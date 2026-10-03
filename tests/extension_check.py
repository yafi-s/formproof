"""Install the packaged MV3 extension in a NEW isolated Chromium profile.

No mocked chrome API, personal profile, real ATS, applicant data or submission.
CDP invokes the real toolbar action and therefore the actual activeTab grant.
"""
import argparse,hashlib,importlib.util,json,tempfile,threading,time
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('serve_demo',ROOT/'tools/serve_demo.py')
demo=importlib.util.module_from_spec(spec);spec.loader.exec_module(demo)
class QuietHandler(demo.Handler):
    def log_message(self,*_):pass

def run(extension_path):
    extension_path=extension_path.resolve();manifest=json.loads((extension_path/'manifest.json').read_text())
    package=json.loads((ROOT/'artifacts/package-manifest.json').read_text())
    assert extension_path.name==package['unpacked']
    for name,sha in package['files'].items():assert hashlib.sha256((extension_path/name).read_bytes()).hexdigest()==sha,name
    checks=['installed folder matches every file in the package hash inventory'];timings=[]
    server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler);threading.Thread(target=server.serve_forever,daemon=True).start()
    other=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler);threading.Thread(target=other.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}';url=base+'/fixtures/pages/extension-ats.html'
    output=ROOT/'results';output.mkdir(exist_ok=True)
    try:
      with sync_playwright() as p,tempfile.TemporaryDirectory(prefix='formproof-installed-',ignore_cleanup_errors=True) as profile:
        context=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
          args=['--enable-unsafe-extension-debugging',f'--disable-extensions-except={extension_path}',f'--load-extension={extension_path}'])
        try:
          network=[];errors=[];context.on('request',lambda request:network.append(request.url))
          worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
          deadline=time.monotonic()+10
          while not worker.evaluate('()=>chrome.action.onClicked.hasListeners()'):
            assert time.monotonic()<deadline;time.sleep(.05)
          ats=context.pages[0];ats.goto(url)
          cdp=context.browser.new_browser_cdp_session()
          extension=next(e for e in cdp.send('Extensions.getExtensions')['extensions'] if e['name'].startswith('FormProof'))
          assert extension['enabled'] and Path(extension['path']).resolve()==extension_path
          def toolbar(page):
            target=next(t for t in cdp.send('Target.getTargets',{'filter':[{}]})['targetInfos'] if t['type']=='tab' and t['url']==page.url)
            cdp.send('Extensions.triggerAction',{'id':extension['id'],'targetId':target['targetId']})
          with context.expect_page() as opened:toolbar(ats)
          ui=opened.value;ui.wait_for_load_state();ui.on('pageerror',lambda error:errors.append(str(error)))
          expect(ui.locator('#unlock')).to_be_enabled()
          ui.locator('#password').fill('synthetic extension passphrase');ui.locator('#unlock').click();expect(ui.locator('#workspace')).to_be_visible()
          checks.append('real installed toolbar action opens persistent workspace with an actual activeTab grant')
          def upload(name,success=True):
            start=time.perf_counter();ui.locator('#files').set_input_files(str(ROOT/'fixtures'/name))
            expect(ui.locator('#files')).to_be_enabled(timeout=20000)
            status=ui.locator('#status').inner_text()
            if success:assert status=='Imported. Verify each proposed fact before reuse.',status
            else:assert not status.startswith('Imported.'),status
            timings.append({'fixture':name,'elapsed_ms':round((time.perf_counter()-start)*1000,2),'status':status})
            return status
          upload('uploads/synthetic-backend.pdf');assert 'PDF.js' in ui.locator('#resumes').inner_text()
          assert 'page 2' in ui.locator('#facts').inner_text()
          ui.locator('#scan').click();expect(ui.locator('#status')).to_have_text('Review every proposed answer, then fill once.')
          expect(ui.locator('#apply')).to_be_disabled();assert ats.locator('[name=email]').input_value()==''
          checks.append('PDF upload extracts two pages with source provenance; unverified proposals cannot fill')
          upload('uploads/synthetic-backend.docx');assert 'Mammoth' in ui.locator('#resumes').inner_text()
          assert '2 resume versions' in ui.locator('#profileCount').inner_text()
          checks.append('DOCX uploads directly and keeps a separate source version')
          ui.locator('#workspace > section').first.screenshot(path=str(output/'extension-upload.png'))
          for name,message in [('textless.pdf','No PDF text layer'),('encrypted.pdf','Password-protected'),('damaged.pdf','could not be read'),('unsafe-path.docx','Unsafe'),('unsupported.doc','Legacy DOC')]:
            assert message in upload('uploads/'+name,False)
            assert '2 resume versions' in ui.locator('#profileCount').inner_text()
          checks.append('scanned, encrypted, damaged, unsafe ZIP and legacy files fail with actionable errors and no partial import')
          ui.locator('#files').set_input_files([str(ROOT/'fixtures/unlabeled.txt'),str(ROOT/'fixtures/uploads/damaged.pdf')])
          expect(ui.locator('#files')).to_be_enabled(timeout=20000)
          assert '2 resume versions' in ui.locator('#profileCount').inner_text()
          checks.append('a malformed second file rolls back the entire staged multi-file import')
          vault_before=ui.evaluate('async()=> (await chrome.storage.local.get("vault")).vault.data')
          ui.locator('#files').set_input_files([{'name':f'oversized-profile-{i}.txt','mimeType':'text/plain',
              'buffer':('Current employer: '+'x'*240000+str(i)).encode()} for i in range(10)])
          expect(ui.locator('#files')).to_be_enabled(timeout=20000)
          expect(ui.locator('#status')).to_contain_text('4 MB text budget')
          assert '2 resume versions' in ui.locator('#profileCount').inner_text()
          assert ui.evaluate('async()=> (await chrome.storage.local.get("vault")).vault.data')==vault_before
          ui.locator('#job').fill('SQL backend');ui.locator('#rank').click()
          assert 'oversized-profile' not in ui.locator('#ranking').inner_text()
          checks.append('a supported-files batch exceeding the total vault budget leaves both live and durable profiles unchanged')
          def verify(key):
            fact=ui.locator('#facts > .candidate').filter(has=ui.locator(f'[data-key="{key}"]'))
            fact.get_by_role('button',name='Verify & choose').first.click()
            expect(fact.get_by_text('Verified choice',exact=True)).to_be_visible()
            expect(ui.locator('#status')).to_contain_text('verified for reuse.')
          for key in ['firstName','lastName','email','phone','city','school','degree','graduation','github']:verify(key)
          def scan():
            ui.locator('#scan').click();expect(ui.locator('#status')).to_have_text('Review every proposed answer, then fill once.')
          scan();assert '/never-submit' in ui.locator('#destination').inner_text()
          assert ui.locator('#review input:checked').count()==5,ui.locator('#review').inner_text()
          assert 'already filled' in ui.locator('#review').inner_text()
          ui.locator('#apply').click();expect(ui.locator('#status')).to_have_text('5 fields filled. Review the page. Nothing was submitted.')
          assert ats.locator('[name=first_name]').input_value()=='Alex' and ats.locator('[name=city]').input_value()=='aus'
          assert ats.locator('[name=portfolio]').input_value()=='https://preserved.example.invalid'
          assert ats.locator('[name=essay]').input_value()=='' and ats.locator('[name=resume]').input_value()==''
          assert ats.locator('[name=honeypot_email]').input_value()=='' and ats.locator('[name=disabled_email]').input_value()==''
          assert ats.evaluate('()=>window.submitCount')==0
          assert ats.evaluate('()=>window.controlledState.email')=='alex@example.invalid'
          checks.append('contact/native-select fill updates reactive state, preserves answers and skips hidden/disabled/files/narrative controls without submitting')
          expect(ui.locator('#apply')).to_be_disabled()
          checks.append('successful fill consumes the preview; another fill requires inspection')
          def manual(key,value):
            ui.locator('#manualFact').evaluate('(element)=>element.open=true')
            ui.locator('#factKey').select_option(key);ui.locator('#factValue').fill(value);ui.locator('#saveFact').click()
            expect(ui.locator('#status')).to_have_text('Saved your explicit answer locally.')
          manual('gender','Prefer not to say');manual('birthDate','2000-02-29')
          ats.locator('#next').click();scan();assert ui.locator('#review input:checked').count()==4
          sensitive=ui.locator('#review .review-row').filter(has_text='sensitive').locator('input[type=checkbox]')
          assert sensitive.count()==2
          for item in sensitive.all():item.check()
          ui.locator('#apply').click();expect(ui.locator('#status')).to_have_text('Sensitive destination approval required')
          assert ats.locator('[name=birth_date]').input_value()=='' and not ats.locator('[name=gender]:checked').count()
          ui.locator('#sensitiveApproval').check()
          ui.set_viewport_size({'width':740,'height':1500})
          ui.locator('#workspace > section').last.screenshot(path=str(output/'extension-destination-preview.png'))
          ui.set_viewport_size({'width':740,'height':860})
          ui.locator('#apply').click()
          expect(ui.locator('#status')).to_have_text('6 fields filled. Review the page. Nothing was submitted.')
          assert ats.locator('[name=graduation]').input_value()=='2028-05' and ats.locator('[name=birth_date]').input_value()=='2000-02-29'
          assert ats.locator('[name=gender]:checked').input_value()=='decline' and ats.locator('[name=degree]').input_value()=='bs'
          assert ats.evaluate('()=>window.submitCount')==0
          checks.append('second-step month/date/native-radio fill needs fresh review and separate explicit sensitive consent')
          ui.screenshot(path=str(output/'extension-review.png'),full_page=True)
          ats.screenshot(path=str(output/'extension-filled-ats.png'),full_page=True)
          vault=ui.evaluate('async()=> (await chrome.storage.local.get("vault")).vault')
          assert 'alex@example.invalid' not in json.dumps(vault) and 'Prefer not to say' not in json.dumps(vault)
          session=ui.evaluate('async()=>await chrome.storage.session.get(null)')
          assert set(session)<= {'targetTabId','workspaceWindow'}
          checks.append('actual browser local storage contains an encrypted envelope; session storage carries only tab/window IDs')
          duplicate=context.new_page();duplicate.goto(ui.url);expect(duplicate.locator('#unlock')).to_be_disabled()
          expect(duplicate.locator('#status')).to_contain_text('already open');duplicate.close()
          checks.append('a second review window cannot unlock a stale competing profile')
          for mutation,expected in [
            ('()=>document.querySelector("form").action="/different-destination"','Destination changed'),
            ('()=>document.querySelector("[name=email]").value="preserved@example.invalid"','no longer empty'),
            ('()=>document.querySelector("#step1").style.opacity="0"','no longer empty')]:
            ats.goto(url);scan();ats.evaluate(mutation);ui.locator('#apply').click()
            expect(ui.locator('#status')).to_contain_text(expected)
            assert ats.locator('[name=first_name]').input_value()==''
            expect(ui.locator('#apply')).to_be_disabled()
          checks.append('changed destinations, existing answers and newly invisible ancestors stop the entire stale fill')
          ats.goto(url);ats.locator('#next').click();scan()
          ui.locator('#review .review-row').filter(has_text='Date of birth').locator('input').check();ui.locator('#sensitiveApproval').check()
          ats.locator('[name=birth_date]').evaluate('(element)=>element.max="1999-12-31"')
          ui.locator('#apply').click();expect(ui.locator('#status')).to_contain_text('Form changed')
          assert ats.locator('[name=school]').input_value()==''
          checks.append('changed date bounds invalidate a preview before any ordinary field is written')
          ats.goto(url);ats.locator('#next').click()
          ats.locator('[name=degree]').evaluate('(select)=>{const group=document.createElement("optgroup");group.label="Unavailable";group.disabled=true;group.append(select.querySelector("[value=bs]"));select.append(group);}')
          scan();assert 'no exact option match' in ui.locator('#review').inner_text()
          assert not ui.locator('#review .review-row').filter(has_text='Degree').locator('input').count()
          ats.goto(url);ats.locator('#next').click();scan()
          ats.locator('[name=degree]').evaluate('(select)=>{const group=document.createElement("optgroup");group.label="Changed";group.disabled=true;group.append(select.querySelector("[value=bs]"));select.append(group);}')
          ui.locator('#apply').click();expect(ui.locator('#status')).to_contain_text('Form changed')
          assert ats.locator('[name=school]').input_value()==''
          checks.append('disabled optgroup inheritance prevents an option proposal and invalidates newly disabled previews')
          ats.goto(url);scan()
          ats.evaluate('()=>document.querySelector("[name=first_name]").addEventListener("input",()=>document.querySelector("form").action="/changed-during-fill",{once:true})')
          ui.locator('#apply').click();expect(ui.locator('#status')).to_contain_text('1 fields filled. Destination changed during fill')
          assert ats.locator('[name=email]').input_value()==''
          checks.append('an input event changing the form destination stops all subsequent writes')
          ats.goto(url);scan();ats.goto(f'http://127.0.0.1:{other.server_port}/fixtures/pages/extension-ats.html')
          ui.locator('#apply').click();expect(ui.locator('#status')).not_to_have_text('Review every proposed answer, then fill once.')
          assert ats.locator('[name=first_name]').input_value()==''
          toolbar(ats);expect(ui.locator('#status')).to_contain_text('Application tab changed');scan()
          checks.append('cross-origin navigation cannot reuse the old activeTab grant; the toolbar reauthorizes the new destination')
          remote=ui.evaluate('async()=>{try{await fetch("https://example.invalid/formproof-csp-probe");return false;}catch{return true;}}')
          assert remote and not any('example.invalid/formproof-csp-probe' in u for u in network)
          assert not any(u.startswith(('http://','https://')) and not u.startswith((base,f'http://127.0.0.1:{other.server_port}')) for u in network),network
          checks.append('CSP blocks remote fetch before any network request; all observed HTTP requests were synthetic localhost assets')
          ui.locator('#lock').click();expect(ui.locator('#workspace')).to_be_hidden();assert ui.locator('#facts').inner_text()==''
          ui.locator('#password').fill('wrong synthetic passphrase');ui.locator('#unlock').click();expect(ui.locator('#workspace')).to_be_hidden()
          ui.locator('#password').fill('synthetic extension passphrase');ui.locator('#unlock').click();expect(ui.locator('#workspace')).to_be_visible()
          assert '2 resume versions' in ui.locator('#profileCount').inner_text()
          checks.append('lock removes displayed plaintext; a wrong passphrase fails; the correct passphrase restores verified facts')
          ui.locator('#erase').click();expect(ui.locator('#status')).to_have_text('Local profile deleted. Original files are unchanged.')
          assert ui.evaluate('async()=>Object.keys(await chrome.storage.local.get(null)).length')==0
          ui.locator('#password').fill('synthetic extension passphrase');ui.locator('#unlock').click();expect(ui.locator('#workspace')).to_be_visible()
          upload('unlabeled.txt');expect(ui.locator('#nameParts')).to_be_visible()
          ui.locator('#confirmedFirstName').fill('Example');ui.locator('#confirmedLastName').fill('Person');ui.locator('#confirmNameParts').click()
          expect(ui.locator('#status')).to_have_text('Saved the name parts you explicitly confirmed.')
          assert 'user entry' in ui.locator('#facts').inner_text().lower()
          checks.append('unlabeled full-name resumes require explicit name-part confirmation; manual values keep user-entry provenance')
          ui.evaluate('()=>{window.originalArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){await new Promise(resolve=>window.releaseImport=resolve);return window.originalArrayBuffer.call(this);}}')
          ui.locator('#files').set_input_files(str(ROOT/'fixtures/uploads/synthetic-backend.pdf'))
          ui.wait_for_function('()=>typeof window.releaseImport==="function"')
          ui.locator('#erase').click();expect(ui.locator('#status')).to_have_text('Local profile deleted. Original files are unchanged.')
          ui.evaluate('async()=>{window.releaseImport();await new Promise(resolve=>setTimeout(resolve,250));File.prototype.arrayBuffer=window.originalArrayBuffer;}')
          assert ui.evaluate('async()=>Object.keys(await chrome.storage.local.get(null)).length')==0 and ui.locator('#facts').inner_text()==''
          expect(ui.locator('#status')).to_have_text('Local profile deleted. Original files are unchanged.')
          checks.append('actual installed delayed PDF upload cannot recreate a deleted vault or restore plaintext')
          assert not errors,errors
          report={'schema':'formproof.installed-extension.v1','scope':'actual packaged extension; new isolated profile; synthetic localhost ATS only',
            'browser':context.browser.version,'version':manifest['version'],'package_sha256':package['zip_sha256'],
            'checks':checks,'parser_timings':timings,'http_requests':len([u for u in network if u.startswith('http')]),'page_errors':errors,
            'limitations':['Chromium automation, not a manual Chrome/Edge install','No real employer ATS tested','No scanned OCR/custom widgets/iframes/shadow DOM/attachment/submission']}
          (output/'extension-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
          print(f'{len(checks)} actual packaged extension checks passed; browser {context.browser.version}')
        finally:context.close()
    finally:server.shutdown();server.server_close();other.shutdown();other.server_close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--extension',type=Path,default=ROOT/'artifacts/formproof-0.2.0-unpacked');args=parser.parse_args();run(args.extension)

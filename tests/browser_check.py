"""Headless Chromium tests of controlled mock ATS pages; never installs the extension."""
from __future__ import annotations
import functools
import html
import json
import platform
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VALUES = dict(firstName='Alex', lastName='Example', fullName='Alex Example', email='alex@example.invalid',
              phone='+1 202 555 0104', city='Austin', linkedin='https://www.linkedin.com/in/alex-example',
              github='https://github.com/example-alex', website='https://example.invalid/alex',
              school='Example State University', degree='Bachelor of Science', graduation='May 2028',
              currentEmployer='Example Labs', currentTitle='Software Engineering Intern', gender='Prefer not to say',
              citizenship='Synthetic country', ethnicity='Prefer not to say', sponsorship='No',
              workAuthorization='Yes', veteranStatus='Prefer not to say')


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def fixture_html(case):
    fields = []
    for i, field in enumerate(case['fields']):
        ident = f'control-{i}'
        label = html.escape(field['label'])
        name = html.escape(field['name'])
        attrs = f'id="{ident}" name="{name}"'
        if field.get('disabled'):
            attrs += ' disabled'
        if field.get('readonly'):
            attrs += ' readonly'
        if field.get('hidden'):
            attrs += ' style="display:none"'
        if field.get('autocomplete'):
            attrs += f' autocomplete="{html.escape(field["autocomplete"])}"'
        style = field.get('style')
        if style == 'aria':
            attrs += f' aria-label="{label}"'
        elif style == 'labelledby':
            attrs += f' aria-labelledby="label-{i}"'
        elif style == 'placeholder':
            attrs += f' placeholder="{label}"'
        prefix = '' if style in {'aria', 'placeholder'} else f'<label id="label-{i}" for="{ident}">{label}</label>'
        kind = field.get('kind', 'text')
        if kind == 'select':
            options = ''.join(f'<option value="{html.escape(v)}">{html.escape(t)}</option>' for v, t in field['options'])
            control = f'<select {attrs}>{options}</select>'
        elif kind == 'radio':
            controls = ''.join(f'<label><input type="radio" name="{name}" value="{html.escape(v)}">{html.escape(t)}</label>' for v, t in field['options'])
            control = f'<fieldset><legend>{label}</legend>{controls}</fieldset>'
            prefix = ''
        elif kind == 'textarea':
            control = f'<textarea {attrs}></textarea>'
        else:
            control = f'<input {attrs} type="{field.get("type", "text")}" value="{html.escape(field.get("value", ""))}">'
        fields.append(f'<div class="field">{prefix}{control}</div>')
    return ('<!doctype html><meta charset="utf-8"><title>Controlled ATS fixture</title>'
            '<style>body{font:16px system-ui;max-width:760px;margin:30px auto}label{display:block}.field{margin:12px 0}</style>'
            f'<h1>{html.escape(case["name"])}</h1><form action="/never-submit">' + ''.join(fields) +
            '<button type="submit">Submit application</button></form>'
            '<script>window.submitCount=0;document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();window.submitCount++})</script>')


INIT = """async values => {
  const core=await import('/extension/core.js'); const dom=await import('/extension/page.js');
  const profile=core.emptyProfile(); for(const [k,v]of Object.entries(values))core.setUserFact(profile,k,v);
  window.testApi={core,dom,profile};
} """
PLAN = """() => {const a=window.testApi; const start=performance.now();
  const snapshot=a.dom.scanPage(); const plan=a.core.buildPlan(a.profile,snapshot); a.plan=plan;
  return {snapshot,plan,planning_ms:performance.now()-start};} """
APPLY = """sensitive => {const a=window.testApi; const ids=a.plan.rows.filter(r=>r.status!=='abstain').map(r=>r.id);
  const approval=a.core.approvePlan(a.plan,ids,sensitive,a.profile.revision);a.approval=approval;
  const start=performance.now();const result=a.dom.applyPage(approval);return {...result,apply_ms:performance.now()-start};} """


def run():
    output = ROOT / 'results'
    output.mkdir(exist_ok=True)
    cases = json.loads((ROOT / 'fixtures/cases.json').read_text())
    generated = ROOT / 'fixtures/pages'
    generated.mkdir(exist_ok=True)
    for case in cases:
        (generated / f'{case["name"]}.html').write_text(fixture_html(case), encoding='utf-8')
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    checks, records, baseline_rows = [], [], []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1080, 'height': 1000})
            page = context.new_page()
            for case in cases:
                page.goto(f'{base}/fixtures/pages/{case["name"]}.html')
                page.evaluate(INIT, VALUES)
                observed = page.evaluate(PLAN)
                assert len(observed['snapshot']['fields']) == len(case['fields'])
                # Sensitive values cannot be applied without separate destination approval.
                if any(r.get('sensitive') for r in observed['plan']['rows']):
                    try:
                        page.evaluate(APPLY, False)
                        raise AssertionError('Sensitive approval was bypassed')
                    except Exception as error:
                        assert 'Sensitive destination approval required' in str(error)
                    checks.append(f'{case["name"]}: sensitive approval blocked')
                applied = page.evaluate(APPLY, True)
                assert not applied['errors'], applied
                assert page.evaluate('window.submitCount') == 0
                current = page.evaluate("""() => [...document.querySelectorAll('.field')].map(div=>{
                  const e=div.querySelector('input,select,textarea');
                  return e.type==='radio'?(div.querySelector('input:checked')?.value??''):e.value;
                })""")
                for i, field in enumerate(case['fields']):
                    expected = field.get('expected', VALUES.get(field.get('key'))) if field.get('key') else field.get('value', '')
                    # Checkboxes are never filled or clicked, irrespective of their HTML value.
                    if field.get('type') == 'checkbox':
                        assert not page.locator(f'[name="{field["name"]}"]').is_checked()
                        expected = field.get('value', '')
                    assert current[i] == expected, (case['name'], field, current[i], expected)
                    row = observed['plan']['rows'][i]
                    records.append({'fixture': case['name'], 'label': field['label'], 'truth_key': field.get('key'),
                                    'expected': expected, 'status': row['status'], 'reason': row.get('reason'),
                                    'actual': current[i], 'planning_ms': observed['planning_ms'], 'apply_ms': applied['apply_ms']})
                replay = page.evaluate('() => window.testApi.dom.applyPage(window.testApi.approval)')
                assert replay['errors'] == ['Review expired or already used']
                checks.append(f'{case["name"]}: expected fields, preserved fields, no submission and one-use approval')

            # Re-review changes: labels, destination/action, options, editability, and prefilled data.
            mutations = [
                ('label', "document.querySelector('label').textContent='Citizenship'"),
                ('action', "document.querySelector('form').action='/different-destination'"),
                ('prefilled', "document.querySelector('input').value='user edit'"),
                ('disabled', "document.querySelector('input').disabled=true"),
                ('hidden', "document.querySelector('input').style.display='none'"),
                ('removed', "document.querySelector('input').remove()")
            ]
            for name, script in mutations:
                page.goto(f'{base}/fixtures/pages/native-contact.html')
                page.evaluate(INIT, VALUES)
                page.evaluate(PLAN)
                page.evaluate(script)
                result = page.evaluate(APPLY, True)
                assert not result['applied'] and result['errors'], result
                assert page.evaluate('window.submitCount') == 0
                checks.append(f'changed {name}: entire approval blocked')

            page.goto(f'{base}/fixtures/pages/choices.html')
            page.evaluate(INIT, VALUES)
            page.evaluate(PLAN)
            page.evaluate("document.querySelector('select').options[1].textContent='Not Austin'")
            result = page.evaluate(APPLY, True)
            assert not result['applied'] and result['errors']
            checks.append('changed select options: entire approval blocked')

            page.goto(f'{base}/fixtures/pages/native-contact.html')
            page.evaluate(INIT, VALUES)
            page.evaluate(PLAN)
            page.evaluate("document.querySelector('input').addEventListener('input',()=>document.querySelectorAll('input')[1].value='script edit')")
            result = page.evaluate(APPLY, True)
            assert len(result['applied']) == 1 and result['errors']
            checks.append('page mutation during input event: partial result reported and remaining fields skipped')

            for mutation in ('url','action'):
                page.goto(f'{base}/fixtures/pages/native-contact.html')
                page.set_content('<form action="/reviewed"><label>Email<input type="email" name="email"></label>'
                    '<label for="gender">Gender</label><select id="gender"><option value=""></option><option>Prefer not to say</option></select></form>')
                page.evaluate(INIT, VALUES);page.evaluate(PLAN)
                script="history.pushState({},'', '/unreviewed')" if mutation=='url' else "document.querySelector('form').action='/unreviewed'"
                page.evaluate("document.querySelector('input').addEventListener('input',()=>{"+script+"})")
                result=page.evaluate(APPLY,True)
                assert len(result['applied'])==1 and 'Destination changed during fill' in result['errors'][0]
                assert page.locator('select').input_value()==''
                checks.append(f'{mutation} changed during first input: later sensitive answer withheld')

            radio_html=('<form><label>Email<input name="email"></label><fieldset><legend>Gender</legend>'
                '<label><input type="radio" name="gender" value="na">Prefer not to say</label></fieldset></form>')
            append_radio="""const x=document.createElement('input');x.type='radio';x.name='gender';x.value='new';
                document.querySelector('fieldset').append(x);x.checked=true;"""
            for during in (False,True):
                page.goto(f'{base}/fixtures/pages/native-contact.html');page.set_content(radio_html)
                page.evaluate(INIT,VALUES);page.evaluate(PLAN)
                if during:page.evaluate("document.querySelector('[name=email]').addEventListener('input',()=>{"+append_radio+"})")
                else:page.evaluate('() => {'+append_radio+'}')
                result=page.evaluate(APPLY,True)
                assert len(result['applied'])==(1 if during else 0) and result['errors']
                assert page.locator('[value=new]').is_checked() and not page.locator('[value=na]').is_checked()
                checks.append(f'new checked radio {"during fill" if during else "after review"}: preserved and approval stopped')

            page.goto(f'{base}/fixtures/pages/native-contact.html');page.evaluate(INIT,VALUES);page.evaluate(PLAN)
            isolated=page.evaluate("""async () => {
                const a=window.testApi,approval=a.core.approvePlan(a.plan,a.plan.rows.filter(r=>r.status!=='abstain').map(r=>r.id),true,a.profile.revision);
                const frame=document.createElement('iframe');frame.src='/fixtures/pages/native-contact.html';
                const ready=new Promise(resolve=>frame.onload=resolve);document.body.append(frame);await ready;
                return frame.contentWindow.eval('('+a.dom.applyPage.toString()+')')(approval);
            }""")
            assert isolated['errors']==['Review expired or already used'] and not isolated['applied']
            checks.append('approval from another DOM frame rejected; actual extension isolated-world installation remains untested')

            # The popup runs as a local page with a storage-only mock; extension is never installed.
            ui = context.new_page()
            ui.add_init_script("""window.chrome={storage:{local:{
              async setAccessLevel(){},async get(){return {vault:window.mockVault}},
              async set(v){window.mockVault=v.vault},async remove(){delete window.mockVault}}},
              tabs:{async query(){return [{id:42,url:window.mockTarget.contentWindow.location.href}]}},
              scripting:{async executeScript(request){const fn=window.mockTarget.contentWindow.eval('('+request.func.toString()+')');
                return [{result:fn(...(request.args??[]))}]}}};""")
            ui.goto(f'{base}/extension/popup.html')
            ui.evaluate("""async () => {window.mockTarget=document.createElement('iframe');
              window.mockTarget.id='mock-target'; window.mockTarget.style='position:absolute;left:-9999px;width:600px;height:800px';
              window.mockTarget.src='/fixtures/pages/choices.html';const ready=new Promise(resolve=>window.mockTarget.onload=resolve);
              document.body.append(window.mockTarget);await ready;}""")
            target=ui.frame_locator('#mock-target')
            ui.locator('#password').fill('synthetic passphrase 2026')
            ui.locator('#unlock').click()
            ui.locator('#workspace').wait_for(state='visible')
            ui.locator('#files').set_input_files([str(ROOT/'fixtures/backend.txt'),str(ROOT/'fixtures/ml.txt')])
            ui.get_by_text('2 resume versions · revision 2').wait_for()
            assert ui.locator('#facts').inner_text().count('conflicting resume versions') == 1
            ui.locator('#job').fill('SQL backend transactions recovery databases')
            ui.locator('#rank').click()
            assert 'Suggested version' in ui.locator('#ranking').inner_text()
            ui.locator('#confirmResume').click()
            ui.get_by_text('Version selected. Attach the original resume file manually.').wait_for()
            ui.locator('summary').click()
            ui.locator('#factKey').select_option('gender')
            ui.locator('#factValue').fill('Prefer not to say')
            ui.locator('#saveFact').click()
            ui.get_by_text('Saved your explicit answer locally.').wait_for()
            vault = ui.evaluate('JSON.stringify(window.mockVault)')
            assert 'Prefer not to say' not in vault and 'alex@example.invalid' not in vault
            ui.screenshot(path=str(output/'review-ui.png'), full_page=True)
            for key in ('city','degree'):
                fact=ui.locator('#facts > .candidate').filter(has=ui.locator('strong',has_text=re.compile('^'+key+'$')))
                fact.get_by_role('button',name='Verify & choose').first.click()
                ui.get_by_text(f'2 resume versions · revision {5 if key=="city" else 6}').wait_for()
            ui.locator('#scan').click()
            ui.get_by_text('Review every proposed answer, then fill once.').wait_for()
            assert len(ui.locator('#review input:checked').all())==2
            assert '/never-submit' in ui.locator('#destination').inner_text()
            assert '/never-submit' in ui.locator('#review').inner_text()
            checks.append('review displays page URL and actual per-field form action before sensitive consent')
            ui.locator('#review label').filter(has_text='Gender').locator('input').check()
            ui.locator('#apply').click()
            ui.get_by_text('Sensitive destination approval required').wait_for()
            assert target.locator('[name="c3"]').input_value()==''
            ui.locator('#sensitiveApproval').check()
            ui.locator('#workspace > section').nth(2).screenshot(path=str(output/'destination-review.png'))
            ui.locator('#apply').click()
            ui.get_by_text('3 fields filled. Review the page. Nothing was submitted.').wait_for()
            assert target.locator('[name="c1"]').input_value()=='austin'
            assert target.locator('[name="c2"]').input_value()=='bs'
            assert target.locator('[name="c3"]').input_value()=='na'
            assert ui.evaluate('window.mockTarget.contentWindow.submitCount')==0
            checks.append('popup scan/review/sensitive gate/apply integration passed through mock Chrome bridge')
            ui.locator('#lock').click()
            ui.locator('#workspace').wait_for(state='hidden')
            assert ui.locator('#facts').inner_text() == ''
            ui.locator('#password').fill('synthetic passphrase 2026')
            ui.locator('#unlock').click()
            ui.locator('#workspace').wait_for(state='visible')
            assert 'Prefer not to say' in ui.locator('#facts').inner_text()
            ui.locator('#erase').click()
            ui.locator('#workspace').wait_for(state='hidden')
            assert ui.evaluate('window.mockVault') is None
            checks.append('popup import/conflict/ranking/encrypted persistence/lock/unlock/delete verified with storage mock')

            # Delayed writes and callbacks must not resurrect a vault or stale plaintext after deletion.
            ui.locator('#password').fill('synthetic passphrase 2026');ui.locator('#unlock').click()
            ui.locator('#workspace').wait_for(state='visible')
            ui.evaluate("""() => {window.originalSet=chrome.storage.local.set;
                chrome.storage.local.set=async value=>{await new Promise(resolve=>window.releaseStorage=resolve);await window.originalSet(value);};}""")
            if not ui.locator('#factValue').is_visible():ui.locator('summary').click()
            ui.locator('#factKey').select_option('gender');ui.locator('#factValue').fill('Prefer not to say')
            ui.locator('#saveFact').click();ui.wait_for_function("typeof window.releaseStorage==='function'")
            ui.locator('#erase').click();ui.locator('#workspace').wait_for(state='hidden')
            assert ui.locator('#facts').inner_text()=='' and ui.locator('#unlock').is_disabled()
            ui.evaluate("""() => {document.querySelector('#factKey').value='citizenship';document.querySelector('#factValue').value='Synthetic country';
                document.querySelector('#saveFact').click();window.releaseStorage();}""")
            ui.get_by_text('Local profile deleted. Original files are unchanged.').wait_for()
            assert ui.evaluate('window.mockVault') is None
            assert ui.locator('#facts').inner_text()=='' and ui.locator('#review').inner_text()==''
            ui.evaluate('() => {chrome.storage.local.set=window.originalSet;}')
            checks.append('deletion fences new edits and drains delayed storage writes before removing vault')

            ui.locator('#password').fill('synthetic passphrase 2026');ui.locator('#unlock').click()
            ui.locator('#workspace').wait_for(state='visible')
            ui.evaluate("""() => {window.originalText=File.prototype.text;File.prototype.text=async function(){
                await new Promise(resolve=>window.releaseImport=resolve);const text=await window.originalText.call(this);window.importReturned=true;return text;};}""")
            ui.locator('#files').set_input_files(str(ROOT/'fixtures/backend.txt'));ui.wait_for_function("typeof window.releaseImport==='function'")
            ui.locator('#erase').click();ui.get_by_text('Local profile deleted. Original files are unchanged.').wait_for()
            ui.evaluate('() => {window.releaseImport();}');ui.wait_for_function('window.importReturned')
            ui.evaluate('async () => {await new Promise(resolve=>setTimeout(resolve,20));File.prototype.text=window.originalText;}')
            assert ui.evaluate('window.mockVault') is None and ui.locator('#facts').inner_text()==''
            assert ui.locator('#status').inner_text()=='Local profile deleted. Original files are unchanged.'
            checks.append('delayed resume import cannot repopulate profile, vault or status after deletion')

            ui.locator('#password').fill('synthetic passphrase 2026');ui.locator('#unlock').click()
            ui.locator('#workspace').wait_for(state='visible')
            ui.evaluate("""() => {window.originalQuery=chrome.tabs.query;chrome.tabs.query=async()=>{
                await new Promise(resolve=>window.releaseScan=resolve);const tabs=await window.originalQuery();window.scanReturned=true;return tabs;};}""")
            ui.locator('#scan').click();ui.wait_for_function("typeof window.releaseScan==='function'")
            ui.locator('#erase').click();ui.get_by_text('Local profile deleted. Original files are unchanged.').wait_for()
            ui.evaluate('() => {window.releaseScan();}');ui.wait_for_function('window.scanReturned')
            ui.evaluate('async () => {await new Promise(resolve=>setTimeout(resolve,20));chrome.tabs.query=window.originalQuery;}')
            assert ui.evaluate('window.mockVault') is None and ui.locator('#review').inner_text()==''
            assert ui.locator('#status').inner_text()=='Local profile deleted. Original files are unchanged.'
            checks.append('delayed page scan cannot restore review or status after deletion')

            # Transparent synthetic entry-time experiment, not a human productivity study.
            entry_trials=[]
            for trial in range(3):
                native=cases[0]
                page.goto(f'{base}/fixtures/pages/native-contact.html')
                start=time.perf_counter()
                typed_characters=0
                for field in native['fields']:
                    if not field.get('key'):continue
                    value=VALUES[field['key']]
                    control=page.locator(f'[name="{field["name"]}"]')
                    control.click()
                    control.press_sequentially(value,delay=20)
                    page.wait_for_timeout(100)
                    typed_characters+=len(value)
                scripted_typing_ms=(time.perf_counter()-start)*1000
                page.goto(f'{base}/fixtures/pages/native-contact.html')
                page.evaluate(INIT,VALUES)
                start=time.perf_counter()
                page.evaluate(PLAN)
                result=page.evaluate(APPLY,True)
                automated_entry_ms=(time.perf_counter()-start)*1000
                assert len(result['applied'])==14 and not result['errors']
                entry_trials.append({'trial':trial,'fields':14,'typed_characters':typed_characters,
                    'scripted_typing_ms':scripted_typing_ms,'plan_and_approved_apply_ms':automated_entry_ms,
                    'mechanical_entry_time_difference_ms':scripted_typing_ms-automated_entry_ms})
            checks.append('three controlled scripted typing versus approved-fill entry trials; no submission')

            # A plausible naive baseline: name/id hints, first candidate, no label semantics.
            alias = [('first','firstName'),('last','lastName'),('email','email'),('phone','phone'),('city','city'),
                     ('linkedin','linkedin'),('github','github'),('school','school'),('degree','degree'),
                     ('employer','currentEmployer'),('company','currentEmployer'),('title','currentTitle'),
                     ('name','fullName')]
            for case in cases:
                for field in case['fields']:
                    eligible = not (field.get('disabled') or field.get('readonly') or field.get('hidden') or
                                    field.get('value') or field.get('type') in {'password','file','checkbox','date'})
                    key = next((v for hint,v in alias if hint in field['name']), None) if eligible else None
                    value = VALUES.get(key)
                    if field.get('kind') in {'select','radio'} and value:
                        value = next((v for v,t in field['options'] if t.lower()==value.lower()),None)
                    truth = field.get('expected',VALUES.get(field.get('key'))) if field.get('key') else None
                    baseline_rows.append({'fixture':case['name'],'label':field['label'],'expected':truth,
                                          'proposal':value,'correct':value is not None and value==truth})
            proposed = sum(r['status']!='abstain' for r in records)
            supported = sum(r['truth_key'] is not None for r in records)
            base_proposed = sum(r['proposal'] is not None for r in baseline_rows)
            base_correct = sum(r['correct'] for r in baseline_rows)
            report = {'schema':'formproof.browser-evaluation.v1','timestamp':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
                      'environment':{'python':platform.python_version(),'browser':browser.version,'platform':platform.platform()},
                      'scope':'controlled synthetic ATS native fields; page functions and local popup mock; extension not installed',
                      'total_fields':len(records),'supported_fields':supported,'proposed':proposed,'correct':proposed,
                      'precision':1.0,'supported_recall':proposed/supported,'abstention_rate':(len(records)-proposed)/len(records),
                      'required_corrections':0,'measured_human_time_savings_seconds':None,
                      'entry_time_experiment':{'scope':'mechanical field entry only; synthetic script at 20 ms/character + 100 ms/field, including Playwright call overhead',
                        'excluded':['human review/cognition','initial fact verification','resume import','extension installation','file attachment','application submission'],
                        'human_time_savings_claim_supported':False,'trials':entry_trials},
                      'baseline':{'name':'naive name/id substring mapper with same verified facts',
                                  'proposed':base_proposed,'correct':base_correct,'precision':base_correct/base_proposed,
                                  'supported_recall':base_correct/supported,'required_corrections':base_proposed-base_correct,
                                  'rows':baseline_rows},
                      'checks':checks,'rows':records}
            (output/'browser-evaluation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps({k:v for k,v in report.items() if k not in {'rows','checks','baseline'}}))
            print(f'{len(checks)} browser checks passed; baseline {base_correct}/{base_proposed} accepted proposals correct')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()

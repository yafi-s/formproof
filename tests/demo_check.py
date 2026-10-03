"""Verify the actual local demo server and its browser bridge without installing an extension."""
import importlib.util
import json
import re
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('serve_demo',ROOT/'tools/serve_demo.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def run():
    server=ThreadingHTTPServer(('127.0.0.1',0),module.Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    checks=[]
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True)
            context=browser.new_context(viewport={'width':1440,'height':1100})
            page=context.new_page();page.goto(base)
            ui=page.frame_locator('#copilot');ats=page.frame_locator('#application')
            ui.locator('#password').fill('synthetic demo passphrase')
            ui.locator('#unlock').click();ui.locator('#workspace').wait_for(state='visible')
            ui.locator('#files').set_input_files(str(ROOT/'fixtures/backend.txt'))
            ui.get_by_text('1 resume versions · revision 1').wait_for()
            for key in ('firstName','email'):
                fact=ui.locator('#facts > .candidate').filter(has=ui.locator('strong',has_text=re.compile('^'+key+'$')))
                fact.get_by_role('button',name='Verify & choose').click()
                ui.get_by_text(f'1 resume versions · revision {2 if key=="firstName" else 3}').wait_for()
            ui.locator('#scan').click();ui.get_by_text('Review every proposed answer, then fill once.').wait_for()
            ui.locator('#apply').click();ui.get_by_text('2 fields filled. Review the page. Nothing was submitted.').wait_for()
            assert ats.locator('[name="first_name"]').input_value()=='Alex'
            assert ats.locator('[name="email"]').input_value()=='alex@example.invalid'
            assert page.evaluate('document.querySelector("#application").contentWindow.submitCount')==0
            checks.append('real loopback demo server: import/verify/scan/fill writes only the controlled iframe')
            ui.locator('summary').click();ui.locator('#factKey').select_option('gender')
            ui.locator('#factValue').fill('<img src=x onerror="window.xss=true">')
            ui.locator('#saveFact').click();ui.get_by_text('Saved your explicit answer locally.').wait_for()
            assert ui.locator('#facts img').count()==0
            assert page.evaluate('document.querySelector("#copilot").contentWindow.xss') is None
            checks.append('user fact HTML is rendered as inert text')
            assert context.request.get(base+'/README.md').status==404
            assert context.request.get(base+'/tools/import_resume.py').status==404
            assert context.request.post(base+'/upload',data='synthetic').status==405
            checks.append('server rejects non-asset reads and all POST uploads')
            for path in ('/extension/%2e%2e/README.md','/extension/%2e%2e/tools/import_resume.py',
                         '/demo/%2e%2e%2fREADME.md','/tools/import_resume.py'):
                for method in ('GET','HEAD'):
                    try:
                        urlopen(Request(base+path,method=method));raise AssertionError((path,method))
                    except HTTPError as error:assert error.code==404
            checks.append('canonical asset allowlist blocks encoded traversal for GET and HEAD')
            assert context.request.head(base+'/extension/popup.html').status==200
            checks.append('HEAD follows the same validated asset routing as GET')
            manifest=json.loads((ROOT/'extension/manifest.json').read_text())
            assert set(manifest['permissions'])=={'activeTab','scripting','storage'}
            assert not manifest.get('host_permissions') and not manifest.get('content_scripts')
            assert "connect-src 'none'" in manifest['content_security_policy']['extension_pages']
            checks.append('manifest has minimal user-invoked permissions and no network endpoint access')
            page.screenshot(path=str(ROOT/'results/local-demo.png'),full_page=True)
            page.evaluate('() => {document.querySelector("#copilot").contentWindow.chrome.storage.local.set=async()=>{throw new Error("Synthetic storage quota failure")};}')
            ui.locator('#factKey').select_option('citizenship');ui.locator('#factValue').fill('Synthetic country')
            ui.locator('#saveFact').click();ui.get_by_text('Synthetic storage quota failure').wait_for()
            ui.locator('#erase').click();ui.get_by_text('Local profile deleted. Original files are unchanged.').wait_for()
            assert page.evaluate('document.querySelector("#copilot").contentWindow.localStorage.getItem("formproof-demo-vault")') is None
            checks.append('a failed storage write still permits complete local vault deletion')
            (ROOT/'results/demo-verification.json').write_text(json.dumps({'schema':'formproof.demo-verification.v1',
                'scope':'controlled localhost only; no extension installation','browser':browser.version,'checks':checks},indent=2),encoding='utf-8')
            browser.close()
            print(f'{len(checks)} local demo checks passed')
    finally:server.shutdown();server.server_close()


if __name__=='__main__':run()

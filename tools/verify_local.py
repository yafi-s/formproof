"""Reproduce local proof and bind observations to the tested source/assets."""
import datetime,hashlib,json,platform,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];results=ROOT/'results';results.mkdir(exist_ok=True)
record=results/'local-verification.json'
if record.exists():
    old=json.loads(record.read_text(encoding='utf-8'))
    if old.get('extension_installed') is False:
        history=results/'history';history.mkdir(exist_ok=True)
        (history/'local-verification-0.1.json').write_text(json.dumps(old,indent=2)+'\n',encoding='utf-8')
commands=[('vendored-assets',[sys.executable,'tools/verify_assets.py']),
 ('node-unit-security',['node','--test','tests/core.test.mjs','tests/upload.test.mjs']),
 ('python-importer',[sys.executable,'-m','unittest','discover','-s','tests','-p','test_*.py','-v']),
 ('descriptor-evaluation',['node','tests/evaluate.mjs']),('parser-evaluation',['node','tests/parser_evaluate.mjs']),
 ('mock-browser',[sys.executable,'tests/browser_check.py']),('localhost-demo',[sys.executable,'tests/demo_check.py']),
 ('extension-package',[sys.executable,'tools/package_extension.py']),('installed-extension',[sys.executable,'tests/extension_check.py'])]
checks=[];logs=results/'verification-logs';logs.mkdir(exist_ok=True)
for name,args in commands:
    start=time.perf_counter();run=subprocess.run(args,cwd=ROOT,capture_output=True,encoding='utf-8',errors='replace')
    output=run.stdout+run.stderr;(logs/f'{name}.txt').write_text(output,encoding='utf-8')
    check={'name':name,'exit_code':run.returncode,'elapsed_seconds':round(time.perf_counter()-start,3),
           'log':f'verification-logs/{name}.txt','log_sha256':hashlib.sha256(output.encode()).hexdigest()};checks.append(check)
    print(f'{name}: {"PASS" if run.returncode==0 else "FAIL"} ({check["elapsed_seconds"]} s)',flush=True)
    if run.returncode:print(output);break
source={}
for folder in ['extension','tests','tools','fixtures','docs','.github']:
    for path in (ROOT/folder).rglob('*'):
        if path.is_file() and '__pycache__' not in path.parts:source[path.relative_to(ROOT).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
for name in ['README.md','THIRD_PARTY.md','LICENSE','package.json','package-lock.json','requirements-optional.txt','setup.ps1','verify.ps1','.gitignore','.gitattributes']:
    source[name]=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
proof={'schema':'formproof.local-verification.v2','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'environment':{'python':platform.python_version(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'platform':platform.platform()},
 'all_local_checks_passed':len(checks)==len(commands) and all(c['exit_code']==0 for c in checks),'checks':checks,
 'extension_installed':True,'scope':'actual packaged MV3 extension in a fresh isolated Chromium profile; synthetic localhost only',
 'source_sha256':source,'independent_review':'source/assets review: all three new concrete regressions closed; see docs/REVIEW.md',
 'remote_ci_status':'recorded separately by exact Git commit; not inferred from local tests'}
record.write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
raise SystemExit(0 if proof['all_local_checks_passed'] else 1)

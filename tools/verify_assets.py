"""Verify pinned vendored assets without network access or package installation."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];vendor=ROOT/'extension/vendor'
pdf=json.loads((vendor/'pdfjs/upstream.json').read_text());parser=json.loads((vendor/'parser-manifest.json').read_text())
lock=json.loads((ROOT/'package-lock.json').read_text());manifest=json.loads((ROOT/'extension/manifest.json').read_text())
for name,sha in pdf['files'].items():assert hashlib.sha256((vendor/'pdfjs'/name).read_bytes()).hexdigest()==sha,name
assert {p.relative_to(vendor/'pdfjs').as_posix() for p in (vendor/'pdfjs').rglob('*') if p.is_file()}==set(pdf['files'])|{'upstream.json'}
assert not any('Liberation' in name for name in pdf['files'])
for name,sha in parser['files'].items():assert hashlib.sha256((vendor/name).read_bytes()).hexdigest()==sha,name
for package in parser['packages']:
    pinned=lock['packages']['node_modules/'+package['name']]
    assert pinned['version']==package['version'] and pinned['integrity']==package['integrity'],package['name']
    assert any((vendor/'licenses'/package['name'].replace('/','__')).iterdir()),package['name']
assert set(manifest['permissions'])=={'activeTab','scripting','storage'} and not manifest.get('host_permissions') and not manifest.get('content_scripts')
assert manifest['version']==json.loads((ROOT/'package.json').read_text())['version']
assert manifest['content_security_policy']['extension_pages']=="script-src 'self'; object-src 'none'; connect-src 'self'; worker-src 'self'"
assert not manifest['action'].get('default_popup')
print(f"Verified {len(pdf['files'])} PDF assets, {len(parser['packages'])} bundled package pins/notices and minimal MV3 permissions.")

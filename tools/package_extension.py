"""Package only the extension and public installation/license files. No profile or resume input."""
import hashlib,json,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def package():
    manifest=json.loads((ROOT/'extension/manifest.json').read_text(encoding='utf-8'))
    version=manifest['version'];out=ROOT/'artifacts';out.mkdir(exist_ok=True)
    unpacked=out/f'formproof-{version}-unpacked';unpacked.mkdir(exist_ok=True)
    files={p.relative_to(ROOT/'extension').as_posix():p for p in (ROOT/'extension').rglob('*') if p.is_file()}
    assert all(p.suffix in {'.js','.mjs','.json','.html','.css','.png','.bcmap','.pfb'} or p.name in {'LICENSE','LICENSE.txt','LICENSE_FOXIT','LICENSE_APACHE','LICENSE.md','LICENSE.markdown'} for p in files.values()),'Unexpected extension asset'
    files.update({'INSTALL.md':ROOT/'docs/INSTALL.md','PROJECT_LICENSE':ROOT/'LICENSE','THIRD_PARTY.md':ROOT/'THIRD_PARTY.md'})
    # Refuse stale outputs rather than deleting anything.
    existing={p.relative_to(unpacked).as_posix() for p in unpacked.rglob('*') if p.is_file()}
    assert existing<=files.keys(),'Package contains stale files; choose a new version/output directory'
    hashes={}
    zipped=out/f'formproof-{version}.zip'
    with zipfile.ZipFile(zipped,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,source in sorted(files.items()):
            data=source.read_bytes();target=unpacked/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
            info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)
            hashes[name]=hashlib.sha256(data).hexdigest()
    result={'schema':'formproof.package.v1','version':version,'files':hashes,'zip':zipped.name,'zip_bytes':zipped.stat().st_size,
            'zip_sha256':hashlib.sha256(zipped.read_bytes()).hexdigest(),'unpacked':unpacked.name}
    (out/'package-manifest.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='files'}));return unpacked
if __name__=='__main__':package()

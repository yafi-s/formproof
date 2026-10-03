"""Copy only selected upstream PDF.js assets from a pinned public npm archive."""
import hashlib
import json
from pathlib import Path
import tarfile

ROOT=Path(__file__).resolve().parents[1]
archive=ROOT/'vendor-downloads/pdfjs-dist-6.3.289.tgz'
destination=ROOT/'extension/vendor/pdfjs'
files={}
with tarfile.open(archive) as source:
    for member in source.getmembers():
        if not member.isfile():continue
        relative=member.name.removeprefix('package/')
        if relative.startswith('standard_fonts/LiberationSans-') or relative=='standard_fonts/LICENSE_LIBERATION':continue
        if relative not in {'build/pdf.min.mjs','build/pdf.worker.min.mjs','LICENSE','package.json'} and not relative.startswith(('cmaps/','standard_fonts/')):continue
        parts=Path(relative).parts
        assert '..' not in parts and not Path(relative).is_absolute()
        path=destination/relative
        path.parent.mkdir(parents=True,exist_ok=True)
        data=source.extractfile(member).read();path.write_bytes(data)
        files[relative]=hashlib.sha256(data).hexdigest()
(destination/'upstream.json').write_text(json.dumps({'package':'pdfjs-dist','version':'6.3.289',
    'source':'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz',
    'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'files':files},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'assets':len(files),'bytes':sum((destination/n).stat().st_size for n in files)}))

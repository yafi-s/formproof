"""Generate only original fabricated parser fixtures; no user resume is read."""
from pathlib import Path
from xml.sax.saxutils import escape
import zipfile
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'fixtures/uploads';OUTPUT.mkdir(exist_ok=True)
lines=(ROOT/'fixtures/backend.txt').read_text(encoding='utf-8').splitlines()

def pdf(path,groups):
    writer=PdfWriter()
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    for group in groups:
        page=writer.add_blank_page(width=612,height=792)
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
        stream=DecodedStreamObject()
        statements=['BT /F1 11 Tf 48 740 Td']
        for line in group:
            text=line.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
            statements.append(f'({text}) Tj 0 -18 Td')
        statements.append('ET');stream.set_data('\n'.join(statements).encode('ascii'))
        page[NameObject('/Contents')]=writer._add_object(stream)
    writer.write(path)
    return writer

pdf(OUTPUT/'synthetic-backend.pdf',[lines[:8],lines[8:]])
pdf(OUTPUT/'textless.pdf',[[]])
encrypted=pdf(OUTPUT/'temporary-encryption-input.pdf',[lines]);encrypted.encrypt('synthetic-fixture-only');encrypted.write(OUTPUT/'encrypted.pdf')
# The intermediate fixture is retained; there is no cleanup of user files.
doc=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
     '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(
     '<w:p><w:r><w:t xml:space="preserve">'+escape(line)+'</w:t></w:r></w:p>' for line in lines)+'<w:sectPr/></w:body></w:document>')
types=('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
       '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
       '<Default Extension="xml" ContentType="application/xml"/>'
       '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
rels=('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
with zipfile.ZipFile(OUTPUT/'synthetic-backend.docx','w',compression=zipfile.ZIP_DEFLATED) as archive:
    for name,data in {'[Content_Types].xml':types,'_rels/.rels':rels,'word/document.xml':doc}.items():
        info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)
with zipfile.ZipFile(OUTPUT/'unsafe-path.docx','w',compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('../unexpected',b'original synthetic security test')
    archive.writestr('[Content_Types].xml',types);archive.writestr('word/document.xml',doc)
(OUTPUT/'damaged.pdf').write_bytes(b'%PDF-1.7\nThis is an original invalid fixture.')
(OUTPUT/'unsupported.doc').write_text('Original unsupported legacy-format fixture.',encoding='utf-8')
print('Original synthetic PDF/DOCX/error fixtures generated.')

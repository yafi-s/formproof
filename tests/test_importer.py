import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('import_resume', ROOT / 'tools/import_resume.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImporterTests(unittest.TestCase):
    def test_text_provenance(self):
        result = module.extract(ROOT / 'fixtures/backend.txt')
        self.assertEqual(len(result['sha256']), 64)
        self.assertIn('Email: alex@example.invalid', result['text'])
        self.assertEqual(result['parser'], 'utf-8 text')

    def test_multpage_pdf_text_layer(self):
        from pypdf import PdfWriter
        from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
        with tempfile.TemporaryDirectory(prefix='formproof-import-') as directory:
            path = Path(directory) / 'synthetic-resume.pdf'
            writer = PdfWriter()
            font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
                                     NameObject('/BaseFont'): NameObject('/Helvetica')})
            for text in ['Name: Alex Example', 'Email: alex@example.invalid']:
                page = writer.add_blank_page(width=612, height=792)
                page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
                stream = DecodedStreamObject()
                stream.set_data(f'BT /F1 12 Tf 40 700 Td ({text}) Tj ET'.encode())
                page[NameObject('/Contents')] = writer._add_object(stream)
            writer.write(path)
            result = module.extract(path)
            self.assertEqual(result['pages'], 2)
            self.assertIn('Name: Alex Example', result['text'])
            self.assertIn('Email: alex@example.invalid', result['text'])
            self.assertEqual(result['parser'], 'pypdf text layer')

    def test_scanned_pdf_abstains(self):
        from pypdf import PdfWriter
        with tempfile.TemporaryDirectory(prefix='formproof-import-') as directory:
            path = Path(directory) / 'no-text.pdf'
            writer = PdfWriter()
            writer.add_blank_page(width=612, height=792)
            writer.write(path)
            with self.assertRaisesRegex(ValueError, 'No text layer'):
                module.extract(path)

    def test_unsupported_format_and_invalid_utf8(self):
        with tempfile.TemporaryDirectory(prefix='formproof-import-') as directory:
            path = Path(directory) / 'resume.exe'
            path.write_bytes(b'not a resume')
            with self.assertRaisesRegex(ValueError, 'Supported inputs'):
                module.extract(path)
            path = Path(directory) / 'resume.txt'
            path.write_bytes(b'\xff')
            with self.assertRaises(UnicodeDecodeError):
                module.extract(path)


if __name__ == '__main__':
    unittest.main()

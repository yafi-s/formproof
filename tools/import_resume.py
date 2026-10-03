"""Offline text/PDF -> inert JSON bundle. No network, OCR, model or inferred demographics."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path


def extract(path: Path) -> dict:
    raw = path.read_bytes()
    if len(raw) > 10_000_000:
        raise ValueError('Each resume must be under 10 MB')
    pages = None
    if path.suffix.lower() == '.pdf':
        try:
            from pypdf import PdfReader
        except ImportError as error:
            raise RuntimeError('PDF import needs the optional free BSD-licensed pypdf package; text import needs no dependencies') from error
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError('Encrypted PDFs must be unlocked locally before import')
        if len(reader.pages) > 20:
            raise ValueError('Resume PDF is limited to 20 pages')
        pages = [page.extract_text() or '' for page in reader.pages]
        text = '\n\n'.join(pages)
        if not text.strip():
            raise ValueError('No text layer found; scanned PDFs need a manually reviewed text transcription')
    elif path.suffix.lower() in {'.txt', '.md'}:
        text = raw.decode('utf-8-sig')
    else:
        raise ValueError('Supported inputs: .pdf, .txt, .md')
    if len(text) > 250_000:
        raise ValueError('Extracted resume text is too large')
    return {'name': path.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'text': text,
            'pages': len(pages) if pages is not None else None,
            'parser': 'pypdf text layer' if pages is not None else 'utf-8 text'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    bundle = {'schema': 'formproof.resume-bundle.v1', 'resumes': [extract(p) for p in args.input]}
    if args.output.exists():
        parser.error('Output already exists; choose a new path to preserve the earlier artifact')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Wrote {len(bundle["resumes"])} local resume versions to {args.output}')


if __name__ == '__main__':
    main()

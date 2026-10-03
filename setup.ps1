$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js 24 is required for developer tests. The unpacked extension itself needs no Node installation.' }
python -c "import sqlite3; print('Python is available; optional PDF importer uses pypdf.')"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12+ is required for the local PDF importer.' }
python -c "import importlib.util; print({m:bool(importlib.util.find_spec(m)) for m in ['pypdf','playwright']})"
python tools/verify_assets.py
if ($LASTEXITCODE -ne 0) { throw 'Vendored parser assets failed verification.' }
python tools/package_extension.py
if ($LASTEXITCODE -ne 0) { throw 'Extension packaging failed.' }
Write-Output 'No dependencies were downloaded. Load artifacts/formproof-0.2.0-unpacked in your browser. See docs/INSTALL.md. Developer tests additionally require npm ci --ignore-scripts and the optional Python/browser dependencies.'

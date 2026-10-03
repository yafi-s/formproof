$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js is required for core tests (no npm packages needed).' }
python -c "import sqlite3; print('Python is available; optional PDF importer uses pypdf.')"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12+ is required for the local PDF importer.' }
python -c "import importlib.util; print({m:bool(importlib.util.find_spec(m)) for m in ['pypdf','playwright']})"
Write-Output 'No dependencies were downloaded. See README.md for mock tests and later unpacked-extension installation.'

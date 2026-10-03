$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node --test tests/*.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'FormProof core tests failed.' }
python -m unittest discover -s tests -p 'test_*.py' -v
if ($LASTEXITCODE -ne 0) { throw 'Importer tests failed.' }
node tests/evaluate.mjs
if ($LASTEXITCODE -ne 0) { throw 'Descriptor evaluation failed.' }
node tests/parser_evaluate.mjs
if ($LASTEXITCODE -ne 0) { throw 'Parser evaluation failed.' }
python tests/browser_check.py
if ($LASTEXITCODE -ne 0) { throw 'Controlled browser tests failed.' }
python tests/demo_check.py
if ($LASTEXITCODE -ne 0) { throw 'Local demo checks failed.' }

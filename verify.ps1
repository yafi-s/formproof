$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
python tools/verify_local.py
if ($LASTEXITCODE -ne 0) { throw 'FormProof verification failed; see results/local-verification.json and its logs.' }

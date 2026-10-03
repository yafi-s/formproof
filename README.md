# FormProof

A Chrome/Edge Manifest V3 extension: **upload a resume → parse locally → verify or edit facts → preview ATS fields → explicitly fill**. PDF and DOCX parsing run inside bundled local workers. Source excerpts, PDF page references, conflicts, abstention and one-use destination consent remain visible. Original files are attached manually and applications are submitted by the user.

## Install the extension

Use the feature branch's packaged `formproof-0.2.0.zip`, extract it, then open `chrome://extensions` or `edge://extensions`, enable Developer mode and **Load unpacked** from the folder containing `manifest.json`. Pin the icon, open an application page and click FormProof (Alt+Shift+F). Its separate review window stays open while you work in the application tab. Create a local passphrase, upload a PDF/DOCX/TXT/Markdown resume, verify facts, then inspect and approve a fill. Click the toolbar on each new application tab/destination.

To package from a checkout, run `python tools/package_extension.py` or `./setup.ps1`; the result is `artifacts/formproof-0.2.0-unpacked/` plus the ZIP. No npm install or account is needed for runtime; parser assets are already vendored. See the [step-by-step install/privacy guide](docs/INSTALL.md), [local-upload screenshot](results/extension-upload.png), [destination preview](results/extension-destination-preview.png), and [filled synthetic ATS](results/extension-filled-ats.png).

The **actual packaged extension** has been installed and tested in an isolated bundled Chromium profile. A personal Chrome/Edge install, Web Store release and real employer ATS compatibility remain unverified.

## Try the controlled demo without installing an extension

Requirements: Python 3.12+ for the demo server. Node.js 24 is used for developer tests. There are no models or API keys. The extension ZIP includes its licensed document-parser dependencies.

```powershell
cd formproof
.\setup.ps1
python tools/serve_demo.py --port 8765
```

Open `http://127.0.0.1:8765/`. The left panel is the real review UI with a localhost-only Chrome API emulator; the right panel is a synthetic ATS form. Use a test passphrase and import `fixtures/backend.txt` and `fixtures/ml.txt`. Resolve their email conflict, verify the fields you want to reuse, compare versions using a pasted job description, confirm a resume choice, then inspect and review the mock form. Switch to the select-field fixture to test a separately approved, explicitly entered sensitive answer. Close the server with Ctrl+C. The server accepts no uploads or POST requests, and serves only its static demo assets. Demo vault storage belongs to that local web origin; the actual extension uses extension storage.

## Import your own resume versions locally

Upload PDF, DOCX, UTF-8 `.txt`/`.md` or importer-generated `.json` directly in the extension. PDF.js reads PDF text layers; Mammoth extracts raw DOCX text without rendering document HTML. Limits include 5 MB/file, 25 PDF pages, 250,000 extracted characters, 25 versions and a 4 MB serialized profile. ZIP entry/inflation limits and a cancellable 15-second parser worker constrain malformed input. Scanned, encrypted, damaged and legacy `.doc` documents show explicit errors. Do not place personal resume files in the repository.

The separate offline Python converter remains available for text-layer PDFs and existing bundle workflows:

```powershell
python tools/import_resume.py --input "C:\private\backend-resume.pdf" --input "C:\private\ml-resume.pdf" --output "C:\private\resume-bundle.json"
```

The importer rejects encrypted PDFs, oversized files and PDFs without a text layer. It does not perform OCR. PDF reading order can differ from visual order; review every excerpt before verification. This is a text-layer parser, not broad document understanding. The original file hash and extracted-text hash remain distinguishable. [pypdf extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html).

The proposed parser covers explicit English labels, contact emails/phone/LinkedIn/GitHub, a conservative first-line name suggestion, and school/degree/expected-graduation statements inside an explicit education section. It does not infer first/last-name splitting, demographic characteristics, citizenship, work authorization, job dates, experience duration or answers to narrative questions. Unsupported facts can be entered manually with explicit provenance.

## Review and privacy

- Every resume-derived fact starts unverified and retains a source hash, line, excerpt and rule confidence. Different values across versions block reuse until the user selects and verifies one. Importing a new conflicting version invalidates the old choice.
- The full profile, including extracted resume text and optional sensitive facts, is encrypted at rest using AES-GCM with a random salt/IV and a PBKDF2-SHA256 key derived from the passphrase. Original PDF/DOCX bytes are not persisted. The passphrase is not persisted. Closing the review window drops its in-memory state; Lock clears plaintext. There is no recovery key.
- Gender, ethnicity, citizenship, sponsorship, work authorization, disability and similar answers come only from explicit user entry. They start unselected in a fill plan and require an additional one-use approval for that exact destination. They can be edited or deleted. Nothing is transmitted as telemetry; there are no telemetry or model endpoints.
- Approval is bound to the complete page URL, form actions, field labels/options, profile revision and scan nonce. A changed destination, reused nonce, changed field, unsupported control or prefilled value blocks filling. Event-driven changes during a fill stop remaining writes and report a partial result.
- Resume removal removes its sourced candidates; deleting a fact removes all of that fact's candidate history. Resume text remains until that resume is removed. Delete local profile removes the persisted vault. Original files are unchanged. Page scripts receive any answers you choose to fill; encryption at rest cannot protect an unlocked profile from a compromised device.

The manifest requests only `activeTab`, `scripting` and `storage`, with no host wildcards, automatic content scripts or account access. CSP permits bundled extension assets and blocks remote connections. `activeTab` access is temporary and user invoked. [Chrome activeTab documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab). The demo emulator is outside `extension/` and never enters the package.

## Supported controls and sites

Verified on controlled synthetic ATS pages: native text/email/tel/URL inputs, textareas, autocomplete, associated/ARIA labels, exact-match single selects, named radio fieldsets, month/date fields and two form steps. Wrapped select labels exclude their option text; disabled optgroups remain disabled. Dates require an exact YYYY-MM-DD; a graduation month never produces a guessed day. Existing answers, hidden/disabled/read-only fields, passwords, uploads, checkboxes, numeric fields, multiselects, narratives and custom widgets remain manual. Shadow DOM and iframe fields are not traversed. No Greenhouse, Lever, Workday, Ashby, Simplify or company application site is claimed as verified.

To try the installed extension against a harmless form, run the demo server and visit `/fixtures/pages/extension-ats.html`, then invoke the toolbar and upload `fixtures/uploads/synthetic-backend.pdf` or `.docx`. This fixture uses native controls and tracks input events; it never sends an application.

## Verify and inspect evidence

```powershell
npm ci --ignore-scripts
# If the optional Python packages/browser are not already installed:
python -m pip install -r requirements-optional.txt
python -m playwright install chromium
.\verify.ps1
```

Local verification uses pypdf 6.9.2, Playwright 1.60.0 and Chromium 148.0.7778.96. The legacy browser/demo suites use a localhost bridge. `tests/extension_check.py` additionally installs the **packaged** extension into a fresh isolated profile, invokes the real toolbar via CDP, and uses the real extension APIs/activeTab grant. No personal browser profile is opened.

The recorded result has **35 Node tests, four importer tests, 29 browser checks, seven local-demo checks and 21 actual packaged-extension checks**. The original 64-field corpus still produced 36 correct supported fills, 28 abstentions and zero required corrections; its simple substring baseline made 18 proposals, 14 correct. The installed suite verifies eleven approved field writes across two ATS steps, PDF/DOCX source provenance, failed/staged/oversized imports, sensitive consent, date bounds, disabled optgroups, remote CSP blocking, expired grants, singleton workspace, encryption and deletion races. These are controlled fixture observations, not real-site coverage or a calibrated accuracy estimate. Parser evaluation found 31 correct proposals on three synthetic text resumes, all requiring user verification.

Three mechanical input-entry trials compare scripted typing at 20 ms/character plus 100 ms/field with plan-and-approved-apply on the same 14 fields. They exclude human review, initial verification, import, attachments and submission, and include Playwright overhead. No measured human time-savings or adoption claim is supported.

- [Browser observations and entry timings](results/browser-evaluation.json)
- [Actual installed-extension checks and parser timings](results/extension-verification.json)
- [Descriptor evaluation](results/descriptor-evaluation.json)
- [Parser proposals and source excerpts](results/parser-evaluation.json)
- [Destination review screenshot](results/destination-review.png)
- [Architecture and decisions](docs/ARCHITECTURE.md)
- [Evaluation protocol](docs/EVALUATION.md)

All data fixtures are original synthetic examples with reserved `.invalid` domains and fictitious organizations. See [THIRD_PARTY.md](THIRD_PARTY.md) for bundled and optional dependency licenses. Parser rebuilds use the exact lockfile (`npm run build:parsers`); CI audits dependencies, verifies byte hashes and reproduces the package/install checks. Source is MIT licensed; bundled assets retain their own notices.

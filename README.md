# FormProof

A local application copilot that proposes source-backed facts and reviewed fills from several resume versions. It does not generate experience, attach files or submit applications. The project ships an unpacked Chrome Manifest V3 extension and a controlled local demo; it has not been installed in a personal browser or exercised on real applications.

## Try the controlled demo without installing an extension

Requirements: Python 3.12+ for the demo server. Node.js 24 was used for core tests. The extension and its text parser have no npm dependencies, models or API keys.

```powershell
cd formproof
.\setup.ps1
python tools/serve_demo.py --port 8765
```

Open `http://127.0.0.1:8765/`. The left panel is the real review UI with a localhost-only Chrome API emulator; the right panel is a synthetic ATS form. Use a test passphrase and import `fixtures/backend.txt` and `fixtures/ml.txt`. Resolve their email conflict, verify the fields you want to reuse, compare versions using a pasted job description, confirm a resume choice, then inspect and review the mock form. Switch to the select-field fixture to test a separately approved, explicitly entered sensitive answer. Close the server with Ctrl+C. The server accepts no uploads or POST requests, and serves only its static demo assets. Demo vault storage belongs to that local web origin; the actual extension uses extension storage.

## Import your own resume versions locally

The extension accepts UTF-8 `.txt`, `.md` and importer-generated `.json` files. Native PDF import uses a separate offline converter with the optional BSD-licensed `pypdf` package. No PDF data leaves the machine. Do not place personal resume files in the project: use a separate private folder.

```powershell
python tools/import_resume.py --input "C:\private\backend-resume.pdf" --input "C:\private\ml-resume.pdf" --output "C:\private\resume-bundle.json"
```

The importer rejects encrypted PDFs, oversized files and PDFs without a text layer. It does not perform OCR. PDF reading order can differ from visual order; review every excerpt before verification. This is a text-layer parser, not broad document understanding. The original file hash and extracted-text hash remain distinguishable. [pypdf extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html).

The proposed parser covers explicit English labels, contact emails/phone/LinkedIn/GitHub, a conservative first-line name suggestion, and school/degree/expected-graduation statements inside an explicit education section. It does not infer first/last-name splitting, demographic characteristics, citizenship, work authorization, job dates, experience duration or answers to narrative questions. Unsupported facts can be entered manually with explicit provenance.

## Review and privacy

- Every resume-derived fact starts unverified and retains a source hash, line, excerpt and rule confidence. Different values across versions block reuse until the user selects and verifies one. Importing a new conflicting version invalidates the old choice.
- The full profile, including resume text and optional sensitive facts, is encrypted at rest using AES-GCM with a random salt/IV and a PBKDF2-SHA256 key derived from the passphrase. The passphrase is not persisted. Closing the popup drops its in-memory state; the Lock button clears the displayed facts. There is no recovery key.
- Gender, ethnicity, citizenship, sponsorship, work authorization, disability and similar answers come only from explicit user entry. They start unselected in a fill plan and require an additional one-use approval for that exact destination. They can be edited or deleted. Nothing is transmitted as telemetry; there are no telemetry or model endpoints.
- Approval is bound to the complete page URL, form actions, field labels/options, profile revision and scan nonce. A changed destination, reused nonce, changed field, unsupported control or prefilled value blocks filling. Event-driven changes during a fill stop remaining writes and report a partial result.
- Resume removal removes its sourced candidates; deleting a fact removes all of that fact's candidate history. Resume text remains until that resume is removed. Delete local profile removes the persisted vault. Original files are unchanged. Page scripts receive any answers you choose to fill; encryption at rest cannot protect an unlocked profile from a compromised device.

The manifest requests `activeTab`, `scripting` and `storage`, with no host wildcards, automatic content scripts, account access or network endpoints. `activeTab` access is temporary and user invoked. [Chrome activeTab documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab). The demo emulator is outside `extension/` and is never loaded by the extension manifest.

## Supported controls and sites

Verified: six controlled synthetic ATS schemas with native text/email/tel/URL inputs, textareas, standard autocomplete, explicit labels, aria-label, aria-labelledby, exact-match selects and named radio fieldsets. Narrative questions deliberately abstain. Existing values, hidden/disabled/read-only fields, passwords, uploads, checkboxes, dates, numeric fields, multiselects and custom widgets remain manual. Shadow DOM and cross-origin frames are not traversed. No Greenhouse, Lever, Workday, Ashby, Simplify, or company application site is claimed as verified.

`extension/` is ready for a later unpacked-extension review. Installing it or granting access in a personal browser is a separate step; this task did neither. Installation is not needed for the demo or tests.

## Verify and inspect evidence

```powershell
.\verify.ps1
```

Verification uses the existing optional `pypdf 6.9.2`, `playwright 1.60.0` and Chromium `148.0.7778.96`; setup performs no downloads. The browser suite launches a fresh headless test context against localhost and does not load the extension.

The recorded result has **26 Node tests, four importer tests, 29 browser checks and seven local-demo checks**. Its 64-field corpus produced 36 correct supported fills, 28 abstentions and zero required corrections. A deliberately simple name/id substring baseline made 18 proposals, 14 correct. These are controlled fixture results, not real-site coverage or a calibrated accuracy estimate. Parser evaluation found 31 correct proposals on three synthetic resumes, all requiring user verification. Independent review led to regression coverage for delayed-save deletion, stale import/scan callbacks, destination changes during filling, newly added radio options, visible form destinations and encoded asset traversal.

Three mechanical input-entry trials compare scripted typing at 20 ms/character plus 100 ms/field with plan-and-approved-apply on the same 14 fields. They exclude human review, initial verification, import, attachments and submission, and include Playwright overhead. No measured human time-savings or adoption claim is supported.

- [Browser observations and entry timings](results/browser-evaluation.json)
- [Descriptor evaluation](results/descriptor-evaluation.json)
- [Parser proposals and source excerpts](results/parser-evaluation.json)
- [Destination review screenshot](results/destination-review.png)
- [Architecture and decisions](docs/ARCHITECTURE.md)
- [Evaluation protocol](docs/EVALUATION.md)

All data fixtures are original synthetic examples with reserved `.invalid` email/website domains and fictitious organizations. See [THIRD_PARTY.md](THIRD_PARTY.md) for optional dependency licenses. Source is MIT licensed.

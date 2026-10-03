# Install FormProof in Chrome or Edge

1. Extract `formproof-0.2.0.zip` into a permanent folder. The folder you select must contain `manifest.json` directly.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge. Turn on **Developer mode**, select **Load unpacked**, and choose that folder. Pin FormProof from the browser's Extensions menu.
3. Open an application page and click the **FormProof toolbar icon** (or Alt+Shift+F). A separate review window stays open while you work on the application. Create a local passphrase of at least 12 characters.
4. Upload a PDF with selectable text, DOCX, or UTF-8 TXT/Markdown. Read the extracted text and source excerpts. Use **Verify & choose** for each correct fact, or **Edit answer** to enter a correction. If only a full name was parsed, explicitly confirm its first and last name parts.
5. Click **Inspect the active application page**. Check each proposed answer and the page/form destinations. Select the answers to reuse, approve any sensitive answers separately, then click **Fill selected fields**. Review the application in the browser, attach your original resume manually, and submit it yourself.

For another page or application tab, click the toolbar icon on that tab again. Reinspect after moving to another form step or after the site changes a field. FormProof preserves existing answers and fills each preview only once.

## Try a fabricated application first

From the repository, run `python tools/serve_demo.py` and open the printed localhost address. That demo uses a browser bridge; it is separate from the installed-extension test. For the extension itself, open `http://127.0.0.1:8765/fixtures/pages/extension-ats.html` while that server is running. Upload `fixtures/uploads/synthetic-backend.pdf` or `.docx`; every identity is fabricated. The fixture has native inputs, a native select/radio group, date/month controls and a second step. It never sends an application.

## What is supported

Top-level HTTP(S) pages with native text/email/phone/URL inputs, textareas, single selects and named radio fieldsets. Native month/date inputs require an exact month/date; a graduation month never becomes a guessed day. Missing, ambiguous, hidden, disabled, conflicting, already-filled and narrative fields remain manual. Custom widgets, iframe/shadow-DOM fields, checkboxes, file attachments and automatic submission are unsupported.

PDF extraction uses its text layer; scanned/image PDFs need a text export or OCR outside FormProof. Encrypted/damaged documents are rejected. Maximums: 5 MB/file, 25 PDF pages, 250,000 extracted characters, 25 resume versions/profile and 4 MB serialized profile text. Oversized imports fail without changing your profile. Complex PDF reading order can be imperfect. DOCX extraction omits visual layout. Review the source before approving facts. Legacy `.doc` is unsupported.

## Privacy and removal

Parsing runs locally with bundled, open-source libraries. There is no remote parser, paid API, telemetry or account. The extension requests only `activeTab`, `scripting` and `storage`; the toolbar grants access to the selected tab. The encrypted local profile stores extracted text, facts and source hashes, not original PDF/DOCX bytes. Your passphrase stays in the review window's memory while unlocked. There is no password recovery. Lock clears the review window's plaintext; Delete local profile removes its vault. Keep your original documents. Data you explicitly fill becomes part of the destination page, which can read it immediately.

Close the review window before removing the extension at the browser's Extensions page. Reinstalling/renaming an unpacked folder can change its extension ID and local storage identity. This package is an unsigned developer build, not a Web Store listing. Automated installation was verified with isolated bundled Chromium; manual Chrome/Edge setup and real employer ATS compatibility still need user validation.

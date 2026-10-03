# Independent review and regression fixes

## Initial text/importer release (v0.1)

An independent reviewer reproduced five concrete FormProof problems before the final revision: deletion could race a later queued save; a page could change destination during an earlier input event; newly added radio controls were outside the saved group; the UI did not show actual form actions; and encoded demo paths could bypass its asset allowlist.

The final implementation synchronously fences lock/deletion transitions, clears plaintext and drains a stable write queue before removal. Old import/scan callbacks cannot restore a closed session. Apply checks the page and all form destinations before every write and checks current radio membership. Review shows actual destinations globally and per proposed field. GET and HEAD use a canonical asset allowlist.

The reviewer independently reran the original reproductions, delayed-save deletion, failed-removal reporting/retry, deferred-import cancellation, destination display and GET/HEAD traversal rejection. All passed after fixes. It also ran all 26 core tests and four importer tests. The project's final broader suite reports 29 browser checks and seven actual localhost-demo checks.

The v0.1 browser bridge emulates Chrome APIs and did not install the extension. Its records are historical. See the [evaluation contract](EVALUATION.md) and [raw browser observations](../results/browser-evaluation.json).

## Direct-upload extension (v0.2)

An independent source/assets review reproduced three new regressions: disabled optgroup inheritance was missed; an individually valid batch could exceed storage quota and create invisible unsaved live facts; and completing a save could erase text entered for the next answer. Effective `:disabled` checks, bounded persist-before-publish drafts, and captured-input comparisons fixed them. The reviewer reran every reproduction and found no remaining concrete blocker in the reviewed source.

Independent verification passed 26 core tests, nine upload/security tests and eight additional ZIP checks. It also installed the actual extension in its own fresh temporary Chromium profile and verified real activeTab scanning/filling, DOCX worker parsing, month conversion, refusal to infer a date, sensitive exclusion without approval, zero submissions, singleton locking and plaintext clearance. A held storage write with a queued sensitive edit followed by deletion produced only the in-flight write, then an empty vault/UI; queued work did not repopulate it. Vendored hashes and corrected dependency notices passed inspection. All Liberation font assets are omitted.

The independent review covered source and assets, not the final ZIP. The separate project integration suite verifies the exact packaged inventory and real installed-extension behavior in 21 controlled checks. Source-review closure and package verification are distinct evidence. All data is original synthetic input; no external accounts/private data or real employer applications were used. Manual Chrome/Edge installation, real ATS compatibility, OCR and broader hostile-document qualification remain untested.

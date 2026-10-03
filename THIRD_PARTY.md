# Dependencies and fixture rights

The extension uses only browser APIs; there are no bundled npm packages, remote scripts, datasets or model weights. Its own code and original synthetic fixtures are MIT licensed.

Optional local tools used in this workspace:

| Dependency | Existing tested version | License / use |
| --- | --- | --- |
| Python | 3.12.10 | PSF; local importer and test tooling |
| pypdf | 6.9.2 | BSD-3-Clause; text-layer PDF extraction, not bundled in extension |
| Node.js | 24.15.0 | MIT and distributed notices; core tests only |
| Playwright | 1.60.0 | Apache-2.0; optional local headless tests |
| Playwright Chromium | 148.0.7778.96 | Chromium BSD-style and third-party notices; existing browser test runtime, not redistributed |

No account was created, paid API called, package downloaded or model/dataset fetched. The repository includes only fabricated profiles, `.invalid` domains and mock ATS pages. The importer does not read any personal resume unless the user explicitly supplies it.

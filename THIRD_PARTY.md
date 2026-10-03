# Dependencies and fixture rights

FormProof code and original fabricated fixtures are MIT licensed. Third-party assets retain their own licenses; the project license does not replace them. No personal resume, employer data, model weights, paid API or dataset is distributed.

The unpacked extension includes these local libraries and unchanged notices:

| Library / asset | Version | License / notice |
| --- | --- | --- |
| PDF.js (`pdfjs-dist`) | 6.3.289 | Apache-2.0, `vendor/pdfjs/LICENSE` |
| PDF.js packed character maps | upstream 6.3.289 assets | Adobe BSD-style notice, `vendor/pdfjs/cmaps/LICENSE` |
| Foxit standard font data | upstream 6.3.289 assets | BSD-style notice, `vendor/pdfjs/standard_fonts/LICENSE_FOXIT` |
| Mammoth | 1.13.0 | BSD-2-Clause, `vendor/licenses/mammoth/LICENSE` |
| fflate | 0.8.3 | MIT, `vendor/licenses/fflate/LICENSE` |
| @xmldom/xmldom | 0.8.15 | MIT |
| base64-js | 1.5.1 | MIT |
| dingbat-to-unicode | 1.0.2 | BSD-2-Clause |
| JSZip | 3.10.2 | MIT alternative selected; full dual-license notice retained |
| lop | 0.4.2 | BSD-2-Clause |
| option | 0.2.4 | BSD-2-Clause |
| underscore | 1.13.8 | MIT |
| xmlbuilder | 10.1.1 | MIT |

Every bundled transitive package's license is in `extension/vendor/licenses/`. `parser-manifest.json` records exact packages, npm integrity values and generated bundle hashes. `pdfjs/upstream.json` records the pinned public npm archive and each included asset hash. The upstream Liberation font family and GPL notice are omitted; no font rendering/distribution is needed by this text-only workflow. A document requiring an omitted optional font may emit an extraction warning. Font/cMap data is loaded only from extension URLs.

Mammoth is rebuilt from its installed entry point with current lockfile dependencies, rather than the older upstream prebuilt browser bundle. `tools/build_parsers.mjs` uses esbuild 0.28.2 (MIT, build-time only), preserves legal comments and copies notices. Runtime requires neither npm nor a network connection. Rebuilding uses public npm downloads with lifecycle scripts disabled (`npm ci --ignore-scripts`). A zero-advisory lockfile audit is a dated check, not a guarantee.

Optional local tools used in this workspace:

| Dependency | Existing tested version | License / use |
| --- | --- | --- |
| Python | 3.12.10 | PSF; local importer and test tooling |
| pypdf | 6.9.2 | BSD-3-Clause; text-layer PDF extraction, not bundled in extension |
| Node.js | 24.15.0 | MIT and distributed notices; core tests only |
| Playwright | 1.60.0 | Apache-2.0; optional local headless tests |
| Playwright Chromium | 148.0.7778.96 | Chromium BSD-style and third-party notices; existing browser test runtime, not redistributed |

No account was created, paid API called or model/dataset fetched. The public parser packages were downloaded for this extension build. The repository includes only fabricated profiles, `.invalid` domains and mock ATS pages. The importer does not read any personal resume unless the user explicitly supplies it.

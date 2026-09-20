# Executed validation — ChromaForge 0.1.0

## Repository publication validation — September 20, 2026

The complete source was checksum-verified, restored to readable files, tested and packaged in GitHub Actions. The successful import run is https://github.com/wieslawsoltes/ChromaForgeMaterialStudio/actions/runs/35508719733 .

| Suite | Executed result |
| --- | --- |
| JavaScript syntax and package checks | Passed |
| Node unit/integration tests | 66 passed; zero failures |
| Editor browser checks | 32 passed; no uncaught JavaScript exceptions |
| Website/standalone SDK browser checks | 13 passed; no uncaught JavaScript exceptions |
| Distribution | Standalone editor, static site, six independent library bundles and six npm-compatible tarballs rebuilt |
| Pages preparation | Repository-relative HTML links checked; standalone download, `.nojekyll` and commit metadata generated |

The Node count includes nested tests. Browser counts are assertions inside scripted sessions, not independent end-to-end test cases.

The GitHub-hosted Chromium sessions selected **WebGL2**, so the WebGL2 runtime path was exercised in this runner. The tests checked actual painted/exported pixels and interactive website/example rendering. This does not qualify physical GPU performance, all shader combinations or cross-device correctness.

The import browser runs used offline `set_content`, not a secure origin. `indexedDBAvailable` and `secureContext` were false in the editor report. **WebGPU/WGSL execution, normal-origin IndexedDB reload durability and multi-user browser login/reconnect remain unqualified by these runs.** Node server tests do exercise real authenticated HTTP/WebSocket clients and SQLite restart recovery.

The regenerated evidence is in `qa/node-results.txt`, `qa/browser-results.json`, `qa/site-results.json` and the seven PNG captures under `qa/`. The site preview is copied from the actual studio capture. The original sandbox validation narrative is retained separately in [QA-SANDBOX.md](QA-SANDBOX.md); it describes an earlier CPU-fallback environment, not these refreshed reports.

## Continuous validation and publication

`.github/workflows/ci.yml` validates source, runs the Node suite, packages the libraries and builds Pages output on pushes and pull requests. It uploads a downloadable distribution artifact. No npm registry publication occurs.

`.github/workflows/pages.yml` repeats the build gates for `main`, publishes only `dist/site`, then verifies the public build metadata matches the deployed commit and checks fourteen public pages/resources. The workflow result is the authority for deployment status. GitHub Pages hosts the static website and editor, not the Node/SQLite collaboration service.

## Reproduce

```sh
npm run check
npm test
npm run pack:libraries
npm run build:pages
```

Browser checks use Python Playwright only as a development tool:

```sh
python3 -m pip install playwright
python3 -m playwright install --with-deps chromium
# Set CF_BROWSER to the installed browser executable when not /usr/bin/chromium.
npm run test:browser
npm run test:site
```

To test the served editor instead of offline HTML, start `npm start` and run `CF_TEST_URL=http://localhost:8787/apps/studio/ CF_BROWSER=/path/to/chromium python3 tests/browser.py`.

## Remaining qualification

No claim is made for full Substance 3D Painter feature parity, physical-GPU performance, WebGPU shader execution, Safari/Firefox compatibility, production-scale loads, enterprise security, browser account/reconnect durability, certified color management, proprietary-format compatibility, Docker/Render execution or npm publication. See [FEATURES.md](FEATURES.md), [SECURITY.md](SECURITY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

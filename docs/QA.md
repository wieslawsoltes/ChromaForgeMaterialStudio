# Executed validation — ChromaForge 0.1.0

Validation date: September 15, 2026. The reports and screenshots in `docs/qa/` were produced by running this repository. This is fixture-based verification, not certification or a claim of feature parity.

## Results

| Suite | Executed result | Main coverage |
| --- | --- | --- |
| JavaScript/package checks | 37 JavaScript files and six export manifests passed | Source syntax and package entry-point structure |
| Node unit/integration tests | **66 passed; zero failed or skipped** | Document model, order-independent replay fixtures, undo, validation, BVH, geometry I/O, baking, materials, ZIP, WebSocket framing, client outbox and actual server integration |
| Editor browser tests | **32 passed; no uncaught JavaScript errors** | Actual pointer painting, changed pixels, undo/redo, masks, erasing, 3D UV picking, property editing, layer duplication/order, views, command palette, notes, theme/density, OBJ and valid PNG/ZIP/project exports |
| Website/SDK browser tests | **13 passed; no uncaught JavaScript errors** | Interactive hero materials and orbit, desktop/mobile overflow, complete mobile preview, static links, independent renderer/model/material/wireframe controls |
| Type declarations | TypeScript declaration checking passed | Six package declarations under ES2022 and DOM types; not exhaustive runtime contract proof |
| Distribution build | Standalone HTML, static website and six package bundles built | Self-contained browser entry points and local npm-compatible tarballs |

The 66-test count includes nested tests reported by Node's test runner, not 66 independent end-to-end workflows. The 32 and 13 browser checks are assertions within their respective scripted sessions.

## Actual multi-client server tests

The server integration suite creates three accounts and opens independent authenticated socket clients. It checks room creation, invitation redemption, owner/editor/viewer permissions, live operation broadcasting and persistence, repeated delivery, rejected writes, cursor attribution, membership changes, invitation revocation and logout. It stops the server and starts another process against the same temporary SQLite database, then verifies recovered history and an authenticated late client.

These are real HTTP/WebSocket interactions against the supplied server, not mocked browser network responses. Separate client-outbox tests use a controlled database double to check persist-before-send ordering, a room-switch race and read-only rollback. They do not prove IndexedDB reload durability.

## Browser environment and restrictions

Executed using Chromium 144.0.7559.96, Playwright for Python, Node 22.16.0 and Python 3.13.5 in the provided Linux environment.

The browser environment blocks ordinary network navigation and does not expose a usable GPU backend. Tests load the generated HTML into an offline `set_content` document instead of modifying managed browser policy. That document is not a secure origin. WebGPU was unavailable, WebGL2 context creation failed, and IndexedDB access was denied. The app displayed the actual **CPU compatibility** backend and storage-unavailable state.

Consequently:

- **WebGPU/WGSL and WebGL2/GLSL execution, physical-GPU behavior, shader correctness and GPU performance remain unverified.** Shader sources and runtime paths are implemented, but browser screenshots and passing UI tests do not qualify them.
- **IndexedDB persistence and reload recovery remain unverified in a normal browser origin.** Atomic storage code and outbox logic exist; the restricted context could not execute the database itself.
- Browser account/share dialogs were not exercised end-to-end across real browser origins. The corresponding authenticated API/WS behavior was exercised separately against the actual server.
- Native browser downloads were restricted. Export tests capture the Blob handed to the download function in memory, verify the PNG signature, open the generated ZIP with Python's ZIP reader and check its entries. They do not claim operating-system download-dialog or filesystem qualification.

No browser policy was changed to enable forbidden navigation, downloads or GPU APIs.

## Reproduce

```sh
npm run check
npm test
npm run build
```

For browser QA install Python Playwright and a Chromium executable in your own environment. No Python dependency is needed to run the application itself.

```sh
python -m pip install playwright
# Set CF_BROWSER to your Chromium/Chrome executable if not /usr/bin/chromium.
npm run test:browser
npm run test:site
```

The default test mode uses offline HTML. To exercise the studio on a normal local HTTP origin, keep the application server running and supply its URL:

```sh
CF_TEST_URL=http://localhost:8787/apps/studio/ CF_BROWSER=/path/to/chromium python tests/browser.py
```

The test report records the actual backend, secure-context status and IndexedDB availability. On a normal machine this can exercise a GPU backend, but such a run has **not** been claimed for this delivery. The supplied tests do not yet include a full real-browser login/invitation/reconnect/reload suite; add and execute that before deployment qualification.

## Files

`qa/node-results.txt` contains the Node runner output. `qa/browser-results.json` and `qa/site-results.json` contain the browser assertions and reported environment. `qa/studio-dark.png`, `qa/studio-light.png`, `qa/site-hero.png`, `qa/site-desktop.png`, `qa/site-mobile.png` and `qa/sdk-example.png` are actual application captures, not image-generated marketing renders.

## Not performed

Docker/Render/GitHub Actions execution; public deployment; npm publication; physical-GPU tests; production-scale or sustained-load benchmarks; large-asset memory qualification; tablet/stylus hardware qualification; cross-browser Safari/Firefox tests; independent security review; protocol fuzzing; accessibility audit; certified color management; native proprietary-format compatibility. No results are implied for these areas.

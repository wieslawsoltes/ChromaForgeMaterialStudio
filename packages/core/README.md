# @chromaforge/core

Validated document operations, deterministic replicas, history, persistence and math.

Version 0.1.0, MIT license. The distribution is a self-contained ES module with its required internal dependencies bundled. No runtime npm dependencies or studio application are required. This is a first release, not a production qualification or a feature-parity claim.

```js
import * as Core from '@chromaforge/core';
```

To build from this workspace, run `npm run build` at the root. To create the local npm tarball, run `npm run pack:libraries`. The included `SDK.md` documents public entry points and lifecycle responsibilities; `FEATURES.md` records the implemented subset and limitations.

Browser packages require their corresponding DOM APIs. `renderer` selects WebGPU, then WebGL2, then a slower compatibility rasterizer. `controls` requires `HTMLElement` at module evaluation. `core` math/document logic and `geometry` can be imported in Node without a DOM; IndexedDB is only required when persistence methods are called.

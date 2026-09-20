# SDK guide

Each package can be consumed as an ES module without the studio application. Use `dist/libraries/<name>.js`, install a local tarball, or use source imports while developing inside this repository. Types are included with the npm-compatible packages.

## Minimal material viewport

Place a canvas in a browser page, then run this as a module. Adjust the relative module paths to your server layout. The example deliberately owns its animation loop and cleanup.

```html
<canvas id="material-view" style="width:640px;height:480px"></canvas>
<script type="module">
import { MaterialRenderer } from './libraries/renderer.js';
import { createModel } from './libraries/geometry.js';
import { createProject } from './libraries/core.js';
import { TextureCompositor } from './libraries/paint.js';

const renderer = await new MaterialRenderer(
  document.querySelector('#material-view'), { maxDPR: 1.5 }
).initialize();
const compositor = new TextureCompositor(512);
const project = createProject('sphere', 512);
renderer.setMesh(createModel('sphere'));
renderer.upload(0, compositor.compose(project.textureSets[0]), 1);

let running = true;
function frame() {
  if (!running) return;
  if (renderer.dirty) renderer.draw();
  requestAnimationFrame(frame);
}
frame();

// After camera or settings edits:
renderer.camera.yaw = 0.7;
renderer.invalidate();

window.addEventListener('pagehide', () => {
  running = false;
  renderer.dispose();
  compositor.dispose();
}, { once: true });
</script>
```

The complete interactive example is `examples/renderer.html`: model/material selection, orbit, zoom, framing and wireframe without the studio. Initialization can replace the canvas for fallback contexts; use `renderer.canvas` for pointer listeners and snapshots afterward.

## Editing through operations

Do not mutate `store.state` directly in an editor that needs history or synchronization. Direct state mutation is appropriate only for disposable previews such as the landing page.

```js
import { ProjectStore, createProject, createLayer, uid } from './libraries/core.js';

const store = new ProjectStore(createProject('sphere', 512), 'local-user');
const setId = store.state.textureSets[0].id;
const layer = createLayer('paint', 'Accent paint');
store.dispatch('layer:add', { setId, layer }, 'Add paint layer');
store.dispatch('stroke:add', {
  setId, layerId: layer.id,
  stroke: {
    id: uid(), target: 'paint',
    brush: {
      size: 0.07, color: '#df8043', flow: 1, hardness: 0.8,
      spacing: 0.2, shape: 'round', pressure: true,
      channels: ['baseColor'], wrap: false, seed: 19
    },
    points: [[0.3, 0.5, 0.8], [0.5, 0.6, 1], [0.7, 0.5, 0.7]]
  }
}, 'Paint accent');
store.undo();
store.redo();
const portableJSON = JSON.stringify(store.serialize());
```

Brush size is a fraction of texture width. Points store UV coordinates and optional pressure/segment-break metadata. A layer stroke targets either paint or its mask. On `change`, mark the affected texture set dirty, compose it and call `renderer.upload(index, output, totalSets)`.

Accepted operations are `layer:add`, `layer:set`, `layer:delete`, `layer:move`, `stroke:add`, `project:set`, `set:set`, `comment:add`, `comment:resolve` and `history:toggle`. Every dispatched or ingested operation is checked against an allowlisted schema. Imported `.cforge` documents must use the documented `format`, `version`, `base` and `operations` envelope.

## Texture outputs and export

`TextureCompositor.compose(set)` returns `{ maps, color, orm, emissive, version }`. Set layers must conform to the core layer schema. Load embedded decal images with `await compositor.loadImage(layer.image)` before composing a restored project. Outputs are owned by the compositor; do not dispose them while the renderer still needs to upload them.

```js
import { createZip } from './libraries/paint.js';
const archive = await createZip({
  'material/baseColor.png': await compositor.export(setId, 'baseColor'),
  'material/normal.png': await compositor.export(setId, 'normal'),
  'material/orm.png': await compositor.export(setId, 'orm')
});
```

Call `compose` before exporting a set. `normal` derives from painted height; `orm` has constant occlusion in R. PNG export is eight bits per component. Paths passed to `createZip` must be safe relative paths; traversal, absolute paths and backslashes are rejected. ZIP64 and compressed ZIP generation are not implemented.

## Geometry and picking

```js
import { parseOBJ, MeshBVH } from './libraries/geometry.js';
const mesh = parseOBJ(objText, 'Imported mesh');
const bvh = new MeshBVH(mesh);
const ray = renderer.camera.ray(ndcX, ndcY, canvasAspect);
const hit = bvh.intersect(ray.origin, ray.direction);
if (hit) console.log(hit.uv, hit.material, hit.normal);
```

Normalized-device coordinates range from -1 to 1. `parseGLTF` accepts GLB `ArrayBuffer`, JSON text or a parsed JSON object. External buffers require an explicit `resolve(uri)` callback; the caller owns path/CORS/origin policy. Supported geometry and rejected extensions are documented in `FEATURES.md`.

`bakeMeshMaps(mesh, { size, samples, material, signal, onProgress })` returns RGBA byte arrays for five maps. `material` is the selected texture-set index. This is geometry-map baking, not high-poly transfer. Cancellation is cooperative between work segments.

## Browser controls

```js
import { registerControls, CommandRegistry } from './libraries/controls.js';
registerControls();
const commands = new CommandRegistry();
commands.register('save', 'Save project', () => saveProject(), { key: 'Ctrl+S' });
```

`cf-slider` combines a native range input and numeric editor; it emits `value-input` while adjusting and `value-change` when committed. `cf-splitter` supports pointer and keyboard resizing. The controls package requires `HTMLElement` and therefore must not be imported during server-side rendering without a DOM. No React or other framework runtime is required.

## Collaboration client

```js
import { ProjectDatabase } from './libraries/core.js';
import { CollaborationClient } from './libraries/collab.js';
const database = new ProjectDatabase();
await database.open();
const collaboration = new CollaborationClient(store, database);
await collaboration.login(email, password);
const room = await collaboration.createRoom(store.state.name);
// createRoom connects automatically. Use connect(room.id) to reopen an existing room.
```

The default API is same-origin. The initial shared document is a flattened copy of the current state; pre-room local history is not shared. Listen to `status`, `presence`, `cursor`, `role`, `error` and document changes as needed. A server rejection removes the rejected optimistic operation. Never treat client-side read-only controls as authorization; the server checks membership and operation authorship for each write.

The server API and limitations are in `SECURITY.md`. Sign-out, disconnect and disposal have different roles; disconnect leaves account authentication intact. Call `dispose()` when destroying a consumer to release listeners and sockets.

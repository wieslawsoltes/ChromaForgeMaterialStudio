# Architecture

## Layers of the system

The studio and landing website are consumers of six ES-module packages, not the owners of rendering or painting algorithms. The reusable renderer example does not import the studio. Source-level dependencies use relative imports; the build produces self-contained package entry points so distribution does not require the source monorepo.

```text
apps/studio   -> core + geometry + paint + renderer + controls + collab
apps/site     -> core + geometry + paint + renderer
examples      -> core + geometry + paint + renderer

core          -> platform only
geometry      -> core math
paint         -> core + geometry
renderer      -> core + software fallback + shader source
controls      -> browser DOM
collab        -> core events + supplied document/database contracts
server        -> core validation + Node HTTP/crypto/SQLite + WebSocket transport
```

Canvas2D and graphics objects remain outside the serialized project. No GPU resources, DOM elements, session secrets or database handles are placed in project files.

## Editing pipeline

A pointer event is mapped either into the UV canvas or into an orbit-camera ray. The BVH returns a nearest triangle hit with barycentric UVs, normal and material index. The editor accumulates normalized brush points, respecting segment breaks when a stroke crosses discontinuous UVs. A preview stroke is composited without committing it on every pointer move. Pointer-up commits a `stroke:add` operation.

A store change marks affected texture sets dirty. The compositor replays their ordered fill/paint/decal layers and masks into the enabled material channels. It generates base-color, packed ORM/height and emissive canvases. The renderer uploads these outputs and redraws on demand. Geometry is uploaded when the model changes, not at every frame.

The paint path is CPU Canvas2D; the browser may internally accelerate Canvas2D, but ChromaForge does not claim a WebGPU brush engine. Mesh-map baking is CPU JavaScript with cooperative yielding, not a worker/GPU bake pipeline.

## Document and operation model

The `ProjectStore` owns a validated immutable base snapshot, an operation map keyed by unique IDs, a Lamport clock and a derived state. State is reconstructed by deterministic sorting on clock, actor and operation ID, using code-point ordering rather than locale-sensitive collation. Layer arrays are ordered bottom-to-top. Reducers use ID addressing and ignore edits to nonexistent targets instead of implicitly recreating deleted objects.

Undo/redo uses a new `history:toggle` operation targeting one of the same actor's commands. Other collaborators' work is not blindly rewound. The server also enforces this ownership rule. Duplicate IDs are idempotent. An invalid import or incoming batch is checked before replacing the active project.

The model is an operation-set journal with deterministic conflict resolution. It is not advertised as exhaustive CRDT semantics: concurrent edits to the same property are resolved by the total order, deletion can make later edits no-ops, and late delivery can change replay ordering. Large journals are replayed in memory; there is no production compaction service.

## Geometry and texture conventions

A triangle vertex contains nine floats: position XYZ, normal XYZ, UV, material index. Meshes are non-indexed triangle lists and material indices correspond to the project's texture-set order. UV V points up; Canvas2D rows point down. The implementation converts between these conventions during picking, baking and rasterization.

Output textures are square and share one resolution per project. Color and emissive are interpreted as approximate sRGB values; scalar channels are numeric linear values. Internally the ORM canvas alpha carries height; the public packed export documents R=constant one, G=roughness and B=metallic. Height-derived normals use the OpenGL +Y convention. This is not an OCIO-managed, physically calibrated color pipeline.

## Rendering lifecycle

`MaterialRenderer.initialize()` attempts WebGPU, then WebGL2, then software compatibility. An unsuccessful canvas context can require a replacement canvas; consumers should attach interaction listeners to `renderer.canvas` after initialization. `setMesh`, `upload`, camera edits, settings edits and resize mark the view dirty. Consumers call `draw()` from their own animation loop. `dispose()` releases the package's owned buffers/textures/context resources and event wiring.

GPU mode uses shader-based direct GGX lighting and a procedural environment approximation. The software path uses a z-buffer and perspective-correct UV sampling with simplified shading at reduced resolution. The status distinguishes modes. Recorded `frameTime` is CPU submission time for a GPU backend, not a measured GPU frame duration; in compatibility mode it measures CPU rasterization.

## Persistence and collaboration

IndexedDB stores local documents, settings and pending operations. SQLite WAL stores accounts, hashed session tokens, rooms, membership, invitation hashes and append-only room operations. A successful server operation is persisted before it is broadcast and acknowledged. The client only clears a pending operation after acknowledgment. Reconnection loads the authoritative base/journal and replays pending local operations.

The browser outbox is an implementation path that still requires intended-browser persistence qualification; the offline validation context denied IndexedDB. The three-user network tests exercise real HTTP/WS authentication, roles, persistence and restart recovery separately.

## Build and distribution

`scripts/build.js` is a small deterministic bundler for this repository's named-import/re-export subset. It rejects unsupported module syntax. It creates the standalone HTML editor, the static website, six self-contained ES module libraries and the independent example. It is not intended as a general JavaScript bundler.

`scripts/pack.js` invokes local `npm pack` in offline mode and writes six tarballs. It does not contact or publish to a registry. There are no external runtime dependencies or network-fetched assets. Generated declarations describe the public entry points; internal application helpers are not a stability guarantee.

# Feature and compatibility matrix — 0.1.0

This release is a working implementation with explicit boundaries. A feature being implemented does not imply exhaustive compatibility with another application, independent security review or production-scale qualification.

| Area | Implemented | Boundaries |
| --- | --- | --- |
| Workspace | Simultaneous 3D and UV views; single-view modes; resizable shelf/properties/view split; light/dark; compact/comfortable; command search; history; notes | No native floating windows, multi-monitor docking, full accessibility audit or exact Painter UI parity |
| Painting | UV and BVH-picked 3D strokes; pressure, hardness, flow, size, spacing, angle, scatter; eraser; straight segments; eight preset brushes | CPU rasterization; no GPU compute painting, particle simulation, clone/heal, smudge, arbitrary alpha authoring or projected stencils |
| Symmetry | Mirrored UV coordinates and repeat/wrap brushes | Not object-space X/Y/Z symmetry, radial geometry symmetry or seam-aware world-space projection |
| Materials | 24 original procedural material presets, parameters and fill layers | UV-space procedures; no native Substance graph evaluation, SBSAR/SBS support, anchored generators or commercial asset library |
| Layers | Paint/fill/decal layers; visibility, order, opacity, duplication, names, channel switches; normal/multiply/screen/overlay/add/difference | Flat stacks, at most 128 layers per texture set; no folders, nested graphs, adjustment/filter stack, pass-through groups or anchor-point dependencies |
| Masks | Black/white bases, inversion, dedicated mask strokes | No complete procedural mask graph or geometry-aware smart-mask network |
| Channels | Base color, roughness, metallic, height, emissive, opacity; channel inspection and exports | 8-bit Canvas2D textures; opacity is editable/exportable but the 3D renderer is opaque; no refractive glass, transmission, subsurface scattering or displacement geometry |
| Decals | Embedded PNG/JPEG/WebP and rasterized text; UV placement, scale and rotation | UV-space placement; no arbitrary surface projection, vector/SVG decals, stencil projection, font packaging or live editable text after rasterization |
| Texture sets | One set per mesh material, 1–16 sets; 256/512/1024/2048/4096 resolutions | No UDIM tiles, sparse/virtual textures or 8K/16K; large supported limits are validation caps, not proven working-set capacity |
| Geometry | Original NOMAD camera, sphere, torus and rounded cube; OBJ triangles/polygons; static glTF/GLB triangle primitives and transforms | No FBX, USD, Alembic, SPP, high-poly sculpting, auto unwrap, mesh-editing suite, rigging or animation |
| glTF | Embedded/external buffers with explicit resolver, interleaved and normalized accessors, TRS transforms | Geometry only, not full material/texture preservation; required extensions, compressed, sparse, skinned, morph and non-triangle primitives are rejected |
| Picking | CPU triangle BVH, nearest surface hit, UV and normal interpolation, material-aware painting | Non-indexed triangle storage; no GPU picking, scene streaming or million-triangle interactive qualification |
| GPU rendering | WGSL WebGPU implementation; GLSL WebGL2 fallback; direct GGX lighting, procedural environment, height-normal derivatives, wireframe, debug views; WebGPU 4x MSAA | GPU compilation and runtime not validated here. Procedural lighting is not HDR image-based lighting. No path tracing, ray tracing, physically complete optical effects, OCIO or certified color management |
| Compatibility renderer | Perspective-correct software triangles, z-buffer, texture sampling, approximate GGX shading, channel views and wireframe | Lower resolution and throughput; no height bump and no GPU speed claims; used for the captured screenshots and browser tests |
| Baking | Selected-material object-space normals, normalized position, ID, BVH-ray AO, UV-normal-gradient curvature approximation, dilation, progress and cancellation | CPU bake up to 1024; no high-to-low cage projection, high-poly tangent normal transfer, thickness or production-quality curvature solver |
| Export | Actual PNG maps, ZIP archive, selected/all texture sets, packed game-engine naming preset, OBJ and `.cforge` | PNG is 8-bit; no EXR, TIFF, PSD, native Painter project, color-profile preservation or certified DCC round trips. Tangent normals derive from painted height, OpenGL +Y |
| Packed ORM | R=1, G=roughness, B=metallic | Baked AO is exported separately and is not automatically connected to ORM or smart materials |
| Local persistence | IndexedDB project library, settings and operation outbox; atomic transaction wrappers; manual project import/export | IndexedDB was unavailable in the restricted browser test context. Automatic local persistence and reload durability need validation on the intended browser/origin |
| Shared editing | Real HTTP authentication and WebSocket rooms; server journal, optimistic local edits, operation dedup, reconnect replay, presence/cursors/notes | Single-server operation-set replication, not a comprehensive CRDT suite. Same-property conflicts use deterministic total ordering; whole-mesh replacements require a new room |
| Permissions | Owner/editor/viewer, owner-managed membership, read-only rejection, expiring invitations and revocation | No organization directory, granular asset ACLs, external SSO, email verification/recovery, compliance features, independent audit or enterprise administration |
| Packaging | Plain HTML/CSS/JS, six standalone bundled ES modules, declarations, six npm tarballs, website, independent renderer example and server | Local distribution only; no npm/NuGet publication, GitHub repository creation or public deployment was performed |

## Data and memory limits

The validator accepts at most 16 texture sets, 128 layers per set, one million triangles, 100,000 journal operations, 20,000 strokes per layer and 30,000 points per stroke. These prevent some malformed inputs but do not guarantee interactive performance at those maxima. Shared room base documents have a 32 MB serialized limit and operation messages a 9 MB application limit. Embedded image sources are capped and decoded images above 16 megapixels are rejected.

The compositor retains per-layer/per-channel canvases. A large texture, many enabled channels and many sets can exhaust browser memory well before the structural limits. Start at 512 or 1024 with modest layer counts. No automatic out-of-core paging, journal compaction or memory-budget scheduler is implemented.

## File portability

`.cforge` is a versioned JSON document containing a base project and editable operations. It is specific to ChromaForge and does not open native Painter projects. Imported image decals are embedded, not linked. Built-in model geometry is regenerated by its model name; imported mesh geometry is stored in the project. SVG is not accepted as a decal format.

## Validation meaning

The tests establish specific behaviors in the supplied fixtures. They do not establish product equivalence, unrestricted network deployment safety, physical-GPU correctness, printer/colorimetric accuracy, tablet qualification or large-team/large-asset performance. See [QA.md](QA.md) for the exact executed coverage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, Mesh } from '../packages/geometry/src/mesh.js';
import { MeshBVH } from '../packages/geometry/src/bvh.js';
import { parseOBJ, exportOBJ, parseGLTF } from '../packages/geometry/src/io.js';
import { bakeMeshMaps } from '../packages/paint/src/baker.js';
import { sampleMaterial, MATERIALS } from '../packages/paint/src/materials.js';
test('sample camera has four materials and finite interleaved geometry', () => { const m = createModel('nomad'); assert.equal(m.materials.length, 4); assert.ok(m.triangleCount > 10000); assert.ok(m.vertices.every(Number.isFinite)); assert.equal(m.vertices.length, m.triangleCount * 27); });
test('sphere BVH returns UV surface hit and respects visibility', () => { const m = createModel('sphere'), bvh = new MeshBVH(m), h = bvh.intersect([0, 0, 6], [0, 0, -1]); assert.ok(h); assert.ok(h.uv.every(x => x >= 0 && x <= 1)); assert.equal(h.material, 0); assert.equal(bvh.intersect([0, 0, 6], [0, 0, -1], { visible: [false] }), null); });
test('BVH misses geometry outside bounds', () => assert.equal(new MeshBVH(createModel('cube')).intersect([8, 8, 8], [0, 0, -1]), null));
test('OBJ negative indices and fan triangulation', () => { const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1'); assert.equal(m.triangleCount, 2); assert.equal(m.warnings.length, 1); assert.ok(m.vertices.every(Number.isFinite)); });
test('OBJ export reimports geometry and UVs', () => { const m = createModel('torus'), copy = parseOBJ(exportOBJ(m)); assert.equal(copy.triangleCount, m.triangleCount); assert.equal(copy.vertices[6], m.vertices[6]); });
test('OBJ invalid vertex reference is rejected', () => assert.throws(() => parseOBJ('v 0 0 0\nf 1 2 3'), /Invalid/));
function gltf() { const data = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); return { asset: { version: '2.0' }, buffers: [{ byteLength: data.byteLength, uri: 'data:application/octet-stream;base64,' + Buffer.from(data.buffer).toString('base64') }], bufferViews: [{ buffer: 0, byteLength: data.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0, translation: [3, 4, 5] }], scenes: [{ nodes: [0] }], scene: 0 }; }
test('glTF embedded static geometry and scene transform import', async () => { const m = await parseGLTF(gltf()); assert.equal(m.triangleCount, 1); assert.ok(m.vertices.every(Number.isFinite)); assert.equal(m.bounds.min[0], -1.5); assert.equal(m.bounds.max[1], 1.5); });
test('glTF unsupported required extensions fail clearly', async () => { const j = gltf(); j.extensionsRequired = ['KHR_draco_mesh_compression']; await assert.rejects(parseGLTF(j), /extensions/); });
test('glTF scene cycles are rejected', async () => { const j = gltf(); j.nodes[0].children = [0]; await assert.rejects(parseGLTF(j), /Cycle/); });
test('geometry map baking produces real opaque pixels and AO', async () => { const out = await bakeMeshMaps(createModel('cube'), { size: 32, samples: 2 }); assert.equal(out.size, 32); assert.equal(Object.keys(out.maps).length, 5); assert.ok(out.maps.ao.some((v, i) => i % 4 === 3 && v === 255)); assert.ok(out.maps.normal.some((v, i) => i % 4 === 2 && v > 0)); });
test('baking observes cancellation', async () => { const controller = new AbortController(); controller.abort(); await assert.rejects(bakeMeshMaps(createModel('sphere'), { size: 32, samples: 1, signal: controller.signal }), /cancel/i); });
test('all original material presets produce finite bounded channel values', () => { for (const material of MATERIALS)
    for (const uv of [[.1, .2], [.7, .9]]) {
        const m = sampleMaterial(material, ...uv);
        assert.ok(m.color.every(c => Number.isFinite(c) && c >= 0 && c <= 1));
        assert.ok(m.roughness >= 0 && m.roughness <= 1);
    } });
test('standalone mesh validates NaN and material-index boundaries', () => { const m = createModel('cube'), bad = m.vertices.slice(); bad[0] = NaN; assert.throws(() => new Mesh(bad), /finite/); const invalid = m.vertices.slice(); invalid[8] = 22; assert.throws(() => new Mesh(invalid), /material index/); });
test('baker rejects invalid dimensions, sample budgets and materials', async () => { const mesh = createModel('cube'); for (const options of [{ size: 0 }, { size: NaN }, { samples: 0 }, { samples: Infinity }, { material: 2 }, { maxDistance: NaN }])
    await assert.rejects(bakeMeshMaps(mesh, options)); });

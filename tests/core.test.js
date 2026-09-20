import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createLayer, ProjectStore, validateProject, validateOperation } from '../packages/core/src/document.js';
import { identity, inverse, multiply, composeTRS, transform, rayTriangle, rayBox, OrbitCamera } from '../packages/core/src/math.js';
import { crc32, createZip } from '../packages/paint/src/zip.js';
const approx = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const store = actor => new ProjectStore(createProject('sphere', 256), actor);
const patch = (s, color) => s.dispatch('layer:set', { setId: 'set-0', layerId: 'base-0', patch: { color } }, 'Set color');
const stroke = (id = 'stroke-1') => ({ id, target: 'paint', brush: { size: .03, color: '#ff0000', flow: 1, hardness: .5, shape: 'round', channels: ['baseColor'] }, points: [[.2, .3, 1, 0], [.3, .4, .5, 0]] });
test('matrix inverse preserves an affine transform', () => { const m = composeTRS([2, -1, 4], [0, .5, 0, Math.sqrt(.75)], [2, 3, 4]); const q = multiply(m, inverse(m)); q.forEach((v, i) => approx(v, identity()[i])); const p = transform(inverse(m), transform(m, [.2, .3, .4])); p.slice(0, 3).forEach((v, i) => approx(v, [.2, .3, .4][i])); });
test('singular inverse throws explicitly', () => assert.throws(() => inverse(new Float32Array(16)), /Singular/));
test('ray triangle returns barycentric coordinates', () => { const hit = rayTriangle([.25, .25, 1], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]); approx(hit.u, .25); approx(hit.v, .25); approx(hit.t, 1); assert.equal(rayTriangle([2, 2, 1], [0, 0, -1], [0, 0, 0], [1, 0, 0], [0, 1, 0]), null); });
test('ray AABB handles parallel directions', () => { assert.equal(rayBox([0, 0, 3], [0, 0, -1], [-1, -1, -1], [1, 1, 1]), true); assert.equal(rayBox([2, 0, 3], [0, 0, -1], [-1, -1, -1], [1, 1, 1]), false); });
test('camera center ray points at target', () => { const c = new OrbitCamera(), r = c.ray(0, 0, 1.5); const dot = r.direction.reduce((n, v, i) => n + v * (-c.eye[i]), 0); assert.ok(dot > 6.79); });
test('default project passes strict validation', () => assert.equal(validateProject(createProject()).textureSets.length, 4));
test('material IDs and inline style colors reject injection', () => { for (const fn of [p => p.textureSets[0].id = '\" onclick=alert(1)', p => p.textureSets[0].layers[0].color = 'red; background:url(https://evil)', p => p.textureSets[0].layers[0].image = 'data:image/svg+xml,<svg/>']) {
    const p = createProject();
    fn(p);
    assert.throws(() => validateProject(p));
} });
test('duplicate project layer IDs are rejected', () => { const p = createProject(); p.textureSets[1].layers[0].id = 'base-0'; assert.throws(() => validateProject(p), /Duplicate/); });
test('layer operation, visibility, order and delete reduce correctly', () => { const s = store('artist'); const l = createLayer('paint', 'Paint', { id: 'paint' }); s.dispatch('layer:add', { setId: 'set-0', layer: l }); s.dispatch('layer:set', { setId: 'set-0', layerId: l.id, patch: { visible: false, opacity: .5 } }); assert.equal(s.state.textureSets[0].layers.find(x => x.id === l.id).opacity, .5); s.dispatch('layer:move', { setId: 'set-0', layerId: l.id, index: 0 }); assert.equal(s.state.textureSets[0].layers[0].id, l.id); s.dispatch('layer:delete', { setId: 'set-0', layerId: l.id }); assert.equal(s.state.textureSets[0].layers.length, 4); });
test('concurrent operations converge regardless of arrival order', () => { const a = store('artist-a'), b = new ProjectStore(a.base, 'artist-b'), x = patch(a, '#ff0000'), y = patch(b, '#0000ff'); a.ingest([y]); b.ingest([x]); assert.deepEqual(a.state, b.state); assert.equal(a.state.textureSets[0].layers[0].color, '#0000ff'); });
test('independent concurrent changes survive', () => { const a = store('a'), b = new ProjectStore(a.base, 'b'); const x = patch(a, '#aa0000'), y = b.dispatch('project:set', { patch: { name: 'Shared' } }); a.ingest([y]); b.ingest([x]); assert.deepEqual(a.state, b.state); assert.equal(a.state.name, 'Shared'); assert.equal(a.state.textureSets[0].layers[0].color, '#aa0000'); });
test('duplicate delivery is idempotent', () => { const s = store('a'), op = patch(s, '#00aaff'); const revision = s.revision; s.ingest([op, op]); assert.equal(s.ops.size, 1); assert.equal(s.revision, revision); });
test('local undo does not undo another artist', () => { const a = store('a'), b = new ProjectStore(a.base, 'b'), x = patch(a, '#123456'), y = b.dispatch('project:set', { patch: { name: 'Other artist' } }); a.ingest([y]); a.undo(); assert.equal(a.state.textureSets[0].layers[0].color, a.base.textureSets[0].layers[0].color); assert.equal(a.state.name, 'Other artist'); a.redo(); assert.equal(a.state.textureSets[0].layers[0].color, '#123456'); });
test('forged cross-actor undo is not applied by replica', () => { const a = store('a'), op = patch(a, '#123456'); a.ingest([{ id: 'forged', actor: 'b', clock: 10, type: 'history:toggle', payload: { target: op.id, enabled: false } }]); assert.equal(a.state.textureSets[0].layers[0].color, '#123456'); });
test('strokes retain pressure and seam breaks', () => { const s = store('a'), l = s.state.textureSets[0].layers.at(-1); s.dispatch('stroke:add', { setId: 'set-0', layerId: l.id, stroke: stroke() }); assert.equal(s.state.textureSets[0].layers.at(-1).strokes[0].points[1][2], .5); });
test('invalid imported operation leaves current project unchanged', () => { const s = store('a'); patch(s, '#00ff00'); const before = JSON.stringify(s.serialize()); const d = structuredClone(s.serialize()); d.operations.push({ id: 'bad', actor: 'a', clock: 3, type: 'layer:set', payload: { setId: 'set-0', layerId: 'base-0', patch: { color: 'broken' } } }); assert.throws(() => s.load(d)); assert.equal(JSON.stringify(s.serialize()), before); });
test('invalid operation batch is atomic', () => { const s = store('a'); const a = { id: 'good', actor: 'b', clock: 1, type: 'project:set', payload: { patch: { name: 'No mutation' } } }; assert.throws(() => s.ingest([a, { ...a, id: 'bad', clock: NaN }])); assert.equal(s.ops.size, 0); });
test('project roundtrip preserves operation history and state', () => { const s = store('a'); patch(s, '#ccaa33'); s.undo(); const copy = store('b'); copy.load(JSON.parse(JSON.stringify(s.serialize()))); assert.deepEqual(copy.state, s.state); assert.deepEqual(copy.operations, s.operations); });
test('schema forbids non-finite and unsafe material values', () => { for (const patch of [{ opacity: 1.1 }, { roughness: NaN }, { metallic: '1' }, { pattern: '<script>' }, { channels: ['unknown'] }, { __proto__: null, constructor: { polluted: true } }])
    assert.throws(() => validateOperation({ id: 'op', actor: 'a', clock: 1, type: 'layer:set', payload: { setId: 'set-0', layerId: 'base-0', patch } })); });
test('stroke size, coordinate and payload validation', () => { for (const change of [s => s.brush.size = Infinity, s => s.points[0][2] = 3, s => s.brush.color = 'bad', s => s.points = []]) {
    const s = stroke();
    change(s);
    assert.throws(() => validateOperation({ id: 'op', actor: 'a', clock: 1, type: 'stroke:add', payload: { setId: 'set-0', layerId: 'paint', stroke: s } }));
} });
test('comment resolution replays and can be undone', () => { const s = store('a'); s.dispatch('comment:add', { comment: { id: 'note', text: 'Check the finish' } }); s.dispatch('comment:resolve', { commentId: 'note', resolved: true }); assert.equal(s.state.comments[0].resolved, true); s.undo(); assert.equal(s.state.comments[0].resolved, false); });
test('CRC32 matches known test vector', () => assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926));
test('ZIP central directory, UTF-8 name and file CRC are valid', async () => { const b = new Uint8Array(await (await createZip({ 'textures/café.txt': 'hello' })).arrayBuffer()), v = new DataView(b.buffer); assert.equal(v.getUint32(0, true), 0x04034b50); assert.equal(v.getUint32(14, true), crc32(new TextEncoder().encode('hello'))); assert.equal(v.getUint32(b.length - 22, true), 0x06054b50); assert.equal(v.getUint16(b.length - 14, true), 1); });
test('ZIP traversal and absolute path entries are rejected', async () => { for (const name of ['../outside.txt', '/absolute.txt', 'C:/secret.txt', 'dir/../../secret', 'dir\\secret.txt'])
    await assert.rejects(createZip({ [name]: 'x' }), /safe relative/); });

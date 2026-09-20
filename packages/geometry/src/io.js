import { Mesh } from './mesh.js';
import { normalize, cross, sub, transform, multiply, identity, composeTRS, inverse } from '../../core/src/math.js';
/** OBJ: polygons fan-triangulated, negative indices, groups, normals, UV and usemtl. */
export function parseOBJ(text, name = 'Imported OBJ') {
    if (typeof text !== 'string' || text.length > 100e6)
        throw Error('OBJ input too large');
    const positions = [], normals = [], uv = [], out = [], materials = [];
    let mat = 0, missingUV = 0;
    const resolve = (a, i) => { const n = Number(i); return a[n < 0 ? a.length + n : n - 1]; };
    for (const line of text.split(/\r?\n/)) {
        const w = line.trim().split(/\s+/), cmd = w.shift();
        if (cmd === 'v')
            positions.push(w.slice(0, 3).map(Number));
        else if (cmd === 'vn')
            normals.push(normalize(w.slice(0, 3).map(Number)));
        else if (cmd === 'vt')
            uv.push(w.slice(0, 2).map(Number));
        else if (cmd === 'usemtl') {
            const n = w.join(' ');
            mat = materials.indexOf(n);
            if (mat < 0) {
                mat = materials.length;
                materials.push(n);
            }
        }
        else if (cmd === 'f') {
            if (!materials.length)
                materials.push('Material');
            const refs = w.map(t => { const [p, tv, n] = t.split('/'); const pos = resolve(positions, p); if (!pos || pos.some(v => !Number.isFinite(v)))
                throw Error('Invalid OBJ vertex reference'); let tc = tv ? resolve(uv, tv) : null; if (!tc)
                missingUV++; return { p: pos, uv: tc, n: n ? resolve(normals, n) : null }; });
            for (let i = 1; i < refs.length - 1; i++) {
                const tri = [refs[0], refs[i], refs[i + 1]], n = normalize(cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p)));
                for (const v of tri) {
                    const tc = v.uv ?? [v.p[0] * .25 + .5, v.p[1] * .25 + .5];
                    out.push(...v.p, ...(v.n ?? n), ...tc, mat);
                }
            }
        }
    }
    if (!out.length)
        throw Error('OBJ contains no polygon faces');
    if (materials.length > 16)
        throw Error('This build supports up to 16 material sets');
    let mesh = new Mesh(out, name, materials.length ? materials : ['Material']).normalized();
    mesh.warnings = missingUV ? ['Missing texture coordinates: planar fallback applied. Supply UVs for predictable painting.'] : [];
    return mesh;
}
export function exportOBJ(mesh) { const v = mesh.vertices, out = ['# ChromaForge mesh export']; for (let i = 0; i < v.length; i += 9)
    out.push(`v ${v[i]} ${v[i + 1]} ${v[i + 2]}`); for (let i = 0; i < v.length; i += 9)
    out.push(`vt ${v[i + 6]} ${v[i + 7]}`); for (let i = 0; i < v.length; i += 9)
    out.push(`vn ${v[i + 3]} ${v[i + 4]} ${v[i + 5]}`); let last = -1; for (let i = 0; i < v.length; i += 27) {
    let m = v[i + 8];
    if (m !== last) {
        out.push(`usemtl ${mesh.materials[m] ?? 'Material'}`);
        last = m;
    }
    let a = i / 9 + 1;
    out.push(`f ${a}/${a}/${a} ${a + 1}/${a + 1}/${a + 1} ${a + 2}/${a + 2}/${a + 2}`);
} return out.join('\n'); }
/** glTF 2.0 static triangle geometry. External resources require an explicit resolver.
 * Unsupported compression, skinning, sparse accessors and morph targets are rejected.
 */
export async function parseGLTF(input, { name = 'Imported glTF', resolve = null } = {}) {
    let json, binary;
    if (input instanceof ArrayBuffer) {
        const d = new DataView(input);
        if (d.getUint32(0, true) !== 0x46546c67 || d.getUint32(4, true) !== 2)
            throw Error('Expected GLB version 2');
        if (d.getUint32(8, true) > input.byteLength)
            throw Error('Truncated GLB');
        let o = 12;
        while (o + 8 <= input.byteLength) {
            let size = d.getUint32(o, true), type = d.getUint32(o + 4, true);
            if (o + 8 + size > input.byteLength)
                throw Error('Invalid GLB chunk');
            if (type === 0x4e4f534a)
                json = JSON.parse(new TextDecoder().decode(input.slice(o + 8, o + 8 + size)));
            if (type === 0x004e4942)
                binary = input.slice(o + 8, o + 8 + size);
            o += 8 + size;
        }
    }
    else
        json = typeof input === 'string' ? JSON.parse(input) : input;
    if (json?.asset?.version !== '2.0')
        throw Error('Expected glTF 2.0');
    if (json.extensionsRequired?.length)
        throw Error(`Required glTF extensions not supported: ${json.extensionsRequired.join(', ')}`);
    const buffers = await Promise.all((json.buffers ?? []).map(async (b) => { if (!b.uri) {
        if (!binary)
            throw Error('Missing GLB binary buffer');
        return binary;
    } if (b.uri.startsWith('data:')) {
        const comma = b.uri.indexOf(','), s = atob(b.uri.slice(comma + 1));
        return Uint8Array.from(s, c => c.charCodeAt(0)).buffer;
    } if (!resolve)
        throw Error('External glTF resources: select the .gltf and associated .bin files together'); return resolve(b.uri); }));
    const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, getters = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
    function accessor(id) { const a = json.accessors[id]; if (!a || a.sparse)
        throw Error('Missing/sparse accessor is not supported'); const b = json.bufferViews[a.bufferView]; if (!b)
        throw Error('Missing buffer view'); const data = new DataView(buffers[b.buffer]), count = components[a.type], sz = sizes[a.componentType], stride = b.byteStride ?? count * sz, base = (b.byteOffset ?? 0) + (a.byteOffset ?? 0); if (!count || !sz || a.count > 3e6)
        throw Error('Invalid accessor'); return Array.from({ length: a.count }, (_, i) => Array.from({ length: count }, (_, j) => { let x = data[getters[a.componentType]](base + i * stride + j * sz, true); if (a.normalized && a.componentType !== 5126) {
        const signed = [5120, 5122].includes(a.componentType), den = signed ? 2 ** (sz * 8 - 1) - 1 : 2 ** (sz * 8) - 1;
        x = Math.max(signed ? -1 : 0, x / den);
    } return x; })); }
    const out = [], materials = (json.materials ?? []).map((m, i) => m.name ?? `Material ${i + 1}`);
    if (!materials.length)
        materials.push('Material');
    if (materials.length > 16)
        throw Error('Up to 16 material sets supported');
    function node(index, parent, ancestors = new Set()) {
        if (ancestors.has(index))
            throw Error('Cycle in glTF scene graph');
        const seen = new Set(ancestors).add(index), n = json.nodes[index];
        if (!n)
            throw Error('Invalid glTF node');
        if (n.skin !== undefined)
            throw Error('Skinned geometry: export a static mesh first');
        let m = multiply(parent, n.matrix ?? composeTRS(n.translation, n.rotation, n.scale)), im = inverse(m);
        if (n.mesh !== undefined)
            for (const p of json.meshes[n.mesh].primitives) {
                if ((p.mode ?? 4) !== 4)
                    throw Error('Only triangle primitives supported');
                if (p.targets?.length || p.extensions)
                    throw Error('Morph/compressed primitives are unsupported');
                const pos = accessor(p.attributes.POSITION), nr = p.attributes.NORMAL === undefined ? null : accessor(p.attributes.NORMAL), uv = p.attributes.TEXCOORD_0 === undefined ? null : accessor(p.attributes.TEXCOORD_0), ix = p.indices === undefined ? pos.map((_, i) => i) : accessor(p.indices).flat();
                if (ix.length % 3)
                    throw Error('Invalid triangle index count');
                for (let i = 0; i < ix.length; i += 3) {
                    const tri = ix.slice(i, i + 3).map(id => { if (!pos[id])
                        throw Error('Invalid geometry index'); return transform(m, pos[id]).slice(0, 3); }), normal = normalize(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
                    for (let j = 0; j < 3; j++) {
                        let k = ix[i + j], n = nr?.[k];
                        if (n)
                            n = normalize([0, 1, 2].map(r => im[r * 4] * n[0] + im[r * 4 + 1] * n[1] + im[r * 4 + 2] * n[2]));
                        out.push(...tri[j], ...(n ?? normal), ...(uv?.[k] ?? [pos[k][0] * .25 + .5, pos[k][1] * .25 + .5]), p.material ?? 0);
                    }
                }
            }
        for (const c of n.children ?? [])
            node(c, m, seen);
    }
    const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes?.map((_, i) => i).filter(i => !json.nodes.some(n => n.children?.includes(i)));
    for (const i of roots ?? [])
        node(i, identity());
    if (!out.length)
        throw Error('No static triangle mesh found');
    return new Mesh(out, name, materials).normalized();
}

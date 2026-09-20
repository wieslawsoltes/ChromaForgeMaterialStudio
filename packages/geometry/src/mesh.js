import { clamp, normalize, add, sub, scale, cross, transform, identity, multiply, composeTRS } from '../../core/src/math.js';
/** Interleaved non-indexed triangles: position.xyz, normal.xyz, uv.xy, material-index. */
export class Mesh {
    constructor(vertices, name = 'Mesh', materials = ['Material']) { this.vertices = vertices instanceof Float32Array ? vertices : new Float32Array(vertices); if (!this.vertices.length || this.vertices.length % 27 || this.vertices.length > 27000000 || !this.vertices.every(Number.isFinite))
        throw Error('Mesh must contain finite, complete triangles (at most one million)'); if (!Array.isArray(materials) || materials.length < 1 || materials.length > 16 || materials.some(n => typeof n !== 'string' || n.length > 200))
        throw Error('Mesh requires 1–16 named material sets'); for (let i = 8; i < this.vertices.length; i += 9)
        if (!Number.isInteger(this.vertices[i]) || this.vertices[i] < 0 || this.vertices[i] >= materials.length)
            throw Error('Invalid vertex material index'); this.name = name; this.materials = materials; this.triangleCount = this.vertices.length / 27; this.bounds = this.calculateBounds(); }
    calculateBounds() { let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < this.vertices.length; i += 9)
        for (let j = 0; j < 3; j++) {
            min[j] = Math.min(min[j], this.vertices[i + j]);
            max[j] = Math.max(max[j], this.vertices[i + j]);
        } return { min, max }; }
    normalized() { const { min, max } = this.bounds, c = scale(add(min, max), .5), s = 3 / Math.max(...sub(max, min), 1e-8), v = this.vertices.slice(); for (let i = 0; i < v.length; i += 9)
        for (let j = 0; j < 3; j++)
            v[i + j] = (v[i + j] - c[j]) * s; return new Mesh(v, this.name, this.materials); }
    toJSON() { return { vertices: Array.from(this.vertices), name: this.name, materials: this.materials }; }
    static fromJSON(v) { return new Mesh(v.vertices, v.name, v.materials); }
}
export class MeshBuilder {
    constructor() { this.parts = []; }
    add(vertices, { position = [0, 0, 0], rotation = [0, 0, 0], size = [1, 1, 1], material = 0 } = {}) {
        let [rx, ry, rz] = rotation;
        const rot = (p) => { let [x, y, z] = p; [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)]; [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)]; [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)]; return [x, y, z]; };
        const out = [];
        for (let i = 0; i < vertices.length; i += 8) {
            const p = add(rot(vertices.slice(i, i + 3).map((v, j) => v * size[j])), position), n = normalize(rot(vertices.slice(i + 3, i + 6).map((v, j) => v / size[j])));
            out.push(...p, ...n, vertices[i + 6], vertices[i + 7], material);
        }
        this.parts.push({ vertices: out, material });
        return this;
    }
    finish(name = 'Mesh', materials = ['Material']) {
        const counts = {}, indices = {};
        for (const p of this.parts)
            counts[p.material] = (counts[p.material] ?? 0) + 1;
        let all = [];
        for (const p of this.parts) {
            let n = Math.ceil(Math.sqrt(counts[p.material])), index = indices[p.material] ?? 0;
            indices[p.material] = index + 1;
            const col = index % n, row = Math.floor(index / n), pad = .025;
            for (let i = 0; i < p.vertices.length; i += 9) {
                let v = p.vertices.slice(i, i + 9);
                v[6] = (col + pad + v[6] * (1 - 2 * pad)) / n;
                v[7] = (row + pad + v[7] * (1 - 2 * pad)) / n;
                all.push(...v);
            }
        }
        return new Mesh(all, name, materials);
    }
}
function grid(fn, nu, nv) { let out = []; for (let y = 0; y < nv; y++)
    for (let x = 0; x < nu; x++) {
        const a = fn(x / nu, y / nv), b = fn((x + 1) / nu, y / nv), c = fn((x + 1) / nu, (y + 1) / nv), d = fn(x / nu, (y + 1) / nv);
        out.push(...a, ...b, ...c, ...a, ...c, ...d);
    } return out; }
export function roundedBox(size = [1, 1, 1], r = .12, n = 8) {
    let out = [];
    const axes = [[0, 1, 2, 1], [0, 1, 2, -1], [2, 1, 0, 1], [2, 1, 0, -1], [0, 2, 1, 1], [0, 2, 1, -1]];
    axes.forEach(([a, b, c, sign], face) => { out.push(...grid((u, v) => { let p = [0, 0, 0]; p[a] = (u - .5) * size[a]; p[b] = (v - .5) * size[b]; p[c] = sign * size[c] / 2; let q = p.map((x, i) => clamp(x, -size[i] / 2 + r, size[i] / 2 - r)), nr = normalize(sub(p, q)); p = add(q, scale(nr, r)); let uu = (face % 3 + u) / 3, vv = (Math.floor(face / 3) + v) / 2; return [...p, ...nr, uu, vv]; }, n, n)); });
    return out;
}
export function sphere(r = 1, nu = 64, nv = 32) { return grid((u, v) => { let t = u * Math.PI * 2, p = v * Math.PI, n = [-Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)]; return [...scale(n, r), ...n, u, 1 - v]; }, nu, nv); }
export function torus(major = .7, minor = .1, nu = 64, nv = 12) { return grid((u, v) => { let t = u * Math.PI * 2, p = v * Math.PI * 2, n = [Math.cos(t) * Math.cos(p), Math.sin(t) * Math.cos(p), Math.sin(p)], pos = [Math.cos(t) * (major + minor * Math.cos(p)), Math.sin(t) * (major + minor * Math.cos(p)), minor * Math.sin(p)]; return [...pos, ...n, u, v]; }, nu, nv); }
export function cylinder(radius = .5, depth = 1, n = 48) {
    let out = grid((u, v) => { const t = u * Math.PI * 2; return [Math.cos(t) * radius, Math.sin(t) * radius, (v - .5) * depth, Math.cos(t), Math.sin(t), 0, u, v * .5]; }, n, 1);
    for (let s of [-1, 1])
        for (let i = 0; i < n; i++) {
            let a = i / n * 2 * Math.PI, b = (i + 1) / n * 2 * Math.PI;
            out.push(0, 0, s * depth / 2, 0, 0, s, .5, .75, Math.cos(a) * radius, Math.sin(a) * radius, s * depth / 2, 0, 0, s, .5 + Math.cos(a) * .24, .75 + Math.sin(a) * .24, Math.cos(b) * radius, Math.sin(b) * radius, s * depth / 2, 0, 0, s, .5 + Math.cos(b) * .24, .75 + Math.sin(b) * .24);
        }
    return out;
}
export function createModel(type = 'nomad') {
    const b = new MeshBuilder();
    if (type === 'sphere')
        return b.add(sphere(1.45)).finish('Material sphere');
    if (type === 'cube')
        return b.add(roundedBox([2.6, 2.6, 2.6], .16, 10)).finish('Rounded cube');
    if (type === 'torus')
        return b.add(torus(1.1, .45, 96, 32), { rotation: [.35, 0, 0] }).finish('Material torus');
    b.add(roundedBox([2.7, 1.92, 1.45], .2, 12), { position: [0, .1, 0], material: 0 });
    b.add(roundedBox([2.79, 1.75, 1.1], .18, 10), { position: [0, .02, -.14], material: 1 });
    b.add(roundedBox([2.38, 1.64, .18], .08, 8), { position: [0, .12, .754], material: 0 });
    b.add(cylinder(.79, .3, 72), { position: [-.25, .15, .91], material: 1 });
    b.add(torus(.69, .067, 80, 14), { position: [-.25, .15, 1.085], material: 2 });
    b.add(cylinder(.63, .36, 72), { position: [-.25, .15, 1.18], material: 1 });
    b.add(torus(.59, .037, 80, 12), { position: [-.25, .15, 1.377], material: 2 });
    b.add(cylinder(.515, .06, 72), { position: [-.25, .15, 1.36], material: 3 });
    b.add(torus(.43, .025, 72, 12), { position: [-.25, .15, 1.397], material: 1 });
    b.add(torus(.26, .012, 64, 8), { position: [-.25, .15, 1.401], material: 2 });
    b.add(cylinder(.21, .02, 64), { position: [-.25, .15, 1.402], material: 1 });
    for (let i = 0; i < 48; i++) {
        let t = i / 48 * Math.PI * 2;
        b.add(roundedBox([.027, .1, .19], .01, 1), { position: [-.25 + Math.cos(t) * .645, .15 + Math.sin(t) * .645, 1.22], rotation: [0, 0, t - Math.PI / 2], material: 2 });
    }
    for (let x of [-1.25, 1.25])
        for (let y of [-.67, .86])
            b.add(roundedBox([.32, .37, 1.67], .08, 5), { position: [x, y, 0], material: 1 });
    for (let x of [-1.16, 1.16])
        for (let y of [-.61, .78]) {
            b.add(cylinder(.07, .045, 16), { position: [x, y, .848], material: 2 });
            b.add(roundedBox([.067, .014, .015], .004, 1), { position: [x, y, .878], rotation: [0, 0, .6], material: 1 });
        }
    b.add(roundedBox([1.65, .15, .3], .055, 5), { position: [0, 1.46, -.14], material: 2 });
    for (let x of [-.72, .72])
        b.add(roundedBox([.16, .39, .3], .055, 5), { position: [x, 1.22, -.14], material: 2 });
    b.add(roundedBox([1.02, .17, .34], .06, 4), { position: [0, 1.46, -.14], material: 1 });
    for (let x of [-.88, .88])
        b.add(roundedBox([.7, .24, .82], .06, 5), { position: [x, -.96, 0], material: 1 });
    b.add(roundedBox([.38, .62, .07], .045, 5), { position: [.88, .4, .889], material: 1 });
    for (let y of [.54, .3])
        b.add(cylinder(.067, .035, 20), { position: [.88, y, .94], material: y > .4 ? 3 : 2 });
    b.add(roundedBox([.57, .26, .048], .026, 3), { position: [.78, -.35, .88], material: 1 });
    for (let i = 0; i < 7; i++)
        b.add(roundedBox([.035, .25, .032], .006, 1), { position: [.55 + i * .077, -.35, .915], material: 2 });
    for (let y of [-.46, -.26, -.06, .14, .34, .54])
        b.add(roundedBox([.028, .045, .74], .012, 2), { position: [1.394, y, -.12], material: 2 });
    b.add(roundedBox([1.56, 1.04, .07], .08, 6), { position: [-.22, .15, -.746], material: 3 });
    b.add(cylinder(.135, .09, 24), { position: [.83, .7, -.78], material: 2 });
    return b.finish('NOMAD-07 · Survey camera', ['Shell', 'Chassis', 'Hardware', 'Optics']);
}

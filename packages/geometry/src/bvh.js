import { rayBox, rayTriangle, normalize, add, scale } from '../../core/src/math.js';
/** Median-split BVH. Built once for an immutable mesh; rays return barycentric UV/material. */
export class MeshBVH {
    constructor(mesh, leafSize = 12) { this.mesh = mesh; this.v = mesh.vertices; this.leafSize = leafSize; let tris = Array.from({ length: mesh.triangleCount }, (_, i) => i); this.root = this.build(tris); }
    build(ids) { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let id of ids)
        for (let j = 0; j < 3; j++)
            for (let k = 0; k < 3; k++) {
                let v = this.v[id * 27 + j * 9 + k];
                min[k] = Math.min(min[k], v);
                max[k] = Math.max(max[k], v);
            } const node = { min, max }; if (ids.length <= this.leafSize) {
        node.ids = ids;
        return node;
    } let axis = 0; for (let i = 1; i < 3; i++)
        if (max[i] - min[i] > max[axis] - min[axis])
            axis = i; const center = id => (this.v[id * 27 + axis] + this.v[id * 27 + 9 + axis] + this.v[id * 27 + 18 + axis]); ids.sort((a, b) => center(a) - center(b)); let mid = ids.length >> 1; node.left = this.build(ids.slice(0, mid)); node.right = this.build(ids.slice(mid)); return node; }
    intersect(origin, direction, { material = -1, maxDistance = Infinity, ignoreTriangle = -1, visible = null } = {}) {
        let best = maxDistance, result = null;
        const v = this.v, stack = [this.root];
        while (stack.length) {
            const n = stack.pop();
            if (!rayBox(origin, direction, n.min, n.max, best))
                continue;
            if (!n.ids) {
                stack.push(n.left, n.right);
                continue;
            }
            for (let id of n.ids) {
                if (id === ignoreTriangle)
                    continue;
                const o = id * 27, m = Math.round(v[o + 8]);
                if (material >= 0 && m !== material || visible && !visible[m])
                    continue;
                const hit = rayTriangle(origin, direction, v.subarray(o, o + 3), v.subarray(o + 9, o + 12), v.subarray(o + 18, o + 21));
                if (hit && hit.t < best) {
                    best = hit.t;
                    const w = 1 - hit.u - hit.v;
                    result = { ...hit, triangle: id, material: m, uv: [v[o + 6] * w + v[o + 15] * hit.u + v[o + 24] * hit.v, v[o + 7] * w + v[o + 16] * hit.u + v[o + 25] * hit.v], position: add(origin, scale(direction, hit.t)), normal: normalize([3, 4, 5].map(k => v[o + k] * w + v[o + 9 + k] * hit.u + v[o + 18 + k] * hit.v)) };
                }
            }
        }
        return result;
    }
}

import { MeshBVH } from '../../geometry/src/bvh.js';
import { normalize, add, scale, cross, sub, clamp } from '../../core/src/math.js';
import { hash } from './materials.js';
/** Geometry raster baker. Object-space normals, position, material ID and ray-cast AO.
 * High-to-low cage projection and tangent-space high-poly normal baking are not implied.
 */
export async function bakeMeshMaps(mesh, { size = 256, samples = 8, maxDistance = .45, material = 0, onProgress = () => { }, signal = null } = {}) {
    if (!Number.isInteger(size) || size < 2 || size > 1024)
        throw Error('Bake size must be an integer from 2 to 1024');
    if (!Number.isInteger(samples) || samples < 1 || samples > 128)
        throw Error('AO samples must be an integer from 1 to 128');
    if (!Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance > 1000000)
        throw Error('AO distance must be finite and positive');
    if (!Number.isInteger(material) || material < 0 || material >= mesh.materials.length)
        throw Error('Invalid bake material index');
    if (signal?.aborted)
        throw Error('Baking cancelled');
    const bvh = new MeshBVH(mesh), v = mesh.vertices, count = size * size, maps = { normal: new Uint8ClampedArray(count * 4), position: new Uint8ClampedArray(count * 4), ao: new Uint8ClampedArray(count * 4), id: new Uint8ClampedArray(count * 4), curvature: new Uint8ClampedArray(count * 4) }, position = new Float32Array(count * 3), normals = new Float32Array(count * 3), triangles = new Int32Array(count).fill(-1);
    for (let t = 0; t < mesh.triangleCount; t++) {
        let o = t * 27;
        if (Math.round(v[o + 8]) !== material)
            continue;
        const pts = [0, 1, 2].map(j => [v[o + j * 9 + 6] * size, (1 - v[o + j * 9 + 7]) * size]), [a, b, c] = pts, den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(den) < 1e-10)
            continue;
        let minx = clamp(Math.floor(Math.min(...pts.map(p => p[0]))), 0, size - 1), maxx = clamp(Math.ceil(Math.max(...pts.map(p => p[0]))), 0, size - 1), miny = clamp(Math.floor(Math.min(...pts.map(p => p[1]))), 0, size - 1), maxy = clamp(Math.ceil(Math.max(...pts.map(p => p[1]))), 0, size - 1);
        for (let y = miny; y <= maxy; y++)
            for (let x = minx; x <= maxx; x++) {
                const px = x + .5, py = y + .5, w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den, w2 = 1 - w0 - w1;
                if (Math.min(w0, w1, w2) < 0)
                    continue;
                let i = y * size + x;
                triangles[i] = t;
                for (let k = 0; k < 3; k++) {
                    position[i * 3 + k] = v[o + k] * w0 + v[o + 9 + k] * w1 + v[o + 18 + k] * w2;
                    normals[i * 3 + k] = v[o + 3 + k] * w0 + v[o + 12 + k] * w1 + v[o + 21 + k] * w2;
                }
            }
    }
    for (let y = 0; y < size; y++) {
        if (signal?.aborted)
            throw Error('Baking cancelled');
        for (let x = 0; x < size; x++) {
            let i = y * size + x;
            if (triangles[i] < 0)
                continue;
            const p = Array.from(position.subarray(i * 3, i * 3 + 3)), n = normalize(normals.subarray(i * 3, i * 3 + 3)), t = normalize(cross(Math.abs(n[1]) > .9 ? [1, 0, 0] : [0, 1, 0], n)), b = cross(n, t);
            let hits = 0;
            for (let s = 0; s < samples; s++) {
                const r = Math.sqrt((s + .5) / samples), a = hash(i, s, 19) * Math.PI * 2, dir = add(add(scale(t, r * Math.cos(a)), scale(b, r * Math.sin(a))), scale(n, Math.sqrt(1 - r * r)));
                if (bvh.intersect(add(p, scale(n, .001)), dir, { maxDistance, ignoreTriangle: triangles[i] }))
                    hits++;
            }
            const ao = Math.round((1 - hits / samples) * 255);
            maps.ao.set([ao, ao, ao, 255], i * 4);
            maps.normal.set([...n.map(v => (v * .5 + .5) * 255), 255], i * 4);
            maps.position.set([...p.map((v, k) => (v - mesh.bounds.min[k]) / (mesh.bounds.max[k] - mesh.bounds.min[k] || 1) * 255), 255], i * 4);
            maps.id.set([hash(material, 0, 1) * 200 + 35, hash(material, 1, 1) * 200 + 35, hash(material, 2, 1) * 200 + 35, 255], i * 4);
            let edge = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                let xx = x + dx, yy = y + dy, j = yy * size + xx;
                if (xx >= 0 && xx < size && yy >= 0 && yy < size && triangles[j] >= 0)
                    edge += Math.hypot(...n.map((v, k) => v - normals[j * 3 + k]));
            }
            let cv = clamp(edge * 2) * 255;
            maps.curvature.set([cv, cv, cv, 255], i * 4);
        }
        if (y % 8 === 0) {
            onProgress(y / size);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    // Four-pixel dilation prevents black borders around ordinary islands.
    for (const map of Object.values(maps))
        for (let pass = 0; pass < 4; pass++) {
            const copy = map.slice();
            for (let y = 1; y < size - 1; y++)
                for (let x = 1; x < size - 1; x++) {
                    const i = (y * size + x) * 4;
                    if (copy[i + 3])
                        continue;
                    for (const d of [-4, 4, -size * 4, size * 4])
                        if (copy[i + d + 3]) {
                            map.set(copy.subarray(i + d, i + d + 4), i);
                            break;
                        }
                }
        }
    onProgress(1);
    return { size, maps };
}

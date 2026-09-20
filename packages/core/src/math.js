/** Allocation-conscious column-major matrix / vector helpers. Right-handed, WebGPU Z [0,1]. */
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(...a);
export const normalize = a => { let l = length(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 1, 0]; };
export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
export function perspective(fov, aspect, near = .05, far = 200) { const f = 1 / Math.tan(fov / 2); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0]); }
export function orthographic(l, r, b, t, n = .05, f = 200) { return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, 1 / (n - f), 0, -(r + l) / (r - l), -(t + b) / (t - b), n / (n - f), 1]); }
export function lookAt(eye, target, up = [0, 1, 0]) { const z = normalize(sub(eye, target)), x = normalize(cross(up, z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]); }
export function inverse(a) { const m = Array.from({ length: 4 }, (_, r) => [a[r], a[4 + r], a[8 + r], a[12 + r], ...Array.from({ length: 4 }, (_, c) => +(r === c))]); for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++)
        if (Math.abs(m[r][c]) > Math.abs(m[p][c]))
            p = r;
    if (Math.abs(m[p][c]) < 1e-12)
        throw new Error('Singular matrix');
    [m[p], m[c]] = [m[c], m[p]];
    let s = m[c][c];
    for (let j = 0; j < 8; j++)
        m[c][j] /= s;
    for (let r = 0; r < 4; r++)
        if (r !== c) {
            s = m[r][c];
            for (let j = 0; j < 8; j++)
                m[r][j] -= s * m[c][j];
        }
} return new Float32Array(Array.from({ length: 16 }, (_, i) => m[i % 4][4 + Math.floor(i / 4)])); }
export function transform(m, p, w = 1) { return [0, 1, 2, 3].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * w); }
export function unproject(m, p) { const q = transform(m, p); return q.slice(0, 3).map(v => v / q[3]); }
export function composeTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) { let [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z; return new Float32Array([(1 - y * y2 - z * z2) * s[0], (x * y2 + w * z2) * s[0], (x * z2 - w * y2) * s[0], 0, (x * y2 - w * z2) * s[1], (1 - x * x2 - z * z2) * s[1], (y * z2 + w * x2) * s[1], 0, (x * z2 + w * y2) * s[2], (y * z2 - w * x2) * s[2], (1 - x * x2 - y * y2) * s[2], 0, ...t, 1]); }
export function rayTriangle(origin, dir, a, b, c) { const e1 = sub(b, a), e2 = sub(c, a), p = cross(dir, e2), det = dot(e1, p); if (Math.abs(det) < 1e-9)
    return null; const inv = 1 / det, tv = sub(origin, a), u = dot(tv, p) * inv; if (u < 0 || u > 1)
    return null; const q = cross(tv, e1), v = dot(dir, q) * inv; if (v < 0 || u + v > 1)
    return null; const t = dot(e2, q) * inv; return t > 1e-5 ? { t, u, v } : null; }
export function rayBox(o, d, min, max, best = Infinity) { let lo = 0, hi = best; for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
        if (o[a] < min[a] || o[a] > max[a])
            return false;
        continue;
    }
    let t0 = (min[a] - o[a]) / d[a], t1 = (max[a] - o[a]) / d[a];
    if (t0 > t1)
        [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    if (hi < lo)
        return false;
} return true; }
export function hexRGB(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); }
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export class OrbitCamera {
    constructor() { this.target = [0, 0, 0]; this.yaw = .58; this.pitch = .28; this.distance = 6.8; this.fov = .62; this.ortho = false; }
    get eye() { const c = Math.cos(this.pitch); return add(this.target, [Math.sin(this.yaw) * c * this.distance, Math.sin(this.pitch) * this.distance, Math.cos(this.yaw) * c * this.distance]); }
    matrix(aspect) { let h = this.distance * .34; return multiply(this.ortho ? orthographic(-h * aspect, h * aspect, -h, h) : perspective(this.fov, aspect), lookAt(this.eye, this.target)); }
    ray(x, y, aspect) { let m = inverse(this.matrix(aspect)), a = unproject(m, [x, y, 0]), b = unproject(m, [x, y, 1]); return { origin: a, direction: normalize(sub(b, a)) }; }
    orbit(dx, dy) { this.yaw -= dx * .008; this.pitch = clamp(this.pitch + dy * .008, -1.5, 1.5); }
    zoom(delta) { this.distance = clamp(this.distance * Math.exp(delta * .001), .3, 100); }
    pan(dx, dy) { const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)], up = cross(normalize(sub(this.eye, this.target)), right); this.target = add(this.target, add(scale(right, -dx * this.distance * .0015), scale(up, dy * this.distance * .0015))); }
    frame() { this.target = [0, 0, 0]; this.distance = 6.8; }
}

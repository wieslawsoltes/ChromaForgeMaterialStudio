import { transform, clamp } from '../../core/src/math.js';
/** Compatibility rasterizer for environments without GPU contexts.
 * Perspective-correct UVs, a depth buffer and interpolated normals; reduced resolution
 * and simplified PBR lighting. This is deliberately NOT advertised as the GPU backend.
 */
export class SoftwareRasterizer {
    constructor(canvas, { maxWidth = 840 } = {}) { this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); if (!this.ctx)
        throw Error('No supported rendering context is available'); this.surface = document.createElement('canvas'); this.context = this.surface.getContext('2d', { alpha: false, willReadFrequently: true }); this.textures = new Map(); this.maxWidth = maxWidth; }
    upload(index, output) { const read = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data; this.textures.set(index, { size: output.color.width, color: read(output.color), orm: read(output.orm), emissive: read(output.emissive) }); }
    draw(mesh, camera, settings, visible) {
        const ratio = Math.min(1, this.maxWidth / this.canvas.width), w = Math.max(1, Math.round(this.canvas.width * ratio)), h = Math.max(1, Math.round(this.canvas.height * ratio));
        if (this.surface.width !== w || this.surface.height !== h) {
            this.surface.width = w;
            this.surface.height = h;
            this.z = new Float32Array(w * h);
        }
        const ctx = this.context, vp = camera.matrix(w / h), eye = camera.eye;
        const project = (x, y, z) => { const q = transform(vp, [x, y, z, 1]); return [(q[0] / q[3] * .5 + .5) * w, (.5 - q[1] / q[3] * .5) * h, q[2] / q[3], 1 / q[3]]; };
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#30333a');
        bg.addColorStop(1, '#1b1d21');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        if (settings.floor) {
            ctx.strokeStyle = '#353941';
            ctx.lineWidth = .55;
            ctx.beginPath();
            for (let i = -12; i <= 12; i++) {
                for (const points of [[[i, -1.12, -12], [i, -1.12, 12]], [[-12, -1.12, i], [12, -1.12, i]]]) {
                    const a = project(...points[0]), b = project(...points[1]);
                    if (a[3] > 0 && b[3] > 0) {
                        ctx.moveTo(a[0], a[1]);
                        ctx.lineTo(b[0], b[1]);
                    }
                }
            }
            ctx.stroke();
            const c = project(0, -1.13, 0), p = project(1.8, -1.13, 0);
            const r = Math.max(3, Math.abs(p[0] - c[0]));
            ctx.save();
            ctx.translate(c[0], c[1]);
            ctx.scale(1, .32);
            const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
            shadow.addColorStop(0, '#00000088');
            shadow.addColorStop(1, '#00000000');
            ctx.fillStyle = shadow;
            ctx.fillRect(-r, -r, 2 * r, 2 * r);
            ctx.restore();
        }
        const image = ctx.getImageData(0, 0, w, h), dst = image.data, zbuf = this.z;
        zbuf.fill(Infinity);
        const src = mesh.vertices, n = src.length / 9, pv = new Float32Array(n * 4);
        for (let i = 0; i < n; i++)
            pv.set(project(src[i * 9], src[i * 9 + 1], src[i * 9 + 2]), i * 4);
        const ra = settings.rotation, cr = Math.cos(ra), sr = Math.sin(ra), normalize = a => { const s = 1 / Math.hypot(...a); return a.map(v => v * s); };
        const rot = a => [a[0] * cr + a[2] * sr, a[1], -a[0] * sr + a[2] * cr], l1 = rot(normalize([-.6, 1.2, 1.4])), l2 = rot(normalize([1.3, .45, -.8]));
        const light = (nx, ny, nz, vx, vy, vz, l, rough, metal, r, g, b) => {
            const hx = vx + l[0], hy = vy + l[1], hz = vz + l[2], hl = 1 / Math.hypot(hx, hy, hz), nh = Math.max(0, (nx * hx + ny * hy + nz * hz) * hl), nl = Math.max(0, nx * l[0] + ny * l[1] + nz * l[2]), nv = Math.max(.001, nx * vx + ny * vy + nz * vz), hv = Math.max(0, (vx * hx + vy * hy + vz * hz) * hl), a = Math.max(.002, rough * rough), a2 = a * a, den = nh * nh * (a2 - 1) + 1, D = a2 / (Math.PI * den * den), k = (rough + 1) ** 2 / 8, G = nv / (nv * (1 - k) + k) * nl / (nl * (1 - k) + k), spec = D * G / Math.max(.001, 4 * nl * nv), f = (1 - hv) ** 5;
            const shade = base => { const f0 = .04 * (1 - metal) + base * metal, F = f0 + (1 - f0) * f; return ((1 - F) * (1 - metal) * base / Math.PI + spec * F) * nl; };
            return [shade(r), shade(g), shade(b)];
        };
        const tm = x => Math.pow(clamp(x * (2.51 * x + .03) / (x * (2.43 * x + .59) + .14), 0, 1), 1 / 2.2) * 255;
        for (let i = 0; i < n; i += 3) {
            const s = i * 9, p = i * 4, material = src[s + 8] | 0, t = this.textures.get(material);
            if (!t || visible[material] < .5)
                continue;
            const ax = pv[p], ay = pv[p + 1], az = pv[p + 2], ai = pv[p + 3], bx = pv[p + 4], by = pv[p + 5], bz = pv[p + 6], bi = pv[p + 7], cx = pv[p + 8], cy = pv[p + 9], cz = pv[p + 10], ci = pv[p + 11];
            if (ai <= 0 || bi <= 0 || ci <= 0 || Math.min(az, bz, cz) < 0)
                continue;
            const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
            if (Math.abs(den) < .005)
                continue;
            const inv = 1 / den, minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx))), minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
            for (let y = minY; y <= maxY; y++)
                for (let x = minX; x <= maxX; x++) {
                    const a = ((by - cy) * (x + .5 - cx) + (cx - bx) * (y + .5 - cy)) * inv, b = ((cy - ay) * (x + .5 - cx) + (ax - cx) * (y + .5 - cy)) * inv, c = 1 - a - b;
                    if (a < 0 || b < 0 || c < 0)
                        continue;
                    const ix = y * w + x, z = a * az + b * bz + c * cz;
                    if (z >= zbuf[ix])
                        continue;
                    const k = 1 / (a * ai + b * bi + c * ci), A = a * ai * k, B = b * bi * k, C = c * ci * k, u = A * src[s + 6] + B * src[s + 15] + C * src[s + 24], v = A * src[s + 7] + B * src[s + 16] + C * src[s + 25], tx = Math.min(t.size - 1, Math.floor(((u % 1 + 1) % 1) * t.size)), ty = Math.min(t.size - 1, Math.floor(((1 - v) % 1 + 1) % 1 * t.size)), q = (ty * t.size + tx) * 4;
                    if (t.color[q + 3] < 13)
                        continue;
                    zbuf[ix] = z;
                    let nx = A * src[s + 3] + B * src[s + 12] + C * src[s + 21], ny = A * src[s + 4] + B * src[s + 13] + C * src[s + 22], nz = A * src[s + 5] + B * src[s + 14] + C * src[s + 23], nl = 1 / Math.hypot(nx, ny, nz);
                    nx *= nl;
                    ny *= nl;
                    nz *= nl;
                    let vx = eye[0] - (A * src[s] + B * src[s + 9] + C * src[s + 18]), vy = eye[1] - (A * src[s + 1] + B * src[s + 10] + C * src[s + 19]), vz = eye[2] - (A * src[s + 2] + B * src[s + 11] + C * src[s + 20]), vl = 1 / Math.hypot(vx, vy, vz);
                    vx *= vl;
                    vy *= vl;
                    vz *= vl;
                    let nv = nx * vx + ny * vy + nz * vz;
                    if (nv < 0) {
                        nx = -nx;
                        ny = -ny;
                        nz = -nz;
                        nv = -nv;
                    }
                    let r = t.color[q], g = t.color[q + 1], bcol = t.color[q + 2];
                    const rough = Math.max(.04, t.orm[q + 1] / 255), metal = t.orm[q + 2] / 255, mode = settings.channel;
                    if (mode === 2)
                        r = g = bcol = t.orm[q + 1];
                    else if (mode === 3)
                        r = g = bcol = t.orm[q + 2];
                    else if (mode === 4) {
                        r = (nx * .5 + .5) * 255;
                        g = (ny * .5 + .5) * 255;
                        bcol = (nz * .5 + .5) * 255;
                    }
                    else if (mode === 5)
                        r = g = bcol = t.orm[q + 3];
                    else if (mode === 6) {
                        r = t.emissive[q];
                        g = t.emissive[q + 1];
                        bcol = t.emissive[q + 2];
                    }
                    else if (mode === 7)
                        r = g = bcol = ((Math.floor(u * 16) + Math.floor(v * 16)) % 2) ? 180 : 46;
                    else if (mode === 0) {
                        r = (r / 255) ** 2.2;
                        g = (g / 255) ** 2.2;
                        bcol = (bcol / 255) ** 2.2;
                        const a = light(nx, ny, nz, vx, vy, vz, l1, rough, metal, r, g, bcol), b = light(nx, ny, nz, vx, vy, vz, l2, rough, metal, r, g, bcol);
                        const rx = 2 * nv * nx - vx, ry = 2 * nv * ny - vy, rz = 2 * nv * nz - vz, shine = Math.pow(Math.max(0, rx * l1[0] + ry * l1[1] + rz * l1[2]), Math.max(3, 180 * (1 - rough * rough))), e = .12 + .34 * (ry * .5 + .5) + shine * 3.8, f = (1 - nv) ** 5, ambient = .19 + Math.max(ny, 0) * .22, ex = settings.exposure;
                        const shade = (base, direct, emit, tint) => { const f0 = .04 * (1 - metal) + base * metal; return tm((base * (1 - metal) * ambient + e * (f0 + (1 - f0) * f) * (1 - rough * .45) * tint + direct + emit / 255 * 2) * ex); };
                        const tint = settings.environment === 1 ? [1.15, .88, .67] : settings.environment === 2 ? [.35, .52, .85] : [1, 1, 1];
                        r = shade(r, a[0] * 2.9 + b[0] * 1.4, t.emissive[q], tint[0]);
                        g = shade(g, a[1] * 2.65 + b[1] * 1.8, t.emissive[q + 1], tint[1]);
                        bcol = shade(bcol, a[2] * 2.4 + b[2] * 2.4, t.emissive[q + 2], tint[2]);
                    }
                    if (settings.wireframe && Math.min(a, b, c) < .018) {
                        r *= .35;
                        g *= .35;
                        bcol *= .35;
                    }
                    const o = ix * 4;
                    dst[o] = r;
                    dst[o + 1] = g;
                    dst[o + 2] = bcol;
                    dst[o + 3] = 255;
                }
        }
        ctx.putImageData(image, 0, 0);
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.drawImage(this.surface, 0, 0, this.canvas.width, this.canvas.height);
    }
    dispose() { this.textures.clear(); this.z = null; this.surface.width = this.surface.height = 1; }
}

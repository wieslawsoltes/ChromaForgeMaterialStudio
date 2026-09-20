import { CHANNELS } from '../../core/src/document.js';
import { clamp, hexRGB } from '../../core/src/math.js';
import { sampleMaterial, hash } from './materials.js';
export const makeCanvas = (width, height = width) => { let c = typeof document === 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas'); c.width = width; c.height = height; return c; };
const context = c => c.getContext('2d', { willReadFrequently: true });
const scalar = v => { let k = Math.round(clamp(v) * 255); return `rgb(${k},${k},${k})`; };
const defaultColor = { baseColor: '#888888', roughness: '#808080', metallic: '#000000', height: '#808080', emissive: '#000000', opacity: '#ffffff' };
const blendName = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', add: 'lighter', difference: 'difference' };
/** Raster painting core. Normalized UV strokes are replayable at any supported resolution. */
export function stampStroke(canvas, stroke, channel, mask = false) {
    const ctx = context(canvas), size = canvas.width, b = stroke.brush;
    if (!mask && !(b.channels ?? ['baseColor']).includes(channel))
        return;
    if ((stroke.target === 'mask') !== mask)
        return;
    ctx.save();
    ctx.globalCompositeOperation = b.erase && !mask ? 'destination-out' : 'source-over';
    const color = mask ? scalar(b.erase ? 0 : 1) : channel === 'baseColor' ? b.color : channel === 'emissive' ? scalar((b.emissive ?? 0) / 2) : channel === 'opacity' ? scalar(b.opacity ?? 1) : scalar(b[channel] ?? .5);
    let serial = 0;
    function stamp(u, v, p = 1) {
        const pressure = b.pressure === false ? 1 : Math.max(.08, p), radius = Math.max(.5, b.size * size * .5 * pressure), scatter = b.scatter ?? 0, angle = (b.angle ?? 0) * Math.PI / 180;
        const i = serial++, sx = (hash(i, 1, b.seed ?? 1) - .5) * radius * scatter * 2, sy = (hash(i, 2, b.seed ?? 1) - .5) * radius * scatter * 2;
        const paint = (x, y) => {
            ctx.save();
            ctx.translate(x + sx, y + sy);
            ctx.rotate(angle);
            ctx.globalAlpha = clamp((b.flow ?? 1) * (b.pressure === false ? 1 : pressure));
            ctx.fillStyle = color;
            const shape = b.shape ?? 'round';
            if (shape === 'round') {
                const hard = clamp(b.hardness ?? .75, 0, .999), grad = ctx.createRadialGradient(0, 0, radius * hard, 0, 0, radius);
                grad.addColorStop(0, color);
                grad.addColorStop(1, 'transparent');
                ctx.fillStyle = grad;
                ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
            }
            else if (shape === 'square')
                ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
            else if (shape === 'ring') {
                ctx.strokeStyle = color;
                ctx.lineWidth = radius * .2;
                ctx.beginPath();
                ctx.arc(0, 0, radius * .85, 0, Math.PI * 2);
                ctx.stroke();
            }
            else if (shape === 'star') {
                ctx.beginPath();
                for (let j = 0; j < 10; j++) {
                    const a = j * Math.PI / 5 - Math.PI / 2, r = j % 2 ? radius * .4 : radius;
                    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                }
                ctx.closePath();
                ctx.fill();
            }
            else {
                let count = shape === 'scratch' ? 9 : shape === 'spray' ? 32 : 80;
                for (let j = 0; j < count; j++) {
                    let dx = hash(i * 97 + j, 5, b.seed ?? 1) * 2 - 1, dy = hash(i * 97 + j, 9, b.seed ?? 1) * 2 - 1;
                    if (dx * dx + dy * dy > 1)
                        continue;
                    ctx.globalAlpha = (b.flow ?? 1) * (shape === 'spray' ? .45 : .7);
                    if (shape === 'scratch')
                        ctx.fillRect(dx * radius, dy * radius, radius * .018, radius * .8);
                    else
                        ctx.fillRect(dx * radius, dy * radius, Math.max(1, radius * .09), Math.max(1, radius * .09));
                }
            }
            ctx.restore();
        };
        const x = u * size, y = (1 - v) * size;
        paint(x, y);
        if (b.wrap) {
            if (x < radius)
                paint(x + size, y);
            if (x > size - radius)
                paint(x - size, y);
            if (y < radius)
                paint(x, y + size);
            if (y > size - radius)
                paint(x, y - size);
        }
        if (b.symmetry)
            paint((1 - u) * size, y);
    }
    let prev = null;
    for (const point of stroke.points) {
        const [u, v, p = 1, brk = 0] = point;
        if (prev && !brk) {
            let d = Math.hypot(u - prev[0], v - prev[1]), step = Math.max(.0001, b.size * (b.spacing ?? .15) * .5);
            if (d < .25) {
                let n = Math.min(500, Math.ceil(d / step));
                for (let j = 1; j <= n; j++) {
                    let t = j / n;
                    stamp(prev[0] + (u - prev[0]) * t, prev[1] + (v - prev[1]) * t, prev[2] + (p - prev[2]) * t);
                }
            }
            else
                stamp(u, v, p);
        }
        else
            stamp(u, v, p);
        prev = [u, v, p];
    }
    ctx.restore();
}
export class TextureCompositor {
    constructor(size = 1024) { this.size = size; this.cache = new Map(); this.outputs = new Map(); this.images = new Map(); this.stats = { layers: 0, milliseconds: 0 }; }
    resize(size) { if (size !== this.size) {
        this.size = size;
        this.dispose(true);
    } }
    dispose(keepImages = false) { this.cache.clear(); this.outputs.clear(); if (!keepImages)
        this.images.clear(); }
    async loadImage(url) { if (!url)
        return null; if (this.images.has(url))
        return this.images.get(url); const image = new Image(); if (/^https?:/.test(url))
        image.crossOrigin = 'anonymous'; image.src = url; await image.decode(); if (image.width * image.height > 16777216)
        throw Error('Decal image exceeds the 16-megapixel decoded size limit'); this.images.set(url, image); return image; }
    renderLayer(layer) {
        const { strokes, ...props } = layer, key = JSON.stringify(props), prev = this.cache.get(layer.id);
        let entry = prev;
        if (!entry || entry.key !== key || entry.strokeCount > strokes.length || entry.strokeIds !== strokes.slice(0, entry.strokeCount).map(s => s.id).join(',')) {
            entry = { key, maps: {}, strokeCount: 0, strokeIds: '', mask: null };
            if (layer.type === 'paint') {
                for (const ch of layer.channels ?? CHANNELS)
                    entry.maps[ch] = makeCanvas(this.size);
            }
            else if (layer.type === 'decal') {
                const c = makeCanvas(this.size), ctx = context(c), image = this.images.get(layer.image);
                if (image) {
                    const t = layer.transform ?? { u: .5, v: .5, scale: .3, angle: 0 };
                    ctx.save();
                    ctx.translate(t.u * this.size, (1 - t.v) * this.size);
                    ctx.rotate((t.angle ?? 0) * Math.PI / 180);
                    ctx.drawImage(image, -t.scale * this.size / 2, -t.scale * this.size / 2, t.scale * this.size, t.scale * this.size);
                    ctx.restore();
                }
                entry.maps.baseColor = c;
            }
            else {
                const chans = layer.channels ?? CHANNELS, ims = {};
                for (const ch of chans) {
                    entry.maps[ch] = makeCanvas(this.size);
                    ims[ch] = context(entry.maps[ch]).createImageData(this.size, this.size);
                }
                const l = { ...layer, rgb: hexRGB(layer.color ?? '#808080') };
                for (let y = 0; y < this.size; y++)
                    for (let x = 0; x < this.size; x++) {
                        const m = sampleMaterial(l, x / this.size, 1 - y / this.size), o = (y * this.size + x) * 4;
                        for (const ch of chans) {
                            const d = ims[ch].data, c = ch === 'baseColor' ? m.color : ch === 'emissive' ? m.color.map(c => c * clamp(m.emissive / 2)) : ch === 'opacity' ? [1, 1, 1] : [m[ch], m[ch], m[ch]];
                            d[o] = c[0] * 255;
                            d[o + 1] = c[1] * 255;
                            d[o + 2] = c[2] * 255;
                            d[o + 3] = m.opacity * 255;
                        }
                    }
                for (const ch of chans)
                    context(entry.maps[ch]).putImageData(ims[ch], 0, 0);
            }
            if (layer.mask) {
                entry.mask = makeCanvas(this.size);
                const mc = context(entry.mask);
                mc.fillStyle = layer.mask.base === 'black' ? '#000' : '#fff';
                mc.fillRect(0, 0, this.size, this.size);
            }
            this.cache.set(layer.id, entry);
        }
        for (let i = entry.strokeCount; i < strokes.length; i++) {
            let s = strokes[i];
            if (s.target === 'mask') {
                if (entry.mask)
                    stampStroke(entry.mask, s, 'baseColor', true);
            }
            else
                for (const ch of s.brush.channels ?? ['baseColor']) {
                    if (!entry.maps[ch])
                        entry.maps[ch] = makeCanvas(this.size);
                    stampStroke(entry.maps[ch], s, ch);
                }
        }
        entry.strokeCount = strokes.length;
        entry.strokeIds = strokes.map(s => s.id).join(',');
        return entry;
    }
    compose(set, preview = null) {
        const start = performance.now(), n = this.size;
        let output = this.outputs.get(set.id);
        if (!output) {
            const maps = {};
            for (const ch of CHANNELS)
                maps[ch] = makeCanvas(n);
            output = { maps, color: maps.baseColor, orm: makeCanvas(n), emissive: maps.emissive, version: 0 };
            this.outputs.set(set.id, output);
        }
        const ctxs = {};
        for (const ch of CHANNELS) {
            ctxs[ch] = context(output.maps[ch]);
            ctxs[ch].globalCompositeOperation = 'source-over';
            ctxs[ch].globalAlpha = 1;
            ctxs[ch].fillStyle = defaultColor[ch];
            ctxs[ch].fillRect(0, 0, n, n);
        }
        for (const l of set.layers) {
            if (!l.visible || l.opacity <= 0)
                continue;
            const e = this.renderLayer(l);
            let maskData = null;
            if (e.mask) {
                maskData = context(e.mask).getImageData(0, 0, n, n).data;
            }
            for (const ch of Object.keys(e.maps)) {
                if (!(l.channels ?? CHANNELS).includes(ch) && l.type !== 'decal')
                    continue;
                let source = e.maps[ch];
                if (preview && preview.layerId === l.id && preview.stroke.target !== 'mask') {
                    source = makeCanvas(n);
                    context(source).drawImage(e.maps[ch], 0, 0);
                    stampStroke(source, preview.stroke, ch);
                }
                if (maskData || preview?.layerId === l.id && preview.stroke.target === 'mask') {
                    let md = maskData;
                    if (preview?.layerId === l.id && preview.stroke.target === 'mask' && e.mask) {
                        const tmp = makeCanvas(n);
                        context(tmp).drawImage(e.mask, 0, 0);
                        stampStroke(tmp, preview.stroke, 'baseColor', true);
                        md = context(tmp).getImageData(0, 0, n, n).data;
                    }
                    if (md) {
                        const temp = makeCanvas(n), tc = context(temp);
                        tc.drawImage(source, 0, 0);
                        const im = tc.getImageData(0, 0, n, n);
                        for (let i = 0; i < im.data.length; i += 4)
                            im.data[i + 3] *= (l.mask?.invert ? 255 - md[i] : md[i]) / 255;
                        tc.putImageData(im, 0, 0);
                        source = temp;
                    }
                }
                const c = ctxs[ch];
                c.globalAlpha = clamp(l.opacity);
                c.globalCompositeOperation = blendName[l.blend] ?? 'source-over';
                c.drawImage(source, 0, 0);
            }
        }
        const rough = ctxs.roughness.getImageData(0, 0, n, n).data, metal = ctxs.metallic.getImageData(0, 0, n, n).data, height = ctxs.height.getImageData(0, 0, n, n).data, opacity = ctxs.opacity.getImageData(0, 0, n, n).data, orm = context(output.orm).createImageData(n, n), color = ctxs.baseColor.getImageData(0, 0, n, n);
        for (let i = 0; i < orm.data.length; i += 4) {
            orm.data[i] = 255;
            orm.data[i + 1] = rough[i];
            orm.data[i + 2] = metal[i];
            orm.data[i + 3] = height[i];
            color.data[i + 3] = opacity[i];
        }
        context(output.orm).putImageData(orm, 0, 0);
        ctxs.baseColor.putImageData(color, 0, 0);
        output.version++;
        this.stats = { layers: set.layers.length, milliseconds: performance.now() - start };
        return output;
    }
    normalMap(setId, strength = 4) { const out = this.outputs.get(setId); if (!out)
        throw Error('Texture set is not composited'); const n = this.size, data = context(out.maps.height).getImageData(0, 0, n, n).data, c = makeCanvas(n), im = context(c).createImageData(n, n); for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            const sample = (a, b) => data[((b + n) % n * n + (a + n) % n) * 4] / 255, dx = (sample(x - 1, y) - sample(x + 1, y)) * strength, dy = (sample(x, y + 1) - sample(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
            im.data.set([(dx / l * .5 + .5) * 255, (dy / l * .5 + .5) * 255, (1 / l * .5 + .5) * 255, 255], i);
        } context(c).putImageData(im, 0, 0); return c; }
    async export(setId, channel) { const out = this.outputs.get(setId); if (!out)
        throw Error('Texture set not found'); const c = channel === 'normal' ? this.normalMap(setId) : channel === 'orm' ? out.orm : out.maps[channel]; if (!c)
        throw Error(`Unknown channel ${channel}`); return new Promise(r => c.toBlob(r, 'image/png')); }
}

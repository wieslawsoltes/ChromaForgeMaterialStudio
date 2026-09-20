import { clamp, lerp, hexRGB } from '../../core/src/math.js';
export const MATERIALS = [
    { id: 'alloy', name: 'Coated alloy', category: 'Metals', color: '#c88135', roughness: .43, metallic: .48, pattern: 'painted' },
    { id: 'steel', name: 'Brushed steel', category: 'Metals', color: '#a1adb6', roughness: .28, metallic: 1, pattern: 'brushed' },
    { id: 'darksteel', name: 'Black titanium', category: 'Metals', color: '#323f4c', roughness: .31, metallic: .95, pattern: 'brushed' },
    { id: 'copper', name: 'Aged copper', category: 'Metals', color: '#b16f49', roughness: .32, metallic: .96, pattern: 'copper' },
    { id: 'gold', name: 'Satin gold', category: 'Metals', color: '#d5ae57', roughness: .26, metallic: 1, pattern: 'brushed' },
    { id: 'rust', name: 'Oxidized iron', category: 'Metals', color: '#9b542e', roughness: .78, metallic: .4, pattern: 'rust' },
    { id: 'carbon', name: 'Carbon weave', category: 'Fabric', color: '#25313a', roughness: .28, metallic: .6, pattern: 'carbon' },
    { id: 'rubber', name: 'Industrial rubber', category: 'Plastic', color: '#20262a', roughness: .79, metallic: 0, pattern: 'noise' },
    { id: 'ceramic', name: 'Ivory ceramic', category: 'Plastic', color: '#d5cfbb', roughness: .2, metallic: .02, pattern: 'solid' },
    { id: 'teal', name: 'Ocean enamel', category: 'Plastic', color: '#407e82', roughness: .23, metallic: .2, pattern: 'painted' },
    { id: 'red', name: 'Signal red', category: 'Plastic', color: '#a7352b', roughness: .35, metallic: .25, pattern: 'painted' },
    { id: 'violet', name: 'Violet anodized', category: 'Metals', color: '#726887', roughness: .24, metallic: .94, pattern: 'brushed' },
    { id: 'leather', name: 'Full-grain leather', category: 'Fabric', color: '#57372a', roughness: .64, metallic: 0, pattern: 'leather' },
    { id: 'fabric', name: 'Woven canvas', category: 'Fabric', color: '#b7a780', roughness: .88, metallic: 0, pattern: 'fabric' },
    { id: 'wood', name: 'Smoked walnut', category: 'Organic', color: '#704931', roughness: .48, metallic: 0, pattern: 'wood' },
    { id: 'marble', name: 'Carrara marble', category: 'Organic', color: '#c9cdca', roughness: .24, metallic: 0, pattern: 'marble' },
    { id: 'concrete', name: 'Cast concrete', category: 'Organic', color: '#8b8c87', roughness: .9, metallic: 0, pattern: 'concrete' },
    { id: 'moss', name: 'Forest camouflage', category: 'Organic', color: '#647051', roughness: .72, metallic: 0, pattern: 'camouflage' },
    { id: 'hex', name: 'Hex composite', category: 'Fabric', color: '#414c57', roughness: .43, metallic: .45, pattern: 'hex' },
    { id: 'glow', name: 'Cyan emission', category: 'Utility', color: '#4ba7b8', roughness: .2, metallic: .1, emissive: 1.5, pattern: 'solid' },
    { id: 'wear', name: 'Edge abrasion', category: 'Generators', color: '#a9b1b2', roughness: .35, metallic: .9, pattern: 'wear' },
    { id: 'dust', name: 'Settled dust', category: 'Generators', color: '#b5a587', roughness: .96, metallic: 0, pattern: 'dust' },
    { id: 'grid', name: 'UV checker', category: 'Utility', color: '#9aa6b0', roughness: .8, metallic: 0, pattern: 'checker' },
    { id: 'stripes', name: 'Safety stripes', category: 'Utility', color: '#e0ab3d', roughness: .5, metallic: .15, pattern: 'stripes' }
];
export const BRUSHES = [
    { id: 'soft', name: 'Soft round', shape: 'round', hardness: .18, flow: .75, spacing: .18 },
    { id: 'hard', name: 'Hard round', shape: 'round', hardness: .95, flow: 1, spacing: .12 },
    { id: 'chalk', name: 'Dry chalk', shape: 'noise', hardness: .7, flow: .65, spacing: .16 },
    { id: 'spray', name: 'Fine spray', shape: 'spray', hardness: .2, flow: .8, spacing: .24, scatter: .3 },
    { id: 'square', name: 'Square tip', shape: 'square', hardness: 1, flow: 1, spacing: .1 },
    { id: 'scratch', name: 'Scratches', shape: 'scratch', hardness: .8, flow: .7, spacing: .15 },
    { id: 'star', name: 'Star stamp', shape: 'star', hardness: 1, flow: 1, spacing: 1.2 },
    { id: 'ring', name: 'Ring stamp', shape: 'ring', hardness: .8, flow: 1, spacing: 1.2 }
];
export function hash(x, y, seed = 1) { let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; }
export function noise(x, y, s = 1) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, a = fx * fx * (3 - 2 * fx), b = fy * fy * (3 - 2 * fy); return lerp(lerp(hash(ix, iy, s), hash(ix + 1, iy, s), a), lerp(hash(ix, iy + 1, s), hash(ix + 1, iy + 1, s), a), b); }
export function fbm(x, y, s = 1) { return noise(x, y, s) * .57 + noise(x * 2, y * 2, s + 5) * .28 + noise(x * 4, y * 4, s + 9) * .15; }
export function sampleMaterial(layer, u, v) {
    const scale = layer.scale ?? 6, s = layer.seed ?? 17, x = u * scale, y = v * scale, n = noise(x * 15, y * 15, s), f = fbm(x, y, s);
    let mod = 1, rough = layer.roughness ?? .5, metal = layer.metallic ?? 0, h = .5, alpha = 1, color = layer.rgb ?? hexRGB(layer.color ?? '#808080');
    switch (layer.pattern) {
        case 'painted':
            mod = .91 + n * .12;
            h = .47 + n * .07;
            rough += n * .08;
            break;
        case 'noise':
            mod = .88 + n * .18;
            h = .45 + n * .1;
            break;
        case 'brushed': {
            let t = noise(x * 3, y * 160, s);
            mod = .7 + t * .32;
            rough += t * .14;
            h = .48 + t * .04;
            break;
        }
        case 'rust': {
            let t = fbm(x * 3, y * 3, s);
            mod = .35 + t * 1.1;
            rough = .66 + t * .3;
            metal = t > .58 ? .55 : .1;
            h = .25 + t * .4;
            color = [color[0], color[1] * (.65 + t * .6), color[2] * (.6 + t * .5)];
            break;
        }
        case 'copper':
            if (f > .57) {
                color = [.22, .45, .39];
                rough = .76;
                metal = .3;
            }
            mod = .76 + n * .24;
            h = f * .25 + .4;
            break;
        case 'carbon': {
            let cx = Math.floor(x * 7), cy = Math.floor(y * 7), t = (cx + cy) % 2 === 0 ? Math.sin(x * 170) : Math.sin(y * 170);
            mod = .6 + t * .16 + n * .2;
            h = .5 + t * .08;
            rough += t * .07;
            break;
        }
        case 'fabric': {
            let t = Math.sin(x * 170) * Math.sin(y * 170);
            mod = .73 + t * .17 + n * .17;
            h = .48 + t * .12;
            break;
        }
        case 'leather': {
            let t = Math.pow(noise(x * 21, y * 21, s), 3);
            mod = .65 + t * .65;
            h = .48 + t * .12;
            rough += t * .1;
            break;
        }
        case 'wood': {
            let t = Math.sin(x * 6 + fbm(x * 2, y * .2, s) * 14) * .5 + .5;
            mod = .42 + t * .57 + n * .1;
            h = .47 + t * .08;
            rough += t * .15;
            break;
        }
        case 'marble': {
            let t = Math.pow(Math.abs(Math.sin(x * 2.7 + y + f * 8)), .12);
            mod = .2 + t * .8;
            h = .5;
            break;
        }
        case 'concrete':
            mod = .63 + f * .33 + n * .18;
            h = .4 + f * .1 + n * .15;
            break;
        case 'camouflage': {
            let t = fbm(x * 2, y * 2, s);
            mod = t > .6 ? .47 : t > .5 ? 1.12 : t > .4 ? .83 : .32;
            h = .5;
            break;
        }
        case 'hex': {
            let cx = x * 5, cy = y * 5, rx = cx % 1, ry = (cy + (Math.floor(cx) % 2) * .5) % 1;
            let e = Math.abs(rx - .5) * 1.7 + Math.abs(ry - .5);
            mod = e > .71 ? .4 : .92;
            h = e > .71 ? .4 : .55;
            break;
        }
        case 'checker':
            mod = (Math.floor(x * 2) + Math.floor(y * 2)) % 2 ? .35 : 1.1;
            break;
        case 'stripes':
            mod = ((u + v) * scale * 2) % 1 > .52 ? .09 : 1;
            break;
        case 'wear': {
            const edge = Math.min(u % (.333333), .333333 - u % (.333333), v % .5, .5 - v % .5);
            alpha = clamp((.009 + noise(x * 8, y * 8, s) * .018 - edge) * 80);
            mod = .8 + n * .2;
            h = .45;
            break;
        }
        case 'dust':
            alpha = clamp((f - .44) * 3) * (.1 + (1 - v) * .6);
            mod = .9 + n * .1;
            break;
    }
    return { color: color.map(c => clamp(c * mod)), roughness: clamp(rough, .03, 1), metallic: clamp(metal), height: clamp(h + (layer.height ?? .5) - .5), emissive: layer.emissive ?? 0, opacity: alpha };
}
export function materialThumbnail(material, size = 88) { const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d'), im = ctx.createImageData(size, size), l = { ...material, rgb: hexRGB(material.color), scale: 5 }; for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
        let nx = (x / size - .5) * 2.2, ny = (y / size - .49) * 2.2, r = nx * nx + ny * ny, o = (y * size + x) * 4;
        if (r > 1) {
            im.data[o] = im.data[o + 1] = im.data[o + 2] = 37;
            im.data[o + 3] = 255;
            continue;
        }
        let z = Math.sqrt(1 - r), u = Math.atan2(nx, z) / (Math.PI * 2) + .5, v = Math.asin(ny) / Math.PI + .5, m = sampleMaterial(l, u, v), d = Math.max(0, nx * -.42 + ny * -.66 + z * .63), spec = Math.pow(Math.max(0, nx * -.25 + ny * -.4 + z * .86), 8 + (1 - m.roughness) * 120) * (m.metallic * .8 + .12);
        for (let k = 0; k < 3; k++)
            im.data[o + k] = clamp(m.color[k] * (.24 + d * .85) + spec * (m.metallic ? m.color[k] * 1.2 : 1)) * 255;
        im.data[o + 3] = 255;
    } ctx.putImageData(im, 0, 0); return c.toDataURL(); }

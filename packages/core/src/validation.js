/** Strict validation at file, replica and service boundaries. No executable image formats. */
export const PATTERNS = ['solid', 'painted', 'noise', 'brushed', 'rust', 'copper', 'carbon', 'fabric', 'leather', 'wood', 'marble', 'concrete', 'camouflage', 'hex', 'checker', 'stripes', 'wear', 'dust'];
const channels = ['baseColor', 'roughness', 'metallic', 'height', 'emissive', 'opacity'];
const blends = ['normal', 'multiply', 'screen', 'overlay', 'add', 'difference'];
const shapes = ['round', 'square', 'ring', 'star', 'scratch', 'spray', 'noise'];
export const isRecord = o => o !== null && typeof o === 'object' && !Array.isArray(o);
export function check(condition, message) { if (!condition)
    throw Error(message); }
export const identifier = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export const text = (v, max = 200) => typeof v === 'string' && v.length <= max;
export const hexColor = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const has = (o, k) => Object.hasOwn(o, k);
function channelList(value) { return Array.isArray(value) && value.length <= channels.length && value.every(v => channels.includes(v)) && new Set(value).size === value.length; }
export function validateStroke(stroke) {
    check(isRecord(stroke) && identifier(stroke.id), 'Invalid stroke identifier');
    check(stroke.target === undefined || ['paint', 'mask'].includes(stroke.target), 'Invalid stroke target');
    check(Array.isArray(stroke.points) && stroke.points.length > 0 && stroke.points.length <= 30000, 'Expected 1–30000 stroke points');
    for (const a of stroke.points)
        check(Array.isArray(a) && a.length >= 2 && a.length <= 4 && finite(a[0], -2, 3) && finite(a[1], -2, 3) && (a.length < 3 || finite(a[2], 0, 1)) && (a.length < 4 || [0, 1].includes(a[3])), 'Invalid stroke coordinates');
    const b = stroke.brush;
    check(isRecord(b) && finite(b.size, .0001, 2), 'Invalid brush radius');
    for (const [key, min, max] of [['flow', 0, 1], ['hardness', 0, 1], ['spacing', .01, 2], ['angle', -360, 360], ['scatter', 0, 2], ['seed', -2147483648, 2147483647], ['roughness', 0, 1], ['metallic', 0, 1], ['height', 0, 1], ['opacity', 0, 1], ['emissive', 0, 2]])
        if (has(b, key))
            check(finite(b[key], min, max), `Invalid brush ${key}`);
    if (has(b, 'color'))
        check(hexColor(b.color), 'Invalid brush color');
    if (has(b, 'channels'))
        check(channelList(b.channels), 'Invalid brush channels');
    if (has(b, 'shape'))
        check(shapes.includes(b.shape), 'Invalid brush shape');
    for (const key of ['erase', 'pressure', 'wrap', 'symmetry'])
        if (has(b, key))
            check(typeof b[key] === 'boolean', `Invalid brush ${key}`);
    return stroke;
}
const layerFields = ['name', 'visible', 'opacity', 'blend', 'color', 'roughness', 'metallic', 'height', 'emissive', 'channels', 'pattern', 'scale', 'seed', 'mask', 'image', 'transform'];
export function validateLayer(layer, { partial = false } = {}) {
    check(isRecord(layer), 'Invalid layer');
    if (partial)
        check(Object.keys(layer).every(k => layerFields.includes(k)), 'Unsupported layer property');
    else {
        check(identifier(layer.id) && ['fill', 'paint', 'decal'].includes(layer.type) && text(layer.name), 'Invalid layer identity');
        check(Array.isArray(layer.strokes) && layer.strokes.length <= 20000, 'Invalid layer strokes');
        for (const s of layer.strokes)
            validateStroke(s);
    }
    if (has(layer, 'name'))
        check(text(layer.name), 'Invalid layer name');
    if (has(layer, 'visible'))
        check(typeof layer.visible === 'boolean', 'Invalid layer visibility');
    if (has(layer, 'color'))
        check(hexColor(layer.color), 'Invalid layer color');
    if (has(layer, 'channels'))
        check(channelList(layer.channels), 'Invalid material channels');
    if (has(layer, 'blend'))
        check(blends.includes(layer.blend), 'Invalid blend mode');
    if (has(layer, 'pattern'))
        check(PATTERNS.includes(layer.pattern), 'Invalid material pattern');
    for (const [key, min, max] of [['opacity', 0, 1], ['roughness', 0, 1], ['metallic', 0, 1], ['height', 0, 1], ['emissive', 0, 2], ['scale', .1, 80], ['seed', -2147483648, 2147483647]])
        if (has(layer, key))
            check(finite(layer[key], min, max), `Invalid layer ${key}`);
    if (layer.mask !== undefined && layer.mask !== null)
        check(isRecord(layer.mask) && ['white', 'black'].includes(layer.mask.base) && (layer.mask.invert === undefined || typeof layer.mask.invert === 'boolean'), 'Invalid layer mask');
    if (has(layer, 'image'))
        check(typeof layer.image === 'string' && layer.image.length <= 12 * 1024 * 1024 && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/]+=*$/.test(layer.image), 'Only embedded PNG, JPEG and WebP decal images are accepted');
    if (has(layer, 'transform')) {
        check(isRecord(layer.transform), 'Invalid decal transform');
        for (const [key, min, max] of [['u', -2, 3], ['v', -2, 3], ['scale', .001, 4], ['angle', -360, 360]])
            if (has(layer.transform, key))
                check(finite(layer.transform[key], min, max), `Invalid decal ${key}`);
    }
    return layer;
}
export function validateSettings(s) { check(isRecord(s) && Object.keys(s).every(k => ['environment', 'exposure', 'rotation'].includes(k)), 'Invalid environment settings'); if (has(s, 'environment'))
    check(['studio', 'warm', 'night'].includes(s.environment), 'Invalid environment'); if (has(s, 'exposure'))
    check(finite(s.exposure, .05, 8), 'Invalid exposure'); if (has(s, 'rotation'))
    check(finite(s.rotation, -100, 100), 'Invalid environment rotation'); return s; }
export function validateComment(c) { check(isRecord(c) && identifier(c.id) && text(c.text, 5000) && (!has(c, 'author') || text(c.author)) && (!has(c, 'time') || text(c.time, 50)), 'Invalid comment'); return c; }

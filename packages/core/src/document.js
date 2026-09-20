import { Signal } from './events.js';
import { uid, clamp } from './math.js';
import { isRecord as plain, check, identifier, finite, text, validateLayer, validateStroke, validateSettings, validateComment } from './validation.js';
export const CHANNELS = ['baseColor', 'roughness', 'metallic', 'height', 'emissive', 'opacity'];
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'add', 'difference'];
export const SCHEMA = 1;
export function createLayer(type = 'paint', name = type === 'paint' ? 'Paint layer' : 'Fill layer', values = {}) {
    return { id: uid(), name, type, visible: true, opacity: 1, blend: 'normal', color: '#e19b39', roughness: .4, metallic: 0, height: .5, emissive: 0, channels: [...CHANNELS], pattern: 'solid', scale: 6, seed: 17, mask: null, strokes: [], ...values };
}
export function createProject(model = 'nomad', resolution = 1024) {
    const spec = model === 'nomad' ? [['Shell', '#cd7832', .48, .35], ['Chassis', '#242e34', .56, .65], ['Hardware', '#8b9da6', .23, .92], ['Optics', '#258c91', .14, .65]] : [['Material', '#72989e', .36, .35]];
    return { schema: SCHEMA, id: uid(), name: model === 'nomad' ? 'NOMAD · Field camera' : 'Untitled material study', model, resolution, created: new Date().toISOString(), mesh: null, textureSets: spec.map(([name, color, roughness, metallic], i) => ({ id: `set-${i}`, name, visible: true, layers: [createLayer('fill', name === 'Shell' ? 'Powder-coated alloy' : name === 'Optics' ? 'Optical glass' : 'Base material', { id: `base-${i}`, color, roughness, metallic, pattern: name === 'Shell' ? 'painted' : name === 'Hardware' ? 'brushed' : 'solid', emissive: name === 'Optics' ? .45 : 0 }), ...(i === 0 ? [createLayer('fill', 'Machined edge wear', { id: 'wear', color: '#929b9c', metallic: .88, roughness: .37, pattern: 'wear', opacity: .8 }), createLayer('paint', 'Surface details', { id: 'details' }), createLayer('paint', 'Paint layer 01', { id: 'paint-01', color: '#d8c8a6' })] : [])] })), comments: [], settings: { environment: 'studio', exposure: 1.1, rotation: 0 } };
}
export function validateProject(p) {
    check(plain(p) && p.schema === SCHEMA && identifier(p.id) && text(p.name), 'Invalid ChromaForge project header');
    check(['nomad', 'sphere', 'cube', 'torus', 'imported'].includes(p.model), 'Unknown project model');
    check([256, 512, 1024, 2048, 4096].includes(p.resolution), 'Resolution must be 256, 512, 1024, 2048 or 4096');
    check(Array.isArray(p.textureSets) && p.textureSets.length >= 1 && p.textureSets.length <= 16, 'Expected 1–16 texture sets');
    const ids = new Set(), sets = new Set();
    for (const s of p.textureSets) {
        check(plain(s) && identifier(s.id) && !sets.has(s.id) && text(s.name) && typeof s.visible === 'boolean' && Array.isArray(s.layers) && s.layers.length <= 128, 'Invalid texture set');
        sets.add(s.id);
        for (const l of s.layers) {
            validateLayer(l);
            check(!ids.has(l.id), 'Duplicate layer identifier');
            ids.add(l.id);
        }
    }
    if (p.mesh) {
        const m = p.mesh;
        check(plain(m) && Array.isArray(m.vertices) && m.vertices.length > 0 && m.vertices.length % 27 === 0 && m.vertices.length <= 27 * 1000000 && m.vertices.every(v => finite(v, -1e9, 1e9)), 'Invalid triangle-list mesh vertex buffer');
        check(Array.isArray(m.materials) && m.materials.length === p.textureSets.length && m.materials.every(n => text(n)), 'Invalid mesh material list');
        for (let i = 8; i < m.vertices.length; i += 9)
            check(Number.isInteger(m.vertices[i]) && m.vertices[i] >= 0 && m.vertices[i] < m.materials.length, 'Invalid vertex material');
    }
    check(p.model !== 'imported' || !!p.mesh, 'Imported projects require a mesh');
    check(Array.isArray(p.comments) && p.comments.length <= 20000, 'Invalid project comments');
    for (const c of p.comments)
        validateComment(c);
    validateSettings(p.settings);
    return p;
}
export function validateOperation(op) {
    check(plain(op) && identifier(op.id) && identifier(op.actor) && Number.isSafeInteger(op.clock) && op.clock >= 1 && op.clock < Number.MAX_SAFE_INTEGER, 'Invalid operation envelope');
    check(op.label === undefined || text(op.label, 500), 'Invalid operation label');
    const p = op.payload;
    check(plain(p), 'Invalid operation payload');
    check(['layer:add', 'layer:set', 'layer:delete', 'layer:move', 'stroke:add', 'project:set', 'set:set', 'comment:add', 'comment:resolve', 'history:toggle'].includes(op.type), 'Unknown operation type');
    if (op.type.startsWith('layer:') || op.type === 'stroke:add' || op.type === 'set:set')
        check(identifier(p.setId), 'Invalid texture set identifier');
    if (['layer:set', 'layer:delete', 'layer:move', 'stroke:add'].includes(op.type))
        check(identifier(p.layerId), 'Invalid layer identifier');
    if (op.type === 'stroke:add')
        validateStroke(p.stroke);
    if (op.type === 'layer:set')
        validateLayer(p.patch, { partial: true });
    if (op.type === 'layer:add') {
        validateLayer(p.layer);
        if (p.index !== undefined)
            check(Number.isInteger(p.index) && finite(p.index, 0, 128), 'Invalid layer index');
    }
    if (op.type === 'layer:move')
        check(Number.isInteger(p.index) && finite(p.index, 0, 128), 'Invalid layer index');
    if (op.type === 'project:set') {
        check(plain(p.patch) && Object.keys(p.patch).every(k => ['name', 'resolution', 'settings'].includes(k)), 'Unsupported project property');
        if (p.patch.resolution !== undefined)
            check([256, 512, 1024, 2048, 4096].includes(p.patch.resolution), 'Invalid resolution');
        if (p.patch.name !== undefined)
            check(text(p.patch.name), 'Invalid project name');
        if (p.patch.settings !== undefined)
            validateSettings(p.patch.settings);
    }
    if (op.type === 'set:set') {
        check(plain(p.patch) && Object.keys(p.patch).every(k => ['name', 'visible'].includes(k)), 'Unsupported texture set property');
        if (p.patch.name !== undefined)
            check(text(p.patch.name), 'Invalid texture set name');
        if (p.patch.visible !== undefined)
            check(typeof p.patch.visible === 'boolean', 'Invalid visibility');
    }
    if (op.type === 'comment:add')
        validateComment(p.comment);
    if (op.type === 'comment:resolve')
        check(identifier(p.commentId) && typeof p.resolved === 'boolean', 'Invalid comment resolution');
    if (op.type === 'history:toggle')
        check(identifier(p.target) && typeof p.enabled === 'boolean', 'Invalid history toggle');
    return op;
}
/** Deterministic command reducer. Arrays are ordered bottom to top. */
export function applyOperation(state, op) {
    const p = op.payload, s = state.textureSets.find(s => s.id === p.setId), l = s?.layers.find(l => l.id === p.layerId);
    switch (op.type) {
        case 'layer:add':
            if (s && !s.layers.some(l => l.id === p.layer.id) && s.layers.length < 128)
                s.layers.splice(clamp(p.index ?? s.layers.length, 0, s.layers.length), 0, structuredClone(p.layer));
            break;
        case 'layer:set':
            if (l)
                Object.assign(l, structuredClone(p.patch));
            break;
        case 'layer:delete':
            if (s)
                s.layers = s.layers.filter(l => l.id !== p.layerId);
            break;
        case 'layer:move':
            if (s && l) {
                s.layers = s.layers.filter(x => x !== l);
                s.layers.splice(clamp(p.index, 0, s.layers.length), 0, l);
            }
            break;
        case 'stroke:add':
            if (l && l.strokes.length < 20000 && !l.strokes.some(s => s.id === p.stroke.id))
                l.strokes.push(structuredClone(p.stroke));
            break;
        case 'project:set':
            Object.assign(state, structuredClone(p.patch));
            break;
        case 'set:set':
            if (s)
                Object.assign(s, structuredClone(p.patch));
            break;
        case 'comment:add':
            if (!state.comments.some(c => c.id === p.comment.id))
                state.comments.push({ ...structuredClone(p.comment), actor: op.actor, resolved: false });
            break;
        case 'comment:resolve': {
            let c = state.comments.find(c => c.id === p.commentId);
            if (c)
                c.resolved = !!p.resolved;
            break;
        }
    }
    return state;
}
/** Replica: deduplicated immutable commands ordered by Lamport counter + actor + ID.
 * Commands made concurrently to independent objects survive. Same-property changes are LWW.
 * Undo toggles only commands owned by the same actor; it never replaces a shared document.
 */
export class ProjectStore extends Signal {
    constructor(project = createProject(), actor = uid()) { super(); this.actor = actor; this.clock = 0; this.base = structuredClone(validateProject(project)); this.state = structuredClone(project); this.ops = new Map(); this.revision = 0; }
    get operations() { return [...this.ops.values()].sort((a, b) => a.clock - b.clock || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); }
    dispatch(type, payload, label = type) { const op = { id: uid(), actor: this.actor, clock: ++this.clock, type, payload: structuredClone(payload), label, time: new Date().toISOString() }; validateOperation(op); this.ingest([op], true); return op; }
    ingest(operations, local = false) { check(Array.isArray(operations) && operations.length <= 100000, 'Invalid operation list'); for (const op of operations)
        validateOperation(op); check(this.ops.size + operations.filter(o => !this.ops.has(o.id)).length <= 100000, 'Operation journal limit reached; create a new project snapshot'); let changed = false; for (const raw of operations) {
        const op = raw;
        this.clock = Math.max(this.clock, op.clock);
        if (!this.ops.has(op.id)) {
            this.ops.set(op.id, structuredClone(op));
            changed = true;
        }
    } if (changed) {
        this.rebuild();
        this.emit('change', { local, operations, state: this.state });
    } }
    rebuild() { const ops = this.operations, disabled = new Map(); for (const o of ops)
        if (o.type === 'history:toggle') {
            const target = this.ops.get(o.payload.target);
            if (target?.actor === o.actor)
                disabled.set(o.payload.target, !o.payload.enabled);
        } this.state = structuredClone(this.base); for (const o of ops)
        if (!disabled.get(o.id) && o.type !== 'history:toggle')
            applyOperation(this.state, o); this.disabled = disabled; this.revision++; }
    undo() { const op = this.operations.reverse().find(o => o.actor === this.actor && o.type !== 'history:toggle' && !this.disabled?.get(o.id)); if (op)
        this.dispatch('history:toggle', { target: op.id, enabled: false }, `Undo ${op.label}`); return !!op; }
    redo() { const op = this.operations.reverse().find(o => o.actor === this.actor && o.type !== 'history:toggle' && this.disabled?.get(o.id)); if (op)
        this.dispatch('history:toggle', { target: op.id, enabled: true }, `Redo ${op.label}`); return !!op; }
    serialize() { return { format: 'chromaforge', version: 1, base: this.base, operations: this.operations }; }
    load(data) {
        check(data?.format === 'chromaforge' && data.version === 1 && Array.isArray(data.operations) && data.operations.length <= 100000, 'Unsupported project file');
        // Validate in a temporary replica. Failed imports never partially replace the active document.
        const staged = new ProjectStore(validateProject(data.base), this.actor);
        staged.ingest(data.operations);
        if (!data.operations.length)
            staged.rebuild();
        this.base = staged.base;
        this.state = staged.state;
        this.ops = staged.ops;
        this.disabled = staged.disabled;
        this.clock = staged.clock;
        this.revision++;
        this.emit('load', this.state);
    }
}

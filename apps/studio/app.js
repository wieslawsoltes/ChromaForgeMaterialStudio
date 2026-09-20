import { ProjectStore, createProject, createLayer, CHANNELS, BLENDS } from '../../packages/core/src/document.js';
import { ProjectDatabase } from '../../packages/core/src/storage.js';
import { uid, clamp, hexRGB } from '../../packages/core/src/math.js';
import { Mesh, createModel } from '../../packages/geometry/src/mesh.js';
import { MeshBVH } from '../../packages/geometry/src/bvh.js';
import { parseOBJ, parseGLTF, exportOBJ } from '../../packages/geometry/src/io.js';
import { MaterialRenderer } from '../../packages/renderer/src/renderer.js';
import { TextureCompositor, makeCanvas } from '../../packages/paint/src/compositor.js';
import { MATERIALS, BRUSHES, materialThumbnail } from '../../packages/paint/src/materials.js';
import { bakeMeshMaps } from '../../packages/paint/src/baker.js';
import { createZip, downloadBlob } from '../../packages/paint/src/zip.js';
import { icon, esc } from '../../packages/controls/src/icons.js';
import { registerControls, CommandRegistry } from '../../packages/controls/src/elements.js';
import { CollaborationClient } from '../../packages/collab/src/client.js';
const $ = (s, p = document) => p.querySelector(s), $$ = (s, p = document) => [...p.querySelectorAll(s)];
const channelNames = { baseColor: 'Base color', roughness: 'Roughness', metallic: 'Metallic', height: 'Height', emissive: 'Emissive', opacity: 'Opacity' };
const toolInfo = { paint: ['brush', 'Paint', 'B'], erase: ['erase', 'Eraser', 'E'], fill: ['fill', 'Fill material', 'G'], picker: ['pick', 'Color picker', 'I'], decal: ['image', 'Import decal', 'D'], pan: ['move', 'Navigate', 'H'], mask: ['mask', 'Paint mask', 'U'] };
const modeChannel = { material: 0, baseColor: 1, roughness: 2, metallic: 3, normal: 4, height: 5, emissive: 6, checker: 7 };
function button(id, label, ico, cls = '') { return `<button class="${cls}" data-command="${id}" title="${esc(label)}">${ico ? icon(ico) : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`; }
function ib(action, title, ico, cls = '') { return `<button class="${cls}" data-action="${action}" title="${esc(title)}" aria-label="${esc(title)}">${icon(ico)}</button>`; }
function slider(label, id, value, min = 0, max = 1, step = .01, scope = 'layer') { return `<cf-slider label="${label}" data-scope="${scope}" data-prop="${id}" value="${value}" min="${min}" max="${max}" step="${step}"></cf-slider>`; }
class Studio {
    constructor() { this.db = new ProjectDatabase(); this.store = new ProjectStore(createProject()); this.commands = new CommandRegistry(); this.setId = 'set-0'; this.layerId = 'paint-01'; this.tool = 'paint'; this.maskSelected = false; this.brush = { ...BRUSHES[0], size: 36 / 1024, color: '#dfbe87', roughness: .45, metallic: .2, height: .55, emissive: .3, opacity: 1, channels: ['baseColor'], pressure: true, angle: 0, scatter: 0, wrap: false, symmetry: false, seed: 17 }; this.assetTab = 'materials'; this.assetCategory = 'All assets'; this.assetQuery = ''; this.propertyTab = 'paint'; this.sideTab = 'layers'; this.view = 'split'; this.displayChannel = 'material'; this.uv = { zoom: 1, x: 0, y: 0 }; this.preview = null; this.dirtySets = new Set(); this.thumbnails = new Map(); this.undoDepth = 0; this.turntable = false; this.lastDraw = 0; this.frameCount = 0; this.bake = null; this.ready = false; this.storageAvailable = false; this.menus = {}; this.renderPending = false; }
    get set() { return this.store.state.textureSets.find(s => s.id === this.setId) ?? this.store.state.textureSets[0]; }
    get layer() { return this.set.layers.find(l => l.id === this.layerId) ?? this.set.layers.at(-1); }
    async init() {
        registerControls();
        this.buildUI();
        this.registerCommands();
        this.bindUI();
        try {
            await this.db.open();
            this.storageAvailable = true;
            const prefs = await this.db.setting('preferences');
            if (prefs) {
                document.body.classList.toggle('light', prefs.theme === 'light');
                $('.studio').classList.toggle('comfortable', prefs.density === 'comfortable');
                if (prefs.right)
                    $('.studio').style.setProperty('--right', prefs.right);
                if (prefs.shelf)
                    $('.studio').style.setProperty('--shelf', prefs.shelf);
            }
        }
        catch (e) {
            this.toast(`Browser storage unavailable: ${e.message}. Export project files to keep your work.`, 'error');
        }
        this.renderer = new MaterialRenderer($('#viewport3d'), { forceWebGL: new URLSearchParams(location.search).has('webgl'), maxDPR: 1.75 });
        this.renderer.on('error', e => this.toast(e, 'error'));
        this.renderer.on('warning', e => console.warn(e));
        try {
            await this.renderer.initialize();
        }
        catch (e) {
            this.toast(e.message, 'error');
            $('#gpu-label').textContent = 'GPU unavailable';
            $('.view-area').insertAdjacentHTML('beforeend', `<div class="view-hint">${esc(e.message)}</div>`);
            throw e;
        }
        $('#gpu-label').textContent = this.renderer.mode;
        this.renderer.canvas.id = 'viewport3d';
        this.compositor = new TextureCompositor(this.store.state.resolution);
        this.bindViewport(this.renderer.canvas, false);
        this.bindViewport($('#viewport2d'), true);
        this.store.on('change', e => this.changed(e));
        this.store.on('load', () => this.loadScene().catch(e => this.toast(e.message, 'error')));
        this.collab = new CollaborationClient(this.store, this.db);
        this.collab.on('status', s => this.collabStatus(s));
        this.collab.on('presence', p => this.updatePresence(p));
        this.collab.on('cursor', p => this.remoteCursor(p));
        this.collab.on('error', e => this.toast(e, 'error'));
        await this.loadScene();
        this.ready = true;
        this.loop();
        this.renderAssets();
        this.renderRight();
        $('#save-status').textContent = this.storageAvailable ? 'Local project · Autosave on' : 'Storage unavailable · Export project to save';
        try {
            const recentId = await this.db.setting('lastProject');
            const recent = recentId ? await this.db.get(recentId) : null;
            if (recent && new URLSearchParams(location.search).get('fresh') !== '1') {
                this.store.load(recent.data);
                this.toast(`Restored ${recent.name}`);
            }
        }
        catch (e) {
            console.warn('Restore skipped', e);
        }
        this.toast('Paint on the model or UV canvas. Alt + drag to orbit.', 'success');
    }
    buildUI() {
        $('#app').innerHTML = `<main class="studio" data-layout>
    <header class="titlebar"><div class="brandmark">C<span>F</span></div><div class="brand">ChromaForge<span class="studio-label">Material Studio</span></div><span class="separator"></span><span class="project-name" id="project-name">NOMAD · Field camera</span><span class="project-dot" id="project-dot" hidden></span><div class="spacer"></div><span class="local-label micro" id="collab-label">Local project</span><div class="avatar-group" id="avatars"><span class="avatar" title="Local artist">You</span></div>${button('collaborate', 'Share', 'share', 'secondary')}${button('export', 'Export textures', 'export', 'primary')}</header>
    <nav class="menubar" aria-label="Main menu">${['File', 'Edit', 'Layer', 'Texture Set', 'View', 'Window', 'Help'].map(n => `<button data-menu="${n}">${n}</button>`).join('')}<button class="kbd-search" data-command="palette">${icon('search', 13)} Search commands <kbd class="keycap">⌘ K</kbd></button></nav>
    <div class="tool-options"><span class="tool-title" id="tool-title">${icon('brush')} Paint <span class="shortcut">B</span></span><div class="separator"></div><label class="input-pair">Size <input type="number" id="brush-size" aria-label="Brush size" min="1" max="400" value="36"><span class="micro">px</span></label><label class="input-pair">Flow <input type="number" id="brush-flow" aria-label="Brush flow" min="1" max="100" value="75"><span class="micro">%</span></label><label class="input-pair optional-small">Hardness <input class="mini-range" id="brush-hardness" aria-label="Brush hardness" type="range" min="0" max="1" step=".01" value=".18"></label><div class="separator"></div><input type="color" aria-label="Brush color" id="brush-color" value="#dfbe87"><label class="input-pair optional">Spacing <input type="number" id="brush-spacing" aria-label="Brush spacing" min="1" max="200" value="18">%</label><div class="spacer"></div><button id="symmetry-btn" data-action="symmetry" title="Toggle UV symmetry">${icon('symmetry')}<span class="optional">Symmetry</span></button>${ib('pressure', 'Toggle pressure response', 'tune', 'optional')}${ib('settings', 'Project settings', 'settings')}</div>
    <div class="workspace"><aside class="toolrail" aria-label="Painting tools">${Object.entries(toolInfo).map(([id, [ico, label, key]]) => `<button data-tool="${id}" class="${id === 'paint' ? 'active' : ''}" title="${label} (${key})" aria-label="${label}" aria-pressed="${id === 'paint'}">${icon(ico, 19)}</button>`).join('')}<hr>${ib('add-mask', 'Add layer mask', 'mask')}${ib('wireframe', 'Toggle wireframe', 'grid')}<div class="spacer"></div>${ib('frame', 'Frame model (F)', 'maximize')}${ib('theme', 'Toggle light / dark theme', 'sun')}<input class="color-chip" type="color" id="rail-color" aria-label="Foreground color" value="#dfbe87">${ib('help', 'Keyboard shortcuts', 'help')}</aside>
    <section class="center"><div class="view-area"><div class="document-tabs"><div class="document-tab">${icon('cube', 12)}<span id="doc-tab-name">NOMAD — Field camera</span><span class="micro">.cforge</span><span class="close-tab">●</span></div><div class="spacer"></div><button data-command="new" title="New project">${icon('plus', 13)}</button></div>
    <div class="view-toolbar"><select id="channel-view" aria-label="Viewport channel"><option value="material">Material</option><option value="baseColor">Base color</option><option value="roughness">Roughness</option><option value="metallic">Metallic</option><option value="normal">Normals</option><option value="height">Height</option><option value="emissive">Emissive</option><option value="checker">UV checker</option></select><span class="micro optional">PBR · Metal / Rough</span><div class="spacer"></div><button data-action="environment" title="Display settings">${icon('sun', 14)}</button><button data-action="turntable" id="turntable-btn" title="Turntable">${icon('play', 12)}</button><button data-action="snapshot" title="Save viewport render">${icon('camera', 14)}</button><span class="separator"></span><div class="segmented" aria-label="Viewport layout"><button data-view="3d" title="3D view (F2)">${icon('cube', 14)}</button><button data-view="split" class="active" title="3D and 2D (F1)">${icon('split', 14)}</button><button data-view="2d" title="2D view (F3)">${icon('grid', 14)}</button></div><button data-command="focus" title="Focus workspace (Tab)">${icon('maximize', 13)}</button></div>
    <div class="viewport-layout view-mode-split"><div class="viewport viewport-3d"><canvas id="viewport3d" tabindex="0" aria-label="3D material painting viewport"></canvas><div class="viewport-label">Perspective <span class="tag">3D</span></div><div class="axis-gizmo"><span class="axis-y">Y</span><span class="axis-x">X</span><span class="axis-z">Z</span></div><div class="viewport-bottom"><span id="mesh-name">NOMAD-07</span><span id="tri-count"></span></div><div class="viewport-brand">CHROMAFORGE</div><div class="brush-cursor" id="cursor3d"></div></div><div class="viewport viewport-2d"><canvas id="viewport2d" tabindex="0" aria-label="2D UV texture painting viewport"></canvas><div class="viewport-label">UV view <span class="tag">2D</span></div><div class="viewport-bottom"><span id="uv-set-label">Shell</span><span id="uv-res-label">1024 × 1024</span><span id="uv-zoom">100%</span></div><div class="brush-cursor" id="cursor2d"></div></div></div></div>
    <cf-splitter direction="horizontal" property="--shelf" sign="-1" min="110" max="600" aria-label="Resize asset shelf"></cf-splitter>
    <section class="shelf"><div class="panel-header"><span class="panel-tabs"><button class="active" data-asset-tab="materials">Assets</button><button data-asset-tab="brushes">Brushes</button><button data-asset-tab="generators">Generators</button></span><span class="count" id="asset-count">24 assets</span><div class="spacer"></div>${ib('import-decal', 'Import texture or decal', 'import')}${ib('shelf', 'Hide asset shelf', 'down')}</div><div class="shelf-toolbar"><label class="search-input">${icon('search', 12)}<input id="asset-search" placeholder="Search your assets…" aria-label="Search assets"></label><button data-category="All assets" class="filter active">All assets</button><button data-category="Metals" class="filter">Metals</button><button data-category="Plastic" class="filter">Plastic</button><button data-category="Fabric" class="filter">Fabric</button><div class="spacer"></div><span class="micro optional">Drag a material onto the model</span>${ib('asset-refresh', 'Clear asset filters', 'refresh')}</div><div class="shelf-body"><nav class="asset-categories">${['All assets', 'Metals', 'Plastic', 'Fabric', 'Organic', 'Utility', 'Generators'].map((c, i) => `<button data-category="${c}" class="${i === 0 ? 'active' : ''}">${i === 0 ? icon('folder', 12) : icon('chevron', 10)}${c}<span class="asset-count">${i === 0 ? 24 : MATERIALS.filter(m => m.category === c).length}</span></button>`).join('')}</nav><div class="asset-grid" id="asset-grid"></div></div></section></section>
    <cf-splitter property="--right" sign="-1" min="220" max="550" aria-label="Resize property panels"></cf-splitter><aside class="right-panel"><section class="texture-sets"><div class="panel-header">Texture set list <div class="spacer"></div>${ib('isolate', 'Isolate active texture set', 'eye')}${ib('settings', 'Texture set settings', 'settings')}</div><div class="texture-set-list" id="texture-set-list"></div></section><section class="layers-panel"><div class="panel-header"><div class="panel-tabs"><button data-side-tab="layers" class="active">Layers</button><button data-side-tab="history">History</button><button data-side-tab="notes">Notes</button></div><div class="spacer"></div>${ib('layer-menu', 'Layer actions', 'dots')}</div><div class="layer-toolbar" id="layer-toolbar">${ib('add-paint', 'Add paint layer', 'plus')}${ib('add-fill', 'Add fill layer', 'fill')}${ib('add-mask', 'Add mask', 'mask')}${ib('duplicate-layer', 'Duplicate layer', 'copy')}${ib('delete-layer', 'Delete layer', 'trash')}<select id="blend-mode" aria-label="Layer blend mode">${BLENDS.map(b => `<option>${b}</option>`).join('')}</select></div><div class="layers-list" id="layers-list"></div></section><cf-splitter direction="horizontal" property="--props" sign="-1" min="160" max="620" aria-label="Resize properties"></cf-splitter><section class="properties"><div class="panel-header"><div class="panel-tabs"><button data-prop-tab="paint" class="active">Paint</button><button data-prop-tab="layer">Layer</button><button data-prop-tab="display">Display</button></div><div class="spacer"></div>${icon('tune', 12)}</div><div class="property-body" id="property-body"></div></section></aside></div>
    <footer class="statusbar"><span><span class="engine-dot"></span><strong id="gpu-label">Initializing GPU</strong></span><span class="status-sep">│</span><span id="save-status">Preparing document</span><span class="spacer"></span><span class="optional">Alt + LMB: orbit · MMB: pan · Scroll: zoom</span><span class="status-sep">│</span><span id="perf-label">Ready</span><span class="status-sep">│</span><span id="resolution-status">1024²</span></footer></main><div class="toast-container" role="status" aria-live="polite"></div>`;
    }
    registerCommands() {
        const c = this.commands, reg = (id, label, fn, key = '', ico = '') => c.register(id, label, fn, { key, icon: ico });
        reg('new', 'New project', () => this.newDialog(), '⌘ N', 'file');
        reg('open', 'Open project file', () => this.chooseFiles('.cforge,.json', false, f => this.openProject(f[0])), '⌘ O', 'folder');
        reg('recent', 'Project library', () => this.projectLibrary(), '', 'folder');
        reg('save', 'Save project', () => this.saveProject(), '⌘ S', 'save');
        reg('import', 'Import mesh', () => this.chooseFiles('.obj,.gltf,.glb,.bin', true, f => this.importMesh(f)), '', 'import');
        reg('export', 'Export textures', () => this.exportDialog(), '⌘ ⇧ E', 'export');
        reg('mesh-export', 'Export mesh as OBJ', () => downloadBlob(new Blob([exportOBJ(this.mesh)], { type: 'text/plain' }), 'chromaforge-mesh.obj'), '', 'cube');
        reg('snapshot', 'Save viewport PNG', async () => downloadBlob(await this.renderer.snapshot(), 'chromaforge-render.png'), '', 'camera');
        reg('undo', 'Undo', () => { if (!this.store.undo())
            this.toast('No local operation to undo'); }, '⌘ Z', 'undo');
        reg('redo', 'Redo', () => { if (!this.store.redo())
            this.toast('No local operation to redo'); }, '⌘ ⇧ Z', 'redo');
        reg('add-paint', 'Add paint layer', () => this.addLayer('paint'), '', 'plus');
        reg('add-fill', 'Add fill layer', () => this.addLayer('fill'), '', 'fill');
        reg('duplicate-layer', 'Duplicate layer', () => this.duplicateLayer(), '⌘ D', 'copy');
        reg('delete-layer', 'Delete selected layer', () => this.deleteLayer(), 'Delete', 'trash');
        reg('rename-layer', 'Rename layer', () => this.renameLayer(), '', 'file');
        reg('add-mask', 'Add layer mask', () => this.maskMenu(), '', 'mask');
        reg('remove-mask', 'Remove mask', () => { if (this.layer)
            this.patchLayer({ mask: null }); this.maskSelected = false; this.renderProperties(); }, '', 'mask');
        reg('invert-mask', 'Invert mask', () => { if (this.layer?.mask)
            this.patchLayer({ mask: { ...this.layer.mask, invert: !this.layer.mask.invert } }); }, '', 'mask');
        reg('layer-up', 'Move layer up', () => this.moveLayer(1), '', 'layers');
        reg('layer-down', 'Move layer down', () => this.moveLayer(-1), '', 'layers');
        reg('import-decal', 'Import image / decal', () => this.chooseFiles('image/png,image/jpeg,image/webp', false, f => this.importDecal(f[0])), 'D', 'image');
        reg('text-decal', 'Add text decal', () => this.textDecalDialog(), '', 'image');
        reg('bake', 'Bake mesh maps', () => this.bakeDialog(), '', 'bolt');
        reg('settings', 'Project / texture settings', () => this.projectSettings(), '', 'settings');
        reg('frame', 'Frame mesh', () => { this.renderer.camera.frame(); this.uv = { zoom: 1, x: 0, y: 0 }; this.renderer.invalidate(); this.drawUV(); }, 'F', 'maximize');
        reg('view-split', '3D + 2D views', () => this.setView('split'), 'F1', 'split');
        reg('view-3d', '3D only', () => this.setView('3d'), 'F2', 'cube');
        reg('view-2d', '2D only', () => this.setView('2d'), 'F3', 'grid');
        reg('wireframe', 'Toggle wireframe', () => { this.renderer.settings.wireframe = !this.renderer.settings.wireframe; this.renderer.invalidate(); }, 'W', 'grid');
        reg('orthographic', 'Toggle orthographic camera', () => { this.renderer.camera.ortho = !this.renderer.camera.ortho; $('.viewport-3d .viewport-label').innerHTML = `${this.renderer.camera.ortho ? 'Orthographic' : 'Perspective'} <span class="tag">3D</span>`; this.renderer.invalidate(); }, '', 'cube');
        reg('focus', 'Focus workspace', () => $('.studio').classList.toggle('focus-mode'), 'Tab', 'maximize');
        reg('shelf', 'Toggle asset shelf', () => $('.studio').classList.toggle('shelf-hidden'), '', 'layers');
        reg('theme', 'Toggle light / dark theme', () => { document.body.classList.toggle('light'); this.savePreferences(); }, '', 'sun');
        reg('density', 'Toggle compact / comfortable density', () => { $('.studio').classList.toggle('comfortable'); this.savePreferences(); }, '', 'tune');
        reg('reset-layout', 'Reset panel layout', () => { $('.studio').removeAttribute('style'); $('.studio').classList.remove('focus-mode', 'shelf-hidden'); this.setView('split'); this.savePreferences(); }, '', 'refresh');
        reg('collaborate', 'Collaboration workspace', () => this.collaborationDialog(), '', 'share');
        reg('help', 'Keyboard shortcuts', () => this.helpDialog(), '?', 'help');
        reg('about', 'About ChromaForge', () => this.aboutDialog(), '', 'info');
        reg('palette', 'Search all commands', () => this.commandPalette(), '⌘ K', 'search');
        reg('environment', 'Display settings', () => { this.propertyTab = 'display'; this.renderProperties(); }, '', 'sun');
        this.menus = { File: ['new', 'open', 'recent', null, 'import', 'import-decal', 'text-decal', null, 'save', 'export', 'mesh-export', 'snapshot'], Edit: ['undo', 'redo', null, 'settings', 'palette'], Layer: ['add-paint', 'add-fill', 'duplicate-layer', 'rename-layer', null, 'add-mask', 'remove-mask', 'invert-mask', null, 'layer-up', 'layer-down', 'delete-layer'], 'Texture Set': ['settings', 'bake', 'export'], View: ['view-split', 'view-3d', 'view-2d', null, 'frame', 'orthographic', 'wireframe', 'environment', 'focus'], Window: ['shelf', 'density', 'theme', 'reset-layout', null, 'collaborate'], Help: ['help', 'about'] };
    }
    bindUI() {
        document.addEventListener('click', e => { const menu = e.target.closest('[data-menu]'); if (menu) {
            this.openMenu(menu, this.menus[menu.dataset.menu]);
            return;
        } const cmd = e.target.closest('[data-command]'); if (cmd) {
            this.closeMenus();
            this.run(cmd.dataset.command);
            return;
        } const action = e.target.closest('[data-action]'); if (action) {
            this.action(action.dataset.action, action, e);
            return;
        } const tool = e.target.closest('[data-tool]'); if (tool) {
            this.setTool(tool.dataset.tool);
            return;
        } const view = e.target.closest('[data-view]'); if (view) {
            this.setView(view.dataset.view);
            return;
        } const set = e.target.closest('[data-set]'); if (set) {
            this.selectSet(set.dataset.set);
            return;
        } const layer = e.target.closest('[data-layer]'); if (layer) {
            this.layerId = layer.dataset.layer;
            this.maskSelected = e.target.closest('.mask-thumb') !== null;
            this.renderRight();
            return;
        } const prop = e.target.closest('[data-prop-tab]'); if (prop) {
            this.propertyTab = prop.dataset.propTab;
            this.renderProperties();
            return;
        } const side = e.target.closest('[data-side-tab]'); if (side) {
            this.sideTab = side.dataset.sideTab;
            this.renderLayers();
            return;
        } const at = e.target.closest('[data-asset-tab]'); if (at) {
            this.assetTab = at.dataset.assetTab;
            this.assetCategory = 'All assets';
            this.renderAssets();
            return;
        } const cat = e.target.closest('[data-category]'); if (cat) {
            this.assetCategory = cat.dataset.category;
            this.assetTab = cat.dataset.category === 'Generators' ? 'generators' : 'materials';
            this.renderAssets();
            return;
        } const asset = e.target.closest('[data-asset]'); if (asset) {
            this.applyAsset(asset.dataset.asset);
            return;
        } if (!e.target.closest('.dropdown-menu'))
            this.closeMenus(); });
        $('#asset-search').oninput = e => { this.assetQuery = e.target.value; this.renderAssets(); };
        $('#channel-view').onchange = e => { this.displayChannel = e.target.value; this.renderer.settings.channel = modeChannel[this.displayChannel]; this.renderer.invalidate(); this.drawUV(); };
        $('#brush-size').onchange = e => { this.brush.size = clamp(+e.target.value, 1, 400) / this.store.state.resolution; this.renderProperties(); };
        $('#brush-flow').onchange = e => { this.brush.flow = clamp(+e.target.value / 100, .01, 1); this.renderProperties(); };
        $('#brush-hardness').oninput = e => { this.brush.hardness = +e.target.value; };
        $('#brush-spacing').onchange = e => { this.brush.spacing = clamp(+e.target.value / 100, .01, 2); this.renderProperties(); };
        for (const id of ['brush-color', 'rail-color'])
            $('#' + id).oninput = e => this.setBrushColor(e.target.value);
        $('#blend-mode').onchange = e => this.patchLayer({ blend: e.target.value });
        document.addEventListener('value-input', e => { const el = e.target; if (el.dataset.scope === 'brush') {
            this.brush[el.dataset.prop] = e.detail;
            this.syncToolbar();
        } if (el.dataset.scope === 'display') {
            this.renderer.settings[el.dataset.prop] = e.detail;
            this.renderer.invalidate();
        } });
        document.addEventListener('value-change', e => { const el = e.target; if (el.dataset.scope === 'layer')
            this.patchLayer({ [el.dataset.prop]: e.detail }); if (el.dataset.scope === 'decal')
            this.patchLayer({ transform: { ...this.layer.transform, [el.dataset.prop]: e.detail } }); if (el.dataset.scope === 'display')
            this.store.dispatch('project:set', { patch: { settings: { ...this.store.state.settings, exposure: this.renderer.settings.exposure, rotation: this.renderer.settings.rotation } } }, 'Adjust studio lighting'); });
        document.addEventListener('change', e => { const p = e.target.dataset.layerProp; if (p)
            this.patchLayer({ [p]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); if (e.target.id === 'environment-select') {
            const env = e.target.value;
            this.renderer.settings.environment = ['studio', 'warm', 'night'].indexOf(env);
            this.store.dispatch('project:set', { patch: { settings: { ...this.store.state.settings, environment: env } } }, 'Change studio environment');
        } });
        document.addEventListener('keydown', e => this.keydown(e));
        document.addEventListener('resize-end', () => this.savePreferences());
        window.addEventListener('resize', () => { this.drawUV(); this.renderer?.invalidate(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden && this.ready)
            this.db.save(this.store).catch(() => { }); });
        document.addEventListener('dragstart', e => { const a = e.target.closest('[data-asset]'), l = e.target.closest('[data-layer]'); if (a)
            e.dataTransfer.setData('application/x-chromaforge-material', a.dataset.asset); if (l)
            e.dataTransfer.setData('application/x-chromaforge-layer', l.dataset.layer); });
        $('#layers-list').addEventListener('dragover', e => { e.preventDefault(); const row = e.target.closest('[data-layer]'); $$('.drag-target').forEach(el => el.classList.remove('drag-target')); row?.classList.add('drag-target'); });
        $('#layers-list').addEventListener('drop', e => { e.preventDefault(); const id = e.dataTransfer.getData('application/x-chromaforge-layer'), target = e.target.closest('[data-layer]'); $$('.drag-target').forEach(el => el.classList.remove('drag-target')); if (id && target) {
            const index = this.set.layers.findIndex(l => l.id === target.dataset.layer);
            this.store.dispatch('layer:move', { setId: this.set.id, layerId: id, index }, 'Reorder layer');
        } });
        $('.viewport-layout').addEventListener('dragover', e => e.preventDefault());
        $('.viewport-layout').addEventListener('drop', e => { e.preventDefault(); const id = e.dataTransfer.getData('application/x-chromaforge-material'); if (id) {
            const hit = this.hit3D(e);
            if (hit)
                this.selectSet(this.store.state.textureSets[hit.material].id);
            this.applyAsset(id);
        }
        else if (e.dataTransfer.files.length) {
            const files = [...e.dataTransfer.files];
            if (files[0].type.startsWith('image/'))
                this.importDecal(files[0]);
            else
                this.importMesh(files).catch(e => this.toast(e.message, 'error'));
        } });
    }
    async run(id) { try {
        await this.commands.run(id);
    }
    catch (e) {
        console.error(e);
        this.toast(e.message, 'error');
    } }
    action(id, el, e) {
        if (id === 'toggle-set') {
            e.stopPropagation();
            const s = this.store.state.textureSets.find(s => s.id === el.dataset.id);
            this.store.dispatch('set:set', { setId: s.id, patch: { visible: !s.visible } }, 'Toggle texture set visibility');
            return;
        }
        if (id === 'toggle-layer') {
            e.stopPropagation();
            const l = this.set.layers.find(l => l.id === el.dataset.id);
            this.store.dispatch('layer:set', { setId: this.set.id, layerId: l.id, patch: { visible: !l.visible } }, 'Toggle layer visibility');
            return;
        }
        if (id === 'layer-menu') {
            this.openMenu(el, this.menus.Layer);
            return;
        }
        if (id === 'symmetry') {
            this.brush.symmetry = !this.brush.symmetry;
            el.classList.toggle('active', this.brush.symmetry);
            this.toast(`UV symmetry ${this.brush.symmetry ? 'enabled' : 'disabled'}`);
            return;
        }
        if (id === 'pressure') {
            this.brush.pressure = !this.brush.pressure;
            this.toast(`Pressure response ${this.brush.pressure ? 'enabled' : 'disabled'}`);
            this.renderProperties();
            return;
        }
        if (id === 'asset-refresh') {
            this.assetQuery = '';
            this.assetCategory = 'All assets';
            $('#asset-search').value = '';
            this.renderAssets();
            return;
        }
        if (id === 'channel') {
            const ch = el.dataset.channel;
            this.brush.channels = this.brush.channels.includes(ch) ? this.brush.channels.filter(c => c !== ch) : [...this.brush.channels, ch];
            this.renderProperties();
            return;
        }
        if (id === 'layer-channel') {
            const ch = el.dataset.channel, channels = this.layer.channels.includes(ch) ? this.layer.channels.filter(c => c !== ch) : [...this.layer.channels, ch];
            this.patchLayer({ channels });
            return;
        }
        if (id === 'swatch') {
            this.setBrushColor(el.dataset.color);
            return;
        }
        if (id === 'isolate') {
            this.isolate = !this.isolate;
            this.updateVisibility();
            this.toast(this.isolate ? 'Active texture set isolated' : 'Showing visible texture sets');
            return;
        }
        if (id === 'turntable') {
            this.turntable = !this.turntable;
            $('#turntable-btn').innerHTML = icon(this.turntable ? 'stop' : 'play', 12);
            return;
        }
        if (id === 'note-add') {
            const text = $('#note-text')?.value.trim();
            if (text)
                this.store.dispatch('comment:add', { comment: { id: uid(), text, time: new Date().toISOString(), setId: this.setId } }, 'Add review note');
            return;
        }
        if (id === 'resolve-note') {
            this.store.dispatch('comment:resolve', { commentId: el.dataset.id, resolved: el.dataset.resolved !== 'true' }, 'Resolve review note');
            return;
        }
        this.run(id);
    }
    async loadScene() {
        const generation = this.sceneGeneration = (this.sceneGeneration ?? 0) + 1;
        this.setId = this.store.state.textureSets[0].id;
        this.layerId = this.set.layers.at(-1)?.id;
        this.maskSelected = false;
        this.compositor?.resize(this.store.state.resolution);
        this.compositor?.dispose();
        this.mesh = this.store.state.mesh ? Mesh.fromJSON(this.store.state.mesh) : createModel(this.store.state.model);
        this.bvh = new MeshBVH(this.mesh);
        this.renderer.setMesh(this.mesh);
        this.uvPaths = new Map();
        this.renderer.camera.frame();
        this.applySettings();
        this.updateVisibility();
        for (const set of this.store.state.textureSets)
            for (const l of set.layers)
                if (l.image)
                    await this.compositor.loadImage(l.image).catch(e => this.toast(`Image decode failed: ${e.message}`, 'error'));
        if (generation !== this.sceneGeneration)
            return;
        $('#mesh-name').textContent = this.mesh.name;
        $('#tri-count').textContent = `${this.mesh.triangleCount.toLocaleString()} tris`;
        $('#project-name').textContent = this.store.state.name;
        $('#doc-tab-name').textContent = this.store.state.name;
        $('#resolution-status').textContent = `${this.store.state.resolution}²`;
        this.dirtySets = new Set(this.store.state.textureSets.map(s => s.id));
        this.renderRight();
        this.updateTextures();
        this.renderer.draw();
        this.drawUV();
    }
    applySettings() { const s = this.store.state.settings; this.renderer.settings.exposure = s.exposure ?? 1.1; this.renderer.settings.rotation = s.rotation ?? 0; this.renderer.settings.environment = ['studio', 'warm', 'night'].indexOf(s.environment ?? 'studio'); }
    updateVisibility() { this.store.state.textureSets.forEach((s, i) => this.renderer.visible[i] = +(s.visible && (!this.isolate || s.id === this.setId))); this.renderer.invalidate(); }
    changed(e) {
        if (this.store.state.resolution !== this.compositor.size) {
            this.compositor.resize(this.store.state.resolution);
            this.renderer.textureSize = 0;
            this.dirtySets = new Set(this.store.state.textureSets.map(s => s.id));
        }
        else
            for (const op of e.operations) {
                if (op.payload.setId)
                    this.dirtySets.add(op.payload.setId);
                else if (op.type === 'history:toggle')
                    this.dirtySets = new Set(this.store.state.textureSets.map(s => s.id));
            }
        if (!this.set.layers.some(l => l.id === this.layerId))
            this.layerId = this.set.layers.at(-1)?.id;
        this.applySettings();
        this.updateVisibility();
        this.renderRight();
        $('#project-name').textContent = this.store.state.name;
        $('#doc-tab-name').textContent = this.store.state.name;
        $('#resolution-status').textContent = `${this.store.state.resolution}²`;
        $('#project-dot').hidden = false;
        $('#save-status').textContent = 'Saving locally…';
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.autosave(), 700);
    }
    async autosave() { if (!this.storageAvailable) {
        $('#save-status').textContent = 'Storage unavailable · Export project to save';
        return;
    } try {
        await this.db.save(this.store);
        await this.db.setting('lastProject', this.store.state.id);
        $('#save-status').textContent = this.collab?.connected ? 'Shared · Local backup saved' : 'All changes saved locally';
        $('#project-dot').hidden = true;
    }
    catch (e) {
        $('#save-status').textContent = 'Local save failed — export a project backup';
        this.toast(`Save failed: ${e.message}`, 'error');
    } }
    async savePreferences() { try {
        const style = getComputedStyle($('.studio'));
        await this.db.setting('preferences', { theme: document.body.classList.contains('light') ? 'light' : 'dark', density: $('.studio').classList.contains('comfortable') ? 'comfortable' : 'compact', right: style.getPropertyValue('--right'), shelf: style.getPropertyValue('--shelf') });
    }
    catch { } }
    updateTextures() { for (const id of this.dirtySets) {
        const index = this.store.state.textureSets.findIndex(s => s.id === id);
        if (index < 0)
            continue;
        const set = this.store.state.textureSets[index], output = this.compositor.compose(set, this.preview?.setId === id ? this.preview : null);
        this.renderer.upload(index, output, this.store.state.textureSets.length);
    } this.dirtySets.clear(); this.drawUV(); }
    loop() { this.raf = requestAnimationFrame(t => { if (!this.ready)
        return; if (this.turntable) {
        this.renderer.camera.yaw += .0035;
        this.renderer.invalidate();
    } if (this.dirtySets.size && (!this.preview || t - this.lastDraw > 45)) {
        this.updateTextures();
        this.lastDraw = t;
    } if (this.renderer.dirty)
        this.renderer.draw(); if (++this.frameCount % 60 === 0)
        $('#perf-label').textContent = `${this.mesh.triangleCount.toLocaleString()} tris · ${this.renderer.frameTime.toFixed(1)} ms ${this.renderer.software ? 'CPU draw' : 'submit'}`; this.loop(); }); }
    renderRight() { this.renderSets(); this.renderLayers(); this.renderProperties(); }
    renderSets() { $('#texture-set-list').innerHTML = this.store.state.textureSets.map((s, i) => `<div class="set-row ${s.id === this.setId ? 'active' : ''}" data-set="${s.id}" tabindex="0"><button data-action="toggle-set" data-id="${s.id}" aria-label="Toggle ${esc(s.name)} visibility">${icon(s.visible ? 'eye' : 'hidden', 13)}</button><span class="swatch" style="background:${s.layers[0]?.color ?? '#888'}"></span><span>${esc(s.name)}</span><span class="resolution">${this.store.state.resolution}²</span>${icon('layers', 11)}</div>`).join(''); $('#uv-set-label').textContent = this.set.name; $('#uv-res-label').textContent = `${this.store.state.resolution} × ${this.store.state.resolution}`; }
    renderLayers() {
        for (const b of $$('[data-side-tab]'))
            b.classList.toggle('active', b.dataset.sideTab === this.sideTab);
        $('#layer-toolbar').style.display = this.sideTab === 'layers' ? 'flex' : 'none';
        const host = $('#layers-list');
        if (this.sideTab === 'history') {
            host.innerHTML = this.store.operations.slice().reverse().map(o => `<div class="history-entry ${this.store.disabled?.get(o.id) ? 'disabled' : ''}">${icon(o.type === 'stroke:add' ? 'brush' : o.type === 'history:toggle' ? 'history' : 'layers', 13)}<div>${esc(o.label ?? o.type)}<div class="time">${esc(o.actor === this.store.actor ? 'You' : o.actor.slice(0, 8))} · ${new Date(o.time ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div></div>`).join('') || '<div class="empty-state">Your editing history appears here.<br>Undo affects only your own operations.</div>';
            return;
        }
        if (this.sideTab === 'notes') {
            host.innerHTML = `<div class="comment-form"><input id="note-text" aria-label="Review note" placeholder="Leave a review note…"><button data-action="note-add" title="Add note">${icon('plus', 13)}</button></div>` + this.store.state.comments.map(c => `<div class="comment ${c.resolved ? 'resolved' : ''}"><div class="comment-head">${icon('chat', 12)}${c.actor === this.store.actor ? 'You' : esc(c.actor?.slice(0, 10))}<span class="spacer"></span><button data-action="resolve-note" data-id="${c.id}" data-resolved="${c.resolved}" title="${c.resolved ? 'Reopen' : 'Resolve'} note">${icon('check', 12)}</button></div>${esc(c.text)}</div>`).join('');
            return;
        }
        host.innerHTML = this.set.layers.slice().reverse().map(l => `<div class="layer-row ${l.id === this.layerId ? 'active' : ''}" data-layer="${l.id}" draggable="true" tabindex="0"><button class="eye-btn" data-action="toggle-layer" data-id="${l.id}" title="Toggle layer visibility">${icon(l.visible ? 'eye' : 'hidden', 13)}</button><span class="layer-thumb" style="${l.type === 'fill' ? `background:${l.color}` : ''}">${icon(l.type === 'paint' ? 'brush' : l.type === 'decal' ? 'image' : 'fill', 14)}</span>${l.mask ? `<span class="layer-thumb mask-thumb ${this.maskSelected && l.id === this.layerId ? 'selected' : ''}" title="Edit layer mask" style="background:${l.mask.base === 'black' ? '#161616' : '#ddd'}"></span>` : ''}<span style="min-width:0"><div class="layer-name">${esc(l.name)}</div><div class="layer-caption">${l.type === 'fill' ? 'FILL · ' + (l.pattern ?? 'solid').toUpperCase() : l.type === 'decal' ? 'DECAL' : l.strokes.length ? `${l.strokes.length} STROKES` : 'PAINT'}${l.mask ? ' · MASK' : ''}</div></span><span class="layer-opacity">${Math.round(l.opacity * 100)}%</span></div>`).join('') || '<div class="empty-state">Add a paint or fill layer to start.</div>';
        $('#blend-mode').value = this.layer?.blend ?? 'normal';
        for (const row of $$('[data-layer]', host))
            row.ondblclick = () => { this.layerId = row.dataset.layer; this.renameLayer(); };
    }
    renderProperties() {
        for (const b of $$('[data-prop-tab]'))
            b.classList.toggle('active', b.dataset.propTab === this.propertyTab);
        const host = $('#property-body'), b = this.brush, l = this.layer;
        if (this.propertyTab === 'display') {
            const s = this.renderer?.settings ?? {};
            host.innerHTML = `<div class="property-title">${icon('sun', 22)}<div><strong>Studio lighting</strong><div class="micro">Procedural environment · GGX shading</div></div></div><div class="property-row">Environment<select id="environment-select"><option value="studio">Neutral studio</option><option value="warm">Warm studio</option><option value="night">Cool evening</option></select></div>${slider('Exposure', 'exposure', s.exposure ?? 1.1, .1, 4, .01, 'display')}${slider('Environment rotation', 'rotation', s.rotation ?? 0, -3.14, 3.14, .01, 'display')}${slider('Bump strength', 'normalStrength', s.normalStrength ?? 1, 0, 5, .05, 'display')}<div class="property-section"><h4>Viewport</h4><div class="property-row">${button('wireframe', 'Wireframe', 'grid', 'secondary')}${button('orthographic', 'Orthographic', 'cube', 'secondary')}</div><div class="property-row">${button('snapshot', 'Save render', 'camera', 'secondary')}${button('frame', 'Frame', 'maximize', 'secondary')}</div><div class="property-note">Lighting uses a procedural studio environment and rasterized PBR shading. The floor contact shadow is an artistic approximation, not ray tracing.</div></div>`;
            $('#environment-select').value = this.store.state.settings.environment ?? 'studio';
            return;
        }
        if (this.propertyTab === 'layer') {
            if (!l) {
                host.innerHTML = '<div class="empty-state">No layer selected</div>';
                return;
            }
            host.innerHTML = `<div class="property-title"><span class="layer-thumb">${icon(l.type === 'fill' ? 'fill' : l.type === 'decal' ? 'image' : 'brush', 24)}</span><div><strong>${esc(l.name)}</strong><div class="micro">${l.type === 'paint' ? 'Non-destructive paint strokes' : l.type === 'fill' ? 'Procedural material fill' : 'Image projection into UV space'}</div></div></div><div class="property-row">Name<input type="text" data-layer-prop="name" maxlength="200" value="${esc(l.name)}"></div>${slider('Layer opacity', 'opacity', l.opacity)}<div class="property-section"><h4>Material channels</h4><div class="channel-pills">${CHANNELS.map(c => `<button data-action="layer-channel" data-channel="${c}" class="${l.channels.includes(c) ? 'active' : ''}">${channelNames[c]}</button>`).join('')}</div></div>`;
            if (l.type === 'fill')
                host.insertAdjacentHTML('beforeend', `<div class="property-row">Base color<input type="color" data-layer-prop="color" value="${l.color}"></div><div class="property-row">Pattern<select data-layer-prop="pattern">${['solid', 'painted', 'brushed', 'rust', 'copper', 'carbon', 'fabric', 'leather', 'wood', 'marble', 'concrete', 'camouflage', 'hex', 'noise', 'wear', 'dust', 'checker', 'stripes'].map(p => `<option ${p === l.pattern ? 'selected' : ''}>${p}</option>`).join('')}</select></div>${slider('Roughness', 'roughness', l.roughness)}${slider('Metallic', 'metallic', l.metallic)}${slider('Height', 'height', l.height)}${slider('Emission', 'emissive', l.emissive, 0, 2)}${slider('Pattern scale', 'scale', l.scale, 1, 40, .2)}`);
            if (l.type === 'decal') {
                const t = l.transform;
                host.insertAdjacentHTML('beforeend', `${slider('Horizontal position', 'u', t.u, 0, 1, .001, 'decal')}${slider('Vertical position', 'v', t.v, 0, 1, .001, 'decal')}${slider('Scale', 'scale', t.scale, .01, 2, .005, 'decal')}${slider('Rotation', 'angle', t.angle, -180, 180, 1, 'decal')}`);
            }
            if (l.mask)
                host.insertAdjacentHTML('beforeend', `<div class="property-section"><h4>${icon('mask', 12)} Layer mask</h4><div class="property-row">${button('invert-mask', 'Invert', 'mask', 'secondary')}${button('remove-mask', 'Remove', 'trash', 'secondary')}</div><p class="property-note">Select the mask thumbnail to paint white. Use the eraser to paint black.</p></div>`);
            return;
        }
        host.innerHTML = `<div class="property-title"><div class="preview-brush" style="background:radial-gradient(circle,${b.color} 0,transparent ${Math.round(45 + b.hardness * 35)}%),#17191d"></div><div><strong>${esc(b.name ?? 'Custom brush')}</strong><div class="micro">${this.maskSelected ? 'Painting layer mask' : toolInfo[this.tool][1]} · ${b.pressure ? 'Pressure sensitive' : 'Constant pressure'}</div></div><div class="spacer"></div>${icon('brush', 15)}</div><div class="property-row">Brush shape<select id="brush-shape">${BRUSHES.map(a => `<option value="${a.id}" ${a.id === b.id ? 'selected' : ''}>${a.name}</option>`).join('')}</select></div>${slider('Flow', 'flow', b.flow, 0, 1, .01, 'brush')}${slider('Hardness', 'hardness', b.hardness, 0, 1, .01, 'brush')}${slider('Spacing', 'spacing', b.spacing, .01, 2, .01, 'brush')}${slider('Angle', 'angle', b.angle, -180, 180, 1, 'brush')}${slider('Scatter', 'scatter', b.scatter, 0, 2, .01, 'brush')}<div class="property-section"><h4>Paint channels</h4><div class="channel-pills">${CHANNELS.map(c => `<button data-action="channel" data-channel="${c}" class="${b.channels.includes(c) ? 'active' : ''}">${channelNames[c]}</button>`).join('')}</div><div class="property-row">Base color<span class="color-preview"><span>${b.color.toUpperCase()}</span><input type="color" id="property-brush-color" aria-label="Paint base color" value="${b.color}"></span></div><div class="palette-swatches">${['#dfbe87', '#d47535', '#799fa2', '#e3e4da', '#9f4240', '#2e353e', '#788064', '#6f6596', '#ffffff', '#000000'].map(c => `<button data-action="swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}"></button>`).join('')}</div>${b.channels.includes('roughness') ? slider('Roughness', 'roughness', b.roughness, 0, 1, .01, 'brush') : ''}${b.channels.includes('metallic') ? slider('Metallic', 'metallic', b.metallic, 0, 1, .01, 'brush') : ''}${b.channels.includes('height') ? slider('Height', 'height', b.height, 0, 1, .01, 'brush') : ''}${b.channels.includes('emissive') ? slider('Emission', 'emissive', b.emissive, 0, 2, .01, 'brush') : ''}${b.channels.includes('opacity') ? slider('Opacity', 'opacity', b.opacity ?? 1, 0, 1, .01, 'brush') : ''}<p class="property-note">${this.maskSelected ? 'Mask painting: white reveals, black conceals.' : 'Only enabled channels are painted. Hold Shift for a straight stroke; [ and ] resize the brush.'}</p></div>`;
        $('#brush-shape').onchange = e => { Object.assign(this.brush, BRUSHES.find(b => b.id === e.target.value)); this.syncToolbar(); this.renderProperties(); };
        $('#property-brush-color').oninput = e => this.setBrushColor(e.target.value);
    }
    renderAssets() { for (const b of $$('[data-asset-tab]'))
        b.classList.toggle('active', b.dataset.assetTab === this.assetTab); for (const b of $$('[data-category]'))
        b.classList.toggle('active', b.dataset.category === this.assetCategory); let list = this.assetTab === 'brushes' ? BRUSHES : MATERIALS.filter(m => this.assetTab === 'generators' ? m.category === 'Generators' : this.assetCategory === 'All assets' || m.category === this.assetCategory); list = list.filter(m => `${m.name} ${m.category ?? ''}`.toLowerCase().includes(this.assetQuery.toLowerCase())); $('#asset-count').textContent = `${list.length} assets`; $('#asset-grid').innerHTML = list.map(m => { let img = ''; if (m.color) {
        if (!this.thumbnails.has(m.id))
            this.thumbnails.set(m.id, materialThumbnail(m));
        img = `<img src="${this.thumbnails.get(m.id)}" alt="${esc(m.name)} material preview" draggable="false">`;
    }
    else {
        const symbol = { round: '●', noise: '▧', spray: '⁙', square: '■', scratch: '╱', star: '★', ring: '◯' }[m.shape];
        img = `<div class="brush-thumb">${symbol}</div>`;
    } return `<button class="asset ${m.id === this.selectedAsset ? 'selected' : ''}" data-asset="${m.id}" draggable="${!!m.color}" title="${m.color ? 'Apply ' + m.name + ' as a new fill layer' : 'Select ' + m.name + ' brush'}">${img}<span class="asset-name">${m.name}</span><span class="asset-type">${m.color ? m.category : 'Brush'}</span></button>`; }).join('') || '<div class="empty-state">No matching assets</div>'; }
    applyAsset(id) { const brush = BRUSHES.find(b => b.id === id); if (brush) {
        Object.assign(this.brush, brush);
        this.setTool('paint');
        this.syncToolbar();
        this.renderProperties();
    }
    else {
        const m = MATERIALS.find(m => m.id === id);
        if (!m)
            return;
        this.addLayer('fill', m.name, { ...m, id: uid() });
        this.propertyTab = 'layer';
        this.renderProperties();
        this.toast(`${m.name} applied to ${this.set.name}`, 'success');
    } this.selectedAsset = id; this.renderAssets(); }
    selectSet(id) { this.setId = id; this.layerId = this.set.layers.at(-1)?.id; this.maskSelected = false; this.renderRight(); this.updateVisibility(); this.drawUV(); }
    setBrushColor(color) { this.brush.color = color; $('#brush-color').value = $('#rail-color').value = color; if ($('#property-brush-color'))
        $('#property-brush-color').value = color; }
    syncToolbar() { $('#brush-size').value = Math.round(this.brush.size * this.store.state.resolution); $('#brush-flow').value = Math.round(this.brush.flow * 100); $('#brush-hardness').value = this.brush.hardness; $('#brush-spacing').value = Math.round(this.brush.spacing * 100); }
    setTool(tool) { this.tool = tool; if (tool === 'decal') {
        this.run('import-decal');
        return;
    } if (tool === 'mask') {
        if (!this.layer?.mask) {
            this.maskMenu();
            return;
        }
        this.maskSelected = true;
    }
    else if (tool !== 'erase')
        this.maskSelected = false; for (const b of $$('[data-tool]')) {
        b.classList.toggle('active', b.dataset.tool === tool);
        b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    } const [ico, name, key] = toolInfo[tool]; $('#tool-title').innerHTML = `${icon(ico)} ${name} <span class="shortcut">${key}</span>`; this.renderProperties(); }
    setView(view) { this.view = view; $('.viewport-layout').className = `viewport-layout view-mode-${view}`; for (const b of $$('[data-view]'))
        b.classList.toggle('active', b.dataset.view === view); requestAnimationFrame(() => { this.renderer.resize(); this.renderer.invalidate(); this.drawUV(); }); }
    addLayer(type, name, props = {}) { const l = createLayer(type, name ?? (type === 'paint' ? `Paint layer ${String(this.set.layers.filter(l => l.type === 'paint').length + 1).padStart(2, '0')}` : 'Fill layer'), { color: this.brush.color, roughness: this.brush.roughness, metallic: this.brush.metallic, ...props }); this.layerId = l.id; this.maskSelected = false; this.store.dispatch('layer:add', { setId: this.set.id, layer: l }, `Add ${l.name}`); this.renderRight(); return l; }
    patchLayer(patch) { if (!this.layer)
        return; this.store.dispatch('layer:set', { setId: this.set.id, layerId: this.layer.id, patch }, `Edit ${Object.keys(patch).join(', ')}`); }
    duplicateLayer() { if (!this.layer)
        return; const l = structuredClone(this.layer); l.id = uid(); l.name += ' copy'; l.strokes = l.strokes.map(s => ({ ...s, id: uid() })); this.layerId = l.id; this.store.dispatch('layer:add', { setId: this.set.id, layer: l }, 'Duplicate layer'); }
    deleteLayer() { if (!this.layer)
        return; this.store.dispatch('layer:delete', { setId: this.set.id, layerId: this.layer.id }, 'Delete layer'); }
    moveLayer(delta) { const ix = this.set.layers.findIndex(l => l.id === this.layerId); if (ix >= 0)
        this.store.dispatch('layer:move', { setId: this.set.id, layerId: this.layerId, index: clamp(ix + delta, 0, this.set.layers.length - 1) }, 'Move layer'); }
    renameLayer() { if (!this.layer)
        return; this.modal('Rename layer', `<div class="form-row"><label>Layer name</label><input id="rename-input" value="${esc(this.layer.name)}"></div>`, [{ label: 'Rename', primary: true, run: () => { const name = $('#rename-input').value.trim(); if (name)
                this.patchLayer({ name }); this.closeModal(); } }]); $('#rename-input').select(); }
    maskMenu() { if (!this.layer) {
        this.toast('Select a layer first');
        return;
    } this.modal('Add a layer mask', '<p class="subtle">A white mask reveals the layer. A black mask conceals it until painted.</p>', [{ label: 'White mask', run: () => { this.patchLayer({ mask: { base: 'white', invert: false } }); this.maskSelected = true; this.closeModal(); this.renderRight(); } }, { label: 'Black mask', primary: true, run: () => { this.patchLayer({ mask: { base: 'black', invert: false } }); this.maskSelected = true; this.closeModal(); this.renderRight(); } }]); }
    hit3D(e) { const rect = this.renderer.canvas.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
        return null; const x = (e.clientX - rect.left) / rect.width * 2 - 1, y = 1 - (e.clientY - rect.top) / rect.height * 2, ray = this.renderer.camera.ray(x, y, rect.width / rect.height); return this.bvh.intersect(ray.origin, ray.direction, { visible: this.renderer.visible }); }
    uvRect() { const c = $('#viewport2d'), w = c.clientWidth, h = c.clientHeight, size = Math.min(w, h) * .82 * this.uv.zoom; return { size, x: (w - size) / 2 + this.uv.x, y: (h - size) / 2 + this.uv.y }; }
    hitUV(e) { const rect = $('#viewport2d').getBoundingClientRect(), r = this.uvRect(), u = (e.clientX - rect.left - r.x) / r.size, v = 1 - (e.clientY - rect.top - r.y) / r.size; return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { uv: [u, v], material: this.store.state.textureSets.findIndex(s => s.id === this.setId) } : null; }
    bindViewport(canvas, isUV) {
        let drag = null, lastHover = 0;
        canvas.oncontextmenu = e => e.preventDefault();
        canvas.onpointerdown = e => {
            canvas.focus();
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            const nav = e.button === 1 || e.button === 2 || e.altKey || this.tool === 'pan';
            drag = { x: e.clientX, y: e.clientY, nav, pan: e.button === 1 || e.shiftKey && nav, isUV };
            if (nav)
                return;
            const hit = isUV ? this.hitUV(e) : this.hit3D(e);
            if (!hit) {
                drag = null;
                return;
            }
            const sid = this.store.state.textureSets[hit.material]?.id;
            if (sid && sid !== this.setId)
                this.selectSet(sid);
            if (this.tool === 'picker') {
                this.pickColor(hit.uv);
                drag = null;
                return;
            }
            if (this.tool === 'fill') {
                this.addLayer('fill', 'Material fill', { color: this.brush.color, roughness: this.brush.roughness, metallic: this.brush.metallic });
                drag = null;
                return;
            }
            if (this.tool === 'decal') {
                drag = null;
                return;
            }
            if (!this.maskSelected && this.layer?.type !== 'paint')
                this.addLayer('paint');
            if (!this.layer) {
                drag = null;
                return;
            }
            if (!this.brush.channels.length && !this.maskSelected) {
                this.toast('Enable at least one paint channel');
                drag = null;
                return;
            }
            const stroke = { id: uid(), target: this.maskSelected ? 'mask' : 'paint', brush: { ...structuredClone(this.brush), erase: this.tool === 'erase', seed: Math.floor(Math.random() * 1e6) }, points: [] };
            this.preview = { setId: this.setId, layerId: this.layer.id, stroke };
            this.appendPoint(e, hit);
            drag.paint = true;
        };
        canvas.onpointermove = e => {
            const cursor = $(isUV ? '#cursor2d' : '#cursor3d'), rect = canvas.getBoundingClientRect();
            cursor.style.left = `${e.clientX - rect.left}px`;
            cursor.style.top = `${e.clientY - rect.top}px`;
            const diameter = isUV ? this.brush.size * this.uvRect().size : Math.max(8, this.brush.size * canvas.clientHeight * .9);
            cursor.style.width = cursor.style.height = `${diameter}px`;
            cursor.style.display = ['paint', 'erase', 'mask'].includes(this.tool) && !e.altKey ? 'block' : 'none';
            if (drag?.nav) {
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                if (isUV) {
                    this.uv.x += dx;
                    this.uv.y += dy;
                    this.drawUV();
                }
                else {
                    drag.pan ? this.renderer.camera.pan(dx, dy) : this.renderer.camera.orbit(dx, dy);
                    this.renderer.invalidate();
                }
                drag.x = e.clientX;
                drag.y = e.clientY;
                return;
            }
            if (drag?.paint && this.preview) {
                const events = e.getCoalescedEvents?.() ?? [e];
                for (const event of events.length ? events : [e]) {
                    const hit = isUV ? this.hitUV(event) : this.hit3D(event);
                    if (hit && this.store.state.textureSets[hit.material]?.id === this.preview.setId)
                        this.appendPoint(event, hit);
                    else
                        this.breakStroke = true;
                }
                return;
            }
            if (this.collab?.connected && performance.now() - lastHover > 80) {
                lastHover = performance.now();
                this.collab.cursor({ view: isUV ? '2d' : '3d', x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, setId: this.setId });
            }
        };
        const end = e => { if (this.preview && drag?.paint) {
            const p = this.preview;
            this.preview = null;
            this.breakStroke = false;
            this.store.dispatch('stroke:add', { setId: p.setId, layerId: p.layerId, stroke: p.stroke }, p.stroke.target === 'mask' ? 'Paint mask' : this.tool === 'erase' ? 'Erase stroke' : 'Paint stroke');
            this.dirtySets.add(p.setId);
        } drag = null; if (canvas.hasPointerCapture(e.pointerId))
            canvas.releasePointerCapture(e.pointerId); };
        canvas.onpointerup = end;
        canvas.onpointercancel = e => { if (this.preview) {
            this.dirtySets.add(this.preview.setId);
            this.preview = null;
        } drag = null; };
        canvas.onpointerleave = () => $(isUV ? '#cursor2d' : '#cursor3d').style.display = 'none';
        canvas.addEventListener('wheel', e => { e.preventDefault(); if (isUV) {
            this.uv.zoom = clamp(this.uv.zoom * Math.exp(-e.deltaY * .001), .25, 8);
            this.drawUV();
        }
        else {
            this.renderer.camera.zoom(e.deltaY);
            this.renderer.invalidate();
        } }, { passive: false });
    }
    appendPoint(e, hit) { if (this.preview.stroke.points.length >= 29990)
        return; const stroke = this.preview.stroke, [u, v] = hit.uv, pressure = e.pointerType === 'pen' ? Math.max(.08, e.pressure) : 1, p = [clamp(u, 0, 1), clamp(v, 0, 1), pressure, this.breakStroke ? 1 : 0]; this.breakStroke = false; if (e.shiftKey && stroke.points.length > 1)
        stroke.points = stroke.points.slice(0, 1); const last = stroke.points.at(-1); if (!last || Math.hypot(last[0] - u, last[1] - v) > .0002) {
        stroke.points.push(p);
        this.dirtySets.add(this.preview.setId);
    } if (stroke.points.length >= 29990)
        this.toast('Stroke limit reached. Release the pointer to continue in a new stroke.'); }
    pickColor(uv) { const out = this.compositor.outputs.get(this.setId); if (!out)
        return; const n = this.compositor.size, d = out.color.getContext('2d').getImageData(clamp(Math.floor(uv[0] * n), 0, n - 1), clamp(Math.floor((1 - uv[1]) * n), 0, n - 1), 1, 1).data; const color = '#' + [...d].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join(''); this.setBrushColor(color); this.setTool('paint'); this.toast(`Sampled ${color.toUpperCase()}`); }
    drawUV() {
        if (!this.compositor || !this.mesh)
            return;
        const c = $('#viewport2d');
        if (!c.clientWidth || !c.clientHeight)
            return;
        const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
        if (c.width !== w || c.height !== h) {
            c.width = w;
            c.height = h;
        }
        const ctx = c.getContext('2d'), r = this.uvRect(), out = this.compositor.outputs.get(this.setId);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#25282d';
        ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.fillStyle = '#31343a';
        ctx.fillRect(-1, -1, r.size + 2, r.size + 2);
        for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
                ctx.fillStyle = (x + y) % 2 ? '#303339' : '#353940';
                ctx.fillRect(x * r.size / 8, y * r.size / 8, r.size / 8, r.size / 8);
            }
        if (out) {
            let src = this.displayChannel === 'material' || this.displayChannel === 'checker' ? out.color : this.displayChannel === 'normal' ? this.compositor.normalMap(this.setId) : out.maps[this.displayChannel] ?? out.color;
            ctx.drawImage(src, 0, 0, r.size, r.size);
        }
        let path = this.uvPaths?.get(this.setId);
        if (!path) {
            path = new Path2D();
            const v = this.mesh.vertices, m = this.store.state.textureSets.findIndex(s => s.id === this.setId);
            for (let i = 0; i < v.length; i += 27)
                if (Math.round(v[i + 8]) === m) {
                    path.moveTo(v[i + 6], 1 - v[i + 7]);
                    path.lineTo(v[i + 15], 1 - v[i + 16]);
                    path.lineTo(v[i + 24], 1 - v[i + 25]);
                    path.closePath();
                }
            this.uvPaths?.set(this.setId, path);
        }
        ctx.scale(r.size, r.size);
        ctx.strokeStyle = '#d9d5c861';
        ctx.lineWidth = .55 / r.size;
        ctx.stroke(path);
        ctx.restore();
        ctx.fillStyle = '#959ca9';
        ctx.font = '9px system-ui';
        ctx.fillText('1001', r.x + 5, r.y + r.size + 16);
        ctx.strokeStyle = '#858a9766';
        ctx.strokeRect(r.x - .5, r.y - .5, r.size + 1, r.size + 1);
        $('#uv-zoom').textContent = `${Math.round(this.uv.zoom * 100)}%`;
    }
    keydown(e) {
        const typing = ['INPUT', 'TEXTAREA', 'SELECT', 'CF-SLIDER'].includes(e.target.tagName) || e.target.isContentEditable;
        if (e.key === 'Escape') {
            this.closeMenus();
            this.closeModal();
            if (this.preview) {
                this.dirtySets.add(this.preview.setId);
                this.preview = null;
            }
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            this.run('palette');
            return;
        }
        if (typing || $('.modal-backdrop'))
            return;
        const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
        let cmd = null;
        if (mod) {
            if (key === 'z')
                cmd = e.shiftKey ? 'redo' : 'undo';
            if (key === 'y')
                cmd = 'redo';
            if (key === 's')
                cmd = 'save';
            if (key === 'o')
                cmd = 'open';
            if (key === 'n')
                cmd = 'new';
            if (key === 'd')
                cmd = 'duplicate-layer';
            if (key === 'e' && e.shiftKey)
                cmd = 'export';
        }
        else {
            if (key === 'f')
                cmd = 'frame';
            if (key === 'w')
                cmd = 'wireframe';
            if (key === 'delete' || key === 'backspace')
                cmd = 'delete-layer';
            if (key === 'tab')
                cmd = 'focus';
            if (key === 'f1')
                cmd = 'view-split';
            if (key === 'f2')
                cmd = 'view-3d';
            if (key === 'f3')
                cmd = 'view-2d';
            if (key === '?')
                cmd = 'help';
            const tools = { b: 'paint', e: 'erase', g: 'fill', i: 'picker', h: 'pan', u: 'mask', d: 'decal' };
            if (tools[key]) {
                e.preventDefault();
                this.setTool(tools[key]);
                return;
            }
            if (key === '[' || key === ']') {
                e.preventDefault();
                this.brush.size = clamp(this.brush.size * (key === ']' ? 1.15 : 1 / 1.15), 1 / this.store.state.resolution, .4);
                this.syncToolbar();
                return;
            }
            if (key === 'c') {
                const values = Object.keys(modeChannel);
                this.displayChannel = values[(values.indexOf(this.displayChannel) + 1) % values.length];
                $('#channel-view').value = this.displayChannel;
                this.renderer.settings.channel = modeChannel[this.displayChannel];
                this.renderer.invalidate();
                this.drawUV();
                return;
            }
        }
        if (cmd) {
            e.preventDefault();
            this.run(cmd);
        }
    }
    toast(message, type = '') { const host = $('.toast-container'), el = document.createElement('div'); el.className = `toast ${type}`; el.innerHTML = icon(type === 'error' ? 'info' : type === 'success' ? 'check' : 'info', 15) + `<span>${esc(message)}</span>`; host.append(el); setTimeout(() => el.remove(), type === 'error' ? 8500 : 4300); while (host.children.length > 4)
        host.firstElementChild.remove(); }
    openMenu(anchor, items) { this.closeMenus(); const r = anchor.getBoundingClientRect(), el = document.createElement('div'); el.className = 'dropdown-menu'; el.setAttribute('role', 'menu'); el.innerHTML = items.map(id => { if (!id)
        return '<hr>'; const c = this.commands.commands.get(id); return `<button role="menuitem" data-command="${id}">${icon(c.icon || 'chevron', 13)}${esc(c.label)}<span class="command-key">${c.key ?? ''}</span></button>`; }).join(''); document.body.append(el); el.style.left = `${Math.min(r.left, innerWidth - el.offsetWidth - 9)}px`; el.style.top = `${Math.min(r.bottom + 3, innerHeight - el.offsetHeight - 9)}px`; el.querySelector('button')?.focus(); el.onkeydown = e => { const buttons = $$('button', el), i = buttons.indexOf(document.activeElement); if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } if (e.key === 'Escape')
        this.closeMenus(); }; }
    closeMenus() { $$('.dropdown-menu').forEach(e => e.remove()); }
    modal(title, content, actions = [], wide = false) { this.closeMenus(); this.closeModal(); this.previousFocus = document.activeElement; const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = `<section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-header"><h2 id="dialog-title">${esc(title)}</h2><button class="close" aria-label="Close dialog">${icon('close', 18)}</button></header><div class="modal-content">${content}</div><footer class="modal-footer"><button class="cancel">Cancel</button>${actions.map((a, i) => `<button class="${a.primary ? 'primary' : 'secondary'}" data-modal-action="${i}">${esc(a.label)}</button>`).join('')}</footer></section>`; document.body.append(backdrop); $('.close', backdrop).onclick = $('.cancel', backdrop).onclick = () => this.closeModal(); backdrop.onpointerdown = e => { if (e.target === backdrop)
        this.closeModal(); }; for (const b of $$('[data-modal-action]', backdrop))
        b.onclick = async () => { try {
            b.disabled = true;
            await actions[+b.dataset.modalAction].run();
        }
        catch (e) {
            this.toast(e.message, 'error');
            console.error(e);
        }
        finally {
            b.disabled = false;
        } }; backdrop.onkeydown = e => { if (e.key === 'Tab') {
        const list = $$('button:not(:disabled),input,textarea,select,[tabindex="0"]', backdrop).filter(e => e.offsetParent !== null);
        if (!list.length)
            return;
        if (e.shiftKey && document.activeElement === list[0]) {
            e.preventDefault();
            list.at(-1).focus();
        }
        else if (!e.shiftKey && document.activeElement === list.at(-1)) {
            e.preventDefault();
            list[0].focus();
        }
    } }; setTimeout(() => ($('input', backdrop) ?? $('.close', backdrop))?.focus(), 0); return backdrop; }
    closeModal() { $$('.modal-backdrop').forEach(el => el.remove()); this.bakeAbort?.abort(); this.bakeAbort = null; if (this.previousFocus?.isConnected)
        this.previousFocus.focus(); }
    commandPalette() { const el = this.modal('Command search', `<div class="command-palette"><label class="search-input">${icon('search', 17)}<input id="command-search" placeholder="Type a command…" autocomplete="off"></label><div class="command-results" id="command-results"></div></div>`, []); $('.modal-footer', el).style.display = 'none'; const render = () => { $('#command-results').innerHTML = this.commands.search($('#command-search').value).map(c => `<button data-palette-command="${c.id}">${icon(c.icon || 'chevron', 14)}${esc(c.label)}<span class="command-key">${c.key}</span></button>`).join(''); $$('[data-palette-command]', el).forEach(b => b.onclick = () => { const id = b.dataset.paletteCommand; this.closeModal(); this.run(id); }); }; $('#command-search').oninput = render; $('#command-search').onkeydown = e => { if (e.key === 'Enter')
        $('[data-palette-command]', el)?.click(); if (e.key === 'ArrowDown') {
        e.preventDefault();
        $('[data-palette-command]', el)?.focus();
    } }; render(); }
    chooseFiles(accept, multiple, fn) { const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple; input.onchange = () => { if (input.files.length)
        Promise.resolve(fn([...input.files])).catch(e => this.toast(e.message, 'error')); }; input.click(); }
    async saveProject() { await this.autosave(); downloadBlob(new Blob([JSON.stringify(this.store.serialize())], { type: 'application/json' }), `${this.store.state.name.replace(/[^a-z0-9_-]+/gi, '-')}.cforge`); this.toast('Project file exported with editable layers and stroke history.', 'success'); }
    async openProject(file) { if (file.size > 100 * 1024 * 1024)
        throw Error('Project file exceeds the 100 MB import limit'); await this.autosave(); this.collab.disconnect(); const data = JSON.parse(await file.text()); this.store.load(data); this.autosave(); this.toast(`Opened ${file.name}`, 'success'); }
    newDialog() { let model = 'nomad'; this.modal('Create a material project', `<p class="subtle">Start with a sample mesh, or import your own geometry after creating a project.</p><div class="form-row"><label>Project name</label><input id="new-name" maxlength="200" value="Untitled material project"></div><div class="model-cards">${[['nomad', 'Survey camera', 'camera'], ['sphere', 'Material sphere', 'globe'], ['cube', 'Rounded cube', 'cube'], ['torus', 'Material torus', 'palette']].map(([id, name, ico]) => `<button class="model-card ${id === 'nomad' ? 'active' : ''}" data-model="${id}">${icon(ico, 30)}${name}</button>`).join('')}</div><div class="form-row"><label>Texture resolution</label><select id="new-resolution"><option>256</option><option>512</option><option selected>1024</option><option>2048</option><option>4096</option></select></div><p class="property-note">4096² textures can require several gigabytes of memory with multiple sets and layers. Resolution can be changed later; strokes replay at the new size.</p>`, [{ label: 'Create project', primary: true, run: async () => { await this.autosave(); this.collab.disconnect(); const p = createProject(model, +$('#new-resolution').value); p.name = $('#new-name').value.trim() || 'Untitled material project'; this.closeModal(); this.store.load({ format: 'chromaforge', version: 1, base: p, operations: [] }); await this.autosave(); } }]); $$('[data-model]').forEach(b => b.onclick = () => { model = b.dataset.model; $$('[data-model]').forEach(x => x.classList.toggle('active', x === b)); }); }
    async projectLibrary() { const rows = (await this.db.list()).sort((a, b) => b.updated - a.updated); this.modal('Local project library', rows.length ? rows.map(p => `<div class="project-item">${icon('cube', 26)}<div class="project-info"><strong>${esc(p.name)}</strong><small>Saved ${new Date(p.updated).toLocaleString()}</small></div><button class="secondary" data-open-project="${p.id}">Open</button><button class="danger" data-delete-project="${p.id}" aria-label="Delete saved project">${icon('trash', 15)}</button></div>`).join('') : '<div class="empty-state">No saved projects yet. Your current document is saved automatically after editing.</div>'); $$('[data-open-project]').forEach(b => b.onclick = async () => { await this.autosave(); const row = await this.db.get(b.dataset.openProject); this.collab.disconnect(); this.closeModal(); this.store.load(row.data); await this.db.setting('lastProject', row.id); }); $$('[data-delete-project]').forEach(b => b.onclick = async () => { await this.db.delete(b.dataset.deleteProject); b.closest('.project-item').remove(); }); }
    async importMesh(files) { const main = files.find(f => /\.(obj|gltf|glb)$/i.test(f.name)); if (!main)
        throw Error('Choose an OBJ, GLB, or glTF mesh'); if (main.size > 100 * 1024 * 1024)
        throw Error('Mesh file exceeds 100 MB'); this.toast(`Importing ${main.name}…`); let mesh; if (/\.obj$/i.test(main.name))
        mesh = parseOBJ(await main.text(), main.name);
    else
        mesh = await parseGLTF(/\.glb$/i.test(main.name) ? await main.arrayBuffer() : await main.text(), { name: main.name, resolve: async (uri) => { const f = files.find(f => f.name === decodeURIComponent(uri.split('/').pop())); if (!f)
                throw Error(`Missing resource ${uri}. Select the .gltf and .bin files together.`); return f.arrayBuffer(); } }); await this.autosave(); this.collab.disconnect(); let p = createProject('imported', this.store.state.resolution); p.name = main.name.replace(/\.[^.]+$/, ''); p.mesh = mesh.toJSON(); p.textureSets = mesh.materials.map((name, i) => ({ id: `set-${i}`, name, visible: true, layers: [createLayer('fill', 'Base material', { color: '#8c989e' }), createLayer('paint', 'Paint layer 01')] })); this.store.load({ format: 'chromaforge', version: 1, base: p, operations: [] }); this.autosave(); this.toast(`Imported ${mesh.triangleCount.toLocaleString()} triangles and ${mesh.materials.length} texture sets`, 'success'); for (const w of mesh.warnings ?? [])
        this.toast(w); }
    async importDecal(file) { if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw Error('Choose a PNG, JPEG or WebP image'); if (file.size > 8 * 1024 * 1024)
        throw Error('Decals are limited to 8 MB'); const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file); }); await this.compositor.loadImage(data); this.addLayer('decal', file.name, { image: data, channels: ['baseColor'], transform: { u: .5, v: .5, scale: .25, angle: 0 } }); this.propertyTab = 'layer'; this.setTool('paint'); this.renderProperties(); this.toast('Decal added. Adjust its UV position, scale, and rotation in Layer properties.', 'success'); }
    textDecalDialog() { this.modal('Create a text decal', `<div class="form-row"><label>Text</label><input id="decal-text" value="NOMAD / 07" maxlength="200"></div><div class="form-grid"><div class="form-row"><label>Text color</label><input type="color" id="decal-color" value="#e9dfc6"></div><div class="form-row"><label>Font weight</label><select id="decal-weight"><option value="500">Medium</option><option value="700" selected>Bold</option></select></div></div><p class="property-note">Text is rasterized into a portable image layer. Adjust placement in Layer properties.</p>`, [{ label: 'Add decal', primary: true, run: async () => { const c = makeCanvas(1024), ctx = c.getContext('2d'), text = $('#decal-text').value; ctx.fillStyle = $('#decal-color').value; ctx.font = `${$('#decal-weight').value} 120px system-ui`; const width = ctx.measureText(text).width; ctx.font = `${$('#decal-weight').value} ${Math.min(120, 880 / width * 120)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 512, 512); const data = c.toDataURL(); await this.compositor.loadImage(data); this.addLayer('decal', text || 'Text decal', { image: data, channels: ['baseColor'], transform: { u: .5, v: .5, scale: .4, angle: 0 } }); this.closeModal(); this.propertyTab = 'layer'; this.renderProperties(); } }]); }
    projectSettings() { this.modal('Project & texture settings', `<div class="form-row"><label>Project name</label><input id="project-title-edit" value="${esc(this.store.state.name)}"></div><div class="form-grid"><div class="form-row"><label>Texture resolution</label><select id="settings-resolution">${[256, 512, 1024, 2048, 4096].map(n => `<option ${n === this.store.state.resolution ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="form-row"><label>Active texture set name</label><input id="set-name-edit" value="${esc(this.set.name)}"></div></div><div class="notice info">${this.mesh.triangleCount.toLocaleString()} triangles · ${this.store.state.textureSets.length} texture sets · ${this.store.operations.length} operations. Mesh replacement creates a new document so incompatible UV paint is not silently transferred.</div><div class="property-note">All maps are 8-bit. The viewport uses approximate sRGB conversion; certified ACES/OpenColorIO workflows and virtual UDIM texture streaming are not included.</div>`, [{ label: 'Apply settings', primary: true, run: () => { this.store.dispatch('project:set', { patch: { name: $('#project-title-edit').value.trim() || 'Untitled', resolution: +$('#settings-resolution').value } }, 'Project settings'); this.store.dispatch('set:set', { setId: this.setId, patch: { name: $('#set-name-edit').value.trim() || this.set.name } }, 'Rename texture set'); this.closeModal(); } }]); }
    exportDialog() { this.modal('Export textures', `<div class="notice info">Export the composited PBR channels as PNG images in one ZIP archive. The packed ORM map stores constant occlusion (R), roughness (G), and metallic (B).</div><div class="form-grid"><div class="form-row"><label>Output scope</label><select id="export-scope"><option value="all">All texture sets</option><option value="active">Active texture set only</option></select></div><div class="form-row"><label>File naming</label><select id="export-preset"><option value="pbr">PBR Metal / Rough</option><option value="engine">Packed game-engine maps</option></select></div></div><div class="checklist">${['baseColor', 'roughness', 'metallic', 'normal', 'height', 'emissive', 'opacity', 'orm'].map(ch => `<label><input type="checkbox" data-export-channel="${ch}" ${['baseColor', 'roughness', 'metallic', 'normal', 'height'].includes(ch) ? 'checked' : ''}>${channelNames[ch] ?? (ch === 'orm' ? 'Packed ORM' : 'Tangent normal from height')}</label>`).join('')}</div><p class="property-note">Resolution: ${this.store.state.resolution}² · PNG, 8-bit per channel. Height-derived tangent normals are not a high-poly normal bake.</p><div id="export-status"></div>`, [{ label: 'Export ZIP', primary: true, run: async () => { const channels = $$('[data-export-channel]:checked').map(e => e.dataset.exportChannel); if (!channels.length)
                throw Error('Select at least one channel'); this.updateTextures(); const sets = $('#export-scope').value === 'all' ? this.store.state.textureSets : [this.set], files = {}; $('#export-status').innerHTML = '<p class="subtle">Encoding texture maps…</p>'; for (const s of sets) {
                const safe = s.name.replace(/[^a-z0-9_-]/gi, '_');
                for (const ch of channels)
                    files[`${safe}/${safe}_${ch}.png`] = await this.compositor.export(s.id, ch);
            } files['manifest.json'] = JSON.stringify({ app: 'ChromaForge', version: '0.1.0', project: this.store.state.name, resolution: this.store.state.resolution, colorSpace: { baseColor: 'sRGB', emissive: 'sRGB', other: 'linear scalar' }, normal: 'OpenGL +Y, derived from painted height', orm: 'R=1, G=roughness, B=metallic', channels, sets: sets.map(s => s.name) }, null, 2); downloadBlob(await createZip(files), 'chromaforge-textures.zip'); this.closeModal(); this.toast(`Exported ${sets.length * channels.length} texture maps`, 'success'); } }]); $('#export-preset').onchange = e => { const set = e.target.value === 'engine' ? ['baseColor', 'normal', 'orm', 'emissive'] : ['baseColor', 'roughness', 'metallic', 'normal', 'height']; for (const c of $$('[data-export-channel]'))
        c.checked = set.includes(c.dataset.exportChannel); }; }
    bakeDialog() { const mat = this.store.state.textureSets.findIndex(s => s.id === this.setId); this.modal('Bake mesh maps', `<p class="subtle">Bake geometry-derived maps for <strong>${esc(this.set.name)}</strong>.</p><div class="form-grid"><div class="form-row"><label>Output resolution</label><select id="bake-resolution"><option>128</option><option selected>256</option><option>512</option><option>1024</option></select></div><div class="form-row"><label>Ambient occlusion samples</label><select id="bake-samples"><option value="4">4 · preview</option><option value="8" selected>8 · standard</option><option value="16">16 · fine</option><option value="32">32 · high</option></select></div></div><div class="notice info">Includes object-space normals, normalized position, material ID, ray-cast ambient occlusion, and a screen-of-UV normal-gradient curvature approximation. No high-to-low cage projection.</div><progress id="bake-progress" max="1" value="0"></progress><div class="micro" id="bake-status">Ready to bake</div><div class="bake-preview" id="bake-preview"></div>`, [{ label: 'Bake maps', primary: true, run: async () => { this.bakeAbort = new AbortController(); const progress = $('#bake-progress'), status = $('#bake-status'); status.textContent = 'Casting ambient-occlusion rays…'; const result = await bakeMeshMaps(this.mesh, { size: +$('#bake-resolution').value, samples: +$('#bake-samples').value, material: mat, signal: this.bakeAbort.signal, onProgress: p => { progress.value = p; status.textContent = `Baking ${Math.round(p * 100)}%`; } }); this.bake = result; this.bakeAbort = null; const files = {}; $('#bake-preview').innerHTML = ''; for (const [name, data] of Object.entries(result.maps)) {
                const c = makeCanvas(result.size);
                c.getContext('2d').putImageData(new ImageData(data, result.size, result.size), 0, 0);
                $('#bake-preview').insertAdjacentHTML('beforeend', `<figure><img src="${c.toDataURL()}" alt="${name} baked map"><figcaption>${name}</figcaption></figure>`);
                files[`${this.set.name.replace(/[^a-z0-9_-]/gi, '_')}_${name}.png`] = await new Promise(r => c.toBlob(r, 'image/png'));
            } this.bakedZip = await createZip(files); status.innerHTML = `Baking complete. <button class="secondary" id="download-bake">${icon('export', 12)} Download maps</button>`; $('#download-bake').onclick = () => downloadBlob(this.bakedZip, 'chromaforge-mesh-maps.zip'); } }], true); }
    helpDialog() { this.modal('Keyboard & viewport controls', `<div class="kbd-grid">${[['Paint', 'B'], ['Erase', 'E'], ['Fill material', 'G'], ['Pick color', 'I'], ['Navigate', 'H'], ['Paint selected mask', 'U'], ['Frame model / UVs', 'F'], ['3D + 2D / 3D / 2D', 'F1 / F2 / F3'], ['Orbit', 'Alt + left drag / right drag'], ['Pan', 'Middle drag / Alt + Shift + drag'], ['Zoom', 'Mouse wheel'], ['Straight brush segment', 'Shift + drag'], ['Smaller / larger brush', '[ / ]'], ['Cycle display channels', 'C'], ['Undo / redo', '⌘ Z / ⌘ ⇧ Z'], ['Save project', '⌘ S'], ['Export textures', '⌘ ⇧ E'], ['Command search', '⌘ K'], ['Focus workspace', 'Tab']].map(([a, b]) => `<span>${a}</span><kbd class="keycap">${b}</kbd>`).join('')}</div><p class="property-note">Use Ctrl instead of ⌘ on Windows and Linux. Paint on an editable paint layer; painting on a fill automatically adds a new paint layer. For full control, use the Layer properties tab.</p>`, [{ label: 'Close', primary: true, run: () => this.closeModal() }]); }
    aboutDialog() { this.modal('ChromaForge Material Studio', `<h2 style="font-size:25px;letter-spacing:-1px;margin:0">A surface for your imagination.</h2><p class="subtle">Version 0.1.0 · Browser-native material painting</p><div class="notice success">Original JavaScript engine, WebGPU / WebGL2 renderer, multi-channel painting, editable layer stacks, mesh import, geometry baking, local persistence and authenticated WebSocket collaboration.</div><p>Standalone modules: Core, Geometry, Renderer, Paint, Controls, Collaboration.</p><div class="notice">This is an independent implementation, not an Adobe product. Full Substance 3D Painter parity is not established. Native SPP/SBSAR, production color management, high-poly cage baking, virtual UDIM streaming, particle painting, and enterprise service qualification are not included.</div><p class="property-note">MIT-licensed source. No proprietary application code, branding, material libraries, fonts, or meshes are bundled.</p>`, [{ label: 'Close', primary: true, run: () => this.closeModal() }]); }
    collabStatus(s) { $('#collab-label').textContent = s === 'connected' ? 'Live workspace' : s === 'connecting' ? 'Connecting…' : s === 'reconnecting' ? 'Reconnecting…' : 'Local project'; if (s === 'connected')
        $('#save-status').textContent = 'Live operations · Local backup on'; if (s === 'disconnected')
        $('#avatars').innerHTML = '<span class="avatar" title="Local artist">You</span>'; }
    updatePresence(peers) { $('#avatars').innerHTML = peers.map(p => `<span class="avatar" title="${esc(p.name)} · ${esc(p.role)}">${esc(p.name.slice(0, 2).toUpperCase())}</span>`).join(''); }
    remoteCursor(p) { const parent = $(p.view === '2d' ? '.viewport-2d' : '.viewport-3d'); let el = $(`[data-peer-cursor="${p.actor}"]`); if (!el) {
        el = document.createElement('div');
        el.className = 'remote-cursor';
        el.dataset.peerCursor = p.actor;
    } parent.append(el); el.textContent = p.name ?? 'Collaborator'; el.style.left = `${p.x * 100}%`; el.style.top = `${p.y * 100}%`; clearTimeout(el.removeTimer); el.removeTimer = setTimeout(() => el.remove(), 3500); }
    async collaborationDialog() {
        const client = this.collab;
        try {
            await client.session();
        }
        catch (e) {
            this.modal('Collaboration service', `<div class="notice">The collaboration backend is not reachable from this page.</div><p>Run the included Node.js server with <code>npm start</code>, then open its local studio. Static and single-file builds support local editing without a server.</p><p class="property-note">Shared rooms require the authenticated HTTP/WebSocket service and its SQLite database. A static hosting service alone does not run this backend.</p><div class="form-row"><label>Backend origin (optional, requires server CORS configuration)</label><input id="backend-origin" placeholder="https://your-chromaforge-service.example" value="${esc(client.baseURL)}"></div>`, [{ label: 'Connect to service', primary: true, run: async () => { client.baseURL = $('#backend-origin').value.trim().replace(/\/$/, ''); await client.session(); this.collaborationDialog(); } }]);
            return;
        }
        if (!client.user) {
            this.modal('Join your workspace', `<p class="subtle">Sign in to collaborate in real time. Your local projects remain private until you create a shared room.</p><div class="form-row"><label>Display name (for new accounts)</label><input id="auth-name" placeholder="Artist name" maxlength="80" autocomplete="name"></div><div class="form-row"><label>Email</label><input id="auth-email" type="email" placeholder="artist@example.com" autocomplete="email"></div><div class="form-row"><label>Password (minimum 10 characters)</label><input id="auth-password" type="password" autocomplete="current-password"></div><div class="property-note">Sessions use HttpOnly cookies. Rooms have owner, editor and viewer roles; invitations are explicit and revocable. This server does not include enterprise SSO or password-recovery email.</div>`, [{ label: 'Create account', run: async () => { await client.register($('#auth-name').value, $('#auth-email').value, $('#auth-password').value); this.collaborationDialog(); } }, { label: 'Sign in', primary: true, run: async () => { await client.login($('#auth-email').value, $('#auth-password').value); this.collaborationDialog(); } }]);
            return;
        }
        const rooms = await client.rooms();
        this.modal('Shared workspaces', `<div class="property-row"><span>Signed in as <strong>${esc(client.user.name)}</strong></span><button class="secondary" id="logout-btn">Sign out</button></div>${client.room ? `<div class="notice success">Connected to <strong>${esc(client.room.name)}</strong> as ${esc(client.room.role)}. Operations synchronize live; notes and outbox edits persist across reconnects.</div>` : ''}<div class="form-row"><label>Create a new shared copy of the current document</label><button class="primary" id="create-room">${icon('share', 15)} Share ${esc(this.store.state.name)}</button></div>${client.room ? '<div id="member-manager" class="property-section"><h4>Room members</h4><div id="member-list">Loading members…</div></div>' : ''}<div class="property-section"><h4>Your rooms</h4><div class="form-row"><label>New invitation role</label><select id="invitation-role"><option value="editor">Editor · can paint and edit</option><option value="viewer">Viewer · read-only review</option></select></div>${rooms.length ? rooms.map(r => `<div class="project-item"><div class="project-info"><strong>${esc(r.name)}</strong><small>${esc(r.role)} · ${r.id}</small></div><button class="secondary" data-join-room="${r.id}">Open</button>${r.role === 'owner' ? `<button data-invite-room="${r.id}" title="Create invitation">${icon('link', 15)}</button>` : ''}</div>`).join('') : '<p class="subtle">No shared rooms yet.</p>'}</div><div class="property-section"><h4>Join with an invitation</h4><div class="form-row"><input id="invite-link" placeholder="Paste an invitation link or room-id / token"></div><button id="join-invite" class="secondary">Join room</button></div><div id="invitation-result"></div><p class="property-note">Joining a room replaces the active document. A local backup is saved before switching. Mesh replacement requires a new room.</p>`, client.room ? [{ label: 'Disconnect', run: () => { client.disconnect(); this.closeModal(); } }, { label: 'Done', primary: true, run: () => this.closeModal() }] : [{ label: 'Done', primary: true, run: () => this.closeModal() }], true);
        if (client.room) {
            const refreshMembers = async () => { const { members } = await client.members(); const host = $('#member-list'); if (!host)
                return; host.innerHTML = members.map(m => `<div class="property-row"><span>${esc(m.name)}</span>${client.room.role === 'owner' && m.role !== 'owner' ? `<select aria-label="Role for ${esc(m.name)}" data-member-id="${m.id}"><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Editor</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Viewer</option><option value="removed">Remove access</option></select>` : `<span class="micro">${esc(m.role)}</span>`}</div>`).join(''); for (const select of $$('[data-member-id]'))
                select.onchange = async () => { try {
                    if (select.value === 'removed' && !confirm('Remove this member from the room?'))
                        return refreshMembers();
                    await client.setRole(select.dataset.memberId, select.value);
                    await refreshMembers();
                }
                catch (e) {
                    this.toast(e.message, 'error');
                } }; };
            refreshMembers().catch(e => this.toast(e.message, 'error'));
        }
        $('#logout-btn').onclick = async () => { await client.logout(); this.collaborationDialog(); };
        $('#create-room').onclick = async () => { try {
            await this.autosave();
            await client.createRoom(this.store.state.name);
            this.toast('Shared room created', 'success');
            this.collaborationDialog();
        }
        catch (e) {
            this.toast(e.message, 'error');
        } };
        for (const b of $$('[data-join-room]'))
            b.onclick = async () => { try {
                await this.autosave();
                await client.connect(b.dataset.joinRoom);
                this.closeModal();
            }
            catch (e) {
                this.toast(e.message, 'error');
            } };
        for (const b of $$('[data-invite-room]'))
            b.onclick = async () => { try {
                const token = await client.invite(b.dataset.inviteRoom, $('#invitation-role').value);
                const url = new URL(location.href);
                url.searchParams.set('room', b.dataset.inviteRoom);
                url.searchParams.set('invite', token.token);
                $('#invitation-result').innerHTML = `<div class="notice info">${esc(token.role)} invitation (expires in seven days):<input style="width:100%;margin-top:8px" id="created-invite" readonly value="${esc(url.href)}"><button id="copy-invite" class="secondary">Copy invitation</button><button id="revoke-invites" class="secondary">Revoke invitations</button></div>`;
                $('#copy-invite').onclick = () => navigator.clipboard?.writeText(url.href).then(() => this.toast('Invitation copied')).catch(() => $('#created-invite').select());
                $('#revoke-invites').onclick = async () => { await client.revokeInvites(b.dataset.inviteRoom); $('#invitation-result').innerHTML = '<div class="notice success">Invitations revoked.</div>'; };
            }
            catch (e) {
                this.toast(e.message, 'error');
            } };
        $('#join-invite').onclick = async () => { try {
            const value = $('#invite-link').value.trim();
            let id, token;
            try {
                const url = new URL(value);
                id = url.searchParams.get('room');
                token = url.searchParams.get('invite');
            }
            catch {
                [id, token] = value.split(/\s*\/\s*/);
            }
            if (!id || !token)
                throw Error('The invitation must include both a room identifier and a token');
            await this.autosave();
            await client.join(id, token);
            await client.connect(id);
            this.closeModal();
        }
        catch (e) {
            this.toast(e.message, 'error');
        } };
        const params = new URLSearchParams(location.search);
        if (params.has('room') && params.has('invite'))
            $('#invite-link').value = location.href;
    }
}
const studio = new Studio();
globalThis.chroma = studio;
studio.init().catch(e => { console.error('Studio initialization failed', e); studio.toast(`Initialization failed: ${e.message}`, 'error'); });

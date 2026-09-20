import { MaterialRenderer } from '../packages/renderer/src/renderer.js';
import { createModel } from '../packages/geometry/src/mesh.js';
import { createProject } from '../packages/core/src/document.js';
import { TextureCompositor } from '../packages/paint/src/compositor.js';
import { MATERIALS } from '../packages/paint/src/materials.js';
async function start() { const renderer = await new MaterialRenderer(document.querySelector('#view')).initialize(), paint = new TextureCompositor(512), project = createProject('sphere', 512); project.textureSets[0].layers = project.textureSets[0].layers.slice(0, 1); const select = document.querySelector('#material'); for (const m of MATERIALS)
    select.add(new Option(m.name, m.id)); select.value = 'alloy'; const material = () => { Object.assign(project.textureSets[0].layers[0], MATERIALS.find(m => m.id === select.value), { id: 'example-fill' }); renderer.upload(0, paint.compose(project.textureSets[0]), 1); }; renderer.setMesh(createModel('sphere')); material(); select.onchange = material; document.querySelector('#model').onchange = e => renderer.setMesh(createModel(e.target.value)); document.querySelector('#frame').onclick = () => { renderer.camera.frame(); renderer.invalidate(); }; document.querySelector('#wire').onclick = () => { renderer.settings.wireframe = !renderer.settings.wireframe; renderer.invalidate(); }; document.querySelector('#status').textContent = renderer.mode + ' backend'; const canvas = renderer.canvas; let last = null; canvas.onpointerdown = e => { canvas.setPointerCapture(e.pointerId); last = [e.clientX, e.clientY]; }; canvas.onpointermove = e => { if (last) {
    renderer.camera.orbit(e.clientX - last[0], e.clientY - last[1]);
    last = [e.clientX, e.clientY];
    renderer.invalidate();
} }; canvas.onpointerup = canvas.onpointercancel = () => last = null; canvas.addEventListener('wheel', e => { e.preventDefault(); renderer.camera.zoom(e.deltaY); renderer.invalidate(); }, { passive: false }); const frame = () => { if (renderer.dirty)
    renderer.draw(); requestAnimationFrame(frame); }; frame(); window.exampleRenderer = renderer; }
start().catch(e => document.querySelector('#status').textContent = e.message);

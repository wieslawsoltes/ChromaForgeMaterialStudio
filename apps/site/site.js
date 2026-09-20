import { MaterialRenderer } from '../../packages/renderer/src/renderer.js';
import { createModel } from '../../packages/geometry/src/mesh.js';
import { createProject } from '../../packages/core/src/document.js';
import { TextureCompositor } from '../../packages/paint/src/compositor.js';
import { MATERIALS } from '../../packages/paint/src/materials.js';
async function main() { const renderer = await new MaterialRenderer(document.querySelector('#hero-canvas'), { maxDPR: 1.5 }).initialize(); const project = createProject('nomad', 512), paint = new TextureCompositor(512); renderer.setMesh(createModel('nomad')); renderer.camera.distance = 6.8; renderer.settings.floor = false; renderer.camera.yaw = .52; renderer.camera.pitch = .22; const renderSet = i => renderer.upload(i, paint.compose(project.textureSets[i]), project.textureSets.length); project.textureSets.forEach((_, i) => renderSet(i)); document.querySelector('#render-mode').textContent = renderer.mode + ' · live material preview'; document.querySelectorAll('[data-material]').forEach(button => button.onclick = () => { document.querySelectorAll('[data-material]').forEach(b => b.classList.toggle('selected', b === button)); Object.assign(project.textureSets[0].layers[0], MATERIALS.find(m => m.id === button.dataset.material), { id: 'base-0' }); renderSet(0); renderer.draw(); }); let drag = null; const c = renderer.canvas; c.onpointerdown = e => { drag = [e.clientX, e.clientY]; c.setPointerCapture(e.pointerId); }; c.onpointermove = e => { if (drag) {
    renderer.camera.orbit(e.clientX - drag[0], e.clientY - drag[1]);
    drag = [e.clientX, e.clientY];
    renderer.invalidate();
} }; c.onpointerup = () => drag = null; c.onpointercancel = () => drag = null; c.onwheel = e => { e.preventDefault(); renderer.camera.zoom(e.deltaY); renderer.invalidate(); }; const draw = () => { if (renderer.dirty)
    renderer.draw(); requestAnimationFrame(draw); }; draw(); window.heroRenderer = renderer; }
main().catch(e => document.querySelector('#render-mode').textContent = 'Preview unavailable: ' + e.message);

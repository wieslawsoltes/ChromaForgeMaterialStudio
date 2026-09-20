import { SoftwareRasterizer } from './software.js';
import { Signal } from '../../core/src/events.js';
import { OrbitCamera, inverse } from '../../core/src/math.js';
import { WGSL, GL_VERTEX, GL_FRAGMENT, GL_BG_VERTEX, GL_BG_FRAGMENT } from './shaders.js';
/** Standalone viewport. GPU resources are owned by the renderer and explicitly disposed. */
export class MaterialRenderer extends Signal {
    constructor(canvas, options = {}) { super(); this.canvas = canvas; this.options = options; this.camera = new OrbitCamera(); this.settings = { exposure: 1.1, rotation: 0, channel: 0, normalStrength: 1, floor: true, wireframe: false, environment: 0 }; this.visible = new Float32Array(16).fill(1); this.dirty = true; this.frames = 0; this.frameTime = 0; this.ready = false; this.textureSize = 0; this.textures = []; this.outputs = new Map(); this.mode = 'initializing'; }
    async initialize() {
        if (!this.options.forceWebGL && globalThis.navigator?.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
                if (adapter) {
                    this.device = await adapter.requestDevice();
                    this.device.addEventListener('uncapturederror', e => this.emit('error', e.error.message));
                    this.device.lost.then(info => { if (info.reason !== 'destroyed') {
                        this.ready = false;
                        this.emit('error', 'GPU device lost. Save your work and reload to recover.');
                    } });
                    await this.initGPU();
                    this.mode = 'WebGPU';
                }
            }
            catch (e) {
                this.emit('warning', `WebGPU initialization: ${e.message}`);
                this.device?.destroy();
                this.device = null;
            }
        }
        if (!this.device) {
            if (this.canvas.getContext('webgpu')) {
                const copy = this.canvas.cloneNode();
                this.canvas.replaceWith(copy);
                this.canvas = copy;
            }
            try {
                this.initGL();
                this.mode = 'WebGL2';
            }
            catch (e) {
                this.emit('warning', `GPU backend unavailable: ${e.message}`);
                const copy = this.canvas.cloneNode();
                this.canvas.replaceWith(copy);
                this.canvas = copy;
                this.gl = null;
                this.software = new SoftwareRasterizer(this.canvas);
                this.mode = 'CPU compatibility';
            }
        }
        this.ready = true;
        this.resize();
        this.observer = new ResizeObserver(() => { this.resize(); this.invalidate(); });
        this.observer.observe(this.canvas);
        this.emit('ready', this.mode);
        return this;
    }
    async initGPU() {
        const d = this.device;
        this.ctx = this.canvas.getContext('webgpu');
        if (!this.ctx)
            throw Error('Unable to create WebGPU canvas');
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.ctx.configure({ device: d, format: this.format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        const module = d.createShaderModule({ label: 'ChromaForge PBR', code: WGSL });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(m => m.type === 'error');
        if (errors.length)
            throw Error(errors.map(e => `${e.lineNum}: ${e.message}`).join('\n'));
        this.uniform = d.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.layout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, ...[1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } })), { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
        const layout = d.createPipelineLayout({ bindGroupLayouts: [this.layout] });
        this.pipeline = await d.createRenderPipelineAsync({ label: 'PBR material pipeline', layout, vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 36, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' }] }] }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: 4 } });
        this.bgPipeline = await d.createRenderPipelineAsync({ label: 'Studio background', layout, vertex: { module, entryPoint: 'bgvs' }, fragment: { module, entryPoint: 'bgfs', targets: [{ format: this.format }] }, primitive: { topology: 'triangle-list' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }, multisample: { count: 4 } });
        this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
    }
    initGL() { const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true }); if (!gl)
        throw Error('WebGPU and WebGL2 are unavailable. Enable browser hardware acceleration.'); this.gl = gl; this.program = this.glProgram(GL_VERTEX, GL_FRAGMENT); this.bgProgram = this.glProgram(GL_BG_VERTEX, GL_BG_FRAGMENT); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); }
    glProgram(vs, fs) { const gl = this.gl, p = gl.createProgram(); for (const [src, type] of [[vs, gl.VERTEX_SHADER], [fs, gl.FRAGMENT_SHADER]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
        gl.deleteShader(s);
    } gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(p)); return p; }
    setMesh(mesh) { if (!this.ready)
        throw Error('Initialize the renderer before uploading a mesh'); this.mesh = mesh; if (this.software) {
        this.invalidate();
        return;
    } if (this.device) {
        this.vertexBuffer?.destroy();
        this.vertexBuffer = this.device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(this.vertexBuffer, 0, mesh.vertices);
    }
    else {
        const gl = this.gl;
        if (this.vertexBuffer)
            gl.deleteBuffer(this.vertexBuffer);
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
        if (this.vao)
            gl.deleteVertexArray(this.vao);
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        [3, 3, 2, 1].forEach((n, i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 36, [0, 12, 24, 32][i]); });
        gl.bindVertexArray(null);
    } this.invalidate(); }
    allocateTextures(size, layers) {
        if (size === this.textureSize && layers === this.textureLayers)
            return;
        this.textureSize = size;
        this.textureLayers = layers;
        for (const t of this.textures)
            this.device ? t.destroy() : this.gl.deleteTexture(t);
        this.textures = [];
        if (this.device) {
            const d = this.device;
            for (let i = 0; i < 3; i++)
                this.textures.push(d.createTexture({ size: [size, size, layers], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }));
            this.bindGroup = d.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }, ...this.textures.map((t, i) => ({ binding: i + 1, resource: t.createView({ dimension: '2d-array' }) })), { binding: 4, resource: this.sampler }] });
        }
        else {
            const gl = this.gl;
            for (let i = 0; i < 3; i++) {
                const t = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
                gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, layers);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
                this.textures.push(t);
            }
        }
    }
    upload(index, output, totalSets) { if (!this.ready)
        throw Error('Initialize the renderer before uploading textures'); if (!Number.isInteger(totalSets) || totalSets < 1 || totalSets > 16 || !Number.isInteger(index) || index < 0 || index >= totalSets)
        throw Error('Expected a valid material index and 1–16 texture sets'); const size = output.color.width; if ([output.color, output.orm, output.emissive].some(c => c.width !== size || c.height !== size))
        throw Error('Material textures must be square with matching dimensions'); if (this.software) {
        this.outputs.set(index, output);
        this.software.upload(index, output);
        this.invalidate();
        return;
    } this.allocateTextures(output.color.width, totalSets); this.outputs.set(index, output); [output.color, output.orm, output.emissive].forEach((canvas, i) => { if (this.device)
        this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: this.textures[i], origin: [0, 0, index] }, { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 });
    else {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures[i]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, index, canvas.width, canvas.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    } }); this.invalidate(); }
    resize() { const c = this.canvas, dpr = Math.min(globalThis.devicePixelRatio || 1, this.options.maxDPR ?? 2), w = Math.max(1, Math.floor(c.clientWidth * dpr)), h = Math.max(1, Math.floor(c.clientHeight * dpr)); if (w === c.width && h === c.height)
        return; c.width = w; c.height = h; if (this.device) {
        this.depth?.destroy();
        this.msaa?.destroy();
        this.depth = this.device.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
        this.msaa = this.device.createTexture({ size: [w, h], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    } this.invalidate(); }
    uniformData() { const f = new Float32Array(64), s = this.settings, vp = this.camera.matrix(this.canvas.width / this.canvas.height); f.set(vp); f.set(inverse(vp), 16); f.set([...this.camera.eye, 1], 32); f.set([s.exposure, s.rotation, s.channel, s.normalStrength], 36); f.set([this.canvas.width, this.canvas.height, +s.floor, +s.wireframe], 40); f.set(this.visible, 44); f.set([s.environment, 0, 0, 0], 60); return f; }
    invalidate() { this.dirty = true; }
    draw() {
        if (!this.ready || !this.mesh || (!this.software && !this.textures.length))
            return false;
        this.resize();
        const start = performance.now(), f = this.uniformData();
        if (this.software) {
            this.software.draw(this.mesh, this.camera, this.settings, this.visible);
        }
        else if (this.device) {
            const d = this.device;
            if (!this.depth) {
                this.canvas.width = 0;
                this.resize();
            }
            d.queue.writeBuffer(this.uniform, 0, f);
            const encoder = d.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: .1, g: .1, b: .1, a: 1 } }], depthStencilAttachment: { view: this.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
            pass.setBindGroup(0, this.bindGroup);
            pass.setPipeline(this.bgPipeline);
            pass.draw(3);
            pass.setPipeline(this.pipeline);
            pass.setVertexBuffer(0, this.vertexBuffer);
            pass.draw(this.mesh.vertices.length / 9);
            pass.end();
            d.queue.submit([encoder.finish()]);
        }
        else {
            const gl = this.gl, uniform = (p, n) => gl.getUniformLocation(p, n);
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clearColor(.1, .1, .1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.disable(gl.DEPTH_TEST);
            gl.useProgram(this.bgProgram);
            gl.uniformMatrix4fv(uniform(this.bgProgram, 'inv'), false, f.subarray(16, 32));
            gl.uniform4fv(uniform(this.bgProgram, 'viewport'), f.subarray(40, 44));
            gl.bindVertexArray(null);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.enable(gl.DEPTH_TEST);
            gl.useProgram(this.program);
            gl.uniformMatrix4fv(uniform(this.program, 'vp'), false, f.subarray(0, 16));
            gl.uniform3fv(uniform(this.program, 'eye'), f.subarray(32, 35));
            gl.uniform4fv(uniform(this.program, 'settings'), f.subarray(36, 40));
            gl.uniform4fv(uniform(this.program, 'viewport'), f.subarray(40, 44));
            gl.uniform1fv(uniform(this.program, 'visible'), this.visible);
            gl.uniform4fv(uniform(this.program, 'env'), f.subarray(60, 64));
            this.textures.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); gl.uniform1i(uniform(this.program, ['texColor', 'texOrm', 'texEmit'][i]), i); });
            gl.bindVertexArray(this.vao);
            gl.drawArrays(gl.TRIANGLES, 0, this.mesh.vertices.length / 9);
            gl.bindVertexArray(null);
        }
        this.dirty = false;
        this.frames++;
        this.frameTime = performance.now() - start;
        return true;
    }
    snapshot() { this.draw(); return new Promise(resolve => this.canvas.toBlob(resolve, 'image/png')); }
    dispose() { this.ready = false; this.observer?.disconnect(); this.software?.dispose(); if (this.device) {
        this.vertexBuffer?.destroy();
        this.uniform?.destroy();
        this.depth?.destroy();
        this.msaa?.destroy();
        this.textures.forEach(t => t.destroy());
        this.device.destroy();
    }
    else if (this.gl) {
        this.gl.deleteBuffer(this.vertexBuffer);
        this.gl.deleteVertexArray(this.vao);
        this.gl.deleteProgram(this.program);
        this.gl.deleteProgram(this.bgProgram);
        this.textures.forEach(t => this.gl.deleteTexture(t));
    } this.clear(); }
}

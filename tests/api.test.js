import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createProject } from '../packages/core/src/document.js';
const root = resolve(import.meta.dirname, '..');
/** Tiny raw RFC6455 test client, independent of the server implementation. */
class Client extends EventEmitter {
    constructor(socket, head) { super(); this.socket = socket; this.buffer = Buffer.alloc(0); this.messages = []; socket.on('data', b => this.read(b)); socket.on('error', () => { }); if (head.length)
        this.read(head); }
    read(data) { this.buffer = Buffer.concat([this.buffer, data]); while (this.buffer.length >= 2) {
        const b = this.buffer, opcode = b[0] & 15;
        let n = b[1] & 127, k = 2;
        if (n === 126) {
            if (b.length < 4)
                return;
            n = b.readUInt16BE(2);
            k = 4;
        }
        else if (n === 127) {
            if (b.length < 10)
                return;
            n = Number(b.readBigUInt64BE(2));
            k = 10;
        }
        if (b.length < k + n)
            return;
        const payload = b.subarray(k, k + n);
        this.buffer = b.subarray(k + n);
        if (opcode === 1) {
            const m = JSON.parse(payload.toString());
            this.messages.push(m);
            this.emit('message');
        }
        if (opcode === 8) {
            this.closed = true;
            this.emit('closed');
        }
    } }
    send(message) { const data = Buffer.from(JSON.stringify(message)), mask = randomBytes(4), ext = data.length >= 126 ? 2 : 0, buf = Buffer.alloc(2 + ext + 4 + data.length); buf[0] = 129; buf[1] = 128 | (ext ? 126 : data.length); if (ext)
        buf.writeUInt16BE(data.length, 2); mask.copy(buf, 2 + ext); for (let i = 0; i < data.length; i++)
        buf[6 + ext + i] = data[i] ^ mask[i & 3]; this.socket.write(buf); }
    async next(type, predicate = () => true) { return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.off('message', check); reject(Error(`No ${type} frame`)); }, 4000); const check = () => { const i = this.messages.findIndex(m => m.type === type && predicate(m)); if (i >= 0) {
        clearTimeout(timer);
        this.off('message', check);
        resolve(this.messages.splice(i, 1)[0]);
    } }; this.on('message', check); check(); }); }
    close() { this.socket.destroy(); }
    static connect(origin, room, cookie) { return new Promise((resolve, reject) => { const req = http.request(`${origin}/api/socket?room=${room}`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), Cookie: cookie, Origin: origin } }); req.on('upgrade', (res, sock, head) => resolve(new Client(sock, head))); req.on('response', res => { res.resume(); reject(Error(`Upgrade rejected ${res.statusCode}`)); }); req.on('error', reject); req.end(); }); }
}
async function start(dataDir) { const p = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = ''; p.stderr.on('data', b => stderr += b); const origin = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Server startup timeout: ' + stderr)), 5000); p.stdout.on('data', b => { const m = b.toString().match(/running at (http:\/\/[^\s]+)/); if (m) {
    clearTimeout(timer);
    resolve(m[1]);
} }); p.once('exit', () => { clearTimeout(timer); reject(Error('Server exited: ' + stderr)); }); }); return { p, origin }; }
async function stop(p) { if (p.exitCode !== null)
    return; await new Promise(r => { p.once('exit', r); p.kill('SIGTERM'); }); }
function api(origin, cookie = '') { return async (path, { method = 'GET', body, headers = {} } = {}) => { const r = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); let data; try {
    data = await r.json();
}
catch {
    data = null;
} return { status: r.status, data, cookie: r.headers.get('set-cookie')?.split(';')[0], headers: r.headers }; }; }
test('authenticated HTTP, SQLite persistence, roles and WebSocket collaboration integration', async (t) => {
    const dataDir = await mkdtemp(resolve(tmpdir(), 'chromaforge-test-'));
    let service = await start(dataDir);
    const sockets = [];
    try {
        let request = api(service.origin), owner, editor, viewer, room, inv;
        await t.test('health endpoint and source site are reachable', async () => { assert.equal((await request('/api/health')).data.storage, 'sqlite'); const r = await fetch(service.origin + '/apps/site/'); assert.equal(r.status, 200); assert.match(await r.text(), /ChromaForge/); });
        await t.test('unauthenticated access and arbitrary origin writes are denied', async () => { assert.equal((await request('/api/rooms')).status, 401); assert.equal((await request('/api/auth/register', { method: 'POST', body: {}, headers: { Origin: 'https://malicious.example' } })).status, 403); });
        await t.test('data, server files and traversal are not served', async () => { for (const path of ['/data/chromaforge.sqlite', '/server/index.js', '/apps/%2e%2e/data/chromaforge.sqlite', '/apps/%2eenv'])
            assert.equal((await fetch(service.origin + path)).status, 404); });
        await t.test('account registration issues strict HttpOnly sessions', async () => { const register = async (name) => { const r = await request('/api/auth/register', { method: 'POST', body: { name, email: name.toLowerCase() + '@example.test', password: 'Correct-Horse-' + name + '-92' } }); assert.equal(r.status, 201); assert.match(r.headers.get('set-cookie'), /HttpOnly/); assert.match(r.headers.get('set-cookie'), /SameSite=Strict/); return { user: r.data.user, cookie: r.cookie }; }; owner = await register('Owner'); editor = await register('Editor'); viewer = await register('Viewer'); assert.equal((await api(service.origin, owner.cookie)('/api/me')).data.user.id, owner.user.id); });
        await t.test('bad credentials and short passwords are rejected', async () => { assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: 'wrong' } })).status, 401); assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: 'Bad', email: 'bad@example.test', password: 'short' } })).status, 400); });
        let ownerAPI = api(service.origin, owner.cookie), editorAPI = api(service.origin, editor.cookie), viewerAPI = api(service.origin, viewer.cookie);
        await t.test('only members can read a shared project', async () => { const r = await ownerAPI('/api/rooms', { method: 'POST', body: { name: 'Shared test', base: createProject('sphere', 256) } }); assert.equal(r.status, 201); room = r.data.room.id; assert.equal((await editorAPI(`/api/rooms/${room}`)).status, 403); });
        await t.test('editor and viewer invitation roles are enforced', async () => { inv = (await ownerAPI(`/api/rooms/${room}/invites`, { method: 'POST', body: { role: 'editor' } })).data.token; assert.equal((await editorAPI(`/api/rooms/${room}/join`, { method: 'POST', body: { token: inv } })).status, 200); const vi = (await ownerAPI(`/api/rooms/${room}/invites`, { method: 'POST', body: { role: 'viewer' } })).data.token; assert.equal((await viewerAPI(`/api/rooms/${room}/join`, { method: 'POST', body: { token: vi } })).status, 200); assert.equal((await editorAPI(`/api/rooms/${room}/invites`, { method: 'POST', body: { role: 'editor' } })).status, 403); });
        const a = await Client.connect(service.origin, room, owner.cookie), b = await Client.connect(service.origin, room, editor.cookie), v = await Client.connect(service.origin, room, viewer.cookie);
        sockets.push(a, b, v);
        await t.test('WebSocket join returns authoritative history and presence', async () => { assert.equal((await a.next('sync')).role, 'owner'); assert.equal((await b.next('sync')).role, 'editor'); assert.equal((await v.next('sync')).role, 'viewer'); const p = await a.next('presence', m => m.peers.length === 3); assert.equal(p.peers.length, 3); });
        let op = { id: randomUUID(), actor: editor.user.id, clock: 1, type: 'project:set', payload: { patch: { name: 'Edited remotely' } }, label: 'Rename', time: new Date().toISOString() };
        await t.test('accepted edits broadcast and are acknowledged', async () => { b.send({ type: 'operation', operation: op }); assert.equal((await a.next('operation')).operation.id, op.id); assert.equal((await b.next('ack')).id, op.id); assert.equal((await v.next('operation')).operation.payload.patch.name, 'Edited remotely'); });
        await t.test('duplicate operation delivery does not duplicate the journal', async () => { b.send({ type: 'operation', operation: op }); await b.next('ack'); const doc = (await ownerAPI(`/api/rooms/${room}`)).data.document; assert.equal(doc.operations.length, 1); });
        await t.test('viewer writes and cross-actor impersonation are rejected', async () => { v.send({ type: 'operation', operation: { ...op, id: randomUUID(), actor: viewer.user.id } }); assert.match((await v.next('rejected')).error, /read-only/); b.send({ type: 'operation', operation: { ...op, id: randomUUID(), actor: owner.user.id } }); assert.match((await b.next('rejected')).error, /actor/); });
        await t.test('owners cannot undo another member’s operation', async () => { a.send({ type: 'operation', operation: { id: randomUUID(), actor: owner.user.id, clock: 2, type: 'history:toggle', payload: { target: op.id, enabled: false } } }); assert.match((await a.next('rejected')).error, /own operations/); });
        await t.test('cursor positions broadcast with authenticated attribution', async () => { b.send({ type: 'cursor', x: .35, y: .6, view: '2d', name: 'Forged' }); const c = await a.next('cursor'); assert.equal(c.name, 'Editor'); assert.equal(c.actor, editor.user.id); assert.equal(c.x, .35); });
        await t.test('live owner role changes immediately deny future edits', async () => { assert.equal((await ownerAPI(`/api/rooms/${room}/members/${editor.user.id}`, { method: 'PATCH', body: { role: 'viewer' } })).status, 200); assert.equal((await b.next('role')).role, 'viewer'); b.send({ type: 'operation', operation: { ...op, id: randomUUID(), clock: 3 } }); assert.match((await b.next('rejected')).error, /read-only/); });
        await t.test('revoked invitation cannot be used again', async () => { await ownerAPI(`/api/rooms/${room}/invites`, { method: 'DELETE' }); assert.equal((await viewerAPI(`/api/rooms/${room}/join`, { method: 'POST', body: { token: inv } })).status, 403); });
        await t.test('malformed material patch is rejected over the socket', async () => { a.send({ type: 'operation', operation: { id: randomUUID(), actor: owner.user.id, clock: 4, type: 'layer:set', payload: { setId: 'set-0', layerId: 'base-0', patch: { color: 'red; bad' } } } }); assert.match((await a.next('rejected')).error, /color/); });
        await t.test('database and session survive process restart; late joins replay the journal', async () => { for (const s of sockets)
            s.close(); await stop(service.p); service = await start(dataDir); ownerAPI = api(service.origin, owner.cookie); const r = await ownerAPI(`/api/rooms/${room}`); assert.equal(r.status, 200); assert.equal(r.data.document.operations[0].id, op.id); const c = await Client.connect(service.origin, room, owner.cookie); sockets.push(c); assert.equal((await c.next('sync')).document.operations[0].id, op.id); });
        await t.test('logout invalidates the session', async () => { assert.equal((await ownerAPI('/api/auth/logout', { method: 'POST', body: {} })).status, 200); assert.equal((await ownerAPI('/api/rooms')).status, 401); });
    }
    finally {
        for (const s of sockets)
            s.close();
        await stop(service.p);
        await rm(dataDir, { recursive: true, force: true });
    }
});

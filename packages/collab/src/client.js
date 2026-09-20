import { Signal } from '../../core/src/events.js';
/** Authenticated room client. Pending operations are persisted before transmission.
 * Reconnection fetches authoritative history and replays the local outbox by operation ID.
 */
export class CollaborationClient extends Signal {
    constructor(store, database, { baseURL = '' } = {}) { super(); this.store = store; this.db = database; this.baseURL = baseURL; this.user = null; this.room = null; this.socket = null; this.connected = false; this.retry = 0; this.manual = true; this.generation = 0; this.pending = new Map(); this.off = store.on('change', e => { if (e.local && this.room) {
        for (const op of e.operations)
            this.enqueue(op);
    } }); }
    async request(path, options = {}) { const r = await fetch(`${this.baseURL}/api${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options }); let data; try {
        data = await r.json();
    }
    catch {
        throw Error('The collaboration server returned an invalid response');
    } if (!r.ok)
        throw Error(data.error ?? `HTTP ${r.status}`); return data; }
    async session() { const { user } = await this.request('/me'); this.user = user; return user; }
    async register(name, email, password) { const r = await this.request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }); this.user = r.user; return r.user; }
    async login(email, password) { const r = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); this.user = r.user; return r.user; }
    async logout() { this.disconnect(); await this.request('/auth/logout', { method: 'POST', body: '{}' }); this.user = null; }
    async rooms() { return (await this.request('/rooms')).rooms; }
    async createRoom(name) { const r = await this.request('/rooms', { method: 'POST', body: JSON.stringify({ name, base: this.store.state }) }); await this.connect(r.room.id); return r.room; }
    async invite(id, role = 'editor') { return this.request(`/rooms/${encodeURIComponent(id)}/invites`, { method: 'POST', body: JSON.stringify({ role }) }); }
    async revokeInvites(id) { return this.request(`/rooms/${encodeURIComponent(id)}/invites`, { method: 'DELETE' }); }
    async join(id, token) { return this.request(`/rooms/${encodeURIComponent(id)}/join`, { method: 'POST', body: JSON.stringify({ token }) }); }
    async members(id = this.room?.id) { return this.request(`/rooms/${encodeURIComponent(id)}/members`); }
    async setRole(userId, role) { return this.request(`/rooms/${this.room.id}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) }); }
    async connect(id) { if (!this.user)
        await this.session(); if (!this.user)
        throw Error('Sign in before joining a shared room'); this.disconnect(); this.manual = false; const gen = ++this.generation; const r = await this.request(`/rooms/${encodeURIComponent(id)}`); if (gen !== this.generation)
        return; this.room = r.room; this.store.actor = this.user.id; const queued = (await this.db.pending()).filter(o => o.room === id); if (gen !== this.generation)
        return; this.pending = new Map(queued.map(({ room, ...o }) => [o.id, o])); this.store.load(r.document); if (this.pending.size)
        this.store.ingest([...this.pending.values()]); this.openSocket(gen); }
    openSocket(gen) {
        if (this.manual || gen !== this.generation || !this.room)
            return;
        this.emit('status', this.retry ? 'reconnecting' : 'connecting');
        const base = this.baseURL || location.origin, url = new URL('/api/socket', base);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('room', this.room.id);
        this.socket = new WebSocket(url);
        let opened = false;
        this.socket.onmessage = e => {
            if (gen !== this.generation)
                return;
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'sync') {
                    this.store.load(msg.document);
                    if (this.pending.size)
                        this.store.ingest([...this.pending.values()]);
                    this.room.role = msg.role;
                    this.connected = true;
                    this.retry = 0;
                    opened = true;
                    this.emit('status', 'connected');
                    for (const op of this.pending.values())
                        this.send({ type: 'operation', operation: op });
                }
                else if (msg.type === 'operation') {
                    this.store.ingest([msg.operation]);
                    this.ack(msg.operation.id);
                }
                else if (msg.type === 'ack')
                    this.ack(msg.id);
                else if (msg.type === 'presence')
                    this.emit('presence', msg.peers);
                else if (msg.type === 'cursor')
                    this.emit('cursor', msg);
                else if (msg.type === 'role') {
                    this.room.role = msg.role;
                    this.emit('role', msg.role);
                    this.emit('status', 'connected');
                }
                else if (msg.type === 'rejected') {
                    const op = this.pending.get(msg.id);
                    if (op) {
                        this.pending.delete(msg.id);
                        this.db.acknowledge(msg.id);
                        this.store.ops.delete(msg.id);
                        this.store.rebuild();
                        this.store.emit('change', { local: false, operations: [op], state: this.store.state });
                    }
                    this.emit('error', msg.error);
                }
                else if (msg.type === 'error')
                    this.emit('error', msg.error);
            }
            catch (err) {
                this.emit('error', err.message);
            }
        };
        this.socket.onclose = () => { if (gen !== this.generation)
            return; this.connected = false; if (!this.manual) {
            this.emit('status', 'reconnecting');
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.openSocket(gen), Math.min(15000, 700 * 2 ** this.retry++));
        }
        else
            this.emit('status', 'disconnected'); };
        this.socket.onerror = () => { if (!opened)
            this.emit('error', 'WebSocket connection failed. Verify the server, session, and room permissions.'); };
    }
    async enqueue(op) { if (this.room.role === 'viewer') {
        this.store.ops.delete(op.id);
        this.store.rebuild();
        this.store.emit('change', { local: false, operations: [op], state: this.store.state });
        this.emit('error', 'This room is read-only for viewers.');
        return;
    } const roomId = this.room.id, gen = this.generation; try {
        await this.db.queue(op, roomId);
        if (gen !== this.generation || this.room?.id !== roomId)
            return;
        this.pending.set(op.id, op);
        this.send({ type: 'operation', operation: op });
    }
    catch (e) {
        this.emit('error', `Unable to persist collaboration outbox: ${e.message}`);
    } }
    send(message) { if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(message));
        return true;
    } return false; }
    ack(id) { if (this.pending.has(id)) {
        this.pending.delete(id);
        this.db.acknowledge(id).catch(e => this.emit('error', e.message));
    } }
    cursor(position) { this.send({ type: 'cursor', ...position }); }
    disconnect() { this.manual = true; this.generation++; clearTimeout(this.timer); this.socket?.close(1000, 'Leaving workspace'); this.socket = null; this.connected = false; this.room = null; this.pending.clear(); this.emit('status', 'disconnected'); }
    dispose() { this.disconnect(); this.off(); this.clear(); }
}

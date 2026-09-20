import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProject, validateOperation } from '../packages/core/src/document.js';
import { upgradeWebSocket } from './websocket.js';
const scrypt = promisify(scryptCallback), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), PORT = Number(process.env.PORT ?? 8787), HOST = process.env.HOST ?? '127.0.0.1';
const DATA = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(DATA, 'chromaforge.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),base TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,op_id TEXT NOT NULL,actor TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(room_id,op_id));
CREATE INDEX IF NOT EXISTS operations_room ON operations(room_id,seq);
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,role TEXT NOT NULL,expires INTEGER NOT NULL);
PRAGMA user_version=1;`);
const peers = new Map(), limits = new Map(), allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean));
const digest = v => createHash('sha256').update(v).digest('hex'), publicUser = u => u ? { id: u.id, name: u.name, email: u.email } : null;
const cookie = req => Object.fromEntries((req.headers.cookie ?? '').split(';').map(v => v.trim().split('=')));
function userFor(req) { const token = cookie(req).cf_session; if (!token)
    return null; return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').get(digest(token), Date.now()) ?? null; }
function member(room, user) { if (!user)
    return null; return db.prepare('SELECT r.id,r.name,r.owner_id,m.role FROM rooms r JOIN members m ON r.id=m.room_id WHERE r.id=? AND m.user_id=?').get(room, user.id); }
function roomDocument(id) { const r = db.prepare('SELECT base FROM rooms WHERE id=?').get(id); if (!r)
    throw Error('Room not found'); return { format: 'chromaforge', version: 1, base: JSON.parse(r.base), operations: db.prepare('SELECT json FROM operations WHERE room_id=? ORDER BY seq').all(id).map(r => JSON.parse(r.json)) }; }
function originOK(req) { const origin = req.headers.origin; if (!origin)
    return true; return allowedOrigins.has(origin) || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`; }
function headers(req, res) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); if (req.headers.origin && allowedOrigins.has(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
} res.setHeader('Cache-Control', 'no-store'); }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function fail(status, message) { const e = Error(message); e.status = status; throw e; }
function authenticate(req) { const u = userFor(req); if (!u)
    fail(401, 'Sign in to continue'); return u; }
function permit(req, id, owner = false) { const u = authenticate(req), m = member(id, u); if (!m)
    fail(403, 'You do not have access to this room'); if (owner && m.role !== 'owner')
    fail(403, 'Only the room owner may do that'); return { u, m }; }
function rate(req, key, max, window = 60000) { const id = `${key}:${req.socket.remoteAddress}`, now = Date.now(); let l = limits.get(id); if (!l || now - l.start > window)
    limits.set(id, l = { start: now, count: 0 }); if (++l.count > max)
    fail(429, 'Too many requests. Try again later.'); }
async function body(req, max = 40 * 1024 * 1024) { if (!req.headers['content-type']?.startsWith('application/json'))
    fail(415, 'Use application/json'); let data = [], size = 0; for await (const chunk of req) {
    size += chunk.length;
    if (size > max)
        fail(413, 'Request too large');
    data.push(chunk);
} try {
    return JSON.parse(Buffer.concat(data).toString('utf8') || '{}');
}
catch {
    fail(400, 'Invalid JSON request');
} }
function setSession(req, res, user) { const token = randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(digest(token), user.id, Date.now() + 30 * 86400000); const secure = process.env.SECURE_COOKIES === '1'; res.setHeader('Set-Cookie', `cf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`); }
function broadcast(id, message, except = null) { for (const peer of peers.get(id) ?? [])
    if (peer !== except)
        peer.send(message); }
function presence(id) { const list = [...(peers.get(id) ?? [])], unique = new Map(); for (const p of list)
    unique.set(p.user.id, { id: p.user.id, name: p.user.name, role: p.role }); broadcast(id, { type: 'presence', peers: [...unique.values()] }); }
async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1), method = req.method;
    if (method === 'OPTIONS') {
        if (!originOK(req))
            fail(403, 'Origin not allowed');
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        return res.end();
    }
    if (!originOK(req))
        fail(403, 'Origin not allowed');
    if (method !== 'GET' && req.headers['sec-fetch-site'] === 'cross-site' && !allowedOrigins.has(req.headers.origin))
        fail(403, 'Cross-site mutation rejected');
    if (parts[0] === 'health' && method === 'GET')
        return json(res, 200, { ok: true, app: 'ChromaForge', version: '0.1.0', storage: 'sqlite', transport: 'websocket' });
    if (parts[0] === 'me' && method === 'GET')
        return json(res, 200, { user: publicUser(userFor(req)) });
    if (parts[0] === 'auth') {
        if (parts[1] === 'register' && method === 'POST') {
            rate(req, 'register', 12, 3600000);
            const p = await body(req, 8192);
            if (typeof p.email !== 'string' || !/^\S+@\S+\.\S+$/.test(p.email) || p.email.length > 254)
                fail(400, 'A valid email address is required');
            if (typeof p.name !== 'string' || p.name.trim().length < 1 || p.name.length > 80)
                fail(400, 'Name must contain 1–80 characters');
            if (typeof p.password !== 'string' || p.password.length < 10 || p.password.length > 256)
                fail(400, 'Password must contain 10–256 characters');
            const salt = randomBytes(16).toString('hex'), password = (await scrypt(p.password, salt, 64)).toString('hex'), u = { id: randomUUID(), name: p.name.trim(), email: p.email.toLowerCase().trim() };
            try {
                db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(u.id, u.email, u.name, salt, password, Date.now());
            }
            catch {
                fail(409, 'Unable to register that account. Try signing in.');
            }
            setSession(req, res, u);
            return json(res, 201, { user: u });
        }
        if (parts[1] === 'login' && method === 'POST') {
            rate(req, 'login', 30);
            const p = await body(req, 8192);
            if (typeof p.email !== 'string' || typeof p.password !== 'string' || p.password.length > 256)
                fail(400, 'Email and password are required');
            const u = db.prepare('SELECT * FROM users WHERE email=?').get(p.email.toLowerCase().trim());
            const computed = await scrypt(p.password, u?.salt ?? 'dummy-salt-for-timing', 64);
            if (!u || !timingSafeEqual(computed, Buffer.from(u.password, 'hex')))
                fail(401, 'Email or password is incorrect');
            setSession(req, res, u);
            return json(res, 200, { user: publicUser(u) });
        }
        if (parts[1] === 'logout' && method === 'POST') {
            const token = cookie(req).cf_session;
            if (token)
                db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));
            res.setHeader('Set-Cookie', 'cf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
            return json(res, 200, { ok: true });
        }
    }
    if (parts[0] === 'rooms') {
        if (parts.length === 1 && method === 'GET') {
            const u = authenticate(req);
            const rooms = db.prepare('SELECT r.id,r.name,m.role,r.created FROM rooms r JOIN members m ON r.id=m.room_id WHERE m.user_id=? ORDER BY r.created DESC').all(u.id);
            return json(res, 200, { rooms });
        }
        if (parts.length === 1 && method === 'POST') {
            const u = authenticate(req);
            rate(req, 'create-room', 20, 3600000);
            if (db.prepare('SELECT count(*) AS n FROM rooms WHERE owner_id=?').get(u.id).n >= 30)
                fail(429, 'Per-account room limit reached');
            const p = await body(req);
            validateProject(p.base);
            if (JSON.stringify(p.base).length > 32 * 1024 * 1024)
                fail(413, 'Shared project exceeds 32 MB');
            const id = randomUUID(), name = String(p.name ?? p.base.name).slice(0, 200);
            db.exec('BEGIN');
            try {
                db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run(id, name, u.id, JSON.stringify(p.base), Date.now());
                db.prepare('INSERT INTO members VALUES(?,?,?)').run(id, u.id, 'owner');
                db.exec('COMMIT');
            }
            catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
            return json(res, 201, { room: { id, name, role: 'owner' } });
        }
        const id = parts[1];
        if (!id)
            fail(404, 'Room not found');
        if (parts[2] === 'join' && method === 'POST') {
            const u = authenticate(req);
            rate(req, 'join', 30);
            const p = await body(req, 4096), invite = db.prepare('SELECT * FROM invites WHERE hash=? AND room_id=? AND expires>?').get(digest(String(p.token ?? '')), id, Date.now());
            if (!invite)
                fail(403, 'Invitation is invalid, expired, or revoked');
            if (!member(id, u))
                db.prepare('INSERT INTO members VALUES(?,?,?)').run(id, u.id, invite.role);
            return json(res, 200, { room: member(id, u) });
        }
        if (parts.length === 2 && method === 'GET') {
            const { m } = permit(req, id);
            return json(res, 200, { room: m, document: roomDocument(id) });
        }
        if (parts[2] === 'invites') {
            permit(req, id, true);
            if (method === 'POST') {
                rate(req, 'invite', 40);
                const p = await body(req, 4096), role = p.role ?? 'editor';
                if (!['editor', 'viewer'].includes(role))
                    fail(400, 'Invite role must be editor or viewer');
                const token = randomBytes(32).toString('hex'), expires = Date.now() + 7 * 86400000;
                db.prepare('INSERT INTO invites VALUES(?,?,?,?)').run(digest(token), id, role, expires);
                return json(res, 201, { token, role, expires });
            }
            if (method === 'DELETE') {
                db.prepare('DELETE FROM invites WHERE room_id=?').run(id);
                return json(res, 200, { ok: true });
            }
        }
        if (parts[2] === 'members') {
            if (parts.length === 3 && method === 'GET') {
                permit(req, id);
                const members = db.prepare('SELECT u.id,u.name,m.role FROM members m JOIN users u ON m.user_id=u.id WHERE m.room_id=?').all(id);
                return json(res, 200, { members });
            }
            if (parts.length === 4 && method === 'PATCH') {
                const { m } = permit(req, id, true), p = await body(req, 4096), target = parts[3];
                if (target === m.owner_id)
                    fail(400, 'Owner permissions cannot be changed');
                if (!['editor', 'viewer', 'removed'].includes(p.role))
                    fail(400, 'Invalid role');
                if (p.role === 'removed')
                    db.prepare('DELETE FROM members WHERE room_id=? AND user_id=?').run(id, target);
                else
                    db.prepare('UPDATE members SET role=? WHERE room_id=? AND user_id=?').run(p.role, id, target);
                for (const peer of peers.get(id) ?? [])
                    if (peer.user.id === target) {
                        if (p.role === 'removed')
                            peer.close(1008, 'Room access revoked');
                        else {
                            peer.role = p.role;
                            peer.send({ type: 'role', role: p.role });
                        }
                    }
                presence(id);
                return json(res, 200, { ok: true });
            }
        }
    }
    fail(404, 'API endpoint not found');
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.cforge': 'application/json' };
const server = http.createServer(async (req, res) => { headers(req, res); try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/'))
        return await api(req, res, url);
    if (!['GET', 'HEAD'].includes(req.method))
        fail(405, 'Method not allowed');
    if (url.pathname === '/' || url.pathname === '/studio') {
        res.writeHead(302, { Location: url.pathname === '/' ? '/apps/site/' : '/apps/studio/' });
        return res.end();
    }
    let pathname = decodeURIComponent(url.pathname);
    if (!['/apps/', '/packages/', '/dist/', '/examples/', '/docs/'].some(p => pathname.startsWith(p)) || pathname.split('/').some(p => p.startsWith('.')))
        fail(404, 'Not found');
    if (pathname.endsWith('/'))
        pathname += 'index.html';
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep) || !types[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile())
        fail(404, 'Not found');
    res.setHeader('Cache-Control', 'no-cache');
    if (!pathname.startsWith('/dist/'))
        res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss: http: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Content-Length': fs.statSync(file).size });
    if (req.method === 'HEAD')
        return res.end();
    fs.createReadStream(file).pipe(res);
}
catch (e) {
    if (!res.headersSent)
        json(res, e.status ?? 400, { error: e.status ? e.message : e.message ?? 'Request failed' });
    else
        res.end();
} });
server.on('upgrade', (req, socket, head) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/api/socket' || !originOK(req))
            throw Error('Not allowed');
        const user = userFor(req), id = url.searchParams.get('room'), m = member(id, user);
        if (!m)
            throw Error('Unauthorized');
        const peer = upgradeWebSocket(req, socket, head);
        if (!peer)
            return;
        peer.user = user;
        peer.role = m.role;
        peer.room = id;
        peer.sessionHash = digest(cookie(req).cf_session);
        peer.rate = { start: Date.now(), count: 0 };
        if (!peers.has(id))
            peers.set(id, new Set());
        peers.get(id).add(peer);
        peer.send({ type: 'sync', role: m.role, document: roomDocument(id) });
        presence(id);
        peer.on('message', text => {
            try {
                const now = Date.now();
                if (now - peer.rate.start > 1000)
                    peer.rate = { start: now, count: 0 };
                if (++peer.rate.count > 60)
                    throw Error('Message rate exceeded');
                const msg = JSON.parse(text);
                if (msg.type === 'cursor') {
                    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y))
                        return;
                    broadcast(id, { type: 'cursor', actor: user.id, name: user.name, view: msg.view === '2d' ? '2d' : '3d', x: Math.max(0, Math.min(1, msg.x)), y: Math.max(0, Math.min(1, msg.y)) }, peer);
                    return;
                }
                if (msg.type !== 'operation')
                    throw Error('Unknown message type');
                const op = msg.operation;
                try {
                    const current = db.prepare('SELECT role FROM members WHERE room_id=? AND user_id=?').get(id, user.id);
                    if (!current || current.role === 'viewer')
                        throw Error('This room is read-only for viewers');
                    validateOperation(op);
                    if (op.actor !== user.id)
                        throw Error('Operation actor must match authenticated user');
                    if (text.length > 9 * 1024 * 1024)
                        throw Error('Operation too large');
                    if (op.type === 'history:toggle') {
                        const target = db.prepare('SELECT actor FROM operations WHERE room_id=? AND op_id=?').get(id, op.payload.target);
                        if (!target || target.actor !== user.id)
                            throw Error('Only your own operations can be undone');
                    }
                    const exists = db.prepare('SELECT json FROM operations WHERE room_id=? AND op_id=?').get(id, op.id);
                    if (exists) {
                        peer.send({ type: 'ack', id: op.id });
                        return;
                    }
                    if (db.prepare('SELECT count(*) AS n FROM operations WHERE room_id=?').get(id).n >= 100000)
                        throw Error('Room operation limit reached. Export and create a new shared project.');
                    db.prepare('INSERT INTO operations(room_id,op_id,actor,json) VALUES(?,?,?,?)').run(id, op.id, user.id, JSON.stringify(op));
                    broadcast(id, { type: 'operation', operation: op });
                    peer.send({ type: 'ack', id: op.id });
                }
                catch (e) {
                    peer.send({ type: 'rejected', id: op?.id, error: e.message });
                }
            }
            catch (e) {
                peer.send({ type: 'error', error: e.message });
            }
        });
        peer.on('close', () => { peers.get(id)?.delete(peer); if (!peers.get(id)?.size)
            peers.delete(id);
        else
            presence(id); });
    }
    catch {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
});
const maintenance = setInterval(() => { for (const list of peers.values())
    for (const p of list) {
        const valid = db.prepare('SELECT 1 FROM sessions WHERE hash=? AND expires>?').get(p.sessionHash, Date.now());
        if (!valid)
            p.close(1008, 'Session expired');
        else
            p.ping();
    } db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); db.prepare('DELETE FROM invites WHERE expires<?').run(Date.now()); for (const [key, val] of limits)
    if (Date.now() - val.start > 3600000)
        limits.delete(key); }, 30000);
maintenance.unref();
server.listen(PORT, HOST, () => console.log(`ChromaForge running at http://${HOST}:${server.address().port}\nStudio: http://${HOST}:${server.address().port}/apps/studio/\nData: ${DATA}`));
function shutdown() { clearInterval(maintenance); for (const list of peers.values())
    for (const p of list)
        p.close(1001, 'Server shutdown'); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

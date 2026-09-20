import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
/** Minimal RFC 6455 transport: masked client frames, fragmentation, ping/pong,
 * bounded payloads/backpressure, strict UTF-8 and close handling. No compression.
 */
export class WebSocketPeer extends EventEmitter {
    constructor(socket, head = Buffer.alloc(0), maxBytes = 10 * 1024 * 1024) { super(); this.socket = socket; this.buffer = Buffer.alloc(0); this.fragments = []; this.fragmentBytes = 0; this.fragmentOpcode = 0; this.maxBytes = maxBytes; this.closed = false; this.lastPong = Date.now(); socket.on('data', b => this.read(b)); socket.on('close', () => { if (!this.closed) {
        this.closed = true;
        this.emit('close');
    } }); socket.on('error', () => this.close(1011, 'Transport error')); if (head.length)
        queueMicrotask(() => this.read(head)); }
    send(data) { if (this.closed || this.socket.destroyed)
        return false; const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)); if (this.socket.writableLength > this.maxBytes) {
        this.close(1013, 'Slow consumer');
        return false;
    } return this.frame(1, bytes); }
    frame(opcode, payload = Buffer.alloc(0)) { if (this.socket.destroyed)
        return false; let header; if (payload.length < 126) {
        header = Buffer.alloc(2);
        header[1] = payload.length;
    }
    else if (payload.length < 65536) {
        header = Buffer.alloc(4);
        header[1] = 126;
        header.writeUInt16BE(payload.length, 2);
    }
    else {
        header = Buffer.alloc(10);
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
    } header[0] = 0x80 | opcode; return this.socket.write(Buffer.concat([header, payload])); }
    ping() { if (Date.now() - this.lastPong > 90000) {
        this.close(1001, 'Heartbeat timeout');
        return;
    } this.frame(9, Buffer.from('cf')); }
    close(code = 1000, reason = '') { if (this.closed)
        return; const r = Buffer.from(reason).subarray(0, 123), p = Buffer.alloc(r.length + 2); p.writeUInt16BE(code); r.copy(p, 2); this.frame(8, p); this.closed = true; this.socket.end(); this.emit('close'); setTimeout(() => this.socket.destroy(), 1000).unref(); }
    read(chunk) {
        if (this.closed)
            return;
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length > this.maxBytes + 14) {
            this.close(1009, 'Message too large');
            return;
        }
        while (this.buffer.length >= 2) {
            let b = this.buffer, first = b[0], opcode = first & 15, fin = !!(first & 128), masked = !!(b[1] & 128), length = b[1] & 127, offset = 2;
            if (first & 112 || !masked || ![0, 1, 2, 8, 9, 10].includes(opcode)) {
                this.close(1002, 'Invalid frame');
                return;
            }
            if (length === 126) {
                if (b.length < 4)
                    return;
                length = b.readUInt16BE(2);
                offset = 4;
                if (length < 126) {
                    this.close(1002, 'Noncanonical length');
                    return;
                }
            }
            else if (length === 127) {
                if (b.length < 10)
                    return;
                const n = b.readBigUInt64BE(2);
                if (n > BigInt(this.maxBytes) || n < 65536n) {
                    this.close(n > BigInt(this.maxBytes) ? 1009 : 1002, 'Invalid payload length');
                    return;
                }
                length = Number(n);
                offset = 10;
            }
            if (length > this.maxBytes || opcode >= 8 && (!fin || length > 125)) {
                this.close(1009, 'Invalid control/payload size');
                return;
            }
            if (b.length < offset + 4 + length)
                return;
            const mask = b.subarray(offset, offset + 4);
            offset += 4;
            const payload = Buffer.allocUnsafe(length);
            for (let i = 0; i < length; i++)
                payload[i] = b[offset + i] ^ mask[i & 3];
            this.buffer = b.subarray(offset + length);
            if (opcode === 8) {
                if (length === 1) {
                    this.close(1002, 'Invalid close');
                    return;
                }
                this.close(1000, 'Closed');
                return;
            }
            if (opcode === 9) {
                this.frame(10, payload);
                continue;
            }
            if (opcode === 10) {
                this.lastPong = Date.now();
                continue;
            }
            if (opcode === 2) {
                this.close(1003, 'Binary messages not supported');
                return;
            }
            if (opcode === 1) {
                if (this.fragmentOpcode) {
                    this.close(1002, 'Nested fragments');
                    return;
                }
                if (!fin) {
                    this.fragmentOpcode = 1;
                    this.fragments = [payload];
                    this.fragmentBytes = payload.length;
                    continue;
                }
                this.message(payload);
            }
            else if (opcode === 0) {
                if (!this.fragmentOpcode) {
                    this.close(1002, 'Unexpected continuation');
                    return;
                }
                this.fragments.push(payload);
                this.fragmentBytes += payload.length;
                if (this.fragmentBytes > this.maxBytes) {
                    this.close(1009, 'Message too large');
                    return;
                }
                if (fin) {
                    this.message(Buffer.concat(this.fragments));
                    this.fragments = [];
                    this.fragmentBytes = 0;
                    this.fragmentOpcode = 0;
                }
            }
        }
    }
    message(payload) { try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
        this.emit('message', text);
    }
    catch {
        this.close(1007, 'Invalid UTF-8');
    } }
}
export function upgradeWebSocket(req, socket, head) { const key = req.headers['sec-websocket-key']; if (req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' || !key || Buffer.from(key, 'base64').length !== 16) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
} const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`); return new WebSocketPeer(socket, head); }

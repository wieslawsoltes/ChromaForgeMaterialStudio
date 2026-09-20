import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocketPeer } from '../server/websocket.js';
class Socket extends EventEmitter {
    constructor() { super(); this.writes = []; this.destroyed = false; this.writableLength = 0; }
    write(b) { this.writes.push(b); return true; }
    end() { }
    destroy() { this.destroyed = true; }
}
function frame(text, { opcode = 1, fin = true, masked = true } = {}) { const data = Buffer.from(text), mask = Buffer.from([3, 4, 5, 6]), b = Buffer.alloc(2 + (masked ? 4 : 0) + data.length); b[0] = (fin ? 128 : 0) | opcode; b[1] = (masked ? 128 : 0) | data.length; if (masked)
    mask.copy(b, 2); for (let i = 0; i < data.length; i++)
    b[2 + (masked ? 4 : 0) + i] = data[i] ^ (masked ? mask[i & 3] : 0); return b; }
test('RFC6455 masked text and split TCP packets decode', () => { const sock = new Socket(), peer = new WebSocketPeer(sock), result = []; peer.on('message', m => result.push(m)); const data = frame('hello'); peer.read(data.subarray(0, 3)); peer.read(data.subarray(3)); assert.deepEqual(result, ['hello']); });
test('RFC6455 fragmented text reconstructs UTF-8', () => { const sock = new Socket(), peer = new WebSocketPeer(sock), result = []; peer.on('message', m => result.push(m)); peer.read(frame('hel', { fin: false })); peer.read(frame('lo', { opcode: 0 })); assert.deepEqual(result, ['hello']); });
test('RFC6455 unmasked client frames are rejected', () => { const sock = new Socket(), peer = new WebSocketPeer(sock); peer.read(frame('bad', { masked: false })); assert.equal(peer.closed, true); assert.equal(sock.writes[0].readUInt16BE(2), 1002); });
test('RFC6455 ping receives pong', () => { const sock = new Socket(), peer = new WebSocketPeer(sock); peer.read(frame('cf', { opcode: 9 })); assert.equal(sock.writes[0][0], 138); });
test('RFC6455 invalid UTF-8 is rejected', () => { const sock = new Socket(), peer = new WebSocketPeer(sock); peer.read(frame(Buffer.from([255, 255]))); assert.equal(peer.closed, true); assert.equal(sock.writes[0].readUInt16BE(2), 1007); });
test('RFC6455 message budget rejects excessive payload', () => { const sock = new Socket(), peer = new WebSocketPeer(sock, Buffer.alloc(0), 16); peer.read(frame('x'.repeat(31))); assert.equal(peer.closed, true); });

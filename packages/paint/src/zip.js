/** Dependency-free ZIP writer (stored entries, UTF-8, CRC32). PNG files are already compressed. */
const table = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let c = 0xffffffff; for (const b of bytes)
    c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export async function createZip(files) { if (Object.keys(files).length > 65535)
    throw Error('ZIP64 is not supported'); let local = [], central = [], offset = 0; const enc = new TextEncoder(); for (const [name, value] of Object.entries(files)) {
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.includes('\0') || name.split('/').includes('..'))
        throw Error('ZIP entry must be a safe relative path');
    const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : typeof value === 'string' ? enc.encode(value) : new Uint8Array(value), nb = enc.encode(name), crc = crc32(bytes);
    if (nb.length > 65535)
        throw Error('ZIP entry name too long');
    if (bytes.length > 0xffffffff || offset + bytes.length + 30 + nb.length > 0xffffffff)
        throw Error('ZIP64 is not supported');
    const h = new Uint8Array(30 + nb.length), d = new DataView(h.buffer);
    d.setUint32(0, 0x04034b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 0x800, true);
    d.setUint32(14, crc, true);
    d.setUint32(18, bytes.length, true);
    d.setUint32(22, bytes.length, true);
    d.setUint16(26, nb.length, true);
    h.set(nb, 30);
    local.push(h, bytes);
    const c = new Uint8Array(46 + nb.length), v = new DataView(c.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x800, true);
    v.setUint32(16, crc, true);
    v.setUint32(20, bytes.length, true);
    v.setUint32(24, bytes.length, true);
    v.setUint16(28, nb.length, true);
    v.setUint32(42, offset, true);
    c.set(nb, 46);
    central.push(c);
    offset += h.length + bytes.length;
} const cs = central.reduce((s, b) => s + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, cs, true); e.setUint32(16, offset, true); return new Blob([...local, ...central, end], { type: 'application/zip' }); }
export function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }

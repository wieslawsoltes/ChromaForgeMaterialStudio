/** IndexedDB saves are atomic. Documents and outbox operations survive a reload. */
export class ProjectDatabase {
    constructor(name = 'chromaforge') { this.name = name; this.db = null; }
    async open() { if (this.db)
        return this; this.db = await new Promise((resolve, reject) => { const r = indexedDB.open(this.name, 1); r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('settings'); r.result.createObjectStore('outbox', { keyPath: 'id' }); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); return this; }
    async transaction(store, mode, fn) { await this.open(); return new Promise((resolve, reject) => { const tx = this.db.transaction(store, mode), result = fn(tx.objectStore(store)); tx.oncomplete = () => resolve(result?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? Error('Storage transaction aborted')); }); }
    async save(store) { return this.transaction('projects', 'readwrite', s => s.put({ id: store.state.id, name: store.state.name, updated: Date.now(), data: store.serialize() })); }
    get(id) { return this.transaction('projects', 'readonly', s => s.get(id)); }
    list() { return this.transaction('projects', 'readonly', s => s.getAll()); }
    delete(id) { return this.transaction('projects', 'readwrite', s => s.delete(id)); }
    setting(key, value) { return this.transaction('settings', value === undefined ? 'readonly' : 'readwrite', s => value === undefined ? s.get(key) : s.put(value, key)); }
    queue(op, room) { return this.transaction('outbox', 'readwrite', s => s.put({ ...op, room })); }
    pending() { return this.transaction('outbox', 'readonly', s => s.getAll()); }
    acknowledge(id) { return this.transaction('outbox', 'readwrite', s => s.delete(id)); }
    close() { this.db?.close(); this.db = null; }
}

/** Subscription API has deterministic teardown and does not depend on browser globals. */
export class Signal {
    #listeners = new Map();
    on(type, fn) { let s = this.#listeners.get(type); if (!s)
        this.#listeners.set(type, s = new Set()); s.add(fn); return () => s.delete(fn); }
    emit(type, data) { for (const f of [...(this.#listeners.get(type) ?? [])])
        f(data); }
    clear() { this.#listeners.clear(); }
}

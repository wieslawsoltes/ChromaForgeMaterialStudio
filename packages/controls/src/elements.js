/** Native web components with shadow-DOM isolation and accessible form controls. */
export class CFSlider extends HTMLElement {
    static get observedAttributes() { return ['value', 'min', 'max', 'step', 'label', 'suffix']; }
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected)
        this.render(); }
    get value() { return Number(this.getAttribute('value') ?? 0); }
    set value(v) { this.setAttribute('value', v); }
    render() {
        const label = this.getAttribute('label') ?? '', min = this.getAttribute('min') ?? '0', max = this.getAttribute('max') ?? '1', step = this.getAttribute('step') ?? '.01';
        this.shadowRoot.innerHTML = `<style>:host{display:block;font:11px var(--font,system-ui);color:var(--text,#c6c8cc);margin:11px 0}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px}label{color:var(--muted,#989ca3)}input[type=number]{width:57px;text-align:right;background:var(--input,#202124);border:1px solid var(--border,#35373b);border-radius:3px;color:inherit;font:inherit;padding:3px 5px;appearance:textfield}input[type=number]::-webkit-inner-spin-button{appearance:none}input[type=range]{display:block;width:100%;height:3px;margin:0;accent-color:var(--accent,#d4a45a);cursor:ew-resize}input:focus-visible{outline:2px solid var(--accent,#d4a45a);outline-offset:3px}</style><header><label>${label.replace(/[<&]/g, '')}</label><input type="number" aria-label="${label.replace(/["<&]/g, '')}" min="${min}" max="${max}" step="${step}" value="${this.value}"></header><input type="range" aria-label="${label.replace(/["<&]/g, '')}" min="${min}" max="${max}" step="${step}" value="${this.value}">`;
        const [number, range] = this.shadowRoot.querySelectorAll('input');
        for (const input of [number, range]) {
            input.oninput = () => { const v = Math.max(Number(min), Math.min(Number(max), Number(input.value))); number.value = range.value = v; this._value = v; this.dispatchEvent(new CustomEvent('value-input', { detail: v, bubbles: true, composed: true })); };
            input.onchange = () => { const v = Number(input.value); this.setAttribute('value', v); this.dispatchEvent(new CustomEvent('value-change', { detail: v, bubbles: true, composed: true })); };
        }
    }
}
export class CFSplitter extends HTMLElement {
    connectedCallback() { this.tabIndex = 0; this.setAttribute('role', 'separator'); const vertical = this.getAttribute('direction') !== 'horizontal'; this.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal'); this.onpointerdown = e => { if (e.button !== 0)
        return; e.preventDefault(); this.setPointerCapture(e.pointerId); const prop = this.getAttribute('property'), target = this.closest('[data-layout]') ?? document.documentElement, start = vertical ? e.clientX : e.clientY, initial = parseFloat(getComputedStyle(target).getPropertyValue(prop)) || 200, sign = Number(this.getAttribute('sign') ?? 1); this.onpointermove = e => { let value = Math.max(Number(this.getAttribute('min') ?? 120), Math.min(Number(this.getAttribute('max') ?? 650), initial + ((vertical ? e.clientX : e.clientY) - start) * sign)); target.style.setProperty(prop, `${value}px`); }; this.onpointerup = e => { this.onpointermove = null; this.releasePointerCapture(e.pointerId); this.dispatchEvent(new CustomEvent('resize-end', { bubbles: true })); }; }; this.ondblclick = () => { const target = this.closest('[data-layout]') ?? document.documentElement; target.style.removeProperty(this.getAttribute('property')); }; this.onkeydown = e => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
        return; e.preventDefault(); const target = this.closest('[data-layout]') ?? document.documentElement, prop = this.getAttribute('property'), v = parseFloat(getComputedStyle(target).getPropertyValue(prop)) || 200; target.style.setProperty(prop, `${Math.max(100, v + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 10 : -10))}px`); }; }
}
export function registerControls() { if (!customElements.get('cf-slider'))
    customElements.define('cf-slider', CFSlider); if (!customElements.get('cf-splitter'))
    customElements.define('cf-splitter', CFSplitter); }
export class CommandRegistry {
    constructor() { this.commands = new Map(); }
    register(id, label, execute, options = {}) { if (this.commands.has(id))
        throw Error(`Duplicate command ${id}`); this.commands.set(id, { id, label, execute, ...options }); return this; }
    async run(id, ...args) { const c = this.commands.get(id); if (!c)
        throw Error(`Unknown command: ${id}`); if (c.enabled && !c.enabled())
        throw Error(`${c.label} is unavailable in this state`); return c.execute(...args); }
    search(query = '') { const q = query.toLowerCase(); return [...this.commands.values()].filter(c => `${c.label} ${c.id}`.toLowerCase().includes(q)); }
}

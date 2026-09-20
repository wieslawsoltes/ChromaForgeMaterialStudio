export function icon(name: string, size?: number): string;
export function esc(value: unknown): string;
export class CFSlider extends HTMLElement {
    value: number;
    render(): void;
}
export class CFSplitter extends HTMLElement {
}
export function registerControls(): void;
export interface Command {
    id: string;
    label: string;
    execute: (...args: any[]) => any;
    key?: string;
    icon?: string;
    enabled?: () => boolean;
}
export class CommandRegistry {
    commands: Map<string, Command>;
    register(id: string, label: string, execute: Command['execute'], options?: Partial<Command>): this;
    run(id: string, ...args: any[]): Promise<any>;
    search(query?: string): Command[];
}

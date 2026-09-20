export type Vec3 = [
    number,
    number,
    number
];
export type Channel = 'baseColor' | 'roughness' | 'metallic' | 'height' | 'emissive' | 'opacity';
export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'difference';
export interface Brush {
    size: number;
    color?: string;
    channels?: Channel[];
    shape?: 'round' | 'square' | 'ring' | 'star' | 'scratch' | 'spray' | 'noise';
    flow?: number;
    hardness?: number;
    spacing?: number;
    angle?: number;
    scatter?: number;
    roughness?: number;
    metallic?: number;
    height?: number;
    emissive?: number;
    opacity?: number;
    pressure?: boolean;
    erase?: boolean;
    wrap?: boolean;
    symmetry?: boolean;
    seed?: number;
}
export interface Stroke {
    id: string;
    target?: 'paint' | 'mask';
    brush: Brush;
    points: Array<[
        number,
        number,
        number?,
        number?
    ]>;
}
export interface Layer {
    id: string;
    name: string;
    type: 'paint' | 'fill' | 'decal';
    visible: boolean;
    opacity: number;
    blend: Blend;
    color: string;
    roughness: number;
    metallic: number;
    height: number;
    emissive: number;
    channels: Channel[];
    pattern: string;
    scale: number;
    seed: number;
    mask: null | {
        base: 'white' | 'black';
        invert?: boolean;
    };
    image?: string;
    transform?: {
        u: number;
        v: number;
        scale: number;
        angle: number;
    };
    strokes: Stroke[];
}
export interface TextureSet {
    id: string;
    name: string;
    visible: boolean;
    layers: Layer[];
}
export interface Project {
    schema: 1;
    id: string;
    name: string;
    model: 'nomad' | 'sphere' | 'cube' | 'torus' | 'imported';
    resolution: number;
    created: string;
    mesh: null | {
        vertices: number[];
        name: string;
        materials: string[];
    };
    textureSets: TextureSet[];
    comments: Array<{
        id: string;
        text: string;
        actor?: string;
        resolved?: boolean;
    }>;
    settings: {
        environment: 'studio' | 'warm' | 'night';
        exposure: number;
        rotation: number;
    };
}
export interface Operation {
    id: string;
    actor: string;
    clock: number;
    type: string;
    payload: Record<string, unknown>;
    label?: string;
    time?: string;
}
export interface ProjectFile {
    format: 'chromaforge';
    version: 1;
    base: Project;
    operations: Operation[];
}
export const CHANNELS: Channel[];
export const BLENDS: Blend[];
export const SCHEMA: 1;
export const PATTERNS: string[];
export function createProject(model?: Project['model'], resolution?: number): Project;
export function createLayer(type?: Layer['type'], name?: string, values?: Partial<Layer>): Layer;
export function validateProject(project: unknown): Project;
export function validateOperation(operation: unknown): Operation;
export function applyOperation(state: Project, operation: Operation): Project;
export class Signal {
    on(type: string, fn: (event: any) => void): () => void;
    emit(type: string, event?: unknown): void;
    clear(): void;
}
export class ProjectStore extends Signal {
    constructor(project?: Project, actor?: string);
    actor: string;
    clock: number;
    base: Project;
    state: Project;
    ops: Map<string, Operation>;
    revision: number;
    readonly operations: Operation[];
    dispatch(type: string, payload: Record<string, unknown>, label?: string): Operation;
    ingest(operations: Operation[], local?: boolean): void;
    rebuild(): void;
    undo(): boolean;
    redo(): boolean;
    serialize(): ProjectFile;
    load(file: ProjectFile): void;
}
export class ProjectDatabase {
    constructor(name?: string);
    open(): Promise<unknown>;
    save(store: ProjectStore): Promise<unknown>;
    get(id: string): Promise<any>;
    list(): Promise<any[]>;
    delete(id: string): Promise<unknown>;
    setting(key: string, value?: unknown): Promise<any>;
    queue(operation: Operation, room: string): Promise<unknown>;
    pending(): Promise<Array<Operation & {
        room: string;
    }>>;
    acknowledge(id: string): Promise<unknown>;
    close(): void;
}
export function clamp(v: number, min?: number, max?: number): number;
export function lerp(a: number, b: number, t: number): number;
export function uid(): string;
export function hexRGB(hex: string): number[];
export function add(a: ArrayLike<number>, b: ArrayLike<number>): Vec3;
export function sub(a: ArrayLike<number>, b: ArrayLike<number>): Vec3;
export function scale(a: ArrayLike<number>, s: number): Vec3;
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number;
export function cross(a: ArrayLike<number>, b: ArrayLike<number>): Vec3;
export function length(a: ArrayLike<number>): number;
export function normalize(a: ArrayLike<number>): Vec3;
export function identity(): Float32Array;
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array;
export function inverse(a: ArrayLike<number>): Float32Array;
export function perspective(fov: number, aspect: number, near?: number, far?: number): Float32Array;
export function orthographic(l: number, r: number, b: number, t: number, n?: number, f?: number): Float32Array;
export function lookAt(eye: Vec3, target: Vec3, up?: Vec3): Float32Array;
export function transform(m: ArrayLike<number>, p: ArrayLike<number>, w?: number): number[];
export function unproject(m: ArrayLike<number>, p: ArrayLike<number>): Vec3;
export function composeTRS(t?: Vec3, q?: [
    number,
    number,
    number,
    number
], s?: Vec3): Float32Array;
export function rayTriangle(o: Vec3, d: Vec3, a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): null | {
    t: number;
    u: number;
    v: number;
};
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3, best?: number): boolean;
export class OrbitCamera {
    target: Vec3;
    yaw: number;
    pitch: number;
    distance: number;
    fov: number;
    ortho: boolean;
    readonly eye: Vec3;
    matrix(aspect: number): Float32Array;
    ray(x: number, y: number, aspect: number): {
        origin: Vec3;
        direction: Vec3;
    };
    orbit(dx: number, dy: number): void;
    pan(dx: number, dy: number): void;
    zoom(delta: number): void;
    frame(): void;
}
export function isRecord(value: unknown): boolean;
export function check(value: unknown, message: string): asserts value;
export function identifier(value: unknown): boolean;
export function finite(value: unknown, min: number, max: number): boolean;
export function text(value: unknown, max?: number): boolean;
export function hexColor(value: unknown): boolean;
export function validateLayer(value: unknown, options?: {
    partial?: boolean;
}): Layer;
export function validateStroke(value: unknown): Stroke;
export function validateSettings(value: unknown): Project['settings'];
export function validateComment(value: unknown): Project['comments'][number];

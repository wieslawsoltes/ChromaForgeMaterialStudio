export interface MeshData {
    vertices: number[];
    name: string;
    materials: string[];
}
export class Mesh {
    constructor(vertices: ArrayLike<number>, name?: string, materials?: string[]);
    vertices: Float32Array;
    name: string;
    materials: string[];
    triangleCount: number;
    bounds: {
        min: number[];
        max: number[];
    };
    warnings?: string[];
    calculateBounds(): Mesh['bounds'];
    normalized(): Mesh;
    toJSON(): MeshData;
    static fromJSON(data: MeshData): Mesh;
}
export class MeshBuilder {
    add(vertices: number[], options?: {
        position?: number[];
        rotation?: number[];
        size?: number[];
        material?: number;
    }): this;
    finish(name?: string, materials?: string[]): Mesh;
}
export function createModel(name?: string): Mesh;
export function roundedBox(size?: number[], r?: number, n?: number): number[];
export function sphere(radius?: number, nu?: number, nv?: number): number[];
export function torus(radius?: number, tube?: number, nu?: number, nv?: number): number[];
export function cylinder(radius?: number, depth?: number, segments?: number): number[];
export interface Hit {
    t: number;
    u: number;
    v: number;
    triangle: number;
    material: number;
    uv: [
        number,
        number
    ];
    position: number[];
    normal: number[];
}
export class MeshBVH {
    constructor(mesh: Mesh, leafSize?: number);
    intersect(origin: ArrayLike<number>, direction: ArrayLike<number>, options?: {
        material?: number;
        maxDistance?: number;
        ignoreTriangle?: number;
        visible?: ArrayLike<number | boolean>;
    }): Hit | null;
}
export function parseOBJ(text: string, name?: string): Mesh;
export function exportOBJ(mesh: Mesh): string;
export function parseGLTF(input: string | ArrayBuffer | Record<string, unknown>, options?: {
    name?: string;
    resolve?: (uri: string) => Promise<ArrayBuffer>;
}): Promise<Mesh>;

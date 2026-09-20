export const MATERIALS: Array<{
    id: string;
    name: string;
    category: string;
    color: string;
    roughness: number;
    metallic: number;
    pattern: string;
    emissive?: number;
}>;
export const BRUSHES: Array<{
    id: string;
    name: string;
    shape: string;
    hardness: number;
    flow: number;
    spacing: number;
    scatter?: number;
}>;
export function hash(x: number, y: number, seed?: number): number;
export function noise(x: number, y: number, seed?: number): number;
export function fbm(x: number, y: number, seed?: number): number;
export function sampleMaterial(layer: any, u: number, v: number): {
    color: number[];
    roughness: number;
    metallic: number;
    height: number;
    emissive: number;
    opacity: number;
};
export function materialThumbnail(material: any, size?: number): string;
export function makeCanvas(width: number, height?: number): HTMLCanvasElement;
export function stampStroke(canvas: HTMLCanvasElement, stroke: any, channel: string, mask?: boolean): void;
export interface TextureOutput {
    maps: Record<string, HTMLCanvasElement>;
    color: HTMLCanvasElement;
    orm: HTMLCanvasElement;
    emissive: HTMLCanvasElement;
    version: number;
}
export class TextureCompositor {
    constructor(size?: number);
    size: number;
    outputs: Map<string, TextureOutput>;
    stats: {
        layers: number;
        milliseconds: number;
    };
    resize(size: number): void;
    loadImage(url: string): Promise<HTMLImageElement | null>;
    compose(set: any, preview?: any): TextureOutput;
    normalMap(setId: string, strength?: number): HTMLCanvasElement;
    export(setId: string, channel: string): Promise<Blob>;
    dispose(keepImages?: boolean): void;
}
export function bakeMeshMaps(mesh: any, options?: {
    size?: number;
    samples?: number;
    maxDistance?: number;
    material?: number;
    onProgress?: (value: number) => void;
    signal?: AbortSignal;
}): Promise<{
    size: number;
    maps: Record<string, Uint8ClampedArray>;
}>;
export function crc32(bytes: Uint8Array): number;
export function createZip(files: Record<string, Blob | string | ArrayBuffer | Uint8Array>): Promise<Blob>;
export function downloadBlob(blob: Blob, name: string): void;

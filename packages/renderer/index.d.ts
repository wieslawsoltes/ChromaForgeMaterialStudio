export interface MaterialOutput {
    color: HTMLCanvasElement;
    orm: HTMLCanvasElement;
    emissive: HTMLCanvasElement;
}
export interface RenderMesh {
    vertices: Float32Array;
    name?: string;
    materials?: string[];
    triangleCount: number;
}
export class MaterialRenderer {
    constructor(canvas: HTMLCanvasElement, options?: {
        forceWebGL?: boolean;
        maxDPR?: number;
    });
    canvas: HTMLCanvasElement;
    mode: string;
    ready: boolean;
    dirty: boolean;
    frames: number;
    frameTime: number;
    visible: Float32Array;
    settings: {
        exposure: number;
        rotation: number;
        channel: number;
        normalStrength: number;
        floor: boolean;
        wireframe: boolean;
        environment: number;
    };
    camera: {
        target: number[];
        yaw: number;
        pitch: number;
        distance: number;
        fov: number;
        ortho: boolean;
        readonly eye: number[];
        matrix(aspect: number): Float32Array;
        ray(x: number, y: number, aspect: number): {
            origin: number[];
            direction: number[];
        };
        orbit(dx: number, dy: number): void;
        pan(dx: number, dy: number): void;
        zoom(delta: number): void;
        frame(): void;
    };
    initialize(): Promise<this>;
    setMesh(mesh: RenderMesh): void;
    upload(index: number, output: MaterialOutput, totalSets: number): void;
    resize(): void;
    invalidate(): void;
    draw(): boolean;
    snapshot(): Promise<Blob | null>;
    dispose(): void;
    on(event: string, callback: (value: any) => void): () => void;
}

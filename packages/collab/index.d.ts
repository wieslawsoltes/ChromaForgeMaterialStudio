export interface User {
    id: string;
    name: string;
    email: string;
}
export interface Room {
    id: string;
    name: string;
    role: 'owner' | 'editor' | 'viewer';
}
export class CollaborationClient {
    constructor(store: any, database: any, options?: {
        baseURL?: string;
    });
    baseURL: string;
    user: User | null;
    room: Room | null;
    connected: boolean;
    pending: Map<string, any>;
    on(type: string, callback: (event: any) => void): () => void;
    session(): Promise<User | null>;
    register(name: string, email: string, password: string): Promise<User>;
    login(email: string, password: string): Promise<User>;
    logout(): Promise<void>;
    rooms(): Promise<Room[]>;
    createRoom(name: string): Promise<Room>;
    invite(id: string, role?: 'editor' | 'viewer'): Promise<{
        token: string;
        role: string;
        expires: number;
    }>;
    revokeInvites(id: string): Promise<{
        ok: boolean;
    }>;
    join(id: string, token: string): Promise<{
        room: Room;
    }>;
    members(id?: string): Promise<{
        members: Array<{
            id: string;
            name: string;
            role: string;
        }>;
    }>;
    setRole(userId: string, role: 'editor' | 'viewer' | 'removed'): Promise<{
        ok: boolean;
    }>;
    connect(id: string): Promise<void>;
    cursor(position: {
        x: number;
        y: number;
        view: '2d' | '3d';
    }): void;
    disconnect(): void;
    dispose(): void;
}

export interface CompileCommand {
    source: string;
    path: string;
    pixel_per_pt: number;
    fill: string;
    size: number;
    display: boolean;
}

export interface WorkerRequest {
    buffer: Int32Array,
    path: string
}

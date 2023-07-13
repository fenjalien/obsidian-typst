export interface CompileCommand {
    source: string;
    path: string;
    pixel_per_pt: number;
    fill: string;
}

export interface WorkerRequest {
    buffer: Int32Array,
    path: string
}
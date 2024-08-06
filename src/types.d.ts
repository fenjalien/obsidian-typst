export interface CompileImageCommand {
  format: "image";
  source: string;
  path: string;
  pixel_per_pt: number;
  fill: string;
  size: number;
  display: boolean;
}

export interface CompileSvgCommand {
  format: "svg";
  source: string;
  path: string;
}

export interface WorkerRequest {
  buffer: Int32Array;
  path: string;
}

export interface Message {
  type: string;
  data: any;
}

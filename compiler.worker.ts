//@ts-ignore
import wasmBin from './pkg/obsidian_typst_bg.wasm'
import * as typst from './pkg'

import { CompileCommand, WorkerRequest } from "types";

typst.initSync(wasmBin);

let canUseSharedArrayBuffer = new Boolean(false);

// let buffer: Int32Array;
let decoder = new TextDecoder()

function requestData(path: string): string {
    if (!canUseSharedArrayBuffer) {
        throw "Cannot read files on mobile"
    }

    // @ts-expect-error
    let buffer = new Int32Array(new SharedArrayBuffer(4, { maxByteLength: 1e8 }))
    buffer[0] = 0;
    postMessage({ buffer, path })
    const res = Atomics.wait(buffer, 0, 0);
    if (buffer[0] == 0) {
        return decoder.decode(Uint8Array.from(buffer.slice(1)))
    }

    throw "AAAAAAAAAAAAAAA"
}

const compiler = new typst.SystemWorld("", requestData)


onmessage = (ev: MessageEvent<CompileCommand | true>) => {
    if (ev.data == true) {
        canUseSharedArrayBuffer = ev.data
    } else if ("source" in ev.data) {
        const data: CompileCommand = ev.data;
        postMessage(compiler.compile(data.source, data.path, data.pixel_per_pt, data.fill))
    } else {
        throw ev;
    }
}

console.log("Typst compiler worker loaded!");

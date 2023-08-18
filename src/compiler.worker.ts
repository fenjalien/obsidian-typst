//@ts-ignore
import wasmBin from '../pkg/obsidian_typst_bg.wasm'
import * as typst from '../pkg'

import { CompileCommand, WorkerRequest } from "src/types";

typst.initSync(wasmBin);

let canUseSharedArrayBuffer = new Boolean(false);

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

    throw buffer[0]
}

const compiler = new typst.SystemWorld("", requestData)

onmessage = (ev: MessageEvent<CompileCommand | true>) => {
    if (ev.data == true) {
        canUseSharedArrayBuffer = ev.data
    } else if (ev.data instanceof Array) {
        ev.data.forEach(font => compiler.add_font(new Uint8Array(font)))
    } else if ("source" in ev.data) {
        const data: CompileCommand = ev.data;
        postMessage(compiler.compile(data.source, data.path, data.pixel_per_pt, data.fill, data.size, data.display))

        // postMessage(compile(ev.data))
    } else {
        throw ev;
    }
}

console.log("Typst compiler worker loaded!");

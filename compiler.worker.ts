//@ts-ignore
import wasmBin from './pkg/obsidian_typst_bg.wasm'
import * as typst from './pkg'

import CompileCommand from "types";

typst.initSync(wasmBin);


let file: Int32Array;

function readFile(path: string) {
    postMessage(path)
    const res = Atomics.wait(file, 0, 0);
    if (res == "ok") {
        return Uint8Array.from(file.slice(1))
    }
    throw "AAAAAAAAAAAAAAA"
}

const compiler = new typst.SystemWorld("", readFile)


onmessage = (ev: MessageEvent<CompileCommand | Int32Array>) => {
    if (ev.data instanceof Int32Array && file == undefined) {
        file = ev.data;
    } else if ("source" in ev.data) {
        const data: CompileCommand = ev.data;
        postMessage(compiler.compile(data.source, data.path, data.pixel_per_pt, data.fill))
    } else {
        throw ev;
    }
}

console.log("Typst compiler worker loaded!");

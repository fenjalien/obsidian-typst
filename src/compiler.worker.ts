import typstInit, * as typst from '../pkg'

import { CompileImageCommand, CompileSvgCommand } from "src/types";

let canUseSharedArrayBuffer = false;

let decoder = new TextDecoder()
let basePath: string;
const xhr = new XMLHttpRequest()

function requestData(path: string): string {
    if (!canUseSharedArrayBuffer) {
        path = "http://localhost/_capacitor_file_" + basePath + "/" + path
        console.log(path);
        xhr.open("GET", path, false)
        xhr.send()
        if (xhr.status != 200) {
            throw "Failed loading file"
        }
        return xhr.responseText
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

let compiler: typst.SystemWorld; //= new typst.SystemWorld("", requestData)

// Receive data from main thread
// `true` means a sharedarraybuffer can be used
// `Array` is a list of fonts to be added to the compiler
// `string` the url to the web assembly binary data
onmessage = (ev: MessageEvent<CompileImageCommand | CompileSvgCommand | true | { wasm: string, basePath: string }>) => {
    if (ev.data == true) {
        canUseSharedArrayBuffer = true
    } else if (ev.data instanceof Array) {
        ev.data.forEach(font => compiler.add_font(new Uint8Array(font)))
    } else if ("wasm" in ev.data) {
        typstInit(ev.data.wasm).then(_ => {
            compiler = new typst.SystemWorld("", requestData)
            console.log("Typst web assembly loaded!");
        })
        basePath = ev.data.basePath
    } else if ("format" in ev.data) {
        if (ev.data.format == "image") {
            const data: CompileImageCommand = ev.data;
            postMessage(compiler.compile_image(data.source, data.path, data.pixel_per_pt, data.fill, data.size, data.display))
        } else if (ev.data.format == "svg") {
            postMessage(compiler.compile_svg(ev.data.source, ev.data.path))
        }
    } else {
        throw ev;
    }
}

console.log("Typst compiler worker loaded!");

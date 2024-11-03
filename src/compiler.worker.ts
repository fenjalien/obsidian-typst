import typstInit, * as typst from '../pkg'

import { CompileImageCommand, CompileSvgCommand, Message } from "src/types";

let canUseSharedArrayBuffer = false;

let decoder = new TextDecoder()
let basePath: string;
let packagePath: string;
let packages: string[] = []
const xhr = new XMLHttpRequest()

function requestData(path: string): string {
    try {
        if (!canUseSharedArrayBuffer) {
            if (path.startsWith("@")) {
                if (packages.includes(path.slice(1))) {
                    return packagePath + path.slice(1)
                }
                throw 2
            }
            path = "http://localhost/_capacitor_file_" + basePath + "/" + path
            xhr.open("GET", path, false)
            try {
                xhr.send()
            } catch (e) {
                console.error(e);
                throw 3
            }
            if (xhr.status == 404) {
                throw 2
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
    } catch (e) {
        if (typeof e != "number") {
            console.error(e)
            throw 1
        }
        throw e
    }
}

let compiler: typst.Compiler;

onmessage = (ev: MessageEvent<Message>) => {
    const message = ev.data
    switch (message.type) {
        case "canUseSharedArrayBuffer":
            canUseSharedArrayBuffer = message.data
            break;
        case "startup":
            typstInit(message.data.wasm).then(_ => {
                compiler = new typst.Compiler("", requestData)
                console.log("Typst web assembly loaded!");
            })
            basePath = message.data.basePath
            packagePath = message.data.packagePath
            break;
        case "fonts":
            message.data.forEach((font: any) => compiler.add_font(new Uint8Array(font)))
            break;
        case "compile":
            if (message.data.format == "image") {
                const data: CompileImageCommand = message.data;
                postMessage(compiler.compile_image(data.source, data.path, data.pixel_per_pt, data.fill, data.size, data.display))
            } else if (message.data.format == "svg") {
                postMessage(compiler.compile_svg(message.data.source, message.data.path))
            }
            break;
        case "packages":
            packages = message.data
            break;
        default:
            throw message
    }
}

console.log("Typst compiler worker loaded!");

import { App, renderMath, HexString, Platform, Plugin, PluginSettingTab, Setting, loadMathJax, normalizePath } from 'obsidian';

// @ts-ignore
import Worker from "./compiler.worker.ts"

import TypstCanvasElement from 'typst-canvas-element';
import { WorkerRequest } from 'types.js';

interface TypstPluginSettings {
    noFill: boolean,
    fill: HexString,
    pixel_per_pt: number,
    search_system: boolean,
    override_math: boolean,
    preamable: {
        shared: string,
        math: string,
        code: string,
    }
}

const DEFAULT_SETTINGS: TypstPluginSettings = {
    noFill: true,
    fill: "#ffffff",
    pixel_per_pt: 3,
    search_system: false,
    override_math: false,
    preamable: {
        shared: "#set text(fill: white, size: SIZE)\n#set page(width: WIDTH, height: HEIGHT)",
        math: "#set page(margin: 0pt)\n#set align(horizon)",
        code: "#set page(margin: (y: 1em, x: 0pt))"
    }
}

export default class TypstPlugin extends Plugin {
    settings: TypstPluginSettings;

    compilerWorker: Worker;

    tex2chtml: any;

    prevCanvasHeight: number = 0;
    textEncoder: TextEncoder
    fs: any;

    async onload() {
        this.compilerWorker = new Worker();
        if (!Platform.isMobileApp) {
            this.compilerWorker.postMessage(true);
            this.fs = require("fs")
        }

        this.textEncoder = new TextEncoder()
        await this.loadSettings()

        TypstCanvasElement.compile = (a, b, c, d, e) => this.processThenCompileTypst(a, b, c, d, e)
        if (customElements.get("typst-renderer") == undefined) {
            customElements.define("typst-renderer", TypstCanvasElement, { extends: "canvas" })
        }

        await loadMathJax()
        renderMath("", false);
        // @ts-expect-error
        this.tex2chtml = MathJax.tex2chtml
        this.overrideMathJax(this.settings.override_math)

        this.addCommand({
            id: "toggle-math-override",
            name: "Toggle math block override",
            callback: () => this.overrideMathJax(!this.settings.override_math)
        })


        this.addSettingTab(new TypstSettingTab(this.app, this));
        this.registerMarkdownCodeBlockProcessor("typst", async (source, el, ctx) => {
            el.appendChild(this.createTypstCanvas("/" + ctx.sourcePath, `${this.settings.preamable.code}\n${source}`, true, false))
        })


        console.log("loaded Typst Renderer");
    }

    // async loadCompilerWorker() {
    //     this.compilerWorker.
    // }

    async compileToTypst(path: string, source: string, size: number, display: boolean): Promise<ImageData> {
        return await navigator.locks.request("typst renderer compiler", async (lock) => {
            this.compilerWorker.postMessage({
                source,
                path,
                pixel_per_pt: this.settings.pixel_per_pt,
                fill: `${this.settings.fill}${this.settings.noFill ? "00" : "ff"}`,
                size,
                display
            });
            while (true) {
                let result: ImageData | WorkerRequest = await new Promise((resolve, reject) => {
                    const listener = (ev: MessageEvent<ImageData>) => {
                        remove();
                        resolve(ev.data);
                    }
                    const errorListener = (error: ErrorEvent) => {
                        remove();
                        reject(error.message)
                    }
                    const remove = () => {
                        this.compilerWorker.removeEventListener("message", listener);
                        this.compilerWorker.removeEventListener("error", errorListener);
                    }
                    this.compilerWorker.addEventListener("message", listener);
                    this.compilerWorker.addEventListener("error", errorListener);
                })

                if (result instanceof ImageData) {
                    return result
                }
                // Cannot reach this point when in mobile app as the worker should
                // not have a SharedArrayBuffer
                await this.handleWorkerRequest(result)
            }
        })
    }

    async handleWorkerRequest({ buffer: wbuffer, path }: WorkerRequest) {
        try {
            let s = await (
                path.startsWith("@")
                    ? this.preparePackage(path)
                    : this.getFileString(path)
            );
            if (s) {


                let buffer = Int32Array.from(this.textEncoder.encode(
                    s
                ));
                if (wbuffer.byteLength < (buffer.byteLength + 4)) {
                    //@ts-expect-error
                    wbuffer.buffer.grow(buffer.byteLength + 4)
                }
                wbuffer.set(buffer, 1)
                wbuffer[0] = 0
            } else {
                wbuffer[0] = -2
            }
        } catch (error) {
            wbuffer[0] = -1
            throw error
        } finally {
            Atomics.notify(wbuffer, 0)
        }
    }

    async getFileString(path: string): Promise<string> {
        if (require("path").isAbsolute(path)) {
            return await this.fs.promises.readFile(path, { encoding: "utf8" })
        } else {
            return await this.app.vault.adapter.read(normalizePath(path))
        }
    }

    async preparePackage(spec: string): Promise<string | undefined> {
        spec = spec.slice(1)
        let subdir = "/typst/packages/" + spec

        let dir = normalizePath(this.getDataDir() + subdir)
        if (this.fs.existsSync(dir)) {
            return dir
        }

        dir = normalizePath(this.getCacheDir() + subdir)

        if (this.fs.existsSync(dir)) {
            return dir
        }
    }

    getDataDir() {
        if (Platform.isLinux) {
            if ("XDG_DATA_HOME" in process.env) {
                return process.env["XDG_DATA_HOME"]
            } else {
                return process.env["HOME"] + "/.local/share"
            }
        } else if (Platform.isWin) {
            return process.env["APPDATA"]
        } else if (Platform.isMacOS) {
            return process.env["HOME"] + "/Library/Application Support"
        }
        throw "Cannot find data directory on an unknown platform"
    }

    getCacheDir() {
        if (Platform.isLinux) {
            if ("XDG_CACHE_HOME" in process.env) {
                return process.env["XDG_DATA_HOME"]
            } else {
                return process.env["HOME"] + "/.cache"
            }
        } else if (Platform.isWin) {
            return process.env["LOCALAPPDATA"]
        } else if (Platform.isMacOS) {
            return process.env["HOME"] + "/Library/Caches"
        }
        throw "Cannot find cache directory on an unknown platform"
    }

    async processThenCompileTypst(path: string, source: string, size: number, display: boolean, fontSize: number) {
        const dpr = window.devicePixelRatio;
        const pxToPt = (px: number) => (px * dpr * (72 / 96)).toString() + "pt"
        const sizing = `#let (WIDTH, HEIGHT, SIZE) = (${display ? pxToPt(size) : "auto"}, ${!display ? pxToPt(size) : "auto"}, ${pxToPt(fontSize)})`
        return this.compileToTypst(
            path,
            `${sizing}\n${this.settings.preamable.shared}\n${source}`,
            size,
            display
        )
    }

    createTypstCanvas(path: string, source: string, display: boolean, math: boolean) {
        let canvas = new TypstCanvasElement();
        canvas.source = source
        canvas.path = path
        canvas.display = display
        canvas.math = math
        return canvas
    }

    createTypstMath(source: string, r: { display: boolean }) {
        const display = r.display;
        source = `${this.settings.preamable.math}\n${display ? `$ ${source} $` : `$${source}$`}`

        return this.createTypstCanvas("/586f8912-f3a8-4455-8a4a-3729469c2cc1.typ", source, display, true)
    }

    onunload() {
        // @ts-expect-error
        MathJax.tex2chtml = this.tex2chtml
        this.compilerWorker.terminate()
    }

    async overrideMathJax(value: boolean) {
        this.settings.override_math = value
        await this.saveSettings();
        if (this.settings.override_math) {
            // @ts-expect-error
            MathJax.tex2chtml = (e, r) => this.createTypstMath(e, r)
        } else {
            // @ts-expect-error
            MathJax.tex2chtml = this.tex2chtml
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class TypstSettingTab extends PluginSettingTab {
    plugin: TypstPlugin;

    constructor(app: App, plugin: TypstPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();


        new Setting(containerEl)
            .setName("No Fill (Transparent)")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.noFill)
                    .onChange(
                        async (value) => {
                            this.plugin.settings.noFill = value;
                            await this.plugin.saveSettings();
                            fill_color.setDisabled(value)
                        }
                    )
            });

        let fill_color = new Setting(containerEl)
            .setName("Fill Color")
            .setDisabled(this.plugin.settings.noFill)
            .addColorPicker((picker) => {
                picker.setValue(this.plugin.settings.fill)
                    .onChange(
                        async (value) => {
                            this.plugin.settings.fill = value;
                            await this.plugin.saveSettings();
                        }
                    )
            })

        new Setting(containerEl)
            .setName("Pixel Per Point")
            .addSlider((slider) =>
                slider.setValue(this.plugin.settings.pixel_per_pt)
                    .setLimits(1, 5, 1)
                    .onChange(
                        async (value) => {
                            this.plugin.settings.pixel_per_pt = value;
                            await this.plugin.saveSettings();
                        }
                    )
                    .setDynamicTooltip()
            )

        new Setting(containerEl)
            .setName("Search System Fonts")
            .setDesc(`Whether the plugin should search for system fonts.
            This is off by default as it takes around 20 seconds to complete but it gives access to more fonts.
            Requires reload of plugin.`)
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.search_system)
                    .onChange(async (value) => {
                        this.plugin.settings.search_system = value;
                        await this.plugin.saveSettings();
                    })
            })

        new Setting(containerEl)
            .setName("Override Math Blocks")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.override_math)
                    .onChange((value) => this.plugin.overrideMathJax(value))
            });

        new Setting(containerEl)
            .setName("Shared Preamable")
            .addTextArea((c) => c.setValue(this.plugin.settings.preamable.shared).onChange(async (value) => { this.plugin.settings.preamable.shared = value; await this.plugin.saveSettings() }))
        new Setting(containerEl)
            .setName("Code Block Preamable")
            .addTextArea((c) => c.setValue(this.plugin.settings.preamable.code).onChange(async (value) => { this.plugin.settings.preamable.code = value; await this.plugin.saveSettings() }))
        new Setting(containerEl)
            .setName("Math Block Preamable")
            .addTextArea((c) => c.setValue(this.plugin.settings.preamable.math).onChange(async (value) => { this.plugin.settings.preamable.math = value; await this.plugin.saveSettings() }))
    }
}

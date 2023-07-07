import { App, FileSystemAdapter, HexString, Notice, Plugin, PluginSettingTab, Setting, Workspace, loadMathJax, normalizePath } from 'obsidian';


// @ts-ignore
import Worker from "./compiler.worker.ts"

import TypstCanvasElement from 'typst-canvas-element';

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
    fileBuffer: Int32Array;

    tex2chtml: any;

    async onload() {
        //@ts-expect-error
        this.fileBuffer = new Int32Array(new SharedArrayBuffer(4, { maxByteLength: 1e8 }));
        this.compilerWorker = new Worker();
        this.compilerWorker.postMessage(this.fileBuffer);
        await this.loadSettings()

        TypstCanvasElement.compile = (a, b, c, d, e) => this.processThenCompileTypst(a, b, c, d, e)
        customElements.define("typst-renderer", TypstCanvasElement, { extends: "canvas" })

        await loadMathJax()
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
            el.appendChild(this.createTypstCanvas("/" + ctx.sourcePath, `${this.settings.preamable.code}\n${source}`, true))
        })

        console.log("loaded Typst Renderer");
    }

    async compileToTypst(path: string, source: string): Promise<ImageData> {
        return await navigator.locks.request("typst renderer compiler", async (lock) => {
            this.compilerWorker.postMessage({
                source,
                path,
                pixel_per_pt: this.settings.pixel_per_pt,
                fill: `${this.settings.fill}${this.settings.noFill ? "00" : "ff"}`
            });
            while (true) {
                let result: ImageData | string = await new Promise((resolve, reject) => {
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

                await this.sendFile(result)
            }
        })
    }

    async sendFile(path: string) {
        console.log("sending file ", path);
        
        try {
            let file = Int32Array.from(new Uint8Array(await this.app.vault.adapter.readBinary(normalizePath(path))))
            //@ts-expect-error
            this.fileBuffer.buffer.grow(file.byteLength + 4)
            this.fileBuffer.set(file, 1)
            this.fileBuffer[0] = 0
        } catch(error) {
            console.error(error);
            this.fileBuffer[0] = -1
            throw error
        } finally {
            console.log("main", this.fileBuffer[0]);
            
            Atomics.notify(this.fileBuffer, 0)
        }
        

    }

    async processThenCompileTypst(path: string, source: string, size: number, display: boolean, fontSize: number) {
        const dpr = window.devicePixelRatio;
        const pxToPt = (px: number) => (px * dpr * (72 / 96)).toString() + "pt"
        const sizing = `#let (WIDTH, HEIGHT, SIZE) = (${display ? pxToPt(size) : "auto"}, ${!display ? pxToPt(size) : "auto"}, ${pxToPt(fontSize)})`
        return this.compileToTypst(
            path,
            `${sizing}\n${this.settings.preamable.shared}\n${source}`
        )
    }

    createTypstCanvas(path: string, source: string, display: boolean) {
        let canvas = new TypstCanvasElement();
        canvas.source = source
        canvas.path = path
        canvas.display = display
        return canvas
    }

    createTypstMath(source: string, r: { display: boolean }) {
        const display = r.display;
        source = `${this.settings.preamable.math}\n${display ? `$ ${source} $` : `$${source}$`}`

        return this.createTypstCanvas("/", source, display)
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
                    ))
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

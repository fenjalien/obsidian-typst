import { App, renderMath, HexString, Platform, Plugin, PluginSettingTab, Setting, loadMathJax, normalizePath } from 'obsidian';

// @ts-ignore
import CompilerWorker from "./compiler.worker.ts"

import TypstRenderElement from './typst-render-element.js';
import { WorkerRequest } from './types';

interface TypstPluginSettings {
    format: string,
    noFill: boolean,
    fill: HexString,
    pixel_per_pt: number,
    search_system: boolean,
    override_math: boolean,
    font_families: string[],
    preamable: {
        shared: string,
        math: string,
        code: string,
    }
}

const DEFAULT_SETTINGS: TypstPluginSettings = {
    format: "image",
    noFill: true,
    fill: "#ffffff",
    pixel_per_pt: 3,
    search_system: false,
    override_math: false,
    font_families: [],
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
        this.compilerWorker = (new CompilerWorker() as Worker);
        if (!Platform.isMobileApp) {
            this.compilerWorker.postMessage(true);
            this.fs = require("fs")
        }

        this.textEncoder = new TextEncoder()
        await this.loadSettings()

        let fonts = await Promise.all(
            //@ts-expect-error
            (await window.queryLocalFonts() as Array)
                .filter((font: { family: string; name: string; }) => this.settings.font_families.contains(font.family.toLowerCase()))
                .map(
                    async (font: { blob: () => Promise<Blob>; }) => await (await font.blob()).arrayBuffer()
                )
        )
        this.compilerWorker.postMessage(fonts, fonts)

        // Setup cutom canvas
        TypstRenderElement.compile = (a, b, c, d, e) => this.processThenCompileTypst(a, b, c, d, e)
        if (customElements.get("typst-renderer") == undefined) {
            customElements.define("typst-renderer", TypstRenderElement)
        }

        // Setup MathJax
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

        // Settings
        this.addSettingTab(new TypstSettingTab(this.app, this));

        // Code blocks
        this.registerMarkdownCodeBlockProcessor("typst", async (source, el, ctx) => {
            el.appendChild(this.createTypstRenderElement("/" + ctx.sourcePath, `${this.settings.preamable.code}\n${source}`, true, false))
        })


        console.log("loaded Typst Renderer");
    }


    async compileToTypst(path: string, source: string, size: number, display: boolean): Promise<ImageData> {
        return await navigator.locks.request("typst renderer compiler", async (lock) => {
            if (this.settings.format == "svg") {
                this.compilerWorker.postMessage({
                    format: "svg",
                    path,
                    source
                })
            } else if (this.settings.format == "image") {
                this.compilerWorker.postMessage({
                    format: "image",
                    source,
                    path,
                    pixel_per_pt: this.settings.pixel_per_pt,
                    fill: `${this.settings.fill}${this.settings.noFill ? "00" : "ff"}`,
                    size,
                    display
                });
            }
            while (true) {
                let result: ImageData | string | WorkerRequest = await new Promise((resolve, reject) => {
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

                if (result instanceof ImageData || typeof result == "string") {
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

    createTypstRenderElement(path: string, source: string, display: boolean, math: boolean) {
        let renderer = new TypstRenderElement();
        renderer.format = this.settings.format
        renderer.source = source
        renderer.path = path
        renderer.display = display
        renderer.math = math
        return renderer
    }

    createTypstMath(source: string, r: { display: boolean }) {
        const display = r.display;
        source = `${this.settings.preamable.math}\n${display ? `$ ${source} $` : `$${source}$`}`

        return this.createTypstRenderElement("/586f8912-f3a8-4455-8a4a-3729469c2cc1.typ", source, display, true)
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
            .setName("Render Format")
            .addDropdown(dropdown => {
                dropdown.addOptions({
                    svg: "SVG",
                    image: "Image"
                })
                    .setValue(this.plugin.settings.format)
                    .onChange(async value => {
                        this.plugin.settings.format = value;
                        await this.plugin.saveSettings();
                        if (value == "svg") {
                            no_fill.setDisabled(true)
                            fill_color.setDisabled(true)
                            pixel_per_pt.setDisabled(true)
                        } else {
                            no_fill.setDisabled(false)
                            fill_color.setDisabled(this.plugin.settings.noFill)
                            pixel_per_pt.setDisabled(false)
                        }
                    })
            })



        let no_fill = new Setting(containerEl)
            .setName("No Fill (Transparent)")
            .setDisabled(this.plugin.settings.format == "svg")
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
            .setDisabled(this.plugin.settings.noFill || this.plugin.settings.format == "svg")
            .addColorPicker((picker) => {
                picker.setValue(this.plugin.settings.fill)
                    .onChange(
                        async (value) => {
                            this.plugin.settings.fill = value;
                            await this.plugin.saveSettings();
                        }
                    )
            })

        let pixel_per_pt = new Setting(containerEl)
            .setName("Pixel Per Point")
            .setDisabled(this.plugin.settings.format == "svg")
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
            .setName("Override Math Blocks")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.override_math)
                    .onChange((value) => this.plugin.overrideMathJax(value))
            });

        new Setting(containerEl)
            .setName("Shared Preamble")
            .addTextArea((c) => c.setValue(this.plugin.settings.preamable.shared).onChange(async (value) => { this.plugin.settings.preamable.shared = value; await this.plugin.saveSettings() }))
        new Setting(containerEl)
            .setName("Code Block Preamble")
            .addTextArea((c) => c.setValue(this.plugin.settings.preamable.code).onChange(async (value) => { this.plugin.settings.preamable.code = value; await this.plugin.saveSettings() }))
        new Setting(containerEl)
            .setName("Math Block Preamble")
            .addTextArea((c) => c.setValue(this.plugin.settings.preamable.math).onChange(async (value) => { this.plugin.settings.preamable.math = value; await this.plugin.saveSettings() }))

        //Font family settings
        const fontSettings = containerEl.createDiv({ cls: "setting-item font-settings" })
        fontSettings.createDiv({ text: "Fonts", cls: "setting-item-name" })
        fontSettings.createDiv({ text: "Font family names that should be loaded for Typst from your system. Requires a reload on change.", cls: "setting-item-description" })

        const addFontsDiv = fontSettings.createDiv({ cls: "add-fonts-div" })
        const fontsInput = addFontsDiv.createEl('input', { type: "text", placeholder: "Enter a font family", cls: "font-input", })
        const addFontBtn = addFontsDiv.createEl('button', { text: "Add" })

        const fontTagsDiv = fontSettings.createDiv({ cls: "font-tags-div" })

        const addFontTag = async () => {
            if (!this.plugin.settings.font_families.contains(fontsInput.value)) {
                this.plugin.settings.font_families.push(fontsInput.value.toLowerCase())
                await this.plugin.saveSettings()
            }
            fontsInput.value = ''
            this.renderFontTags(fontTagsDiv)
        }

        fontsInput.addEventListener('keydown', async (ev) => {
            if (ev.key == "Enter") {
                addFontTag()
            }
        })
        addFontBtn.addEventListener('click', async () => addFontTag())

        this.renderFontTags(fontTagsDiv)
    }


    renderFontTags(fontTagsDiv: HTMLDivElement) {
        fontTagsDiv.innerHTML = ''
        this.plugin.settings.font_families.forEach((fontFamily) => {
            const fontTag = fontTagsDiv.createEl('span', { cls: "font-tag" })
            fontTag.createEl('span', { text: fontFamily, cls: "font-tag-text", attr: { style: `font-family: ${fontFamily};` } })
            const removeBtn = fontTag.createEl('span', { text: "x", cls: "tag-btn" })
            removeBtn.addEventListener('click', async () => {
                this.plugin.settings.font_families.remove(fontFamily)
                await this.plugin.saveSettings()
                this.renderFontTags(fontTagsDiv)
            })
        })
    }

}

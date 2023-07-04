import { App, HexString, Notice, Plugin, PluginSettingTab, Setting, Workspace, loadMathJax } from 'obsidian';

// @ts-ignore
import typst_wasm_bin from './pkg/obsidian_typst_bg.wasm'
import typstInit, * as typst from './pkg/obsidian_typst'
import TypstCanvasElement from 'typst-canvas-element';

// temp.track()

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
    compiler: typst.SystemWorld;
    files: Map<string, string>;
    tex2chtml: any;
    resizeObserver: ResizeObserver;

    async onload() {
        await typstInit(typst_wasm_bin)
        await this.loadSettings()
        let notice = new Notice("Loading fonts for Typst...");
        this.compiler = new typst.SystemWorld("", (path: string) => this.get_file(path))//, this.settings.search_system);
        notice.hide();
        notice = new Notice("Finished loading fonts for Typst", 5000);

        this.registerEvent(
            this.app.metadataCache.on("resolved", () => this.updateFileCache())
        )

        TypstCanvasElement.compile = (a, b, c, d, e) => this.typstToSizedImage(a, b, c, d, e)
        customElements.define("typst-canvas", TypstCanvasElement, { extends: "canvas" })

        // await loadMathJax()
        // // @ts-expect-error
        // this.tex2chtml = MathJax.tex2chtml
        // this.overrideMathJax(this.settings.override_math)

        this.addCommand({
            id: "math-override",
            name: "Toggle Math Block Override",
            callback: () => this.overrideMathJax(!this.settings.override_math)
        })
        this.addCommand({
            id: "update-files",
            name: "Update Cached .typ Files",
            callback: () => this.updateFileCache()
        })

        this.addSettingTab(new TypstSettingTab(this.app, this));
        this.registerMarkdownCodeBlockProcessor("typst", (source, el, ctx) => {
            el.appendChild(this.typstToCanvas("/" + ctx.sourcePath, `${this.settings.preamable.code}\n${source}`, true))
        })

        console.log("loaded Typst");
    }

    typstToImage(path: string, source: string) {
        console.log(source);

        return this.compiler.compile(source, path, this.settings.pixel_per_pt, `${this.settings.fill}${this.settings.noFill ? "00" : "ff"}`)
        // return this.compiler.compile(source, path);
    }

    typstToSizedImage(path: string, source: string, size: number, display: boolean, fontSize: number) {
        const dpr = window.devicePixelRatio;
        const pxToPt = (px: number) => (px * dpr * (72 / 96)).toString() + "pt"
        const sizing = `#let (WIDTH, HEIGHT, SIZE) = (${display ? pxToPt(size) : "auto"}, ${!display ? pxToPt(size) : "auto"}, ${pxToPt(fontSize)})`
        return this.typstToImage(
            path,
            `${sizing}\n${this.settings.preamable.shared}\n${source}`
        )
    }

    typstToCanvas(path: string, source: string, display: boolean) {
        let canvas = new TypstCanvasElement();
        canvas.source = source
        canvas.path = path
        canvas.display = display
        return canvas
    }

    typstMath2Html(source: string, r: { display: boolean }) {
        const display = r.display;
        source = `${this.settings.preamable.math}\n${display ? `$ ${source} $` : `$${source}$`}`
        // return this.typstToCanvas(source, display)
    }

    onunload() {
        //@ts-expect-error
        MathJax.tex2chtml = this.tex2chtml
    }

    async overrideMathJax(value: boolean) {
        this.settings.override_math = value
        await this.saveSettings();
        if (this.settings.override_math) {
            // @ts-expect-error
            MathJax.tex2chtml = (e, r) => this.typstMath2Html(e, r)
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

    get_file(path: string) {
        if (this.files.has(path)) {
            return this.files.get(path)
        }
        console.error(`'${path}' is a folder or does not exist`, this.files.keys());
        throw `'${path}' is a folder or does not exist`
    }

    async updateFileCache() {
        this.files = new Map()
        for (const file of this.app.vault.getFiles()) {
            if (file.extension == "typ") {
                this.files.set(file.path, await this.app.vault.cachedRead(file))
            }
        }
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

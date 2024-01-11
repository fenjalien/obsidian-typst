import { App, renderMath, HexString, Platform, Plugin, PluginSettingTab, Setting, loadMathJax, normalizePath, Notice, requestUrl } from 'obsidian';

declare const PLUGIN_VERSION: string;

// @ts-ignore
import CompilerWorker from "./compiler.worker.ts"

import TypstRenderElement from './typst-render-element.js';
import { WorkerRequest } from './types';

// @ts-ignore
import untar from "js-untar"
import { decompressSync } from "fflate"

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
    },
    plugin_version: string,
    autoDownloadPackages: boolean
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
    },
    plugin_version: PLUGIN_VERSION,
    autoDownloadPackages: true
}

export default class TypstPlugin extends Plugin {
    settings: TypstPluginSettings;

    compilerWorker: Worker;

    tex2chtml: any;

    prevCanvasHeight: number = 0;
    textEncoder: TextEncoder
    fs: any;

    wasmPath: string
    pluginPath: string
    packagePath: string

    async onload() {
        console.log("loading Typst Renderer");

        this.textEncoder = new TextEncoder()
        await this.loadSettings()

        this.pluginPath = this.app.vault.configDir + "/plugins/typst/"
        this.packagePath = this.pluginPath + "packages/"
        this.wasmPath = this.pluginPath + "obsidian_typst_bg.wasm"

        this.compilerWorker = (new CompilerWorker() as Worker);
        if (!await this.app.vault.adapter.exists(this.wasmPath) || this.settings.plugin_version != PLUGIN_VERSION) {
            new Notice("Typst Renderer: Downloading required web assembly component!", 5000);
            try {
                await this.fetchWasm()
                new Notice("Typst Renderer: Web assembly component downloaded!", 5000)
            } catch (error) {
                new Notice("Typst Renderer: Failed to fetch component: " + error, 0)
                console.error("Typst Renderer: Failed to fetch component: " + error)
            }
        }
        this.compilerWorker.postMessage({
            type: "startup",
            data: {
                wasm: URL.createObjectURL(
                    new Blob(
                        [await this.app.vault.adapter.readBinary(this.wasmPath)],
                        { type: "application/wasm" }
                    )
                ),
                //@ts-ignore
                basePath: this.app.vault.adapter.basePath,
                packagePath: this.packagePath
            }
        });

        if (Platform.isDesktopApp) {
            this.compilerWorker.postMessage({ type: "canUseSharedArrayBuffer", data: true });
            this.fs = require("fs")
            let fonts = await Promise.all(
                //@ts-expect-error
                (await window.queryLocalFonts() as Array)
                    .filter((font: { family: string; name: string; }) => this.settings.font_families.contains(font.family.toLowerCase()))
                    .map(
                        async (font: { blob: () => Promise<Blob>; }) => await (await font.blob()).arrayBuffer()
                    )
            )
            this.compilerWorker.postMessage({ type: "fonts", data: fonts }, fonts)
        } else {
            // Mobile
            // Make sure it exists, won't error/affect anything if it does exist 
            await this.app.vault.adapter.mkdir(this.packagePath)
            const packages = await this.getPackageList();
            this.compilerWorker.postMessage({ type: "packages", data: packages })
        }

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

    async fetchWasm() {
        let response
        let data
        response = requestUrl(`https://api.github.com/repos/fenjalien/obsidian-typst/releases/tags/${PLUGIN_VERSION}`)
        data = await response.json
        let asset = data.assets.find((a: any) => a.name == "obsidian_typst_bg.wasm")
        if (asset == undefined) {
            throw "Could not find the correct file!"
        }

        response = requestUrl({ url: asset.url, headers: { "Accept": "application/octet-stream" } })
        data = await response.arrayBuffer
        await this.app.vault.adapter.writeBinary(
            this.wasmPath,
            data
        )

        this.settings.plugin_version = PLUGIN_VERSION
        await this.saveSettings()
    }

    async getPackageList(): Promise<string[]> {
        let getFolders = async (f: string) => (await this.app.vault.adapter.list(f)).folders
        let packages = []
        // namespace
        for (const namespace of await getFolders(this.packagePath)) {
            // name
            for (const name of await getFolders(namespace)) {
                // version
                for (const version of await getFolders(name)) {
                    packages.push(version.split("/").slice(-3).join("/"))
                }
            }
        }
        return packages
    }

    async deletePackages(packages: string[]) {
        for (const folder of packages) {
            await this.app.vault.adapter.rmdir(this.packagePath + folder, true)
        }
    }

    async compileToTypst(path: string, source: string, size: number, display: boolean): Promise<ImageData> {
        return await navigator.locks.request("typst renderer compiler", async (lock) => {
            let message
            if (this.settings.format == "svg") {
                message = {
                    type: "compile",
                    data: {
                        format: "svg",
                        path,
                        source
                    }
                }
            } else if (this.settings.format == "image") {
                message = {
                    type: "compile",
                    data: {
                        format: "image",
                        source,
                        path,
                        pixel_per_pt: this.settings.pixel_per_pt,
                        fill: `${this.settings.fill}${this.settings.noFill ? "00" : "ff"}`,
                        size,
                        display
                    }
                }
            }
            this.compilerWorker.postMessage(message)
            while (true) {
                let result: ImageData | string | WorkerRequest;
                try {
                    result = await new Promise((resolve, reject) => {
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
                } catch (e) {
                    if (Platform.isMobileApp && e.startsWith("Uncaught Error: package not found (searched for")) {
                        const spec = e.match(/"@preview\/.*?"/)[0].slice(2, -1).replace(":", "/")
                        const [namespace, name, version] = spec.split("/")
                        try {
                            await this.fetchPackage(this.packagePath + spec + "/", name, version)
                        } catch (error) {
                            if (error == 2) {
                                throw e
                            }
                            throw error
                        }
                        const packages = await this.getPackageList()
                        this.compilerWorker.postMessage({ type: "packages", data: packages })
                        this.compilerWorker.postMessage(message)
                        continue
                    }
                    throw e
                }
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
            const text = await (path.startsWith("@") ? this.preparePackage(path.slice(1)) : this.getFileString(path))
            if (text) {
                let buffer = Int32Array.from(this.textEncoder.encode(
                    text
                ));
                if (wbuffer.byteLength < (buffer.byteLength + 4)) {
                    //@ts-expect-error
                    wbuffer.buffer.grow(buffer.byteLength + 4)
                }
                wbuffer.set(buffer, 1)
                wbuffer[0] = 0
            }
        } catch (error) {
            if (typeof error === "number") {
                wbuffer[0] = error
            } else {
                wbuffer[0] = 1
                console.error(error)
            }
        } finally {
            Atomics.notify(wbuffer, 0)
        }
    }

    async getFileString(path: string): Promise<string> {
        try {
            if (require("path").isAbsolute(path)) {
                return await this.fs.promises.readFile(path, { encoding: "utf8" })
            } else {
                return await this.app.vault.adapter.read(normalizePath(path))
            }
        } catch (e) {
            console.error(e);
            if (e.code == "ENOENT") {
                // File not found
                throw 2
            }
            if (e.code == "EACCES") {
                // access denied
                throw 3
            }
            if (e.code == "EISDIR") {
                // File is directory
                throw 4
            }
            // Other File error
            throw 5
        }
    }

    async preparePackage(spec: string): Promise<string | undefined> {
        if (Platform.isDesktopApp) {
            let subdir = "/typst/packages/" + spec

            let dir = require('path').normalize(this.getDataDir() + subdir)
            if (this.fs.existsSync(dir)) {
                return dir
            }

            dir = require('path').normalize(this.getCacheDir() + subdir)

            if (this.fs.existsSync(dir)) {
                return dir
            }
        }

        const folder = this.packagePath + spec + "/"
        if (await this.app.vault.adapter.exists(folder)) {
            return folder
        }
        if (spec.startsWith("preview") && this.settings.autoDownloadPackages) {
            const [namespace, name, version] = spec.split("/")
            try {
                await this.fetchPackage(folder, name, version)
                return folder
            } catch (e) {
                if (e == 2) {
                    throw e
                }
                console.error(e);
                // Other package error
                throw 3
            }
        }
        // Package not found error
        throw 2
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

    async fetchPackage(folder: string, name: string, version: string) {
        const url = `https://packages.typst.org/preview/${name}-${version}.tar.gz`;
        const response = await fetch(url)
        if (response.status == 404) {
            // Package not found error
            throw 2
        }
        await this.app.vault.adapter.mkdir(folder)
        await untar(decompressSync(new Uint8Array(await response.arrayBuffer())).buffer).progress(async (file: any) => {
            // is folder
            if (file.type == "5" && file.name != ".") {
                await this.app.vault.adapter.mkdir(folder + file.name)
            }
            // is file
            if (file.type === "0") {
                await this.app.vault.adapter.writeBinary(folder + file.name, file.buffer)
            }
        });
    }


    async processThenCompileTypst(path: string, source: string, size: number, display: boolean, fontSize: number) {
        const dpr = window.devicePixelRatio;
        // * (72 / 96)
        const pxToPt = (px: number) => px.toString() + "pt"
        const sizing = `#let (WIDTH, HEIGHT, SIZE, THEME) = (${display ? pxToPt(size) : "auto"}, ${!display ? pxToPt(size) : "auto"}, ${pxToPt(fontSize)}, "${document.body.getCssPropertyValue("color-scheme")}")`
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


    async display() {
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
        if (!Platform.isMobileApp) {

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

            new Setting(containerEl)
                .setName("Download Missing Packages")
                .setDesc("When on, if the compiler cannot find a package in the system it will attempt to download it. Packages downloaded this way will be stored within the vault in the plugin's folder. Always on for mobile.")
                .addToggle(toggle => toggle.setValue(this.plugin.settings.autoDownloadPackages).onChange(async (value) => { this.plugin.settings.autoDownloadPackages = value; await this.plugin.saveSettings() }))
        }

        const packageSettingsDiv = containerEl.createDiv({ cls: "setting-item package-settings" })
        packageSettingsDiv.createDiv({ text: "Downloaded Packages", cls: "setting-item-name" })
        packageSettingsDiv.createDiv({ text: "These are the currently downloaded packages. Select the packages you want to delete.", cls: "setting-item-description" });

        (await this.plugin.getPackageList()).forEach(pkg => {
            const [namespace, name, version] = pkg.split("/")
            //create package item
            const packageItem = packageSettingsDiv.createDiv({ cls: "package-item" })
            packageItem.createEl('input', { type: "checkbox", cls: "package-checkbox", value: pkg, attr: { name: "package-checkbox" } })
            packageItem.createEl('p', { text: name })
            packageItem.createEl('p', { text: version, cls: "package-version" })
        })

        const deletePackagesBtn = packageSettingsDiv.createEl('button', { text: 'Delete Selected Packages', cls: "delete-pkg-btn" })

        deletePackagesBtn.addEventListener('click', () => {
            const selectedPackageElements = packageSettingsDiv.querySelectorAll('input[name="package-checkbox"]:checked')

            let packagesToDelete: string[] = []

            selectedPackageElements.forEach(pkgEl => {
                packagesToDelete.push(pkgEl.getAttribute('value')!)
                packageSettingsDiv.removeChild(pkgEl.parentNode!)
            })

            this.plugin.deletePackages(packagesToDelete)
        })

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

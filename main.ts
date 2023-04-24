import { App, HexString, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// @ts-ignore
import typst_wasm_bin from './pkg/obsidian_typst_bg.wasm'
import typstInit, * as typst from './pkg/obsidian_typst'

// temp.track()

interface TypstPluginSettings {
    noFill: boolean,
    fill: HexString,
    pixel_per_pt: number,
    search_system: boolean,
}

const DEFAULT_SETTINGS: TypstPluginSettings = {
    noFill: false,
    fill: "#ffffff",
    pixel_per_pt: 1,
    search_system: false,
}

export default class TypstPlugin extends Plugin {
    settings: TypstPluginSettings;
    compiler: typst.SystemWorld;
    files: Map<string, string>;

    async onload() {
        await typstInit(typst_wasm_bin)
        await this.loadSettings()
        this.files = new Map()
        let notice = new Notice("Loading fonts for Typst...");
        this.compiler = await new typst.SystemWorld("", (path: string) => this.get_file(path), this.settings.search_system);
        notice.hide();
        notice = new Notice("Finished loading fonts for Typst", 5000);

        this.addSettingTab(new TypstSettingTab(this.app, this));
        this.registerMarkdownCodeBlockProcessor("typst", async (source, el, ctx) => {
            this.files.clear()
            for (const file of this.app.vault.getFiles()) {
                if (file.extension == "typ") {
                    this.files.set(file.path, await this.app.vault.cachedRead(file))
                }
            }

            try {
                const image = this.compiler.compile(source, this.settings.pixel_per_pt, `${this.settings.fill}${this.settings.noFill ? "00" : "ff"}`);
                // el.createEl("img", {
                //     attr: {
                //         src: "data:image/png;base64," + Base64.fromUint8Array(image.data.)
                //     }
                // })
                const width = el.clientWidth
                const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: image.height * (width / image.width), resizeQuality: "high" })
                let canvas = el.createEl("canvas", {
                    cls: "obsidian-typst",
                    attr: {
                        width: bitmap.width,
                        height: bitmap.height,
                    }
                });
                let ctx = canvas.getContext("2d");
                ctx?.drawImage(bitmap, 0, 0);
            } catch (error) {
                console.error(error);
            }
        })

        /// Renders typst using the cli
        // this.registerMarkdownCodeBlockProcessor("typst", (source, el, ctx) => {
        //     temp.mkdir("obsidian-typst", (err, folder) => {
        //         if (err) {
        //             el.innerHTML = err;
        //             console.log(err);
        //         } else {
        //             fs.writeFileSync(path.join(folder, "main.typ"), source)
        //             exec(
        //                 `typst main.typ --image ${this.settings.noFill ? "--no-fill" : "--fill=" + this.settings.fill} --pixel-per-pt=${this.settings.pixel_per_pt}`,
        //                 { cwd: folder }, (err, stdout, stderr) => {
        //                     if (err || stdout || stderr) {
        //                         // console.log(err, stdout, stderr);
        //                         el.innerHTML = [String(err), stdout, stderr.replace(/\u001b[^m]*?m/g, "")].join("\n")
        //                     } else {
        //                         el.createEl("img", {
        //                             cls: "obsidian-typst",
        //                             attr: {
        //                                 src: `data:image/png;base64,${fs.readFileSync(path.join(folder, "main-1.png")).toString("base64")}`
        //                             }
        //                         })
        //                     }
        //                 })
        //         }
        //         // temp.cleanup()
        //     })
        // });
        console.log("loaded Typst");
    }

    onunload() {

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
        console.error(`'${path}' is a folder or does not exist`);
        throw `'${path}' is a folder or does not exist`
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
    }
}

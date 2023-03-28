import { App, HexString, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';


// @ts-ignore
import typst_wasm_bin from './pkg/obsidian_typst_bg.wasm'
import typstInit, * as typst from './pkg/obsidian_typst'

// temp.track()

interface TypstPluginSettings {
    noFill: boolean,
    fill: HexString,
    pixel_per_pt: number,
}

const DEFAULT_SETTINGS: TypstPluginSettings = {
    noFill: false,
    fill: "#ffffff",
    pixel_per_pt: 1
}

export default class TypstPlugin extends Plugin {
    settings: TypstPluginSettings;
    compiler: typst.SystemWorld;

    async onload() {
        await typstInit(typst_wasm_bin)
        this.loadSettings()
        let notice = new Notice("Loading fonts for Typst...")
        this.compiler = await new typst.SystemWorld(this.app.vault.getRoot().path);
        notice.hide();
        notice = new Notice("Finished loading fonts for Typst", 5000);

        this.addSettingTab(new TypstSettingTab(this.app, this));
        this.registerMarkdownCodeBlockProcessor("typst", (source, el, ctx) => {
            try {
                const image = this.compiler.compile(source, this.settings.pixel_per_pt, `${this.settings.fill}${this.settings.noFill ? "00" : "ff"}`);
                let canvas = el.createEl("canvas", {
                    cls: "obsidian-typst",
                    attr: {
                        width: image.width,
                        height: image.height,
                    }

                });
                let ctx = canvas.getContext("2d");
                ctx?.putImageData(image, 0, 0);
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
    }
}

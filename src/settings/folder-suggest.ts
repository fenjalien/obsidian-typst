import { AbstractInputSuggest, App, TFolder } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, private inputEl: HTMLInputElement) {
        super(app, inputEl);
    }
    protected getSuggestions(query: string): string[] {
        // @ts-ignore "getAllFolders" exists but is undocumented.
        return (this.app.vault.getAllFolders() as TFolder[])
            .filter(folder => folder.path.contains(query))
            .map(folder => folder.path);
    }
    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }
    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.inputEl.value = value;
        this.close();
    }
}

import { FuzzySuggestModal, TFile, type App } from "obsidian";
import { IMAGE_EXTENSIONS, sortImageFiles } from "./textarea-suggest";

export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;
	private recipePath?: string;

	constructor(app: App, onChoose: (file: TFile) => void, recipePath?: string) {
		super(app);
		this.onChoose = onChoose;
		this.recipePath = recipePath;
		this.setPlaceholder("Search for an image file...");
	}

	getItems(): TFile[] {
		const images = this.app.vault
			.getFiles()
			.filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
		return sortImageFiles(images, this.recipePath);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

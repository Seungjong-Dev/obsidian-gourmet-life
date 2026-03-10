import { App, Modal } from "obsidian";

export class ConfirmDeleteModal extends Modal {
	private name: string;
	private resolve: (value: boolean) => void;
	private resolved = false;

	constructor(app: App, name: string, resolve: (value: boolean) => void) {
		super(app);
		this.name = name;
		this.resolve = resolve;
	}

	onOpen(): void {
		this.contentEl.createEl("p", {
			text: `Delete "${this.name}"? This cannot be undone.`,
		});
		const btnRow = this.contentEl.createDiv({ cls: "modal-button-container" });
		btnRow.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => { this.resolved = true; this.resolve(false); this.close(); });
		btnRow.createEl("button", { cls: "mod-warning", text: "Delete" })
			.addEventListener("click", () => { this.resolved = true; this.resolve(true); this.close(); });
	}

	onClose(): void {
		if (!this.resolved) this.resolve(false);
	}
}

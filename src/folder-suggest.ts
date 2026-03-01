import {
	AbstractInputSuggest,
	App,
	TFolder,
} from "obsidian";

/**
 * Suggests existing vault folders as the user types.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(query: string): TFolder[] {
		const lowerQuery = query.toLowerCase();
		const folders: TFolder[] = [];

		const allFolders = this.getAllFolders();
		for (const folder of allFolders) {
			if (folder.path.toLowerCase().includes(lowerQuery)) {
				folders.push(folder);
			}
		}

		// Sort: exact prefix matches first, then alphabetical
		folders.sort((a, b) => {
			const aStarts = a.path.toLowerCase().startsWith(lowerQuery);
			const bStarts = b.path.toLowerCase().startsWith(lowerQuery);
			if (aStarts && !bStarts) return -1;
			if (!aStarts && bStarts) return 1;
			return a.path.localeCompare(b.path);
		});

		return folders.slice(0, 20);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.inputEl.value = folder.path;
		this.inputEl.dispatchEvent(new Event("input"));
		this.close();
	}

	private getAllFolders(): TFolder[] {
		const folders: TFolder[] = [];
		const recurse = (folder: TFolder) => {
			// Skip root
			if (folder.path !== "/") {
				folders.push(folder);
			}
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					recurse(child);
				}
			}
		};
		recurse(this.app.vault.getRoot());
		return folders;
	}
}

import { type App, FuzzySuggestModal } from "obsidian";
import type { NoteIndex } from "./note-index";
import type { GourmetNote } from "./types";

export class RecipeSearchModal extends FuzzySuggestModal<GourmetNote> {
	private noteIndex: NoteIndex;
	private onChoose: (note: GourmetNote) => void;

	constructor(
		app: App,
		noteIndex: NoteIndex,
		onChoose: (note: GourmetNote) => void
	) {
		super(app);
		this.noteIndex = noteIndex;
		this.onChoose = onChoose;
		this.setPlaceholder("Search recipes...");
	}

	getItems(): GourmetNote[] {
		return this.noteIndex.getRecipes();
	}

	getItemText(note: GourmetNote): string {
		return note.name;
	}

	onChooseItem(note: GourmetNote): void {
		this.onChoose(note);
	}
}

import type { App, TFile } from "obsidian";
import type {
	GourmetLifeSettings,
	GourmetNote,
	GourmetNoteType,
	IngredientFrontmatter,
} from "./types";
import {
	getExpectedType,
	readGourmetFrontmatter,
} from "./frontmatter-utils";

export class NoteIndex {
	private notes: Map<string, GourmetNote> = new Map();
	/** ingredient display name (lowercase) → file path */
	private ingredientNames: Map<string, string> = new Map();
	private app: App;
	private settings: GourmetLifeSettings;

	constructor(app: App, settings: GourmetLifeSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: GourmetLifeSettings): void {
		this.settings = settings;
	}

	/** Full scan of all configured folders */
	buildIndex(): void {
		this.notes.clear();
		this.ingredientNames.clear();

		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			this.indexFile(file);
		}

		console.log(
			`[Gourmet Life] Index built: ${this.notes.size} notes ` +
			`(${this.getRecipes().length} recipes, ` +
			`${this.getIngredients().length} ingredients, ` +
			`${this.getRestaurants().length} restaurants)`
		);
	}

	/** Index or re-index a single file */
	updateFile(file: TFile): void {
		// Remove old entry first (handles type changes)
		this.removeFile(file.path);
		this.indexFile(file);
	}

	/** Remove a file from the index */
	removeFile(path: string): void {
		const existing = this.notes.get(path);
		if (existing && existing.type === "ingredient") {
			this.removeIngredientNames(path);
		}
		this.notes.delete(path);
	}

	/** Handle file rename */
	renameFile(oldPath: string, newPath: string): void {
		const existing = this.notes.get(oldPath);
		if (!existing) return;

		this.removeFile(oldPath);

		const file = this.app.vault.getAbstractFileByPath(newPath);
		if (file && "extension" in file) {
			this.indexFile(file as TFile);
		}
	}

	// ── Queries ──

	getByPath(path: string): GourmetNote | undefined {
		return this.notes.get(path);
	}

	getRecipes(): GourmetNote[] {
		return this.getByType("recipe");
	}

	getIngredients(): GourmetNote[] {
		return this.getByType("ingredient");
	}

	getRestaurants(): GourmetNote[] {
		return this.getByType("restaurant");
	}

	searchByName(query: string): GourmetNote[] {
		const q = query.toLowerCase();
		const results: GourmetNote[] = [];
		for (const note of this.notes.values()) {
			if (note.name.toLowerCase().includes(q)) {
				results.push(note);
			}
		}
		return results;
	}

	/** Returns Map of ingredient display name (lowercase) → file path */
	getIngredientNames(): Map<string, string> {
		return this.ingredientNames;
	}

	// ── Private ──

	private getByType(type: GourmetNoteType): GourmetNote[] {
		const results: GourmetNote[] = [];
		for (const note of this.notes.values()) {
			if (note.type === type) results.push(note);
		}
		return results;
	}

	private indexFile(file: TFile): void {
		const expectedType = getExpectedType(file.path, this.settings);
		if (!expectedType) return;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = readGourmetFrontmatter(cache);
		if (!fm || fm.type !== expectedType) return;

		const name = file.basename;
		const note: GourmetNote = {
			path: file.path,
			name,
			type: fm.type,
			frontmatter: fm,
		};

		this.notes.set(file.path, note);

		if (fm.type === "ingredient") {
			this.addIngredientNames(file.path, name, fm as IngredientFrontmatter);
		}
	}

	private addIngredientNames(
		path: string,
		name: string,
		fm: IngredientFrontmatter
	): void {
		this.ingredientNames.set(name.toLowerCase(), path);
		if (fm.aliases) {
			for (const alias of fm.aliases) {
				if (alias) {
					this.ingredientNames.set(alias.toLowerCase(), path);
				}
			}
		}
	}

	private removeIngredientNames(path: string): void {
		for (const [name, p] of this.ingredientNames) {
			if (p === path) {
				this.ingredientNames.delete(name);
			}
		}
	}
}

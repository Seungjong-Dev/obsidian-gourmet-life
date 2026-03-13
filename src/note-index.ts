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
import { parseCooklangBody } from "./cooklang-parser";

export class NoteIndex {
	private notes: Map<string, GourmetNote> = new Map();
	/** ingredient display name (lowercase) → file path */
	private ingredientNames: Map<string, string> = new Map();
	/** recipe path → set of ingredient names (lowercase) */
	recipeIngredients: Map<string, Set<string>> = new Map();
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
	async buildIndex(): Promise<void> {
		this.notes.clear();
		this.ingredientNames.clear();
		this.recipeIngredients.clear();

		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			this.indexFile(file);
		}

		await this.buildRecipeIngredientIndex();

		console.log(
			`[Gourmet Life] Index built: ${this.notes.size} notes ` +
			`(${this.getRecipes().length} recipes, ` +
			`${this.getIngredients().length} ingredients, ` +
			`${this.getRestaurants().length} restaurants)`
		);
	}

	/** Async: index recipe ingredients from Cooklang bodies */
	private async buildRecipeIngredientIndex(): Promise<void> {
		for (const note of this.notes.values()) {
			if (note.type !== "recipe") continue;
			await this.indexRecipeIngredients(note.path);
		}
	}

	private async indexRecipeIngredients(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !("extension" in file)) return;
		try {
			const content = await this.app.vault.cachedRead(file as TFile);
			const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
			const body = fmMatch ? content.substring(fmMatch[0].length) : content;
			const parsed = parseCooklangBody(body);
			const names = new Set(parsed.ingredients.map((i) => i.name.toLowerCase()));
			if (names.size > 0) {
				this.recipeIngredients.set(path, names);
			}
		} catch {
			// ignore read errors
		}
	}

	/** Index or re-index a single file */
	updateFile(file: TFile): void {
		// Remove old entry first (handles type changes)
		this.removeFile(file.path);
		this.indexFile(file);
		// Re-index recipe ingredients if applicable
		const note = this.notes.get(file.path);
		if (note?.type === "recipe") {
			this.indexRecipeIngredients(file.path);
		}
	}

	/** Remove a file from the index */
	removeFile(path: string): void {
		const existing = this.notes.get(path);
		if (existing && existing.type === "ingredient") {
			this.removeIngredientNames(path);
		}
		this.recipeIngredients.delete(path);
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

	/** Collect unique category values from restaurants, sorted */
	getRestaurantCategoryValues(): string[] {
		const set = new Set<string>();
		for (const note of this.getRestaurants()) {
			const cat = (note.frontmatter as any).category;
			if (cat) set.add(cat);
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}

	/** Collect unique cuisine values from all recipes and restaurants, sorted */
	getCuisineValues(): string[] {
		const set = new Set<string>();
		for (const note of this.notes.values()) {
			const cuisine = (note.frontmatter as any).cuisine;
			if (cuisine) {
				const arr = Array.isArray(cuisine) ? cuisine : [cuisine];
				for (const c of arr) if (c) set.add(c);
			}
		}
		return [...set].sort((a, b) => a.localeCompare(b));
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

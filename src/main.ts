import { Notice, Plugin, TFile } from "obsidian";
import {
	DEFAULT_SETTINGS,
	VIEW_TYPE_RECIPE,
	type GourmetLifeSettings,
	type RecipeViewMode,
} from "./types";
import { GourmetLifeSettingTab } from "./settings";
import { NoteIndex } from "./note-index";
import { generateBaseFiles } from "./bases-generator";
import { NoteCreateModal } from "./note-create-modal";
import {
	IngredientSuggest,
	batchLinkIngredients,
} from "./ingredient-suggest";
import { RecipeView } from "./recipe-view";
import { isGourmetNote } from "./frontmatter-utils";

export default class GourmetLifePlugin extends Plugin {
	settings: GourmetLifeSettings = DEFAULT_SETTINGS;
	noteIndex: NoteIndex = null!;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.noteIndex = new NoteIndex(this.app, this.settings);

		this.addSettingTab(new GourmetLifeSettingTab(this.app, this));

		// ── Commands ──

		this.addCommand({
			id: "new-recipe",
			name: "New recipe",
			callback: () =>
				new NoteCreateModal(
					this.app,
					"recipe",
					this.settings,
					(file) => this.openRecipeView(file)
				).open(),
		});

		this.addCommand({
			id: "new-ingredient",
			name: "New ingredient",
			callback: () =>
				new NoteCreateModal(
					this.app,
					"ingredient",
					this.settings
				).open(),
		});

		this.addCommand({
			id: "new-restaurant",
			name: "New restaurant",
			callback: () =>
				new NoteCreateModal(
					this.app,
					"restaurant",
					this.settings
				).open(),
		});

		this.addCommand({
			id: "auto-link-ingredients",
			name: "Auto-link ingredients",
			editorCallback: async (editor) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return;

				if (
					!file.path.startsWith(
						this.settings.recipesFolder + "/"
					)
				) {
					new Notice("This command only works in recipe notes");
					return;
				}

				const content = editor.getValue();
				const ingredientNames =
					this.noteIndex.getIngredientNames();
				const { result, count } = batchLinkIngredients(
					content,
					ingredientNames
				);

				if (count > 0) {
					editor.setValue(result);
					new Notice(`Linked ${count} ingredient(s)`);
				} else {
					new Notice("No ingredients to link");
				}
			},
		});

		this.addCommand({
			id: "open-recipe-view",
			name: "Open recipe view",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !file.path.startsWith(this.settings.recipesFolder + "/")) return false;
				if (!checking) this.openRecipeView(file);
				return true;
			},
		});

		// ── Ribbon ──

		this.addRibbonIcon("chef-hat", "Gourmet Life: New recipe", () => {
			new NoteCreateModal(
				this.app,
				"recipe",
				this.settings,
				(file) => this.openRecipeView(file)
			).open();
		});

		// ── EditorSuggest ──

		this.registerEditorSuggest(new IngredientSuggest(this));

		// ── Recipe View ──

		this.registerView(VIEW_TYPE_RECIPE, (leaf) => {
			return new RecipeView(leaf, this);
		});

		// Intercept recipe file opens
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file) return;
				if (
					!file.path.startsWith(
						this.settings.recipesFolder + "/"
					)
				) {
					return;
				}
				const cache =
					this.app.metadataCache.getFileCache(file);
				if (
					!isGourmetNote(
						file.path,
						cache,
						this.settings
					)
				) {
					return;
				}
				// Open in recipe view
				this.openRecipeView(file);
			})
		);

		// ── Layout Ready ──

		this.app.workspace.onLayoutReady(async () => {
			this.noteIndex.buildIndex();
			await generateBaseFiles(this.app.vault, this.settings);
		});

		// ── Vault Events ──

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				this.noteIndex.updateFile(file);
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.noteIndex.removeFile(file.path);
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.noteIndex.renameFile(oldPath, file.path);
			})
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async openRecipeView(file: TFile, mode: RecipeViewMode = "viewer"): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RECIPE);
		let leaf = leaves.find((l) => {
			return (l.view as RecipeView).getState().file === file.path;
		});

		if (!leaf) {
			leaf = this.app.workspace.getLeaf(false);
			await leaf.setViewState({
				type: VIEW_TYPE_RECIPE,
				active: true,
				state: { file: file.path, mode },
			});
		} else {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
		}
	}

	onFolderSettingsChanged(): void {
		this.noteIndex.updateSettings(this.settings);
		this.noteIndex.buildIndex();
		generateBaseFiles(this.app.vault, this.settings);
	}
}

import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	VIEW_TYPE_RECIPE,
	VIEW_TYPE_RESTAURANT,
	VIEW_TYPE_EXPLORER,
	type GourmetLifeSettings,
	type RecipeViewMode,
	type RestaurantViewMode,
	type ExplorerTab,
} from "./types";
import { GourmetLifeSettingTab } from "./settings";
import { NoteIndex } from "./note-index";
import { NoteCreateModal } from "./note-create-modal";
import {
	IngredientSuggest,
	batchLinkIngredients,
} from "./ingredient-suggest";
import { RecipeView } from "./recipe-view";
import { RestaurantView } from "./restaurant-view";
import { ExplorerView } from "./explorer-view";
import { RecipeSearchModal } from "./recipe-search-modal";
import { exportShareCard } from "./recipe-share-card";
import { isGourmetNote } from "./frontmatter-utils";

export default class GourmetLifePlugin extends Plugin {
	settings: GourmetLifeSettings = DEFAULT_SETTINGS;
	noteIndex: NoteIndex = null!;
	private _intercepting = false;

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
					this.settings,
					(file) => this.openRestaurantView(file, "editor")
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

		this.addCommand({
			id: "open-restaurant-view",
			name: "Open restaurant view",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !file.path.startsWith(this.settings.restaurantsFolder + "/")) return false;
				if (!checking) this.openRestaurantView(file);
				return true;
			},
		});

		this.addCommand({
			id: "search-recipes",
			name: "Search recipes",
			callback: () => {
				new RecipeSearchModal(this.app, this.noteIndex, (note) => {
					const file = this.app.vault.getFileByPath(note.path);
					if (file) this.openRecipeView(file);
				}).open();
			},
		});

		this.addCommand({
			id: "share-recipe-image",
			name: "Share recipe as image",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(RecipeView);
				if (!view) return false;
				const state = view.getState();
				if (!state.file) return false;
				if (checking) return true;
				const file = this.app.vault.getAbstractFileByPath(state.file);
				if (!file || !(file instanceof TFile)) return false;
				const cache = this.app.metadataCache.getFileCache(file as TFile);
				const fm = cache?.frontmatter;
				if (!fm || fm.type !== "recipe") return false;
				this.app.vault.read(file as TFile).then((content) => {
					const match = content.match(/^---\n[\s\S]*?\n---\n?/);
					const body = match ? content.substring(match[0].length) : content;
					exportShareCard(this.app, state.file, fm as any, body, (file as TFile).basename);
				});
				return true;
			},
		});

		this.addCommand({
			id: "open-explorer",
			name: "Open Gourmet Explorer",
			callback: () => this.openExplorerView(),
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

		this.addRibbonIcon("compass", "Gourmet Life: Explorer", () => {
			this.openExplorerView();
		});

		// ── EditorSuggest ──

		this.registerEditorSuggest(new IngredientSuggest(this));

		// ── Recipe View ──

		this.registerView(VIEW_TYPE_RECIPE, (leaf) => {
			return new RecipeView(leaf, this);
		});

		// ── Restaurant View ──

		this.registerView(VIEW_TYPE_RESTAURANT, (leaf) => {
			return new RestaurantView(leaf, this);
		});

		// ── Explorer View ──

		this.registerView(VIEW_TYPE_EXPLORER, (leaf) => {
			return new ExplorerView(leaf, this);
		});

		// Intercept recipe and restaurant file opens
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!file || this._intercepting) return;
				const originLeaf = this.app.workspace.activeLeaf;
				if (!originLeaf) return;

				const cache = this.app.metadataCache.getFileCache(file);
				const isGourmet = isGourmetNote(file.path, cache, this.settings);

				if (isGourmet) {
					if (file.path.startsWith(this.settings.recipesFolder + "/")) {
						this.openRecipeView(file, "viewer", originLeaf);
					} else if (file.path.startsWith(this.settings.restaurantsFolder + "/")) {
						this.openRestaurantView(file, "viewer", originLeaf);
					}
				} else {
					// Cache might not be ready — fallback to folder-based check
					if (file.path.startsWith(this.settings.restaurantsFolder + "/") && file.path.endsWith(".md")) {
						this.openRestaurantView(file, "viewer", originLeaf);
					} else if (file.path.startsWith(this.settings.recipesFolder + "/") && file.path.endsWith(".md")) {
						this.openRecipeView(file, "viewer", originLeaf);
					}
				}
			})
		);

		// ── Layout Ready ──

		this.app.workspace.onLayoutReady(async () => {
			this.noteIndex.buildIndex();
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

	async openRecipeView(file: TFile, mode: RecipeViewMode = "viewer", originLeaf?: WorkspaceLeaf): Promise<void> {
		this._intercepting = true;
		try {
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RECIPE);

			const exact = leaves.find((l) => {
				return (l.view as RecipeView).getState().file === file.path;
			});
			if (exact) {
				this.app.workspace.setActiveLeaf(exact, { focus: true });
				if (originLeaf && originLeaf !== exact) originLeaf.detach();
				return;
			}

			if (leaves.length > 0) {
				const leaf = leaves[0];
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
				await (leaf.view as RecipeView).setFile(file.path);
				if (originLeaf && originLeaf !== leaf) originLeaf.detach();
				return;
			}

			const leaf = originLeaf ?? this.app.workspace.getLeaf(false);
			await leaf.setViewState({
				type: VIEW_TYPE_RECIPE,
				active: true,
				state: { file: file.path, mode },
			});
		} finally {
			this._intercepting = false;
		}
	}

	async openRestaurantView(file: TFile, mode: RestaurantViewMode = "viewer", originLeaf?: WorkspaceLeaf): Promise<void> {
		this._intercepting = true;
		try {
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RESTAURANT);

			// Exact match — already showing this file
			const exact = leaves.find((l) => {
				return (l.view as RestaurantView).getState().file === file.path;
			});
			if (exact) {
				this.app.workspace.setActiveLeaf(exact, { focus: true });
				if (mode !== "viewer") await (exact.view as RestaurantView).setFile(file.path, mode);
				if (originLeaf && originLeaf !== exact) originLeaf.detach();
				return;
			}

			// Reuse any existing RestaurantView leaf
			if (leaves.length > 0) {
				const leaf = leaves[0];
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
				await (leaf.view as RestaurantView).setFile(file.path, mode);
				if (originLeaf && originLeaf !== leaf) originLeaf.detach();
				return;
			}

			// No RestaurantView exists — replace origin leaf directly
			const leaf = originLeaf ?? this.app.workspace.getLeaf(false);
			await leaf.setViewState({
				type: VIEW_TYPE_RESTAURANT,
				active: true,
				state: { file: file.path, mode },
			});
		} finally {
			this._intercepting = false;
		}
	}

	async openExplorerView(tab?: ExplorerTab): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EXPLORER);
		if (leaves.length > 0) {
			this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
			if (tab) {
				(leaves[0].view as ExplorerView).setTab(tab);
			}
			return;
		}

		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: VIEW_TYPE_EXPLORER,
			active: true,
			state: tab ? { tab } : {},
		});
	}

	onFolderSettingsChanged(): void {
		this.noteIndex.updateSettings(this.settings);
		this.noteIndex.buildIndex();
	}
}

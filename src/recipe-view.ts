import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { VIEW_TYPE_RECIPE, type RecipeFrontmatter, type RecipeViewMode } from "./types";
import { SINGLE_COLUMN_BREAKPOINT, AUTO_SAVE_DELAY_MS, SAVE_FLAG_RESET_MS } from "./constants";
import { titleFromPath, resolveResourcePath, splitFrontmatterBody } from "./view-utils";
import {
	renderSidePanel,
	refreshSideData,
	collectSideState,
	highlightSideIngredients,
	clearSideHighlights,
} from "./recipe-side-panel";
import {
	renderMainPanel,
	renderTitleRow,
	collectMainState,
	highlightMainSteps,
} from "./recipe-main-panel";
import { buildFrontmatterString } from "./frontmatter-utils";
import { exportShareCard } from "./recipe-share-card";
import type GourmetLifePlugin from "./main";

interface RecipeViewState {
	file: string;
	mode: RecipeViewMode;
}

export class RecipeView extends ItemView {
	private plugin: GourmetLifePlugin;
	private filePath: string = "";
	private mode: RecipeViewMode = "viewer";
	private titleRow: HTMLElement = null!;
	private sideContainer: HTMLElement = null!;
	private mainContainer: HTMLElement = null!;
	private rootContainer: HTMLElement = null!;
	private resizeObserver: ResizeObserver | null = null;
	private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	private isSaving = false;
	private lastSavedContent = "";
	private renderVersion = 0;

	constructor(leaf: WorkspaceLeaf, plugin: GourmetLifePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RECIPE;
	}

	getDisplayText(): string {
		return this.filePath ? titleFromPath(this.filePath) : "Recipe";
	}

	getIcon(): string {
		return "chef-hat";
	}

	async setState(
		state: RecipeViewState,
		result: { history: boolean }
	): Promise<void> {
		this.filePath = state.file || "";
		this.mode = state.mode || "viewer";
		await this.render();
		await super.setState(state, result);
	}

	getState(): RecipeViewState {
		return { file: this.filePath, mode: this.mode };
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.style.position = "relative";

		this.rootContainer = container.createDiv({ cls: "gl-recipe" });
		this.titleRow = this.rootContainer.createDiv({
			cls: "gl-recipe__title-row",
		});
		this.sideContainer = this.rootContainer.createDiv({
			cls: "gl-recipe__side",
		});
		this.mainContainer = this.rootContainer.createDiv({
			cls: "gl-recipe__main",
		});

		// Responsive layout
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const width = entry.contentRect.width;
				this.rootContainer.toggleClass("gl-recipe--single", width < SINGLE_COLUMN_BREAKPOINT);
			}
		});
		this.resizeObserver.observe(container);

		// Ctrl+E / Cmd+E to toggle mode
		this.registerDomEvent(this.containerEl, "keydown", (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "e") {
				e.preventDefault();
				this.toggleMode();
			}
		});

		// Re-render on external metadata change (skip if we caused the save)
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.path === this.filePath && !this.isSaving) {
					this.render();
				}
			})
		);

		if (this.filePath) {
			await this.render();
		}
	}

	async onClose(): Promise<void> {
		// Flush any pending auto-save
		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			await this.autoSave();
		}

		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
	}

	async setFile(filePath: string): Promise<void> {
		// Flush pending changes for the previous file
		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			await this.autoSave();
		}

		this.filePath = filePath;
		this.mode = "viewer";
		await this.render();
		this.leaf.updateHeader();
	}

	private toggleMode(): void {
		// Flush pending auto-save before switching
		if (this.mode === "editor" && this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			this.autoSave();
		}
		this.mode = this.mode === "viewer" ? "editor" : "viewer";
		this.render();
	}

	private async render(): Promise<void> {
		if (!this.filePath) return;
		const thisRender = ++this.renderVersion;

		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as RecipeFrontmatter | undefined;
		if (!fm || fm.type !== "recipe") {
			// Cache not ready — schedule one retry
			if (thisRender === this.renderVersion) {
				setTimeout(() => this.render(), 100);
			}
			return;
		}

		const content = await this.app.vault.read(file);
		if (thisRender !== this.renderVersion) return;
		const { body: bodyContent } = splitFrontmatterBody(content);

		this.lastSavedContent = content;

		// Mode class for CSS targeting
		this.rootContainer.toggleClass("gl-recipe--editor", this.mode === "editor");

		// Preserve scroll positions
		const sideScroll = this.sideContainer?.scrollTop ?? 0;
		const mainScroll = this.mainContainer?.scrollTop ?? 0;

		const resourcePath = (path: string) => resolveResourcePath(this.app, path, this.filePath);

		// Side panel
		renderSidePanel(
			this.sideContainer,
			fm,
			bodyContent,
			resourcePath,
			this.mode,
			{
				onIngredientHover: (name) => {
					highlightMainSteps(this.mainContainer, name);
				},
				onInput: () => {
					this.scheduleAutoSave();
				},
			},
			this.app,
			this.filePath,
			this.plugin.noteIndex
		);

		// Main panel
		const viewerCallbacks = {
			onStepHover: (ingredientNames: string[]) => {
				if (ingredientNames.length > 0) {
					highlightSideIngredients(this.sideContainer, ingredientNames);
				} else {
					clearSideHighlights(this.sideContainer);
				}
			},
			onIngredientChipClick: (name: string) => {
				this.navigateToIngredient(name);
			},
			onBodyInput: (_newBody: string) => {},
			onNotesInput: () => {},
			onReviewsInput: () => {},
			onViewSource: () => {
				this.handleViewSource();
			},
			onToggleMode: () => {
				this.toggleMode();
			},
			onTitleChange: () => {},
			onShareCard: () => {
				exportShareCard(this.app, this.filePath, fm, bodyContent, titleFromPath(this.filePath));
			},
			onDelete: () => this.handleDelete(),
		};

		const editorCallbacks = {
			onTitleChange: async (newTitle: string) => {
				const f = this.app.vault.getAbstractFileByPath(this.filePath);
				if (!f || !(f instanceof TFile)) return;
				const parent = f.parent?.path ?? "";
				const newPath = parent ? `${parent}/${newTitle}.md` : `${newTitle}.md`;
				await this.app.fileManager.renameFile(f, newPath);
				this.filePath = newPath;
				this.leaf.updateHeader();
			},
			onStepHover: (_ingredientNames: string[]) => {},
			onIngredientChipClick: (_name: string) => {},
			onBodyInput: (newBody: string) => {
				// Read current fm from side panel for total time recalculation
				const sideState = collectSideState(this.sideContainer);
				const liveFm: RecipeFrontmatter = {
					...fm,
					prep_time: parseInt(sideState.prep_time, 10) || undefined,
					cook_time: parseInt(sideState.cook_time, 10) || undefined,
				};
				refreshSideData(this.sideContainer, newBody, liveFm, {
					onIngredientHover: (name) => {
						highlightMainSteps(this.mainContainer, name);
					},
					onInput: () => {
						this.scheduleAutoSave();
					},
				}, this.mode);
				this.scheduleAutoSave();
			},
			onNotesInput: () => {
				this.scheduleAutoSave();
			},
			onReviewsInput: () => {
				this.scheduleAutoSave();
			},
			onViewSource: () => {
				this.handleViewSource();
			},
			onToggleMode: () => {
				this.toggleMode();
			},
			onDelete: () => this.handleDelete(),
		};

		// Title row — at root level, above side/main
		const callbacks = this.mode === "viewer" ? viewerCallbacks : editorCallbacks;
		renderTitleRow(this.titleRow, titleFromPath(this.filePath), this.mode, callbacks);

		renderMainPanel(
			this.mainContainer,
			bodyContent,
			fm.source,
			this.mode,
			callbacks,
			this.app,
			this.filePath,
			resourcePath,
			this
		);

		// Restore scroll positions
		this.sideContainer.scrollTop = sideScroll;
		this.mainContainer.scrollTop = mainScroll;
	}

	// ── Auto-save ──

	private scheduleAutoSave(): void {
		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
		}
		this.autoSaveTimer = setTimeout(() => {
			this.autoSaveTimer = null;
			this.autoSave();
		}, AUTO_SAVE_DELAY_MS);
	}

	private async autoSave(): Promise<void> {
		if (this.mode !== "editor") return;

		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;

		const content = this.buildFileContent(file);
		if (content === this.lastSavedContent) return;

		this.isSaving = true;
		await this.app.vault.modify(file, content);
		this.lastSavedContent = content;

		setTimeout(() => {
			this.isSaving = false;
		}, SAVE_FLAG_RESET_MS);
	}

	private buildFileContent(file: TFile): string {
		const sideState = collectSideState(this.sideContainer);
		const mainState = collectMainState(this.mainContainer);

		const cache = this.app.metadataCache.getFileCache(file);
		const origFm = cache?.frontmatter;
		const fmData = buildRecipeFmData(sideState, origFm);

		const frontmatter = buildFrontmatterString(fmData);
		const body = buildRecipeBody(mainState.body, mainState.notes, mainState.reviews);

		return `${frontmatter}\n${body}`;
	}

	// ── Navigation ──

	private async handleViewSource(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	private handleDelete(): void {
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;
		new ConfirmDeleteModal(this.app, titleFromPath(this.filePath), async (confirmed) => {
			if (!confirmed) return;
			await this.app.vault.trash(file, true);
			this.leaf.detach();
		}).open();
	}

	private navigateToIngredient(name: string): void {
		const ingredientNames = this.plugin.noteIndex.getIngredientNames();
		const path = ingredientNames.get(name.toLowerCase());
		if (!path) return;

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return;

		const leaf = this.app.workspace.getLeaf(false);
		leaf.openFile(file);
	}
}

export function buildRecipeFmData(
	sideState: import("./recipe-side-panel").SideState,
	origFm?: Record<string, any> | null
): Record<string, unknown> {
	const fmData: Record<string, unknown> = { type: "recipe" };
	if (sideState.cuisine) {
		fmData.cuisine = sideState.cuisine
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}
	if (sideState.category) fmData.category = sideState.category;
	if (sideState.difficulty) fmData.difficulty = sideState.difficulty;
	const servings = parseInt(sideState.servings, 10);
	if (!isNaN(servings)) fmData.servings = servings;
	const prepTime = parseInt(sideState.prep_time, 10);
	if (!isNaN(prepTime)) fmData.prep_time = prepTime;
	const cookTime = parseInt(sideState.cook_time, 10);
	if (!isNaN(cookTime)) fmData.cook_time = cookTime;
	const rating = parseInt(sideState.rating, 10);
	if (!isNaN(rating) && rating >= 1 && rating <= 5) fmData.rating = rating;
	if (sideState.tags) {
		fmData.tags = sideState.tags
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}
	if (sideState.image) fmData.image = sideState.image;
	if (sideState.source) fmData.source = sideState.source;
	if (origFm?.created) fmData.created = origFm.created;
	return fmData;
}

export function buildRecipeBody(
	recipeBody: string,
	notes: string,
	reviews: string
): string {
	const lines: string[] = [];

	lines.push("## Recipe");
	lines.push("");
	if (recipeBody.trim()) {
		lines.push(recipeBody.trim());
	}
	lines.push("");

	if (notes) {
		lines.push("## Notes");
		lines.push("");
		lines.push(notes);
		lines.push("");
	}

	if (reviews) {
		lines.push("## Reviews");
		lines.push("");
		lines.push(reviews);
		lines.push("");
	}

	return lines.join("\n");
}

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { VIEW_TYPE_INGREDIENT, type IngredientFrontmatter, type IngredientViewMode } from "./types";
import { SINGLE_COLUMN_BREAKPOINT, AUTO_SAVE_DELAY_MS, SAVE_FLAG_RESET_MS } from "./constants";
import { titleFromPath, resolveResourcePath, splitFrontmatterBody } from "./view-utils";
import {
	renderIngredientSidePanel,
	collectIngredientSideState,
	type IngredientSideState,
} from "./ingredient-side-panel";
import {
	renderIngredientMainPanel,
	renderIngredientTitleRow,
	collectIngredientMainState,
} from "./ingredient-main-panel";
import { buildFrontmatterString } from "./frontmatter-utils";
import type GourmetLifePlugin from "./main";

interface IngredientViewState {
	file: string;
	mode: IngredientViewMode;
}

export class IngredientView extends ItemView {
	private plugin: GourmetLifePlugin;
	private filePath: string = "";
	private mode: IngredientViewMode = "viewer";
	private titleRow: HTMLElement = null!;
	private sideContainer: HTMLElement = null!;
	private mainContainer: HTMLElement = null!;
	private rootContainer: HTMLElement = null!;
	private resizeObserver: ResizeObserver | null = null;
	private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	private isSaving = false;
	private lastSavedContent = "";
	private renderVersion = 0;
	private lastRenderedFile = "";
	private isRendering = false;

	constructor(leaf: WorkspaceLeaf, plugin: GourmetLifePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_INGREDIENT;
	}

	getDisplayText(): string {
		return this.filePath ? titleFromPath(this.filePath) : "Ingredient";
	}

	getIcon(): string {
		return "salad";
	}

	async setState(
		state: IngredientViewState,
		result: { history: boolean }
	): Promise<void> {
		this.filePath = state.file || "";
		this.mode = state.mode || "viewer";
		await this.render();
		await super.setState(state, result);
	}

	getState(): IngredientViewState {
		return { file: this.filePath, mode: this.mode };
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.style.position = "relative";

		this.rootContainer = container.createDiv({ cls: "gl-ingredient" });
		this.titleRow = this.rootContainer.createDiv({ cls: "gl-ingredient__title-row" });
		this.sideContainer = this.rootContainer.createDiv({ cls: "gl-ingredient__side" });
		this.mainContainer = this.rootContainer.createDiv({ cls: "gl-ingredient__main" });

		// Responsive layout
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const width = entry.contentRect.width;
				this.rootContainer.toggleClass("gl-ingredient--single", width < SINGLE_COLUMN_BREAKPOINT);
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

		// Re-render on external metadata change
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.path === this.filePath && !this.isSaving && !this.isRendering) {
					this.render();
				}
			})
		);

		if (this.filePath) {
			await this.render();
		}
	}

	async onClose(): Promise<void> {
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

	async setFile(filePath: string, mode: IngredientViewMode = "viewer"): Promise<void> {
		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			await this.autoSave();
		}
		this.filePath = filePath;
		this.mode = mode;
		await this.render();
		this.leaf.updateHeader();
	}

	private toggleMode(): void {
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
		const fm = cache?.frontmatter as IngredientFrontmatter | undefined;
		if (!fm || fm.type !== "ingredient") {
			if (thisRender === this.renderVersion) {
				setTimeout(() => this.render(), 100);
			}
			return;
		}

		this.isRendering = true;
		try {
			const content = await this.app.vault.read(file);
			if (thisRender !== this.renderVersion) return;
			const { body: bodyContent } = splitFrontmatterBody(content);

			this.lastSavedContent = content;

			this.rootContainer.toggleClass("gl-ingredient--editor", this.mode === "editor");

			const sideScroll = this.sideContainer?.scrollTop ?? 0;
			const mainScroll = this.mainContainer?.scrollTop ?? 0;

			const resourcePath = (path: string) => resolveResourcePath(this.app, path, this.filePath);

			// Side panel
			renderIngredientSidePanel(
				this.sideContainer,
				fm,
				resourcePath,
				this.mode,
				{
					onInput: () => this.scheduleAutoSave(),
					onNavigateIngredient: (name: string) => this.navigateToIngredient(name),
				},
				this.app,
				this.filePath,
				this.plugin.noteIndex
			);

			// Title row + Main panel
			const callbacks = {
				onViewSource: () => this.handleViewSource(),
				onToggleMode: () => this.toggleMode(),
				onTitleChange: async (newTitle: string) => {
					const f = this.app.vault.getAbstractFileByPath(this.filePath);
					if (!f || !(f instanceof TFile)) return;
					const parent = f.parent?.path ?? "";
					const newPath = parent ? `${parent}/${newTitle}.md` : `${newTitle}.md`;
					await this.app.fileManager.renameFile(f, newPath);
					this.filePath = newPath;
					this.leaf.updateHeader();
				},
				onStoragePrepInput: () => this.scheduleAutoSave(),
				onNotesInput: () => this.scheduleAutoSave(),
				onPurchaseLogInput: () => this.scheduleAutoSave(),
				onDelete: () => this.handleDelete(),
				onRecipeClick: (path: string) => {
					const f = this.app.vault.getAbstractFileByPath(path);
					if (f instanceof TFile) this.plugin.openRecipeView(f);
				},
			};

			renderIngredientTitleRow(this.titleRow, titleFromPath(this.filePath), this.mode, callbacks);
			renderIngredientMainPanel(
				this.mainContainer, bodyContent, this.mode, callbacks,
				this.app, this.filePath, this,
				this.plugin.noteIndex, titleFromPath(this.filePath)
			);

			const isNewFile = this.filePath !== this.lastRenderedFile;
			if (isNewFile) {
				this.sideContainer.scrollTop = 0;
				this.mainContainer.scrollTop = 0;
				this.lastRenderedFile = this.filePath;
			} else {
				this.sideContainer.scrollTop = sideScroll;
				this.mainContainer.scrollTop = mainScroll;
			}
		} finally {
			this.isRendering = false;
		}
	}

	// ── Auto-save ──

	private scheduleAutoSave(): void {
		if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
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
		const sideState = collectIngredientSideState(this.sideContainer);
		const mainState = collectIngredientMainState(this.mainContainer);

		const cache = this.app.metadataCache.getFileCache(file);
		const origFm = cache?.frontmatter;
		const fmData = buildIngredientFmData(sideState, origFm);

		const frontmatter = buildFrontmatterString(fmData);
		const body = buildIngredientBody(mainState.storagePrep, mainState.notes, mainState.purchaseLog);

		return `${frontmatter}\n${body}`;
	}

	// ── Navigation ──

	private navigateToIngredient(name: string): void {
		const ingredientNames = this.plugin.noteIndex.getIngredientNames();
		const path = ingredientNames.get(name.toLowerCase());
		if (!path) return;

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) return;

		this.plugin.openIngredientView(file);
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

	private async handleViewSource(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}
}

export function buildIngredientFmData(
	sideState: IngredientSideState,
	origFm?: Record<string, any> | null
): Record<string, unknown> {
	const fmData: Record<string, unknown> = { type: "ingredient" };
	if (sideState.category) fmData.category = sideState.category;
	if (sideState.season.length > 0) fmData.season = sideState.season;
	const rating = parseFloat(sideState.rating);
	if (!isNaN(rating) && rating >= 1 && rating <= 5) fmData.rating = rating;
	if (sideState.aliases) {
		fmData.aliases = sideState.aliases
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}
	if (sideState.image) fmData.image = sideState.image;
	if (sideState.substitutes) {
		fmData.substitutes = sideState.substitutes
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}
	if (sideState.tags) {
		fmData.tags = sideState.tags
			.split(",")
			.map((s: string) => s.trim())
			.filter(Boolean);
	}
	if (origFm?.created) fmData.created = origFm.created;
	return fmData;
}

export function buildIngredientBody(
	storagePrep: string,
	notes: string,
	purchaseLog: string
): string {
	const lines: string[] = [];

	lines.push("## Storage & Prep");
	lines.push("");
	if (storagePrep.trim()) {
		lines.push(storagePrep.trim());
	}
	lines.push("");

	lines.push("## Notes");
	lines.push("");
	if (notes.trim()) {
		lines.push(notes.trim());
	}
	lines.push("");

	lines.push("## Purchase Log");
	lines.push("");
	if (purchaseLog.trim()) {
		lines.push(purchaseLog.trim());
	}
	lines.push("");

	return lines.join("\n");
}

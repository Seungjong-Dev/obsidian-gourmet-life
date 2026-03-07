import { ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import {
	VIEW_TYPE_EXPLORER,
	type ExplorerTab,
	type ExplorerLayout,
	type GourmetNote,
	type RecipeFrontmatter,
	type RestaurantFrontmatter,
} from "./types";
import {
	createEmptyFilter,
	applyFilters,
	extractFilterOptions,
	extractTagCounts,
	type ExplorerFilterState,
} from "./explorer-filter";
import {
	renderFilterBar,
	renderTagCloud,
	renderCardGrid,
	renderListView,
} from "./explorer-cards";
import { renderSidePanel, type SidePanelCallbacks } from "./recipe-side-panel";
import { renderMainPanel, type MainPanelCallbacks } from "./recipe-main-panel";
import { renderRestaurantSidePanel, destroyLeafletMap, type RestaurantSideCallbacks } from "./restaurant-side-panel";
import { renderRestaurantMainPanel, type RestaurantMainCallbacks } from "./restaurant-main-panel";
import { readGourmetFrontmatter } from "./frontmatter-utils";
import type GourmetLifePlugin from "./main";

interface ExplorerViewState {
	tab: ExplorerTab;
	layout: ExplorerLayout;
}

export class ExplorerView extends ItemView {
	private plugin: GourmetLifePlugin;
	private tab: ExplorerTab = "recipe";
	private layout: ExplorerLayout = "card";
	private filter: ExplorerFilterState = createEmptyFilter();
	private searchDebounce: ReturnType<typeof setTimeout> | null = null;

	private filterOpen = false;
	private selectedPath: string | null = null;

	// DOM refs
	private tabButtons: HTMLElement[] = [];
	private filterToggleBtn: HTMLButtonElement = null!;
	private layoutCardBtn: HTMLButtonElement = null!;
	private layoutListBtn: HTMLButtonElement = null!;
	private searchInput: HTMLInputElement = null!;
	private filterPanel: HTMLElement = null!;
	private filterContainer: HTMLElement = null!;
	private tagCloudContainer: HTMLElement = null!;
	private bodyContainer: HTMLElement = null!;
	private contentContainer: HTMLElement = null!;
	private previewContainer: HTMLElement = null!;

	constructor(leaf: WorkspaceLeaf, plugin: GourmetLifePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_EXPLORER;
	}

	getDisplayText(): string {
		return "Gourmet Explorer";
	}

	getIcon(): string {
		return "compass";
	}

	getState(): ExplorerViewState {
		return { tab: this.tab, layout: this.layout };
	}

	async setState(state: Partial<ExplorerViewState>): Promise<void> {
		if (state.tab) this.tab = state.tab;
		if (state.layout) this.layout = state.layout;
		this.filter = createEmptyFilter();
		this.refresh();
	}

	setTab(tab: ExplorerTab): void {
		this.tab = tab;
		this.filter = createEmptyFilter();
		this.closePreview();
		this.refresh();
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("gl-explorer");

		// ── Toolbar ──
		const toolbar = container.createDiv({ cls: "gl-explorer__toolbar" });

		// Tabs
		const tabs = toolbar.createDiv({ cls: "gl-explorer__tabs" });
		this.tabButtons = [];
		for (const t of ["recipe", "restaurant"] as ExplorerTab[]) {
			const btn = tabs.createEl("button", {
				cls: "gl-explorer__tab",
				text: t === "recipe" ? "Recipes" : "Restaurants",
			});
			btn.addEventListener("click", () => {
				this.tab = t;
				this.filter = createEmptyFilter();
				this.searchInput.value = "";
				this.closePreview();
				this.refresh();
			});
			this.tabButtons.push(btn);
		}

		// Right side of toolbar
		const right = toolbar.createDiv({ cls: "gl-explorer__toolbar-right" });

		this.filterToggleBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "Toggle filters" },
		});
		this.filterToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
		this.filterToggleBtn.addEventListener("click", () => {
			this.filterOpen = !this.filterOpen;
			this.updateFilterPanel();
		});

		this.searchInput = right.createEl("input", {
			cls: "gl-explorer__search",
			attr: { type: "text", placeholder: "Search..." },
		});
		this.searchInput.addEventListener("input", () => {
			if (this.searchDebounce) clearTimeout(this.searchDebounce);
			this.searchDebounce = setTimeout(() => {
				this.filter.search = this.searchInput.value;
				this.renderContent();
			}, 300);
		});

		this.layoutCardBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "Card view" },
		});
		this.layoutCardBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
		this.layoutCardBtn.addEventListener("click", () => {
			this.layout = "card";
			this.updateLayoutButtons();
			this.renderContent();
		});

		this.layoutListBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "List view" },
		});
		this.layoutListBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
		this.layoutListBtn.addEventListener("click", () => {
			this.layout = "list";
			this.updateLayoutButtons();
			this.renderContent();
		});

		// ── Filters (collapsible) ──
		this.filterPanel = container.createDiv({ cls: "gl-explorer__filter-panel" });
		this.filterContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });
		this.tagCloudContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });

		// ── Body (list + preview split) ──
		this.bodyContainer = container.createDiv({ cls: "gl-explorer__body" });
		this.contentContainer = this.bodyContainer.createDiv({ cls: "gl-explorer__content" });
		this.previewContainer = this.bodyContainer.createDiv({ cls: "gl-explorer__preview" });

		// ── Events ──
		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.renderContent())
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.renderContent())
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.renderContent())
		);

		this.refresh();
	}

	async onClose(): Promise<void> {
		if (this.searchDebounce) clearTimeout(this.searchDebounce);
		this.closePreview();
	}

	private refresh(): void {
		this.updateTabButtons();
		this.updateLayoutButtons();
		this.updateFilterPanel();
		this.renderFilters();
		this.renderContent();
	}

	private updateTabButtons(): void {
		const tabs: ExplorerTab[] = ["recipe", "restaurant"];
		for (let i = 0; i < this.tabButtons.length; i++) {
			this.tabButtons[i].toggleClass("gl-explorer__tab--active", tabs[i] === this.tab);
		}
	}

	private updateFilterPanel(): void {
		this.filterPanel.toggleClass("gl-explorer__filter-panel--open", this.filterOpen);
		this.filterToggleBtn.toggleClass("gl-explorer__layout-btn--active", this.filterOpen);
	}

	private updateLayoutButtons(): void {
		this.layoutCardBtn.toggleClass("gl-explorer__layout-btn--active", this.layout === "card");
		this.layoutListBtn.toggleClass("gl-explorer__layout-btn--active", this.layout === "list");
	}

	private getNotes(): GourmetNote[] {
		return this.tab === "recipe"
			? this.plugin.noteIndex.getRecipes()
			: this.plugin.noteIndex.getRestaurants();
	}

	private renderFilters(): void {
		const notes = this.getNotes();
		const options = extractFilterOptions(notes);
		const tagCounts = extractTagCounts(notes);

		renderFilterBar(
			this.filterContainer,
			this.tab,
			options,
			this.filter,
			(field, value) => this.onFilterChange(field, value)
		);

		renderTagCloud(
			this.tagCloudContainer,
			tagCounts,
			this.filter.tags,
			(tag) => this.onTagToggle(tag)
		);
	}

	private renderContent(): void {
		const notes = this.getNotes();
		const filtered = applyFilters(notes, this.filter);

		// Close preview if selected note is no longer visible
		if (this.selectedPath && !filtered.some((n) => n.path === this.selectedPath)) {
			this.closePreview();
		}

		const onOpen = (path: string) => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return;
			if (this.tab === "recipe") {
				this.plugin.openRecipeView(file);
			} else {
				this.plugin.openRestaurantView(file);
			}
		};

		const onSelect = (path: string) => {
			if (this.selectedPath === path) {
				this.closePreview();
			} else {
				this.selectedPath = path;
				this.renderPreview();
			}
			this.renderContent();
		};

		const resolveImage = (imagePath: string, notePath: string) => {
			const cleaned = imagePath.replace(/^\[\[|\]\]$/g, "");
			const resolved = this.app.metadataCache.getFirstLinkpathDest(cleaned, notePath);
			if (resolved) return this.app.vault.getResourcePath(resolved as any);
			const match = this.app.vault.getFiles().find(f => f.name === cleaned || f.path === cleaned);
			return match ? this.app.vault.getResourcePath(match as any) : "";
		};

		if (this.layout === "card") {
			renderCardGrid(this.contentContainer, filtered, this.tab, onOpen, this.app.vault, onSelect, this.selectedPath, resolveImage);
		} else {
			renderListView(this.contentContainer, filtered, this.tab, onOpen, this.app.vault, onSelect, this.selectedPath, resolveImage);
		}
	}

	private closePreview(): void {
		this.selectedPath = null;
		if (this.previewContainer) {
			// Destroy leaflet map if restaurant preview was open
			const sideEl = this.previewContainer.querySelector(".gl-restaurant__side");
			if (sideEl) destroyLeafletMap(sideEl as HTMLElement);
			this.previewContainer.empty();
			this.previewContainer.removeClass("gl-explorer__preview--open");
		}
	}

	private async renderPreview(): Promise<void> {
		if (!this.selectedPath) {
			this.closePreview();
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(this.selectedPath);
		if (!(file instanceof TFile)) {
			this.closePreview();
			return;
		}

		this.previewContainer.empty();
		this.previewContainer.addClass("gl-explorer__preview--open");

		// Header bar
		const header = this.previewContainer.createDiv({ cls: "gl-explorer__preview-header" });
		header.createSpan({ cls: "gl-explorer__preview-title", text: file.basename });

		const headerBtns = header.createDiv({ cls: "gl-explorer__preview-btns" });

		const openBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn" });
		openBtn.title = "Open in viewer";
		setIcon(openBtn, "external-link");
		openBtn.addEventListener("click", () => {
			if (this.tab === "recipe") {
				this.plugin.openRecipeView(file);
			} else {
				this.plugin.openRestaurantView(file);
			}
		});

		const closeBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn" });
		closeBtn.title = "Close preview";
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => {
			this.closePreview();
			this.renderContent();
		});

		// Read file content
		const content = await this.app.vault.read(file);
		const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
		const bodyContent = fmMatch ? content.substring(fmMatch[0].length) : content;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = readGourmetFrontmatter(cache);
		if (!fm) return;

		const resourcePath = (path: string) => {
			const cleaned = path.replace(/^\[\[|\]\]$/g, "");
			const resolved = this.app.metadataCache.getFirstLinkpathDest(cleaned, file.path);
			if (resolved) {
				return this.app.vault.getResourcePath(resolved as any);
			}
			const match = this.app.vault.getFiles().find(f => f.name === cleaned || f.path === cleaned);
			return match ? this.app.vault.getResourcePath(match as any) : "";
		};

		const previewBody = this.previewContainer.createDiv();

		if (fm.type === "recipe") {
			previewBody.addClass("gl-recipe", "gl-recipe--single");

			const sideEl = previewBody.createDiv({ cls: "gl-recipe__side" });
			const mainEl = previewBody.createDiv({ cls: "gl-recipe__main" });

			const sideCb: SidePanelCallbacks = {
				onIngredientHover: () => {},
				onInput: () => {},
			};
			renderSidePanel(sideEl, fm as RecipeFrontmatter, bodyContent, resourcePath, "viewer", sideCb);

			const mainCb: MainPanelCallbacks = {
				onStepHover: () => {},
				onIngredientChipClick: () => {},
				onBodyInput: () => {},
				onNotesInput: () => {},
				onReviewsInput: () => {},
				onViewSource: () => {},
				onToggleMode: () => {},
				onTitleChange: () => {},
			};
			renderMainPanel(mainEl, bodyContent, (fm as RecipeFrontmatter).source, "viewer", mainCb, this.app, file.path, resourcePath, this);
		} else if (fm.type === "restaurant") {
			previewBody.addClass("gl-restaurant", "gl-restaurant--single");

			const sideEl = previewBody.createDiv({ cls: "gl-restaurant__side" });
			const mainEl = previewBody.createDiv({ cls: "gl-restaurant__main" });

			const sideCb: RestaurantSideCallbacks = { onInput: () => {} };
			renderRestaurantSidePanel(sideEl, fm as RestaurantFrontmatter, bodyContent, resourcePath, "viewer", sideCb);

			const mainCb: RestaurantMainCallbacks = {
				onViewSource: () => {},
				onToggleMode: () => {},
				onTitleChange: () => {},
				onMenuInput: () => {},
				onNotesInput: () => {},
				onReviewsInput: () => {},
			};
			renderRestaurantMainPanel(mainEl, bodyContent, "viewer", mainCb, this.app, file.path, this);
		}
	}

	private onFilterChange(field: string, value: string): void {
		if (field === "minRating") {
			const num = parseInt(value, 10);
			this.filter.minRating = this.filter.minRating === num ? 0 : num;
		} else {
			const arr = (this.filter as any)[field] as string[];
			const idx = arr.indexOf(value);
			if (idx >= 0) arr.splice(idx, 1);
			else arr.push(value);
		}
		this.renderFilters();
		this.renderContent();
	}

	private onTagToggle(tag: string): void {
		const idx = this.filter.tags.indexOf(tag);
		if (idx >= 0) this.filter.tags.splice(idx, 1);
		else this.filter.tags.push(tag);
		this.renderFilters();
		this.renderContent();
	}
}

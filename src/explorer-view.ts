import { ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import {
	VIEW_TYPE_EXPLORER,
	type ExplorerTab,
	type ExplorerLayout,
	type SortOption,
	type GourmetNote,
	type RecipeFrontmatter,
	type RestaurantFrontmatter,
} from "./types";
import {
	createEmptyFilter,
	applyFilters,
	sortNotes,
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
import { renderStatsBar } from "./explorer-stats";
import { renderSidePanel, type SidePanelCallbacks } from "./recipe-side-panel";
import { renderMainPanel, type MainPanelCallbacks } from "./recipe-main-panel";
import { renderRestaurantSidePanel, destroyLeafletMap, type RestaurantSideCallbacks } from "./restaurant-side-panel";
import { renderRestaurantMainPanel, type RestaurantMainCallbacks } from "./restaurant-main-panel";
import { readGourmetFrontmatter } from "./frontmatter-utils";
import { renderGraphView, destroyGraph, hasExplorerGraph, updateGraphSelection } from "./explorer-graph";
import { renderMapView, destroyExplorerMap, hasExplorerMap, updateMapSelection } from "./explorer-map";
import type GourmetLifePlugin from "./main";

interface ExplorerViewState {
	tab: ExplorerTab;
	layout: ExplorerLayout;
	sortBy?: SortOption;
	filter?: Partial<ExplorerFilterState>;
	filterOpen?: boolean;
}

const RECIPE_SORT_OPTIONS: { value: SortOption; label: string }[] = [
	{ value: "name-asc", label: "Name A-Z" },
	{ value: "name-desc", label: "Name Z-A" },
	{ value: "rating-desc", label: "Rating" },
	{ value: "cook-time-asc", label: "Cook time" },
	{ value: "created-desc", label: "Newest" },
	{ value: "difficulty-asc", label: "Difficulty" },
];

const RESTAURANT_SORT_OPTIONS: { value: SortOption; label: string }[] = [
	{ value: "name-asc", label: "Name A-Z" },
	{ value: "name-desc", label: "Name Z-A" },
	{ value: "rating-desc", label: "Rating" },
	{ value: "created-desc", label: "Newest" },
	{ value: "price-asc", label: "Price" },
];

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
	private sortSelect: HTMLSelectElement = null!;
	private searchInput: HTMLInputElement = null!;
	private searchModeBtn: HTMLButtonElement = null!;
	private layoutCardBtn: HTMLButtonElement = null!;
	private layoutListBtn: HTMLButtonElement = null!;
	private layoutGraphBtn: HTMLButtonElement = null!;
	private layoutMapBtn: HTMLButtonElement = null!;
	private filterPanel: HTMLElement = null!;
	private filterContainer: HTMLElement = null!;
	private tagCloudContainer: HTMLElement = null!;
	private statsContainer: HTMLElement = null!;
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
		return {
			tab: this.tab,
			layout: this.layout,
			sortBy: this.filter.sortBy,
			filter: {
				cuisine: this.filter.cuisine,
				category: this.filter.category,
				difficulty: this.filter.difficulty,
				price_range: this.filter.price_range,
				area: this.filter.area,
				minRating: this.filter.minRating,
				tags: this.filter.tags,
				unrated: this.filter.unrated,
				searchIngredients: this.filter.searchIngredients,
			},
			filterOpen: this.filterOpen,
		};
	}

	async setState(state: Partial<ExplorerViewState>): Promise<void> {
		if (state.tab) this.tab = state.tab;
		if (state.layout) this.layout = state.layout;

		// Fallback if restored layout doesn't match current tab
		if (this.layout === "graph" && this.tab !== "recipe") this.layout = "card";
		if (this.layout === "map" && this.tab !== "restaurant") this.layout = "card";

		this.filter = createEmptyFilter();
		if (state.sortBy) this.filter.sortBy = state.sortBy;
		if (state.filterOpen !== undefined) this.filterOpen = state.filterOpen;

		// Restore filter values, validating against current data
		if (state.filter) {
			const notes = this.getNotes();
			const options = extractFilterOptions(notes);
			const sf = state.filter;

			if (sf.cuisine) {
				const valid = new Set(options.cuisine?.map((o) => o.value) ?? []);
				this.filter.cuisine = sf.cuisine.filter((v) => valid.has(v));
			}
			if (sf.category) {
				const valid = new Set(options.category?.map((o) => o.value) ?? []);
				this.filter.category = sf.category.filter((v) => valid.has(v));
			}
			if (sf.difficulty) this.filter.difficulty = sf.difficulty;
			if (sf.price_range) {
				const valid = new Set(options.price_range?.map((o) => o.value) ?? []);
				this.filter.price_range = sf.price_range.filter((v) => valid.has(v));
			}
			if (sf.area) {
				const valid = new Set(options.area?.map((o) => o.value) ?? []);
				this.filter.area = sf.area.filter((v) => valid.has(v));
			}
			if (sf.minRating) this.filter.minRating = sf.minRating;
			if (sf.tags) {
				const tagCounts = extractTagCounts(notes);
				this.filter.tags = sf.tags.filter((t) => tagCounts.has(t));
			}
			if (sf.unrated) this.filter.unrated = sf.unrated;
			if (sf.searchIngredients) this.filter.searchIngredients = sf.searchIngredients;
		}

		this.refresh();
	}

	setTab(tab: ExplorerTab): void {
		this.tab = tab;
		this.filter = createEmptyFilter();
		// Fallback: graph is recipe-only, map is restaurant-only
		if (this.layout === "graph" && tab !== "recipe") this.layout = "card";
		if (this.layout === "map" && tab !== "restaurant") this.layout = "card";
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
				// Fallback layout for incompatible tab
				if (this.layout === "graph" && t !== "recipe") this.layout = "card";
				if (this.layout === "map" && t !== "restaurant") this.layout = "card";
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

		// Search wrapper with mode toggle
		const searchWrap = right.createDiv({ cls: "gl-explorer__search-wrap" });

		this.searchInput = searchWrap.createEl("input", {
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

		this.searchModeBtn = searchWrap.createEl("button", {
			cls: "gl-explorer__search-mode",
			attr: { "aria-label": "Toggle ingredient search" },
		});
		setIcon(this.searchModeBtn, "leaf");
		this.searchModeBtn.title = "Include ingredient names in search";
		this.searchModeBtn.addEventListener("click", () => {
			this.filter.searchIngredients = !this.filter.searchIngredients;
			this.updateSearchMode();
			if (this.filter.search) this.renderContent();
		});

		// Sort dropdown
		this.sortSelect = right.createEl("select", {
			cls: "gl-explorer__sort",
		});
		this.sortSelect.addEventListener("change", () => {
			this.filter.sortBy = this.sortSelect.value as SortOption;
			this.renderContent();
		});

		// Surprise Me button
		const surpriseBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "Surprise me!" },
		});
		setIcon(surpriseBtn, "shuffle");
		surpriseBtn.title = "Pick a random note";
		surpriseBtn.addEventListener("click", () => this.surpriseMe());

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

		this.layoutGraphBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "Graph view" },
		});
		setIcon(this.layoutGraphBtn, "git-fork");
		this.layoutGraphBtn.addEventListener("click", () => {
			this.layout = "graph";
			this.updateLayoutButtons();
			this.renderContent();
		});

		this.layoutMapBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "Map view" },
		});
		setIcon(this.layoutMapBtn, "map-pin");
		this.layoutMapBtn.addEventListener("click", () => {
			this.layout = "map";
			this.updateLayoutButtons();
			this.renderContent();
		});

		// ── Filters (collapsible) ──
		this.filterPanel = container.createDiv({ cls: "gl-explorer__filter-panel" });
		this.filterContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });
		this.tagCloudContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });

		// ── Stats Bar ──
		this.statsContainer = container.createDiv({ cls: "gl-explorer__stats-wrap" });

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

		// ESC closes the side preview panel
		this.registerDomEvent(container, "keydown", (e: KeyboardEvent) => {
			if (e.key === "Escape" && this.selectedPath) {
				this.closePreviewAndSync();
			}
		});

		this.refresh();
	}

	async onClose(): Promise<void> {
		if (this.searchDebounce) clearTimeout(this.searchDebounce);
		destroyGraph(this.contentContainer);
		destroyExplorerMap(this.contentContainer);
		this.closePreview();
	}

	refresh(): void {
		this.updateTabButtons();
		this.updateLayoutButtons();
		this.updateFilterPanel();
		this.updateSortOptions();
		this.updateSearchMode();
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
		this.layoutGraphBtn.toggleClass("gl-explorer__layout-btn--active", this.layout === "graph");
		this.layoutMapBtn.toggleClass("gl-explorer__layout-btn--active", this.layout === "map");

		// Show graph only for recipe tab, map only for restaurant tab
		this.layoutGraphBtn.style.display = this.tab === "recipe" ? "" : "none";
		this.layoutMapBtn.style.display = this.tab === "restaurant" ? "" : "none";
	}

	private updateSortOptions(): void {
		this.sortSelect.empty();
		const opts = this.tab === "recipe" ? RECIPE_SORT_OPTIONS : RESTAURANT_SORT_OPTIONS;
		for (const opt of opts) {
			const el = this.sortSelect.createEl("option", { text: opt.label, value: opt.value });
			if (opt.value === this.filter.sortBy) el.selected = true;
		}
	}

	private updateSearchMode(): void {
		this.searchModeBtn.toggleClass("gl-explorer__search-mode--active", this.filter.searchIngredients);
		this.searchInput.placeholder = this.filter.searchIngredients ? "Search name + ingredients..." : "Search...";
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
		const ingredientIndex = this.filter.searchIngredients
			? this.plugin.noteIndex.recipeIngredients
			: undefined;
		const filtered = applyFilters(notes, this.filter, ingredientIndex);
		const sorted = sortNotes(filtered, this.filter.sortBy);

		// Close preview if selected note is no longer visible
		if (this.selectedPath && !sorted.some((n) => n.path === this.selectedPath)) {
			this.closePreview();
		}

		// Stats bar
		renderStatsBar(this.statsContainer, sorted, this.tab);

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

			// For map/graph, update selection in-place instead of full re-render
			if (this.layout === "map" && hasExplorerMap(this.contentContainer)) {
				updateMapSelection(this.contentContainer, this.selectedPath);
				return;
			}
			if (this.layout === "graph" && hasExplorerGraph(this.contentContainer)) {
				updateGraphSelection(this.contentContainer, this.selectedPath);
				return;
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

		// Cleanup previous graph/map before switching
		destroyGraph(this.contentContainer);
		destroyExplorerMap(this.contentContainer);

		if (this.layout === "graph") {
			renderGraphView(
				this.contentContainer,
				sorted,
				this.plugin.noteIndex.recipeIngredients,
				onSelect,
				this.selectedPath,
				this.plugin.settings.graphSettings,
				(gs) => {
					this.plugin.settings.graphSettings = gs;
					this.plugin.saveSettings();
				}
			);
		} else if (this.layout === "map") {
			renderMapView(this.contentContainer, sorted, onSelect, this.selectedPath);
		} else if (this.layout === "card") {
			renderCardGrid(this.contentContainer, sorted, this.tab, onOpen, this.app.vault, onSelect, this.selectedPath, resolveImage);
		} else {
			renderListView(this.contentContainer, sorted, this.tab, onOpen, this.app.vault, onSelect, this.selectedPath, resolveImage);
		}
	}

	private closePreview(): void {
		this.selectedPath = null;
		if (this.previewContainer) {
			const sideEl = this.previewContainer.querySelector(".gl-restaurant__side");
			if (sideEl) destroyLeafletMap(sideEl as HTMLElement);
			this.previewContainer.empty();
			this.previewContainer.removeClass("gl-explorer__preview--open");
		}
	}

	/** Close preview and sync the view selection without full re-render */
	private closePreviewAndSync(): void {
		this.closePreview();
		if (this.layout === "map" && hasExplorerMap(this.contentContainer)) {
			updateMapSelection(this.contentContainer, null);
		} else if (this.layout === "graph" && hasExplorerGraph(this.contentContainer)) {
			updateGraphSelection(this.contentContainer, null);
		} else {
			this.renderContent();
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
			this.closePreviewAndSync();
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

		// Related notes section
		this.renderRelatedNotes(this.previewContainer, fm, file.path);
	}

	private renderRelatedNotes(container: HTMLElement, fm: any, currentPath: string): void {
		const notes = this.getNotes().filter((n) => n.path !== currentPath);
		if (notes.length === 0) return;

		const currentTags = new Set<string>(fm.tags ?? []);
		const currentCuisines = new Set<string>(
			Array.isArray(fm.cuisine) ? fm.cuisine : fm.cuisine ? [fm.cuisine] : []
		);

		// Score by tag/cuisine overlap
		const scored = notes.map((n) => {
			let score = 0;
			const nfm = n.frontmatter as any;
			const nTags = nfm.tags ?? [];
			for (const t of nTags) {
				if (currentTags.has(t)) score += 2;
			}
			const nCuisines = Array.isArray(nfm.cuisine) ? nfm.cuisine : nfm.cuisine ? [nfm.cuisine] : [];
			for (const c of nCuisines) {
				if (currentCuisines.has(c)) score += 1;
			}
			return { note: n, score };
		}).filter((s) => s.score > 0);

		scored.sort((a, b) => b.score - a.score);
		const top = scored.slice(0, 5);
		if (top.length === 0) return;

		const section = container.createDiv({ cls: "gl-explorer__related" });
		section.createDiv({ cls: "gl-explorer__related-title", text: "You might also like" });

		for (const { note } of top) {
			const item = section.createDiv({ cls: "gl-explorer__related-item" });
			item.createSpan({ text: note.name });
			const rating = (note.frontmatter as any).rating;
			if (rating) {
				item.createSpan({
					cls: "gl-explorer__related-rating",
					text: "\u2605".repeat(rating),
				});
			}
			item.addEventListener("click", () => {
				this.selectedPath = note.path;
				this.renderPreview();
				if (this.layout === "map" && hasExplorerMap(this.contentContainer)) {
					updateMapSelection(this.contentContainer, this.selectedPath);
				} else if (this.layout === "graph" && hasExplorerGraph(this.contentContainer)) {
					updateGraphSelection(this.contentContainer, this.selectedPath);
				} else {
					this.renderContent();
				}
			});
		}
	}

	private surpriseMe(): void {
		const notes = this.getNotes();
		const ingredientIndex = this.filter.searchIngredients
			? this.plugin.noteIndex.recipeIngredients
			: undefined;
		const filtered = applyFilters(notes, this.filter, ingredientIndex);
		if (filtered.length === 0) return;

		const random = filtered[Math.floor(Math.random() * filtered.length)];
		this.selectedPath = random.path;
		this.renderPreview();
		this.renderContent();
	}

	private onFilterChange(field: string, value: string): void {
		if (field === "unrated") {
			this.filter.unrated = !this.filter.unrated;
			// Unrated and minRating are mutually exclusive
			if (this.filter.unrated) this.filter.minRating = 0;
		} else if (field === "minRating") {
			const num = parseInt(value, 10);
			this.filter.minRating = this.filter.minRating === num ? 0 : num;
			// Disable unrated when setting a rating filter
			if (this.filter.minRating > 0) this.filter.unrated = false;
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

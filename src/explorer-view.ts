import { ItemView, Menu, Modal, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import {
	VIEW_TYPE_EXPLORER,
	type ExplorerTab,
	type ExplorerLayout,
	type SortOption,
	type GourmetNote,
	type RecipeFrontmatter,
	type RecipeViewMode,
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
import { renderSidePanel, collectSideState, refreshSideData, type SidePanelCallbacks } from "./recipe-side-panel";
import { renderMainPanel, collectMainState, type MainPanelCallbacks } from "./recipe-main-panel";
import { renderRestaurantSidePanel, collectRestaurantSideState, destroyLeafletMap, type RestaurantSideCallbacks, type NearbyRestaurant } from "./restaurant-side-panel";
import { renderRestaurantMainPanel, collectRestaurantMainState, type RestaurantMainCallbacks } from "./restaurant-main-panel";
import { readGourmetFrontmatter, buildFrontmatterString } from "./frontmatter-utils";
import { buildRecipeBody, buildRecipeFmData } from "./recipe-view";
import { buildRestaurantBody, buildRestaurantFmData } from "./restaurant-view";
import { renderGraphView, destroyGraph, hasExplorerGraph, updateGraphSelection } from "./explorer-graph";
import { renderMapView, destroyExplorerMap, hasExplorerMap, updateMapSelection } from "./explorer-map";
import { getLayoutTier, isTouchDevice, suppressGhostClick, type LayoutTier } from "./device";
import type GourmetLifePlugin from "./main";
import { NoteCreateModal } from "./note-create-modal";
import { renderStarsDom } from "./render-utils";

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
	private previewMode: RecipeViewMode = "viewer";
	private previewAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	private previewIsSaving = false;
	private previewLastSavedContent = "";

	// Layout tier
	private currentTier: LayoutTier = "wide";
	private resizeObserver: ResizeObserver | null = null;

	// Narrow search state
	private narrowSearchOpen = false;

	// DOM refs — wide toolbar
	private tabButtons: HTMLElement[] = [];
	private filterToggleBtn: HTMLButtonElement = null!;
	private sortSelect: HTMLSelectElement = null!;
	private searchInput: HTMLInputElement = null!;
	private searchModeBtn: HTMLButtonElement = null!;
	private layoutCardBtn: HTMLButtonElement = null!;
	private layoutListBtn: HTMLButtonElement = null!;
	private layoutGraphBtn: HTMLButtonElement = null!;
	private layoutMapBtn: HTMLButtonElement = null!;
	private wideToolbar: HTMLElement = null!;

	// DOM refs — narrow toolbar
	private narrowToolbar: HTMLElement = null!;
	private narrowTabButtons: HTMLElement[] = [];
	private narrowSearchBar: HTMLElement = null!;
	private narrowSearchInput: HTMLInputElement = null!;
	private narrowSearchModeBtn: HTMLButtonElement = null!;

	// Shared panels
	private filterPanel: HTMLElement = null!;
	private filterContainer: HTMLElement = null!;
	private tagCloudContainer: HTMLElement = null!;
	private statsContainer: HTMLElement = null!;
	private bodyContainer: HTMLElement = null!;
	private contentContainer: HTMLElement = null!;
	private previewContainer: HTMLElement = null!;

	// Narrow overlay containers
	private previewOverlay: HTMLElement = null!;
	private filterDropdown: HTMLElement = null!;
	private filterBackdrop: HTMLElement = null!;

	// Swipe-back state
	private swipeStartX = 0;
	private swipeStartY = 0;
	private swiping = false;

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

	selectOnMap(path: string): void {
		this.flushPreviewAutoSave();
		this.previewMode = "viewer";
		this.tab = "restaurant";
		this.layout = "map";
		this.filter = createEmptyFilter();
		this.selectedPath = path;
		this.refresh();
		this.renderPreview();
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

		// ── Sidebar swipe interference prevention ──
		if (isTouchDevice()) {
			this.registerDomEvent(container, "touchmove", (e: TouchEvent) => {
				e.stopPropagation();
			});
		}

		// ── Wide Toolbar ──
		this.wideToolbar = container.createDiv({ cls: "gl-explorer__toolbar gl-explorer__toolbar--wide" });
		this.buildWideToolbar(this.wideToolbar);

		// ── Narrow Header (sticky wrapper for toolbar + search) ──
		const narrowHeader = container.createDiv({ cls: "gl-explorer__narrow-header" });
		this.narrowToolbar = narrowHeader.createDiv({ cls: "gl-explorer__toolbar gl-explorer__toolbar--narrow" });
		this.buildNarrowToolbar(this.narrowToolbar);

		// ── Narrow Search Bar (expandable) ──
		this.narrowSearchBar = narrowHeader.createDiv({ cls: "gl-explorer__narrow-search" });
		this.buildNarrowSearchBar(this.narrowSearchBar);

		// ── Filters (collapsible — for wide/medium) ──
		this.filterPanel = container.createDiv({ cls: "gl-explorer__filter-panel" });
		this.filterContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });
		this.tagCloudContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });

		// ── Narrow Filter Dropdown (overlay) ──
		this.filterBackdrop = container.createDiv({ cls: "gl-explorer__filter-backdrop" });
		this.filterBackdrop.addEventListener("click", () => this.closeNarrowFilter());
		this.filterDropdown = container.createDiv({ cls: "gl-explorer__filter-dropdown" });

		// ── Stats Bar ──
		this.statsContainer = narrowHeader.createDiv({ cls: "gl-explorer__stats-wrap" });

		// ── Body (list + preview split) ──
		this.bodyContainer = container.createDiv({ cls: "gl-explorer__body" });
		this.contentContainer = this.bodyContainer.createDiv({ cls: "gl-explorer__content" });
		this.previewContainer = this.bodyContainer.createDiv({ cls: "gl-explorer__preview" });

		// ── Narrow Preview Overlay ──
		this.previewOverlay = container.createDiv({ cls: "gl-explorer__preview-overlay" });

		// ── ResizeObserver ──
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const width = entry.contentRect.width;
				const newTier = getLayoutTier(width);
				if (newTier !== this.currentTier) {
					this.currentTier = newTier;
					this.onLayoutTierChanged(newTier);
				}
			}
		});
		this.resizeObserver.observe(container);
		// Set initial tier
		this.currentTier = getLayoutTier(container.clientWidth);
		this.applyTierClasses(this.currentTier);

		// ── Events ──
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				if (!this.previewIsSaving) this.renderContent();
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.renderContent())
		);
		this.registerEvent(
			this.app.vault.on("rename", () => this.renderContent())
		);

		// ESC closes the side preview panel
		this.registerDomEvent(container, "keydown", (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (this.narrowSearchOpen) {
					this.closeNarrowSearch();
				} else if (this.selectedPath) {
					this.closePreviewAndSync();
				}
			}
		});

		this.refresh();
	}

	async onClose(): Promise<void> {
		if (this.searchDebounce) clearTimeout(this.searchDebounce);
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		await this.flushPreviewAutoSave();
		destroyGraph(this.contentContainer);
		destroyExplorerMap(this.contentContainer);
		this.closePreview();
	}

	// ── Wide Toolbar Construction ──

	private buildWideToolbar(toolbar: HTMLElement): void {
		// Tabs
		const tabs = toolbar.createDiv({ cls: "gl-explorer__tabs" });
		this.tabButtons = [];
		for (const t of ["recipe", "restaurant"] as ExplorerTab[]) {
			const btn = tabs.createEl("button", {
				cls: "gl-explorer__tab",
				text: t === "recipe" ? "Recipes" : "Restaurants",
			});
			btn.addEventListener("click", () => this.switchTab(t));
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
		this.searchInput.addEventListener("input", () => this.onSearchInput(this.searchInput));

		this.searchModeBtn = searchWrap.createEl("button", {
			cls: "gl-explorer__search-mode",
			attr: { "aria-label": "Toggle ingredient search" },
		});
		setIcon(this.searchModeBtn, "leaf");
		this.searchModeBtn.title = "Include ingredient names in search";
		this.searchModeBtn.addEventListener("click", () => this.toggleSearchIngredients());

		// Sort dropdown
		this.sortSelect = right.createEl("select", {
			cls: "gl-explorer__sort",
		});
		this.sortSelect.addEventListener("change", () => {
			this.filter.sortBy = this.sortSelect.value as SortOption;
			this.renderContent();
		});

		// Add new note button
		const addBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "New note" },
		});
		setIcon(addBtn, "plus");
		addBtn.title = "Create new note";
		addBtn.addEventListener("click", () => this.createNote());

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
	}

	// ── Narrow Toolbar Construction ──

	private buildNarrowToolbar(toolbar: HTMLElement): void {
		// Segment control (pill toggle)
		const segment = toolbar.createDiv({ cls: "gl-explorer__segment" });
		this.narrowTabButtons = [];
		for (const t of ["recipe", "restaurant"] as ExplorerTab[]) {
			const btn = segment.createEl("button", {
				cls: "gl-explorer__segment-btn",
				text: t === "recipe" ? "Recipes" : "Restaurants",
			});
			btn.addEventListener("click", () => this.switchTab(t));
			this.narrowTabButtons.push(btn);
		}

		// Right icons
		const right = toolbar.createDiv({ cls: "gl-explorer__toolbar-right" });

		const searchBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "Search" },
		});
		setIcon(searchBtn, "search");
		searchBtn.addEventListener("click", () => this.toggleNarrowSearch());

		const overflowBtn = right.createEl("button", {
			cls: "gl-explorer__layout-btn",
			attr: { "aria-label": "More options" },
		});
		setIcon(overflowBtn, "more-vertical");
		overflowBtn.addEventListener("click", (e) => this.showOverflowMenu(e));
	}

	// ── Narrow Search Bar ──

	private buildNarrowSearchBar(bar: HTMLElement): void {
		const wrap = bar.createDiv({ cls: "gl-explorer__narrow-search-inner" });

		this.narrowSearchInput = wrap.createEl("input", {
			cls: "gl-explorer__search",
			attr: { type: "text", placeholder: "Search..." },
		});
		this.narrowSearchInput.addEventListener("input", () => this.onSearchInput(this.narrowSearchInput));

		this.narrowSearchModeBtn = wrap.createEl("button", {
			cls: "gl-explorer__search-mode",
			attr: { "aria-label": "Toggle ingredient search" },
		});
		setIcon(this.narrowSearchModeBtn, "leaf");
		this.narrowSearchModeBtn.addEventListener("click", () => this.toggleSearchIngredients());
	}

	// ── Common Tab Switch ──

	private switchTab(t: ExplorerTab): void {
		this.tab = t;
		this.filter = createEmptyFilter();
		this.searchInput.value = "";
		this.narrowSearchInput.value = "";
		// Fallback layout for incompatible tab
		if (this.layout === "graph" && t !== "recipe") this.layout = "card";
		if (this.layout === "map" && t !== "restaurant") this.layout = "card";
		this.closePreview();
		this.refresh();
	}

	// ── Search Helpers ──

	private onSearchInput(input: HTMLInputElement): void {
		if (this.searchDebounce) clearTimeout(this.searchDebounce);
		this.searchDebounce = setTimeout(() => {
			this.filter.search = input.value;
			// Sync both inputs
			if (input === this.searchInput) {
				this.narrowSearchInput.value = input.value;
			} else {
				this.searchInput.value = input.value;
			}
			this.renderContent();
		}, 300);
	}

	private toggleSearchIngredients(): void {
		this.filter.searchIngredients = !this.filter.searchIngredients;
		this.updateSearchMode();
		if (this.filter.search) this.renderContent();
	}

	// ── Narrow Search Expand/Collapse ──

	private toggleNarrowSearch(): void {
		if (this.narrowSearchOpen) {
			this.closeNarrowSearch();
		} else {
			this.narrowSearchOpen = true;
			this.narrowSearchBar.addClass("gl-explorer__narrow-search--open");
			this.narrowSearchInput.focus({ preventScroll: true });
		}
	}

	private closeNarrowSearch(): void {
		this.narrowSearchOpen = false;
		this.narrowSearchBar.removeClass("gl-explorer__narrow-search--open");
		if (!this.narrowSearchInput.value) {
			this.filter.search = "";
			this.searchInput.value = "";
			this.narrowSearchInput.value = "";
			this.renderContent();
		}
	}

	// ── Overflow Menu (Narrow) ──

	private showOverflowMenu(e: MouseEvent | Event): void {
		const menu = new Menu();

		// Sort submenu
		const sortOpts = this.tab === "recipe" ? RECIPE_SORT_OPTIONS : RESTAURANT_SORT_OPTIONS;
		for (const opt of sortOpts) {
			menu.addItem((item) => {
				item.setTitle(`Sort: ${opt.label}`);
				if (opt.value === this.filter.sortBy) item.setIcon("check");
				item.onClick(() => {
					this.filter.sortBy = opt.value;
					this.sortSelect.value = opt.value;
					this.renderContent();
				});
			});
		}

		menu.addSeparator();

		// Filter toggle
		menu.addItem((item) => {
			item.setTitle("Filters");
			item.setIcon("filter");
			if (this.filterOpen) item.setIcon("check");
			item.onClick(() => {
				if (this.currentTier === "narrow") {
					this.toggleNarrowFilter();
				} else {
					this.filterOpen = !this.filterOpen;
					this.updateFilterPanel();
				}
			});
		});

		menu.addSeparator();

		// Layout options
		const layouts: { value: ExplorerLayout; label: string; icon: string; show: boolean }[] = [
			{ value: "card", label: "Card view", icon: "layout-grid", show: true },
			{ value: "list", label: "List view", icon: "list", show: true },
			{ value: "graph", label: "Graph view", icon: "git-fork", show: this.tab === "recipe" },
			{ value: "map", label: "Map view", icon: "map-pin", show: this.tab === "restaurant" },
		];
		for (const l of layouts) {
			if (!l.show) continue;
			menu.addItem((item) => {
				item.setTitle(l.label);
				item.setIcon(l.icon);
				if (this.layout === l.value) item.setIcon("check");
				item.onClick(() => {
					this.layout = l.value;
					this.updateLayoutButtons();
					this.renderContent();
				});
			});
		}

		menu.addSeparator();

		// Add new note
		menu.addItem((item) => {
			item.setTitle("New note");
			item.setIcon("plus");
			item.onClick(() => this.createNote());
		});

		// Surprise me
		menu.addItem((item) => {
			item.setTitle("Surprise me!");
			item.setIcon("shuffle");
			item.onClick(() => this.surpriseMe());
		});

		menu.showAtMouseEvent(e as MouseEvent);
	}

	// ── Narrow Filter Dropdown ──

	private toggleNarrowFilter(): void {
		if (this.filterOpen) {
			this.closeNarrowFilter();
		} else {
			this.filterOpen = true;
			this.renderNarrowFilterContent();
			this.filterDropdown.addClass("gl-explorer__filter-dropdown--open");
			this.filterBackdrop.addClass("gl-explorer__filter-backdrop--open");
		}
	}

	private closeNarrowFilter(): void {
		this.filterOpen = false;
		this.filterDropdown.removeClass("gl-explorer__filter-dropdown--open");
		this.filterBackdrop.removeClass("gl-explorer__filter-backdrop--open");
	}

	private renderNarrowFilterContent(): void {
		this.filterDropdown.empty();
		const notes = this.getNotes();
		const options = extractFilterOptions(notes);
		const tagCounts = extractTagCounts(notes);

		const filterEl = this.filterDropdown.createDiv({ cls: "gl-explorer__filters" });
		renderFilterBar(filterEl, this.tab, options, this.filter, (field, value) => {
			this.onFilterChange(field, value);
			this.renderNarrowFilterContent();
		});

		const tagEl = this.filterDropdown.createDiv({ cls: "gl-explorer__filters" });
		renderTagCloud(tagEl, tagCounts, this.filter.tags, (tag) => {
			this.onTagToggle(tag);
			this.renderNarrowFilterContent();
		});
	}

	// ── Layout Tier Management ──

	private onLayoutTierChanged(tier: LayoutTier): void {
		this.applyTierClasses(tier);

		// If narrow and filter was open via collapsible panel, migrate to dropdown
		if (tier === "narrow" && this.filterOpen) {
			this.filterPanel.removeClass("gl-explorer__filter-panel--open");
			this.renderNarrowFilterContent();
			this.filterDropdown.addClass("gl-explorer__filter-dropdown--open");
			this.filterBackdrop.addClass("gl-explorer__filter-backdrop--open");
		} else if (tier !== "narrow" && this.filterOpen) {
			this.filterDropdown.removeClass("gl-explorer__filter-dropdown--open");
			this.filterBackdrop.removeClass("gl-explorer__filter-backdrop--open");
			this.filterPanel.addClass("gl-explorer__filter-panel--open");
		}

		// If switching away from narrow and graph was hidden, ensure valid layout
		if (tier !== "narrow" && this.layout === "graph" && this.tab !== "recipe") {
			this.layout = "card";
		}

		// Migrate preview positioning
		if (this.selectedPath) {
			this.renderPreview();
		}

		this.updateLayoutButtons();
		this.renderContent();
	}

	private applyTierClasses(tier: LayoutTier): void {
		const container = this.contentEl;
		container.removeClass("gl-explorer--wide", "gl-explorer--medium", "gl-explorer--narrow");
		container.addClass(`gl-explorer--${tier}`);
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
		for (let i = 0; i < this.narrowTabButtons.length; i++) {
			this.narrowTabButtons[i].toggleClass("gl-explorer__segment-btn--active", tabs[i] === this.tab);
		}
	}

	private updateFilterPanel(): void {
		if (this.currentTier === "narrow") {
			this.filterPanel.removeClass("gl-explorer__filter-panel--open");
			if (this.filterOpen) {
				this.renderNarrowFilterContent();
				this.filterDropdown.addClass("gl-explorer__filter-dropdown--open");
				this.filterBackdrop.addClass("gl-explorer__filter-backdrop--open");
			} else {
				this.filterDropdown.removeClass("gl-explorer__filter-dropdown--open");
				this.filterBackdrop.removeClass("gl-explorer__filter-backdrop--open");
			}
		} else {
			this.filterPanel.toggleClass("gl-explorer__filter-panel--open", this.filterOpen);
			this.filterDropdown.removeClass("gl-explorer__filter-dropdown--open");
			this.filterBackdrop.removeClass("gl-explorer__filter-backdrop--open");
		}
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
		this.narrowSearchModeBtn.toggleClass("gl-explorer__search-mode--active", this.filter.searchIngredients);
		const placeholder = this.filter.searchIngredients ? "Search name + ingredients..." : "Search...";
		this.searchInput.placeholder = placeholder;
		this.narrowSearchInput.placeholder = placeholder;
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
		renderStatsBar(this.statsContainer, sorted, this.tab, this.currentTier);

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
				this.flushPreviewAutoSave();
				this.previewMode = "viewer";
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
			renderCardGrid(this.contentContainer, sorted, this.tab, onOpen, this.app.vault, onSelect, this.selectedPath, resolveImage, this.currentTier);
		} else {
			renderListView(this.contentContainer, sorted, this.tab, onOpen, this.app.vault, onSelect, this.selectedPath, resolveImage, this.currentTier);
		}
	}

	private closePreview(): void {
		this.flushPreviewAutoSave();
		this.previewMode = "viewer";
		this.selectedPath = null;
		if (this.previewContainer) {
			const sideEl = this.previewContainer.querySelector(".gl-restaurant__side");
			if (sideEl) destroyLeafletMap(sideEl as HTMLElement);
			this.previewContainer.empty();
			this.previewContainer.removeClass("gl-explorer__preview--open");
		}
		if (this.previewOverlay) {
			const sideEl = this.previewOverlay.querySelector(".gl-restaurant__side");
			if (sideEl) destroyLeafletMap(sideEl as HTMLElement);
			this.previewOverlay.empty();
			this.previewOverlay.removeClass("gl-explorer__preview-overlay--open");
		}
	}

	/** Close preview and sync the view selection without full re-render */
	private closePreviewAndSync(): void {
		if (this.currentTier === "narrow") {
			suppressGhostClick(this.contentContainer);
		}
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

		// Flush any pending auto-save before switching notes
		await this.flushPreviewAutoSave();

		// Determine target container based on tier
		const isNarrow = this.currentTier === "narrow";
		const isMedium = this.currentTier === "medium";
		const targetContainer = isNarrow ? this.previewOverlay : this.previewContainer;

		// Clean both containers
		this.previewContainer.empty();
		this.previewOverlay.empty();

		if (isNarrow) {
			this.previewContainer.removeClass("gl-explorer__preview--open");
			this.previewOverlay.addClass("gl-explorer__preview-overlay--open");
			this.setupSwipeBack(this.previewOverlay);
		} else {
			this.previewOverlay.removeClass("gl-explorer__preview-overlay--open");
			targetContainer.addClass("gl-explorer__preview--open");
			if (isMedium) {
				targetContainer.addClass("gl-explorer__preview--medium");
			} else {
				targetContainer.removeClass("gl-explorer__preview--medium");
			}
		}

		// Header bar
		const header = targetContainer.createDiv({ cls: "gl-explorer__preview-header" });

		if (isNarrow) {
			const backBtn = header.createEl("button", { cls: "gl-explorer__preview-btn gl-explorer__preview-back-btn" });
			setIcon(backBtn, "arrow-left");
			backBtn.title = "Back";
			backBtn.addEventListener("click", () => this.closePreviewAndSync());
		}

		header.createSpan({ cls: "gl-explorer__preview-title", text: file.basename });

		const headerBtns = header.createDiv({ cls: "gl-explorer__preview-btns" });

		// Edit/View toggle button
		const editToggleBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn" });
		editToggleBtn.title = this.previewMode === "viewer" ? "Edit" : "View";
		setIcon(editToggleBtn, this.previewMode === "viewer" ? "pencil" : "eye");
		editToggleBtn.addEventListener("click", () => {
			this.flushPreviewAutoSave();
			this.previewMode = this.previewMode === "viewer" ? "editor" : "viewer";
			this.renderPreview();
		});

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

		const deleteBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn gl-explorer__preview-btn--danger" });
		deleteBtn.title = "Delete note";
		setIcon(deleteBtn, "trash-2");
		deleteBtn.addEventListener("click", () => this.deleteNote(file));

		if (!isNarrow) {
			const closeBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn" });
			closeBtn.title = "Close preview";
			setIcon(closeBtn, "x");
			closeBtn.addEventListener("click", () => {
				this.closePreviewAndSync();
			});
		}

		// Read file content
		const content = await this.app.vault.read(file);
		const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
		const bodyContent = fmMatch ? content.substring(fmMatch[0].length) : content;
		this.previewLastSavedContent = content;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = readGourmetFrontmatter(cache);
		if (!fm) {
			// Cache not ready (e.g. newly created file) — retry once
			setTimeout(() => {
				if (this.selectedPath === file.path) this.renderPreview();
			}, 150);
			return;
		}

		const resourcePath = (path: string) => {
			const cleaned = path.replace(/^\[\[|\]\]$/g, "");
			const resolved = this.app.metadataCache.getFirstLinkpathDest(cleaned, file.path);
			if (resolved) {
				return this.app.vault.getResourcePath(resolved as any);
			}
			const match = this.app.vault.getFiles().find(f => f.name === cleaned || f.path === cleaned);
			return match ? this.app.vault.getResourcePath(match as any) : "";
		};

		const mode = this.previewMode;
		const previewBody = targetContainer.createDiv();

		if (fm.type === "recipe") {
			previewBody.addClass("gl-recipe", "gl-recipe--single");
			previewBody.toggleClass("gl-recipe--editor", mode === "editor");

			const sideEl = previewBody.createDiv({ cls: "gl-recipe__side" });
			const mainEl = previewBody.createDiv({ cls: "gl-recipe__main" });

			const sideCb: SidePanelCallbacks = {
				onIngredientHover: () => {},
				onInput: () => this.schedulePreviewAutoSave(),
			};
			renderSidePanel(sideEl, fm as RecipeFrontmatter, bodyContent, resourcePath, mode, sideCb);

			const mainCb: MainPanelCallbacks = {
				onStepHover: () => {},
				onIngredientChipClick: () => {},
				onBodyInput: (newBody: string) => {
					if (mode === "editor") {
						const sideState = collectSideState(sideEl);
						const liveFm: RecipeFrontmatter = {
							...(fm as RecipeFrontmatter),
							prep_time: parseInt(sideState.prep_time, 10) || undefined,
							cook_time: parseInt(sideState.cook_time, 10) || undefined,
						};
						refreshSideData(sideEl, newBody, liveFm, {
							onIngredientHover: () => {},
							onInput: () => this.schedulePreviewAutoSave(),
						}, mode);
					}
					this.schedulePreviewAutoSave();
				},
				onNotesInput: () => this.schedulePreviewAutoSave(),
				onReviewsInput: () => this.schedulePreviewAutoSave(),
				onViewSource: () => {},
				onToggleMode: () => {
					this.flushPreviewAutoSave();
					this.previewMode = this.previewMode === "viewer" ? "editor" : "viewer";
					this.renderPreview();
				},
				onTitleChange: () => {},
			};
			renderMainPanel(mainEl, bodyContent, (fm as RecipeFrontmatter).source, mode, mainCb, this.app, file.path, resourcePath, this);
		} else if (fm.type === "restaurant") {
			previewBody.addClass("gl-restaurant", "gl-restaurant--single");
			previewBody.toggleClass("gl-restaurant--editor", mode === "editor");

			const sideEl = previewBody.createDiv({ cls: "gl-restaurant__side" });
			const mainEl = previewBody.createDiv({ cls: "gl-restaurant__main" });

			const rfm = fm as RestaurantFrontmatter;
			const nearbyRestaurants = this.buildNearbyRestaurants(rfm, file.path);
			const sideCb: RestaurantSideCallbacks = {
				onInput: () => this.schedulePreviewAutoSave(),
				onShowOnMap: this.layout !== "map" ? () => {
					this.layout = "map";
					this.selectedPath = file.path;
					this.refresh();
				} : undefined,
				nearbyRestaurants,
				onNearbyClick: (path: string) => {
					this.flushPreviewAutoSave();
					this.previewMode = "viewer";
					this.selectedPath = path;
					this.renderPreview();
					if (this.layout === "map" && hasExplorerMap(this.contentContainer)) {
						updateMapSelection(this.contentContainer, this.selectedPath);
					} else {
						this.renderContent();
					}
				},
			};
			renderRestaurantSidePanel(sideEl, rfm, bodyContent, resourcePath, mode, sideCb);

			const mainCb: RestaurantMainCallbacks = {
				onViewSource: () => {},
				onToggleMode: () => {
					this.flushPreviewAutoSave();
					this.previewMode = this.previewMode === "viewer" ? "editor" : "viewer";
					this.renderPreview();
				},
				onTitleChange: () => {},
				onMenuInput: () => this.schedulePreviewAutoSave(),
				onNotesInput: () => this.schedulePreviewAutoSave(),
				onReviewsInput: () => this.schedulePreviewAutoSave(),
			};
			renderRestaurantMainPanel(mainEl, bodyContent, mode, mainCb, this.app, file.path, this);
		}

		// Related notes section
		this.renderRelatedNotes(targetContainer, fm, file.path);
	}

	// ── Swipe Back (narrow preview) ──

	private setupSwipeBack(overlay: HTMLElement): void {
		const onTouchStart = (e: TouchEvent) => {
			const touch = e.touches[0];
			// Only trigger from left edge (20px zone)
			if (touch.clientX > 20) return;
			this.swipeStartX = touch.clientX;
			this.swipeStartY = touch.clientY;
			this.swiping = true;
		};

		const onTouchMove = (e: TouchEvent) => {
			if (!this.swiping) return;
			const touch = e.touches[0];
			const dx = touch.clientX - this.swipeStartX;
			const dy = Math.abs(touch.clientY - this.swipeStartY);
			// If vertical movement exceeds horizontal, cancel swipe
			if (dy > Math.abs(dx)) {
				this.swiping = false;
				overlay.style.transform = "";
				return;
			}
			if (dx > 0) {
				overlay.style.transform = `translateX(${dx}px)`;
			}
		};

		const onTouchEnd = (e: TouchEvent) => {
			if (!this.swiping) return;
			this.swiping = false;
			const touch = e.changedTouches[0];
			const dx = touch.clientX - this.swipeStartX;
			overlay.style.transform = "";
			if (dx > 75) {
				this.closePreviewAndSync();
			}
		};

		overlay.addEventListener("touchstart", onTouchStart, { passive: true });
		overlay.addEventListener("touchmove", onTouchMove, { passive: true });
		overlay.addEventListener("touchend", onTouchEnd, { passive: true });
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
				const ratingSpan = item.createSpan({ cls: "gl-explorer__related-rating" });
				renderStarsDom(ratingSpan, rating);
			}
			item.addEventListener("click", () => {
				this.flushPreviewAutoSave();
				this.previewMode = "viewer";
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

	// ── Preview auto-save ──

	private schedulePreviewAutoSave(): void {
		if (this.previewAutoSaveTimer) clearTimeout(this.previewAutoSaveTimer);
		this.previewAutoSaveTimer = setTimeout(() => {
			this.previewAutoSaveTimer = null;
			this.previewAutoSave();
		}, 1000);
	}

	private async previewAutoSave(): Promise<void> {
		if (this.previewMode !== "editor" || !this.selectedPath) return;

		const file = this.app.vault.getAbstractFileByPath(this.selectedPath);
		if (!file || !(file instanceof TFile)) return;

		const content = this.buildPreviewFileContent(file);
		if (!content || content === this.previewLastSavedContent) return;

		this.previewIsSaving = true;
		await this.app.vault.modify(file, content);
		this.previewLastSavedContent = content;

		setTimeout(() => {
			this.previewIsSaving = false;
		}, 200);
	}

	private async flushPreviewAutoSave(): Promise<void> {
		if (this.previewAutoSaveTimer) {
			clearTimeout(this.previewAutoSaveTimer);
			this.previewAutoSaveTimer = null;
			await this.previewAutoSave();
		}
	}

	private buildPreviewFileContent(file: TFile): string | null {
		// Check both containers
		let previewBody = this.previewContainer.querySelector(".gl-recipe, .gl-restaurant") as HTMLElement | null;
		if (!previewBody) {
			previewBody = this.previewOverlay.querySelector(".gl-recipe, .gl-restaurant") as HTMLElement | null;
		}
		if (!previewBody) return null;

		const cache = this.app.metadataCache.getFileCache(file);
		const origFm = cache?.frontmatter;

		if (previewBody.classList.contains("gl-recipe")) {
			const sideEl = previewBody.querySelector(".gl-recipe__side") as HTMLElement;
			const mainEl = previewBody.querySelector(".gl-recipe__main") as HTMLElement;
			if (!sideEl || !mainEl) return null;

			const sideState = collectSideState(sideEl);
			const mainState = collectMainState(mainEl);
			const fmData = buildRecipeFmData(sideState, origFm);
			const frontmatter = buildFrontmatterString(fmData);
			const body = buildRecipeBody(mainState.body, mainState.notes, mainState.reviews);
			return `${frontmatter}\n${body}`;
		} else {
			const sideEl = previewBody.querySelector(".gl-restaurant__side") as HTMLElement;
			const mainEl = previewBody.querySelector(".gl-restaurant__main") as HTMLElement;
			if (!sideEl || !mainEl) return null;

			const sideState = collectRestaurantSideState(sideEl);
			const mainState = collectRestaurantMainState(mainEl);
			const fmData = buildRestaurantFmData(sideState, origFm);
			const frontmatter = buildFrontmatterString(fmData);
			const body = buildRestaurantBody(mainState.menuHighlights, mainState.notes, mainState.reviews);
			return `${frontmatter}\n${body}`;
		}
	}

	private buildNearbyRestaurants(fm: RestaurantFrontmatter, currentPath: string): NearbyRestaurant[] {
		if (fm.lat == null || fm.lng == null) return [];
		const all = this.plugin.noteIndex.getRestaurants();
		const nearby: NearbyRestaurant[] = [];
		for (const note of all) {
			if (note.path === currentPath) continue;
			const nfm = note.frontmatter as RestaurantFrontmatter;
			if (nfm.lat == null || nfm.lng == null) continue;
			if (Math.abs(nfm.lat - fm.lat) > 0.05 || Math.abs(nfm.lng - fm.lng) > 0.05) continue;
			nearby.push({ name: note.name, lat: nfm.lat, lng: nfm.lng, path: note.path });
			if (nearby.length >= 15) break;
		}
		return nearby;
	}

	private createNote(): void {
		const noteType = this.tab === "recipe" ? "recipe" : "restaurant";
		new NoteCreateModal(this.app, noteType, this.plugin.settings, (file) => {
			this.selectedPath = file.path;
			this.previewMode = "editor";

			// Wait for metadataCache to index the new file before rendering
			const ref = this.app.metadataCache.on("changed", (changedFile) => {
				if (changedFile.path === file.path) {
					this.app.metadataCache.offref(ref);
					this.renderContent();
					this.renderPreview();
				}
			});
			// Fallback in case the event already fired or doesn't come
			setTimeout(() => {
				this.app.metadataCache.offref(ref);
				if (this.selectedPath === file.path) {
					this.renderContent();
					this.renderPreview();
				}
			}, 500);
		}).open();
	}

	private async deleteNote(file: TFile): Promise<void> {
		const confirmed = await new Promise<boolean>((resolve) => {
			const modal = new ConfirmDeleteModal(this.app, file.basename, resolve);
			modal.open();
		});
		if (!confirmed) return;

		this.closePreview();
		await this.app.vault.trash(file, true);
		new Notice(`Deleted "${file.basename}"`);
		this.renderContent();
	}

	private surpriseMe(): void {
		const notes = this.getNotes();
		const ingredientIndex = this.filter.searchIngredients
			? this.plugin.noteIndex.recipeIngredients
			: undefined;
		const filtered = applyFilters(notes, this.filter, ingredientIndex);
		if (filtered.length === 0) return;

		const random = filtered[Math.floor(Math.random() * filtered.length)];
		this.flushPreviewAutoSave();
		this.previewMode = "viewer";
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

export class ConfirmDeleteModal extends Modal {
	private name: string;
	private resolve: (value: boolean) => void;
	private resolved = false;

	constructor(app: import("obsidian").App, name: string, resolve: (value: boolean) => void) {
		super(app);
		this.name = name;
		this.resolve = resolve;
	}

	onOpen(): void {
		this.contentEl.createEl("p", {
			text: `Delete "${this.name}"? This cannot be undone.`,
		});
		const btnRow = this.contentEl.createDiv({ cls: "modal-button-container" });
		btnRow.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => { this.resolved = true; this.resolve(false); this.close(); });
		btnRow.createEl("button", { cls: "mod-warning", text: "Delete" })
			.addEventListener("click", () => { this.resolved = true; this.resolve(true); this.close(); });
	}

	onClose(): void {
		if (!this.resolved) this.resolve(false);
	}
}

import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import {
	VIEW_TYPE_EXPLORER,
	type ExplorerTab,
	type ExplorerLayout,
	type SortOption,
	type GourmetNote,
	type RecipeViewMode,
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
import { destroyLeafletMap } from "./restaurant-side-panel";
import { renderGraphView, destroyGraph, hasExplorerGraph, updateGraphSelection } from "./explorer-graph";
import { renderMapView, destroyExplorerMap, hasExplorerMap, updateMapSelection } from "./explorer-map";
import { getLayoutTier, isTouchDevice, suppressGhostClick, type LayoutTier } from "./device";
import { SEARCH_DEBOUNCE_MS } from "./constants";
import {
	buildWideToolbar,
	buildNarrowToolbar,
	buildNarrowSearchBar,
	showOverflowMenu,
	updateTabButtons,
	updateLayoutButtons,
	updateSortOptions,
	updateSearchMode,
	type WideToolbarRefs,
	type NarrowToolbarRefs,
	type NarrowSearchBarRefs,
	type ToolbarCallbacks,
} from "./explorer-toolbar";
import {
	renderPreview as renderPreviewImpl,
	flushPreviewAutoSave,
	type PreviewHost,
} from "./explorer-preview";
import { NoteCreateModal } from "./note-create-modal";
import type GourmetLifePlugin from "./main";

// Re-export for backwards compatibility
export { ConfirmDeleteModal } from "./confirm-delete-modal";

interface ExplorerViewState {
	tab: ExplorerTab;
	layout: ExplorerLayout;
	sortBy?: SortOption;
	filter?: Partial<ExplorerFilterState>;
	filterOpen?: boolean;
}

export class ExplorerView extends ItemView implements PreviewHost {
	plugin: GourmetLifePlugin;
	tab: ExplorerTab = "recipe";
	layout: ExplorerLayout = "card";
	private filter: ExplorerFilterState = createEmptyFilter();
	private searchDebounce: ReturnType<typeof setTimeout> | null = null;

	private filterOpen = false;
	selectedPath: string | null = null;
	previewMode: RecipeViewMode = "viewer";
	previewAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	previewIsSaving = false;
	previewLastSavedContent = "";

	// Layout tier
	currentTier: LayoutTier = "wide";
	private resizeObserver: ResizeObserver | null = null;

	// Narrow search state
	private narrowSearchOpen = false;

	// DOM refs — wide toolbar
	private wideRefs: WideToolbarRefs = null!;

	// DOM refs — narrow toolbar
	private narrowRefs: NarrowToolbarRefs = null!;
	private narrowSearchRefs: NarrowSearchBarRefs = null!;

	// Shared panels
	private filterPanel: HTMLElement = null!;
	private filterContainer: HTMLElement = null!;
	private tagCloudContainer: HTMLElement = null!;
	private statsContainer: HTMLElement = null!;
	private bodyContainer: HTMLElement = null!;
	contentContainer: HTMLElement = null!;
	previewContainer: HTMLElement = null!;

	// Narrow overlay containers
	previewOverlay: HTMLElement = null!;
	private filterDropdown: HTMLElement = null!;
	private filterBackdrop: HTMLElement = null!;

	// Swipe-back state
	swipeStartX = 0;
	swipeStartY = 0;
	swiping = false;

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

	// ── State Persistence ──

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

		if (this.layout === "graph" && this.tab !== "recipe") this.layout = "card";
		if (this.layout === "map" && this.tab !== "restaurant") this.layout = "card";

		this.filter = createEmptyFilter();
		if (state.sortBy) this.filter.sortBy = state.sortBy;
		if (state.filterOpen !== undefined) this.filterOpen = state.filterOpen;

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

	// ── Public API ──

	selectOnMap(path: string): void {
		flushPreviewAutoSave(this);
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
		if (this.layout === "graph" && tab !== "recipe") this.layout = "card";
		if (this.layout === "map" && tab !== "restaurant") this.layout = "card";
		this.closePreview();
		this.refresh();
	}

	// ── Lifecycle ──

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("gl-explorer");

		// Sidebar swipe interference prevention
		if (isTouchDevice()) {
			this.registerDomEvent(container, "touchmove", (e: TouchEvent) => {
				// Skip stopPropagation for map/graph areas so Leaflet's
				// document-level touch handlers (dragging, pinch-zoom) still fire
				const target = e.target as HTMLElement;
				if (target.closest(".gl-explorer__map-inner") || target.closest(".gl-explorer__graph-container")) return;
				e.stopPropagation();
			});
		}

		// Build toolbar callbacks
		const toolbarCb: ToolbarCallbacks = {
			onSwitchTab: (t) => this.switchTab(t),
			onToggleFilter: () => {
				this.filterOpen = !this.filterOpen;
				this.updateFilterPanel();
			},
			onSearchInput: (input) => this.onSearchInput(input),
			onToggleSearchIngredients: () => this.toggleSearchIngredients(),
			onSortChange: (sortBy) => {
				this.filter.sortBy = sortBy;
				this.wideRefs.sortSelect.value = sortBy;
				this.renderContent();
			},
			onCreateNote: () => this.createNote(),
			onSurpriseMe: () => this.surpriseMe(),
			onLayoutChange: (layout) => {
				this.layout = layout;
				updateLayoutButtons(this.wideRefs, this.layout, this.tab);
				this.renderContent();
			},
			onToggleNarrowSearch: () => this.toggleNarrowSearch(),
			onShowOverflowMenu: (e) => this.handleOverflowMenu(e),
		};

		// Wide Toolbar
		const wideToolbarEl = container.createDiv({ cls: "gl-explorer__toolbar gl-explorer__toolbar--wide" });
		this.wideRefs = buildWideToolbar(wideToolbarEl, toolbarCb);

		// Narrow Header (sticky wrapper for toolbar + search)
		const narrowHeader = container.createDiv({ cls: "gl-explorer__narrow-header" });
		const narrowToolbarEl = narrowHeader.createDiv({ cls: "gl-explorer__toolbar gl-explorer__toolbar--narrow" });
		this.narrowRefs = buildNarrowToolbar(narrowToolbarEl, toolbarCb);

		// Narrow Search Bar (expandable)
		const narrowSearchBarEl = narrowHeader.createDiv({ cls: "gl-explorer__narrow-search" });
		this.narrowSearchRefs = buildNarrowSearchBar(narrowSearchBarEl, toolbarCb);

		// Filters (collapsible — for wide/medium)
		this.filterPanel = container.createDiv({ cls: "gl-explorer__filter-panel" });
		this.filterContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });
		this.tagCloudContainer = this.filterPanel.createDiv({ cls: "gl-explorer__filters" });

		// Narrow Filter Dropdown (overlay)
		this.filterBackdrop = container.createDiv({ cls: "gl-explorer__filter-backdrop" });
		this.filterBackdrop.addEventListener("click", () => this.closeNarrowFilter());
		this.filterDropdown = container.createDiv({ cls: "gl-explorer__filter-dropdown" });

		// Stats Bar
		this.statsContainer = narrowHeader.createDiv({ cls: "gl-explorer__stats-wrap" });

		// Body (list + preview split)
		this.bodyContainer = container.createDiv({ cls: "gl-explorer__body" });
		this.contentContainer = this.bodyContainer.createDiv({ cls: "gl-explorer__content" });
		this.previewContainer = this.bodyContainer.createDiv({ cls: "gl-explorer__preview" });

		// Narrow Preview Overlay
		this.previewOverlay = container.createDiv({ cls: "gl-explorer__preview-overlay" });

		// ResizeObserver
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
		this.currentTier = getLayoutTier(container.clientWidth);
		this.applyTierClasses(this.currentTier);

		// Events
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				if (!this.previewIsSaving) this.renderContent();
			})
		);
		this.registerEvent(this.app.vault.on("delete", () => this.renderContent()));
		this.registerEvent(this.app.vault.on("rename", () => this.renderContent()));

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
		await flushPreviewAutoSave(this);
		destroyGraph(this.contentContainer);
		destroyExplorerMap(this.contentContainer);
		this.closePreview();
	}

	// ── Tab Switch ──

	private switchTab(t: ExplorerTab): void {
		this.tab = t;
		this.filter = createEmptyFilter();
		this.wideRefs.searchInput.value = "";
		this.narrowSearchRefs.searchInput.value = "";
		if (this.layout === "graph" && t !== "recipe") this.layout = "card";
		if (this.layout === "map" && t !== "restaurant") this.layout = "card";
		this.closePreview();
		this.refresh();
	}

	// ── Search ──

	private onSearchInput(input: HTMLInputElement): void {
		if (this.searchDebounce) clearTimeout(this.searchDebounce);
		this.searchDebounce = setTimeout(() => {
			this.filter.search = input.value;
			if (input === this.wideRefs.searchInput) {
				this.narrowSearchRefs.searchInput.value = input.value;
			} else {
				this.wideRefs.searchInput.value = input.value;
			}
			this.renderContent();
		}, SEARCH_DEBOUNCE_MS);
	}

	private toggleSearchIngredients(): void {
		this.filter.searchIngredients = !this.filter.searchIngredients;
		updateSearchMode(
			this.wideRefs.searchModeBtn,
			this.narrowSearchRefs.searchModeBtn,
			this.wideRefs.searchInput,
			this.narrowSearchRefs.searchInput,
			this.filter.searchIngredients
		);
		if (this.filter.search) this.renderContent();
	}

	// ── Narrow Search ──

	private toggleNarrowSearch(): void {
		if (this.narrowSearchOpen) {
			this.closeNarrowSearch();
		} else {
			this.narrowSearchOpen = true;
			this.narrowSearchRefs.bar.addClass("gl-explorer__narrow-search--open");
			this.narrowSearchRefs.searchInput.focus({ preventScroll: true });
		}
	}

	private closeNarrowSearch(): void {
		this.narrowSearchOpen = false;
		this.narrowSearchRefs.bar.removeClass("gl-explorer__narrow-search--open");
		if (!this.narrowSearchRefs.searchInput.value) {
			this.filter.search = "";
			this.wideRefs.searchInput.value = "";
			this.narrowSearchRefs.searchInput.value = "";
			this.renderContent();
		}
	}

	// ── Overflow Menu ──

	private handleOverflowMenu(e: MouseEvent | Event): void {
		showOverflowMenu(e, this.tab, this.layout, this.filter, this.currentTier, {
			onSortChange: (sortBy) => {
				this.filter.sortBy = sortBy;
				this.wideRefs.sortSelect.value = sortBy;
				this.renderContent();
			},
			onToggleFilter: () => {
				this.filterOpen = !this.filterOpen;
				this.updateFilterPanel();
			},
			onToggleNarrowFilter: () => this.toggleNarrowFilter(),
			onLayoutChange: (layout) => {
				this.layout = layout;
				updateLayoutButtons(this.wideRefs, this.layout, this.tab);
				this.renderContent();
			},
			onCreateNote: () => this.createNote(),
			onSurpriseMe: () => this.surpriseMe(),
		});
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

	// ── Layout Tier ──

	private onLayoutTierChanged(tier: LayoutTier): void {
		this.applyTierClasses(tier);

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

		if (tier !== "narrow" && this.layout === "graph" && this.tab !== "recipe") {
			this.layout = "card";
		}

		if (this.selectedPath) {
			this.renderPreview();
		}

		updateLayoutButtons(this.wideRefs, this.layout, this.tab);
		this.renderContent();
	}

	private applyTierClasses(tier: LayoutTier): void {
		const container = this.contentEl;
		container.removeClass("gl-explorer--wide", "gl-explorer--medium", "gl-explorer--narrow");
		container.addClass(`gl-explorer--${tier}`);
	}

	// ── Refresh ──

	refresh(): void {
		updateTabButtons(this.wideRefs.tabButtons, this.narrowRefs.tabButtons, this.tab);
		updateLayoutButtons(this.wideRefs, this.layout, this.tab);
		this.updateFilterPanel();
		updateSortOptions(this.wideRefs.sortSelect, this.tab, this.filter.sortBy);
		updateSearchMode(
			this.wideRefs.searchModeBtn,
			this.narrowSearchRefs.searchModeBtn,
			this.wideRefs.searchInput,
			this.narrowSearchRefs.searchInput,
			this.filter.searchIngredients
		);
		this.renderFilters();
		this.renderContent();
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
		this.wideRefs.filterToggleBtn.toggleClass("gl-explorer__layout-btn--active", this.filterOpen);
	}

	getNotes(): GourmetNote[] {
		return this.tab === "recipe"
			? this.plugin.noteIndex.getRecipes()
			: this.plugin.noteIndex.getRestaurants();
	}

	// ── Filters ──

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

	// ── Content ──

	renderContent(): void {
		const notes = this.getNotes();
		const ingredientIndex = this.filter.searchIngredients
			? this.plugin.noteIndex.recipeIngredients
			: undefined;
		const filtered = applyFilters(notes, this.filter, ingredientIndex);
		const sorted = sortNotes(filtered, this.filter.sortBy);

		if (this.selectedPath && !sorted.some((n) => n.path === this.selectedPath)) {
			this.closePreview();
		}

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
				flushPreviewAutoSave(this);
				this.previewMode = "viewer";
				this.selectedPath = path;
				this.renderPreview();
			}

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

		destroyGraph(this.contentContainer);
		destroyExplorerMap(this.contentContainer);

		// Disable body scroll when map is active (prevents touch event theft)
		this.bodyContainer.toggleClass("gl-explorer__body--map", this.layout === "map");

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

	// ── Preview (delegated to explorer-preview.ts) ──

	closePreview(): void {
		flushPreviewAutoSave(this);
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

	closePreviewAndSync(): void {
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

	async renderPreview(): Promise<void> {
		return renderPreviewImpl(this);
	}

	// ── Note Actions ──

	private createNote(): void {
		const noteType = this.tab === "recipe" ? "recipe" : "restaurant";
		new NoteCreateModal(this.app, noteType, this.plugin.settings, (file) => {
			this.selectedPath = file.path;
			this.previewMode = "editor";

			const ref = this.app.metadataCache.on("changed", (changedFile) => {
				if (changedFile.path === file.path) {
					this.app.metadataCache.offref(ref);
					this.renderContent();
					this.renderPreview();
				}
			});
			setTimeout(() => {
				this.app.metadataCache.offref(ref);
				if (this.selectedPath === file.path) {
					this.renderContent();
					this.renderPreview();
				}
			}, 500);
		}).open();
	}

	private surpriseMe(): void {
		const notes = this.getNotes();
		const ingredientIndex = this.filter.searchIngredients
			? this.plugin.noteIndex.recipeIngredients
			: undefined;
		const filtered = applyFilters(notes, this.filter, ingredientIndex);
		if (filtered.length === 0) return;

		const random = filtered[Math.floor(Math.random() * filtered.length)];
		flushPreviewAutoSave(this);
		this.previewMode = "viewer";
		this.selectedPath = random.path;
		this.renderPreview();
		this.renderContent();
	}

	private onFilterChange(field: string, value: string): void {
		if (field === "unrated") {
			this.filter.unrated = !this.filter.unrated;
			if (this.filter.unrated) this.filter.minRating = 0;
		} else if (field === "minRating") {
			const num = parseInt(value, 10);
			this.filter.minRating = this.filter.minRating === num ? 0 : num;
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

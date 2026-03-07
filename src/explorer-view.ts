import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import {
	VIEW_TYPE_EXPLORER,
	type ExplorerTab,
	type ExplorerLayout,
	type GourmetNote,
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

	// DOM refs
	private tabButtons: HTMLElement[] = [];
	private layoutCardBtn: HTMLButtonElement = null!;
	private layoutListBtn: HTMLButtonElement = null!;
	private searchInput: HTMLInputElement = null!;
	private filterContainer: HTMLElement = null!;
	private tagCloudContainer: HTMLElement = null!;
	private contentContainer: HTMLElement = null!;

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
				this.refresh();
			});
			this.tabButtons.push(btn);
		}

		// Right side of toolbar
		const right = toolbar.createDiv({ cls: "gl-explorer__toolbar-right" });

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

		// ── Filters ──
		this.filterContainer = container.createDiv({ cls: "gl-explorer__filters" });
		this.tagCloudContainer = container.createDiv({ cls: "gl-explorer__filters" });

		// ── Content ──
		this.contentContainer = container.createDiv({ cls: "gl-explorer__content" });

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
	}

	private refresh(): void {
		this.updateTabButtons();
		this.updateLayoutButtons();
		this.renderFilters();
		this.renderContent();
	}

	private updateTabButtons(): void {
		const tabs: ExplorerTab[] = ["recipe", "restaurant"];
		for (let i = 0; i < this.tabButtons.length; i++) {
			this.tabButtons[i].toggleClass("gl-explorer__tab--active", tabs[i] === this.tab);
		}
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

		const onOpen = (path: string) => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return;
			if (this.tab === "recipe") {
				this.plugin.openRecipeView(file);
			} else {
				this.plugin.openRestaurantView(file);
			}
		};

		if (this.layout === "card") {
			renderCardGrid(this.contentContainer, filtered, this.tab, onOpen, this.app.vault);
		} else {
			renderListView(this.contentContainer, filtered, this.tab, onOpen, this.app.vault);
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

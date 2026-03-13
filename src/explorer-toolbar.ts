import { Menu, setIcon } from "obsidian";
import type { ExplorerTab, ExplorerLayout, SortOption } from "./types";
import type { ExplorerFilterState } from "./explorer-filter";

// ── Sort Option Definitions ──

export const RECIPE_SORT_OPTIONS: { value: SortOption; label: string }[] = [
	{ value: "name-asc", label: "Name A-Z" },
	{ value: "name-desc", label: "Name Z-A" },
	{ value: "rating-desc", label: "Rating" },
	{ value: "cook-time-asc", label: "Cook time" },
	{ value: "created-desc", label: "Newest" },
	{ value: "difficulty-asc", label: "Difficulty" },
];

export const RESTAURANT_SORT_OPTIONS: { value: SortOption; label: string }[] = [
	{ value: "name-asc", label: "Name A-Z" },
	{ value: "name-desc", label: "Name Z-A" },
	{ value: "rating-desc", label: "Rating" },
	{ value: "created-desc", label: "Newest" },
	{ value: "price-asc", label: "Price" },
];

export const INGREDIENT_SORT_OPTIONS: { value: SortOption; label: string }[] = [
	{ value: "name-asc", label: "Name A-Z" },
	{ value: "name-desc", label: "Name Z-A" },
	{ value: "rating-desc", label: "Rating" },
	{ value: "created-desc", label: "Newest" },
	{ value: "category", label: "Category" },
];

// ── Callbacks ──

export interface ToolbarCallbacks {
	onSwitchTab: (tab: ExplorerTab) => void;
	onToggleFilter: () => void;
	onSearchInput: (input: HTMLInputElement) => void;
	onToggleSearchIngredients: () => void;
	onSortChange: (sortBy: SortOption) => void;
	onCreateNote: () => void;
	onSurpriseMe: () => void;
	onLayoutChange: (layout: ExplorerLayout) => void;
	onToggleNarrowSearch: () => void;
	onShowOverflowMenu: (e: MouseEvent | Event) => void;
}

// ── Wide Toolbar DOM Refs ──

export interface WideToolbarRefs {
	toolbar: HTMLElement;
	tabButtons: HTMLElement[];
	filterToggleBtn: HTMLButtonElement;
	sortSelect: HTMLSelectElement;
	searchInput: HTMLInputElement;
	searchModeBtn: HTMLButtonElement;
	layoutCardBtn: HTMLButtonElement;
	layoutListBtn: HTMLButtonElement;
	layoutGraphBtn: HTMLButtonElement;
	layoutMapBtn: HTMLButtonElement;
}

// ── Narrow Toolbar DOM Refs ──

export interface NarrowToolbarRefs {
	toolbar: HTMLElement;
	tabButtons: HTMLElement[];
}

export interface NarrowSearchBarRefs {
	bar: HTMLElement;
	searchInput: HTMLInputElement;
	searchModeBtn: HTMLButtonElement;
}

// ── Build Wide Toolbar ──

export function buildWideToolbar(
	toolbar: HTMLElement,
	callbacks: ToolbarCallbacks
): WideToolbarRefs {
	const tabButtons: HTMLElement[] = [];

	// Tabs — icons with tooltips
	const tabs = toolbar.createDiv({ cls: "gl-explorer__tabs" });
	const tabIcons: Record<ExplorerTab, { icon: string; label: string }> = {
		recipe: { icon: "chef-hat", label: "Recipes" },
		restaurant: { icon: "map-pin", label: "Restaurants" },
		ingredient: { icon: "salad", label: "Ingredients" },
	};
	for (const t of ["recipe", "restaurant", "ingredient"] as ExplorerTab[]) {
		const btn = tabs.createEl("button", {
			cls: "gl-explorer__tab",
			attr: { "aria-label": tabIcons[t].label },
		});
		setIcon(btn, tabIcons[t].icon);
		btn.addEventListener("click", () => callbacks.onSwitchTab(t));
		tabButtons.push(btn);
	}

	// Right side of toolbar
	const right = toolbar.createDiv({ cls: "gl-explorer__toolbar-right" });

	const filterToggleBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "Toggle filters" },
	}) as HTMLButtonElement;
	filterToggleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
	filterToggleBtn.addEventListener("click", () => callbacks.onToggleFilter());

	// Search wrapper with mode toggle
	const searchWrap = right.createDiv({ cls: "gl-explorer__search-wrap" });

	const searchInput = searchWrap.createEl("input", {
		cls: "gl-explorer__search",
		attr: { type: "text", placeholder: "Search..." },
	});
	searchInput.addEventListener("input", () => callbacks.onSearchInput(searchInput));

	const searchModeBtn = searchWrap.createEl("button", {
		cls: "gl-explorer__search-mode",
		attr: { "aria-label": "Toggle ingredient search" },
	}) as HTMLButtonElement;
	setIcon(searchModeBtn, "leaf");
	searchModeBtn.title = "Include ingredient names in search";
	searchModeBtn.addEventListener("click", () => callbacks.onToggleSearchIngredients());

	// Sort dropdown
	const sortSelect = right.createEl("select", {
		cls: "gl-explorer__sort",
	}) as HTMLSelectElement;
	sortSelect.addEventListener("change", () => {
		callbacks.onSortChange(sortSelect.value as SortOption);
	});

	// Add new note button
	const addBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "New note" },
	});
	setIcon(addBtn, "plus");
	addBtn.title = "Create new note";
	addBtn.addEventListener("click", () => callbacks.onCreateNote());

	// Surprise Me button
	const surpriseBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "Surprise me!" },
	});
	setIcon(surpriseBtn, "shuffle");
	surpriseBtn.title = "Pick a random note";
	surpriseBtn.addEventListener("click", () => callbacks.onSurpriseMe());

	const layoutCardBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "Card view" },
	}) as HTMLButtonElement;
	layoutCardBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
	layoutCardBtn.addEventListener("click", () => callbacks.onLayoutChange("card"));

	const layoutListBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "List view" },
	}) as HTMLButtonElement;
	layoutListBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
	layoutListBtn.addEventListener("click", () => callbacks.onLayoutChange("list"));

	const layoutGraphBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "Graph view" },
	}) as HTMLButtonElement;
	setIcon(layoutGraphBtn, "git-fork");
	layoutGraphBtn.addEventListener("click", () => callbacks.onLayoutChange("graph"));

	const layoutMapBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "Map view" },
	}) as HTMLButtonElement;
	setIcon(layoutMapBtn, "map-pin");
	layoutMapBtn.addEventListener("click", () => callbacks.onLayoutChange("map"));

	return {
		toolbar,
		tabButtons,
		filterToggleBtn,
		sortSelect,
		searchInput,
		searchModeBtn,
		layoutCardBtn,
		layoutListBtn,
		layoutGraphBtn,
		layoutMapBtn,
	};
}

// ── Build Narrow Toolbar ──

export function buildNarrowToolbar(
	toolbar: HTMLElement,
	callbacks: ToolbarCallbacks
): NarrowToolbarRefs {
	const tabButtons: HTMLElement[] = [];

	// Segment control (pill toggle) — icons only for narrow width
	const segment = toolbar.createDiv({ cls: "gl-explorer__segment" });
	const segIcons: Record<ExplorerTab, { icon: string; label: string }> = {
		recipe: { icon: "chef-hat", label: "Recipes" },
		restaurant: { icon: "map-pin", label: "Restaurants" },
		ingredient: { icon: "salad", label: "Ingredients" },
	};
	for (const t of ["recipe", "restaurant", "ingredient"] as ExplorerTab[]) {
		const btn = segment.createEl("button", {
			cls: "gl-explorer__segment-btn",
			attr: { "aria-label": segIcons[t].label },
		});
		setIcon(btn, segIcons[t].icon);
		btn.addEventListener("click", () => callbacks.onSwitchTab(t));
		tabButtons.push(btn);
	}

	// Right icons
	const right = toolbar.createDiv({ cls: "gl-explorer__toolbar-right" });

	const searchBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "Search" },
	});
	setIcon(searchBtn, "search");
	searchBtn.addEventListener("click", () => callbacks.onToggleNarrowSearch());

	const overflowBtn = right.createEl("button", {
		cls: "gl-explorer__layout-btn",
		attr: { "aria-label": "More options" },
	});
	setIcon(overflowBtn, "more-vertical");
	overflowBtn.addEventListener("click", (e) => callbacks.onShowOverflowMenu(e));

	return { toolbar, tabButtons };
}

// ── Build Narrow Search Bar ──

export function buildNarrowSearchBar(
	bar: HTMLElement,
	callbacks: ToolbarCallbacks
): NarrowSearchBarRefs {
	const wrap = bar.createDiv({ cls: "gl-explorer__narrow-search-inner" });

	const searchInput = wrap.createEl("input", {
		cls: "gl-explorer__search",
		attr: { type: "text", placeholder: "Search..." },
	});
	searchInput.addEventListener("input", () => callbacks.onSearchInput(searchInput));

	const searchModeBtn = wrap.createEl("button", {
		cls: "gl-explorer__search-mode",
		attr: { "aria-label": "Toggle ingredient search" },
	}) as HTMLButtonElement;
	setIcon(searchModeBtn, "leaf");
	searchModeBtn.addEventListener("click", () => callbacks.onToggleSearchIngredients());

	return { bar, searchInput, searchModeBtn };
}

// ── Overflow Menu ──

export function showOverflowMenu(
	e: MouseEvent | Event,
	tab: ExplorerTab,
	layout: ExplorerLayout,
	filter: ExplorerFilterState,
	currentTier: string,
	callbacks: {
		onSortChange: (sortBy: SortOption) => void;
		onToggleFilter: () => void;
		onToggleNarrowFilter: () => void;
		onLayoutChange: (layout: ExplorerLayout) => void;
		onCreateNote: () => void;
		onSurpriseMe: () => void;
	}
): void {
	const menu = new Menu();

	// Sort submenu
	const sortOpts = tab === "recipe"
		? RECIPE_SORT_OPTIONS
		: tab === "ingredient"
			? INGREDIENT_SORT_OPTIONS
			: RESTAURANT_SORT_OPTIONS;
	for (const opt of sortOpts) {
		menu.addItem((item) => {
			item.setTitle(`Sort: ${opt.label}`);
			if (opt.value === filter.sortBy) item.setIcon("check");
			item.onClick(() => callbacks.onSortChange(opt.value));
		});
	}

	menu.addSeparator();

	// Filter toggle
	menu.addItem((item) => {
		item.setTitle("Filters");
		item.setIcon("filter");
		if (filter.sortBy) { /* placeholder — filterOpen checked by caller */ }
		item.onClick(() => {
			if (currentTier !== "wide") {
				callbacks.onToggleNarrowFilter();
			} else {
				callbacks.onToggleFilter();
			}
		});
	});

	menu.addSeparator();

	// Layout options
	const layouts: { value: ExplorerLayout; label: string; icon: string; show: boolean }[] = [
		{ value: "card", label: "Card view", icon: "layout-grid", show: true },
		{ value: "list", label: "List view", icon: "list", show: true },
		{ value: "graph", label: "Graph view", icon: "git-fork", show: tab === "recipe" || tab === "ingredient" },
		{ value: "map", label: "Map view", icon: "map-pin", show: tab === "restaurant" },
	];
	for (const l of layouts) {
		if (!l.show) continue;
		menu.addItem((item) => {
			item.setTitle(l.label);
			item.setIcon(l.icon);
			if (layout === l.value) item.setIcon("check");
			item.onClick(() => callbacks.onLayoutChange(l.value));
		});
	}

	menu.addSeparator();

	// Add new note
	menu.addItem((item) => {
		item.setTitle("New note");
		item.setIcon("plus");
		item.onClick(() => callbacks.onCreateNote());
	});

	// Surprise me
	menu.addItem((item) => {
		item.setTitle("Surprise me!");
		item.setIcon("shuffle");
		item.onClick(() => callbacks.onSurpriseMe());
	});

	menu.showAtMouseEvent(e as MouseEvent);
}

// ── UI Update Helpers ──

export function updateTabButtons(
	wideButtons: HTMLElement[],
	narrowButtons: HTMLElement[],
	tab: ExplorerTab
): void {
	const tabs: ExplorerTab[] = ["recipe", "restaurant", "ingredient"];
	for (let i = 0; i < wideButtons.length; i++) {
		wideButtons[i].toggleClass("gl-explorer__tab--active", tabs[i] === tab);
	}
	for (let i = 0; i < narrowButtons.length; i++) {
		narrowButtons[i].toggleClass("gl-explorer__segment-btn--active", tabs[i] === tab);
	}
}

export function updateLayoutButtons(
	refs: Pick<WideToolbarRefs, "layoutCardBtn" | "layoutListBtn" | "layoutGraphBtn" | "layoutMapBtn">,
	layout: ExplorerLayout,
	tab: ExplorerTab
): void {
	refs.layoutCardBtn.toggleClass("gl-explorer__layout-btn--active", layout === "card");
	refs.layoutListBtn.toggleClass("gl-explorer__layout-btn--active", layout === "list");
	refs.layoutGraphBtn.toggleClass("gl-explorer__layout-btn--active", layout === "graph");
	refs.layoutMapBtn.toggleClass("gl-explorer__layout-btn--active", layout === "map");

	// Show graph for recipe + ingredient tabs, map only for restaurant tab
	refs.layoutGraphBtn.style.display = (tab === "recipe" || tab === "ingredient") ? "" : "none";
	refs.layoutMapBtn.style.display = tab === "restaurant" ? "" : "none";
}

export function updateSortOptions(
	sortSelect: HTMLSelectElement,
	tab: ExplorerTab,
	currentSortBy: SortOption
): void {
	sortSelect.empty();
	const opts = tab === "recipe"
		? RECIPE_SORT_OPTIONS
		: tab === "ingredient"
			? INGREDIENT_SORT_OPTIONS
			: RESTAURANT_SORT_OPTIONS;
	for (const opt of opts) {
		const el = sortSelect.createEl("option", { text: opt.label, value: opt.value });
		if (opt.value === currentSortBy) el.selected = true;
	}
}

export function updateSearchMode(
	wideBtn: HTMLButtonElement,
	narrowBtn: HTMLButtonElement,
	wideInput: HTMLInputElement,
	narrowInput: HTMLInputElement,
	searchIngredients: boolean
): void {
	wideBtn.toggleClass("gl-explorer__search-mode--active", searchIngredients);
	narrowBtn.toggleClass("gl-explorer__search-mode--active", searchIngredients);
	const placeholder = searchIngredients ? "Search name + ingredients..." : "Search...";
	wideInput.placeholder = placeholder;
	narrowInput.placeholder = placeholder;
}

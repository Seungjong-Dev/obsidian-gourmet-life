import { Notice, setIcon, TFile, type App } from "obsidian";
import type {
	GourmetNote,
	ExplorerTab,
	ExplorerLayout,
	RecipeFrontmatter,
	RecipeViewMode,
	RestaurantFrontmatter,
} from "./types";
import { readGourmetFrontmatter, buildFrontmatterString } from "./frontmatter-utils";
import { renderSidePanel, collectSideState, refreshSideData, type SidePanelCallbacks } from "./recipe-side-panel";
import { renderMainPanel, collectMainState, type MainPanelCallbacks } from "./recipe-main-panel";
import { renderRestaurantSidePanel, collectRestaurantSideState, destroyLeafletMap, type RestaurantSideCallbacks, type NearbyRestaurant } from "./restaurant-side-panel";
import { renderRestaurantMainPanel, collectRestaurantMainState, type RestaurantMainCallbacks } from "./restaurant-main-panel";
import { buildRecipeBody, buildRecipeFmData } from "./recipe-view";
import { buildRestaurantBody, buildRestaurantFmData } from "./restaurant-view";
import { hasExplorerMap, updateMapSelection } from "./explorer-map";
import { hasExplorerGraph, updateGraphSelection } from "./explorer-graph";
import { suppressGhostClick, type LayoutTier } from "./device";
import { renderStarsDom } from "./render-utils";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { AUTO_SAVE_DELAY_MS, SAVE_FLAG_RESET_MS, MAX_NEARBY_RESTAURANTS, NEARBY_RADIUS_DEG } from "./constants";
import { splitFrontmatterBody } from "./view-utils";
import type GourmetLifePlugin from "./main";

// ── Host interface ──
// ExplorerView implements this, allowing preview functions to interact with the view.

export interface PreviewHost {
	app: App;
	plugin: GourmetLifePlugin;
	tab: ExplorerTab;
	layout: ExplorerLayout;
	currentTier: LayoutTier;
	selectedPath: string | null;
	previewMode: RecipeViewMode;
	previewAutoSaveTimer: ReturnType<typeof setTimeout> | null;
	previewIsSaving: boolean;
	previewLastSavedContent: string;
	previewContainer: HTMLElement;
	previewOverlay: HTMLElement;
	contentContainer: HTMLElement;
	// Swipe state
	swipeStartX: number;
	swipeStartY: number;
	swiping: boolean;

	getNotes(): GourmetNote[];
	closePreview(): void;
	closePreviewAndSync(): void;
	renderContent(): void;
	renderPreview(): Promise<void>;
}

// ── Render Preview ──

export async function renderPreview(host: PreviewHost): Promise<void> {
	if (!host.selectedPath) {
		host.closePreview();
		return;
	}

	const file = host.app.vault.getAbstractFileByPath(host.selectedPath);
	if (!(file instanceof TFile)) {
		host.closePreview();
		return;
	}

	// Flush any pending auto-save before switching notes
	await flushPreviewAutoSave(host);

	// Determine target container based on tier
	const isNarrow = host.currentTier === "narrow";
	const isMedium = host.currentTier === "medium";
	const targetContainer = isNarrow ? host.previewOverlay : host.previewContainer;

	// Clean both containers
	host.previewContainer.empty();
	host.previewOverlay.empty();

	if (isNarrow) {
		host.previewContainer.removeClass("gl-explorer__preview--open");
		host.previewOverlay.addClass("gl-explorer__preview-overlay--open");
		setupSwipeBack(host, host.previewOverlay);
	} else {
		host.previewOverlay.removeClass("gl-explorer__preview-overlay--open");
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
		backBtn.addEventListener("click", () => host.closePreviewAndSync());
	}

	header.createSpan({ cls: "gl-explorer__preview-title", text: file.basename });

	const headerBtns = header.createDiv({ cls: "gl-explorer__preview-btns" });

	// Edit/View toggle button
	const editToggleBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn" });
	editToggleBtn.title = host.previewMode === "viewer" ? "Edit" : "View";
	setIcon(editToggleBtn, host.previewMode === "viewer" ? "pencil" : "eye");
	editToggleBtn.addEventListener("click", () => {
		flushPreviewAutoSave(host);
		host.previewMode = host.previewMode === "viewer" ? "editor" : "viewer";
		host.renderPreview();
	});

	const openBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn" });
	openBtn.title = "Open in viewer";
	setIcon(openBtn, "external-link");
	openBtn.addEventListener("click", () => {
		if (host.tab === "recipe") {
			host.plugin.openRecipeView(file);
		} else {
			host.plugin.openRestaurantView(file);
		}
	});

	const deleteBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn gl-explorer__preview-btn--danger" });
	deleteBtn.title = "Delete note";
	setIcon(deleteBtn, "trash-2");
	deleteBtn.addEventListener("click", () => deleteNote(host, file));

	if (!isNarrow) {
		const closeBtn = headerBtns.createEl("button", { cls: "gl-explorer__preview-btn" });
		closeBtn.title = "Close preview";
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => host.closePreviewAndSync());
	}

	// Read file content
	const content = await host.app.vault.read(file);
	const { body: bodyContent } = splitFrontmatterBody(content);
	host.previewLastSavedContent = content;

	const cache = host.app.metadataCache.getFileCache(file);
	const fm = readGourmetFrontmatter(cache);
	if (!fm) {
		// Cache not ready — retry once
		setTimeout(() => {
			if (host.selectedPath === file.path) host.renderPreview();
		}, 150);
		return;
	}

	const resourcePath = (path: string) => {
		const cleaned = path.replace(/^\[\[|\]\]$/g, "");
		const resolved = host.app.metadataCache.getFirstLinkpathDest(cleaned, file.path);
		if (resolved) {
			return host.app.vault.getResourcePath(resolved as TFile);
		}
		const match = host.app.vault.getFiles().find(f => f.name === cleaned || f.path === cleaned);
		return match ? host.app.vault.getResourcePath(match as TFile) : "";
	};

	const mode = host.previewMode;
	const previewBody = targetContainer.createDiv();

	if (fm.type === "recipe") {
		renderRecipePreview(host, previewBody, fm, bodyContent, resourcePath, mode, file);
	} else if (fm.type === "restaurant") {
		renderRestaurantPreview(host, previewBody, fm, bodyContent, resourcePath, mode, file);
	}

	// Related notes section
	renderRelatedNotes(host, targetContainer, fm, file.path);
}

// ── Recipe Preview ──

function renderRecipePreview(
	host: PreviewHost,
	previewBody: HTMLElement,
	fm: RecipeFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	mode: RecipeViewMode,
	file: TFile
): void {
	previewBody.addClass("gl-recipe", "gl-recipe--single");
	previewBody.toggleClass("gl-recipe--editor", mode === "editor");

	const sideEl = previewBody.createDiv({ cls: "gl-recipe__side" });
	const mainEl = previewBody.createDiv({ cls: "gl-recipe__main" });

	const sideCb: SidePanelCallbacks = {
		onIngredientHover: () => {},
		onInput: () => schedulePreviewAutoSave(host),
	};
	renderSidePanel(sideEl, fm, bodyContent, resourcePath, mode, sideCb);

	const mainCb: MainPanelCallbacks = {
		onStepHover: () => {},
		onIngredientChipClick: () => {},
		onBodyInput: (newBody: string) => {
			if (mode === "editor") {
				const sideState = collectSideState(sideEl);
				const liveFm: RecipeFrontmatter = {
					...fm,
					prep_time: parseInt(sideState.prep_time, 10) || undefined,
					cook_time: parseInt(sideState.cook_time, 10) || undefined,
				};
				refreshSideData(sideEl, newBody, liveFm, {
					onIngredientHover: () => {},
					onInput: () => schedulePreviewAutoSave(host),
				}, mode);
			}
			schedulePreviewAutoSave(host);
		},
		onNotesInput: () => schedulePreviewAutoSave(host),
		onReviewsInput: () => schedulePreviewAutoSave(host),
		onViewSource: () => {},
		onToggleMode: () => {
			flushPreviewAutoSave(host);
			host.previewMode = host.previewMode === "viewer" ? "editor" : "viewer";
			host.renderPreview();
		},
		onTitleChange: () => {},
	};
	renderMainPanel(mainEl, bodyContent, fm.source, mode, mainCb, host.app, file.path, resourcePath, host as any);
}

// ── Restaurant Preview ──

function renderRestaurantPreview(
	host: PreviewHost,
	previewBody: HTMLElement,
	fm: RestaurantFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	mode: RecipeViewMode,
	file: TFile
): void {
	previewBody.addClass("gl-restaurant", "gl-restaurant--single");
	previewBody.toggleClass("gl-restaurant--editor", mode === "editor");

	const sideEl = previewBody.createDiv({ cls: "gl-restaurant__side" });
	const mainEl = previewBody.createDiv({ cls: "gl-restaurant__main" });

	const nearbyRestaurants = buildNearbyRestaurants(host, fm, file.path);
	const sideCb: RestaurantSideCallbacks = {
		onInput: () => schedulePreviewAutoSave(host),
		onShowOnMap: host.layout !== "map" ? () => {
			host.layout = "map" as any;
			host.selectedPath = file.path;
			host.renderContent();
			host.renderPreview();
		} : undefined,
		nearbyRestaurants,
		onNearbyClick: (path: string) => {
			flushPreviewAutoSave(host);
			host.previewMode = "viewer";
			host.selectedPath = path;
			host.renderPreview();
			if (host.layout === "map" && hasExplorerMap(host.contentContainer)) {
				updateMapSelection(host.contentContainer, host.selectedPath);
			} else {
				host.renderContent();
			}
		},
	};
	renderRestaurantSidePanel(sideEl, fm, bodyContent, resourcePath, mode, sideCb);

	const mainCb: RestaurantMainCallbacks = {
		onViewSource: () => {},
		onToggleMode: () => {
			flushPreviewAutoSave(host);
			host.previewMode = host.previewMode === "viewer" ? "editor" : "viewer";
			host.renderPreview();
		},
		onTitleChange: () => {},
		onMenuInput: () => schedulePreviewAutoSave(host),
		onNotesInput: () => schedulePreviewAutoSave(host),
		onReviewsInput: () => schedulePreviewAutoSave(host),
	};
	renderRestaurantMainPanel(mainEl, bodyContent, mode, mainCb, host.app, file.path, host as any);
}

// ── Swipe Back (narrow preview) ──

function setupSwipeBack(host: PreviewHost, overlay: HTMLElement): void {
	const onTouchStart = (e: TouchEvent) => {
		const touch = e.touches[0];
		if (touch.clientX > 20) return;
		host.swipeStartX = touch.clientX;
		host.swipeStartY = touch.clientY;
		host.swiping = true;
	};

	const onTouchMove = (e: TouchEvent) => {
		if (!host.swiping) return;
		const touch = e.touches[0];
		const dx = touch.clientX - host.swipeStartX;
		const dy = Math.abs(touch.clientY - host.swipeStartY);
		if (dy > Math.abs(dx)) {
			host.swiping = false;
			overlay.style.transform = "";
			return;
		}
		if (dx > 0) {
			overlay.style.transform = `translateX(${dx}px)`;
		}
	};

	const onTouchEnd = (e: TouchEvent) => {
		if (!host.swiping) return;
		host.swiping = false;
		const touch = e.changedTouches[0];
		const dx = touch.clientX - host.swipeStartX;
		overlay.style.transform = "";
		if (dx > 75) {
			host.closePreviewAndSync();
		}
	};

	overlay.addEventListener("touchstart", onTouchStart, { passive: true });
	overlay.addEventListener("touchmove", onTouchMove, { passive: true });
	overlay.addEventListener("touchend", onTouchEnd, { passive: true });
}

// ── Related Notes ──

function renderRelatedNotes(
	host: PreviewHost,
	container: HTMLElement,
	fm: any,
	currentPath: string
): void {
	const notes = host.getNotes().filter((n) => n.path !== currentPath);
	if (notes.length === 0) return;

	const currentTags = new Set<string>(fm.tags ?? []);
	const currentCuisines = new Set<string>(
		Array.isArray(fm.cuisine) ? fm.cuisine : fm.cuisine ? [fm.cuisine] : []
	);

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
			flushPreviewAutoSave(host);
			host.previewMode = "viewer";
			host.selectedPath = note.path;
			host.renderPreview();
			if (host.layout === "map" && hasExplorerMap(host.contentContainer)) {
				updateMapSelection(host.contentContainer, host.selectedPath);
			} else if (host.layout === "graph" && hasExplorerGraph(host.contentContainer)) {
				updateGraphSelection(host.contentContainer, host.selectedPath);
			} else {
				host.renderContent();
			}
		});
	}
}

// ── Preview Auto-Save ──

export function schedulePreviewAutoSave(host: PreviewHost): void {
	if (host.previewAutoSaveTimer) clearTimeout(host.previewAutoSaveTimer);
	host.previewAutoSaveTimer = setTimeout(() => {
		host.previewAutoSaveTimer = null;
		previewAutoSave(host);
	}, AUTO_SAVE_DELAY_MS);
}

async function previewAutoSave(host: PreviewHost): Promise<void> {
	if (host.previewMode !== "editor" || !host.selectedPath) return;

	const file = host.app.vault.getAbstractFileByPath(host.selectedPath);
	if (!file || !(file instanceof TFile)) return;

	const content = buildPreviewFileContent(host, file);
	if (!content || content === host.previewLastSavedContent) return;

	host.previewIsSaving = true;
	await host.app.vault.modify(file, content);
	host.previewLastSavedContent = content;

	setTimeout(() => {
		host.previewIsSaving = false;
	}, SAVE_FLAG_RESET_MS);
}

export async function flushPreviewAutoSave(host: PreviewHost): Promise<void> {
	if (host.previewAutoSaveTimer) {
		clearTimeout(host.previewAutoSaveTimer);
		host.previewAutoSaveTimer = null;
		await previewAutoSave(host);
	}
}

function buildPreviewFileContent(host: PreviewHost, file: TFile): string | null {
	let previewBody = host.previewContainer.querySelector(".gl-recipe, .gl-restaurant") as HTMLElement | null;
	if (!previewBody) {
		previewBody = host.previewOverlay.querySelector(".gl-recipe, .gl-restaurant") as HTMLElement | null;
	}
	if (!previewBody) return null;

	const cache = host.app.metadataCache.getFileCache(file);
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

// ── Nearby Restaurants ──

function buildNearbyRestaurants(
	host: PreviewHost,
	fm: RestaurantFrontmatter,
	currentPath: string
): NearbyRestaurant[] {
	if (fm.lat == null || fm.lng == null) return [];
	const all = host.plugin.noteIndex.getRestaurants();
	const nearby: NearbyRestaurant[] = [];
	for (const note of all) {
		if (note.path === currentPath) continue;
		const nfm = note.frontmatter as RestaurantFrontmatter;
		if (nfm.lat == null || nfm.lng == null) continue;
		if (Math.abs(nfm.lat - fm.lat) > NEARBY_RADIUS_DEG || Math.abs(nfm.lng - fm.lng) > NEARBY_RADIUS_DEG) continue;
		nearby.push({ name: note.name, lat: nfm.lat, lng: nfm.lng, path: note.path });
		if (nearby.length >= MAX_NEARBY_RESTAURANTS) break;
	}
	return nearby;
}

// ── Delete Note ──

export async function deleteNote(host: PreviewHost, file: TFile): Promise<void> {
	const confirmed = await new Promise<boolean>((resolve) => {
		const modal = new ConfirmDeleteModal(host.app, file.basename, resolve);
		modal.open();
	});
	if (!confirmed) return;

	host.closePreview();
	await host.app.vault.trash(file, true);
	new Notice(`Deleted "${file.basename}"`);
	host.renderContent();
}

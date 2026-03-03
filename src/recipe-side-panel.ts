import type { App } from "obsidian";
import type { RecipeFrontmatter, RecipeViewMode } from "./types";
import { DIFFICULTY_OPTIONS, RECIPE_CATEGORIES } from "./types";
import {
	extractCooklangIngredientsGrouped,
	extractCooklangTools,
	extractCooklangTimers,
	calculateTotalTime,
	type CooklangIngredient,
} from "./cooklang-parser";
import { showImageLightbox } from "./recipe-main-panel";
import { ImageSuggestModal } from "./image-suggest-modal";

export interface SidePanelCallbacks {
	onIngredientHover: (name: string | null) => void;
	onInput: () => void;
}

export interface SideState {
	image: string;
	cuisine: string;
	category: string;
	difficulty: string;
	servings: string;
	prep_time: string;
	cook_time: string;
	rating: string;
	tags: string;
	source: string;
}

/**
 * Render the side panel in viewer or editor mode.
 */
export function renderSidePanel(
	container: HTMLElement,
	fm: RecipeFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	mode: RecipeViewMode,
	callbacks: SidePanelCallbacks,
	app?: App,
	recipePath?: string
): void {
	container.empty();

	if (mode === "viewer") {
		renderSidePanelViewer(container, fm, bodyContent, resourcePath, callbacks);
	} else {
		renderSidePanelEditor(container, fm, bodyContent, resourcePath, callbacks, app, recipePath);
	}
}

/**
 * Viewer mode: read-only metadata display.
 */
function renderSidePanelViewer(
	container: HTMLElement,
	fm: RecipeFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	callbacks: SidePanelCallbacks
): void {
	// Image — single display
	if (fm.image) {
		const imageWrap = container.createDiv({ cls: "gl-recipe__image-wrap" });
		const img = imageWrap.createEl("img", {
			cls: "gl-recipe__image",
		});
		img.src = resourcePath(fm.image);
		img.addEventListener("click", () => showImageLightbox(img.src, fm.title || ""));
	}

	// Stats grid — prep_time, cook_time, servings, difficulty
	const hasStats = fm.prep_time != null || fm.cook_time != null || fm.servings != null || fm.difficulty;
	if (hasStats) {
		const statsGrid = container.createDiv({ cls: "gl-recipe__stats-grid" });
		if (fm.prep_time != null) addStatCell(statsGrid, "Prep", `${fm.prep_time} min`);
		if (fm.cook_time != null) addStatCell(statsGrid, "Cook", `${fm.cook_time} min`);
		if (fm.servings != null) addStatCell(statsGrid, "Servings", String(fm.servings));
		if (fm.difficulty) {
			const label = fm.difficulty.charAt(0).toUpperCase() + fm.difficulty.slice(1);
			addStatCell(statsGrid, "Level", label);
		}
	}

	// Metadata — remaining fields
	const metaSection = container.createDiv({ cls: "gl-recipe__meta" });

	// Cuisine + Category as chips
	const hasCuisineOrCategory = fm.cuisine || fm.category;
	if (hasCuisineOrCategory) {
		const chipsWrap = metaSection.createDiv({ cls: "gl-recipe__meta-chips" });
		if (fm.cuisine) {
			const cuisines = Array.isArray(fm.cuisine) ? fm.cuisine : [fm.cuisine];
			for (const c of cuisines) {
				chipsWrap.createSpan({ text: c, cls: "gl-recipe__meta-chip" });
			}
		}
		if (fm.category) {
			chipsWrap.createSpan({ text: fm.category, cls: "gl-recipe__meta-chip" });
		}
	}

	// Rating — large star display
	if (fm.rating != null) {
		const ratingWrap = metaSection.createDiv({ cls: "gl-recipe__rating-display" });
		ratingWrap.createSpan({ text: renderStars(fm.rating) });
		ratingWrap.createSpan({ text: ` ${fm.rating}/5`, cls: "gl-recipe__rating-label" });
	}

	// Source — truncated URL link
	if (fm.source) {
		if (fm.source.startsWith("http")) {
			const sourceWrap = metaSection.createDiv();
			let displayUrl = fm.source;
			try {
				const url = new URL(fm.source);
				displayUrl = url.hostname.replace(/^www\./, "") + (url.pathname.length > 1 ? url.pathname : "");
				if (displayUrl.length > 40) displayUrl = displayUrl.slice(0, 37) + "...";
			} catch { /* use raw */ }
			const link = sourceWrap.createEl("a", {
				text: displayUrl,
				href: fm.source,
				cls: "gl-recipe__source-link",
			});
			link.setAttr("target", "_blank");
			link.setAttr("rel", "noopener");
		} else {
			addViewRow(metaSection, "Source", fm.source);
		}
	}

	// Tags
	if (fm.tags && fm.tags.length > 0) {
		const tagsRow = metaSection.createDiv({ cls: "gl-recipe__meta-row" });
		tagsRow.createSpan({ text: "Tags", cls: "gl-recipe__meta-label" });
		const tagsContainer = tagsRow.createSpan();
		for (const tag of fm.tags) {
			tagsContainer.createSpan({ text: tag, cls: "gl-recipe__tag-chip" });
		}
	}

	// Side data — ingredients/tools/time (same as editor)
	const sideData = container.createDiv({ cls: "gl-recipe__side-data" });
	renderSideDataContent(sideData, bodyContent, fm, callbacks, "viewer");
}

/**
 * Editor mode: editable input fields + live side data.
 */
function renderSidePanelEditor(
	container: HTMLElement,
	fm: RecipeFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	callbacks: SidePanelCallbacks,
	app?: App,
	recipePath?: string
): void {
	// Editor metadata card — accordion wrapper for Image + Metadata
	const editorMeta = container.createDiv({ cls: "gl-recipe__editor-meta" });

	// Accordion header
	const metaHeader = editorMeta.createDiv({ cls: "gl-recipe__editor-meta-header" });
	metaHeader.createSpan({ cls: "gl-recipe__ingredients-chevron", text: "\u25B6" });
	metaHeader.createEl("h3", { text: "Metadata", cls: "gl-recipe__section-title" });

	metaHeader.addEventListener("click", () => {
		editorMeta.toggleClass("gl-recipe__editor-meta--open",
			!editorMeta.hasClass("gl-recipe__editor-meta--open"));
	});

	// Accordion body
	const metaBody = editorMeta.createDiv({ cls: "gl-recipe__editor-meta-body" });

	// Image — h3 visible only in 2-column (hidden in single-column by CSS)
	metaBody.createEl("h3", { text: "Image", cls: "gl-recipe__editor-meta-label" });

	// Image — single with change/remove
	const imageContainer = metaBody.createDiv({ cls: "gl-recipe__image-single" });
	let currentImage = fm.image || "";

	const renderImageEditor = () => {
		imageContainer.empty();
		if (currentImage) {
			const item = imageContainer.createDiv({ cls: "gl-recipe__image-item" });
			item.dataset.imagePath = currentImage;

			const preview = item.createEl("img", {
				cls: "gl-recipe__image gl-recipe__image--thumb",
			});
			preview.src = resourcePath(currentImage);

			item.createSpan({
				cls: "gl-recipe__image-path",
				text: currentImage,
			});

			const removeBtn = item.createEl("button", {
				cls: "gl-recipe__image-remove",
				text: "\u00d7",
			});
			removeBtn.title = "Remove image";
			removeBtn.addEventListener("click", () => {
				currentImage = "";
				renderImageEditor();
				callbacks.onInput();
			});
		}

		const btnText = currentImage ? "Change image" : "+ Add image";
		const addBtn = imageContainer.createEl("button", {
			cls: "gl-recipe__add-btn",
			text: btnText,
		});
		addBtn.addEventListener("click", () => {
			if (app) {
				new ImageSuggestModal(app, (file) => {
					currentImage = file.name;
					renderImageEditor();
					callbacks.onInput();
				}, recipePath).open();
			}
		});
	};
	renderImageEditor();

	// Metadata — h3 visible only in 2-column (hidden in single-column by CSS)
	metaBody.createEl("h3", { text: "Metadata", cls: "gl-recipe__editor-meta-label" });

	// Metadata — input fields
	const cuisineValue = Array.isArray(fm.cuisine) ? fm.cuisine.join(", ") : (fm.cuisine || "");
	addEditField(metaBody, "Cuisine", "cuisine", cuisineValue, callbacks.onInput);
	addDropdownField(
		metaBody,
		"Category",
		"category",
		["", ...RECIPE_CATEGORIES],
		fm.category || "",
		callbacks.onInput
	);
	addDropdownField(
		metaBody,
		"Difficulty",
		"difficulty",
		["", ...DIFFICULTY_OPTIONS],
		fm.difficulty || "",
		callbacks.onInput
	);
	addEditField(
		metaBody,
		"Servings",
		"servings",
		fm.servings != null ? String(fm.servings) : "",
		callbacks.onInput
	);
	addEditField(
		metaBody,
		"Prep time (min)",
		"prep_time",
		fm.prep_time != null ? String(fm.prep_time) : "",
		callbacks.onInput
	);
	addEditField(
		metaBody,
		"Cook time (min)",
		"cook_time",
		fm.cook_time != null ? String(fm.cook_time) : "",
		callbacks.onInput
	);
	addEditField(
		metaBody,
		"Rating (1-5)",
		"rating",
		fm.rating != null ? String(fm.rating) : "",
		callbacks.onInput
	);
	const tagsValue = fm.tags ? fm.tags.join(", ") : "";
	addEditField(metaBody, "Tags", "tags", tagsValue, callbacks.onInput);
	addEditField(metaBody, "Source", "source", fm.source || "", callbacks.onInput);

	// Side data wrapper — live ingredients/tools/time
	const sideData = container.createDiv({ cls: "gl-recipe__side-data" });
	renderSideDataContent(sideData, bodyContent, fm, callbacks, "editor");
}

/**
 * Re-render only the side data section (ingredients/tools/time).
 * Does not touch metadata input fields.
 */
export function refreshSideData(
	container: HTMLElement,
	bodyContent: string,
	fm: RecipeFrontmatter,
	callbacks: SidePanelCallbacks,
	mode: RecipeViewMode = "editor"
): void {
	const sideData = container.querySelector(".gl-recipe__side-data") as HTMLElement | null;
	if (!sideData) return;
	sideData.empty();
	renderSideDataContent(sideData, bodyContent, fm, callbacks, mode);
}

/**
 * Render ingredients, tools, and total time into a container.
 */
function renderSideDataContent(
	container: HTMLElement,
	bodyContent: string,
	fm: RecipeFrontmatter,
	callbacks: SidePanelCallbacks,
	mode: RecipeViewMode = "editor"
): void {
	const sectionTitle = (parent: HTMLElement, text: string) => {
		parent.createEl("h3", {
			text,
			cls: "gl-recipe__section-title",
		});
	};

	// Ingredients — extracted from @markers
	const grouped = extractCooklangIngredientsGrouped(bodyContent);
	const hasIngredients = Array.from(grouped.values()).some((arr) => arr.length > 0);

	if (hasIngredients) {
		const ingredientsSection = container.createDiv({
			cls: "gl-recipe__ingredients",
		});

		// Accordion header
		const header = ingredientsSection.createDiv({ cls: "gl-recipe__ingredients-header" });
		header.createSpan({ cls: "gl-recipe__ingredients-chevron", text: "\u25B6" });
		sectionTitle(header, "Ingredients");

		header.addEventListener("click", () => {
			ingredientsSection.toggleClass("gl-recipe__ingredients--open",
				!ingredientsSection.hasClass("gl-recipe__ingredients--open"));
		});

		// Accordion body
		const accordionBody = ingredientsSection.createDiv({ cls: "gl-recipe__ingredients-body" });

		for (const [sectionName, items] of grouped) {
			if (grouped.size > 1 || sectionName) {
				const sDiv = accordionBody.createDiv({
					cls: "gl-recipe__section",
				});
				sDiv.createEl("h4", { text: sectionName || "Main" });
			}

			const merged = mergeIngredients(items);

			for (const ing of merged) {
				const item = accordionBody.createDiv({
					cls: "gl-recipe__item",
				});

				// Checkbox (viewer mode only)
				if (mode === "viewer") {
					const checkbox = item.createEl("input", {
						type: "checkbox",
						cls: "gl-recipe__item-checkbox",
					}) as HTMLInputElement;
					checkbox.addEventListener("click", (e) => e.stopPropagation());
					checkbox.addEventListener("change", () => {
						if (checkbox.checked) {
							item.addClass("gl-recipe__item--checked");
						} else {
							item.removeClass("gl-recipe__item--checked");
						}
					});
				}

				const nameEl = item.createSpan({
					text: ing.name,
				});
				const qtyText =
					[ing.quantity, ing.unit].filter(Boolean).join(" ");
				if (qtyText) {
					item.createSpan({
						text: qtyText,
						cls: "gl-recipe__meta-label",
					});
				}

				// Hover interaction
				item.addEventListener("mouseenter", () => {
					item.addClass("gl-recipe__item--highlight");
					callbacks.onIngredientHover(ing.name);
				});
				item.addEventListener("mouseleave", () => {
					item.removeClass("gl-recipe__item--highlight");
					callbacks.onIngredientHover(null);
				});

				// Store for external highlighting
				nameEl.dataset.ingredient = ing.name.toLowerCase();
			}
		}
	}

	// Tools — extracted from #markers
	const tools = extractCooklangTools(bodyContent);
	if (tools.length > 0) {
		const toolsSection = container.createDiv({
			cls: "gl-recipe__tools",
		});
		sectionTitle(toolsSection, "Tools");
		const list = toolsSection.createEl("ul");
		for (const tool of tools) {
			list.createEl("li", { text: tool.name });
		}
	}

	// Total time — frontmatter first, then timer sum
	const fmTotalTime = (fm.prep_time || 0) + (fm.cook_time || 0);
	const timers = extractCooklangTimers(bodyContent);
	const timerTotal = calculateTotalTime(timers);
	const totalTime = fmTotalTime > 0 ? fmTotalTime : timerTotal;

	if (totalTime && totalTime > 0) {
		const timeSection = container.createDiv({
			cls: "gl-recipe__time",
		});
		sectionTitle(timeSection, "Total Time");
		timeSection.createEl("p", { text: `${totalTime} minutes` });
	}
}

/**
 * Highlight ingredients in the side panel by names used in a step.
 */
export function highlightSideIngredients(
	container: HTMLElement,
	names: string[]
): void {
	const lowerNames = names.map((n) => n.toLowerCase());
	const items = container.querySelectorAll(".gl-recipe__item");
	for (const item of Array.from(items)) {
		const nameEl = item.querySelector("[data-ingredient]") as HTMLElement;
		if (
			nameEl &&
			lowerNames.includes(nameEl.dataset.ingredient || "")
		) {
			item.addClass("gl-recipe__item--highlight");
		} else {
			item.removeClass("gl-recipe__item--highlight");
		}
	}
}

/**
 * Clear all ingredient highlights.
 */
export function clearSideHighlights(container: HTMLElement): void {
	const items = container.querySelectorAll(
		".gl-recipe__item--highlight"
	);
	for (const item of Array.from(items)) {
		item.removeClass("gl-recipe__item--highlight");
	}
}

/**
 * Collect the current state from the side panel inputs.
 */
export function collectSideState(
	container: HTMLElement
): SideState {
	const getField = (field: string): string => {
		const el = container.querySelector(
			`[data-field="${field}"]`
		) as HTMLInputElement | HTMLSelectElement | null;
		return el?.value?.trim() || "";
	};

	// Collect single image from image item
	const imageItem = container.querySelector(".gl-recipe__image-item") as HTMLElement | null;
	const image = imageItem?.dataset.imagePath || "";

	return {
		image,
		cuisine: getField("cuisine"),
		category: getField("category"),
		difficulty: getField("difficulty"),
		servings: getField("servings"),
		prep_time: getField("prep_time"),
		cook_time: getField("cook_time"),
		rating: getField("rating"),
		tags: getField("tags"),
		source: getField("source"),
	};
}

// ── Helpers ──

function addStatCell(parent: HTMLElement, label: string, value: string): void {
	const cell = parent.createDiv({ cls: "gl-recipe__stat-cell" });
	cell.createDiv({ text: label, cls: "gl-recipe__stat-label" });
	cell.createDiv({ text: value, cls: "gl-recipe__stat-value" });
}

function addViewRow(parent: HTMLElement, label: string, value: string): void {
	const row = parent.createDiv({ cls: "gl-recipe__meta-row" });
	row.createSpan({ text: label, cls: "gl-recipe__meta-label" });
	row.createSpan({ text: value });
}

function renderStars(rating: number): string {
	const clamped = Math.max(0, Math.min(5, Math.round(rating)));
	return "\u2605".repeat(clamped) + "\u2606".repeat(5 - clamped);
}

function addEditField(
	parent: HTMLElement,
	label: string,
	field: string,
	value: string,
	onInput: () => void
): void {
	const row = parent.createDiv({ cls: "gl-recipe__meta-row" });
	row.createSpan({ text: label, cls: "gl-recipe__meta-label" });
	const input = row.createEl("input", {
		cls: "gl-recipe__edit-input",
		type: "text",
		value,
	}) as HTMLInputElement;
	input.dataset.field = field;
	input.addEventListener("input", onInput);
}

function addDropdownField(
	parent: HTMLElement,
	label: string,
	field: string,
	options: readonly string[],
	value: string,
	onInput: () => void
): void {
	const row = parent.createDiv({ cls: "gl-recipe__meta-row" });
	row.createSpan({ text: label, cls: "gl-recipe__meta-label" });
	const select = row.createEl("select", {
		cls: "gl-recipe__edit-input dropdown",
	}) as HTMLSelectElement;
	select.dataset.field = field;
	for (const opt of options) {
		const option = select.createEl("option", {
			text: opt || "\u2014",
			value: opt,
		});
		if (opt === value) option.selected = true;
	}
	select.addEventListener("change", onInput);
}

/**
 * Merge duplicate ingredients by name, combining quantities.
 */
function mergeIngredients(items: CooklangIngredient[]): CooklangIngredient[] {
	const map = new Map<string, CooklangIngredient>();
	for (const ing of items) {
		const key = ing.name.toLowerCase();
		if (!map.has(key)) {
			map.set(key, { ...ing });
		}
	}
	return Array.from(map.values());
}

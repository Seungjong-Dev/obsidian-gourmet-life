import { setIcon, type App } from "obsidian";
import type { IngredientFrontmatter, IngredientViewMode } from "./types";
import { INGREDIENT_CATEGORIES, SEASONS } from "./types";
import type { NoteIndex } from "./note-index";
import { showImageLightbox } from "./recipe-main-panel";
import { ImageSuggestModal } from "./image-suggest-modal";
import { renderStarsDom } from "./render-utils";

export interface IngredientSideCallbacks {
	onInput: () => void;
	onNavigateIngredient?: (name: string) => void;
}

export interface IngredientSideState {
	image: string;
	category: string;
	season: string[];
	rating: string;
	aliases: string;
	substitutes: string;
	tags: string;
}

// ── Render ──

export function renderIngredientSidePanel(
	container: HTMLElement,
	fm: IngredientFrontmatter,
	resourcePath: (path: string) => string,
	mode: IngredientViewMode,
	callbacks: IngredientSideCallbacks,
	app?: App,
	notePath?: string,
	noteIndex?: NoteIndex
): void {
	container.empty();

	if (mode === "viewer") {
		renderViewer(container, fm, resourcePath, callbacks, noteIndex);
	} else {
		renderEditor(container, fm, resourcePath, callbacks, app, notePath);
	}

	// Force layout recalculation
	container.style.display = "none";
	void container.offsetHeight;
	container.style.display = "";
}

// ── Viewer ──

function renderViewer(
	container: HTMLElement,
	fm: IngredientFrontmatter,
	resourcePath: (path: string) => string,
	callbacks: IngredientSideCallbacks,
	noteIndex?: NoteIndex
): void {
	// Image
	if (fm.image) {
		const imageWrap = container.createDiv({ cls: "gl-ingredient__image-wrap" });
		const img = imageWrap.createEl("img", { cls: "gl-ingredient__image" });
		img.src = resourcePath(fm.image);
		img.addEventListener("click", () => showImageLightbox(img.src, ""));
	}

	// Info grid
	const infoGrid = container.createDiv({ cls: "gl-ingredient__info-grid" });

	if (fm.category) {
		addInfoRow(infoGrid, "Category", fm.category);
	}

	// Season badges
	if (fm.season && fm.season.length > 0) {
		const row = infoGrid.createDiv({ cls: "gl-ingredient__info-row" });
		row.createSpan({ text: "Season", cls: "gl-ingredient__info-label" });
		const badges = row.createSpan({ cls: "gl-ingredient__season-badges" });
		for (const s of fm.season) {
			badges.createSpan({
				text: s,
				cls: `gl-ingredient__season-badge gl-ingredient__season-badge--${s}`,
			});
		}
	}

	// Rating
	if (fm.rating != null) {
		const ratingRow = infoGrid.createDiv({ cls: "gl-ingredient__info-row" });
		ratingRow.createSpan({ text: "Rating", cls: "gl-ingredient__info-label" });
		const ratingVal = ratingRow.createSpan({ cls: "gl-ingredient__rating" });
		renderStarsDom(ratingVal, fm.rating);
		ratingVal.createSpan({
			text: ` ${fm.rating.toFixed(1)}/5`,
			cls: "gl-ingredient__rating-label",
		});
	}

	// Aliases
	if (fm.aliases && fm.aliases.length > 0) {
		const row = infoGrid.createDiv({ cls: "gl-ingredient__info-row" });
		row.createSpan({ text: "Aliases", cls: "gl-ingredient__info-label" });
		const chips = row.createSpan({ cls: "gl-ingredient__alias-chips" });
		for (const alias of fm.aliases) {
			chips.createSpan({ text: alias, cls: "gl-ingredient__alias-chip" });
		}
	}

	// Substitutes
	if (fm.substitutes && fm.substitutes.length > 0) {
		const row = infoGrid.createDiv({ cls: "gl-ingredient__info-row" });
		row.createSpan({ text: "Substitutes", cls: "gl-ingredient__info-label" });
		const chips = row.createSpan({ cls: "gl-ingredient__substitute-chips" });
		for (const sub of fm.substitutes) {
			const chip = chips.createEl("button", {
				text: sub,
				cls: "gl-ingredient__substitute-chip",
			});
			if (callbacks.onNavigateIngredient) {
				chip.addEventListener("click", () => callbacks.onNavigateIngredient!(sub));
			}
		}
	}

	// Tags
	if (fm.tags && fm.tags.length > 0) {
		const tagsRow = infoGrid.createDiv({ cls: "gl-ingredient__info-row" });
		tagsRow.createSpan({ text: "Tags", cls: "gl-ingredient__info-label" });
		const tagsWrap = tagsRow.createSpan();
		for (const tag of fm.tags) {
			tagsWrap.createSpan({ text: tag, cls: "gl-ingredient__tag-chip" });
		}
	}

	// Used in recipes count
	if (noteIndex) {
		const recipes = noteIndex.getRecipesUsingIngredient(fm.aliases?.[0] || "");
		// Also try the note name — we'll get the name from the calling context
		// For now, show recipe count from substitutes/aliases perspective
	}
}

// ── Editor ──

function renderEditor(
	container: HTMLElement,
	fm: IngredientFrontmatter,
	resourcePath: (path: string) => string,
	callbacks: IngredientSideCallbacks,
	app?: App,
	notePath?: string
): void {
	// Image editor
	const imageSection = container.createDiv({ cls: "gl-ingredient__image-edit" });
	let currentImage = fm.image || "";

	const renderImageEditor = () => {
		imageSection.empty();
		if (currentImage) {
			const item = imageSection.createDiv({ cls: "gl-recipe__image-item" });
			item.dataset.imagePath = currentImage;
			const preview = item.createEl("img", {
				cls: "gl-recipe__image gl-recipe__image--thumb",
			});
			preview.src = resourcePath(currentImage);
			item.createSpan({ cls: "gl-recipe__image-path", text: currentImage });
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
		const addBtn = imageSection.createEl("button", {
			cls: "gl-recipe__add-btn",
			text: btnText,
		});
		addBtn.addEventListener("click", () => {
			if (app) {
				new ImageSuggestModal(app, (file) => {
					currentImage = file.name;
					renderImageEditor();
					callbacks.onInput();
				}, notePath).open();
			}
		});
	};
	renderImageEditor();

	// Metadata fields
	const metaSection = container.createDiv({ cls: "gl-ingredient__meta-edit" });

	// Category dropdown
	addDropdownField(metaSection, "Category", "category", ["", ...INGREDIENT_CATEGORIES], fm.category || "", callbacks.onInput);

	// Season checkboxes
	const seasonRow = metaSection.createDiv({ cls: "gl-recipe__meta-row" });
	seasonRow.createSpan({ text: "Season", cls: "gl-recipe__meta-label" });
	const seasonWrap = seasonRow.createDiv({ cls: "gl-ingredient__season-checkboxes" });
	const selectedSeasons = new Set(fm.season || []);
	for (const season of SEASONS) {
		const label = seasonWrap.createEl("label", { cls: "gl-ingredient__season-checkbox-label" });
		const checkbox = label.createEl("input", { type: "checkbox" }) as HTMLInputElement;
		checkbox.checked = selectedSeasons.has(season);
		checkbox.dataset.season = season;
		label.appendText(` ${season}`);
		checkbox.addEventListener("change", () => callbacks.onInput());
	}

	addEditField(metaSection, "Rating (1-5)", "rating", fm.rating != null ? String(fm.rating) : "", callbacks.onInput);
	addEditField(metaSection, "Aliases (comma-separated)", "aliases", fm.aliases ? fm.aliases.join(", ") : "", callbacks.onInput);
	addEditField(metaSection, "Substitutes (comma-separated)", "substitutes", fm.substitutes ? fm.substitutes.join(", ") : "", callbacks.onInput);
	addEditField(metaSection, "Tags (comma-separated)", "tags", fm.tags ? fm.tags.join(", ") : "", callbacks.onInput);
}

// ── Collect State ──

export function collectIngredientSideState(container: HTMLElement): IngredientSideState {
	const getField = (field: string): string => {
		const el = container.querySelector(`[data-field="${field}"]`) as HTMLInputElement | HTMLSelectElement | null;
		return el?.value?.trim() || "";
	};

	const imageItem = container.querySelector(".gl-recipe__image-item") as HTMLElement | null;
	const image = imageItem?.dataset.imagePath || "";

	// Collect checked seasons
	const seasonCheckboxes = container.querySelectorAll('[data-season]');
	const season: string[] = [];
	for (let i = 0; i < seasonCheckboxes.length; i++) {
		const cb = seasonCheckboxes[i] as HTMLInputElement;
		if (cb.checked && cb.dataset.season) season.push(cb.dataset.season);
	}

	return {
		image,
		category: getField("category"),
		season,
		rating: getField("rating"),
		aliases: getField("aliases"),
		substitutes: getField("substitutes"),
		tags: getField("tags"),
	};
}

// ── Helpers ──

function addInfoRow(parent: HTMLElement, label: string, value: string): void {
	const row = parent.createDiv({ cls: "gl-ingredient__info-row" });
	row.createSpan({ text: label, cls: "gl-ingredient__info-label" });
	row.createSpan({ text: value });
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

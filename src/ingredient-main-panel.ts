import { MarkdownRenderer, setIcon, type App, type Component } from "obsidian";
import type { IngredientViewMode, GourmetNote, RecipeFrontmatter } from "./types";
import { parseIngredientSections, type IngredientSections } from "./ingredient-parser";
import { createImageSuggest, type TextareaSuggest } from "./textarea-suggest";
import { attachIndentHandler } from "./textarea-indent";
import { renderStarsDom } from "./render-utils";
import type { NoteIndex } from "./note-index";
import type { TFile } from "obsidian";

export interface IngredientMainCallbacks {
	onViewSource: () => void;
	onToggleMode: () => void;
	onTitleChange: (newTitle: string) => void;
	onStoragePrepInput: () => void;
	onNotesInput: () => void;
	onPurchaseLogInput: () => void;
	onDelete?: () => void;
	onRecipeClick?: (path: string) => void;
}

export interface IngredientMainState {
	storagePrep: string;
	notes: string;
	purchaseLog: string;
}

// ── Title Row ──

export function renderIngredientTitleRow(
	titleRow: HTMLElement,
	title: string,
	mode: IngredientViewMode,
	callbacks: IngredientMainCallbacks
): void {
	titleRow.empty();

	if (mode === "editor") {
		const titleInput = titleRow.createEl("input", {
			cls: "gl-recipe__title-input",
			type: "text",
			value: title,
		}) as HTMLInputElement;
		const commitTitle = () => {
			const newTitle = titleInput.value.trim();
			if (newTitle && newTitle !== title) {
				callbacks.onTitleChange(newTitle);
			}
		};
		titleInput.addEventListener("change", commitTitle);
		titleInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				titleInput.blur();
			}
		});
	} else {
		titleRow.createEl("h1", { text: title, cls: "gl-recipe__title" });
	}

	const btnGroup = titleRow.createDiv({ cls: "gl-recipe__title-btns" });

	const toggleBtn = btnGroup.createEl("button", { cls: "gl-recipe__mode-toggle" });
	toggleBtn.title = mode === "viewer" ? "Edit" : "View";
	setIcon(toggleBtn, mode === "viewer" ? "pencil" : "eye");
	toggleBtn.addEventListener("click", callbacks.onToggleMode);

	if (callbacks.onDelete) {
		const deleteBtn = btnGroup.createEl("button", { cls: "gl-recipe__delete-btn" });
		deleteBtn.title = "Delete";
		setIcon(deleteBtn, "trash-2");
		deleteBtn.addEventListener("click", callbacks.onDelete);
	}

	const viewSourceBtn = btnGroup.createEl("button", {
		text: "</>",
		cls: "gl-recipe__view-source",
	});
	viewSourceBtn.title = "View Source";
	viewSourceBtn.addEventListener("click", callbacks.onViewSource);
}

// ── Main Panel ──

export function renderIngredientMainPanel(
	container: HTMLElement,
	bodyContent: string,
	mode: IngredientViewMode,
	callbacks: IngredientMainCallbacks,
	app?: App,
	notePath?: string,
	component?: Component,
	noteIndex?: NoteIndex,
	ingredientName?: string
): void {
	// Cleanup previous suggests
	const prev = (container as any).__glSuggests as TextareaSuggest<unknown>[] | undefined;
	if (prev) {
		for (const s of prev) s.destroy();
		(container as any).__glSuggests = null;
	}

	container.empty();

	const sections = parseIngredientSections(bodyContent);

	if (mode === "viewer") {
		renderViewer(container, sections, app, notePath, component, noteIndex, ingredientName, callbacks);
	} else {
		renderEditor(container, sections, callbacks, app, notePath);
	}
}

// ── Viewer ──

function renderViewer(
	container: HTMLElement,
	sections: IngredientSections,
	app?: App,
	notePath?: string,
	component?: Component,
	noteIndex?: NoteIndex,
	ingredientName?: string,
	callbacks?: IngredientMainCallbacks
): void {
	// Storage & Prep
	if (sections.storagePrep.trim()) {
		const section = container.createDiv();
		section.createEl("h2", { text: "Storage & Prep" });
		if (app && notePath && component) {
			const md = section.createDiv({ cls: "gl-markdown" });
			MarkdownRenderer.render(app, sections.storagePrep, md, notePath, component);
		} else {
			for (const line of sections.storagePrep.split("\n")) {
				if (line.trim()) section.createEl("p", { text: line.trim() });
			}
		}
	}

	// Notes
	if (sections.notes.trim()) {
		const section = container.createDiv();
		section.createEl("h2", { text: "Notes" });
		if (app && notePath && component) {
			const md = section.createDiv({ cls: "gl-markdown" });
			MarkdownRenderer.render(app, sections.notes, md, notePath, component);
		} else {
			for (const line of sections.notes.split("\n")) {
				if (line.trim()) section.createEl("p", { text: line.trim() });
			}
		}
	}

	// Purchase Log
	if (sections.purchaseLog.trim()) {
		const section = container.createDiv();
		section.createEl("h2", { text: "Purchase Log" });
		renderPurchaseLog(section, sections.purchaseLog);
	}

	// Recipes using this ingredient
	if (noteIndex && ingredientName) {
		const recipes = noteIndex.getRecipesUsingIngredient(ingredientName);
		if (recipes.length > 0) {
			renderRecipeList(container, recipes, callbacks);
		}
	}
}

function renderPurchaseLog(container: HTMLElement, text: string): void {
	const lines = text.split("\n");
	let currentEntry: HTMLElement | null = null;

	for (const line of lines) {
		const h3Match = line.match(/^###\s+(.+)/);
		if (h3Match) {
			currentEntry = container.createDiv({ cls: "gl-ingredient__purchase-entry" });
			currentEntry.createDiv({
				text: h3Match[1],
				cls: "gl-ingredient__purchase-date",
			});
			continue;
		}
		if (currentEntry && line.trim()) {
			currentEntry.createDiv({
				text: line.trim(),
				cls: "gl-ingredient__purchase-detail",
			});
		}
	}
}

function renderRecipeList(
	container: HTMLElement,
	recipes: GourmetNote[],
	callbacks?: IngredientMainCallbacks
): void {
	const section = container.createDiv({ cls: "gl-ingredient__recipe-list" });
	section.createEl("h2", { text: `Used in ${recipes.length} recipe${recipes.length === 1 ? "" : "s"}` });

	const list = section.createDiv({ cls: "gl-ingredient__recipe-items" });
	for (const recipe of recipes) {
		const item = list.createDiv({ cls: "gl-ingredient__recipe-item" });
		const nameEl = item.createSpan({ text: recipe.name, cls: "gl-ingredient__recipe-name" });
		const fm = recipe.frontmatter as RecipeFrontmatter;
		if (fm.rating) {
			const ratingSpan = item.createSpan({ cls: "gl-ingredient__recipe-rating" });
			renderStarsDom(ratingSpan, fm.rating);
		}
		if (callbacks?.onRecipeClick) {
			item.addClass("gl-ingredient__recipe-item--clickable");
			item.addEventListener("click", () => callbacks.onRecipeClick!(recipe.path));
		}
	}
}

// ── Editor ──

function renderEditor(
	container: HTMLElement,
	sections: IngredientSections,
	callbacks: IngredientMainCallbacks,
	app?: App,
	notePath?: string
): void {
	const suggests: TextareaSuggest<TFile>[] = [];

	// Storage & Prep
	const storagePrepSection = container.createDiv();
	storagePrepSection.createEl("h2", { text: "Storage & Prep" });
	const storagePrepArea = storagePrepSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	storagePrepArea.dataset.field = "storage-prep";
	storagePrepArea.value = sections.storagePrep;
	storagePrepArea.placeholder = "Storage tips, preparation methods, selection guide...";
	storagePrepArea.addEventListener("input", () => callbacks.onStoragePrepInput());
	if (app) {
		suggests.push(createImageSuggest(storagePrepArea, () => app.vault.getFiles(), notePath));
	}

	// Notes
	const notesSection = container.createDiv();
	notesSection.createEl("h2", { text: "Notes" });
	const notesArea = notesSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	notesArea.dataset.field = "notes";
	notesArea.value = sections.notes;
	notesArea.placeholder = "Personal notes, cooking tips, pairings...";
	notesArea.addEventListener("input", () => callbacks.onNotesInput());
	if (app) {
		suggests.push(createImageSuggest(notesArea, () => app.vault.getFiles(), notePath));
	}

	// Purchase Log
	const purchaseSection = container.createDiv();
	purchaseSection.createEl("h2", { text: "Purchase Log" });
	const purchaseArea = purchaseSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea gl-recipe__edit-textarea--full",
	}) as HTMLTextAreaElement;
	purchaseArea.dataset.field = "purchase-log";
	purchaseArea.value = sections.purchaseLog;
	purchaseArea.placeholder = "### 2026-01-15\nStore name, price, notes...";
	purchaseArea.addEventListener("input", () => callbacks.onPurchaseLogInput());
	if (app) {
		suggests.push(createImageSuggest(purchaseArea, () => app.vault.getFiles(), notePath));
	}

	// Attach indent handlers
	for (const ta of [storagePrepArea, notesArea, purchaseArea]) {
		const detach = attachIndentHandler(ta);
		suggests.push({ destroy: detach } as any);
	}

	(container as any).__glSuggests = suggests;
}

// ── Collect State ──

export function collectIngredientMainState(container: HTMLElement): IngredientMainState {
	const getField = (field: string): string => {
		const ta = container.querySelector(`[data-field="${field}"]`) as HTMLTextAreaElement | null;
		return ta?.value ?? "";
	};

	return {
		storagePrep: getField("storage-prep").trim(),
		notes: getField("notes").trim(),
		purchaseLog: getField("purchase-log").trim(),
	};
}

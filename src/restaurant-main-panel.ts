import { setIcon, type App } from "obsidian";
import type { RestaurantViewMode } from "./types";
import {
	parseRestaurantSections,
	parseRestaurantVisits,
	parseMenuHighlights,
	computeVisitRating,
	type RestaurantVisit,
	type RestaurantMenuItem,
} from "./restaurant-parser";

export interface RestaurantMainCallbacks {
	onViewSource: () => void;
	onToggleMode: () => void;
	onTitleChange: (newTitle: string) => void;
	onMenuInput: () => void;
	onNotesInput: () => void;
	onReviewsInput: () => void;
}

export interface RestaurantMainState {
	menuHighlights: string;
	notes: string;
	reviews: string;
}

// ── Title Row ──

export function renderRestaurantTitleRow(
	titleRow: HTMLElement,
	title: string,
	mode: RestaurantViewMode,
	callbacks: RestaurantMainCallbacks
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

	const viewSourceBtn = btnGroup.createEl("button", {
		text: "</>",
		cls: "gl-recipe__view-source",
	});
	viewSourceBtn.title = "View Source";
	viewSourceBtn.addEventListener("click", callbacks.onViewSource);
}

// ── Main Panel ──

export function renderRestaurantMainPanel(
	container: HTMLElement,
	bodyContent: string,
	mode: RestaurantViewMode,
	callbacks: RestaurantMainCallbacks
): void {
	container.empty();

	const sections = parseRestaurantSections(bodyContent);

	if (mode === "viewer") {
		renderViewer(container, sections);
	} else {
		renderEditor(container, sections, callbacks);
	}
}

// ── Viewer ──

function renderViewer(
	container: HTMLElement,
	sections: { menuHighlights: string; notes: string; reviews: string }
): void {
	// Menu Highlights
	if (sections.menuHighlights.trim()) {
		const menuSection = container.createDiv();
		menuSection.createEl("h2", { text: "Menu Highlights" });
		const items = parseMenuHighlights(sections.menuHighlights);
		const list = menuSection.createDiv({ cls: "gl-restaurant__menu-list" });
		for (const item of items) {
			const el = list.createDiv({ cls: "gl-restaurant__menu-item" });
			el.createSpan({ text: item.name, cls: "gl-restaurant__menu-name" });
			if (item.description) {
				el.createSpan({ text: ` — ${item.description}`, cls: "gl-restaurant__menu-desc" });
			}
		}
	}

	// Notes
	if (sections.notes.trim()) {
		const notesSection = container.createDiv();
		notesSection.createEl("h2", { text: "Notes" });
		for (const line of sections.notes.split("\n")) {
			if (line.trim()) {
				notesSection.createEl("p", { text: line.trim() });
			}
		}
	}

	// Reviews
	if (sections.reviews.trim()) {
		const reviewsSection = container.createDiv();
		reviewsSection.createEl("h2", { text: "Reviews" });
		const visits = parseRestaurantVisits(sections.reviews);
		renderVisitCards(reviewsSection, visits);
	}
}

// ── Visit Cards ──

function renderVisitCards(container: HTMLElement, visits: RestaurantVisit[]): void {
	// Sort by date descending
	const sorted = [...visits].sort((a, b) => {
		if (!a.date && !b.date) return 0;
		if (!a.date) return 1;
		if (!b.date) return -1;
		return b.date.localeCompare(a.date);
	});

	const timeline = container.createDiv({ cls: "gl-restaurant__review-timeline" });

	for (const visit of sorted) {
		const card = timeline.createDiv({ cls: "gl-restaurant__review-card" });

		// Header: date + visit rating
		const header = card.createDiv({ cls: "gl-restaurant__review-header" });
		if (visit.date) {
			header.createSpan({ text: visit.date, cls: "gl-restaurant__review-date" });
		}
		const visitRating = computeVisitRating(visit);
		if (visitRating != null) {
			const ratingEl = header.createSpan({ cls: "gl-restaurant__review-rating" });
			const stars = Math.max(0, Math.min(5, Math.round(visitRating)));
			ratingEl.createSpan({ text: "\u2605".repeat(stars) + "\u2606".repeat(5 - stars) });
			ratingEl.createSpan({
				text: ` ${visitRating.toFixed(1)}`,
				cls: "gl-restaurant__review-rating-num",
			});
		}

		// Dish reviews
		for (const dish of visit.dishReviews) {
			const dishEl = card.createDiv({ cls: "gl-restaurant__dish-review" });
			dishEl.createSpan({ text: dish.name, cls: "gl-restaurant__dish-chip" });
			if (dish.rating != null) {
				const stars = "\u2605".repeat(dish.rating);
				dishEl.createSpan({ text: ` ${stars}`, cls: "gl-restaurant__dish-stars" });
			}
			if (dish.comment) {
				dishEl.createSpan({
					text: ` — ${dish.comment}`,
					cls: "gl-restaurant__dish-comment",
				});
			}
		}

		// General comments
		for (const comment of visit.generalComments) {
			card.createDiv({
				text: comment,
				cls: "gl-restaurant__general-comment",
			});
		}
	}
}

// ── Editor ──

function renderEditor(
	container: HTMLElement,
	sections: { menuHighlights: string; notes: string; reviews: string },
	callbacks: RestaurantMainCallbacks
): void {
	// Menu Highlights
	const menuSection = container.createDiv();
	menuSection.createEl("h2", { text: "Menu Highlights" });
	const menuArea = menuSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	menuArea.dataset.field = "menu-highlights";
	menuArea.value = sections.menuHighlights;
	menuArea.placeholder = "- Menu item — Description";
	menuArea.addEventListener("input", () => callbacks.onMenuInput());

	// Notes
	const notesSection = container.createDiv();
	notesSection.createEl("h2", { text: "Notes" });
	const notesArea = notesSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	notesArea.dataset.field = "notes";
	notesArea.value = sections.notes;
	notesArea.addEventListener("input", () => callbacks.onNotesInput());

	// Reviews
	const reviewsSection = container.createDiv();
	reviewsSection.createEl("h2", { text: "Reviews" });

	const today = new Date().toISOString().split("T")[0];
	const addVisitBtn = reviewsSection.createEl("button", {
		text: "+ New visit",
		cls: "gl-recipe__add-btn",
	});

	const reviewsArea = reviewsSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea gl-recipe__edit-textarea--full",
	}) as HTMLTextAreaElement;
	reviewsArea.dataset.field = "reviews";
	reviewsArea.value = sections.reviews;
	reviewsArea.placeholder = "- 2026-03-05\n  - Menu item #rate/4 — Comment";
	reviewsArea.addEventListener("input", () => callbacks.onReviewsInput());

	addVisitBtn.addEventListener("click", () => {
		const prefix = reviewsArea.value.trim() ? "\n" : "";
		reviewsArea.value += `${prefix}- ${today}\n  - `;
		reviewsArea.focus();
		reviewsArea.selectionStart = reviewsArea.value.length;
		reviewsArea.selectionEnd = reviewsArea.value.length;
		reviewsArea.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

// ── Collect State ──

export function collectRestaurantMainState(container: HTMLElement): RestaurantMainState {
	const getField = (field: string): string => {
		const ta = container.querySelector(`[data-field="${field}"]`) as HTMLTextAreaElement | null;
		return ta?.value ?? "";
	};

	return {
		menuHighlights: getField("menu-highlights").trim(),
		notes: getField("notes").trim(),
		reviews: getField("reviews").trim(),
	};
}

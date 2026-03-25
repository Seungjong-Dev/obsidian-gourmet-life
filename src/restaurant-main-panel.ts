import { MarkdownRenderer, Menu, setIcon, type App, type Component, type TFile } from "obsidian";
import type { RestaurantViewMode } from "./types";
import { EMBED_RE, IMAGE_EXTS } from "./constants";
import {
	parseRestaurantSections,
	parseRestaurantVisits,
	parseMenuHighlights,
	computeVisitRating,
	type RestaurantVisit,
	type RestaurantMenuItem,
} from "./restaurant-parser";
import { createImageSuggest, type TextareaSuggest } from "./textarea-suggest";
import { attachIndentHandler } from "./textarea-indent";
import { renderStarsDom } from "./render-utils";
import { showImageLightbox, type GalleryInfo } from "./recipe-main-panel";
import { ReviewModal } from "./review-modal";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { extractRestaurantVisitPrefill, replaceReviewInFile, deleteReviewInFile } from "./review-utils";
import { isGalleryCalloutMarker, transformGalleryCallouts, isImageOnlyLine } from "./gallery-utils";

export interface RestaurantMainCallbacks {
	onViewSource: () => void;
	onToggleMode: () => void;
	onTitleChange: (newTitle: string) => void;
	onMenuInput: () => void;
	onNotesInput: () => void;
	onReviewsInput: () => void;
	onDelete?: () => void;
	onAddReview?: () => void;
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

	if (mode === "viewer" && callbacks.onAddReview) {
		const addReviewBtn = btnGroup.createEl("button", { cls: "gl-review-add-btn" });
		addReviewBtn.title = "Add review";
		setIcon(addReviewBtn, "message-square-plus");
		addReviewBtn.addEventListener("click", () => callbacks.onAddReview?.());
	}

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

export function renderRestaurantMainPanel(
	container: HTMLElement,
	bodyContent: string,
	mode: RestaurantViewMode,
	callbacks: RestaurantMainCallbacks,
	app?: App,
	notePath?: string,
	component?: Component,
	file?: TFile,
	onReviewChanged?: () => void,
	mediaFolder?: string
): void {
	// Cleanup previous image suggests
	const prev = (container as any).__glSuggests as TextareaSuggest<unknown>[] | undefined;
	if (prev) {
		for (const s of prev) s.destroy();
		(container as any).__glSuggests = null;
	}

	container.empty();

	const sections = parseRestaurantSections(bodyContent);

	if (mode === "viewer") {
		renderViewer(container, sections, callbacks, app, notePath, component, file, onReviewChanged, mediaFolder);
	} else {
		renderEditor(container, sections, callbacks, app, notePath);
	}
}

// ── Viewer ──

function renderViewer(
	container: HTMLElement,
	sections: { menuHighlights: string; notes: string; reviews: string },
	callbacks: RestaurantMainCallbacks,
	app?: App,
	notePath?: string,
	component?: Component,
	file?: TFile,
	onReviewChanged?: () => void,
	mediaFolder?: string
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
		if (app && notePath && component) {
			const md = notesSection.createDiv({ cls: "gl-markdown" });
			MarkdownRenderer.render(app, sections.notes, md, notePath, component).then(() => {
				transformGalleryCallouts(md);
			});
		} else {
			for (const line of sections.notes.split("\n")) {
				if (line.trim()) {
					notesSection.createEl("p", { text: line.trim() });
				}
			}
		}
	}

	// Reviews
	if (sections.reviews.trim() || (app && file && onReviewChanged)) {
		const reviewsSection = container.createDiv();
		reviewsSection.createEl("h2", { text: "Reviews" });
		const visits = sections.reviews.trim() ? parseRestaurantVisits(sections.reviews) : [];
		renderVisitCards(reviewsSection, visits, app, notePath, component, file, onReviewChanged, mediaFolder);
	}
}

// ── Visit Cards ──

function renderVisitCards(container: HTMLElement, visits: RestaurantVisit[], app?: App, notePath?: string, component?: Component, file?: TFile, onReviewChanged?: () => void, mediaFolder?: string): void {
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
			renderStarsDom(ratingEl, visitRating);
			ratingEl.createSpan({
				text: ` ${visitRating.toFixed(1)}`,
				cls: "gl-restaurant__review-rating-num",
			});
		}

		// Kebab menu
		if (app && file && onReviewChanged) {
			const menuBtn = header.createEl("button", { cls: "gl-review-card__menu-btn" });
			setIcon(menuBtn, "more-horizontal");
			menuBtn.addEventListener("click", (e) => {
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle("Edit").setIcon("pencil").onClick(() => {
						const prefill = extractRestaurantVisitPrefill(visit);
						new ReviewModal(app, "restaurant", file, onReviewChanged, prefill, async (newMd) => {
							await replaceReviewInFile(app, file, visit.rawText, newMd);
						}, mediaFolder).open();
					});
				});
				menu.addItem((item) => {
					item.setTitle("Delete").setIcon("trash-2").onClick(() => {
						new ConfirmDeleteModal(app, `visit from ${visit.date || "unknown date"}`, async (confirmed) => {
							if (!confirmed) return;
							await deleteReviewInFile(app, file, visit.rawText);
							onReviewChanged();
						}).open();
					});
				});
				menu.showAtMouseEvent(e as MouseEvent);
			});
		}

		// Dish reviews
		for (const dish of visit.dishReviews) {
			const dishEl = card.createDiv({ cls: "gl-restaurant__dish-review" });
			dishEl.createSpan({ text: dish.name, cls: "gl-restaurant__dish-chip" });
			if (dish.rating != null) {
				const dishStarsEl = dishEl.createSpan({ cls: "gl-restaurant__dish-stars" });
				renderStarsDom(dishStarsEl, dish.rating);
			}
			if (dish.comment) {
				dishEl.createSpan({
					text: ` — ${dish.comment}`,
					cls: "gl-restaurant__dish-comment",
				});
			}
		}

		// General comments — preprocess for gallery callout blocks, then group images
		const processedComments = preprocessGalleryComments(visit.generalComments);
		let pendingImageComments: string[] = [];

		const flushImageGallery = () => {
			if (pendingImageComments.length === 0) return;
			const galleryMd = pendingImageComments.join("\n");
			pendingImageComments = [];
			if (app && notePath && component) {
				const gallery = card.createDiv({ cls: "gl-gallery" });
				MarkdownRenderer.render(app, galleryMd, gallery, notePath, component).then(() => {
					attachLightboxHandlers(gallery);
				});
			} else {
				card.createDiv({ text: galleryMd, cls: "gl-restaurant__general-comment" });
			}
		};

		for (const item of processedComments) {
			if (typeof item !== "string") {
				// Gallery group — render as .gl-gallery
				flushImageGallery();
				if (app && notePath && component) {
					const gallery = card.createDiv({ cls: "gl-gallery" });
					const galleryMd = item.galleryImages.join("\n");
					MarkdownRenderer.render(app, galleryMd, gallery, notePath, component).then(() => {
						attachLightboxHandlers(gallery);
					});
				} else {
					card.createDiv({ text: item.galleryImages.join(" "), cls: "gl-restaurant__general-comment" });
				}
			} else if (isImageOnlyComment(item)) {
				pendingImageComments.push(item);
			} else {
				flushImageGallery();
				if (app && notePath && component) {
					const commentEl = card.createDiv({ cls: "gl-restaurant__general-comment gl-markdown" });
					MarkdownRenderer.render(app, item, commentEl, notePath, component).then(() => {
						attachLightboxHandlers(commentEl);
					});
				} else {
					card.createDiv({
						text: item,
						cls: "gl-restaurant__general-comment",
					});
				}
			}
		}
		flushImageGallery();
	}

	// Add review prompt at the bottom of timeline
	if (app && file && onReviewChanged) {
		const addCard = timeline.createDiv({ cls: "gl-restaurant__review-card gl-review-card--add" });
		addCard.createSpan({ text: "Write a new review...", cls: "gl-review-card--add__text" });
		addCard.addEventListener("click", () => {
			new ReviewModal(app, "restaurant", file, onReviewChanged, undefined, undefined, mediaFolder).open();
		});
	}
}

// ── Gallery Comment Preprocessing ──

/**
 * Preprocess generalComments to detect `> [!gallery]` markers and group
 * following `> ![[img]]` lines into gallery groups.
 */
function preprocessGalleryComments(
	comments: string[]
): (string | { galleryImages: string[] })[] {
	const result: (string | { galleryImages: string[] })[] = [];
	let galleryImages: string[] | null = null;

	const flushGallery = () => {
		if (galleryImages && galleryImages.length > 0) {
			result.push({ galleryImages });
		}
		galleryImages = null;
	};

	for (const comment of comments) {
		// Strip `> ` prefix if present for marker detection
		const stripped = comment.replace(/^>\s*/, "");

		if (isGalleryCalloutMarker(stripped)) {
			flushGallery();
			galleryImages = [];
			continue;
		}

		if (galleryImages !== null && isImageOnlyLine(comment)) {
			// Strip `> ` prefix for the image embed line
			galleryImages.push(stripped);
			continue;
		}

		// Non-image line breaks out of gallery mode
		flushGallery();
		result.push(comment);
	}
	flushGallery();
	return result;
}

// ── Image Helpers ──

/** Returns true if the comment text contains only image embeds (and whitespace) */
function isImageOnlyComment(text: string): boolean {
	const re = new RegExp(EMBED_RE.source, EMBED_RE.flags);
	const stripped = text.replace(re, "").trim();
	if (stripped !== "") return false;
	let hasImage = false;
	for (const match of text.matchAll(new RegExp(EMBED_RE.source, EMBED_RE.flags))) {
		const ext = match[1].split(".").pop()?.toLowerCase() ?? "";
		if (!IMAGE_EXTS.includes(ext)) return false;
		hasImage = true;
	}
	return hasImage;
}

/** Attach lightbox click handlers to all img elements in a container */
function attachLightboxHandlers(container: HTMLElement): void {
	const imgs = Array.from(container.querySelectorAll("img"));
	const srcs = imgs.map((i) => i.src);
	const alts = imgs.map((i) => i.alt);
	const gallery: GalleryInfo | undefined =
		imgs.length > 1 ? { srcs, alts, index: 0 } : undefined;

	for (let i = 0; i < imgs.length; i++) {
		const img = imgs[i];
		img.style.cursor = "zoom-in";
		const idx = i;
		img.addEventListener("click", (e) => {
			e.stopPropagation();
			showImageLightbox(
				img.src,
				img.alt,
				gallery ? { ...gallery, index: idx } : undefined
			);
		});
	}
}

// ── Editor ──

function renderEditor(
	container: HTMLElement,
	sections: { menuHighlights: string; notes: string; reviews: string },
	callbacks: RestaurantMainCallbacks,
	app?: App,
	notePath?: string
): void {
	const suggests: TextareaSuggest<TFile>[] = [];

	// Menu Highlights
	const menuSection = container.createDiv();
	menuSection.createEl("h2", { text: "Menu Highlights" });
	const menuArea = menuSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	menuArea.dataset.field = "menu-highlights";
	menuArea.value = sections.menuHighlights;
	menuArea.placeholder = "- Menu item -- Description";
	menuArea.addEventListener("input", () => callbacks.onMenuInput());
	if (app) {
		suggests.push(createImageSuggest(menuArea, () => app.vault.getFiles(), notePath));
	}

	// Notes
	const notesSection = container.createDiv();
	notesSection.createEl("h2", { text: "Notes" });
	const notesArea = notesSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	notesArea.dataset.field = "notes";
	notesArea.value = sections.notes;
	notesArea.addEventListener("input", () => callbacks.onNotesInput());
	if (app) {
		suggests.push(createImageSuggest(notesArea, () => app.vault.getFiles(), notePath));
	}

	// Reviews
	const reviewsSection = container.createDiv();
	reviewsSection.createEl("h2", { text: "Reviews" });

	const reviewsArea = reviewsSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea gl-recipe__edit-textarea--full",
	}) as HTMLTextAreaElement;
	reviewsArea.dataset.field = "reviews";
	reviewsArea.value = sections.reviews;
	reviewsArea.placeholder = "- 2026-03-05\n  - Menu item #rate/4 -- Comment";
	reviewsArea.addEventListener("input", () => callbacks.onReviewsInput());
	if (app) {
		suggests.push(createImageSuggest(reviewsArea, () => app.vault.getFiles(), notePath));
	}

	// Attach indent handlers and store for cleanup
	for (const ta of [menuArea, notesArea, reviewsArea]) {
		const detach = attachIndentHandler(ta);
		suggests.push({ destroy: detach } as any);
	}

	// Store suggests for cleanup on re-render
	(container as any).__glSuggests = suggests;
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

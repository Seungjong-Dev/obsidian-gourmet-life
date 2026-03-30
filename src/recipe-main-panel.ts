import { MarkdownRenderer, Menu, setIcon, type App, type Component } from "obsidian";
import type { RecipeViewMode } from "./types";
import { SECTION_HEADING_RE, RECIPE_END_SECTIONS, EMBED_RE, IMAGE_EXTS } from "./constants";
import {
	parseCooklangBody,
	parseNotesSection,
	parseReviewsSection,
	type CooklangSegment,
	type CooklangStep,
} from "./cooklang-parser";
import { createImageSuggest, type TextareaSuggest } from "./textarea-suggest";
import { isGalleryCalloutMarker, transformGalleryCallouts } from "./gallery-utils";
import { attachIndentHandler } from "./textarea-indent";
import { ReviewModal } from "./review-modal";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { extractRecipeReviewPrefill, replaceReviewInFile, deleteReviewInFile } from "./review-utils";
import type { TFile } from "obsidian";

export interface MainPanelCallbacks {
	onStepHover: (ingredientNames: string[]) => void;
	onIngredientChipClick: (name: string) => void;
	onBodyInput: (newBodyContent: string) => void;
	onNotesInput: () => void;
	onReviewsInput: () => void;
	onViewSource: () => void;
	onToggleMode: () => void;
	onTitleChange: (newTitle: string) => void;
	onShareCard?: () => void;
	onDelete?: () => void;
	onAddReview?: () => void;
}

export interface MainState {
	body: string;
	notes: string;
	reviews: string;
}

/**
 * Render the title row into the given container.
 */
export function renderTitleRow(
	titleRow: HTMLElement,
	title: string,
	mode: RecipeViewMode,
	callbacks: MainPanelCallbacks
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

	const toggleBtn = btnGroup.createEl("button", {
		cls: "gl-recipe__mode-toggle",
	});
	toggleBtn.title = mode === "viewer" ? "Edit" : "View";
	setIcon(toggleBtn, mode === "viewer" ? "pencil" : "eye");
	toggleBtn.addEventListener("click", callbacks.onToggleMode);

	if (mode === "viewer" && callbacks.onShareCard) {
		const shareBtn = btnGroup.createEl("button", { cls: "gl-recipe__share-btn" });
		shareBtn.title = "Share as image";
		setIcon(shareBtn, "share-2");
		shareBtn.addEventListener("click", callbacks.onShareCard);
	}

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

/**
 * Render the main panel in viewer or editor mode.
 */
export function renderMainPanel(
	container: HTMLElement,
	bodyContent: string,
	source: string | undefined,
	mode: RecipeViewMode,
	callbacks: MainPanelCallbacks,
	app?: App,
	recipePath?: string,
	resourcePath?: (path: string) => string,
	component?: Component,
	file?: TFile,
	onReviewChanged?: () => void,
	mediaFolder?: string
): void {
	// Clean up previous TextareaSuggest instances
	const prev = (container as any).__glSuggests as TextareaSuggest<unknown>[] | undefined;
	if (prev) {
		for (const s of prev) s.destroy();
		(container as any).__glSuggests = null;
	}

	container.empty();

	if (mode === "viewer") {
		renderMainPanelViewer(container, bodyContent, source, callbacks, resourcePath, app, recipePath, component, file, onReviewChanged, mediaFolder);
	} else {
		renderMainPanelEditor(container, bodyContent, source, callbacks, app, recipePath);
	}
}

/**
 * Viewer mode: rendered preview with chips and hover interactions.
 */
function renderMainPanelViewer(
	container: HTMLElement,
	bodyContent: string,
	source: string | undefined,
	callbacks: MainPanelCallbacks,
	resourcePath?: (path: string) => string,
	app?: App,
	recipePath?: string,
	component?: Component,
	file?: TFile,
	onReviewChanged?: () => void,
	mediaFolder?: string
): void {
	// Recipe section — rendered chips
	const bodySection = container.createDiv({ cls: "gl-recipe__steps" });
	bodySection.createEl("h2", { text: "Recipe" });
	renderPreviewContent(bodySection, getRecipeEditableContent(bodyContent), callbacks, resourcePath);

	// Notes
	const notesContent = parseNotesSection(bodyContent);
	if (notesContent.trim()) {
		const notesSection = container.createDiv();
		notesSection.createEl("h2", { text: "Notes" });
		renderTextContent(notesSection, notesContent, resourcePath, app, recipePath, component);
	}

	// Reviews
	const reviewsContent = parseReviewsSection(bodyContent);
	if (reviewsContent.trim() || (app && file && onReviewChanged)) {
		const reviewsSection = container.createDiv();
		reviewsSection.createEl("h2", { text: "Reviews" });
		renderReviewCards(reviewsSection, reviewsContent, resourcePath, app, recipePath, component, file, onReviewChanged, mediaFolder);
	}

	// References — at the bottom
	if (source) {
		const refsSection = container.createDiv({ cls: "gl-recipe__refs" });
		refsSection.createEl("h2", { text: "References" });
		if (source.startsWith("http")) {
			const link = refsSection.createEl("a", { text: source, href: source });
			link.setAttr("target", "_blank");
			link.setAttr("rel", "noopener");
		} else {
			refsSection.createEl("p", { text: source });
		}
	}
}

/**
 * Editor mode: textarea + toolbar, no preview zone.
 */
function renderMainPanelEditor(
	container: HTMLElement,
	bodyContent: string,
	source: string | undefined,
	callbacks: MainPanelCallbacks,
	app?: App,
	recipePath?: string
): void {
	// Recipe section — toolbar + textarea
	const bodySection = container.createDiv({ cls: "gl-recipe__steps" });
	bodySection.createEl("h2", { text: "Recipe" });

	// ── Toolbar ──
	const toolbar = bodySection.createDiv({ cls: "gl-toolbar" });

	const btnIngredient = toolbar.createEl("button", {
		cls: "gl-toolbar__btn gl-toolbar__btn--ingredient",
		text: "@ Ingredient",
	});
	const btnTool = toolbar.createEl("button", {
		cls: "gl-toolbar__btn gl-toolbar__btn--tool",
		text: "# Tool",
	});
	const btnTimer = toolbar.createEl("button", {
		cls: "gl-toolbar__btn gl-toolbar__btn--timer",
		text: "~ Timer",
	});
	const btnSection = toolbar.createEl("button", {
		cls: "gl-toolbar__btn",
		text: "Section",
	});
	const btnComment = toolbar.createEl("button", {
		cls: "gl-toolbar__btn",
		text: "> Tip",
	});

	// ── Inline form area ──
	const formArea = bodySection.createDiv({ cls: "gl-toolbar__form-area" });
	formArea.style.display = "none";

	// ── Textarea ──
	const recipeContent = getRecipeEditableContent(bodyContent);
	const bodyArea = bodySection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea gl-recipe__edit-textarea--full",
	}) as HTMLTextAreaElement;
	bodyArea.dataset.field = "recipe-body";
	bodyArea.value = recipeContent;
	bodyArea.placeholder = "Write your recipe here, or use the toolbar above to insert ingredients, tools, and timers.";

	bodyArea.addEventListener("input", () => {
		callbacks.onBodyInput(bodyArea.value);
	});

	// ── Image autocomplete ──
	const suggests: TextareaSuggest<TFile>[] = [];
	if (app) {
		suggests.push(createImageSuggest(bodyArea, () => app.vault.getFiles(), recipePath));
	}

	// ── Toolbar button handlers ──
	const clearForm = () => {
		formArea.empty();
		formArea.style.display = "none";
	};

	btnIngredient.addEventListener("click", () => {
		clearForm();
		formArea.style.display = "";
		renderIngredientForm(formArea, bodyArea, clearForm);
	});

	btnTool.addEventListener("click", () => {
		clearForm();
		formArea.style.display = "";
		renderToolForm(formArea, bodyArea, clearForm);
	});

	btnTimer.addEventListener("click", () => {
		clearForm();
		formArea.style.display = "";
		renderTimerForm(formArea, bodyArea, clearForm);
	});

	btnSection.addEventListener("click", () => {
		clearForm();
		formArea.style.display = "";
		renderSectionForm(formArea, bodyArea, clearForm);
	});

	btnComment.addEventListener("click", () => {
		insertAtCursor(bodyArea, "> ", true);
		bodyArea.focus();
	});

	// References
	if (source) {
		const refsSection = container.createDiv({ cls: "gl-recipe__refs" });
		refsSection.createEl("h2", { text: "References" });
		if (source.startsWith("http")) {
			const link = refsSection.createEl("a", { text: source, href: source });
			link.setAttr("target", "_blank");
			link.setAttr("rel", "noopener");
		} else {
			refsSection.createEl("p", { text: source });
		}
	}

	// Notes textarea
	const notesSection = container.createDiv();
	notesSection.createEl("h2", { text: "Notes" });
	const notesContent = parseNotesSection(bodyContent);
	const notesArea = notesSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	notesArea.dataset.field = "notes";
	notesArea.value = notesContent;
	notesArea.addEventListener("input", () => {
		callbacks.onNotesInput();
	});
	if (app) {
		suggests.push(createImageSuggest(notesArea, () => app.vault.getFiles(), recipePath));
	}

	// Reviews textarea
	const reviewsSection = container.createDiv();
	reviewsSection.createEl("h2", { text: "Reviews" });
	const reviewsContent = parseReviewsSection(bodyContent);
	const reviewsArea = reviewsSection.createEl("textarea", {
		cls: "gl-recipe__edit-textarea",
	}) as HTMLTextAreaElement;
	reviewsArea.dataset.field = "reviews";
	reviewsArea.placeholder = "- 2026-03-04 Write your review here";
	reviewsArea.value = reviewsContent;
	reviewsArea.addEventListener("input", () => {
		callbacks.onReviewsInput();
	});
	if (app) {
		suggests.push(createImageSuggest(reviewsArea, () => app.vault.getFiles(), recipePath));
	}

	// Attach indent handlers and store for cleanup
	for (const ta of [bodyArea, notesArea, reviewsArea]) {
		const detach = attachIndentHandler(ta);
		suggests.push({ destroy: detach } as any);
	}

	// Store all suggests for cleanup on re-render
	(container as any).__glSuggests = suggests;
}

/**
 * Render Cooklang-parsed preview with chips and hover interactions.
 */
function renderPreviewContent(
	container: HTMLElement,
	recipeBody: string,
	callbacks: MainPanelCallbacks,
	resourcePath?: (path: string) => string
): void {
	const parsed = parseCooklangBody(recipeBody);

	if (parsed.steps.length === 0) {
		return;
	}

	let currentSection = "";
	let stepIndex = 0;
	let pendingImageSteps: CooklangStep[] = [];
	let pendingGalleryImages: string[] = [];
	let inGalleryMode = false;
	let stepGroup: HTMLElement | null = null;

	const ensureStepGroup = (): HTMLElement => {
		if (!stepGroup) {
			stepGroup = container.createDiv({ cls: "gl-recipe__step-group" });
		}
		return stepGroup;
	};

	const flushImageSteps = () => {
		if (pendingImageSteps.length === 0) return;
		const combined = pendingImageSteps
			.flatMap((s) => s.segments)
			.map((s) => (s as { type: "text"; value: string }).value)
			.join(" ");
		renderTextWithEmbeds(ensureStepGroup(), combined, resourcePath);
		pendingImageSteps = [];
	};

	const flushGalleryImages = () => {
		if (pendingGalleryImages.length === 0) return;
		const combined = pendingGalleryImages.join(" ");
		renderTextWithEmbeds(ensureStepGroup(), combined, resourcePath);
		pendingGalleryImages = [];
		inGalleryMode = false;
	};

	const isImageOnlyComment = (step: CooklangStep): boolean => {
		if (!step.isComment) return false;
		if (!step.segments.every((s) => s.type === "text")) return false;
		const text = step.segments
			.map((s) => (s as { type: "text"; value: string }).value)
			.join("");
		return isImageOnlyLine(text);
	};

	for (const step of parsed.steps) {
		if (step.section !== currentSection) {
			flushImageSteps();
			flushGalleryImages();
			currentSection = step.section;
			if (currentSection) {
				container.createEl("h3", {
					text: currentSection,
					cls: "gl-recipe__section-header",
				});
			}
			stepGroup = container.createDiv({ cls: "gl-recipe__step-group" });
		}

		// Gallery callout mode: accumulate image-only comment steps
		if (inGalleryMode) {
			if (isImageOnlyComment(step)) {
				const text = step.segments
					.map((s) => (s as { type: "text"; value: string }).value)
					.join("");
				pendingGalleryImages.push(text);
				continue;
			}
			flushGalleryImages();
		}

		// Detect [!gallery] marker in comment steps
		if (step.isComment && step.segments.length === 1 && step.segments[0].type === "text") {
			const text = (step.segments[0] as { type: "text"; value: string }).value;
			if (isGalleryCalloutMarker(text)) {
				flushImageSteps();
				inGalleryMode = true;
				pendingGalleryImages = [];
				continue;
			}
		}

		if (isImageOnlyStep(step)) {
			pendingImageSteps.push(step);
			continue;
		}

		flushImageSteps();

		if (step.isComment) {
			const commentEl = ensureStepGroup().createDiv({
				cls: "gl-recipe__comment",
			});
			renderSegments(commentEl, step.segments, callbacks, resourcePath);
			continue;
		}

		const stepEl = ensureStepGroup().createDiv({
			cls: "gl-recipe__step",
		});

		renderSegments(stepEl, step.segments, callbacks, resourcePath);

		const ingredientNames = step.segments
			.filter((s): s is Extract<CooklangSegment, { type: "ingredient" }> => s.type === "ingredient")
			.map((s) => s.value.name);

		stepEl.addEventListener("mouseenter", () => {
			stepEl.addClass("gl-recipe__step--highlight");
			callbacks.onStepHover(ingredientNames);
		});
		stepEl.addEventListener("mouseleave", () => {
			stepEl.removeClass("gl-recipe__step--highlight");
			callbacks.onStepHover([]);
		});

		stepEl.dataset.stepIndex = String(stepIndex);
		stepEl.dataset.ingredients = ingredientNames.join(",");
		stepIndex++;
	}
	flushImageSteps();
	flushGalleryImages();
}

/**
 * Check if a line contains only image embeds (and whitespace).
 */
function isImageOnlyLine(line: string): boolean {
	if (!line.trim()) return false;
	const withoutImages = line.replace(
		/!\[\[([^\]]+)\]\]/g,
		(m, filePath: string) => {
			const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
			return IMAGE_EXTS.includes(ext) ? "" : m;
		}
	);
	return !withoutImages.trim();
}

/**
 * Check if a Cooklang step contains only image embeds (text-only segments, all images).
 */
function isImageOnlyStep(step: CooklangStep): boolean {
	if (step.isComment) return false;
	if (!step.segments.every((s) => s.type === "text")) return false;
	const combined = step.segments
		.map((s) => (s as { type: "text"; value: string }).value)
		.join("");
	return isImageOnlyLine(combined);
}

/**
 * Render plain text content as paragraphs.
 * Consecutive image-only lines are joined so they form a single gallery.
 */
function renderTextContent(
	container: HTMLElement,
	text: string,
	resourcePath?: (path: string) => string,
	app?: App,
	sourcePath?: string,
	component?: Component
): void {
	if (app && sourcePath && component) {
		const md = container.createDiv({ cls: "gl-markdown" });
		MarkdownRenderer.render(app, text, md, sourcePath, component).then(() => {
			transformGalleryCallouts(md);
		});
		return;
	}

	const lines = text.split("\n");
	let pendingImageLines: string[] = [];

	const flushImages = () => {
		if (pendingImageLines.length === 0) return;
		renderTextWithEmbeds(container, pendingImageLines.join(" "), resourcePath);
		pendingImageLines = [];
	};

	for (const line of lines) {
		if (!line.trim()) continue;
		if (isImageOnlyLine(line)) {
			pendingImageLines.push(line);
		} else {
			flushImages();
			const p = container.createEl("p");
			renderTextWithEmbeds(p, line, resourcePath);
		}
	}
	flushImages();
}

// ── Review Cards ──

interface ReviewEntry {
	date: string;
	lines: string[];
	rawText: string;
}

/**
 * Parse review entries from text.
 * Each entry starts with `- ` at line start (top-level list item).
 * Dated entries: `- YYYY-MM-DD ...`; dateless entries: `- text`.
 * Indented/continuation lines belong to the previous entry.
 * Text before the first entry is collected as preamble.
 */
function parseReviewEntries(text: string): { preamble: string; entries: ReviewEntry[] } | null {
	const lines = text.split("\n");
	const entries: ReviewEntry[] = [];
	const preambleLines: string[] = [];
	const datedRe = /^-\s*(\d{4}-\d{2}-\d{2})\s*:?\s*(.*)/;
	const itemRe = /^-\s+(.*)/;
	let rawLines: string[] = [];

	for (const line of lines) {
		const dm = line.match(datedRe);
		if (dm) {
			if (entries.length > 0) {
				entries[entries.length - 1].rawText = rawLines.join("\n");
			}
			rawLines = [line];
			entries.push({ date: dm[1], lines: dm[2].trim() ? [dm[2].trim()] : [], rawText: "" });
		} else {
			const im = line.match(itemRe);
			if (im) {
				if (entries.length > 0) {
					entries[entries.length - 1].rawText = rawLines.join("\n");
				}
				rawLines = [line];
				entries.push({ date: "", lines: im[1].trim() ? [im[1].trim()] : [], rawText: "" });
			} else if (entries.length > 0) {
				rawLines.push(line);
				if (line.trim()) {
					entries[entries.length - 1].lines.push(line.trim());
				}
			} else if (entries.length === 0 && line.trim()) {
				preambleLines.push(line.trim());
			}
		}
	}

	if (entries.length > 0) {
		entries[entries.length - 1].rawText = rawLines.join("\n");
	}

	if (entries.length === 0) return null;
	return { preamble: preambleLines.join("\n"), entries };
}

/**
 * Render review entries as timeline cards.
 * Falls back to renderTextContent if parsing fails.
 */
function renderReviewCards(
	container: HTMLElement,
	text: string,
	resourcePath?: (path: string) => string,
	app?: App,
	sourcePath?: string,
	component?: Component,
	file?: TFile,
	onReviewChanged?: () => void,
	mediaFolder?: string
): void {
	const result = text.trim() ? parseReviewEntries(text) : null;
	if (!result && text.trim()) {
		renderTextContent(container, text, resourcePath, app, sourcePath, component);
	}

	if (result?.preamble) {
		renderTextContent(container, result.preamble, resourcePath, app, sourcePath, component);
	}

	const timeline = container.createDiv({ cls: "gl-recipe__review-timeline" });
	for (const entry of result?.entries ?? []) {
		const card = timeline.createDiv({ cls: "gl-recipe__review-card" });

		const header = card.createDiv({ cls: "gl-recipe__review-header" });
		if (entry.date) {
			header.createSpan({ text: entry.date, cls: "gl-recipe__review-date" });
		}

		// Kebab menu (only when file is available — viewer mode)
		if (app && file && onReviewChanged) {
			const menuBtn = header.createEl("button", { cls: "gl-review-card__menu-btn" });
			menuBtn.setAttr("aria-label", "Review actions");
			menuBtn.title = "Review actions";
			setIcon(menuBtn, "more-horizontal");
			menuBtn.addEventListener("click", (e) => {
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle("Edit").setIcon("pencil").onClick(() => {
						const prefill = extractRecipeReviewPrefill(entry);
						new ReviewModal(app, "recipe", file, onReviewChanged, prefill, async (newMd) => {
							await replaceReviewInFile(app, file, entry.rawText, newMd);
						}, mediaFolder).open();
					});
				});
				menu.addItem((item) => {
					item.setTitle("Delete").setIcon("trash-2").onClick(() => {
						new ConfirmDeleteModal(app, `review from ${entry.date || "unknown date"}`, async (confirmed) => {
							if (!confirmed) return;
							await deleteReviewInFile(app, file, entry.rawText);
							onReviewChanged();
						}).open();
					});
				});
				menu.showAtMouseEvent(e as MouseEvent);
			});
		}

		const body = card.createDiv({ cls: "gl-recipe__review-body" });
		const content = entry.lines.join("\n");
		if (content) {
			if (app && sourcePath && component) {
				body.classList.add("gl-markdown");
				MarkdownRenderer.render(app, content, body, sourcePath, component).then(() => {
					transformGalleryCallouts(body);
				});
			} else {
				renderTextWithEmbeds(body, content, resourcePath);
			}
		}
	}

	// Add review prompt at the bottom of timeline
	if (app && file && onReviewChanged) {
		const addCard = timeline.createDiv({ cls: "gl-recipe__review-card gl-review-card--add" });
		addCard.setAttr("role", "button");
		addCard.setAttr("tabindex", "0");
		addCard.createSpan({ text: "Write a new review...", cls: "gl-review-card--add__text" });
		const openModal = () => {
			new ReviewModal(app, "recipe", file, onReviewChanged, undefined, undefined, mediaFolder).open();
		};
		addCard.addEventListener("click", openModal);
		addCard.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(); }
		});
	}
}

/**
 * Highlight steps that use a specific ingredient.
 */
export function highlightMainSteps(
	container: HTMLElement,
	ingredientName: string | null
): void {
	const steps = container.querySelectorAll(".gl-recipe__step");
	for (const step of Array.from(steps)) {
		const el = step as HTMLElement;
		if (
			ingredientName &&
			(el.dataset.ingredients || "")
				.toLowerCase()
				.split(",")
				.includes(ingredientName.toLowerCase())
		) {
			el.addClass("gl-recipe__step--highlight");
		} else {
			el.removeClass("gl-recipe__step--highlight");
		}
	}
}

/**
 * Collect state from all three textareas.
 */
export function collectMainState(container: HTMLElement): MainState {
	const getField = (field: string): string => {
		const ta = container.querySelector(
			`[data-field="${field}"]`
		) as HTMLTextAreaElement | null;
		return ta?.value ?? "";
	};

	return {
		body: getField("recipe-body"),
		notes: getField("notes").trim(),
		reviews: getField("reviews").trim(),
	};
}

// ── Embed Rendering ──

// EMBED_RE and IMAGE_EXTS imported from constants.ts

function renderTextWithEmbeds(
	container: HTMLElement,
	text: string,
	resourcePath?: (path: string) => string
): void {
	if (!resourcePath) {
		container.appendText(text);
		return;
	}

	let lastIndex = 0;
	let pendingImages: { src: string; alt: string }[] = [];

	const flushGallery = () => {
		if (pendingImages.length === 0) return;
		const gallery = container.createDiv({ cls: "gl-gallery" });
		const srcs = pendingImages.map((p) => p.src);
		const alts = pendingImages.map((p) => p.alt);
		for (let i = 0; i < pendingImages.length; i++) {
			const img = gallery.createEl("img");
			img.src = pendingImages[i].src;
			img.alt = pendingImages[i].alt;
			const idx = i;
			img.addEventListener("click", () =>
				showImageLightbox(img.src, img.alt, { srcs, alts, index: idx })
			);
		}
		pendingImages = [];
	};

	for (const match of text.matchAll(EMBED_RE)) {
		const textBefore = text.slice(lastIndex, match.index!);
		if (textBefore.trim()) {
			flushGallery();
			container.appendText(textBefore);
		} else if (textBefore && pendingImages.length === 0) {
			container.appendText(textBefore);
		}
		// whitespace between consecutive images → skip (gallery gap handles spacing)

		const filePath = match[1];
		const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
		if (IMAGE_EXTS.includes(ext)) {
			pendingImages.push({ src: resourcePath(filePath), alt: filePath });
		} else {
			flushGallery();
			container.appendText(match[0]);
		}
		lastIndex = match.index! + match[0].length;
	}
	flushGallery();
	if (lastIndex < text.length) {
		container.appendText(text.slice(lastIndex));
	}
}

export interface GalleryInfo {
	srcs: string[];
	alts: string[];
	index: number;
}

// ── Lightbox Zoom Controller ──

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.002;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;
const TOGGLE_ZOOM = 2.5;
const SWIPE_THRESHOLD = 50;

interface LightboxCallbacks {
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	onSingleTap?: () => void;
}

class LightboxZoom {
	private scale = 1;
	private tx = 0;
	private ty = 0;
	private isDragging = false;
	private isPinching = false;
	private isSwiping = false;
	private lastX = 0;
	private lastY = 0;
	private pinchStartDist = 0;
	private pinchStartScale = 1;
	private lastTapTime = 0;
	private lastTapX = 0;
	private lastTapY = 0;
	private swipeStartX = 0;
	private swipeStartY = 0;
	private swipeX = 0;
	private singleTapTimer: ReturnType<typeof setTimeout> | null = null;
	private singleClickTimer: ReturnType<typeof setTimeout> | null = null;

	private readonly onWheel: (e: WheelEvent) => void;
	private readonly onPointerDown: (e: PointerEvent) => void;
	private readonly onPointerMove: (e: PointerEvent) => void;
	private readonly onPointerUp: (e: PointerEvent) => void;
	private readonly onTouchStart: (e: TouchEvent) => void;
	private readonly onTouchMove: (e: TouchEvent) => void;
	private readonly onTouchEnd: (e: TouchEvent) => void;
	private readonly onDblClick: (e: MouseEvent) => void;
	private readonly onClick: (e: MouseEvent) => void;

	constructor(
		private overlay: HTMLElement,
		private img: HTMLImageElement,
		private callbacks: LightboxCallbacks = {}
	) {
		this.onWheel = (e) => {
			e.preventDefault();
			e.stopPropagation();
			const delta = -e.deltaY * ZOOM_STEP;
			this.zoomTo(this.scale * (1 + delta), e.clientX, e.clientY);
		};

		this.onPointerDown = (e) => {
			if (e.pointerType === "touch" || e.button !== 0) return;
			if (!this.isZoomed()) return;
			this.startDrag(e.clientX, e.clientY);
			this.img.setPointerCapture(e.pointerId);
		};

		this.onPointerMove = (e) => {
			if (!this.isDragging || e.pointerType === "touch") return;
			this.moveDrag(e.clientX, e.clientY);
		};

		this.onPointerUp = (e) => {
			if (e.pointerType === "touch") return;
			this.endDrag();
		};

		this.onTouchStart = (e) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				this.isPinching = true;
				this.isDragging = false;
				this.isSwiping = false;
				if (this.singleTapTimer) { clearTimeout(this.singleTapTimer); this.singleTapTimer = null; }
				this.pinchStartDist = this.touchDist(e.touches);
				this.pinchStartScale = this.scale;
				this.img.classList.add("gl-lightbox__image--no-transition");
			} else if (e.touches.length === 1) {
				const t = e.touches[0];
				const now = Date.now();
				const dx = t.clientX - this.lastTapX;
				const dy = t.clientY - this.lastTapY;

				// Double-tap detection
				if (
					now - this.lastTapTime < DOUBLE_TAP_MS &&
					Math.hypot(dx, dy) < DOUBLE_TAP_DIST
				) {
					e.preventDefault();
					if (this.singleTapTimer) { clearTimeout(this.singleTapTimer); this.singleTapTimer = null; }
					this.toggleZoom(t.clientX, t.clientY);
					this.lastTapTime = 0;
				} else {
					this.lastTapTime = now;
					this.lastTapX = t.clientX;
					this.lastTapY = t.clientY;
					if (this.isZoomed()) {
						this.startDrag(t.clientX, t.clientY);
					} else {
						// Start swipe tracking
						this.swipeStartX = t.clientX;
						this.swipeStartY = t.clientY;
						this.swipeX = 0;
						this.isSwiping = false;
					}
				}
			}
		};

		this.onTouchMove = (e) => {
			if (this.isPinching && e.touches.length === 2) {
				e.preventDefault();
				const newDist = this.touchDist(e.touches);
				const mid = this.touchMid(e.touches);
				const newScale = this.pinchStartScale * (newDist / this.pinchStartDist);
				this.zoomTo(newScale, mid.x, mid.y, true);
			} else if (this.isDragging && e.touches.length === 1) {
				e.preventDefault();
				this.moveDrag(e.touches[0].clientX, e.touches[0].clientY);
			} else if (!this.isZoomed() && e.touches.length === 1) {
				// Swipe tracking
				const t = e.touches[0];
				const dx = t.clientX - this.swipeStartX;
				const dy = t.clientY - this.swipeStartY;
				if (!this.isSwiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
					this.isSwiping = true;
					this.img.classList.add("gl-lightbox__image--no-transition");
				}
				if (this.isSwiping) {
					e.preventDefault();
					this.swipeX = dx;
					this.img.style.transform = `translateX(${dx}px)`;
				}
			}
		};

		this.onTouchEnd = (e) => {
			if (this.isPinching && e.touches.length < 2) {
				this.isPinching = false;
				this.img.classList.remove("gl-lightbox__image--no-transition");
				if (this.scale < MIN_ZOOM) this.zoomTo(MIN_ZOOM, window.innerWidth / 2, window.innerHeight / 2);
			}
			if (e.touches.length === 0) {
				if (this.isSwiping) {
					this.img.classList.remove("gl-lightbox__image--no-transition");
					if (Math.abs(this.swipeX) > SWIPE_THRESHOLD) {
						if (this.swipeX > 0) this.callbacks.onSwipeRight?.();
						else this.callbacks.onSwipeLeft?.();
					}
					// Snap back
					this.img.style.transform = "";
					this.isSwiping = false;
					this.swipeX = 0;
				} else if (!this.isDragging && !this.isPinching) {
					// Single-tap detection: if finger barely moved
					const ct = e.changedTouches[0];
					const moved = Math.hypot(ct.clientX - this.swipeStartX, ct.clientY - this.swipeStartY);
					if (moved < 10 && !this.isZoomed()) {
						this.singleTapTimer = setTimeout(() => {
							this.singleTapTimer = null;
							this.callbacks.onSingleTap?.();
						}, DOUBLE_TAP_MS);
					}
				}
				this.endDrag();
			}
		};

		this.onDblClick = (e) => {
			e.stopPropagation();
			if (this.singleClickTimer) { clearTimeout(this.singleClickTimer); this.singleClickTimer = null; }
			this.toggleZoom(e.clientX, e.clientY);
		};

		// Desktop single-click → chrome toggle (delayed to distinguish from dblclick)
		this.onClick = (e) => {
			e.stopPropagation();
			if (this.isZoomed()) return;
			if (this.singleClickTimer) clearTimeout(this.singleClickTimer);
			this.singleClickTimer = setTimeout(() => {
				this.singleClickTimer = null;
				this.callbacks.onSingleTap?.();
			}, DOUBLE_TAP_MS);
		};

		img.addEventListener("wheel", this.onWheel, { passive: false });
		img.addEventListener("pointerdown", this.onPointerDown);
		img.addEventListener("pointermove", this.onPointerMove);
		img.addEventListener("pointerup", this.onPointerUp);
		img.addEventListener("pointercancel", this.onPointerUp);
		img.addEventListener("touchstart", this.onTouchStart, { passive: false });
		img.addEventListener("touchmove", this.onTouchMove, { passive: false });
		img.addEventListener("touchend", this.onTouchEnd);
		img.addEventListener("dblclick", this.onDblClick);
		img.addEventListener("click", this.onClick);
	}

	isZoomed(): boolean {
		return this.scale > 1.01;
	}

	reset(): void {
		this.scale = 1;
		this.tx = 0;
		this.ty = 0;
		this.isDragging = false;
		this.isPinching = false;
		this.isSwiping = false;
		this.img.style.transform = "";
		this.img.classList.remove("gl-lightbox__image--zoomed");
		this.overlay.style.cursor = "zoom-in";
	}

	destroy(): void {
		if (this.singleTapTimer) clearTimeout(this.singleTapTimer);
		if (this.singleClickTimer) clearTimeout(this.singleClickTimer);
		this.img.removeEventListener("wheel", this.onWheel);
		this.img.removeEventListener("pointerdown", this.onPointerDown);
		this.img.removeEventListener("pointermove", this.onPointerMove);
		this.img.removeEventListener("pointerup", this.onPointerUp);
		this.img.removeEventListener("pointercancel", this.onPointerUp);
		this.img.removeEventListener("touchstart", this.onTouchStart);
		this.img.removeEventListener("touchmove", this.onTouchMove);
		this.img.removeEventListener("touchend", this.onTouchEnd);
		this.img.removeEventListener("dblclick", this.onDblClick);
		this.img.removeEventListener("click", this.onClick);
	}

	private toggleZoom(cx: number, cy: number): void {
		if (this.isZoomed()) {
			this.reset();
		} else {
			this.zoomTo(TOGGLE_ZOOM, cx, cy);
		}
	}

	private zoomTo(newScale: number, cx: number, cy: number, noTransition = false): void {
		const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
		const ratio = clamped / this.scale;
		const ox = window.innerWidth / 2;
		const oy = window.innerHeight / 2;
		this.tx = (cx - ox) * (1 - ratio) + ratio * this.tx;
		this.ty = (cy - oy) * (1 - ratio) + ratio * this.ty;
		this.scale = clamped;
		this.clampTranslation();
		if (noTransition) this.img.classList.add("gl-lightbox__image--no-transition");
		this.applyTransform();
		if (noTransition) {
			void this.img.offsetHeight;
			this.img.classList.remove("gl-lightbox__image--no-transition");
		}
	}

	private clampTranslation(): void {
		if (!this.isZoomed()) {
			this.tx = 0;
			this.ty = 0;
			return;
		}
		const rect = this.img.getBoundingClientRect();
		const imgW = (rect.width / this.scale) * this.scale;
		const imgH = (rect.height / this.scale) * this.scale;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const maxTx = Math.max(0, (imgW - vw) / 2);
		const maxTy = Math.max(0, (imgH - vh) / 2);
		this.tx = Math.max(-maxTx, Math.min(maxTx, this.tx));
		this.ty = Math.max(-maxTy, Math.min(maxTy, this.ty));
	}

	private applyTransform(): void {
		this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
		if (this.isZoomed()) {
			this.img.classList.add("gl-lightbox__image--zoomed");
			this.overlay.style.cursor = this.scale >= MAX_ZOOM ? "zoom-out" : "default";
		} else {
			this.img.classList.remove("gl-lightbox__image--zoomed");
			this.overlay.style.cursor = "zoom-in";
		}
	}

	private startDrag(x: number, y: number): void {
		this.isDragging = true;
		this.lastX = x;
		this.lastY = y;
		this.overlay.classList.add("gl-lightbox--grabbing");
		this.img.classList.add("gl-lightbox__image--no-transition");
	}

	private moveDrag(x: number, y: number): void {
		if (!this.isDragging) return;
		this.tx += x - this.lastX;
		this.ty += y - this.lastY;
		this.lastX = x;
		this.lastY = y;
		this.clampTranslation();
		this.applyTransform();
	}

	private endDrag(): void {
		if (!this.isDragging) return;
		this.isDragging = false;
		this.overlay.classList.remove("gl-lightbox--grabbing");
		this.img.classList.remove("gl-lightbox__image--no-transition");
	}

	private touchDist(touches: TouchList): number {
		const dx = touches[1].clientX - touches[0].clientX;
		const dy = touches[1].clientY - touches[0].clientY;
		return Math.hypot(dx, dy);
	}

	private touchMid(touches: TouchList): { x: number; y: number } {
		return {
			x: (touches[0].clientX + touches[1].clientX) / 2,
			y: (touches[0].clientY + touches[1].clientY) / 2,
		};
	}
}

export function showImageLightbox(
	src: string,
	alt: string,
	gallery?: GalleryInfo
): void {
	const overlay = document.body.createDiv({ cls: "gl-lightbox" });
	const img = overlay.createEl("img", { cls: "gl-lightbox__image" });
	img.src = src;
	img.alt = alt;

	// Close button (always visible unless chrome hidden)
	const closeBtn = overlay.createEl("button", {
		cls: "gl-lightbox__close",
		text: "\u00D7",
	});

	let chromeVisible = true;
	const toggleChrome = () => {
		chromeVisible = !chromeVisible;
		overlay.classList.toggle("gl-lightbox--chrome-hidden", !chromeVisible);
	};

	let zoom: LightboxZoom;

	const close = () => {
		zoom.destroy();
		overlay.remove();
	};

	const onKeydown = (e: KeyboardEvent) => {
		e.stopPropagation();
		e.preventDefault();
		if (e.key === "Escape") {
			close();
			document.removeEventListener("keydown", onKeydown, true);
		}
	};

	closeBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		close();
		document.removeEventListener("keydown", onKeydown, true);
	});

	if (gallery && gallery.srcs.length > 1) {
		let currentIndex = gallery.index;

		// Thumbnail strip
		const strip = overlay.createDiv({ cls: "gl-lightbox__strip" });
		const thumbs: HTMLImageElement[] = [];
		for (let i = 0; i < gallery.srcs.length; i++) {
			const thumb = strip.createEl("img", { cls: "gl-lightbox__thumb" });
			thumb.src = gallery.srcs[i];
			thumb.alt = gallery.alts[i];
			const idx = i;
			thumb.addEventListener("click", (e) => {
				e.stopPropagation();
				currentIndex = idx;
				update();
			});
			thumbs.push(thumb);
		}

		const update = () => {
			img.src = gallery.srcs[currentIndex];
			img.alt = gallery.alts[currentIndex];
			zoom.reset();
			// Update active thumbnail
			for (let i = 0; i < thumbs.length; i++) {
				thumbs[i].classList.toggle("gl-lightbox__thumb--active", i === currentIndex);
			}
			thumbs[currentIndex].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
		};

		const goNext = () => {
			currentIndex = (currentIndex + 1) % gallery.srcs.length;
			update();
		};
		const goPrev = () => {
			currentIndex = (currentIndex - 1 + gallery.srcs.length) % gallery.srcs.length;
			update();
		};

		zoom = new LightboxZoom(overlay, img, {
			onSwipeLeft: goNext,
			onSwipeRight: goPrev,
			onSingleTap: toggleChrome,
		});

		update();

		// Extend keydown for arrow navigation
		const galleryKeydown = (e: KeyboardEvent) => {
			e.stopPropagation();
			e.preventDefault();
			if (e.key === "ArrowLeft") goPrev();
			else if (e.key === "ArrowRight") goNext();
			else if (e.key === "Escape") {
				close();
				document.removeEventListener("keydown", galleryKeydown, true);
			}
		};
		document.addEventListener("keydown", galleryKeydown, true);

		overlay.addEventListener("click", () => {
			if (!zoom.isZoomed()) {
				close();
				document.removeEventListener("keydown", galleryKeydown, true);
			}
		});
	} else {
		zoom = new LightboxZoom(overlay, img, {
			onSingleTap: toggleChrome,
		});

		document.addEventListener("keydown", onKeydown, true);
		overlay.addEventListener("click", () => {
			if (!zoom.isZoomed()) {
				close();
				document.removeEventListener("keydown", onKeydown, true);
			}
		});
	}
}

// ── Segment Rendering ──

/**
 * Render Cooklang segments with 3-type chips:
 * - ingredient (accent), tool (border), timer (accent alt)
 */
function renderSegments(
	container: HTMLElement,
	segments: CooklangSegment[],
	callbacks: MainPanelCallbacks,
	resourcePath?: (path: string) => string
): void {
	for (const seg of segments) {
		switch (seg.type) {
			case "text":
				renderTextWithEmbeds(container, seg.value, resourcePath);
				break;

			case "ingredient": {
				const qtyText = [seg.value.quantity, seg.value.unit]
					.filter(Boolean)
					.join(" ");

				const wrap = qtyText
					? container.createSpan({ cls: "gl-recipe__chip-wrap" })
					: container;

				const chip = wrap.createSpan({
					text: seg.value.name,
					cls: "gl-recipe__chip gl-recipe__chip--ingredient",
				});
				if (qtyText) {
					wrap.createSpan({
						text: qtyText,
						cls: "gl-recipe__chip-qty",
					});
					chip.title = qtyText;
				}
				chip.dataset.ingredient = seg.value.name.toLowerCase();
				chip.addEventListener("click", (e) => {
					e.stopPropagation();
					callbacks.onIngredientChipClick(seg.value.name);
				});
				break;
			}

			case "tool": {
				container.createSpan({
					text: seg.value.name,
					cls: "gl-recipe__chip gl-recipe__chip--tool",
				});
				break;
			}

			case "timer": {
				const timerText = [seg.value.time, seg.value.unit]
					.filter(Boolean)
					.join(" ");
				container.createSpan({
					text: timerText,
					cls: "gl-recipe__chip gl-recipe__chip--timer",
				});
				break;
			}
		}
	}
}

// ── Inline Forms ──

function renderIngredientForm(
	formArea: HTMLElement,
	textarea: HTMLTextAreaElement,
	onDone: () => void
): void {
	const form = formArea.createDiv({ cls: "gl-toolbar__form" });

	const nameInput = form.createEl("input", {
		type: "text",
		placeholder: "Name",
		cls: "gl-toolbar__input gl-toolbar__input--name",
	}) as HTMLInputElement;

	const qtyInput = form.createEl("input", {
		type: "text",
		placeholder: "Qty",
		cls: "gl-toolbar__input gl-toolbar__input--short",
	}) as HTMLInputElement;

	const unitInput = form.createEl("input", {
		type: "text",
		placeholder: "Unit",
		cls: "gl-toolbar__input gl-toolbar__input--short",
	}) as HTMLInputElement;

	const insertBtn = form.createEl("button", {
		text: "Insert",
		cls: "mod-cta",
	});

	const cancelBtn = form.createEl("button", { text: "Cancel" });

	const doInsert = () => {
		const name = nameInput.value.trim();
		if (!name) return;
		const qty = qtyInput.value.trim();
		const unit = unitInput.value.trim();

		let marker: string;
		if (qty && unit) {
			marker = `@${name}{${qty}%${unit}}`;
		} else if (qty) {
			marker = `@${name}{${qty}}`;
		} else {
			marker = `@${name}{}`;
		}

		insertAtCursor(textarea, marker, false);
		onDone();
		textarea.focus();
	};

	insertBtn.addEventListener("click", doInsert);
	cancelBtn.addEventListener("click", () => { onDone(); textarea.focus(); });

	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === "Enter") { e.preventDefault(); doInsert(); }
		if (e.key === "Escape") { onDone(); textarea.focus(); }
	};
	nameInput.addEventListener("keydown", onKeydown);
	qtyInput.addEventListener("keydown", onKeydown);
	unitInput.addEventListener("keydown", onKeydown);

	nameInput.focus();
}

function renderToolForm(
	formArea: HTMLElement,
	textarea: HTMLTextAreaElement,
	onDone: () => void
): void {
	const form = formArea.createDiv({ cls: "gl-toolbar__form" });

	const nameInput = form.createEl("input", {
		type: "text",
		placeholder: "Tool name",
		cls: "gl-toolbar__input gl-toolbar__input--name",
	}) as HTMLInputElement;

	const insertBtn = form.createEl("button", {
		text: "Insert",
		cls: "mod-cta",
	});

	const cancelBtn = form.createEl("button", { text: "Cancel" });

	const doInsert = () => {
		const name = nameInput.value.trim();
		if (!name) return;
		insertAtCursor(textarea, `#${name}{}`, false);
		onDone();
		textarea.focus();
	};

	insertBtn.addEventListener("click", doInsert);
	cancelBtn.addEventListener("click", () => { onDone(); textarea.focus(); });

	nameInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); doInsert(); }
		if (e.key === "Escape") { onDone(); textarea.focus(); }
	});

	nameInput.focus();
}

function renderTimerForm(
	formArea: HTMLElement,
	textarea: HTMLTextAreaElement,
	onDone: () => void
): void {
	const form = formArea.createDiv({ cls: "gl-toolbar__form" });

	const timeInput = form.createEl("input", {
		type: "text",
		placeholder: "Time",
		cls: "gl-toolbar__input gl-toolbar__input--short",
	}) as HTMLInputElement;

	const unitSelect = form.createEl("select", {
		cls: "gl-toolbar__input gl-toolbar__input--short dropdown",
	}) as HTMLSelectElement;
	for (const [val, label] of [["sec", "Seconds"], ["min", "Minutes"], ["hr", "Hours"]]) {
		const opt = unitSelect.createEl("option", { text: label, value: val });
		if (val === "min") opt.selected = true;
	}

	const insertBtn = form.createEl("button", {
		text: "Insert",
		cls: "mod-cta",
	});

	const cancelBtn = form.createEl("button", { text: "Cancel" });

	const doInsert = () => {
		const time = timeInput.value.trim();
		if (!time) return;
		const unit = unitSelect.value;
		insertAtCursor(textarea, `~{${time}%${unit}}`, false);
		onDone();
		textarea.focus();
	};

	insertBtn.addEventListener("click", doInsert);
	cancelBtn.addEventListener("click", () => { onDone(); textarea.focus(); });

	timeInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); doInsert(); }
		if (e.key === "Escape") { onDone(); textarea.focus(); }
	});

	timeInput.focus();
}

function renderSectionForm(
	formArea: HTMLElement,
	textarea: HTMLTextAreaElement,
	onDone: () => void
): void {
	const form = formArea.createDiv({ cls: "gl-toolbar__form" });

	const nameInput = form.createEl("input", {
		type: "text",
		placeholder: "Section name",
		cls: "gl-toolbar__input gl-toolbar__input--name",
	}) as HTMLInputElement;

	const insertBtn = form.createEl("button", {
		text: "Insert",
		cls: "mod-cta",
	});

	const cancelBtn = form.createEl("button", { text: "Cancel" });

	const doInsert = () => {
		const name = nameInput.value.trim();
		if (!name) return;
		insertAtCursor(textarea, `### ${name}`, true);
		onDone();
		textarea.focus();
	};

	insertBtn.addEventListener("click", doInsert);
	cancelBtn.addEventListener("click", () => { onDone(); textarea.focus(); });

	nameInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); doInsert(); }
		if (e.key === "Escape") { onDone(); textarea.focus(); }
	});

	nameInput.focus();
}

// ── Textarea Insertion ──

/**
 * Insert text at the current cursor position in a textarea.
 * If `newLine` is true, ensures the text is on its own line.
 * Dispatches input event to trigger auto-save.
 */
function insertAtCursor(
	textarea: HTMLTextAreaElement,
	text: string,
	newLine: boolean
): void {
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const before = textarea.value.substring(0, start);
	const after = textarea.value.substring(end);

	let insertion = text;
	if (newLine) {
		const needPrecedingNewline = before.length > 0 && !before.endsWith("\n");
		insertion = (needPrecedingNewline ? "\n" : "") + text + "\n";
	}

	textarea.value = before + insertion + after;

	const cursorPos = start + insertion.length;
	textarea.selectionStart = cursorPos;
	textarea.selectionEnd = cursorPos;

	// Dispatch input event so auto-save is triggered
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

// ── Helpers ──

/**
 * Extract the editable recipe content zone (before ## Notes / ## Reviews).
 */
function getRecipeEditableContent(body: string): string {
	const lines = body.split("\n");
	const endSections: readonly string[] = RECIPE_END_SECTIONS;
	const resultLines: string[] = [];

	for (const line of lines) {
		const match = line.match(SECTION_HEADING_RE);
		if (match && endSections.includes(match[1].trim().toLowerCase())) {
			break;
		}
		if (match && match[1].trim().toLowerCase() === "recipe") {
			continue;
		}
		resultLines.push(line);
	}

	while (resultLines.length > 0 && !resultLines[0].trim()) {
		resultLines.shift();
	}
	while (resultLines.length > 0 && !resultLines[resultLines.length - 1].trim()) {
		resultLines.pop();
	}

	return resultLines.join("\n");
}

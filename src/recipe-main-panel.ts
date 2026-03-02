import { setIcon, type App } from "obsidian";
import type { RecipeViewMode } from "./types";
import {
	parseCooklangBody,
	parseNotesSection,
	parseReviewsSection,
	type CooklangSegment,
	type CooklangStep,
} from "./cooklang-parser";
import { createImageSuggest, type TextareaSuggest } from "./textarea-suggest";
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
}

export interface MainState {
	body: string;
	notes: string;
	reviews: string;
}

/**
 * Render the main panel in viewer or editor mode.
 */
export function renderMainPanel(
	container: HTMLElement,
	title: string,
	bodyContent: string,
	source: string | undefined,
	mode: RecipeViewMode,
	callbacks: MainPanelCallbacks,
	app?: App,
	recipePath?: string,
	resourcePath?: (path: string) => string
): void {
	// Clean up previous TextareaSuggest instances
	const prev = (container as any).__glSuggests as TextareaSuggest<unknown>[] | undefined;
	if (prev) {
		for (const s of prev) s.destroy();
		(container as any).__glSuggests = null;
	}

	container.empty();

	// Title row — title + mode toggle + view source
	const titleRow = container.createDiv({ cls: "gl-recipe__title-row" });
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

	const viewSourceBtn = btnGroup.createEl("button", {
		text: "</>",
		cls: "gl-recipe__view-source",
	});
	viewSourceBtn.title = "View Source";
	viewSourceBtn.addEventListener("click", callbacks.onViewSource);

	if (mode === "viewer") {
		renderMainPanelViewer(container, bodyContent, source, callbacks, resourcePath);
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
	resourcePath?: (path: string) => string
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
		renderTextContent(notesSection, notesContent, resourcePath);
	}

	// Reviews
	const reviewsContent = parseReviewsSection(bodyContent);
	if (reviewsContent.trim()) {
		const reviewsSection = container.createDiv();
		reviewsSection.createEl("h2", { text: "Reviews" });
		renderTextContent(reviewsSection, reviewsContent, resourcePath);
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
		text: "== Section",
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
	reviewsArea.value = reviewsContent;
	reviewsArea.addEventListener("input", () => {
		callbacks.onReviewsInput();
	});
	if (app) {
		suggests.push(createImageSuggest(reviewsArea, () => app.vault.getFiles(), recipePath));
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
	let stepGroup = container.createDiv({ cls: "gl-recipe__step-group" });

	const flushImageSteps = () => {
		if (pendingImageSteps.length === 0) return;
		const combined = pendingImageSteps
			.flatMap((s) => s.segments)
			.map((s) => (s as { type: "text"; value: string }).value)
			.join(" ");
		renderTextWithEmbeds(stepGroup, combined, resourcePath);
		pendingImageSteps = [];
	};

	for (const step of parsed.steps) {
		if (step.section !== currentSection) {
			flushImageSteps();
			currentSection = step.section;
			if (currentSection) {
				container.createEl("h3", {
					text: currentSection,
					cls: "gl-recipe__section-header",
				});
			}
			stepGroup = container.createDiv({ cls: "gl-recipe__step-group" });
		}

		if (isImageOnlyStep(step)) {
			pendingImageSteps.push(step);
			continue;
		}

		flushImageSteps();

		if (step.isComment) {
			const commentEl = stepGroup.createDiv({
				cls: "gl-recipe__comment",
			});
			renderSegments(commentEl, step.segments, callbacks, resourcePath);
			continue;
		}

		const stepEl = stepGroup.createDiv({
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
	resourcePath?: (path: string) => string
): void {
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

const EMBED_RE = /!\[\[([^\]]+)\]\]/g;
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"];

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
		const gallery = container.createDiv({ cls: "gl-recipe__gallery" });
		for (const { src, alt } of pendingImages) {
			const img = gallery.createEl("img", {
				cls: "gl-recipe__inline-image",
			});
			img.src = src;
			img.alt = alt;
			img.addEventListener("click", () =>
				showImageLightbox(img.src, img.alt)
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

function showImageLightbox(src: string, alt: string): void {
	const overlay = document.body.createDiv({ cls: "gl-lightbox" });
	const img = overlay.createEl("img", { cls: "gl-lightbox__image" });
	img.src = src;
	img.alt = alt;
	overlay.addEventListener("click", () => overlay.remove());
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
		insertAtCursor(textarea, `== ${name} ==`, true);
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
	const endSections = ["notes", "reviews"];
	const resultLines: string[] = [];

	for (const line of lines) {
		const match = line.match(/^##\s+(.+)/);
		if (match && endSections.includes(match[1].trim().toLowerCase())) {
			break;
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

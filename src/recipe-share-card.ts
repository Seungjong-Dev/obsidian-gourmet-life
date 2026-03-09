import { App, Notice } from "obsidian";
import { toPng } from "html-to-image";
import type { RecipeFrontmatter } from "./types";
import {
	parseCooklangBody,
	extractCooklangIngredientsGrouped,
	type CooklangSegment,
	type CooklangIngredient,
} from "./cooklang-parser";
import { renderStarsDom } from "./render-utils";

// ── Public API ─────────────────────────────────────────────

export async function exportShareCard(
	app: App,
	filePath: string,
	fm: RecipeFrontmatter,
	bodyContent: string,
	title: string
): Promise<void> {
	const wrapper = document.createElement("div");
	wrapper.style.position = "fixed";
	wrapper.style.left = "-9999px";
	wrapper.style.top = "0";
	try {
		const imageDataUrl = fm.image
			? await resolveImageDataUrl(app, fm.image, filePath)
			: null;

		const card = buildShareCardDOM(title, fm, bodyContent, imageDataUrl);
		wrapper.appendChild(card);
		document.body.appendChild(wrapper);

		const dataUrl = await toPng(card, {
			pixelRatio: 2,
			backgroundColor: BG,
		});

		const blob = await (await fetch(dataUrl)).blob();
		await copyOrShare(blob, title);
		new Notice("Recipe image copied!");
	} catch (e: unknown) {
		if (e instanceof DOMException && e.name === "AbortError") return;
		console.error("Share card export failed:", e);
		new Notice("Failed to export recipe image");
	} finally {
		wrapper.remove();
	}
}

// ── Hardcoded palette (mirrors recipe-view light theme) ────

const BG = "#ffffff";
const BG_SECONDARY = "#f8f8f8";
const BORDER = "#e5e5e5";
const TEXT = "#1a1a1a";
const TEXT_MUTED = "#999999";
const ACCENT = "#d97706";
const ACCENT_SOFT = "#fef3c7";
const ON_ACCENT = "#ffffff";

// ── Image Resolution ───────────────────────────────────────

async function resolveImageDataUrl(
	app: App,
	imagePath: string,
	filePath: string
): Promise<string | null> {
	try {
		const resolved = app.metadataCache.getFirstLinkpathDest(
			imagePath,
			filePath
		);
		if (!resolved) return null;
		const buf = await app.vault.readBinary(resolved);
		const ext = resolved.extension.toLowerCase();
		const mime =
			ext === "png"
				? "image/png"
				: ext === "svg"
					? "image/svg+xml"
					: ext === "gif"
						? "image/gif"
						: ext === "webp"
							? "image/webp"
							: "image/jpeg";
		return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
	} catch {
		return null;
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

// ── Card DOM Builder ───────────────────────────────────────

function buildShareCardDOM(
	title: string,
	fm: RecipeFrontmatter,
	bodyContent: string,
	imageDataUrl: string | null
): HTMLElement {
	const card = el("div", "gl-share-card");

	// ── Image with gradient overlay (matches gl-recipe__image-wrap) ──
	if (imageDataUrl) {
		const imageWrap = el("div", "gl-share-card__image-wrap");
		const img = document.createElement("img");
		img.className = "gl-share-card__image";
		img.src = imageDataUrl;
		imageWrap.appendChild(img);
		const overlay = el("div", "gl-share-card__image-overlay");
		imageWrap.appendChild(overlay);
		card.appendChild(imageWrap);
	} else {
		card.appendChild(el("div", "gl-share-card__no-image"));
	}

	const body = el("div", "gl-share-card__body");
	card.appendChild(body);

	// ── Title (matches gl-recipe__title) ──
	const titleEl = el("div", "gl-share-card__title");
	titleEl.textContent = title;
	body.appendChild(titleEl);

	// ── Rating (matches gl-recipe__rating-display) ──
	if (fm.rating) {
		const ratingRow = el("div", "gl-share-card__rating");
		const starsSpan = el("span", "gl-share-card__rating-stars");
		renderStarsDom(starsSpan, fm.rating);
		ratingRow.appendChild(starsSpan);
		const label = el("span", "gl-share-card__rating-label");
		label.textContent = `${fm.rating}/5`;
		ratingRow.appendChild(label);
		body.appendChild(ratingRow);
	}

	// ── Meta chips (matches gl-recipe__meta-chip) ──
	const cuisines = Array.isArray(fm.cuisine)
		? fm.cuisine
		: fm.cuisine
			? [fm.cuisine]
			: [];
	const chipValues = [...cuisines, fm.category].filter(Boolean) as string[];
	if (chipValues.length > 0) {
		const chipRow = el("div", "gl-share-card__chips");
		for (const v of chipValues) {
			const chip = el("span", "gl-share-card__chip");
			chip.textContent = v;
			chipRow.appendChild(chip);
		}
		body.appendChild(chipRow);
	}

	// ── Stats grid (matches gl-recipe__stats-grid) ──
	const statItems: { label: string; value: string }[] = [];
	if (fm.prep_time) statItems.push({ label: "Prep", value: `${fm.prep_time}min` });
	if (fm.cook_time) statItems.push({ label: "Cook", value: `${fm.cook_time}min` });
	if (fm.servings) statItems.push({ label: "Serves", value: String(fm.servings) });
	if (fm.difficulty) statItems.push({ label: "Level", value: fm.difficulty });

	if (statItems.length > 0) {
		const grid = el("div", "gl-share-card__stats");
		for (const item of statItems) {
			const cell = el("div", "gl-share-card__stat-cell");
			const label = el("div", "gl-share-card__stat-label");
			label.textContent = item.label;
			const value = el("div", "gl-share-card__stat-value");
			value.textContent = item.value;
			cell.appendChild(label);
			cell.appendChild(value);
			grid.appendChild(cell);
		}
		body.appendChild(grid);
	}

	// ── Ingredients (matches gl-recipe__ingredients card) ──
	const grouped = extractCooklangIngredientsGrouped(bodyContent);
	const allIngredients: CooklangIngredient[] = [];
	for (const items of grouped.values()) {
		allIngredients.push(...items);
	}

	if (allIngredients.length > 0) {
		const section = el("div", "gl-share-card__section");
		section.appendChild(sectionHeader("Ingredients"));

		const ingCard = el("div", "gl-share-card__ing-card");
		for (let i = 0; i < allIngredients.length; i++) {
			const ing = allIngredients[i];
			const item = el("div", "gl-share-card__ing-item");
			if (i < allIngredients.length - 1) {
				item.style.borderBottom = `1px solid ${BORDER}`;
			}
			const name = el("span", "gl-share-card__ing-name");
			name.textContent = ing.name;
			item.appendChild(name);
			const qty = [ing.quantity, ing.unit].filter(Boolean).join(" ");
			if (qty) {
				const pill = el("span", "gl-share-card__ing-qty");
				pill.textContent = qty;
				item.appendChild(pill);
			}
			ingCard.appendChild(item);
		}
		section.appendChild(ingCard);
		body.appendChild(section);
	}

	// ── Steps (matches gl-recipe__step with number badge) ──
	const parsed = parseCooklangBody(bodyContent);
	const steps = parsed.steps.filter((s) => !s.isComment);

	if (steps.length > 0) {
		const section = el("div", "gl-share-card__section");
		section.appendChild(sectionHeader("Steps"));

		const stepGroup = el("div", "gl-share-card__step-group");
		let stepNum = 0;
		for (const step of steps) {
			stepNum++;
			const stepEl = el("div", "gl-share-card__step");
			const badge = el("span", "gl-share-card__step-num");
			badge.textContent = String(stepNum);
			stepEl.appendChild(badge);
			const text = el("span", "gl-share-card__step-text");
			text.textContent = segmentsToPlainText(step.segments);
			stepEl.appendChild(text);
			stepGroup.appendChild(stepEl);
		}
		section.appendChild(stepGroup);
		body.appendChild(section);
	}

	// ── Footer ──
	const footer = el("div", "gl-share-card__footer");
	footer.textContent = "👨‍🍳 Gourmet Life";
	card.appendChild(footer);

	return card;
}

// ── Helpers ────────────────────────────────────────────────

function el(tag: string, cls: string): HTMLElement {
	const e = document.createElement(tag);
	e.className = cls;
	return e;
}

function sectionHeader(text: string): HTMLElement {
	const h = el("div", "gl-share-card__section-header");
	h.textContent = text;
	return h;
}

function segmentsToPlainText(segments: CooklangSegment[]): string {
	return segments
		.map((seg) => {
			switch (seg.type) {
				case "text":
					return seg.value;
				case "ingredient":
					return seg.value.name;
				case "tool":
					return seg.value.name;
				case "timer": {
					const parts = [seg.value.time, seg.value.unit]
						.filter(Boolean)
						.join(" ");
					return parts;
				}
			}
		})
		.join("");
}

async function copyOrShare(blob: Blob, title: string): Promise<void> {
	if (isMobile() && navigator.share) {
		const file = new File([blob], `${title}.png`, { type: "image/png" });
		await navigator.share({ files: [file] });
	} else {
		await navigator.clipboard.write([
			new ClipboardItem({ "image/png": blob }),
		]);
	}
}

function isMobile(): boolean {
	return document.body.hasClass("is-mobile");
}

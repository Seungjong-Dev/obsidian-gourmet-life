import type { App, Vault } from "obsidian";
import type { GourmetNote, ExplorerTab, RecipeFrontmatter, RestaurantFrontmatter } from "./types";
import type { ExplorerFilterState, FilterOption } from "./explorer-filter";

// ── Filter Bar ──

export function renderFilterBar(
	container: HTMLElement,
	type: ExplorerTab,
	options: Record<string, FilterOption[]>,
	state: ExplorerFilterState,
	onChange: (field: string, value: string) => void
): void {
	container.empty();

	const fields =
		type === "recipe"
			? ["cuisine", "category", "difficulty"]
			: ["cuisine", "price_range", "area"];

	for (const field of fields) {
		const values = options[field];
		if (!values || values.length === 0) continue;

		const row = container.createDiv({ cls: "gl-explorer__filter-row" });
		row.createSpan({
			cls: "gl-explorer__filter-label",
			text: field.replace("_", " "),
		});

		const chips = row.createDiv({ cls: "gl-explorer__filter-chips" });
		for (const opt of values) {
			const selected = (state as any)[field]?.includes(opt.value);
			const chip = chips.createEl("button", {
				cls: `gl-explorer__chip${selected ? " gl-explorer__chip--active" : ""}`,
			});
			chip.createSpan({ text: opt.value });
			chip.createSpan({ cls: "gl-explorer__chip-count", text: ` ${opt.count}` });
			chip.addEventListener("click", () => onChange(field, opt.value));
		}
	}

	// Rating filter
	const ratingRow = container.createDiv({ cls: "gl-explorer__filter-row" });
	ratingRow.createSpan({ cls: "gl-explorer__filter-label", text: "min rating" });
	const ratingChips = ratingRow.createDiv({ cls: "gl-explorer__filter-chips" });
	for (let r = 1; r <= 5; r++) {
		const selected = state.minRating === r;
		const chip = ratingChips.createEl("button", {
			cls: `gl-explorer__chip${selected ? " gl-explorer__chip--active" : ""}`,
			text: "\u2605".repeat(r),
		});
		chip.addEventListener("click", () => onChange("minRating", String(r)));
	}

	// Unrated toggle chip
	const unratedChip = ratingChips.createEl("button", {
		cls: `gl-explorer__chip gl-explorer__chip--unrated${state.unrated ? " gl-explorer__chip--active" : ""}`,
		text: "unrated",
	});
	unratedChip.addEventListener("click", () => onChange("unrated", ""));
}

// ── Tag Cloud ──

export function renderTagCloud(
	container: HTMLElement,
	tagCounts: Map<string, number>,
	selectedTags: string[],
	onToggle: (tag: string) => void
): void {
	container.empty();
	if (tagCounts.size === 0) return;

	const header = container.createDiv({ cls: "gl-explorer__filter-row" });
	header.createSpan({ cls: "gl-explorer__filter-label", text: "tags" });

	const cloud = container.createDiv({ cls: "gl-explorer__tag-cloud" });
	const maxCount = Math.max(...tagCounts.values());
	const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

	for (const [tag, count] of sorted) {
		const ratio = maxCount > 1 ? count / maxCount : 1;
		const size = ratio > 0.66 ? "lg" : ratio > 0.33 ? "md" : "sm";
		const selected = selectedTags.includes(tag);
		const el = cloud.createEl("button", {
			cls: `gl-explorer__tag gl-explorer__tag--${size}${selected ? " gl-explorer__tag--active" : ""}`,
			text: tag,
		});
		el.createSpan({ cls: "gl-explorer__tag-count", text: ` ${count}` });
		el.addEventListener("click", () => onToggle(tag));
	}
}

// ── Card Grid ──

export function renderCardGrid(
	container: HTMLElement,
	notes: GourmetNote[],
	type: ExplorerTab,
	onOpen: (path: string) => void,
	vault: Vault,
	onSelect?: (path: string) => void,
	selectedPath?: string | null,
	resolveImage?: (imagePath: string, notePath: string) => string
): void {
	container.empty();
	if (notes.length === 0) {
		container.createDiv({ cls: "gl-explorer__empty", text: "No notes found" });
		return;
	}

	const now = Date.now();
	const sevenDays = 7 * 24 * 60 * 60 * 1000;

	const grid = container.createDiv({ cls: "gl-explorer__grid" });
	for (const note of notes) {
		const cls = "gl-explorer__card" + (selectedPath === note.path ? " gl-explorer__card--selected" : "");
		const card = grid.createDiv({ cls });
		if (onSelect) {
			card.addEventListener("click", () => onSelect(note.path));
			card.addEventListener("dblclick", () => onOpen(note.path));
		} else {
			card.addEventListener("click", () => onOpen(note.path));
		}

		// Image
		const imagePath = (note.frontmatter as any).image;
		if (imagePath) {
			const src = resolveImage ? resolveImage(imagePath, note.path) : "";
			if (src) {
				const imgWrap = card.createDiv({ cls: "gl-explorer__card-image-wrap" });
				const img = imgWrap.createEl("img", { cls: "gl-explorer__card-image" });
				img.src = src;

				// "New" badge
				const created = (note.frontmatter as any).created;
				if (created) {
					const createdDate = new Date(created);
					if (!isNaN(createdDate.getTime()) && (now - createdDate.getTime()) < sevenDays) {
						imgWrap.createSpan({ cls: "gl-explorer__card-new", text: "new" });
					}
				}
			}
		} else {
			// "New" badge without image
			const created = (note.frontmatter as any).created;
			if (created) {
				const createdDate = new Date(created);
				if (!isNaN(createdDate.getTime()) && (now - createdDate.getTime()) < sevenDays) {
					card.createSpan({ cls: "gl-explorer__card-new gl-explorer__card-new--no-img", text: "new" });
				}
			}
		}

		const body = card.createDiv({ cls: "gl-explorer__card-body" });
		body.createDiv({ cls: "gl-explorer__card-name", text: note.name });

		const meta = body.createDiv({ cls: "gl-explorer__card-meta" });

		if (type === "recipe") {
			const fm = note.frontmatter as RecipeFrontmatter;
			const cuisines = Array.isArray(fm.cuisine) ? fm.cuisine : fm.cuisine ? [fm.cuisine] : [];
			for (const c of cuisines) {
				meta.createSpan({ cls: "gl-explorer__card-chip", text: c });
			}
			if (fm.category) meta.createSpan({ cls: "gl-explorer__card-chip", text: fm.category });
			if (fm.difficulty) {
				meta.createSpan({
					cls: `gl-explorer__card-badge gl-explorer__card-badge--${fm.difficulty}`,
					text: fm.difficulty,
				});
			}
			const info = body.createDiv({ cls: "gl-explorer__card-info" });
			if (fm.rating) info.createSpan({ text: "\u2605".repeat(fm.rating) + "\u2606".repeat(5 - fm.rating), cls: "gl-explorer__card-rating" });
			if (fm.cook_time) info.createSpan({ text: `${fm.cook_time}min`, cls: "gl-explorer__card-time" });
		} else {
			const fm = note.frontmatter as RestaurantFrontmatter;
			if (fm.cuisine) meta.createSpan({ cls: "gl-explorer__card-chip", text: fm.cuisine });
			if (fm.price_range) meta.createSpan({ cls: "gl-explorer__card-chip", text: fm.price_range });
			if (fm.area) meta.createSpan({ cls: "gl-explorer__card-chip", text: fm.area });
			const info = body.createDiv({ cls: "gl-explorer__card-info" });
			if (fm.rating) info.createSpan({ text: "\u2605".repeat(fm.rating) + "\u2606".repeat(5 - fm.rating), cls: "gl-explorer__card-rating" });
			if (fm.address) info.createSpan({ text: fm.address, cls: "gl-explorer__card-location" });
		}
	}
}

// ── List View ──

export function renderListView(
	container: HTMLElement,
	notes: GourmetNote[],
	type: ExplorerTab,
	onOpen: (path: string) => void,
	vault: Vault,
	onSelect?: (path: string) => void,
	selectedPath?: string | null,
	resolveImage?: (imagePath: string, notePath: string) => string
): void {
	container.empty();
	if (notes.length === 0) {
		container.createDiv({ cls: "gl-explorer__empty", text: "No notes found" });
		return;
	}

	const now = Date.now();
	const sevenDays = 7 * 24 * 60 * 60 * 1000;

	const list = container.createDiv({ cls: "gl-explorer__list" });
	for (const note of notes) {
		const cls = "gl-explorer__list-item" + (selectedPath === note.path ? " gl-explorer__list-item--selected" : "");
		const row = list.createDiv({ cls });
		if (onSelect) {
			row.addEventListener("click", () => onSelect(note.path));
			row.addEventListener("dblclick", () => onOpen(note.path));
		} else {
			row.addEventListener("click", () => onOpen(note.path));
		}

		// Thumbnail
		const imagePath = (note.frontmatter as any).image;
		if (imagePath) {
			const src = resolveImage ? resolveImage(imagePath, note.path) : "";
			if (src) {
				const img = row.createEl("img", { cls: "gl-explorer__list-thumb" });
				img.src = src;
			}
		} else {
			row.createDiv({ cls: "gl-explorer__list-thumb gl-explorer__list-thumb--empty" });
		}

		// "New" dot
		const created = (note.frontmatter as any).created;
		if (created) {
			const createdDate = new Date(created);
			if (!isNaN(createdDate.getTime()) && (now - createdDate.getTime()) < sevenDays) {
				row.createSpan({ cls: "gl-explorer__list-new" });
			}
		}

		row.createSpan({ cls: "gl-explorer__list-name", text: note.name });

		const meta = row.createSpan({ cls: "gl-explorer__list-meta" });
		if (type === "recipe") {
			const fm = note.frontmatter as RecipeFrontmatter;
			const parts: string[] = [];
			const cuisines = Array.isArray(fm.cuisine) ? fm.cuisine : fm.cuisine ? [fm.cuisine] : [];
			if (cuisines.length > 0) parts.push(cuisines.join(", "));
			if (fm.category) parts.push(fm.category);
			if (fm.difficulty) parts.push(fm.difficulty);
			if (fm.cook_time) parts.push(`${fm.cook_time}min`);
			meta.textContent = parts.join(" \u00b7 ");
		} else {
			const fm = note.frontmatter as RestaurantFrontmatter;
			const parts: string[] = [];
			if (fm.cuisine) parts.push(fm.cuisine);
			if (fm.price_range) parts.push(fm.price_range);
			if (fm.area) parts.push(fm.area);
			if (fm.address) parts.push(fm.address);
			meta.textContent = parts.join(" \u00b7 ");
		}

		const rating = (note.frontmatter as any).rating;
		if (rating) {
			row.createSpan({
				cls: "gl-explorer__list-rating",
				text: "\u2605".repeat(rating) + "\u2606".repeat(5 - rating),
			});
		}
	}
}

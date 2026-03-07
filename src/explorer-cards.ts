import type { Vault } from "obsidian";
import type { GourmetNote, ExplorerTab, RecipeFrontmatter, RestaurantFrontmatter } from "./types";
import type { ExplorerFilterState } from "./explorer-filter";

// ── Filter Bar ──

export function renderFilterBar(
	container: HTMLElement,
	type: ExplorerTab,
	options: Record<string, string[]>,
	state: ExplorerFilterState,
	onChange: (field: string, value: string) => void
): void {
	container.empty();

	const fields =
		type === "recipe"
			? ["cuisine", "category", "difficulty"]
			: ["cuisine", "price_range", "location"];

	for (const field of fields) {
		const values = options[field];
		if (!values || values.length === 0) continue;

		const row = container.createDiv({ cls: "gl-explorer__filter-row" });
		row.createSpan({
			cls: "gl-explorer__filter-label",
			text: field.replace("_", " "),
		});

		const chips = row.createDiv({ cls: "gl-explorer__filter-chips" });
		for (const val of values) {
			const selected = (state as any)[field]?.includes(val);
			const chip = chips.createEl("button", {
				cls: `gl-explorer__chip${selected ? " gl-explorer__chip--active" : ""}`,
				text: val,
			});
			chip.addEventListener("click", () => onChange(field, val));
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
			text: "★".repeat(r),
		});
		chip.addEventListener("click", () => onChange("minRating", String(r)));
	}
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
	vault: Vault
): void {
	container.empty();
	if (notes.length === 0) {
		container.createDiv({ cls: "gl-explorer__empty", text: "No notes found" });
		return;
	}

	const grid = container.createDiv({ cls: "gl-explorer__grid" });
	for (const note of notes) {
		const card = grid.createDiv({ cls: "gl-explorer__card" });
		card.addEventListener("click", () => onOpen(note.path));

		// Image
		const imagePath = (note.frontmatter as any).image;
		if (imagePath) {
			const imgFile = vault.getAbstractFileByPath(imagePath);
			if (imgFile) {
				const img = card.createEl("img", { cls: "gl-explorer__card-image" });
				img.src = vault.getResourcePath(imgFile as any);
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
			if (fm.rating) info.createSpan({ text: "★".repeat(fm.rating) + "☆".repeat(5 - fm.rating), cls: "gl-explorer__card-rating" });
			if (fm.cook_time) info.createSpan({ text: `${fm.cook_time}min`, cls: "gl-explorer__card-time" });
		} else {
			const fm = note.frontmatter as RestaurantFrontmatter;
			if (fm.cuisine) meta.createSpan({ cls: "gl-explorer__card-chip", text: fm.cuisine });
			if (fm.price_range) meta.createSpan({ cls: "gl-explorer__card-chip", text: fm.price_range });
			const info = body.createDiv({ cls: "gl-explorer__card-info" });
			if (fm.rating) info.createSpan({ text: "★".repeat(fm.rating) + "☆".repeat(5 - fm.rating), cls: "gl-explorer__card-rating" });
			if (fm.location) info.createSpan({ text: fm.location, cls: "gl-explorer__card-location" });
		}
	}
}

// ── List View ──

export function renderListView(
	container: HTMLElement,
	notes: GourmetNote[],
	type: ExplorerTab,
	onOpen: (path: string) => void,
	vault: Vault
): void {
	container.empty();
	if (notes.length === 0) {
		container.createDiv({ cls: "gl-explorer__empty", text: "No notes found" });
		return;
	}

	const list = container.createDiv({ cls: "gl-explorer__list" });
	for (const note of notes) {
		const row = list.createDiv({ cls: "gl-explorer__list-item" });
		row.addEventListener("click", () => onOpen(note.path));

		// Thumbnail
		const imagePath = (note.frontmatter as any).image;
		if (imagePath) {
			const imgFile = vault.getAbstractFileByPath(imagePath);
			if (imgFile) {
				const img = row.createEl("img", { cls: "gl-explorer__list-thumb" });
				img.src = vault.getResourcePath(imgFile as any);
			}
		} else {
			row.createDiv({ cls: "gl-explorer__list-thumb gl-explorer__list-thumb--empty" });
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
			meta.textContent = parts.join(" · ");
		} else {
			const fm = note.frontmatter as RestaurantFrontmatter;
			const parts: string[] = [];
			if (fm.cuisine) parts.push(fm.cuisine);
			if (fm.price_range) parts.push(fm.price_range);
			if (fm.location) parts.push(fm.location);
			meta.textContent = parts.join(" · ");
		}

		const rating = (note.frontmatter as any).rating;
		if (rating) {
			row.createSpan({
				cls: "gl-explorer__list-rating",
				text: "★".repeat(rating) + "☆".repeat(5 - rating),
			});
		}
	}
}

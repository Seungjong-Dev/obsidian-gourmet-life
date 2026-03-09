import type { GourmetNote, ExplorerTab, RecipeFrontmatter, RestaurantFrontmatter } from "./types";
import type { LayoutTier } from "./device";

export function renderStatsBar(
	container: HTMLElement,
	notes: GourmetNote[],
	tab: ExplorerTab,
	layoutTier?: LayoutTier
): void {
	container.empty();
	if (notes.length === 0) return;

	container.addClass("gl-explorer__stats");

	const isNarrow = layoutTier === "narrow";

	// Total count
	container.createSpan({
		cls: "gl-explorer__stats-item",
		text: `${notes.length} ${tab === "recipe" ? "recipes" : "restaurants"}`,
	});

	// Average rating (shared)
	const rated = notes.filter((n) => (n.frontmatter as any).rating > 0);
	if (rated.length > 0) {
		const avg = rated.reduce((sum, n) => sum + ((n.frontmatter as any).rating ?? 0), 0) / rated.length;
		container.createSpan({ cls: "gl-explorer__stats-sep", text: "\u00b7" });
		container.createSpan({
			cls: "gl-explorer__stats-item gl-explorer__stats-rating",
			text: `avg \u2605${avg.toFixed(1)}`,
		});
	}

	// Narrow: only count + avg rating
	if (isNarrow) return;

	container.createSpan({ cls: "gl-explorer__stats-sep", text: "|" });

	if (tab === "recipe") {
		renderRecipeStats(container, notes);
	} else {
		renderRestaurantStats(container, notes);
	}

	// Cooking timeline (last 12 months)
	renderMiniTimeline(container, notes);
}

function renderRecipeStats(container: HTMLElement, notes: GourmetNote[]): void {
	// Top 3 cuisines
	const cuisineCount = new Map<string, number>();
	for (const n of notes) {
		const fm = n.frontmatter as RecipeFrontmatter;
		const arr = Array.isArray(fm.cuisine) ? fm.cuisine : fm.cuisine ? [fm.cuisine] : [];
		for (const c of arr) cuisineCount.set(c, (cuisineCount.get(c) ?? 0) + 1);
	}
	const topCuisines = [...cuisineCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([c]) => c);
	if (topCuisines.length > 0) {
		container.createSpan({
			cls: "gl-explorer__stats-item",
			text: topCuisines.join(", "),
		});
		container.createSpan({ cls: "gl-explorer__stats-sep", text: "|" });
	}

	// Difficulty distribution as colored dots
	const diff: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
	for (const n of notes) {
		const d = (n.frontmatter as RecipeFrontmatter).difficulty;
		if (d && d in diff) diff[d]++;
	}
	const diffEl = container.createSpan({ cls: "gl-explorer__stats-item gl-explorer__stats-difficulty" });
	for (const [level, count] of Object.entries(diff)) {
		if (count === 0) continue;
		const dot = diffEl.createSpan({ cls: `gl-explorer__stats-dot gl-explorer__stats-dot--${level}` });
		dot.title = `${level}: ${count}`;
		diffEl.createSpan({ text: `${count} ` });
	}
}

function renderRestaurantStats(container: HTMLElement, notes: GourmetNote[]): void {
	// Top areas
	const locCount = new Map<string, number>();
	for (const n of notes) {
		const area = (n.frontmatter as RestaurantFrontmatter).area;
		if (area) locCount.set(area, (locCount.get(area) ?? 0) + 1);
	}
	const topLocs = [...locCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([l]) => l);
	if (topLocs.length > 0) {
		container.createSpan({
			cls: "gl-explorer__stats-item",
			text: topLocs.join(", "),
		});
		container.createSpan({ cls: "gl-explorer__stats-sep", text: "|" });
	}

	// Price range distribution
	const priceCount = new Map<string, number>();
	for (const n of notes) {
		const pr = (n.frontmatter as RestaurantFrontmatter).price_range;
		if (pr) priceCount.set(pr, (priceCount.get(pr) ?? 0) + 1);
	}
	if (priceCount.size > 0) {
		const priceEl = container.createSpan({ cls: "gl-explorer__stats-item" });
		const sorted = [...priceCount.entries()].sort((a, b) => a[0].length - b[0].length);
		priceEl.textContent = sorted.map(([p, c]) => `${p}(${c})`).join(" ");
	}
}

function renderMiniTimeline(container: HTMLElement, notes: GourmetNote[]): void {
	const now = new Date();
	const months: number[] = new Array(12).fill(0);

	for (const note of notes) {
		const created = (note.frontmatter as any).created;
		if (!created) continue;
		const date = new Date(created);
		if (isNaN(date.getTime())) continue;
		const diffMs = now.getTime() - date.getTime();
		const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
		if (diffMonths >= 0 && diffMonths < 12) {
			months[11 - diffMonths]++;
		}
	}

	// Only show if there's at least one note with a date
	if (months.every((m) => m === 0)) return;

	container.createSpan({ cls: "gl-explorer__stats-sep", text: "|" });
	const timeline = container.createSpan({ cls: "gl-explorer__stats-timeline" });
	const maxCount = Math.max(...months, 1);
	for (let i = 0; i < 12; i++) {
		const bar = timeline.createSpan({ cls: "gl-explorer__stats-bar" });
		const height = months[i] > 0 ? Math.max(20, (months[i] / maxCount) * 100) : 0;
		bar.style.height = `${height}%`;
		if (months[i] > 0) bar.addClass("gl-explorer__stats-bar--active");
		const monthDate = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
		bar.title = `${monthDate.toLocaleString("default", { month: "short" })}: ${months[i]}`;
	}
}

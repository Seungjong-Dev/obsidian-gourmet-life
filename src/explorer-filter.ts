import type { GourmetNote, RecipeFrontmatter, RestaurantFrontmatter } from "./types";

export interface ExplorerFilterState {
	cuisine: string[];
	category: string[];
	difficulty: string[];
	price_range: string[];
	location: string[];
	minRating: number;
	tags: string[];
	search: string;
}

export function createEmptyFilter(): ExplorerFilterState {
	return {
		cuisine: [],
		category: [],
		difficulty: [],
		price_range: [],
		location: [],
		minRating: 0,
		tags: [],
		search: "",
	};
}

export function applyFilters(
	notes: GourmetNote[],
	filters: ExplorerFilterState
): GourmetNote[] {
	return notes.filter((note) => {
		const fm = note.frontmatter;

		// Search filter
		if (filters.search) {
			const q = filters.search.toLowerCase();
			if (!note.name.toLowerCase().includes(q)) return false;
		}

		// Rating filter
		if (filters.minRating > 0) {
			const rating = (fm as any).rating ?? 0;
			if (rating < filters.minRating) return false;
		}

		// Tag filter (AND — all selected tags must be present)
		if (filters.tags.length > 0) {
			const noteTags = (fm as any).tags ?? [];
			if (!filters.tags.every((t) => noteTags.includes(t))) return false;
		}

		// Cuisine filter (OR within field)
		if (filters.cuisine.length > 0) {
			const val = fm.cuisine;
			const cuisines = Array.isArray(val) ? val : val ? [val] : [];
			if (!filters.cuisine.some((c) => cuisines.includes(c))) return false;
		}

		if (fm.type === "recipe") {
			const rfm = fm as RecipeFrontmatter;
			if (filters.category.length > 0) {
				if (!rfm.category || !filters.category.includes(rfm.category)) return false;
			}
			if (filters.difficulty.length > 0) {
				if (!rfm.difficulty || !filters.difficulty.includes(rfm.difficulty)) return false;
			}
		}

		if (fm.type === "restaurant") {
			const rfm = fm as RestaurantFrontmatter;
			if (filters.price_range.length > 0) {
				if (!rfm.price_range || !filters.price_range.includes(rfm.price_range)) return false;
			}
			if (filters.location.length > 0) {
				if (!rfm.location || !filters.location.includes(rfm.location)) return false;
			}
		}

		return true;
	});
}

export function extractFilterOptions(
	notes: GourmetNote[]
): Record<string, string[]> {
	const sets: Record<string, Set<string>> = {
		cuisine: new Set(),
		category: new Set(),
		difficulty: new Set(),
		price_range: new Set(),
		location: new Set(),
	};

	for (const note of notes) {
		const fm = note.frontmatter;
		const cuisine = (fm as any).cuisine;
		if (cuisine) {
			const arr = Array.isArray(cuisine) ? cuisine : [cuisine];
			for (const c of arr) sets.cuisine.add(c);
		}
		if (fm.type === "recipe") {
			const rfm = fm as RecipeFrontmatter;
			if (rfm.category) sets.category.add(rfm.category);
			if (rfm.difficulty) sets.difficulty.add(rfm.difficulty);
		}
		if (fm.type === "restaurant") {
			const rfm = fm as RestaurantFrontmatter;
			if (rfm.price_range) sets.price_range.add(rfm.price_range);
			if (rfm.location) sets.location.add(rfm.location);
		}
	}

	const result: Record<string, string[]> = {};
	for (const [key, s] of Object.entries(sets)) {
		result[key] = [...s].sort();
	}
	return result;
}

export function extractTagCounts(notes: GourmetNote[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const note of notes) {
		const tags = (note.frontmatter as any).tags;
		if (!tags) continue;
		for (const tag of tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return counts;
}

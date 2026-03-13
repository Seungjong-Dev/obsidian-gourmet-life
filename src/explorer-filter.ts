import type { GourmetNote, RecipeFrontmatter, RestaurantFrontmatter, IngredientFrontmatter, SortOption } from "./types";

export interface ExplorerFilterState {
	cuisine: string[];
	category: string[];
	difficulty: string[];
	price_range: string[];
	area: string[];
	season: string[];
	minRating: number;
	tags: string[];
	search: string;
	sortBy: SortOption;
	unrated: boolean;
	searchIngredients: boolean;
}

export function createEmptyFilter(): ExplorerFilterState {
	return {
		cuisine: [],
		category: [],
		difficulty: [],
		price_range: [],
		area: [],
		season: [],
		minRating: 0,
		tags: [],
		search: "",
		sortBy: "name-asc",
		unrated: false,
		searchIngredients: false,
	};
}

export interface FilterOption {
	value: string;
	count: number;
}

export function applyFilters(
	notes: GourmetNote[],
	filters: ExplorerFilterState,
	ingredientIndex?: Map<string, Set<string>>
): GourmetNote[] {
	return notes.filter((note) => {
		const fm = note.frontmatter;

		// Search filter — expanded scope
		if (filters.search) {
			const q = filters.search.toLowerCase();
			const nameMatch = note.name.toLowerCase().includes(q);
			const cuisineVal = (fm as any).cuisine;
			const cuisines = Array.isArray(cuisineVal) ? cuisineVal : cuisineVal ? [cuisineVal] : [];
			const cuisineMatch = cuisines.some((c: string) => c.toLowerCase().includes(q));
			const categoryMatch = (fm as any).category?.toLowerCase().includes(q) ?? false;
			const tagsMatch = ((fm as any).tags ?? []).some((t: string) => t.toLowerCase().includes(q));
			const addressMatch = (fm as any).address?.toLowerCase().includes(q) ?? false;
			const areaMatch = (fm as any).area?.toLowerCase().includes(q) ?? false;
			const difficultyMatch = (fm as any).difficulty?.toLowerCase().includes(q) ?? false;

			let ingredientMatch = false;
			if (filters.searchIngredients && ingredientIndex) {
				const ingredients = ingredientIndex.get(note.path);
				if (ingredients) {
					ingredientMatch = [...ingredients].some((ing) => ing.toLowerCase().includes(q));
				}
			}

			// Ingredient-specific search: aliases
			const aliasesMatch = fm.type === "ingredient" && ((fm as IngredientFrontmatter).aliases ?? []).some((a: string) => a.toLowerCase().includes(q));

			if (!nameMatch && !cuisineMatch && !categoryMatch && !tagsMatch && !addressMatch && !areaMatch && !difficultyMatch && !ingredientMatch && !aliasesMatch) {
				return false;
			}
		}

		// Unrated filter
		if (filters.unrated) {
			const rating = (fm as any).rating ?? 0;
			if (rating > 0) return false;
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
			const val = (fm as any).cuisine;
			const cuisines = Array.isArray(val) ? val : val ? [val] : [];
			if (!filters.cuisine.some((c: string) => cuisines.includes(c))) return false;
		}

		if (filters.category.length > 0) {
			const cat = (fm as any).category;
			if (!cat || !filters.category.includes(cat)) return false;
		}

		if (fm.type === "recipe") {
			const rfm = fm as RecipeFrontmatter;
			if (filters.difficulty.length > 0) {
				if (!rfm.difficulty || !filters.difficulty.includes(rfm.difficulty)) return false;
			}
		}

		if (fm.type === "restaurant") {
			const rfm = fm as RestaurantFrontmatter;
			if (filters.price_range.length > 0) {
				if (!rfm.price_range || !filters.price_range.includes(rfm.price_range)) return false;
			}
			if (filters.area.length > 0) {
				if (!rfm.area || !filters.area.includes(rfm.area)) return false;
			}
		}

		if (fm.type === "ingredient") {
			const ifm = fm as IngredientFrontmatter;
			// Season filter (OR — any matching season)
			if (filters.season.length > 0) {
				if (!ifm.season || !filters.season.some((s) => ifm.season!.includes(s))) return false;
			}
		}

		return true;
	});
}

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

export function sortNotes(notes: GourmetNote[], sortBy: SortOption): GourmetNote[] {
	const sorted = [...notes];
	sorted.sort((a, b) => {
		const fmA = a.frontmatter as any;
		const fmB = b.frontmatter as any;
		switch (sortBy) {
			case "name-asc":
				return a.name.localeCompare(b.name);
			case "name-desc":
				return b.name.localeCompare(a.name);
			case "rating-desc":
				return (fmB.rating ?? 0) - (fmA.rating ?? 0);
			case "cook-time-asc":
				return (fmA.cook_time ?? Infinity) - (fmB.cook_time ?? Infinity);
			case "created-desc":
				return (fmB.created ?? "").localeCompare(fmA.created ?? "");
			case "difficulty-asc":
				return (DIFFICULTY_ORDER[fmA.difficulty] ?? 99) - (DIFFICULTY_ORDER[fmB.difficulty] ?? 99);
			case "price-asc": {
				const priceLen = (s: string | undefined) => s ? s.length : 99;
				return priceLen(fmA.price_range) - priceLen(fmB.price_range);
			}
			case "category":
				return (fmA.category ?? "").localeCompare(fmB.category ?? "");
			default:
				return 0;
		}
	});
	return sorted;
}

export function extractFilterOptions(
	notes: GourmetNote[]
): Record<string, FilterOption[]> {
	const counts: Record<string, Map<string, number>> = {
		cuisine: new Map(),
		category: new Map(),
		difficulty: new Map(),
		price_range: new Map(),
		area: new Map(),
		season: new Map(),
	};

	for (const note of notes) {
		const fm = note.frontmatter;
		const cuisine = (fm as any).cuisine;
		if (cuisine) {
			const arr = Array.isArray(cuisine) ? cuisine : [cuisine];
			for (const c of arr) {
				counts.cuisine.set(c, (counts.cuisine.get(c) ?? 0) + 1);
			}
		}
		if (fm.type === "recipe") {
			const rfm = fm as RecipeFrontmatter;
			if (rfm.category) counts.category.set(rfm.category, (counts.category.get(rfm.category) ?? 0) + 1);
			if (rfm.difficulty) counts.difficulty.set(rfm.difficulty, (counts.difficulty.get(rfm.difficulty) ?? 0) + 1);
		}
		if (fm.type === "restaurant") {
			const rfm = fm as RestaurantFrontmatter;
			if (rfm.category) counts.category.set(rfm.category, (counts.category.get(rfm.category) ?? 0) + 1);
			if (rfm.price_range) counts.price_range.set(rfm.price_range, (counts.price_range.get(rfm.price_range) ?? 0) + 1);
			if (rfm.area) counts.area.set(rfm.area, (counts.area.get(rfm.area) ?? 0) + 1);
		}
		if (fm.type === "ingredient") {
			const ifm = fm as IngredientFrontmatter;
			if (ifm.category) counts.category.set(ifm.category, (counts.category.get(ifm.category) ?? 0) + 1);
			if (ifm.season) {
				for (const s of ifm.season) {
					counts.season.set(s, (counts.season.get(s) ?? 0) + 1);
				}
			}
		}
	}

	const result: Record<string, FilterOption[]> = {};
	for (const [key, map] of Object.entries(counts)) {
		result[key] = [...map.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([value, count]) => ({ value, count }));
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

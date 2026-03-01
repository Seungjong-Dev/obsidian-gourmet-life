// ── View Types ──────────────────────────────────────────────

export const VIEW_TYPE_RECIPE = "gourmet-life-recipe-view";

export type RecipeViewMode = "viewer" | "editor";

// ── Note Types ──────────────────────────────────────────────

export type GourmetNoteType = "recipe" | "ingredient" | "restaurant";

export interface RecipeFrontmatter {
	type: "recipe";
	cuisine?: string;
	difficulty?: "easy" | "medium" | "hard";
	servings?: number;
	prep_time?: number;
	cook_time?: number;
	rating?: number;
	tags?: string[];
	image?: string;
	images?: string[];
	source?: string;
	created?: string;
}

export interface IngredientFrontmatter {
	type: "ingredient";
	category?: string;
	season?: string[];
	rating?: number;
	aliases?: string[];
	tags?: string[];
	created?: string;
}

export interface RestaurantFrontmatter {
	type: "restaurant";
	cuisine?: string;
	location?: string;
	price_range?: string;
	rating?: number;
	url?: string;
	tags?: string[];
	created?: string;
}

export type GourmetFrontmatter =
	| RecipeFrontmatter
	| IngredientFrontmatter
	| RestaurantFrontmatter;

export interface GourmetNote {
	path: string;
	name: string;
	type: GourmetNoteType;
	frontmatter: GourmetFrontmatter;
}

// ── Settings ────────────────────────────────────────────────

export interface GourmetLifeSettings {
	recipesFolder: string;
	ingredientsFolder: string;
	restaurantsFolder: string;
	autoLinkEnabled: boolean;
	autoLinkMinChars: number;
	generateBaseFiles: boolean;
}

export const DEFAULT_SETTINGS: GourmetLifeSettings = {
	recipesFolder: "Gourmet/Recipes",
	ingredientsFolder: "Gourmet/Ingredients",
	restaurantsFolder: "Gourmet/Restaurants",
	autoLinkEnabled: true,
	autoLinkMinChars: 2,
	generateBaseFiles: true,
};

// ── Base File Config ────────────────────────────────────────

export interface BaseFileConfig {
	path: string;
	content: string;
}

// ── Option Arrays ───────────────────────────────────────────

export const DIFFICULTY_OPTIONS = ["easy", "medium", "hard"] as const;

export const INGREDIENT_CATEGORIES = [
	"vegetable",
	"fruit",
	"meat",
	"seafood",
	"dairy",
	"grain",
	"spice",
	"condiment",
	"other",
] as const;

export const SEASONS = ["spring", "summer", "fall", "winter"] as const;

export const PRICE_RANGES = ["$", "$$", "$$$", "$$$$"] as const;

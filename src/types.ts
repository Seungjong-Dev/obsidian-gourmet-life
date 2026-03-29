// ── View Types ──────────────────────────────────────────────

export const VIEW_TYPE_RECIPE = "gourmet-life-recipe-view";
export const VIEW_TYPE_RESTAURANT = "gourmet-life-restaurant-view";
export const VIEW_TYPE_INGREDIENT = "gourmet-life-ingredient-view";
export const VIEW_TYPE_EXPLORER = "gourmet-life-explorer-view";

export type RecipeViewMode = "viewer" | "editor";
export type RestaurantViewMode = "viewer" | "editor";
export type IngredientViewMode = "viewer" | "editor";
export type ExplorerTab = "recipe" | "restaurant" | "ingredient";
export type ExplorerLayout = "card" | "list" | "graph" | "map";
export type SortOption =
	| "name-asc"
	| "name-desc"
	| "rating-desc"
	| "cook-time-asc"
	| "created-desc"
	| "difficulty-asc"
	| "price-asc"
	| "category";

// ── Note Types ──────────────────────────────────────────────

export type GourmetNoteType = "recipe" | "ingredient" | "restaurant";

export interface RecipeFrontmatter {
	type: "recipe";
	cuisine?: string | string[];
	category?: string;
	difficulty?: "easy" | "medium" | "hard";
	servings?: number;
	prep_time?: number;
	cook_time?: number;
	rating?: number;
	tags?: string[];
	image?: string;
	source?: string;
	created?: string;
}

export interface IngredientFrontmatter {
	type: "ingredient";
	category?: string;
	season?: string[];
	rating?: number;
	aliases?: string[];
	image?: string;
	substitutes?: string[];
	tags?: string[];
	created?: string;
}

export interface RestaurantFrontmatter {
	type: "restaurant";
	cuisine?: string;
	category?: string;
	address?: string;
	area?: string;
	price_range?: string;
	rating?: number;
	url?: string;
	image?: string;
	lat?: number;
	lng?: number;
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

export interface GraphSettings {
	centerForce: number;   // 0–10, default 3
	repulsion: number;     // 0–10, default 5
	linkDistance: number;   // 0–10, default 4
	linkForce: number;     // 0–10, default 5
	nodeSize: number;      // 0–10, default 5
	showLabels: boolean;
	showOrphans: boolean;
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
	centerForce: 3,
	repulsion: 5,
	linkDistance: 4,
	linkForce: 5,
	nodeSize: 5,
	showLabels: true,
	showOrphans: true,
};

export interface GourmetLifeSettings {
	recipesFolder: string;
	ingredientsFolder: string;
	restaurantsFolder: string;
	autoLinkEnabled: boolean;
	autoLinkMinChars: number;
	mediaFolder: string;
	graphSettings: GraphSettings;
}

export const DEFAULT_SETTINGS: GourmetLifeSettings = {
	recipesFolder: "Gourmet/Recipes",
	ingredientsFolder: "Gourmet/Ingredients",
	restaurantsFolder: "Gourmet/Restaurants",
	autoLinkEnabled: true,
	autoLinkMinChars: 2,
	mediaFolder: "media",
	graphSettings: { ...DEFAULT_GRAPH_SETTINGS },
};

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

export const RECIPE_CATEGORIES = [
	"main",
	"side",
	"soup",
	"dessert",
	"drink",
	"snack",
	"bread",
	"sauce",
	"other",
] as const;

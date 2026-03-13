// ── Layout ──

/** Breakpoint for switching to single-column layout in recipe/restaurant views */
export const SINGLE_COLUMN_BREAKPOINT = 600;

// ── Timing ──

/** Auto-save debounce delay in milliseconds */
export const AUTO_SAVE_DELAY_MS = 1000;

/** Search input debounce delay in milliseconds */
export const SEARCH_DEBOUNCE_MS = 300;

/** Delay before clearing isSaving flag after a vault write */
export const SAVE_FLAG_RESET_MS = 200;

/** Ghost click suppression duration after overlay transitions */
export const GHOST_CLICK_SUPPRESSION_MS = 400;

// ── Explorer ──

/** Number of days a note is considered "new" in card/list views */
export const NEW_BADGE_DAYS = 7;

/** Maximum number of nearby restaurants to show */
export const MAX_NEARBY_RESTAURANTS = 15;

/** Lat/lng delta for nearby restaurant proximity check (~5.5km) */
export const NEARBY_RADIUS_DEG = 0.05;

// ── Section parsing ──

/** Regex for matching markdown H2 section headers */
export const SECTION_HEADING_RE = /^##\s+(.+)/;

/** Standard section names that end the recipe content zone */
export const RECIPE_END_SECTIONS = ["notes", "reviews"] as const;

// ── Embed parsing ──

/** Regex for matching Obsidian image/file embeds: ![[filename]] */
export const EMBED_RE = /!\[\[([^\]]+)\]\]/g;

/** Supported image file extensions */
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"];

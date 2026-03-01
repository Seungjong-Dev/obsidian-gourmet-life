import type { CachedMetadata } from "obsidian";
import type {
	GourmetFrontmatter,
	GourmetLifeSettings,
	GourmetNoteType,
} from "./types";

/**
 * Extract typed frontmatter from Obsidian's CachedMetadata.
 * Returns null if the frontmatter doesn't have a valid gourmet `type` field.
 */
export function readGourmetFrontmatter(
	cache: CachedMetadata | null
): GourmetFrontmatter | null {
	if (!cache?.frontmatter) return null;

	const fm = cache.frontmatter;
	const type = fm.type;
	if (type !== "recipe" && type !== "ingredient" && type !== "restaurant") {
		return null;
	}

	return fm as unknown as GourmetFrontmatter;
}

/**
 * Determine the expected gourmet note type for a file path based on folder settings.
 * Returns null if the file is not in any gourmet folder.
 */
export function getExpectedType(
	filePath: string,
	settings: GourmetLifeSettings
): GourmetNoteType | null {
	if (filePath.startsWith(settings.recipesFolder + "/")) return "recipe";
	if (filePath.startsWith(settings.ingredientsFolder + "/")) return "ingredient";
	if (filePath.startsWith(settings.restaurantsFolder + "/")) return "restaurant";
	return null;
}

/**
 * Check if a file qualifies as a gourmet note:
 * must be in the correct folder AND have the matching type field.
 */
export function isGourmetNote(
	filePath: string,
	cache: CachedMetadata | null,
	settings: GourmetLifeSettings
): boolean {
	const expectedType = getExpectedType(filePath, settings);
	if (!expectedType) return false;

	const fm = readGourmetFrontmatter(cache);
	if (!fm) return false;

	return fm.type === expectedType;
}

/**
 * Build a YAML frontmatter string block from a key-value object.
 * Skips undefined/null/empty values.
 */
export function buildFrontmatterString(
	data: Record<string, unknown>
): string {
	const lines: string[] = ["---"];
	for (const [key, value] of Object.entries(data)) {
		if (value === undefined || value === null || value === "") continue;

		if (Array.isArray(value)) {
			if (value.length === 0) continue;
			lines.push(`${key}: [${value.map(formatYamlValue).join(", ")}]`);
		} else {
			lines.push(`${key}: ${formatYamlValue(value)}`);
		}
	}
	lines.push("---");
	return lines.join("\n");
}

function formatYamlValue(value: unknown): string {
	if (typeof value === "string") {
		// Quote if contains special YAML chars
		if (/[:#\[\]{},&*?|>!'"%@`]/.test(value) || value.includes("\n")) {
			return `"${value.replace(/"/g, '\\"')}"`;
		}
		return value;
	}
	return String(value);
}

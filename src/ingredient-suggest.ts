import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	Notice,
	TFile,
} from "obsidian";
import type GourmetLifePlugin from "./main";

interface IngredientSuggestion {
	name: string;
	path: string;
}

export class IngredientSuggest extends EditorSuggest<IngredientSuggestion> {
	plugin: GourmetLifePlugin;

	constructor(plugin: GourmetLifePlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile | null
	): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.autoLinkEnabled) return null;
		if (!file) return null;

		// Only trigger in recipe notes
		const recipesFolder = this.plugin.settings.recipesFolder;
		if (!file.path.startsWith(recipesFolder + "/")) return null;

		const line = editor.getLine(cursor.line);
		const beforeCursor = line.substring(0, cursor.ch);

		// Find the last @ before cursor
		const lastAt = beforeCursor.lastIndexOf("@");
		if (lastAt === -1) return null;

		// Check if we're inside an already-completed @name{...} marker
		const afterAt = beforeCursor.substring(lastAt);
		const openBrace = afterAt.indexOf("{");
		if (openBrace !== -1) {
			// There's an opening brace after @
			const closeBrace = afterAt.indexOf("}", openBrace);
			if (closeBrace !== -1) {
				// Already completed — don't trigger
				return null;
			}
			// Inside braces (typing qty/unit) — don't trigger suggest
			return null;
		}

		// Extract the query after @
		const query = beforeCursor.substring(lastAt + 1);
		const minChars = this.plugin.settings.autoLinkMinChars;
		if (query.length < minChars) return null;

		return {
			start: { line: cursor.line, ch: lastAt },
			end: cursor,
			query,
		};
	}

	getSuggestions(
		context: EditorSuggestContext
	): IngredientSuggestion[] {
		const query = context.query.toLowerCase();
		const ingredientNames = this.plugin.noteIndex.getIngredientNames();
		const results: IngredientSuggestion[] = [];
		const seen = new Set<string>();

		for (const [name, path] of ingredientNames) {
			if (name.includes(query) && !seen.has(path)) {
				seen.add(path);
				// Use the file basename as display name
				const basename = path
					.substring(path.lastIndexOf("/") + 1)
					.replace(/\.md$/, "");
				results.push({ name: basename, path });
			}
		}

		return results;
	}

	renderSuggestion(
		suggestion: IngredientSuggestion,
		el: HTMLElement
	): void {
		el.createEl("span", { text: suggestion.name });
	}

	selectSuggestion(suggestion: IngredientSuggestion): void {
		if (!this.context) return;
		const { editor, start, end } = this.context;
		const replacement = `@${suggestion.name}{}`;
		editor.replaceRange(replacement, start, end);
		// Place cursor inside {} for quantity input
		const cursorPos = {
			line: start.line,
			ch: start.ch + replacement.length - 1,
		};
		editor.setCursor(cursorPos);
	}
}

// ── Batch Auto-Link ──

/**
 * Scan a recipe note body and link all unlinked ingredient names
 * using Cooklang @name{} syntax.
 * Returns the number of links added.
 */
export function batchLinkIngredients(
	content: string,
	ingredientNames: Map<string, string>
): { result: string; count: number } {
	// Split content into frontmatter and body
	const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
	if (!fmMatch) return { result: content, count: 0 };

	const frontmatter = fmMatch[0];
	let body = content.substring(frontmatter.length);

	// Build sorted entries: longest name first
	const entries = Array.from(ingredientNames.entries()).sort(
		(a, b) => b[0].length - a[0].length
	);

	// Build a map from lowercase name → display name (file basename)
	const displayNames = new Map<string, string>();
	for (const [name, path] of entries) {
		const basename = path
			.substring(path.lastIndexOf("/") + 1)
			.replace(/\.md$/, "");
		displayNames.set(name, basename);
	}

	let count = 0;

	// Find skip regions in body
	const skipRegions = findSkipRegions(body);

	for (const [name, _path] of entries) {
		const displayName = displayNames.get(name)!;
		const escaped = escapeRegex(name);
		const regex = new RegExp(`(?<=^|[\\s,;.!?()])${escaped}(?=[\\s,;.!?()]|$)`, "gi");

		let match: RegExpExecArray | null;
		const replacements: Array<{ start: number; end: number; text: string }> = [];

		while ((match = regex.exec(body)) !== null) {
			const start = match.index;
			const end = start + match[0].length;

			// Skip if inside a skip region
			if (isInSkipRegion(start, end, skipRegions)) continue;

			replacements.push({
				start,
				end,
				text: `@${displayName}{}`,
			});
			count++;
		}

		// Apply replacements in reverse order to maintain positions
		for (let i = replacements.length - 1; i >= 0; i--) {
			const r = replacements[i];
			body =
				body.substring(0, r.start) +
				r.text +
				body.substring(r.end);
		}

		// Recalculate skip regions after modifications
		if (replacements.length > 0) {
			skipRegions.length = 0;
			skipRegions.push(...findSkipRegions(body));
		}
	}

	return { result: frontmatter + body, count };
}

function findSkipRegions(
	text: string
): Array<{ start: number; end: number }> {
	const regions: Array<{ start: number; end: number }> = [];

	// Code blocks (``` ... ```)
	const codeBlockRegex = /```[\s\S]*?```/g;
	let match: RegExpExecArray | null;
	while ((match = codeBlockRegex.exec(text)) !== null) {
		regions.push({
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	// Inline code (`...`)
	const inlineCodeRegex = /`[^`]+`/g;
	while ((match = inlineCodeRegex.exec(text)) !== null) {
		regions.push({
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	// Cooklang ingredient markers (@name{...})
	const ingredientRegex = /@[^@#~{}\s][^{}]*\{[^}]*\}/g;
	while ((match = ingredientRegex.exec(text)) !== null) {
		regions.push({
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	// Cooklang tool markers (#name{...})
	const toolRegex = /#[^@#~{}\s][^{}]*\{[^}]*\}/g;
	while ((match = toolRegex.exec(text)) !== null) {
		regions.push({
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	// Cooklang timer markers (~{...})
	const timerRegex = /~\{[^}]*\}/g;
	while ((match = timerRegex.exec(text)) !== null) {
		regions.push({
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	// Wiki links ([[...]])
	const wikiLinkRegex = /\[\[[^\]]+\]\]/g;
	while ((match = wikiLinkRegex.exec(text)) !== null) {
		regions.push({
			start: match.index,
			end: match.index + match[0].length,
		});
	}

	return regions;
}

function isInSkipRegion(
	start: number,
	end: number,
	regions: Array<{ start: number; end: number }>
): boolean {
	for (const region of regions) {
		if (start >= region.start && end <= region.end) return true;
		if (start < region.end && end > region.start) return true;
	}
	return false;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

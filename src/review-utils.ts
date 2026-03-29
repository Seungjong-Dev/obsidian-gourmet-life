import type { App, TFile } from "obsidian";
import { IMAGE_EXTS } from "./constants";
import type { RestaurantVisit } from "./restaurant-parser";

/**
 * Format a recipe review entry as markdown.
 * Output: `- YYYY-MM-DD review text\n  ![[photo1]]\n  ![[photo2]]`
 */
export function formatRecipeReview(
	date: string,
	text: string,
	photos: string[],
	rating?: number
): string {
	const lines: string[] = [];
	const rateTag = rating && rating >= 1 && rating <= 5 ? `#rate/${rating}` : "";
	const body = text.trim();
	const parts = [date, rateTag, body].filter(Boolean).join(" ");
	lines.push(`- ${parts}`);
	if (photos.length > 0) {
		lines.push(`  > [!gallery]`);
		for (const photo of photos) {
			lines.push(`  > ![[${photo}]]`);
		}
	}
	return lines.join("\n");
}

/**
 * Format a restaurant visit review entry as markdown.
 * Output:
 * ```
 * - YYYY-MM-DD
 *   - Dish Name #rate/N — Comment
 *   General comment text
 *   > [!gallery]
 *   > ![[photo1]]
 *   > ![[photo2]]
 * ```
 */
export function formatRestaurantVisit(
	date: string,
	dishes: { name: string; rating: number; comment: string }[],
	comment: string,
	photos: string[]
): string {
	const lines: string[] = [];
	lines.push(`- ${date}`);
	for (const dish of dishes) {
		if (!dish.name.trim()) continue;
		let dishLine = `  - ${dish.name.trim()}`;
		if (dish.rating >= 1 && dish.rating <= 5) {
			dishLine += ` #rate/${dish.rating}`;
		}
		if (dish.comment.trim()) {
			dishLine += ` — ${dish.comment.trim()}`;
		}
		lines.push(dishLine);
	}
	if (comment.trim()) {
		lines.push(`  ${comment.trim()}`);
	}
	if (photos.length > 0) {
		lines.push(`  > [!gallery]`);
		for (const photo of photos) {
			lines.push(`  > ![[${photo}]]`);
		}
	}
	return lines.join("\n");
}

/**
 * Append a review markdown entry to the ## Reviews section of a note file.
 * If no ## Reviews section exists, one is created at the end.
 */
export async function appendReviewToFile(
	app: App,
	file: TFile,
	reviewMarkdown: string
): Promise<void> {
	const content = await app.vault.read(file);
	const reviewsHeadingRe = /^## Reviews\s*$/m;
	const match = content.match(reviewsHeadingRe);

	let newContent: string;
	if (match && match.index != null) {
		// Find the end of the reviews section (next ## heading or end of file)
		const afterHeading = match.index + match[0].length;
		const rest = content.substring(afterHeading);
		const nextHeadingMatch = rest.match(/\n## /);
		const insertPos = nextHeadingMatch?.index != null
			? afterHeading + nextHeadingMatch.index
			: content.length;

		// Ensure there's a blank line before the new entry
		const before = content.substring(0, insertPos).trimEnd();
		const after = content.substring(insertPos);
		newContent = before + "\n\n" + reviewMarkdown + "\n" + after;
	} else {
		// No ## Reviews section — add one at the end
		const trimmed = content.trimEnd();
		newContent = trimmed + "\n\n## Reviews\n\n" + reviewMarkdown + "\n";
	}

	await app.vault.modify(file, newContent);
}

/**
 * Import an image file (from a File/Blob) into the note type's folder
 * under a configurable subfolder and return the vault-relative path.
 *
 * For example, if the source note is in `Gourmet/Recipes/` and mediaFolder is "media",
 * the image is saved to `Gourmet/Recipes/media/photo.jpg`.
 */
export async function importImageToVault(
	app: App,
	sourceFile: TFile,
	blob: ArrayBuffer,
	filename: string,
	mediaFolder = "media"
): Promise<string> {
	// Use the source note's parent folder + media subfolder
	const parentFolder = sourceFile.parent?.path ?? "";
	const folderPath = parentFolder
		? `${parentFolder}/${mediaFolder}`
		: mediaFolder;

	// Use note name as base filename with original extension
	const ext = filename.substring(filename.lastIndexOf("."));
	const baseName = sourceFile.basename;

	let targetPath = `${folderPath}/${baseName}${ext}`;
	let counter = 1;
	while (app.vault.getAbstractFileByPath(targetPath)) {
		targetPath = `${folderPath}/${baseName}-${counter}${ext}`;
		counter++;
	}

	// Create attachments folder if needed
	if (!app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}

	await app.vault.createBinary(targetPath, blob);
	return targetPath;
}

/**
 * Check if a filename has an image extension.
 */
export function isImageFile(filename: string): boolean {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTS.includes(ext);
}

/**
 * Get today's date as YYYY-MM-DD string.
 */
export function todayString(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

// ── Review Section Helpers ──

/**
 * Find the start and end offsets of the ## Reviews section content in file text.
 * Returns the range after the heading line through the next ## heading or EOF.
 */
function findReviewsSectionRange(content: string): { start: number; end: number } | null {
	const headingMatch = content.match(/^## Reviews\s*$/m);
	if (!headingMatch || headingMatch.index == null) return null;
	const start = headingMatch.index + headingMatch[0].length;
	const rest = content.substring(start);
	const nextHeading = rest.match(/\n## /);
	const end = nextHeading?.index != null ? start + nextHeading.index : content.length;
	return { start, end };
}

/**
 * Replace a review entry in the ## Reviews section by matching its raw text.
 */
export async function replaceReviewInFile(
	app: App,
	file: TFile,
	oldRawText: string,
	newRawText: string
): Promise<void> {
	const content = await app.vault.read(file);
	const range = findReviewsSectionRange(content);
	if (!range) return;

	const section = content.substring(range.start, range.end);
	const idx = section.indexOf(oldRawText);
	if (idx < 0) return;

	const before = content.substring(0, range.start + idx);
	const after = content.substring(range.start + idx + oldRawText.length);
	await app.vault.modify(file, before + newRawText + after);
}

/**
 * Delete a review entry from the ## Reviews section by matching its raw text.
 */
export async function deleteReviewInFile(
	app: App,
	file: TFile,
	rawText: string
): Promise<void> {
	const content = await app.vault.read(file);
	const range = findReviewsSectionRange(content);
	if (!range) return;

	const section = content.substring(range.start, range.end);
	const idx = section.indexOf(rawText);
	if (idx < 0) return;

	// Clean up within the reviews section only to avoid reformatting other sections
	const sectionBefore = section.substring(0, idx);
	const sectionAfter = section.substring(idx + rawText.length);
	const cleanedSection = (sectionBefore + sectionAfter).replace(/\n{3,}/g, "\n\n");

	const newContent =
		content.substring(0, range.start) +
		cleanedSection +
		content.substring(range.end);

	await app.vault.modify(file, newContent);
}

// ── Review Prefill Extraction ──

export interface ReviewPrefill {
	date: string;
	rating?: number;
	text?: string;
	dishes?: { name: string; rating: number; comment: string }[];
	generalComment?: string;
	photos?: string[];
}

const RATE_TAG_RE = /#rate\/(\d)/;

/**
 * Extract prefill data from a parsed recipe review entry.
 */
export function extractRecipeReviewPrefill(entry: { date: string; lines: string[] }): ReviewPrefill {
	const photos: string[] = [];
	const textParts: string[] = [];
	let rating: number | undefined;

	for (const line of entry.lines) {
		// Skip gallery callout marker
		if (/^>\s*\[!gallery\]/.test(line)) continue;
		// Check for embeds (plain or gallery callout format)
		const embedMatch = line.match(/^>?\s*!\[\[([^\]]+)\]\]$/);
		if (embedMatch) {
			photos.push(embedMatch[1]);
			continue;
		}
		// Check for rating tag
		const rateMatch = line.match(RATE_TAG_RE);
		if (rateMatch && !rating) {
			rating = parseInt(rateMatch[1], 10);
			const cleaned = line.replace(RATE_TAG_RE, "").trim();
			if (cleaned) textParts.push(cleaned);
		} else {
			textParts.push(line);
		}
	}

	return {
		date: entry.date,
		rating,
		text: textParts.join("\n"),
		photos,
	};
}

/**
 * Extract prefill data from a parsed restaurant visit.
 */
export function extractRestaurantVisitPrefill(visit: RestaurantVisit): ReviewPrefill {
	const photos: string[] = [];
	const commentParts: string[] = [];

	for (const c of visit.generalComments) {
		// Extract image embeds from gallery callouts
		const embedMatch = c.match(/^>?\s*!\[\[([^\]]+)\]\]$/);
		if (embedMatch) {
			photos.push(embedMatch[1]);
			continue;
		}
		// Skip gallery callout marker
		if (/^>\s*\[!gallery\]/.test(c)) continue;
		commentParts.push(c);
	}

	const dishes = visit.dishReviews.map((d) => ({
		name: d.name,
		rating: d.rating ?? 0,
		comment: d.comment,
	}));

	return {
		date: visit.date,
		dishes,
		generalComment: commentParts.join("\n"),
		photos,
	};
}

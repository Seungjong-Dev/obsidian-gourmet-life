import type { App, TFile } from "obsidian";
import { splitFrontmatterBody } from "./view-utils";
import { IMAGE_EXTS } from "./constants";

/**
 * Format a recipe review entry as markdown.
 * Output: `- YYYY-MM-DD review text\n  ![[photo1]]\n  ![[photo2]]`
 */
export function formatRecipeReview(
	date: string,
	text: string,
	photos: string[]
): string {
	const lines: string[] = [];
	const body = text.trim();
	lines.push(`- ${date}${body ? " " + body : ""}`);
	for (const photo of photos) {
		lines.push(`  ![[${photo}]]`);
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
		newContent = before + "\n" + reviewMarkdown + "\n" + after;
	} else {
		// No ## Reviews section — add one at the end
		const trimmed = content.trimEnd();
		newContent = trimmed + "\n\n## Reviews\n\n" + reviewMarkdown + "\n";
	}

	await app.vault.modify(file, newContent);
}

/**
 * Import an image file (from a File/Blob) into the note type's folder
 * under an `attachments/` subfolder and return the vault-relative path.
 *
 * For example, if the source note is in `Gourmet/Recipes/`,
 * the image is saved to `Gourmet/Recipes/attachments/photo.jpg`.
 */
export async function importImageToVault(
	app: App,
	sourceFile: TFile,
	blob: ArrayBuffer,
	filename: string
): Promise<string> {
	// Use the source note's parent folder + attachments/ subfolder
	const parentFolder = sourceFile.parent?.path ?? "";
	const folderPath = parentFolder
		? `${parentFolder}/attachments`
		: "attachments";

	// Ensure unique filename
	let targetPath = `${folderPath}/${filename}`;
	let counter = 1;
	while (app.vault.getAbstractFileByPath(targetPath)) {
		const dotIdx = filename.lastIndexOf(".");
		const base = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
		const ext = dotIdx > 0 ? filename.substring(dotIdx) : "";
		targetPath = `${folderPath}/${base}-${counter}${ext}`;
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

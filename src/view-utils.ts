import type { App, TFile } from "obsidian";

/**
 * Extract display name from a file path (strip folder and .md extension).
 */
export function titleFromPath(filePath: string): string {
	return filePath
		.substring(filePath.lastIndexOf("/") + 1)
		.replace(/\.md$/, "");
}

/**
 * Resolve a wiki-link or filename to a vault resource URL.
 */
export function resolveResourcePath(
	app: App,
	path: string,
	sourcePath: string
): string {
	const cleaned = path.replace(/^\[\[|\]\]$/g, "");
	const resolved = app.metadataCache.getFirstLinkpathDest(
		cleaned,
		sourcePath
	);
	if (resolved) {
		return app.vault.adapter.getResourcePath(resolved.path);
	}
	const match = app.vault
		.getFiles()
		.find((f) => f.name === cleaned || f.path === cleaned);
	return app.vault.adapter.getResourcePath(match?.path ?? cleaned);
}

/**
 * Extract frontmatter block and body content from raw file text.
 */
export function splitFrontmatterBody(content: string): {
	fmBlock: string;
	body: string;
} {
	const match = content.match(/^---\n[\s\S]*?\n---\n?/);
	if (match) {
		return { fmBlock: match[0], body: content.substring(match[0].length) };
	}
	return { fmBlock: "", body: content };
}

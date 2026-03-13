import { EMBED_RE, IMAGE_EXTS } from "./constants";
import { showImageLightbox, type GalleryInfo } from "./recipe-main-panel";

/**
 * Check if text is a gallery callout marker: `[!gallery]` (with optional whitespace).
 */
export function isGalleryCalloutMarker(text: string): boolean {
	return text.trim().toLowerCase() === "[!gallery]";
}

/**
 * Post-process MarkdownRenderer output: convert `.callout[data-callout="gallery"]`
 * elements into `.gl-gallery` horizontal scroll strips with lightbox support.
 */
export function transformGalleryCallouts(container: HTMLElement): void {
	const callouts = container.querySelectorAll('.callout[data-callout="gallery"]');
	for (const callout of Array.from(callouts)) {
		const imgs = Array.from(callout.querySelectorAll("img"));
		if (imgs.length === 0) {
			// No images — just remove the hidden callout
			callout.remove();
			continue;
		}

		const gallery = document.createElement("div");
		gallery.className = "gl-gallery";

		const srcs = imgs.map((i) => i.src);
		const alts = imgs.map((i) => i.alt);

		for (let i = 0; i < imgs.length; i++) {
			const img = imgs[i];
			gallery.appendChild(img);
			img.style.cursor = "zoom-in";
			const idx = i;
			img.addEventListener("click", (e) => {
				e.stopPropagation();
				showImageLightbox(img.src, img.alt, { srcs, alts, index: idx });
			});
		}

		callout.replaceWith(gallery);
	}
}

/**
 * Check if a line (possibly with `> ` prefix) contains only image embeds.
 */
export function isImageOnlyLine(line: string): boolean {
	const stripped = line.replace(/^>\s*/, "");
	if (!stripped.trim()) return false;
	const withoutImages = stripped.replace(
		/!\[\[([^\]]+)\]\]/g,
		(m, filePath: string) => {
			const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
			return IMAGE_EXTS.includes(ext) ? "" : m;
		}
	);
	return !withoutImages.trim();
}

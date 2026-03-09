/**
 * Shared star-rating rendering with half-star support.
 *
 * Rounding rule for the fractional part:
 *   < 0.25  → empty star
 *   0.25–0.74 → half star
 *   ≥ 0.75  → full star
 */

const STAR_FULL = "\u2605";  // ★
const STAR_EMPTY = "\u2606"; // ☆

/**
 * Render star rating into a DOM container (clears existing children).
 */
export function renderStarsDom(
	container: HTMLElement,
	rating: number,
	max = 5
): void {
	const clamped = Math.max(0, Math.min(max, rating));
	const fullCount = Math.floor(clamped);
	const frac = clamped - fullCount;
	const hasHalf = frac >= 0.25 && frac < 0.75;
	const extraFull = frac >= 0.75 ? 1 : 0;
	const totalFull = fullCount + extraFull;
	const emptyCount = max - totalFull - (hasHalf ? 1 : 0);

	for (let i = 0; i < totalFull; i++) {
		container.createSpan({ text: STAR_FULL, cls: "gl-star gl-star--full" });
	}
	if (hasHalf) {
		const wrapper = container.createSpan({ cls: "gl-star gl-star--half" });
		wrapper.createSpan({ text: STAR_EMPTY, cls: "gl-star gl-star--empty" });
		wrapper.createSpan({ text: STAR_FULL, cls: "gl-star gl-star--half-fill" });
	}
	for (let i = 0; i < emptyCount; i++) {
		container.createSpan({ text: STAR_EMPTY, cls: "gl-star gl-star--empty" });
	}
}

/**
 * Return an HTML string of star rating (for innerHTML / popup use).
 */
export function renderStarsHtml(rating: number, max = 5): string {
	const clamped = Math.max(0, Math.min(max, rating));
	const fullCount = Math.floor(clamped);
	const frac = clamped - fullCount;
	const hasHalf = frac >= 0.25 && frac < 0.75;
	const extraFull = frac >= 0.75 ? 1 : 0;
	const totalFull = fullCount + extraFull;
	const emptyCount = max - totalFull - (hasHalf ? 1 : 0);

	let html = "";
	for (let i = 0; i < totalFull; i++) {
		html += `<span class="gl-star gl-star--full">${STAR_FULL}</span>`;
	}
	if (hasHalf) {
		html += `<span class="gl-star gl-star--half"><span class="gl-star gl-star--empty">${STAR_EMPTY}</span><span class="gl-star gl-star--half-fill">${STAR_FULL}</span></span>`;
	}
	for (let i = 0; i < emptyCount; i++) {
		html += `<span class="gl-star gl-star--empty">${STAR_EMPTY}</span>`;
	}
	return html;
}

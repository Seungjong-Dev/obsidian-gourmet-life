// ── Types ──────────────────────────────────────────────────

export interface CooklangIngredient {
	name: string;
	quantity: string;
	unit: string;
	raw: string;
}

export interface CooklangTool {
	name: string;
	raw: string;
}

export interface CooklangTimer {
	time: string;
	unit: string;
	raw: string;
}

export type CooklangSegment =
	| { type: "text"; value: string }
	| { type: "ingredient"; value: CooklangIngredient }
	| { type: "tool"; value: CooklangTool }
	| { type: "timer"; value: CooklangTimer };

export interface CooklangStep {
	segments: CooklangSegment[];
	section: string;
	isComment: boolean;
}

export interface CooklangParseResult {
	steps: CooklangStep[];
	ingredients: CooklangIngredient[];
	tools: CooklangTool[];
	timers: CooklangTimer[];
	comments: string[];
	sections: string[];
}

// ── Main Parser ────────────────────────────────────────────

/**
 * Parse a Cooklang recipe body into structured data.
 * Processes only the recipe content zone (before ## Notes / ## Reviews).
 */
export function parseCooklangBody(body: string): CooklangParseResult {
	const content = getRecipeContentZone(body);
	const lines = content.split("\n");

	const steps: CooklangStep[] = [];
	const allIngredients: CooklangIngredient[] = [];
	const allTools: CooklangTool[] = [];
	const allTimers: CooklangTimer[] = [];
	const comments: string[] = [];
	const sections: string[] = [];
	let currentSection = "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		// Hidden comment (-- text)
		if (trimmed.startsWith("--")) {
			continue;
		}

		// Section header (== name ==)
		const sectionMatch = trimmed.match(/^==\s*(.+?)\s*==$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1];
			sections.push(currentSection);
			continue;
		}

		// Visible comment (> text)
		if (trimmed.startsWith(">")) {
			const commentText = trimmed.substring(1).trim();
			comments.push(commentText);
			steps.push({
				segments: [{ type: "text", value: commentText }],
				section: currentSection,
				isComment: true,
			});
			continue;
		}

		// Regular step line — parse for @, #, ~ markers
		const segments = parseCooklangLine(trimmed);

		// Collect ingredients, tools, timers
		for (const seg of segments) {
			if (seg.type === "ingredient") allIngredients.push(seg.value);
			if (seg.type === "tool") allTools.push(seg.value);
			if (seg.type === "timer") allTimers.push(seg.value);
		}

		steps.push({ segments, section: currentSection, isComment: false });
	}

	return {
		steps,
		ingredients: allIngredients,
		tools: deduplicateTools(allTools),
		timers: allTimers,
		comments,
		sections,
	};
}

/**
 * Parse a single Cooklang line into segments using a scanner approach.
 * Handles: @name{qty%unit}, #name{}, ~{time%unit}
 */
export function parseCooklangLine(line: string): CooklangSegment[] {
	const segments: CooklangSegment[] = [];
	let i = 0;
	let textBuf = "";

	const flushText = () => {
		if (textBuf) {
			segments.push({ type: "text", value: textBuf });
			textBuf = "";
		}
	};

	while (i < line.length) {
		// Timer: ~{time%unit}
		if (line[i] === "~" && i + 1 < line.length && line[i + 1] === "{") {
			flushText();
			const start = i;
			i += 2; // skip ~{
			let inner = "";
			while (i < line.length && line[i] !== "}") {
				inner += line[i];
				i++;
			}
			if (i < line.length) i++; // skip }
			const raw = line.substring(start, i);
			const [time, unit] = splitQtyUnit(inner);
			segments.push({
				type: "timer",
				value: { time, unit, raw },
			});
			continue;
		}

		// Ingredient: @name{qty%unit} or @name (single word)
		if (line[i] === "@") {
			flushText();
			const start = i;
			i++; // skip @
			let name = "";

			// Read name until { or whitespace
			while (i < line.length && line[i] !== "{" && !isBreakChar(line[i])) {
				name += line[i];
				i++;
			}

			if (i < line.length && line[i] === "{") {
				// Has braces — read qty%unit
				i++; // skip {
				let inner = "";
				while (i < line.length && line[i] !== "}") {
					inner += line[i];
					i++;
				}
				if (i < line.length) i++; // skip }
				const raw = line.substring(start, i);
				const [quantity, unit] = splitQtyUnit(inner);
				segments.push({
					type: "ingredient",
					value: { name: name.trim(), quantity, unit, raw },
				});
			} else {
				// No braces — single word ingredient
				const raw = line.substring(start, i);
				segments.push({
					type: "ingredient",
					value: { name: name.trim(), quantity: "", unit: "", raw },
				});
			}
			continue;
		}

		// Tool: #name{}
		if (line[i] === "#") {
			flushText();
			const start = i;
			i++; // skip #
			let name = "";

			while (i < line.length && line[i] !== "{" && !isBreakChar(line[i])) {
				name += line[i];
				i++;
			}

			if (i < line.length && line[i] === "{") {
				i++; // skip {
				// Read and discard inner content
				while (i < line.length && line[i] !== "}") i++;
				if (i < line.length) i++; // skip }
			}

			const raw = line.substring(start, i);
			segments.push({
				type: "tool",
				value: { name: name.trim(), raw },
			});
			continue;
		}

		// Plain text
		textBuf += line[i];
		i++;
	}

	flushText();
	return segments;
}

// ── Content Zone Extraction ────────────────────────────────

/**
 * Extract the recipe content zone from the body.
 * Returns everything before ## Notes or ## Reviews.
 */
export function getRecipeContentZone(body: string): string {
	const lines = body.split("\n");
	const endSections = ["notes", "reviews"];
	const resultLines: string[] = [];

	for (const line of lines) {
		const match = line.match(/^##\s+(.+)/);
		if (match && endSections.includes(match[1].trim().toLowerCase())) {
			break;
		}
		resultLines.push(line);
	}

	return resultLines.join("\n");
}

// ── Grouped Extraction ─────────────────────────────────────

/**
 * Extract ingredients grouped by section.
 */
export function extractCooklangIngredientsGrouped(
	body: string
): Map<string, CooklangIngredient[]> {
	const content = getRecipeContentZone(body);
	const lines = content.split("\n");
	const grouped = new Map<string, CooklangIngredient[]>();
	let currentSection = "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const sectionMatch = trimmed.match(/^==\s*(.+?)\s*==$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1];
			continue;
		}

		if (trimmed.startsWith("--") || trimmed.startsWith(">")) continue;

		const segments = parseCooklangLine(trimmed);
		for (const seg of segments) {
			if (seg.type === "ingredient") {
				const key = currentSection || "";
				if (!grouped.has(key)) grouped.set(key, []);
				grouped.get(key)!.push(seg.value);
			}
		}
	}

	return grouped;
}

/**
 * Extract all tools from a Cooklang body.
 */
export function extractCooklangTools(body: string): CooklangTool[] {
	const { tools } = parseCooklangBody(body);
	return tools;
}

/**
 * Extract all timers from a Cooklang body.
 */
export function extractCooklangTimers(body: string): CooklangTimer[] {
	const { timers } = parseCooklangBody(body);
	return timers;
}

/**
 * Calculate total time from timers in minutes.
 * Returns null if no timers are present.
 */
export function calculateTotalTime(timers: CooklangTimer[]): number | null {
	if (timers.length === 0) return null;

	let totalMinutes = 0;
	for (const t of timers) {
		const num = parseFloat(t.time);
		if (isNaN(num)) continue;

		const u = t.unit.toLowerCase();
		if (u === "초" || u === "s" || u === "sec" || u === "seconds") {
			totalMinutes += num / 60;
		} else if (u === "분" || u === "m" || u === "min" || u === "minutes") {
			totalMinutes += num;
		} else if (u === "시간" || u === "h" || u === "hr" || u === "hours") {
			totalMinutes += num * 60;
		} else {
			// Default: assume minutes
			totalMinutes += num;
		}
	}

	return totalMinutes > 0 ? Math.round(totalMinutes) : null;
}

// ── Parsing Notes & Reviews ────────────────────────────────

/**
 * Parse the ## Notes section content.
 */
export function parseNotesSection(body: string): string {
	return parseSectionContent(body, "notes");
}

/**
 * Parse the ## Reviews section content.
 */
export function parseReviewsSection(body: string): string {
	return parseSectionContent(body, "reviews");
}

function parseSectionContent(body: string, sectionName: string): string {
	const lines = body.split("\n");
	let inSection = false;
	const resultLines: string[] = [];

	for (const line of lines) {
		const match = line.match(/^##\s+(.+)/);
		if (match) {
			if (inSection) break;
			if (match[1].trim().toLowerCase() === sectionName) {
				inSection = true;
			}
			continue;
		}

		if (inSection) {
			resultLines.push(line);
		}
	}

	// Trim leading/trailing empty lines
	while (resultLines.length > 0 && !resultLines[0].trim()) {
		resultLines.shift();
	}
	while (resultLines.length > 0 && !resultLines[resultLines.length - 1].trim()) {
		resultLines.pop();
	}

	return resultLines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────

function splitQtyUnit(inner: string): [string, string] {
	const idx = inner.indexOf("%");
	if (idx === -1) return [inner.trim(), ""];
	return [inner.substring(0, idx).trim(), inner.substring(idx + 1).trim()];
}

function isBreakChar(ch: string): boolean {
	// Break on punctuation that can't be part of an ingredient/tool name
	// Allow spaces, hyphens, Korean chars, etc. in names
	return ch === "," || ch === "." || ch === "!" || ch === "?" ||
		ch === ";" || ch === ":" || ch === ")" || ch === "(" ||
		ch === "\n" || ch === "\t";
}

function deduplicateTools(tools: CooklangTool[]): CooklangTool[] {
	const seen = new Set<string>();
	const result: CooklangTool[] = [];
	for (const t of tools) {
		const key = t.name.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			result.push(t);
		}
	}
	return result;
}

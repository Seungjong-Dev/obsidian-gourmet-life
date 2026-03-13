import { SECTION_HEADING_RE } from "./constants";

export interface IngredientSections {
	storagePrep: string;
	notes: string;
	purchaseLog: string;
}

export function parseIngredientSections(body: string): IngredientSections {
	const sections: Record<string, string[]> = {};
	let currentSection = "";
	const lines = body.split("\n");

	for (const line of lines) {
		const match = line.match(SECTION_HEADING_RE);
		if (match) {
			currentSection = match[1].trim().toLowerCase();
			continue;
		}
		if (currentSection) {
			if (!sections[currentSection]) sections[currentSection] = [];
			sections[currentSection].push(line);
		}
	}

	const trimSection = (key: string): string => {
		const s = (sections[key] || []).join("\n");
		return s.replace(/^\n+|\n+$/g, "");
	};

	return {
		storagePrep: trimSection("storage & prep"),
		notes: trimSection("notes"),
		purchaseLog: trimSection("purchase log"),
	};
}

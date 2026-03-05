// ── Restaurant Parser ──
// Parses restaurant note body sections: Menu Highlights, Notes, Reviews
// Reviews use visit-based structure with dish reviews and general comments

export interface DishReview {
	name: string;
	rating?: number;
	comment: string;
}

export interface RestaurantVisit {
	date: string;
	dishReviews: DishReview[];
	generalComments: string[];
}

export interface RestaurantMenuItem {
	name: string;
	description: string;
}

export interface GeoCoords {
	lat: number;
	lng: number;
}

// ── Section Parsing ──

export function parseRestaurantSections(body: string): {
	menuHighlights: string;
	notes: string;
	reviews: string;
} {
	const sections: Record<string, string[]> = {};
	let currentSection = "";
	const lines = body.split("\n");

	for (const line of lines) {
		const match = line.match(/^##\s+(.+)/);
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
		menuHighlights: trimSection("menu highlights"),
		notes: trimSection("notes"),
		reviews: trimSection("reviews"),
	};
}

// ── Menu Highlights Parser ──

export function parseMenuHighlights(text: string): RestaurantMenuItem[] {
	const items: RestaurantMenuItem[] = [];
	for (const line of text.split("\n")) {
		const m = line.match(/^-\s+(.+)/);
		if (!m) continue;
		const content = m[1].trim();
		const dashIdx = content.indexOf(" — ");
		if (dashIdx >= 0) {
			items.push({
				name: content.substring(0, dashIdx).trim(),
				description: content.substring(dashIdx + 3).trim(),
			});
		} else {
			items.push({ name: content, description: "" });
		}
	}
	return items;
}

// ── Reviews Parser ──

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /#rate\/(\d)/;

function parseDishOrComment(text: string): { dish: DishReview | null; comment: string | null } {
	const dashIdx = text.indexOf(" — ");
	if (dashIdx >= 0) {
		const before = text.substring(0, dashIdx).trim();
		const after = text.substring(dashIdx + 3).trim();
		const rateMatch = before.match(RATE_RE);
		if (rateMatch) {
			const name = before.replace(RATE_RE, "").trim();
			return {
				dish: { name, rating: parseInt(rateMatch[1], 10), comment: after },
				comment: null,
			};
		}
		return {
			dish: { name: before, comment: after },
			comment: null,
		};
	}
	const rateMatch = text.match(RATE_RE);
	if (rateMatch) {
		const name = text.replace(RATE_RE, "").trim();
		return {
			dish: { name, rating: parseInt(rateMatch[1], 10), comment: "" },
			comment: null,
		};
	}
	return { dish: null, comment: text };
}

export function parseRestaurantVisits(reviewsText: string): RestaurantVisit[] {
	const visits: RestaurantVisit[] = [];
	const lines = reviewsText.split("\n");

	for (const line of lines) {
		// Top-level list item
		const topMatch = line.match(/^-\s+(.*)/);
		if (topMatch) {
			const content = topMatch[1].trim();
			// Check if starts with date
			const dateMatch = content.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)/);
			if (dateMatch) {
				const date = dateMatch[1];
				const rest = dateMatch[2].trim();
				const visit: RestaurantVisit = {
					date,
					dishReviews: [],
					generalComments: [],
				};
				if (rest) {
					const { dish, comment } = parseDishOrComment(rest);
					if (dish) visit.dishReviews.push(dish);
					else if (comment) visit.generalComments.push(comment);
				}
				visits.push(visit);
			} else {
				// No date — treat as standalone visit
				const visit: RestaurantVisit = {
					date: "",
					dishReviews: [],
					generalComments: [],
				};
				const { dish, comment } = parseDishOrComment(content);
				if (dish) visit.dishReviews.push(dish);
				else if (comment) visit.generalComments.push(comment);
				visits.push(visit);
			}
			continue;
		}

		// Sub-level list item (indented)
		const subMatch = line.match(/^\s+-\s+(.*)/);
		if (subMatch && visits.length > 0) {
			const content = subMatch[1].trim();
			const { dish, comment } = parseDishOrComment(content);
			const currentVisit = visits[visits.length - 1];
			if (dish) currentVisit.dishReviews.push(dish);
			else if (comment) currentVisit.generalComments.push(comment);
			continue;
		}

		// Continuation text for the last visit
		if (line.trim() && visits.length > 0) {
			visits[visits.length - 1].generalComments.push(line.trim());
		}
	}

	return visits;
}

// ── Rating Computation ──

export function computeVisitRating(visit: RestaurantVisit): number | null {
	const rated = visit.dishReviews.filter((d) => d.rating != null);
	if (rated.length === 0) return null;
	const sum = rated.reduce((acc, d) => acc + d.rating!, 0);
	return sum / rated.length;
}

export function computeOverallRating(visits: RestaurantVisit[]): number | null {
	const allRated = visits.flatMap((v) => v.dishReviews).filter((d) => d.rating != null);
	if (allRated.length === 0) return null;
	const sum = allRated.reduce((acc, d) => acc + d.rating!, 0);
	return sum / allRated.length;
}

export function computeVisitStats(visits: RestaurantVisit[]): {
	count: number;
	lastVisit: string;
} {
	const dated = visits.filter((v) => v.date).sort((a, b) => b.date.localeCompare(a.date));
	return {
		count: visits.length,
		lastVisit: dated.length > 0 ? dated[0].date : "",
	};
}

export function getAllDishes(visits: RestaurantVisit[]): string[] {
	const set = new Set<string>();
	for (const v of visits) {
		for (const d of v.dishReviews) {
			set.add(d.name);
		}
	}
	return Array.from(set);
}

export function getTopDishes(visits: RestaurantVisit[], limit = 5): DishReview[] {
	const dishMap = new Map<string, { totalRating: number; count: number; comment: string }>();
	for (const v of visits) {
		for (const d of v.dishReviews) {
			if (d.rating == null) continue;
			const key = d.name.toLowerCase();
			const existing = dishMap.get(key);
			if (existing) {
				existing.totalRating += d.rating;
				existing.count += 1;
			} else {
				dishMap.set(key, { totalRating: d.rating, count: 1, comment: d.comment });
			}
		}
	}
	return Array.from(dishMap.entries())
		.map(([, v]) => ({
			name: v.comment ? v.comment : "",
			rating: Math.round((v.totalRating / v.count) * 10) / 10,
			comment: v.comment,
		}))
		.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
		.slice(0, limit);
}

// ── Geo Coordinate Extraction ──

export function extractCoordsFromUrl(url: string): GeoCoords | null {
	if (!url) return null;

	// Google Maps: /@37.4979,127.0276 or @37.4979,127.0276
	const googleMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
	if (googleMatch) {
		return { lat: parseFloat(googleMatch[1]), lng: parseFloat(googleMatch[2]) };
	}

	// Naver Maps: c=127.0276,37.4979 (lng,lat order)
	const naverMatch = url.match(/[?&]c=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
	if (naverMatch) {
		return { lat: parseFloat(naverMatch[2]), lng: parseFloat(naverMatch[1]) };
	}

	// Kakao Maps: /map/name,37.4979,127.0276
	const kakaoMatch = url.match(/\/map\/[^,]*,(-?\d+\.?\d*),(-?\d+\.?\d*)/);
	if (kakaoMatch) {
		return { lat: parseFloat(kakaoMatch[1]), lng: parseFloat(kakaoMatch[2]) };
	}

	return null;
}

export async function geocodeAddress(address: string): Promise<GeoCoords | null> {
	try {
		const encoded = encodeURIComponent(address);
		const resp = await fetch(
			`https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
			{
				headers: { "User-Agent": "ObsidianGourmetLife/1.0" },
			}
		);
		if (!resp.ok) return null;
		const data = await resp.json();
		if (data.length === 0) return null;
		return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
	} catch {
		return null;
	}
}

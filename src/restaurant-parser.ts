// ── Restaurant Parser ──
// Parses restaurant note body sections: Menu Highlights, Notes, Reviews
// Reviews use visit-based structure with dish reviews and general comments

import { requestUrl } from "obsidian";

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

interface SyncMapUrlRule {
	name: string;
	test: RegExp;
	extract: (url: string) => GeoCoords | null;
}

interface AsyncMapUrlRule {
	name: string;
	test: RegExp;
	fetch: (url: string) => Promise<GeoCoords | null>;
}

const SYNC_MAP_RULES: SyncMapUrlRule[] = [
	{
		name: "Google Maps",
		test: /@-?\d+\.?\d*,-?\d+\.?\d*/,
		extract: (url) => {
			const m = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
			return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
		},
	},
	{
		name: "Naver Maps",
		test: /[?&]c=-?\d+\.?\d*,-?\d+\.?\d*/,
		extract: (url) => {
			const m = url.match(/[?&]c=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
			return m ? { lat: parseFloat(m[2]), lng: parseFloat(m[1]) } : null;
		},
	},
	{
		name: "Kakao Maps",
		test: /\/map\/[^,]*,-?\d+\.?\d*,-?\d+\.?\d*/,
		extract: (url) => {
			const m = url.match(/\/map\/[^,]*,(-?\d+\.?\d*),(-?\d+\.?\d*)/);
			return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
		},
	},
];

/** Extract "x" (lng) and "y" (lat) from JSON embedded in HTML */
function parseXYFromHtml(html: string): GeoCoords | null {
	const xMatch = html.match(/"x"\s*:\s*"(-?\d+\.?\d*)"/);
	const yMatch = html.match(/"y"\s*:\s*"(-?\d+\.?\d*)"/);
	if (xMatch && yMatch) {
		const lng = parseFloat(xMatch[1]);
		const lat = parseFloat(yMatch[1]);
		if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
	}
	return null;
}

/** Extract og:latitude / og:longitude meta tags from HTML */
function parseOgCoordsFromHtml(html: string): GeoCoords | null {
	const latMatch = html.match(/<meta\s[^>]*property=["']og:latitude["'][^>]*content=["']([^"']+)["']/);
	const lngMatch = html.match(/<meta\s[^>]*property=["']og:longitude["'][^>]*content=["']([^"']+)["']/);
	if (latMatch && lngMatch) {
		const lat = parseFloat(latMatch[1]);
		const lng = parseFloat(lngMatch[1]);
		if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
	}
	return null;
}

/**
 * Follow redirect chain using Node's https (no auto-follow, no CORS).
 * Returns the final URL after up to `maxHops` redirects.
 */
function followRedirects(startUrl: string, maxHops = 5): Promise<string> {
	const nodeHttps = (window as any).require("https");
	const nodeHttp = (window as any).require("http");
	return new Promise((resolve) => {
		let current = startUrl;
		let hops = 0;
		const next = () => {
			if (hops >= maxHops) { resolve(current); return; }
			const mod = current.startsWith("https") ? nodeHttps : nodeHttp;
			const req = mod.get(current, (res: any) => {
				res.resume();
				const loc: string = res.headers.location || "";
				if (loc && res.statusCode >= 300 && res.statusCode < 400) {
					hops++;
					// Handle relative redirects
					current = loc.startsWith("http") ? loc : new URL(loc, current).href;
					next();
				} else {
					resolve(current);
				}
			});
			req.on("error", () => resolve(current));
		};
		next();
	});
}

const ASYNC_MAP_RULES: AsyncMapUrlRule[] = [
	{
		name: "Google Maps (short URL)",
		test: /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//,
		fetch: async (url) => {
			try {
				const resolved = await followRedirects(url);
				const m = resolved.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
				return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
			} catch {
				return null;
			}
		},
	},
	{
		name: "Kakao Place",
		test: /^https?:\/\/place\.map\.kakao\.com\/\d+/,
		fetch: async (url) => {
			try {
				const resp = await requestUrl({ url });
				const html = resp.text;

				const staticMapMatch = html.match(
					/staticmap\.kakao\.com[^"']*[?&]m=(-?\d+\.?\d*)(?:,|%2C)(-?\d+\.?\d*)/,
				);
				if (staticMapMatch) {
					const lng = parseFloat(staticMapMatch[1]);
					const lat = parseFloat(staticMapMatch[2]);
					if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
				}

				return parseOgCoordsFromHtml(html);
			} catch {
				return null;
			}
		},
	},
	{
		name: "Naver Place",
		test: /^https?:\/\/(naver\.me\/|map\.naver\.com\/p\/(entry\/place|search)\/)/,
		fetch: async (url) => {
			try {
				// Extract place ID from URL or resolve short URL via redirect
				let placeId: string | null = null;
				const directMatch = url.match(/\/place\/(\d+)/);
				if (directMatch) {
					placeId = directMatch[1];
				} else {
					// naver.me short URL: resolve redirects to find place ID in URL
					const resolved = await followRedirects(url);
					const resolvedMatch = resolved.match(/\/place\/(\d+)/);
					if (resolvedMatch) placeId = resolvedMatch[1];
				}
				if (!placeId) return null;

				// Fetch mobile place page with mobile UA (required for SSR data)
				const mobileUrl = `https://m.place.naver.com/restaurant/${placeId}/home`;
				const resp = await requestUrl({
					url: mobileUrl,
					headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)" },
				});
				return parseXYFromHtml(resp.text);
			} catch {
				return null;
			}
		},
	},
];

export function extractCoordsFromUrl(url: string): GeoCoords | null {
	if (!url) return null;
	for (const rule of SYNC_MAP_RULES) {
		if (rule.test.test(url)) {
			const coords = rule.extract(url);
			if (coords) return coords;
		}
	}
	return null;
}

export async function fetchCoordsFromUrl(url: string): Promise<GeoCoords | null> {
	if (!url) return null;
	for (const rule of ASYNC_MAP_RULES) {
		if (rule.test.test(url)) {
			const coords = await rule.fetch(url);
			if (coords) return coords;
		}
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

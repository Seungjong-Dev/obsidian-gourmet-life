import * as L from "leaflet";
import type { GourmetNote, RestaurantFrontmatter } from "./types";
import { LEAFLET_CSS } from "./restaurant-side-panel";

const activeMaps = new WeakMap<HTMLElement, L.Map>();
const activeMarkers = new WeakMap<HTMLElement, Map<string, L.Marker>>();
const pendingRAFs = new WeakMap<HTMLElement, number>();

export function destroyExplorerMap(container: HTMLElement): void {
	const raf = pendingRAFs.get(container);
	if (raf != null) {
		cancelAnimationFrame(raf);
		pendingRAFs.delete(container);
	}
	const map = activeMaps.get(container);
	if (map) {
		map.remove();
		activeMaps.delete(container);
	}
	activeMarkers.delete(container);
}

export function hasExplorerMap(container: HTMLElement): boolean {
	return activeMaps.has(container);
}

export function updateMapSelection(container: HTMLElement, selectedPath: string | null): void {
	const markers = activeMarkers.get(container);
	if (!markers) return;

	for (const [path, marker] of markers) {
		const isSelected = path === selectedPath;
		const color = isSelected ? "var(--interactive-accent, #7c3aed)" : "#e74c3c";
		const icon = L.divIcon({
			className: "gl-map-marker",
			html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>`,
			iconSize: [24, 36],
			iconAnchor: [12, 36],
			popupAnchor: [0, -36],
		});
		marker.setIcon(icon);
	}
}

export function renderMapView(
	container: HTMLElement,
	restaurants: GourmetNote[],
	onSelect: (path: string) => void,
	selectedPath: string | null
): void {
	destroyExplorerMap(container);
	container.empty();
	container.addClass("gl-explorer__map-container");

	// Filter restaurants with coordinates
	const withCoords = restaurants.filter((r) => {
		const fm = r.frontmatter as RestaurantFrontmatter;
		return fm.lat != null && fm.lng != null;
	});

	if (withCoords.length === 0) {
		container.createDiv({
			cls: "gl-explorer__empty",
			text: "No restaurants with coordinates",
		});
		return;
	}

	// Inject Leaflet CSS if needed
	if (!document.getElementById("gl-leaflet-css")) {
		const style = document.createElement("style");
		style.id = "gl-leaflet-css";
		style.textContent = LEAFLET_CSS;
		document.head.appendChild(style);
	}

	const mapEl = container.createDiv({ cls: "gl-explorer__map-inner" });

	const rafId = requestAnimationFrame(() => {
		pendingRAFs.delete(container);
		if (!mapEl.isConnected) return;

		try {
			const map = L.map(mapEl, {
				zoomControl: true,
				attributionControl: false,
			});
			activeMaps.set(container, map);

			L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 19,
			}).addTo(map);

			const bounds = L.latLngBounds([]);
			const markers = new Map<string, L.Marker>();

			for (const r of withCoords) {
				const fm = r.frontmatter as RestaurantFrontmatter;
				const lat = fm.lat!;
				const lng = fm.lng!;
				const isSelected = r.path === selectedPath;

				const markerColor = isSelected ? "var(--interactive-accent, #7c3aed)" : "#e74c3c";
				const markerIcon = L.divIcon({
					className: "gl-map-marker",
					html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${markerColor}"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>`,
					iconSize: [24, 36],
					iconAnchor: [12, 36],
					popupAnchor: [0, -36],
				});

				const marker = L.marker([lat, lng], { icon: markerIcon }).addTo(map);

				// Permanent tooltip with restaurant name
				marker.bindTooltip(escapeHtml(r.name), {
					permanent: true,
					direction: "top",
					className: "gl-map-tooltip",
					offset: [0, -36],
				});

				// Popup content
				const lines: string[] = [`<strong>${escapeHtml(r.name)}</strong>`];
				if (fm.cuisine) lines.push(`<span class="gl-map-popup__cuisine">${escapeHtml(fm.cuisine)}</span>`);
				if (fm.price_range) lines.push(`<span class="gl-map-popup__price">${escapeHtml(fm.price_range)}</span>`);
				if (fm.rating != null) lines.push(`<span class="gl-map-popup__rating">${"\u2605".repeat(Math.round(fm.rating))}</span>`);
				marker.bindPopup(lines.join("<br>"), { className: "gl-map-popup" });

				marker.on("click", () => {
					onSelect(r.path);
				});

				markers.set(r.path, marker);
				bounds.extend([lat, lng]);
			}

			activeMarkers.set(container, markers);

			if (withCoords.length === 1) {
				const fm = withCoords[0].frontmatter as RestaurantFrontmatter;
				map.setView([fm.lat!, fm.lng!], 15);
			} else {
				map.fitBounds(bounds, { padding: [30, 30] });
			}
		} catch (err) {
			console.error("[GourmetLife] Explorer map render failed:", err);
			mapEl.empty();
			mapEl.createDiv({
				cls: "gl-explorer__empty",
				text: "Failed to load map. Check console for details.",
			});
		}
	});

	pendingRAFs.set(container, rafId);
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

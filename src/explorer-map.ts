import * as L from "leaflet";
import type { GourmetNote, RestaurantFrontmatter } from "./types";
import { LEAFLET_CSS } from "./restaurant-side-panel";

const TOOLTIP_ZOOM_THRESHOLD = 13;
const TOOLTIP_OVERLAP_PX = 60;

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

	const map = activeMaps.get(container);

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

		if (isSelected && map) {
			map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15));
		}
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
				zoomSnap: 0,
				scrollWheelZoom: false,
			});
			activeMaps.set(container, map);
			enableSmoothWheelZoom(map);

			L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 19,
				detectRetina: true,
				updateWhenZooming: false,
			}).addTo(map);

			L.control.scale({ metric: true, imperial: false }).addTo(map);

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

				const marker = L.marker([lat, lng], { icon: markerIcon, riseOnHover: true }).addTo(map);

				// Tooltip with restaurant name (permanent at high zoom)
				marker.bindTooltip(escapeHtml(r.name), {
					permanent: false,
					direction: "top",
					offset: [0, -36],
				});

				// Popup content
				const lines: string[] = [`<strong>${escapeHtml(r.name)}</strong>`];
				if (fm.cuisine) lines.push(`<span class="gl-map-popup__cuisine">${escapeHtml(fm.cuisine)}</span>`);
				if (fm.price_range) lines.push(`<span class="gl-map-popup__price">${escapeHtml(fm.price_range)}</span>`);
				if (fm.rating != null) lines.push(`<span class="gl-map-popup__rating">${"\u2605".repeat(Math.round(fm.rating))}</span>`);
				marker.bindPopup(lines.join("<br>"));

				marker.on("click", () => {
					onSelect(r.path);
				});

				markers.set(r.path, marker);
				bounds.extend([lat, lng]);
			}

			activeMarkers.set(container, markers);

			map.on("zoomend", () => {
				updateTooltipVisibility(map, markers);
			});

			if (withCoords.length === 1) {
				const fm = withCoords[0].frontmatter as RestaurantFrontmatter;
				map.setView([fm.lat!, fm.lng!], 15);
			} else if (bounds.isValid()) {
				map.fitBounds(bounds, { padding: [30, 30] });
			}

			updateTooltipVisibility(map, markers);
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

function enableSmoothWheelZoom(map: L.Map): void {
	const ZOOM_SPEED = 1 / 300;
	const LERP_FACTOR = 0.15;
	const EPSILON = 0.005;

	let targetZoom = map.getZoom();
	let displayZoom = targetZoom;
	let rafId: number | null = null;

	function animate() {
		try {
			const diff = targetZoom - displayZoom;
			if (Math.abs(diff) < EPSILON) {
				displayZoom = targetZoom;
				map.setView(map.getCenter(), targetZoom, { animate: false });
				rafId = null;
				return;
			}
			displayZoom += diff * LERP_FACTOR;
			map.fire("zoomanim", {
				center: map.getCenter(),
				zoom: displayZoom,
				noUpdate: true,
			});
			rafId = requestAnimationFrame(animate);
		} catch {
			rafId = null;
		}
	}

	map.getContainer().addEventListener("wheel", (e) => {
		e.preventDefault();
		const delta = -e.deltaY * ZOOM_SPEED;
		const min = map.getMinZoom();
		const max = map.getMaxZoom();
		targetZoom = Math.max(min, Math.min(max, targetZoom + delta));
		if (rafId == null) rafId = requestAnimationFrame(animate);
	}, { passive: false });

	map.on("zoomend", () => {
		targetZoom = map.getZoom();
		displayZoom = targetZoom;
	});
}

function updateTooltipVisibility(map: L.Map, markers: Map<string, L.Marker>): void {
	const zoom = map.getZoom();
	if (zoom < TOOLTIP_ZOOM_THRESHOLD) {
		for (const marker of markers.values()) marker.closeTooltip();
		return;
	}

	const thresholdSq = TOOLTIP_OVERLAP_PX * TOOLTIP_OVERLAP_PX;
	const opened: L.Point[] = [];

	for (const marker of markers.values()) {
		const pt = map.latLngToContainerPoint(marker.getLatLng());
		let tooClose = false;
		for (const op of opened) {
			const dx = pt.x - op.x;
			const dy = pt.y - op.y;
			if (dx * dx + dy * dy < thresholdSq) {
				tooClose = true;
				break;
			}
		}
		if (tooClose) {
			marker.closeTooltip();
		} else {
			marker.openTooltip();
			opened.push(pt);
		}
	}
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

import * as L from "leaflet";
import type { GourmetNote, RestaurantFrontmatter } from "./types";
import { LEAFLET_CSS } from "./restaurant-side-panel";
import { renderStarsHtml } from "./render-utils";

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

	// Close any open popups when deselecting
	if (!selectedPath && map) {
		map.closePopup();
	}

	for (const [path, marker] of markers) {
		const isSelected = path === selectedPath;
		const color = isSelected ? "var(--interactive-accent, #7c3aed)" : "#e74c3c";
		const icon = L.divIcon({
			className: "gl-map-marker",
			html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="27" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>`,
			iconSize: [18, 27],
			iconAnchor: [9, 27],
			popupAnchor: [0, -27],
		});
		marker.setIcon(icon);

		if (isSelected && map) {
			map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15));
			marker.openPopup();
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
				zoomControl: false,
				attributionControl: false,
				zoomSnap: 0,
				scrollWheelZoom: false,
			});
			activeMaps.set(container, map);

			const tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 19,
				updateWhenZooming: false,
				keepBuffer: 4,
			}).addTo(map);
			enableSmoothWheelZoom(map, tileLayer);

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
					html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="27" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${markerColor}"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>`,
					iconSize: [18, 27],
					iconAnchor: [9, 27],
					popupAnchor: [0, -27],
				});

				const marker = L.marker([lat, lng], { icon: markerIcon, riseOnHover: true }).addTo(map);

				// Tooltip with restaurant name (permanent at high zoom)
				marker.bindTooltip(escapeHtml(r.name), {
					permanent: false,
					direction: "top",
					offset: [0, -27],
				});

				// Popup content
				const lines: string[] = [`<strong>${escapeHtml(r.name)}</strong>`];
				if (fm.cuisine) lines.push(`<span class="gl-map-popup__cuisine">${escapeHtml(fm.cuisine)}</span>`);
				if (fm.price_range) lines.push(`<span class="gl-map-popup__price">${escapeHtml(fm.price_range)}</span>`);
				if (fm.rating != null) lines.push(`<span class="gl-map-popup__rating">${renderStarsHtml(fm.rating)}</span>`);
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

			// Nav control (needs valid bounds for presets + fit-all)
			if (bounds.isValid()) {
				createMapNavControl(map, bounds).addTo(map);
			}

			updateTooltipVisibility(map, markers);

			// If a marker is already selected on initial render, flyTo + open popup
			if (selectedPath && markers.has(selectedPath)) {
				const selMarker = markers.get(selectedPath)!;
				map.flyTo(selMarker.getLatLng(), Math.max(map.getZoom(), 15));
				selMarker.openPopup();
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

function enableSmoothWheelZoom(map: L.Map, tileLayer: L.TileLayer): void {
	const ZOOM_SPEED = 1 / 300;
	const LERP_FACTOR = 0.15;
	const EPSILON = 0.005;

	let targetZoom = map.getZoom();
	let displayZoom = targetZoom;
	let rafId: number | null = null;
	let mouseContainerPt = map.getSize().divideBy(2);

	/** Compute new map center that keeps the mouse pointer fixed while zooming */
	function zoomAroundCenter(zoom: number): L.LatLng {
		const scale = map.getZoomScale(zoom);
		const viewHalf = map.getSize().divideBy(2);
		const centerOffset = mouseContainerPt
			.subtract(viewHalf)
			.multiplyBy(1 - 1 / scale);
		return map.containerPointToLatLng(viewHalf.add(centerOffset));
	}

	function animate() {
		try {
			const diff = targetZoom - displayZoom;
			if (Math.abs(diff) < EPSILON) {
				displayZoom = targetZoom;

				/*
				 * Suppress _resetAll on the tile layer during setView.
				 * Without this, setView({animate:false}) fires viewreset
				 * → _resetAll → removes ALL tiles from the DOM before new
				 * ones load, causing a white flash.
				 * With _resetAll suppressed, old tiles stay visible while
				 * the zoom event's _setView path loads new tiles via
				 * _updateLevels + _update. Normal _pruneTiles (with
				 * fadeAnimation delay) then fades out old tiles gracefully.
				 */
				const gl = tileLayer as any;
				const origResetAll = gl._resetAll;
				gl._resetAll = function () {};
				map.setView(zoomAroundCenter(targetZoom), targetZoom, { animate: false });
				gl._resetAll = origResetAll;

				rafId = null;
				return;
			}
			displayZoom += diff * LERP_FACTOR;
			map.fire("zoomanim", {
				center: zoomAroundCenter(displayZoom),
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
		mouseContainerPt = new L.Point(e.offsetX, e.offsetY);
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

// ── Map Navigation Control ──

const ZOOM_PRESETS = [
	{ zoom: 11, label: "City", icon: '<circle cx="12" cy="12" r="2.5"/>' },
	{ zoom: 14, label: "Area", icon: '<circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/>' },
	{ zoom: 17, label: "Street", icon: '<circle cx="4" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="20" cy="12" r="2.5"/>' },
] as const;

const PRESET_ACTIVE_THRESHOLD = 1.5;

const ICON_ZOOM_IN = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
const ICON_ZOOM_OUT = '<line x1="5" y1="12" x2="19" y2="12"/>';
const ICON_FIT_ALL = '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>';

function svgIcon(content: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${content}</svg>`;
}

function createMapNavControl(map: L.Map, initialBounds: L.LatLngBounds): L.Control {
	const NavControl = L.Control.extend({
		options: { position: "bottomright" as L.ControlPosition },

		onAdd() {
			const container = L.DomUtil.create("div", "gl-map-nav");
			L.DomEvent.disableClickPropagation(container);
			L.DomEvent.disableScrollPropagation(container);

			// Zoom in/out group
			const zoomGroup = L.DomUtil.create("div", "gl-map-nav__group", container);
			makeBtn(zoomGroup, svgIcon(ICON_ZOOM_IN), "Zoom in", () => map.zoomIn(1));
			makeBtn(zoomGroup, svgIcon(ICON_ZOOM_OUT), "Zoom out", () => map.zoomOut(1));

			// Divider
			L.DomUtil.create("div", "gl-map-nav__divider", container);

			// Preset group
			const presetGroup = L.DomUtil.create("div", "gl-map-nav__group", container);
			const presetBtns: HTMLElement[] = [];
			for (const p of ZOOM_PRESETS) {
				const btn = makeBtn(presetGroup, svgIcon(p.icon), p.label, () =>
					map.flyTo(map.getCenter(), p.zoom)
				);
				btn.classList.add("gl-map-nav__preset");
				btn.dataset.zoom = String(p.zoom);
				presetBtns.push(btn);
			}

			// Divider
			L.DomUtil.create("div", "gl-map-nav__divider", container);

			// Fit all group
			const fitGroup = L.DomUtil.create("div", "gl-map-nav__group", container);
			makeBtn(fitGroup, svgIcon(ICON_FIT_ALL), "Fit all", () =>
				map.fitBounds(initialBounds, { padding: [30, 30] })
			);

			// Active preset highlight
			const updateActivePreset = () => {
				const currentZoom = map.getZoom();
				for (const btn of presetBtns) {
					const presetZoom = Number(btn.dataset.zoom);
					btn.classList.toggle(
						"gl-map-nav__preset--active",
						Math.abs(currentZoom - presetZoom) <= PRESET_ACTIVE_THRESHOLD
					);
				}
			};

			map.on("zoomend", updateActivePreset);
			updateActivePreset();

			return container;
		},
	});

	return new NavControl();
}

function makeBtn(
	parent: HTMLElement,
	html: string,
	ariaLabel: string,
	onClick: () => void
): HTMLElement {
	const btn = L.DomUtil.create("button", "gl-map-nav__btn", parent);
	btn.innerHTML = html;
	btn.setAttribute("aria-label", ariaLabel);
	btn.addEventListener("click", onClick);
	return btn;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

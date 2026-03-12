import * as L from "leaflet";
import type { GourmetNote, RestaurantFrontmatter } from "./types";
import { LEAFLET_CSS } from "./restaurant-side-panel";
import { renderStarsHtml } from "./render-utils";
import { isTouchDevice } from "./device";

const TOOLTIP_ZOOM_THRESHOLD = 13;
const TOOLTIP_OVERLAP_PX = 60;

const activeMaps = new WeakMap<HTMLElement, L.Map>();
const activeMarkers = new WeakMap<HTMLElement, Map<string, L.Marker>>();
const activeObservers = new WeakMap<HTMLElement, ResizeObserver>();
const pendingRAFs = new WeakMap<HTMLElement, number>();

export function destroyExplorerMap(container: HTMLElement): void {
	const raf = pendingRAFs.get(container);
	if (raf != null) {
		cancelAnimationFrame(raf);
		pendingRAFs.delete(container);
	}
	const ro = activeObservers.get(container);
	if (ro) {
		ro.disconnect();
		activeObservers.delete(container);
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

function createMarkerIcon(color: string, isTouch: boolean): L.DivIcon {
	const size: [number, number] = isTouch ? [32, 44] : [18, 27];
	const anchor: [number, number] = isTouch ? [16, 44] : [9, 27];
	const svgW = isTouch ? 24 : 18;
	const svgH = isTouch ? 36 : 27;
	return L.divIcon({
		className: "gl-map-marker",
		html: `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>`,
		iconSize: size,
		iconAnchor: anchor,
		popupAnchor: [0, -anchor[1]],
	});
}

export function updateMapSelection(container: HTMLElement, selectedPath: string | null): void {
	const markers = activeMarkers.get(container);
	if (!markers) return;

	const map = activeMaps.get(container);
	const touch = isTouchDevice();

	// Close any open popups when deselecting
	if (!selectedPath && map) {
		map.closePopup();
	}

	for (const [path, marker] of markers) {
		const isSelected = path === selectedPath;
		const color = isSelected ? "var(--interactive-accent, #7c3aed)" : "#e74c3c";
		marker.setIcon(createMarkerIcon(color, touch));

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
			const touch = isTouchDevice();

			const map = L.map(mapEl, {
				zoomControl: false,
				attributionControl: false,
				zoomSnap: 0,
				scrollWheelZoom: false,
				touchZoom: !touch,
				dragging: !touch,
				tap: !touch,
				tapTolerance: 15,
			});
			activeMaps.set(container, map);

			// ResizeObserver to keep Leaflet in sync with flex layout changes
			const ro = new ResizeObserver(() => {
				map.invalidateSize({ animate: false });
			});
			ro.observe(mapEl);
			activeObservers.set(container, ro);

			const tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 19,
				detectRetina: true,
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
				const markerIcon = createMarkerIcon(markerColor, touch);

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

			const fitPad: L.PointExpression = touch ? [50, 50] : [30, 30];
			if (withCoords.length === 1) {
				const fm = withCoords[0].frontmatter as RestaurantFrontmatter;
				map.setView([fm.lat!, fm.lng!], 15);
			} else if (bounds.isValid()) {
				map.fitBounds(bounds, { padding: fitPad });
			}

			// Nav control (needs valid bounds for presets + fit-all)
			if (bounds.isValid()) {
				createMapNavControl(map, bounds, fitPad).addTo(map);
			}

			updateTooltipVisibility(map, markers);

			// If a marker is already selected on initial render, flyTo + open popup
			if (selectedPath && markers.has(selectedPath)) {
				const selMarker = markers.get(selectedPath)!;
				map.flyTo(selMarker.getLatLng(), Math.max(map.getZoom(), 15));
				selMarker.openPopup();
			}

			// Custom touch handlers for mobile (Leaflet's pointer events are blocked by Obsidian Mobile)
			if (touch) {
				setupMapTouchHandlers(mapEl, map, markers, onSelect);
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

// ── Custom Touch Handlers (mobile) ──
// Leaflet's built-in touch handlers use pointer events which Obsidian Mobile blocks.
// This mirrors the pattern from explorer-graph.ts (lines 566-727).

const TAP_DISTANCE_THRESHOLD = 10;
const TAP_TIME_THRESHOLD = 300;
const INERTIA_DECEL = 0.92;
const INERTIA_MIN_SPEED = 0.5;
const MARKER_TAP_RADIUS = 40;

function setupMapTouchHandlers(
	mapEl: HTMLElement,
	map: L.Map,
	markers: Map<string, L.Marker>,
	onSelect: (path: string) => void
): void {
	let lastTouches: Touch[] = [];
	let isDragging = false;
	let isPinching = false;
	let lastPinchDist = 0;
	let lastPinchCenter: L.Point | null = null;

	// Inertia state
	let velocityX = 0;
	let velocityY = 0;
	let lastMoveTime = 0;
	let inertiaRAF: number | null = null;

	// Tap detection
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;

	function getTouchCenter(t1: Touch, t2: Touch): L.Point {
		return new L.Point((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
	}

	function getTouchDist(t1: Touch, t2: Touch): number {
		const dx = t1.clientX - t2.clientX;
		const dy = t1.clientY - t2.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function cancelInertia(): void {
		if (inertiaRAF != null) {
			cancelAnimationFrame(inertiaRAF);
			inertiaRAF = null;
		}
	}

	function startInertia(): void {
		cancelInertia();
		if (Math.abs(velocityX) < INERTIA_MIN_SPEED && Math.abs(velocityY) < INERTIA_MIN_SPEED) return;

		function step() {
			velocityX *= INERTIA_DECEL;
			velocityY *= INERTIA_DECEL;
			if (Math.abs(velocityX) < INERTIA_MIN_SPEED && Math.abs(velocityY) < INERTIA_MIN_SPEED) {
				inertiaRAF = null;
				return;
			}
			map.panBy(new L.Point(-velocityX, -velocityY), { animate: false });
			inertiaRAF = requestAnimationFrame(step);
		}
		inertiaRAF = requestAnimationFrame(step);
	}

	function findClosestMarker(clientX: number, clientY: number): string | null {
		const rect = mapEl.getBoundingClientRect();
		const containerPt = new L.Point(clientX - rect.left, clientY - rect.top);
		let closestPath: string | null = null;
		let closestDistSq = MARKER_TAP_RADIUS * MARKER_TAP_RADIUS;

		for (const [path, marker] of markers) {
			const markerPt = map.latLngToContainerPoint(marker.getLatLng());
			const dx = containerPt.x - markerPt.x;
			const dy = containerPt.y - markerPt.y;
			const distSq = dx * dx + dy * dy;
			if (distSq < closestDistSq) {
				closestDistSq = distSq;
				closestPath = path;
			}
		}
		return closestPath;
	}

	mapEl.addEventListener("touchstart", (e: TouchEvent) => {
		e.preventDefault();
		e.stopPropagation();
		cancelInertia();

		const touches = Array.from(e.touches);
		lastTouches = touches;

		if (touches.length === 1) {
			isDragging = true;
			isPinching = false;
			touchStartX = touches[0].clientX;
			touchStartY = touches[0].clientY;
			touchStartTime = Date.now();
			velocityX = 0;
			velocityY = 0;
			lastMoveTime = Date.now();
		} else if (touches.length === 2) {
			isDragging = false;
			isPinching = true;
			lastPinchDist = getTouchDist(touches[0], touches[1]);
			lastPinchCenter = getTouchCenter(touches[0], touches[1]);
		}
	}, { passive: false });

	mapEl.addEventListener("touchmove", (e: TouchEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const touches = Array.from(e.touches);
		const now = Date.now();

		if (touches.length === 1 && isDragging && lastTouches.length >= 1) {
			const dx = touches[0].clientX - lastTouches[0].clientX;
			const dy = touches[0].clientY - lastTouches[0].clientY;
			const dt = Math.max(1, now - lastMoveTime);
			velocityX = dx / dt * 16; // normalize to ~60fps frame
			velocityY = dy / dt * 16;
			lastMoveTime = now;
			map.panBy(new L.Point(-dx, -dy), { animate: false });
		} else if (touches.length === 2 && isPinching) {
			const dist = getTouchDist(touches[0], touches[1]);
			const center = getTouchCenter(touches[0], touches[1]);

			if (lastPinchDist > 0 && lastPinchCenter) {
				// Pan by center movement
				const cdx = center.x - lastPinchCenter.x;
				const cdy = center.y - lastPinchCenter.y;
				if (Math.abs(cdx) > 0.5 || Math.abs(cdy) > 0.5) {
					map.panBy(new L.Point(-cdx, -cdy), { animate: false });
				}

				// Zoom by pinch distance ratio
				const scale = dist / lastPinchDist;
				if (Math.abs(scale - 1) > 0.01) {
					const rect = mapEl.getBoundingClientRect();
					const zoomCenter = map.containerPointToLatLng(
						new L.Point(center.x - rect.left, center.y - rect.top)
					);
					const newZoom = Math.max(
						map.getMinZoom(),
						Math.min(map.getMaxZoom(), map.getZoom() + Math.log2(scale))
					);
					map.setZoomAround(zoomCenter, newZoom, { animate: false });
				}
			}

			lastPinchDist = dist;
			lastPinchCenter = center;
		}

		lastTouches = touches;
	}, { passive: false });

	mapEl.addEventListener("touchend", (e: TouchEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const remaining = e.touches.length;

		// Tap detection: single finger, short time, small movement
		if (remaining === 0 && !isPinching) {
			const elapsed = Date.now() - touchStartTime;
			const movedX = Math.abs((lastTouches[0]?.clientX ?? 0) - touchStartX);
			const movedY = Math.abs((lastTouches[0]?.clientY ?? 0) - touchStartY);
			const dist = Math.sqrt(movedX * movedX + movedY * movedY);

			if (elapsed < TAP_TIME_THRESHOLD && dist < TAP_DISTANCE_THRESHOLD) {
				// It's a tap — find nearest marker
				const path = findClosestMarker(touchStartX, touchStartY);
				if (path) {
					onSelect(path);
					const marker = markers.get(path);
					if (marker) marker.openPopup();
				}
			} else if (isDragging) {
				// End of drag — start inertia
				startInertia();
			}
		}

		// Transition from pinch to single-finger drag
		if (remaining === 1) {
			isPinching = false;
			isDragging = true;
			lastTouches = Array.from(e.touches);
			velocityX = 0;
			velocityY = 0;
			lastMoveTime = Date.now();
		} else {
			isDragging = false;
			isPinching = false;
		}
	}, { passive: false });

	mapEl.addEventListener("touchcancel", (e: TouchEvent) => {
		e.stopPropagation();
		isDragging = false;
		isPinching = false;
		cancelInertia();
	});
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

function createMapNavControl(map: L.Map, initialBounds: L.LatLngBounds, fitPad: L.PointExpression): L.Control {
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
				map.fitBounds(initialBounds, { padding: fitPad })
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

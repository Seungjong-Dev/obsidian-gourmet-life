import { Notice, setIcon, type App } from "obsidian";
import type { RestaurantFrontmatter, RestaurantViewMode } from "./types";
import { PRICE_RANGES } from "./types";
import {
	parseRestaurantVisits,
	parseRestaurantSections,
	computeOverallRating,
	computeVisitStats,
	extractCoordsFromUrl,
	fetchCoordsFromUrl,
	geocodeAddress,
	type GeoCoords,
} from "./restaurant-parser";
import { showImageLightbox } from "./recipe-main-panel";
import { suggestAreaFromLocation } from "./area-suggest";
import { ImageSuggestModal } from "./image-suggest-modal";
import { renderStarsDom } from "./render-utils";
import * as L from "leaflet";

export interface NearbyRestaurant {
	name: string;
	lat: number;
	lng: number;
	path: string;
}

export interface RestaurantSideCallbacks {
	onInput: () => void;
	onShowOnMap?: () => void;
	nearbyRestaurants?: NearbyRestaurant[];
	onNearbyClick?: (path: string) => void;
}

export interface RestaurantSideState {
	image: string;
	cuisine: string;
	address: string;
	area: string;
	price_range: string;
	rating: string;
	url: string;
	lat: string;
	lng: string;
	tags: string;
}

// Track active Leaflet map instances for cleanup
const activeMaps = new WeakMap<HTMLElement, L.Map>();
const pendingMapRAFs = new WeakMap<HTMLElement, number>();

/** Destroy any Leaflet map previously rendered inside this container */
export function destroyLeafletMap(container: HTMLElement): void {
	const pendingRAF = pendingMapRAFs.get(container);
	if (pendingRAF != null) {
		cancelAnimationFrame(pendingRAF);
		pendingMapRAFs.delete(container);
	}
	const map = activeMaps.get(container);
	if (map) {
		map.remove();
		activeMaps.delete(container);
	}
}

// ── Render ──

export function renderRestaurantSidePanel(
	container: HTMLElement,
	fm: RestaurantFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	mode: RestaurantViewMode,
	callbacks: RestaurantSideCallbacks,
	app?: App,
	notePath?: string
): void {
	destroyLeafletMap(container);
	container.empty();

	try {
		if (mode === "viewer") {
			renderViewer(container, fm, bodyContent, resourcePath, callbacks);
		} else {
			renderEditor(container, fm, bodyContent, resourcePath, callbacks, app, notePath);
		}
		// Force layout recalculation — works around Chromium bug where
		// children added after empty() inside a grid cell get 0×0 layout.
		container.style.display = "none";
		void container.offsetHeight;
		container.style.display = "";
	} catch (err) {
		console.error("[GourmetLife] Side panel render failed:", err);
		if (container.childElementCount === 0) {
			container.createDiv({
				cls: "gl-restaurant__error",
				text: "Side panel failed to render. Check console for details.",
			});
		}
	}
}

// ── Viewer ──

function renderViewer(
	container: HTMLElement,
	fm: RestaurantFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	callbacks?: RestaurantSideCallbacks
): void {
	// Image
	if (fm.image) {
		const imageWrap = container.createDiv({ cls: "gl-restaurant__image-wrap" });
		const img = imageWrap.createEl("img", { cls: "gl-restaurant__image" });
		img.src = resourcePath(fm.image);
		img.addEventListener("click", () => showImageLightbox(img.src, ""));
	}

	// Map
	if (fm.lat != null && fm.lng != null) {
		const mapWrap = container.createDiv({ cls: "gl-restaurant__map-wrap" });
		const mapEl = mapWrap.createDiv({ cls: "gl-restaurant__map" });
		renderLeafletMap(container, mapEl, fm.lat, fm.lng, false, undefined, callbacks?.nearbyRestaurants, callbacks?.onNearbyClick);
		if (callbacks?.onShowOnMap) {
			const showBtn = mapWrap.createEl("button", {
				cls: "gl-restaurant__show-on-map-btn",
			});
			setIcon(showBtn, "map");
			showBtn.addEventListener("click", () => callbacks.onShowOnMap!());
		}
	} else if (fm.address) {
		const fallback = container.createDiv({ cls: "gl-restaurant__map-fallback" });
		const link = fallback.createEl("a", {
			text: `\uD83D\uDDFA\uFE0F ${fm.address}`,
			cls: "gl-restaurant__location-link",
		});
		link.href = `https://maps.google.com/maps?q=${encodeURIComponent(fm.address)}`;
		link.setAttr("target", "_blank");
		link.setAttr("rel", "noopener");
	}

	// Info grid
	const infoGrid = container.createDiv({ cls: "gl-restaurant__info-grid" });

	if (fm.address) {
		const row = infoGrid.createDiv({ cls: "gl-restaurant__info-row" });
		row.createSpan({ text: "Address", cls: "gl-restaurant__info-label" });
		const link = row.createEl("a", {
			text: fm.address,
			cls: "gl-restaurant__location-link",
		});
		link.href = `https://maps.google.com/maps?q=${encodeURIComponent(fm.address)}`;
		link.setAttr("target", "_blank");
		link.setAttr("rel", "noopener");
	}

	if (fm.area) {
		addInfoRow(infoGrid, "Area", fm.area);
	}

	if (fm.cuisine) {
		addInfoRow(infoGrid, "Cuisine", fm.cuisine);
	}

	if (fm.price_range) {
		const row = infoGrid.createDiv({ cls: "gl-restaurant__info-row" });
		row.createSpan({ text: "Price", cls: "gl-restaurant__info-label" });
		const priceWrap = row.createSpan({ cls: "gl-restaurant__price" });
		for (let i = 0; i < 4; i++) {
			const cls = i < fm.price_range.length
				? "gl-restaurant__price--active"
				: "gl-restaurant__price--inactive";
			priceWrap.createSpan({ text: "$", cls });
		}
	}

	// Rating
	const sections = parseRestaurantSections(bodyContent);
	const visits = parseRestaurantVisits(sections.reviews);
	const autoRating = computeOverallRating(visits);
	const displayRating = fm.rating ?? (autoRating != null ? Math.round(autoRating * 10) / 10 : null);

	if (displayRating != null) {
		const ratingWrap = infoGrid.createDiv({ cls: "gl-restaurant__info-row" });
		ratingWrap.createSpan({ text: "Rating", cls: "gl-restaurant__info-label" });
		const ratingVal = ratingWrap.createSpan({ cls: "gl-restaurant__rating" });
		renderStarsDom(ratingVal, displayRating);
		ratingVal.createSpan({
			text: ` ${displayRating.toFixed(1)}/5`,
			cls: "gl-restaurant__rating-label",
		});
	}

	// URL
	if (fm.url) {
		const row = infoGrid.createDiv({ cls: "gl-restaurant__info-row" });
		row.createSpan({ text: "URL", cls: "gl-restaurant__info-label" });
		let displayUrl = fm.url;
		try {
			const url = new URL(fm.url);
			displayUrl = url.hostname.replace(/^www\./, "");
			if (displayUrl.length > 30) displayUrl = displayUrl.slice(0, 27) + "...";
		} catch { /* use raw */ }
		const link = row.createEl("a", {
			text: displayUrl,
			cls: "gl-restaurant__url-link",
		});
		link.href = fm.url;
		link.setAttr("target", "_blank");
		link.setAttr("rel", "noopener");
	}

	// Tags
	if (fm.tags && fm.tags.length > 0) {
		const tagsRow = infoGrid.createDiv({ cls: "gl-restaurant__info-row" });
		tagsRow.createSpan({ text: "Tags", cls: "gl-restaurant__info-label" });
		const tagsWrap = tagsRow.createSpan();
		for (const tag of fm.tags) {
			tagsWrap.createSpan({ text: tag, cls: "gl-restaurant__tag-chip" });
		}
	}

	// Visit summary
	if (visits.length > 0) {
		const stats = computeVisitStats(visits);
		const summary = container.createDiv({ cls: "gl-restaurant__visit-summary" });
		summary.createDiv({
			text: `${stats.count} visit${stats.count === 1 ? "" : "s"}`,
			cls: "gl-restaurant__visit-count",
		});
		if (stats.lastVisit) {
			summary.createDiv({
				text: `Last: ${stats.lastVisit}`,
				cls: "gl-restaurant__visit-last",
			});
		}
	}
}

// ── Editor ──

function renderEditor(
	container: HTMLElement,
	fm: RestaurantFrontmatter,
	bodyContent: string,
	resourcePath: (path: string) => string,
	callbacks: RestaurantSideCallbacks,
	app?: App,
	notePath?: string
): void {
	// Image editor
	const imageSection = container.createDiv({ cls: "gl-restaurant__image-edit" });
	let currentImage = fm.image || "";

	const renderImageEditor = () => {
		imageSection.empty();
		if (currentImage) {
			const item = imageSection.createDiv({ cls: "gl-recipe__image-item" });
			item.dataset.imagePath = currentImage;
			const preview = item.createEl("img", {
				cls: "gl-recipe__image gl-recipe__image--thumb",
			});
			preview.src = resourcePath(currentImage);
			item.createSpan({ cls: "gl-recipe__image-path", text: currentImage });
			const removeBtn = item.createEl("button", {
				cls: "gl-recipe__image-remove",
				text: "\u00d7",
			});
			removeBtn.title = "Remove image";
			removeBtn.addEventListener("click", () => {
				currentImage = "";
				renderImageEditor();
				callbacks.onInput();
			});
		}
		const btnText = currentImage ? "Change image" : "+ Add image";
		const addBtn = imageSection.createEl("button", {
			cls: "gl-recipe__add-btn",
			text: btnText,
		});
		addBtn.addEventListener("click", () => {
			if (app) {
				new ImageSuggestModal(app, (file) => {
					currentImage = file.name;
					renderImageEditor();
					callbacks.onInput();
				}, notePath).open();
			}
		});
	};
	renderImageEditor();

	// Metadata fields
	const metaSection = container.createDiv({ cls: "gl-restaurant__meta-edit" });
	addEditField(metaSection, "Cuisine", "cuisine", fm.cuisine || "", callbacks.onInput);
	addEditField(metaSection, "Address", "address", fm.address || "", callbacks.onInput);
	addEditField(metaSection, "Area", "area", fm.area || "", callbacks.onInput);

	// Auto-suggest area from location
	{
		const addressInput = metaSection.querySelector('[data-field="address"]') as HTMLInputElement | null;
		const areaInput = metaSection.querySelector('[data-field="area"]') as HTMLInputElement | null;
		if (addressInput && areaInput) {
			let lastSuggested = fm.area ? suggestAreaFromLocation(fm.address || "") : "";
			addressInput.addEventListener("input", () => {
				const currentArea = areaInput.value.trim();
				if (!currentArea || currentArea === lastSuggested) {
					const suggested = suggestAreaFromLocation(addressInput.value);
					areaInput.value = suggested;
					lastSuggested = suggested;
					callbacks.onInput();
				}
			});
		}
	}

	addDropdownField(metaSection, "Price range", "price_range", ["", ...PRICE_RANGES], fm.price_range || "", callbacks.onInput);
	addEditField(metaSection, "Rating (1-5)", "rating", fm.rating != null ? String(fm.rating) : "", callbacks.onInput);
	addEditField(metaSection, "URL", "url", fm.url || "", callbacks.onInput);
	addEditField(metaSection, "Tags", "tags", fm.tags ? fm.tags.join(", ") : "", callbacks.onInput);

	// Coordinates section
	const coordSection = container.createDiv({ cls: "gl-restaurant__coord-edit" });
	coordSection.createEl("h3", { text: "Coordinates", cls: "gl-recipe__section-title" });

	addEditField(coordSection, "Latitude", "lat", fm.lat != null ? String(fm.lat) : "", callbacks.onInput);
	addEditField(coordSection, "Longitude", "lng", fm.lng != null ? String(fm.lng) : "", callbacks.onInput);

	// Auto-extract from URL button
	const btnRow = coordSection.createDiv({ cls: "gl-restaurant__coord-btns" });

	const extractBtn = btnRow.createEl("button", {
		cls: "gl-recipe__add-btn",
		text: "Extract from URL",
	});
	extractBtn.addEventListener("click", async () => {
		const urlField = container.querySelector('[data-field="url"]') as HTMLInputElement | null;
		const urlVal = urlField?.value?.trim() || "";
		if (!urlVal) {
			new Notice("No URL to extract coordinates from");
			return;
		}
		// Try sync regex extraction first
		const coords = extractCoordsFromUrl(urlVal);
		if (coords) {
			setFieldValue(container, "lat", String(coords.lat));
			setFieldValue(container, "lng", String(coords.lng));
			callbacks.onInput();
			new Notice(`Coordinates extracted: ${coords.lat}, ${coords.lng}`);
			return;
		}
		// Try async fetch-based extraction
		new Notice("Fetching coordinates...");
		const fetched = await fetchCoordsFromUrl(urlVal);
		if (fetched) {
			setFieldValue(container, "lat", String(fetched.lat));
			setFieldValue(container, "lng", String(fetched.lng));
			callbacks.onInput();
			new Notice(`Coordinates extracted: ${fetched.lat}, ${fetched.lng}`);
			return;
		}
		new Notice("Could not extract coordinates from URL");
	});

	const geocodeBtn = btnRow.createEl("button", {
		cls: "gl-recipe__add-btn",
		text: "Search by address",
	});
	geocodeBtn.addEventListener("click", async () => {
		const addressField = container.querySelector('[data-field="address"]') as HTMLInputElement | null;
		const address = addressField?.value?.trim() || "";
		if (!address) {
			new Notice("No address to search");
			return;
		}
		new Notice("Searching...");
		const coords = await geocodeAddress(address);
		if (coords) {
			setFieldValue(container, "lat", String(coords.lat));
			setFieldValue(container, "lng", String(coords.lng));
			callbacks.onInput();
			new Notice(`Found: ${coords.lat}, ${coords.lng}`);
		} else {
			new Notice("Address not found");
		}
	});

	// Mini map (editor — clickable)
	const lat = fm.lat;
	const lng = fm.lng;
	if (lat != null && lng != null) {
		const mapEl = container.createDiv({ cls: "gl-restaurant__map" });
		renderLeafletMap(container, mapEl, lat, lng, true, (coords) => {
			setFieldValue(container, "lat", String(coords.lat));
			setFieldValue(container, "lng", String(coords.lng));
			callbacks.onInput();
		});
	}

	// Auto-extract coordinates if URL exists but lat/lng are empty
	const urlVal = fm.url?.trim() || "";
	const hasCoords = fm.lat != null && fm.lng != null;
	if (urlVal && !hasCoords) {
		(async () => {
			const coords = extractCoordsFromUrl(urlVal) || await fetchCoordsFromUrl(urlVal);
			if (coords) {
				setFieldValue(container, "lat", String(coords.lat));
				setFieldValue(container, "lng", String(coords.lng));
				callbacks.onInput();
				new Notice(`Coordinates auto-extracted: ${coords.lat}, ${coords.lng}`);
			}
		})();
	}
}

// ── Collect State ──

export function collectRestaurantSideState(container: HTMLElement): RestaurantSideState {
	const getField = (field: string): string => {
		const el = container.querySelector(`[data-field="${field}"]`) as HTMLInputElement | HTMLSelectElement | null;
		return el?.value?.trim() || "";
	};

	const imageItem = container.querySelector(".gl-recipe__image-item") as HTMLElement | null;
	const image = imageItem?.dataset.imagePath || "";

	return {
		image,
		cuisine: getField("cuisine"),
		address: getField("address"),
		area: getField("area"),
		price_range: getField("price_range"),
		rating: getField("rating"),
		url: getField("url"),
		lat: getField("lat"),
		lng: getField("lng"),
		tags: getField("tags"),
	};
}

// ── Leaflet Map ──

function renderLeafletMap(
	sideContainer: HTMLElement,
	mapEl: HTMLElement,
	lat: number,
	lng: number,
	interactive: boolean,
	onMapClick?: (coords: GeoCoords) => void,
	nearbyRestaurants?: NearbyRestaurant[],
	onNearbyClick?: (path: string) => void
): void {
	mapEl.style.height = "180px";

	// Inject minimal Leaflet CSS if not already present
	if (!document.getElementById("gl-leaflet-css")) {
		const style = document.createElement("style");
		style.id = "gl-leaflet-css";
		style.textContent = LEAFLET_CSS;
		document.head.appendChild(style);
	}

	// Defer Leaflet init to rAF so CSS grid has completed layout first
	const rafId = requestAnimationFrame(() => {
		pendingMapRAFs.delete(sideContainer);
		if (!mapEl.isConnected) return;

		try {
			const map = L.map(mapEl, {
				zoomControl: false,
				attributionControl: false,
				dragging: interactive,
				scrollWheelZoom: interactive,
				doubleClickZoom: interactive,
				touchZoom: interactive,
	
			}).setView([lat, lng], 15);

			// Store reference for cleanup immediately so destroyLeafletMap always finds it
			activeMaps.set(sideContainer, map);

			L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 19,
				updateWhenZooming: false,
				keepBuffer: 4,
			}).addTo(map);

			const markerIcon = L.divIcon({
				className: "gl-map-marker",
				html: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#e74c3c"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>',
				iconSize: [24, 36],
				iconAnchor: [12, 36],
			});
			const marker = L.marker([lat, lng], { icon: markerIcon }).addTo(map);

			if (!interactive) {
				marker.on("click", () => {
					window.open(
						`https://maps.google.com/maps?q=${lat},${lng}`,
						"_blank"
					);
				});
			}

			if (interactive && onMapClick) {
				map.on("click", (e: L.LeafletMouseEvent) => {
					marker.setLatLng(e.latlng);
					onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
				});
			}

			// Nearby restaurant markers
			if (nearbyRestaurants && nearbyRestaurants.length > 0) {
				const nearbyIcon = L.divIcon({
					className: "gl-map-marker gl-map-marker--nearby",
					html: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="21" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#999"/><circle cx="12" cy="11" r="5" fill="#fff"/></svg>',
					iconSize: [14, 21],
					iconAnchor: [7, 21],
				});
				for (const nr of nearbyRestaurants) {
					const nm = L.marker([nr.lat, nr.lng], { icon: nearbyIcon }).addTo(map);
					nm.bindTooltip(nr.name, { direction: "top", offset: [0, -18] });
					if (onNearbyClick) {
						nm.on("click", () => onNearbyClick(nr.path));
					}
				}
			}
			} catch (err) {
			console.error("[GourmetLife] Leaflet map render failed:", err);
			mapEl.empty();
			mapEl.style.height = "";
			const fallback = mapEl.createEl("a", {
				text: `\uD83D\uDDFA\uFE0F Open in Google Maps`,
				cls: "gl-restaurant__location-link",
			});
			fallback.href = `https://maps.google.com/maps?q=${lat},${lng}`;
			fallback.setAttr("target", "_blank");
			fallback.setAttr("rel", "noopener");
		}
	});
	pendingMapRAFs.set(sideContainer, rafId);
}

// ── Helpers ──

function addInfoRow(parent: HTMLElement, label: string, value: string): void {
	const row = parent.createDiv({ cls: "gl-restaurant__info-row" });
	row.createSpan({ text: label, cls: "gl-restaurant__info-label" });
	row.createSpan({ text: value });
}

function addEditField(
	parent: HTMLElement,
	label: string,
	field: string,
	value: string,
	onInput: () => void
): void {
	const row = parent.createDiv({ cls: "gl-recipe__meta-row" });
	row.createSpan({ text: label, cls: "gl-recipe__meta-label" });
	const input = row.createEl("input", {
		cls: "gl-recipe__edit-input",
		type: "text",
		value,
	}) as HTMLInputElement;
	input.dataset.field = field;
	input.addEventListener("input", onInput);
}

function addDropdownField(
	parent: HTMLElement,
	label: string,
	field: string,
	options: readonly string[],
	value: string,
	onInput: () => void
): void {
	const row = parent.createDiv({ cls: "gl-recipe__meta-row" });
	row.createSpan({ text: label, cls: "gl-recipe__meta-label" });
	const select = row.createEl("select", {
		cls: "gl-recipe__edit-input dropdown",
	}) as HTMLSelectElement;
	select.dataset.field = field;
	for (const opt of options) {
		const option = select.createEl("option", {
			text: opt || "\u2014",
			value: opt,
		});
		if (opt === value) option.selected = true;
	}
	select.addEventListener("change", onInput);
}

function setFieldValue(container: HTMLElement, field: string, value: string): void {
	const el = container.querySelector(`[data-field="${field}"]`) as HTMLInputElement | null;
	if (el) el.value = value;
}

// Minimal inline Leaflet CSS (just what's needed for rendering)
export const LEAFLET_CSS = `
.leaflet-container{height:100%;width:100%;position:relative;outline-offset:1px}
.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container{position:absolute;left:0;top:0}
.leaflet-pane>svg,.leaflet-pane>canvas{position:absolute;left:0;top:0}
.leaflet-container img{max-width:none!important;max-height:none!important}
.leaflet-tile{filter:inherit;visibility:hidden}
.leaflet-tile-loaded{visibility:inherit}
.leaflet-zoom-box{width:0;height:0;-moz-box-sizing:border-box;box-sizing:border-box;z-index:800}
.leaflet-overlay-pane svg{-moz-user-select:none}
.leaflet-pane{z-index:400}
.leaflet-tile-pane{z-index:200}
.leaflet-overlay-pane{z-index:400}
.leaflet-shadow-pane{z-index:500}
.leaflet-marker-pane{z-index:600}
.leaflet-tooltip-pane{z-index:650}
.leaflet-popup-pane{z-index:700}
.leaflet-map-pane canvas{z-index:100}
.leaflet-map-pane svg{z-index:200}
.leaflet-control{position:relative;z-index:800;pointer-events:visiblePainted;pointer-events:auto}
.leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none}
.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}
.leaflet-fade-anim .leaflet-popup{opacity:1;transition:opacity .2s linear}
.leaflet-zoom-anim .leaflet-zoom-animated{will-change:transform;transition:transform .25s cubic-bezier(0,0,.25,1)}
.leaflet-pan-anim .leaflet-tile,.leaflet-zoom-anim .leaflet-zoom-hide{visibility:hidden}
.leaflet-zoom-animated{transform-origin:0 0}
.leaflet-grab{cursor:grab}.leaflet-dragging .leaflet-grab,.leaflet-dragging .leaflet-grab .leaflet-clickable{cursor:move;cursor:grabbing}
.leaflet-marker-icon,.leaflet-marker-shadow{display:block}
.leaflet-container .leaflet-marker-pane img,.leaflet-container .leaflet-shadow-pane img,.leaflet-container .leaflet-tile-pane img,.leaflet-container img.leaflet-image-layer,.leaflet-container .leaflet-tile{max-width:none!important;max-height:none!important;padding:0}
.leaflet-container img.leaflet-tile{mix-blend-mode:plus-lighter}
.leaflet-container.leaflet-touch-zoom{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y}
.leaflet-container.leaflet-touch-drag{-ms-touch-action:pinch-zoom;touch-action:none;touch-action:pinch-zoom}
.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom{-ms-touch-action:none;touch-action:none}
.leaflet-tile-container{pointer-events:none}
.leaflet-default-icon-path{background-image:url(data:image/png;base64,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3Bf/2Bf/2Bf/2Bf/1Bf/1Bf/1Af/0Af/0Af/0Af/zAf/zAf/zAf/yAf/yAf/y/+/x/+/x/+/w/+/w/+/w/+/v/+/v/+/v/+/u/+/u/+/u/+/t/+/t/+/t/+/s/+/s/+/s/+/r/+/r/+/r9//q9//q9//q9//p9//p9//p9//o8//o8//o8//n8//n8//n8//m8//m8//m7//l7//l7//l7//k7//k7//k7//j7//j7//j6//i6//i6//i6//h6//h6//h6//g6//g6//g5//f5//f5//f5//e5//e5//e5//d5//d5//d4//c4//c4//c4//b4//b4//b4//a4//a4//a3//Z3//Z3//Z3//Y3//Y3//Y3//X3//X3//X2//W2//W2//W2//V2//V2//V2//U2//U2//U1//T1//T1//T1//S1//S1//S1//R1//R1//R0//Q0//Q0//Q0//P0//P0//Pz//Oz//Oz//Oz//Nz//Nz//Nz//Mz//Mz//My//Ly//Ly//Ly//Ky//Ky//Ky//Jy//Jy//Jx//Ix//Ix//Ix//Hx//Hx//Hx//Gx//Gx//Gw//Fw//Fw//Fw//Ew//Ew//Ew//Dw//Dw//Dv//Cv//Cv//Cv//Bv//Bv//Bv//Av//Av//Au/+/u/+/u/+/u/++u/++u/++t/++t/++t/++t/+9t/+9t/+9s/+9s/+9s/+9s/+8s/+8s/+8r/+8r/+8r/+8r/+7r/+7r/+7q/+7q/+7q/+7q/+6q/+6q/+6p/+6p/+6p/+5p/+5p/+5p/+5p/+4p/+4o/+4o/+4o/+4o/+3o/+3o/+3n/+3n/+3n/+3n/+2n/+2n/+2m/+2m/+2m/+1m/+1m/+1m/+1m/+0m/+0l/+0l/+0l/+0l/+zl/+zl/+zk/+zk/+zk/+yk/+yk/+yk/+yk/+xk/+xj/+xj/+xj/+xj/+wj/+wj/+wi/+wi/+wi/+vi/+vi/+vi/+vi/+ui/+uh/+uh/+uh/+uh/+th/+th/+tg/+tg/+tg/+sg/+sg/+sg/+sg/+rg/+rf/+rf/+rf/+rf/+qf/+qf/+qe/+qe/+qe/+pe/+pe/+pe/+pe/+oe/+od/+od/+od/+od/+nd/+nd/+nc/+nc/+nc/+mc/+mc/+mc/+mc/+lc/+lb/+lb/+lb/+lb/+kb/+kb/+ka/+ka/+ka/+ja/+ja/+ja/+ja/+ia/+i5/+i5/+i5/+i5/+h5/+h5/+h4/+h4/+h4/+g4/+g4/+g4/+g4/+f4/+f3/+f3/+f3/+f3/+e3/+e3/+e2/+e2/+e2/+d2/+d2/+d2/+d2/+c2/+c1/+c1/+c1/+c1/+b1/+b1/+b0/+b0/+b0/+a0/+a0/+a0/+a0/+Z0/+Zz/+Zz/+Zz/+Zz/+Yz/+Yz/+Yy/+Yy/+Yy/+Xy/+Xy/+Xy/+Xy/+Wy/+Wx/+Wx/+Wx/+Wx/+Vx/+Vx/+Vw/+Vw/+Vw/+Uw/+Uw/+Uw/+Uw/+Tw/+Tv/+Tv/+Tv/+Tv/+Sv/+Sv/+Su/+Su/+Su/+Ru/+Ru/+Ru/+Ru/+Qu/+Qt/+Qt/+Qt/+Qt/+Pt/+Pt/+Ps/+Ps/+Ps/+Os/+Os/+Os//AAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAAEAAA)}
.leaflet-default-icon-path svg{background-image:none}
.leaflet-popup{position:absolute;text-align:center;margin-bottom:20px}
.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}
.leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;min-height:1px}
.leaflet-popup-content p{margin:17px 0}
.leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}
.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;transform:rotate(45deg)}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:white;color:#333;box-shadow:0 3px 14px rgba(0,0,0,0.4)}
.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:transparent}
.leaflet-container a.leaflet-popup-close-button:hover,.leaflet-container a.leaflet-popup-close-button:focus{color:#585858}
.leaflet-popup-scrolled{overflow:auto}
.leaflet-tooltip{position:absolute;padding:6px;background-color:#fff;border:1px solid #fff;border-radius:3px;color:#222;white-space:nowrap;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
.leaflet-tooltip.leaflet-interactive{cursor:pointer;pointer-events:auto}
.leaflet-tooltip-top:before,.leaflet-tooltip-bottom:before,.leaflet-tooltip-left:before,.leaflet-tooltip-right:before{position:absolute;pointer-events:none;border:6px solid transparent;background:transparent;content:""}
.leaflet-tooltip-bottom{margin-top:6px}
.leaflet-tooltip-top{margin-top:-6px}
.leaflet-tooltip-bottom:before,.leaflet-tooltip-top:before{left:50%;margin-left:-6px}
.leaflet-tooltip-top:before{bottom:0;margin-bottom:-12px;border-top-color:#fff}
.leaflet-tooltip-bottom:before{top:0;margin-top:-12px;margin-left:-6px;border-bottom-color:#fff}
.leaflet-tooltip-left{margin-left:-6px}
.leaflet-tooltip-right{margin-left:6px}
.leaflet-tooltip-left:before,.leaflet-tooltip-right:before{top:50%;margin-top:-6px}
.leaflet-tooltip-left:before{right:0;margin-right:-12px;border-left-color:#fff}
.leaflet-tooltip-right:before{left:0;margin-left:-12px;border-right-color:#fff}
`;

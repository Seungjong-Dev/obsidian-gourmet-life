import type { GourmetNote, GraphSettings, IngredientFrontmatter } from "./types";
import type { NoteIndex } from "./note-index";

interface Node {
	id: string;
	label: string;
	type: "recipe" | "ingredient";
	x: number;
	y: number;
	vx: number;
	vy: number;
	fx: number | null;
	fy: number | null;
	degree: number;
	path?: string;
	// SVG element refs for live update
	circle?: SVGCircleElement;
	text?: SVGTextElement;
	group?: SVGGElement;
}

interface Edge {
	source: Node;
	target: Node;
	line?: SVGLineElement;
}

import { DEFAULT_GRAPH_SETTINGS } from "./types";

interface SimulationState {
	nodes: Node[];
	edges: Edge[];
	alpha: number;
	rafId: number | null;
	svg: SVGSVGElement;
	gNodes: SVGGElement;
	gEdges: SVGGElement;
	viewBox: { x: number; y: number; w: number; h: number };
	dragging: Node | null;
	onSelect: (path: string) => void;
	selectedPath: string | null;
	highlightedIng: string | null;
	highlightedRecipe: string | null;
	cleanupListeners: (() => void) | null;
	resizeObserver: ResizeObserver | null;
	settings: GraphSettings;
}

const simStates = new WeakMap<HTMLElement, SimulationState>();

export function destroyGraph(container: HTMLElement): void {
	const state = simStates.get(container);
	if (!state) return;
	if (state.rafId != null) {
		cancelAnimationFrame(state.rafId);
		state.rafId = null;
	}
	if (state.cleanupListeners) {
		state.cleanupListeners();
		state.cleanupListeners = null;
	}
	if (state.resizeObserver) {
		state.resizeObserver.disconnect();
		state.resizeObserver = null;
	}
	simStates.delete(container);
}

export function hasExplorerGraph(container: HTMLElement): boolean {
	return simStates.has(container);
}

export function updateGraphSelection(container: HTMLElement, selectedPath: string | null): void {
	const state = simStates.get(container);
	if (!state) return;
	state.selectedPath = selectedPath;
	for (const n of state.nodes) {
		if (n.group) {
			n.group.classList.toggle("gl-graph__node--selected", !!(n.path && n.path === selectedPath));
		}
	}
	// Sync highlight with selection
	if (selectedPath) {
		const selectedNode = state.nodes.find(n => n.path === selectedPath);
		if (selectedNode) {
			state.highlightedIng = selectedNode.type === "ingredient" ? selectedNode.id : null;
			state.highlightedRecipe = selectedNode.type === "recipe" ? selectedNode.id : null;
			highlightConnected(selectedNode, state.nodes, state.edges, state.gNodes, state.gEdges);
		}
	} else {
		state.highlightedRecipe = null;
		state.highlightedIng = null;
		clearHighlight(state.gNodes, state.gEdges);
	}
}

const MAX_NODES = 500;

// ── Mapping helpers: slider 0–10 → actual physics values ──

function mapCenter(v: number): number { return 0.0001 + (v / 10) * 0.0099; }
function mapRepulsion(v: number): number { return 100 + (v / 10) * 1900; }
function mapLinkDist(v: number): number { return 30 + (v / 10) * 170; }
function mapLinkForce(v: number): number { return 0.01 + (v / 10) * 0.19; }
function mapNodeScale(v: number): number { return 0.5 + (v / 10) * 1.5; }

export function renderGraphView(
	container: HTMLElement,
	recipes: GourmetNote[],
	recipeIngredients: Map<string, Set<string>>,
	onSelect: (path: string) => void,
	selectedPath: string | null,
	initialSettings?: GraphSettings,
	onSettingsChange?: (settings: GraphSettings) => void,
	extraEdges?: Edge[],
	ingredientPaths?: Map<string, string>,
	extraNodes?: Array<{ id: string; label: string; type: "recipe" | "ingredient"; path?: string }>,
): void {
	destroyGraph(container);
	container.empty();
	container.addClass("gl-explorer__graph");

	if (recipes.length === 0) {
		container.createDiv({ cls: "gl-explorer__empty", text: "No recipes to display" });
		return;
	}

	const settings: GraphSettings = { ...(initialSettings ?? DEFAULT_GRAPH_SETTINGS) };

	// Build nodes and edges
	const nodeMap = new Map<string, Node>();
	const edges: Edge[] = [];

	for (const recipe of recipes) {
		const rx = Math.random() * 400 - 200;
		const ry = Math.random() * 300 - 150;
		const rNode: Node = {
			id: `r:${recipe.path}`,
			label: recipe.name,
			type: "recipe",
			x: rx,
			y: ry,
			vx: 0, vy: 0,
			fx: null, fy: null,
			degree: 0,
			path: recipe.path,
		};
		nodeMap.set(rNode.id, rNode);

		const ings = recipeIngredients.get(recipe.path);
		if (ings) {
			for (const ing of ings) {
				const iId = `i:${ing}`;
				if (!nodeMap.has(iId)) {
					// Place ingredient near its first recipe
					nodeMap.set(iId, {
						id: iId,
						label: ing,
						type: "ingredient",
						x: rx + (Math.random() - 0.5) * 60,
						y: ry + (Math.random() - 0.5) * 60,
						vx: 0, vy: 0,
						fx: null, fy: null,
						degree: 0,
						path: ingredientPaths?.get(ing),
					});
				}
				const iNode = nodeMap.get(iId)!;
				edges.push({ source: rNode, target: iNode });
				rNode.degree++;
				iNode.degree++;
			}
		}
	}

	// Add extra edges (e.g., substitute links between ingredient nodes)
	if (extraEdges) {
		for (const ee of extraEdges) {
			// Try to find nodes by exact id, then by path match for ingredients
			let src = nodeMap.get(ee.source.id);
			let tgt = nodeMap.get(ee.target.id);

			// If not found by id, try to find ingredient node by path
			if (!src && ingredientPaths) {
				const srcName = ee.source.id.replace(/^i:/, "");
				const srcPath = ingredientPaths.get(srcName);
				if (srcPath) {
					for (const n of nodeMap.values()) {
						if (n.type === "ingredient" && n.path === srcPath) { src = n; break; }
					}
				}
			}
			if (!tgt && ingredientPaths) {
				const tgtName = ee.target.id.replace(/^i:/, "");
				const tgtPath = ingredientPaths.get(tgtName);
				if (tgtPath) {
					for (const n of nodeMap.values()) {
						if (n.type === "ingredient" && n.path === tgtPath) { tgt = n; break; }
					}
				}
			}

			if (src && tgt && src !== tgt) {
				edges.push({ source: src, target: tgt });
				src.degree++;
				tgt.degree++;
			}
		}
	}

	// Merge extra nodes (e.g., unconnected ingredient notes)
	if (extraNodes) {
		for (const en of extraNodes) {
			if (!nodeMap.has(en.id)) {
				nodeMap.set(en.id, {
					...en,
					x: (Math.random() - 0.5) * 400,
					y: (Math.random() - 0.5) * 300,
					vx: 0, vy: 0, fx: null, fy: null,
					degree: 0,
				});
			}
		}
	}

	let nodes = Array.from(nodeMap.values());
	let truncated = false;

	if (nodes.length > MAX_NODES) {
		truncated = true;
		nodes.sort((a, b) => b.degree - a.degree);
		const keep = new Set(nodes.slice(0, MAX_NODES).map(n => n.id));
		nodes = nodes.filter(n => keep.has(n.id));
		for (let i = edges.length - 1; i >= 0; i--) {
			if (!keep.has(edges[i].source.id) || !keep.has(edges[i].target.id)) {
				edges.splice(i, 1);
			}
		}
	}

	// Filter orphans if setting is off
	if (!settings.showOrphans) {
		const connectedIds = new Set<string>();
		for (const e of edges) {
			connectedIds.add(e.source.id);
			connectedIds.add(e.target.id);
		}
		nodes = nodes.filter(n => connectedIds.has(n.id));
	}

	// ── Graph wrapper (relative positioning for overlays) ──
	const graphWrap = container.createDiv({ cls: "gl-graph__wrap" });

	if (truncated) {
		container.createDiv({
			cls: "gl-explorer__graph-info",
			text: `Showing top ${MAX_NODES} nodes by connections`,
		});
	}

	// Create SVG
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("class", "gl-explorer__graph-svg");
	svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

	const gMain = document.createElementNS(ns, "g");
	svg.appendChild(gMain);

	// Edges
	const gEdges = document.createElementNS(ns, "g");
	gMain.appendChild(gEdges);
	for (const e of edges) {
		const line = document.createElementNS(ns, "line");
		line.setAttribute("class", "gl-graph__edge");
		gEdges.appendChild(line);
		e.line = line;
	}

	// Drag state (declared early so node mousedown handlers can access)
	let dragStartPos: { x: number; y: number } | null = null;
	let dragMoved = false;

	// Touch state
	let touchDragging: Node | null = null;
	let touchDragStartPos: { x: number; y: number } | null = null;
	let touchDragMoved = false;
	let isTouchPanning = false;
	let touchPanStart = { x: 0, y: 0 };
	let pinchStartDist: number | null = null;
	let pinchStartViewBox: { x: number; y: number; w: number; h: number } | null = null;
	let pinchCenter: { x: number; y: number } | null = null;

	// Nodes
	const gNodes = document.createElementNS(ns, "g");
	gMain.appendChild(gNodes);

	// Initial viewBox
	const pad = 60;
	const viewBox = { x: -400 - pad, y: -300 - pad, w: 800 + pad * 2, h: 600 + pad * 2 };
	svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);

	const state: SimulationState = {
		nodes, edges,
		alpha: 1.0,
		rafId: null,
		svg, gNodes, gEdges,
		viewBox,
		dragging: null,
		onSelect,
		selectedPath,
		highlightedIng: null,
		highlightedRecipe: null,
		cleanupListeners: null,
		resizeObserver: null,
		settings,
	};

	const scale = mapNodeScale(settings.nodeSize);

	for (const n of nodes) {
		const g = document.createElementNS(ns, "g");
		const cls = `gl-graph__node gl-graph__node--${n.type}`;
		g.setAttribute("class", n.type === "ingredient" && !n.path ? `${cls} gl-graph__node--unresolved` : cls);
		if (n.path && n.path === selectedPath) g.classList.add("gl-graph__node--selected");

		const baseR = n.type === "recipe" ? 8 : 5;
		const r = baseR * scale;
		const circle = document.createElementNS(ns, "circle");
		circle.setAttribute("r", String(r));
		g.appendChild(circle);

		const text = document.createElementNS(ns, "text");
		text.setAttribute("class", "gl-graph__label");
		if (!settings.showLabels) text.setAttribute("display", "none");
		const displayLabel = n.label.length > 15 ? n.label.slice(0, 14) + "\u2026" : n.label;
		text.textContent = displayLabel;
		g.appendChild(text);

		n.circle = circle;
		n.text = text;
		n.group = g;

		// Drag handling — reheat is deferred to mousemove so clicks don't jolt the graph
		g.addEventListener("mousedown", (ev) => {
			if (ev.button !== 0) return;
			ev.stopPropagation();
			state.dragging = n;
			n.fx = n.x;
			n.fy = n.y;
			dragStartPos = { x: ev.clientX, y: ev.clientY };
			dragMoved = false;
			svg.style.cursor = "grabbing";
		});

		g.addEventListener("click", (ev) => {
			ev.stopPropagation();
		});

		gNodes.appendChild(g);
	}

	graphWrap.appendChild(svg);

	// ── ResizeObserver: adjust viewBox aspect ratio on container resize ──
	const resizeObserver = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (!entry) return;
		const { width, height } = entry.contentRect;
		if (width === 0 || height === 0) return;
		const newAspect = width / height;
		const curAspect = viewBox.w / viewBox.h;
		if (Math.abs(newAspect - curAspect) < 0.01) return;
		const cx = viewBox.x + viewBox.w / 2;
		const cy = viewBox.y + viewBox.h / 2;
		viewBox.w = viewBox.h * newAspect;
		viewBox.x = cx - viewBox.w / 2;
		svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
	});
	resizeObserver.observe(graphWrap);
	state.resizeObserver = resizeObserver;

	// ── Navigation Controls (zoom in/out/fit) ──
	const navEl = graphWrap.createDiv({ cls: "gl-graph__nav" });
	const zoomInBtn = navEl.createEl("button", { cls: "gl-graph__nav-btn", attr: { "aria-label": "Zoom in" } });
	zoomInBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

	const zoomOutBtn = navEl.createEl("button", { cls: "gl-graph__nav-btn", attr: { "aria-label": "Zoom out" } });
	zoomOutBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>';

	const fitBtn = navEl.createEl("button", { cls: "gl-graph__nav-btn", attr: { "aria-label": "Fit to view" } });
	fitBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

	const applyZoom = (factor: number) => {
		const cx = viewBox.x + viewBox.w / 2;
		const cy = viewBox.y + viewBox.h / 2;
		viewBox.w *= factor;
		viewBox.h *= factor;
		viewBox.x = cx - viewBox.w / 2;
		viewBox.y = cy - viewBox.h / 2;
		svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
	};

	zoomInBtn.addEventListener("click", () => applyZoom(0.75));
	zoomOutBtn.addEventListener("click", () => applyZoom(1.333));
	fitBtn.addEventListener("click", () => fitToView(state));

	// ── Settings Panel ──
	const settingsToggle = graphWrap.createEl("button", {
		cls: "gl-graph__settings-toggle",
		attr: { "aria-label": "Graph settings" },
	});
	settingsToggle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

	const settingsPanel = graphWrap.createDiv({ cls: "gl-graph__settings" });

	settingsToggle.addEventListener("click", () => {
		settingsPanel.classList.toggle("gl-graph__settings--open");
		settingsToggle.classList.toggle("gl-graph__settings-toggle--active");
	});

	// Helper to create a slider row
	const addSlider = (label: string, key: keyof GraphSettings, min: number, max: number, step: number, onChange: (v: number) => void) => {
		const row = settingsPanel.createDiv({ cls: "gl-graph__setting-row" });
		row.createSpan({ cls: "gl-graph__setting-label", text: label });
		const input = row.createEl("input", {
			cls: "gl-graph__setting-slider",
			attr: { type: "range", min: String(min), max: String(max), step: String(step) },
		});
		input.value = String(settings[key]);
		input.addEventListener("input", () => {
			const val = parseFloat(input.value);
			(settings as any)[key] = val;
			onSettingsChange?.({ ...settings });
			onChange(val);
			// Reheat
			state.alpha = Math.max(state.alpha, 0.5);
			startSimulation(state);
		});
	};

	const addToggle = (label: string, key: keyof GraphSettings, onChange: (v: boolean) => void) => {
		const row = settingsPanel.createDiv({ cls: "gl-graph__setting-row" });
		row.createSpan({ cls: "gl-graph__setting-label", text: label });
		const toggle = row.createEl("input", {
			cls: "gl-graph__setting-toggle",
			attr: { type: "checkbox" },
		});
		toggle.checked = settings[key] as boolean;
		toggle.addEventListener("change", () => {
			(settings as any)[key] = toggle.checked;
			onSettingsChange?.({ ...settings });
			onChange(toggle.checked);
		});
	};

	addSlider("Center force", "centerForce", 0, 10, 0.5, () => {});
	addSlider("Repulsion", "repulsion", 0, 10, 0.5, () => {});
	addSlider("Link distance", "linkDistance", 0, 10, 0.5, () => {});
	addSlider("Link force", "linkForce", 0, 10, 0.5, () => {});
	addSlider("Node size", "nodeSize", 0, 10, 0.5, (v) => {
		const s = mapNodeScale(v);
		for (const n of nodes) {
			if (n.circle) {
				const baseR = n.type === "recipe" ? 8 : 5;
				n.circle.setAttribute("r", String(baseR * s));
			}
		}
	});
	addToggle("Labels", "showLabels", (v) => {
		for (const n of nodes) {
			if (n.text) n.text.setAttribute("display", v ? "" : "none");
		}
	});
	addToggle("Orphan nodes", "showOrphans", () => {
		// Needs full rebuild — set flag and re-render
		// For simplicity, toggle visibility of degree-0 nodes
		for (const n of nodes) {
			if (n.degree === 0 && n.group) {
				n.group.setAttribute("display", settings.showOrphans ? "" : "none");
			}
		}
	});

	// ── Mouse / pan / zoom event handlers ──
	let isPanning = false;
	let panStart = { x: 0, y: 0 };

	const onMouseDown = (ev: MouseEvent) => {
		if (state.dragging) {
			dragStartPos = { x: ev.clientX, y: ev.clientY };
			dragMoved = false;
			return;
		}
		if (ev.button !== 0) return;
		panStart = { x: ev.clientX, y: ev.clientY };
		isPanning = true;
		svg.style.cursor = "grabbing";
	};

	const onMouseMove = (ev: MouseEvent) => {
		if (state.dragging) {
			const rect = svg.getBoundingClientRect();
			const svgX = ((ev.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x;
			const svgY = ((ev.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y;
			state.dragging.fx = svgX;
			state.dragging.fy = svgY;
			state.dragging.x = svgX;
			state.dragging.y = svgY;
			if (dragStartPos && !dragMoved) {
				const dx = ev.clientX - dragStartPos.x;
				const dy = ev.clientY - dragStartPos.y;
				if (Math.abs(dx) + Math.abs(dy) > 3) {
					dragMoved = true;
					// Reheat only when actual dragging starts
					if (state.alpha < 0.05) {
						state.alpha = 0.3;
						startSimulation(state);
					} else {
						state.alpha = Math.max(state.alpha, 0.3);
					}
				}
			}
			return;
		}
		if (!isPanning) return;
		const rect = svg.getBoundingClientRect();
		const dx = ((ev.clientX - panStart.x) / rect.width) * viewBox.w;
		const dy = ((ev.clientY - panStart.y) / rect.height) * viewBox.h;
		viewBox.x -= dx;
		viewBox.y -= dy;
		panStart = { x: ev.clientX, y: ev.clientY };
		svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
	};

	const onMouseUp = () => {
		if (state.dragging) {
			const node = state.dragging;
			state.dragging = null;
			svg.style.cursor = "";

			if (!dragMoved) {
				if (node.path) {
					// Selectable node (recipe, or ingredient with path)
					onSelect(node.path);
				} else if (node.type === "ingredient") {
					if (state.highlightedIng === node.id) {
						state.highlightedIng = null;
						clearHighlight(gNodes, gEdges);
					} else {
						state.highlightedRecipe = null;
						state.highlightedIng = node.id;
						highlightConnected(node, nodes, edges, gNodes, gEdges);
					}
				}
			}

			node.fx = null;
			node.fy = null;
			dragStartPos = null;
			dragMoved = false;
			return;
		}
		isPanning = false;
		svg.style.cursor = "";
	};

	svg.addEventListener("mousedown", onMouseDown);
	document.addEventListener("mousemove", onMouseMove);
	document.addEventListener("mouseup", onMouseUp);

	svg.addEventListener("wheel", (e) => {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 1.1 : 0.9;
		const rect = svg.getBoundingClientRect();
		const mx = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x;
		const my = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y;
		viewBox.w *= factor;
		viewBox.h *= factor;
		viewBox.x = mx - (mx - viewBox.x) * factor;
		viewBox.y = my - (my - viewBox.y) * factor;
		svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
	}, { passive: false });

	// ── Touch helpers ──

	const clientToSvg = (clientX: number, clientY: number) => {
		const rect = svg.getBoundingClientRect();
		return {
			x: ((clientX - rect.left) / rect.width) * viewBox.w + viewBox.x,
			y: ((clientY - rect.top) / rect.height) * viewBox.h + viewBox.y,
		};
	};

	const findNodeAtPoint = (clientX: number, clientY: number): Node | null => {
		const pt = clientToSvg(clientX, clientY);
		const nodeScale = mapNodeScale(settings.nodeSize);
		const touchPadding = 8;
		let closest: Node | null = null;
		let closestDist = Infinity;
		for (const n of nodes) {
			if (n.group && n.group.getAttribute("display") === "none") continue;
			const baseR = n.type === "recipe" ? 8 : 5;
			const hitR = baseR * nodeScale + touchPadding;
			const dx = pt.x - n.x;
			const dy = pt.y - n.y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < hitR && dist < closestDist) {
				closest = n;
				closestDist = dist;
			}
		}
		return closest;
	};

	const pinchDist = (t1: Touch, t2: Touch): number => {
		const dx = t2.clientX - t1.clientX;
		const dy = t2.clientY - t1.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	};

	// ── Touch event handlers ──

	svg.addEventListener("touchstart", (e) => {
		e.preventDefault();
		const touches = e.touches;

		if (touches.length === 2) {
			// Cancel any 1-finger action in progress
			if (touchDragging) {
				touchDragging.fx = null;
				touchDragging.fy = null;
				touchDragging = null;
			}
			isTouchPanning = false;
			touchDragMoved = false;

			// Start pinch zoom
			pinchStartDist = pinchDist(touches[0], touches[1]);
			pinchStartViewBox = { ...viewBox };
			const rect = svg.getBoundingClientRect();
			const cx = (touches[0].clientX + touches[1].clientX) / 2;
			const cy = (touches[0].clientY + touches[1].clientY) / 2;
			pinchCenter = {
				x: ((cx - rect.left) / rect.width) * viewBox.w + viewBox.x,
				y: ((cy - rect.top) / rect.height) * viewBox.h + viewBox.y,
			};
			return;
		}

		if (touches.length === 1) {
			const t = touches[0];
			const hitNode = findNodeAtPoint(t.clientX, t.clientY);
			if (hitNode) {
				// Start node drag
				touchDragging = hitNode;
				hitNode.fx = hitNode.x;
				hitNode.fy = hitNode.y;
				touchDragStartPos = { x: t.clientX, y: t.clientY };
				touchDragMoved = false;
			} else {
				// Start pan
				isTouchPanning = true;
				touchPanStart = { x: t.clientX, y: t.clientY };
			}
		}
	}, { passive: false });

	svg.addEventListener("touchmove", (e) => {
		e.preventDefault();
		const touches = e.touches;

		if (touches.length === 2 && pinchStartDist != null && pinchStartViewBox && pinchCenter) {
			// Pinch zoom
			const curDist = pinchDist(touches[0], touches[1]);
			const ratio = pinchStartDist / curDist; // >1 = zoom out, <1 = zoom in
			viewBox.w = pinchStartViewBox.w * ratio;
			viewBox.h = pinchStartViewBox.h * ratio;
			viewBox.x = pinchCenter.x - (pinchCenter.x - pinchStartViewBox.x) * ratio;
			viewBox.y = pinchCenter.y - (pinchCenter.y - pinchStartViewBox.y) * ratio;
			svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
			return;
		}

		if (touches.length === 1 && touchDragging) {
			const t = touches[0];
			const pt = clientToSvg(t.clientX, t.clientY);
			touchDragging.fx = pt.x;
			touchDragging.fy = pt.y;
			touchDragging.x = pt.x;
			touchDragging.y = pt.y;

			if (touchDragStartPos && !touchDragMoved) {
				const dx = t.clientX - touchDragStartPos.x;
				const dy = t.clientY - touchDragStartPos.y;
				if (Math.abs(dx) + Math.abs(dy) > 3) {
					touchDragMoved = true;
					if (state.alpha < 0.05) {
						state.alpha = 0.3;
						startSimulation(state);
					} else {
						state.alpha = Math.max(state.alpha, 0.3);
					}
				}
			}
			return;
		}

		if (touches.length === 1 && isTouchPanning) {
			const t = touches[0];
			const rect = svg.getBoundingClientRect();
			const dx = ((t.clientX - touchPanStart.x) / rect.width) * viewBox.w;
			const dy = ((t.clientY - touchPanStart.y) / rect.height) * viewBox.h;
			viewBox.x -= dx;
			viewBox.y -= dy;
			touchPanStart = { x: t.clientX, y: t.clientY };
			svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
		}
	}, { passive: false });

	svg.addEventListener("touchend", (e) => {
		e.preventDefault();
		const remaining = e.touches.length;

		if (remaining === 1 && pinchStartDist != null) {
			// Transitioning from pinch to single-finger pan
			pinchStartDist = null;
			pinchStartViewBox = null;
			pinchCenter = null;
			isTouchPanning = true;
			touchPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
			return;
		}

		if (remaining === 0) {
			// Pinch ended
			pinchStartDist = null;
			pinchStartViewBox = null;
			pinchCenter = null;

			if (touchDragging) {
				const node = touchDragging;
				touchDragging = null;

				if (!touchDragMoved) {
					// Tap — select or toggle highlight
					if (node.path) {
						onSelect(node.path);
					} else if (node.type === "ingredient") {
						if (state.highlightedIng === node.id) {
							state.highlightedIng = null;
							clearHighlight(gNodes, gEdges);
						} else {
							state.highlightedRecipe = null;
							state.highlightedIng = node.id;
							highlightConnected(node, nodes, edges, gNodes, gEdges);
						}
					}
				}

				node.fx = null;
				node.fy = null;
				touchDragStartPos = null;
				touchDragMoved = false;
			}

			isTouchPanning = false;
		}
	}, { passive: false });

	svg.addEventListener("touchcancel", () => {
		if (touchDragging) {
			touchDragging.fx = null;
			touchDragging.fy = null;
			touchDragging = null;
		}
		touchDragStartPos = null;
		touchDragMoved = false;
		isTouchPanning = false;
		pinchStartDist = null;
		pinchStartViewBox = null;
		pinchCenter = null;
	});

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape" && !state.selectedPath && (state.highlightedIng || state.highlightedRecipe)) {
			state.highlightedIng = null;
			state.highlightedRecipe = null;
			clearHighlight(gNodes, gEdges);
		}
	};
	container.addEventListener("keydown", onKeyDown);
	// Make container focusable so it can receive key events
	if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");

	state.cleanupListeners = () => {
		document.removeEventListener("mousemove", onMouseMove);
		document.removeEventListener("mouseup", onMouseUp);
		container.removeEventListener("keydown", onKeyDown);
	};

	simStates.set(container, state);

	// Warmup: run simulation off-screen to reach a fully stable layout
	warmupSimulation(state, 300);
	state.alpha = 0;
	fitToView(state);
}

// ── Fit to view ──

function fitToView(state: SimulationState): void {
	const { nodes, viewBox, svg } = state;
	if (nodes.length === 0) return;

	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
	for (const n of nodes) {
		if (n.group && n.group.getAttribute("display") === "none") continue;
		if (n.x < minX) minX = n.x;
		if (n.x > maxX) maxX = n.x;
		if (n.y < minY) minY = n.y;
		if (n.y > maxY) maxY = n.y;
	}

	const pad = 80;
	viewBox.x = minX - pad;
	viewBox.y = minY - pad;
	viewBox.w = (maxX - minX) + pad * 2 || 400;
	viewBox.h = (maxY - minY) + pad * 2 || 400;
	svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

// ── Warmup: run physics ticks synchronously without rendering ──

function warmupSimulation(state: SimulationState, ticks: number): void {
	const { nodes, edges, settings } = state;
	const centerF = mapCenter(settings.centerForce);
	const repulsion = mapRepulsion(settings.repulsion);
	const springLen = mapLinkDist(settings.linkDistance);
	const springK = mapLinkForce(settings.linkForce);
	const scale = mapNodeScale(settings.nodeSize);
	const cr = 12 * scale;
	const maxV = 30;

	let alpha = state.alpha;
	for (let t = 0; t < ticks; t++) {
		for (const n of nodes) {
			n.vx -= n.x * centerF;
			n.vy -= n.y * centerF;
		}
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i], b = nodes[j];
				const dx = b.x - a.x, dy = b.y - a.y;
				const dist = Math.sqrt(dx * dx + dy * dy) || 1;
				const force = repulsion / (dist * dist);
				const fx = (dx / dist) * force, fy = (dy / dist) * force;
				a.vx -= fx; a.vy -= fy;
				b.vx += fx; b.vy += fy;
			}
		}
		for (const e of edges) {
			const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
			const dist = Math.sqrt(dx * dx + dy * dy) || 1;
			const displacement = dist - springLen;
			const force = springK * displacement;
			const fx = (dx / dist) * force, fy = (dy / dist) * force;
			e.source.vx += fx; e.source.vy += fy;
			e.target.vx -= fx; e.target.vy -= fy;
		}
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i], b = nodes[j];
				const dx = b.x - a.x, dy = b.y - a.y;
				const dist = Math.sqrt(dx * dx + dy * dy) || 1;
				if (dist < cr * 2) {
					const overlap = cr * 2 - dist;
					const fx = (dx / dist) * overlap * 0.5, fy = (dy / dist) * overlap * 0.5;
					a.x -= fx; a.y -= fy;
					b.x += fx; b.y += fy;
				}
			}
		}
		for (const n of nodes) {
			n.vx *= 0.9;
			n.vy *= 0.9;
			const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
			if (speed > maxV) { n.vx *= maxV / speed; n.vy *= maxV / speed; }
			n.x += n.vx * alpha;
			n.y += n.vy * alpha;
		}
		alpha *= 0.97; // faster cooling during warmup
	}
	state.alpha = alpha;

	// Sync SVG positions after warmup
	for (const n of nodes) {
		if (n.circle) {
			n.circle.setAttribute("cx", String(n.x));
			n.circle.setAttribute("cy", String(n.y));
		}
		if (n.text) {
			const baseR = n.type === "recipe" ? 8 : 5;
			const r = baseR * scale;
			n.text.setAttribute("x", String(n.x + r + 3));
			n.text.setAttribute("y", String(n.y + 3));
		}
	}
	for (const e of edges) {
		if (e.line) {
			e.line.setAttribute("x1", String(e.source.x));
			e.line.setAttribute("y1", String(e.source.y));
			e.line.setAttribute("x2", String(e.target.x));
			e.line.setAttribute("y2", String(e.target.y));
		}
	}
}

// ── Simulation loop ──

function startSimulation(state: SimulationState): void {
	if (state.rafId != null) return;

	const { nodes, edges, settings } = state;
	const collisionRadius = 12;

	const tick = () => {
		state.rafId = null;

		const centerF = mapCenter(settings.centerForce);
		const repulsion = mapRepulsion(settings.repulsion);
		const springLen = mapLinkDist(settings.linkDistance);
		const springK = mapLinkForce(settings.linkForce);
		const damping = 0.9;

		// Center gravity
		for (const n of nodes) {
			n.vx -= n.x * centerF;
			n.vy -= n.y * centerF;
		}

		// Repulsion
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.sqrt(dx * dx + dy * dy) || 1;
				const force = repulsion / (dist * dist);
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				a.vx -= fx;
				a.vy -= fy;
				b.vx += fx;
				b.vy += fy;
			}
		}

		// Spring (edges)
		for (const e of edges) {
			const dx = e.target.x - e.source.x;
			const dy = e.target.y - e.source.y;
			const dist = Math.sqrt(dx * dx + dy * dy) || 1;
			const displacement = dist - springLen;
			const force = springK * displacement;
			const fx = (dx / dist) * force;
			const fy = (dy / dist) * force;
			e.source.vx += fx;
			e.source.vy += fy;
			e.target.vx -= fx;
			e.target.vy -= fy;
		}

		// Collision
		const scale = mapNodeScale(settings.nodeSize);
		const cr = collisionRadius * scale;
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.sqrt(dx * dx + dy * dy) || 1;
				if (dist < cr * 2) {
					const overlap = cr * 2 - dist;
					const fx = (dx / dist) * overlap * 0.5;
					const fy = (dy / dist) * overlap * 0.5;
					a.x -= fx;
					a.y -= fy;
					b.x += fx;
					b.y += fy;
				}
			}
		}

		// Apply velocity (with clamping)
		const maxV = 30;
		for (const n of nodes) {
			n.vx *= damping;
			n.vy *= damping;
			const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
			if (speed > maxV) { n.vx *= maxV / speed; n.vy *= maxV / speed; }
			if (n.fx != null) { n.x = n.fx; n.vx = 0; } else { n.x += n.vx * state.alpha; }
			if (n.fy != null) { n.y = n.fy; n.vy = 0; } else { n.y += n.vy * state.alpha; }
		}

		// Update SVG positions
		for (const n of nodes) {
			if (n.circle) {
				n.circle.setAttribute("cx", String(n.x));
				n.circle.setAttribute("cy", String(n.y));
			}
			if (n.text) {
				const baseR = n.type === "recipe" ? 8 : 5;
				const r = baseR * scale;
				n.text.setAttribute("x", String(n.x + r + 3));
				n.text.setAttribute("y", String(n.y + 3));
			}
		}
		for (const e of edges) {
			if (e.line) {
				e.line.setAttribute("x1", String(e.source.x));
				e.line.setAttribute("y1", String(e.source.y));
				e.line.setAttribute("x2", String(e.target.x));
				e.line.setAttribute("y2", String(e.target.y));
			}
		}

		// Cooling
		state.alpha *= 0.98;

		if (state.alpha > 0.01 || state.dragging) {
			state.rafId = requestAnimationFrame(tick);
		}
	};

	state.rafId = requestAnimationFrame(tick);
}

function highlightConnected(
	centerNode: Node,
	allNodes: Node[],
	edges: Edge[],
	gNodes: SVGGElement,
	gEdges: SVGGElement
): void {
	const connected = new Set<string>();
	connected.add(centerNode.id);
	for (const e of edges) {
		if (e.source.id === centerNode.id) connected.add(e.target.id);
		if (e.target.id === centerNode.id) connected.add(e.source.id);
	}

	for (const n of allNodes) {
		if (n.group) {
			n.group.classList.toggle("gl-graph__node--dim", !connected.has(n.id));
		}
	}

	const edgeEls = gEdges.children;
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const isConn = e.source.id === centerNode.id || e.target.id === centerNode.id;
		(edgeEls[i] as SVGElement).classList.toggle("gl-graph__edge--dim", !isConn);
	}
}

function clearHighlight(gNodes: SVGGElement, gEdges: SVGGElement): void {
	for (let i = 0; i < gNodes.children.length; i++) {
		(gNodes.children[i] as SVGElement).classList.remove("gl-graph__node--dim");
	}
	for (let i = 0; i < gEdges.children.length; i++) {
		(gEdges.children[i] as SVGElement).classList.remove("gl-graph__edge--dim");
	}
}

// ── Ingredient Graph ──
// Nodes = ingredient notes + recipe notes that use them
// Edges = recipe→ingredient links + ingredient→ingredient substitutes

export function renderIngredientGraphView(
	container: HTMLElement,
	ingredients: GourmetNote[],
	noteIndex: NoteIndex,
	onSelect: (path: string) => void,
	selectedPath: string | null,
	initialSettings?: GraphSettings,
	onSettingsChange?: (settings: GraphSettings) => void
): void {
	destroyGraph(container);
	container.empty();

	if (ingredients.length === 0) {
		container.createDiv({ cls: "gl-explorer__empty", text: "No ingredients to display" });
		return;
	}

	// Build ingredient name → path map (for ingredient node path resolution)
	const ingredientPathMap = new Map<string, string>(); // lowercase name → path
	for (const ing of ingredients) {
		ingredientPathMap.set(ing.name.toLowerCase(), ing.path);
		const fm = ing.frontmatter as IngredientFrontmatter;
		if (fm.aliases) {
			for (const alias of fm.aliases) {
				if (alias) ingredientPathMap.set(alias.toLowerCase(), ing.path);
			}
		}
	}

	// Collect recipes that use any of these ingredients
	const relevantRecipes: GourmetNote[] = [];
	const relevantRecipeIngredients = new Map<string, Set<string>>();
	const ingredientPaths = new Set(ingredients.map(i => i.path));

	for (const [recipePath, recipeIngs] of noteIndex.recipeIngredients) {
		// Check if this recipe uses any of our ingredient notes
		let usesAny = false;
		for (const ingName of recipeIngs) {
			const ingPath = ingredientPathMap.get(ingName);
			if (ingPath && ingredientPaths.has(ingPath)) {
				usesAny = true;
				break;
			}
		}
		if (usesAny) {
			const recipeNote = noteIndex.getByPath(recipePath);
			if (recipeNote) {
				relevantRecipes.push(recipeNote);
				// Only include ingredient names that match our displayed ingredients
				const filtered = new Set<string>();
				for (const ingName of recipeIngs) {
					const ingPath = ingredientPathMap.get(ingName);
					if (ingPath && ingredientPaths.has(ingPath)) {
						filtered.add(ingName);
					}
				}
				relevantRecipeIngredients.set(recipePath, filtered);
			}
		}
	}

	// Build substitute edges (ingredient → ingredient)
	const substituteEdges: Edge[] = [];
	for (const ing of ingredients) {
		const fm = ing.frontmatter as IngredientFrontmatter;
		if (fm.substitutes) {
			for (const sub of fm.substitutes) {
				const subPath = ingredientPathMap.get(sub.toLowerCase());
				if (subPath && subPath !== ing.path) {
					// Create edge stubs with id only — renderGraphView will resolve from nodeMap
					substituteEdges.push({
						source: { id: `i:${ing.name.toLowerCase()}` } as Node,
						target: { id: `i:${sub.toLowerCase()}` } as Node,
					});
				}
			}
		}
	}

	// All ingredient notes as extra nodes — connected ones will be skipped via nodeMap.has()
	const extraNodes = ingredients.map(ing => ({
		id: `i:${ing.name.toLowerCase()}`,
		label: ing.name,
		type: "ingredient" as const,
		path: ing.path,
	}));

	renderGraphView(
		container,
		relevantRecipes,
		relevantRecipeIngredients,
		onSelect,
		selectedPath,
		initialSettings,
		onSettingsChange,
		substituteEdges,
		ingredientPathMap,
		extraNodes,
	);
}

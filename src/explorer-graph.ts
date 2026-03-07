import type { GourmetNote } from "./types";

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

interface GraphSettings {
	centerForce: number;   // 0–10, default 3  (maps to 0.0001–0.01)
	repulsion: number;     // 0–10, default 5  (maps to 100–2000)
	linkDistance: number;   // 0–10, default 4  (maps to 30–200)
	linkForce: number;     // 0–10, default 5  (maps to 0.01–0.2)
	nodeSize: number;      // 0–10, default 5  (scale factor 0.5–2.0)
	showLabels: boolean;   // default true
	showOrphans: boolean;  // default true (nodes with degree 0)
}

const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
	centerForce: 3,
	repulsion: 5,
	linkDistance: 4,
	linkForce: 5,
	nodeSize: 5,
	showLabels: true,
	showOrphans: true,
};

// Persist settings across graph renders in the same session
let savedGraphSettings: GraphSettings = { ...DEFAULT_GRAPH_SETTINGS };

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
	cleanupListeners: (() => void) | null;
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
	selectedPath: string | null
): void {
	destroyGraph(container);
	container.empty();
	container.addClass("gl-explorer__graph");

	if (recipes.length === 0) {
		container.createDiv({ cls: "gl-explorer__empty", text: "No recipes to display" });
		return;
	}

	const settings: GraphSettings = { ...savedGraphSettings };

	// Build nodes and edges
	const nodeMap = new Map<string, Node>();
	const edges: Edge[] = [];

	for (const recipe of recipes) {
		const rNode: Node = {
			id: `r:${recipe.path}`,
			label: recipe.name,
			type: "recipe",
			x: Math.random() * 800 - 400,
			y: Math.random() * 600 - 300,
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
					nodeMap.set(iId, {
						id: iId,
						label: ing,
						type: "ingredient",
						x: Math.random() * 800 - 400,
						y: Math.random() * 600 - 300,
						vx: 0, vy: 0,
						fx: null, fy: null,
						degree: 0,
					});
				}
				const iNode = nodeMap.get(iId)!;
				edges.push({ source: rNode, target: iNode });
				rNode.degree++;
				iNode.degree++;
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
		cleanupListeners: null,
		settings,
	};

	const scale = mapNodeScale(settings.nodeSize);

	for (const n of nodes) {
		const g = document.createElementNS(ns, "g");
		g.setAttribute("class", `gl-graph__node gl-graph__node--${n.type}`);
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

		// Drag handling
		g.addEventListener("mousedown", (ev) => {
			if (ev.button !== 0) return;
			ev.stopPropagation();
			state.dragging = n;
			n.fx = n.x;
			n.fy = n.y;
			if (state.alpha < 0.05) {
				state.alpha = 0.3;
				startSimulation(state);
			} else {
				state.alpha = Math.max(state.alpha, 0.3);
			}
			svg.style.cursor = "grabbing";
		});

		g.addEventListener("click", (ev) => {
			ev.stopPropagation();
		});

		gNodes.appendChild(g);
	}

	graphWrap.appendChild(svg);

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
			savedGraphSettings = { ...settings };
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
			savedGraphSettings = { ...settings };
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
	let dragStartPos: { x: number; y: number } | null = null;
	let dragMoved = false;
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
			if (dragStartPos) {
				const dx = ev.clientX - dragStartPos.x;
				const dy = ev.clientY - dragStartPos.y;
				if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
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
				if (node.type === "recipe" && node.path) {
					onSelect(node.path);
				} else if (node.type === "ingredient") {
					if (state.highlightedIng === node.id) {
						state.highlightedIng = null;
						clearHighlight(gNodes, gEdges);
					} else {
						state.highlightedIng = node.id;
						highlightIngredient(node, nodes, edges, gNodes, gEdges);
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

	state.cleanupListeners = () => {
		document.removeEventListener("mousemove", onMouseMove);
		document.removeEventListener("mouseup", onMouseUp);
	};

	simStates.set(container, state);
	startSimulation(state);
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

		// Apply velocity
		for (const n of nodes) {
			if (n.fx != null) { n.x = n.fx; n.vx = 0; }
			else { n.vx *= damping; n.x += n.vx * state.alpha; }
			if (n.fy != null) { n.y = n.fy; n.vy = 0; }
			else { n.vy *= damping; n.y += n.vy * state.alpha; }
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
		state.alpha *= 0.995;

		if (state.alpha > 0.001 || state.dragging) {
			state.rafId = requestAnimationFrame(tick);
		}
	};

	state.rafId = requestAnimationFrame(tick);
}

function highlightIngredient(
	ingNode: Node,
	allNodes: Node[],
	edges: Edge[],
	gNodes: SVGGElement,
	gEdges: SVGGElement
): void {
	const connected = new Set<string>();
	connected.add(ingNode.id);
	for (const e of edges) {
		if (e.source.id === ingNode.id) connected.add(e.target.id);
		if (e.target.id === ingNode.id) connected.add(e.source.id);
	}

	for (const n of allNodes) {
		if (n.group) {
			n.group.classList.toggle("gl-graph__node--dim", !connected.has(n.id));
		}
	}

	const edgeEls = gEdges.children;
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		const isConn = e.source.id === ingNode.id || e.target.id === ingNode.id;
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

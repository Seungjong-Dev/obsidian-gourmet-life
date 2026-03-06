import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_RESTAURANT, type RestaurantFrontmatter, type RestaurantViewMode } from "./types";
import {
	renderRestaurantSidePanel,
	collectRestaurantSideState,
	destroyLeafletMap,
} from "./restaurant-side-panel";
import {
	renderRestaurantMainPanel,
	renderRestaurantTitleRow,
	collectRestaurantMainState,
} from "./restaurant-main-panel";
import { buildFrontmatterString } from "./frontmatter-utils";
import type GourmetLifePlugin from "./main";

interface RestaurantViewState {
	file: string;
	mode: RestaurantViewMode;
}

export class RestaurantView extends ItemView {
	private plugin: GourmetLifePlugin;
	private filePath: string = "";
	private mode: RestaurantViewMode = "viewer";
	private titleRow: HTMLElement = null!;
	private sideContainer: HTMLElement = null!;
	private mainContainer: HTMLElement = null!;
	private rootContainer: HTMLElement = null!;
	private resizeObserver: ResizeObserver | null = null;
	private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	private isSaving = false;
	private lastSavedContent = "";
	private renderVersion = 0;
	private lastRenderedFile = "";
	private isRendering = false;

	constructor(leaf: WorkspaceLeaf, plugin: GourmetLifePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RESTAURANT;
	}

	getDisplayText(): string {
		if (this.filePath) {
			return this.filePath
				.substring(this.filePath.lastIndexOf("/") + 1)
				.replace(/\.md$/, "");
		}
		return "Restaurant";
	}

	getIcon(): string {
		return "map-pin";
	}

	async setState(
		state: RestaurantViewState,
		result: { history: boolean }
	): Promise<void> {
		this.filePath = state.file || "";
		this.mode = state.mode || "viewer";
		await this.render();
		await super.setState(state, result);
	}

	getState(): RestaurantViewState {
		return { file: this.filePath, mode: this.mode };
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.style.position = "relative";

		this.rootContainer = container.createDiv({ cls: "gl-restaurant" });
		this.titleRow = this.rootContainer.createDiv({ cls: "gl-restaurant__title-row" });
		this.sideContainer = this.rootContainer.createDiv({ cls: "gl-restaurant__side" });
		this.mainContainer = this.rootContainer.createDiv({ cls: "gl-restaurant__main" });

		// Responsive layout
		this.resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const width = entry.contentRect.width;
				if (width < 600) {
					this.rootContainer.addClass("gl-restaurant--single");
				} else {
					this.rootContainer.removeClass("gl-restaurant--single");
				}
			}
		});
		this.resizeObserver.observe(container);

		// Ctrl+E / Cmd+E to toggle mode
		this.registerDomEvent(this.containerEl, "keydown", (e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "e") {
				e.preventDefault();
				this.toggleMode();
			}
		});

		// Re-render on external metadata change
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.path === this.filePath && !this.isSaving && !this.isRendering) {
					this.render();
				}
			})
		);

		if (this.filePath) {
			await this.render();
		}
	}

	async onClose(): Promise<void> {
		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			await this.autoSave();
		}
		if (this.sideContainer) destroyLeafletMap(this.sideContainer);
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
	}

	async setFile(filePath: string): Promise<void> {
		if (this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			await this.autoSave();
		}
		this.filePath = filePath;
		this.mode = "viewer";
		await this.render();
		this.leaf.updateHeader();
	}

	private toggleMode(): void {
		if (this.mode === "editor" && this.autoSaveTimer) {
			clearTimeout(this.autoSaveTimer);
			this.autoSaveTimer = null;
			this.autoSave();
		}
		this.mode = this.mode === "viewer" ? "editor" : "viewer";
		this.render();
	}

	private async render(): Promise<void> {
		if (!this.filePath) return;
		const thisRender = ++this.renderVersion;

		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as unknown as RestaurantFrontmatter;
		if (!fm || fm.type !== "restaurant") {
			// Cache not ready — schedule one retry
			if (thisRender === this.renderVersion) {
				setTimeout(() => this.render(), 100);
			}
			return;
		}

		this.isRendering = true;
		try {
			const content = await this.app.vault.read(file);
			if (thisRender !== this.renderVersion) return;
			const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
			const bodyContent = fmMatch ? content.substring(fmMatch[0].length) : content;

			this.lastSavedContent = content;

			this.rootContainer.toggleClass("gl-restaurant--editor", this.mode === "editor");

			const sideScroll = this.sideContainer?.scrollTop ?? 0;
			const mainScroll = this.mainContainer?.scrollTop ?? 0;

			const resourcePath = (path: string) => this.resolveResourcePath(path);

			// Side panel
			try {
				renderRestaurantSidePanel(
					this.sideContainer,
					fm,
					bodyContent,
					resourcePath,
					this.mode,
					{
						onInput: () => this.scheduleAutoSave(),
					},
					this.app,
					this.filePath
				);
			} catch (err) {
				console.error("[GourmetLife] Side panel render failed in view:", err);
			}
			// Title row + Main panel
			const callbacks = {
				onViewSource: () => this.handleViewSource(),
				onToggleMode: () => this.toggleMode(),
				onTitleChange: async (newTitle: string) => {
					const f = this.app.vault.getAbstractFileByPath(this.filePath);
					if (!f || !(f instanceof TFile)) return;
					const parent = f.parent?.path ?? "";
					const newPath = parent ? `${parent}/${newTitle}.md` : `${newTitle}.md`;
					await this.app.fileManager.renameFile(f, newPath);
					this.filePath = newPath;
					this.leaf.updateHeader();
				},
				onMenuInput: () => this.scheduleAutoSave(),
				onNotesInput: () => this.scheduleAutoSave(),
				onReviewsInput: () => this.scheduleAutoSave(),
			};

			const title = this.filePath
				.substring(this.filePath.lastIndexOf("/") + 1)
				.replace(/\.md$/, "");

			try {
				renderRestaurantTitleRow(this.titleRow, title, this.mode, callbacks);
			} catch (err) {
				console.error("[GourmetLife] Title row render failed:", err);
			}

			try {
				renderRestaurantMainPanel(this.mainContainer, bodyContent, this.mode, callbacks);
			} catch (err) {
				console.error("[GourmetLife] Main panel render failed:", err);
			}

			const isNewFile = this.filePath !== this.lastRenderedFile;
			if (isNewFile) {
				this.sideContainer.scrollTop = 0;
				this.mainContainer.scrollTop = 0;
				this.lastRenderedFile = this.filePath;
			} else {
				this.sideContainer.scrollTop = sideScroll;
				this.mainContainer.scrollTop = mainScroll;
			}
		} finally {
			this.isRendering = false;
		}
	}

	// ── Resource resolution ──

	private resolveResourcePath(path: string): string {
		const cleaned = path.replace(/^\[\[|\]\]$/g, "");
		const resolved = this.app.metadataCache.getFirstLinkpathDest(cleaned, this.filePath ?? "");
		if (resolved) {
			return this.app.vault.adapter.getResourcePath(resolved.path);
		}
		const match = this.app.vault.getFiles().find(f => f.name === cleaned || f.path === cleaned);
		return this.app.vault.adapter.getResourcePath(match?.path ?? cleaned);
	}

	// ── Auto-save ──

	private scheduleAutoSave(): void {
		if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
		this.autoSaveTimer = setTimeout(() => {
			this.autoSaveTimer = null;
			this.autoSave();
		}, 1000);
	}

	private async autoSave(): Promise<void> {
		if (this.mode !== "editor") return;

		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;

		const content = this.buildFileContent(file);
		if (content === this.lastSavedContent) return;

		this.isSaving = true;
		await this.app.vault.modify(file, content);
		this.lastSavedContent = content;

		setTimeout(() => {
			this.isSaving = false;
		}, 200);
	}

	private buildFileContent(file: TFile): string {
		const sideState = collectRestaurantSideState(this.sideContainer);
		const mainState = collectRestaurantMainState(this.mainContainer);

		const fmData: Record<string, unknown> = { type: "restaurant" };
		if (sideState.cuisine) fmData.cuisine = sideState.cuisine;
		if (sideState.location) fmData.location = sideState.location;
		if (sideState.price_range) fmData.price_range = sideState.price_range;
		const rating = parseFloat(sideState.rating);
		if (!isNaN(rating) && rating >= 1 && rating <= 5) fmData.rating = rating;
		if (sideState.url) fmData.url = sideState.url;
		if (sideState.image) fmData.image = sideState.image;
		const lat = parseFloat(sideState.lat);
		const lng = parseFloat(sideState.lng);
		if (!isNaN(lat)) fmData.lat = lat;
		if (!isNaN(lng)) fmData.lng = lng;
		if (sideState.tags) {
			fmData.tags = sideState.tags
				.split(",")
				.map((s: string) => s.trim())
				.filter(Boolean);
		}

		// Preserve created date
		const cache = this.app.metadataCache.getFileCache(file);
		const origFm = cache?.frontmatter;
		if (origFm?.created) fmData.created = origFm.created;

		const frontmatter = buildFrontmatterString(fmData);
		const body = buildRestaurantBody(mainState.menuHighlights, mainState.notes, mainState.reviews);

		return `${frontmatter}\n${body}`;
	}

	// ── Navigation ──

	private async handleViewSource(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!file || !(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}
}

function buildRestaurantBody(
	menuHighlights: string,
	notes: string,
	reviews: string
): string {
	const lines: string[] = [];

	lines.push("## Menu Highlights");
	lines.push("");
	if (menuHighlights.trim()) {
		lines.push(menuHighlights.trim());
	}
	lines.push("");

	lines.push("## Notes");
	lines.push("");
	if (notes.trim()) {
		lines.push(notes.trim());
	}
	lines.push("");

	lines.push("## Reviews");
	lines.push("");
	if (reviews.trim()) {
		lines.push(reviews.trim());
	}
	lines.push("");

	return lines.join("\n");
}

import type { TFile } from "obsidian";

export interface TextareaSuggestConfig<T> {
	trigger: string;
	closingStr: string;
	getItems: () => T[];
	getItemText: (item: T) => string;
	renderItem: (item: T, el: HTMLElement) => void;
	onSelect: (
		item: T,
		textarea: HTMLTextAreaElement,
		start: number,
		end: number
	) => void;
}

const MAX_ITEMS = 8;

export class TextareaSuggest<T> {
	private textarea: HTMLTextAreaElement;
	private config: TextareaSuggestConfig<T>;
	private popup: HTMLElement | null = null;
	private mirror: HTMLElement | null = null;
	private items: T[] = [];
	private activeIndex = 0;
	private triggerStart = -1;

	private boundOnInput: () => void;
	private boundOnKeydown: (e: KeyboardEvent) => void;
	private boundOnBlur: (e: FocusEvent) => void;
	private boundOnScroll: () => void;

	constructor(
		textarea: HTMLTextAreaElement,
		config: TextareaSuggestConfig<T>
	) {
		this.textarea = textarea;
		this.config = config;

		this.boundOnInput = this.onInput.bind(this);
		this.boundOnKeydown = this.onKeydown.bind(this);
		this.boundOnBlur = this.onBlur.bind(this);
		this.boundOnScroll = this.updatePosition.bind(this);

		this.textarea.addEventListener("input", this.boundOnInput);
		this.textarea.addEventListener("keydown", this.boundOnKeydown);
		this.textarea.addEventListener("blur", this.boundOnBlur);
		this.textarea.addEventListener("scroll", this.boundOnScroll);
	}

	destroy(): void {
		this.textarea.removeEventListener("input", this.boundOnInput);
		this.textarea.removeEventListener("keydown", this.boundOnKeydown);
		this.textarea.removeEventListener("blur", this.boundOnBlur);
		this.textarea.removeEventListener("scroll", this.boundOnScroll);
		this.closePopup();
		this.removeMirror();
	}

	private onInput(): void {
		const pos = this.textarea.selectionStart;
		const text = this.textarea.value.substring(0, pos);

		const trigIdx = text.lastIndexOf(this.config.trigger);
		if (trigIdx === -1) {
			this.closePopup();
			return;
		}

		// Check if already closed with closingStr
		const afterTrigger = this.textarea.value.substring(trigIdx + this.config.trigger.length);
		const closingIdx = afterTrigger.indexOf(this.config.closingStr);
		if (closingIdx !== -1 && trigIdx + this.config.trigger.length + closingIdx < pos) {
			this.closePopup();
			return;
		}

		// Check for newline between trigger and cursor (don't span lines)
		const query = text.substring(trigIdx + this.config.trigger.length);
		if (query.includes("\n")) {
			this.closePopup();
			return;
		}

		this.triggerStart = trigIdx;
		const allItems = this.config.getItems();

		if (query) {
			const lowerQuery = query.toLowerCase();
			this.items = allItems
				.filter((item) =>
					this.config.getItemText(item).toLowerCase().includes(lowerQuery)
				)
				.slice(0, MAX_ITEMS);
		} else {
			this.items = allItems.slice(0, MAX_ITEMS);
		}

		if (this.items.length === 0) {
			this.closePopup();
			return;
		}

		this.activeIndex = 0;
		this.showPopup();
	}

	private onKeydown(e: KeyboardEvent): void {
		if (!this.popup) return;

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				this.activeIndex = (this.activeIndex + 1) % this.items.length;
				this.renderItems();
				break;
			case "ArrowUp":
				e.preventDefault();
				this.activeIndex =
					(this.activeIndex - 1 + this.items.length) % this.items.length;
				this.renderItems();
				break;
			case "Enter":
			case "Tab":
				e.preventDefault();
				this.selectItem(this.activeIndex);
				break;
			case "Escape":
				e.preventDefault();
				this.closePopup();
				break;
		}
	}

	private onBlur(e: FocusEvent): void {
		// Delay close so click on popup item registers first
		const related = e.relatedTarget as HTMLElement | null;
		if (related && this.popup?.contains(related)) return;
		setTimeout(() => this.closePopup(), 150);
	}

	private selectItem(index: number): void {
		const item = this.items[index];
		if (!item) return;

		const pos = this.textarea.selectionStart;
		this.config.onSelect(item, this.textarea, this.triggerStart, pos);
		this.closePopup();
	}

	private showPopup(): void {
		if (!this.popup) {
			this.popup = document.createElement("div");
			this.popup.classList.add("gl-suggest");
			document.body.appendChild(this.popup);
		}

		this.renderItems();
		this.updatePosition();
	}

	private renderItems(): void {
		if (!this.popup) return;
		this.popup.empty();

		this.items.forEach((item, i) => {
			const row = this.popup!.createDiv({
				cls:
					"gl-suggest__item" +
					(i === this.activeIndex ? " gl-suggest__item--active" : ""),
			});
			this.config.renderItem(item, row);
			row.addEventListener("mousedown", (e) => {
				e.preventDefault(); // keep focus on textarea
				this.selectItem(i);
			});
			row.addEventListener("mouseenter", () => {
				this.activeIndex = i;
				this.renderItems();
			});
		});
	}

	private updatePosition(): void {
		if (!this.popup) return;

		const coords = this.getCursorCoordinates();
		if (!coords) return;

		this.popup.style.left = `${coords.left}px`;
		this.popup.style.top = `${coords.top}px`;
	}

	/**
	 * Mirror div technique to compute cursor pixel coordinates.
	 */
	private getCursorCoordinates(): { left: number; top: number } | null {
		const ta = this.textarea;

		if (!this.mirror) {
			this.mirror = document.createElement("div");
			this.mirror.classList.add("gl-suggest-mirror");
			document.body.appendChild(this.mirror);
		}

		const style = window.getComputedStyle(ta);
		const props = [
			"fontFamily",
			"fontSize",
			"fontWeight",
			"lineHeight",
			"letterSpacing",
			"wordSpacing",
			"textIndent",
			"whiteSpace",
			"wordWrap",
			"overflowWrap",
			"paddingTop",
			"paddingRight",
			"paddingBottom",
			"paddingLeft",
			"borderTopWidth",
			"borderRightWidth",
			"borderBottomWidth",
			"borderLeftWidth",
			"boxSizing",
		] as const;

		const m = this.mirror;
		for (const prop of props) {
			m.style[prop as any] = style[prop as any];
		}
		m.style.position = "absolute";
		m.style.visibility = "hidden";
		m.style.overflow = "hidden";
		m.style.width = `${ta.clientWidth}px`;
		m.style.height = "auto";
		m.style.whiteSpace = "pre-wrap";
		m.style.wordWrap = "break-word";

		const pos = ta.selectionStart;
		const textBefore = ta.value.substring(0, pos);

		m.textContent = textBefore;

		const marker = document.createElement("span");
		marker.textContent = "\u200B"; // zero-width space
		m.appendChild(marker);

		const taRect = ta.getBoundingClientRect();
		const markerRect = marker.getBoundingClientRect();

		const left = taRect.left + (markerRect.left - m.getBoundingClientRect().left) - ta.scrollLeft;
		const top = taRect.top + (markerRect.top - m.getBoundingClientRect().top) - ta.scrollTop + markerRect.height;

		return { left, top };
	}

	private closePopup(): void {
		if (this.popup) {
			this.popup.remove();
			this.popup = null;
		}
		this.items = [];
		this.triggerStart = -1;
	}

	private removeMirror(): void {
		if (this.mirror) {
			this.mirror.remove();
			this.mirror = null;
		}
	}
}

// ── Image-specific helpers ──

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"];

/**
 * Sort image files: recipe-folder images first, then by most-recently-modified.
 */
export function sortImageFiles(files: TFile[], recipePath?: string): TFile[] {
	const folder = recipePath
		? recipePath.substring(0, recipePath.lastIndexOf("/") + 1)
		: "";

	return files.slice().sort((a, b) => {
		if (folder) {
			const aLocal = a.path.startsWith(folder) ? 0 : 1;
			const bLocal = b.path.startsWith(folder) ? 0 : 1;
			if (aLocal !== bLocal) return aLocal - bLocal;
		}
		return b.stat.mtime - a.stat.mtime;
	});
}

export function createImageSuggest(
	textarea: HTMLTextAreaElement,
	getFiles: () => TFile[],
	recipePath?: string
): TextareaSuggest<TFile> {
	return new TextareaSuggest(textarea, {
		trigger: "![[",
		closingStr: "]]",
		getItems: () =>
			sortImageFiles(
				getFiles().filter((f) => IMAGE_EXTENSIONS.includes(f.extension)),
				recipePath
			),
		getItemText: (file) => file.name,
		renderItem: (file, el) => {
			el.createDiv({ text: file.name, cls: "gl-suggest__name" });
			el.createDiv({ text: file.path, cls: "gl-suggest__path" });
		},
		onSelect: (file, ta, start, end) => {
			const before = ta.value.substring(0, start);
			const after = ta.value.substring(end);
			const insertion = `![[${file.name}]]`;

			ta.value = before + insertion + after;
			const cursorPos = start + insertion.length;
			ta.selectionStart = cursorPos;
			ta.selectionEnd = cursorPos;
			ta.dispatchEvent(new Event("input", { bubbles: true }));
		},
	});
}

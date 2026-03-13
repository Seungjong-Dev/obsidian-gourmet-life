/**
 * Lightweight combobox for <input> elements.
 * Shows a dropdown of suggestions filtered by the current input value.
 * Allows free-text entry — selecting a suggestion replaces the input value.
 */

const MAX_ITEMS = 8;

export class InputSuggest {
	private input: HTMLInputElement;
	private getItems: () => string[];
	private onSelect: (() => void) | undefined;
	private popup: HTMLElement | null = null;
	private items: string[] = [];
	private activeIndex = 0;

	private boundOnInput: () => void;
	private boundOnKeydown: (e: KeyboardEvent) => void;
	private boundOnBlur: (e: FocusEvent) => void;
	private boundOnFocus: () => void;

	constructor(
		input: HTMLInputElement,
		getItems: () => string[],
		onSelect?: () => void
	) {
		this.input = input;
		this.getItems = getItems;
		this.onSelect = onSelect;

		this.boundOnInput = this.onInputEvent.bind(this);
		this.boundOnKeydown = this.onKeydown.bind(this);
		this.boundOnBlur = this.onBlur.bind(this);
		this.boundOnFocus = this.onInputEvent.bind(this);

		this.input.addEventListener("input", this.boundOnInput);
		this.input.addEventListener("keydown", this.boundOnKeydown);
		this.input.addEventListener("blur", this.boundOnBlur);
		this.input.addEventListener("focus", this.boundOnFocus);
	}

	destroy(): void {
		this.input.removeEventListener("input", this.boundOnInput);
		this.input.removeEventListener("keydown", this.boundOnKeydown);
		this.input.removeEventListener("blur", this.boundOnBlur);
		this.input.removeEventListener("focus", this.boundOnFocus);
		this.closePopup();
	}

	private onInputEvent(): void {
		const query = this.input.value.trim().toLowerCase();
		const allItems = this.getItems();

		if (query) {
			this.items = allItems
				.filter((item) => item.toLowerCase().includes(query))
				.slice(0, MAX_ITEMS);
		} else {
			this.items = allItems.slice(0, MAX_ITEMS);
		}

		// Don't show if the only match is exactly what's typed
		if (this.items.length === 1 && this.items[0].toLowerCase() === query) {
			this.closePopup();
			return;
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
		if (e.isComposing) return;

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
		const related = e.relatedTarget as HTMLElement | null;
		if (related && this.popup?.contains(related)) return;
		setTimeout(() => this.closePopup(), 150);
	}

	private selectItem(index: number): void {
		const item = this.items[index];
		if (!item) return;

		this.input.value = item;
		this.input.dispatchEvent(new Event("input", { bubbles: true }));
		this.closePopup();
		this.onSelect?.();
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
			row.createDiv({ text: item, cls: "gl-suggest__name" });
			row.addEventListener("mousedown", (e) => {
				e.preventDefault();
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
		const rect = this.input.getBoundingClientRect();
		this.popup.style.left = `${rect.left}px`;
		this.popup.style.top = `${rect.bottom + 2}px`;
		this.popup.style.minWidth = `${rect.width}px`;
	}

	private closePopup(): void {
		if (this.popup) {
			this.popup.remove();
			this.popup = null;
		}
		this.items = [];
	}
}

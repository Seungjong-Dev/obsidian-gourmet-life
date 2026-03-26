import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import { ImageSuggestModal } from "./image-suggest-modal";
import {
	formatRecipeReview,
	formatRestaurantVisit,
	appendReviewToFile,
	importImageToVault,
	isImageFile,
	todayString,
	type ReviewPrefill,
} from "./review-utils";

interface DishEntry {
	name: string;
	rating: number;
	comment: string;
}

interface PhotoEntry {
	/** Display name (filename) */
	name: string;
	/** If from vault, the vault path. If imported, set after import. */
	vaultPath?: string;
	/** If from device, the raw ArrayBuffer to import. */
	buffer?: ArrayBuffer;
	/** Object URL for thumbnail preview */
	objectUrl?: string;
}

type ReviewMode = "recipe" | "restaurant";

export class ReviewModal extends Modal {
	private mode: ReviewMode;
	private file: TFile;
	private onDone: () => void;
	private prefill?: ReviewPrefill;
	private onEditSubmit?: (newReviewMd: string) => Promise<void>;
	private mediaFolder: string;

	private dateInput: HTMLInputElement | null = null;
	private ratingValue = 0;
	private reviewText: HTMLTextAreaElement | null = null;
	private dishes: DishEntry[] = [];
	private dishContainer: HTMLElement | null = null;
	private photos: PhotoEntry[] = [];
	private photoStrip: HTMLElement | null = null;

	constructor(
		app: App,
		mode: ReviewMode,
		file: TFile,
		onDone: () => void,
		prefill?: ReviewPrefill,
		onEditSubmit?: (newReviewMd: string) => Promise<void>,
		mediaFolder = "media"
	) {
		super(app);
		this.mode = mode;
		this.file = file;
		this.onDone = onDone;
		this.prefill = prefill;
		this.onEditSubmit = onEditSubmit;
		this.mediaFolder = mediaFolder;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("gl-modal", "gl-review-modal");

		const isEdit = !!this.prefill;
		contentEl.createEl("h2", {
			text: isEdit
				? (this.mode === "recipe" ? "Edit Review" : "Edit Visit Review")
				: (this.mode === "recipe" ? "New Review" : "New Visit Review"),
		});

		// Date
		new Setting(contentEl)
			.setName("Date")
			.addText((text) => {
				text.setValue(this.prefill?.date || todayString());
				text.inputEl.type = "date";
				this.dateInput = text.inputEl;
			});

		if (this.mode === "recipe") {
			this.buildRecipeForm(contentEl);
		} else {
			this.buildRestaurantForm(contentEl);
		}

		// Prefill recipe fields
		if (this.prefill && this.mode === "recipe") {
			if (this.prefill.rating) {
				this.ratingValue = this.prefill.rating;
				const starContainer = contentEl.querySelector(".gl-review-modal__star-picker") as HTMLElement | null;
				if (starContainer) this.renderStarPicker(starContainer, this.ratingValue);
			}
			if (this.prefill.text && this.reviewText) {
				this.reviewText.value = this.prefill.text;
			}
		}

		// Prefill restaurant fields
		if (this.prefill && this.mode === "restaurant") {
			if (this.prefill.dishes && this.prefill.dishes.length > 0) {
				// Remove the default empty row
				this.dishes = [];
				if (this.dishContainer) this.dishContainer.empty();
				for (const dish of this.prefill.dishes) {
					this.addDishRow(dish);
				}
			}
			if (this.prefill.generalComment && this.reviewText) {
				this.reviewText.value = this.prefill.generalComment;
			}
		}

		// Photos section (must be built before prefilling photos)
		this.buildPhotoSection(contentEl);

		// Show existing photos as thumbnails
		if (this.prefill?.photos && this.prefill.photos.length > 0) {
			for (const vaultPath of this.prefill.photos) {
				const entry: PhotoEntry = { name: vaultPath.split("/").pop() || vaultPath, vaultPath };
				this.photos.push(entry);
				this.renderPhotoThumb(entry);
			}
		}

		// Submit
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(isEdit ? "Update Review" : "Save Review")
					.setCta()
					.onClick(() => this.handleSubmit())
			);
	}

	onClose(): void {
		// Revoke object URLs
		for (const p of this.photos) {
			if (p.objectUrl) URL.revokeObjectURL(p.objectUrl);
		}
	}

	// ── Recipe Form ──

	private buildRecipeForm(container: HTMLElement): void {
		// Star rating picker
		const ratingSetting = new Setting(container).setName("Rating");
		const starContainer = ratingSetting.controlEl.createDiv({
			cls: "gl-review-modal__star-picker",
		});
		this.renderStarPicker(starContainer, 0);

		// Review text
		new Setting(container)
			.setName("Review")
			.addTextArea((ta) => {
				ta.setPlaceholder("How was it?");
				ta.inputEl.rows = 4;
				ta.inputEl.addClass("gl-review-modal__textarea");
				this.reviewText = ta.inputEl;
			});
	}

	// ── Restaurant Form ──

	private buildRestaurantForm(container: HTMLElement): void {
		// Dishes section
		container.createEl("h3", {
			text: "Dishes",
			cls: "gl-review-modal__section-title",
		});
		this.dishContainer = container.createDiv({ cls: "gl-review-modal__dish-list" });

		// Add first dish row
		this.addDishRow();

		// Add dish button
		const addDishBtn = container.createEl("button", {
			text: "+ Add Dish",
			cls: "gl-review-modal__add-dish-btn",
		});
		addDishBtn.addEventListener("click", () => this.addDishRow());

		// General comment
		new Setting(container)
			.setName("Comment")
			.addTextArea((ta) => {
				ta.setPlaceholder("Overall impression...");
				ta.inputEl.rows = 3;
				ta.inputEl.addClass("gl-review-modal__textarea");
				this.reviewText = ta.inputEl;
			});
	}

	private addDishRow(prefillDish?: { name: string; rating: number; comment: string }): void {
		if (!this.dishContainer) return;

		const entry: DishEntry = prefillDish
			? { ...prefillDish }
			: { name: "", rating: 0, comment: "" };
		this.dishes.push(entry);
		const idx = this.dishes.length - 1;

		const row = this.dishContainer.createDiv({ cls: "gl-review-modal__dish-row" });

		// Dish name
		const nameInput = row.createEl("input", {
			cls: "gl-review-modal__dish-name",
			type: "text",
			placeholder: "Dish name",
		}) as HTMLInputElement;
		if (entry.name) nameInput.value = entry.name;
		nameInput.oninput = () => {
			this.dishes[idx].name = nameInput.value;
		};

		// Star rating
		const starsEl = row.createDiv({ cls: "gl-review-modal__dish-stars" });
		this.renderDishStarPicker(starsEl, idx, entry.rating);

		// Comment
		const commentInput = row.createEl("input", {
			cls: "gl-review-modal__dish-comment",
			type: "text",
			placeholder: "Comment",
		}) as HTMLInputElement;
		if (entry.comment) commentInput.value = entry.comment;
		commentInput.oninput = () => {
			this.dishes[idx].comment = commentInput.value;
		};

		// Remove button
		const removeBtn = row.createEl("button", {
			cls: "gl-review-modal__dish-remove",
		});
		setIcon(removeBtn, "x");
		removeBtn.addEventListener("click", () => {
			const currentIdx = this.dishes.indexOf(entry);
			if (currentIdx >= 0) this.dishes.splice(currentIdx, 1);
			row.remove();
			this.reindexDishRows();
		});
	}

	private reindexDishRows(): void {
		if (!this.dishContainer) return;
		const rows = this.dishContainer.querySelectorAll(".gl-review-modal__dish-row");
		rows.forEach((row, i) => {
			const nameInput = row.querySelector(".gl-review-modal__dish-name") as HTMLInputElement | null;
			const commentInput = row.querySelector(".gl-review-modal__dish-comment") as HTMLInputElement | null;
			if (nameInput) {
				nameInput.oninput = () => { this.dishes[i].name = nameInput.value; };
			}
			if (commentInput) {
				commentInput.oninput = () => { this.dishes[i].comment = commentInput.value; };
			}
			const starsEl = row.querySelector(".gl-review-modal__dish-stars") as HTMLElement | null;
			if (starsEl) {
				this.renderDishStarPicker(starsEl, i, this.dishes[i].rating);
			}
		});
	}

	// ── Star Pickers ──

	private renderStarPicker(container: HTMLElement, current: number): void {
		container.empty();
		for (let i = 1; i <= 5; i++) {
			const star = container.createSpan({
				text: i <= current ? "\u2605" : "\u2606",
				cls: `gl-star gl-review-modal__star ${i <= current ? "gl-star--full" : "gl-star--empty"}`,
			});
			star.addEventListener("click", () => {
				this.ratingValue = i;
				this.renderStarPicker(container, i);
			});
		}
	}

	private renderDishStarPicker(container: HTMLElement, dishIdx: number, current: number): void {
		container.empty();
		for (let i = 1; i <= 5; i++) {
			const star = container.createSpan({
				text: i <= current ? "\u2605" : "\u2606",
				cls: `gl-star gl-review-modal__star ${i <= current ? "gl-star--full" : "gl-star--empty"}`,
			});
			star.addEventListener("click", () => {
				this.dishes[dishIdx].rating = i;
				this.renderDishStarPicker(container, dishIdx, i);
			});
		}
	}

	// ── Photos ──

	private buildPhotoSection(container: HTMLElement): void {
		const section = container.createDiv({ cls: "gl-review-modal__photo-section" });
		section.createEl("h3", {
			text: "Photos",
			cls: "gl-review-modal__section-title",
		});

		this.photoStrip = section.createDiv({ cls: "gl-review-modal__photo-strip" });

		const btnRow = section.createDiv({ cls: "gl-review-modal__photo-buttons" });

		// Camera (direct capture on mobile)
		const cameraBtn = btnRow.createEl("button", {
			cls: "gl-review-modal__photo-btn",
		});
		setIcon(cameraBtn, "camera");
		cameraBtn.appendText(" Camera");
		cameraBtn.addEventListener("click", () => this.pickFromCamera());

		// Gallery (file picker without capture)
		const galleryBtn = btnRow.createEl("button", {
			cls: "gl-review-modal__photo-btn",
		});
		setIcon(galleryBtn, "image-plus");
		galleryBtn.appendText(" Gallery");
		galleryBtn.addEventListener("click", () => this.pickFromGallery());

		// From vault
		const vaultBtn = btnRow.createEl("button", {
			cls: "gl-review-modal__photo-btn",
		});
		setIcon(vaultBtn, "image");
		vaultBtn.appendText(" From vault");
		vaultBtn.addEventListener("click", () => this.pickFromVault());
	}

	private pickFromCamera(): void {
		this.pickFromFileInput(true);
	}

	private pickFromGallery(): void {
		this.pickFromFileInput(false);
	}

	private pickFromFileInput(useCapture: boolean): void {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.multiple = true;
		if (useCapture) {
			input.setAttribute("capture", "environment");
		}
		input.addEventListener("change", async () => {
			if (!input.files) return;
			for (const file of Array.from(input.files)) {
				if (!isImageFile(file.name)) continue;
				const buffer = await file.arrayBuffer();
				const objectUrl = URL.createObjectURL(file);
				const entry: PhotoEntry = {
					name: file.name,
					buffer,
					objectUrl,
				};
				this.photos.push(entry);
				this.renderPhotoThumb(entry);
			}
		});
		input.click();
	}

	private pickFromVault(): void {
		new ImageSuggestModal(
			this.app,
			(file: TFile) => {
				const entry: PhotoEntry = {
					name: file.name,
					vaultPath: file.path,
				};
				this.photos.push(entry);
				this.renderPhotoThumb(entry);
			},
			this.file.path
		).open();
	}

	private renderPhotoThumb(entry: PhotoEntry): void {
		if (!this.photoStrip) return;

		const thumb = this.photoStrip.createDiv({ cls: "gl-review-modal__photo-thumb" });

		if (entry.objectUrl) {
			thumb.createEl("img", { attr: { src: entry.objectUrl } });
		} else if (entry.vaultPath) {
			// Resolve link path (may be filename-only or full path)
			const resolved = this.app.metadataCache.getFirstLinkpathDest(entry.vaultPath, this.file.path);
			if (resolved) {
				const resourcePath = this.app.vault.getResourcePath(resolved);
				thumb.createEl("img", { attr: { src: resourcePath } });
			} else {
				const resourcePath = this.app.vault.adapter.getResourcePath(entry.vaultPath);
				thumb.createEl("img", { attr: { src: resourcePath } });
			}
		}

		const nameEl = thumb.createSpan({
			text: entry.name,
			cls: "gl-review-modal__photo-name",
		});

		const removeBtn = thumb.createEl("button", {
			cls: "gl-review-modal__photo-remove",
		});
		setIcon(removeBtn, "x");
		removeBtn.addEventListener("click", () => {
			const idx = this.photos.indexOf(entry);
			if (idx >= 0) this.photos.splice(idx, 1);
			if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
			thumb.remove();
		});
	}

	// ── Submit ──

	private async handleSubmit(): Promise<void> {
		const date = this.dateInput?.value || todayString();

		// Import device photos into vault
		const photoPaths: string[] = [];
		for (const photo of this.photos) {
			if (photo.vaultPath) {
				photoPaths.push(photo.vaultPath);
			} else if (photo.buffer) {
				try {
					const path = await importImageToVault(
						this.app,
						this.file,
						photo.buffer,
						photo.name,
						this.mediaFolder
					);
					photoPaths.push(path);
				} catch (err) {
					console.error("[GourmetLife] Failed to import photo:", err);
					new Notice(`Failed to import ${photo.name}`);
				}
			}
		}

		let reviewMd: string;
		if (this.mode === "recipe") {
			const text = this.reviewText?.value?.trim() ?? "";
			if (!this.ratingValue && !text && photoPaths.length === 0) {
				new Notice("Please add at least a rating, comment, or photo.");
				return;
			}
			reviewMd = formatRecipeReview(date, text, photoPaths, this.ratingValue);
		} else {
			const validDishes = this.dishes.filter((d) => d.name.trim());
			const comment = this.reviewText?.value?.trim() ?? "";
			if (validDishes.length === 0 && !comment && photoPaths.length === 0) {
				new Notice("Please add at least a dish review, comment, or photo.");
				return;
			}
			reviewMd = formatRestaurantVisit(date, validDishes, comment, photoPaths);
		}

		try {
			if (this.onEditSubmit) {
				await this.onEditSubmit(reviewMd);
				new Notice("Review updated!");
			} else {
				await appendReviewToFile(this.app, this.file, reviewMd);
				new Notice("Review added!");
			}
			this.close();
			this.onDone();
		} catch (err) {
			console.error("[GourmetLife] Failed to save review:", err);
			new Notice("Failed to save review.");
		}
	}
}

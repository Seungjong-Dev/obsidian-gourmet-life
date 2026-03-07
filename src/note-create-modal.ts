import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type { GourmetLifeSettings, GourmetNoteType } from "./types";
import {
	DIFFICULTY_OPTIONS,
	INGREDIENT_CATEGORIES,
	RECIPE_CATEGORIES,
	SEASONS,
	PRICE_RANGES,
} from "./types";
import { buildFrontmatterString } from "./frontmatter-utils";
import {
	getRecipeTemplate,
	getIngredientTemplate,
	getRestaurantTemplate,
} from "./template-utils";
import { suggestAreaFromLocation } from "./area-suggest";

interface FormData {
	[key: string]: string | string[] | number | undefined;
}

export class NoteCreateModal extends Modal {
	private noteType: GourmetNoteType;
	private settings: GourmetLifeSettings;
	private formData: FormData = {};
	private selectedSeasons: Set<string> = new Set();

	private onFileCreated?: (file: TFile) => void;

	constructor(
		app: App,
		noteType: GourmetNoteType,
		settings: GourmetLifeSettings,
		onFileCreated?: (file: TFile) => void
	) {
		super(app);
		this.noteType = noteType;
		this.settings = settings;
		this.onFileCreated = onFileCreated;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("gl-modal");

		const title = {
			recipe: "New Recipe",
			ingredient: "New Ingredient",
			restaurant: "New Restaurant",
		}[this.noteType];

		contentEl.createEl("h2", { text: title });

		// Name field (required for all types)
		this.addTextField(contentEl, "Name", "name", "", true);

		switch (this.noteType) {
			case "recipe":
				this.buildRecipeForm(contentEl);
				break;
			case "ingredient":
				this.buildIngredientForm(contentEl);
				break;
			case "restaurant":
				this.buildRestaurantForm(contentEl);
				break;
		}

		// Submit button
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Create")
				.setCta()
				.onClick(() => this.onSubmit())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private buildRecipeForm(el: HTMLElement): void {
		this.addTextField(el, "Cuisine (comma-separated)", "cuisine");
		this.addDropdown(el, "Category", "category", [
			"",
			...RECIPE_CATEGORIES,
		]);
		this.addDropdown(el, "Difficulty", "difficulty", [
			"",
			...DIFFICULTY_OPTIONS,
		]);
		this.addTextField(el, "Servings", "servings");
		this.addTextField(el, "Prep time (min)", "prep_time");
		this.addTextField(el, "Cook time (min)", "cook_time");
		this.addTextField(el, "Source", "source");
	}

	private buildIngredientForm(el: HTMLElement): void {
		this.addDropdown(el, "Category", "category", [
			"",
			...INGREDIENT_CATEGORIES,
		]);
		this.addSeasonCheckboxes(el);
		this.addTextField(el, "Aliases (comma-separated)", "aliases");
	}

	private buildRestaurantForm(el: HTMLElement): void {
		this.addTextField(el, "Cuisine", "cuisine");
		this.addTextField(el, "Address", "address");
		this.addTextField(el, "Area", "area");
		this.addDropdown(el, "Price range", "price_range", [
			"",
			...PRICE_RANGES,
		]);
		this.addTextField(el, "URL", "url");

		// Auto-suggest area from location
		// Find inputs by iterating setting fields
		const fields = el.querySelectorAll(".gl-modal__field");
		let addressInput: HTMLInputElement | null = null;
		let areaInput: HTMLInputElement | null = null;
		for (const field of fields) {
			const label = field.querySelector(".setting-item-name")?.textContent;
			if (label === "Address") addressInput = field.querySelector("input");
			if (label === "Area") areaInput = field.querySelector("input");
		}
		if (addressInput && areaInput) {
			let lastSuggested = "";
			const areaEl = areaInput;
			addressInput.addEventListener("input", () => {
				const currentArea = areaEl.value.trim();
				if (!currentArea || currentArea === lastSuggested) {
					const suggested = suggestAreaFromLocation((this.formData["address"] as string) || "");
					areaEl.value = suggested;
					this.formData["area"] = suggested;
					lastSuggested = suggested;
				}
			});
		}
	}

	private addTextField(
		el: HTMLElement,
		label: string,
		key: string,
		placeholder = "",
		autofocus = false
	): void {
		const setting = new Setting(el)
			.setName(label)
			.addText((text) => {
				text.setPlaceholder(placeholder).onChange((value) => {
					this.formData[key] = value;
				});
				if (autofocus) {
					setTimeout(() => text.inputEl.focus(), 50);
				}
			});
		setting.settingEl.addClass("gl-modal__field");
	}

	private addDropdown(
		el: HTMLElement,
		label: string,
		key: string,
		options: readonly string[]
	): void {
		const setting = new Setting(el)
			.setName(label)
			.addDropdown((dropdown) => {
				for (const opt of options) {
					dropdown.addOption(opt, opt || "—");
				}
				dropdown.onChange((value) => {
					this.formData[key] = value;
				});
			});
		setting.settingEl.addClass("gl-modal__field");
	}

	private addSeasonCheckboxes(el: HTMLElement): void {
		const setting = new Setting(el).setName("Season");
		setting.settingEl.addClass("gl-modal__field");

		const container = setting.controlEl.createDiv({
			cls: "gl-modal__checkboxes",
		});
		for (const season of SEASONS) {
			const label = container.createEl("label", {
				cls: "gl-modal__checkbox-label",
			});
			const checkbox = label.createEl("input", { type: "checkbox" });
			label.appendText(` ${season}`);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.selectedSeasons.add(season);
				} else {
					this.selectedSeasons.delete(season);
				}
			});
		}
	}

	private async onSubmit(): Promise<void> {
		const name = (this.formData["name"] as string || "").trim();
		if (!name) {
			new Notice("Name is required");
			return;
		}

		const folder = this.getFolder();
		const filePath = `${folder}/${name}.md`;

		// Check if file already exists
		if (this.app.vault.getAbstractFileByPath(filePath)) {
			new Notice(`File already exists: ${filePath}`);
			return;
		}

		const frontmatter = this.buildFrontmatter(name);
		const body = this.getTemplate();
		const content = `${frontmatter}\n${body}`;

		// Ensure folder exists
		const folderObj = this.app.vault.getAbstractFileByPath(folder);
		if (!folderObj) {
			await this.app.vault.createFolder(folder);
		}

		const file = await this.app.vault.create(filePath, content);
		this.close();

		if (this.onFileCreated) {
			this.onFileCreated(file as TFile);
		} else {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file as TFile);
		}
	}

	private getFolder(): string {
		switch (this.noteType) {
			case "recipe":
				return this.settings.recipesFolder;
			case "ingredient":
				return this.settings.ingredientsFolder;
			case "restaurant":
				return this.settings.restaurantsFolder;
		}
	}

	private buildFrontmatter(_name: string): string {
		const today = new Date().toISOString().split("T")[0];
		const data: Record<string, unknown> = { type: this.noteType };

		switch (this.noteType) {
			case "recipe": {
				const cuisineStr = (this.formData["cuisine"] as string || "").trim();
				if (cuisineStr) {
					data.cuisine = cuisineStr
						.split(",")
						.map((s: string) => s.trim())
						.filter(Boolean);
				}
				if (this.formData["category"])
					data.category = this.formData["category"];
				if (this.formData["difficulty"])
					data.difficulty = this.formData["difficulty"];
				const servings = parseInt(
					this.formData["servings"] as string,
					10
				);
				if (!isNaN(servings)) data.servings = servings;
				const prep = parseInt(
					this.formData["prep_time"] as string,
					10
				);
				if (!isNaN(prep)) data.prep_time = prep;
				const cook = parseInt(
					this.formData["cook_time"] as string,
					10
				);
				if (!isNaN(cook)) data.cook_time = cook;
				if (this.formData["source"])
					data.source = this.formData["source"];
				break;
			}
			case "ingredient": {
				if (this.formData["category"])
					data.category = this.formData["category"];
				if (this.selectedSeasons.size > 0)
					data.season = Array.from(this.selectedSeasons);
				const aliasStr = (this.formData["aliases"] as string || "").trim();
				if (aliasStr) {
					data.aliases = aliasStr
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
				}
				break;
			}
			case "restaurant": {
				if (this.formData["cuisine"])
					data.cuisine = this.formData["cuisine"];
				if (this.formData["address"])
					data.address = this.formData["address"];
				if (this.formData["area"])
					data.area = this.formData["area"];
				if (this.formData["price_range"])
					data.price_range = this.formData["price_range"];
				if (this.formData["url"]) data.url = this.formData["url"];
				break;
			}
		}

		data.created = today;
		return buildFrontmatterString(data);
	}

	private getTemplate(): string {
		switch (this.noteType) {
			case "recipe":
				return getRecipeTemplate();
			case "ingredient":
				return getIngredientTemplate();
			case "restaurant":
				return getRestaurantTemplate();
		}
	}
}

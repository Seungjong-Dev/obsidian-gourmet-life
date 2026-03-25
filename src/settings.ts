import { App, PluginSettingTab, Setting } from "obsidian";
import type GourmetLifePlugin from "./main";
import { FolderSuggest } from "./folder-suggest";

export class GourmetLifeSettingTab extends PluginSettingTab {
	plugin: GourmetLifePlugin;

	constructor(app: App, plugin: GourmetLifePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Gourmet Life Settings" });

		// ── Folder Paths ──

		this.addFolderSetting(
			containerEl,
			"Recipes folder",
			"Folder path for recipe notes",
			this.plugin.settings.recipesFolder,
			"Gourmet/Recipes",
			(value) => {
				this.plugin.settings.recipesFolder = value;
			}
		);

		this.addFolderSetting(
			containerEl,
			"Ingredients folder",
			"Folder path for ingredient notes",
			this.plugin.settings.ingredientsFolder,
			"Gourmet/Ingredients",
			(value) => {
				this.plugin.settings.ingredientsFolder = value;
			}
		);

		this.addFolderSetting(
			containerEl,
			"Restaurants folder",
			"Folder path for restaurant notes",
			this.plugin.settings.restaurantsFolder,
			"Gourmet/Restaurants",
			(value) => {
				this.plugin.settings.restaurantsFolder = value;
			}
		);

		// ── Media ──

		new Setting(containerEl)
			.setName("Media folder name")
			.setDesc("Subfolder name for review photos (created inside each note type folder)")
			.addText((text) =>
				text
					.setPlaceholder("media")
					.setValue(this.plugin.settings.mediaFolder)
					.onChange(async (value) => {
						const trimmed = value.trim();
						if (trimmed) {
							this.plugin.settings.mediaFolder = trimmed;
							await this.plugin.saveSettings();
						}
					})
			);

		// ── Auto-Link ──

		new Setting(containerEl)
			.setName("Enable ingredient auto-link")
			.setDesc("Suggest ingredient links while typing in recipe notes")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoLinkEnabled)
					.onChange(async (value) => {
						this.plugin.settings.autoLinkEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-link minimum characters")
			.setDesc("Minimum characters before suggesting ingredients")
			.addText((text) =>
				text
					.setPlaceholder("2")
					.setValue(String(this.plugin.settings.autoLinkMinChars))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.autoLinkMinChars = num;
							await this.plugin.saveSettings();
						}
					})
			);

	}

	private addFolderSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		currentValue: string,
		placeholder: string,
		setter: (value: string) => void
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.setPlaceholder(placeholder).setValue(currentValue);

				// Attach folder suggest
				new FolderSuggest(this.app, text.inputEl);

				// Only save on blur (focus lost) — not on every keystroke
				text.inputEl.addEventListener("blur", async () => {
					const value = text.inputEl.value.trim();
					if (value !== currentValue) {
						setter(value);
						await this.plugin.saveSettings();
						this.plugin.onFolderSettingsChanged();
					}
				});
			});
	}
}

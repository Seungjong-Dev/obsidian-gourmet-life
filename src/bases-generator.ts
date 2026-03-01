import type { Vault } from "obsidian";
import type { GourmetLifeSettings, BaseFileConfig } from "./types";

const GENERATED_MARKER = "# generated: gourmet-life";

export async function generateBaseFiles(
	vault: Vault,
	settings: GourmetLifeSettings
): Promise<void> {
	if (!settings.generateBaseFiles) return;

	const configs: BaseFileConfig[] = [
		{
			path: `${settings.recipesFolder}/Recipes.base`,
			content: buildRecipesBase(settings.recipesFolder),
		},
		{
			path: `${settings.ingredientsFolder}/Ingredients.base`,
			content: buildIngredientsBase(settings.ingredientsFolder),
		},
		{
			path: `${settings.restaurantsFolder}/Restaurants.base`,
			content: buildRestaurantsBase(settings.restaurantsFolder),
		},
	];

	for (const config of configs) {
		await writeBaseFile(vault, config);
	}
}

async function writeBaseFile(
	vault: Vault,
	config: BaseFileConfig
): Promise<void> {
	const existing = vault.getAbstractFileByPath(config.path);

	if (existing && "path" in existing) {
		// Check if user has modified the file (no generated marker)
		const content = await vault.read(existing as any);
		if (!content.includes(GENERATED_MARKER)) {
			// User-modified file — do not overwrite
			return;
		}
	}

	// Ensure folder exists
	const folderPath = config.path.substring(
		0,
		config.path.lastIndexOf("/")
	);
	await ensureFolderExists(vault, folderPath);

	const fileContent = `${GENERATED_MARKER}\n${config.content}`;

	if (existing) {
		await vault.modify(existing as any, fileContent);
	} else {
		await vault.create(config.path, fileContent);
	}
}

async function ensureFolderExists(
	vault: Vault,
	folderPath: string
): Promise<void> {
	if (!folderPath) return;
	const existing = vault.getAbstractFileByPath(folderPath);
	if (!existing) {
		await vault.createFolder(folderPath);
	}
}

function buildRecipesBase(folder: string): string {
	return `
filters:
  and:
    - file.inFolder("${folder}")
    - type == "recipe"
views:
  - name: Cards
    type: cards
    coverProperty: image
    properties:
      - cuisine
      - difficulty
      - rating
      - cook_time
    order:
      - file.mtime DESC
  - name: Table
    type: table
    properties:
      - cuisine
      - difficulty
      - servings
      - prep_time
      - cook_time
      - rating
      - created
    order:
      - file.mtime DESC
`;
}

function buildIngredientsBase(folder: string): string {
	return `
filters:
  and:
    - file.inFolder("${folder}")
    - type == "ingredient"
views:
  - name: Table
    type: table
    properties:
      - category
      - season
      - rating
      - aliases
    order:
      - file.mtime DESC
  - name: Cards
    type: cards
    properties:
      - category
      - season
      - rating
`;
}

function buildRestaurantsBase(folder: string): string {
	return `
filters:
  and:
    - file.inFolder("${folder}")
    - type == "restaurant"
views:
  - name: Cards
    type: cards
    coverProperty: image
    properties:
      - cuisine
      - price_range
      - rating
      - location
    order:
      - file.mtime DESC
  - name: Table
    type: table
    properties:
      - cuisine
      - location
      - price_range
      - rating
      - url
    order:
      - file.mtime DESC
`;
}

export function getRecipeTemplate(): string {
	return "";
}

export function getIngredientTemplate(): string {
	return [
		"## Storage & Prep",
		"",
		"",
		"## Notes",
		"",
		"",
		"## Purchase Log",
		"",
		"",
	].join("\n");
}

export function getRestaurantTemplate(): string {
	return [
		"## Menu Highlights",
		"",
		"",
		"## Notes",
		"",
		"",
		"## Reviews",
		"",
		"",
	].join("\n");
}

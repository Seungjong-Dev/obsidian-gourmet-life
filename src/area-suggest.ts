/**
 * Best-effort area extraction from a location string.
 * Used for coarse filtering (e.g. "강남", "Brooklyn", "渋谷").
 */
export function suggestAreaFromLocation(location: string): string {
	const trimmed = location.trim();
	if (!trimmed) return "";

	// 1. Korean address: extract 구 name (e.g. "강남구" → "강남")
	const koMatch = trimmed.match(/([가-힣]+)구/);
	if (koMatch) return koMatch[1];

	// 2. Japanese address: 都道府県 followed by 市/区 name
	const jpMatch = trimmed.match(/[都道府県]\s*([^\s市区町村]+)[市区]/);
	if (jpMatch) return jpMatch[1];

	// 3. Comma-separated western address: 3+ segments → second-to-last
	const segments = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
	if (segments.length >= 3) return segments[segments.length - 2];

	// 4. Fallback: return as-is
	return trimmed;
}

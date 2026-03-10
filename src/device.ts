import { Platform } from "obsidian";
import { GHOST_CLICK_SUPPRESSION_MS } from "./constants";

// ── Layout Tiers ──

export type LayoutTier = "wide" | "medium" | "narrow";

const WIDE_BREAKPOINT = 800;
const MEDIUM_BREAKPOINT = 500;

export function getLayoutTier(width: number): LayoutTier {
	if (width >= WIDE_BREAKPOINT) return "wide";
	if (width >= MEDIUM_BREAKPOINT) return "medium";
	return "narrow";
}

// ── Device Detection ──

export function isMobileDevice(): boolean {
	return Platform.isMobile;
}

export function isTouchDevice(): boolean {
	return Platform.isMobile || "ontouchstart" in window;
}

// ── Haptic Feedback ──

export function hapticFeedback(): void {
	if (typeof navigator !== "undefined" && "vibrate" in navigator) {
		navigator.vibrate(10);
	}
}

// ── Ghost Click Suppression ──
// After overlay transitions (e.g. closing preview), Android can fire a
// "ghost" click on elements underneath. Install a one-shot capture handler
// that swallows pointer events for 400ms.

export function suppressGhostClick(container: HTMLElement): void {
	const handler = (e: Event) => {
		e.stopPropagation();
		e.preventDefault();
	};
	container.addEventListener("click", handler, true);
	container.addEventListener("touchend", handler, true);
	setTimeout(() => {
		container.removeEventListener("click", handler, true);
		container.removeEventListener("touchend", handler, true);
	}, GHOST_CLICK_SUPPRESSION_MS);
}

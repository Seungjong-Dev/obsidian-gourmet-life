/**
 * Attach Tab/Shift+Tab indent and Enter auto-prefix handlers to a textarea.
 * Returns a cleanup function that removes the listener.
 *
 * Coexists with TextareaSuggest: skips when `e.defaultPrevented` is true
 * (suggest popup already handled the key) or during IME composition.
 */
export function attachIndentHandler(textarea: HTMLTextAreaElement): () => void {
	const INDENT = "  "; // 2 spaces

	// Matches leading whitespace + optional list/blockquote prefix
	// Groups: (1) indent  (2) prefix like "- ", "> ", "* ", "1. "
	const PREFIX_RE = /^(\s*)([-*>]\s|(\d+)\.\s)?/;

	const handler = (e: KeyboardEvent) => {
		if (e.defaultPrevented || e.isComposing) return;

		if (e.key === "Tab") {
			e.preventDefault();
			const { selectionStart, selectionEnd, value } = textarea;

			if (selectionStart === selectionEnd && !e.shiftKey) {
				// No selection: insert indent at cursor
				replaceRange(textarea, selectionStart, selectionEnd, INDENT);
				textarea.selectionStart = textarea.selectionEnd = selectionStart + INDENT.length;
			} else {
				// Selection spans lines: indent/dedent each line
				const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
				const lineEnd = value.indexOf("\n", selectionEnd);
				const blockEnd = lineEnd === -1 ? value.length : lineEnd;
				const block = value.slice(lineStart, blockEnd);
				const lines = block.split("\n");

				const transformed = lines.map((line) => {
					if (e.shiftKey) {
						// Dedent: remove up to 2 leading spaces
						if (line.startsWith(INDENT)) return line.slice(INDENT.length);
						if (line.startsWith(" ")) return line.slice(1);
						return line;
					}
					return INDENT + line;
				});

				const newBlock = transformed.join("\n");
				replaceRange(textarea, lineStart, blockEnd, newBlock);

				// Adjust selection to cover the modified block
				textarea.selectionStart = lineStart;
				textarea.selectionEnd = lineStart + newBlock.length;
			}
			dispatchInput(textarea);
			return;
		}

		if (e.shiftKey && e.key === "Tab") {
			// Already handled above (Tab with shiftKey)
			return;
		}

		if (e.key === "Enter") {
			e.preventDefault();
			const { selectionStart, selectionEnd, value } = textarea;
			const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
			const currentLine = value.slice(lineStart, selectionStart);

			const match = currentLine.match(PREFIX_RE);
			if (!match) {
				replaceRange(textarea, selectionStart, selectionEnd, "\n");
				textarea.selectionStart = textarea.selectionEnd = selectionStart + 1;
				dispatchInput(textarea);
				return;
			}

			const indent = match[1] ?? "";
			const prefix = match[2] ?? "";
			const fullPrefix = indent + prefix;

			// If line has prefix but no content after it → clear the prefix (list escape)
			if (fullPrefix && currentLine.trimEnd() === (indent + prefix).trimEnd()) {
				replaceRange(textarea, lineStart, selectionEnd, "\n");
				textarea.selectionStart = textarea.selectionEnd = lineStart + 1;
				dispatchInput(textarea);
				return;
			}

			const insertion = "\n" + fullPrefix;
			replaceRange(textarea, selectionStart, selectionEnd, insertion);
			textarea.selectionStart = textarea.selectionEnd = selectionStart + insertion.length;
			dispatchInput(textarea);
		}
	};

	textarea.addEventListener("keydown", handler);
	return () => textarea.removeEventListener("keydown", handler);
}

function replaceRange(
	textarea: HTMLTextAreaElement,
	start: number,
	end: number,
	text: string
): void {
	const before = textarea.value.slice(0, start);
	const after = textarea.value.slice(end);
	textarea.value = before + text + after;
}

function dispatchInput(textarea: HTMLTextAreaElement): void {
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

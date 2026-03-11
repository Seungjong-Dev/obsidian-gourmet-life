# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Gourmet Life** is an Obsidian plugin for culinary life management — recipes, ingredients, and restaurants. See `SPEC.md` for full specification.

## Key Architecture Decisions

- **Data source**: All data comes from Obsidian's MetadataCache frontmatter — the plugin never parses YAML directly or uses external databases
- **Vanilla DOM only**: No frameworks (React, Vue, Svelte). Uses Obsidian API (`createEl`, `createDiv`, `Setting`, `Modal`) for all UI
- **CSS prefix**: All CSS classes use `gl-` prefix to avoid conflicts with other plugins
- **View architecture**: Recipe/Restaurant views use 2-column layouts (side + main panels), split into separate files (`*-side-panel.ts`, `*-main-panel.ts`)
- **Explorer decomposition**: ExplorerView orchestrates 4 extracted modules — toolbar, preview, filter, cards
- **NoteIndex**: In-memory Map<path, GourmetNote> rebuilt from MetadataCache on vault changes. `buildIndex()` is async (awaits recipe ingredient indexing)
- **Cooklang parsing**: Recipe body uses Cooklang-inspired syntax (`@ingredient`, `#tool`, `~timer`), parsed by `cooklang-parser.ts`
- **External deps**: Leaflet for restaurant maps, html-to-image for exports. Both are bundled (not externalized)

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development build with hot reload
npm run build        # Production build
```

Output goes to `main.js` in the repo root. `manifest.json` and `styles.css` are hand-edited.

## Testing

For testing within Obsidian, symlink or copy the repo into an Obsidian vault's
`.obsidian/plugins/gourmet-life/` directory.

## Note Types & Frontmatter

Three note types: `recipe`, `ingredient`, `restaurant`. All use `type` field in frontmatter.
See SPEC.md Section 3 for full YAML schemas.

## Recipe Body Format

- Sections delimited by `## Recipe`, `## Notes`, `## Reviews` headings
- Cooklang parser skips `## Recipe` heading before parsing
- Ingredients: `@ingredient` or `@ingredient{amount%unit}`
- Tools: `#tool` or `#tool{spec}`
- Timers: `~{amount%unit}`

## File Naming

All source files use kebab-case. Views follow `{name}-view.ts` + `{name}-side-panel.ts` / `{name}-main-panel.ts` pattern.

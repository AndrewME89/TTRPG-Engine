# TTRPG Engine

TTRPG Engine is an Obsidian plugin for running and maintaining tabletop RPG campaigns. It includes campaign management, worldbuilding tools, NPC and creature tracking, quests, encounters, sessions, secrets, a compendium/library, generators, a tile map builder, and a player-facing companion mode.

Current plugin version: **2.1.0**  
Minimum Obsidian version: **1.5.0**

## Current repo status

This repo is a clean repository wrapper around the current working plugin build.

The current runtime is still a single JavaScript plugin file at:

```txt
src/main.js
```

The installable Obsidian release files are copied to the repo root:

```txt
main.js
manifest.json
styles.css
```

That is deliberate. The first priority is preserving the current working plugin before splitting the codebase into smaller TypeScript modules. No ghost refactor, no “oops, the Campaigns tab is the only thing left” nonsense.

## Manual installation

Copy these files/folders into your vault:

```txt
Vault/.obsidian/plugins/ttrpg-engine/
├─ main.js
├─ manifest.json
├─ styles.css
└─ assets/          optional, for bundled tile-map assets
```

Then reload Obsidian and enable **TTRPG Engine** in Community Plugins.

## Development commands

```bash
npm ci
npm run check
npm run build
npm run package
```

### What each command does

- `npm run check` checks JavaScript syntax, validates the manifest, and confirms release files exist.
- `npm run build` copies `src/main.js` and `src/styles.css` into root release position, then runs checks.
- `npm run package` builds and creates a manual-install ZIP in `release/`.
- `npm run clean` removes generated release/build folders.

## Safe mode / crash protection

The plugin includes kill-switch and crash-lock file checks. See:

```txt
docs/SAFETY_AND_KILLSWITCH.md
```

## Tile map assets

The plugin scans this folder inside the installed plugin directory:

```txt
.obsidian/plugins/ttrpg-engine/assets/
```

This repo includes a starter folder structure under:

```txt
assets/tile-map/
```

Add image assets into those folders, then package/reinstall the plugin or copy the assets folder into the installed plugin folder.

## Repo philosophy

1. Keep the current working plugin installable.
2. Keep root release files boring and predictable.
3. Do not silently delete legacy campaign data paths.
4. Keep the Tile Map Builder; do not resurrect the old random SVG map generator.
5. Refactor gradually from the monolith into `src/core`, `src/state`, `src/ui`, `src/tabs`, `src/modals`, and `src/maps`.

## Important docs

```txt
docs/ROADMAP.md
docs/TESTING.md
docs/DATA_MODEL.md
docs/IMPORT_FORMAT.md
docs/SAFETY_AND_KILLSWITCH.md
docs/DEVELOPER_NOTES.md
docs/REFACTOR_MAP.md
docs/LEGACY_REMOVAL.md
```

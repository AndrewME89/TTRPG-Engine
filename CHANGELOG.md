# Changelog

All notable changes to TTRPG Engine are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [SemVer](https://semver.org/).

---

## [Unreleased] — Phase 254

### Added
- 7 new entity types: `nations`, `religions`, `districts`, `rooms`, `timelines`, `reveals`, `loot`
- All 7 entities added to `createDefaultState()` (auto-migrated via existing `migrateState` loop)
- Full field schema arrays for each entity, registered in `ENTITY_FIELD_SCHEMAS`
- `ENTITY_ICONS` and `ENTITY_LABELS` entries for all 7 types (card rendering, empty-state labels)
- **World & Lore**: Nations and Religions sections; `+ Nation` / `+ Religion` pageHead buttons
- **Geography & Maps**: Districts (under Settlements) and Rooms (under Locations) sections with pageHead buttons
- **Sessions & Timeline**: Timeline Events section; `+ Timeline Event` pageHead button
- **Secrets & Reveals**: Reveals section between Secrets and Handouts; `+ Reveal` pageHead button
- **Encounters & Combat**: Loot section below Encounters; `+ Loot` pageHead button

---

## [Unreleased] — Phase 253

### Fixed
- DM Screen: added `sectionHead('Quick Reference')` above the reference card grid — the only page that previously lacked a section heading
- `styles.css`: `.ttrpg-shell.is-collapsed .te-nav-group-label` changed from `visibility:hidden` to `display:none` — eliminates the invisible dead-space gap in the collapsed sidebar
- `styles.css`: `.te-condition-card` padding increased from `var(--te-gap-md)` to `var(--te-gap-lg)` — now matches the standard `.te-card` padding
- `styles.css`: added `.te-field-ta` rule (`width:100%; resize:vertical; min-height:60px`) — textarea fields in modals now have explicit min-height and vertical-resize affordance

---

## [Unreleased] — Phase 252

### Added
- `assets/tile-map/README.md`: full asset installation guide — folder structure, naming conventions, footprint hints, licensing sources
- `tests/tile-map.test.js`: 52 pure-function unit tests covering `prettifyAssetName`, `inferTileKind`, `inferTileFootprint`, `assetMatches`, tileMap state migration, and missing-asset detection
- `npm test` script (`node tests/tile-map.test.js`)
- `npm run check-release` script — verifies all 9 expected tile-map category subfolders, manifest shape, versions.json, and syntax before packaging
- `npm run release` script — chains `check`, `check-release`, and `package-release` in one step
- `npm run validate` and `npm run version-bump` scripts wired to existing scripts

### Changed
- Diagnostics now reports per-category asset breakdown (e.g. `terrain: 12, tokens: 8`) and names affected maps when broken tile paths are detected
- `check-release-files.mjs` now verifies the complete asset folder structure (9 category subfolders + README) and runs a syntax check on `main.js`

---

## [2.1.0] – 2026-05-25

### Added
- Tile Map Builder: rotation controls (90°/−90°/reset) with CSS transform applied to placed tiles
- Tile Map Builder: Bring to Front / Send to Back layer controls
- Tile Map Builder: grid size selector (30–100 px) with live canvas update
- Tile Map Builder: canvas size presets (small battlemap → region map) and custom W/H inputs
- Tile Map Builder: distance scale field ("1 sq = 5 ft")
- Tile Map Builder: geography links row (region, settlement, location, encounter, session)
- Save Map now exports a PNG file via HTML Canvas API instead of a Markdown note

### Fixed
- Tile map palette asset list now scrolls correctly when many assets are loaded
- Tile interactions (place, drag, resize, delete, rotate, layer) no longer cause page scroll jump — use `saveStateQuiet` instead of full view re-render
- Saved Maps section moved below the Tile Map Builder
- Removed `detachLeavesOfType` from `onunload` (Obsidian lifecycle compliance)
- Removed plugin name prefix from all command names (Obsidian review compliance)
- `PLUGIN_VERSION` and `manifest.json` version aligned at 2.1.0

### Infrastructure
- Added `versions.json`, `package.json`, `eslint.config.mjs`, `CHANGELOG.md`
- Added `check-quality.js` gate (40 automated checks)

---

## [2.0.0] – 2026-05-20

### Added
- Full DM Engine: campaigns, worlds, NPCs, factions, quests, encounters, sessions, secrets, handouts, compendium, homebrew, generators, rules reference
- PC Companion mode: overview, character sheet, inventory, spellbook, quest log, handouts, journal, world lore
- Tile Map Builder: dynamic asset scanner, image thumbnails, footprint-aware placement, drag/resize, layers, saved map records
- Campaign Wizard (12-step), Campaign Bible export, Dungeon Builder, War Machine, Faction Matrix, Run Session live mode, Endgame Tracker
- Safe mode / crash lock / diagnostics system
- Import / export (full backup and player-safe packet)
- Option banks (60+ curated chip-field lists)
- Workspace split: DM Engine vs PC Companion navigation

---

## [1.0.0] – initial private build

- Initial working plugin with core campaign management features

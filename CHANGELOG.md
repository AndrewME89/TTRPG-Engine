# Changelog

All notable changes to TTRPG Engine are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [SemVer](https://semver.org/).

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

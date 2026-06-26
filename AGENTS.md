# AGENTS.md — TTRPG Engine

## Project

TTRPG Engine is a single-file Obsidian plugin for D&D/TTRPG campaign management.

The project is currently being stabilised after many phase-based patches. Prioritise safety, runtime correctness, and data preservation over new features.

## Source of truth

* `main.js` is the source of truth.
* `src/main.js` is generated/mirrored by `npm run build`.
* Edit root `main.js` first.
* After editing `main.js`, run `npm run build`.
* Then run `npm run sync-check`.

Do not edit `src/main.js` directly unless explicitly instructed.

## Required checks

Before reporting completion, run:

```bash
npm test
npm run build
npm run sync-check
npm run validate
npm run check
```

If any command fails, report the failure and fix it if it is within the task scope.

## Testing expectations

`npm test` must run every `tests/*.test.js` file through `scripts/run-tests.mjs`.

Do not add tests that only test copied/mock implementations while ignoring the real plugin source.

Prefer tests that inspect or exercise real source code paths in `main.js`.

If direct runtime tests are difficult because this is an Obsidian plugin, add targeted static tests that catch the specific real bug.

## Data safety rules

* Do not delete user data arrays destructively.
* Preserve legacy fields unless a safe migration is implemented.
* Do not silently create junk entities from descriptive chip values.
* Do not copy large reference JSON records into saved plugin state.
* Do not overwrite user-edited migrated records.
* Keep compatibility redirects/aliases where old routes may exist.

## Current design direction

Newer requirements override older/legacy requirements unless explicitly marked otherwise.

Current preferred architecture:

* Dashboard = live DM cockpit / doing.
* Campaign Command Centre = campaign structure.
* World Atlas = world/geography/maps.
* Cast & Powers = NPCs, creatures, factions, villains, relationships.
* Adventure Planner = adventures, quests, encounters, prep.
* Secrets & Handouts = reveal/player-facing material.
* Compendium / Library = storage and reference.
* Generators = generation tools.
* Settings / Tools = diagnostics, repair, import/export, backups.

## Important current constraints

Do not start broad redesign work during stabilisation.

Do not rebuild Run Session unless the task explicitly says to.

Do not reintroduce Noble Families as a standalone creation/management workflow. Noble Families should be managed as Factions with type/subtype `Noble House`, while legacy noble family records remain preserved for migration compatibility.

Do not add new generators unless explicitly requested.

Do not use internet access or remote package changes unless explicitly requested.

## Coding style

Prefer small, safe patches.

Prefer central helpers over one-off fixes.

Avoid duplicate function declarations. If a helper already exists, merge/extend it rather than redefining it later in the file.

Be especially careful with:

* `resolveEntityDisplay`
* `migrateNobleFamiliesToFactions`
* note path resolution helpers
* campaign-scoped entity lists
* Run Session state/logging helpers
* entity picker helpers

## Completion report

When done, report:

* Files changed.
* Exact bugs fixed.
* Tests/checks run.
* Any remaining known gaps.
* Any user decisions still needed.
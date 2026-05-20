# Obsidian TTRPG Table

**Obsidian TTRPG Table** is an Obsidian plugin for running, organising, and recovering tabletop RPG campaign content directly inside your vault.

It is designed as a practical campaign command centre for Dungeon Masters, players, worldbuilders, and TTRPG note-hoarders who want their campaign data to live where their notes already live: inside Obsidian.

The plugin is currently focused on clean layout, stable persistence, saved-content recovery, and foundational campaign tooling before deeper automation and visual polish are added.

---

## Current Status

> **Development status:** Active early development
> **Stability:** Experimental / work-in-progress
> **Recommended use:** Testing, development vaults, and controlled campaign notes
> **Production use:** Not yet recommended without backups

This plugin is being developed in phases. Features are added incrementally, tested, and refined before heavier styling, automation, and compendium integration are layered on top.

At this stage, the priority is:

1. Reliable saved data
2. Clear dashboard layout
3. Recoverable campaign content
4. Obsidian-native visual behaviour
5. Clean architecture for future expansion

Custom colours and heavy visual styling are intentionally being avoided for now so the plugin respects the user’s active Obsidian theme.

---

## Features

### Campaign Dashboard

The plugin provides a central campaign dashboard for viewing and managing campaign-related content.

Current and planned dashboard areas include:

* Campaign overview
* Player-facing tools
* DM-facing tools
* World, lore, and cosmology tracking
* Rules and mechanics references
* Secrets and reveals
* Saved content recovery
* State diagnostics
* Campaign metadata

Dashboard sections are being structured so information is readable, scannable, and not jammed into dense single-line blocks.

---

### Saved Items / Content Recovery

A major goal of the plugin is to prevent campaign content from disappearing after updates, reloads, or layout changes.

The plugin is being built with a dedicated recovery-oriented mindset.

Supported and planned saved-item categories include:

* Campaigns
* Characters
* NPCs
* Encounters
* Quests
* Journals
* Compendium entries
* Archived records
* Recovered orphaned records

The plugin is expected to include a **My Content / Saved Items** dashboard where stored content can be reviewed, recovered, repaired, or re-indexed.

---

### Persistence & Migration Safety

The plugin is being developed with strong attention to data persistence.

Persistence priorities include:

* Loading existing saved data after plugin updates
* Preserving old content across schema changes
* Detecting missing active IDs
* Showing archived records where relevant
* Logging migrations clearly
* Supporting backup-before-migration workflows
* Providing repair or re-index commands
* Showing useful recovery messages when no saved items are found

The long-term goal is simple: campaign data should survive reloads, restarts, plugin toggles, updates, and future feature additions.

---

### DM Tools

Planned DM-facing tools include:

* Campaign manager
* NPC and PC character portrait generator
* Encounter tracker
* Initiative tracker
* NPC roster
* Quest tracker
* Faction tracker
* Timeline tracker
* Secrets and reveals dashboard
* Session notes support
* Homebrew builder
* Worldbuilding tools
* Lore and cosmology references
* Rules and mechanics references
* DM table kit references

The DM side is intended to support actual table workflow rather than becoming a decorative notebook with buttons wearing a tiny hat.

---

### Player Tools

Planned player-facing tools include:

* Character dashboard
* Character creation workflow
* PC character portrait generator
* Character sheet support
* Stats tracking
* HP tracking
* Spell slot tracking
* Hit dice tracking
* Exhaustion tracking
* Death save tracking
* Inspiration tracking
* Temporary HP tracking
* Equipment tracking
* Class feature references
* Backstory and character journal support
* Player table kit references

The eventual goal is for players to have a clean, useful interface without accidentally exposing DM-only campaign secrets.

---

### World, Lore & Cosmology

The plugin includes or plans support for structured worldbuilding content, including:

* World summaries
* Campaign IDs
* Visibility status
* Sync state
* Last synced note reference
* Lore entries
* Cosmology notes
* Factions
* Locations
* Historical events
* Planes, gods, and metaphysics
* Campaign-specific canon tracking

Where metadata is displayed, the layout should favour one field per line for readability.

Example layout target:

```text
Summary:
Campaign ID:
Visibility:
Last Synced to Note:
Sync Status:
```

This avoids unreadable horizontal metadata soup. Metadata soup is where good UI goes to be reincarnated as a spreadsheet with abandonment issues.

---

### Rules & Mechanics

The plugin is intended to support structured rules references, including:

* House rules
* Homebrew mechanics
* Campaign-specific rulings
* Optional rules
* Conditions
* Combat references
* Travel rules
* Downtime rules
* Magic item rules
* Class and subclass notes
* Monster and encounter references

Rules content should be accessible without forcing the DM to dig through scattered notes mid-session.

---

### Secrets & Reveals

The plugin is being designed with campaign secrecy in mind.

Planned support includes:

* DM-only secrets
* Player-visible reveals
* Hidden plot threads
* NPC secret motivations
* Future reveal tracking
* Lore visibility states
* Reveal timing notes
* Campaign-safe summaries

This will be especially important as player-facing and DM-facing views become more distinct.

---

### Map Generator

A map generator is planned as part of the broader plugin system.

The map generator is expected to support curated map assets and future refinements inspired by practical TTRPG generator workflows.

Planned areas may include:

* Dungeon maps
* Town maps
* Wilderness maps
* Region maps
* World maps
* Randomised generation options
* Asset-based map construction
* Export or note-sync support

This area is still under active development and may be replaced or heavily revised as stronger generator files become available.

---

### Obsidian-Native Styling

The plugin should respect Obsidian’s active theme wherever possible.

Current styling goals:

* Avoid hardcoded colours
* Avoid forced textures
* Avoid theme-breaking visual overrides
* Use Obsidian CSS variables where styling is needed
* Preserve layout without imposing a visual identity too early
* Keep UI readable in light and dark themes
* Allow future visual polish after layout and persistence are stable

In other words: layout first, fancy cloak later.

---

## Installation

### Manual Installation

1. Download or build the plugin files.
2. Copy the plugin folder into your Obsidian vault:

```text
<vault>/.obsidian/plugins/obsidian-ttrpg-table/
```

3. Ensure the plugin folder contains at least:

```text
main.js
manifest.json
styles.css
```

4. Open Obsidian.
5. Go to **Settings → Community plugins**.
6. Make sure **Restricted mode** is disabled.
7. Enable **Obsidian TTRPG Table**.

---

## Development Setup

### Requirements

* Node.js
* npm
* Obsidian desktop app
* A test Obsidian vault

### Install Dependencies

From the plugin folder, run:

```bash
npm install
```

### Build

Run:

```bash
npm run build
```

For development builds, use the configured development script if present:

```bash
npm run dev
```

If the build fails with a TypeScript error such as:

```text
error TS18003: No inputs were found in config file
```

check that the expected source files exist under the path referenced by `tsconfig.json`, usually:

```text
src/**/*.ts
```

---

## Expected Plugin Structure

The exact structure may change during development, but a typical layout may look like this:

```text
obsidian-ttrpg-table/
├── manifest.json
├── main.js
├── styles.css
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── main.ts
│   ├── views/
│   ├── components/
│   ├── services/
│   ├── storage/
│   ├── types/
│   └── utils/
└── README.md
```

Development should favour clear separation between:

* UI rendering
* data storage
* migration logic
* Obsidian commands
* domain models
* recovery tools
* feature modules

---

## Data Safety

Because this plugin is still in active development, use backups.

Recommended safety habits:

* Test in a separate vault first
* Back up your vault before updating the plugin
* Back up plugin data before migration tests
* Keep copies of important campaign notes outside plugin-only storage
* Avoid relying on experimental views as the only copy of critical campaign content

The plugin’s persistence and recovery systems are a major development priority, but early builds should still be treated carefully.

---

## Design Principles

### 1. Preserve Campaign Data

No feature is worth losing saved campaign content.

Persistence, migration, recovery, and diagnostics take priority over visual polish.

### 2. Respect Obsidian

The plugin should feel like it belongs inside Obsidian.

That means:

* respecting themes
* avoiding unnecessary hardcoded colours
* using Markdown-friendly workflows where possible
* keeping vault data accessible
* avoiding locked-in black-box storage where practical

### 3. Separate DM and Player Concerns

Player-facing views should not accidentally expose DM-only information.

DM tools and player tools should be clearly separated in both data and interface logic.

### 4. Build Incrementally

The plugin should be developed in testable phases.

Avoid random redesigns, silent rewrites, and speculative architecture changes.

Each meaningful change should answer:

* What changed?
* Which files changed?
* What should be tested?
* What could regress?

### 5. Layout Before Visual Polish

The plugin should first become usable, stable, and readable.

Visual identity can come later.

A pretty plugin that eats your campaign notes is not a plugin. It is a mimic.

---

## Current Development Priorities

### Ship-Now Essentials

* Clean dashboard layout
* Separate readable metadata fields
* Saved Items / My Content dashboard
* Data shape audit
* State diagnostic summary
* Repair / re-index command
* Backup-before-migration option
* Migration logging
* Recovery messages for missing content
* Obsidian-theme-friendly CSS
* Collapsible internal sidebar
* Removal of redundant command deck layout

### Near-Term Improvements

* Improved player-facing dashboard
* Stronger DM/player separation
* Better saved item filtering
* Search and recovery tools
* Campaign visibility controls
* More consistent section formatting
* Cleaner component structure
* Better empty states
* Improved map generator integration

### Later Ideas

* Full character creation workflow
* Character portrait generator for NPCs and PCs
* 5e.tools-inspired compendium integration
* Spell selection workflows
* Level-up workflows
* Homebrew builder
* Encounter balancing
* Map generation and export
* Note sync for campaign records
* Campaign timeline visualisation
* Faction relationship mapping
* Player handout generation
* Session recap generation
* Rules lookup tools

---

## Testing Checklist

Before considering a build stable, test:

### Plugin Loading

* Plugin enables successfully
* Plugin disables cleanly
* Plugin reloads without errors
* Views reopen correctly after Obsidian restart

### Data Persistence

* Existing campaigns remain visible after reload
* Existing characters remain visible after reload
* Existing encounters remain visible after reload
* Existing quests remain visible after reload
* Existing journals remain visible after reload
* Archived records remain recoverable
* Missing active IDs do not break the dashboard

### Migration / Recovery

* Old data versions are detected
* Migration logs are readable
* Backup-before-migration works
* Repair / re-index command finds orphaned content
* Empty states explain what happened
* No saved items found message is useful, not cryptic

### Layout

* Dashboard is centred and balanced
* Sidebar collapses correctly
* Command deck is not duplicated unnecessarily
* Metadata appears one field per line
* Sections do not collapse into unreadable horizontal blocks
* Player-facing dashboard does not show DM-only content
* DM-facing dashboard does not overwrite player-facing layout

### Theme Compatibility

* Works in light mode
* Works in dark mode
* Respects the active Obsidian theme
* Does not force custom colours
* Does not force decorative textures
* Uses readable spacing without visual clutter

---

## Known Limitations

* The plugin is still experimental.
* Some planned features may not yet be implemented.
* The player-facing dashboard may still be under active correction.
* The map generator is still being refined.
* Heavy visual styling is intentionally deferred.
* Persistence and recovery systems are still being hardened.
* Documentation may evolve quickly as phases ship.

---

## Roadmap

The roadmap is phase-based and subject to change as stability issues are discovered.

### Phase Focus Areas

1. Foundation and plugin shell
2. Dashboard layout
3. Player and DM tool separation
4. Saved content recovery
5. Persistence and migration safety
6. State diagnostics
7. Repair and re-index tooling
8. Map generator integration
9. Character portrait generator for NPCs and PCs
10. Character and campaign workflows
11. Compendium and rules integrations
12. Homebrew builder
13. Visual polish and theme refinement

The guiding rule is simple: build the bones before painting the dragon scales.

---

## Contributing

This plugin is currently being developed in a controlled, phase-based workflow.

Contributions should follow the existing project discipline:

* Keep changes incremental
* Avoid large rewrites unless explicitly planned
* Do not remove working functionality without a clear reason
* Respect Obsidian community plugin expectations
* Prefer maintainable structure over clever shortcuts
* Document changed files and test steps
* Preserve user data wherever possible

Before contributing major changes, document:

1. The problem being solved
2. The files affected
3. The expected behaviour change
4. Regression risks
5. Test steps

---

## Developer Notes

This plugin is being built as a greenfield Obsidian TTRPG tool.

Older RPG Engine concepts may be referenced for useful ideas, but this plugin should not blindly copy old architecture.

The goal is a clean, maintainable plugin designed specifically for TTRPG campaign management inside Obsidian.

---

## Disclaimer

This plugin is not affiliated with Wizards of the Coast, Dungeons & Dragons, Obsidian, 5e.tools, or any other referenced tabletop RPG product or tool.

All trademarks and game terms belong to their respective owners.

Use this plugin with your own legally owned or permitted content.

---

## License

License information has not yet been finalised.

Before public release, add a clear license file such as:

* MIT License
* GPL-3.0
* Apache-2.0
* another appropriate open-source license

Until a license is added, assume all rights are reserved by the project owner.

---

## Suggested Repository Files Before Release

Before publishing publicly, consider adding:

```text
README.md
LICENSE
CHANGELOG.md
CONTRIBUTING.md
CODE_OF_CONDUCT.md
manifest.json
versions.json
main.js
styles.css
```

Optional but useful:

```text
docs/
├── installation.md
├── development.md
├── roadmap.md
├── testing.md
└── data-safety.md
```

---

## Summary

**Obsidian TTRPG Table** aims to become a practical, stable, Obsidian-native campaign management plugin for tabletop RPGs.

It is being built around a few non-negotiables:

* campaign data should survive updates
* player and DM content should stay properly separated
* dashboards should be readable
* styling should respect Obsidian themes
* features should ship in controlled, testable phases

The dragon is still young, but the skeleton is getting stronger.

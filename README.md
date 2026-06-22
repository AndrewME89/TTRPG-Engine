# TTRPG Engine

> Build, run, and manage tabletop RPG campaigns directly inside Obsidian.

TTRPG Engine is an Obsidian plugin for Dungeon Masters and players who want a single campaign workspace for worldbuilding, sessions, maps, NPCs, quests, encounters, rules, secrets, homebrew, and player-facing campaign tools.

The plugin is designed around two connected workspaces:

- **DM Engine** — campaign management, prep, worldbuilding, encounters, secrets, maps, compendium tools, and live session support.
- **PC Companion** — character overview, inventory, spellbook, quest log, handouts, journal, and player-safe campaign information.

---

## Screenshots

> Replace these placeholder paths with real screenshots before publishing.

### Dashboard

![Dashboard screenshot placeholder](docs/screenshots/dashboard.png)

### Campaigns

![Campaigns screenshot placeholder](docs/screenshots/campaigns.png)

### Geography & Maps

![Geography and maps screenshot placeholder](docs/screenshots/geography-maps.png)

### Tile Map Builder

![Tile Map Builder screenshot placeholder](docs/screenshots/tile-map-builder.png)

### NPCs & Creatures

![NPCs and creatures screenshot placeholder](docs/screenshots/npcs-creatures.png)

### DM Screen

![DM Screen screenshot placeholder](docs/screenshots/dm-screen.png)

### PC Companion

![PC Companion screenshot placeholder](docs/screenshots/pc-companion.png)

---

## Features

### Campaign management

- Create and manage campaigns.
- Set an active campaign.
- Track campaign summaries, status, theme, folder, sync status, and timestamps.
- Run or resume campaign sessions.
- Export player-safe packets.
- Back up plugin data.
- Repair and reindex stored campaign data.
- Use diagnostics and crash-recovery tools.

### DM Engine

The DM workspace includes sections for:

- Dashboard
- Campaigns
- Campaign Bible
- DM Screen
- Run Session
- World & Lore
- Geography & Maps
- Gazetteer
- NPCs & Creatures
- Factions
- Faction Matrix
- Adventures & Quests
- Encounters & Combat
- Rules & Mechanics
- Downtime & Bases
- Sessions & Timeline
- Secrets & Reveals
- War Machine
- Endgame
- Compendium & Library
- Homebrew
- Generators

### PC Companion

The player-facing workspace includes:

- Character overview
- Character sheet
- Inventory
- Spellbook
- Quest log
- Handouts
- Journal
- Player-safe world lore

DM-only secrets and hidden campaign information are intended to stay out of player-facing views and exports.

### Creation tools

TTRPG Engine includes builders for common tabletop campaign content, including:

- Campaigns
- Worlds
- Cosmologies
- Realms
- Regions
- Settlements
- Locations
- Points of interest
- Routes
- Dungeons
- NPCs
- Creatures
- BBEGs
- Factions
- Quests
- Adventures
- Encounters
- Sessions
- Secrets
- Handouts
- Rules
- Downtime activities
- Projects
- Bastions
- Compendium entries
- Homebrew entries
- Characters
- Calendars
- Journals
- Maps
- Timers
- Enemy templates
- Reputations
- War fronts
- Incursions
- Endgame states

### Chip fields and selector banks

Many creation forms support reusable option banks and chip-style inputs for repeated values such as:

- Tags
- Themes
- Traits
- Hooks
- Objectives
- Resources
- Hazards
- Loot
- Relationships
- Conditions
- Factions
- Locations
- Rooms
- Staff
- Facilities

These fields are intended to avoid messy comma-separated input while still allowing custom values.

---

## Tile Map Builder

TTRPG Engine includes an inline Tile Map Builder inside **Geography & Maps**.

### Asset folder

The Tile Map Builder scans image assets from:

```text
.obsidian/plugins/ttrpg-engine/assets
```

Subfolders are supported and become palette categories.

Example:

```text
.obsidian/plugins/ttrpg-engine/assets/
├─ terrain/
├─ buildings/
├─ dungeons/
├─ furniture/
├─ props/
├─ tokens/
└─ effects/
```

### Supported asset formats

The Tile Map Builder supports:

```text
.png
.jpg
.jpeg
.webp
.gif
.svg
```

### Tile sizing

The builder can infer tile footprint from filenames.

Examples:

```text
castle-gate-4x2.png
large-room-6x6.webp
corridor-3x1.png
market-stall-2x1.png
```

If no footprint is found in the filename, the plugin attempts to infer a reasonable default from the file path or name, such as background, room, corridor, wall, terrain, or furniture.

### Map tools

The Tile Map Builder supports:

- Recursive asset scanning
- Real image thumbnails
- Asset search
- Category filtering
- Reload assets button
- Click-to-place tiles
- Grid snapping
- Drag-to-move
- Corner drag resizing
- Width and height controls
- Layer up/down controls
- Rotation controls
- Delete selected tile
- Clear map
- Save map
- Reopen saved maps
- Map records stored in plugin data
- Map notes written to the active campaign folder
- Missing asset warnings

### Asset licensing note

Do not redistribute third-party tile packs unless you have permission to do so.

For public plugin releases, the recommended approach is:

- Include only a tiny sample asset set, or no bundled assets.
- Let users place their own legally owned assets in the plugin `assets` folder.
- Keep large commercial or third-party tile packs outside the GitHub repository unless their license allows redistribution.

---

## Installation

### Manual installation

1. Download the latest release.
2. Copy the plugin files into:

```text
<vault>/.obsidian/plugins/ttrpg-engine/
```

3. Make sure the folder contains:

```text
main.js
manifest.json
styles.css
```

4. Restart Obsidian or reload plugins.
5. Enable **TTRPG Engine** in **Settings → Community plugins**.

### Optional tile assets

To use custom Tile Map Builder assets, place image files inside:

```text
<vault>/.obsidian/plugins/ttrpg-engine/assets/
```

Then open the Tile Map Builder and click **Reload Assets**.

---

## Usage

### Open the plugin

Use one of the following:

- Click the castle ribbon icon.
- Run **Open TTRPG Engine** from the command palette.

### Start a campaign

1. Open **Campaigns**.
2. Create a campaign.
3. Set it as the active campaign.
4. Use the campaign dashboard, builders, and session tools to build out the campaign.

### Build campaign content

Use the sidebar to move between major campaign areas. Most sections include action buttons at the top of the page for creating new records.

### Run a session

Use **Run Session** or **Run / Resume Campaign** to access live session tools, session notes, initiative support, and linked campaign content.

### Export player-safe content

Use the player packet export to generate player-facing campaign material from visible handouts, quests, and safe summaries.

---

## Data and storage

TTRPG Engine stores plugin state using Obsidian plugin data storage.

Markdown notes and exports are written inside the active campaign folder where supported.

The plugin is designed to avoid silently deleting campaign content. Diagnostic and repair tools are included to help recover from missing references, old data structures, or broken saved state.

### Recommended backup habit

Before major updates:

1. Open TTRPG Engine.
2. Run **Backup Data**.
3. Copy the plugin folder or vault backup somewhere safe.
4. Update the plugin.

Tiny bit boring. Extremely worth it.

---

## Safety and recovery

TTRPG Engine includes basic safety helpers:

- Crash marker files
- Load failure report
- Safe mode file
- Crash report file
- Diagnostics modal
- Repair / reindex command
- Backup command

Safety files are stored in:

```text
.obsidian/plugins/ttrpg-engine/
```

Common recovery files include:

```text
DISABLE_TTRPG_ENGINE.txt
TTRPG_ENGINE_DISABLED.txt
SAFE_MODE.txt
TTRPG_ENGINE_LOAD_FAILED.txt
TTRPG_ENGINE_LAST_CRASH.txt
```

If the plugin fails to load, check the crash report file before deleting data.

---

## Commands

TTRPG Engine provides command palette actions for common workflows, including:

- Open TTRPG Engine
- Create Campaign
- Run / Resume Campaign
- Roll Dice
- Create NPC
- Create Encounter
- Create Quest
- Create Session Log
- Create Homebrew Entry
- Open Tile Map Builder
- Repair / Reindex Data
- Backup Data
- Open My Content / Saved Items
- Open Diagnostics Report
- Enable Safe Mode
- Disable Safe Mode
- Clear Crash Lock
- View Last Crash Report
- Create World
- Create Faction
- Create Location
- Create Creature
- Create BBEG
- Create Character Sheet
- Campaign Creation Wizard
- Open Campaign Bible
- Create Dungeon / Location
- Create Escalation Timer
- Create Enemy Template
- Open War Machine
- Open Faction Relationship Matrix
- Run / Resume Session
- End Current Session
- Open PC Companion
- Open PC Inventory
- Open Spellbook
- Long Rest
- Short Rest
- Export Campaign
- Export Player Packet
- Import Campaign
- Open Endgame Tracker

---

## Development

### Requirements

- Obsidian
- Node.js
- npm

### Suggested development setup

```bash
npm install
npm run build
```

If linting is configured:

```bash
npm run lint
```

If a quality check script is configured:

```bash
npm run check
```

### Suggested release files

A release build should include:

```text
main.js
manifest.json
styles.css
```

Optional:

```text
assets/
```

Do not include large asset packs in public releases unless you have confirmed redistribution rights.

---

## Roadmap

Planned or ongoing areas of work:

- Stronger TypeScript/module architecture
- Cleaner Obsidian Community Plugin compliance
- Improved command naming for submission readiness
- Reduced inline styling
- Better map asset relinking tools
- More complete PC Companion features
- More complete 5e/SRD-compatible compendium support
- Campaign-aware generators
- Improved import/export workflows
- More robust markdown sync
- Community plugin review preparation

---

## Privacy

TTRPG Engine is intended to work locally inside your Obsidian vault.

The plugin should not require external accounts, analytics, remote services, or internet access for core features.

If future versions add optional network features, they should be clearly documented here before release.

---

## Licensing

Plugin code license:

```text
TODO: Add license, for example MIT.
```

Asset license:

```text
TODO: Document bundled sample asset licenses.
```

D&D / rules content note:

```text
TODO: Confirm that any bundled rules, compendium entries, or game data are allowed under the relevant license before public release.
```

---

## Support

Issues and feature requests:

```text
TODO: Add GitHub issues link.
```

Documentation:

```text
TODO: Add documentation link or wiki link.
```

---

## Status

TTRPG Engine is currently under active development.

Before submitting to the Obsidian Community Plugin directory, the plugin should be checked for:

- Manifest accuracy
- Version alignment
- Build reproducibility
- ESLint / Obsidian lint compliance
- Clear README and screenshots
- License completeness
- Asset redistribution safety
- No bundled oversized asset packs
- No unexpected network activity
- No destructive migrations
- No startup-time code that can break Obsidian

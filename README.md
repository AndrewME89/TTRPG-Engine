# Obsidian TTRPG Table

**Obsidian TTRPG Table** is an Obsidian plugin for running, organising, and recovering tabletop RPG campaign content directly inside your vault.

It is designed as a practical campaign command centre for Dungeon Masters, players, worldbuilders, and TTRPG note-hoarders who want their campaign data to live where their notes already live: inside Obsidian.

---

## Current Status

> **Version:** 1.141.0 (Phase 141)
>
> **Development status:** Active early development
>
> **Stability:** Experimental / work-in-progress
>
> **Recommended use:** Testing, development vaults, and controlled campaign notes
>
> **Production use:** Not yet recommended without backups

Phase 141 is a cleaned release aligned to the same repository/package standard as the Claude-cleaned `TTRPG-Engine-main` build.

This release keeps the plugin package lean: plugin entry files, metadata, styles, licence/git hygiene files, and the shared `data/` compendium JSON files only. Large bundled asset packs and stale release notes have been removed from this ZIP.

---

## New in Phase 141

- Cleaned the release package to match the `TTRPG-Engine-main` standard.
- Added missing `.gitignore` and `LICENSE` files.
- Removed the bundled `assets/portrait-tokens/bewby/` asset pack from the release ZIP.
- Removed the stale `adventure-module-template.json` file from the release ZIP.
- Replaced the old Phase 111 README with current Phase 141 release documentation.
- Aligned `PLUGIN_VERSION` in `main.js` with `manifest.json`.
- Added a Phase 141 save-state version marker so saved data reports `1.141.0`.
- Preserved the Phase 141 live-combat theme cleanup code and all shared data files.

---

## Package Contents

This cleaned ZIP contains:

```text
.gitignore
LICENSE
README.md
manifest.json
main.js
styles.css
data/
```

The `data/` folder contains the shared compendium/reference JSON files used by the plugin.

---

## Install

Copy this plugin folder into:

```text
<vault>/.obsidian/plugins/ttrpg-table/
```

Then reload Obsidian and enable **TTRPG Table** from Community Plugins.

---

## Testing Checklist

After installing this build, check:

- Plugin enables without console errors.
- Main TTRPG Table view opens.
- Campaign dashboard still loads.
- Live Combat cards use Obsidian theme colours instead of hard-coded parchment/red/gold styling.
- Saved campaigns, characters, NPCs, encounters, quests, journals, and compendium entries still appear.
- Data survives reload/restart/plugin toggle.
- No bundled portrait-token asset pack is expected in this release ZIP.

---

## Notes

This build is intentionally lean. Optional visual assets should be handled as user-provided folders or separate asset packs rather than bundled into the core plugin ZIP.

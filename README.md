# TTRPG Table — Phase 82

Adds a dedicated **DM Mode → Homebrew Forge** module.

## New in Phase 82

- New sidebar module: **Homebrew Forge**
- Fast category-driven homebrew builder for:
  - Nonmagical items
  - Magic items
  - Potions / poisons
  - Creatures / monsters
  - Spells
  - Races / ancestries
  - Classes / subclasses
  - Feats
  - Backgrounds
  - Traps
  - Environments
  - NPCs
  - Encounters
  - Rule variants
  - Worlds / campaigns
- Built-in design guardrails for rarity, attunement, charges, action economy, CR, save DCs, crafting, and playtesting.
- Saves into the relevant plugin section where useful.
- Also indexes homebrew entries in Library & Homebrew.
- **Save & Write Note** creates clean template-driven Markdown notes.
- No external network calls.


## Phase 90
- Added dashboard House Rules quick chip.
- Shop/inn/tavern/blacksmith/general-store/apothecary generators now include relevant catalogues from local item data.
- Combat tracker can add enemies from compendium and apply conditions/traps/hazards/effects.
- World & Lore category chips now use a compact 2x3 layout.
- Interactive Map Manager can generate/regenerate SVG maps for settlements, towns, villages, cities, POIs, dungeons, battlemaps, regions, and worlds.
- Library is now Library & Compendium with searchable categorised chips; homebrew creation lives in Homebrew Forge.
- Homebrew Forge saves generated entries to the compendium.
- Removed visible “Created from Campaign Builder Wizard” wording from new generated output.

## Phase 91 — Randomised Map Generator Upgrade

- Map rendering now uses a fresh random seed instead of a deterministic name hash.
- Added different procedural SVG layouts for settlement, town, village, city, POI, dungeon, battlemap, region, and world maps.
- Interactive Map Manager can regenerate maps repeatedly and writes actual SVG files into the campaign Maps folder.
- Added an optional Token Asset Folder field for future asset-pack support.

## Phase 92 — Markdown Import Cleanup

- Removes noisy `imported` labels and “Imported from existing Markdown folder” wording from UI cards and generated sync metadata.
- Improves Markdown importer cleanup for Dataview, Meta Bind `INPUT`/`VIEW`, metadata callouts, HTML spans, and wiki links.
- Keeps note/plugin sync metadata in YAML, but does not display import scaffolding to users.

## Phase 93 — Compendium Category Consolidation

- Compendium category chips now use canonical Title Case labels.
- Duplicate chips such as `Spell` / `spell`, `Weapon` / `weapon`, `Armor` / `armor` are consolidated.
- Source labels such as built-in JSON seed text are no longer shown as category chips.
- Compendium result cards show cleaned category chips rather than noisy raw tags.


## Phase 97 — Hard Restore Saved Entry Cards

- Replaced the fragile saved-entry card renderer with a defensive renderer.
- Cards now always show Open / Edit, Note, Delete, and relevant contextual actions.
- NPCs, creatures, settlements, worlds, lore, maps, and compendium entries should no longer collapse to title-only cards.
- Structured fields are displayed safely without `[object Object]` and without stopping the rest of the card from rendering.

## Phase 104 — Asset-backed map generation

This build includes the curated map asset pack under `assets/map-tokens/` and uses it when writing generated SVG maps. If an asset cannot be loaded, the procedural SVG generator remains the fallback.

Faction creation now includes a Faction Type selector covering organisations, cults, guilds, noble houses, criminal syndicates, political groups, religious orders, and other common faction categories.

## Phase 105 — Disciplined Asset Map Placement

Phase 104 confirmed bundled map assets could render, but placement was too chaotic. Phase 105 tightens generation by:

- using a lighter settlement base when asset-backed maps are available;
- preventing duplicated procedural buildings under asset buildings;
- reducing token counts per map;
- filtering out creature/casualty/water tokens from settlement maps;
- using stricter category matching for buildings, nature, dungeon pieces, props, and ruins;
- placing buildings into sensible settlement slots with collision avoidance;
- keeping trees and rocks mostly around map edges for cleaner villages/towns/cities.

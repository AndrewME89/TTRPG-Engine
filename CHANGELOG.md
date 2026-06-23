# Changelog

All notable changes to TTRPG Engine are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [SemVer](https://semver.org/).

---

## [Unreleased] — Phase 265 (Tests)

### Added
- **`tests/phase261.test.js`**: 34 pure-function tests across 6 suites —
  `generate() new types` (7: Plot Twist/Town Event/Trap assertions),
  `Currency defaults` (7: all 5 coins present and zero),
  `calcInitiative` (5: stored override, DEX-based calculation, edge cases),
  `ENTITY_NAV map` (6: section routing for key entity types),
  `BBEGModal defaults` (5: visibility, motivation, linkedNpcIds),
  `repairAndReindex extended` (4: multi-type repair, campaignId assignment rules)
- **`npm test`**: Now chains all four test suites — 204 tests total, 0 failed

---

## [Unreleased] — Phase 264 (UI/Accessibility)

### Added
- **`styles.css` — `.te-empty-state`**: Inline empty-state message class (used 49× in main.js but was unstyled); now rendered as italic muted text with appropriate padding
- **`styles.css` — `.te-chip-input`**: Chip input wrapper with border, flex layout, and min-height
- **`styles.css` — `.te-stat-value`**: Diagnostic/wizard stat value class
- **`styles.css` — Keyboard focus styles**: `.te-btn:focus-visible`, `.te-nav-btn:focus-visible`, `.te-player-tab:focus-visible`, `input/select/textarea:focus-visible` — all receive 2px accent-colour outline; mouse-click focus suppressed via `:focus:not(:focus-visible)` to avoid visual noise
- **`styles.css` — Level-up modal classes**: `.te-levelup-card`, `.te-levelup-stat`
- **`styles.css` — Run Session NPC row**: `.te-session-npc-row` matching the inline styles previously applied via JavaScript

### Changed
- `src/styles.css` synced from root `styles.css`

---

## [Unreleased] — Phase 263

### Added
- **NPCModal — Tags**: Tags chip field added to the Identity section (was already stored in `tags` array, now has UI); suggestions: Merchant, Noble, Informant, Villain, Ally, Enemy, Quest Giver, Recurring, Secret Keeper, Combat, Social, City, Wilderness
- **BBEGModal enhancements**: Added `Visibility` select (dm-only/player-visible/secret), `Motivation / Backstory` textarea, and `Lieutenant NPCs` entity multi-picker backed by the NPCs list; `linkedNpcIds` stored on entity
- **QuestModal — DM Notes fix**: `DM Notes (hidden from players)` field now correctly saves to `dmNotes` (was saving to `secrets`); `Secrets (DM only)` field retained as a separate field
- **New generators — Plot Twist**: 12-entry plot twist table covering betrayals, misdirections, and dramatic reversals
- **New generators — Town Event**: 12-entry town event table for settlement-level happenings during play
- **New generators — Trap**: Generator combining trap type, trigger, effect, and tell sign into a single card result
- **Generator UI**: Plot Twist, Town Event, and Trap cards added to both the Generators tab and the Run Session Quick Generators panel (now 14 types)

---

## [Unreleased] — Phase 262

### Added
- **Dashboard — My Content clickable tiles**: All "Content Summary" stat cards now navigate to their corresponding section on click; hover shows accent outline
- **Dashboard — Quick actions**: Backup Now, Restore Backup, and Repair & Reindex buttons in the Content Summary card
- **`RestoreBackupModal`**: Preview a backup JSON file (vault path input), see version/timestamp/entity counts; "Restore" auto-backs up current data first, then restores and re-migrates state
- **Character sheet calculated initiative**: `renderPCCharacter` stat grid now always shows Initiative as the DEX ability modifier if no override is set

### Changed
- **Dashboard**: "My Content / Saved Items" section retitled "Content Summary — click any tile to navigate"; stat cards are now interactive

---

## [Unreleased] — Phase 261

### Added
- **Spellbook v2** (`renderPCSpellbook`, now async): Full spell browser backed by `ReferenceDataService` (`spells.json`); level filter buttons (All/Cantrip/1–9), search input, expandable spell detail cards (school, cast time, range, duration); "+ Learn" action adds spell to character; known spells shown at top with expand-to-detail and Remove button
- **Inventory Equipment Browser** (`renderPCInventory`, now async): Equipment browser backed by `ReferenceDataService` (`equipment.json`); search input, expandable detail, "+ Carry" action adds item to character inventory
- **Currency unified to 5 coins**: CharacterModal defaults updated from `{gp, sp, cp}` to `{pp, gp, ep, sp, cp}` matching the Inventory view's five-coin display
- **Run Session — Active NPCs panel**: Searchable list of campaign NPCs showing name, role, attitude, and motivation quote
- **Run Session — Active Quests panel**: Grid of active campaign quests with objectives (up to 3 shown per quest)
- **Run Session — Conditions Reference**: Expandable conditions list loaded async from `conditions.json` via `ReferenceDataService`

---

## [Unreleased] — Phase 260c

### Added
- **Complete Entity Generators**: Four "Complete Entity Generator" cards in Generators tab — Complete NPC, Complete Settlement, Complete Faction, Complete Quest — each returns a full structured object (all required fields populated) and opens `EntityDraftModal` for preview before saving
- **`generateCompleteNPC(state)`**: Returns name, ancestry, role, occupation, attitude, personality, motivation, secret, questHook, status, visibility, campaignId
- **`generateCompleteSettlement(state)`**: Returns name, type, size, government, population, economy, problems array, description, status, campaignId
- **`generateCompleteFaction(state)`**: Returns name, type, goals/methods arrays, publicFace, secretAgenda, status, visibility, campaignId
- **`generateCompleteQuest(state)`**: Returns name, questType, status, summary, objectives/complications/rewards arrays, campaignId
- **`EntityDraftModal`**: Preview-and-save modal for generated entities — shows all fields, "Save as Entity" opens the correct builder modal, "Regenerate" refreshes the draft, "Discard" cancels
- **Session Event Log**: Live event log at the bottom of Run Session — 12 type buttons (Note, NPC Met, Location Visited, Combat Start, Combat End, Loot Found, Spell Cast, Death/KO, PC Decision, Revelation, Quest Update, Other), text input with Enter support, persisted to `sess.eventLog`, displayed in reverse-chronological order with timestamps

---

## [Unreleased] — Phase 260b

### Added
- **Level-up constants**: `HIT_DICE` (all 13 classes d6–d12), `SPELLCASTER_TYPE` (full/half/pact/none per class), `FULL_CASTER_SLOTS` / `HALF_CASTER_SLOTS` / `PACT_SLOTS` tables, `ASI_LEVELS_DEFAULT/FIGHTER/ROGUE`
- **`getAsiLevels(cls)`**: Returns correct ASI level array (Fighter gets 7 ASIs, Rogue gets 6, others get 5)
- **`getSpellSlotsForLevel(cls, level)`**: Returns 9-element slot array for full/half casters, null for pact/none
- **`isSpellcaster(cls)`**: Returns true for all caster types including pact
- **`LevelUpModal`**: Level-up flow modal triggered automatically when Character Builder saves with a higher level — HP section (average/roll/manual with Roll Die button), ASI section (conditional on ASI level), Spell Slots section (conditional on caster type), Class Features note; Apply button commits HP gain, ASI deltas (capped at 20), and spell slot changes to the character record and records a `levelHistory` entry; Skip cancels without applying

### Changed
- **CharacterModal save**: Now detects level increase (`newLevel > prevLevel`), saves the character first, then automatically opens `LevelUpModal`

---

## [Unreleased] — Phase 260a

### Added
- **`repairAndReindex(state)`**: Scans all entity arrays — assigns missing IDs (`${key}-repaired-${i}`), renames duplicates (`${id}-dup-${i}`), adds missing `createdAt`/`updatedAt`, assigns `campaignId` from `state.activeCampaignId` to campaign-owned entities; returns issues array for reporting
- **Safe Mode Recovery — Repair / Reindex**: New option in the safe mode recovery shell that calls `repairAndReindex()` and shows a summary notice of issues found/fixed
- **Safe Mode Recovery — View Crash Report**: New option that renders the full crash error and stack trace in a scrollable container
- **`ENTITY_MD_TEMPLATES`**: Expanded from 6 to 12 entries — added `secrets`, `bbegs`, `hybridAncestries`, `nobleFamilies`, `handouts`, `homebrew` templates with structured Markdown bodies (sections, bold labels, proper paragraph breaks)
- **`scripts/sync-check.mjs`**: Verifies root `main.js` and `src/main.js` are byte-identical; exits 1 with a helpful message if they differ (preventing accidental divergence)

### Changed
- **`scripts/build.mjs`**: Rewritten to copy root → src (was src → root); now runs `node --check main.js` as first step and fails fast on syntax errors
- **`npm run build`**: Now includes `check-release` step; `release` script chains check → build → check-release → package
- **`package.json` scripts**: Added `sync-check` script; `build` and `release` scripts updated

---

## [Unreleased] — Phase 260e (tests)

### Added
- **`tests/phase260.test.js`**: 39 pure-function unit tests across 7 suites — `HIT_DICE` (5), `SPELLCASTER_TYPE/isSpellcaster` (8), `getSpellSlotsForLevel` (6), `getAsiLevels` (6), `repairAndReindex` (7), `generateCompleteNPC` (4), `generateCompleteFaction` (3)
- **`npm test`**: Now chains all three test suites (`tile-map.test.js` + `phase259.test.js` + `phase260.test.js`) — 170 tests total

---

## [Unreleased] — Phase 259e

### Added
- **`tests/phase259.test.js`**: 79 pure-function unit tests across 8 suites — `toTitleCase` (6), `renderTag` (10), `modifier/modStr/profBonus` (12), `slugify` (4), `safeArr` (5), `matchesSearch` (6), `activeCampaign` (4), `upsert/removeItem` (7), `generate` (10), `computeHybridBalance` (15)
- **`npm test`**: Now chains both test suites (`tile-map.test.js` + `phase259.test.js`)

---

## [Unreleased] — Phase 259d

### Added
- **Run Session — Inline Dice Roller**: Quick die buttons (d4–d100) + formula input (`NdN±M`) with instant result; Enter key submits formula
- **Run Session — Quick Generators panel**: Type selector (11 generator types), Generate button, result display; "Save as Entity" button appears for NPC Name (→ NPCModal), Faction Name (→ FactionModal), Quest Hook (→ QuestModal)
- **Run Session — empty notes state**: Shows "Start a session to enable notes." when no active session

### Changed
- **Campaign pickers**: Added `campaignId` field + `addCampaignPicker()` to **CreatureModal**, **BBEGModal**, **SessionModal**, and **SecretModal** (NPCModal, FactionModal, QuestModal, EncounterModal already had it)
- **EncounterModal participants**: Replaced manual `chipField('Participants (PCs)')` with two entity multi-pickers — `participantPcIds` (characters) and `participantNpcIds` (NPCs); legacy `participants` text array preserved for backward compat
- **"Write Note" label**: All "Sync" buttons renamed to "Write Note" (clarifies one-way export — does not sync back from vault)

---

## [Unreleased] — Phase 259c

### Added
- **Relationship Matrix**: Replaces Faction Matrix — multi-entity relationship tracking for Factions, NPCs, PCs, Noble Families, Settlements, Locations, Regions, and Quests; nav label updated to "Relationship Matrix"; `'relationship-matrix'` section alias added; old `renderFactionMatrix` kept as delegate stub for backward compatibility
- **`RELATIONSHIP_TYPES`**: 28 relationship types (Ally, At War, Blackmailed, Blood Feud, Business Partners, Cautious, Controlled, Defector, Diplomatic, Estranged, Feudal Lord, Former Allies, Grudging Respect, Mercenaries, Mentored, Neutral, Peace Treaty, Protected, Rivals, Romance, Servant, Spy, Suspicious, Trade Partners, Trusted, Uneasy Truce, Unknown, Vassal)
- **`PICKABLE_ENTITY_TYPES`**: 8 entity types selectable in relationship from/to pickers (Faction, NPC, PC/Character, Noble Family, Settlement, Location, Region, Quest)
- **`addTypedEntityPicker()`**: Helper for two-dropdown entity selection (type selector + entity-ID selector populated from that type)
- **`NobleFamilyModal`**: 4-section rich modal — Identity (name, motto, status, visibility, head of house NPC, home region, seat settlement), Holdings & Claims, Relations (allied factions multi-picker, related quests multi-picker, member/alliance/rival chips), DM Notes (secrets, player summary, DM notes)
- **Noble Families entity**: `nobleFamilies` added to `createDefaultState()`, `ENTITY_ICONS` (🏰), `ENTITY_LABELS`, `RICH_EDIT_MAP`, and `ENTITY_FIELD_SCHEMAS`
- **`renderRelationshipMatrix()`**: New render function — All Relationships section with filter buttons (All, NPC, Faction, PC, Noble Family, Settlement), Noble Families & Houses card grid, Faction Reputation tracker

### Changed
- **`RelationshipModal`**: Rebuilt with typed-entity pickers (`fromEntityType/fromId`, `toEntityType/toId`), `relationshipType` dropdown (28 types), `attitude`, `influence`, `trust`, `fear` sliders/fields; legacy `from/to/type` text fields preserved for backward compat
- **`FactionModal`**: Added `staffRoles` chip field section (Staff & Roles) with suggestions: Leader, Second-in-command, Quartermaster, Spy, Recruiter, Agent, Informant, Commander, Diplomat, Treasurer, Enforcer, Defector

---

## [Unreleased] — Phase 259

### Added
- **5e Reference section**: New Library nav item "📖 5e Reference" — searchable, tab-filtered reference for 15 data types: Spells, Feats, Equipment, Backgrounds, Races, Skills, Languages, Conditions, Deities, Actions, Rewards, Traps, Vehicles, Objects, Senses; expand any row for full detail including spell stats grid (school, cast time, range, duration), feat prerequisites, background skill proficiencies, deity domains; capped at 120 visible results with "refine to see more" prompt
- **`ReferenceDataService`**: Lazy-loading JSON cache — reads per-type file from `PLUGIN_DIR/data/` on first access; `search()` filters across name, source, type, school, level, category
- **`renderTag()`**: Strips 5e.tools inline tags (`{@spell fireball}`, `{@dice 1d6}`, `{@dc 13}`, `{@variantrule Long Rest|XPHB}`, etc.) to readable plain text
- **`renderEntries()`**: Recursively renders 5e.tools entry objects (strings, `entries`, `list`, `item`, `table`, `cell`) as DOM nodes — handles nested sections, bullet lists, and data tables
- **Reference data bundle**: 15 JSON data files copied to `data/` folder (actions, backgrounds, conditions, deities, equipment, feats, languages, objects, races, rewards, senses, skills, spells, traps, vehicles)
- **`addEntityMultiPicker()`**: New helper for chip-display multi-entity selection storing IDs with add-from-dropdown and click-to-remove chips
- **Drow + ancestry variants**: Added Drow (darkvision 120, Superior Darkvision, Fey Ancestry, Drow Magic, Sunlight Sensitivity), High Elf, Wood Elf, Hill Dwarf, Mountain Dwarf, Lightfoot Halfling, Stout Halfling, Forest Gnome, Rock Gnome, Deep Gnome to `ANCESTRIES` list and `ANCESTRY_DATA` with correct stats
- **`ANCESTRIES` sorted alphabetically** (Other remains last)
- **`toTitleCase()` helper** + **`campaignFolder()` now produces Title Case paths** (e.g. `My Campaign`) instead of kebab-case slugs
- **`addEntityPicker()` sort**: Items now sorted alphabetically by name
- **`entityMd()` rewritten** with per-entity Markdown body templates (npcs, quests, factions, encounters, sessions, hybridAncestries); YAML frontmatter reduced to essential fields only (name, status, type, campaignId, visibility, updatedAt)

### Changed
- **NPCModal**: Added campaign picker (top), `locationId` (settlements entity picker), `factionIds` (faction multi-picker with chips) — IDs stored alongside legacy text fields
- **FactionModal**: Added campaign picker, visibility selector, `leaderNpcId` (NPC picker), `allyIds` / `enemyIds` (faction multi-pickers replacing plain chipFields)
- **QuestModal**: Added campaign picker, `giverNpcId` (NPC picker), `locationId` (settlements picker), `relatedNpcIds` / `relatedFactionIds` / `linkedEncounterIds` (entity multi-pickers)
- **EncounterModal**: Added campaign picker, visibility selector, `locationId` (settlements picker), `linkedQuestId` (quest picker)
- **HybridAncestryModal trait chips**: Replaced native `<input type="checkbox">` with accessible custom toggle cards (`role="checkbox"`, `aria-checked`, keyboard support via Space/Enter)

### Fixed
- **`safeDisable()`**: No longer writes `TTRPG_ENGINE_DISABLED.txt` automatically on crash — only `LOAD_FAILED` and `CRASH_REPORT` are written, preventing a normal crash from creating an unrecoverable hard-disable
- **`clearCrashLock()`**: Now removes all plugin-created lock files (`LOAD_FAILED`, `BOOT_MARKER`, `TTRPG_ENGINE_DISABLED.txt`) instead of just `LOAD_FAILED`

---

## [Unreleased] — Phase 258

### Fixed
- **Hybridiser checkbox CSS**: `.te-modal input` width rule now excludes `[type="checkbox"]` and `[type="radio"]` — checkboxes no longer render as full-width red bars in the trait picker
- **Hybridiser trait grid**: `tGrid` now uses class `te-trait-grid` (responsive `auto-fit minmax(220px,1fr)`) instead of hardcoded `1fr 1fr`; looks correct at any modal width
- **Hybridiser live balance refresh**: `refreshBalance()` closure recomputes score, rating, fill colour, label, and warnings whenever a trait checkbox is toggled or an ASI input changes; ASI total label also updates live
- **Hybridiser trait descriptions**: Each trait chip now renders its description as visible text (`te-trait-desc`) below the name, not only as a hover tooltip
- **Edit button routing — `RICH_EDIT_MAP`**: `defaultEdit()` now routes npcs → `NPCModal`, creatures → `CreatureModal`, bbegs → `BBEGModal`, factions → `FactionModal`, quests → `QuestModal`, encounters → `EncounterModal`, sessions → `SessionModal`, secrets → `SecretModal`, calendars → `CalendarModal`, homebrew → `HomebrewModal`, characters → `CharacterModal`, hybridAncestries → `HybridAncestryModal` — all Edit buttons now open the correct rich modal instead of the weak `GenericModal`
- **Safe Mode no longer a hard brick**: `SAFE_MODE.txt` removed from `KILL_SWITCH_FILES`; if safe mode is active the plugin now loads a recovery shell (Disable Safe Mode, Backup, Diagnostics, Clear Crash Lock) instead of blocking load entirely and leaving the DM unable to recover without touching the filesystem
- **PC visibility filter**: Hybrid ancestry filter in PC mode changed from `!== 'dm-only'` to `=== 'player-visible'` — future visibility states won't accidentally leak DM content
- **"Use for New PC/NPC" guard**: Now validates that an ancestry name is entered before opening `CharacterModal` / `NPCModal`
- **CSS version**: Comment updated from 2.0 to 2.1.0
- **CSS rgba fix**: `.te-btn.is-danger:hover` changed from `rgba(var(--te-danger), .08)` (invalid for non-RGB variable values) to `color-mix(in srgb, var(--te-danger) 10%, transparent)`
- **CSS hardcoded colour**: `.te-btn.is-run` `color:#fff` changed to `color:var(--te-on-accent,#fff)`
- **Field schemas**: Added `damageTypes` and `tables` schemas to `ENTITY_FIELD_SCHEMAS` so `GenericModal` renders useful forms for those entity types
- **src/ sync**: `src/main.js` and `src/styles.css` copied from root — build script (`scripts/build.mjs`) is now safe to run without overwriting Phase 253–258 work

---

## [Unreleased] — Phase 257

### Added
- **Race/Ancestry Hybridiser**: `hybridAncestries` entity; `ANCESTRY_DATA` constant (size, speed, darkvision, creature type, resistance, and traits for all 34 built-in ancestries); `HYBRID_TRAIT_LIBRARY` (30 traits across 4 tiers: cosmetic, minor, medium, strong); `computeHybridBalance()` (score 0–10, ratings: Underpowered / Balanced / Strong / Overpowered, auto-generates warnings for duplicate darkvision, stacked resistances, multiple spellcasting, flight, non-humanoid type, and ASI > +3)
- **Hybrid Ancestry page**: Available in both DM Engine (World & Story nav group) and PC Companion (Character nav group) as `hybrid-ancestry` section; DM view shows stat summary (total/approved/pending) and full card grid with balance bar + warning badge; PC view shows player-visible ancestries only
- **HybridAncestryModal**: 8-section form — Identity (name, parent ancestries, third influence, visibility, status, approval status), Parent Ancestry Reference (auto-populated ANCESTRY_DATA cards for dominant and recessive parents), Core Basics (size, speed, creature type, darkvision, languages, age notes), Ability Score Improvements (method select, per-score inputs, total counter, DM override toggle), Traits (tiered checkbox picker with live balance bar and warning box), Culture & Appearance, Player Notes, DM Notes; action buttons: Use for New PC, Use for New NPC, Save as Homebrew, Save as Compendium, Export Player-Safe (writes Markdown note)
- **Integration**: `CharacterModal` and `NPCModal` ancestry datalists now include names of saved hybrid ancestries; `exportPlayerSafePacket` includes player-visible hybrids section with trait list and summary
- **CSS**: `.te-balance-row`, `.te-balance-meter`, `.te-balance-fill` (`.is-weak`, `.is-balanced`, `.is-strong`, `.is-over`), `.te-balance-label`, `.te-trait-chip` (`.is-active`), `.te-muted-text`, `.te-hybrid-warning-box`, `.te-hybrid-warning-item`, `.te-hybrid-warning-badge`

---

## [Unreleased] — Phase 256

### Added
- **Encounter XP Budget Calculator**: `ENCOUNTER_XP_THRESHOLDS` constant (D&D 5e per-character thresholds by level); new Party XP Budget card in Encounters & Combat shows Easy / Medium / Hard / Deadly totals based on current characters
- **Handout Reveal Queue**: Run Session now shows DM-only handouts alongside queued secrets; "📤 Share with Players" button marks handout player-visible immediately
- **Quest Status Board**: Adventures & Quests replaces plain quest grid with a board showing Active / Completed / Other counts (stat cards) then grouped lists; `itemCards()` gains an `opts.items` override for pre-filtered rendering
- **4 new generator types**: Faction Name, NPC Trait, Dungeon Room, Wild Magic Surge — wired in `GEN_TABLES`, `generate()`, and the generator card grid; Faction Name and NPC Trait get context-aware Save buttons in generator history
- **Campaign Bible — Session History**: New section showing up to 12 recent sessions (newest first) with date/status/summary; "View All" link navigates to Sessions & Timeline; empty state when no sessions exist
- **CSS**: `.te-quest-status-head` for quest board status group labels

---

## [Unreleased] — Phase 255

### Added
- **XP Tracker**: `XP_THRESHOLDS` constant (D&D 5e standard); `xp` field added to `CharacterModal` defaults and combat stats section; XP progress bar shows current/next-level XP with purple fill in Character Sheet
- **Saving Throws**: calculated display below ability scores in Character Sheet — STR through CHA saves with modifier + proficiency bonus; proficient saves highlighted with accent border (`.te-ability-box.is-proficient`) and ● indicator; Passive Perception shown alongside
- **Death Saves Tracker**: shown only when HP = 0; 3 clickable success bubbles (accent) + 3 failure bubbles (danger); click toggles individual checkmarks; Reset button clears all; data stored in `char.deathSaves`
- **Spell Slots Tracker**: new section above spell list in Spellbook; levels 1–9 shown (empty high levels hidden); bubble-per-slot click marks used; editable max-per-level input; Reset All Slots button; data stored in `char.spellSlots`
- **PC Lore expansion**: `renderPCLore()` now shows player-visible `nations` and `religions` (Phase 254 entities) below worlds and cultures
- **CSS** (styles.css): `.te-ability-box.is-proficient`, `.te-death-saves`, `.te-death-save-row`, `.te-death-save-label`, `.te-save-bubble` (`.is-success`, `.is-failure`), `.te-spell-slots`, `.te-slot-row`, `.te-slot-label`, `.te-slot-bubbles`, `.te-slot-bubble` (`.is-used`)

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

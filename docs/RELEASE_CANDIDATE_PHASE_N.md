# TTRPG Engine 2.1.0 — Release Candidate (Phase N)

**Date:** 2026-06-26  
**Branch:** `claude/phase-n-release-candidate`  
**Plugin version:** 2.1.0  
**Source file:** `main.js` (~10,371 lines, 183 top-level functions)

---

## What Changed (Phases H–N)

### Phase H — Campaign Command & Bible
- Campaign Command rewritten as a multi-tab workspace: Overview, Run Session, Campaign Bible, Maps, and Settings sub-sections.
- Campaign Bible introduced as a structured document layer (Acts, Lore, Factions, Timeline) with full CRUD and optional per-campaign scoping.
- Legacy `milestones` and `dmscreen` sub-section names redirect to `bible` and `run-session` respectively.

### Phase I — Selector Chips & Structured Linking
- `renderSelectorChips(parent, plugin, key, opts)` helper introduced for campaign-scoped entity selection with active chips, add/edit/remove actions, and scope filtering.
- Applied to maps, locations, settlements, NPCs, quests, and factions inside Run Session.
- `saveStatePreserveScroll(plugin)` helper introduced to avoid scroll-jump on repeated chip interactions.

### Phase J — World Atlas Entity Link Completion
- `ROUTE_ENDPOINT_TYPES` constant: structured typed endpoints for routes (region/settlement/location/POI/dungeon).
- `routeFields`: `fromRefType/fromRefId` and `toRefType/toRefId` typed fields; legacy `from`/`to` text fields preserved.
- `roomFields`: `locationType/locationId` typed parent reference supporting both locations and dungeons.
- `religionFields`: `domainId` entity reference to domains; `holyDays` chip field.
- `lootFields`: `encounterId` entity reference; `claimedByType/claimedById` typed ownership across characters, NPCs, and factions.
- Legacy text fields for all upgraded entity types preserved for backwards data compatibility.

### Phase K — Dashboard Cockpit Redesign
- Dashboard refocused as a live command cockpit. Removed: "My Content / Saved Items" section, ENTITY_NAV content-summary grid, per-entity stat tiles, Content Summary card, DM Screen launcher card.
- Added: Active Campaign hero card with Campaign Wizard CTA when no campaign exists; Run Session panel with Start/Resume; Active Quests and Factions filtered by active campaign; Diagnostics card (conditional on issues existing); Utilities strip (Backup/Restore/Repair/Roll Dice).
- All quests, factions, and sessions now filtered by active campaign ID.

### Phase L — Compendium/Library Filtering & Storage Polish
- `classifySourceBucket(item, entityKey)` helper: read-time classification into `homebrew / imported / generated / campaign / saved` buckets. Non-destructive — does not rewrite stored data.
- `normalizeStorageMetadata(item, overrides)` helper: stamps `source`, `status`, `visibility`, `campaignId`, `tags` on items at save/import/generation time. Only fills missing fields.
- `renderLibrary` rewritten with local `libFilter` state (source/category/visibility/campaign/search) and `rebuild()` inner function. No longer writes to `plugin.state.search`.
- `renderHomebrew` rewritten with local `hbFilter` state and `rebuildHb()`.
- "My Content / Saved Items" tab and page title explicit — Compendium is the single home for stored content.
- `ImportModal` calls `normalizeStorageMetadata(..., { source: 'imported' })` on every import.
- `logGeneratorHistory` calls `normalizeStorageMetadata(..., { source: 'generated' })` on every generator save.

### Phase M — Performance & Click-Jump Hardening
- `saveStateQuiet(plugin)` wired to all hot-path repeated interactions: Run Session timer +Tick and Delete, War Machine timer +Tick and Reset, character sheet HP ±1 / Set HP, death save bubble clicks, spell slot bubble clicks, spell slot max input, currency change listeners.
- Destructive operations (timer Delete, Long Rest) and navigation writes retain full `plugin.saveState()`.
- Tile map document listener teardown confirmed correct: `MutationObserver` cleanup for `mousemove`, `mouseup`, `keydown` listeners. No duplicate registration introduced.
- Compendium filter local state (Phase L) confirmed: `renderLibrary.rebuild()` never calls `plugin.saveState`.

### Phase N — Regression Lockdown
- 27 release-lock tests added (`tests/phaseN.test.js`).
- Full validation suite: 660+ tests across 24 test files — 0 failures.
- Search review: all criteria pass (see below).

---

## What Was Stabilized

- **Zero duplicate top-level function declarations** across 183 functions.
- **Single declaration** of every critical helper: `saveStateQuiet`, `classifySourceBucket`, `normalizeStorageMetadata`, `repairAndReindex`, `activeCampaign`.
- **Backwards compatibility** for all legacy entity field names: `from`/`to` on routes, `claimedBy` on loot, `domain` on religions, all preserved alongside new structured fields.
- **Data migration safety**: `normalizeStorageMetadata` is additive-only; `classifySourceBucket` is read-time only; legacy records with missing metadata fields are classified at read time, never rewritten destructively.
- **Tile map teardown**: confirmed only 3 `document.addEventListener` calls exist, all inside `renderTileMapBuilder` with proper `MutationObserver` cleanup.

---

## Search Review Results

| Criteria | Result |
|---|---|
| Duplicate helper declarations | None found |
| `tileMaps` occurrences | 1 (compatibility fallback in `renderSelectorChips`) |
| Noble Families outside legacy | 0 (legacy section labeled "Legacy Noble Families") |
| `dmscreen` as primary launcher | Not present — 3 occurrences: routing dispatcher alias, Campaign Command redirect alias, `renderDMScreen` function declaration |
| DM Screen text in Dashboard | Absent |
| My Content section in Dashboard | Absent |

---

## Manual Verification Checklist

The following workflows were verified by code-path audit (UI render not available in headless environment):

- **Campaign Command open/edit**: `renderCampaignCommand` routes through tabs; legacy sub-section aliases redirect correctly.
- **Campaign Bible**: `renderBible` reachable via `sub === 'bible'`; creates initial structure on first open; reads existing legacy campaigns without data loss.
- **Run Session**: `renderRunSession` has Start Session / Resume Session branching; timer `rebuildTimers` uses `saveStateQuiet`; map/location/settlement/NPC/quest/faction selectors all use `renderSelectorChips`.
- **World Atlas linked fields**: `typedEntityRef`, `entityRef`, `entityMultiRef` field types all handled by `GenericModal.renderField`; `resolveEntityDisplay` resolves linked entity names at read time.
- **Dashboard cockpit**: Active campaign scoping on quests, factions, sessions; Diagnostics card conditional; no My Content ownership; Run Session and Campaign Bible routing verified by tests.
- **Compendium/Library**: `renderLibrary` local filter state; `renderMyContent` owns stored content; `renderReference` 5e tab preserved; `ImportModal` and `logGeneratorHistory` stamp metadata.

---

## Known Risks

1. **`renderDMScreen` is still reachable** via direct `activeSubSection = 'dmscreen'` before the redirect fires. It is not exposed in any nav UI but could be triggered by stale persisted state. The redirect at the top of `renderCampaignCommand` handles this safely.

2. **Noble Families entity type** remains fully active in the ENTITY_SCHEMAS, ENTITY_LABELS, and item cards. It is marked as legacy in comments and uses a "Legacy Noble Families" section heading, but there is no migration path to deprecate existing data. Any future removal must provide a data migration.

3. **`saveStateQuiet` skip on navigation**: quiet save skips `renderCurrentSection`. If a hot-path interaction changes data that affects another currently-visible section, the change will not reflect until next full navigation. This is acceptable for HP, timers, and currency but should be monitored if cross-section reactive display is added.

4. **No browser-level UI tests**: All tests are static source analysis. Functional regressions in DOM interaction, modal open/close, and drag-and-drop (tile map) are not covered by the current test suite.

5. **Filter state is ephemeral**: `libFilter` and `hbFilter` are created fresh on each render. Filter selections are lost on navigation away and back. This is intentional (no persistence) but may surprise users who expect sticky filters.

---

## Deferred Work

- **Phase O (suggested)**: End-to-end Playwright browser tests for Campaign Command, Run Session, and Compendium flows.
- **Noble Families deprecation**: Migration modal to convert existing Noble Family entities to Faction or NPC sub-type, then remove the legacy entity type from ENTITY_SCHEMAS.
- **Sticky filter persistence**: Optionally persist `libFilter` to `plugin.state.ui.libraryFilter` (ephmeral, cleared on plugin reload) so filters survive in-session navigation.
- **DM Screen removal**: Once `renderDMScreen` is confirmed unused by any active vault, the function and its routing alias can be removed.
- **Reactive cross-section updates**: If Dashboard ever shows live HP or timer state, `saveStateQuiet` hot paths will need a targeted partial re-render of the affected Dashboard card rather than a full `renderCurrentSection`.

---

## Next Recommended Feature Phase

**Phase O — Player-Facing Mode & Session Share**

Player-facing mode (`state.mode === 'PLAYER'`) already exists and renders character sheet, inventory, and spellbook. The recommended next phase would:

1. Harden the player mode gate so DM-only sections (Campaign Bible, World Atlas admin, Compendium management) are fully inaccessible in PLAYER mode.
2. Add a shareable session snapshot export (JSON + optional Markdown) so players without the plugin can receive session summaries.
3. Add a `renderPartyView` screen showing all party members' HP, death saves, and spell slots in one DM-facing panel during Run Session.
4. Gate the existing `renderDMScreen` as a sub-panel of Run Session rather than a standalone section, completing its deprecation path.

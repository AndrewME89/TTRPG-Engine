# Data Model

The current plugin state is persisted through Obsidian's plugin data API.

## Top-level state areas

- `version`
- `mode`
- `activeSection`
- `sidebarCollapsed`
- `activeCampaignId`
- `search`
- `calendar`
- `settings`
- `initiativeTracker`
- `tileMap`
- `playerTab`
- `entities`
- `relationships`
- `generatorHistory`
- `diceHistory`
- `workspace`
- `sessionRunMode`
- `activeSessionId`
- `activeCharacterId`

## Intended Hierarchy

### Campaign Structure

```
Campaign → Act → Adventure → Quest → Encounter/Scene
```

- **Campaign**: The whole saga. Top-level container.
- **Act**: A major phase of the campaign (level tier or story phase). First-class entity with `campaignId`. Stored in `state.entities.acts`.
- **Adventure**: A contained story module inside an act. Has `campaignId` and optional `actId`.
- **Quest**: A specific objective inside an adventure. Has `campaignId`, `adventureId`, and optional `actId`.
- **Encounter/Scene**: A playable moment. Linked to quest/adventure/act.

Sessions are **not** children of encounters. They are play records:

```
Session → Acts advanced, Adventures run, Quests progressed,
          Encounters run, NPCs met, Locations visited,
          Secrets revealed, Loot awarded
```

### World Structure

```
Cosmology → Realm/Plane → World → Region → Settlement/Wilderness Area
  → District/Location/POI → Room/Encounter Area
```

- **Cosmology**: The outer container of all planes/realities.
- **Realm**: A major sphere of power, identity, plane, nation, divine/magical area, or mythic domain.
- **World**: The main campaign world/planet/setting.
- **Region**: A named geographic or political area within a world.
- **Settlement / Wilderness Area**: A populated place or named wild zone within a region.
- **District/Ward**: A subdivision inside a settlement.
- **Location**: A specific dungeon, ruin, building, or landmark.
- **Room**: The smallest unit — a room inside a location.
- **POI**: A point of interest attached to a region, settlement, or location.

### Political / Control Structure

```
Nation/Realm/Empire → Province/Territory → Domain/Holding → Controlled Places
```

- **Nation**: A sovereign political entity.
- **Domain**: An area of control or influence — not necessarily physical geography. May belong to a noble, faction, monster, god, curse, magical effect, etc. (see below)

### Social Structure

```
Faction / Noble Family / Religion / Culture
  → NPCs, Settlements, Regions, Quests, Secrets
```

## Entity Collections

### Phase 268 additions

- **acts** — Campaign acts (first-class). Fields: `id, campaignId, name, order, status, levelStart, levelEnd, tier, summary, goal, turningPoint, linkedAdventureIds, linkedMilestoneIds, linkedSecretIds, visibility`
- **domains** — Areas of control/influence. Fields: `id, campaignId, name, domainType, controllerType, controllerId (entityRef), parentRef (entityRef), claimedRegionIds, settlementIds, locationIds, factionIds, laws, resources, threats, summary, visibility`

Domain types: Political, Noble Holding, Divine, Magical, Monster Lair, Faction Territory, Dread Domain, Planar, Other.

### All entity collections

- campaigns
- acts *(Phase 268)*
- worlds, cosmologies, realms
- regions, settlements, districts, locations, pois, routes, dungeons, rooms
- domains *(Phase 268)*
- npcs, creatures, bbegs
- factions, nations, religions, cultures, languages, deities, pantheons
- nobleFamilies, hybridAncestries
- quests, adventures, encounters
- sessions, milestones
- secrets, handouts, reveals
- rules, conditions, damageTypes
- downtime, projects, bastions
- compendium, homebrew, tables
- characters, calendars, journals
- maps, timers, enemyTemplates
- reputations, warFronts, incursions, endgameStates
- timelines, loot

## Campaign Scoping

The `CAMPAIGN_SCOPED_ENTITIES` constant defines every entity key that belongs to a campaign. These entities:
- Should carry a `campaignId` field
- Are validated by diagnostics for missing/broken campaign links
- Are included in repair/reindex campaignId assignment
- Are filtered by activeCampaignId in relevant views

The canonical list is defined in `src/main.js` at the `CAMPAIGN_SCOPED_ENTITIES` constant.

## Entity References — How They Are Stored

### Single entity reference (one type)
```js
// Field type: 'entity', entityKey: 'regions'
settlement.regionId = 'reg-abc123'
```

### Single typed entity reference (polymorphic parent)
```js
// Field type: 'entityRef', entityTypes: ['regions','settlements','districts','locations']
location.parentRef = { entityType: 'settlements', entityId: 'set-abc123' }
```

### Multiple entity references (one type)
```js
// Field type: 'entityMulti', entityKey: 'adventures'
act.linkedAdventureIds = ['adv-abc', 'adv-def']
```

### Multiple typed entity references (polymorphic)
```js
// Field type: 'entityRefMulti', entityTypes: ['regions','settlements']
domain.locationRefs = [
  { entityType: 'regions', entityId: 'reg-abc' },
  { entityType: 'settlements', entityId: 'set-def' },
]
```

## Legacy Text Fields

Many older entity schemas stored relationships as plain text (e.g. `settlement.region = "Vale of Shadows"`). These are preserved for backwards compatibility. The new preferred fields are ID-based:

| Entity | Legacy field | Preferred field |
|---|---|---|
| settlement | `region` (text) | `regionId` (entity → regions) |
| location | `parent` (text) | `parentRef` (entityRef) |
| poi | `location` (text) | `locationRef` (entityRef) |
| route | `from` / `to` (text) | `fromRef` / `toRef` (entityRef) |
| realm | `parentPlane` (text) | `parentRef` (entityRef) |
| deity | `pantheon` (text) | `pantheonId` (entity → pantheons) |
| religion | `deity` (text) | `primaryDeityId` + `deityIds` (entity → deities) |
| nation | `capital` (text) | `capitalSettlementId` (entity → settlements) |

Repair/reindex (`repairAndReindex()`) will automatically migrate obvious single-match cases (e.g. `settlement.region` text → `regionId`) when an exact unique name match exists in the same campaign. Ambiguous cases are logged but left unchanged.

## How Acts Differ from Adventures

- **Act**: A high-level phase of the whole campaign. Usually corresponds to level tiers or major story phases. Contains multiple adventures.
- **Adventure**: A self-contained story module — usually one dungeon, one political arc, one heist, etc. Lives inside an act.

The old `campaign.bible.acts` (stored as `{ title, summary }` pairs on the campaign object) is the **legacy** act list. New acts should use the first-class `state.entities.acts` collection. Legacy bible acts are preserved and displayed on the campaign bible tab but are not linked to quests, encounters, or sessions.

## How Domains Differ from Regions/Realms

- **Region**: A geographic area — hills, forests, coastlines, plains. Neutral geography.
- **Realm**: A sphere of power or existence — a plane of existence, a magical domain, a divine sphere. Usually cosmological in scale.
- **Domain**: An area of *control or influence* — not necessarily a geographic feature. It can be a noble's holding, a god's sphere, a monster's territory, a faction's turf, a cursed land, a political jurisdiction, etc. Domains may overlap with regions or realms but are defined by who/what controls them.

## Rule

Tabs and modals should not own truth. The state layer owns truth.

# Import Format

The current import system accepts JSON and should treat unknown fields conservatively.

## Import principles

1. Never overwrite existing user data without a backup.
2. Validate shape before merging.
3. Preserve unknown fields where possible.
4. Attach imported records to the active campaign when appropriate.
5. Stamp missing IDs and timestamps during migration/repair.

## Minimum campaign import shape

```json
{
  "campaigns": [],
  "acts": [],
  "worlds": [],
  "regions": [],
  "settlements": [],
  "locations": [],
  "domains": [],
  "npcs": [],
  "factions": [],
  "quests": [],
  "adventures": [],
  "encounters": [],
  "sessions": [],
  "secrets": [],
  "handouts": []
}
```

The plugin may also import a full backup wrapper containing:

```json
{
  "version": "2.1.0",
  "timestamp": "...",
  "entityCounts": {},
  "state": {}
}
```

## Campaign-scoped entities

When importing, all entities in `CAMPAIGN_SCOPED_ENTITIES` should have a `campaignId` field. If missing, repair/reindex will attempt to assign from `activeCampaignId`.

## Entity reference fields

Entity references in imported data follow one of two forms:

**Single ID reference:**
```json
{ "regionId": "reg-abc123" }
```

**Typed reference (polymorphic):**
```json
{ "parentRef": { "entityType": "settlements", "entityId": "set-abc123" } }
```

**Multiple typed references:**
```json
{ "locationRefs": [
  { "entityType": "regions", "entityId": "reg-abc" },
  { "entityType": "settlements", "entityId": "set-def" }
]}
```

## Legacy text fields

Imports may include legacy text fields (e.g. `settlement.region = "Vale of Shadows"`). These are preserved. Repair/reindex will attempt safe automatic migration to ID fields where a unique name match exists. See `DATA_MODEL.md` for the full mapping table.

## Act import shape

```json
{
  "id": "act-abc123",
  "campaignId": "camp-...",
  "name": "The Dark Rising",
  "order": 1,
  "status": "Active",
  "levelStart": 1,
  "levelEnd": 4,
  "tier": "Tier 1 (1-4)",
  "summary": "...",
  "goal": "...",
  "turningPoint": "...",
  "linkedAdventureIds": [],
  "linkedMilestoneIds": [],
  "linkedSecretIds": [],
  "visibility": "dm-only",
  "createdAt": "...",
  "updatedAt": "..."
}
```

## Domain import shape

```json
{
  "id": "dom-abc123",
  "campaignId": "camp-...",
  "name": "The Iron March",
  "domainType": "Political",
  "controllerType": "Faction",
  "controllerId": { "entityType": "factions", "entityId": "fac-..." },
  "parentRef": { "entityType": "regions", "entityId": "reg-..." },
  "claimedRegionIds": [],
  "settlementIds": [],
  "locationIds": [],
  "factionIds": [],
  "laws": "...",
  "resources": "...",
  "threats": "...",
  "summary": "...",
  "visibility": "dm-only",
  "createdAt": "...",
  "updatedAt": "..."
}
```

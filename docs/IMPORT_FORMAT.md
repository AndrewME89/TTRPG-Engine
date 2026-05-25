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
  "worlds": [],
  "regions": [],
  "settlements": [],
  "locations": [],
  "npcs": [],
  "factions": [],
  "quests": [],
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

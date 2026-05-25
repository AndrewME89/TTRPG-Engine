# Testing Checklist

Run this before every release.

## Static checks

```bash
npm ci
npm run check
npm run build
npm run package
```

## Manual Obsidian checks

1. Copy the packaged plugin into a clean test vault.
2. Enable Community Plugins.
3. Enable TTRPG Engine.
4. Confirm the castle ribbon opens the plugin.
5. Confirm Dashboard renders.
6. Confirm Campaigns tab renders.
7. Create a campaign.
8. Set it active.
9. Create one NPC, one quest, one encounter, one session, and one secret.
10. Reload Obsidian.
11. Confirm saved content still appears.
12. Use Backup Data.
13. Use Repair / Reindex Data.
14. Open Diagnostics.
15. Enable Safe Mode.
16. Restart Obsidian and confirm safe behaviour.
17. Disable Safe Mode.
18. Confirm Tile Map Builder opens.
19. Place, move, resize, delete, and save a tile.
20. Confirm no legacy SVG random map generator UI appears.

## Regression focus

- No blank screen.
- No disappearing tabs.
- No duplicate command registration.
- No old SVG map generator controls.
- No saved data loss after reload.
- No search-bar focus loss in tile palette.

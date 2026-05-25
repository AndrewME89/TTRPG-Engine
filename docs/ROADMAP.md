# Roadmap

## Current baseline

Version **2.1.0** is preserved as a working JavaScript monolith. The clean repo goal is stability first, modularity second.

## Immediate priorities

1. Keep the current plugin loading reliably.
2. Preserve state migrations, backups, diagnostics, safe mode, and crash-lock behaviour.
3. Keep the Tile Map Builder as the only map-building system.
4. Improve module boundaries without deleting working functionality.
5. Move feature groups out of `src/main.js` only after tests/checks exist for that group.

## Suggested phase order

### Phase A — Repo hardening

- Confirm release ZIP installs cleanly.
- Confirm `npm run build` and `npm run package` work.
- Confirm safe-mode files are documented.
- Confirm no old random SVG map generator commands exist.

### Phase B — State extraction

Move state constants, default state, migrations, backup, diagnostics, and repair into `src/state/`.

### Phase C — UI shell extraction

Move the main view, top bar, sidebar, page headers, cards, buttons, chips, and empty states into `src/ui/`.

### Phase D — Tab extraction

Move each render function into `src/tabs/`.

### Phase E — Modal extraction

Move modal classes and field helpers into `src/modals/`.

### Phase F — Tile map extraction

Move tile assets, tile canvas, palette, map saving, PNG export, and map diagnostics into `src/maps/`.

### Phase G — TypeScript conversion

Only convert after the plugin is modular and covered by checks.

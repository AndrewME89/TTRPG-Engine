# TTRPG Engine — Tile Map Assets

This folder holds image tiles used by the Tile Map Builder.

## Quick Start

Drop your images into the appropriate category subfolder. The builder scans
this folder automatically when the Geography section opens and when you click
**🔄 Reload Assets**.

Supported formats: `.png` `.jpg` `.jpeg` `.webp` `.gif` `.svg`

## Folder Structure

```
tile-map/
  terrain/      outdoor ground tiles — grass, dirt, stone, snow, sand
  buildings/    walls, floors, roofs, structures, exteriors
  interiors/    room floors, dungeon stone, tavern wood, carpets
  dungeons/     dungeon-specific tiles — pits, lava, traps, doors
  props/        furniture, barrels, crates, chests, tables, beds
  tokens/       creature and NPC tokens (round or square)
  vegetation/   trees, bushes, vines, crops, fungi
  roads/        paths, cobblestones, bridges, rivers
  water/        sea, lakes, rivers, waterfalls, ice
```

You can create additional subdirectories — anything goes. The folder name
becomes the tile **category** shown in the palette category filter.

## Naming Conventions

The tile's **display name** is derived from the filename by:
- Removing the file extension
- Replacing underscores and hyphens with spaces
- Stripping dimension suffixes like `2x3` (used for footprint)
- Title-casing the result

Examples:
- `stone_floor_2x2.png` → **Stone Floor** (2×2 cells)
- `oak-tree.webp`       → **Oak Tree** (1×1 cell)
- `goblin-token.png`    → **Goblin Token** (1×1 cell)

## Footprint (Tile Size in Grid Cells)

The scanner reads dimension hints from the filename (`WxH`, e.g. `door_1x2.png`
→ 1 cell wide, 2 cells tall). If no dimension is given, the tile kind is
inferred from the filename and a sensible default is applied:

| Kind        | Default footprint |
|-------------|-------------------|
| background  | 8 × 8             |
| room        | 4 × 4             |
| corridor    | 3 × 1             |
| wall        | 2 × 1             |
| terrain     | 2 × 2             |
| furniture   | 2 × 1             |
| everything else | 1 × 1         |

You can always resize any placed tile using the **W/H** controls in the
inspector, or drag the resize handle.

## Tips

- Transparent PNGs work best — the builder renders them with `object-fit:
  contain` so transparency is preserved.
- Keep tiles square or power-of-two where possible for crisp rendering.
- Token images look best at 1×1 (one grid square).
- Aim for consistent resolution within each category (e.g. 256×256 px per
  grid cell) to avoid blurry up-scaling.
- Files are loaded lazily in the palette — large libraries (500+ tiles)
  work fine.

## Missing Assets

If a placed tile's image file is moved or deleted, it shows a ⚠️ warning on
the canvas. The Diagnostics report (`🔧 Diagnostics` button) lists the count
of broken tile paths so you can track them down.

## Licensing

Only add images you have the right to use. Free sources for battle-map tiles:

- **2-Minute Tabletop** — free assets at 2minutetabletop.com (CC attribution)
- **Forgotten Adventures** — patreon.com/forgottenadventures (free tier available)
- **Dungeon Scrawl** — dungeon-scrawl.com (CC0 export)
- Your own artwork or commissioned tiles

The TTRPG Engine plugin does not ship with any tile images. You provide your
own. Ensure any assets you distribute with a vault comply with their licence.

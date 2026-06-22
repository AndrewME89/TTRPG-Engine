'use strict';
/**
 * Tile Map Builder — pure-function unit tests.
 * Run with: node tests/tile-map.test.js
 * No test framework needed — uses Node's built-in assert.
 */
const assert = require('node:assert/strict');

// ── Extract testable functions from main.js ────────────────────────────────────
// We re-implement the pure helpers inline (same logic as main.js) so we don't
// need to load the whole plugin (which requires Obsidian globals).

function prettifyAssetName(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
    .replace(/\b\d+x\d+\b/gi, '').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Unnamed Tile';
}

function inferTileKind(path) {
  const p = String(path || '').toLowerCase();
  if (p.includes('background') || p.includes('base') || p.includes('floor')) return 'background';
  if (p.includes('wall')) return 'wall';
  if (p.includes('door')) return 'door';
  if (p.includes('room')) return 'room';
  if (p.includes('corridor') || p.includes('hall')) return 'corridor';
  if (p.includes('furniture') || p.includes('table') || p.includes('chair') || p.includes('bed')) return 'furniture';
  if (p.includes('prop') || p.includes('crate') || p.includes('barrel') || p.includes('clutter')) return 'prop';
  if (p.includes('token') || p.includes('creature') || p.includes('npc')) return 'token';
  if (p.includes('terrain') || p.includes('forest') || p.includes('mountain') || p.includes('water')) return 'terrain';
  return 'tile';
}

function inferTileFootprint(path) {
  const p = String(path || '').toLowerCase();
  const explicit = p.match(/(?:^|[^0-9])(\d{1,2})x(\d{1,2})(?:[^0-9]|$)/);
  if (explicit) return { widthCells: Math.max(1, Math.min(20, Number(explicit[1]))), heightCells: Math.max(1, Math.min(20, Number(explicit[2]))) };
  const kind = inferTileKind(p);
  if (kind === 'background') return { widthCells: 8, heightCells: 8 };
  if (kind === 'room')       return { widthCells: 4, heightCells: 4 };
  if (kind === 'corridor')   return { widthCells: 3, heightCells: 1 };
  if (kind === 'wall')       return { widthCells: 2, heightCells: 1 };
  if (kind === 'terrain')    return { widthCells: 2, heightCells: 2 };
  if (kind === 'furniture')  return { widthCells: 2, heightCells: 1 };
  return { widthCells: 1, heightCells: 1 };
}

function assetMatches(asset, query, category) {
  const q = String(query || '').toLowerCase();
  const haystack = [asset.label, asset.filename, asset.category, asset.kind, ...(asset.tags || [])].join(' ').toLowerCase();
  return (!q || haystack.includes(q)) && (!category || category === 'All' || asset.category === category);
}

// Minimal migrateState for tileMap-specific migration (excerpted from main.js logic)
function migrateTileMap(state) {
  const TILE_ASSET_ROOT = '.obsidian/plugins/ttrpg-engine/assets';
  if (!state.tileMap || typeof state.tileMap !== 'object') {
    state.tileMap = { tiles: [], nextId: 1, mapName: 'Untitled Map', gridSize: 60, width: 1800, height: 1200, assetRoot: TILE_ASSET_ROOT, selectedMapId: '', mapId: '', distanceScale: '5 ft', linkedRegionId: '', linkedSettlementId: '', linkedLocationId: '', linkedDungeonId: '', linkedPoiId: '', linkedEncounterId: '', linkedSessionId: '' };
  }
  if (!Array.isArray(state.tileMap.tiles))   state.tileMap.tiles = [];
  if (!state.tileMap.nextId)                 state.tileMap.nextId = 1;
  if (!state.tileMap.gridSize)               state.tileMap.gridSize = 60;
  if (!state.tileMap.width)                  state.tileMap.width   = 1800;
  if (!state.tileMap.height)                 state.tileMap.height  = 1200;
  if (!state.tileMap.assetRoot)              state.tileMap.assetRoot = TILE_ASSET_ROOT;
  if (!('mapId' in state.tileMap))           state.tileMap.mapId = '';
  if (!state.tileMap.distanceScale)          state.tileMap.distanceScale = '5 ft';
  if (!('linkedRegionId' in state.tileMap))  state.tileMap.linkedRegionId = '';
  if (!('linkedSettlementId' in state.tileMap)) state.tileMap.linkedSettlementId = '';
  if (!('linkedLocationId' in state.tileMap))   state.tileMap.linkedLocationId = '';
  if (!('linkedDungeonId' in state.tileMap))    state.tileMap.linkedDungeonId = '';
  if (!('linkedPoiId' in state.tileMap))        state.tileMap.linkedPoiId = '';
  if (!('linkedEncounterId' in state.tileMap))  state.tileMap.linkedEncounterId = '';
  if (!('linkedSessionId' in state.tileMap))    state.tileMap.linkedSessionId = '';
  // Migrate legacy tiles
  state.tileMap.tiles.forEach(tile => {
    if (!tile.assetId && tile.type) tile.assetId = tile.type;
    if (!tile.widthCells)  tile.widthCells  = Math.max(1, Math.round((tile.w || state.tileMap.gridSize) / state.tileMap.gridSize));
    if (!tile.heightCells) tile.heightCells = Math.max(1, Math.round((tile.h || state.tileMap.gridSize) / state.tileMap.gridSize));
    if (!('layer'    in tile)) tile.layer    = 0;
    if (!('rotation' in tile)) tile.rotation = 0;
  });
}

// ── Test runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (e) { console.error(`  ✗  ${name}\n     ${e.message}`); failed++; }
}

// ── prettifyAssetName ──────────────────────────────────────────────────────────
console.log('\nprettifyAssetName');
test('strips extension',           () => assert.equal(prettifyAssetName('grass.png'), 'Grass'));
test('replaces underscores',       () => assert.equal(prettifyAssetName('stone_floor.png'), 'Stone Floor'));
test('replaces hyphens',           () => assert.equal(prettifyAssetName('oak-tree.webp'), 'Oak Tree'));
test('strips WxH dimension hint',  () => assert.equal(prettifyAssetName('room_4x4.png'), 'Room'));
test('strips dimension mid-name',  () => assert.equal(prettifyAssetName('dungeon_wall_2x1.png'), 'Dungeon Wall'));
test('title-cases result',         () => assert.equal(prettifyAssetName('wooden_door.jpg'), 'Wooden Door'));
test('empty string → Unnamed Tile',() => assert.equal(prettifyAssetName(''), 'Unnamed Tile'));
test('null → Unnamed Tile',        () => assert.equal(prettifyAssetName(null), 'Unnamed Tile'));

// ── inferTileKind ──────────────────────────────────────────────────────────────
console.log('\ninferTileKind');
test('floor → background', () => assert.equal(inferTileKind('stone_floor.png'), 'background'));
test('background → background', () => assert.equal(inferTileKind('background_grass.png'), 'background'));
test('wall → wall',        () => assert.equal(inferTileKind('dungeon_wall_2x1.png'), 'wall'));
test('door → door',        () => assert.equal(inferTileKind('wooden_door.png'), 'door'));
test('room → room',        () => assert.equal(inferTileKind('chamber_room.png'), 'room'));
test('corridor → corridor',() => assert.equal(inferTileKind('long_corridor.png'), 'corridor'));
test('hall → corridor',    () => assert.equal(inferTileKind('great_hall.png'), 'corridor'));
test('token → token',      () => assert.equal(inferTileKind('goblin-token.png'), 'token'));
test('creature → token',   () => assert.equal(inferTileKind('creature_orc.png'), 'token'));
test('terrain → terrain',  () => assert.equal(inferTileKind('forest_terrain.png'), 'terrain'));
test('mountain → terrain', () => assert.equal(inferTileKind('mountain_peak.png'), 'terrain'));
test('barrel → prop',      () => assert.equal(inferTileKind('wooden_barrel.png'), 'prop'));
test('table → furniture',  () => assert.equal(inferTileKind('tavern_table.png'), 'furniture'));
test('unknown → tile',     () => assert.equal(inferTileKind('mysterious_thing.png'), 'tile'));

// ── inferTileFootprint ─────────────────────────────────────────────────────────
console.log('\ninferTileFootprint');
test('explicit 2x3',         () => assert.deepEqual(inferTileFootprint('door_2x3.png'), { widthCells: 2, heightCells: 3 }));
test('explicit 4x4',         () => assert.deepEqual(inferTileFootprint('room_4x4.png'), { widthCells: 4, heightCells: 4 }));
test('explicit 1x1',         () => assert.deepEqual(inferTileFootprint('token_1x1.png'), { widthCells: 1, heightCells: 1 }));
test('clamps at max 20x20',  () => assert.deepEqual(inferTileFootprint('huge_99x99.png'), { widthCells: 20, heightCells: 20 }));
test('floor → 8x8 (background)', () => assert.deepEqual(inferTileFootprint('stone_floor.png'), { widthCells: 8, heightCells: 8 }));
test('room → 4x4',           () => assert.deepEqual(inferTileFootprint('chamber_room.png'), { widthCells: 4, heightCells: 4 }));
test('corridor → 3x1',       () => assert.deepEqual(inferTileFootprint('long_corridor.png'), { widthCells: 3, heightCells: 1 }));
test('wall → 2x1',           () => assert.deepEqual(inferTileFootprint('dungeon_wall.png'), { widthCells: 2, heightCells: 1 }));
test('terrain → 2x2',        () => assert.deepEqual(inferTileFootprint('forest_terrain.png'), { widthCells: 2, heightCells: 2 }));
test('furniture → 2x1',      () => assert.deepEqual(inferTileFootprint('tavern_table.png'), { widthCells: 2, heightCells: 1 }));
test('token → 1x1',          () => assert.deepEqual(inferTileFootprint('goblin-token.png'), { widthCells: 1, heightCells: 1 }));
test('unknown → 1x1',        () => assert.deepEqual(inferTileFootprint('thing.png'), { widthCells: 1, heightCells: 1 }));

// ── assetMatches ───────────────────────────────────────────────────────────────
console.log('\nassetMatches');
const sampleAsset = { label: 'Oak Tree', filename: 'oak-tree.webp', category: 'vegetation', kind: 'terrain', tags: ['tree', 'forest'] };
test('no query / no category → matches all', () => assert.ok(assetMatches(sampleAsset, '', '')));
test('matching label query',    () => assert.ok(assetMatches(sampleAsset, 'oak', '')));
test('matching tag query',      () => assert.ok(assetMatches(sampleAsset, 'forest', '')));
test('matching category query', () => assert.ok(assetMatches(sampleAsset, 'vegetation', '')));
test('non-matching query',      () => assert.ok(!assetMatches(sampleAsset, 'dragon', '')));
test('matching category filter', () => assert.ok(assetMatches(sampleAsset, '', 'vegetation')));
test('category filter = All',   () => assert.ok(assetMatches(sampleAsset, '', 'All')));
test('wrong category filter',   () => assert.ok(!assetMatches(sampleAsset, '', 'tokens')));
test('query + matching category', () => assert.ok(assetMatches(sampleAsset, 'tree', 'vegetation')));
test('query + wrong category',  () => assert.ok(!assetMatches(sampleAsset, 'tree', 'tokens')));

// ── tileMap state migration ────────────────────────────────────────────────────
console.log('\ntileMap state migration');
test('creates tileMap from scratch when missing', () => {
  const state = {};
  migrateTileMap(state);
  assert.ok(state.tileMap, 'tileMap missing');
  assert.equal(state.tileMap.gridSize, 60);
  assert.equal(state.tileMap.width, 1800);
  assert.equal(state.tileMap.distanceScale, '5 ft');
  assert.equal(state.tileMap.linkedRegionId, '');
  assert.equal(state.tileMap.linkedSessionId, '');
});

test('preserves existing tileMap values', () => {
  const state = { tileMap: { gridSize: 40, width: 2400, height: 1600, tiles: [], nextId: 5, mapName: 'Test' } };
  migrateTileMap(state);
  assert.equal(state.tileMap.gridSize, 40);
  assert.equal(state.tileMap.width, 2400);
  assert.equal(state.tileMap.mapName, 'Test');
  assert.equal(state.tileMap.nextId, 5);
});

test('migrates legacy tile type→assetId', () => {
  const state = { tileMap: { tiles: [{ id: 1, type: 'grass', x: 0, y: 0, w: 60, h: 60 }], gridSize: 60 } };
  migrateTileMap(state);
  assert.equal(state.tileMap.tiles[0].assetId, 'grass');
});

test('stamps missing layer/rotation on legacy tiles', () => {
  const state = { tileMap: { tiles: [{ id: 1, type: 'wall', assetId: 'wall', x: 0, y: 0, w: 120, h: 60 }], gridSize: 60 } };
  migrateTileMap(state);
  assert.equal(state.tileMap.tiles[0].layer, 0);
  assert.equal(state.tileMap.tiles[0].rotation, 0);
});

test('infers widthCells/heightCells from w/h when missing', () => {
  const state = { tileMap: { tiles: [{ id: 1, type: 'room', assetId: 'room', x: 0, y: 0, w: 240, h: 240 }], gridSize: 60 } };
  migrateTileMap(state);
  assert.equal(state.tileMap.tiles[0].widthCells, 4);
  assert.equal(state.tileMap.tiles[0].heightCells, 4);
});

// ── missing-asset detection logic ─────────────────────────────────────────────
console.log('\nmissing-asset detection');
test('tile with assetPath not in live assets is detected as missing', () => {
  const livePaths = new Set(['.obsidian/plugins/ttrpg-engine/assets/terrain/grass.png']);
  const tile = { assetPath: '.obsidian/plugins/ttrpg-engine/assets/terrain/missing.png', assetId: 'some-id' };
  const isMissing = tile.assetPath && !livePaths.has(tile.assetPath);
  assert.ok(isMissing);
});

test('tile with valid assetPath is not detected as missing', () => {
  const livePaths = new Set(['.obsidian/plugins/ttrpg-engine/assets/terrain/grass.png']);
  const tile = { assetPath: '.obsidian/plugins/ttrpg-engine/assets/terrain/grass.png', assetId: 'some-id' };
  const isMissing = tile.assetPath && !livePaths.has(tile.assetPath);
  assert.ok(!isMissing);
});

test('emoji-only tile (no assetPath) is not detected as missing', () => {
  const livePaths = new Set([]);
  const tile = { type: 'grass', icon: '🌿', assetId: 'grass' };
  const isMissing = (tile.assetPath || (tile.assetId && tile.assetId !== tile.type)) && !livePaths.has(tile.assetPath);
  assert.ok(!isMissing);
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

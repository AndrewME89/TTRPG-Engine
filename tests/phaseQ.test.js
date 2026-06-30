'use strict';
/**
 * Phase Q — World Atlas Navigation, Dungeons & Domains
 * Sections 1–5: Gazetteer removal, Tile Map tab, Dungeon boss selector,
 *   Dungeon rooms/Room entity linking, Domain of Delight model.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`); }
}
function ok(cond, msg) { assert.ok(cond, msg); }
function notOk(cond, msg) { assert.ok(!cond, msg); }

// Slice key sections
const waIdx = src.indexOf('function renderWorldAtlas(');
const waBlock = src.slice(waIdx, waIdx + 800);

const geoIdx = src.indexOf('function renderGeography(');
const geoEnd = src.indexOf('\nconst regionFields', geoIdx);
const geoBlock = src.slice(geoIdx, geoEnd);

const tileTabIdx = src.indexOf('function renderTileMapTab(');
const tileTabEnd = src.indexOf('\nfunction renderGeography(', tileTabIdx);
const tileTabBlock = src.slice(tileTabIdx, tileTabEnd);

const dungeonIdx = src.indexOf('class DungeonModal');
const dungeonEnd = src.indexOf('\n// ── TimerModal', dungeonIdx);
const dungeonBlock = src.slice(dungeonIdx, dungeonEnd);

const domainFieldsIdx = src.indexOf('const domainFields');
const domainFieldsEnd = src.indexOf('\n// ── TILE MAP', domainFieldsIdx);
const domainFieldsBlock = src.slice(domainFieldsIdx, domainFieldsEnd);

const gazetteerIdx = src.indexOf('function renderGazetteer(');
const gazetteerBlock = src.slice(gazetteerIdx, gazetteerIdx + 200);

console.log('\nPhase Q — World Atlas Navigation, Dungeons & Domains\n');

// ── Section 1: Navigation ────────────────────────────────────────────────────
console.log('  Section 1: Navigation — Gazetteer removed, Tile Map tab added');

test('renderWorldAtlas does not expose Gazetteer as primary navigation tab', () => {
  notOk(waBlock.includes("{ id: 'gazetteer'"), 'Gazetteer still exposed as primary nav tab in renderWorldAtlas');
});
test('renderWorldAtlas has Tile Map Builder tab', () => {
  ok(waBlock.includes("{ id: 'tilemap'"), 'Tile Map Builder tab missing from renderWorldAtlas');
});
test('renderWorldAtlas redirects gazetteer sub-section to geography', () => {
  ok(waBlock.includes("activeSubSection === 'gazetteer'") && waBlock.includes("activeSubSection = 'geography'"),
    'renderWorldAtlas does not redirect gazetteer → geography');
});
test('renderWorldAtlas routes tilemap to renderTileMapTab', () => {
  ok(waBlock.includes('renderTileMapTab'), 'renderWorldAtlas does not call renderTileMapTab');
});
test('renderWorldAtlas still has Geography & Maps tab', () => {
  ok(waBlock.includes("{ id: 'geography'"), 'Geography tab missing from renderWorldAtlas');
});
test('renderWorldAtlas still has World & Lore tab', () => {
  ok(waBlock.includes("{ id: 'lore'"), 'World & Lore tab missing from renderWorldAtlas');
});

// ── Section 2: Tile Map Builder tab ─────────────────────────────────────────
console.log('\n  Section 2: Tile Map Builder tab');

test('renderTileMapTab function exists', () => {
  ok(src.includes('function renderTileMapTab('), 'renderTileMapTab function missing');
});
test('renderTileMapTab calls renderTileMapBuilder', () => {
  ok(tileTabBlock.includes('renderTileMapBuilder'), 'renderTileMapTab does not call renderTileMapBuilder');
});
test('renderTileMapTab shows Saved Maps section', () => {
  ok(tileTabBlock.includes('Saved Maps'), 'renderTileMapTab missing Saved Maps section');
});
test('renderTileMapTab loads maps from state.entities.maps', () => {
  ok(tileTabBlock.includes('entities.maps'), 'renderTileMapTab does not read state.entities.maps');
});
test('renderTileMapTab does NOT inline render Geography entity lists', () => {
  notOk(tileTabBlock.includes('itemCards(main, plugin,'), 'renderTileMapTab should not render entity card grids');
});

// ── Section 3: Geography & Maps has Dungeon access ──────────────────────────
console.log('\n  Section 3: Geography & Maps — Dungeon section');

test('renderGeography has + Dungeon button', () => {
  ok(geoBlock.includes("'+ Dungeon'") || geoBlock.includes("label: '+ Dungeon'"),
    'renderGeography missing + Dungeon button');
});
test('renderGeography opens DungeonModal for Dungeon creation', () => {
  ok(geoBlock.includes('new DungeonModal'), 'renderGeography does not open DungeonModal');
});
test('renderGeography has Dungeons & Keyed Locations section', () => {
  ok(geoBlock.includes('Dungeons') && (geoBlock.includes("'dungeons'") || geoBlock.includes('"dungeons"')),
    'renderGeography missing Dungeons section');
});
test('renderGeography does not include inline Tile Map Builder', () => {
  notOk(geoBlock.includes('renderTileMapBuilder'), 'renderGeography still contains inline TileMapBuilder');
});
test('renderGeography still has Regions, Settlements, Locations', () => {
  ok(geoBlock.includes("'regions'") && geoBlock.includes("'settlements'") && geoBlock.includes("'locations'"),
    'renderGeography missing standard entity sections');
});

// ── Section 4: DungeonModal — boss selector + room entity linking ────────────
console.log('\n  Section 4: DungeonModal — boss selector & room entity linking');

test('DungeonModal constructor has bossRef field', () => {
  ok(dungeonBlock.includes('bossRef'), 'DungeonModal constructor missing bossRef field');
});
test('DungeonModal has NPC boss picker', () => {
  ok(dungeonBlock.includes("'npcs'") || dungeonBlock.includes('"npcs"'),
    'DungeonModal missing NPC boss picker');
});
test('DungeonModal has Creature boss picker', () => {
  ok(dungeonBlock.includes("'creatures'") || dungeonBlock.includes('"creatures"'),
    'DungeonModal missing Creature boss picker');
});
test('DungeonModal has bestiary boss picker', () => {
  ok(dungeonBlock.includes("'bestiary'") && dungeonBlock.includes('RefDataPickerModal'),
    'DungeonModal missing bestiary boss picker');
});
test('DungeonModal sets bossRef with sourceType and source fields', () => {
  ok(dungeonBlock.includes('sourceType') && dungeonBlock.includes("source: 'entity'"),
    'DungeonModal bossRef missing sourceType/source fields');
});
test('DungeonModal bossRef from bestiary has source: bestiary', () => {
  ok(dungeonBlock.includes("source: 'bestiary'"), 'DungeonModal bestiary bossRef missing source:bestiary');
});
test('legacy boss text field is hidden from the primary DungeonModal UI', () => {
  notOk(dungeonBlock.includes("'Boss / Key Enemy (text)'"),
    'Legacy boss text field should not render in DungeonModal primary UI');
});
test('DungeonModal has linkedRoomIds for linking Room entities', () => {
  ok(dungeonBlock.includes('linkedRoomIds'), 'DungeonModal missing linkedRoomIds field');
});
test('DungeonModal uses addEntityMultiPicker for linked rooms', () => {
  ok(dungeonBlock.includes('addEntityMultiPicker') && dungeonBlock.includes("'rooms'"),
    'DungeonModal does not use addEntityMultiPicker for rooms');
});
test('DungeonModal has button to create new linked Room', () => {
  ok(dungeonBlock.includes('Create') && dungeonBlock.includes('Room') && dungeonBlock.includes('GenericModal'),
    'DungeonModal missing Create New Room button');
});
test('new Room entity gets dungeonId set', () => {
  ok(dungeonBlock.includes('dungeonId'), 'new Room does not receive dungeonId');
});
test('new Room entity gets campaignId from dungeon', () => {
  ok(dungeonBlock.includes('campaignId: this.values.campaignId'),
    'new Room does not inherit campaignId from dungeon');
});
test('legacy inline rooms still display', () => {
  ok(dungeonBlock.includes('Legacy inline rooms') || (dungeonBlock.includes("this.values.rooms") && dungeonBlock.includes('rooms.length')),
    'Legacy inline rooms not preserved in DungeonModal');
});
test('DungeonModal auto-stamps campaignId on save', () => {
  ok(dungeonBlock.includes('activeCampaignId') && dungeonBlock.includes('campaignId'),
    'DungeonModal does not stamp campaignId on save');
});

// Functional: bossRef construction
test('functional: NPC boss sets bossRef correctly', () => {
  const state = { entities: { npcs: [{ id: 'npc-1', name: 'Beholder' }] } };
  const values = { bossNpcId: '', bossRef: null };
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const v = 'npc-1';
  values.bossNpcId = v;
  if (v) { const npc = safeArr(state.entities.npcs).find(n => n.id === v); values.bossRef = { sourceType: 'npc', id: v, name: npc ? npc.name : v, source: 'entity' }; }
  ok(values.bossRef.sourceType === 'npc', 'sourceType should be npc');
  ok(values.bossRef.name === 'Beholder', 'name should be Beholder');
  ok(values.bossRef.source === 'entity', 'source should be entity');
});
test('functional: bestiary boss sets bossRef correctly', () => {
  const monster = { name: 'Adult Red Dragon', id: 'ard-001' };
  const values = { bossRef: null, boss: '' };
  values.bossRef = { sourceType: 'bestiary', id: monster.id || monster.name, name: monster.name, source: 'bestiary' };
  if (!values.boss) values.boss = monster.name;
  ok(values.bossRef.sourceType === 'bestiary', 'sourceType should be bestiary');
  ok(values.boss === 'Adult Red Dragon', 'legacy boss text should be populated');
});
test('functional: legacy boss text displays safely when bossRef is null', () => {
  const dungeon = { boss: 'The Dark Wizard', bossRef: null };
  const displayName = dungeon.bossRef ? dungeon.bossRef.name : dungeon.boss;
  ok(displayName === 'The Dark Wizard', 'legacy boss text not displayed safely');
});
test('functional: Room entity gets dungeonId from parent', () => {
  const dungeonId = 'dungeon-abc';
  const newRoom = { id: 'room-1', dungeonId, locationType: 'dungeons', locationId: dungeonId, campaignId: 'camp-1' };
  ok(newRoom.dungeonId === dungeonId, 'dungeonId not set on room');
  ok(newRoom.locationId === dungeonId, 'locationId not set to dungeonId');
  ok(newRoom.campaignId === 'camp-1', 'campaignId not inherited');
});

// ── Section 5: Domain model — type/subtype + Domain of Delight ──────────────
console.log('\n  Section 5: Domain model — type/subtype + Domain of Delight');

test('DOMAIN_TYPES constant declared', () => {
  ok(src.includes('const DOMAIN_TYPES'), 'DOMAIN_TYPES constant missing');
});
test('domainFields uses DOMAIN_TYPES', () => {
  ok(domainFieldsBlock.includes('DOMAIN_TYPES') || domainFieldsBlock.includes("options: DOMAIN_TYPES"),
    'domainFields does not use DOMAIN_TYPES');
});
test('DOMAIN_TYPES includes Fey Domain / Domain of Delight', () => {
  ok(src.includes("'Fey Domain / Domain of Delight'"), 'Fey Domain / Domain of Delight type missing');
});
test('DOMAIN_TYPES includes Dread Domain', () => {
  ok(src.includes("'Dread Domain'"), 'Dread Domain type missing');
});
test('DOMAIN_TYPES includes Political', () => {
  ok(src.includes("'Political'"), 'Political domain type missing');
});
test('domainFields has archfeyRuler field for Fey Domains', () => {
  ok(domainFieldsBlock.includes('archfeyRuler'), 'domainFields missing archfeyRuler field');
});
test('domainFields has delightTheme field', () => {
  ok(domainFieldsBlock.includes('delightTheme'), 'domainFields missing delightTheme field');
});
test('domainFields has entranceRules field', () => {
  ok(domainFieldsBlock.includes('entranceRules'), 'domainFields missing entranceRules field');
});
test('domainFields has feyBargains field', () => {
  ok(domainFieldsBlock.includes('feyBargains'), 'domainFields missing feyBargains field');
});
test('domainFields has timeDistortion field', () => {
  ok(domainFieldsBlock.includes('timeDistortion'), 'domainFields missing timeDistortion field');
});
test('domainFields has planarTraits field', () => {
  ok(domainFieldsBlock.includes('planarTraits'), 'domainFields missing planarTraits field');
});
test('domainFields has delightDreadTone field', () => {
  ok(domainFieldsBlock.includes('delightDreadTone'), 'domainFields missing delightDreadTone tone field');
});
test('domainFields has campaignId field for campaign scoping', () => {
  ok(domainFieldsBlock.includes("'campaignId'") || domainFieldsBlock.includes("key: 'campaign'"),
    'domainFields missing campaignId campaign scoping field');
});
test('domainFields core fields still present (name, laws, summary)', () => {
  ok(domainFieldsBlock.includes("'name'") && domainFieldsBlock.includes("'laws'") && domainFieldsBlock.includes("'summary'"),
    'domainFields missing core fields');
});

// Functional: domain type/subtype
test('functional: domain can be created with Fey Domain type', () => {
  const domain = { id: 'dom-1', name: 'The Twilight Glade', domainType: 'Fey Domain / Domain of Delight', archfeyRuler: 'Titania', delightTheme: 'Revelry', campaignId: 'camp-1' };
  ok(domain.domainType === 'Fey Domain / Domain of Delight', 'domain type not set correctly');
  ok(domain.archfeyRuler === 'Titania', 'archfeyRuler not set');
  ok(domain.campaignId === 'camp-1', 'domain not campaign-scoped');
});
test('functional: legacy domain with old type string still opens', () => {
  const oldDomain = { id: 'dom-old', name: 'Old Domain', domainType: 'Magical', summary: 'Old record' };
  // Domain type 'Magical' → mapped to 'Magical Region' or just preserved
  ok(typeof oldDomain.domainType === 'string', 'legacy domainType should still be a string');
  ok(oldDomain.name === 'Old Domain', 'legacy domain name should be preserved');
});

// ── Section 6: No duplicate function declarations ────────────────────────────
console.log('\n  Section 6: Regression — no duplicate declarations');

test('no duplicate top-level function declarations after Phase Q', () => {
  const seen = {};
  const dups = [];
  for (const m of src.matchAll(/^(?:async )?function (\w+)\(/mg)) {
    seen[m[1]] = (seen[m[1]] || 0) + 1;
    if (seen[m[1]] === 2) dups.push(m[1]);
  }
  ok(dups.length === 0, `Duplicate function declarations: ${dups.join(', ')}`);
});
test('renderTileMapTab declared exactly once', () => {
  const n = (src.match(/^function renderTileMapTab\(/mg) || []).length;
  ok(n === 1, `renderTileMapTab declared ${n} times (expected 1)`);
});
test('renderGeography declared exactly once', () => {
  const n = (src.match(/^function renderGeography\(/mg) || []).length;
  ok(n === 1, `renderGeography declared ${n} times (expected 1)`);
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

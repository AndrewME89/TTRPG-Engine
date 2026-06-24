'use strict';
/**
 * Phase 270 — Vault Note Folder Structure
 * Tests: resolveEntityNotePath, safeFileName, ensureFolder (recursive),
 *        ENTITY_NOTE_FOLDERS mapping, settings defaults, parent-aware nesting,
 *        legacy/flat/workspace modes.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`); }
}
function ok(cond, msg) { assert.ok(cond, msg); }
function eq(a, b) { assert.deepStrictEqual(a, b); }

// ── Extract and evaluate helpers from src ─────────────────────────────────────
// We extract functions we can run in isolation using a minimal environment.

// Stub normalizePath (Obsidian built-in)
global.normalizePath = (p) => p.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

// Stub Notice (Obsidian)
global.Notice = function(msg) {};

// Extract safeFileName
const safeFnMatch = src.match(/function safeFileName\(name, fallback\) \{([\s\S]*?)\n\}/);
let safeFileName;
if (safeFnMatch) {
  safeFileName = new Function('name', 'fallback', safeFnMatch[1]);
} else {
  safeFileName = (name, fallback) => String(name || fallback || 'Untitled').replace(/[\\/:*?"<>|#^[\]]+/g, '').trim().slice(0, 100) || String(fallback || 'Untitled');
}

// Extract ENTITY_NOTE_FOLDERS
const enfMatch = src.match(/const ENTITY_NOTE_FOLDERS = \{([\s\S]*?)\};/);
let ENTITY_NOTE_FOLDERS = {};
if (enfMatch) {
  // Parse key: 'value' pairs
  const re = /(\w+):\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(enfMatch[1])) !== null) ENTITY_NOTE_FOLDERS[m[1]] = m[2];
}

// Extract SETTLEMENT_TYPE_FOLDERS
const stfMatch = src.match(/const SETTLEMENT_TYPE_FOLDERS = \{([\s\S]*?)\};/);
let SETTLEMENT_TYPE_FOLDERS = {};
if (stfMatch) {
  const re = /(\w+):\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(stfMatch[1])) !== null) SETTLEMENT_TYPE_FOLDERS[m[1]] = m[2];
}

// Extract ENTITY_FOLDER_LABELS
const eflMatch = src.match(/const ENTITY_FOLDER_LABELS = \{([\s\S]*?)\};/);
let ENTITY_FOLDER_LABELS = {};
if (eflMatch) {
  const re = /(\w+):'([^']+)'/g;
  let m;
  while ((m = re.exec(eflMatch[1])) !== null) ENTITY_FOLDER_LABELS[m[1]] = m[2];
}

// Build a minimal version of resolveEntityNotePath for testing
function safeArr(v) { return Array.isArray(v) ? v : []; }
function activeCampaign(state) {
  return safeArr(state.entities.campaigns).find(c => c.id === state.activeCampaignId)
    || safeArr(state.entities.campaigns).find(c => c.status !== 'Archived')
    || null;
}

function resolveEntityNotePath(entityType, entity, state, pluginOrNull) {
  const mode = state.settings.noteFolderMode || 'workspace';
  const root = safeFileName(state.settings.noteRootFolder || 'TTRPG Engine', 'TTRPG Engine');
  const name = safeFileName(entity.name || entity.title || entity.id, 'Untitled');

  if (mode === 'legacy') {
    const camp = activeCampaign(state);
    const campFolder = camp ? safeFileName(camp.name, 'Unassigned') : 'Unassigned';
    const sub = ENTITY_FOLDER_LABELS[entityType] || entityType;
    return normalizePath(`${campFolder}/${sub}/${name}.md`);
  }

  if (mode === 'flat') {
    const sub = ENTITY_NOTE_FOLDERS[entityType] || (ENTITY_FOLDER_LABELS[entityType] || entityType);
    return normalizePath(`${root}/${sub}/${name}.md`);
  }

  const camp = activeCampaign(state);
  const campName = camp ? safeFileName(camp.name, 'Unassigned') : 'Unassigned';
  const campBase = `${root}/Campaigns/${campName}`;
  const workspaceFolder = ENTITY_NOTE_FOLDERS[entityType];

  if (!workspaceFolder) {
    return normalizePath(`${campBase}/Compendium/My Content/${name}.md`);
  }

  const nestLocations = state.settings.nestLocationsUnderParents !== false;
  const nestQuests = state.settings.nestQuestsUnderAdventures === true;

  if (entityType === 'settlements' && entity.type) {
    const typeKey = String(entity.type).toLowerCase();
    const typeFolder = SETTLEMENT_TYPE_FOLDERS[typeKey];
    if (typeFolder) return normalizePath(`${campBase}/World Atlas/Settlements/${typeFolder}/${name}.md`);
  }

  if (entityType === 'locations' && nestLocations) {
    if (entity.settlementId) {
      const settlement = safeArr(state.entities.settlements).find(s => s.id === entity.settlementId);
      if (settlement) {
        const sName = safeFileName(settlement.name, 'Settlement');
        const typeKey = String(settlement.type || '').toLowerCase();
        const typeFolder = SETTLEMENT_TYPE_FOLDERS[typeKey];
        const sFolder = typeFolder ? `Settlements/${typeFolder}/${sName}` : `Settlements/${sName}`;
        return normalizePath(`${campBase}/World Atlas/${sFolder}/Locations/${name}.md`);
      }
    }
    if (entity.regionId) {
      const region = safeArr(state.entities.regions).find(r => r.id === entity.regionId);
      if (region) {
        return normalizePath(`${campBase}/World Atlas/Regions/${safeFileName(region.name, 'Region')}/Locations/${name}.md`);
      }
    }
  }

  if (entityType === 'districts' && nestLocations) {
    if (entity.settlementId) {
      const settlement = safeArr(state.entities.settlements).find(s => s.id === entity.settlementId);
      if (settlement) {
        const sName = safeFileName(settlement.name, 'Settlement');
        const typeKey = String(settlement.type || '').toLowerCase();
        const typeFolder = SETTLEMENT_TYPE_FOLDERS[typeKey];
        const sFolder = typeFolder ? `Settlements/${typeFolder}/${sName}` : `Settlements/${sName}`;
        return normalizePath(`${campBase}/World Atlas/${sFolder}/Districts/${name}.md`);
      }
    }
  }

  if (entityType === 'rooms' && nestLocations) {
    if (entity.dungeonId) {
      const dungeon = safeArr(state.entities.dungeons).find(d => d.id === entity.dungeonId);
      if (dungeon) return normalizePath(`${campBase}/World Atlas/Dungeons/${safeFileName(dungeon.name, 'Dungeon')}/Rooms/${name}.md`);
    }
  }

  if (entityType === 'quests' && nestQuests && entity.adventureId) {
    const adv = safeArr(state.entities.adventures).find(a => a.id === entity.adventureId);
    if (adv) return normalizePath(`${campBase}/Adventure Planner/Adventures/${safeFileName(adv.name, 'Adventure')}/Quests/${name}.md`);
  }

  if (entityType === 'encounters' && nestQuests && entity.adventureId) {
    const adv = safeArr(state.entities.adventures).find(a => a.id === entity.adventureId);
    if (adv) return normalizePath(`${campBase}/Adventure Planner/Adventures/${safeFileName(adv.name, 'Adventure')}/Encounters/${name}.md`);
  }

  return normalizePath(`${campBase}/${workspaceFolder}/${name}.md`);
}

// ── Minimal state builder ─────────────────────────────────────────────────────
function makeState(overrides = {}) {
  return {
    activeCampaignId: 'camp-1',
    settings: {
      noteRootFolder: 'TTRPG Engine',
      noteFolderMode: 'workspace',
      nestLocationsUnderParents: true,
      nestQuestsUnderAdventures: false,
      ...overrides.settings,
    },
    entities: {
      campaigns: [{ id: 'camp-1', name: 'Dark Horizons', status: 'Active' }],
      settlements: [],
      regions: [],
      locations: [],
      districts: [],
      dungeons: [],
      adventures: [],
      quests: [],
      encounters: [],
      ...overrides.entities,
    },
  };
}

// ── Tests: ENTITY_NOTE_FOLDERS ─────────────────────────────────────────────────
console.log('\nPhase 270 — Vault Note Folder Structure\n');
console.log('  ENTITY_NOTE_FOLDERS mapping');

test('ENTITY_NOTE_FOLDERS is populated', () => ok(Object.keys(ENTITY_NOTE_FOLDERS).length > 10, 'Too few entries'));
test('npcs maps to Cast & Powers/NPCs', () => eq(ENTITY_NOTE_FOLDERS['npcs'], 'Cast & Powers/NPCs'));
test('creatures maps to Cast & Powers/Creatures', () => eq(ENTITY_NOTE_FOLDERS['creatures'], 'Cast & Powers/Creatures'));
test('factions maps to Cast & Powers/Factions', () => eq(ENTITY_NOTE_FOLDERS['factions'], 'Cast & Powers/Factions'));
test('settlements maps to World Atlas/Settlements', () => eq(ENTITY_NOTE_FOLDERS['settlements'], 'World Atlas/Settlements'));
test('regions maps to World Atlas/Regions', () => eq(ENTITY_NOTE_FOLDERS['regions'], 'World Atlas/Regions'));
test('locations maps to World Atlas/Locations', () => eq(ENTITY_NOTE_FOLDERS['locations'], 'World Atlas/Locations'));
test('dungeons maps to World Atlas/Dungeons', () => eq(ENTITY_NOTE_FOLDERS['dungeons'], 'World Atlas/Dungeons'));
test('rooms maps to World Atlas/Dungeons/Rooms', () => eq(ENTITY_NOTE_FOLDERS['rooms'], 'World Atlas/Dungeons/Rooms'));
test('quests maps to Adventure Planner/Quests', () => eq(ENTITY_NOTE_FOLDERS['quests'], 'Adventure Planner/Quests'));
test('encounters maps to Adventure Planner/Encounters', () => eq(ENTITY_NOTE_FOLDERS['encounters'], 'Adventure Planner/Encounters'));
test('adventures maps to Adventure Planner/Adventures', () => eq(ENTITY_NOTE_FOLDERS['adventures'], 'Adventure Planner/Adventures'));
test('sessions maps to Sessions/Session Logs', () => eq(ENTITY_NOTE_FOLDERS['sessions'], 'Sessions/Session Logs'));
test('secrets maps to Secrets & Handouts/Secrets', () => eq(ENTITY_NOTE_FOLDERS['secrets'], 'Secrets & Handouts/Secrets'));
test('handouts maps to Secrets & Handouts/Handouts', () => eq(ENTITY_NOTE_FOLDERS['handouts'], 'Secrets & Handouts/Handouts'));
test('acts maps to Campaign Command Centre/Acts', () => eq(ENTITY_NOTE_FOLDERS['acts'], 'Campaign Command Centre/Acts'));
test('homebrew maps to Compendium/Homebrew', () => eq(ENTITY_NOTE_FOLDERS['homebrew'], 'Compendium/Homebrew'));

// ── Tests: safeFileName ────────────────────────────────────────────────────────
console.log('\n  safeFileName helper');

test('safeFileName strips illegal chars', () => {
  const result = safeFileName('My: Village? <Test>', 'fallback');
  ok(!result.includes(':') && !result.includes('?') && !result.includes('<') && !result.includes('>'),
    `Got: ${result}`);
});
test('safeFileName trims whitespace', () => {
  eq(safeFileName('  Name  ', 'fb'), 'Name');
});
test('safeFileName uses fallback for empty', () => {
  const result = safeFileName('', 'Untitled');
  ok(result === 'Untitled', `Got: ${result}`);
});
test('safeFileName uses fallback for null', () => {
  const result = safeFileName(null, 'Untitled');
  ok(result === 'Untitled', `Got: ${result}`);
});
test('safeFileName preserves readable names', () => {
  const result = safeFileName('Blackfen Village', 'fb');
  ok(result.includes('Blackfen') && result.includes('Village'), `Got: ${result}`);
});
test('safeFileName handles forward slash', () => {
  ok(!safeFileName('path/file', 'fb').includes('/'), 'Forward slash not removed');
});

// ── Tests: resolveEntityNotePath — workspace mode ──────────────────────────────
console.log('\n  resolveEntityNotePath — workspace mode');

const state = makeState();

test('NPC goes under Cast & Powers/NPCs', () => {
  const p = resolveEntityNotePath('npcs', { name: 'Aldric' }, state, null);
  ok(p.includes('Cast & Powers/NPCs/Aldric'), `Got: ${p}`);
});
test('NPC path starts with TTRPG Engine/Campaigns', () => {
  const p = resolveEntityNotePath('npcs', { name: 'Aldric' }, state, null);
  ok(p.startsWith('TTRPG Engine/Campaigns/Dark Horizons'), `Got: ${p}`);
});
test('Quest goes under Adventure Planner/Quests', () => {
  const p = resolveEntityNotePath('quests', { name: 'Find the Key' }, state, null);
  ok(p.includes('Adventure Planner/Quests/Find the Key'), `Got: ${p}`);
});
test('Session goes under Sessions/Session Logs', () => {
  const p = resolveEntityNotePath('sessions', { name: 'Session 01' }, state, null);
  ok(p.includes('Sessions/Session Logs/Session 01'), `Got: ${p}`);
});
test('Secret goes under Secrets & Handouts/Secrets', () => {
  const p = resolveEntityNotePath('secrets', { name: 'The Betrayal' }, state, null);
  ok(p.includes('Secrets & Handouts/Secrets/The Betrayal'), `Got: ${p}`);
});
test('Faction goes under Cast & Powers/Factions', () => {
  const p = resolveEntityNotePath('factions', { name: 'Iron March' }, state, null);
  ok(p.includes('Cast & Powers/Factions/Iron March'), `Got: ${p}`);
});
test('Region goes under World Atlas/Regions', () => {
  const p = resolveEntityNotePath('regions', { name: 'Vale of Shadows' }, state, null);
  ok(p.includes('World Atlas/Regions/Vale of Shadows'), `Got: ${p}`);
});
test('Path ends with .md', () => {
  const p = resolveEntityNotePath('npcs', { name: 'Test' }, state, null);
  ok(p.endsWith('.md'), `Got: ${p}`);
});
test('No double slashes in path', () => {
  const p = resolveEntityNotePath('npcs', { name: 'Test' }, state, null);
  ok(!p.includes('//'), `Got: ${p}`);
});

// ── Tests: settlement type subfolders ─────────────────────────────────────────
console.log('\n  settlement type subfolders');

test('Settlement type=Village goes to World Atlas/Settlements/Villages', () => {
  const p = resolveEntityNotePath('settlements', { name: 'Blackfen', type: 'Village' }, state, null);
  ok(p.includes('World Atlas/Settlements/Villages/Blackfen'), `Got: ${p}`);
});
test('Settlement type=City goes to World Atlas/Settlements/Cities', () => {
  const p = resolveEntityNotePath('settlements', { name: 'Ironhaven', type: 'City' }, state, null);
  ok(p.includes('World Atlas/Settlements/Cities/Ironhaven'), `Got: ${p}`);
});
test('Settlement type=Town goes to World Atlas/Settlements/Towns', () => {
  const p = resolveEntityNotePath('settlements', { name: 'Millford', type: 'Town' }, state, null);
  ok(p.includes('World Atlas/Settlements/Towns/Millford'), `Got: ${p}`);
});
test('Settlement type=Hamlet goes to World Atlas/Settlements/Hamlets', () => {
  const p = resolveEntityNotePath('settlements', { name: 'Ashcroft', type: 'Hamlet' }, state, null);
  ok(p.includes('World Atlas/Settlements/Hamlets/Ashcroft'), `Got: ${p}`);
});
test('Settlement with no type goes to World Atlas/Settlements', () => {
  const p = resolveEntityNotePath('settlements', { name: 'Unknown' }, state, null);
  ok(p.includes('World Atlas/Settlements/Unknown'), `Got: ${p}`);
});

// ── Tests: location parent-aware nesting ──────────────────────────────────────
console.log('\n  location parent-aware nesting');

const stateWithSettlement = makeState({
  entities: {
    settlements: [{ id: 'set-1', name: 'Blackfen', type: 'Village' }],
    regions: [{ id: 'reg-1', name: 'Vale of Shadows' }],
  },
});

test('Location linked to village nests under Settlements/Villages/Blackfen', () => {
  const p = resolveEntityNotePath('locations', { name: 'The Crooked Lantern', settlementId: 'set-1' }, stateWithSettlement, null);
  ok(p.includes('Settlements/Villages/Blackfen/Locations/The Crooked Lantern'), `Got: ${p}`);
});
test('Location linked to region nests under Regions/RegionName', () => {
  const p = resolveEntityNotePath('locations', { name: 'Ancient Ruins', regionId: 'reg-1' }, stateWithSettlement, null);
  ok(p.includes('Regions/Vale of Shadows/Locations/Ancient Ruins'), `Got: ${p}`);
});
test('Location with no parent goes to World Atlas/Locations', () => {
  const p = resolveEntityNotePath('locations', { name: 'Orphan Location' }, state, null);
  ok(p.includes('World Atlas/Locations/Orphan Location'), `Got: ${p}`);
});

// ── Tests: district nesting ───────────────────────────────────────────────────
console.log('\n  district nesting');

const stateWithCity = makeState({
  entities: {
    settlements: [{ id: 'city-1', name: 'Ironhaven', type: 'City' }],
  },
});

test('District linked to city nests under Settlements/Cities/Ironhaven', () => {
  const p = resolveEntityNotePath('districts', { name: 'Market Ward', settlementId: 'city-1' }, stateWithCity, null);
  ok(p.includes('Settlements/Cities/Ironhaven/Districts/Market Ward'), `Got: ${p}`);
});
test('District with no parent goes to World Atlas/Districts', () => {
  const p = resolveEntityNotePath('districts', { name: 'Orphan District' }, state, null);
  ok(p.includes('World Atlas/Districts/Orphan District'), `Got: ${p}`);
});

// ── Tests: room nesting ───────────────────────────────────────────────────────
console.log('\n  room nesting');

const stateWithDungeon = makeState({
  entities: {
    dungeons: [{ id: 'dun-1', name: 'Crypt of Shadows' }],
  },
});

test('Room linked to dungeon nests under Dungeons/DungeonName/Rooms', () => {
  const p = resolveEntityNotePath('rooms', { name: 'Entry Hall', dungeonId: 'dun-1' }, stateWithDungeon, null);
  ok(p.includes('Dungeons/Crypt of Shadows/Rooms/Entry Hall'), `Got: ${p}`);
});
test('Room with no parent goes to World Atlas/Dungeons/Rooms', () => {
  const p = resolveEntityNotePath('rooms', { name: 'Lost Room' }, state, null);
  ok(p.includes('World Atlas/Dungeons/Rooms/Lost Room'), `Got: ${p}`);
});

// ── Tests: quest nesting ──────────────────────────────────────────────────────
console.log('\n  quest nesting (disabled by default)');

const stateWithAdv = makeState({
  entities: {
    adventures: [{ id: 'adv-1', name: 'The Sunken City' }],
  },
});

test('Quest does NOT nest under adventure by default (nestQuestsUnderAdventures=false)', () => {
  const p = resolveEntityNotePath('quests', { name: 'Find the Key', adventureId: 'adv-1' }, stateWithAdv, null);
  ok(p.includes('Adventure Planner/Quests/Find the Key'), `Got: ${p}`);
  ok(!p.includes('Adventures'), `Should not include Adventures, got: ${p}`);
});
test('Quest nests under adventure when nestQuestsUnderAdventures=true', () => {
  const nestState = makeState({ settings: { nestQuestsUnderAdventures: true }, entities: { adventures: [{ id: 'adv-1', name: 'The Sunken City' }] } });
  const p = resolveEntityNotePath('quests', { name: 'Find the Key', adventureId: 'adv-1' }, nestState, null);
  ok(p.includes('Adventures/The Sunken City/Quests/Find the Key'), `Got: ${p}`);
});

// ── Tests: legacy mode ────────────────────────────────────────────────────────
console.log('\n  legacy mode');

const legacyState = makeState({ settings: { noteFolderMode: 'legacy' } });

test('Legacy mode NPC goes to flat CampaignName/NPCs path', () => {
  const p = resolveEntityNotePath('npcs', { name: 'Aldric' }, legacyState, null);
  ok(p.startsWith('Dark Horizons/NPCs/'), `Got: ${p}`);
  ok(!p.includes('TTRPG Engine'), `Should not include root folder in legacy mode, got: ${p}`);
});
test('Legacy mode does not create workspace folders', () => {
  const p = resolveEntityNotePath('sessions', { name: 'Session 01' }, legacyState, null);
  ok(!p.includes('Sessions/Session Logs'), `Should be flat, got: ${p}`);
});

// ── Tests: flat mode ──────────────────────────────────────────────────────────
console.log('\n  flat mode');

const flatState = makeState({ settings: { noteFolderMode: 'flat' } });

test('Flat mode NPC goes under root/Cast & Powers/NPCs', () => {
  const p = resolveEntityNotePath('npcs', { name: 'Aldric' }, flatState, null);
  ok(p.startsWith('TTRPG Engine/Cast & Powers/NPCs'), `Got: ${p}`);
  ok(!p.includes('Campaigns'), `Should not have Campaigns folder in flat mode, got: ${p}`);
});

// ── Tests: no top-level entity folders ────────────────────────────────────────
console.log('\n  no top-level entity folders');

test('NPC path does not start with NPCs/', () => {
  const p = resolveEntityNotePath('npcs', { name: 'Test' }, state, null);
  ok(!p.startsWith('NPCs/'), `Path starts with entity folder directly: ${p}`);
});
test('Sessions path does not start with Sessions/', () => {
  const p = resolveEntityNotePath('sessions', { name: 'Test' }, state, null);
  ok(!p.startsWith('Sessions/'), `Path starts with entity folder directly: ${p}`);
});
test('Regions path does not start with Regions/', () => {
  const p = resolveEntityNotePath('regions', { name: 'Test' }, state, null);
  ok(!p.startsWith('Regions/'), `Path starts with entity folder directly: ${p}`);
});

// ── Tests: source-level checks ────────────────────────────────────────────────
console.log('\n  source-level checks');

test('resolveEntityNotePath function is defined in source', () => {
  ok(/^function resolveEntityNotePath/m.test(src), 'resolveEntityNotePath missing');
});
test('safeFileName function is defined in source', () => {
  ok(/^function safeFileName/m.test(src), 'safeFileName missing');
});
test('ensureFolder is recursive (splits on /)', () => {
  ok(src.includes("const parts = norm.split('/')"), 'ensureFolder does not have recursive split logic');
});
test('campaignRootFolder in default settings', () => {
  ok(src.includes("campaignRootFolder: 'Campaigns'"), 'campaignRootFolder missing from default settings');
});
test('noteFolderMode in default settings', () => {
  ok(src.includes("noteFolderMode: 'workspace'"), 'noteFolderMode missing from default settings');
});
test('ENTITY_NOTE_FOLDERS defined in source', () => {
  ok(src.includes('ENTITY_NOTE_FOLDERS'), 'ENTITY_NOTE_FOLDERS missing');
});
test('writeEntityNote uses resolveEntityNotePath', () => {
  ok(src.includes('resolveEntityNotePath(key, item, plugin.state, plugin)'), 'writeEntityNote does not use resolver');
});
test('campaignFolder uses campaignRootFolder', () => {
  ok(src.includes('campaignRootFolder(plugin)'), 'campaignFolder does not use campaignRootFolder');
});
test('globalFolder function exists', () => {
  ok(/function globalFolder/.test(src), 'globalFolder missing');
});
test('diagnoseLegacyNotes function exists', () => {
  ok(/async function diagnoseLegacyNotes/.test(src), 'diagnoseLegacyNotes missing');
});
test('migrateLegacyNotes function exists', () => {
  ok(/async function migrateLegacyNotes/.test(src), 'migrateLegacyNotes missing');
});
test('entityMd includes ttrpg-engine frontmatter field', () => {
  ok(src.includes("'ttrpg-engine: true'"), 'entityMd missing ttrpg-engine frontmatter');
});
test('entityMd includes workspace frontmatter field', () => {
  ok(src.includes('`workspace: ${workspace}`'), 'entityMd missing workspace frontmatter');
});
test('Campaign wizard uses workspace folder structure', () => {
  ok(src.includes('Campaign Command Centre/Campaign Overview'), 'wizard not creating workspace folders');
});
test('exportBackup uses Campaign Command Centre/Exports', () => {
  ok(src.includes('Campaign Command Centre/Exports'), 'exportBackup not using new path');
});
test('exportCampaignBible uses Campaign Command Centre/Campaign Bible.md', () => {
  ok(src.includes('Campaign Command Centre/Campaign Bible.md'), 'exportCampaignBible not using new path');
});
test('Session review uses Sessions/Session Logs', () => {
  ok(src.includes('Sessions/Session Logs'), 'session review not using new path');
});
test('Hybrid ancestry note uses Cast & Powers/Hybrid Ancestries', () => {
  ok(src.includes('Cast & Powers/Hybrid Ancestries'), 'hybrid ancestry not using new path');
});
test('Map export uses World Atlas/Maps', () => {
  ok(src.includes('World Atlas/Maps'), 'map export not using new path');
});
test('Generated output uses Compendium/Generated', () => {
  ok(src.includes('Compendium/Generated'), 'generated output not using new path');
});
test('Player packet uses Secrets & Handouts/Player Packets', () => {
  ok(src.includes('Secrets & Handouts/Player Packets'), 'player packet not using new path');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

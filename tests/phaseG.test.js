'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS', name);
    passed++;
  } catch (error) {
    console.log('  FAIL', name, '\n       ', error.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function includes(text, fragment) {
  assert(text.includes(fragment), `Expected to find: ${fragment}`);
}

function notIncludes(text, fragment) {
  assert(!text.includes(fragment), `Expected NOT to find: ${fragment}`);
}

function countDeclarations(name) {
  return (src.match(new RegExp(`function ${name}\\s*\\(`, 'g')) || []).length;
}

function extractFunctionSource(name) {
  const start = src.indexOf(`function ${name}(`);
  assert(start >= 0, `Could not find function ${name}`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      depth++;
      if (bodyStart === -1) bodyStart = i;
    } else if (ch === '}') {
      depth--;
      if (bodyStart !== -1 && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function buildFunction(name, extraContext) {
  const context = Object.assign({
    safeArr(value) { return Array.isArray(value) ? value : []; },
    uid(prefix) {
      context.__uid = (context.__uid || 0) + 1;
      return `${prefix}-${context.__uid}`;
    },
    upsert(state, key, item) {
      if (!state.entities[key]) state.entities[key] = [];
      const idx = state.entities[key].findIndex(entry => entry.id === item.id);
      if (idx >= 0) state.entities[key][idx] = item;
      else state.entities[key].push(item);
    },
    console,
  }, extraContext || {});
  return vm.runInNewContext(`(${extractFunctionSource(name)})`, context);
}

console.log('\nPhase G — Critical Runtime Repair & Truthful Coverage\n');

console.log('  Section 1: Duplicate critical declarations');
test('migrateNobleFamiliesToFactions is declared exactly once', () => {
  assert(countDeclarations('migrateNobleFamiliesToFactions') === 1, 'Expected exactly one migrateNobleFamiliesToFactions declaration');
});
test('resolveEntityDisplay is declared exactly once', () => {
  assert(countDeclarations('resolveEntityDisplay') === 1, 'Expected exactly one resolveEntityDisplay declaration');
});

console.log('\n  Section 2: Noble family migration safety');
test('renderCastPowers calls migrateNobleFamiliesToFactions with plugin', () => {
  const fn = src.slice(src.indexOf('function renderCastPowers'), src.indexOf('function renderNobleFamiliesSection'));
  includes(fn, 'migrateNobleFamiliesToFactions(plugin);');
});
test('canonical migration uses plugin.state and does not duplicate factions', () => {
  const migrate = buildFunction('migrateNobleFamiliesToFactions');
  let saveCalls = 0;
  const plugin = {
    state: {
      entities: {
        nobleFamilies: [{ id: 'noble-1', name: 'House Rowan', motto: 'Stand Fast', campaignId: 'camp-1', visibility: 'dm-only' }],
        factions: [],
      },
    },
    saveState() { saveCalls++; },
  };
  const createdFirst = migrate(plugin);
  const noble = plugin.state.entities.nobleFamilies[0];
  assert(createdFirst === 1, 'Expected one faction to be created on first migration');
  assert(plugin.state.entities.factions.length === 1, 'Expected one migrated faction');
  assert(noble.migratedFactionId, 'Expected migratedFactionId to be preserved on the noble family');
  assert(noble.migratedToFaction === true, 'Expected migratedToFaction flag to be set');
  const createdSecond = migrate(plugin);
  assert(createdSecond === 0, 'Expected repeated migration to create zero new factions');
  assert(plugin.state.entities.factions.length === 1, 'Expected repeated migration to avoid duplicates');
  assert(plugin.state.entities.nobleFamilies.length === 1, 'Expected legacy noble family record to remain preserved');
  assert(saveCalls >= 1, 'Expected migration to attempt saving when it touched data');
});
test('existing migrated faction is reused without overwriting edits', () => {
  const migrate = buildFunction('migrateNobleFamiliesToFactions');
  const plugin = {
    state: {
      entities: {
        nobleFamilies: [{ id: 'noble-1', name: 'House Rowan', migratedFactionId: 'faction-1', campaignId: 'camp-1' }],
        factions: [{ id: 'faction-1', name: 'Edited House Rowan', type: 'Noble House', migratedFromNobleFamilyId: 'noble-1' }],
      },
    },
    saveState() {},
  };
  const created = migrate(plugin);
  assert(created === 0, 'Expected no new faction when a migrated faction already exists');
  assert(plugin.state.entities.factions[0].name === 'Edited House Rowan', 'Expected existing migrated faction edits to be preserved');
  assert(plugin.state.entities.nobleFamilies[0].migratedToFaction === true, 'Expected noble family to be marked migrated when an existing faction is reused');
});

console.log('\n  Section 3: Entity display resolver compatibility');
test('resolveEntityDisplay supports old two-argument resolution', () => {
  const resolveEntityDisplay = buildFunction('resolveEntityDisplay');
  const state = {
    entities: {
      regions: [{ id: 'region-1', name: 'Northreach' }],
      factions: [{ id: 'faction-1', name: 'The Lantern Court' }],
      nobleFamilies: [],
    },
  };
  assert(resolveEntityDisplay('region-1', state) === 'Northreach', 'Expected two-argument resolver to find region names');
  assert(resolveEntityDisplay('unknown-text', state) === 'unknown-text', 'Expected unresolved values to fall back to the original text');
});
test('resolveEntityDisplay supports new three-argument resolution', () => {
  const resolveEntityDisplay = buildFunction('resolveEntityDisplay');
  const state = {
    entities: {
      factions: [{ id: 'faction-1', name: 'The Lantern Court' }],
    },
  };
  assert(resolveEntityDisplay('factions', 'faction-1', state) === 'The Lantern Court', 'Expected three-argument resolver to find typed entity names');
});
test('resolveEntityDisplay does not throw when state is missing', () => {
  const resolveEntityDisplay = buildFunction('resolveEntityDisplay');
  assert(resolveEntityDisplay('orphan-id', null) === 'orphan-id', 'Expected missing state to return the original value');
});
test('resolveEntityDisplay resolves legacy noble family ids', () => {
  const resolveEntityDisplay = buildFunction('resolveEntityDisplay');
  const state = {
    entities: {
      nobleFamilies: [{ id: 'noble-1', name: 'House Rowan' }],
      factions: [],
    },
  };
  assert(resolveEntityDisplay('nobleFamilies', 'noble-1', state) === 'House Rowan', 'Expected legacy noble family ids to resolve');
});
test('resolveEntityDisplay prefers migrated faction names for legacy noble families', () => {
  const resolveEntityDisplay = buildFunction('resolveEntityDisplay');
  const state = {
    entities: {
      nobleFamilies: [{ id: 'noble-1', name: 'House Rowan', migratedFactionId: 'faction-1' }],
      factions: [{ id: 'faction-1', name: 'House Rowan (Faction)' }],
    },
  };
  assert(resolveEntityDisplay('nobleFamilies', 'noble-1', state) === 'House Rowan (Faction)', 'Expected migrated noble families to resolve to the faction name');
});
test('itemCards still uses a resolver signature supported by the canonical helper', () => {
  const fn = src.slice(src.indexOf('function itemCards'), src.indexOf('const RICH_EDIT_MAP'));
  includes(fn, 'resolveEntityDisplay(String(v), plugin.state)');
  includes(fn, 'resolveEntityDisplay(String(val), plugin.state)');
});

console.log('\n  Section 4: Domains and campaign-scoped entities');
test('createDefaultState includes first-class domains', () => {
  const fn = src.slice(src.indexOf('function createDefaultState'), src.indexOf('function migrateState'));
  includes(fn, 'domains: []');
});
test('ENTITY_FIELD_SCHEMAS includes domainFields', () => {
  const schemaBlock = src.slice(src.indexOf('const ENTITY_FIELD_SCHEMAS'), src.indexOf('function renderPlayerLore'));
  includes(schemaBlock, 'domains: domainFields');
});
test('CAMPAIGN_SCOPED_ENTITIES exists with key modern entity types', () => {
  const match = src.match(/const CAMPAIGN_SCOPED_ENTITIES = \[([\s\S]*?)\];/);
  assert(match, 'CAMPAIGN_SCOPED_ENTITIES declaration not found');
  const block = match[1];
  ['acts', 'worlds', 'domains', 'maps', 'nobleFamilies', 'hybridAncestries', 'warFronts'].forEach(key => includes(block, `'${key}'`));
});
test('repair and diagnostics use CAMPAIGN_SCOPED_ENTITIES instead of a local CAMPAIGN_OWNED list', () => {
  notIncludes(src, 'CAMPAIGN_OWNED');
  includes(src, 'CAMPAIGN_SCOPED_ENTITIES.forEach');
  includes(src, 'CAMPAIGN_SCOPED_ENTITIES.includes(key)');
});

console.log('\n  Section 5: Relationship Matrix and map/file path fixes');
test('Relationship Matrix no longer exposes + Noble Family creation', () => {
  const fn = src.slice(src.indexOf('function renderRelationshipMatrix'), src.indexOf('sectionHead(main, \'Faction Reputation\')'));
  notIncludes(fn, '+ Noble Family');
  notIncludes(fn, 'new NobleFamilyModal');
  includes(fn, 'Legacy Noble Families');
});
test('Run Session map selectors use the canonical maps helper', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('// â”€â”€ PLAYER COMPANION'));
  includes(fn, 'const maps = getCampaignMaps(state, scopeId);');
  includes(fn, 'const selectedMap = selectedMapId ? getCampaignMaps(state).find(m => m.id === selectedMapId) : null;');
});
test('Tile Map PNG export ensures the exact parent folder it writes to', () => {
  const fn = src.slice(src.indexOf('const folder = campaignFolder(plugin);'), src.indexOf('new Notice(`Map "${tmState.mapName}" saved as PNG'));
  includes(fn, 'const pngDir = pngPath.replace(/\\/[^/]+$/, \'\');');
  includes(fn, 'await ensureFolder(plugin.app, pngDir);');
  notIncludes(fn, 'await ensureFolder(plugin.app, `${folder}/Maps`);');
});
test('CampaignModal no longer creates a top-level slugified campaign folder directly', () => {
  const fn = src.slice(src.indexOf('class CampaignModal'), src.indexOf('// NPCModal'));
  notIncludes(fn, 'ensureFolder(this.plugin.app, slugify(this.values.name))');
  includes(fn, 'campaignFolderFor(this.plugin, this.values)');
});

console.log(`\n========================================`);
console.log(`Phase G: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

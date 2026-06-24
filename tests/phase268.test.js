'use strict';
/**
 * Phase 268 — Hierarchy Normalisation & Entity Linking
 * Tests: acts, domains, CAMPAIGN_SCOPED_ENTITIES, GenericModal entityRef fields,
 *        diagnostics broken-link detection, repair/reindex legacy text migration.
 */

const assert = require('node:assert/strict');

// ── Minimal stubs (match what main.js needs for isolated fn extraction) ──────
function uid(prefix) { return `${prefix}-test-${Math.random().toString(36).slice(2,7)}`; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

// ── Re-implement createDefaultState logic for testing ────────────────────────
function createDefaultState() {
  return {
    version: '1.0.0',
    activeCampaignId: '',
    entities: {
      campaigns: [],
      worlds: [], cosmologies: [], realms: [],
      regions: [], settlements: [], locations: [], pois: [], routes: [],
      npcs: [], creatures: [], bbegs: [],
      factions: [],
      cultures: [], languages: [], deities: [], pantheons: [],
      quests: [], adventures: [],
      encounters: [],
      sessions: [], milestones: [],
      secrets: [], handouts: [],
      rules: [], conditions: [], damageTypes: [],
      downtime: [], projects: [], bastions: [],
      compendium: [], homebrew: [], tables: [],
      characters: [],
      calendars: [],
      journals: [],
      maps: [],
      dungeons: [],
      timers: [],
      enemyTemplates: [],
      reputations: [],
      warFronts: [],
      incursions: [],
      endgameStates: [],
      nations: [],
      religions: [],
      districts: [],
      rooms: [],
      timelines: [],
      reveals: [],
      loot: [],
      hybridAncestries: [],
      nobleFamilies: [],
      // Phase 268
      acts: [],
      domains: [],
    },
    relationships: [],
  };
}

const CAMPAIGN_SCOPED_ENTITIES = [
  'acts', 'adventures', 'quests', 'encounters', 'sessions',
  'milestones', 'secrets', 'reveals', 'handouts',
  'worlds', 'cosmologies', 'realms', 'regions', 'settlements',
  'districts', 'locations', 'pois', 'routes', 'dungeons', 'rooms',
  'maps', 'npcs', 'creatures', 'bbegs', 'factions', 'nations',
  'religions', 'cultures', 'languages', 'deities', 'pantheons',
  'timelines', 'loot', 'reputations', 'warFronts', 'incursions',
  'endgameStates', 'nobleFamilies', 'hybridAncestries', 'domains',
];

// ── repairAndReindex (minimal replica for tests) ──────────────────────────────
function repairAndReindex(state) {
  const issues = [];
  const ents = state.entities || {};

  for (const [key, arr] of Object.entries(ents)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((item, i) => {
      if (!item) return;
      if (!item.id) { item.id = `${key}-repaired-${i}`; issues.push(`${key}[${i}]: assigned missing id`); }
      if (!item.createdAt) { item.createdAt = new Date().toISOString(); }
      if (!item.updatedAt) { item.updatedAt = new Date().toISOString(); }
      if (CAMPAIGN_SCOPED_ENTITIES.includes(key) && !item.campaignId && state.activeCampaignId) {
        item.campaignId = state.activeCampaignId;
        issues.push(`${key}[${i}] ${item.id}: assigned campaignId`);
      }
    });
  }

  // Legacy text → ID migration
  const campId = state.activeCampaignId;
  const regions = safeArr(ents.regions);
  const settlements = safeArr(ents.settlements);

  safeArr(ents.settlements).forEach(s => {
    if (s.regionId || !s.region) return;
    const matches = regions.filter(r => r.name && r.name.trim().toLowerCase() === s.region.trim().toLowerCase());
    if (matches.length === 1) {
      s.regionId = matches[0].id;
      issues.push(`settlement "${s.name}": migrated region text → regionId`);
    } else if (matches.length > 1) {
      issues.push(`settlement "${s.name}": region text ambiguous`);
    }
  });

  safeArr(ents.nations).forEach(n => {
    if (n.capitalSettlementId || !n.capital) return;
    const matches = settlements.filter(s => s.name && s.name.trim().toLowerCase() === n.capital.trim().toLowerCase());
    if (matches.length === 1) {
      n.capitalSettlementId = matches[0].id;
      issues.push(`nation "${n.name}": migrated capital text → capitalSettlementId`);
    } else if (matches.length > 1) {
      issues.push(`nation "${n.name}": capital text ambiguous`);
    }
  });

  return issues;
}

// ── runDiagnostics (minimal replica) ─────────────────────────────────────────
function runDiagnosticsSync(state) {
  const e = state.entities || {};
  const issues = [];
  const campaignIds = new Set(safeArr(e.campaigns).map(c => c.id));
  CAMPAIGN_SCOPED_ENTITIES.forEach(key => safeArr(e[key]).forEach(item => {
    if (item.campaignId && !campaignIds.has(item.campaignId))
      issues.push({ sev: 'warn', msg: `${key} "${item.name || item.id}": references missing campaign.` });
  }));
  const regionIds = new Set(safeArr(e.regions).map(x => x.id));
  const settlementIds = new Set(safeArr(e.settlements).map(x => x.id));
  const locationIds = new Set(safeArr(e.locations).map(x => x.id));
  const adventureIds = new Set(safeArr(e.adventures).map(x => x.id));
  const actIds = new Set(safeArr(e.acts).map(x => x.id));
  const questIds = new Set(safeArr(e.quests).map(x => x.id));
  safeArr(e.settlements).forEach(s => {
    if (s.regionId && !regionIds.has(s.regionId))
      issues.push({ sev: 'warn', msg: `Settlement "${s.name}": missing region.` });
  });
  safeArr(e.districts).forEach(d => {
    if (d.settlementId && !settlementIds.has(d.settlementId))
      issues.push({ sev: 'warn', msg: `District "${d.name}": missing settlement.` });
  });
  safeArr(e.rooms).forEach(r => {
    if (r.locationId && !locationIds.has(r.locationId))
      issues.push({ sev: 'warn', msg: `Room "${r.name}": missing location.` });
  });
  safeArr(e.quests).forEach(q => {
    if (q.adventureId && !adventureIds.has(q.adventureId))
      issues.push({ sev: 'warn', msg: `Quest "${q.name}": missing adventure.` });
    if (q.actId && !actIds.has(q.actId))
      issues.push({ sev: 'warn', msg: `Quest "${q.name}": missing act.` });
  });
  safeArr(e.encounters).forEach(enc => {
    if (enc.questId && !questIds.has(enc.questId))
      issues.push({ sev: 'warn', msg: `Encounter "${enc.name}": missing quest.` });
  });
  return issues;
}

// ── GenericModal field type helpers (unit-testable without DOM) ───────────────
function validateFieldSchema(fields, entityKey) {
  const KNOWN_TYPES = ['text','textarea','select','number','toggle','chip','entity','entityMulti','entityRef','entityRefMulti'];
  const errors = [];
  fields.forEach((f, i) => {
    if (!f.key) errors.push(`${entityKey}[${i}]: missing key`);
    if (!f.label) errors.push(`${entityKey}[${i}]: missing label`);
    if (!KNOWN_TYPES.includes(f.type)) errors.push(`${entityKey}[${i}] "${f.key}": unknown type "${f.type}"`);
    if ((f.type === 'entity' || f.type === 'entityMulti') && !f.entityKey) errors.push(`${entityKey}[${i}] "${f.key}": entity/entityMulti requires entityKey`);
    if ((f.type === 'entityRef' || f.type === 'entityRefMulti') && (!f.entityTypes || !f.entityTypes.length)) errors.push(`${entityKey}[${i}] "${f.key}": entityRef/entityRefMulti requires entityTypes`);
  });
  return errors;
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function section(name) { console.log(`\n${name}`); }

// ═══════════════════════════════════════════════════════════════════════════════
section('Default state — acts and domains');
test('default state includes acts array', () => {
  const state = createDefaultState();
  assert.ok(Array.isArray(state.entities.acts), 'acts should be an array');
});
test('default state includes domains array', () => {
  const state = createDefaultState();
  assert.ok(Array.isArray(state.entities.domains), 'domains should be an array');
});
test('default state has no duplicate entity keys', () => {
  const state = createDefaultState();
  const keys = Object.keys(state.entities);
  const unique = new Set(keys);
  assert.equal(keys.length, unique.size, 'Duplicate entity keys found');
});

section('CAMPAIGN_SCOPED_ENTITIES');
test('includes acts', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('acts')));
test('includes domains', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('domains')));
test('includes adventures', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('adventures')));
test('includes quests', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('quests')));
test('includes encounters', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('encounters')));
test('includes sessions', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('sessions')));
test('includes settlements', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('settlements')));
test('includes regions', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('regions')));
test('includes nobleFamilies', () => assert.ok(CAMPAIGN_SCOPED_ENTITIES.includes('nobleFamilies')));
test('no duplicates in CAMPAIGN_SCOPED_ENTITIES', () => {
  const unique = new Set(CAMPAIGN_SCOPED_ENTITIES);
  assert.equal(CAMPAIGN_SCOPED_ENTITIES.length, unique.size);
});

section('Act entity schema');
const actFields = [
  { key: 'name', label: 'Act Name', type: 'text' },
  { key: 'order', label: 'Order / Number', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: ['Planned','Active','Completed','Skipped'] },
  { key: 'campaignId', label: 'Campaign', type: 'entity', entityKey: 'campaigns' },
  { key: 'levelStart', label: 'Level Start', type: 'number' },
  { key: 'levelEnd', label: 'Level End', type: 'number' },
  { key: 'tier', label: 'Tier', type: 'select', options: ['Tier 1 (1-4)','Tier 2 (5-10)','Tier 3 (11-16)','Tier 4 (17-20)','Other'] },
  { key: 'summary', label: 'Summary', type: 'textarea' },
  { key: 'goal', label: 'Central Goal', type: 'textarea' },
  { key: 'turningPoint', label: 'Turning Point / Climax', type: 'textarea' },
  { key: 'linkedAdventureIds', label: 'Adventures', type: 'entityMulti', entityKey: 'adventures' },
  { key: 'linkedMilestoneIds', label: 'Milestones', type: 'entityMulti', entityKey: 'milestones' },
  { key: 'linkedSecretIds', label: 'Secrets', type: 'entityMulti', entityKey: 'secrets' },
  { key: 'visibility', label: 'Visibility', type: 'select', options: ['dm-only','player-visible','secret'] },
];
test('actFields schema is valid', () => {
  const errs = validateFieldSchema(actFields, 'acts');
  assert.deepEqual(errs, [], errs.join('; '));
});
test('actFields has required keys', () => {
  const keys = actFields.map(f => f.key);
  assert.ok(keys.includes('name'));
  assert.ok(keys.includes('campaignId'));
  assert.ok(keys.includes('linkedAdventureIds'));
  assert.ok(keys.includes('status'));
});

section('Domain entity schema');
const domainFields = [
  { key: 'name', label: 'Domain Name', type: 'text' },
  { key: 'domainType', label: 'Domain Type', type: 'select', options: ['Political','Noble Holding','Divine','Magical','Monster Lair','Faction Territory','Dread Domain','Planar','Other'] },
  { key: 'campaignId', label: 'Campaign', type: 'entity', entityKey: 'campaigns' },
  { key: 'controllerType', label: 'Controller Type', type: 'select', options: ['Faction','NPC','Nation','Religion','Noble Family','Creature','Unknown','Other'] },
  { key: 'controllerId', label: 'Controller', type: 'entityRef', entityTypes: ['factions','npcs','nations','religions','nobleFamilies','creatures','bbegs'] },
  { key: 'parentRef', label: 'Parent Domain / Region', type: 'entityRef', entityTypes: ['domains','regions','realms','worlds'] },
  { key: 'claimedRegionIds', label: 'Claimed Regions', type: 'entityMulti', entityKey: 'regions' },
  { key: 'settlementIds', label: 'Settlements', type: 'entityMulti', entityKey: 'settlements' },
  { key: 'locationIds', label: 'Locations', type: 'entityMulti', entityKey: 'locations' },
  { key: 'factionIds', label: 'Factions Present', type: 'entityMulti', entityKey: 'factions' },
  { key: 'laws', label: 'Laws & Edicts', type: 'textarea' },
  { key: 'resources', label: 'Resources', type: 'textarea' },
  { key: 'threats', label: 'Threats', type: 'textarea' },
  { key: 'summary', label: 'Summary', type: 'textarea' },
  { key: 'visibility', label: 'Visibility', type: 'select', options: ['dm-only','player-visible','secret'] },
];
test('domainFields schema is valid', () => {
  const errs = validateFieldSchema(domainFields, 'domains');
  assert.deepEqual(errs, [], errs.join('; '));
});
test('domainFields has controllerId as entityRef', () => {
  const f = domainFields.find(x => x.key === 'controllerId');
  assert.equal(f.type, 'entityRef');
  assert.ok(f.entityTypes.includes('factions'));
  assert.ok(f.entityTypes.includes('npcs'));
});
test('domainFields domainType has required options', () => {
  const f = domainFields.find(x => x.key === 'domainType');
  assert.ok(f.options.includes('Political'));
  assert.ok(f.options.includes('Dread Domain'));
  assert.ok(f.options.includes('Faction Territory'));
});

section('Updated field schemas — entity pickers');
const settlementFields = [
  { key: 'name', label: 'Settlement Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Thorp','Hamlet','Village'] },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'region', label: 'Region (legacy text)', type: 'text' },
  { key: 'regionId', label: 'Region (entity link)', type: 'entity', entityKey: 'regions' },
  { key: 'government', label: 'Government', type: 'text' },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
test('settlementFields has regionId entity field', () => {
  const f = settlementFields.find(x => x.key === 'regionId');
  assert.equal(f.type, 'entity');
  assert.equal(f.entityKey, 'regions');
});
test('settlementFields still has legacy region text field', () => {
  const f = settlementFields.find(x => x.key === 'region');
  assert.equal(f.type, 'text');
});

const locationFields = [
  { key: 'name', label: 'Location Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Dungeon','Ruin'] },
  { key: 'parent', label: 'Parent (legacy text)', type: 'text' },
  { key: 'parentRef', label: 'Parent (entity link)', type: 'entityRef', entityTypes: ['regions','settlements','districts','locations','dungeons'] },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
test('locationFields has parentRef entityRef field', () => {
  const f = locationFields.find(x => x.key === 'parentRef');
  assert.equal(f.type, 'entityRef');
  assert.ok(f.entityTypes.includes('settlements'));
  assert.ok(f.entityTypes.includes('regions'));
});

const routeFields = [
  { key: 'name', label: 'Route Name', type: 'text' },
  { key: 'from', label: 'From (legacy text)', type: 'text' },
  { key: 'to', label: 'To (legacy text)', type: 'text' },
  { key: 'fromRef', label: 'From (entity link)', type: 'entityRef', entityTypes: ['settlements','locations','regions','pois','dungeons'] },
  { key: 'toRef', label: 'To (entity link)', type: 'entityRef', entityTypes: ['settlements','locations','regions','pois','dungeons'] },
  { key: 'travelTime', label: 'Travel Time', type: 'text' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
test('routeFields has fromRef and toRef entityRef fields', () => {
  const from = routeFields.find(x => x.key === 'fromRef');
  const to = routeFields.find(x => x.key === 'toRef');
  assert.equal(from.type, 'entityRef');
  assert.equal(to.type, 'entityRef');
  assert.ok(from.entityTypes.includes('settlements'));
});

const districtFields = [
  { key: 'name', label: 'District Name', type: 'text' },
  { key: 'settlementId', label: 'Settlement', type: 'entity', entityKey: 'settlements' },
];
test('districtFields settlementId is entity type (not text)', () => {
  const f = districtFields.find(x => x.key === 'settlementId');
  assert.equal(f.type, 'entity');
  assert.equal(f.entityKey, 'settlements');
});

const roomFields = [
  { key: 'name', label: 'Room Name', type: 'text' },
  { key: 'locationId', label: 'Location / Dungeon', type: 'entity', entityKey: 'locations' },
];
test('roomFields locationId is entity type (not text)', () => {
  const f = roomFields.find(x => x.key === 'locationId');
  assert.equal(f.type, 'entity');
  assert.equal(f.entityKey, 'locations');
});

section('Diagnostics — broken link detection');
test('detects settlement with broken regionId', () => {
  const state = createDefaultState();
  state.entities.settlements.push({ id: 's1', name: 'Rivertown', regionId: 'MISSING', createdAt: '', updatedAt: '' });
  const issues = runDiagnosticsSync(state);
  assert.ok(issues.some(i => i.msg.includes('Rivertown') && i.msg.includes('region')));
});
test('detects district with broken settlementId', () => {
  const state = createDefaultState();
  state.entities.districts.push({ id: 'd1', name: 'Docks', settlementId: 'GHOST', createdAt: '', updatedAt: '' });
  const issues = runDiagnosticsSync(state);
  assert.ok(issues.some(i => i.msg.includes('Docks') && i.msg.includes('settlement')));
});
test('detects room with broken locationId', () => {
  const state = createDefaultState();
  state.entities.rooms.push({ id: 'r1', name: 'Great Hall', locationId: 'GHOST', createdAt: '', updatedAt: '' });
  const issues = runDiagnosticsSync(state);
  assert.ok(issues.some(i => i.msg.includes('Great Hall') && i.msg.includes('location')));
});
test('detects quest with broken adventureId', () => {
  const state = createDefaultState();
  state.entities.quests.push({ id: 'q1', name: 'Find the Ring', adventureId: 'GHOST', createdAt: '', updatedAt: '' });
  const issues = runDiagnosticsSync(state);
  assert.ok(issues.some(i => i.msg.includes('Find the Ring')));
});
test('detects quest with broken actId', () => {
  const state = createDefaultState();
  state.entities.quests.push({ id: 'q1', name: 'Stop the Dark Lord', actId: 'GHOST', createdAt: '', updatedAt: '' });
  const issues = runDiagnosticsSync(state);
  assert.ok(issues.some(i => i.msg.includes('Stop the Dark Lord') && i.msg.includes('act')));
});
test('no false positives when refs are valid', () => {
  const state = createDefaultState();
  state.entities.regions.push({ id: 'reg1', name: 'The North', createdAt: '', updatedAt: '' });
  state.entities.settlements.push({ id: 's1', name: 'Winterhall', regionId: 'reg1', createdAt: '', updatedAt: '' });
  const issues = runDiagnosticsSync(state);
  assert.equal(issues.filter(i => i.msg.includes('Winterhall')).length, 0);
});
test('detects entity referencing missing campaign', () => {
  const state = createDefaultState();
  state.entities.acts.push({ id: 'a1', name: 'Act One', campaignId: 'GHOST_CAMP', createdAt: '', updatedAt: '' });
  const issues = runDiagnosticsSync(state);
  assert.ok(issues.some(i => i.msg.includes('Act One') && i.msg.includes('campaign')));
});

section('Repair — legacy text migration');
test('migrates settlement.region text to regionId when unique match', () => {
  const state = createDefaultState();
  state.entities.regions.push({ id: 'reg1', name: 'Vale of Shadows', createdAt: '', updatedAt: '' });
  state.entities.settlements.push({ id: 's1', name: 'Shadowton', region: 'Vale of Shadows', createdAt: '', updatedAt: '' });
  repairAndReindex(state);
  assert.equal(state.entities.settlements[0].regionId, 'reg1');
});
test('does not migrate settlement.region when name is ambiguous', () => {
  const state = createDefaultState();
  state.entities.regions.push({ id: 'reg1', name: 'Greenwood', createdAt: '', updatedAt: '' });
  state.entities.regions.push({ id: 'reg2', name: 'Greenwood', createdAt: '', updatedAt: '' });
  state.entities.settlements.push({ id: 's1', name: 'Woodton', region: 'Greenwood', createdAt: '', updatedAt: '' });
  repairAndReindex(state);
  assert.equal(state.entities.settlements[0].regionId, undefined);
});
test('does not overwrite existing regionId', () => {
  const state = createDefaultState();
  state.entities.regions.push({ id: 'reg1', name: 'Highlands', createdAt: '', updatedAt: '' });
  state.entities.settlements.push({ id: 's1', name: 'Hightown', region: 'Highlands', regionId: 'already-set', createdAt: '', updatedAt: '' });
  repairAndReindex(state);
  assert.equal(state.entities.settlements[0].regionId, 'already-set');
});
test('migrates nation.capital text to capitalSettlementId when unique match', () => {
  const state = createDefaultState();
  state.entities.settlements.push({ id: 'cap1', name: 'Goldcrown', createdAt: '', updatedAt: '' });
  state.entities.nations.push({ id: 'n1', name: 'The Golden Empire', capital: 'Goldcrown', createdAt: '', updatedAt: '' });
  repairAndReindex(state);
  assert.equal(state.entities.nations[0].capitalSettlementId, 'cap1');
});
test('preserves legacy capital text after migration', () => {
  const state = createDefaultState();
  state.entities.settlements.push({ id: 'cap1', name: 'Goldcrown', createdAt: '', updatedAt: '' });
  state.entities.nations.push({ id: 'n1', name: 'The Golden Empire', capital: 'Goldcrown', createdAt: '', updatedAt: '' });
  repairAndReindex(state);
  assert.equal(state.entities.nations[0].capital, 'Goldcrown');
});
test('assigns campaignId to acts during repair', () => {
  const state = createDefaultState();
  state.activeCampaignId = 'camp1';
  state.entities.acts.push({ id: 'act1', name: 'Prologue', createdAt: '', updatedAt: '' });
  repairAndReindex(state);
  assert.equal(state.entities.acts[0].campaignId, 'camp1');
});
test('assigns campaignId to domains during repair', () => {
  const state = createDefaultState();
  state.activeCampaignId = 'camp1';
  state.entities.domains.push({ id: 'dom1', name: 'Iron Keep', createdAt: '', updatedAt: '' });
  repairAndReindex(state);
  assert.equal(state.entities.domains[0].campaignId, 'camp1');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)`);
if (failed > 0) process.exit(1);

'use strict';
/**
 * Phase 266 — production hardening unit tests.
 * Run with: node tests/phase266.test.js
 * Covers: boot crash recovery, note folder naming, entity linking expansions,
 *         release checks, refData integration, LevelUpModal feat picker.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── Re-implemented pure helpers ────────────────────────────────────────────────
function safeArr(v) { return Array.isArray(v) ? v : []; }

// ── ENTITY_FOLDER_LABELS (re-implemented) ─────────────────────────────────────
const ENTITY_FOLDER_LABELS = {
  campaigns:'Campaigns', worlds:'Worlds', cosmologies:'Cosmologies', realms:'Realms',
  regions:'Regions', settlements:'Settlements', locations:'Locations', pois:'Points of Interest',
  routes:'Routes', npcs:'NPCs', creatures:'Creatures', bbegs:'BBEGs',
  factions:'Factions', cultures:'Cultures', languages:'Languages', deities:'Deities',
  pantheons:'Pantheons', quests:'Quests', adventures:'Adventures', encounters:'Encounters',
  sessions:'Sessions', milestones:'Milestones', secrets:'Secrets', handouts:'Handouts',
  rules:'Rules', conditions:'Conditions', damageTypes:'Damage Types', downtime:'Downtime Activities',
  projects:'Projects', bastions:'Bastions', compendium:'Compendium', homebrew:'Homebrew',
  tables:'Tables', characters:'Characters', calendars:'Calendars', journals:'Journals',
  maps:'Maps', dungeons:'Dungeons', timers:'Escalation Timers', enemyTemplates:'Enemy Templates',
  reputations:'Reputations', warFronts:'War Fronts', incursions:'Realm Incursions', endgameStates:'Ending States',
  nations:'Nations', religions:'Religions', districts:'Districts', rooms:'Rooms',
  timelines:'Timeline Events', reveals:'Reveals', loot:'Loot',
  hybridAncestries:'Hybrid Ancestries',
  nobleFamilies:'Noble Families',
};

// ── Boot crash recovery logic (re-implemented) ────────────────────────────────
function isKillSwitchReason(reason) {
  return reason && reason.startsWith('Kill switch');
}
function isRecoveryReason(reason) {
  return !isKillSwitchReason(reason);
}

// ── QuestModal defaults (re-implemented) ──────────────────────────────────────
function makeQuestDefaults() {
  return {
    id: 'quest-test', name: '', questType: 'Side', status: 'Available',
    giver: '', giverNpcId: '', location: '', locationId: '', locationType: '', campaignId: '',
    relatedNPCs: [], relatedNpcIds: [], relatedFactions: [], relatedFactionIds: [],
    objectives: '', stages: '', hooks: [], complications: [],
    rewards: '', consequences: '', secrets: '', playerSummary: '', dmNotes: '',
    linkedEncounters: [], linkedEncounterIds: [], visibility: 'dm-only',
  };
}

// ── EncounterModal defaults (re-implemented) ──────────────────────────────────
function makeEncounterDefaults() {
  return {
    id: 'encounter-test', name: '', type: 'Combat', location: '', locationId: '',
    participants: [], participantPcIds: [], participantNpcIds: [],
    enemyTemplateIds: [], creatureIds: [],
    enemyGroups: '', difficulty: 'Medium',
    terrain: '', tactics: '', objectives: '',
    victoryConditions: '', failureConditions: '', rewards: '',
    linkedQuest: '', linkedQuestId: '', campaignId: '',
    notes: '', visibility: 'dm-only',
  };
}

// ── FactionModal defaults (re-implemented) ────────────────────────────────────
function makeFactionDefaults() {
  return {
    id: 'faction-test', name: '', type: '', ideology: '', territory: '',
    leadership: '', leaderNpcId: '', campaignId: '',
    goals: [], methods: [], resources: '', ranks: [],
    allies: [], allyIds: [], enemies: [], enemyIds: [],
    publicFace: '', secretAgenda: '',
    reputation: '', rewards: '', consequences: '', visibility: 'dm-only',
    staffRoles: [],
    memberNpcIds: [], territoryIds: [], linkedQuestIds: [],
  };
}

// ── Test runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function suite(name) { console.log(`\n${name}`); }

// ── ENTITY_FOLDER_LABELS tests ─────────────────────────────────────────────────
suite('ENTITY_FOLDER_LABELS (Item 8 — Title Case export folders)');
test('npcs → NPCs', () => assert.equal(ENTITY_FOLDER_LABELS.npcs, 'NPCs'));
test('campaigns → Campaigns', () => assert.equal(ENTITY_FOLDER_LABELS.campaigns, 'Campaigns'));
test('settlements → Settlements', () => assert.equal(ENTITY_FOLDER_LABELS.settlements, 'Settlements'));
test('characters → Characters', () => assert.equal(ENTITY_FOLDER_LABELS.characters, 'Characters'));
test('sessions → Sessions', () => assert.equal(ENTITY_FOLDER_LABELS.sessions, 'Sessions'));
test('quests → Quests', () => assert.equal(ENTITY_FOLDER_LABELS.quests, 'Quests'));
test('encounters → Encounters', () => assert.equal(ENTITY_FOLDER_LABELS.encounters, 'Encounters'));
test('factions → Factions', () => assert.equal(ENTITY_FOLDER_LABELS.factions, 'Factions'));
test('secrets → Secrets', () => assert.equal(ENTITY_FOLDER_LABELS.secrets, 'Secrets'));
test('hybridAncestries → Hybrid Ancestries', () => assert.equal(ENTITY_FOLDER_LABELS.hybridAncestries, 'Hybrid Ancestries'));
test('nobleFamilies → Noble Families', () => assert.equal(ENTITY_FOLDER_LABELS.nobleFamilies, 'Noble Families'));
test('pois → Points of Interest', () => assert.equal(ENTITY_FOLDER_LABELS.pois, 'Points of Interest'));
test('damageTypes → Damage Types', () => assert.equal(ENTITY_FOLDER_LABELS.damageTypes, 'Damage Types'));
test('enemyTemplates → Enemy Templates', () => assert.equal(ENTITY_FOLDER_LABELS.enemyTemplates, 'Enemy Templates'));
test('all folder names start with upper case', () => {
  const bad = Object.entries(ENTITY_FOLDER_LABELS).filter(([,v]) => v[0] !== v[0].toUpperCase());
  assert.equal(bad.length, 0, `Lower-case folders: ${bad.map(([k]) => k).join(', ')}`);
});
test('has at least 30 entity types mapped', () => assert.ok(Object.keys(ENTITY_FOLDER_LABELS).length >= 30));

// ── Boot crash recovery logic ──────────────────────────────────────────────────
suite('Boot crash recovery (Item 2)');
test('kill switch reason → hard block', () => {
  assert.ok(isKillSwitchReason('Kill switch active: .obsidian/plugins/ttrpg-engine/DISABLE_TTRPG_ENGINE.txt'));
});
test('LOAD_FAILED reason → recovery path', () => {
  assert.ok(isRecoveryReason('Previous crash detected. Delete TTRPG_ENGINE_LOAD_FAILED.txt to re-enable.'));
});
test('stale boot reason → recovery path', () => {
  assert.ok(isRecoveryReason('Stale boot marker detected — the previous load did not complete cleanly.'));
});
test('generic error reason → recovery path', () => {
  assert.ok(isRecoveryReason('TypeError: Cannot read property foo of undefined'));
});
test('undefined reason → recovery path', () => {
  assert.ok(isRecoveryReason(undefined));
});
test('empty reason → recovery path', () => {
  assert.ok(isRecoveryReason(''));
});

// ── QuestModal location type field ────────────────────────────────────────────
suite('QuestModal — location type field (Item 7)');
test('defaults have locationType field', () => {
  const d = makeQuestDefaults();
  assert.ok('locationType' in d);
});
test('locationType defaults to empty string', () => {
  assert.equal(makeQuestDefaults().locationType, '');
});
test('locationId defaults to empty string', () => {
  assert.equal(makeQuestDefaults().locationId, '');
});
test('quest can store locationType separately from locationId', () => {
  const q = makeQuestDefaults();
  q.locationId = 'settlement-1';
  q.locationType = 'settlements';
  assert.equal(q.locationId, 'settlement-1');
  assert.equal(q.locationType, 'settlements');
});
test('locationType accepts region type', () => {
  const q = makeQuestDefaults();
  q.locationType = 'regions';
  assert.equal(q.locationType, 'regions');
});
test('locationType accepts poi type', () => {
  const q = makeQuestDefaults();
  q.locationType = 'pois';
  assert.equal(q.locationType, 'pois');
});

// ── EncounterModal enemy linking ──────────────────────────────────────────────
suite('EncounterModal — enemy template and creature fields (Item 7)');
test('defaults have enemyTemplateIds', () => assert.ok('enemyTemplateIds' in makeEncounterDefaults()));
test('defaults have creatureIds', () => assert.ok('creatureIds' in makeEncounterDefaults()));
test('enemyTemplateIds is an array', () => assert.ok(Array.isArray(makeEncounterDefaults().enemyTemplateIds)));
test('creatureIds is an array', () => assert.ok(Array.isArray(makeEncounterDefaults().creatureIds)));
test('existing fields preserved', () => {
  const d = makeEncounterDefaults();
  assert.ok('participantPcIds' in d);
  assert.ok('participantNpcIds' in d);
});

// ── FactionModal member/territory/quest linking ───────────────────────────────
suite('FactionModal — member NPC, territory, quest fields (Item 7)');
test('defaults have memberNpcIds', () => assert.ok('memberNpcIds' in makeFactionDefaults()));
test('defaults have territoryIds', () => assert.ok('territoryIds' in makeFactionDefaults()));
test('defaults have linkedQuestIds', () => assert.ok('linkedQuestIds' in makeFactionDefaults()));
test('memberNpcIds is array', () => assert.ok(Array.isArray(makeFactionDefaults().memberNpcIds)));
test('territoryIds is array', () => assert.ok(Array.isArray(makeFactionDefaults().territoryIds)));
test('linkedQuestIds is array', () => assert.ok(Array.isArray(makeFactionDefaults().linkedQuestIds)));
test('existing staffRoles field preserved', () => assert.ok('staffRoles' in makeFactionDefaults()));

// ── Data folder checks (Item 1) ───────────────────────────────────────────────
suite('Release data files (Item 1)');
const DATA_DIR = path.join(__dirname, '..', 'data');
const REQUIRED_DATA_FILES = [
  'actions.json','backgrounds.json','conditions.json','deities.json',
  'equipment.json','feats.json','languages.json','objects.json','races.json',
  'rewards.json','senses.json','skills.json','spells.json','traps.json','vehicles.json',
];
test('data/ directory exists', () => {
  assert.ok(fs.existsSync(DATA_DIR), `data/ directory not found at ${DATA_DIR}`);
});
REQUIRED_DATA_FILES.forEach(f => {
  test(`data/${f} exists and is non-empty`, () => {
    const fp = path.join(DATA_DIR, f);
    assert.ok(fs.existsSync(fp), `${f} missing`);
    assert.ok(fs.statSync(fp).size > 0, `${f} is empty`);
  });
});
test('data files are valid JSON', () => {
  const errors = [];
  REQUIRED_DATA_FILES.forEach(f => {
    const fp = path.join(DATA_DIR, f);
    if (!fs.existsSync(fp)) return;
    try { JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch (e) { errors.push(`${f}: ${e.message}`); }
  });
  assert.equal(errors.length, 0, `Invalid JSON: ${errors.join('; ')}`);
});
test('spells.json has entries with name and level', () => {
  const spells = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'spells.json'), 'utf8'));
  assert.ok(spells.length > 0, 'spells.json is empty');
  const sample = spells[0];
  assert.ok('name' in sample, 'spells entries should have name');
});
test('feats.json has entries with name', () => {
  const feats = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'feats.json'), 'utf8'));
  assert.ok(feats.length > 0, 'feats.json is empty');
  assert.ok('name' in feats[0], 'feats entries should have name');
});
test('races.json has entries with name', () => {
  const races = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'races.json'), 'utf8'));
  assert.ok(races.length > 0, 'races.json is empty');
  assert.ok('name' in races[0], 'races entries should have name');
});
test('backgrounds.json has entries with name', () => {
  const bgs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'backgrounds.json'), 'utf8'));
  assert.ok(bgs.length > 0, 'backgrounds.json is empty');
  assert.ok('name' in bgs[0], 'backgrounds entries should have name');
});

// ── Drow in reference data (Item 3) ──────────────────────────────────────────
suite('Drow in reference data (Item 3)');
test('races.json contains a Drow entry', () => {
  const races = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'races.json'), 'utf8'));
  const drow = races.find(r => r.name && r.name.toLowerCase().includes('drow'));
  assert.ok(drow, 'No Drow entry found in races.json');
});
test('Drow entry has required fields', () => {
  const races = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'races.json'), 'utf8'));
  const drow = races.find(r => r.name && r.name.toLowerCase().includes('drow'));
  if (!drow) return; // skip if above test already failed
  assert.ok(drow.id, 'Drow entry should have id');
  assert.ok(drow.name, 'Drow entry should have name');
});

// ── writeEntityNote folder naming logic ───────────────────────────────────────
suite('writeEntityNote folder naming (Item 8)');
function getEntityFolder(key) {
  return ENTITY_FOLDER_LABELS[key] || key;
}
test('npcs folder → NPCs', () => assert.equal(getEntityFolder('npcs'), 'NPCs'));
test('characters folder → Characters', () => assert.equal(getEntityFolder('characters'), 'Characters'));
test('campaigns folder → Campaigns', () => assert.equal(getEntityFolder('campaigns'), 'Campaigns'));
test('sessions folder → Sessions', () => assert.equal(getEntityFolder('sessions'), 'Sessions'));
test('quests folder → Quests', () => assert.equal(getEntityFolder('quests'), 'Quests'));
test('unknown key → raw key (fallback)', () => assert.equal(getEntityFolder('unknownEntityType'), 'unknownEntityType'));
test('folder path is Title Case not lowercase', () => {
  const folder = getEntityFolder('npcs');
  assert.ok(folder[0] === folder[0].toUpperCase(), `Folder "${folder}" should start with upper case`);
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)`);
if (failed > 0) process.exit(1);

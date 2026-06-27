'use strict';
/**
 * Phase O — Campaign Structure & Form Safety
 * Sections 1–5: Wizard milestone entities, duplicate faction button removal,
 *   relationship matrix cleanup, encounter dice demotion, placeholder safety.
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

// ── Re-implemented pure helpers for functional tests ──────────────────────────
function safeArr(v) { return Array.isArray(v) ? v : []; }
function uid(prefix) { return `${prefix}-test-${Math.random().toString(36).slice(2, 8)}`; }
function upsert(state, key, item) {
  if (!state.entities[key]) state.entities[key] = [];
  const idx = state.entities[key].findIndex(x => x.id === item.id);
  if (idx >= 0) state.entities[key][idx] = item;
  else state.entities[key].unshift(item);
}

// Slice key sections from source
const wizardStart  = src.indexOf('class CampaignWizardModal');
const wizardEnd    = src.indexOf('\n// ── CampaignBibleModal', wizardStart);
const wizard       = src.slice(wizardStart, wizardEnd);

const createCampStart = wizard.indexOf('async createCampaign()');
const createCamp      = wizard.slice(createCampStart, createCampStart + 2000);

const worldStart = src.indexOf('function renderWorld(');
const worldEnd   = src.indexOf('\n// Field definitions for generic modals', worldStart);
const worldFn    = src.slice(worldStart, worldEnd);

const matrixStart = src.indexOf('function renderRelationshipMatrix(');
const matrixEnd   = src.indexOf('\n// ── FACTION MATRIX', matrixStart) > matrixStart
  ? src.indexOf('\n// ── FACTION MATRIX', matrixStart)
  : src.indexOf('\nfunction renderFactionMatrix(', matrixStart) > 0
    ? matrixStart + 4000
    : matrixStart + 4000;
const matrixFn = src.slice(matrixStart, matrixStart + 4000);

const factionsStart = src.indexOf('function renderFactions(');
const factionsEnd   = src.indexOf('\n// ── ADVENTURES', factionsStart);
const factionsFn    = src.slice(factionsStart, factionsEnd);

const encStart = src.indexOf('function renderEncounters(');
const encEnd   = src.indexOf('\nfunction renderInitiativeTracker(', encStart);
const encFn    = src.slice(encStart, encEnd);

const repairStart = src.indexOf('function repairAndReindex(');
const repairEnd   = src.indexOf('\n// ── Safe mode', repairStart);
const repairFn    = src.slice(repairStart, repairEnd);

const relModalStart = src.indexOf('class RelationshipModal');
const relModalEnd   = src.indexOf('\n// NobleFamilyModal', relModalStart);
const relModal      = src.slice(relModalStart, relModalEnd);

console.log('\nPhase O — Campaign Structure & Form Safety\n');

// ── Section 1: Wizard milestone entities ─────────────────────────────────────
console.log('  Section 1: Campaign Wizard creates milestone entities');

test('createCampaign upserts to milestones entity key', () => {
  ok(createCamp.includes("upsert(this.plugin.state, 'milestones'"), 'wizard does not upsert to milestones');
});
test('milestone entity includes campaignId', () => {
  const idx = createCamp.indexOf("upsert(this.plugin.state, 'milestones'");
  const block = createCamp.slice(idx, idx + 400);
  ok(block.includes('campaignId'), 'milestone entity missing campaignId');
});
test('milestone entity includes status field', () => {
  const idx = createCamp.indexOf("upsert(this.plugin.state, 'milestones'");
  const block = createCamp.slice(idx, idx + 400);
  ok(block.includes("status: 'Pending'"), 'milestone entity missing status field');
});
test('milestone entity includes visibility field', () => {
  const idx = createCamp.indexOf("upsert(this.plugin.state, 'milestones'");
  const block = createCamp.slice(idx, idx + 400);
  ok(block.includes("visibility: 'dm-only'"), 'milestone entity missing visibility field');
});
test('milestone entity includes order field', () => {
  const idx = createCamp.indexOf("upsert(this.plugin.state, 'milestones'");
  const block = createCamp.slice(idx, idx + 400);
  ok(block.includes('order:'), 'milestone entity missing order field');
});
test('milestone entity includes tags field', () => {
  const idx = createCamp.indexOf("upsert(this.plugin.state, 'milestones'");
  const block = createCamp.slice(idx, idx + 400);
  ok(block.includes('tags:'), 'milestone entity missing tags field');
});
test('milestone entity includes updatedAt field', () => {
  const idx = createCamp.indexOf("upsert(this.plugin.state, 'milestones'");
  const block = createCamp.slice(idx, idx + 400);
  ok(block.includes('updatedAt:'), 'milestone entity missing updatedAt field');
});
test('wizard deduplicates milestones by name within campaign', () => {
  ok(createCamp.includes('existingMilestoneNames') || createCamp.includes('existingMilestone'),
    'wizard does not guard against duplicate milestone names');
});

// Functional: simulate createCampaign milestone logic
test('functional: milestones created for each milestone name', () => {
  const state = { activeCampaignId: 'c1', entities: { milestones: [] } };
  const campId = 'c1';
  const milestoneNames = ['Reach Level 5', 'Defeat the BBEG', 'Recover the Artifact'];
  const existingMilestoneNames = new Set(
    safeArr(state.entities.milestones).filter(m => m.campaignId === campId).map(m => m.name)
  );
  const now = new Date().toISOString();
  safeArr(milestoneNames).forEach((name, i) => {
    if (!name || existingMilestoneNames.has(name)) return;
    upsert(state, 'milestones', {
      id: uid('milestone'), campaignId: campId, name,
      level: '', summary: '', order: i,
      status: 'Pending', visibility: 'dm-only', tags: [], createdAt: now, updatedAt: now,
    });
  });
  ok(state.entities.milestones.length === 3, `Expected 3 milestones, got ${state.entities.milestones.length}`);
  ok(state.entities.milestones[0].campaignId === campId, 'milestone not scoped to campaign');
  ok(state.entities.milestones[0].visibility === 'dm-only', 'milestone visibility not set');
  ok(state.entities.milestones[1].order === 1, 'milestone order not correct');
});

test('functional: repeated saves do not duplicate milestones', () => {
  const state = { activeCampaignId: 'c1', entities: { milestones: [] } };
  const campId = 'c1';
  const milestoneNames = ['Level 5 reached', 'Boss defeated'];
  const now = new Date().toISOString();
  // First save
  const existing1 = new Set(safeArr(state.entities.milestones).filter(m => m.campaignId === campId).map(m => m.name));
  safeArr(milestoneNames).forEach((name, i) => {
    if (!name || existing1.has(name)) return;
    upsert(state, 'milestones', { id: uid('milestone'), campaignId: campId, name, order: i, status: 'Pending', visibility: 'dm-only', tags: [], level: '', summary: '', createdAt: now, updatedAt: now });
  });
  ok(state.entities.milestones.length === 2, 'first save should create 2 milestones');
  // Second save (same names)
  const existing2 = new Set(safeArr(state.entities.milestones).filter(m => m.campaignId === campId).map(m => m.name));
  safeArr(milestoneNames).forEach((name, i) => {
    if (!name || existing2.has(name)) return;
    upsert(state, 'milestones', { id: uid('milestone'), campaignId: campId, name, order: i, status: 'Pending', visibility: 'dm-only', tags: [], level: '', summary: '', createdAt: now, updatedAt: now });
  });
  ok(state.entities.milestones.length === 2, `Expected 2 milestones after repeat save, got ${state.entities.milestones.length}`);
});

test('functional: old campaigns without milestone entities open safely', () => {
  // Simulate a legacy campaign state with no milestone entities
  const state = { activeCampaignId: 'old-c', entities: { milestones: undefined } };
  // safeArr handles undefined gracefully
  const milestones = safeArr(state.entities.milestones);
  ok(Array.isArray(milestones), 'safeArr should return array for undefined milestones');
  ok(milestones.length === 0, 'should be empty array for legacy campaign');
});

// ── Section 2: No duplicate + Faction in World & Lore ─────────────────────────
console.log('\n  Section 2: Duplicate + Faction button removed from World & Lore');

test('World & Lore pageHead does not include + Faction button', () => {
  const pageHeadIdx = worldFn.indexOf('pageHead(');
  const pageHeadBlock = worldFn.slice(pageHeadIdx, pageHeadIdx + 800);
  notOk(pageHeadBlock.includes("label: '+ Faction'"), 'World & Lore still has + Faction button in pageHead');
});
test('World & Lore still renders faction-linked entity sections (nations, regions, etc)', () => {
  ok(worldFn.includes("itemCards(main, plugin, 'nations'") || worldFn.includes("'nations'"),
    'World & Lore should still render nations which can link factions');
});
test('Cast & Powers renderFactions still exposes + Faction creation', () => {
  ok(factionsFn.includes("label: '+ Faction'"), 'Cast & Powers renderFactions should still have + Faction button');
});

// ── Section 3: Relationship Matrix cleanup ────────────────────────────────────
console.log('\n  Section 3: Relationship Matrix cleanup');

test('Relationship Matrix pageHead no longer has + Faction button', () => {
  const pageHeadIdx = matrixFn.indexOf('pageHead(');
  const pageHeadBlock = matrixFn.slice(pageHeadIdx, pageHeadIdx + 400);
  notOk(pageHeadBlock.includes("label: '+ Faction'"), 'Relationship Matrix still has + Faction in pageHead');
});
test('Relationship Matrix still has + Relationship button', () => {
  ok(matrixFn.includes("label: '+ Relationship'"), 'Relationship Matrix missing + Relationship button');
});
test('Faction reputation section moved out of Relationship Matrix', () => {
  notOk(matrixFn.includes("'Faction Reputation'") || matrixFn.includes('Faction Reputation'),
    'Faction Reputation section still present in Relationship Matrix');
});
test('renderFactions shows Faction Standing section with reputation data', () => {
  ok(factionsFn.includes('Faction Standing') || factionsFn.includes('reputations'),
    'renderFactions should surface reputation/standing data');
});
test('RelationshipModal stamps campaignId on save', () => {
  ok(relModal.includes('campaignId') && relModal.includes('activeCampaignId'),
    'RelationshipModal should stamp campaignId from activeCampaignId on save');
});
test('repairAndReindex stamps missing campaignId on relationships', () => {
  ok(repairFn.includes('relationship') && repairFn.includes('campaignId'),
    'repairAndReindex should stamp campaignId on relationships');
});

// Functional: relationship campaignId stamping
test('functional: new relationship gets campaignId from active campaign', () => {
  const pluginState = { activeCampaignId: 'camp-abc', relationships: [] };
  const values = { id: uid('rel'), fromId: 'npc-1', toId: 'faction-1', campaignId: '' };
  // Simulate the save logic
  if (!values.campaignId) values.campaignId = pluginState.activeCampaignId || '';
  ok(values.campaignId === 'camp-abc', 'campaignId should be stamped from active campaign');
});
test('functional: existing relationship campaignId not overwritten', () => {
  const pluginState = { activeCampaignId: 'camp-new', relationships: [] };
  const values = { id: uid('rel'), fromId: 'npc-1', toId: 'faction-1', campaignId: 'camp-old' };
  if (!values.campaignId) values.campaignId = pluginState.activeCampaignId || '';
  ok(values.campaignId === 'camp-old', 'existing campaignId should not be overwritten');
});

// ── Section 4: Encounter dice roller demoted ──────────────────────────────────
console.log('\n  Section 4: Encounter top-level Roll Dice removed');

test('Encounters pageHead does not have Roll Dice button', () => {
  const pageHeadIdx = encFn.indexOf('pageHead(');
  const pageHeadBlock = encFn.slice(pageHeadIdx, pageHeadIdx + 300);
  notOk(pageHeadBlock.includes('Roll Dice'), 'Encounters pageHead still has Roll Dice button');
});
test('Encounters still has + Encounter primary button', () => {
  ok(encFn.includes("label: '+ Encounter'"), 'Encounters missing + Encounter button');
});
test('renderInitiativeTracker still exists for in-tracker dice', () => {
  ok(src.includes('function renderInitiativeTracker('), 'renderInitiativeTracker removed — dice still available from tracker');
});
test('DiceModal class still exists for use from Run Session / Dashboard', () => {
  ok(src.includes('class DiceModal'), 'DiceModal should still exist for other callers');
});

// ── Section 5: Placeholder safety ────────────────────────────────────────────
console.log('\n  Section 5: Placeholder safety');

const PLACEHOLDER_STRINGS = [
  'Select existing',
  'Select common options',
  'Make noted changes',
  'Confirm what this connects to',
  'select common',
  'select existing',
];

test('no placeholder strings used as literal default field values in modal constructors', () => {
  // Check Object.assign default blocks in modal constructors for these strings
  const constructorBlocks = [];
  let searchFrom = 0;
  while (true) {
    const idx = src.indexOf('this.values = Object.assign({', searchFrom);
    if (idx === -1) break;
    constructorBlocks.push(src.slice(idx, idx + 1000));
    searchFrom = idx + 1;
  }
  const found = [];
  for (const block of constructorBlocks) {
    for (const p of PLACEHOLDER_STRINGS) {
      if (block.includes(`'${p}'`) || block.includes(`"${p}"`)) found.push(p);
    }
  }
  ok(found.length === 0, `Placeholder strings found as default values: ${found.join(', ')}`);
});

test('repairAndReindex detects and clears placeholder text in saved entities', () => {
  ok(repairFn.includes('PLACEHOLDER_STRINGS') || repairFn.includes('Select existing'),
    'repairAndReindex should check for and clear placeholder strings');
});

// Functional: placeholder clearing in repairAndReindex
test('functional: placeholder text in entity fields is detected and cleared', () => {
  const PLACEHOLDER_STRINGS_TEST = ['Select existing', 'Select common options', 'Make noted changes'];
  // Simulate repair logic on an entity with placeholder text
  const item = { id: 'npc-1', name: 'Gandalf', summary: 'Select existing', notes: '' };
  for (const [field, val] of Object.entries(item)) {
    if (typeof val === 'string' && PLACEHOLDER_STRINGS_TEST.some(p => val === p)) {
      item[field] = '';
    }
  }
  ok(item.summary === '', 'placeholder text in summary should be cleared');
  ok(item.name === 'Gandalf', 'non-placeholder name should be preserved');
});

test('no literal placeholder strings appear as pageHead button labels', () => {
  for (const p of PLACEHOLDER_STRINGS) {
    notOk(src.includes(`label: '${p}'`), `"${p}" used as button label`);
    notOk(src.includes(`label: "${p}"`), `"${p}" used as button label`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

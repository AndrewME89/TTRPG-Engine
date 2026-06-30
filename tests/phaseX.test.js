'use strict';
/**
 * Phase X — data.json QA Notes Cleanup & Field Hygiene
 * Coverage: legacy field hiding, QA note scrubbing, active-campaign saves,
 * and structured reference display wiring.
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
function eq(a, b, msg) { assert.equal(a, b, msg); }
function notOk(cond, msg) { assert.ok(!cond, msg); }

console.log('\nPhase X — data.json QA Notes Cleanup & Field Hygiene\n');

console.log('  Section 1: Shared sanitisation');

test('QA placeholder helper exists', () => {
  ok(src.includes('const QA_PLACEHOLDER_VALUES = new Set(['), 'QA placeholder set missing');
  ok(src.includes('function sanitizeQaNotesValue('), 'sanitizeQaNotesValue missing');
});

const QA_PLACEHOLDER_VALUES = new Set([
  'remove legacy field',
  'complete noted changes',
  'change to custom input + common options selector',
  'selector for existing entities',
  'should be able to select existing secrets',
  'rollable stats + calculation should be available',
]);
function isQaPlaceholderValue(value) {
  return QA_PLACEHOLDER_VALUES.has(String(value || '').trim().toLowerCase());
}
function sanitizeQaNotesValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeQaNotesValue).filter(v => v !== '' && v != null);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeQaNotesValue(v)]));
  if (typeof value === 'string') return isQaPlaceholderValue(value) ? '' : value;
  return value;
}
test('functional: exact QA note strings are not preserved as saved values', () => {
  eq(sanitizeQaNotesValue('Remove legacy field'), '');
  eq(sanitizeQaNotesValue(['Complete noted changes', 'Real Note']).join('|'), 'Real Note');
});

console.log('\n  Section 2: GenericModal hygiene');

test('GenericModal hides legacy fields from normal forms', () => {
  ok(src.includes('if (f.legacy) return;'), 'GenericModal legacy guard missing');
});
test('GenericModal normalises chip-backed values before rendering', () => {
  ok(src.includes("chipField(el, f.label, normalizeListField(this.values[f.key])"), 'GenericModal chip normalization missing');
});
test('GenericModal stamps active campaign for campaign-scoped entities', () => {
  ok(src.includes("if (CAMPAIGN_SCOPED_ENTITIES.includes(this.key) && !this.values.campaignId)"), 'GenericModal campaign stamping missing');
});

console.log('\n  Section 3: Legacy field arrays hidden from UI');

[
  "planes', label: 'Planes / Realms (legacy text)', type: 'chip', legacy: true",
  "parentPlane', label: 'Parent Plane (legacy text)', type: 'text', legacy: true",
  "region', label: 'Region (legacy text)', type: 'text', legacy: true",
  "notableNPCs', label: 'Notable NPCs (legacy text)', type: 'chip', legacy: true",
  "districts', label: 'Districts (legacy text)', type: 'chip', legacy: true",
  "location', label: 'Location (legacy text)', type: 'text', legacy: true",
  "from', label: 'From (legacy text)', type: 'text', legacy: true",
  "to', label: 'To (legacy text)', type: 'text', legacy: true",
  "claimedBy', label: 'Claimed By (legacy text)', type: 'text', legacy: true",
].forEach(token => {
  test(`legacy schema token retained compatibly: ${token.slice(0, 24)}…`, () => {
    ok(src.includes(token), `missing schema token: ${token}`);
  });
});

console.log('\n  Section 4: Common-options-plus-custom-entry conversions');

test('realm features and rules use chip selectors', () => {
  ok(src.includes("{ key: 'features', label: 'Key Features', type: 'chip'"), 'realm features chip selector missing');
  ok(src.includes("{ key: 'rules', label: 'Special Rules', type: 'chip'"), 'realm rules chip selector missing');
});
test('domain delight and rule fields use structured chips', () => {
  ['laws', 'resources', 'threats', 'delightTheme', 'entranceRules', 'feyBargains', 'timeDistortion', 'planarTraits'].forEach(key => {
    ok(src.includes(`{ key: '${key}'`) && src.includes("type: 'chip'"), `domain chip field missing: ${key}`);
  });
});
test('culture values, quest consequences, downtime outcomes, project materials, and room features use chips', () => {
  ok(src.includes("{ key: 'values', label: 'Core Values', type: 'chip'"), 'culture values chip missing');
  ok(src.includes("chipField(contentEl, 'Consequences (failure)'"), 'quest consequences chip missing');
  ok(src.includes("chipField(contentEl, 'Outcomes'"), 'downtime outcomes chip missing');
  ok(src.includes("chipField(contentEl, 'Materials Required'"), 'project materials chip missing');
  ok(src.includes("{ key: 'features', label: 'Features', type: 'chip'"), 'room features chip missing');
});

console.log('\n  Section 5: Campaign selectors removed from campaign-owned editors');

[
  'class QuestModal extends Modal',
  'class EncounterModal extends Modal',
  'class DowntimeModal extends Modal',
  'class BastionModal extends Modal',
  'class WarFrontModal extends Modal',
  'class IncursionModal extends Modal',
  'class EnemyTemplateModal extends Modal',
].forEach(header => {
  test(`${header} saves to active campaign without picker`, () => {
    const start = src.indexOf(header);
    const end = src.indexOf('\nclass ', start + 1);
    const block = src.slice(start, end > start ? end : undefined);
    notOk(block.includes("addCampaignPicker(contentEl, 'Campaign'"), `${header} still renders campaign picker`);
    ok(block.includes("if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';"),
      `${header} missing active campaign fallback`);
  });
});

console.log('\n  Section 6: Structured references and display');

test('reveal schema requires selecting an existing Secret and Session', () => {
  ok(src.includes("{ key: 'secretId', label: 'Related Secret', type: 'entityRef', entityType: 'secrets' }"), 'reveal secret selector missing');
  ok(src.includes("{ key: 'sessionId', label: 'Delivery Session', type: 'entityRef', entityType: 'sessions' }"), 'reveal session selector missing');
});
test('run session map context uses canonical linkedLocationId / linkedSettlementId', () => {
  ok(src.includes('chosenMap.linkedLocationId || chosenMap.locationId'), 'run session map location link missing');
  ok(src.includes('chosenMap.linkedSettlementId || chosenMap.settlementId'), 'run session map settlement link missing');
});
test('resolveEntityDisplay supports secrets, loot, timers, war fronts, incursions, and maps', () => {
  ['secrets', 'loot', 'timers', 'warFronts', 'incursions', 'maps'].forEach(key => ok(src.includes(`'${key}'`), `resolveEntityDisplay coverage missing ${key}`));
});

console.log('\n  Section 7: Specific workflow cleanups');

test('Enemy Template modal exposes roll/calc helpers for AC, HP, and Speed', () => {
  ok(src.includes('acFormula') && src.includes('hpFormula') && src.includes('speedFormula'), 'enemy template formula fields missing');
  ok(src.includes("btn(calcRow, 'Roll AC'") && src.includes("btn(calcRow, 'Roll HP'") && src.includes("btn(calcRow, 'Apply Speed'"),
    'enemy template calc buttons missing');
});
test('Relationship Matrix no longer shows the legacy noble family container by default', () => {
  ok(src.includes('const showLegacyNobleFamilies = false;'), 'legacy noble family container not disabled');
});
test('Secret modal uses typed related entity selectors', () => {
  ok(src.includes("addTypedEntityMultiPicker(contentEl, 'Related Entities'"), 'Secret related entity typed selector missing');
});
test('Loot cards and quest/encounter cards use structured canonical meta fields', () => {
  ok(src.includes("itemCards(main, plugin, 'loot', { meta: ['type', 'rarity', 'value', 'status', 'encounterId', 'claimedById', 'claimedByType'] })"), 'loot canonical meta missing');
  ok(src.includes("meta: ['questType', 'giverNpcId', 'locationId', 'rewardLootIds']"), 'quest canonical meta missing');
  ok(src.includes("meta: ['type', 'difficulty', 'locationId', 'linkedQuestId', 'linkedMapId', 'rewardLootIds']"), 'encounter canonical meta missing');
});

console.log('\n' + '—'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

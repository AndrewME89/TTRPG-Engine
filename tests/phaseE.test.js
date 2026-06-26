'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e) { console.log('  FAIL', name, '\n       ', e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function includes(str, sub) { assert(str.includes(sub), `Expected to find: ${sub}`); }
function notIncludes(str, sub) { assert(!str.includes(sub), `Expected NOT to find: ${sub}`); }

console.log('\nPhase E — Cleanup & Display\n');

// STEP 1: run-tests.mjs
console.log('  Section 1: Test runner script');
test('scripts/run-tests.mjs exists', () => {
  const exists = fs.existsSync(path.join(__dirname, '../scripts/run-tests.mjs'));
  assert(exists, 'scripts/run-tests.mjs does not exist');
});
test('package.json test script references run-tests.mjs', () => {
  const pkg = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8');
  includes(pkg, 'run-tests.mjs');
});

// STEP 2: Noble Families tab removal
console.log('\n  Section 2: Noble Families tab cleanup');
test('renderCastPowers no longer has noble-families tab entry', () => {
  const fn = src.slice(src.indexOf('function renderCastPowers'), src.indexOf('function renderNobleFamiliesSection'));
  notIncludes(fn, "id: 'noble-families'");
});
test('renderCastPowers tabs does not include Noble Families label', () => {
  const fn = src.slice(src.indexOf('function renderCastPowers'), src.indexOf('function renderNobleFamiliesSection'));
  notIncludes(fn, 'Noble Families');
});
test('renderCastPowers redirects noble-families to factions', () => {
  const fn = src.slice(src.indexOf('function renderCastPowers'), src.indexOf('function renderNobleFamiliesSection'));
  includes(fn, "sub === 'noble-families'");
  includes(fn, "sub = 'factions'");
});
test('renderCastPowers redirects nobleFamilies to factions', () => {
  const fn = src.slice(src.indexOf('function renderCastPowers'), src.indexOf('function renderNobleFamiliesSection'));
  includes(fn, "sub === 'nobleFamilies'");
});
test('renderNobleFamiliesSection still exists (data preserved)', () => {
  includes(src, 'function renderNobleFamiliesSection');
});

// STEP 2d: migrateNobleFamiliesToFactions
console.log('\n  Section 3: Noble Families migration');
test('migrateNobleFamiliesToFactions function exists', () => {
  includes(src, 'function migrateNobleFamiliesToFactions');
});
test('migration guards against duplicates via migratedFromNobleFamilyId', () => {
  includes(src, 'migratedFromNobleFamilyId');
});
test('migration guards against duplicates via migratedToFaction flag', () => {
  includes(src, 'migratedToFaction');
});

// STEP 3: resolveEntityDisplay
console.log('\n  Section 4: resolveEntityDisplay');
test('resolveEntityDisplay function exists', () => {
  includes(src, 'function resolveEntityDisplay');
});
test('resolveEntityDisplay includes nobleFamilies in its collections', () => {
  const fn = src.slice(src.indexOf('function resolveEntityDisplay'), src.indexOf('async function ensureFolder'));
  includes(fn, 'nobleFamilies');
});
test('resolveEntityDisplay handles migratedFactionId lookup', () => {
  const fn = src.slice(src.indexOf('function resolveEntityDisplay'), src.indexOf('async function ensureFolder'));
  includes(fn, 'migratedFactionId');
});

// STEP 4: PICKABLE_ENTITY_TYPES
console.log('\n  Section 5: PICKABLE_ENTITY_TYPES cleanup');
test('nobleFamilies removed from PICKABLE_ENTITY_TYPES', () => {
  const start = src.indexOf('const PICKABLE_ENTITY_TYPES');
  const end = src.indexOf('];', start);
  const block = src.slice(start, end);
  notIncludes(block, 'nobleFamilies');
});
test('PICKABLE_ENTITY_TYPES still has npcs', () => {
  const start = src.indexOf('const PICKABLE_ENTITY_TYPES');
  const end = src.indexOf('];', start);
  const block = src.slice(start, end);
  includes(block, "'npcs'");
});
test('PICKABLE_ENTITY_TYPES still has factions', () => {
  const start = src.indexOf('const PICKABLE_ENTITY_TYPES');
  const end = src.indexOf('];', start);
  const block = src.slice(start, end);
  includes(block, "'factions'");
});

// STEP 5: Faction territory consolidation
console.log('\n  Section 6: Faction territory consolidation');
test('FactionModal territory picker uses regions not settlements', () => {
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  includes(modal, "'regions'");
  includes(modal, 'Territories (Regions)');
});
test('FactionModal old settlement territory picker removed', () => {
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  notIncludes(modal, "addEntityMultiPicker(contentEl, 'Territories', this.values.territoryIds, this.plugin, 'settlements'");
});
test('FactionModal legacy territory text field still exists', () => {
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  includes(modal, 'Territory (legacy text)');
});
test('FactionModal legacy territory is in a details/collapsed section', () => {
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  includes(modal, 'Legacy / Advanced');
});

// STEP 6: Faction reputation inline display
console.log('\n  Section 7: Faction reputation section');
test('FactionModal shows Reputation Records section', () => {
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  includes(modal, 'Reputation Records');
});
test('FactionModal filters reputations by factionId', () => {
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  includes(modal, 'r.factionId === this.values.id');
});
test('FactionModal has Add Reputation button', () => {
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  includes(modal, '+ Add Reputation');
});

// STEP 7: NPC card meta
console.log('\n  Section 8: NPC card meta');
test("NPC itemCards meta includes 'pronouns'", () => {
  includes(src, "'pronouns'");
  // Check it's in the npcs itemCards call
  const npcCards = src.slice(src.indexOf("itemCards(main, plugin, 'npcs'"), src.indexOf("itemCards(main, plugin, 'npcs'") + 200);
  includes(npcCards, 'pronouns');
});
test("NPC itemCards meta includes 'occupation'", () => {
  const npcCards = src.slice(src.indexOf("itemCards(main, plugin, 'npcs'"), src.indexOf("itemCards(main, plugin, 'npcs'") + 200);
  includes(npcCards, 'occupation');
});

// STEP 8: Creature card meta
console.log('\n  Section 9: Creature card meta');
test("Creature itemCards meta includes 'ac'", () => {
  const crCards = src.slice(src.indexOf("itemCards(main, plugin, 'creatures'"), src.indexOf("itemCards(main, plugin, 'creatures'") + 200);
  includes(crCards, "'ac'");
});
test("Creature itemCards meta includes 'hp'", () => {
  const crCards = src.slice(src.indexOf("itemCards(main, plugin, 'creatures'"), src.indexOf("itemCards(main, plugin, 'creatures'") + 200);
  includes(crCards, "'hp'");
});

// STEP 9: HybridAncestryModal campaign picker removed
console.log('\n  Section 10: HybridAncestryModal campaign picker');
test('HybridAncestryModal onOpen does not call addCampaignPicker', () => {
  const start = src.indexOf('class HybridAncestryModal');
  const end = src.indexOf('\nclass ', start + 10);
  const modal = end > start ? src.slice(start, end) : src.slice(start, start + 10000);
  // campaignId field still exists in data but not as a picker
  notIncludes(modal, "addCampaignPicker(s1");
});
test('HybridAncestryModal still stores campaignId in data model', () => {
  const start = src.indexOf('class HybridAncestryModal');
  const end = src.indexOf('\nclass ', start + 10);
  const modal = end > start ? src.slice(start, end) : src.slice(start, start + 10000);
  includes(modal, 'campaignId');
});

// STEP 10: Creature faction linking
console.log('\n  Section 11: Creature faction linking');
test('CreatureModal has factionIds in data model', () => {
  const modal = src.slice(src.indexOf('class CreatureModal'), src.indexOf('// BBEGModal'));
  includes(modal, 'factionIds');
});
test('CreatureModal has Linked Factions entity picker', () => {
  const modal = src.slice(src.indexOf('class CreatureModal'), src.indexOf('// BBEGModal'));
  includes(modal, 'Linked Factions');
});

// STEP 2c: Noble House filter in Factions
console.log('\n  Section 12: Noble House filter in Factions');
test('renderFactions has Noble Houses filter option', () => {
  const fn = src.slice(src.indexOf('function renderFactions'), src.indexOf('\n// ── ADVENTURES'));
  includes(fn, 'Noble Houses');
});
test('renderFactions filters by Noble House type', () => {
  const fn = src.slice(src.indexOf('function renderFactions'), src.indexOf('\n// ── ADVENTURES'));
  includes(fn, 'Noble House');
});

console.log(`\n══════════════════════════════════════════`);
console.log(`Phase E: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

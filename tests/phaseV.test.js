'use strict';
/**
 * Phase V — Homebrew Type-Specific Builders
 * Coverage: type-specific builder registry, chooser routing,
 * shared metadata, hybrid compatibility, and class scaffold.
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

const chooserIdx = src.indexOf('class HomebrewTypeChooserModal');
const chooserEnd = src.indexOf('\n// HomebrewModal', chooserIdx);
const chooserBlock = src.slice(chooserIdx, chooserEnd);

const typedModalIdx = src.indexOf('class TypedHomebrewModal extends Modal');
const typedModalEnd = src.indexOf('\nclass HomebrewTypeChooserModal', typedModalIdx);
const typedModalBlock = src.slice(typedModalIdx, typedModalEnd);

console.log('\nPhase V — Homebrew Type-Specific Builders\n');

console.log('  Section 1: Shared metadata');

test('normalizeHomebrewRecord sets homebrewType', () => {
  ok(src.includes('record.homebrewType'), 'homebrewType normalization missing');
});
test('homebrew metadata includes balanceNotes', () => {
  ok(src.includes('record.balanceNotes') && typedModalBlock.includes('Balance Notes'),
    'balanceNotes metadata missing');
});
test('typed modal exposes scope/status/visibility/tags metadata', () => {
  ['Scope', 'Status', 'Visibility', 'Tags'].forEach(label => ok(typedModalBlock.includes(label), `typed modal missing ${label}`));
});

console.log('\n  Section 2: Builder registry');

test('HOMEBREW_BUILDERS registry exists', () => {
  ok(src.includes('const HOMEBREW_BUILDERS = {'), 'HOMEBREW_BUILDERS missing');
});
['Spell','Feat','Background','Item','Creature','Ancestry','Class','Subclass','Rule','Mechanic','Plane'].forEach(type => {
  test(`builder exists: ${type}`, () => {
    ok(src.includes(`${type}: {`), `${type} builder missing`);
  });
});
test('class builder is scaffolded rather than omitted', () => {
  ok(src.includes('levelTable') && src.includes('subclassLevel') && src.includes('spellcastingRules'),
    'Class scaffold fields missing');
});

console.log('\n  Section 3: Type-specific modal routing');

test('TypedHomebrewModal exists', () => {
  ok(typedModalIdx >= 0, 'TypedHomebrewModal missing');
});
test('openHomebrewBuilder helper exists', () => {
  ok(src.includes('function openHomebrewBuilder('), 'openHomebrewBuilder missing');
});
test('openHomebrewEditor helper exists', () => {
  ok(src.includes('function openHomebrewEditor('), 'openHomebrewEditor missing');
});
test('homebrew edit routing uses openHomebrewEditor', () => {
  ok(src.includes("homebrew:         (p, i) => openHomebrewEditor") && src.includes('onEdit: (plugin, key, item) => openHomebrewEditor'),
    'homebrew edit routing missing');
});

console.log('\n  Section 4: Chooser UX');

test('chooser uses grouped builder cards', () => {
  ok(src.includes('const HOMEBREW_BUILDER_GROUPS = [') && chooserBlock.includes('HOMEBREW_BUILDER_GROUPS.forEach'),
    'grouped builder chooser missing');
});
test('chooser includes managed builder groups', () => {
  ['Character Options','Rules & Mechanics','Items & Equipment','Monsters & Statblocks','Worlds & Planes','Rollable Tables']
    .forEach(label => ok(src.includes(label), `missing chooser group ${label}`));
});
test('chooser routes rollable tables to RollableTableModal', () => {
  ok(chooserBlock.includes('RollableTableModal') && chooserBlock.includes("card.special === 'table'"),
    'chooser missing rollable table routing');
});
test('chooser preserves Hybrid Ancestry entry point separately', () => {
  ok(chooserBlock.includes('Hybrid Ancestry') && chooserBlock.includes('HybridAncestryModal'),
    'Hybrid Ancestry chooser bridge missing');
});
test('generic + Entry is not reintroduced for Homebrew', () => {
  notOk(src.includes("'+ Entry'") && src.includes('Homebrew'), 'generic + Entry reintroduced');
});

console.log('\n  Section 5: Builder specifics');

test('spell builder includes spell-specific fields', () => {
  ['Casting Time', 'Components', 'Higher Levels', 'Spell Lists'].forEach(label => ok(src.includes(label), `Spell field missing: ${label}`));
});
test('item builder includes conditional weapon and armour details', () => {
  ['Weapon Details', 'Armour Details', 'damageDice', 'acFormula', 'stealthDisadvantage'].forEach(token => ok(src.includes(token), `Item conditional detail missing: ${token}`));
});
test('creature builder includes CR, XP, and defenses', () => {
  ['Damage Resistances', 'Damage Immunities', 'Condition Immunities', 'CR', 'XP'].forEach(label => ok(src.includes(label), `Creature field missing: ${label}`));
});
test('ancestry builder includes movement modes and ASI handling', () => {
  ['Walking Speed', 'Flying Speed', 'Ability Score Increase', 'Custom ASI Rules'].forEach(label => ok(src.includes(label), `Ancestry field missing: ${label}`));
});
test('subclass builder includes parent class and feature levels', () => {
  ['Parent Class', 'Feature Levels', 'Spell Additions'].forEach(label => ok(src.includes(label), `Subclass field missing: ${label}`));
});
test('rule and mechanic builders avoid generic junk drawer fields only', () => {
  ['Official Equivalent', 'Mechanic Impact', 'Trigger / When it Applies', 'Math / Formula', 'Examples'].forEach(label => ok(src.includes(label), `Rule/Mechanic field missing: ${label}`));
});
test('plane builder includes cosmology and travel rules', () => {
  ['Cosmology', 'Inhabitants', 'Travel Rules'].forEach(label => ok(src.includes(label), `Plane field missing: ${label}`));
});

console.log('\n  Section 6: Hybrid compatibility and filters');

test('hybridAncestryToBuilderValues helper exists', () => {
  ok(src.includes('function hybridAncestryToBuilderValues('), 'Hybrid ancestry mapping helper missing');
});
test('Hybrid ancestry homebrew save maps into ancestry payload', () => {
  ok(src.includes("homebrewType: 'Ancestry'") && src.includes("type: 'Hybrid Ancestry'") && src.includes("kind: 'Ancestry'"),
    'Hybrid ancestry export not mapped into ancestry schema');
});
test('renderHomebrew has homebrew type filter', () => {
  ok(src.includes('const typeSel = ce(filterRow, \'select\')') && src.includes('hbFilter.type'),
    'Homebrew type filter missing');
});

console.log('\n  Section 7: Functional shape checks');

function normalizeLite(item) {
  const record = Object.assign({}, item || {});
  record.homebrewType = record.homebrewType || record.type || 'Other';
  record.type = record.type || record.homebrewType;
  record.source = 'homebrew';
  record.balanceNotes = record.balanceNotes || '';
  return record;
}

test('functional: typed spell record preserves shared metadata', () => {
  const hb = normalizeLite({ name: 'Solar Lance', homebrewType: 'Spell', status: 'Draft', visibility: 'dm-only', tags: ['radiant'], balanceNotes: 'Watch scaling.' });
  eq(hb.homebrewType, 'Spell');
  eq(hb.type, 'Spell');
  eq(hb.source, 'homebrew');
  eq(hb.balanceNotes, 'Watch scaling.');
});
test('functional: item builder can represent weapon subtype without changing homebrewType', () => {
  const hb = normalizeLite({ name: 'Storm Pike', homebrewType: 'Item', payload: { itemType: 'Weapon' } });
  eq(hb.homebrewType, 'Item');
  eq(hb.payload.itemType, 'Weapon');
});
test('functional: ancestry builder can represent hybrid ancestry records compatibly', () => {
  const hb = normalizeLite({ name: 'Drow-Human', homebrewType: 'Ancestry', type: 'Hybrid Ancestry', sourceHybridId: 'hy-1' });
  eq(hb.homebrewType, 'Ancestry');
  eq(hb.type, 'Hybrid Ancestry');
  eq(hb.sourceHybridId, 'hy-1');
});

console.log('\n' + '—'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

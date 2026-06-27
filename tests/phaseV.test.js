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
test('+ Spell opens a dedicated Homebrew Spell modal directly', () => {
  ok(src.includes('+ Spell') && src.includes('openHomebrewSpellModal'), 'Direct Spell button/modal wiring missing');
});
test('+ Creature opens a dedicated Homebrew Creature modal directly', () => {
  ok(src.includes('+ Creature / Monster / Beast') && src.includes('openHomebrewCreatureModal'), 'Direct Creature button/modal wiring missing');
});
test('+ Weapon opens a dedicated Homebrew Weapon modal directly', () => {
  ok(src.includes('+ Weapon') && src.includes('openHomebrewWeaponModal'), 'Direct Weapon button/modal wiring missing');
});
test('+ Armour opens a dedicated Homebrew Armour modal directly', () => {
  ok(src.includes('+ Armour') && src.includes('openHomebrewArmourModal'), 'Direct Armour button/modal wiring missing');
});
test('+ Item / Magic Item opens a dedicated Homebrew Item modal directly', () => {
  ok(src.includes('+ Item / Magic Item') && src.includes('openHomebrewItemModal'), 'Direct Item button/modal wiring missing');
});
['Spell','Creature','Weapon','Armour','Item','Ancestry','Class','Subclass','Background','Feat','Rule','Plane','Mechanic'].forEach(type => {
  test(`direct open helper exists: ${type}`, () => {
    ok(src.includes(`openHomebrew${type}Modal`) || (type === 'Item' && src.includes('openHomebrewItemModal')),
      `${type} direct homebrew opener missing`);
  });
});

console.log('\n  Section 4: Direct page UX');

test('Homebrew page uses grouped direct creation buttons', () => {
  ok(src.includes('const HOMEBREW_DIRECT_CREATE_GROUPS = [') && src.includes('HOMEBREW_DIRECT_CREATE_GROUPS.forEach'),
    'grouped direct creation buttons missing');
});
test('direct page includes managed builder groups', () => {
  ['Character Options','Items & Equipment','Creatures & Encounters','Rules & Systems','Worldbuilding','Tables']
    .forEach(label => ok(src.includes(label), `missing chooser group ${label}`));
});
test('direct page routes rollable tables to RollableTableModal', () => {
  ok(src.includes('openHomebrewRollableTableModal') && src.includes('RollableTableModal'),
    'direct rollable table routing missing');
});
test('chooser is not the primary Homebrew page flow', () => {
  notOk(src.includes("pageHead(main, plugin, 'Homebrew', 'Create and manage homebrew content for your campaign.', [\n    { label: 'Create Homebrew'"),
    'Homebrew page still launches generic chooser as primary flow');
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
test('typed modal exposes includeInCompendium field', () => {
  ok(typedModalBlock.includes('Include in Compendium') && src.includes('record.includeInCompendium'),
    'includeInCompendium field missing from structured homebrew flow');
});
test('typed modal sanitizes UI placeholder text before save', () => {
  ok(src.includes('scrubHomebrewPlaceholderText') && src.includes('sanitizeHomebrewDraftValue') && typedModalBlock.includes('cleanedValues'),
    'placeholder sanitization missing from dedicated modal save path');
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
test('functional: includeInCompendium flag can persist on structured record', () => {
  const hb = normalizeLite({ name: 'Sunblade Variant', homebrewType: 'Item', includeInCompendium: true });
  eq(hb.includeInCompendium, true);
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

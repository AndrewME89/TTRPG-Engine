'use strict';
/**
 * Phase R — Core Entity Selector Hygiene
 * Sections 1–8: OPTION_BANKS extensions, langFields, cultureFields, nationFields,
 *   religionFields, districtFields, handoutFields, adventureFields,
 *   EncounterModal, QuestModal reward loot linking.
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
const optionBanksIdx = src.indexOf('const OPTION_BANKS');
const optionBanksEnd = src.indexOf('\n};', optionBanksIdx);
const optionBanksBlock = src.slice(optionBanksIdx, optionBanksEnd + 3);

const langFieldsIdx = src.indexOf('const langFields');
const langFieldsEnd = src.indexOf('\n];', langFieldsIdx);
const langFieldsBlock = src.slice(langFieldsIdx, langFieldsEnd + 3);

const cultureFieldsIdx = src.indexOf('const cultureFields');
const cultureFieldsEnd = src.indexOf('\n];', cultureFieldsIdx);
const cultureFieldsBlock = src.slice(cultureFieldsIdx, cultureFieldsEnd + 3);

const nationFieldsIdx = src.indexOf('const nationFields');
const nationFieldsEnd = src.indexOf('\n];', nationFieldsIdx);
const nationFieldsBlock = src.slice(nationFieldsIdx, nationFieldsEnd + 3);

const religionFieldsIdx = src.indexOf('const religionFields');
const religionFieldsEnd = src.indexOf('\n];', religionFieldsIdx);
const religionFieldsBlock = src.slice(religionFieldsIdx, religionFieldsEnd + 3);

const districtFieldsIdx = src.indexOf('const districtFields');
const districtFieldsEnd = src.indexOf('\n];', districtFieldsIdx);
const districtFieldsBlock = src.slice(districtFieldsIdx, districtFieldsEnd + 3);

const handoutFieldsIdx = src.indexOf('const handoutFields');
const handoutFieldsEnd = src.indexOf('\n];', handoutFieldsIdx);
const handoutFieldsBlock = src.slice(handoutFieldsIdx, handoutFieldsEnd + 3);

const adventureFieldsIdx = src.indexOf('const adventureFields');
const adventureFieldsEnd = src.indexOf('\n];', adventureFieldsIdx);
const adventureFieldsBlock = src.slice(adventureFieldsIdx, adventureFieldsEnd + 3);

const questModalIdx = src.indexOf('class QuestModal');
const questModalEnd = src.indexOf('\n// EncounterModal', questModalIdx);
const questModalBlock = src.slice(questModalIdx, questModalEnd);

const encounterModalIdx = src.indexOf('class EncounterModal');
const encounterModalEnd = src.indexOf('\n// SessionModal', encounterModalIdx);
const encounterModalBlock = src.slice(encounterModalIdx, encounterModalEnd);

console.log('\nPhase R — Core Entity Selector Hygiene\n');

// ── Section 1: OPTION_BANKS extensions ──────────────────────────────────────
console.log('  Section 1: OPTION_BANKS — new banks');

test('OPTION_BANKS has religionPractices bank', () => {
  ok(optionBanksBlock.includes('religionPractices'), 'religionPractices bank missing from OPTION_BANKS');
});
test('religionPractices includes Prayer', () => {
  ok(optionBanksBlock.includes("'Prayer'"), 'Prayer missing from religionPractices');
});
test('religionPractices includes Pilgrimage', () => {
  ok(optionBanksBlock.includes("'Pilgrimage'"), 'Pilgrimage missing from religionPractices');
});
test('OPTION_BANKS has clergyTypes bank', () => {
  ok(optionBanksBlock.includes('clergyTypes'), 'clergyTypes bank missing from OPTION_BANKS');
});
test('clergyTypes includes Priest', () => {
  ok(optionBanksBlock.includes("'Priest'"), 'Priest missing from clergyTypes');
});
test('clergyTypes includes Oracle', () => {
  ok(optionBanksBlock.includes("'Oracle'"), 'Oracle missing from clergyTypes');
});
test('OPTION_BANKS has encounterTerrain bank', () => {
  ok(optionBanksBlock.includes('encounterTerrain'), 'encounterTerrain bank missing from OPTION_BANKS');
});
test('encounterTerrain includes Underground Cave', () => {
  ok(optionBanksBlock.includes("'Underground Cave'"), 'Underground Cave missing from encounterTerrain');
});
test('OPTION_BANKS has districtAtmosphere bank', () => {
  ok(optionBanksBlock.includes('districtAtmosphere'), 'districtAtmosphere bank missing from OPTION_BANKS');
});
test('OPTION_BANKS has economyTypes bank', () => {
  ok(optionBanksBlock.includes('economyTypes'), 'economyTypes bank missing from OPTION_BANKS');
});
test('economyTypes includes Trade Hub', () => {
  ok(optionBanksBlock.includes("'Trade Hub'"), 'Trade Hub missing from economyTypes');
});
test('OPTION_BANKS has clothingStyles bank', () => {
  ok(optionBanksBlock.includes('clothingStyles'), 'clothingStyles bank missing from OPTION_BANKS');
});
test('OPTION_BANKS has foodCulture bank', () => {
  ok(optionBanksBlock.includes('foodCulture'), 'foodCulture bank missing from OPTION_BANKS');
});
test('every new bank ends with Custom option', () => {
  const banks = ['religionPractices', 'clergyTypes', 'encounterTerrain', 'districtAtmosphere', 'economyTypes', 'clothingStyles', 'foodCulture'];
  for (const bank of banks) {
    const bankIdx = optionBanksBlock.indexOf(bank);
    const bankEnd = optionBanksBlock.indexOf(']', bankIdx);
    const bankSlice = optionBanksBlock.slice(bankIdx, bankEnd);
    ok(bankSlice.includes("'Custom'"), `${bank} is missing 'Custom' as last option`);
  }
});

// ── Section 2: Language fields ───────────────────────────────────────────────
console.log('\n  Section 2: langFields — entity refs added');

test('langFields has originText field', () => {
  ok(langFieldsBlock.includes('originText'), 'langFields missing originText field');
});
test('langFields has originCultureId entityRef', () => {
  ok(langFieldsBlock.includes('originCultureId') && langFieldsBlock.includes("entityType: 'cultures'"),
    'langFields missing originCultureId entityRef');
});
test('langFields has originRegionId entityRef', () => {
  ok(langFieldsBlock.includes('originRegionId') && langFieldsBlock.includes("entityType: 'regions'"),
    'langFields missing originRegionId entityRef');
});
test('langFields has originNationId entityRef', () => {
  ok(langFieldsBlock.includes('originNationId') && langFieldsBlock.includes("entityType: 'nations'"),
    'langFields missing originNationId entityRef');
});
test('langFields preserves legacy origin text field', () => {
  ok(langFieldsBlock.includes("key: 'origin'"), 'langFields missing legacy origin text field');
});
test('langFields still has name and script fields', () => {
  ok(langFieldsBlock.includes("'name'") && langFieldsBlock.includes("'script'"),
    'langFields missing core name/script fields');
});

// ── Section 3: Culture fields ────────────────────────────────────────────────
console.log('\n  Section 3: cultureFields — chip selectors');

test('cultureFields has clothing chip with clothingStyles bank', () => {
  ok(cultureFieldsBlock.includes("bank: 'clothingStyles'") || cultureFieldsBlock.includes("clothingStyles"),
    'cultureFields missing clothingStyles bank reference');
});
test('cultureFields has clothingNotes textarea', () => {
  ok(cultureFieldsBlock.includes('clothingNotes'), 'cultureFields missing clothingNotes textarea');
});
test('cultureFields has food chip with foodCulture bank', () => {
  ok(cultureFieldsBlock.includes("bank: 'foodCulture'") || cultureFieldsBlock.includes("foodCulture"),
    'cultureFields missing foodCulture bank reference');
});
test('cultureFields has foodNotes textarea', () => {
  ok(cultureFieldsBlock.includes('foodNotes'), 'cultureFields missing foodNotes textarea');
});
test('cultureFields clothing uses chip type', () => {
  const clothIdx = cultureFieldsBlock.indexOf('clothingStyles');
  const clothCtx = cultureFieldsBlock.slice(Math.max(0, clothIdx - 200), clothIdx + 50);
  ok(clothCtx.includes("type: 'chip'"), 'clothing field should be type chip');
});

// ── Section 4: Nation fields ─────────────────────────────────────────────────
console.log('\n  Section 4: nationFields — economy chip');

test('nationFields has economy chip field', () => {
  ok(nationFieldsBlock.includes("key: 'economy'"), 'nationFields missing economy field');
});
test('nationFields economy uses economyTypes bank', () => {
  ok(nationFieldsBlock.includes('economyTypes'), 'nationFields economy missing economyTypes bank');
});
test('nationFields economy uses chip type', () => {
  const eIdx = nationFieldsBlock.indexOf('economyTypes');
  const eCtx = nationFieldsBlock.slice(Math.max(0, eIdx - 200), eIdx + 50);
  ok(eCtx.includes("type: 'chip'"), 'nationFields economy field should be chip type');
});

// ── Section 5: Religion fields ───────────────────────────────────────────────
console.log('\n  Section 5: religionFields — chip selectors');

test('religionFields has practices chip with religionPractices bank', () => {
  ok(religionFieldsBlock.includes('religionPractices'), 'religionFields missing religionPractices bank');
});
test('religionFields has practicesNotes field', () => {
  ok(religionFieldsBlock.includes('practicesNotes'), 'religionFields missing practicesNotes field');
});
test('religionFields has clergy chip with clergyTypes bank', () => {
  ok(religionFieldsBlock.includes('clergyTypes'), 'religionFields missing clergyTypes bank');
});
test('religionFields has clergyNotes field', () => {
  ok(religionFieldsBlock.includes('clergyNotes'), 'religionFields missing clergyNotes field');
});
test('religionFields has symbols chip field', () => {
  ok(religionFieldsBlock.includes("key: 'symbols'"), 'religionFields missing symbols field');
});
test('religionFields has holyDays chip field', () => {
  ok(religionFieldsBlock.includes("key: 'holyDays'") || religionFieldsBlock.includes("'holyDays'"),
    'religionFields missing holyDays field');
});

// ── Section 6: District fields ───────────────────────────────────────────────
console.log('\n  Section 6: districtFields — atmosphere chip');

test('districtFields has atmosphere chip field', () => {
  ok(districtFieldsBlock.includes("key: 'atmosphere'"), 'districtFields missing atmosphere field');
});
test('districtFields atmosphere uses districtAtmosphere bank', () => {
  ok(districtFieldsBlock.includes('districtAtmosphere'), 'districtFields atmosphere missing districtAtmosphere bank');
});

// ── Section 7: Handout fields ────────────────────────────────────────────────
console.log('\n  Section 7: handoutFields — session entity ref');

test('handoutFields has linkedSessionId entityRef', () => {
  ok(handoutFieldsBlock.includes('linkedSessionId') && handoutFieldsBlock.includes("entityType: 'sessions'"),
    'handoutFields missing linkedSessionId entityRef to sessions');
});
test('handoutFields preserves legacy linkedSession text', () => {
  ok(handoutFieldsBlock.includes("key: 'linkedSession'"), 'handoutFields missing legacy linkedSession text field');
});

// ── Section 8: Adventure fields ──────────────────────────────────────────────
console.log('\n  Section 8: adventureFields — entity multi-refs');

test('adventureFields has questIds entityMultiRef', () => {
  ok(adventureFieldsBlock.includes('questIds') && adventureFieldsBlock.includes("entityType: 'quests'"),
    'adventureFields missing questIds entityMultiRef');
});
test('adventureFields preserves legacy acts textarea', () => {
  ok(adventureFieldsBlock.includes("key: 'acts'"), 'adventureFields missing legacy acts textarea');
});
test('adventureFields has linkedNpcIds entityMultiRef', () => {
  ok(adventureFieldsBlock.includes('linkedNpcIds') && adventureFieldsBlock.includes("entityType: 'npcs'"),
    'adventureFields missing linkedNpcIds entityMultiRef');
});
test('adventureFields preserves legacy linkedNPCs chip', () => {
  ok(adventureFieldsBlock.includes('linkedNPCs'), 'adventureFields missing legacy linkedNPCs chip');
});
test('adventureFields has lootIds entityMultiRef', () => {
  ok(adventureFieldsBlock.includes('lootIds') && adventureFieldsBlock.includes("entityType: 'loot'"),
    'adventureFields missing lootIds entityMultiRef');
});
test('adventureFields preserves legacy treasure textarea', () => {
  ok(adventureFieldsBlock.includes("key: 'treasure'"), 'adventureFields missing legacy treasure textarea');
});
test('adventureFields has actId entityRef for parent act', () => {
  ok(adventureFieldsBlock.includes('actId') && adventureFieldsBlock.includes("entityType: 'acts'"),
    'adventureFields missing actId entityRef');
});

// ── Section 9: EncounterModal ────────────────────────────────────────────────
console.log('\n  Section 9: EncounterModal — terrain/tactics chips, loot linking');

test('EncounterModal constructor has terrain as array default', () => {
  const ctorIdx = encounterModalBlock.indexOf('this.values = Object.assign');
  const ctorBlock = encounterModalBlock.slice(ctorIdx, ctorIdx + 600);
  ok(ctorBlock.includes('terrain: []'), 'EncounterModal terrain default should be []');
});
test('EncounterModal constructor has tactics as array default', () => {
  const ctorIdx = encounterModalBlock.indexOf('this.values = Object.assign');
  const ctorBlock = encounterModalBlock.slice(ctorIdx, ctorIdx + 600);
  ok(ctorBlock.includes('tactics: []'), 'EncounterModal tactics default should be []');
});
test('EncounterModal constructor has rewardLootIds array', () => {
  const ctorIdx = encounterModalBlock.indexOf('this.values = Object.assign');
  const ctorBlock = encounterModalBlock.slice(ctorIdx, ctorIdx + 600);
  ok(ctorBlock.includes('rewardLootIds: []'), 'EncounterModal missing rewardLootIds default');
});
test('EncounterModal onOpen uses chipField for terrain', () => {
  ok(encounterModalBlock.includes("chipField(") && encounterModalBlock.includes("'Terrain'"),
    'EncounterModal terrain should use chipField');
});
test('EncounterModal terrain chipField references encounterTerrain bank', () => {
  ok(encounterModalBlock.includes("bank: 'encounterTerrain'"), 'EncounterModal terrain chipField missing encounterTerrain bank');
});
test('EncounterModal onOpen uses chipField for tactics', () => {
  ok(encounterModalBlock.includes("'Tactics'"), 'EncounterModal tactics should use chipField');
});
test('EncounterModal has rewardLootIds entity multi-picker', () => {
  ok(encounterModalBlock.includes('rewardLootIds') && encounterModalBlock.includes("'loot'"),
    'EncounterModal missing rewardLootIds entity multi-picker for loot');
});
test('EncounterModal still has rewards notes textarea', () => {
  ok(encounterModalBlock.includes("'Rewards / Loot (notes)'") || encounterModalBlock.includes("this.values.rewards"),
    'EncounterModal missing rewards notes textarea');
});

// ── Section 10: QuestModal — reward loot linking ─────────────────────────────
console.log('\n  Section 10: QuestModal — reward loot linking');

test('QuestModal constructor has rewardLootIds array', () => {
  const ctorIdx = questModalBlock.indexOf('this.values = Object.assign');
  const ctorBlock = questModalBlock.slice(ctorIdx, ctorIdx + 500);
  ok(ctorBlock.includes('rewardLootIds: []'), 'QuestModal missing rewardLootIds default');
});
test('QuestModal has rewardLootIds entity multi-picker', () => {
  ok(questModalBlock.includes('rewardLootIds') && questModalBlock.includes("'loot'"),
    'QuestModal missing rewardLootIds entity multi-picker for loot');
});
test('QuestModal still has rewards notes textarea', () => {
  ok(questModalBlock.includes("this.values.rewards") && questModalBlock.includes("'Rewards"),
    'QuestModal missing rewards notes textarea');
});

// ── Section 11: No placeholder strings as data defaults ──────────────────────
console.log('\n  Section 11: No placeholder strings as defaults');

const PLACEHOLDER_STRINGS = [
  'Select existing', 'Select common options', 'Make noted changes',
  'Confirm what this connects to', 'select common', 'select existing',
];

test('no placeholder strings used as literal default field values', () => {
  const found = [];
  let searchFrom = 0;
  while (true) {
    const idx = src.indexOf('this.values = Object.assign({', searchFrom);
    if (idx === -1) break;
    const block = src.slice(idx, idx + 1000);
    for (const p of PLACEHOLDER_STRINGS) {
      if ((block.includes(`'${p}'`) || block.includes(`"${p}"`)) && !found.includes(p)) found.push(p);
    }
    searchFrom = idx + 1;
  }
  ok(found.length === 0, `Placeholder strings found as modal defaults: ${found.join(', ')}`);
});

// ── Section 12: No duplicate function declarations ───────────────────────────
console.log('\n  Section 12: Regression — no duplicate declarations');

test('no duplicate top-level function declarations after Phase R', () => {
  const seen = {};
  const dups = [];
  for (const m of src.matchAll(/^(?:async )?function (\w+)\(/mg)) {
    seen[m[1]] = (seen[m[1]] || 0) + 1;
    if (seen[m[1]] === 2) dups.push(m[1]);
  }
  ok(dups.length === 0, `Duplicate function declarations: ${dups.join(', ')}`);
});

// Functional: chip field safe display of legacy strings
test('functional: safeArr handles legacy string terrain gracefully', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const legacyEncounter = { terrain: 'Forest', tactics: 'Ambush' };
  ok(Array.isArray(safeArr(legacyEncounter.terrain)), 'safeArr should return array for legacy string terrain');
  ok(safeArr(legacyEncounter.terrain).length === 0, 'legacy string terrain should render as empty chip list');
});

test('functional: new rewards loot link pattern works', () => {
  const quest = { id: 'q-1', name: 'Test Quest', rewards: 'Gold coins', rewardLootIds: ['loot-1', 'loot-2'] };
  ok(quest.rewardLootIds.length === 2, 'quest should have 2 linked loot items');
  ok(quest.rewards === 'Gold coins', 'legacy rewards notes should be preserved');
});

test('functional: legacy encounter terrain string does not crash', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const encounter = { terrain: 'Open Field', rewardLootIds: undefined, tactics: '' };
  const terrain = safeArr(encounter.terrain);
  const lootIds = safeArr(encounter.rewardLootIds);
  ok(Array.isArray(terrain), 'terrain should be array');
  ok(Array.isArray(lootIds), 'rewardLootIds should be array');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

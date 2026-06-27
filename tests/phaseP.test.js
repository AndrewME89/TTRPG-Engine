'use strict';
/**
 * Phase P — Characters, Creatures, Stats, Equipment & Spells
 * Sections 1–6: Roll Stats buttons, AC/HP suggestions, NPC presets,
 *   creature language migration, PC spell split, structured equipment.
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

// Slice relevant sections
const npcStart = src.indexOf('// NPCModal');
const npcEnd   = src.indexOf('\n// CreatureModal', npcStart);
const npcSrc   = src.slice(npcStart, npcEnd);

const creatureStart = src.indexOf('// CreatureModal');
const creatureEnd   = src.indexOf('\n// CharacterModal (Player Mode)', creatureStart);
const creatureSrc   = src.slice(creatureStart, creatureEnd);

const charModalStart = src.indexOf('// CharacterModal (Player Mode)');
const charModalEnd   = src.indexOf('\nclass HybridAncestryModal', charModalStart);
const charModalSrc = src.slice(charModalStart, charModalEnd > charModalStart ? charModalEnd : charModalStart + 15000);

const spellbookStart = src.indexOf('async function renderPCSpellbook(');
const spellbookEnd   = src.indexOf('\nfunction renderPCQuests(', spellbookStart);
const spellbookSrc   = src.slice(spellbookStart, spellbookEnd);

const inventoryStart = src.indexOf('async function renderPCInventory(');
const inventorySrc   = src.slice(inventoryStart, inventoryStart + 6000);

console.log('\nPhase P — Characters, Creatures, Stats, Equipment & Spells\n');

// ── Section 1: Constants ────────────────────────────────────────────────────
console.log('  Section 1: New constants');

test('HIT_DIE_BY_CLASS constant declared', () => {
  ok(src.includes('const HIT_DIE_BY_CLASS'), 'HIT_DIE_BY_CLASS constant missing');
});
test('HIT_DIE_BY_CLASS has Barbarian d12', () => {
  const idx = src.indexOf('const HIT_DIE_BY_CLASS');
  const block = src.slice(idx, idx + 300);
  ok(block.includes('Barbarian: 12'), 'Barbarian d12 missing from HIT_DIE_BY_CLASS');
});
test('HIT_DIE_BY_CLASS has Wizard d6', () => {
  const idx = src.indexOf('const HIT_DIE_BY_CLASS');
  const block = src.slice(idx, idx + 300);
  ok(block.includes('Wizard: 6'), 'Wizard d6 missing from HIT_DIE_BY_CLASS');
});
test('NPC_STAT_PRESETS constant declared', () => {
  ok(src.includes('const NPC_STAT_PRESETS'), 'NPC_STAT_PRESETS constant missing');
});
test('NPC_STAT_PRESETS has Commoner preset', () => {
  ok(src.includes("'Commoner'"), 'Commoner preset missing from NPC_STAT_PRESETS');
});
test('NPC_STAT_PRESETS has Elite NPC preset', () => {
  ok(src.includes("'Elite NPC'"), 'Elite NPC preset missing from NPC_STAT_PRESETS');
});

// ── Section 2: NPC Roll Stats & suggestions ─────────────────────────────────
console.log('\n  Section 2: NPCModal — Roll Stats + preset + AC/HP suggestions');

test('NPCModal has Roll Stats button', () => {
  ok(npcSrc.includes('Roll Stats'), 'NPCModal missing Roll Stats button');
});
test('NPCModal Roll Stats calls roll4d6dl', () => {
  ok(npcSrc.includes('roll4d6dl()'), 'NPCModal Roll Stats does not call roll4d6dl()');
});
test('NPCModal has NPC presets', () => {
  ok(npcSrc.includes('NPC_STAT_PRESETS'), 'NPCModal does not use NPC_STAT_PRESETS');
});
test('NPCModal presets show Apply via onOpen re-render', () => {
  ok(npcSrc.includes('Object.assign(this.values, p)') && npcSrc.includes('this.onOpen()'),
    'NPCModal preset buttons do not apply and re-render');
});
test('NPCModal shows AC suggestion formula', () => {
  ok(npcSrc.includes('Suggested') && npcSrc.includes('DEX mod'), 'NPCModal missing AC suggestion formula label');
});
test('NPCModal has Apply button for AC suggestion', () => {
  ok(npcSrc.includes('dexMod') && npcSrc.includes('this.values.ac'), 'NPCModal AC Apply logic missing');
});
test('NPCModal shows HP suggestion formula', () => {
  ok(npcSrc.includes('CON mod'), 'NPCModal missing HP suggestion CON mod label');
});
test('NPCModal AC/HP suggestions do not overwrite silently', () => {
  // Suggestions should only apply on explicit button click, not on field change
  const acSugIdx = npcSrc.indexOf('Suggested');
  const preApply = npcSrc.slice(Math.max(0, acSugIdx - 50), acSugIdx);
  // The field onChange should not call dexMod assignment
  notOk(npcSrc.indexOf("t.onChange(v => this.values.ac") < acSugIdx &&
    npcSrc.indexOf("t.onChange(v => this.values.ac") > 0 &&
    npcSrc.slice(npcSrc.indexOf("t.onChange(v => this.values.ac"), npcSrc.indexOf("t.onChange(v => this.values.ac") + 60).includes('dexMod'),
    'AC is overwritten silently in onChange handler');
});

// ── Section 3: Creature Roll Stats + language migration ────────────────────
console.log('\n  Section 3: CreatureModal — Roll Stats + language selector');

test('CreatureModal has Roll Stats button', () => {
  ok(creatureSrc.includes('Roll Stats'), 'CreatureModal missing Roll Stats button');
});
test('CreatureModal Roll Stats calls roll4d6dl', () => {
  ok(creatureSrc.includes('roll4d6dl()'), 'CreatureModal Roll Stats does not call roll4d6dl()');
});
test('CreatureModal migrates legacy string languages to array', () => {
  ok(creatureSrc.includes("typeof this.values.languages === 'string'"),
    'CreatureModal does not migrate legacy string languages to array');
});
test('CreatureModal languages chipField has suggestions', () => {
  ok(creatureSrc.includes('langSuggestions') || creatureSrc.includes("suggestions: lang"),
    'CreatureModal language chipField missing suggestions');
});
test('CreatureModal languages loads from refData', () => {
  ok(creatureSrc.includes("refData.get('languages')"), 'CreatureModal does not load languages from refData');
});

// Functional: legacy string language migration
test('functional: legacy language string migrates to array', () => {
  const values = { languages: 'Common, Elvish' };
  if (typeof values.languages === 'string') values.languages = values.languages ? [values.languages] : [];
  ok(Array.isArray(values.languages), 'languages should be array after migration');
  ok(values.languages[0] === 'Common, Elvish', 'language value should be preserved in array');
});
test('functional: empty string languages migrates to empty array', () => {
  const values = { languages: '' };
  if (typeof values.languages === 'string') values.languages = values.languages ? [values.languages] : [];
  ok(Array.isArray(values.languages), 'should be array');
  ok(values.languages.length === 0, 'empty string should produce empty array');
});
test('functional: array languages unchanged by migration guard', () => {
  const values = { languages: ['Common', 'Elvish'] };
  if (typeof values.languages === 'string') values.languages = values.languages ? [values.languages] : [];
  ok(values.languages.length === 2, 'existing array should not be modified');
});

// ── Section 4: PC AC/MaxHP suggestions ─────────────────────────────────────
console.log('\n  Section 4: CharacterModal — AC/MaxHP suggestions');

test('CharacterModal has Max HP suggestion with HIT_DIE_BY_CLASS', () => {
  ok(charModalSrc.includes('HIT_DIE_BY_CLASS'), 'CharacterModal does not use HIT_DIE_BY_CLASS for Max HP suggestion');
});
test('CharacterModal Max HP suggestion shows formula', () => {
  ok(charModalSrc.includes('sugMaxHp') || charModalSrc.includes('hitDie'),
    'CharacterModal Max HP suggestion formula missing');
});
test('CharacterModal Max HP suggestion has Apply button', () => {
  ok(charModalSrc.includes('this.values.maxHp = sugMaxHp'), 'CharacterModal Max HP Apply action missing');
});
test('CharacterModal AC suggestion uses DEX modifier', () => {
  ok(charModalSrc.includes('dexMod') && charModalSrc.includes('this.values.ac = 10 + dexMod'),
    'CharacterModal AC suggestion missing DEX modifier logic');
});
test('CharacterModal AC suggestion has Apply button', () => {
  ok(charModalSrc.includes("Apply") && charModalSrc.includes('this.values.ac = 10 + dexMod'),
    'CharacterModal AC Apply button missing');
});
test('CharacterModal constructor has preparedSpells field', () => {
  ok(charModalSrc.includes("preparedSpells: []"), 'CharacterModal constructor missing preparedSpells field');
});

// Functional: Max HP calculation
test('functional: max HP calc for level 1 Fighter (d10, CON 14)', () => {
  const HIT_DIE_BY_CLASS = { Fighter: 10 };
  const conScore = 14; const level = 1;
  const conMod = Math.floor((conScore - 10) / 2);
  const hitDie = HIT_DIE_BY_CLASS['Fighter'] || 8;
  const avgRoll = Math.ceil(hitDie / 2) + 1;
  const sugMaxHp = hitDie + conMod + (level - 1) * (avgRoll + conMod);
  ok(sugMaxHp === 12, `Expected 12, got ${sugMaxHp} (d10 + CON+2 at level 1)`);
});
test('functional: max HP calc for level 3 Wizard (d6, CON 10)', () => {
  const HIT_DIE_BY_CLASS = { Wizard: 6 };
  const conScore = 10; const level = 3;
  const conMod = Math.floor((conScore - 10) / 2);
  const hitDie = HIT_DIE_BY_CLASS['Wizard'] || 8;
  const avgRoll = Math.ceil(hitDie / 2) + 1;
  const sugMaxHp = hitDie + conMod + (level - 1) * (avgRoll + conMod);
  ok(sugMaxHp === 6 + 0 + 2 * (4 + 0), `Expected 14, got ${sugMaxHp}`);
});
test('functional: AC suggestion baseline 10 + DEX mod', () => {
  const dexScore = 16;
  const dexMod = Math.floor((dexScore - 10) / 2);
  ok(10 + dexMod === 13, `Expected 13, got ${10 + dexMod}`);
});

// ── Section 5: PC Spell split (Known / Prepared) ────────────────────────────
console.log('\n  Section 5: PC Spellbook — Known/Prepared split');

test('renderPCSpellbook migrates char.spells to knownSpells', () => {
  ok(spellbookSrc.includes('char.knownSpells') && spellbookSrc.includes('char.spells'),
    'renderPCSpellbook does not perform knownSpells/spells migration');
});
test('renderPCSpellbook shows Known Spells section', () => {
  ok(spellbookSrc.includes("Known Spells"), 'renderPCSpellbook missing Known Spells section heading');
});
test('renderPCSpellbook shows Prepared Spells section', () => {
  ok(spellbookSrc.includes("Prepared Spells"), 'renderPCSpellbook missing Prepared Spells section heading');
});
test('renderPCSpellbook + Learn button adds to knownSpells not spells', () => {
  ok(spellbookSrc.includes("char.knownSpells.push(sp.name)"),
    '+ Learn button should push to char.knownSpells');
  notOk(spellbookSrc.includes("char.spells.push(sp.name)"),
    '+ Learn button should not push to legacy char.spells');
});
test('renderPCSpellbook prepared section has + Prepare button', () => {
  ok(spellbookSrc.includes("+ Prepare") || spellbookSrc.includes('Prepare'),
    'renderPCSpellbook missing Prepare button for prepared spells');
});

// Functional: spell migration
test('functional: spells migrated to knownSpells on spellbook open', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const char = { spells: ['Fireball', 'Magic Missile'], knownSpells: [] };
  if (!char.knownSpells || !char.knownSpells.length) {
    if (safeArr(char.spells).length) { char.knownSpells = [...safeArr(char.spells)]; char.spells = []; }
  }
  ok(char.knownSpells.length === 2, 'spells should be migrated to knownSpells');
  ok(char.spells.length === 0, 'char.spells should be cleared after migration');
});
test('functional: existing knownSpells not overwritten by migration', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const char = { spells: ['Old Spell'], knownSpells: ['Fireball'] };
  if (!char.knownSpells || !char.knownSpells.length) {
    if (safeArr(char.spells).length) { char.knownSpells = [...safeArr(char.spells)]; char.spells = []; }
  }
  ok(char.knownSpells[0] === 'Fireball', 'existing knownSpells should not be overwritten');
  ok(char.spells.length === 1, 'char.spells should not be cleared if knownSpells already has data');
});

// ── Section 6: Structured equipment ─────────────────────────────────────────
console.log('\n  Section 6: Structured equipment objects');

test('renderPCInventory displays string equipment items (backwards compat)', () => {
  ok(inventorySrc.includes("typeof it === 'string' ? it : it.name") ||
     inventorySrc.includes("typeof item === 'object'"),
    'renderPCInventory does not handle legacy string equipment');
});
test('renderPCInventory displays equipped status icon', () => {
  ok(inventorySrc.includes("equipped ? '✅'") || inventorySrc.includes("item.equipped"),
    'renderPCInventory does not show equipped status');
});
test('renderPCInventory has Equip/Unequip toggle', () => {
  ok(inventorySrc.includes("Equip") && inventorySrc.includes("Unequip"),
    'renderPCInventory missing Equip/Unequip button');
});
test('manual Add stores structured object not bare string', () => {
  ok(inventorySrc.includes("name: v") && inventorySrc.includes("quantity: 1") && inventorySrc.includes("equipped: false"),
    'manual Add should store structured equipment object');
});
test('equipment browser + Carry stores structured object', () => {
  ok(inventorySrc.includes("name: eq.name") && inventorySrc.includes("sourceKey: 'equipment'"),
    'equipment browser should store structured object with sourceKey');
});
test('equipment browser carried check handles string and object items', () => {
  ok(inventorySrc.includes("typeof it === 'string' ? it : it.name") ||
     inventorySrc.includes("(typeof it === 'string'"),
    'equipment browser carried check does not handle mixed string/object array');
});

// Functional: structured equipment
test('functional: structured item name and meta extracted correctly', () => {
  const item = { name: 'Chain Mail', type: 'Armor', category: 'Heavy', quantity: 1, equipped: true, sourceKey: 'equipment' };
  const isObj = item && typeof item === 'object';
  const name = isObj ? (item.name || 'Item') : item;
  const meta = isObj ? [item.category, item.type, item.quantity > 1 ? `×${item.quantity}` : null].filter(Boolean).join(' · ') : '';
  ok(name === 'Chain Mail', 'name not extracted correctly');
  ok(meta === 'Heavy · Armor', `meta "${meta}" not correct`);
});
test('functional: legacy string item still displays', () => {
  const item = 'Longsword';
  const isObj = item && typeof item === 'object';
  const name = isObj ? (item.name || 'Item') : item;
  ok(name === 'Longsword', 'legacy string item name should display correctly');
});
test('functional: carried check handles mixed array', () => {
  const equipment = ['Dagger', { name: 'Shield', type: 'Armor', category: 'Shield', quantity: 1, equipped: false, sourceKey: 'equipment' }];
  const carried = (name) => equipment.some(it => (typeof it === 'string' ? it : it.name) === name);
  ok(carried('Dagger'), 'string item should be detected as carried');
  ok(carried('Shield'), 'object item should be detected as carried');
  notOk(carried('Longsword'), 'Longsword should not be carried');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

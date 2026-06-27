// Phase 273 tests — ReferenceDataService, Monster helpers, REF_TABS, REF_DATA_FILES
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

let passed = 0;
let failed = 0;
function assert(name, cond) {
  if (cond) { console.log('  PASS:', name); passed++; }
  else { console.error('  FAIL:', name); failed++; }
}

// ── Section 1: REF_DATA_FILES has new keys ──────────────────────────────────
console.log('\nREF_DATA_FILES new keys:');
assert('bestiary key', src.includes("bestiary: 'bestiary.json'"));
assert('monsterFluff key', src.includes("monsterFluff: 'bestiary.json'"));
assert('classes key', src.includes("classes: 'class.json'"));
assert('subclasses key', src.includes("subclasses: 'class.json'"));
assert('classFeatures key', src.includes("classFeatures: 'class.json'"));
assert('subclassFeatures key', src.includes("subclassFeatures: 'class.json'"));
assert('adventures key', src.includes("adventures: 'adventure.json'"));
assert('books key', src.includes("books: 'book.json'"));
assert('generated key', src.includes("generated: 'generated.json'"));

// ── Section 2: extractReferenceArray function exists ────────────────────────
console.log('\nextractReferenceArray function:');
assert('function defined', src.includes('function extractReferenceArray(type, raw)'));
assert('bestiary case returns monster', src.includes("case 'bestiary': return raw.monster || [];"));
assert('classes case returns raw.class', src.includes("case 'classes': return raw.class || [];"));
assert('subclasses case returns raw.subclass', src.includes("case 'subclasses': return raw.subclass || [];"));
assert('adventures/books case returns raw.data', src.includes("case 'adventures': case 'books': return raw.data || [];"));

// ── Section 3: ReferenceDataService has _rawCache ───────────────────────────
console.log('\nReferenceDataService upgrades:');
assert('_rawCache in constructor', src.includes('this._rawCache = {}'));
assert('_loadRaw method', src.includes('async _loadRaw(filename)'));
assert('_rawCache check', src.includes('this._rawCache[filename] !== undefined'));
assert('search includes cr field', src.includes("String(it.cr||'')"));
assert('search includes className field', src.includes("it.className"));

// ── Section 4: REF_TABS has new entries ─────────────────────────────────────
console.log('\nREF_TABS new entries:');
assert('bestiary tab', src.includes("{ key:'bestiary',    label:'Bestiary'"));
assert('classes tab', src.includes("{ key:'classes',     label:'Classes'"));
assert('subclasses tab', src.includes("{ key:'subclasses',  label:'Subclasses'"));
assert('adventures tab removed from REF_TABS', !src.includes("{ key:'adventures',  label:'Adventures'"));
assert('books tab removed from REF_TABS', !src.includes("{ key:'books',       label:'Books'"));

// ── Section 5: refItemMeta new cases ────────────────────────────────────────
console.log('\nrefItemMeta new cases:');
assert("bestiary case", src.includes("case 'bestiary': {"));
assert("classes case", src.includes("case 'classes': return"));
assert("subclasses case", src.includes("case 'subclasses': return"));
assert("adventures/books case", src.includes("case 'adventures': case 'books': return item.source"));

// ── Section 6: Monster helpers ──────────────────────────────────────────────
console.log('\nMonster helper functions:');
assert('getMonsterArmorClass defined', src.includes('function getMonsterArmorClass(m)'));
assert('getMonsterAverageHp defined', src.includes('function getMonsterAverageHp(m)'));
assert('getMonsterDex defined', src.includes('function getMonsterDex(m)'));
assert('getMonsterInitiativeMod defined', src.includes('function getMonsterInitiativeMod(m)'));
assert('getMonsterCr defined', src.includes('function getMonsterCr(m)'));
assert('getMonsterXp defined', src.includes('function getMonsterXp(m)'));
assert('CR_XP table defined', src.includes("const CR_XP = {"));
assert('normaliseBestiaryMonsterForCombat defined', src.includes('function normaliseBestiaryMonsterForCombat(m)'));
assert('normaliseBestiaryMonsterForCombat returns sourceReferenceType', src.includes("sourceReferenceType: 'bestiary'"));

// ── Section 7: AddCombatantModal bestiary mode ──────────────────────────────
console.log('\nAddCombatantModal bestiary mode:');
assert("bestiary mode comment in constructor", src.includes("'manual' | 'entity' | 'bestiary'"));
assert('Pick from Bestiary button', src.includes("'Pick from Bestiary'"));
assert('bestiary mode block', src.includes("if (this.mode === 'bestiary')"));
assert('buildBestiaryList function', src.includes('buildBestiaryList'));
assert('normaliseBestiaryMonsterForCombat called in modal', src.includes('normaliseBestiaryMonsterForCombat(m)'));

// ── Section 8: CharacterModal subclass ──────────────────────────────────────
console.log('\nCharacterModal subclass:');
assert('subclass in default values', src.includes("subclass: ''"));
assert('refData get classes called', src.includes("refData.get('classes').then(classes =>"));
assert('Subclass Setting added', src.includes("setName('Subclass')"));
assert('refData get subclasses called', src.includes("refData.get('subclasses').then(subs =>"));

// ── Section 9: Diagnostics reference data check ─────────────────────────────
console.log('\nDiagnostics reference data:');
assert('refChecked Set in runDiagnostics', src.includes('const refChecked = new Set()'));
assert('REF_DATA_FILES loop in diagnostics', src.includes('for (const [type, filename] of Object.entries(REF_DATA_FILES))'));
assert('Reference data missing warn', src.includes('Reference data missing: data/'));
assert('Reference Data Health section', src.includes("sectionHead(main, 'Reference Data Health')"));
assert('Check Reference Data button', src.includes("'📊 Check Reference Data'"));

// ── Section 10: refItemDetail bestiary block ─────────────────────────────────
console.log('\nrefItemDetail bestiary block:');
assert('bestiary detail block', src.includes("if (type === 'bestiary') {"));
assert('getMonsterArmorClass called in detail', /if \(type === 'bestiary'\)[\s\S]{0,500}getMonsterArmorClass/.test(src));
assert('classes detail block', src.includes("if (type === 'classes') {"));
assert('subclasses detail block', src.includes("if (type === 'subclasses') {"));

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

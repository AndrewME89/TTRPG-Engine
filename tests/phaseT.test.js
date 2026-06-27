'use strict';
/**
 * Phase T — Compendium Merge & Rollable Tables
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

const refTabsIdx = src.indexOf('const REF_TABS');
const refTabsEnd = src.indexOf('\n];', refTabsIdx);
const refTabsBlock = src.slice(refTabsIdx, refTabsEnd + 3);

const compLibIdx = src.indexOf('function renderCompendiumLibrary(');
const compLibEnd = src.indexOf('\nfunction renderMyContent(', compLibIdx);
const compLibBlock = src.slice(compLibIdx, compLibEnd);

const refFnIdx = src.indexOf('async function renderReference(');
const refFnEnd = src.indexOf('\nclass TTRPGEnginePlugin extends Plugin', refFnIdx);
const refFnBlock = src.slice(refFnIdx, refFnEnd);

const libIdx = src.indexOf('function renderLibrary(');
const libEnd = src.indexOf('\nfunction rollTable(', libIdx);
const libBlock = src.slice(libIdx, libEnd);

const rtModalIdx = src.indexOf('class RollableTableModal');
const rtModalEnd = src.indexOf('\n// HomebrewModal', rtModalIdx);
const rtModalBlock = src.slice(rtModalIdx, rtModalEnd);

const rollFnIdx = src.indexOf('function rollStructuredTable(');
const rollFnEnd = src.indexOf('\n}', rollFnIdx);
const rollFnBlock = src.slice(rollFnIdx, rollFnEnd + 2);

console.log('\nPhase T — Compendium Merge & Rollable Tables\n');

console.log('  Section 1: REF_TABS — cleanup and alphabetization');
test('REF_TABS does not include Adventures', () => {
  notOk(refTabsBlock.includes("key:'adventures'") || refTabsBlock.includes("key: 'adventures'"),
    'REF_TABS still contains adventures entry');
});
test('REF_TABS does not include Books', () => {
  notOk(refTabsBlock.includes("key:'books'") || refTabsBlock.includes("key: 'books'"),
    'REF_TABS still contains books entry');
});
test('REF_TABS still has Spells', () => {
  ok(refTabsBlock.includes("key:'spells'"), 'REF_TABS missing spells');
});
test('REF_TABS still has Bestiary', () => {
  ok(refTabsBlock.includes("key:'bestiary'"), 'REF_TABS missing bestiary');
});
test('REF_TABS is alphabetized (Actions before Backgrounds before Bestiary)', () => {
  const actionsIdx = refTabsBlock.indexOf("key:'actions'");
  const backgroundsIdx = refTabsBlock.indexOf("key:'backgrounds'");
  const bestiaryIdx = refTabsBlock.indexOf("key:'bestiary'");
  ok(actionsIdx < backgroundsIdx, 'Actions should come before Backgrounds');
  ok(backgroundsIdx < bestiaryIdx, 'Backgrounds should come before Bestiary');
});

console.log('\n  Section 2: Compendium navigation merge');
test('renderCompendiumLibrary has Compendium tab', () => {
  ok(compLibBlock.includes("id: 'compendium'"), 'Compendium tab missing');
});
test('renderCompendiumLibrary does not have separate 5e Reference tab', () => {
  notOk(compLibBlock.includes("id: 'reference'"), '5e Reference tab should have been merged');
});
test('renderCompendiumLibrary does not have separate Homebrew tab', () => {
  notOk(compLibBlock.includes("id: 'homebrew'"), 'Homebrew tab should not remain in Compendium');
});
test('renderCompendiumLibrary redirects legacy my-content/reference/homebrew routes', () => {
  ok(compLibBlock.includes("'my-content'") && compLibBlock.includes("'reference'") && compLibBlock.includes("'homebrew'"),
    'Legacy compendium routes should redirect to compendium');
});
test('renderCompendiumLibrary routes to renderReference', () => {
  ok(compLibBlock.includes('renderReference'), 'Compendium should render through renderReference');
});

console.log('\n  Section 3: renderReference — Compendium actions');
test('renderReference page title is Compendium', () => {
  ok(refFnBlock.includes("'Compendium'"), 'renderReference should title the page Compendium');
});
test('renderReference has Import button', () => {
  ok(refFnBlock.includes('Import') && refFnBlock.includes('ImportModal'),
    'Compendium missing Import button');
});
test('renderReference has Export button', () => {
  ok(refFnBlock.includes('Export') && refFnBlock.includes('exportBackup'),
    'Compendium missing Export button');
});
test('renderReference does not expose creation buttons', () => {
  notOk(refFnBlock.includes('Create Homebrew') || refFnBlock.includes('RollableTableModal') || refFnBlock.includes('+ Spell') || refFnBlock.includes('+ Monster') || refFnBlock.includes('+ Item'),
    'Compendium should not expose creation buttons');
});

console.log('\n  Section 4: renderReference — search and filters');
test('renderReference search bar includes clear button', () => {
  ok(refFnBlock.includes('× Clear'), 'Compendium search bar missing clear button');
});
test('renderReference uses REF_TABS type filter buttons', () => {
  ok(refFnBlock.includes('REF_TABS') && refFnBlock.includes('is-primary'),
    'Compendium should use REF_TABS buttons as type filters');
});
test('renderReference does not render visibility/campaign/status filters', () => {
  notOk(refFnBlock.includes('All Visibility'), 'Visibility filter should not render in Compendium');
  notOk(refFnBlock.includes('All Campaigns'), 'Campaign filter should not render in Compendium');
  notOk(refFnBlock.includes('All Status'), 'Status filter should not render in Compendium');
});
test('renderReference removes broken go-to-reference button', () => {
  notOk(refFnBlock.includes('Open 5e Reference Browser') || refFnBlock.includes('Go to 5e Reference') || refFnBlock.includes('Search Library elsewhere'),
    'Broken redirect-to-reference button should be removed');
});

console.log('\n  Section 5: renderReference — merged results');
test('renderReference keeps former reference result format', () => {
  ok(refFnBlock.includes('te-card te-ref-card') && refFnBlock.includes('refItemDetail'),
    'Compendium results should still use reference card/detail format');
});
test('renderReference merges local compendium and homebrew results by type', () => {
  ok(src.includes('buildCompendiumLocalResults') && src.includes('homebrewMatchesRefTab') && src.includes('compendiumEntryMatchesRefTab'),
    'Compendium should merge local library records into typed results');
});
test('renderReference starts with 5-result limit and load more control', () => {
  ok(refFnBlock.includes('limit: 5') && refFnBlock.includes('Load more results...') && refFnBlock.includes('rs.limit += 5'),
    'Compendium should support 5-result progressive loading');
});
test('renderLibrary is now a legacy alias to renderReference', () => {
  ok(libBlock.includes('return renderReference'), 'Legacy renderLibrary should delegate to renderReference');
});

console.log('\n  Section 6: RollableTableModal');
test('RollableTableModal class exists', () => {
  ok(src.includes('class RollableTableModal'), 'RollableTableModal class missing');
});
test('RollableTableModal constructor has core fields', () => {
  ok(rtModalBlock.includes('campaignId'), 'RollableTableModal missing campaignId');
  ok(rtModalBlock.includes("name: ''"), 'RollableTableModal missing name');
  ok(rtModalBlock.includes('diceFormula'), 'RollableTableModal missing diceFormula');
  ok(rtModalBlock.includes('rows: []'), 'RollableTableModal missing rows array');
});
test('RollableTableModal supports rolling and save', () => {
  ok(rtModalBlock.includes('rollStructuredTable'), 'RollableTableModal should call rollStructuredTable');
  ok(rtModalBlock.includes("upsert(this.plugin.state, 'tables'"), 'RollableTableModal should save to tables');
});

console.log('\n  Section 7: rollStructuredTable function');
test('rollStructuredTable function exists', () => {
  ok(src.includes('function rollStructuredTable('), 'rollStructuredTable function missing');
});
test('rollStructuredTable parses dice formula and matches rows', () => {
  ok(rollFnBlock.includes('match') && rollFnBlock.includes('find') && rollFnBlock.includes('min') && rollFnBlock.includes('max'),
    'rollStructuredTable should parse formula and match rows by range');
});
test('legacy rollTable function still exists', () => {
  ok(src.includes('function rollTable('), 'legacy rollTable function was removed');
});

console.log('\n  Section 8: Functional — rollStructuredTable');
function rollStructuredTableTest(formula, rows) {
  const structured = (Array.isArray(rows) ? rows : []).filter(r => r.result);
  if (!structured.length) return 'No rows defined.';
  const m = String(formula || '1d6').match(/^(\d+)d(\d+)$/i);
  const count = m ? Math.max(1, parseInt(m[1])) : 1;
  const sides = m ? Math.max(1, parseInt(m[2])) : 6;
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
  const matched = structured.find(r => total >= (Number(r.min) || 1) && total <= (Number(r.max) || Number(r.min) || sides));
  return matched
    ? `${total}: ${matched.result}${matched.notes ? ` — ${matched.notes}` : ''}`
    : `${total}: No matching row.`;
}
test('functional: rollStructuredTable returns a matching row', () => {
  const rows = [{ min: 1, max: 3, result: 'Low' }, { min: 4, max: 6, result: 'High' }];
  for (let i = 0; i < 20; i++) {
    const r = rollStructuredTableTest('1d6', rows);
    ok(r.includes('Low') || r.includes('High'), `Unexpected result: ${r}`);
  }
});
test('functional: rollStructuredTable handles empty rows', () => {
  ok(rollStructuredTableTest('1d6', []) === 'No rows defined.', 'Empty rows should return "No rows defined."');
});

console.log('\n——————————————————————————————————————————————————');
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

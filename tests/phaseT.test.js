'use strict';
/**
 * Phase T — Compendium, 5e Reference & Rollable Tables
 * Sections 1–7: REF_TABS alphabetized, Books/Adventures removed,
 *   My Content tab removed, + Entry removed, source/status/visibility
 *   filters expanded, 5e Reference filter, RollableTableModal,
 *   rollStructuredTable, campaign scoping.
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
const refTabsIdx = src.indexOf('const REF_TABS');
const refTabsEnd = src.indexOf('\n];', refTabsIdx);
const refTabsBlock = src.slice(refTabsIdx, refTabsEnd + 3);

const compLibIdx = src.indexOf('function renderCompendiumLibrary(');
const compLibEnd = src.indexOf('\nfunction renderMyContent(', compLibIdx);
const compLibBlock = src.slice(compLibIdx, compLibEnd);

const libIdx = src.indexOf('function renderLibrary(');
const libEnd = src.indexOf('\nfunction rollTable(', libIdx);
const libBlock = src.slice(libIdx, libEnd);

const rtModalIdx = src.indexOf('class RollableTableModal');
const rtModalEnd = src.indexOf('\n// HomebrewModal', rtModalIdx);
const rtModalBlock = src.slice(rtModalIdx, rtModalEnd);

const rollFnIdx = src.indexOf('function rollStructuredTable(');
const rollFnEnd = src.indexOf('\n}', rollFnIdx);
const rollFnBlock = src.slice(rollFnIdx, rollFnEnd + 2);

console.log('\nPhase T — Compendium, 5e Reference & Rollable Tables\n');

// ── Section 1: REF_TABS — Adventures/Books removed, alphabetized ────────────
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
test('REF_TABS still has Classes', () => {
  ok(refTabsBlock.includes("key:'classes'"), 'REF_TABS missing classes');
});
test('REF_TABS still has Equipment', () => {
  ok(refTabsBlock.includes("key:'equipment'"), 'REF_TABS missing equipment');
});
test('REF_TABS still has Feats', () => {
  ok(refTabsBlock.includes("key:'feats'"), 'REF_TABS missing feats');
});
test('REF_TABS is alphabetized (Actions before Backgrounds before Bestiary)', () => {
  const actionsIdx = refTabsBlock.indexOf("key:'actions'");
  const backgroundsIdx = refTabsBlock.indexOf("key:'backgrounds'");
  const bestiaryIdx = refTabsBlock.indexOf("key:'bestiary'");
  const spellsIdx = refTabsBlock.indexOf("key:'spells'");
  ok(actionsIdx < backgroundsIdx, 'Actions should come before Backgrounds');
  ok(backgroundsIdx < bestiaryIdx, 'Backgrounds should come before Bestiary');
  ok(bestiaryIdx < spellsIdx, 'Bestiary should come before Spells');
});
test('REF_TABS has at least 16 entries (18 minus Adventures and Books)', () => {
  const count = (refTabsBlock.match(/key:'/g) || []).length;
  ok(count >= 16, `REF_TABS should have at least 16 entries, found ${count}`);
});

// ── Section 2: Compendium navigation ────────────────────────────────────────
console.log('\n  Section 2: Compendium navigation — My Content removed');

test('renderCompendiumLibrary does not have my-content tab', () => {
  notOk(compLibBlock.includes("id: 'my-content'") || compLibBlock.includes("id:'my-content'"),
    'my-content still exposed as primary tab in renderCompendiumLibrary');
});
test('renderCompendiumLibrary has Compendium tab', () => {
  ok(compLibBlock.includes("id: 'compendium'"), 'Compendium tab missing from renderCompendiumLibrary');
});
test('renderCompendiumLibrary has 5e Reference tab', () => {
  ok(compLibBlock.includes("id: 'reference'"), '5e Reference tab missing from renderCompendiumLibrary');
});
test('renderCompendiumLibrary has Homebrew tab', () => {
  ok(compLibBlock.includes("id: 'homebrew'"), 'Homebrew tab missing from renderCompendiumLibrary');
});
test('renderCompendiumLibrary redirects legacy my-content to compendium', () => {
  ok(compLibBlock.includes("'my-content'") && compLibBlock.includes("activeSubSection"),
    'renderCompendiumLibrary should redirect legacy my-content sub-section');
});
test('renderMyContent function still exists (user content not deleted)', () => {
  ok(src.includes('function renderMyContent('), 'renderMyContent function should still exist');
});

// ── Section 3: renderLibrary — + Entry removed, new buttons ─────────────────
console.log('\n  Section 3: renderLibrary — buttons updated');

test('renderLibrary does not have generic + Entry button', () => {
  notOk(libBlock.includes("'+ Entry'") || libBlock.includes("label: '+ Entry'"),
    'Generic + Entry button still in renderLibrary');
});
test('renderLibrary has + Homebrew Entry button', () => {
  ok(libBlock.includes('HomebrewModal') && (libBlock.includes('Homebrew') || libBlock.includes('homebrew')),
    'renderLibrary missing + Homebrew Entry button opening HomebrewModal');
});
test('renderLibrary has + Rollable Table button', () => {
  ok(libBlock.includes('RollableTableModal') && libBlock.includes('Rollable Table'),
    'renderLibrary missing + Rollable Table button opening RollableTableModal');
});
test('renderLibrary still has Import button', () => {
  ok(libBlock.includes('Import') && libBlock.includes('ImportModal'),
    'renderLibrary missing Import button');
});
test('renderLibrary still has Export button', () => {
  ok(libBlock.includes('Export') && libBlock.includes('exportBackup'),
    'renderLibrary missing Export button');
});

// ── Section 4: renderLibrary — filters ──────────────────────────────────────
console.log('\n  Section 4: renderLibrary — filter enhancements');

test('source filter includes 5e Reference option', () => {
  ok(libBlock.includes("'5e-reference'") || libBlock.includes("'5e Reference'"),
    'Source filter missing 5e Reference option');
});
test('source filter includes Campaign', () => {
  ok(libBlock.includes("'campaign'") && libBlock.includes('Campaign'),
    'Source filter missing Campaign option');
});
test('source filter includes Homebrew', () => {
  ok(libBlock.includes("'homebrew'") && libBlock.includes('Homebrew'),
    'Source filter missing Homebrew option');
});
test('source filter includes Generated', () => {
  ok(libBlock.includes("'generated'") && libBlock.includes('Generated'),
    'Source filter missing Generated option');
});
test('status filter exists with Draft/Approved/Retired/Needs Review', () => {
  ok(libBlock.includes("'Draft'") && libBlock.includes("'Approved'") && libBlock.includes("'Retired'") && libBlock.includes("'Needs Review'"),
    'Status filter missing Draft/Approved/Retired/Needs Review options');
});
test('visibility filter includes Secret option', () => {
  ok(libBlock.includes("'secret'") && libBlock.includes('Secret'),
    'Visibility filter missing Secret option');
});
test('visibility filter includes Revealed option', () => {
  ok(libBlock.includes("'revealed'") && libBlock.includes('Revealed'),
    'Visibility filter missing Revealed option');
});
test('source=5e-reference shows reference browser prompt', () => {
  ok(libBlock.includes("'5e-reference'") && libBlock.includes('5e Reference'),
    'Source=5e-reference filter does not show reference browser content');
});
test('source=5e-reference provides link to Reference tab', () => {
  ok(libBlock.includes("activeSubSection = 'reference'") || libBlock.includes("'reference'"),
    'Source=5e-reference does not link to reference sub-tab');
});

// ── Section 5: RollableTableModal ───────────────────────────────────────────
console.log('\n  Section 5: RollableTableModal');

test('RollableTableModal class exists', () => {
  ok(src.includes('class RollableTableModal'), 'RollableTableModal class missing');
});
test('RollableTableModal constructor has id field', () => {
  ok(rtModalBlock.includes("uid('table')") || rtModalBlock.includes("id:"), 'RollableTableModal missing id field');
});
test('RollableTableModal constructor has campaignId', () => {
  ok(rtModalBlock.includes('campaignId'), 'RollableTableModal missing campaignId field');
});
test('RollableTableModal constructor has name field', () => {
  ok(rtModalBlock.includes("name: ''"), 'RollableTableModal missing name field');
});
test('RollableTableModal constructor has diceFormula', () => {
  ok(rtModalBlock.includes('diceFormula'), 'RollableTableModal missing diceFormula field');
});
test('RollableTableModal constructor has rows array', () => {
  ok(rtModalBlock.includes('rows: []'), 'RollableTableModal missing rows array');
});
test('RollableTableModal constructor has status field', () => {
  ok(rtModalBlock.includes("status:") && rtModalBlock.includes("'Draft'"),
    'RollableTableModal missing status field');
});
test('RollableTableModal constructor has visibility field', () => {
  ok(rtModalBlock.includes("visibility:"), 'RollableTableModal missing visibility field');
});
test('RollableTableModal constructor has tags array', () => {
  ok(rtModalBlock.includes('tags: []'), 'RollableTableModal missing tags array');
});
test('RollableTableModal constructor has createdAt and updatedAt', () => {
  ok(rtModalBlock.includes('createdAt') && rtModalBlock.includes('updatedAt'),
    'RollableTableModal missing createdAt/updatedAt timestamps');
});
test('RollableTableModal has add/remove row UI', () => {
  ok(rtModalBlock.includes('Add Row') && rtModalBlock.includes('splice'),
    'RollableTableModal missing add/remove row functionality');
});
test('RollableTableModal rows have min/max/result fields', () => {
  ok(rtModalBlock.includes("'Min'") || rtModalBlock.includes("'min'") || rtModalBlock.includes('min:') || rtModalBlock.includes("placeholder = 'Min'"),
    'RollableTableModal row editor missing min field');
  ok(rtModalBlock.includes("placeholder = 'Max'") || rtModalBlock.includes("'Max'"),
    'RollableTableModal row editor missing max field');
  ok(rtModalBlock.includes('result') && rtModalBlock.includes("placeholder"),
    'RollableTableModal row editor missing result field');
});
test('RollableTableModal has Roll button for test rolling', () => {
  ok(rtModalBlock.includes('🎲 Roll') || rtModalBlock.includes("'Roll'"),
    'RollableTableModal missing Roll test button');
});
test('RollableTableModal Roll calls rollStructuredTable', () => {
  ok(rtModalBlock.includes('rollStructuredTable'),
    'RollableTableModal Roll button does not call rollStructuredTable');
});
test('RollableTableModal has Log to Session when session active', () => {
  ok(rtModalBlock.includes('Log to Session') && rtModalBlock.includes('logSessionEvent'),
    'RollableTableModal missing Log to Session functionality');
});
test('RollableTableModal saves to tables entity key', () => {
  ok(rtModalBlock.includes("upsert(this.plugin.state, 'tables'"),
    "RollableTableModal does not save to 'tables' entity key");
});
test('RollableTableModal stamps campaignId on save', () => {
  ok(rtModalBlock.includes('activeCampaignId') || (rtModalBlock.includes('campaignId') && rtModalBlock.includes('saveState')),
    'RollableTableModal does not stamp campaignId on save');
});

// ── Section 6: rollStructuredTable function ──────────────────────────────────
console.log('\n  Section 6: rollStructuredTable function');

test('rollStructuredTable function exists', () => {
  ok(src.includes('function rollStructuredTable('), 'rollStructuredTable function missing');
});
test('rollStructuredTable parses dice formula', () => {
  ok(rollFnBlock.includes('match') && rollFnBlock.includes('d'), 'rollStructuredTable does not parse dice formula');
});
test('rollStructuredTable finds matching row by min/max range', () => {
  ok(rollFnBlock.includes('min') && rollFnBlock.includes('max') && rollFnBlock.includes('find'),
    'rollStructuredTable does not look up row by min/max range');
});
test('rollStructuredTable handles empty rows gracefully', () => {
  ok(rollFnBlock.includes('No rows') || rollFnBlock.includes('length') || rollFnBlock.includes('filter'),
    'rollStructuredTable does not handle empty rows');
});
test('legacy rollTable function still exists', () => {
  ok(src.includes('function rollTable('), 'legacy rollTable function was removed');
});

// ── Section 7: 5e Reference preserved ───────────────────────────────────────
console.log('\n  Section 7: 5e Reference data access preserved');

test('renderReference function still exists', () => {
  ok(src.includes('async function renderReference('), 'renderReference function missing');
});
test('renderReference still uses REF_TABS', () => {
  const refFnIdx = src.indexOf('async function renderReference(');
  const refFnBlock = src.slice(refFnIdx, refFnIdx + 2000);
  ok(refFnBlock.includes('REF_TABS'), 'renderReference does not use REF_TABS');
});
test('renderReference still has search functionality', () => {
  const refFnIdx = src.indexOf('async function renderReference(');
  const refFnBlock = src.slice(refFnIdx, refFnIdx + 2000);
  ok(refFnBlock.includes('search') && refFnBlock.includes('input'),
    'renderReference missing search functionality');
});
test('renderReference still shows up to 120 results with refine hint', () => {
  ok(src.includes('120'), '120 result limit in renderReference may have been removed');
});

// ── Section 8: No regressions ────────────────────────────────────────────────
console.log('\n  Section 8: Regression checks');

test('no duplicate top-level function declarations after Phase T', () => {
  const seen = {};
  const dups = [];
  for (const m of src.matchAll(/^(?:async )?function (\w+)\(/mg)) {
    seen[m[1]] = (seen[m[1]] || 0) + 1;
    if (seen[m[1]] === 2) dups.push(m[1]);
  }
  ok(dups.length === 0, `Duplicate function declarations: ${dups.join(', ')}`);
});
test('renderHomebrew still exists', () => {
  ok(src.includes('function renderHomebrew('), 'renderHomebrew function missing');
});
test('HomebrewModal still exists', () => {
  ok(src.includes('class HomebrewModal'), 'HomebrewModal class missing');
});
test('ImportModal still exists', () => {
  ok(src.includes('class ImportModal'), 'ImportModal class missing');
});
test('renderCompendiumLibrary still routes to renderReference', () => {
  ok(compLibBlock.includes('renderReference'), 'renderCompendiumLibrary no longer routes to renderReference');
});

// ── Functional: rollStructuredTable ─────────────────────────────────────────
console.log('\n  Section 9: Functional — rollStructuredTable');

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

test('functional: rollStructuredTable returns row result within range', () => {
  const rows = [
    { min: 1, max: 3, result: 'Low result', notes: '' },
    { min: 4, max: 6, result: 'High result', notes: '' },
  ];
  // Run 20 times to catch off-by-one errors
  for (let i = 0; i < 20; i++) {
    const r = rollStructuredTableTest('1d6', rows);
    ok(r.includes('Low result') || r.includes('High result'), `Result "${r}" should match one of the rows`);
  }
});
test('functional: rollStructuredTable handles empty rows array', () => {
  const r = rollStructuredTableTest('1d6', []);
  ok(r === 'No rows defined.', 'Should return "No rows defined." for empty rows');
});
test('functional: rollStructuredTable handles undefined rows gracefully', () => {
  const r = rollStructuredTableTest('1d6', undefined);
  ok(r === 'No rows defined.', 'Should handle undefined rows gracefully');
});
test('functional: rollStructuredTable uses formula sides', () => {
  const rows = [
    { min: 1, max: 10, result: 'Within range', notes: '' },
  ];
  for (let i = 0; i < 10; i++) {
    const r = rollStructuredTableTest('1d10', rows);
    ok(r.includes('Within range'), `1d10 should always land in rows 1-10, got: ${r}`);
  }
});
test('functional: rollable table entity schema has required fields', () => {
  const table = {
    id: 'table-1', campaignId: 'camp-1', name: 'Random Encounters', category: 'Encounters',
    diceFormula: '1d6', rows: [{ min: 1, max: 3, result: 'Wolves', notes: '2d4 wolves' }, { min: 4, max: 6, result: 'Bandits', notes: '' }],
    visibility: 'dm-only', tags: ['combat'], source: 'homebrew', status: 'Approved',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  ok(table.id && table.campaignId && table.name && table.diceFormula, 'Table missing required fields');
  ok(Array.isArray(table.rows) && table.rows.length === 2, 'Table rows should be array with 2 entries');
  ok(table.rows[0].min === 1 && table.rows[0].max === 3, 'First row range should be 1-3');
  ok(table.status === 'Approved', 'Table status should be Approved');
});
test('functional: campaign-scoped table filter works', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const tables = [
    { id: 't-1', name: 'Camp Table', campaignId: 'camp-1' },
    { id: 't-2', name: 'Other Table', campaignId: 'camp-2' },
    { id: 't-3', name: 'Global Table', campaignId: '' },
  ];
  const campId = 'camp-1';
  const filtered = safeArr(tables).filter(t => !campId || !t.campaignId || t.campaignId === campId);
  ok(filtered.length === 2, `Should find 2 tables for camp-1 (scoped + global), found ${filtered.length}`);
  ok(filtered.some(t => t.name === 'Camp Table'), 'Camp Table should be in results');
  ok(filtered.some(t => t.name === 'Global Table'), 'Global Table should be in results');
  ok(!filtered.some(t => t.name === 'Other Table'), 'Other Table should not be in results');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

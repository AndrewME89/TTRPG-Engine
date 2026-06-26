'use strict';
/**
 * Phase M — Performance & Click-Jump Hardening
 * Sections 1–8: quiet save patterns in hot paths, no duplicated critical
 *   document-level listeners, reduced full-save in repeated interactions,
 *   tile map teardown preserved, compendium filter local state preserved.
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
function count(pattern) { return (src.match(pattern) || []).length; }

// Slice key render functions
const warMachStart = src.indexOf('\n// ── WAR MACHINE (Phase 11)');
const warMachEnd   = src.indexOf('\n// ── FACTION MATRIX (Phase 12)', warMachStart);
const warMach      = src.slice(warMachStart, warMachEnd);

const initStart  = src.indexOf('function renderInitiativeTracker(');
const initEnd    = src.indexOf('\n// ── RULES', initStart);
const initFn     = src.slice(initStart, initEnd);

const rsStart    = src.indexOf('function renderRunSession(');
const rsEnd      = src.indexOf('\n// ── WAR MACHINE', rsStart);
const rsFn       = src.slice(rsStart, rsEnd);

const pcCharStart = src.indexOf('function renderPCCharacter(');
const pcCharEnd   = src.indexOf('\nasync function renderPCInventory(', pcCharStart);
const pcChar      = src.slice(pcCharStart, pcCharEnd);

const pcInvStart = src.indexOf('async function renderPCInventory(');
const pcInvEnd   = src.indexOf('\nasync function renderPCSpellbook(', pcInvStart);
const pcInv      = src.slice(pcInvStart, pcInvEnd);

const pcSpellsStart = src.indexOf('async function renderPCSpellbook(');
const pcSpellsEnd   = src.indexOf('\nfunction renderPCQuests(', pcSpellsStart);
const pcSpells      = src.slice(pcSpellsStart, pcSpellsEnd);

const tmStart  = src.indexOf('function renderTileMapBuilder(');
const tmEnd    = src.indexOf('\n// ── WAR MACHINE (Phase 11)', tmStart);
const tmFn     = src.slice(tmStart, tmEnd);

const libStart = src.indexOf('function renderLibrary(');
const libEnd   = src.indexOf('\nfunction rollTable(', libStart);
const libFn    = src.slice(libStart, libEnd);

console.log('\nPhase M — Performance & Click-Jump Hardening\n');

// ── Section 1: Run Session timer hot paths use saveStateQuiet ────────────────
console.log('  Section 1: Run Session timer hot paths');

test('Run Session rebuildTimers uses saveStateQuiet for +Tick', () => {
  const rebuildIdx = rsFn.indexOf('const rebuildTimers');
  const rebuildFn  = rsFn.slice(rebuildIdx, rebuildIdx + 2000);
  ok(rebuildFn.includes('saveStateQuiet'), 'Run Session rebuildTimers not using saveStateQuiet');
  notOk(rebuildFn.includes('plugin.saveState()'), 'Run Session rebuildTimers using full saveState');
});

test('Run Session rebuildTimers uses saveStateQuiet for Delete', () => {
  const rebuildIdx = rsFn.indexOf('const rebuildTimers');
  const rebuildFn  = rsFn.slice(rebuildIdx, rebuildIdx + 2000);
  const delIdx     = rebuildFn.indexOf("'Timer Removed'");
  ok(delIdx !== -1, 'Timer Removed log event not found in rebuildTimers');
  const delBlock   = rebuildFn.slice(delIdx, delIdx + 100);
  ok(delBlock.includes('saveStateQuiet'), 'Run Session timer Delete not using saveStateQuiet');
});

// ── Section 2: War Machine timer hot paths use saveStateQuiet ────────────────
console.log('\n  Section 2: War Machine timer hot paths');

test('War Machine +Tick uses saveStateQuiet not full saveState', () => {
  const tickIdx   = warMach.indexOf("'+Tick'");
  ok(tickIdx !== -1, 'War Machine +Tick button not found');
  const tickBlock = warMach.slice(tickIdx, tickIdx + 200);
  ok(tickBlock.includes('saveStateQuiet'), 'War Machine +Tick not using saveStateQuiet');
  notOk(tickBlock.includes('plugin.saveState()'), 'War Machine +Tick using full saveState');
});

test('War Machine Reset uses saveStateQuiet not full saveState', () => {
  const resetIdx   = warMach.indexOf("'Reset'");
  ok(resetIdx !== -1, 'War Machine Reset button not found');
  const resetBlock = warMach.slice(resetIdx, resetIdx + 160);
  ok(resetBlock.includes('saveStateQuiet'), 'War Machine Reset not using saveStateQuiet');
  notOk(resetBlock.includes('plugin.saveState()'), 'War Machine Reset using full saveState');
});

test('War Machine timer Delete saves state (destructive, intentional)', () => {
  ok(warMach.includes("removeItem(plugin.state, 'timers'"), 'Timer Delete removeItem missing');
  const delIdx   = warMach.indexOf("removeItem(plugin.state, 'timers'");
  const delBlock = warMach.slice(delIdx, delIdx + 100);
  ok(delBlock.includes('saveState'), 'Timer Delete not saving state');
});

// ── Section 3: Character sheet HP hot paths use saveStateQuiet ──────────────
console.log('\n  Section 3: Character sheet HP hot paths');

test('HP -1 button uses saveStateQuiet', () => {
  const idx   = pcChar.indexOf("'-1'");
  ok(idx !== -1, 'HP -1 button not found in renderPCCharacter');
  const block = pcChar.slice(idx, idx + 200);
  ok(block.includes('saveStateQuiet'), 'HP -1 not using saveStateQuiet');
  notOk(block.includes('plugin.saveState()'), 'HP -1 using full saveState');
});

test('HP +1 button uses saveStateQuiet', () => {
  const idx   = pcChar.indexOf("'+1'");
  ok(idx !== -1, 'HP +1 button not found in renderPCCharacter');
  const block = pcChar.slice(idx, idx + 200);
  ok(block.includes('saveStateQuiet'), 'HP +1 not using saveStateQuiet');
  notOk(block.includes('plugin.saveState()'), 'HP +1 using full saveState');
});

test('Set HP button uses saveStateQuiet', () => {
  const idx   = pcChar.indexOf("'Set HP'");
  ok(idx !== -1, 'Set HP button not found in renderPCCharacter');
  const block = pcChar.slice(idx, idx + 200);
  ok(block.includes('saveStateQuiet'), 'Set HP not using saveStateQuiet');
  notOk(block.includes('plugin.saveState()'), 'Set HP using full saveState');
});

test('Death save bubble click uses saveStateQuiet', () => {
  const idx   = pcChar.indexOf('deathSaves');
  ok(idx !== -1, 'deathSaves not found in renderPCCharacter');
  const block = pcChar.slice(idx, idx + 1100);
  ok(block.includes('saveStateQuiet'), 'Death save click not using saveStateQuiet');
  notOk(block.includes('plugin.saveState()'), 'Death save click using full saveState');
});

// ── Section 4: Spell slot hot paths use saveStateQuiet ──────────────────────
console.log('\n  Section 4: Spell slot hot paths');

test('Spell slot bubble click uses saveStateQuiet', () => {
  const idx   = pcSpells.indexOf('te-slot-bubble');
  ok(idx !== -1, 'Spell slot bubble not found in renderPCSpellbook');
  const block = pcSpells.slice(idx, idx + 700);
  ok(block.includes('saveStateQuiet'), 'Spell slot bubble click not using saveStateQuiet');
  notOk(block.includes('plugin.saveState()'), 'Spell slot bubble using full saveState');
});

test('Spell slot max change uses saveStateQuiet', () => {
  const idx   = pcSpells.indexOf('Set maximum slots');
  ok(idx !== -1, 'Spell slot max input not found');
  const block = pcSpells.slice(idx, idx + 600);
  ok(block.includes('saveStateQuiet'), 'Spell slot max change not using saveStateQuiet');
  notOk(block.includes('plugin.saveState()'), 'Spell slot max using full saveState');
});

// ── Section 5: Currency input uses saveStateQuiet ───────────────────────────
console.log('\n  Section 5: Currency input hot path');

test('Currency change listener uses saveStateQuiet', () => {
  const idx   = pcInv.indexOf("'pp','gp','ep','sp','cp'");
  ok(idx !== -1, 'Currency section not found in renderPCInventory');
  const block = pcInv.slice(idx, idx + 700);
  ok(block.includes('saveStateQuiet'), 'Currency change not using saveStateQuiet');
  notOk(block.includes('plugin.saveState()'), 'Currency change using full saveState');
});

// ── Section 6: Tile map teardown preserved ──────────────────────────────────
console.log('\n  Section 6: Tile map document listener teardown preserved');

test('tile map removes mousemove listener on disconnect', () => {
  ok(tmFn.includes("removeEventListener('mousemove'"), 'mousemove teardown missing from tile map');
});

test('tile map removes mouseup listener on disconnect', () => {
  ok(tmFn.includes("removeEventListener('mouseup'"), 'mouseup teardown missing from tile map');
});

test('tile map removes keydown listener on disconnect', () => {
  ok(tmFn.includes("removeEventListener('keydown'"), 'keydown teardown missing from tile map');
});

test('tile map uses MutationObserver for disconnect detection', () => {
  ok(tmFn.includes('MutationObserver'), 'MutationObserver teardown missing from tile map');
});

test('document.addEventListener called exactly 3 times total (tile map only)', () => {
  const n = count(/document\.addEventListener\(/g);
  ok(n === 3, `Expected 3 document.addEventListener calls (tile map), found ${n}`);
});

// ── Section 7: Compendium filter uses local state (preserved from Phase L) ──
console.log('\n  Section 7: Compendium filter local state preserved');

test('renderLibrary uses local libFilter not plugin.state.search', () => {
  ok(libFn.includes('libFilter'), 'libFilter missing from renderLibrary');
  notOk(libFn.includes('plugin.state.search ='), 'renderLibrary still writing to plugin.state.search');
});

test('renderLibrary rebuild does not call plugin.saveState', () => {
  const idx    = libFn.indexOf('const rebuild = ');
  const fnBody = libFn.slice(idx, idx + 1200);
  notOk(fnBody.includes('plugin.saveState'), 'renderLibrary rebuild calling plugin.saveState');
});

// ── Section 8: Initiative tracker already uses saveStateQuiet ───────────────
console.log('\n  Section 8: Initiative tracker uses saveStateQuiet');

test('renderInitiativeTracker uses saveStateQuiet', () => {
  ok(initFn.includes('saveStateQuiet'), 'renderInitiativeTracker not using saveStateQuiet');
  notOk(initFn.includes('plugin.saveState()'), 'renderInitiativeTracker still using full plugin.saveState()');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

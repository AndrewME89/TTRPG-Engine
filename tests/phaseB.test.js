'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`); }
}
function ok(cond, msg) { assert.ok(cond, msg); }

console.log('\nPhase B — Run Session Completion\n');

console.log('  Section 1: Layout');
test('renderRunSession uses 2/3|1/3 column layout', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('te-run-left') && fn.includes('te-run-right'), 'two-column layout missing');
});
test('left column has flex:2', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('flex:2 1'), 'left column not 2/3');
});
test('right column has flex:1', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('flex:1 1'), 'right column not 1/3');
});

console.log('\n  Section 2: Session Context');
test('Session Context has Location tab', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("'location'") && fn.includes("Current Location"), 'location tab missing');
});
test('Session Context has Map tab', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("'map'") && fn.includes("Current Map"), 'map tab missing');
});
test('Session Context has NPCs tab', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("'npcs'") && fn.includes("NPC Activated"), 'npcs tab missing');
});
test('Session Context has Quests tab', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("'quests'") && fn.includes("Quest Activated"), 'quests tab missing');
});
test('Session Context has Factions tab', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("'factions'") && fn.includes("Faction Activated"), 'factions tab missing');
});

console.log('\n  Section 3: Removed sections');
test('standalone Active NPCs section removed', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(!fn.includes("sectionHead(leftCol, '👥 Active NPCs')") && !fn.includes("sectionHead(main, '👥 Active NPCs')"), 'standalone Active NPCs still present');
});
test('standalone Active Quests section removed', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(!fn.includes("sectionHead(leftCol, '📋 Active Quests')") && !fn.includes("sectionHead(main, '📋 Active Quests')"), 'standalone Active Quests still present');
});
test('Location/Faction/Secret lookup removed', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(!fn.includes("Location / Faction / Secret Lookup") && !fn.includes("Locations','Factions','Secrets"), 'old lookup still present');
});

console.log('\n  Section 4: Reference Lookup');
test('Reference Lookup present', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('Reference Lookup'), 'Reference Lookup missing');
});
test('Reference Lookup has Combat tab', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("'Combat'") && fn.includes('REF_DATA'), 'Reference Lookup Combat tab missing');
});
test('Reference Lookup has Conditions tab', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("'Conditions'"), 'Reference Lookup Conditions tab missing');
});

console.log('\n  Section 5: Active Location Map');
test('Active Location Map section exists', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('Active Location Map'), 'Active Location Map section missing');
});

console.log('\n  Section 6: Right column sections');
test('Dice Roller in right column', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  const rcIdx = fn.indexOf('te-run-right');
  ok(rcIdx !== -1 && fn.indexOf('Dice Roller', rcIdx) !== -1, 'Dice Roller not in right column');
});
test('Quick Generators in right column', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  const rcIdx = fn.indexOf('te-run-right');
  ok(rcIdx !== -1 && fn.indexOf('Quick Generators', rcIdx) !== -1, 'Quick Generators not in right column');
});
test('Combat Tracker in right column', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  const rcIdx = fn.indexOf('te-run-right');
  ok(rcIdx !== -1 && fn.indexOf('Combat Tracker', rcIdx) !== -1, 'Combat Tracker not in right column');
});
test('Timers in right column', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  const rcIdx = fn.indexOf('te-run-right');
  ok(rcIdx !== -1 && fn.indexOf('Escalation Timers', rcIdx) !== -1, 'Timers not in right column');
});
test('Secrets in right column', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  const rcIdx = fn.indexOf('te-run-right');
  ok(rcIdx !== -1 && fn.indexOf("'🔒 Secrets'", rcIdx) !== -1, 'Secrets not in right column');
});

console.log('\n  Section 7: Timers');
test('timer +Tick rebuilds timer display', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('rebuildTimers()') && fn.includes('+Tick'), 'timer +Tick not rebuilding display');
});
test('timer Delete button exists in Run Session', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes("removeItem(state, 'timers'"), 'timer Delete missing in Run Session');
});

console.log('\n  Section 8: Combat Tracker');
test('Combat Tracker title in renderInitiativeTracker', () => {
  const fn = src.slice(src.indexOf('function renderInitiativeTracker'), src.indexOf('\n// ── RULES'));
  ok(fn.includes('Combat Tracker'), 'Combat Tracker title missing');
});
test('Combat Tracker has HP input', () => {
  const fn = src.slice(src.indexOf('function renderInitiativeTracker'), src.indexOf('\n// ── RULES'));
  ok(fn.includes('type = "number"') || fn.includes("type='number'") || fn.includes("type = 'number'"), 'HP input missing');
});
test('Combat Tracker has condition select', () => {
  const fn = src.slice(src.indexOf('function renderInitiativeTracker'), src.indexOf('\n// ── RULES'));
  ok(fn.includes('Blinded') && fn.includes('condSel'), 'condition select missing');
});
test('Combat Tracker logs Combat Started', () => {
  ok(src.includes("logSessionEvent(plugin, 'Combat Started'"), 'Combat Started not logged');
});
test('Combat Tracker logs Combatant Defeated', () => {
  ok(src.includes("logSessionEvent(plugin, 'Combatant Defeated'"), 'Combatant Defeated not logged');
});
test('Combat Tracker uses saveStateQuiet', () => {
  const fn = src.slice(src.indexOf('function renderInitiativeTracker'), src.indexOf('\n// ── RULES'));
  ok(fn.includes('saveStateQuiet(plugin)') && !fn.includes('plugin.saveState()'), 'Combat Tracker not using saveStateQuiet');
});

console.log('\n  Section 9: End Session');
test('End Session & Review button exists', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('End Session & Review'), 'End Session & Review button missing');
});
test('End Session opens review modal', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(fn.includes('EndSessionReviewModal') && fn.includes('Session Ended'), 'End Session not opening review modal');
});
test('old Open End Session Review section removed', () => {
  const fn = src.slice(src.indexOf('function renderRunSession'), src.indexOf('\n// ── WAR MACHINE'));
  ok(!fn.includes("'📊 End Session Review'") && !fn.includes("Open End Session Review"), 'old end session review section still present');
});

console.log('\n  Section 10: Session Review');
test('session review includes dice rolls section', () => {
  const fn = src.slice(src.indexOf('function compileEndSessionReview'), src.indexOf('\n// ── Modal field helpers'));
  ok(fn.includes("'Dice Rolled'") && fn.includes("Dice Rolls"), 'dice rolls missing from review');
});
test('session review includes combat events', () => {
  const fn = src.slice(src.indexOf('function compileEndSessionReview'), src.indexOf('\n// ── Modal field helpers'));
  ok(fn.includes("'Combat Started'") && fn.includes("Encounters & Combat"), 'combat events missing from review');
});
test('session review includes factions', () => {
  const fn = src.slice(src.indexOf('function compileEndSessionReview'), src.indexOf('\n// ── Modal field helpers'));
  ok(fn.includes("Faction Activated") && fn.includes("Factions"), 'factions missing from review');
});
test('session review includes session number not combat round for session events', () => {
  const fn = src.slice(src.indexOf('function compileEndSessionReview'), src.indexOf('\n// ── Modal field helpers'));
  ok(fn.includes("Session #") || fn.includes("sessionNum"), 'session # reference missing from review');
});
test('session review YAML has minimal frontmatter only', () => {
  const fn = src.slice(src.indexOf('function compileEndSessionReview'), src.indexOf('\n// ── Modal field helpers'));
  ok(fn.includes("entityType: session-review") && !fn.includes("npcsMet:"), 'review YAML not minimal');
});

console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

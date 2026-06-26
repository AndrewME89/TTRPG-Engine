'use strict';
/**
 * Phase 274 — Run Session Continuation Pass
 * Sections 1–9: context panel, event logging, dice logging, generator logging,
 *   session review notes, loot/conditions removal verification, campaign scoping.
 */

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

console.log('\nPhase 274 — Run Session Continuation Pass\n');

// ── Section 1: Session Context Panel ──────────────────────────────────────────
console.log('  Section 1: Session Context Panel');

test('sessionContext lazy-initialised on renderRunSession entry', () => {
  ok(src.includes("if (!activeSess.sessionContext) activeSess.sessionContext ="), 'sessionContext lazy init missing');
});

test('makeCtxSelect logs when selection changes', () => {
  ok(src.includes("if (logType && sel.value !== prev)") && src.includes("logSessionEvent(plugin, logType"), 'makeCtxSelect not logging on change');
});

test('Active NPC chip control exists', () => {
  ok(src.includes("activeNpcIds") && src.includes("renderSelectorChips"), 'Active NPC chip control missing');
});

test('NPC Activated logged when NPC added to scene', () => {
  ok(src.includes("Activated`, ent.name") || src.includes("'NPC Activated'") || src.includes('"NPC Activated"'), 'NPC Activated not logged');
});

test('NPC Deactivated logged when NPC removed from scene', () => {
  ok(src.includes("logSessionEvent(plugin, 'NPC Deactivated'") || src.includes('logSessionEvent(plugin, "NPC Deactivated"'), 'NPC Deactivated not logged');
});

test('NPC Died logged when NPC marked dead', () => {
  ok(src.includes("logSessionEvent(plugin, 'NPC Died'") || src.includes('logSessionEvent(plugin, "NPC Died"'), 'NPC Died not logged');
});

test('Active Quest chip control exists', () => {
  ok(src.includes("activeQuestIds") && src.includes("renderSelectorChips"), 'Active Quest chip control missing');
});

test('Quest Activated logged when quest added', () => {
  ok(src.includes("Activated`, ent.name") || src.includes("'Quest Activated'") || src.includes('"Quest Activated"'), 'Quest Activated not logged');
});

test('Quest Completed logged when quest completed', () => {
  ok(src.includes("logSessionEvent(plugin, 'Quest Completed'") || src.includes('logSessionEvent(plugin, "Quest Completed"'), 'Quest Completed not logged');
});

test('Quest Failed logged when quest failed', () => {
  ok(src.includes("logSessionEvent(plugin, 'Quest Failed'") || src.includes('logSessionEvent(plugin, "Quest Failed"'), 'Quest Failed not logged');
});

// ── Section 2: saveStateQuiet usage ───────────────────────────────────────────
console.log('\n  Section 2: saveStateQuiet usage');

test('saveStateQuiet helper exists', () => {
  ok(/^async function saveStateQuiet\s*\(/m.test(src), 'saveStateQuiet missing');
});

test('context panel saves with saveStateQuiet', () => {
  ok(src.includes('await saveStateQuiet(plugin)'), 'saveStateQuiet not used');
});

// ── Section 3: Dice roll logging ───────────────────────────────────────────────
console.log('\n  Section 3: Dice roll logging');

test('quick dice buttons log Dice Rolled to session', () => {
  ok(src.includes("logSessionEvent(plugin, 'Dice Rolled'") || src.includes('logSessionEvent(plugin, "Dice Rolled"'), 'Dice Rolled not logged');
});

test('dice logging guarded by activeSess check', () => {
  ok(src.includes('if (activeSess) { logSessionEvent(plugin, \'Dice Rolled\''), 'dice logging not guarded by activeSess');
});

test('formula Roll button also logs Dice Rolled', () => {
  const diceSection = src.slice(src.indexOf('Quick Dice Roller'), src.indexOf('Quick Generators'));
  const diceRolledCount = (diceSection.match(/Dice Rolled/g) || []).length;
  ok(diceRolledCount >= 2, `Expected at least 2 Dice Rolled references in dice section, got ${diceRolledCount}`);
});

// ── Section 4: Generator logging ──────────────────────────────────────────────
console.log('\n  Section 4: Generator logging');

test('Log to Session button shown for all types when session active', () => {
  ok(src.includes("logToSessBtn.style.display = activeSess ? '' : 'none'"), 'Log to Session not shown for all types');
});

test('Loot type uses Loot Generated event', () => {
  ok(src.includes("'Loot Generated'"), 'Loot Generated event type missing');
});

test('non-Loot types use Generator Used event', () => {
  ok(src.includes("'Generator Used'"), 'Generator Used event type missing');
});

test('Log to Session button guarded by activeSess', () => {
  ok(src.includes('if (!lastGenResult || !activeSess) return'), 'Log to Session not guarded by activeSess');
});

// ── Section 5: Loot Quick Add removed ─────────────────────────────────────────
console.log('\n  Section 5: Loot Quick Add removed from Run Session');

test('Loot Quick Add section heading not in renderRunSession', () => {
  const rsStart = src.indexOf('function renderRunSession');
  const rsEnd = src.indexOf('\n}', rsStart + 100);
  const rsBody = src.slice(rsStart, rsEnd);
  ok(!rsBody.includes("'💰 Loot Quick Add'") && !rsBody.includes('"💰 Loot Quick Add"'), 'Loot Quick Add section still present');
});

// ── Section 6: Conditions Reference removed ────────────────────────────────────
console.log('\n  Section 6: Conditions Reference removed from Run Session');

test('Conditions Reference section removed from renderRunSession', () => {
  const rsStart = src.indexOf('function renderRunSession');
  const rsEnd = src.indexOf('\n}', rsStart + 100);
  const rsBody = src.slice(rsStart, rsEnd);
  ok(!rsBody.includes("'⚡ Conditions Reference'") && !rsBody.includes('"⚡ Conditions Reference"'), 'Conditions Reference still in renderRunSession');
});

// ── Section 7: Session review markdown ────────────────────────────────────────
console.log('\n  Section 7: Session review markdown');

test('compileEndSessionReview includes session.notes in markdown', () => {
  ok(src.includes('session.notes') && src.includes("'## Scratchpad Notes'"), 'session.notes not in review markdown');
});

test('Loot Generated events included in review loot section', () => {
  ok(src.includes("byType('Loot Generated')"), 'Loot Generated not pulled into review loot');
});

test('Generator Used events included in review generator section', () => {
  ok(src.includes("byType('Generator Used')"), 'Generator Used not pulled into review');
});

test('review has Chronological Event Log', () => {
  ok(src.includes("'## Chronological Event Log'") || src.includes('"## Chronological Event Log"'), 'chronological log missing');
});

test('review has Player Recap', () => {
  ok(src.includes("'## Player Recap'") || src.includes('"## Player Recap"'), 'player recap missing');
});

test('review markdown has YAML frontmatter', () => {
  ok(src.includes("lines.push('---')") && src.includes("lines.push('ttrpg-engine: true')"), 'YAML frontmatter missing');
});

// ── Section 9: Campaign scoping ────────────────────────────────────────────────
console.log('\n  Section 9: Campaign scoping');

test('NPC list filtered by campaign scope', () => {
  ok(src.includes("!scopeId || e.campaignId === scopeId") || src.includes("!state.activeCampaignId || n.campaignId === state.activeCampaignId"), 'NPC list not campaign-scoped');
});

test('quest list filtered by campaign scope', () => {
  ok(src.includes("!scopeId || e.campaignId === scopeId") || src.includes("!state.activeCampaignId || q.campaignId === state.activeCampaignId"), 'quest list not campaign-scoped');
});

test('timer list filtered by activeCampaignId', () => {
  ok(src.includes("!state.activeCampaignId || t.campaignId === state.activeCampaignId"), 'timer list not campaign-scoped');
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

'use strict';
/**
 * Phase 272 — Live Session Usability
 * Sections 1–9: click-jump fixes, tabs below campaign chip, session context panel,
 *   logSessionEvent, loot quick add removal, conditions reference removal,
 *   rich session review markdown, run session cleanup, active campaign scoping.
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

console.log('\nPhase 272 — Live Session Usability\n');

// ── Section 1: click-jump fixes ──────────────────────────────────────────────
console.log('  Section 1: Click-jump fixes');

test('saveStateQuiet helper exists', () => {
  ok(/^async function saveStateQuiet\s*\(/m.test(src), 'saveStateQuiet missing');
});

test('saveStatePreserveScroll helper exists', () => {
  ok(/^async function saveStatePreserveScroll\s*\(/m.test(src), 'saveStatePreserveScroll missing');
});

test('renderRunSession secret reveal uses saveStateQuiet', () => {
  ok(src.includes('logSessionEvent(plugin, \'Secret Revealed\'') && src.includes('await saveStateQuiet(plugin)'), 'secret reveal not using saveStateQuiet');
});

test('renderRunSession handout share uses saveStateQuiet', () => {
  ok(src.includes('logSessionEvent(plugin, \'Handout Shared\'') && src.includes('await saveStateQuiet(plugin)'), 'handout share not using saveStateQuiet');
});

test('session notes textarea uses saveStateQuiet', () => {
  ok(src.includes('activeSess.notes = ta.value') && src.includes('await saveStateQuiet(plugin)'), 'session notes not using saveStateQuiet');
});

test('timer +Tick uses saveStateQuiet', () => {
  ok(src.includes('logSessionEvent(plugin, \'Timer Advanced\'') && src.includes('await saveStateQuiet(plugin)'), 'timer tick not using saveStateQuiet');
});

test('event log Add button uses saveStateQuiet', () => {
  ok(src.includes('logSessionEvent(plugin, evtType, text)') && src.includes('await saveStateQuiet(plugin)'), 'event log not using saveStateQuiet');
});

// ── Section 2: tabs below campaign chip ──────────────────────────────────────
console.log('\n  Section 2: Tabs below campaign chip');

test('pageHead accepts tabs as 6th parameter', () => {
  ok(/function pageHead\s*\(main,\s*plugin,\s*title,\s*subtitle,\s*actions,\s*tabs\)/.test(src), 'pageHead does not accept tabs param');
});

test('pageHead renders tabs after campaign chip', () => {
  ok(src.includes('te-workspace-tabs') && src.includes('te-workspace-tab'), 'pageHead not rendering workspace tabs');
});

test('renderFactions passes tabs to pageHead', () => {
  ok(/function renderFactions\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderFactions missing tabs param');
});

test('renderAdventure passes tabs to pageHead', () => {
  ok(/function renderAdventure\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderAdventure missing tabs param');
});

test('renderEncounters passes tabs to pageHead', () => {
  ok(/function renderEncounters\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderEncounters missing tabs param');
});

test('renderDowntime passes tabs to pageHead', () => {
  ok(/function renderDowntime\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderDowntime missing tabs param');
});

test('renderWarMachine passes tabs to pageHead', () => {
  ok(/function renderWarMachine\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderWarMachine missing tabs param');
});

test('renderEndgame passes tabs to pageHead', () => {
  ok(/function renderEndgame\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderEndgame missing tabs param');
});

test('renderRelationshipMatrix passes tabs to pageHead', () => {
  ok(/function renderRelationshipMatrix\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderRelationshipMatrix missing tabs param');
});

test('renderHybridAncestry passes tabs to pageHead', () => {
  ok(/function renderHybridAncestry\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderHybridAncestry missing tabs param');
});

test('renderLibrary passes tabs to pageHead', () => {
  ok(/function renderLibrary\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderLibrary missing tabs param');
});

test('renderHomebrew passes tabs to pageHead', () => {
  ok(/function renderHomebrew\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderHomebrew missing tabs param');
});

test('renderSessions passes tabs to pageHead', () => {
  ok(/function renderSessions\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderSessions missing tabs param');
});

test('renderCampaignBible passes tabs to pageHead', () => {
  ok(/function renderCampaignBible\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderCampaignBible missing tabs param');
});

test('renderRunSession passes tabs to pageHead', () => {
  ok(/function renderRunSession\s*\(main,\s*plugin,\s*tabs\)/.test(src), 'renderRunSession missing tabs param');
});

// ── Section 3: session context panel ─────────────────────────────────────────
console.log('\n  Section 3: Session context panel');

test('sessionContext shape initialized on session start', () => {
  ok(src.includes('currentLocationId:') && src.includes('activeNpcIds:') && src.includes('activeQuestIds:'), 'sessionContext shape missing');
});

test('sessionContext initialized when missing on existing sessions', () => {
  ok(src.includes("if (!activeSess.sessionContext) activeSess.sessionContext ="), 'sessionContext lazy init missing');
});

test('context panel renders current location select', () => {
  ok(src.includes("makeCtxSelect('Current Location'") || src.includes("'Current Location'"), 'context panel missing location select');
});

test('context panel saves with saveStateQuiet', () => {
  ok(src.includes('await saveStateQuiet(plugin)'), 'context panel not using saveStateQuiet');
});

// ── Section 4: logSessionEvent ───────────────────────────────────────────────
console.log('\n  Section 4: logSessionEvent');

test('logSessionEvent helper exists', () => {
  ok(/^function logSessionEvent\s*\(/m.test(src), 'logSessionEvent missing');
});

test('logSessionEvent stamps round from initiativeTracker', () => {
  ok(src.includes('tracker.round') && src.includes('entry.round'), 'logSessionEvent not stamping round');
});

test('logSessionEvent appends to active session eventLog', () => {
  ok(src.includes("sess.eventLog.push(entry)") && src.includes('upsert(plugin.state'), 'logSessionEvent not appending to eventLog');
});

// ── Section 5: loot quick add removed ────────────────────────────────────────
console.log('\n  Section 5: Loot Quick Add removed from Run Session');

test('Loot Quick Add section heading not in renderRunSession', () => {
  const rsStart = src.indexOf('function renderRunSession');
  const rsEnd = src.indexOf('\n}', rsStart + 100);
  const rsBody = src.slice(rsStart, rsEnd);
  ok(!rsBody.includes("'💰 Loot Quick Add'") && !rsBody.includes('"💰 Loot Quick Add"'), 'Loot Quick Add section still present in renderRunSession');
});

test('Quick Generators has Log to Session button for Loot', () => {
  ok(src.includes("'Log to Session'") || src.includes('"Log to Session"'), 'Log to Session button missing');
});

// ── Section 6: conditions reference removed ───────────────────────────────────
console.log('\n  Section 6: Conditions Reference removed from Run Session');

test('Conditions Reference section removed from renderRunSession', () => {
  const rsStart = src.indexOf('function renderRunSession');
  const rsEnd = src.indexOf('\n}', rsStart + 100);
  const rsBody = src.slice(rsStart, rsEnd);
  ok(!rsBody.includes("'⚡ Conditions Reference'") && !rsBody.includes('"⚡ Conditions Reference"'), 'Conditions Reference still in renderRunSession');
});

// ── Section 7: rich session review markdown ───────────────────────────────────
console.log('\n  Section 7: Rich session review markdown');

test('compileEndSessionReview returns markdown field', () => {
  ok(src.includes('markdown: lines.join') || src.includes("markdown:"), 'compileEndSessionReview missing markdown field');
});

test('review markdown has YAML frontmatter block', () => {
  ok(src.includes("lines.push('---')") && src.includes("lines.push('ttrpg-engine: true')"), 'review missing YAML frontmatter');
});

test('review markdown minimal frontmatter: entityType session-review', () => {
  ok(src.includes("lines.push('entityType: session-review')"), 'review frontmatter missing entityType');
});

test('review has Chronological Event Log section', () => {
  ok(src.includes("'## Chronological Event Log'") || src.includes('"## Chronological Event Log"'), 'chronological log section missing');
});

test('review has Player Recap section', () => {
  ok(src.includes("'## Player Recap'") || src.includes('"## Player Recap"'), 'player recap section missing');
});

test('EndSessionReviewModal exports using review.markdown', () => {
  ok(src.includes('review.markdown'), 'EndSessionReviewModal not using review.markdown');
});

// ── Section 9: active campaign scoping ───────────────────────────────────────
console.log('\n  Section 9: Active campaign scoping');

test('active NPCs list filters by activeCampaignId', () => {
  ok(src.includes("!state.activeCampaignId || n.campaignId === state.activeCampaignId"), 'NPC list not campaign-scoped');
});

test('active quests filters by activeCampaignId', () => {
  ok(src.includes("!state.activeCampaignId || q.campaignId === state.activeCampaignId"), 'quest list not campaign-scoped');
});

test('timers in run session filtered by activeCampaignId', () => {
  ok(src.includes("!state.activeCampaignId || t.campaignId === state.activeCampaignId"), 'timer list not campaign-scoped');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

'use strict';
/**
 * Phase K — Dashboard Cockpit Redesign
 * Sections 1–6: My Content removed from Dashboard, no DM Screen card,
 *   live-play routing, empty-state CTAs, active-campaign filtering, diagnostics.
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

// Extract renderDashboard body (stops at the next top-level function)
const dashStart = src.indexOf('function renderDashboard(');
const dashEnd = src.indexOf('\n// ── CAMPAIGNS', dashStart);
const dash = src.slice(dashStart, dashEnd);

console.log('\nPhase K — Dashboard Cockpit Redesign\n');

// ── Section 1: My Content removed from Dashboard ───────────────────────────
console.log('  Section 1: My Content section removed from Dashboard');

test('My Content / Saved Items heading not in renderDashboard', () => {
  notOk(dash.includes("'My Content / Saved Items'") || dash.includes('"My Content / Saved Items"'),
    '"My Content / Saved Items" section heading still present in renderDashboard');
});

test('ENTITY_NAV (content summary grid) not in renderDashboard', () => {
  notOk(dash.includes('ENTITY_NAV'), 'ENTITY_NAV content-summary grid still in renderDashboard');
});

test('Content Summary click-tile heading not in renderDashboard', () => {
  notOk(dash.includes('Content Summary'), 'Content Summary heading still in renderDashboard');
});

test('stat card per-entity loop (ek.forEach) not in renderDashboard', () => {
  notOk(dash.includes('ek.forEach'), 'per-entity stat loop still in renderDashboard');
});

// ── Section 2: No DM Screen launcher in Dashboard ─────────────────────────
console.log('\n  Section 2: No DM Screen launcher in Dashboard');

test('DM Screen text not in renderDashboard', () => {
  notOk(dash.includes("DM Screen"), '"DM Screen" text still present in renderDashboard');
});

// ── Section 3: Live-play routing ───────────────────────────────────────────
console.log('\n  Section 3: Live-play routing to Run Session');

test('Run Session button routes to campaigns + run-session sub-section', () => {
  ok(dash.includes("activeSubSection = 'run-session'"), 'Run Session not routing to run-session sub-section');
});

test('Campaign Bible button routes to campaigns + bible sub-section', () => {
  ok(dash.includes("activeSubSection = 'bible'"), 'Campaign Bible button not routing to bible sub-section');
});

test('Active Quests link routes to adventure section', () => {
  ok(dash.includes("activeSection = 'adventure'"), 'Active Quests not routing to adventure section');
});

test('Factions link routes to world section', () => {
  ok(dash.includes("activeSection = 'world'"), 'Factions not routing to world section');
});

test('Sessions link routes to sessions section', () => {
  ok(dash.includes("activeSection = 'sessions'"), 'Sessions not routing to sessions section');
});

// ── Section 4: Empty-state CTAs ────────────────────────────────────────────
console.log('\n  Section 4: Empty-state CTAs when no active campaign');

test('No active campaign text shown when camp is falsy', () => {
  ok(dash.includes("No active campaign"), 'No-campaign empty state missing');
});

test('Campaign Wizard CTA present in no-campaign empty state', () => {
  ok(dash.includes('CampaignWizardModal'), 'CampaignWizardModal not in dashboard');
});

test('Empty-state quest/faction CTA adds quest link', () => {
  ok(dash.includes("'+ Add Quest'"), 'Add Quest CTA missing from empty progress state');
});

test('Empty-state quest/faction CTA adds faction link', () => {
  ok(dash.includes("'+ Add Faction'"), 'Add Faction CTA missing from empty progress state');
});

test('No session running text shown', () => {
  ok(dash.includes('No session running'), 'No-session text missing');
});

test('Session in progress text shown when sessionRunMode', () => {
  ok(dash.includes('Session in progress'), 'Session-in-progress text missing');
});

// ── Section 5: Active campaign filtering ──────────────────────────────────
console.log('\n  Section 5: Active-campaign filtering');

test('Quests filtered by campaignId', () => {
  ok(dash.includes('scopedQ(q)') || dash.includes('q.campaignId === campId'), 'Quests not filtered by campaign');
});

test('Factions filtered by campaignId', () => {
  ok(dash.includes('scopedF(f)') || dash.includes('f.campaignId === campId'), 'Factions not filtered by campaign');
});

test('Sessions filtered by campaignId for recent sessions', () => {
  ok(dash.includes('s.campaignId === campId'), 'Sessions not filtered by campaignId');
});

test('Active Quests only shows status Active', () => {
  ok(dash.includes("q.status === 'Active'"), 'Active quests not filtered by Active status');
});

// ── Section 6: Diagnostics ─────────────────────────────────────────────────
console.log('\n  Section 6: Diagnostics card');

test('Diagnostics section only rendered when issues exist', () => {
  ok(dash.includes('repairAndReindex(state)') && dash.includes('issues.length'), 'diagnostics not conditional on issues.length');
});

test('Diagnostics card shows issue count', () => {
  ok(dash.includes('data issue'), 'diagnostics not showing issue count text');
});

test('Repair & Reindex button present in diagnostics', () => {
  ok(dash.includes('Repair & Reindex'), 'Repair & Reindex button missing');
});

test('Backup Now available in utilities strip', () => {
  ok(dash.includes('Backup Now'), 'Backup Now button missing from dashboard');
});

test('Restore Backup available in utilities strip', () => {
  ok(dash.includes('RestoreBackupModal'), 'RestoreBackupModal not in dashboard');
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

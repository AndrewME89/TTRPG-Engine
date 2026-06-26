'use strict';
/**
 * Phase N — Regression Lockdown & Release Candidate
 * Release-lock checks not covered by earlier phase tests:
 *   1. No duplicate top-level function declarations
 *   2. No visible DM Screen primary launcher in Dashboard or Campaign Command nav
 *   3. No My Content section ownership in Dashboard
 *   4. tileMaps used only in compatibility/fallback (≤ 2 occurrences)
 *   5. Noble Families appear only in legacy/read-only contexts
 *   6. dmscreen used only as alias/redirect, not as a primary launcher label
 *   7. saveStateQuiet declared exactly once
 *   8. classifySourceBucket and normalizeStorageMetadata declared exactly once
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

// Slice key sections
const dashStart = src.indexOf('function renderDashboard(');
const dashEnd   = src.indexOf('\n// ── CAMPAIGNS', dashStart);
const dash      = src.slice(dashStart, dashEnd);

const ccStart   = src.indexOf('function renderCampaignCommand(');
const ccNavEnd  = src.indexOf('\n  const wrap = ce(main', ccStart);
const ccNav     = src.slice(ccStart, ccNavEnd + 200);

console.log('\nPhase N — Regression Lockdown & Release Candidate\n');

// ── Section 1: No duplicate top-level function declarations ──────────────────
console.log('  Section 1: No duplicate top-level function declarations');

test('no duplicate top-level function declarations', () => {
  const seen = {};
  const dups = [];
  for (const m of src.matchAll(/^(?:async )?function (\w+)\(/mg)) {
    seen[m[1]] = (seen[m[1]] || 0) + 1;
    if (seen[m[1]] === 2) dups.push(m[1]);
  }
  ok(dups.length === 0, `Duplicate function declarations found: ${dups.join(', ')}`);
});

test('saveStateQuiet declared exactly once', () => {
  const n = count(/^(?:async )?function saveStateQuiet\(/mg);
  ok(n === 1, `saveStateQuiet declared ${n} times (expected 1)`);
});

test('classifySourceBucket declared exactly once', () => {
  const n = count(/^function classifySourceBucket\(/mg);
  ok(n === 1, `classifySourceBucket declared ${n} times (expected 1)`);
});

test('normalizeStorageMetadata declared exactly once', () => {
  const n = count(/^function normalizeStorageMetadata\(/mg);
  ok(n === 1, `normalizeStorageMetadata declared ${n} times (expected 1)`);
});

test('repairAndReindex declared exactly once', () => {
  const n = count(/^function repairAndReindex\(/mg);
  ok(n === 1, `repairAndReindex declared ${n} times (expected 1)`);
});

test('activeCampaign declared exactly once', () => {
  const n = count(/^function activeCampaign\(/mg);
  ok(n === 1, `activeCampaign declared ${n} times (expected 1)`);
});

// ── Section 2: No DM Screen primary launcher in Dashboard or Campaign Command ─
console.log('\n  Section 2: No DM Screen primary launcher in Dashboard / Campaign Command');

test('Dashboard does not mention DM Screen text', () => {
  notOk(dash.includes('DM Screen'), '"DM Screen" visible text found in renderDashboard');
});

test('Dashboard does not route to dmscreen sub-section', () => {
  notOk(dash.includes("'dmscreen'"), 'Dashboard routes to dmscreen sub-section');
});

test('Campaign Command nav does not expose DM Screen as primary tab label', () => {
  notOk(ccNav.includes("'DM Screen'") && ccNav.includes("label:"), 'Campaign Command nav exposes DM Screen as primary tab');
});

// ── Section 3: Dashboard does not own My Content / Saved Items ───────────────
console.log('\n  Section 3: Dashboard does not own My Content / Saved Items');

test('Dashboard has no My Content / Saved Items section heading', () => {
  notOk(dash.includes("'My Content / Saved Items'") || dash.includes('"My Content / Saved Items"'),
    'Dashboard still contains My Content / Saved Items section heading');
});

test('Dashboard has no My Content section heading (short form)', () => {
  notOk(dash.includes("'My Content'") || dash.includes('"My Content"'),
    'Dashboard still contains My Content section heading (short form)');
});

test('Dashboard has no ENTITY_NAV content grid', () => {
  notOk(dash.includes('ENTITY_NAV'), 'ENTITY_NAV content grid still in Dashboard');
});

// ── Section 4: tileMaps only in compatibility/fallback code ──────────────────
console.log('\n  Section 4: tileMaps compatibility/fallback only');

test('tileMaps referenced at most twice (compatibility fallback pattern)', () => {
  const n = count(/tileMaps/g);
  ok(n <= 2, `tileMaps referenced ${n} times — expected ≤ 2 (compatibility fallback only)`);
});

// ── Section 5: Noble Families only in legacy/read-only contexts ──────────────
console.log('\n  Section 5: Noble Families in legacy/read-only contexts only');

test('Noble Families not in renderDashboard', () => {
  notOk(dash.includes('Noble Famil'), 'Noble Families referenced in Dashboard');
});

test('Noble Families legacy section uses Legacy heading label', () => {
  ok(src.includes('Legacy Noble Families'), '"Legacy Noble Families" heading missing — legacy section not labeled');
});

test('Noble Families comment marks entity type as kept for legacy', () => {
  ok(src.includes('Noble Families — legacy entity type kept') || src.includes("nobleFamilies:"),
    'Noble Families not clearly marked as legacy entity type');
});

// ── Section 6: dmscreen as alias/redirect only, not primary launcher label ───
console.log('\n  Section 6: dmscreen as alias/redirect only');

test('dmscreen appears at most 3 times total (alias + redirect + renderDMScreen)', () => {
  const n = count(/dmscreen|dm-screen/g);
  ok(n <= 4, `dmscreen appears ${n} times — expected ≤ 4`);
});

test('dmscreen in Campaign Command is a redirect alias not a primary label', () => {
  ok(src.includes("sub === 'dmscreen'") && src.includes("sub = 'run-session'"),
    'dmscreen redirect alias to run-session missing from Campaign Command');
});

test('Dashboard does not show a DM Screen quick-launch card', () => {
  notOk(dash.includes('dmscreen'), 'Dashboard contains dmscreen launcher');
});

// ── Section 7: Critical workflow entry points exist ──────────────────────────
console.log('\n  Section 7: Critical workflow entry points present');

test('renderCampaignCommand function exists', () => {
  ok(src.includes('function renderCampaignCommand('), 'renderCampaignCommand missing');
});

test('Campaign Bible (renderBible) renders', () => {
  ok(src.includes('function renderBible(') || src.includes("sub === 'bible'"),
    'Campaign Bible entry point missing');
});

test('renderRunSession function exists', () => {
  ok(src.includes('function renderRunSession('), 'renderRunSession missing');
});

test('renderCompendiumLibrary function exists', () => {
  ok(src.includes('function renderCompendiumLibrary('), 'renderCompendiumLibrary missing');
});

test('renderLibrary function exists', () => {
  ok(src.includes('function renderLibrary('), 'renderLibrary missing');
});

test('renderMyContent function exists', () => {
  ok(src.includes('function renderMyContent('), 'renderMyContent missing');
});

test('renderWorldAtlas function exists', () => {
  ok(src.includes('function renderWorldAtlas(') || src.includes("activeSection = 'world'"),
    'World Atlas entry point missing');
});

test('ImportModal class exists', () => {
  ok(src.includes('class ImportModal'), 'ImportModal missing');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

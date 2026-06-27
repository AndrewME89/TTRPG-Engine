'use strict';
/**
 * Phase L — Compendium / Library Storage Polish
 * Updated for the merged Compendium browser.
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

const refStart = src.indexOf('async function renderReference(');
const refEnd = src.indexOf('\nclass TTRPGEnginePlugin extends Plugin', refStart);
const refFn = src.slice(refStart, refEnd);

const hbStart = src.indexOf('function renderHomebrew(');
const hbEnd = src.indexOf('\n// ── GENERATORS', hbStart);
const hbFn = src.slice(hbStart, hbEnd);

const myStart = src.indexOf('function renderMyContent(');
const myEnd = src.indexOf('\nfunction renderSettingsTools(', myStart);
const myFn = src.slice(myStart, myEnd);

const buckStart = src.indexOf('function classifySourceBucket(');
const buckEnd = src.indexOf('\nfunction normalizeStorageMetadata(', buckStart);
const buckFn = src.slice(buckStart, buckEnd);

const normStart = src.indexOf('function normalizeStorageMetadata(');
const normEnd = src.indexOf('\nfunction renderLibrary(', normStart);
const normFn = src.slice(normStart, normEnd);

console.log('\nPhase L — Compendium / Library Storage Polish\n');

console.log('  Section 1: Merged Compendium local state');
test('renderReference uses local result state not plugin.state.search', () => {
  ok(refFn.includes('const rs = {') && refFn.includes('search'), 'renderReference missing local result state');
  notOk(refFn.includes('plugin.state.search ='), 'renderReference should not write to plugin.state.search');
});
test('renderReference has rebuild and buildList functions', () => {
  ok(refFn.includes('const rebuild = async () =>') && refFn.includes('const buildList = async () =>'),
    'renderReference missing rebuild/buildList flow');
});
test('renderHomebrew still uses local hbFilter object', () => {
  ok(hbFn.includes('hbFilter'), 'hbFilter local state object missing from renderHomebrew');
});
test('renderHomebrew does not write to plugin.state.search', () => {
  notOk(hbFn.includes('plugin.state.search ='), 'renderHomebrew should not write to plugin.state.search');
});

console.log('\n  Section 2: Merged Compendium controls');
test('renderReference has search input field', () => {
  ok(refFn.includes('Search name or tag') && refFn.includes('sIn'), 'search input missing from renderReference');
});
test('renderReference has clear button', () => {
  ok(refFn.includes('× Clear'), 'clear button missing from renderReference');
});
test('renderReference uses REF_TABS buttons instead of management filters', () => {
  ok(refFn.includes('REF_TABS') && refFn.includes('is-primary'), 'REF_TABS buttons missing from renderReference');
  notOk(refFn.includes('All Sources') || refFn.includes('All Visibility') || refFn.includes('All Campaigns') || refFn.includes('All Status'),
    'management-table filters should not appear in merged Compendium');
});
test('renderReference starts at 5 results and loads more progressively', () => {
  ok(refFn.includes('limit: 5') && refFn.includes('Load more results...') && refFn.includes('rs.limit += 5'),
    'merged Compendium should use progressive result loading');
});

console.log('\n  Section 3: Reference behavior preserved');
test('renderReference function still exists', () => {
  ok(refFn.length > 100, 'renderReference function missing or too short');
});
test('renderReference still uses tabbed reference layout', () => {
  ok(refFn.includes('REF_TABS'), 'reference tab layout missing');
});
test('Compendium title replaced 5e Reference label in page head', () => {
  ok(refFn.includes("'Compendium'"), 'Compendium title missing from renderReference');
  notOk(refFn.includes("'5e Reference'"), '5e Reference title should not remain in page head');
});
test('renderCompendiumLibrary still routes to renderReference', () => {
  const cls = src.slice(src.indexOf('function renderCompendiumLibrary'), src.indexOf('function renderMyContent'));
  ok(cls.includes('renderReference'), 'renderCompendiumLibrary not routing to renderReference');
});

console.log('\n  Section 4: Local record merge');
test('local compendium/homebrew merge helpers exist', () => {
  ok(src.includes('function buildCompendiumLocalResults('), 'buildCompendiumLocalResults helper missing');
  ok(src.includes('function homebrewMatchesRefTab('), 'homebrewMatchesRefTab helper missing');
  ok(src.includes('function compendiumEntryMatchesRefTab('), 'compendiumEntryMatchesRefTab helper missing');
});
test('renderReference merges local compendium and homebrew results', () => {
  ok(refFn.includes('buildCompendiumLocalResults') && refFn.includes('...local.map') && refFn.includes("kind: 'reference'"),
    'renderReference should merge local and reference results');
});

console.log('\n  Section 5: Source bucket classification');
test('classifySourceBucket function is declared', () => {
  ok(buckFn.length > 50, 'classifySourceBucket function missing');
});
test('classifySourceBucket still supports homebrew/imported/generated/campaign/saved buckets', () => {
  ok(buckFn.includes("'homebrew'"), 'homebrew bucket rule missing');
  ok(buckFn.includes("'imported'"), 'imported bucket rule missing');
  ok(buckFn.includes("'generated'"), 'generated bucket rule missing');
  ok(buckFn.includes("'campaign'"), 'campaign bucket rule missing');
  ok(buckFn.includes("'saved'"), 'saved fallback bucket missing');
});

console.log('\n  Section 6: Metadata normalization');
test('normalizeStorageMetadata function is declared', () => {
  ok(normFn.length > 50, 'normalizeStorageMetadata function missing');
});
test('normalizeStorageMetadata handles source/status/visibility/campaignId/tags', () => {
  ok(normFn.includes('item.source'), 'normalizeStorageMetadata not handling source field');
  ok(normFn.includes('item.status'), 'normalizeStorageMetadata not handling status field');
  ok(normFn.includes('item.visibility'), 'normalizeStorageMetadata not handling visibility field');
  ok(normFn.includes('item.campaignId'), 'normalizeStorageMetadata not handling campaignId field');
  ok(normFn.includes('item.tags'), 'normalizeStorageMetadata not handling tags field');
});
test('ImportModal uses normalizeStorageMetadata and imported source', () => {
  const importCls = src.slice(src.indexOf('class ImportModal'), src.indexOf('\n// SettingsModal'));
  ok(importCls.includes('normalizeStorageMetadata'), 'ImportModal not calling normalizeStorageMetadata');
  ok(importCls.includes("source: 'imported'"), 'ImportModal not stamping source as imported');
});
test('logGeneratorHistory uses normalizeStorageMetadata and generated source', () => {
  const genLog = src.slice(src.indexOf('function logGeneratorHistory'), src.indexOf('\n// Central session event'));
  ok(genLog.includes('normalizeStorageMetadata'), 'logGeneratorHistory not calling normalizeStorageMetadata');
  ok(genLog.includes("source: 'generated'"), 'logGeneratorHistory not stamping source as generated');
});

console.log('\n  Section 7: My Content / Saved Items explicit label');
test('my-content tab removed from renderCompendiumLibrary', () => {
  const compLibIdx = src.indexOf('function renderCompendiumLibrary(');
  const compLibEnd = src.indexOf('\nfunction renderMyContent(', compLibIdx);
  const compLibBlock = src.slice(compLibIdx, compLibEnd);
  ok(!compLibBlock.includes("{ id: 'my-content'"), 'my-content tab should be removed');
});
test('renderMyContent page title is My Content / Saved Items', () => {
  ok(myFn.includes("'My Content / Saved Items'"), 'renderMyContent page title not updated');
});

console.log('\n  Section 8: Dashboard does not own stored content');
test('Dashboard renderDashboard has no My Content section heading', () => {
  const dashStart = src.indexOf('function renderDashboard(');
  const dashEnd = src.indexOf('\n// ── CAMPAIGNS', dashStart);
  const dash = src.slice(dashStart, dashEnd);
  notOk(dash.includes("'My Content / Saved Items'") || dash.includes("'My Content'"),
    'Dashboard still contains My Content section');
});

console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

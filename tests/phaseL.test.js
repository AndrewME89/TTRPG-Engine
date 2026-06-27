'use strict';
/**
 * Phase L — Compendium / Library Filtering & Storage Polish
 * Sections 1–6: combined filters, preserved reference behavior, campaign scoping,
 *   source-bucket classification, no Dashboard ownership, metadata normalization.
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

// Slice render functions
const libStart  = src.indexOf('function renderLibrary(');
const libEnd    = src.indexOf('\nfunction rollTable(', libStart);
const libFn     = src.slice(libStart, libEnd);

const hbStart   = src.indexOf('function renderHomebrew(');
const hbEnd     = src.indexOf('\n// ── GENERATORS', hbStart);
const hbFn      = src.slice(hbStart, hbEnd);

const refStart  = src.indexOf('async function renderReference(');
const refEnd    = src.indexOf('\nfunction renderLibrary(', refStart);
const refFn     = src.slice(refStart, refEnd);

const myStart   = src.indexOf('function renderMyContent(');
const myEnd     = src.indexOf('\nfunction renderSettingsTools(', myStart);
const myFn      = src.slice(myStart, myEnd);

const buckStart = src.indexOf('function classifySourceBucket(');
const buckEnd   = src.indexOf('\nfunction normalizeStorageMetadata(', buckStart);
const buckFn    = src.slice(buckStart, buckEnd);

const normStart = src.indexOf('function normalizeStorageMetadata(');
const normEnd   = src.indexOf('\nfunction renderLibrary(', normStart);
const normFn    = src.slice(normStart, normEnd);

console.log('\nPhase L — Compendium / Library Filtering & Storage Polish\n');

// ── Section 1: Local filter state — does NOT write to plugin.state.search ──
console.log('  Section 1: Local filter state (no plugin.state.search writes)');

test('renderLibrary uses local libFilter object not plugin.state.search', () => {
  ok(libFn.includes('libFilter'), 'libFilter local state object missing from renderLibrary');
});

test('renderLibrary does NOT write to plugin.state.search for filtering', () => {
  notOk(libFn.includes('plugin.state.search ='), 'renderLibrary writes to plugin.state.search (should use local filter)');
});

test('renderHomebrew uses local hbFilter object', () => {
  ok(hbFn.includes('hbFilter'), 'hbFilter local state object missing from renderHomebrew');
});

test('renderHomebrew does NOT write to plugin.state.search for filtering', () => {
  notOk(hbFn.includes('plugin.state.search ='), 'renderHomebrew writes to plugin.state.search');
});

test('renderLibrary has a rebuild/redraw function for filter changes', () => {
  ok(libFn.includes('rebuild()') || libFn.includes('const rebuild'), 'renderLibrary missing rebuild function');
});

test('renderHomebrew has a rebuildHb function for filter changes', () => {
  ok(hbFn.includes('rebuildHb()') || hbFn.includes('const rebuildHb'), 'renderHomebrew missing rebuildHb function');
});

// ── Section 2: Combined filters ─────────────────────────────────────────────
console.log('\n  Section 2: Combined filters');

test('renderLibrary has source bucket filter select', () => {
  ok(libFn.includes('All Sources') && libFn.includes('sourceSel'), 'source bucket filter missing from renderLibrary');
});

test('renderLibrary has category filter select', () => {
  ok(libFn.includes('All Types') && libFn.includes('catSel'), 'category filter missing from renderLibrary');
});

test('renderLibrary has visibility filter select', () => {
  ok(libFn.includes('All Visibility') && libFn.includes('visSel'), 'visibility filter missing from renderLibrary');
});

test('renderLibrary has campaign filter select', () => {
  ok(libFn.includes('All Campaigns') && libFn.includes('campSel'), 'campaign filter missing from renderLibrary');
});

test('renderLibrary has search input field', () => {
  ok(libFn.includes('searchIn') && libFn.includes("placeholder = 'Search"), 'search input missing from renderLibrary');
});

test('renderLibrary has clear filters button', () => {
  ok(libFn.includes('× Clear'), 'clear filters button missing from renderLibrary');
});

test('renderHomebrew has search input', () => {
  ok(hbFn.includes('searchIn'), 'search input missing from renderHomebrew');
});

test('renderHomebrew has status filter', () => {
  ok(hbFn.includes('statusSel') && hbFn.includes('All Status'), 'status filter missing from renderHomebrew');
});

test('renderHomebrew has visibility filter', () => {
  ok(hbFn.includes('visSel') && hbFn.includes('All Visibility'), 'visibility filter missing from renderHomebrew');
});

// ── Section 3: Preserved 5e reference behavior ───────────────────────────────
console.log('\n  Section 3: Preserved 5e reference behavior');

test('renderReference function still exists', () => {
  ok(refFn.length > 100, 'renderReference function missing or too short');
});

test('renderReference uses tabbed layout', () => {
  ok(refFn.includes("'Spells'") || refFn.includes("'Monsters'") || refFn.includes("REF_TABS"), '5e reference tab layout missing');
});

test('5e Reference tab still in renderCompendiumLibrary tabs', () => {
  ok(src.includes("'📖 5e Reference'") || src.includes('"📖 5e Reference"'), '5e Reference tab label missing');
});

test('renderCompendiumLibrary still routes to renderReference', () => {
  const cls = src.slice(src.indexOf('function renderCompendiumLibrary'), src.indexOf('function renderMyContent'));
  ok(cls.includes('renderReference'), 'renderCompendiumLibrary not routing to renderReference');
});

// ── Section 4: Campaign scoping in library filters ───────────────────────────
console.log('\n  Section 4: Campaign scoping');

test('library campaign filter defaults to activeCampaignId when set', () => {
  ok(libFn.includes('activeCampaignId'), 'library filter not defaulting to activeCampaignId');
});

test('library campaign filter filters by campaignId', () => {
  ok(libFn.includes('item.campaignId') && libFn.includes('libFilter.campaign'), 'campaign filter not applied to items');
});

// ── Section 5: Source bucket classification ──────────────────────────────────
console.log('\n  Section 5: Source bucket classification');

test('classifySourceBucket function is declared', () => {
  ok(buckFn.length > 50, 'classifySourceBucket function missing');
});

test('classifySourceBucket returns homebrew for homebrew entityKey', () => {
  ok(buckFn.includes("entityKey === 'homebrew'") || buckFn.includes("'homebrew'"), 'homebrew bucket rule missing');
});

test('classifySourceBucket returns imported for imported source', () => {
  ok(buckFn.includes("'imported'") && (buckFn.includes('importedAt') || buckFn.includes("source === 'imported'")), 'imported bucket rule missing');
});

test('classifySourceBucket returns generated for generated source', () => {
  ok(buckFn.includes("'generated'") && (buckFn.includes('generatedAt') || buckFn.includes("source === 'generated'")), 'generated bucket rule missing');
});

test('classifySourceBucket returns campaign when campaignId is set', () => {
  ok(buckFn.includes("'campaign'") && buckFn.includes('campaignId'), 'campaign bucket rule missing');
});

test('classifySourceBucket returns saved as fallback', () => {
  ok(buckFn.includes("'saved'"), 'saved fallback bucket missing');
});

test('renderLibrary uses classifySourceBucket for source filter', () => {
  ok(libFn.includes('classifySourceBucket'), 'renderLibrary not calling classifySourceBucket');
});

// ── Section 6: Metadata normalization ───────────────────────────────────────
console.log('\n  Section 6: Metadata normalization');

test('normalizeStorageMetadata function is declared', () => {
  ok(normFn.length > 50, 'normalizeStorageMetadata function missing');
});

test('normalizeStorageMetadata stamps source field', () => {
  ok(normFn.includes('item.source'), 'normalizeStorageMetadata not handling source field');
});

test('normalizeStorageMetadata stamps status field', () => {
  ok(normFn.includes('item.status'), 'normalizeStorageMetadata not handling status field');
});

test('normalizeStorageMetadata stamps visibility field', () => {
  ok(normFn.includes('item.visibility'), 'normalizeStorageMetadata not handling visibility field');
});

test('normalizeStorageMetadata stamps campaignId field', () => {
  ok(normFn.includes('item.campaignId'), 'normalizeStorageMetadata not handling campaignId field');
});

test('normalizeStorageMetadata stamps tags field', () => {
  ok(normFn.includes('item.tags'), 'normalizeStorageMetadata not handling tags field');
});

test('ImportModal uses normalizeStorageMetadata on import', () => {
  const importCls = src.slice(src.indexOf('class ImportModal'), src.indexOf('\n// SettingsModal'));
  ok(importCls.includes('normalizeStorageMetadata'), 'ImportModal not calling normalizeStorageMetadata');
});

test('ImportModal stamps source as imported', () => {
  const importCls = src.slice(src.indexOf('class ImportModal'), src.indexOf('\n// SettingsModal'));
  ok(importCls.includes("source: 'imported'"), 'ImportModal not stamping source as imported');
});

test('logGeneratorHistory uses normalizeStorageMetadata', () => {
  const genLog = src.slice(src.indexOf('function logGeneratorHistory'), src.indexOf('\n// Central session event'));
  ok(genLog.includes('normalizeStorageMetadata'), 'logGeneratorHistory not calling normalizeStorageMetadata');
});

test('logGeneratorHistory stamps source as generated', () => {
  const genLog = src.slice(src.indexOf('function logGeneratorHistory'), src.indexOf('\n// Central session event'));
  ok(genLog.includes("source: 'generated'"), 'logGeneratorHistory not stamping source as generated');
});

// ── Section 7: My Content / Saved Items label ────────────────────────────────
console.log('\n  Section 7: My Content / Saved Items explicit label');

test('my-content tab removed from renderCompendiumLibrary (Phase T)', () => {
  const compLibIdx = src.indexOf('function renderCompendiumLibrary(');
  const compLibEnd = src.indexOf('\nfunction renderMyContent(', compLibIdx);
  const compLibBlock = src.slice(compLibIdx, compLibEnd);
  ok(!compLibBlock.includes("{ id: 'my-content'"), 'my-content tab should be removed from renderCompendiumLibrary per Phase T');
});

test('renderMyContent page title is My Content / Saved Items', () => {
  ok(myFn.includes("'My Content / Saved Items'"), 'renderMyContent page title not updated');
});

// ── Section 8: Dashboard does NOT own stored content ────────────────────────
console.log('\n  Section 8: Dashboard does not own stored content');

test('Dashboard renderDashboard has no My Content section heading', () => {
  const dashStart = src.indexOf('function renderDashboard(');
  const dashEnd   = src.indexOf('\n// ── CAMPAIGNS', dashStart);
  const dash = src.slice(dashStart, dashEnd);
  notOk(dash.includes("'My Content / Saved Items'") || dash.includes("'My Content'"),
    'Dashboard still contains My Content section');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

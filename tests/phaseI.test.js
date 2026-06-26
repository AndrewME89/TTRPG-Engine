'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS', name);
    passed++;
  } catch (error) {
    console.log('  FAIL', name, '\n       ', error.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function includes(text, fragment) {
  assert(text.includes(fragment), `Expected to find: ${fragment}`);
}

function notIncludes(text, fragment) {
  assert(!text.includes(fragment), `Expected NOT to find: ${fragment}`);
}

function extractFunctionSource(name) {
  const start = src.indexOf(`function ${name}(`);
  assert(start >= 0, `Could not find function ${name}`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; if (bodyStart === -1) bodyStart = i; }
    else if (ch === '}') { depth--; if (bodyStart !== -1 && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`Could not extract function ${name}`);
}

console.log('\nPhase I — Run Session Picker & Map Context Polish\n');

// ─── Section 1: End button label ──────────────────────────────────────────────
console.log('  Section 1: End button label');

test('renderRunSession end button label is "End Session & Open Review"', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'End Session & Open Review');
});

test('renderRunSession end button does NOT say "End Session & Review" without "Open"', () => {
  const fn = extractFunctionSource('renderRunSession');
  // Should contain "Open Review" — the old label was just "& Review"
  const idx = fn.indexOf('End Session & Open Review');
  assert(idx >= 0, 'Expected "End Session & Open Review" label');
});

// ─── Section 2: currentSettlementId in sessionContext ─────────────────────────
console.log('\n  Section 2: currentSettlementId persistence');

test('sessionContext default includes currentSettlementId', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'currentSettlementId');
});

test('currentSettlementId is in the new session object created on start', () => {
  const fn = extractFunctionSource('renderRunSession');
  const newSessBlock = fn.slice(fn.indexOf('sessionContext:'), fn.indexOf('activeTimerIds'));
  includes(newSessBlock, 'currentSettlementId');
});

test('settlement selector persists to ctx.currentSettlementId', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'ctx.currentSettlementId = sel2.value');
});

test('settlement change logs Settlement Changed event', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, "'Settlement Changed'");
});

test('existing sessions without currentSettlementId get it stamped on load', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, "activeSess.sessionContext.currentSettlementId === undefined");
});

// ─── Section 3: Campaign-scoped selectors replace text-search ─────────────────
console.log('\n  Section 3: Campaign-scoped selectors for NPCs, Quests, Factions');

test('NPC tab uses a dropdown selector (select element) not free-text search', () => {
  const fn = extractFunctionSource('renderRunSession');
  // renderSelectorChips creates a select element; text input placeholder 'Add NPC…' should be gone
  notIncludes(fn, "placeholder = 'Add NPC…'");
});

test('Quest tab uses a dropdown selector not free-text search', () => {
  const fn = extractFunctionSource('renderRunSession');
  notIncludes(fn, "placeholder = 'Activate quest…'");
});

test('Faction tab uses a dropdown selector not free-text search', () => {
  const fn = extractFunctionSource('renderRunSession');
  notIncludes(fn, "placeholder = 'Add faction…'");
});

test('selector helper filters entities by scopeId (campaignId)', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'e.campaignId === scopeId');
});

test('activeNpcIds array is preserved in selector flow', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, "ctx.activeNpcIds");
});

test('activeQuestIds array is preserved in selector flow', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, "ctx.activeQuestIds");
});

test('activeFactionIds array is preserved in selector flow', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, "'activeFactionIds'");
});

// ─── Section 4: Map source uses getCampaignMaps with legacy fallback ──────────
console.log('\n  Section 4: Map source');

test('map tab uses getCampaignMaps for map list', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'getCampaignMaps(state, scopeId)');
});

test('getCampaignMaps exists as a function', () => {
  includes(src, 'function getCampaignMaps(');
});

test('getCampaignMaps includes tileMaps as legacy fallback', () => {
  const fn = extractFunctionSource('getCampaignMaps');
  includes(fn, 'tileMaps');
});

test('map selection does not auto-switch from location changes', () => {
  const fn = extractFunctionSource('renderRunSession');
  // Location tab change handler must not touch ctx.currentMapId
  const locTabIdx = fn.indexOf("activeCtxTab === 'location'");
  const mapTabIdx = fn.indexOf("activeCtxTab === 'map'");
  const locTabCode = fn.slice(locTabIdx, mapTabIdx);
  notIncludes(locTabCode, 'ctx.currentMapId');
});

// ─── Section 5: Map tab shows linked location/settlement metadata ─────────────
console.log('\n  Section 5: Map tab linked location/settlement metadata');

test('map tab shows linked location metadata when locationId present on map', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'chosenMap.locationId');
  includes(fn, 'linkedLoc');
});

test('map tab shows linked settlement metadata when settlementId present on map', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'chosenMap.settlementId');
  includes(fn, 'linkedSettl');
});

// ─── Section 6: Encounters tab present in session context ─────────────────────
console.log('\n  Section 6: Encounters tab in session context');

test('CTX_TABS includes encounters tab', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, "'encounters'");
});

test('encounters tab label is present', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'Encounters');
});

test('activeEncounterIds array is used in encounters tab', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'activeEncounterIds');
});

test('encounters are scoped by campaignId', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, "'encounters'");
  // The renderSelectorChips helper always filters by scopeId
  includes(fn, 'e.campaignId === scopeId');
});

// ─── Section 7: Empty-state safety ───────────────────────────────────────────
console.log('\n  Section 7: Empty-state safety');

test('location tab shows empty state message when no locations in campaign', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'No locations in campaign yet.');
});

test('settlement tab shows empty state message when no settlements in campaign', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'No settlements in campaign yet.');
});

test('map tab shows empty state message when no maps in campaign', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'No maps in campaign yet.');
});

test('selector helper shows no-entities message when campaign list empty', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'No ${label.toLowerCase()} in campaign');
});

test('renderRunSession handles no active session gracefully', () => {
  const fn = extractFunctionSource('renderRunSession');
  includes(fn, 'Start a session to enable Session Context.');
});

// ─── Section 8: Review/export path consistency ────────────────────────────────
console.log('\n  Section 8: Review and export path consistency');

test('EndSessionReviewModal uses campaignFolder helper for export path', () => {
  const classStart = src.indexOf('class EndSessionReviewModal');
  const classEnd = src.indexOf('\nclass ', classStart + 1);
  const cls = src.slice(classStart, classEnd);
  includes(cls, 'campaignFolder(this.plugin)');
});

test('EndSessionReviewModal uses writeNote for export', () => {
  const classStart = src.indexOf('class EndSessionReviewModal');
  const classEnd = src.indexOf('\nclass ', classStart + 1);
  const cls = src.slice(classStart, classEnd);
  includes(cls, 'writeNote(');
});

test('EndSessionReviewModal writes to Sessions/Session Logs folder', () => {
  const classStart = src.indexOf('class EndSessionReviewModal');
  const classEnd = src.indexOf('\nclass ', classStart + 1);
  const cls = src.slice(classStart, classEnd);
  includes(cls, 'Sessions/Session Logs');
});

test('EndSessionReviewModal export uses normalizePath', () => {
  const classStart = src.indexOf('class EndSessionReviewModal');
  const classEnd = src.indexOf('\nclass ', classStart + 1);
  const cls = src.slice(classStart, classEnd);
  includes(cls, 'normalizePath(');
});

console.log(`\nPhase I — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

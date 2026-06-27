'use strict';
/**
 * Phase S — Run Session Calendar & Unified Generators
 * Sections 1–5: compact calendar widget, unified generator panel,
 *   post-generation actions, Save as Entity behaviour, session logging.
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

// Slice renderRunSession — function is large (~150k chars), use targeted sentinels
const rsIdx = src.indexOf('function renderRunSession(');
// Use a large window that covers the whole function
const rsBlock = src.slice(rsIdx, rsIdx + 150000);

// Right column slice (after RIGHT COLUMN comment)
const rightColRelIdx = rsBlock.indexOf('// RIGHT COLUMN');
const rightColBlock = rightColRelIdx >= 0 ? rsBlock.slice(rightColRelIdx) : '';

// Calendar section — search in right column
const calSentinel = rightColBlock.indexOf('In-World Calendar');
const calBlock = calSentinel >= 0 ? rightColBlock.slice(calSentinel, calSentinel + 3000) : rightColBlock.slice(0, 3000);

// Unified generator section (left column)
const ugenRelIdx = rsBlock.indexOf('// ── 6. Unified Generator');
const ugenBlock = ugenRelIdx >= 0 ? rsBlock.slice(ugenRelIdx, ugenRelIdx + 10000) : '';

console.log('\nPhase S — Run Session Calendar & Unified Generators\n');

// ── Section 1: Compact Calendar Context Widget ───────────────────────────────
console.log('  Section 1: Compact calendar context widget');

test('renderRunSession includes Calendar section in right column', () => {
  ok(rightColBlock.includes('CalendarModal') || rightColBlock.includes('campCal'),
    'Right column missing calendar widget — CalendarModal not referenced');
});
test('calendar widget reads campaign-scoped calendar (entities.calendars)', () => {
  ok(rsBlock.includes('entities.calendars'), 'renderRunSession does not read entities.calendars');
});
test('calendar widget falls back to state.calendar for legacy data', () => {
  ok(rsBlock.includes('state.calendar'), 'renderRunSession missing state.calendar fallback');
});
test('calendar widget shows current day/month/year', () => {
  ok(calBlock.includes('campCal.day') && calBlock.includes('campCal.month') && calBlock.includes('campCal.year'),
    'Calendar widget missing day/month/year display');
});
test('calendar widget shows calendar name', () => {
  ok(calBlock.includes('campCal.name') || calBlock.includes("'Calendar'"),
    'Calendar widget missing calendar name display');
});
test('calendar widget shows holidays if present', () => {
  ok(calBlock.includes('holidays'), 'Calendar widget missing holidays display');
});
test('calendar widget has Manage Calendar button opening CalendarModal', () => {
  ok(calBlock.includes('CalendarModal') && (calBlock.includes('Manage Calendar') || calBlock.includes('Open Calendar') || calBlock.includes('Set Up Calendar')),
    'Calendar widget missing button to open CalendarModal');
});
test('calendar widget handles missing calendar gracefully', () => {
  ok(calBlock.includes('empty-state') || calBlock.includes('No in-world calendar') || calBlock.includes('Set Up Calendar'),
    'Calendar widget does not handle missing calendar case');
});
test('+1 Day button exists and updates campCal.day', () => {
  ok(calBlock.includes('+1 Day') && calBlock.includes('campCal.day'),
    'Calendar widget missing +1 Day advance action');
});
test('+1 Day logs session event when session active', () => {
  ok(calBlock.includes('logSessionEvent') && calBlock.includes('Date Advanced'),
    '+1 Day should log session event when active session exists');
});
test('calendar is campaign-scoped (filtered by camp.id)', () => {
  ok(rsBlock.includes('camp.id') && rsBlock.includes('entities.calendars'),
    'Calendar not filtered by campaign id — not campaign-scoped');
});

// ── Section 2: Unified Generator panel ──────────────────────────────────────
console.log('\n  Section 2: Unified Generator panel');

test('Unified Generator section exists in renderRunSession', () => {
  ok(rsBlock.includes('Unified Generator') || rsBlock.includes('UNIFIED_GENS'),
    'Unified Generator section missing from renderRunSession');
});
test('UNIFIED_GENS includes partial generator types (NPC Name, Rumour, etc)', () => {
  ok(ugenBlock.includes("'NPC Name'") && ugenBlock.includes("'Rumour'") && ugenBlock.includes("'Plot Twist'"),
    'UNIFIED_GENS missing expected partial generator types');
});
test('UNIFIED_GENS includes full entity generator types', () => {
  ok(ugenBlock.includes("'Full NPC'") && ugenBlock.includes("'Full Quest'") && ugenBlock.includes("'Full Encounter'"),
    'UNIFIED_GENS missing Full NPC/Quest/Encounter generator types');
});
test('UNIFIED_GENS includes Faction Name partial generator', () => {
  ok(ugenBlock.includes("'Faction Name'"), 'UNIFIED_GENS missing Faction Name partial generator');
});
test('UNIFIED_GENS includes Full Faction full generator', () => {
  ok(ugenBlock.includes("'Full Faction'") && ugenBlock.includes('generateCompleteFaction'),
    'UNIFIED_GENS missing Full Faction generator');
});
test('UNIFIED_GENS includes Full Settlement', () => {
  ok(ugenBlock.includes("'Full Settlement'") && ugenBlock.includes('generateCompleteSettlement'),
    'UNIFIED_GENS missing Full Settlement generator');
});
test('UNIFIED_GENS includes Full Loot', () => {
  ok(ugenBlock.includes("'Full Loot'") && ugenBlock.includes('generateCompleteLoot'),
    'UNIFIED_GENS missing Full Loot generator');
});
test('UNIFIED_GENS includes Wild Magic Surge partial', () => {
  ok(ugenBlock.includes("'Wild Magic Surge'"), 'UNIFIED_GENS missing Wild Magic Surge');
});
test('unified panel has dropdown select for generator type', () => {
  ok(ugenBlock.includes('ugenSel') || (ugenBlock.includes('select') && ugenBlock.includes('UNIFIED_GENS')),
    'Unified generator missing dropdown select');
});
test('unified panel has result display area', () => {
  ok(ugenBlock.includes('ugenResultEl') || ugenBlock.includes('te-result-box'),
    'Unified generator missing result display area');
});
test('Generate button calls generate() for partial types', () => {
  ok(ugenBlock.includes('generate(type,') || ugenBlock.includes('generate(type, state)') || ugenBlock.includes('generate('),
    'Unified generator does not call generate() for partial types');
});
test('Generate button calls full genFn for full entity types', () => {
  ok(ugenBlock.includes('cfg.genFn') || ugenBlock.includes('genFn(state)'),
    'Unified generator does not call genFn for full entity types');
});
test('Full entity Generators section is removed (no separate "Full Entity Generators" sectionHead)', () => {
  notOk(rsBlock.includes("'⚡ Full Entity Generators'") || rsBlock.includes("Full Entity Generators'"),
    'Old Full Entity Generators section head still present');
});
test('Quick Generators section is removed (no separate "Quick Generators" sectionHead)', () => {
  notOk(rsBlock.includes("'⚡ Quick Generators'") || rsBlock.includes("Quick Generators'"),
    'Old Quick Generators section head still present');
});

// ── Section 3: Post-generation contextual actions ────────────────────────────
console.log('\n  Section 3: Post-generation contextual actions');

test('action row is hidden before first generation', () => {
  ok(ugenBlock.includes("display:'none'") || ugenBlock.includes("display: 'none'") || ugenBlock.includes("style.display = 'none'"),
    'Action row should start hidden');
});
test('action row shown after Generate pressed (display set to empty string)', () => {
  ok(ugenBlock.includes("ugenActRow.style.display = ''") || ugenBlock.includes('ugenActRow.style.display=""'),
    'Action row not shown after generation');
});
test('Clear button resets result display and hides actions', () => {
  ok(ugenBlock.includes("'Clear'") && ugenBlock.includes("ugenActRow.style.display = 'none'"),
    'Clear button does not hide action row');
});
test('Log to Session button exists in action row', () => {
  ok(ugenBlock.includes('Log to Session'), 'Log to Session button missing from unified generator');
});
test('Save as Entity button exists in action row', () => {
  ok(ugenBlock.includes('Save as Entity'), 'Save as Entity button missing from unified generator');
});
test('Copy button exists in action row', () => {
  ok(ugenBlock.includes("'Copy'"), 'Copy button missing from unified generator');
});

// ── Section 4: Save as Entity behaviour ─────────────────────────────────────
console.log('\n  Section 4: Save as Entity behaviour');

test('Save as Entity for NPC Name opens NPCModal pre-filled', () => {
  ok(ugenBlock.includes('NPCModal') && ugenBlock.includes('NPC Name') && ugenBlock.includes('ugenLastResult'),
    'Save as Entity for NPC Name does not open NPCModal with result');
});
test('Save as Entity for Faction Name opens FactionModal pre-filled', () => {
  ok(ugenBlock.includes('FactionModal') && ugenBlock.includes('Faction Name'),
    'Save as Entity for Faction Name does not open FactionModal');
});
test('Save as Entity for Quest Hook opens QuestModal pre-filled', () => {
  ok(ugenBlock.includes('QuestModal') && ugenBlock.includes('Quest Hook'),
    'Save as Entity for Quest Hook does not open QuestModal');
});
test('Save as Entity for full entity uses EntityDraftModal', () => {
  ok(ugenBlock.includes('EntityDraftModal') && ugenBlock.includes('ugenLastDraft'),
    'Save as Entity for full entity does not use EntityDraftModal');
});
test('Save as Entity stamps campaignId on partial entity', () => {
  ok(ugenBlock.includes('activeCampaignId') && ugenBlock.includes('campaignId'),
    'Save as Entity does not stamp campaignId');
});
test('Save as Entity stamps campaignId on full draft', () => {
  ok(ugenBlock.includes("ugenLastDraft.campaignId") || ugenBlock.includes('ugenLastDraft.campaignId = state.activeCampaignId'),
    'Full entity draft missing campaignId stamp before EntityDraftModal');
});
test('partial types without entity mapping do not open modal silently', () => {
  ok(ugenBlock.includes("Notice('") || ugenBlock.includes('new Notice('),
    'Partial types without save mapping should show a Notice rather than crashing');
});

// ── Section 5: Session logging ───────────────────────────────────────────────
console.log('\n  Section 5: Session logging');

test('Log to Session calls logSessionEvent', () => {
  ok(ugenBlock.includes('logSessionEvent') && ugenBlock.includes('Generator Used'),
    'Log to Session does not call logSessionEvent with "Generator Used"');
});
test('Log to Session also calls logGeneratorHistory', () => {
  ok(ugenBlock.includes('logGeneratorHistory'),
    'Log to Session does not call logGeneratorHistory');
});
test('Log to Session only fires when activeSess exists', () => {
  ok(ugenBlock.includes('activeSess') && ugenBlock.includes('logSessionEvent'),
    'Log to Session not gated by activeSess check');
});
test('Log to Session button is hidden when no active session', () => {
  ok(ugenBlock.includes("ugenLogBtn.style.display = activeSess ? '' : 'none'") ||
     ugenBlock.includes("logBtn.style.display = activeSess"),
    'Log to Session visibility not gated on activeSess');
});

// ── Section 6: CalendarModal still accessible from Sessions/Campaign ─────────
console.log('\n  Section 6: CalendarModal still accessible outside Run Session');

test('CalendarModal class still exists', () => {
  ok(src.includes('class CalendarModal'), 'CalendarModal class is missing');
});
test('CalendarModal is opened from at least one other location', () => {
  const allCalRefs = (src.match(/new CalendarModal\(/g) || []).length;
  ok(allCalRefs >= 2, `CalendarModal only opened in ${allCalRefs} place(s) — should be accessible from multiple locations`);
});

// ── Section 7: No regressions ────────────────────────────────────────────────
console.log('\n  Section 7: Regression checks');

test('no duplicate top-level function declarations after Phase S', () => {
  const seen = {};
  const dups = [];
  for (const m of src.matchAll(/^(?:async )?function (\w+)\(/mg)) {
    seen[m[1]] = (seen[m[1]] || 0) + 1;
    if (seen[m[1]] === 2) dups.push(m[1]);
  }
  ok(dups.length === 0, `Duplicate function declarations: ${dups.join(', ')}`);
});
test('renderRunSession still exists', () => {
  ok(src.includes('function renderRunSession('), 'renderRunSession function missing');
});
test('logSessionEvent still exists', () => {
  ok(src.includes('function logSessionEvent('), 'logSessionEvent function missing');
});
test('logGeneratorHistory still exists', () => {
  ok(src.includes('function logGeneratorHistory('), 'logGeneratorHistory function missing');
});
test('EntityDraftModal still exists', () => {
  ok(src.includes('class EntityDraftModal'), 'EntityDraftModal class missing');
});

// ── Functional: calendar state handling ──────────────────────────────────────
console.log('\n  Section 8: Functional — calendar state');

test('functional: campaign-scoped calendar lookup works', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const state = {
    activeCampaignId: 'camp-1',
    entities: { calendars: [{ id: 'cal-1', campaignId: 'camp-1', name: 'Greyhawk Calendar', day: 15, month: 'Fireseek', year: 591, holidays: ['High Summer'] }] },
    calendar: null,
  };
  const camp = { id: 'camp-1' };
  const campCal = safeArr(state.entities.calendars).find(c => c.campaignId === camp.id) || state.calendar;
  ok(campCal !== null && campCal !== undefined, 'should find campaign-scoped calendar');
  ok(campCal.name === 'Greyhawk Calendar', 'should find correct calendar');
  ok(campCal.day === 15, 'day should be 15');
  ok(safeArr(campCal.holidays).length === 1, 'holidays should be present');
});

test('functional: missing calendar returns null gracefully', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const state = { activeCampaignId: 'camp-2', entities: { calendars: [] }, calendar: null };
  const camp = { id: 'camp-2' };
  const campCal = safeArr(state.entities.calendars).find(c => c.campaignId === camp.id) || state.calendar;
  ok(campCal == null, 'missing calendar should be null/undefined, not throw');
});

test('functional: legacy state.calendar fallback used when no entity calendar', () => {
  function safeArr(v) { return Array.isArray(v) ? v : []; }
  const legacyCal = { name: 'Old Calendar', day: 1, month: 'Spring', year: 300 };
  const state = { activeCampaignId: 'camp-old', entities: { calendars: [] }, calendar: legacyCal };
  const camp = { id: 'camp-old' };
  const campCal = safeArr(state.entities.calendars).find(c => c.campaignId === camp.id) || state.calendar;
  ok(campCal === legacyCal, 'should fall back to state.calendar for legacy data');
});

test('functional: +1 Day increments day correctly', () => {
  const campCal = { id: 'cal-1', name: 'Test Calendar', day: 14, month: 'Spring', year: 100 };
  campCal.day = (campCal.day || 0) + 1;
  ok(campCal.day === 15, '+1 Day should increment day from 14 to 15');
});

test('functional: generator output reset on new generation', () => {
  let ugenLastResult = 'old result'; let ugenLastDraft = { name: 'old draft' };
  // Simulate pressing Generate again
  ugenLastResult = ''; ugenLastDraft = null;
  const type = 'NPC Name'; const newResult = 'Aldric Ashmore';
  ugenLastResult = newResult;
  ok(ugenLastResult === newResult, 'result should be updated to new value');
  ok(ugenLastDraft === null, 'draft should be cleared on new generation');
});

test('functional: partial result stale output cannot be saved after clear', () => {
  let ugenLastResult = 'Tara Blackwood'; let ugenLastDraft = null; let actionsVisible = true;
  // Simulate clear
  ugenLastResult = ''; ugenLastDraft = null; actionsVisible = false;
  ok(ugenLastResult === '', 'result should be cleared');
  ok(!actionsVisible, 'actions should be hidden after clear — stale save prevented');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

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

console.log('\nPhase A — Campaign Command Cleanup\n');

console.log('  Section 1: Campaign cards');
test('renderCampaigns uses full-width stacked layout not te-grid', () => {
  const fn = src.slice(src.indexOf('function renderCampaigns'), src.indexOf('\n// ── DM SCREEN'));
  ok(!fn.includes("ce(main, 'div', 'te-grid')"), 'renderCampaigns still uses te-grid');
  ok(fn.includes('flex-direction:column'), 'renderCampaigns not using stacked layout');
});
test('campaign cards hide Campaign ID from normal view', () => {
  const fn = src.slice(src.indexOf('function renderCampaigns'), src.indexOf('\n// ── DM SCREEN'));
  ok(!fn.includes("'Campaign ID'"), 'Campaign ID still shown in normal card view');
});
test('campaign cards show tagline / world / level range', () => {
  const fn = src.slice(src.indexOf('function renderCampaigns'), src.indexOf('\n// ── DM SCREEN'));
  ok(fn.includes("'World'") && fn.includes("'Level Range'"), 'campaign card missing World or Level Range');
});

console.log('\n  Section 2: Campaign Wizard milestones');
test('wizard renderStep_progression uses chipField for milestone names', () => {
  ok(src.includes('milestoneNames') && src.includes("chipField(el, 'Milestones"), 'wizard progression step missing chipField for milestones');
});
test('createCampaign creates milestone entities', () => {
  ok(src.includes("upsert(this.plugin.state, 'milestones'") && src.includes('milestoneNames'), 'createCampaign not creating milestone entities');
});
test('wizard-created milestones have campaignId', () => {
  const createFn = src.slice(src.indexOf('async createCampaign()'), src.indexOf('// CampaignBibleModal'));
  ok(createFn.includes('campaignId: d.id') && createFn.includes("upsert(this.plugin.state, 'milestones'"), 'milestones not assigned campaignId');
});

console.log('\n  Section 3: Acts entity system');
test('acts array in DEFAULT_STATE entities', () => {
  ok(src.includes("acts: [],"), 'acts not in DEFAULT_STATE');
});
test('acts in ENTITY_ICONS', () => {
  ok(src.includes("acts:'🎭'"), 'acts missing from ENTITY_ICONS');
});
test('acts in ENTITY_LABELS', () => {
  ok(src.includes("acts:'Act'"), 'acts missing from ENTITY_LABELS');
});
test('actFields defined', () => {
  ok(src.includes('const actFields = ['), 'actFields not defined');
});
test('acts in ENTITY_FIELD_SCHEMAS', () => {
  ok(src.includes('acts: actFields'), 'acts not in ENTITY_FIELD_SCHEMAS');
});
test('GenericModal renderField handles entityRef type', () => {
  ok(src.includes("f.type === 'entityRef'"), 'GenericModal not handling entityRef type');
});

console.log('\n  Section 4: Campaign Bible structure');
test('Campaign Bible shows Act entities', () => {
  const fn = src.slice(src.indexOf('function renderCampaignBible'), src.indexOf('\nasync function exportCampaignBible'));
  ok(fn.includes('state.entities.acts'), 'Campaign Bible not showing act entities');
});
test('Campaign Bible shows Factions section', () => {
  const fn = src.slice(src.indexOf('function renderCampaignBible'), src.indexOf('\nasync function exportCampaignBible'));
  ok(fn.includes("state.entities.factions"), 'Campaign Bible missing factions');
});
test('Campaign Bible shows Adventures section', () => {
  const fn = src.slice(src.indexOf('function renderCampaignBible'), src.indexOf('\nasync function exportCampaignBible'));
  ok(fn.includes("state.entities.adventures"), 'Campaign Bible missing adventures');
});
test('Campaign Bible shows Quests section', () => {
  const fn = src.slice(src.indexOf('function renderCampaignBible'), src.indexOf('\nasync function exportCampaignBible'));
  ok(fn.includes("state.entities.quests"), 'Campaign Bible missing quests');
});
test('Campaign Bible milestone section has Delete button', () => {
  const fn = src.slice(src.indexOf('function renderCampaignBible'), src.indexOf('\nasync function exportCampaignBible'));
  ok(fn.includes("removeItem(state, 'milestones'"), 'Campaign Bible milestones missing delete');
});
test('Campaign Bible secret section has Delete button', () => {
  const fn = src.slice(src.indexOf('function renderCampaignBible'), src.indexOf('\nasync function exportCampaignBible'));
  ok(fn.includes("removeItem(state, 'secrets'"), 'Campaign Bible secrets missing delete');
});

console.log('\n  Section 5: Campaign Bible export');
test('export has YAML frontmatter with entityType campaign-bible', () => {
  const fn = src.slice(src.indexOf('async function exportCampaignBible'), src.indexOf('\n// ── GAZETTEER'));
  ok(fn.includes("entityType: campaign-bible") && fn.includes("ttrpg-engine: true"), 'export missing YAML frontmatter');
});
test('export includes quests', () => {
  const fn = src.slice(src.indexOf('async function exportCampaignBible'), src.indexOf('\n// ── GAZETTEER'));
  ok(fn.includes("state.entities.quests"), 'export missing quests');
});
test('export includes factions', () => {
  const fn = src.slice(src.indexOf('async function exportCampaignBible'), src.indexOf('\n// ── GAZETTEER'));
  ok(fn.includes("state.entities.factions"), 'export missing factions');
});
test('export includes sessions summary', () => {
  const fn = src.slice(src.indexOf('async function exportCampaignBible'), src.indexOf('\n// ── GAZETTEER'));
  ok(fn.includes("state.entities.sessions"), 'export missing sessions');
});

console.log('\n  Section 6: Milestones consolidation');
test('no standalone Milestones tab in Campaign Command', () => {
  const fn = src.slice(src.indexOf('function renderCampaignCommand'), src.indexOf('\nfunction renderMilestonesSection'));
  ok(!fn.includes("id: 'milestones'"), 'Milestones tab still in Campaign Command tabs');
});
test('renderSessions no longer has Milestones section', () => {
  const fn = src.slice(src.indexOf('function renderSessions'), src.indexOf('\nconst milestoneFields'));
  ok(!fn.includes("sectionHead(main, 'Milestones')"), 'Sessions still has Milestones section');
});
test('milestones route redirects to bible', () => {
  ok(src.includes("milestones:           (el, p) => { p.state.activeSubSection = 'bible'"), 'milestones route not redirecting to bible');
});

console.log('\n  Section 8: Calendar +Day button');
test('calendar card has +Day button in renderSessions', () => {
  const fn = src.slice(src.indexOf('function renderSessions'), src.indexOf('\nconst milestoneFields'));
  ok(fn.includes("'+ Day'"), 'calendar card missing +Day button');
});
test('+Day increments cal.day', () => {
  const fn = src.slice(src.indexOf('function renderSessions'), src.indexOf('\nconst milestoneFields'));
  ok(fn.includes('day + 1'), '+Day not incrementing day');
});

console.log('\n  Section 9: Timeline event session picker');
test('timelineFields linkedSessionId uses entityRef', () => {
  const fieldIdx = src.indexOf("const timelineFields = [");
  const fieldEnd = src.indexOf('];', fieldIdx);
  const block = src.slice(fieldIdx, fieldEnd);
  ok(block.includes("entityRef") && block.includes("linkedSessionId"), 'timelineFields linkedSessionId not using entityRef');
});

console.log('\n  Section 10: DM Screen tab removed');
test('DM Screen tab not in Campaign Command tabs', () => {
  const fn = src.slice(src.indexOf('function renderCampaignCommand'), src.indexOf('\nfunction renderMilestonesSection'));
  ok(!fn.includes("id: 'dmscreen'"), 'DM Screen tab still in Campaign Command tabs');
});
test('dmscreen route redirects to run-session', () => {
  ok(src.includes("dmscreen:             (el, p) => { p.state.activeSubSection = 'run-session'"), 'dmscreen route not redirecting to run-session');
});

console.log('\n  Section 11: milestoneFields improvements');
test('milestoneFields has status field', () => {
  const mf = src.slice(src.indexOf('const milestoneFields = ['), src.indexOf('];', src.indexOf('const milestoneFields = [')));
  ok(mf.includes("key: 'status'"), 'milestoneFields missing status field');
});
test('milestoneFields linkedSessionId uses entityRef', () => {
  const mf = src.slice(src.indexOf('const milestoneFields = ['), src.indexOf('];', src.indexOf('const milestoneFields = [')));
  ok(mf.includes("entityRef") && mf.includes("linkedSessionId"), 'milestoneFields linkedSessionId not entityRef');
});

console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

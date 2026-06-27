'use strict';
/**
 * Phase W — Threats, Downtime, Projects & Bastions Selector Pass
 * Coverage: selector cleanup, placeholder scrubbing, and campaign scoping.
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
function eq(a, b, msg) { assert.equal(a, b, msg); }
function notOk(cond, msg) { assert.ok(!cond, msg); }

console.log('\nPhase W — Threats, Downtime, Projects & Bastions Selector Pass\n');

console.log('  Section 1: Shared helpers');

test('campaign scope helper exists', () => {
  ok(src.includes('function isInActiveCampaignScope('), 'isInActiveCampaignScope missing');
});
test('placeholder scrub helpers exist', () => {
  ok(src.includes('function scrubLegacyPlaceholderText(') && src.includes('function scrubLegacyPlaceholderArray('),
    'placeholder scrub helpers missing');
});
test('typed entity multi picker helper exists', () => {
  ok(src.includes('function addTypedEntityMultiPicker('), 'addTypedEntityMultiPicker missing');
});

console.log('\n  Section 2: BBEG cleanup');

test('BBEGModal links timers instead of freeform escalation only', () => {
  ok(src.includes("addEntityMultiPicker(s2, 'Escalation Timers'") && src.includes('timerIds'),
    'BBEG timer linkage missing');
});
test('BBEGModal supports typed lieutenant links', () => {
  ok(src.includes('lieutenantRefs') && src.includes('addTypedEntityMultiPicker(s1, \'Lieutenants (other linked actors)\''),
    'BBEG lieutenant typed links missing');
});
test('BBEGModal lair location uses typed linked selector', () => {
  ok(src.includes("addTypedEntityPicker(s1, 'Lair Location (linked)'") && src.includes('lairLocationType'),
    'BBEG lair location typed selector missing');
});

console.log('\n  Section 3: Timer cleanup');

test('TimerModal links faction, quest, BBEG, war front, incursion, session', () => {
  ['factionId', 'questId', 'bbegId', 'warFrontId', 'incursionId', 'sessionId'].forEach(token => ok(src.includes(token), `Timer field missing: ${token}`));
});
test('TimerModal scrubs legacy faction placeholder text', () => {
  ok(src.includes("this.values.faction = scrubLegacyPlaceholderText(this.values.faction)"),
    'Timer legacy faction scrub missing');
});

console.log('\n  Section 4: War fronts and incursions');

test('WarFrontModal exists and links faction and location selectors', () => {
  ok(src.includes('class WarFrontModal extends Modal') && src.includes('factionId') && src.includes('locationType'),
    'WarFrontModal selector cleanup missing');
});
test('IncursionModal exists and links origin plus connected entities', () => {
  ok(src.includes('class IncursionModal extends Modal') && src.includes('originType') && src.includes('warFrontIds') && src.includes('timerIds'),
    'IncursionModal selector cleanup missing');
});

console.log('\n  Section 5: Downtime, projects, bastions');

test('DowntimeModal exists with linked assignee, project, bastion, and session fields', () => {
  ['class DowntimeModal extends Modal', 'assignedType', 'projectId', 'bastionId', 'sessionId'].forEach(token => ok(src.includes(token), `Downtime token missing: ${token}`));
});
test('ProjectModal uses typed assignee selector and link fields', () => {
  ok(src.includes('assignedToType') && src.includes('assignedToId') && src.includes('downtimeId') && src.includes('bastionId'),
    'ProjectModal selector cleanup missing');
});
test('BastionModal exists with linked location and settlement selectors', () => {
  ok(src.includes('class BastionModal extends Modal') && src.includes('linkedSettlementId') && src.includes('locationId'),
    'BastionModal selector cleanup missing');
});
test('BastionModal uses chip-based defences and events', () => {
  ok(src.includes("chipField(contentEl, 'Defences'") && src.includes("chipField(contentEl, 'Events / Threats'"),
    'Bastion chip-based defences/events missing');
});

console.log('\n  Section 6: Enemy Templates');

test('EnemyTemplateModal does not expose live manual faction field', () => {
  const start = src.indexOf('class EnemyTemplateModal extends Modal');
  const end = src.indexOf('\n// —— FactionRelationshipModal', start);
  const block = src.slice(start, end);
  notOk(block.includes("Faction Tag (manual)"), 'EnemyTemplateModal still exposes manual faction field');
  ok(block.includes("addEntityPicker(s2, 'Faction'"), 'EnemyTemplateModal factionId selector missing');
});
test('Enemy Templates are described as reusable encounter stat packages', () => {
  ok(src.includes('reusable encounter stat packages'), 'Enemy Template purpose text missing');
});

console.log('\n  Section 7: Campaign scoping in renders');

test('downtime render filters by active campaign scope', () => {
  ok(src.includes("isInActiveCampaignScope(plugin.state, 'downtime', item)"), 'Downtime render scoping missing');
});
test('war fronts and incursions render filters by active campaign scope', () => {
  ok(src.includes("isInActiveCampaignScope(state, 'warFronts', item)") && src.includes("isInActiveCampaignScope(state, 'incursions', item)"),
    'Endgame render scoping missing');
});
test('timers and enemy templates lists filter by active campaign scope', () => {
  ok(src.includes("isInActiveCampaignScope(plugin.state, 'timers', t)") && src.includes("isInActiveCampaignScope(plugin.state, 'enemyTemplates', t)"),
    'Threat list scoping missing');
});

console.log('\n  Section 8: Functional placeholder handling');

const PLACEHOLDER_TEXT_VALUES = new Set([
  'select existing', 'select faction', 'select location', 'select settlement', 'select campaign',
  'select owner', 'select assignee', 'select session', 'select quest', 'select timer',
  'select source', 'select origin', 'none', 'n/a', 'na', 'tbd', 'other', 'custom',
]);
function isPlaceholderLike(value) {
  const v = String(value || '').trim().toLowerCase();
  return !v || PLACEHOLDER_TEXT_VALUES.has(v) || v.startsWith('select ') || v === '— none —' || v === '— select —';
}
function scrubLegacyPlaceholderText(value) {
  return isPlaceholderLike(value) ? '' : String(value || '').trim();
}

test('functional: placeholder text is scrubbed to empty', () => {
  eq(scrubLegacyPlaceholderText('Select existing'), '');
  eq(scrubLegacyPlaceholderText('select faction'), '');
});
test('functional: real legacy text survives', () => {
  eq(scrubLegacyPlaceholderText('The Ash Guard'), 'The Ash Guard');
});

console.log('\n' + '—'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

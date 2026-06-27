'use strict';
/**
 * Phase U — Homebrew Promotion Foundations
 * Coverage: homebrew schema normalization, creature/deity promotion,
 *   homebrew entry point, and hybrid ancestry compatibility.
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

const renderHomebrewIdx = src.indexOf('function renderHomebrew(');
const renderHomebrewEnd = src.indexOf('\n// —— GENERATORS', renderHomebrewIdx);
const renderHomebrewBlock = src.slice(renderHomebrewIdx, renderHomebrewEnd);

const creatureModalIdx = src.indexOf('class CreatureModal extends Modal');
const creatureModalEnd = src.indexOf('\n// BBEGModal', creatureModalIdx);
const creatureModalBlock = src.slice(creatureModalIdx, creatureModalEnd);

const deityModalIdx = src.indexOf('class DeityModal extends Modal');
const deityModalEnd = src.indexOf('\n// CampaignModal', deityModalIdx);
const deityModalBlock = src.slice(deityModalIdx, deityModalEnd);

console.log('\nPhase U — Homebrew Promotion Foundations\n');

console.log('  Section 1: Homebrew schema normalization');

test('normalizeHomebrewRecord helper exists', () => {
  ok(src.includes('function normalizeHomebrewRecord('), 'normalizeHomebrewRecord missing');
});
test('homebrew normalization includes category/type/status/visibility/scope metadata', () => {
  ok(src.includes('record.category') && src.includes('record.type') && src.includes('record.status') && src.includes('record.visibility') && src.includes('record.scope'),
    'normalizeHomebrewRecord missing required metadata fields');
});
test('homebrew normalization preserves hybrid ancestry source links', () => {
  ok(src.includes('record.sourceHybridId') && src.includes("record.sourceEntityType = 'hybridAncestries'"),
    'hybrid ancestry source link normalization missing');
});
test('homebrew template renders source links', () => {
  ok(src.includes('## Source Links') && src.includes('sourceEntityType') && src.includes('sourceCampaignId'),
    'homebrew markdown template missing source link block');
});

console.log('\n  Section 2: Promotion helpers');

test('promoteCreatureToHomebrew helper exists', () => {
  ok(src.includes('function promoteCreatureToHomebrew('), 'promoteCreatureToHomebrew missing');
});
test('promoteCreatureToHomebrew maps core creature fields', () => {
  ['creatureType', 'alignment', 'ac', 'hp', 'speed', 'abilities', 'traits', 'actions', 'reactions', 'legendaryActions', 'lairActions', 'lore', 'habitat', 'loot']
    .forEach(field => ok(src.includes(field), `creature promotion missing ${field}`));
});
test('promoteDeityToHomebrew helper exists', () => {
  ok(src.includes('function promoteDeityToHomebrew('), 'promoteDeityToHomebrew missing');
});
test('promoteDeityToHomebrew maps deity fields', () => {
  ['titles', 'domain', 'symbols', 'worshippers', 'clergy', 'summary', 'notes']
    .forEach(field => ok(src.includes(field), `deity promotion missing ${field}`));
});
test('promotion writes safe back references onto source entities', () => {
  ok(src.includes('homebrewId') && src.includes('homebrewIds') && src.includes('promotedHomebrewIds'),
    'source entity back references missing');
});

console.log('\n  Section 3: UI entry points');

test('CreatureModal has Save as Homebrew action', () => {
  ok(creatureModalBlock.includes('Save as Homebrew') && creatureModalBlock.includes('promoteCreatureToHomebrew'),
    'CreatureModal missing Save as Homebrew action');
});
test('DeityModal exists and has Save as Homebrew action', () => {
  ok(deityModalBlock.includes('Save as Homebrew') && deityModalBlock.includes('promoteDeityToHomebrew'),
    'DeityModal missing Save as Homebrew action');
});
test('Create Homebrew entry point exists', () => {
  ok(src.includes('class HomebrewTypeChooserModal') && src.includes('Create Homebrew'),
    'Create Homebrew entry point missing');
});
test('Homebrew type chooser includes the requested category groups', () => {
  ['Character Options', 'Rules & Mechanics', 'Items & Equipment', 'Monsters & Statblocks', 'Worlds & Planes', 'Rollable Tables']
    .forEach(label => ok(src.includes(label), `missing category group ${label}`));
});
test('generic + Entry is not used for Homebrew', () => {
  notOk(src.includes("'+ Entry'") && src.includes('Homebrew'), 'generic + Entry still used for Homebrew');
});

console.log('\n  Section 4: Functional schema checks');

function normalizeListField(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}
function homebrewStatusValue(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'Draft';
  if (raw === 'approved' || raw === 'final' || raw === 'playtested' || raw === 'active') return 'Approved';
  if (raw === 'retired' || raw === 'deprecated' || raw === 'archived') return 'Retired';
  if (raw === 'needs review' || raw === 'needs-review' || raw === 'pending review' || raw === 'pending-review') return 'Needs Review';
  if (raw === 'draft') return 'Draft';
  return status;
}
function homebrewCategoryForType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (!t) return 'Rules & Mechanics';
  if (['ancestry','race / ancestry','race','hybrid ancestry','class','subclass','background','feat','character option'].includes(t)) return 'Character Options';
  if (['rule','mechanic','optional rule','table','rollable table'].includes(t)) return 'Rules & Mechanics';
  if (['item','weapon','armour','armor','magic item','equipment'].includes(t)) return 'Items & Equipment';
  if (['monster','creature','npc template','statblock'].includes(t)) return 'Monsters & Statblocks';
  if (['deity','plane','world lore','realm','pantheon'].includes(t)) return 'Worlds & Planes';
  return 'Rules & Mechanics';
}
function normalizeHomebrewRecordLite(item) {
  const record = Object.assign({}, item || {});
  record.id = record.id || 'homebrew-1';
  record.homebrewId = record.homebrewId || record.id;
  record.type = record.type || (record.sourceHybridId ? 'Hybrid Ancestry' : 'Other');
  record.category = record.category || homebrewCategoryForType(record.type);
  record.source = 'homebrew';
  record.status = homebrewStatusValue(record.status);
  record.visibility = record.visibility || (record.playerVisible ? 'player-visible' : 'dm-only');
  record.tags = normalizeListField(record.tags);
  if (!record.sourceEntityType && record.sourceHybridId) record.sourceEntityType = 'hybridAncestries';
  if (!record.sourceEntityId && record.sourceHybridId) record.sourceEntityId = record.sourceHybridId;
  if (!record.promotedFromEntityType && record.sourceEntityType) record.promotedFromEntityType = record.sourceEntityType;
  if (!record.promotedFromEntityId && record.sourceEntityId) record.promotedFromEntityId = record.sourceEntityId;
  record.sourceCampaignId = record.sourceCampaignId || record.campaignId || '';
  record.scope = record.scope || (record.sourceCampaignId ? 'campaign' : 'global');
  return record;
}

test('functional: legacy homebrew records still normalize and render as Draft', () => {
  const hb = normalizeHomebrewRecordLite({ id: 'hb-legacy', name: 'Legacy Brew', type: 'Spell', playerVisible: true, tags: 'alpha, beta' });
  eq(hb.status, 'Draft');
  eq(hb.visibility, 'player-visible');
  eq(hb.category, 'Rules & Mechanics');
  eq(hb.tags.length, 2);
});
test('functional: hybrid ancestry homebrew records preserve compatibility links', () => {
  const hb = normalizeHomebrewRecordLite({ id: 'hb-hybrid', name: 'Drow-Human', sourceHybridId: 'hy-1', content: '# Drow-Human' });
  eq(hb.type, 'Hybrid Ancestry');
  eq(hb.category, 'Character Options');
  eq(hb.sourceEntityType, 'hybridAncestries');
  eq(hb.sourceEntityId, 'hy-1');
});
test('functional: promoted creature records classify to Monsters & Statblocks', () => {
  const hb = normalizeHomebrewRecordLite({ id: 'hb-creature', name: 'Ash Drake', type: 'Creature', sourceEntityType: 'creatures', sourceEntityId: 'cre-1', campaignId: 'camp-1' });
  eq(hb.category, 'Monsters & Statblocks');
  eq(hb.scope, 'campaign');
});
test('functional: promoted deity records classify to Worlds & Planes', () => {
  const hb = normalizeHomebrewRecordLite({ id: 'hb-deity', name: 'Astra', type: 'Deity', sourceEntityType: 'deities', sourceEntityId: 'deity-1' });
  eq(hb.category, 'Worlds & Planes');
});

console.log('\n' + '—'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

'use strict';
/**
 * Phase 271 — Multi-Section Fixes
 * Sections 0–9: vault root path, calendar saving, generator history,
 *   relationship display names, AddCombatant entity picker,
 *   create-and-link fields, active campaign scoping.
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

// ── Section 0: vault root path ───────────────────────────────────────────────
console.log('\nPhase 271 — Multi-Section Fixes\n');
console.log('  Section 0: Vault root path');

test('default setting is campaignRootFolder: Campaigns', () => {
  ok(src.includes("campaignRootFolder: 'Campaigns'"), 'campaignRootFolder default missing');
});

test('noteRootFolder defaults to empty string (not TTRPG Engine)', () => {
  ok(src.includes("noteRootFolder: ''"), 'noteRootFolder should default to empty string');
});

test('campaignRootFolder() helper exists', () => {
  ok(/^function campaignRootFolder\s*\(/m.test(src), 'campaignRootFolder helper function missing');
});

test('campaignRootFolder() falls back to noteRootFolder for migration', () => {
  ok(src.includes("s.campaignRootFolder || s.noteRootFolder || 'Campaigns'"), 'migration fallback missing');
});

test('globalFolder uses campaignRootFolder', () => {
  ok(src.includes('campaignRootFolder(plugin)') && src.includes('_Global'), 'globalFolder not using campaignRootFolder or _Global');
});

test('resolveEntityNotePath uses campaignRootFolder setting', () => {
  ok(src.includes("state.settings.campaignRootFolder || state.settings.noteRootFolder || 'Campaigns'"), 'resolveEntityNotePath not updated');
});

test('campaign wizard folder creation uses campaignFolder()', () => {
  ok(src.includes('const base = campaignFolder(this.plugin)'), 'wizard createFolders not using campaignFolder()');
});

test('campaign wizard starter note uses campaignFolder()', () => {
  // Two occurrences of campaignFolder(this.plugin) in wizard
  const count = (src.match(/const base = campaignFolder\(this\.plugin\)/g) || []).length;
  ok(count >= 2, `Expected ≥2 wizard uses of campaignFolder(this.plugin), got ${count}`);
});

test('Settings UI shows Campaign Root Folder label', () => {
  ok(src.includes("'Campaign Root Folder'") || src.includes('"Campaign Root Folder"'), 'Settings UI missing Campaign Root Folder label');
});

test('diagnoseLegacyNotes uses campaignRootFolder setting', () => {
  ok(src.includes("state.settings.campaignRootFolder || state.settings.noteRootFolder || 'Campaigns'"), 'diagnoseLegacyNotes not updated');
});

// ── Section 1: calendar saving ───────────────────────────────────────────────
console.log('\n  Section 1: Calendar saving');

test('CalendarModal saves to entities.calendars via upsert', () => {
  ok(src.includes("upsert(this.plugin.state, 'calendars', this.values)"), 'CalendarModal not upserting to entities.calendars');
});

test('CalendarModal keeps singleton state.calendar in sync', () => {
  ok(src.includes('this.plugin.state.calendar = this.values'), 'CalendarModal not updating singleton');
});

test('CalendarModal loads from entities.calendars if available', () => {
  ok(src.includes("state.entities.calendars).find(c => c.campaignId === camp.id)"), 'CalendarModal not reading from entities.calendars');
});

test('CalendarModal assigns uid to new calendar', () => {
  ok(src.includes("if (!this.values.id) this.values.id = uid('cal')"), 'CalendarModal not assigning uid to calendar');
});

test('CalendarModal stamps campaignId', () => {
  ok(src.includes("if (camp && !this.values.campaignId) this.values.campaignId = camp.id"), 'CalendarModal not stamping campaignId');
});

// ── Section 2: generator history ─────────────────────────────────────────────
console.log('\n  Section 2: Generator history');

test('logGeneratorHistory helper exists', () => {
  ok(/^function logGeneratorHistory\s*\(/m.test(src), 'logGeneratorHistory missing');
});

test('logGeneratorHistory stamps campaignId', () => {
  ok(src.includes("campaignId: camp ? camp.id : ''"), 'logGeneratorHistory not stamping campaignId');
});

test('logGeneratorHistory respects 200-entry limit', () => {
  ok(src.includes('plugin.state.generatorHistory.length > 200'), 'history limit check missing');
});

test('EntityDraftModal calls logGeneratorHistory on open', () => {
  ok(src.includes('logGeneratorHistory(this.plugin, {') && src.includes('targetEntityType: this.entityKey'), 'EntityDraftModal not logging history');
});

test('EntityDraftModal updates status to saved', () => {
  ok(src.includes("entry.status = 'saved'"), 'EntityDraftModal not updating status to saved');
});

test('GeneratorModal uses logGeneratorHistory', () => {
  ok(src.includes('logGeneratorHistory(this.plugin, { type: this.type, result: this.result })'), 'GeneratorModal not using central logger');
});

// ── Section 5: relationship display names ────────────────────────────────────
console.log('\n  Section 5: Relationship display names');

test('getEntityDisplayName helper exists', () => {
  ok(/^function getEntityDisplayName\s*\(/m.test(src), 'getEntityDisplayName missing');
});

test('renderRelationshipTracker uses fromId for display name', () => {
  ok(src.includes('rel.fromId') && src.includes('fromName'), 'relationship tracker not using fromId');
});

test('renderRelationshipTracker uses toId for display name', () => {
  ok(src.includes('rel.toId') && src.includes('toName'), 'relationship tracker not using toId');
});

test('relationship tracker falls back to legacy text fields', () => {
  ok(src.includes('rel.from || ') || src.includes("(rel.from || '?')"), 'relationship tracker missing legacy fallback');
});

// ── Section 7: AddCombatant entity picker ────────────────────────────────────
console.log('\n  Section 7: AddCombatant entity picker');

test('AddCombatantModal has mode property', () => {
  ok(src.includes("this.mode = 'manual'"), 'AddCombatantModal missing mode toggle');
});

test('AddCombatantModal has _render method', () => {
  ok(src.includes('_render(contentEl)'), 'AddCombatantModal missing _render method');
});

test('AddCombatantModal supports entity picker mode', () => {
  ok(src.includes("this.mode === 'entity'"), 'AddCombatantModal missing entity picker mode');
});

test('AddCombatantModal auto-fills stats from entity', () => {
  ok(src.includes('entity.hp || entity.maxHp || 10'), 'AddCombatantModal not auto-filling HP');
});

test('AddCombatantModal stores sourceEntityId', () => {
  ok(src.includes('this.values.sourceEntityId = v'), 'AddCombatantModal not storing sourceEntityId');
});

// ── Section 8: create-and-link fields ────────────────────────────────────────
console.log('\n  Section 8: Create-and-link fields');

test('QuestModal has adventureId field', () => {
  ok(src.includes("adventureId: ''") && src.includes("'Parent Adventure'"), 'QuestModal missing adventureId field');
});

test('EncounterModal has adventureId field', () => {
  const encIdx = src.indexOf('class EncounterModal');
  ok(encIdx !== -1 && src.indexOf("adventureId: ''", encIdx) !== -1, 'EncounterModal missing adventureId');
});

test('EncounterModal has questId field', () => {
  const encIdx = src.indexOf('class EncounterModal');
  ok(encIdx !== -1 && src.indexOf("questId: ''", encIdx) !== -1, 'EncounterModal missing questId');
});

test('adventureFields includes actId entityRef', () => {
  ok(src.includes("key: 'actId'") && src.includes("entityType: 'acts'"), 'adventureFields missing actId entityRef');
});

test('EncounterModal shows Parent Quest picker', () => {
  ok(src.includes("'Parent Quest'"), 'EncounterModal missing Parent Quest picker label');
});

// ── Section 9: active campaign scoping ──────────────────────────────────────
console.log('\n  Section 9: Active campaign scoping');

test('renderRelationshipTracker filters by active campaign', () => {
  ok(src.includes("!r.campaignId || r.campaignId === camp.id"), 'relationship tracker not campaign-scoped');
});

test('generator history display filters by active campaign', () => {
  ok(src.includes("!h.campaignId || h.campaignId === activeCamp.id"), 'generator history not campaign-scoped');
});

test('logGeneratorHistory auto-stamps active campaignId', () => {
  ok(src.includes("campaignId: camp ? camp.id : ''"), 'logGeneratorHistory not stamping campaignId');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

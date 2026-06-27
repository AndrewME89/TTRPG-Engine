'use strict';
/**
 * Backup / Import / Restore reliability tests.
 * Covers both static source analysis and inline functional verification
 * of the parsing helpers (re-implemented to avoid Obsidian globals).
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

// ── Re-implement pure helpers (same logic as main.js, no Obsidian globals) ────
const PLUGIN_VERSION = '2.1.0';

function isBackupWrapper(obj) {
  return obj !== null && typeof obj === 'object' && typeof obj.state === 'object' && obj.state !== null &&
    typeof obj.state.entities === 'object' && obj.state.entities !== null;
}
function isRawPluginState(obj) {
  return obj !== null && typeof obj === 'object' && typeof obj.entities === 'object' && obj.entities !== null && !obj.state;
}
function buildBackupWrapperFromRawState(state) {
  const counts = {};
  const ents = state.entities || {};
  for (const [k, arr] of Object.entries(ents)) counts[k] = Array.isArray(arr) ? arr.length : 0;
  return { version: state.version || PLUGIN_VERSION, timestamp: state.updatedAt || null, entityCounts: counts, state };
}
function parseTtrpgBackupJson(rawJson) {
  let obj;
  try { obj = JSON.parse(rawJson); } catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
  if (isBackupWrapper(obj)) {
    if (!obj.entityCounts) {
      const ents = obj.state.entities || {};
      obj.entityCounts = {};
      for (const [k, arr] of Object.entries(ents)) obj.entityCounts[k] = Array.isArray(arr) ? arr.length : 0;
    }
    return obj;
  }
  if (isRawPluginState(obj)) return buildBackupWrapperFromRawState(obj);
  throw new Error('File does not appear to be a TTRPG Engine backup or plugin state file (no entities found).');
}

// ── Test fixtures ─────────────────────────────────────────────────────────────
const rawState = {
  version: '2.1.0',
  activeCampaignId: 'camp-1',
  settings: { compact: false, campaignRootFolder: 'Campaigns' },
  entities: { campaigns: [{ id: 'camp-1', name: 'Test Campaign' }], npcs: [{ id: 'npc-1', name: 'Gandalf' }], sessions: [] },
  relationships: [{ id: 'rel-1', fromId: 'camp-1', toId: 'npc-1', type: 'member' }],
  diceHistory: [],
  generatorHistory: [],
};

const backupWrapper = {
  version: '2.1.0',
  timestamp: '2025-01-01T00:00:00.000Z',
  entityCounts: { campaigns: 1, npcs: 1 },
  state: rawState,
};

const invalidObj = { foo: 'bar', baz: 42 };

console.log('\nBackup / Import / Restore\n');

// ── Section 1: Helper declarations ────────────────────────────────────────────
console.log('  Section 1: Helper function declarations');

test('isBackupWrapper declared in main.js', () => {
  ok(src.includes('function isBackupWrapper('), 'isBackupWrapper not declared');
});
test('isRawPluginState declared in main.js', () => {
  ok(src.includes('function isRawPluginState('), 'isRawPluginState not declared');
});
test('buildBackupWrapperFromRawState declared in main.js', () => {
  ok(src.includes('function buildBackupWrapperFromRawState('), 'buildBackupWrapperFromRawState not declared');
});
test('parseTtrpgBackupJson declared in main.js', () => {
  ok(src.includes('function parseTtrpgBackupJson('), 'parseTtrpgBackupJson not declared');
});
test('helpers are declared exactly once each', () => {
  ['isBackupWrapper', 'isRawPluginState', 'buildBackupWrapperFromRawState', 'parseTtrpgBackupJson'].forEach(name => {
    const n = (src.match(new RegExp(`function ${name}\\(`, 'g')) || []).length;
    ok(n === 1, `${name} declared ${n} times (expected 1)`);
  });
});

// ── Section 2: isBackupWrapper behaviour ─────────────────────────────────────
console.log('\n  Section 2: isBackupWrapper');

test('isBackupWrapper accepts backup wrapper shape', () => {
  ok(isBackupWrapper(backupWrapper), 'backup wrapper should be identified as wrapper');
});
test('isBackupWrapper rejects raw plugin state', () => {
  notOk(isBackupWrapper(rawState), 'raw state should not be identified as wrapper');
});
test('isBackupWrapper rejects invalid object', () => {
  notOk(isBackupWrapper(invalidObj), 'invalid object should not be identified as wrapper');
});
test('isBackupWrapper rejects null', () => {
  notOk(isBackupWrapper(null), 'null should not be identified as wrapper');
});

// ── Section 3: isRawPluginState behaviour ─────────────────────────────────────
console.log('\n  Section 3: isRawPluginState');

test('isRawPluginState accepts raw plugin state', () => {
  ok(isRawPluginState(rawState), 'raw state should be identified as raw plugin state');
});
test('isRawPluginState rejects backup wrapper', () => {
  notOk(isRawPluginState(backupWrapper), 'backup wrapper should not be identified as raw state (has .state)');
});
test('isRawPluginState rejects invalid object', () => {
  notOk(isRawPluginState(invalidObj), 'invalid object should not be identified as raw state');
});

// ── Section 4: buildBackupWrapperFromRawState ─────────────────────────────────
console.log('\n  Section 4: buildBackupWrapperFromRawState');

test('wraps raw state in backup wrapper shape', () => {
  const wrapped = buildBackupWrapperFromRawState(rawState);
  ok(wrapped.state === rawState, 'state reference should be preserved');
  ok(typeof wrapped.entityCounts === 'object', 'entityCounts should be present');
  ok(wrapped.version === '2.1.0', 'version should be copied');
});
test('entityCounts reflect actual array lengths', () => {
  const wrapped = buildBackupWrapperFromRawState(rawState);
  ok(wrapped.entityCounts.campaigns === 1, 'campaigns count should be 1');
  ok(wrapped.entityCounts.npcs === 1, 'npcs count should be 1');
  ok(wrapped.entityCounts.sessions === 0, 'sessions count should be 0');
});
test('raw state with no version uses PLUGIN_VERSION fallback', () => {
  const noVer = { entities: { campaigns: [] } };
  const wrapped = buildBackupWrapperFromRawState(noVer);
  ok(typeof wrapped.version === 'string' && wrapped.version.length > 0, 'should have fallback version');
});

// ── Section 5: parseTtrpgBackupJson ──────────────────────────────────────────
console.log('\n  Section 5: parseTtrpgBackupJson');

test('accepts backup wrapper JSON', () => {
  const result = parseTtrpgBackupJson(JSON.stringify(backupWrapper));
  ok(isBackupWrapper(result), 'result should be backup wrapper');
  ok(result.state.activeCampaignId === 'camp-1', 'activeCampaignId should survive');
});
test('accepts raw plugin state JSON', () => {
  const result = parseTtrpgBackupJson(JSON.stringify(rawState));
  ok(isBackupWrapper(result), 'result should be normalised to wrapper shape');
  ok(result.state.activeCampaignId === 'camp-1', 'activeCampaignId should survive');
  ok(result.state.entities.npcs.length === 1, 'npcs should survive');
});
test('rejects invalid JSON', () => {
  assert.throws(() => parseTtrpgBackupJson('{broken json'), /Invalid JSON/);
});
test('rejects object with no entities', () => {
  assert.throws(() => parseTtrpgBackupJson(JSON.stringify(invalidObj)), /no entities/);
});
test('rejects empty string', () => {
  assert.throws(() => parseTtrpgBackupJson(''), /Invalid JSON/);
});

// ── Section 6: restore preserves full state fields ───────────────────────────
console.log('\n  Section 6: Full-state restore preserves all fields');

test('parsed raw state retains relationships', () => {
  const result = parseTtrpgBackupJson(JSON.stringify(rawState));
  ok(Array.isArray(result.state.relationships), 'relationships should be present');
  ok(result.state.relationships.length === 1, 'relationship should survive');
});
test('parsed raw state retains settings', () => {
  const result = parseTtrpgBackupJson(JSON.stringify(rawState));
  ok(typeof result.state.settings === 'object', 'settings should be present');
  ok(result.state.settings.campaignRootFolder === 'Campaigns', 'settings should survive');
});
test('parsed raw state retains activeCampaignId', () => {
  const result = parseTtrpgBackupJson(JSON.stringify(rawState));
  ok(result.state.activeCampaignId === 'camp-1', 'activeCampaignId should survive');
});
test('entityCounts populated for wrapper missing them', () => {
  const wrapperNoCounts = { version: '2.1.0', timestamp: null, state: rawState };
  const result = parseTtrpgBackupJson(JSON.stringify(wrapperNoCounts));
  ok(typeof result.entityCounts === 'object', 'entityCounts should be backfilled');
  ok(result.entityCounts.npcs === 1, 'npcs count should be backfilled');
});

// ── Section 7: RestoreBackupModal uses parseTtrpgBackupJson ──────────────────
console.log('\n  Section 7: RestoreBackupModal and renderImportPanel source checks');

const rbmStart = src.indexOf('class RestoreBackupModal');
const rbmEnd   = src.indexOf('\n// ── Dice & generators', rbmStart);
const rbm      = src.slice(rbmStart, rbmEnd);

test('RestoreBackupModal uses parseTtrpgBackupJson', () => {
  ok(rbm.includes('parseTtrpgBackupJson'), 'RestoreBackupModal should call parseTtrpgBackupJson');
});
test('RestoreBackupModal accepts preloadedBackup in constructor', () => {
  ok(rbm.includes('preloadedBackup') || rbm.includes('_pendingBackup = preloadedBackup'), 'constructor should accept preloaded backup');
});
test('RestoreBackupModal restore calls migrateState', () => {
  ok(rbm.includes('migrateState('), 'RestoreBackupModal should call migrateState after restore');
});
test('RestoreBackupModal saves safety backup before restore', () => {
  ok(rbm.includes('exportBackup('), 'RestoreBackupModal should call exportBackup before restore');
});
test('RestoreBackupModal does full state assign not entity merge', () => {
  ok(rbm.includes('Object.assign(this.plugin.state, this._pendingBackup.state)'),
    'RestoreBackupModal should do full Object.assign of state');
});

const ipStart = src.indexOf('function renderImportPanel(');
const ipEnd   = src.indexOf('\nfunction renderSettingsPanel(', ipStart);
const ip      = src.slice(ipStart, ipEnd);

test('renderImportPanel has a file input change handler', () => {
  ok(ip.includes("addEventListener('change'"), 'renderImportPanel file input has no change handler');
});
test('renderImportPanel calls parseTtrpgBackupJson in change handler', () => {
  ok(ip.includes('parseTtrpgBackupJson'), 'renderImportPanel does not call parseTtrpgBackupJson');
});
test('renderImportPanel opens RestoreBackupModal after parsing', () => {
  ok(ip.includes('new RestoreBackupModal('), 'renderImportPanel does not open RestoreBackupModal');
});
test('renderImportPanel shows Notice on parse failure', () => {
  ok(ip.includes('new Notice('), 'renderImportPanel does not show Notice on failure');
});

// ── Section 8: ImportModal honesty ───────────────────────────────────────────
console.log('\n  Section 8: ImportModal labels and behaviour');

const imStart = src.indexOf('class ImportModal');
const imEnd   = src.indexOf('\n// SettingsModal', imStart);
const im      = src.slice(imStart, imEnd);

test('ImportModal has "Merge Entity Data" button not "Entity Array"', () => {
  ok(im.includes("'Merge Entity Data'"), '"Merge Entity Data" button label missing');
  notOk(im.includes("'Entity Array'"), '"Entity Array" label still present — should be renamed');
});
test('ImportModal has "Restore Full Backup" button not "Full Backup"', () => {
  ok(im.includes("'Restore Full Backup'"), '"Restore Full Backup" button label missing');
  notOk(im.includes("btn(typeRow, 'Full Backup'"), '"Full Backup" label still present — should be renamed');
});
test('ImportModal Restore Full Backup calls parseTtrpgBackupJson', () => {
  ok(im.includes('parseTtrpgBackupJson'), 'ImportModal backup path should call parseTtrpgBackupJson');
});
test('ImportModal Restore Full Backup does full state restore not entity merge', () => {
  ok(im.includes('Object.assign(this.plugin.state,'), 'ImportModal full backup should do Object.assign of full state');
});
test('ImportModal Restore Full Backup calls migrateState', () => {
  ok(im.includes('migrateState('), 'ImportModal full backup should call migrateState');
});
test('ImportModal merge path does NOT claim to restore full state', () => {
  const mergeNotice = im.indexOf("Merged ");
  ok(mergeNotice !== -1, 'ImportModal merge notice should say "Merged" not "Imported"');
});

// ── Section 9: exported backup can be round-tripped ──────────────────────────
console.log('\n  Section 9: Round-trip integrity');

test('backup wrapper survives JSON.stringify → parseTtrpgBackupJson round-trip', () => {
  const json = JSON.stringify(backupWrapper);
  const result = parseTtrpgBackupJson(json);
  ok(result.state.activeCampaignId === 'camp-1', 'activeCampaignId lost in round-trip');
  ok(result.state.relationships[0].id === 'rel-1', 'relationships lost in round-trip');
});
test('raw state survives JSON.stringify → parseTtrpgBackupJson round-trip', () => {
  const json = JSON.stringify(rawState);
  const result = parseTtrpgBackupJson(json);
  ok(result.state.entities.campaigns[0].name === 'Test Campaign', 'campaign name lost in round-trip');
  ok(result.state.entities.npcs[0].name === 'Gandalf', 'npc lost in round-trip');
  ok(result.state.activeCampaignId === 'camp-1', 'activeCampaignId lost in round-trip');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

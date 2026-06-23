'use strict';
/**
 * Phase 261-264 — pure-function unit tests.
 * Run with: node tests/phase261.test.js
 * Covers: generate() new types, currency defaults, initiative calculation,
 *         repairAndReindex extensions, ENTITY_NAV mapping, builder field defaults.
 */
const assert = require('node:assert/strict');

// ── Re-implemented pure helpers ────────────────────────────────────────────────
function safeArr(v) { return Array.isArray(v) ? v : []; }
function modifier(score) { return Math.floor((score - 10) / 2); }
function modStr(score) { const m = modifier(score); return (m >= 0 ? '+' : '') + m; }
function profBonus(level) { return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4); }

// ── Generator tables (subset) ──────────────────────────────────────────────────
const GEN_TABLES = {
  'Plot Twist': {
    events: [
      'A trusted ally is revealed to be working for the enemy.',
      'The villain\'s true goal was not what the party assumed.',
      'An innocent person was falsely accused — the real culprit is someone the party trusts.',
    ],
  },
  'Town Event': {
    events: [
      'A merchant caravan arrives with exotic goods — and a hidden stowaway.',
      'The local constable has gone missing; rumours blame the new alchemist.',
    ],
  },
  'Trap': {
    type: ['Mechanical', 'Magic'],
    trigger: ['pressure plate', 'tripwire'],
    effect: ['releases poisoned darts (DC 15 DEX)', 'drops a portcullis behind the party'],
    tell: ['slight depression in the flagstone', 'faint scorch marks on the walls'],
  },
  'NPC Name': { first: ['Aldric', 'Brea'], last: ['Ashmore', 'Blackwood'] },
  'Quest Hook': { who: ['A merchant'], what: ['claims'], where: ['a threat'], place: ['nearby'] },
};
function generate(type, state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const t = GEN_TABLES[type];
  if (!t) return `[No table for "${type}"]`;
  switch (type) {
    case 'NPC Name': return `${rnd(t.first)} ${rnd(t.last)}`;
    case 'Quest Hook': return `${rnd(t.who)} ${rnd(t.what)} ${rnd(t.where)} ${rnd(t.place)}.`;
    case 'Plot Twist': return rnd(t.events);
    case 'Town Event': return rnd(t.events);
    case 'Trap': return `${rnd(t.type)} trap triggered by ${rnd(t.trigger)}: ${rnd(t.effect)}. Tell: ${rnd(t.tell)}.`;
    default: return '[Result]';
  }
}

// ── Currency defaults ──────────────────────────────────────────────────────────
const DEFAULT_CURRENCY = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };

// ── Initiative calculation ─────────────────────────────────────────────────────
function calcInitiative(char) {
  return char.initiative != null ? char.initiative : modStr(char.dex || 10);
}

// ── ENTITY_NAV map (subset) ────────────────────────────────────────────────────
const ENTITY_NAV = {
  campaigns:'campaigns', npcs:'npcs', factions:'world', quests:'adventure',
  characters:'pc-character', homebrew:'homebrew', encounters:'adventure',
  sessions:'sessions', secrets:'secrets', handouts:'secrets',
};

// ── repairAndReindex (re-implemented) ─────────────────────────────────────────
function repairAndReindex(state) {
  const issues = [];
  const ents = state.entities || {};
  const seenIds = new Set();
  const CAMPAIGN_OWNED = ['npcs','creatures','factions','quests','encounters','sessions','secrets'];
  for (const [key, arr] of Object.entries(ents)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((item, i) => {
      if (!item) return;
      if (!item.id) { item.id = `${key}-repaired-${i}`; issues.push(`${key}[${i}]: assigned missing id`); }
      if (seenIds.has(item.id)) { const newId = `${item.id}-dup-${i}`; issues.push(`duplicate id`); item.id = newId; }
      seenIds.add(item.id);
      const now = new Date().toISOString();
      if (!item.createdAt) { item.createdAt = now; issues.push(`${key}[${i}]: added createdAt`); }
      if (!item.updatedAt) { item.updatedAt = now; issues.push(`${key}[${i}]: added updatedAt`); }
      if (CAMPAIGN_OWNED.includes(key) && !item.campaignId && state.activeCampaignId) {
        item.campaignId = state.activeCampaignId;
        issues.push(`${key}[${i}]: assigned campaignId`);
      }
    });
  }
  return issues;
}

// ── BBEGModal default values ───────────────────────────────────────────────────
const BBEG_DEFAULTS = {
  id: 'bbeg-test', name: '', title: '', status: 'Active',
  goals: [], methods: [], resources: '', lieutenants: [], motivation: '',
  linkedNpcIds: [],
  lairLocation: '', mythicPhases: '', escalationClocks: '',
  secrets: '', finalConfrontation: '',
  linkedFactions: [], linkedQuests: [], visibility: 'dm-only', campaignId: '',
};

// ── Test runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function suite(name) { console.log(`\n${name}`); }

// ── generate() new types ───────────────────────────────────────────────────────
suite('generate() — new types (Phase 263)');
test('Plot Twist returns non-empty string', () => {
  const r = generate('Plot Twist');
  assert.ok(r && r.length > 10, 'should be a sentence');
});
test('Plot Twist contains a known event string', () => {
  const events = GEN_TABLES['Plot Twist'].events;
  const r = generate('Plot Twist');
  assert.ok(events.includes(r), 'result should be from the events array');
});
test('Town Event returns non-empty string', () => {
  const r = generate('Town Event');
  assert.ok(r && r.length > 10);
});
test('Town Event is from events table', () => {
  const events = GEN_TABLES['Town Event'].events;
  const r = generate('Town Event');
  assert.ok(events.includes(r));
});
test('Trap result contains "trap triggered by"', () => {
  const r = generate('Trap');
  assert.ok(r.includes('trap triggered by'), `got: ${r}`);
});
test('Trap result contains "Tell:"', () => {
  const r = generate('Trap');
  assert.ok(r.includes('Tell:'), `got: ${r}`);
});
test('Unknown type returns [No table for ...]', () => {
  assert.ok(generate('NonExistentType').startsWith('[No table for'));
});

// ── Currency defaults (Phase 261) ─────────────────────────────────────────────
suite('Currency defaults (Phase 261)');
test('default currency has pp', () => assert.ok('pp' in DEFAULT_CURRENCY));
test('default currency has gp', () => assert.ok('gp' in DEFAULT_CURRENCY));
test('default currency has ep', () => assert.ok('ep' in DEFAULT_CURRENCY));
test('default currency has sp', () => assert.ok('sp' in DEFAULT_CURRENCY));
test('default currency has cp', () => assert.ok('cp' in DEFAULT_CURRENCY));
test('default currency has exactly 5 coins', () => assert.equal(Object.keys(DEFAULT_CURRENCY).length, 5));
test('all default coin values are 0', () => assert.ok(Object.values(DEFAULT_CURRENCY).every(v => v === 0)));

// ── Initiative calculation (Phase 262) ────────────────────────────────────────
suite('calcInitiative() (Phase 262)');
test('uses stored initiative if set', () => {
  assert.equal(calcInitiative({ dex: 14, initiative: 5 }), 5);
});
test('calculates from DEX mod when no override (DEX 14 → +2)', () => {
  assert.equal(calcInitiative({ dex: 14 }), '+2');
});
test('calculates from DEX mod (DEX 10 → +0)', () => {
  assert.equal(calcInitiative({ dex: 10 }), '+0');
});
test('calculates from DEX mod (DEX 8 → -1)', () => {
  assert.equal(calcInitiative({ dex: 8 }), '-1');
});
test('uses +0 when DEX is missing', () => {
  assert.equal(calcInitiative({}), '+0');
});

// ── ENTITY_NAV map (Phase 262) ─────────────────────────────────────────────────
suite('ENTITY_NAV map (Phase 262)');
test('npcs → npcs section', () => assert.equal(ENTITY_NAV.npcs, 'npcs'));
test('campaigns → campaigns section', () => assert.equal(ENTITY_NAV.campaigns, 'campaigns'));
test('quests → adventure section', () => assert.equal(ENTITY_NAV.quests, 'adventure'));
test('characters → pc-character section', () => assert.equal(ENTITY_NAV.characters, 'pc-character'));
test('secrets → secrets section', () => assert.equal(ENTITY_NAV.secrets, 'secrets'));
test('handouts → secrets section', () => assert.equal(ENTITY_NAV.handouts, 'secrets'));

// ── BBEGModal defaults (Phase 263) ────────────────────────────────────────────
suite('BBEGModal defaults (Phase 263)');
test('has visibility field', () => assert.ok('visibility' in BBEG_DEFAULTS));
test('default visibility is dm-only', () => assert.equal(BBEG_DEFAULTS.visibility, 'dm-only'));
test('has motivation field', () => assert.ok('motivation' in BBEG_DEFAULTS));
test('has linkedNpcIds field', () => assert.ok('linkedNpcIds' in BBEG_DEFAULTS));
test('linkedNpcIds is array', () => assert.ok(Array.isArray(BBEG_DEFAULTS.linkedNpcIds)));

// ── repairAndReindex (extended, Phase 260) ────────────────────────────────────
suite('repairAndReindex() — extended');
test('repairs items in multiple entity types', () => {
  const state = { activeCampaignId: 'c1', entities: {
    npcs: [{ name: 'Brea' }],
    factions: [{ name: 'Shadow Hand' }],
  }};
  const issues = repairAndReindex(state);
  assert.ok(state.entities.npcs[0].id, 'NPC id assigned');
  assert.ok(state.entities.factions[0].id, 'Faction id assigned');
  assert.ok(issues.length >= 2, 'at least 2 issues reported');
});
test('assigns campaignId to factions', () => {
  const state = { activeCampaignId: 'camp-x', entities: { factions: [{ id: 'f1', name: 'Test' }] } };
  repairAndReindex(state);
  assert.equal(state.entities.factions[0].campaignId, 'camp-x');
});
test('assigns campaignId to quests', () => {
  const state = { activeCampaignId: 'camp-y', entities: { quests: [{ id: 'q1', name: 'The Big One' }] } };
  repairAndReindex(state);
  assert.equal(state.entities.quests[0].campaignId, 'camp-y');
});
test('does not assign campaignId to non-campaign-owned entities', () => {
  const state = { activeCampaignId: 'camp-z', entities: { characters: [{ id: 'ch1', name: 'Hero' }] } };
  repairAndReindex(state);
  assert.ok(!state.entities.characters[0].campaignId, 'characters should not get campaignId');
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)`);
if (failed > 0) process.exit(1);

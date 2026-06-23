'use strict';
/**
 * Phase 260 — pure-function unit tests.
 * Run with: node tests/phase260.test.js
 * Covers: HIT_DICE, SPELLCASTER_TYPE, spell slot helpers, ASI level helpers,
 *         repairAndReindex, level-up constants, complete entity generators.
 */
const assert = require('node:assert/strict');

// ── Re-implemented pure helpers ────────────────────────────────────────────────
function safeArr(v) { return Array.isArray(v) ? v : []; }

const HIT_DICE = {
  Barbarian:12, Fighter:10, Paladin:10, Ranger:10,
  Bard:8, Cleric:8, Druid:8, Monk:8, Rogue:8, Warlock:8, Artificer:8,
  Sorcerer:6, Wizard:6,
};
const SPELLCASTER_TYPE = {
  Bard:'full', Cleric:'full', Druid:'full', Sorcerer:'full', Wizard:'full',
  Paladin:'half', Ranger:'half', Artificer:'half',
  Warlock:'pact', Monk:'none', Rogue:'none', Fighter:'none', Barbarian:'none',
};
const FULL_CASTER_SLOTS = {
  1:[2,0,0,0,0,0,0,0,0], 5:[4,3,2,0,0,0,0,0,0], 9:[4,3,3,3,1,0,0,0,0],
  17:[4,3,3,3,2,1,1,1,1], 20:[4,3,3,3,3,2,2,1,1],
};
const HALF_CASTER_SLOTS = {
  1:[0,0,0,0,0,0,0,0,0], 2:[2,0,0,0,0,0,0,0,0], 5:[4,2,0,0,0,0,0,0,0],
  9:[4,3,2,0,0,0,0,0,0], 17:[4,3,3,3,1,0,0,0,0], 20:[4,3,3,3,2,0,0,0,0],
};
const ASI_LEVELS_DEFAULT = [4, 8, 12, 16, 19];
const ASI_LEVELS_FIGHTER  = [4, 6, 8, 12, 14, 16, 19];
const ASI_LEVELS_ROGUE    = [4, 8, 10, 12, 16, 19];
function getAsiLevels(cls) {
  if (cls === 'Fighter') return ASI_LEVELS_FIGHTER;
  if (cls === 'Rogue')   return ASI_LEVELS_ROGUE;
  return ASI_LEVELS_DEFAULT;
}
function getSpellSlotsForLevel(cls, level) {
  const type = SPELLCASTER_TYPE[cls] || 'none';
  if (type === 'full')  return FULL_CASTER_SLOTS[level] || FULL_CASTER_SLOTS[20];
  if (type === 'half')  return HALF_CASTER_SLOTS[level] || HALF_CASTER_SLOTS[20];
  return null;
}
function isSpellcaster(cls) { return (SPELLCASTER_TYPE[cls] || 'none') !== 'none'; }

// repairAndReindex — re-implemented from main.js logic
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

// Complete entity generators — re-implemented for testing
const GEN_TABLES = {
  'Quest Hook': { who:['A merchant'], what:['claims'], where:['a threat'], place:['nearby'] },
  'Rumour': { source:['A traveller says'], content:['something strange'], place:['in town'] },
  'Settlement Name': { prefix:['Iron','Silver'], suffix:['ford','vale'] },
  'Faction Name': { adj:['Crimson','Shadow'], noun:['Fist','Hand'] },
};
function generate(type) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const t = GEN_TABLES[type];
  if (!t) return '[unknown]';
  if (type === 'Quest Hook') return `${rnd(t.who)} ${rnd(t.what)} ${rnd(t.where)} ${rnd(t.place)}.`;
  if (type === 'Settlement Name') return rnd(t.prefix) + rnd(t.suffix);
  if (type === 'Faction Name') return `The ${rnd(t.adj)} ${rnd(t.noun)}`;
  if (type === 'Rumour') return `${rnd(t.source)} ${rnd(t.content)} ${rnd(t.place)}.`;
  return '[result]';
}
function generateCompleteNPC(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const FIRST = ['Aldric','Brea','Caelum'], LAST = ['Ashmore','Blackwood','Cresthill'];
  const ROLES = ['Merchant','Innkeeper','Guard'], ANCESTRIES = ['Human','Elf','Dwarf'];
  const PERSONALITIES = ['nervous and twitchy','gruff but kind'], QUIRKS = ['fiddles with a coin'];
  const MOTIVATIONS = ['seeking revenge','trying to repay a debt'], SECRETS = ['witnessed a crime'];
  return {
    name: `${rnd(FIRST)} ${rnd(LAST)}`, ancestry: rnd(ANCESTRIES), role: rnd(ROLES),
    occupation: rnd(ROLES), personality: `${rnd(PERSONALITIES)}. ${rnd(QUIRKS)}.`,
    motivation: rnd(MOTIVATIONS), secret: rnd(SECRETS),
    questHook: generate('Quest Hook', state),
    status: 'Active', visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}
function generateCompleteFaction(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['Criminal','Political'], GOALS = ['Accumulate wealth','Overthrow government'];
  const METHODS = ['Manipulation','Assassination'], PUBLIC_FACES = ['A merchant guild'];
  return {
    name: generate('Faction Name', state), type: rnd(TYPES),
    goals: [rnd(GOALS)], methods: [rnd(METHODS)], publicFace: rnd(PUBLIC_FACES),
    secretAgenda: rnd(GOALS), status: 'Active', visibility: 'dm-only',
    campaignId: state.activeCampaignId || '',
  };
}

// ── Test runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function suite(name) { console.log(`\n${name}`); }

// ── HIT_DICE ────────────────────────────────────────────────────────────────
suite('HIT_DICE constants');
test('Barbarian → d12', () => assert.equal(HIT_DICE.Barbarian, 12));
test('Fighter → d10', () => assert.equal(HIT_DICE.Fighter, 10));
test('Cleric → d8', () => assert.equal(HIT_DICE.Cleric, 8));
test('Wizard → d6', () => assert.equal(HIT_DICE.Wizard, 6));
test('all 13 classes defined', () => assert.equal(Object.keys(HIT_DICE).length, 13));

// ── SPELLCASTER_TYPE ──────────────────────────────────────────────────────────
suite('SPELLCASTER_TYPE / isSpellcaster()');
test('Wizard is full caster', () => assert.equal(SPELLCASTER_TYPE.Wizard, 'full'));
test('Paladin is half caster', () => assert.equal(SPELLCASTER_TYPE.Paladin, 'half'));
test('Warlock is pact caster', () => assert.equal(SPELLCASTER_TYPE.Warlock, 'pact'));
test('Fighter is not a caster', () => assert.equal(SPELLCASTER_TYPE.Fighter, 'none'));
test('isSpellcaster(Wizard) = true', () => assert.ok(isSpellcaster('Wizard')));
test('isSpellcaster(Barbarian) = false', () => assert.ok(!isSpellcaster('Barbarian')));
test('isSpellcaster(Warlock) = true', () => assert.ok(isSpellcaster('Warlock')));
test('isSpellcaster(unknown) = false', () => assert.ok(!isSpellcaster('FakeCaster')));

// ── getSpellSlotsForLevel ─────────────────────────────────────────────────────
suite('getSpellSlotsForLevel()');
test('Wizard level 1 → has 2 level-1 slots', () => {
  const slots = getSpellSlotsForLevel('Wizard', 1);
  assert.equal(slots[0], 2);
  assert.equal(slots[1], 0);
});
test('Wizard level 5 → has level-3 slots', () => {
  const slots = getSpellSlotsForLevel('Wizard', 5);
  assert.equal(slots[2], 2);
});
test('Paladin level 1 → no slots (half-caster starts at 2)', () => {
  const slots = getSpellSlotsForLevel('Paladin', 1);
  assert.ok(slots.every(s => s === 0));
});
test('Paladin level 5 → has level-1 and level-2 slots', () => {
  const slots = getSpellSlotsForLevel('Paladin', 5);
  assert.ok(slots[0] > 0 && slots[1] > 0);
});
test('Fighter → null (non-caster)', () => {
  assert.equal(getSpellSlotsForLevel('Fighter', 5), null);
});
test('Warlock → null (pact, not covered by this helper)', () => {
  assert.equal(getSpellSlotsForLevel('Warlock', 5), null);
});

// ── getAsiLevels ───────────────────────────────────────────────────────────────
suite('getAsiLevels()');
test('Fighter gets ASI at level 6', () => assert.ok(getAsiLevels('Fighter').includes(6)));
test('Fighter gets ASI at level 14', () => assert.ok(getAsiLevels('Fighter').includes(14)));
test('Rogue gets ASI at level 10', () => assert.ok(getAsiLevels('Rogue').includes(10)));
test('Cleric does not get ASI at level 6', () => assert.ok(!getAsiLevels('Cleric').includes(6)));
test('all classes get ASI at level 4', () => {
  ['Wizard','Fighter','Rogue','Barbarian','Cleric'].forEach(cls => {
    assert.ok(getAsiLevels(cls).includes(4));
  });
});
test('all classes get ASI at level 8', () => {
  ['Wizard','Fighter','Rogue','Barbarian'].forEach(cls => {
    assert.ok(getAsiLevels(cls).includes(8));
  });
});

// ── repairAndReindex ───────────────────────────────────────────────────────────
suite('repairAndReindex()');
test('assigns missing IDs', () => {
  const state = { activeCampaignId: '', entities: { npcs: [{ name: 'Brea' }] } };
  const issues = repairAndReindex(state);
  assert.ok(state.entities.npcs[0].id, 'id should be assigned');
  assert.ok(issues.some(i => i.includes('assigned missing id')));
});
test('detects duplicate IDs', () => {
  const state = { activeCampaignId: '', entities: { npcs: [{ id:'n1',name:'A' }, { id:'n1',name:'B' }] } };
  const issues = repairAndReindex(state);
  assert.ok(issues.some(i => i.includes('duplicate')));
  assert.ok(state.entities.npcs[1].id !== 'n1', 'duplicate ID should be renamed');
});
test('adds missing createdAt/updatedAt', () => {
  const state = { activeCampaignId: '', entities: { npcs: [{ id:'n1', name:'A' }] } };
  repairAndReindex(state);
  assert.ok(state.entities.npcs[0].createdAt);
  assert.ok(state.entities.npcs[0].updatedAt);
});
test('assigns campaignId to campaign-owned entities', () => {
  const state = { activeCampaignId: 'camp-1', entities: { npcs: [{ id:'n1', name:'A' }] } };
  repairAndReindex(state);
  assert.equal(state.entities.npcs[0].campaignId, 'camp-1');
});
test('does not override existing campaignId', () => {
  const state = { activeCampaignId: 'camp-1', entities: { npcs: [{ id:'n1', name:'A', campaignId:'camp-other' }] } };
  repairAndReindex(state);
  assert.equal(state.entities.npcs[0].campaignId, 'camp-other');
});
test('no issues on valid state', () => {
  const now = new Date().toISOString();
  const state = { activeCampaignId: 'c1', entities: { npcs: [{ id:'n1', name:'A', campaignId:'c1', createdAt:now, updatedAt:now }] } };
  const issues = repairAndReindex(state);
  assert.equal(issues.length, 0);
});
test('handles empty entity arrays', () => {
  const state = { activeCampaignId: '', entities: { npcs: [], factions: [] } };
  assert.doesNotThrow(() => repairAndReindex(state));
});

// ── Complete entity generators ─────────────────────────────────────────────────
suite('generateCompleteNPC()');
const state = { activeCampaignId: 'camp-1', entities: {} };
test('returns object with required fields', () => {
  const npc = generateCompleteNPC(state);
  assert.ok(npc.name, 'has name');
  assert.ok(npc.ancestry, 'has ancestry');
  assert.ok(npc.personality, 'has personality');
  assert.ok(npc.motivation, 'has motivation');
  assert.ok(npc.secret, 'has secret');
  assert.ok(npc.questHook, 'has questHook');
});
test('has visibility and status', () => {
  const npc = generateCompleteNPC(state);
  assert.equal(npc.visibility, 'dm-only');
  assert.equal(npc.status, 'Active');
});
test('assigns campaignId from state', () => {
  const npc = generateCompleteNPC(state);
  assert.equal(npc.campaignId, 'camp-1');
});
test('name is two words', () => {
  const npc = generateCompleteNPC(state);
  assert.equal(npc.name.split(' ').length, 2);
});

suite('generateCompleteFaction()');
test('returns object with required fields', () => {
  const f = generateCompleteFaction(state);
  assert.ok(f.name, 'has name');
  assert.ok(f.type, 'has type');
  assert.ok(f.goals?.length, 'has goals');
  assert.ok(f.methods?.length, 'has methods');
  assert.ok(f.publicFace, 'has publicFace');
  assert.ok(f.secretAgenda, 'has secretAgenda');
});
test('faction name starts with "The "', () => {
  const f = generateCompleteFaction(state);
  assert.ok(f.name.startsWith('The '));
});
test('assigns campaignId', () => {
  assert.equal(generateCompleteFaction(state).campaignId, 'camp-1');
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)`);
if (failed > 0) process.exit(1);

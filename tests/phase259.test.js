'use strict';
/**
 * Phase 259 — pure-function unit tests.
 * Run with: node tests/phase259.test.js
 * No test framework required — uses Node's built-in assert.
 */
const assert = require('node:assert/strict');

// ── Re-implemented pure helpers (same logic as main.js, no Obsidian globals) ───

function safeArr(v) { return Array.isArray(v) ? v : []; }

function slugify(v) {
  return String(v || 'untitled').replace(/[\\/:*?"<>|#^[\]]+/g, '').trim()
    .replace(/\s+/g, '-').slice(0, 80) || 'untitled';
}

function toTitleCase(s) {
  return String(s || '').replace(/[\\/:*?"<>|#^[\]]+/g, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100) || 'Untitled';
}

function modifier(score) { return Math.floor((Number(score || 10) - 10) / 2); }
function modStr(score) { const m = modifier(score); return (m >= 0 ? '+' : '') + m; }
function profBonus(level) { return Math.ceil(Math.max(1, Number(level || 1)) / 4) + 1; }

function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const fields = [item.name, item.title, item.summary, item.description, item.type,
    item.category, item.status, Array.isArray(item.tags) ? item.tags.join(' ') : '']
    .map(v => String(v || '')).join(' ').toLowerCase();
  return fields.includes(needle);
}

function activeCampaign(state) {
  return safeArr(state.entities.campaigns).find(c => c.id === state.activeCampaignId)
    || safeArr(state.entities.campaigns).find(c => c.status !== 'Archived')
    || null;
}

function upsert(state, key, item) {
  if (!Array.isArray(state.entities[key])) state.entities[key] = [];
  const now = new Date().toISOString();
  if (!item.createdAt) item.createdAt = now;
  item.updatedAt = now;
  if (!item.campaignId && state.activeCampaignId) item.campaignId = state.activeCampaignId;
  const i = state.entities[key].findIndex(x => x.id === item.id);
  if (i >= 0) state.entities[key][i] = item; else state.entities[key].unshift(item);
}

function removeItem(state, key, id) {
  if (Array.isArray(state.entities[key]))
    state.entities[key] = state.entities[key].filter(x => x.id !== id);
}

function renderTag(text) {
  return String(text || '').replace(/\{@(\w+)\s+([^}]*)\}/g, (_, tag, content) => {
    const main = content.split('|')[0].trim();
    switch (tag) {
      case 'dice': case 'damage': case 'd20': case 'hit': return main;
      case 'dc': return 'DC ' + main;
      case 'chance': return main + '%';
      case 'variantrule': return main.split('|')[0].trim();
      default: return main.replace(/\b\w/g, c => c.toUpperCase());
    }
  });
}

// Minimal GEN_TABLES for generate() testing
const GEN_TABLES = {
  'NPC Name':       { first: ['Arin', 'Bela', 'Cade'], last: ['Stone', 'Moor', 'Vale'] },
  'Settlement Name':{ prefix: ['Iron', 'Silver', 'Gold'], suffix: ['ford', 'haven', 'keep'] },
  'Tavern Name':    { adj: ['Golden', 'Silver', 'Iron'], noun: ['Flagon', 'Hound', 'Dragon'] },
  'Quest Hook':     { who: ['A local farmer'], what: ['claims to have seen'], where: ['a strange light'], place: ['near the old mill'] },
  'Rumour':         { source: ['A traveller says'], content: ['the old wizard is dead'], place: ['in Ironford'] },
  'Loot':           { type: ['A chest containing'], contents: ['gold coins and a gemstone'] },
  'Weather':        { condition: ['Heavy rain'], detail: ['with strong winds from the north'] },
  'Travel Event':   { events: ['A merchant cart is stuck in the mud', 'Distant howling in the hills'] },
  'Faction Name':   { adj: ['Crimson', 'Shadow', 'Iron'], noun: ['Fist', 'Hand', 'Veil'] },
  'Wild Magic Surge':{ events: ['You teleport 10 feet in a random direction', 'Flowers bloom wherever you step'] },
  'Dungeon Room':   { purpose: ['storage'], feature: ['with collapsed shelving'] },
  'NPC Trait':      { personality: ['gruff but kind'], quirk: ['hums tunelessly when thinking'] },
};

function generate(type, state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const t = GEN_TABLES[type];
  if (!t) return `[No table for "${type}"]`;
  switch (type) {
    case 'NPC Name': return `${rnd(t.first)} ${rnd(t.last)}`;
    case 'Settlement Name': return rnd(t.prefix) + rnd(t.suffix);
    case 'Tavern Name': return `The ${rnd(t.adj)} ${rnd(t.noun)}`;
    case 'Quest Hook': return `${rnd(t.who)} ${rnd(t.what)} ${rnd(t.where)} ${rnd(t.place)}.`;
    case 'Rumour': return `${rnd(t.source)} ${rnd(t.content)} ${rnd(t.place)}.`;
    case 'Loot': return `${rnd(t.type)} ${rnd(t.contents)}.`;
    case 'Weather': return `${rnd(t.condition)} ${rnd(t.detail)}.`;
    case 'Travel Event': return rnd(t.events) + '.';
    case 'Faction Name': return `The ${rnd(t.adj)} ${rnd(t.noun)}`;
    case 'Wild Magic Surge': return rnd(t.events);
    case 'Dungeon Room': return `A ${rnd(t.purpose)} ${rnd(t.feature)}.`;
    case 'NPC Trait': return `${rnd(t.personality)}. ${rnd(t.quirk)}.`;
    default: return '[Result]';
  }
}

// Minimal HYBRID_TRAIT_LIBRARY + ANCESTRY_DATA for computeHybridBalance tests
const HYBRID_TRAIT_LIBRARY = [
  { id: 'darkvision-60',      tier: 1 },
  { id: 'darkvision-120',     tier: 2 },
  { id: 'damage-resistance',  tier: 2 },
  { id: 'dual-resistance',    tier: 3 },
  { id: 'poison-resilience',  tier: 1 },
  { id: 'minor-cantrip',      tier: 1 },
  { id: 'innate-spell',       tier: 2 },
  { id: 'moderate-spellcasting', tier: 3 },
  { id: 'flight-30',          tier: 4 },
  { id: 'lucky',              tier: 1 },
  { id: 'keen-senses',        tier: 1 },
];
const ANCESTRY_DATA = {
  Elf:  { darkvision: 60 },
  Dwarf:{ darkvision: 60 },
  Human:{ darkvision: 0  },
  Drow: { darkvision: 120 },
};

function computeHybridBalance(values) {
  const traitIds = safeArr(values.traits);
  const traitObjs = traitIds.map(id => HYBRID_TRAIT_LIBRARY.find(t => t.id === id)).filter(Boolean);
  const score = traitObjs.reduce((s, t) => s + (t.tier || 0), 0);
  let rating;
  if (score <= 3) rating = 'Underpowered';
  else if (score <= 6) rating = 'Balanced';
  else if (score <= 8) rating = 'Strong';
  else rating = 'Overpowered';
  const warnings = [];
  const dvTraits = traitObjs.filter(t => t.id === 'darkvision-60' || t.id === 'darkvision-120');
  const parentDv = [values.dominantAncestry, values.recessiveAncestry, values.thirdInfluence]
    .filter(Boolean).some(a => (ANCESTRY_DATA[a] || {}).darkvision > 0);
  if (dvTraits.length > 1) warnings.push('Multiple darkvision traits selected (redundant).');
  if (dvTraits.length && parentDv) warnings.push('Darkvision trait selected but a parent ancestry already grants darkvision — consider removing.');
  const resistTraits = traitObjs.filter(t => ['damage-resistance','dual-resistance','poison-resilience'].includes(t.id));
  if (resistTraits.length > 1) warnings.push('Multiple damage resistance traits selected.');
  const spellTraits = traitObjs.filter(t => ['minor-cantrip','innate-spell','moderate-spellcasting'].includes(t.id));
  if (spellTraits.length > 1) warnings.push('Multiple innate spellcasting traits selected.');
  if (traitIds.includes('flight-30')) warnings.push('Flight is a very strong trait — recommend DM approval before level 5.');
  if (values.creatureType && values.creatureType !== 'Humanoid') warnings.push(`Non-humanoid type (${values.creatureType}) may affect spells and class features.`);
  const asiTotal = Object.values(values.asi || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
  if (asiTotal > 3 && !values.asiOverride) warnings.push(`ASI total is +${asiTotal} — exceeds +3 without DM override.`);
  return { score, rating, warnings };
}

// ── Test runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function suite(name) { console.log(`\n${name}`); }

// ── toTitleCase ────────────────────────────────────────────────────────────────
suite('toTitleCase()');
test('capitalises first letter of each word', () => {
  assert.equal(toTitleCase('my campaign'), 'My Campaign');
});
test('strips forbidden path characters', () => {
  const result = toTitleCase('bad:name/here');
  assert.ok(!result.includes(':') && !result.includes('/'));
});
test('handles empty string → Untitled', () => {
  assert.equal(toTitleCase(''), 'Untitled');
});
test('handles null/undefined → Untitled', () => {
  assert.equal(toTitleCase(null), 'Untitled');
  assert.equal(toTitleCase(undefined), 'Untitled');
});
test('caps output at 100 characters', () => {
  const long = 'a '.repeat(60);
  assert.ok(toTitleCase(long).length <= 100);
});
test('handles already Title Case input', () => {
  assert.equal(toTitleCase('The Dark Campaign'), 'The Dark Campaign');
});

// ── renderTag ──────────────────────────────────────────────────────────────────
suite('renderTag()');
test('strips @dice tag → plain formula', () => {
  assert.equal(renderTag('{@dice 2d6+3}'), '2d6+3');
});
test('strips @damage tag → plain formula', () => {
  assert.equal(renderTag('{@damage 1d8}'), '1d8');
});
test('@dc tag prefixes "DC "', () => {
  assert.equal(renderTag('{@dc 15}'), 'DC 15');
});
test('@chance tag appends "%"', () => {
  assert.equal(renderTag('{@chance 50}'), '50%');
});
test('@spell tag title-cases the spell name', () => {
  assert.equal(renderTag('{@spell fireball}'), 'Fireball');
});
test('@variantrule strips pipe suffix', () => {
  assert.equal(renderTag('{@variantrule Long Rest|XPHB}'), 'Long Rest');
});
test('passes plain text through unchanged', () => {
  assert.equal(renderTag('No tags here.'), 'No tags here.');
});
test('handles empty string', () => {
  assert.equal(renderTag(''), '');
});
test('handles multiple tags in one string', () => {
  const result = renderTag('Deal {@dice 1d6} {@damage 1d4} damage.');
  assert.equal(result, 'Deal 1d6 1d4 damage.');
});
test('@hit tag returns plain modifier', () => {
  assert.equal(renderTag('{@hit +5}'), '+5');
});

// ── modifier / modStr / profBonus ──────────────────────────────────────────────
suite('modifier() / modStr() / profBonus()');
test('modifier(10) = 0', () => { assert.equal(modifier(10), 0); });
test('modifier(8) = -1', () => { assert.equal(modifier(8), -1); });
test('modifier(20) = +5', () => { assert.equal(modifier(20), 5); });
test('modifier(1) = -5', () => { assert.equal(modifier(1), -5); });
test('modStr(10) = "+0"', () => { assert.equal(modStr(10), '+0'); });
test('modStr(8) = "-1"', () => { assert.equal(modStr(8), '-1'); });
test('modStr(20) = "+5"', () => { assert.equal(modStr(20), '+5'); });
test('profBonus(1) = 2', () => { assert.equal(profBonus(1), 2); });
test('profBonus(4) = 2', () => { assert.equal(profBonus(4), 2); });
test('profBonus(5) = 3', () => { assert.equal(profBonus(5), 3); });
test('profBonus(9) = 4', () => { assert.equal(profBonus(9), 4); });
test('profBonus(17) = 6', () => { assert.equal(profBonus(17), 6); });

// ── slugify ────────────────────────────────────────────────────────────────────
suite('slugify()');
test('replaces spaces with hyphens', () => {
  assert.equal(slugify('my campaign'), 'my-campaign');
});
test('strips forbidden characters', () => {
  assert.ok(!slugify('foo:bar/baz').includes(':'));
});
test('empty → "untitled"', () => {
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify(null), 'untitled');
});
test('caps at 80 characters', () => {
  assert.ok(slugify('a '.repeat(50)).length <= 80);
});

// ── safeArr ────────────────────────────────────────────────────────────────────
suite('safeArr()');
test('array input returned as-is', () => {
  const a = [1, 2, 3];
  assert.equal(safeArr(a), a);
});
test('null → []', () => { assert.deepEqual(safeArr(null), []); });
test('undefined → []', () => { assert.deepEqual(safeArr(undefined), []); });
test('object → []', () => { assert.deepEqual(safeArr({ a: 1 }), []); });
test('string → []', () => { assert.deepEqual(safeArr('hello'), []); });

// ── matchesSearch ──────────────────────────────────────────────────────────────
suite('matchesSearch()');
test('empty query matches everything', () => {
  assert.ok(matchesSearch({ name: 'anything' }, ''));
  assert.ok(matchesSearch({ name: 'anything' }, null));
});
test('matches by name (case-insensitive)', () => {
  assert.ok(matchesSearch({ name: 'Ironforge' }, 'iron'));
  assert.ok(matchesSearch({ name: 'Ironforge' }, 'IRON'));
});
test('matches by type', () => {
  assert.ok(matchesSearch({ name: 'X', type: 'Dragon' }, 'dragon'));
});
test('matches by tags', () => {
  assert.ok(matchesSearch({ name: 'X', tags: ['undead', 'boss'] }, 'undead'));
});
test('no match returns false', () => {
  assert.ok(!matchesSearch({ name: 'Goblin' }, 'dragon'));
});
test('matches by status', () => {
  assert.ok(matchesSearch({ name: 'Q', status: 'Active' }, 'active'));
});

// ── activeCampaign ─────────────────────────────────────────────────────────────
suite('activeCampaign()');
test('returns campaign matching activeCampaignId', () => {
  const state = { activeCampaignId: 'c1', entities: { campaigns: [
    { id: 'c1', name: 'Alpha', status: 'Active' },
    { id: 'c2', name: 'Beta',  status: 'Active' },
  ] } };
  assert.equal(activeCampaign(state).id, 'c1');
});
test('falls back to first non-Archived campaign', () => {
  const state = { activeCampaignId: '', entities: { campaigns: [
    { id: 'c1', name: 'Old', status: 'Archived' },
    { id: 'c2', name: 'New', status: 'Active' },
  ] } };
  assert.equal(activeCampaign(state).id, 'c2');
});
test('returns null when no campaigns', () => {
  assert.equal(activeCampaign({ activeCampaignId: '', entities: { campaigns: [] } }), null);
});
test('returns null when all campaigns archived', () => {
  const state = { activeCampaignId: '', entities: { campaigns: [
    { id: 'c1', status: 'Archived' },
  ] } };
  assert.equal(activeCampaign(state), null);
});

// ── upsert / removeItem ────────────────────────────────────────────────────────
suite('upsert() / removeItem()');
test('inserts new item at front of array', () => {
  const state = { activeCampaignId: '', entities: { npcs: [{ id: 'n1', name: 'Old' }] } };
  upsert(state, 'npcs', { id: 'n2', name: 'New' });
  assert.equal(state.entities.npcs[0].id, 'n2');
  assert.equal(state.entities.npcs.length, 2);
});
test('updates existing item in place', () => {
  const state = { activeCampaignId: '', entities: { npcs: [{ id: 'n1', name: 'Old' }] } };
  upsert(state, 'npcs', { id: 'n1', name: 'Updated' });
  assert.equal(state.entities.npcs.length, 1);
  assert.equal(state.entities.npcs[0].name, 'Updated');
});
test('sets updatedAt timestamp', () => {
  const state = { activeCampaignId: '', entities: { npcs: [] } };
  const item = { id: 'n1', name: 'Test' };
  upsert(state, 'npcs', item);
  assert.ok(item.updatedAt);
});
test('auto-assigns campaignId from state when missing', () => {
  const state = { activeCampaignId: 'camp-1', entities: { npcs: [] } };
  const item = { id: 'n1', name: 'NPC' };
  upsert(state, 'npcs', item);
  assert.equal(item.campaignId, 'camp-1');
});
test('does not overwrite existing campaignId', () => {
  const state = { activeCampaignId: 'camp-1', entities: { npcs: [] } };
  const item = { id: 'n1', name: 'NPC', campaignId: 'camp-other' };
  upsert(state, 'npcs', item);
  assert.equal(item.campaignId, 'camp-other');
});
test('removeItem deletes by id', () => {
  const state = { entities: { npcs: [{ id: 'n1' }, { id: 'n2' }] } };
  removeItem(state, 'npcs', 'n1');
  assert.equal(state.entities.npcs.length, 1);
  assert.equal(state.entities.npcs[0].id, 'n2');
});
test('removeItem is a no-op for unknown id', () => {
  const state = { entities: { npcs: [{ id: 'n1' }] } };
  removeItem(state, 'npcs', 'zzz');
  assert.equal(state.entities.npcs.length, 1);
});

// ── generate() ────────────────────────────────────────────────────────────────
suite('generate()');
const emptyState = { entities: {} };
test('NPC Name returns two-word string', () => {
  const r = generate('NPC Name', emptyState);
  assert.ok(r.split(' ').length === 2, `Expected two words, got: "${r}"`);
});
test('Settlement Name returns non-empty string', () => {
  assert.ok(generate('Settlement Name', emptyState).length > 0);
});
test('Tavern Name starts with "The "', () => {
  assert.ok(generate('Tavern Name', emptyState).startsWith('The '));
});
test('Quest Hook ends with "."', () => {
  assert.ok(generate('Quest Hook', emptyState).endsWith('.'));
});
test('Faction Name starts with "The "', () => {
  assert.ok(generate('Faction Name', emptyState).startsWith('The '));
});
test('Wild Magic Surge returns non-empty string', () => {
  assert.ok(generate('Wild Magic Surge', emptyState).length > 0);
});
test('Dungeon Room starts with "A "', () => {
  assert.ok(generate('Dungeon Room', emptyState).startsWith('A '));
});
test('NPC Trait contains ". "', () => {
  assert.ok(generate('NPC Trait', emptyState).includes('. '));
});
test('unknown type returns bracketed error', () => {
  assert.ok(generate('Gobbledygook', emptyState).startsWith('['));
});
test('generates different results across runs', () => {
  const results = new Set(Array.from({ length: 20 }, () => generate('NPC Name', emptyState)));
  assert.ok(results.size > 1, 'Expected randomness across 20 calls');
});

// ── computeHybridBalance() ────────────────────────────────────────────────────
suite('computeHybridBalance()');
test('no traits → score 0, Underpowered', () => {
  const r = computeHybridBalance({ traits: [], asi: {} });
  assert.equal(r.score, 0);
  assert.equal(r.rating, 'Underpowered');
  assert.equal(r.warnings.length, 0);
});
test('two tier-1 traits + one tier-2 → score 4, Balanced', () => {
  const r = computeHybridBalance({ traits: ['lucky','keen-senses','damage-resistance'], asi: {} });
  assert.equal(r.score, 4);
  assert.equal(r.rating, 'Balanced');
});
test('score 7 → Strong', () => {
  // flight-30 (tier 4) + damage-resistance (tier 2) + lucky (tier 1) = 7
  const r = computeHybridBalance({ traits: ['flight-30','damage-resistance','lucky'], asi: {} });
  assert.equal(r.rating, 'Strong');
});
test('score > 8 → Overpowered', () => {
  const r = computeHybridBalance({ traits: ['flight-30','moderate-spellcasting','dual-resistance'], asi: {} });
  assert.equal(r.rating, 'Overpowered');
});
test('flight warning fires', () => {
  const r = computeHybridBalance({ traits: ['flight-30'], asi: {} });
  assert.ok(r.warnings.some(w => w.includes('Flight')));
});
test('duplicate darkvision warning', () => {
  const r = computeHybridBalance({ traits: ['darkvision-60','darkvision-120'], asi: {} });
  assert.ok(r.warnings.some(w => w.includes('Multiple darkvision')));
});
test('darkvision + parent ancestry already has darkvision → warning', () => {
  const r = computeHybridBalance({ traits: ['darkvision-60'], dominantAncestry: 'Elf', asi: {} });
  assert.ok(r.warnings.some(w => w.includes('parent ancestry already grants darkvision')));
});
test('darkvision + Human parent (no darkvision) → no warning', () => {
  const r = computeHybridBalance({ traits: ['darkvision-60'], dominantAncestry: 'Human', asi: {} });
  assert.ok(!r.warnings.some(w => w.includes('parent ancestry already grants darkvision')));
});
test('multiple resistance traits warning', () => {
  const r = computeHybridBalance({ traits: ['damage-resistance','poison-resilience'], asi: {} });
  assert.ok(r.warnings.some(w => w.includes('damage resistance')));
});
test('multiple spellcasting traits warning', () => {
  const r = computeHybridBalance({ traits: ['minor-cantrip','innate-spell'], asi: {} });
  assert.ok(r.warnings.some(w => w.includes('spellcasting')));
});
test('non-humanoid creature type warning', () => {
  const r = computeHybridBalance({ traits: [], creatureType: 'Undead', asi: {} });
  assert.ok(r.warnings.some(w => w.includes('Non-humanoid')));
});
test('humanoid type → no creature type warning', () => {
  const r = computeHybridBalance({ traits: [], creatureType: 'Humanoid', asi: {} });
  assert.ok(!r.warnings.some(w => w.includes('Non-humanoid')));
});
test('ASI total > 3 without override → warning', () => {
  const r = computeHybridBalance({ traits: [], asi: { str: 2, dex: 2 } });
  assert.ok(r.warnings.some(w => w.includes('ASI total')));
});
test('ASI total > 3 with override → no ASI warning', () => {
  const r = computeHybridBalance({ traits: [], asi: { str: 2, dex: 2 }, asiOverride: true });
  assert.ok(!r.warnings.some(w => w.includes('ASI total')));
});
test('ASI total ≤ 3 → no ASI warning', () => {
  const r = computeHybridBalance({ traits: [], asi: { str: 1, dex: 1 } });
  assert.ok(!r.warnings.some(w => w.includes('ASI total')));
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)`);
if (failed > 0) process.exit(1);

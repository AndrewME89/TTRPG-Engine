'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS', name); passed++; }
  catch(e) { console.log('  FAIL', name, '\n       ', e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertContains(str, msg) { assert(src.includes(str), `Expected source to contain: ${str}`); }

// ── STEP 1: OPTION_BANKS expansions ──────────────────────────────────────────
test('OPTION_BANKS has pronouns bank', () => assertContains("pronouns:     ['he/him'"));
test('OPTION_BANKS has npcRoles with new entries', () => assertContains("'Rival','Enemy','Mentor','Patron'"));
test('OPTION_BANKS has occupations expanded', () => assertContains("'Farmer','Merchant','Blacksmith','Guard'"));
test('OPTION_BANKS ideals expanded', () => assertContains("'Justice','Freedom','Power','Knowledge','Faith'"));
test('OPTION_BANKS bonds expanded', () => assertContains("'A family legacy','A sacred oath','A homeland'"));
test('OPTION_BANKS flaws expanded', () => assertContains("'Vengeful','Paranoid','Gullible','Cruel'"));
test('OPTION_BANKS has creatureSenses', () => assertContains("creatureSenses:"));
test('OPTION_BANKS creatureSenses includes Darkvision', () => assertContains("'Darkvision','Blindsight'"));
test('OPTION_BANKS has creatureTraits', () => assertContains("creatureTraits:"));
test('OPTION_BANKS creatureTraits includes Pack Tactics', () => assertContains("'Pack Tactics'"));
test('OPTION_BANKS has creatureActions', () => assertContains("creatureActions:"));
test('OPTION_BANKS creatureActions includes Multiattack', () => assertContains("'Multiattack'"));
test('OPTION_BANKS has creatureReactions', () => assertContains("creatureReactions:"));
test('OPTION_BANKS has legendaryActions', () => assertContains("legendaryActions:"));
test('OPTION_BANKS has lairActions', () => assertContains("lairActions:"));
test('OPTION_BANKS lairActions includes Summon Minions', () => assertContains("'Summon Minions'"));
test('OPTION_BANKS has bbegTitles', () => assertContains("bbegTitles:"));
test('OPTION_BANKS bbegTitles includes The Betrayer', () => assertContains("'The Betrayer'"));
test('OPTION_BANKS has leadershipStructure', () => assertContains("leadershipStructure:"));
test('OPTION_BANKS leadershipStructure includes Council', () => assertContains("'Council','Inner Circle'"));
test('OPTION_BANKS has powerDynamic', () => assertContains("powerDynamic:"));
test('OPTION_BANKS has trustLevel', () => assertContains("trustLevel:"));
test('OPTION_BANKS has fearLeverage', () => assertContains("fearLeverage:"));
test('OPTION_BANKS fearLeverage includes Blackmail', () => assertContains("'Blackmail','Debt'"));
test('OPTION_BANKS factionGoals expanded', () => assertContains("'Knowledge Acquisition'"));
test('OPTION_BANKS factionMethods expanded', () => assertContains("'Sabotage','Recruitment'"));
test('OPTION_BANKS factionResources expanded', () => assertContains("'Contraband','Ships'"));

// ── STEP 2: NPC fields ────────────────────────────────────────────────────────
test('NPCModal pronouns uses chipField with bank pronouns', () => assertContains("bank: 'pronouns'"));
test('NPCModal role uses chipField with bank npcRoles', () => assertContains("bank: 'npcRoles'"));
test('NPCModal occupation uses chipField with bank occupations', () => assertContains("bank: 'occupations'"));
test('NPCModal has raceId entityRef for hybridAncestries', () => assertContains("Ancestry / Race (linked)"));
test('NPCModal ideals uses bank ideals', () => assertContains("bank: 'ideals'"));
test('NPCModal bonds uses bank bonds', () => assertContains("bank: 'bonds'"));
test('NPCModal flaws uses bank flaws', () => assertContains("bank: 'flaws'"));
test('NPCModal has relationshipIds entityMultiRef', () => assertContains("Relationships (linked)"));
test('NPCModal removes campaignId from primary', () => {
  // campaignId should not appear between NPCModal h2 and its first section
  const npcIdx = src.indexOf('class NPCModal extends Modal');
  const snip = src.substring(npcIdx, npcIdx + 1200);
  assert(!snip.includes("addCampaignPicker"), 'campaignId picker should be removed from NPCModal primary');
});

// ── STEP 3: Creature fields ───────────────────────────────────────────────────
test('CreatureModal senses uses chipField with bank creatureSenses', () => assertContains("bank: 'creatureSenses'"));
test('CreatureModal traits uses chipField with bank creatureTraits', () => assertContains("bank: 'creatureTraits'"));
test('CreatureModal actions uses chipField with bank creatureActions', () => assertContains("bank: 'creatureActions'"));
test('CreatureModal reactions uses chipField with bank creatureReactions', () => assertContains("bank: 'creatureReactions'"));
test('CreatureModal legendaryActions uses bank', () => assertContains("bank: 'legendaryActions'"));
test('CreatureModal lairActions uses bank', () => assertContains("bank: 'lairActions'"));
test('CreatureModal removes campaignId from primary', () => {
  const idx = src.indexOf('class CreatureModal extends Modal');
  const snip = src.substring(idx, idx + 500);
  assert(!snip.includes("addCampaignPicker"), 'campaignId picker should be removed from CreatureModal primary');
});

// ── STEP 4: BBEG fields ───────────────────────────────────────────────────────
test('BBEGModal title uses chipField with bank bbegTitles', () => assertContains("bank: 'bbegTitles'"));
test('BBEGModal resources uses chipField with bank factionResources', () => {
  const idx = src.indexOf('class BBEGModal extends Modal');
  const snip = src.substring(idx, idx + 3000);
  assert(snip.includes("bank: 'factionResources'"), 'BBEG resources should use factionResources bank');
});
test('BBEGModal has lieutenantIds entityMultiRef', () => assertContains("Lieutenants (linked NPCs)"));
test('BBEGModal has lairLocationId entityRef', () => assertContains("Lair Location (linked)"));
test('BBEGModal has linkedFactionIds entityMultiRef', () => assertContains("Linked Factions"));
test('BBEGModal has linkedQuestIds entityMultiRef', () => assertContains("Linked Quests"));
test('BBEGModal removes campaignId from primary', () => {
  const idx = src.indexOf('class BBEGModal extends Modal');
  const snip = src.substring(idx, idx + 500);
  assert(!snip.includes("addCampaignPicker"), 'campaignId picker should be removed from BBEGModal primary');
});

// ── STEP 5: Faction fields ────────────────────────────────────────────────────
test('FactionModal has leadershipStructure chip', () => assertContains("bank: 'leadershipStructure'"));
test('FactionModal has leaderNpcIds multi', () => assertContains("Leaders / Key Staff (NPCs)"));
test('FactionModal territoryIds linked to regions', () => {
  // Phase E renamed to 'Territories (Regions)' — check either label
  const hasLinked = src.includes("Territory (linked)") || src.includes("Territories (Regions)");
  assert(hasLinked, 'Should have territory linked to regions picker');
  const modal = src.slice(src.indexOf('class FactionModal'), src.indexOf('// QuestModal'));
  assert(modal.includes("'regions'"), 'Territory should link to regions');
});
test('FactionModal goals use bank factionGoals', () => {
  const idx = src.indexOf('class FactionModal extends Modal');
  const snip = src.substring(idx, idx + 3000);
  assert(snip.includes("bank: 'factionGoals'"), 'Faction goals should use factionGoals bank');
});
test('FactionModal removes campaignId from primary', () => {
  const idx = src.indexOf('class FactionModal extends Modal');
  const snip = src.substring(idx, idx + 500);
  assert(!snip.includes("addCampaignPicker"), 'campaignId picker should be removed from FactionModal primary');
});

// ── STEP 6: Noble Families migration ─────────────────────────────────────────
test('migrateNobleFamiliesToFactions function exists', () => assertContains('function migrateNobleFamiliesToFactions'));
test('migration creates faction with type Noble House', () => assertContains("type: 'Noble House'"));
test('migration marks noble as migratedToFaction', () => assertContains('migratedToFaction = true'));
test('migration stores migratedFactionId', () => assertContains('migratedFactionId = newFaction.id'));
test('renderCastPowers calls migration', () => {
  const idx = src.indexOf('function renderCastPowers');
  const snip = src.substring(idx, idx + 200);
  assert(snip.includes('migrateNobleFamiliesToFactions'), 'renderCastPowers should call migration');
});
test('nobleFamilies ENTITY_FIELD_SCHEMAS has motto field', () => {
  const idx = src.indexOf("// Noble Families");
  const snip = src.substring(idx, idx + 600);
  assert(snip.includes("'motto'"), 'nobleFamilies schema should have motto');
});
test('nobleFamilies ENTITY_FIELD_SCHEMAS has debts field', () => {
  const idx = src.indexOf("// Noble Families");
  const snip = src.substring(idx, idx + 600);
  assert(snip.includes("'debts'"), 'nobleFamilies schema should have debts');
});

// ── STEP 7: Relationship Matrix ───────────────────────────────────────────────
test('RelationshipModal has powerDynamic chip', () => assertContains("Power Dynamic / Influence"));
test('RelationshipModal powerDynamic uses bank', () => {
  const idx = src.indexOf('class RelationshipModal extends Modal');
  const snip = src.substring(idx, idx + 2000);
  assert(snip.includes("bank: 'powerDynamic'"), 'powerDynamic should use bank');
});
test('RelationshipModal has trustLevel select', () => assertContains("Trust Level"));
test('RelationshipModal trustLevel includes Absolute trust', () => assertContains("'Absolute trust'"));
test('RelationshipModal has fearLeverage chip', () => {
  const idx = src.indexOf('class RelationshipModal extends Modal');
  const snip = src.substring(idx, idx + 3000);
  assert(snip.includes("bank: 'fearLeverage'"), 'fearLeverage should use bank');
});
test('RelationshipModal uses canonical From typed entity picker', () => {
  const idx = src.indexOf('class RelationshipModal extends Modal');
  const snip = src.substring(idx, idx + 1400);
  assert(snip.includes("addTypedEntityPicker(contentEl, 'From'"), 'RelationshipModal should render canonical From picker');
});
test('RelationshipModal uses canonical To typed entity picker', () => {
  const idx = src.indexOf('class RelationshipModal extends Modal');
  const snip = src.substring(idx, idx + 1400);
  assert(snip.includes("addTypedEntityPicker(contentEl, 'To'"), 'RelationshipModal should render canonical To picker');
});
test('RelationshipModal no longer renders duplicate legacy Entity A/B linked pickers', () => {
  const idx = src.indexOf('class RelationshipModal extends Modal');
  const snip = src.substring(idx, idx + 1600);
  assert(!snip.includes('Entity A (linked NPC)'), 'Legacy Entity A picker should not render');
  assert(!snip.includes('Entity B (linked NPC)'), 'Legacy Entity B picker should not render');
});

// ── STEP 8: Faction Reputation ────────────────────────────────────────────────
test('reputationFields factionId uses entityRef', () => {
  const idx = src.indexOf("const reputationFields");
  const snip = src.substring(idx, idx + 400);
  assert(snip.includes("entityRef") && snip.includes("'factions'"), 'factionId should be entityRef to factions');
});

// ── STEP 9: Hybrid Ancestry ───────────────────────────────────────────────────
test('hybridAncestries schema has dominantCultureId entityRef', () => assertContains("dominantCultureId"));
test('hybridAncestries schema has recessiveCultureId entityRef', () => assertContains("recessiveCultureId"));
test('hybridAncestries schema has raisedInId entityRef', () => assertContains("raisedInId"));
test('HybridAncestryModal trait cards show selected state', () => assertContains("te-selected"));
test('HybridAncestryModal selected traits get outline style', () => assertContains("var(--interactive-accent)"));
test('HybridAncestryModal toggle updates te-selected class', () => {
  const idx = src.indexOf("classList.toggle('is-active'");
  const snip = src.substring(idx, idx + 200);
  assert(snip.includes("te-selected"), 'toggle should update te-selected');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

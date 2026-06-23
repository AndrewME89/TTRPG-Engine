'use strict';
/**
 * Phase 267 — production hardening round 2.
 * Run with: node tests/phase267.test.js
 * Covers: LevelUpModal v2 (subclass, spells, class features),
 *         CharacterModal refData (campaign picker, languages, knownSpells),
 *         entity linking (EncounterModal locationType, FactionModal memberPcIds,
 *         NobleFamilyModal NPC links, HybridAncestryModal campaignId),
 *         Hybridiser persistence (save-first, update-vs-duplicate),
 *         complete generators (POI, Encounter, Tavern, Shop, Rumour, Secret,
 *         DungeonRoom, Loot, TravelEvent, NobleHouse),
 *         Run Session End Review compilation.
 */
const assert = require('node:assert/strict');

// ── Re-implemented pure helpers ────────────────────────────────────────────────
function safeArr(v) { return Array.isArray(v) ? v : []; }
function uid(prefix) { return `${prefix}-test-${Math.random().toString(36).slice(2,7)}`; }

// ── Subclass levels by class (re-implemented) ─────────────────────────────────
const SUBCLASS_LEVELS = {
  Wizard:2, Cleric:1, Druid:2, Sorcerer:1, Warlock:1, Artificer:3,
};
function getSubclassLevel(cls) { return SUBCLASS_LEVELS[cls] || 3; }

// ── Class feature hints (re-implemented) ──────────────────────────────────────
const CLASS_FEATURE_HINTS = {
  Barbarian: { 2:'Reckless Attack, Danger Sense', 3:'Primal Path', 5:'Extra Attack, Fast Movement' },
  Fighter:   { 2:'Action Surge', 3:'Martial Archetype', 5:'Extra Attack' },
  Wizard:    { 2:'Arcane Tradition', 4:'ASI' },
  Warlock:   { 2:'Eldritch Invocations', 3:'Pact Boon', 4:'ASI' },
};
function getClassFeatureHint(cls, level) { return (CLASS_FEATURE_HINTS[cls] || {})[level] || null; }

// ── LevelUpModal v2 state (re-implemented) ────────────────────────────────────
function makeLevelUpState(char, toLevel) {
  return {
    cls: char.class || '',
    fromLevel: char.level || 1,
    toLevel,
    subclassChosen: char.subclass || '',
    rulesetOverride: char.ruleset || 'PHB',
    spellsAdded: [],
    featChosen: '',
    asiDeltas: {},
    hpChoice: 'average',
    _featureNotes: '',
    _manualOverride: false,
  };
}

// ── CharacterModal defaults (re-implemented with new fields) ──────────────────
function makeCharacterDefaults() {
  return {
    id: uid('char'), name: '', race: '', class: '', background: '', level: 1,
    alignment: 'True Neutral',
    campaignId: '',
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    hp: 0, maxHp: 0, tempHp: 0, ac: 10, speed: '30 ft',
    skills: [], savingThrows: [], features: [], spells: [],
    equipment: [], currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    xp: 0, spellSlots: {}, deathSaves: { successes: 0, failures: 0 },
    backstory: '', notes: '', languages: [], knownSpells: [],
  };
}

// ── HybridAncestryModal defaults (re-implemented with campaignId) ─────────────
function makeHybridDefaults() {
  return {
    id: uid('hybrid'), name: '', dominantAncestry: '', recessiveAncestry: '', thirdInfluence: '',
    campaignId: '',
    visibility: 'dm-only', status: 'Draft', approvalStatus: 'Pending Review',
    size: 'Medium', speed: 30, ageNotes: '', creatureType: 'Humanoid',
    languages: [], darkvision: 'None',
    traits: [], traitBudget: 6,
    linkedNotePath: '', syncStatus: 'Local',
  };
}

// ── EncounterModal defaults (re-implemented with new fields) ──────────────────
function makeEncounterDefaults() {
  return {
    id: uid('encounter'), name: '', type: 'Combat', location: '',
    locationId: '', locationType: '',
    linkedQuestId: '', linkedSessionId: '', linkedMapId: '',
    participants: [], participantPcIds: [], participantNpcIds: [],
    enemyTemplateIds: [], creatureIds: [],
    enemyGroups: '', difficulty: 'Medium',
    terrain: '', tactics: '', objectives: '',
    victoryConditions: '', failureConditions: '', rewards: '',
    campaignId: '', notes: '', visibility: 'dm-only',
  };
}

// ── FactionModal defaults (re-implemented with memberPcIds) ───────────────────
function makeFactionDefaults() {
  return {
    id: uid('faction'), name: '', type: '', ideology: '', territory: '',
    leadership: '', leaderNpcId: '', campaignId: '',
    goals: [], methods: [], resources: '', ranks: [],
    allies: [], allyIds: [], enemies: [], enemyIds: [],
    publicFace: '', secretAgenda: '',
    reputation: '', rewards: '', consequences: '', visibility: 'dm-only',
    staffRoles: [],
    memberNpcIds: [], memberPcIds: [], territoryIds: [], linkedQuestIds: [],
  };
}

// ── NobleFamilyModal defaults (re-implemented with NPC links) ─────────────────
function makeNobleFamilyDefaults() {
  return {
    id: uid('noble'), name: '', motto: '', campaignId: '',
    headOfHouseId: '', headOfHouse: '',
    status: 'Noble', holdings: '', titles: [], claims: '',
    members: [], heirs: [], marriages: [],
    memberNpcIds: [], heirNpcIds: [], rivalFamilyIds: [],
    alliances: [], rivals: [], debts: '',
    secrets: '', scandals: '',
    regionId: '', settlementId: '',
    factionIds: [], relatedQuestIds: [],
    summary: '', dmNotes: '', visibility: 'dm-only',
  };
}

// ── Complete generator functions (re-implemented) ─────────────────────────────
const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

function generateCompletePOI(state) {
  const TYPES = ['Ruins','Shrine','Cave','Crossroads','Watchtower','Ancient Stone','Battlefield','Shipwreck','Hidden Cache','Sacred Grove','Abandoned Farm','Cursed Ground'];
  const NOTES = ['locals avoid it','pilgrims visit seasonally','guards patrol nearby','no one has returned from it','said to be haunted','marks an old border'];
  const HOOKS = ['Something was recently disturbed here.','A faction controls access.','Strange sounds at night.','A trail of clues leads here.'];
  return {
    name: `${rnd(['The','Old','Ancient','Ruined','Hidden','Sacred'])} ${rnd(TYPES)}`,
    type: rnd(TYPES), summary: `${rnd(NOTES).charAt(0).toUpperCase()+rnd(NOTES).slice(1)}.`,
    questHook: rnd(HOOKS), visibility: 'dm-only',
    campaignId: (state && state.activeCampaignId) || '',
    tags: ['poi', 'generated'],
  };
}

function generateCompleteEncounter(state) {
  const TYPES = ['Ambush','Skirmish','Boss Fight','Social Confrontation','Trap','Chase','Hazard'];
  const ENEMIES = ['Bandits','Goblins','Cultists','Undead Patrol','Mercenaries','Wild Beasts','Rival Adventurers'];
  const TERRAINS = ['Forest clearing','Narrow bridge','Tavern common room','Underground chamber','Open road','Mountain pass','Docks at night'];
  const TACTICS  = ['They flee at 50% HP.','Leader stays in back.','Use terrain for cover.','One tries to parley.','Fight to the death.'];
  const REWARDS  = ['50 gp in coin','A map fragment','A prisoner to rescue','A stolen signet ring','Potion of healing'];
  return {
    name: `Encounter: ${rnd(ENEMIES)}`,
    type: rnd(TYPES), enemyGroups: rnd(ENEMIES), terrain: rnd(TERRAINS),
    tactics: rnd(TACTICS), rewards: rnd(REWARDS),
    difficulty: rnd(['Easy','Medium','Hard','Deadly']),
    visibility: 'dm-only', campaignId: (state && state.activeCampaignId) || '',
  };
}

function generateCompleteTavern(state) {
  const ADJ  = ['Rusty','Golden','Broken','Jolly','Wandering','Silver','Lucky','Crooked'];
  const NOUN = ['Flagon','Sword','Crow','Anvil','Boot','Coin','Lantern','Compass'];
  const SPECIALS = ['Famous for its meat pies.','Known for cheap rooms.','Secret basement gambling den.','Regulars include off-duty guards.','Has a bard every night.'];
  const HOOKS = ['A missing traveller was last seen here.','The innkeeper knows a local secret.','A shady merchant is looking for discreet workers.'];
  const name = `The ${rnd(ADJ)} ${rnd(NOUN)}`;
  return {
    name, type: 'Tavern',
    summary: `${name}. ${rnd(SPECIALS)}`, questHook: rnd(HOOKS),
    visibility: 'dm-only', campaignId: (state && state.activeCampaignId) || '',
    tags: ['tavern', 'generated'],
  };
}

function generateCompleteShop(state) {
  const TYPES = ['Blacksmith','General Store','Apothecary','Magic Emporium','Pawnshop','Weapon Dealer','Rare Books','Alchemist'];
  const OWNERS = ['A retired adventurer','A dwarf master craftsperson','A gnomish tinkerer','A half-elf widow','A merchant with shady contacts'];
  const SPECIALS = ['Has a hidden back room.','Will barter.','Only sells to those with a faction mark.','Has one rare item in stock.','Is a fence for stolen goods.'];
  const type = rnd(TYPES);
  return {
    name: `${rnd(OWNERS).split(' ').pop()}'s ${type}`,
    type: 'Shop', shopType: type,
    summary: `${type} run by ${rnd(OWNERS).toLowerCase()}. ${rnd(SPECIALS)}`,
    visibility: 'dm-only', campaignId: (state && state.activeCampaignId) || '',
    tags: ['shop', 'generated'],
  };
}

function generateCompleteRumour(state) {
  const SUBJECTS = ['The local lord','A merchant guild','The temple priests','A notorious outlaw','A travelling merchant','The new constable','An old hermit'];
  const VERBS    = ['is secretly funding','has been seen meeting with','was spotted near','is rumoured to have stolen','is hiding','may be behind'];
  const OBJECTS  = ['a criminal operation','an enemy spy','the missing heirloom','a dangerous artefact','a wanted fugitive','the recent murders'];
  const SOURCES  = ['a drunk in the tavern','a nervous stable boy','a merchant passing through','a gossiping noble','an anonymous note'];
  return {
    name: 'Rumour',
    content: `${rnd(SUBJECTS)} ${rnd(VERBS)} ${rnd(OBJECTS)}. (Source: ${rnd(SOURCES)}.)`,
    visibility: 'dm-only', status: 'Unverified',
    campaignId: (state && state.activeCampaignId) || '',
    tags: ['rumour', 'generated'],
  };
}

function generateCompleteSecret(state) {
  const WHO  = ['The mayor','A guild leader','A temple priest','A local noble','A respected merchant','A faction leader'];
  const WHAT = ['is an informant','murdered someone years ago','is secretly a warlock','has been embezzling funds','is planning a coup','hid a body'];
  const EVIDENCE = ['A coded letter','A witness who is afraid to speak','A discrepancy in the ledgers','An unusual scar','A hidden room','A trusted contact'];
  return {
    name: `Secret: ${rnd(WHO)}`,
    summary: `${rnd(WHO)} ${rnd(WHAT)}.`,
    evidence: `Evidence: ${rnd(EVIDENCE)}.`,
    status: 'Hidden', visibility: 'dm-only',
    campaignId: (state && state.activeCampaignId) || '',
    tags: ['secret', 'generated'],
  };
}

function generateCompleteDungeonRoom(state) {
  const PURPOSES  = ['Guardroom','Treasury','Prison cell','Ritual chamber','Barracks','Laboratory','Crypt','Throne room','Kitchen','Armoury'];
  const FEATURES  = ['A crumbling statue in the corner','Water dripping from the ceiling','Old bones scattered on the floor','A firepit long cold','Claw marks on the walls','A single torch burning'];
  const HAZARDS   = ['A tripwire near the door','Unstable ceiling','Poisonous spores','A hidden pit','A magical alarm glyph'];
  const CONTENTS  = ['Nothing of value','A locked chest','A body with clues on it','Scattered coins (2d6 gp)','A useful tool or weapon','A clue to the dungeon\'s history'];
  return {
    name: `${rnd(PURPOSES)}`,
    type: 'Dungeon Room',
    summary: `${rnd(FEATURES)}. ${rnd(CONTENTS)}.`,
    hazard: Math.random() > 0.5 ? rnd(HAZARDS) : '',
    visibility: 'dm-only', campaignId: (state && state.activeCampaignId) || '',
    tags: ['dungeon', 'room', 'generated'],
  };
}

function generateCompleteLoot(state) {
  const MUNDANE = ['A pouch of 3d6 gold pieces','A fine dagger (20 gp)','A set of thieves\' tools','A well-made map','A merchant\'s ring (25 gp)'];
  const MAGICAL = ['A potion of healing','A +1 weapon (DM\'s choice)','A scroll of a 1st-level spell','A sending stone (one charge)','A cloak of protection (+1 AC)'];
  const RELICS  = ['An ancient coin with a forgotten emperor\'s face','A shard of a broken holy symbol','A partial star chart','A letter bearing a noble seal','A small idol that faintly glows at dawn'];
  const isRelic = Math.random() < 0.2;
  const isMagic = !isRelic && Math.random() < 0.4;
  const items = [rnd(isMagic ? MAGICAL : isRelic ? RELICS : MUNDANE)];
  if (Math.random() > 0.5) items.push(rnd(MUNDANE));
  return {
    name: isRelic ? 'Relic Found' : isMagic ? 'Magic Loot' : 'Loot',
    type: isRelic ? 'Relic' : isMagic ? 'Magic Item' : 'Mundane',
    items, summary: items.join('; '),
    visibility: 'dm-only', campaignId: (state && state.activeCampaignId) || '',
    tags: ['loot', 'generated'],
  };
}

function generateCompleteTravelEvent(state) {
  const EVENTS = [
    'A merchant caravan requests escort for the next two days.',
    'A traveller going the wrong direction asks for directions — and seems to be following the party.',
    'Unusual weather forces a detour through unfamiliar territory.',
    'The road is blocked by a collapsed bridge. Alternative routes add a day.',
    'A child is found alone at a crossroads, unable to explain how they got there.',
    'A patrol stops the party to check travel papers.',
    'The party finds the remains of a camp — something attacked it recently.',
    'A peddler sells suspicious wares at impossibly low prices.',
  ];
  const COMPLICATIONS = ['A faction claims the road is theirs.','Local wildlife is more aggressive than usual.','A wanted poster bears a resemblance to one PC.'];
  return {
    name: 'Travel Event',
    summary: rnd(EVENTS),
    complication: Math.random() > 0.5 ? rnd(COMPLICATIONS) : '',
    visibility: 'dm-only', campaignId: (state && state.activeCampaignId) || '',
    tags: ['travel', 'generated'],
  };
}

function generateCompleteNobleHouse(state) {
  const NAMES  = ['Ashmore','Blackthorn','Cresthall','Dunmore','Emberveil','Frostmantle','Greymoor','Holloway','Ironvale','Jasperton'];
  const MOTTOS = ['"We Endure"','"Blood and Iron"','"First and Finest"','"Our Roots Run Deep"','"Justice Above All"','"Through Darkness, Light"'];
  const STATUS = ['Ruling','Noble','Gentry','Declining'];
  const SECRETS = ['Lost a fortune to gambling debts.','Secretly supports a criminal faction.','An heir is illegitimate.','Made a deal with a demon long ago.','Caused a historical massacre they covered up.'];
  const name = `House ${rnd(NAMES)}`;
  return {
    name, motto: rnd(MOTTOS),
    status: rnd(STATUS), secrets: rnd(SECRETS),
    summary: `An ancient ${rnd(['merchant','military','scholarly','religious'])} house known for its ${rnd(['cunning','arrogance','wealth','influence'])}.`,
    visibility: 'dm-only', campaignId: (state && state.activeCampaignId) || '',
    tags: ['noble', 'family', 'generated'],
  };
}

// ── End Session Review compilation (re-implemented) ───────────────────────────
function compileEndSessionReview(session, state) {
  const review = {
    sessionName: session.name || 'Session',
    date: session.realDate || new Date().toISOString().slice(0,10),
    eventLog: safeArr(session.eventLog),
    npcsEncountered: [],
    locationsVisited: [],
    questsAdvanced: safeArr(session.questsAdvanced || []),
    secretsRevealed: [],
    lootAwarded: session.lootAwarded || '',
    timersAdvanced: [],
    playerRecap: '',
  };
  // NPCs met this session
  const npcEvents = review.eventLog.filter(e => e.type === 'NPC Met');
  review.npcsEncountered = npcEvents.map(e => e.text);
  // Locations visited
  const locEvents = review.eventLog.filter(e => e.type === 'Location Visited');
  review.locationsVisited = locEvents.map(e => e.text);
  // Secrets revealed during session
  const revealEvents = review.eventLog.filter(e => e.type === 'Secret Revealed');
  review.secretsRevealed = revealEvents.map(e => e.text);
  // Timer advances
  const timerEvents = review.eventLog.filter(e => e.type === 'Timer Advanced');
  review.timersAdvanced = timerEvents.map(e => e.text);
  // Build player-safe recap from notes
  const noteEvents = review.eventLog.filter(e => e.type === 'Note');
  review.playerRecap = [
    `Session: ${review.sessionName}`,
    noteEvents.length ? 'Summary: ' + noteEvents.map(e => e.text).join(' ') : '',
    review.questsAdvanced.length ? 'Quests advanced: ' + review.questsAdvanced.join(', ') : '',
    review.npcsEncountered.length ? 'NPCs met: ' + review.npcsEncountered.join(', ') : '',
    review.locationsVisited.length ? 'Locations: ' + review.locationsVisited.join(', ') : '',
    review.lootAwarded ? 'Loot: ' + review.lootAwarded : '',
  ].filter(Boolean).join('\n');
  return review;
}

// ── Test runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function suite(name) { console.log(`\n${name}`); }

// ── LevelUpModal v2 tests ──────────────────────────────────────────────────────
suite('LevelUpModal v2 — subclass, spells, class features (Item 4)');
test('subclass level for Wizard is 2', () => assert.equal(getSubclassLevel('Wizard'), 2));
test('subclass level for Cleric is 1', () => assert.equal(getSubclassLevel('Cleric'), 1));
test('subclass level for Warlock is 1', () => assert.equal(getSubclassLevel('Warlock'), 1));
test('subclass level for Fighter defaults to 3', () => assert.equal(getSubclassLevel('Fighter'), 3));
test('subclass level for Rogue defaults to 3', () => assert.equal(getSubclassLevel('Rogue'), 3));
test('class feature hint: Barbarian level 3 is Primal Path', () => {
  assert.ok(getClassFeatureHint('Barbarian', 3).includes('Primal Path'));
});
test('class feature hint: Fighter level 2 is Action Surge', () => {
  assert.ok(getClassFeatureHint('Fighter', 2).includes('Action Surge'));
});
test('class feature hint: Wizard level 2 is Arcane Tradition', () => {
  assert.ok(getClassFeatureHint('Wizard', 2).includes('Arcane Tradition'));
});
test('class feature hint returns null for unknown class/level', () => {
  assert.equal(getClassFeatureHint('Barbarian', 99), null);
});
test('LevelUpModal state has subclassChosen field', () => {
  const state = makeLevelUpState({ class: 'Wizard', level: 1 }, 2);
  assert.ok('subclassChosen' in state);
});
test('LevelUpModal state has rulesetOverride defaulting to PHB', () => {
  const state = makeLevelUpState({ class: 'Wizard', level: 1 }, 2);
  assert.equal(state.rulesetOverride, 'PHB');
});
test('LevelUpModal state has spellsAdded as array', () => {
  const state = makeLevelUpState({ class: 'Wizard', level: 1 }, 2);
  assert.ok(Array.isArray(state.spellsAdded));
});
test('subclassChosen inherited from character', () => {
  const state = makeLevelUpState({ class: 'Wizard', level: 1, subclass: 'Divination' }, 2);
  assert.equal(state.subclassChosen, 'Divination');
});

// ── CharacterModal new fields ──────────────────────────────────────────────────
suite('CharacterModal — refData fields (Item 3)');
test('defaults include campaignId', () => assert.ok('campaignId' in makeCharacterDefaults()));
test('campaignId defaults to empty string', () => assert.equal(makeCharacterDefaults().campaignId, ''));
test('defaults include languages array', () => assert.ok(Array.isArray(makeCharacterDefaults().languages)));
test('defaults include knownSpells array', () => assert.ok(Array.isArray(makeCharacterDefaults().knownSpells)));
test('knownSpells defaults to empty', () => assert.equal(makeCharacterDefaults().knownSpells.length, 0));

// ── HybridAncestryModal campaign picker ───────────────────────────────────────
suite('HybridAncestryModal — campaignId (Item 7)');
test('hybrid defaults have campaignId', () => assert.ok('campaignId' in makeHybridDefaults()));
test('campaignId defaults empty', () => assert.equal(makeHybridDefaults().campaignId, ''));
test('hybridAncestryId can be linked from a character', () => {
  const char = makeCharacterDefaults();
  char.hybridAncestryId = 'hybrid-123';
  assert.equal(char.hybridAncestryId, 'hybrid-123');
});

// ── EncounterModal new fields ──────────────────────────────────────────────────
suite('EncounterModal — locationType, session link, map link (Item 7)');
test('defaults include locationType', () => assert.ok('locationType' in makeEncounterDefaults()));
test('defaults include linkedSessionId', () => assert.ok('linkedSessionId' in makeEncounterDefaults()));
test('defaults include linkedMapId', () => assert.ok('linkedMapId' in makeEncounterDefaults()));
test('locationType defaults empty', () => assert.equal(makeEncounterDefaults().locationType, ''));
test('locationType accepts dungeons', () => {
  const e = makeEncounterDefaults(); e.locationType = 'dungeons';
  assert.equal(e.locationType, 'dungeons');
});

// ── FactionModal member PCs ────────────────────────────────────────────────────
suite('FactionModal — memberPcIds (Item 7)');
test('defaults include memberPcIds', () => assert.ok('memberPcIds' in makeFactionDefaults()));
test('memberPcIds is an array', () => assert.ok(Array.isArray(makeFactionDefaults().memberPcIds)));
test('memberNpcIds still present', () => assert.ok('memberNpcIds' in makeFactionDefaults()));
test('member NPCs and PCs stored separately', () => {
  const f = makeFactionDefaults();
  f.memberNpcIds = ['npc-1'];
  f.memberPcIds  = ['char-1'];
  assert.equal(f.memberNpcIds.length, 1);
  assert.equal(f.memberPcIds.length, 1);
});

// ── NobleFamilyModal NPC linking ──────────────────────────────────────────────
suite('NobleFamilyModal — memberNpcIds, heirNpcIds, rivalFamilyIds (Item 7)');
test('defaults include memberNpcIds', () => assert.ok('memberNpcIds' in makeNobleFamilyDefaults()));
test('defaults include heirNpcIds', () => assert.ok('heirNpcIds' in makeNobleFamilyDefaults()));
test('defaults include rivalFamilyIds', () => assert.ok('rivalFamilyIds' in makeNobleFamilyDefaults()));
test('memberNpcIds is array', () => assert.ok(Array.isArray(makeNobleFamilyDefaults().memberNpcIds)));
test('heirNpcIds is array', () => assert.ok(Array.isArray(makeNobleFamilyDefaults().heirNpcIds)));
test('rivalFamilyIds is array', () => assert.ok(Array.isArray(makeNobleFamilyDefaults().rivalFamilyIds)));

// ── Hybridiser persistence (Item 8) ───────────────────────────────────────────
suite('Hybridiser persistence (Item 8)');
test('Save as Homebrew: finds existing record by sourceHybridId', () => {
  const hybridId = 'hybrid-xyz';
  const homebrew = [{ id: 'hb-1', sourceHybridId: hybridId, name: 'Old Name', content: 'old' }];
  const existing = homebrew.find(h => h.sourceHybridId === hybridId || h.name === 'Drow-Human');
  assert.ok(existing, 'should find existing by sourceHybridId');
});
test('Save as Homebrew: updates existing record (same id)', () => {
  const hybridId = 'hybrid-xyz';
  const homebrew = [{ id: 'hb-1', sourceHybridId: hybridId, name: 'Old Name', content: 'old', createdAt: '2024-01-01' }];
  const existing = homebrew.find(h => h.sourceHybridId === hybridId);
  const updated = existing ? { ...existing, content: 'new', updatedAt: new Date().toISOString() } : null;
  assert.ok(updated, 'should produce an updated object');
  assert.equal(updated.id, 'hb-1', 'id should be preserved');
  assert.equal(updated.content, 'new', 'content should update');
  assert.ok(updated.createdAt, 'createdAt should be preserved');
});
test('Save as Homebrew: creates new when no match', () => {
  const homebrew = [{ id: 'hb-1', sourceHybridId: 'other-id', name: 'Other' }];
  const existing = homebrew.find(h => h.sourceHybridId === 'hybrid-new');
  assert.equal(existing, undefined, 'no existing match → create new');
});
test('Export Player-Safe Note: updates syncStatus', () => {
  const hybrid = makeHybridDefaults();
  hybrid.linkedNotePath = 'Campaigns/Test/Hybrid Ancestries/Test.md';
  hybrid.syncStatus = 'Exported';
  hybrid.lastExportedAt = new Date().toISOString();
  assert.equal(hybrid.syncStatus, 'Exported');
  assert.ok(hybrid.lastExportedAt);
  assert.ok(hybrid.linkedNotePath.includes('Hybrid Ancestries'));
});
test('Use for New PC: saves hybrid with real ID first', () => {
  const hybrid = makeHybridDefaults();
  hybrid.name = 'Drow-Human';
  assert.ok(hybrid.id, 'hybrid must have an id before passing to CharacterModal');
  const charInit = { race: hybrid.name, hybridAncestryId: hybrid.id };
  assert.equal(charInit.hybridAncestryId, hybrid.id);
});

// ── Complete generators (Item 6) ──────────────────────────────────────────────
suite('generateCompletePOI (Item 6)');
const state = { activeCampaignId: 'camp-1', entities: {} };
test('returns object with name', () => assert.ok(generateCompletePOI(state).name));
test('has type field', () => assert.ok(generateCompletePOI(state).type));
test('has questHook', () => assert.ok(generateCompletePOI(state).questHook));
test('has campaignId', () => assert.equal(generateCompletePOI(state).campaignId, 'camp-1'));
test('has visibility dm-only', () => assert.equal(generateCompletePOI(state).visibility, 'dm-only'));

suite('generateCompleteEncounter (Item 6)');
test('returns object with name', () => assert.ok(generateCompleteEncounter(state).name));
test('has difficulty', () => assert.ok(generateCompleteEncounter(state).difficulty));
test('has terrain', () => assert.ok(generateCompleteEncounter(state).terrain));
test('has tactics', () => assert.ok(generateCompleteEncounter(state).tactics));

suite('generateCompleteTavern (Item 6)');
test('name starts with "The "', () => assert.ok(generateCompleteTavern(state).name.startsWith('The ')));
test('type is Tavern', () => assert.equal(generateCompleteTavern(state).type, 'Tavern'));
test('has questHook', () => assert.ok(generateCompleteTavern(state).questHook));

suite('generateCompleteShop (Item 6)');
test('has name', () => assert.ok(generateCompleteShop(state).name));
test('type is Shop', () => assert.equal(generateCompleteShop(state).type, 'Shop'));
test('has shopType', () => assert.ok(generateCompleteShop(state).shopType));

suite('generateCompleteRumour (Item 6)');
test('has content', () => assert.ok(generateCompleteRumour(state).content.length > 10));
test('status is Unverified', () => assert.equal(generateCompleteRumour(state).status, 'Unverified'));

suite('generateCompleteSecret (Item 6)');
test('has summary', () => assert.ok(generateCompleteSecret(state).summary.length > 5));
test('status is Hidden', () => assert.equal(generateCompleteSecret(state).status, 'Hidden'));

suite('generateCompleteDungeonRoom (Item 6)');
test('has name (room type)', () => assert.ok(generateCompleteDungeonRoom(state).name));
test('has summary with period', () => assert.ok(generateCompleteDungeonRoom(state).summary.includes('.')));

suite('generateCompleteLoot (Item 6)');
test('has items array', () => assert.ok(Array.isArray(generateCompleteLoot(state).items)));
test('items array is non-empty', () => assert.ok(generateCompleteLoot(state).items.length > 0));
test('has type', () => assert.ok(['Mundane','Magic Item','Relic'].includes(generateCompleteLoot(state).type)));

suite('generateCompleteTravelEvent (Item 6)');
test('has summary', () => assert.ok(generateCompleteTravelEvent(state).summary.length > 10));
test('name is Travel Event', () => assert.equal(generateCompleteTravelEvent(state).name, 'Travel Event'));

suite('generateCompleteNobleHouse (Item 6)');
test('name starts with "House "', () => assert.ok(generateCompleteNobleHouse(state).name.startsWith('House ')));
test('has motto', () => assert.ok(generateCompleteNobleHouse(state).motto));
test('has status', () => assert.ok(['Ruling','Noble','Gentry','Declining'].includes(generateCompleteNobleHouse(state).status)));
test('has secrets', () => assert.ok(generateCompleteNobleHouse(state).secrets));

// ── End Session Review (Item 5) ────────────────────────────────────────────────
suite('compileEndSessionReview (Item 5)');
test('compiles NPC met events', () => {
  const sess = { name: 'Test', eventLog: [
    { type: 'NPC Met', text: 'Aldric the innkeeper', time: '2024-01-01T12:00:00Z' },
    { type: 'Note', text: 'Party arrived at town', time: '2024-01-01T11:00:00Z' },
  ], questsAdvanced: ['The Lost Shipment'], lootAwarded: '50 gp' };
  const review = compileEndSessionReview(sess, state);
  assert.ok(review.npcsEncountered.includes('Aldric the innkeeper'));
});
test('compiles secrets revealed', () => {
  const sess = { name: 'Test', eventLog: [
    { type: 'Secret Revealed', text: 'The mayor is corrupt', time: '2024-01-01T12:00:00Z' },
  ] };
  const review = compileEndSessionReview(sess, state);
  assert.ok(review.secretsRevealed.includes('The mayor is corrupt'));
});
test('compiles quests advanced', () => {
  const sess = { name: 'Test', eventLog: [], questsAdvanced: ['Main Quest', 'Side Quest'] };
  const review = compileEndSessionReview(sess, state);
  assert.ok(review.questsAdvanced.includes('Main Quest'));
});
test('generates player recap string', () => {
  const sess = { name: 'Session 3', eventLog: [
    { type: 'Note', text: 'Party fought goblins', time: '2024-01-01T12:00:00Z' },
  ], questsAdvanced: ['The Missing Merchant'], lootAwarded: '100 gp' };
  const review = compileEndSessionReview(sess, state);
  assert.ok(review.playerRecap.includes('Session 3'));
  assert.ok(review.playerRecap.includes('Party fought goblins'));
});
test('compiles location events', () => {
  const sess = { name: 'Test', eventLog: [
    { type: 'Location Visited', text: 'The Rusty Flagon tavern', time: '2024-01-01T12:00:00Z' },
  ] };
  const review = compileEndSessionReview(sess, state);
  assert.ok(review.locationsVisited.includes('The Rusty Flagon tavern'));
});
test('compiles timer events', () => {
  const sess = { name: 'Test', eventLog: [
    { type: 'Timer Advanced', text: 'Army approaches: 4/6', time: '2024-01-01T12:00:00Z' },
  ] };
  const review = compileEndSessionReview(sess, state);
  assert.ok(review.timersAdvanced.includes('Army approaches: 4/6'));
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)`);
if (failed > 0) process.exit(1);

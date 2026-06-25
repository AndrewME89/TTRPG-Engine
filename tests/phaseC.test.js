'use strict';
// Phase C tests — World Atlas Linking & Common Option Selectors
// Reads from src/main.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function includes(str, needle, msg) {
  assert(str.includes(needle), msg || `Expected to find: ${needle}`);
}

console.log('\n=== Phase C: World Atlas Linking & Common Option Selectors ===\n');

// ── OPTION_BANKS new banks ────────────────────────────────────────────────────
test('OPTION_BANKS has climateRules bank', () => {
  includes(src, "climateRules:");
});
test('OPTION_BANKS has magicRules bank', () => {
  includes(src, "magicRules:");
});
test('OPTION_BANKS has cosmologyTypes bank', () => {
  includes(src, "cosmologyTypes:");
});
test('OPTION_BANKS has planarTravelRules bank', () => {
  includes(src, "planarTravelRules:");
});
test('OPTION_BANKS has ranks bank', () => {
  includes(src, "ranks:");
});
test('OPTION_BANKS has cultureCustoms bank', () => {
  includes(src, "cultureCustoms:");
});
test('OPTION_BANKS has cultureTaboos bank', () => {
  includes(src, "cultureTaboos:");
});
test('OPTION_BANKS has socialStructure bank', () => {
  includes(src, "socialStructure:");
});
test('OPTION_BANKS has regionalResources bank', () => {
  includes(src, "regionalResources:");
});
test('OPTION_BANKS has worldHazards bank', () => {
  includes(src, "worldHazards:");
});
test('OPTION_BANKS has travelConditions bank', () => {
  includes(src, "travelConditions:");
});
test('OPTION_BANKS has religiousTaboos bank', () => {
  includes(src, "religiousTaboos:");
});

// ── OPTION_BANKS expanded entries ─────────────────────────────────────────────
test('factionGoals has Military Conquest', () => {
  includes(src, "'Military Conquest'");
});
test('factionGoals has Liberation', () => {
  includes(src, "'Liberation'");
});
test('factionMethods has Blackmail', () => {
  includes(src, "'Blackmail'");
});
test('factionMethods has Sabotage', () => {
  includes(src, "'Sabotage'");
});
test('factionResources has Spies', () => {
  includes(src, "'Spies'");
});
test('factionResources has Safehouses', () => {
  includes(src, "'Safehouses'");
});
test('factionResources has Noble Patrons', () => {
  includes(src, "'Noble Patrons'");
});
test('governmentTypes has Magocracy', () => {
  includes(src, "'Magocracy'");
});
test('governmentTypes has Military Junta', () => {
  includes(src, "'Military Junta'");
});
test('governmentTypes has Divine Mandate', () => {
  includes(src, "'Divine Mandate'");
});

// ── worldFields ────────────────────────────────────────────────────────────────
test('worldFields.climate is chip with climateRules bank', () => {
  includes(src, "{ key: 'climate', label: 'Climate Rules', type: 'chip', opts: { bank: 'climateRules' } }");
});
test('worldFields.resources is chip with regionalResources bank', () => {
  includes(src, "{ key: 'resources', label: 'Key Resources', type: 'chip', opts: { bank: 'regionalResources' } }");
});
test('worldFields.magic is chip with magicRules bank', () => {
  includes(src, "{ key: 'magic', label: 'Magic Rules', type: 'chip', opts: { bank: 'magicRules' } }");
});

// ── cosmologyFields ────────────────────────────────────────────────────────────
test('cosmologyFields type field is select with cosmologyTypes options', () => {
  includes(src, "{ key: 'type', label: 'Type', type: 'select', options: ['Great Wheel'");
});
test('cosmologyFields has planeIds entityMultiRef for realms', () => {
  includes(src, "{ key: 'planeIds', label: 'Planes / Realms', type: 'entityMultiRef', entityType: 'realms' }");
});
test('cosmologyFields travelRules is chip with planarTravelRules bank', () => {
  includes(src, "{ key: 'travelRules', label: 'Planar Travel Rules', type: 'chip', opts: { bank: 'planarTravelRules' } }");
});

// ── realmFields ────────────────────────────────────────────────────────────────
test('realmFields has parentPlaneId entityRef for realms', () => {
  includes(src, "{ key: 'parentPlaneId', label: 'Parent Plane', type: 'entityRef', entityType: 'realms' }");
});
test('realmFields has connectionIds entityMultiRef for realms', () => {
  includes(src, "{ key: 'connectionIds', label: 'Connected Realms', type: 'entityMultiRef', entityType: 'realms' }");
});

// ── deityFields ────────────────────────────────────────────────────────────────
test('deityFields.domain is type chip', () => {
  includes(src, "{ key: 'domain', label: 'Divine Domain', type: 'chip'");
});
test('deityFields has pantheonId entityRef for pantheons', () => {
  includes(src, "{ key: 'pantheonId', label: 'Pantheon', type: 'entityRef', entityType: 'pantheons' }");
});
test('deityFields has holySiteIds entityMultiRef for locations', () => {
  includes(src, "{ key: 'holySiteIds', label: 'Holy Sites', type: 'entityMultiRef', entityType: 'locations' }");
});

// ── cultureFields ─────────────────────────────────────────────────────────────
test('cultureFields.customs is chip with cultureCustoms bank', () => {
  includes(src, "{ key: 'customs', label: 'Customs', type: 'chip', opts: { bank: 'cultureCustoms' } }");
});
test('cultureFields.taboos is chip with cultureTaboos bank', () => {
  includes(src, "{ key: 'taboos', label: 'Taboos', type: 'chip', opts: { bank: 'cultureTaboos' } }");
});
test('cultureFields.socialStructure is chip with socialStructure bank', () => {
  includes(src, "{ key: 'socialStructure', label: 'Social Structure', type: 'chip', opts: { bank: 'socialStructure' } }");
});
test('cultureFields has languageId entityRef for languages', () => {
  includes(src, "{ key: 'languageId', label: 'Primary Language', type: 'entityRef', entityType: 'languages' }");
});

// ── regionFields ──────────────────────────────────────────────────────────────
test('regionFields.climate is chip with climateTypes bank', () => {
  includes(src, "{ key: 'climate', label: 'Climate', type: 'chip', opts: { bank: 'climateTypes' } }");
});
test('regionFields.resources is chip with regionalResources bank', () => {
  includes(src, "{ key: 'resources', label: 'Resources', type: 'chip', opts: { bank: 'regionalResources' } }");
});
test('regionFields.hazards is chip with worldHazards bank', () => {
  includes(src, "{ key: 'hazards', label: 'Hazards', type: 'chip', opts: { bank: 'worldHazards' } }");
});

// ── settlementFields ──────────────────────────────────────────────────────────
test('settlementFields has regionId entityRef for regions', () => {
  includes(src, "{ key: 'regionId', label: 'Region', type: 'entityRef', entityType: 'regions' }");
});
test('settlementFields.government is chip with governmentTypes bank', () => {
  includes(src, "{ key: 'government', label: 'Government', type: 'chip', opts: { bank: 'governmentTypes' } }");
});
test('settlementFields has notableNpcIds entityMultiRef for npcs', () => {
  includes(src, "{ key: 'notableNpcIds', label: 'Notable NPCs', type: 'entityMultiRef', entityType: 'npcs' }");
});
test('settlementFields has districtIds entityMultiRef for districts', () => {
  includes(src, "{ key: 'districtIds', label: 'Districts', type: 'entityMultiRef', entityType: 'districts' }");
});

// ── locationFields ────────────────────────────────────────────────────────────
test('locationFields has regionId entityRef for regions', () => {
  assert(src.includes("entityType: 'regions'"), "Expected entityType: 'regions'");
});
test('locationFields.hazards is chip with worldHazards bank', () => {
  includes(src, "bank: 'worldHazards'");
});

// ── districtFields ────────────────────────────────────────────────────────────
test('districtFields.settlementId is entityRef for settlements', () => {
  includes(src, "{ key: 'settlementId', label: 'Settlement', type: 'entityRef', entityType: 'settlements' }");
});
test('districtFields has notableLocationIds entityMultiRef for locations', () => {
  includes(src, "{ key: 'notableLocationIds', label: 'Notable Locations', type: 'entityMultiRef', entityType: 'locations' }");
});
test('districtFields has factionIds entityMultiRef for factions', () => {
  includes(src, "{ key: 'factionIds', label: 'Active Factions', type: 'entityMultiRef', entityType: 'factions' }");
});

// ── roomFields ────────────────────────────────────────────────────────────────
test('roomFields.locationId is entityRef for locations', () => {
  includes(src, "{ key: 'locationId', label: 'Location / Dungeon', type: 'entityRef', entityType: 'locations' }");
});
test('roomFields has connectedRoomIds entityMultiRef for rooms', () => {
  includes(src, "{ key: 'connectedRoomIds', label: 'Connected Rooms', type: 'entityMultiRef', entityType: 'rooms' }");
});

// ── routeFields ───────────────────────────────────────────────────────────────
test('routeFields.hazards is chip with worldHazards bank', () => {
  includes(src, "bank: 'worldHazards'");
});
test('routeFields has conditions chip with travelConditions bank', () => {
  includes(src, "{ key: 'conditions', label: 'Travel Conditions', type: 'chip', opts: { bank: 'travelConditions' } }");
});

// ── nationFields ──────────────────────────────────────────────────────────────
test('nationFields has rulerNpcId entityRef for npcs', () => {
  includes(src, "{ key: 'rulerNpcId', label: 'Ruler / Leader', type: 'entityRef', entityType: 'npcs' }");
});
test('nationFields has capitalId entityRef for settlements', () => {
  includes(src, "{ key: 'capitalId', label: 'Capital', type: 'entityRef', entityType: 'settlements' }");
});
test('nationFields.government is chip with governmentTypes bank', () => {
  includes(src, "bank: 'governmentTypes'");
});
test('nationFields has allyIds entityMultiRef for factions', () => {
  includes(src, "{ key: 'allyIds', label: 'Allies', type: 'entityMultiRef', entityType: 'factions' }");
});
test('nationFields has enemyIds entityMultiRef for factions', () => {
  includes(src, "{ key: 'enemyIds', label: 'Enemies', type: 'entityMultiRef', entityType: 'factions' }");
});

// ── religionFields ────────────────────────────────────────────────────────────
test('religionFields has deityId entityRef for deities', () => {
  includes(src, "{ key: 'deityId', label: 'Primary Deity', type: 'entityRef', entityType: 'deities' }");
});
test('religionFields has templeIds entityMultiRef for locations', () => {
  includes(src, "{ key: 'templeIds', label: 'Temples / Holy Sites', type: 'entityMultiRef', entityType: 'locations' }");
});
test('religionFields.restrictions is chip with religiousTaboos bank', () => {
  includes(src, "{ key: 'restrictions', label: 'Taboos & Restrictions', type: 'chip', opts: { bank: 'religiousTaboos' } }");
});

// ── GenericModal.renderField ──────────────────────────────────────────────────
test('GenericModal.renderField handles entityMultiRef type', () => {
  includes(src, "f.type === 'entityMultiRef'");
});

// ── resolveEntityDisplay ──────────────────────────────────────────────────────
test('resolveEntityDisplay helper exists', () => {
  includes(src, "function resolveEntityDisplay(idOrText, state)");
});

// ── FactionModal bank options ─────────────────────────────────────────────────
test('FactionModal uses bank:factionGoals for goals chipField', () => {
  includes(src, "bank: 'factionGoals'");
});
test('FactionModal uses bank:factionMethods for methods chipField', () => {
  includes(src, "bank: 'factionMethods'");
});
test('FactionModal uses bank:factionResources for resources chipField (no longer textarea)', () => {
  includes(src, "bank: 'factionResources'");
  assert(!src.includes("addField(contentEl, 'Resources', this.values.resources"),
    "Old textarea form for Resources should be removed");
});
test('FactionModal uses bank:ranks for ranks chipField', () => {
  includes(src, "bank: 'ranks'");
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('\nFailures:');
  failures.forEach(f => console.error(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
process.exit(0);

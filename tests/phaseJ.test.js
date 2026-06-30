'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS', name);
    passed++;
  } catch (error) {
    console.log('  FAIL', name, '\n       ', error.message);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function includes(text, fragment) {
  assert(text.includes(fragment), `Expected to find: ${fragment}`);
}

function notIncludes(text, fragment) {
  assert(!text.includes(fragment), `Expected NOT to find: ${fragment}`);
}

// Extract a const array/object definition by name
function extractConst(name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  assert(start >= 0, `Could not find const ${name}`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start + marker.length; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[' || ch === '{') { depth++; if (bodyStart === -1) bodyStart = i; }
    else if (ch === ']' || ch === '}') {
      depth--;
      if (bodyStart !== -1 && depth === 0) return src.slice(start, i + 1);
    }
    if (bodyStart === -1 && ch !== ' ' && ch !== '\n') {
      // scalar value — just grab to end of line
      const eol = src.indexOf('\n', i);
      return src.slice(start, eol > -1 ? eol : i + 20);
    }
  }
  throw new Error(`Could not extract const ${name}`);
}

console.log('\nPhase J — World Atlas Selector & Entity Link Completion\n');

// ─── Section 1: routeFields structured typed refs ────────────────────────────
console.log('  Section 1: routeFields structured typed refs');

test('routeFields includes fromRefType typed endpoint key', () => {
  const def = extractConst('routeFields');
  includes(def, 'fromRefType');
});

test('routeFields includes fromRefId typed endpoint key', () => {
  const def = extractConst('routeFields');
  includes(def, 'fromRefId');
});

test('routeFields includes toRefType typed endpoint key', () => {
  const def = extractConst('routeFields');
  includes(def, 'toRefType');
});

test('routeFields includes toRefId typed endpoint key', () => {
  const def = extractConst('routeFields');
  includes(def, 'toRefId');
});

test('routeFields from/to typed refs support Settlements', () => {
  const def = extractConst('ROUTE_ENDPOINT_TYPES');
  includes(def, "'settlements'");
});

test('routeFields from/to typed refs support Locations', () => {
  const def = extractConst('ROUTE_ENDPOINT_TYPES');
  includes(def, "'locations'");
});

test('routeFields from/to typed refs support Regions', () => {
  const def = extractConst('ROUTE_ENDPOINT_TYPES');
  includes(def, "'regions'");
});

test('routeFields from/to typed refs support POIs', () => {
  const def = extractConst('ROUTE_ENDPOINT_TYPES');
  includes(def, "'pois'");
});

test('routeFields from/to typed refs support Dungeons', () => {
  const def = extractConst('ROUTE_ENDPOINT_TYPES');
  includes(def, "'dungeons'");
});

test('routeFields preserves legacy from text field', () => {
  const def = extractConst('routeFields');
  includes(def, "key: 'from'");
  includes(def, "type: 'text'");
});

test('routeFields preserves legacy to text field', () => {
  const def = extractConst('routeFields');
  includes(def, "key: 'to'");
});

test('routeFields uses typedEntityRef field type for endpoints', () => {
  const def = extractConst('routeFields');
  includes(def, "type: 'typedEntityRef'");
});

// ─── Section 2: roomFields typed parent ref ───────────────────────────────────
console.log('\n  Section 2: roomFields typed parent location/dungeon');

test('roomFields has locationType key for parent type discriminator', () => {
  const def = extractConst('roomFields');
  includes(def, 'locationType');
});

test('roomFields locationId is now the typed ref id key', () => {
  const def = extractConst('roomFields');
  includes(def, "idKey: 'locationId'");
});

test('roomFields parent supports locations', () => {
  const def = extractConst('roomFields');
  // Need both locationId and locations entityType
  includes(def, "key: 'locations'");
});

test('roomFields parent supports dungeons', () => {
  const def = extractConst('roomFields');
  includes(def, "key: 'dungeons'");
});

test('roomFields parent uses typedEntityRef type', () => {
  const def = extractConst('roomFields');
  includes(def, "type: 'typedEntityRef'");
});

test('roomFields traps remain as chip field (not entity-backed)', () => {
  const def = extractConst('roomFields');
  includes(def, "key: 'traps'");
  includes(def, "type: 'chip'");
  // Should NOT be entityRef or entityMultiRef
  const trapsIdx = def.indexOf("key: 'traps'");
  const trapsBlock = def.slice(trapsIdx, trapsIdx + 80);
  notIncludes(trapsBlock, 'entityRef');
});

test('roomFields existing descriptive text fields preserved', () => {
  const def = extractConst('roomFields');
  includes(def, "key: 'description'");
  includes(def, "key: 'features'");
  includes(def, "key: 'loot'"); // legacy textarea
});

// ─── Section 3: religionFields domainId entity ref ──────────────────────────
console.log('\n  Section 3: religionFields domainId entity ref');

test('religionFields has domainId entityRef to domains', () => {
  const def = extractConst('religionFields');
  includes(def, "key: 'domainId'");
  includes(def, "entityType: 'domains'");
});

test('religionFields preserves legacy domain text field', () => {
  const def = extractConst('religionFields');
  includes(def, "key: 'domain'");
  // The legacy field has label containing 'legacy text'
  includes(def, 'legacy text');
});

test('religionFields holyDays is a chip field', () => {
  const def = extractConst('religionFields');
  includes(def, "key: 'holyDays'");
  // Find the holyDays entry and confirm it is type chip
  const idx = def.indexOf("key: 'holyDays'");
  const block = def.slice(idx, idx + 60);
  includes(block, "type: 'chip'");
});

test('religionFields retains deityId entityRef', () => {
  const def = extractConst('religionFields');
  includes(def, "key: 'deityId'");
  includes(def, "entityType: 'deities'");
});

test('religionFields retains templeIds entityMultiRef', () => {
  const def = extractConst('religionFields');
  includes(def, "key: 'templeIds'");
  includes(def, "entityType: 'locations'");
});

// ─── Section 4: lootFields structured ownership ──────────────────────────────
console.log('\n  Section 4: lootFields structured encounter and ownership refs');

test('lootFields encounterId is now entityRef to encounters', () => {
  const def = extractConst('lootFields');
  includes(def, "key: 'encounterId'");
  includes(def, "entityType: 'encounters'");
});

test('lootFields has claimedByType ownership discriminator', () => {
  const def = extractConst('lootFields');
  includes(def, 'claimedByType');
});

test('lootFields has claimedById ownership id ref', () => {
  const def = extractConst('lootFields');
  includes(def, 'claimedById');
});

test('lootFields claimedBy ownership supports characters', () => {
  const def = extractConst('lootFields');
  includes(def, "'characters'");
});

test('lootFields claimedBy ownership supports npcs', () => {
  const def = extractConst('lootFields');
  includes(def, "'npcs'");
});

test('lootFields claimedBy ownership supports factions', () => {
  const def = extractConst('lootFields');
  includes(def, "'factions'");
});

test('lootFields claimedBy uses typedEntityRef type', () => {
  const def = extractConst('lootFields');
  includes(def, "type: 'typedEntityRef'");
});

test('lootFields preserves legacy claimedBy text field', () => {
  const def = extractConst('lootFields');
  includes(def, "key: 'claimedBy'");
  // Should have a text type entry for legacy
  const idx = def.lastIndexOf("key: 'claimedBy'");
  const block = def.slice(idx, idx + 90);
  includes(block, "type: 'text'");
});

// ─── Section 5: Linked name display via resolveEntityDisplay ─────────────────
console.log('\n  Section 5: Linked entity name resolution in cards');

test('itemCards uses resolveEntityDisplay for all meta field values', () => {
  const fn = src.slice(src.indexOf('function itemCards('), src.indexOf('\nconst RICH_EDIT_MAP'));
  includes(fn, 'resolveEntityDisplay');
});

test('route cards show fromRefId in meta (resolves to entity name)', () => {
  includes(src, "'fromRefId', 'toRefId', 'travelTime'");
});

test('loot cards show encounterId and claimedById in meta', () => {
  includes(src, "'encounterId', 'claimedById', 'claimedByType'");
});

test('resolveEntityDisplay is declared exactly once', () => {
  const count = (src.match(/function resolveEntityDisplay\s*\(/g) || []).length;
  assert(count === 1, `Expected 1 resolveEntityDisplay declaration, found ${count}`);
});

test('resolveEntityDisplay covers domains in its collection list', () => {
  const fn = src.slice(src.indexOf('function resolveEntityDisplay('), src.indexOf('\n// ── Vault helpers'));
  includes(fn, "'domains'");
});

test('resolveEntityDisplay covers dungeons in its collection list', () => {
  const fn = src.slice(src.indexOf('function resolveEntityDisplay('), src.indexOf('\n// ── Vault helpers'));
  includes(fn, "'dungeons'");
});

// ─── Section 6: GenericModal handles typedEntityRef field type ────────────────
console.log('\n  Section 6: GenericModal renders typedEntityRef fields');

test('GenericModal renderField handles typedEntityRef type', () => {
  const cls = src.slice(src.indexOf('class GenericModal'), src.indexOf('\n// CampaignModal'));
  includes(cls, "f.type === 'typedEntityRef'");
  includes(cls, 'addTypedEntityPicker');
});

test('GenericModal renderField handles entityRef type', () => {
  const cls = src.slice(src.indexOf('class GenericModal'), src.indexOf('\n// CampaignModal'));
  includes(cls, "f.type === 'entityRef'");
  includes(cls, 'addEntityPicker');
});

test('GenericModal renderField handles entityMultiRef type', () => {
  const cls = src.slice(src.indexOf('class GenericModal'), src.indexOf('\n// CampaignModal'));
  includes(cls, "f.type === 'entityMultiRef'");
  includes(cls, 'addEntityMultiPicker');
});

// ─── Section 7: Routes, Rooms, Religions, Loot in ENTITY_FIELD_SCHEMAS ────────
console.log('\n  Section 7: Schema registry covers all upgraded entities');

test('ENTITY_FIELD_SCHEMAS maps routes to routeFields', () => {
  const schemaStart = src.indexOf('const ENTITY_FIELD_SCHEMAS');
  const block = src.slice(schemaStart, schemaStart + 3000);
  includes(block, 'routes: routeFields');
});

test('ENTITY_FIELD_SCHEMAS maps rooms to roomFields', () => {
  const schemaStart = src.indexOf('const ENTITY_FIELD_SCHEMAS');
  const block = src.slice(schemaStart, schemaStart + 3000);
  includes(block, 'rooms: roomFields');
});

test('ENTITY_FIELD_SCHEMAS maps religions to religionFields', () => {
  const schemaStart = src.indexOf('const ENTITY_FIELD_SCHEMAS');
  const block = src.slice(schemaStart, schemaStart + 3000);
  includes(block, 'religions: religionFields');
});

test('ENTITY_FIELD_SCHEMAS maps loot to lootFields', () => {
  const schemaStart = src.indexOf('const ENTITY_FIELD_SCHEMAS');
  const block = src.slice(schemaStart, schemaStart + 3000);
  includes(block, 'loot: lootFields');
});

test('ENTITY_FIELD_SCHEMAS maps domains to domainFields', () => {
  const schemaStart = src.indexOf('const ENTITY_FIELD_SCHEMAS');
  const block = src.slice(schemaStart, schemaStart + 3000);
  includes(block, 'domains: domainFields');
});

// ─── Section 8: Legacy text preserved alongside structured refs ───────────────
console.log('\n  Section 8: Legacy text fields preserved alongside structured refs');

test('routeFields has both legacy from text AND fromRefId structured ref', () => {
  const def = extractConst('routeFields');
  includes(def, "key: 'from'");
  includes(def, "idKey: 'fromRefId'");
});

test('routeFields has both legacy to text AND toRefId structured ref', () => {
  const def = extractConst('routeFields');
  includes(def, "key: 'to'");
  includes(def, "idKey: 'toRefId'");
});

test('religionFields has both legacy domain text AND domainId entityRef', () => {
  const def = extractConst('religionFields');
  includes(def, "key: 'domain'");
  includes(def, "key: 'domainId'");
});

test('lootFields has both legacy claimedBy text AND claimedById typed ref', () => {
  const def = extractConst('lootFields');
  includes(def, "key: 'claimedBy'");
  includes(def, "claimedById");
});

// ─── Section 9: ROUTE_ENDPOINT_TYPES constant defined ────────────────────────
console.log('\n  Section 9: Shared endpoint type constants');

test('ROUTE_ENDPOINT_TYPES constant is defined', () => {
  includes(src, 'const ROUTE_ENDPOINT_TYPES = ');
});

test('ROUTE_ENDPOINT_TYPES includes all 5 atlas entity types', () => {
  const def = extractConst('ROUTE_ENDPOINT_TYPES');
  includes(def, "'regions'");
  includes(def, "'settlements'");
  includes(def, "'locations'");
  includes(def, "'pois'");
  includes(def, "'dungeons'");
});

test('routeFields references ROUTE_ENDPOINT_TYPES for both from and to', () => {
  const def = extractConst('routeFields');
  const count = (def.match(/ROUTE_ENDPOINT_TYPES/g) || []).length;
  assert(count === 2, `Expected 2 uses of ROUTE_ENDPOINT_TYPES, found ${count}`);
});

console.log(`\nPhase J — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

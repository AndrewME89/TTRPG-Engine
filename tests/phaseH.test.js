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

function extractClassSource(name) {
  const marker = `class ${name} extends Modal`;
  const start = src.indexOf(marker);
  assert(start >= 0, `Could not find class ${name}`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; if (bodyStart === -1) bodyStart = i; }
    else if (ch === '}') { depth--; if (bodyStart !== -1 && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`Could not extract class ${name}`);
}

function extractFunctionSource(name) {
  const start = src.indexOf(`function ${name}(`);
  assert(start >= 0, `Could not find function ${name}`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; if (bodyStart === -1) bodyStart = i; }
    else if (ch === '}') { depth--; if (bodyStart !== -1 && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`Could not extract function ${name}`);
}

console.log('\nPhase H — Campaign Command & Campaign Bible Cleanup\n');

// ─── Section 1: CampaignModal field round-trip ────────────────────────────────
console.log('  Section 1: CampaignModal expanded fields');

test('CampaignModal constructor includes tagline field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'tagline');
});

test('CampaignModal constructor includes premise field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'premise');
});

test('CampaignModal constructor includes format field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'format');
});

test('CampaignModal constructor includes ruleset field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'ruleset');
});

test('CampaignModal constructor includes levellingMethod field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'levellingMethod');
});

test('CampaignModal constructor includes restRules field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'restRules');
});

test('CampaignModal constructor includes deathRules field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'deathRules');
});

test('CampaignModal constructor includes magicItemAvailability field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'magicItemAvailability');
});

test('CampaignModal constructor includes playerCount field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'playerCount');
});

test('CampaignModal constructor includes worldName field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'worldName');
});

test('CampaignModal constructor includes worldPremise field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'worldPremise');
});

test('CampaignModal constructor includes worldScale field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'worldScale');
});

test('CampaignModal constructor includes tone array field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "tone: []");
});

test('CampaignModal constructor includes genres array field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "genres: []");
});

test('CampaignModal constructor includes themes array field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "themes: []");
});

test('CampaignModal constructor includes campaignLoops field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'campaignLoops');
});

test('CampaignModal constructor includes partyNotes field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'partyNotes');
});

test('CampaignModal constructor includes structureNotes field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'structureNotes');
});

test('CampaignModal constructor includes playerPrimer field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'playerPrimer');
});

test('CampaignModal uses Object.assign to preserve existing campaign fields', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'Object.assign');
  includes(cls, 'this.item');
});

// ─── Section 2: Wizard-created fields are editable ───────────────────────────
console.log('\n  Section 2: Wizard-created fields editable in CampaignModal');

test('CampaignModal onOpen renders tagline field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "Tagline");
});

test('CampaignModal onOpen renders format selector using OPTION_BANKS', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'OPTION_BANKS.formats');
});

test('CampaignModal onOpen renders ruleset selector', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'OPTION_BANKS.rulesets');
});

test('CampaignModal onOpen renders levellingMethod selector', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'OPTION_BANKS.levellingMethods');
});

test('CampaignModal onOpen renders restRules selector', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'OPTION_BANKS.restRules');
});

test('CampaignModal onOpen renders deathRules selector', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'OPTION_BANKS.deathRules');
});

test('CampaignModal onOpen renders magicItemAvailability selector', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'OPTION_BANKS.magicItemAvailability');
});

test('CampaignModal onOpen renders tone chipField', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "bank: 'tones'");
});

test('CampaignModal onOpen renders genres chipField', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "bank: 'genres'");
});

test('CampaignModal onOpen renders themes chipField', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "bank: 'themes'");
});

test('CampaignModal onOpen renders campaignLoops chipField', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, "bank: 'campaignLoops'");
});

test('CampaignModal onOpen renders worldName field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'World Name');
});

test('CampaignModal onOpen renders playerCount number field', () => {
  const cls = extractClassSource('CampaignModal');
  includes(cls, 'Player Count');
});

// ─── Section 3: CampaignBibleModal narrowed to textual fields ─────────────────
console.log('\n  Section 3: CampaignBibleModal narrowed to textual fields');

test('CampaignBibleModal does not edit embedded acts array (no "+ Add Act" button)', () => {
  const cls = extractClassSource('CampaignBibleModal');
  notIncludes(cls, '+ Add Act');
});

test('CampaignBibleModal does not render act title/summary edit fields', () => {
  const cls = extractClassSource('CampaignBibleModal');
  notIncludes(cls, 'Act Structure');
});

test('CampaignBibleModal retains premise textual field', () => {
  const cls = extractClassSource('CampaignBibleModal');
  includes(cls, 'Premise');
});

test('CampaignBibleModal retains tone selector', () => {
  const cls = extractClassSource('CampaignBibleModal');
  includes(cls, 'OPTION_BANKS.tones');
});

test('CampaignBibleModal retains genre selector', () => {
  const cls = extractClassSource('CampaignBibleModal');
  includes(cls, 'OPTION_BANKS.genres');
});

test('CampaignBibleModal retains themes chipField', () => {
  const cls = extractClassSource('CampaignBibleModal');
  includes(cls, "bank: 'themes'");
});

test('CampaignBibleModal retains playerPrimer field', () => {
  const cls = extractClassSource('CampaignBibleModal');
  includes(cls, 'playerPrimer');
});

test('CampaignBibleModal retains DM notes field', () => {
  const cls = extractClassSource('CampaignBibleModal');
  includes(cls, 'DM Notes');
});

test('CampaignBibleModal shows legacy embedded acts notice when acts present', () => {
  const cls = extractClassSource('CampaignBibleModal');
  includes(cls, 'Legacy Embedded Acts');
  includes(cls, 'Promote to Entity');
});

// ─── Section 4: renderCampaignBible canonical entity-backed structure ─────────
console.log('\n  Section 4: renderCampaignBible reads from canonical entities');

test('renderCampaignBible reads acts from state.entities.acts', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'state.entities.acts');
});

test('renderCampaignBible reads milestones from state.entities.milestones', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'state.entities.milestones');
});

test('renderCampaignBible reads factions from state.entities.factions', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'state.entities.factions');
});

test('renderCampaignBible reads domains from state.entities.domains', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'state.entities.domains');
});

test('renderCampaignBible shows legacy bible acts as fallback when no entity acts', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'bibActs');
  includes(fn, 'Promote to Entity');
});

test('renderCampaignBible filters entities by campaignId', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'campaignId === campId');
});

// ─── Section 5: No primary DM Screen launcher in Campaign Command ─────────────
console.log('\n  Section 5: No visible DM Screen launcher in Campaign Command');

test('Dashboard Quick Access has no "DM Screen" card title', () => {
  const fn = extractFunctionSource('renderDashboard');
  notIncludes(fn, "'DM Screen'");
  notIncludes(fn, '"DM Screen"');
});

test('Dashboard Quick Access routes run-session action to campaigns run-session subsection', () => {
  const fn = extractFunctionSource('renderDashboard');
  includes(fn, 'run-session');
});

test('renderCampaignCommand redirects dmscreen to run-session', () => {
  const fn = extractFunctionSource('renderCampaignCommand');
  includes(fn, "sub === 'dmscreen'");
  includes(fn, "'run-session'");
});

// ─── Section 6: Campaign-scoped record isolation ──────────────────────────────
console.log('\n  Section 6: Campaign-scoped entity isolation');

test('renderCampaignBible filters acts by campaignId', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'a.campaignId === campId');
});

test('renderCampaignBible filters milestones by campaignId', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'm.campaignId');
});

test('renderCampaignBible filters factions by campaignId', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'f.campaignId');
});

test('renderCampaignBible filters domains by campaignId', () => {
  const fn = extractFunctionSource('renderCampaignBible');
  includes(fn, 'd.campaignId');
});

// ─── Section 7: Linked entities shown as collections not duplicated ────────────
console.log('\n  Section 7: Linked entities derived, not duplicated on campaign');

test('CampaignModal does not store linkedActIds on campaign object', () => {
  const cls = extractClassSource('CampaignModal');
  notIncludes(cls, 'linkedActIds');
});

test('CampaignModal does not store linkedFactionIds on campaign object', () => {
  const cls = extractClassSource('CampaignModal');
  notIncludes(cls, 'linkedFactionIds');
});

test('CampaignModal does not store linkedDomainIds on campaign object', () => {
  const cls = extractClassSource('CampaignModal');
  notIncludes(cls, 'linkedDomainIds');
});

test('CampaignModal does not store linkedMilestoneIds on campaign object', () => {
  const cls = extractClassSource('CampaignModal');
  notIncludes(cls, 'linkedMilestoneIds');
});

console.log(`\nPhase H — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

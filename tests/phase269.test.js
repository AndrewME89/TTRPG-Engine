'use strict';
/**
 * Phase 269 — Navigation Restructuring
 * Tests: dmNavGroups workspace structure, activeSubSection state,
 *        renderSection routing (workspaces + legacy aliases),
 *        workspaceTabs helper, workspace render functions.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── Load source ───────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stdout.write(`  ✗ ${name}\n    ${e.message}\n`); }
}
function ok(cond, msg) { assert.ok(cond, msg); }

// ── Extract dmNavGroups structure from source ─────────────────────────────────
// Parse nav group labels and ids from the source text
function extractNavGroups(src) {
  const match = src.match(/const dmNavGroups = \[([\s\S]*?)\];\s*\n\s*const pcNavGroups/);
  if (!match) return null;
  const block = match[1];
  const groups = [];
  const groupRe = /\{ label: '([^']+)', items: \[([\s\S]*?)\]\}/g;
  let gm;
  while ((gm = groupRe.exec(block)) !== null) {
    const label = gm[1];
    const items = [];
    const itemRe = /\{ id: '([^']+)'/g;
    let im;
    while ((im = itemRe.exec(gm[2])) !== null) items.push(im[1]);
    groups.push({ label, items });
  }
  return groups;
}

// ── Extract workspace functions list ─────────────────────────────────────────
function hasFunction(name) {
  return new RegExp(`^function ${name}\\s*\\(`, 'm').test(src);
}

// ── Extract renderSection map keys ───────────────────────────────────────────
function extractSectionMapKeys(src) {
  const match = src.match(/function renderSection\([\s\S]*?const map = \{([\s\S]*?)\};\s*\(map\[section\]/);
  if (!match) return [];
  const keys = [];
  const re = /^\s+['"]?([\w-]+)['"]?\s*:/gm;
  let m;
  while ((m = re.exec(match[1])) !== null) keys.push(m[1]);
  return keys;
}

// ── Tests: dmNavGroups ────────────────────────────────────────────────────────
console.log('\nPhase 269 — Navigation Restructuring\n');
console.log('  dmNavGroups structure');

const navGroups = extractNavGroups(src);

test('dmNavGroups is present and parseable', () => {
  ok(navGroups !== null, 'Could not parse dmNavGroups');
});

test('dmNavGroups has 5 groups', () => {
  ok(navGroups && navGroups.length === 5, `Expected 5 groups, got ${navGroups && navGroups.length}`);
});

test('dmNavGroups contains dashboard nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('dashboard'), 'Missing dashboard');
});

test('dmNavGroups contains campaign-command nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('campaign-command'), 'Missing campaign-command');
});

test('dmNavGroups contains world-atlas nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('world-atlas'), 'Missing world-atlas');
});

test('dmNavGroups contains cast-powers nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('cast-powers'), 'Missing cast-powers');
});

test('dmNavGroups contains adventure-planner nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('adventure-planner'), 'Missing adventure-planner');
});

test('dmNavGroups contains secrets-handouts nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('secrets-handouts'), 'Missing secrets-handouts');
});

test('dmNavGroups contains compendium-library nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('compendium-library'), 'Missing compendium-library');
});

test('dmNavGroups contains generators nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('generators'), 'Missing generators');
});

test('dmNavGroups contains settings-tools nav item', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  ok(allIds.includes('settings-tools'), 'Missing settings-tools');
});

test('dmNavGroups does NOT contain old flat nav items as top-level', () => {
  const allIds = navGroups ? navGroups.flatMap(g => g.items) : [];
  const oldItems = ['campaigns', 'bible', 'world', 'geography', 'npcs', 'factions',
    'adventure', 'encounters', 'sessions', 'secrets', 'library', 'homebrew',
    'reference', 'downtime', 'war-machine', 'endgame', 'rules'];
  const found = oldItems.filter(id => allIds.includes(id));
  ok(found.length === 0, `Old flat nav items still in top-level nav: ${found.join(', ')}`);
});

// ── Tests: activeSubSection in default state ──────────────────────────────────
console.log('\n  activeSubSection state');

test('activeSubSection is defined in createDefaultState', () => {
  ok(src.includes("activeSubSection: ''"), "activeSubSection missing from createDefaultState");
});

test('activeSubSection is reset on nav click', () => {
  ok(src.includes("state.activeSubSection = ''"), "activeSubSection not reset on nav change");
});

// ── Tests: renderSection routes ───────────────────────────────────────────────
console.log('\n  renderSection routing');

const sectionKeys = extractSectionMapKeys(src);

test('renderSection has dashboard route', () => {
  ok(sectionKeys.includes('dashboard'), 'Missing dashboard route');
});

test('renderSection has campaign-command route', () => {
  ok(sectionKeys.includes('campaign-command'), 'Missing campaign-command route');
});

test('renderSection has world-atlas route', () => {
  ok(sectionKeys.includes('world-atlas'), 'Missing world-atlas route');
});

test('renderSection has cast-powers route', () => {
  ok(sectionKeys.includes('cast-powers'), 'Missing cast-powers route');
});

test('renderSection has adventure-planner route', () => {
  ok(sectionKeys.includes('adventure-planner'), 'Missing adventure-planner route');
});

test('renderSection has secrets-handouts route', () => {
  ok(sectionKeys.includes('secrets-handouts'), 'Missing secrets-handouts route');
});

test('renderSection has compendium-library route', () => {
  ok(sectionKeys.includes('compendium-library'), 'Missing compendium-library route');
});

test('renderSection has settings-tools route', () => {
  ok(sectionKeys.includes('settings-tools'), 'Missing settings-tools route');
});

// Legacy aliases
test('renderSection has legacy campaigns alias', () => {
  ok(sectionKeys.includes('campaigns'), 'Missing legacy campaigns alias');
});

test('renderSection has legacy bible alias', () => {
  ok(sectionKeys.includes('bible'), 'Missing legacy bible alias');
});

test('renderSection has legacy world alias', () => {
  ok(sectionKeys.includes('world'), 'Missing legacy world alias');
});

test('renderSection has legacy geography alias', () => {
  ok(sectionKeys.includes('geography'), 'Missing legacy geography alias');
});

test('renderSection has legacy npcs alias', () => {
  ok(sectionKeys.includes('npcs'), 'Missing legacy npcs alias');
});

test('renderSection has legacy factions alias', () => {
  ok(sectionKeys.includes('factions'), 'Missing legacy factions alias');
});

test('renderSection has legacy adventure alias', () => {
  ok(sectionKeys.includes('adventure'), 'Missing legacy adventure alias');
});

test('renderSection has legacy encounters alias', () => {
  ok(sectionKeys.includes('encounters'), 'Missing legacy encounters alias');
});

test('renderSection has legacy sessions alias', () => {
  ok(sectionKeys.includes('sessions'), 'Missing legacy sessions alias');
});

test('renderSection has legacy secrets alias', () => {
  ok(sectionKeys.includes('secrets'), 'Missing legacy secrets alias');
});

test('renderSection has legacy run-session alias', () => {
  ok(sectionKeys.includes('run-session'), 'Missing legacy run-session alias');
});

test('renderSection has legacy war-machine alias', () => {
  ok(sectionKeys.includes('war-machine'), 'Missing legacy war-machine alias');
});

test('renderSection has legacy endgame alias', () => {
  ok(sectionKeys.includes('endgame'), 'Missing legacy endgame alias');
});

test('renderSection has legacy library alias', () => {
  ok(sectionKeys.includes('library'), 'Missing legacy library alias');
});

test('renderSection has legacy homebrew alias', () => {
  ok(sectionKeys.includes('homebrew'), 'Missing legacy homebrew alias');
});

test('renderSection has legacy faction-matrix alias', () => {
  ok(sectionKeys.includes('faction-matrix'), 'Missing legacy faction-matrix alias');
});

test('renderSection has legacy relationship-matrix alias', () => {
  ok(sectionKeys.includes('relationship-matrix'), 'Missing legacy relationship-matrix alias');
});

// ── Tests: workspace render functions ────────────────────────────────────────
console.log('\n  workspace render functions');

test('workspaceTabs function exists', () => ok(hasFunction('workspaceTabs'), 'workspaceTabs missing'));
test('renderCampaignCommand function exists', () => ok(hasFunction('renderCampaignCommand'), 'renderCampaignCommand missing'));
test('renderWorldAtlas function exists', () => ok(hasFunction('renderWorldAtlas'), 'renderWorldAtlas missing'));
test('renderCastPowers function exists', () => ok(hasFunction('renderCastPowers'), 'renderCastPowers missing'));
test('renderAdventurePlanner function exists', () => ok(hasFunction('renderAdventurePlanner'), 'renderAdventurePlanner missing'));
test('renderSecretsHandouts function exists', () => ok(hasFunction('renderSecretsHandouts'), 'renderSecretsHandouts missing'));
test('renderCompendiumLibrary function exists', () => ok(hasFunction('renderCompendiumLibrary'), 'renderCompendiumLibrary missing'));
test('renderSettingsTools function exists', () => ok(hasFunction('renderSettingsTools'), 'renderSettingsTools missing'));
test('renderMyContent function exists', () => ok(hasFunction('renderMyContent'), 'renderMyContent missing'));
test('renderNobleFamiliesSection function exists', () => ok(hasFunction('renderNobleFamiliesSection'), 'renderNobleFamiliesSection missing'));
test('renderMilestonesSection function exists', () => ok(hasFunction('renderMilestonesSection'), 'renderMilestonesSection missing'));

// ── Tests: workspace sub-tab definitions ─────────────────────────────────────
console.log('\n  workspace sub-tab content');

test('renderCampaignCommand includes campaigns sub-tab', () => {
  ok(src.includes("id: 'campaigns'") && src.includes("📜 Campaigns"), 'Missing campaigns sub-tab in CampaignCommand');
});

test('renderCampaignCommand includes bible sub-tab', () => {
  ok(src.includes("id: 'bible'") && src.includes("📖 Campaign Bible"), 'Missing bible sub-tab');
});

test('renderCampaignCommand includes sessions sub-tab', () => {
  ok(src.includes("id: 'sessions'") && src.includes("📅 Sessions"), 'Missing sessions sub-tab');
});

test('renderWorldAtlas includes lore sub-tab', () => {
  ok(src.includes("id: 'lore'") && src.includes("🌍 World & Lore"), 'Missing lore sub-tab');
});

test('renderWorldAtlas includes geography sub-tab', () => {
  ok(src.includes("id: 'geography'") && src.includes("Geography & Maps"), 'Missing geography sub-tab');
});

test('renderCastPowers includes npcs sub-tab', () => {
  ok(src.includes("id: 'npcs'") && src.includes("NPCs & Creatures"), 'Missing npcs sub-tab');
});

test('renderCastPowers redirects noble-families to factions (tab removed in Phase E)', () => {
  // noble-families tab removed; verify redirect exists instead
  const fn = src.slice(src.indexOf('function renderCastPowers'), src.indexOf('function renderNobleFamiliesSection'));
  ok(fn.includes("sub === 'noble-families'") && fn.includes("sub = 'factions'"), 'Missing noble-families redirect');
});

test('renderAdventurePlanner includes adventures sub-tab', () => {
  ok(src.includes("id: 'adventures'") && src.includes("📝 Adventures"), 'Missing adventures sub-tab');
});

test('renderAdventurePlanner includes war-machine sub-tab', () => {
  ok(src.includes("id: 'war-machine'"), 'Missing war-machine sub-tab');
});

test('renderCompendiumLibrary includes my-content sub-tab', () => {
  ok(src.includes("id: 'my-content'"), 'Missing my-content sub-tab');
});

test('renderSettingsTools includes diagnostics sub-tab', () => {
  ok(src.includes("id: 'diagnostics'"), 'Missing diagnostics sub-tab');
});

test('renderSettingsTools includes repair sub-tab', () => {
  ok(src.includes("id: 'repair'"), 'Missing repair sub-tab');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`  ${passed} passed  ${failed} failed  (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);

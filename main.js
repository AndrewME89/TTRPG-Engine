'use strict';
const { Plugin, ItemView, Modal, Notice, Setting, normalizePath } = require('obsidian');

// ── Constants ────────────────────────────────────────────────────────────────
const VIEW_TYPE = 'ttrpg-engine-view';
const PLUGIN_VERSION = '2.0.0';
const PLUGIN_DIR = '.obsidian/plugins/ttrpg-engine';
const KILL_SWITCH_FILES = [
  `${PLUGIN_DIR}/DISABLE_TTRPG_ENGINE.txt`,
  `${PLUGIN_DIR}/TTRPG_ENGINE_DISABLED.txt`,
  `${PLUGIN_DIR}/SAFE_MODE.txt`,
];
const BOOT_MARKER = `${PLUGIN_DIR}/TTRPG_ENGINE_BOOTING.txt`;
const LOAD_FAILED = `${PLUGIN_DIR}/TTRPG_ENGINE_LOAD_FAILED.txt`;
const CRASH_REPORT = `${PLUGIN_DIR}/TTRPG_ENGINE_LAST_CRASH.txt`;

// ── Kill-switch helpers ───────────────────────────────────────────────────────
async function adapterExists(app, p) {
  try { return !!(await app.vault.adapter.exists(p)); } catch { return false; }
}
async function adapterRead(app, p) {
  try { return await app.vault.adapter.read(p); } catch { return ''; }
}
async function adapterWrite(app, p, t) {
  try { await app.vault.adapter.write(p, String(t || '')); return true; } catch { return false; }
}
async function adapterRemove(app, p) {
  try { if (await adapterExists(app, p)) await app.vault.adapter.remove(p); } catch {}
}
async function checkKillSwitch(app) {
  for (const f of KILL_SWITCH_FILES) { if (await adapterExists(app, f)) return f; }
  return '';
}
async function checkLoadFailed(app) {
  return (await adapterExists(app, LOAD_FAILED)) ? LOAD_FAILED : '';
}
async function safeDisable(app, reason, err) {
  const stamp = new Date().toISOString();
  const msg = `TTRPG Engine safety-disabled at ${stamp}.\n\nReason: ${reason}\n\n${err ? String(err.stack || err) : ''}`;
  await adapterWrite(app, LOAD_FAILED, msg);
  await adapterWrite(app, KILL_SWITCH_FILES[1], msg);
  await adapterWrite(app, CRASH_REPORT, msg);
}
async function beginBoot(plugin) {
  const app = plugin.app;
  const ks = await checkKillSwitch(app);
  if (ks) return { ok: false, reason: `Kill switch active: ${ks}` };
  const lf = await checkLoadFailed(app);
  if (lf) {
    const report = await adapterRead(app, lf);
    return { ok: false, reason: `Previous crash detected. Delete ${LOAD_FAILED} to re-enable.\n\n${report}` };
  }
  await adapterRemove(app, BOOT_MARKER);
  await adapterWrite(app, BOOT_MARKER, `Boot started ${new Date().toISOString()}`);
  return { ok: true };
}
async function endBoot(plugin) {
  await adapterRemove(plugin.app, BOOT_MARKER);
}

// ── Safe-mode & crash-lock helpers ────────────────────────────────────────────
const SAFE_MODE_FILE = `${PLUGIN_DIR}/SAFE_MODE.txt`;
async function safeModeActive(app) { return adapterExists(app, SAFE_MODE_FILE); }
async function enableSafeMode(app) { await adapterWrite(app, SAFE_MODE_FILE, `Safe mode enabled ${new Date().toISOString()}`); }
async function disableSafeMode(app) { await adapterRemove(app, SAFE_MODE_FILE); }
async function clearCrashLock(app) { await adapterRemove(app, LOAD_FAILED); }
async function readCrashReport(app) { return (await adapterExists(app, CRASH_REPORT)) ? adapterRead(app, CRASH_REPORT) : ''; }

// ── Tile assets ───────────────────────────────────────────────────────────────
const TILE_ASSETS = [
  { id:'grass',    icon:'🌿', label:'Grass' },
  { id:'water',    icon:'🌊', label:'Water' },
  { id:'mountain', icon:'⛰️',  label:'Mountain' },
  { id:'forest',   icon:'🌲', label:'Forest' },
  { id:'desert',   icon:'🏜️', label:'Desert' },
  { id:'road',     icon:'🛤️',  label:'Road' },
  { id:'village',  icon:'🏘️', label:'Village' },
  { id:'town',     icon:'🏙️', label:'Town' },
  { id:'castle',   icon:'🏰', label:'Castle' },
  { id:'dungeon',  icon:'🕳️', label:'Dungeon' },
  { id:'cave',     icon:'🪨', label:'Cave' },
  { id:'ruin',     icon:'🏚️', label:'Ruin' },
  { id:'port',     icon:'⚓', label:'Port' },
  { id:'tower',    icon:'🗼', label:'Tower' },
  { id:'temple',   icon:'🛕', label:'Temple' },
  { id:'camp',     icon:'⛺', label:'Camp' },
  { id:'bridge',   icon:'🌉', label:'Bridge' },
  { id:'swamp',    icon:'🍂', label:'Swamp' },
  { id:'tundra',   icon:'❄️',  label:'Tundra' },
  { id:'volcano',  icon:'🌋', label:'Volcano' },
  { id:'plains',   icon:'🌾', label:'Plains' },
  { id:'hills',    icon:'🏔️', label:'Hills' },
  { id:'coast',    icon:'🏖️', label:'Coast' },
  { id:'inn',      icon:'🏨', label:'Inn / Tavern' },
  { id:'market',   icon:'🏪', label:'Market' },
];

// ── 5e canonical lists ────────────────────────────────────────────────────────
const ANCESTRIES = ['Dragonborn','Dwarf','Elf','Gnome','Half-Elf','Half-Orc','Halfling','Human','Tiefling',
  'Aasimar','Genasi','Goliath','Tabaxi','Kenku','Lizardfolk','Triton','Yuan-ti Pureblood',
  'Firbolg','Bugbear','Goblin','Hobgoblin','Kobold','Orc','Tortle','Changeling','Kalashtar',
  'Shifter','Warforged','Centaur','Loxodon','Minotaur','Simic Hybrid','Vedalken','Other'];
const CLASSES = ['Artificer','Barbarian','Bard','Cleric','Druid','Fighter','Monk','Paladin',
  'Ranger','Rogue','Sorcerer','Warlock','Wizard'];
const BACKGROUNDS = ['Acolyte','Charlatan','Criminal','Entertainer','Folk Hero','Guild Artisan',
  'Hermit','Noble','Outlander','Sage','Sailor','Soldier','Urchin','Custom'];
const CREATURE_TYPES = ['Aberration','Beast','Celestial','Construct','Dragon','Elemental',
  'Fey','Fiend','Giant','Humanoid','Monstrosity','Ooze','Plant','Undead'];
const SIZES = ['Tiny','Small','Medium','Large','Huge','Gargantuan'];
const ALIGNMENTS = ['Lawful Good','Neutral Good','Chaotic Good','Lawful Neutral','True Neutral',
  'Chaotic Neutral','Lawful Evil','Neutral Evil','Chaotic Evil','Unaligned'];
const CONDITIONS_LIST = ['Blinded','Charmed','Deafened','Exhaustion (1)','Exhaustion (2)',
  'Exhaustion (3)','Exhaustion (4)','Exhaustion (5)','Exhaustion (6)',
  'Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified',
  'Poisoned','Prone','Restrained','Stunned','Unconscious'];
const SPELLCASTING_CLASSES = ['Artificer','Bard','Cleric','Druid','Paladin','Ranger','Sorcerer','Warlock','Wizard'];

// ── Seed data ────────────────────────────────────────────────────────────────
function seedConditions() {
  const data = {
    Blinded: 'A blinded creature can\'t see and automatically fails any ability check requiring sight. Attack rolls against it have advantage; its own attack rolls have disadvantage.',
    Charmed: 'A charmed creature can\'t attack the charmer or target them with harmful abilities. The charmer has advantage on Charisma checks against the creature.',
    Deafened: 'A deafened creature can\'t hear and automatically fails any ability check requiring hearing.',
    Frightened: 'A frightened creature has disadvantage on ability checks and attack rolls while the source of fear is in line of sight. It can\'t willingly move closer to the source.',
    Grappled: 'A grappled creature\'s speed becomes 0. The condition ends if the grappler becomes incapacitated, or if the creature escapes.',
    Incapacitated: 'An incapacitated creature can\'t take actions or reactions.',
    Invisible: 'An invisible creature is impossible to see without special sense. Attacks against it have disadvantage; its attacks have advantage.',
    Paralyzed: 'A paralyzed creature is incapacitated, can\'t move or speak. Attacks against it have advantage. Any attack that hits from within 5 ft is a critical hit.',
    Petrified: 'A petrified creature is transformed to stone, incapacitated, and unaware of surroundings. Attacks have advantage; it fails STR and DEX saves. Resistant to all damage; immune to poison and disease.',
    Poisoned: 'A poisoned creature has disadvantage on attack rolls and ability checks.',
    Prone: 'A prone creature must crawl or spend half its speed to stand up. Attacks have advantage if attacker is within 5 ft; otherwise disadvantage. Its own attacks have disadvantage.',
    Restrained: 'A restrained creature\'s speed becomes 0. Attacks against it have advantage; its own attacks have disadvantage. It has disadvantage on DEX saving throws.',
    Stunned: 'A stunned creature is incapacitated, can\'t move, and can only speak falteringly. Attacks against it have advantage; it fails STR and DEX saving throws.',
    Unconscious: 'An unconscious creature is incapacitated, can\'t move or speak, unaware of surroundings. It drops anything held and falls prone. Attacks against it have advantage. Any attack from within 5 ft is a critical hit.',
  };
  return Object.entries(data).map(([name, summary]) => ({ id: uid('cond'), name, summary, category: 'Condition', tags: [] }));
}
function seedDamageTypes() {
  return ['Acid','Bludgeoning','Cold','Fire','Force','Lightning','Necrotic','Piercing',
    'Poison','Psychic','Radiant','Slashing','Thunder'].map(name => ({
    id: uid('dmg'), name, category: 'Damage Type',
    summary: `Track resistance, immunity, and vulnerability to ${name} damage.`, tags: []
  }));
}
function seedRules() {
  return [
    { id: uid('rule'), name: 'Advantage & Disadvantage', category: 'Core', summary: 'Roll two d20s; take higher (advantage) or lower (disadvantage). Conditions and abilities grant these states. They cancel out if both apply.' },
    { id: uid('rule'), name: 'Concentration', category: 'Spellcasting', summary: 'Maintain a concentration spell until you cast another, take damage (CON save DC 10 or half damage taken), are incapacitated, or die.' },
    { id: uid('rule'), name: 'Cover', category: 'Combat', summary: 'Half cover: +2 AC & DEX saves. Three-quarters cover: +5 AC & DEX saves. Total cover: cannot be targeted directly.' },
    { id: uid('rule'), name: 'Death Saving Throws', category: 'Combat', summary: 'At 0 HP roll d20 each turn: 10+ = success, else failure. 3 successes = stable. 3 failures = dead. Natural 20 restores 1 HP. Natural 1 counts as two failures.' },
    { id: uid('rule'), name: 'Travel Pace', category: 'Exploration', summary: 'Fast: 4 mph, −5 Passive Perception. Normal: 3 mph. Slow: 2 mph, can use Stealth.' },
  ];
}
function seedCompendium() {
  return [
    { id: uid('comp'), name: 'Fire Bolt', type: 'Spell', source: 'SRD', level: 'Cantrip', summary: 'Ranged spell attack (120 ft). 1d10 fire damage (increases at lvl 5/11/17). Flammable objects ignite.' },
    { id: uid('comp'), name: 'Fireball', type: 'Spell', source: 'SRD', level: '3rd', summary: '20-ft radius blast, 150 ft range. 8d6 fire damage, DEX save DC 13+ for half. +1d6/slot above 3rd.' },
    { id: uid('comp'), name: 'Cure Wounds', type: 'Spell', source: 'SRD', level: '1st', summary: 'Touch range. Restore 1d8 + spellcasting modifier HP. No effect on undead or constructs.' },
    { id: uid('comp'), name: 'Longsword', type: 'Weapon', source: 'SRD', summary: 'Martial melee. 1d8 slashing (1d10 versatile). 15 gp, 3 lb.' },
    { id: uid('comp'), name: 'Shield', type: 'Armour', source: 'SRD', summary: '+2 AC. Requires one free hand. 10 gp, 6 lb.' },
    { id: uid('comp'), name: 'Goblin', type: 'Monster', source: 'SRD', summary: 'Small humanoid. CR 1/4. AC 15, HP 7, Speed 30. Nimble Escape: disengage or hide as bonus action.' },
    { id: uid('comp'), name: 'Skeleton', type: 'Monster', source: 'SRD', summary: 'Medium undead. CR 1/4. AC 13, HP 13. Immune to poison, exhaustion. Vulnerable to bludgeoning.' },
  ];
}

// ── Default state ────────────────────────────────────────────────────────────
function createDefaultState() {
  return {
    version: PLUGIN_VERSION,
    mode: 'DM',
    activeSection: 'dashboard',
    sidebarCollapsed: false,
    activeCampaignId: '',
    search: '',
    calendar: { name: '', year: 1, month: '', day: 1, moons: '', seasons: '', holidays: '' },
    settings: { compact: false },
    initiativeTracker: { combatants: [], currentIndex: 0, round: 1, active: false },
    tileMap: { tiles: [], nextId: 1, mapName: 'Untitled Map' },
    playerTab: 'overview',
    entities: {
      campaigns: [],
      worlds: [], cosmologies: [], realms: [],
      regions: [], settlements: [], locations: [], pois: [], routes: [],
      npcs: [], creatures: [], bbegs: [],
      factions: [],
      cultures: [], languages: [], deities: [], pantheons: [],
      quests: [], adventures: [],
      encounters: [],
      sessions: [], milestones: [],
      secrets: [], handouts: [],
      rules: [], conditions: [], damageTypes: [],
      downtime: [], projects: [], bastions: [],
      compendium: [], homebrew: [], tables: [],
      characters: [],
      calendars: [],
      journals: [],
    },
    generatorHistory: [],
    diceHistory: [],
  };
}

function migrateState(state) {
  const def = createDefaultState();
  // Ensure top-level keys
  for (const k of Object.keys(def)) {
    if (state[k] === undefined) state[k] = def[k];
  }
  // Ensure entity keys
  for (const k of Object.keys(def.entities)) {
    if (!Array.isArray(state.entities[k])) state.entities[k] = def.entities[k];
  }
  // Ensure settings keys
  for (const k of Object.keys(def.settings)) {
    if (state.settings[k] === undefined) state.settings[k] = def.settings[k];
  }
  // Ensure initiativeTracker keys
  for (const k of Object.keys(def.initiativeTracker)) {
    if (state.initiativeTracker[k] === undefined) state.initiativeTracker[k] = def.initiativeTracker[k];
  }
  // Ensure tileMap keys
  if (!state.tileMap || typeof state.tileMap !== 'object') state.tileMap = def.tileMap;
  if (!Array.isArray(state.tileMap.tiles)) state.tileMap.tiles = [];
  if (!state.tileMap.nextId) state.tileMap.nextId = 1;
  // Seed reference data if empty
  if (!state.entities.conditions.length) state.entities.conditions = seedConditions();
  if (!state.entities.damageTypes.length) state.entities.damageTypes = seedDamageTypes();
  if (!state.entities.rules.length) state.entities.rules = seedRules();
  if (!state.entities.compendium.length) state.entities.compendium = seedCompendium();
  state.version = PLUGIN_VERSION;
}

// ── Utilities ────────────────────────────────────────────────────────────────
function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function slugify(v) { return String(v || 'untitled').replace(/[\\/:*?"<>|#^[\]]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'untitled'; }
function ce(parent, tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  parent.appendChild(el);
  return el;
}
function btn(parent, text, cls, onClick) {
  const b = ce(parent, 'button', cls || 'te-btn', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
function clear(el) { el.replaceChildren(); }
function safeArr(v) { return Array.isArray(v) ? v : []; }
function activeCampaign(state) {
  return safeArr(state.entities.campaigns).find(c => c.id === state.activeCampaignId)
    || safeArr(state.entities.campaigns).find(c => c.status !== 'Archived')
    || null;
}
function campaignFolder(plugin) {
  const c = activeCampaign(plugin.state);
  return c ? (slugify(c.name) || 'Unassigned') : 'Unassigned';
}
function modifier(score) { return Math.floor((Number(score || 10) - 10) / 2); }
function modStr(score) { const m = modifier(score); return (m >= 0 ? '+' : '') + m; }
function profBonus(level) { return Math.ceil(Math.max(1, Number(level || 1)) / 4) + 1; }

function upsert(state, key, item) {
  if (!Array.isArray(state.entities[key])) state.entities[key] = [];
  const i = state.entities[key].findIndex(x => x.id === item.id);
  if (i >= 0) state.entities[key][i] = item; else state.entities[key].unshift(item);
}
function removeItem(state, key, id) {
  if (Array.isArray(state.entities[key])) state.entities[key] = state.entities[key].filter(x => x.id !== id);
}

function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const fields = [item.name, item.title, item.summary, item.description, item.type, item.category, item.status,
    Array.isArray(item.tags) ? item.tags.join(' ') : ''].map(v => String(v || '')).join(' ').toLowerCase();
  return fields.includes(needle);
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
async function runDiagnostics(plugin) {
  const state = plugin.state;
  const e = state.entities || {};
  const issues = [];
  const info = [];

  // System info
  const counts = {};
  for (const [k, arr] of Object.entries(e)) counts[k] = Array.isArray(arr) ? arr.length : 0;
  info.push(`Plugin version: ${PLUGIN_VERSION}`);
  info.push(`State version: ${state.version || 'unknown'}`);

  // Active campaign
  const camp = activeCampaign(state);
  if (!camp) {
    if (!safeArr(e.campaigns).length) issues.push({ sev: 'warn', msg: 'No campaigns exist. Create one to get started.' });
    else issues.push({ sev: 'warn', msg: 'No active campaign set — open Campaigns and activate one.' });
  } else {
    info.push(`Active campaign: "${camp.name}" (${camp.id})`);
  }

  // Duplicate IDs
  for (const [key, arr] of Object.entries(e)) {
    if (!Array.isArray(arr)) continue;
    const seen = new Set();
    arr.forEach(item => {
      if (!item.id) { issues.push({ sev: 'error', msg: `${key}: item "${item.name || '?'}" has no ID.` }); }
      else if (seen.has(item.id)) { issues.push({ sev: 'error', msg: `${key}: duplicate ID "${item.id}" (${item.name || '?'}).` }); }
      else seen.add(item.id);
    });
  }

  // Orphaned campaign references
  const campaignIds = new Set(safeArr(e.campaigns).map(c => c.id));
  const needsCampaign = ['npcs','creatures','bbegs','factions','quests','adventures','encounters','sessions','secrets','handouts','regions','settlements','locations'];
  needsCampaign.forEach(key => safeArr(e[key]).forEach(item => {
    if (item.campaignId && !campaignIds.has(item.campaignId))
      issues.push({ sev: 'warn', msg: `${key} "${item.name || item.id}": references missing campaign "${item.campaignId}".` });
  }));

  // Broken parent references
  const factionIds = new Set(safeArr(e.factions).map(x => x.id));
  const adventureIds = new Set(safeArr(e.adventures).map(x => x.id));
  const regionIds = new Set(safeArr(e.regions).map(x => x.id));
  safeArr(e.npcs).forEach(npc => {
    if (npc.factionId && !factionIds.has(npc.factionId))
      issues.push({ sev: 'warn', msg: `NPC "${npc.name || npc.id}": references missing faction "${npc.factionId}".` });
  });
  safeArr(e.quests).forEach(q => {
    if (q.adventureId && !adventureIds.has(q.adventureId))
      issues.push({ sev: 'warn', msg: `Quest "${q.name || q.id}": references missing adventure "${q.adventureId}".` });
  });
  safeArr(e.settlements).forEach(s => {
    if (s.regionId && !regionIds.has(s.regionId))
      issues.push({ sev: 'warn', msg: `Settlement "${s.name || s.id}": references missing region "${s.regionId}".` });
  });

  // Invalid visibility states
  const validVis = new Set(['dm-only', 'player-visible', 'revealed']);
  ['secrets','handouts','quests','npcs'].forEach(key => safeArr(e[key]).forEach(item => {
    if (item.visibility && !validVis.has(item.visibility))
      issues.push({ sev: 'warn', msg: `${key} "${item.name || item.id}": invalid visibility "${item.visibility}".` });
  }));

  // Broken relationships
  const allIds = new Set();
  Object.values(e).forEach(arr => { if (Array.isArray(arr)) arr.forEach(item => { if (item.id) allIds.add(item.id); }); });
  safeArr(state.relationships).forEach(rel => {
    if (!allIds.has(rel.fromId)) issues.push({ sev: 'warn', msg: `Relationship: source entity "${rel.fromId}" no longer exists.` });
    if (!allIds.has(rel.toId))   issues.push({ sev: 'warn', msg: `Relationship: target entity "${rel.toId}" no longer exists.` });
  });

  // Safe mode / crash lock
  if (await safeModeActive(plugin.app))
    issues.push({ sev: 'warn', msg: 'Safe mode is active — plugin will not load on next startup until disabled.' });
  if (await adapterExists(plugin.app, LOAD_FAILED))
    issues.push({ sev: 'error', msg: 'Crash lock present — plugin blocked itself from loading. Use "Clear Crash Lock" to re-enable.' });

  return { issues, info, counts };
}

// ── Vault helpers ─────────────────────────────────────────────────────────────
async function ensureFolder(app, path) {
  try {
    const norm = normalizePath(path);
    if (!(await app.vault.adapter.exists(norm))) await app.vault.createFolder(norm);
  } catch {}
}
async function writeNote(app, path, content) {
  const norm = normalizePath(path);
  try {
    const existing = app.vault.getAbstractFileByPath(norm);
    if (existing) await app.vault.modify(existing, content);
    else await app.vault.create(norm, content);
  } catch (e) { new Notice('Could not write note: ' + e.message); }
}
function entityMd(key, item) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(item)) {
    if (k === 'id') continue;
    const val = Array.isArray(v) ? v.join(', ') : String(v || '');
    lines.push(`${k}: ${val}`);
  }
  lines.push('---', '', `# ${item.name || item.title || 'Untitled'}`, '', item.summary || item.description || '');
  return lines.join('\n');
}
async function writeEntityNote(plugin, key, item) {
  const folder = campaignFolder(plugin);
  const dir = `${folder}/${key}`;
  await ensureFolder(plugin.app, folder);
  await ensureFolder(plugin.app, dir);
  const path = `${dir}/${slugify(item.name || item.title || item.id)}.md`;
  await writeNote(plugin.app, path, entityMd(key, item));
  item.lastSynced = new Date().toISOString();
  item.syncStatus = 'Synced';
  upsert(plugin.state, key, item);
  await plugin.saveState();
  new Notice(`Saved to ${path}`);
}
async function exportPlayerSafePacket(plugin) {
  const state = plugin.state;
  const folder = campaignFolder(plugin);
  const dir = `${folder}/Player Packet`;
  await ensureFolder(plugin.app, folder);
  await ensureFolder(plugin.app, dir);
  const camp = activeCampaign(state);
  let md = `# Player Packet — ${camp ? camp.name : 'Campaign'}\n\n`;
  md += `*Exported ${new Date().toLocaleDateString()}*\n\n`;
  const visQ = safeArr(state.entities.quests).filter(q => q.visibility === 'player-visible');
  if (visQ.length) { md += '## Active Quests\n\n'; visQ.forEach(q => { md += `### ${q.name}\n${q.playerSummary || q.summary || ''}\n\n`; }); }
  const visH = safeArr(state.entities.handouts).filter(h => h.visibility === 'player-visible');
  if (visH.length) { md += '## Handouts\n\n'; visH.forEach(h => { md += `### ${h.name}\n${h.content || h.summary || ''}\n\n`; }); }
  await writeNote(plugin.app, `${dir}/player-packet.md`, md);
  new Notice(`Player packet exported to ${dir}`);
}
async function exportBackup(plugin) {
  const folder = campaignFolder(plugin);
  const dir = `${folder}/Backups`;
  await ensureFolder(plugin.app, folder);
  await ensureFolder(plugin.app, dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = `${dir}/backup-${stamp}.json`;
  const counts = {};
  const ents = plugin.state.entities || {};
  for (const [k, arr] of Object.entries(ents)) counts[k] = Array.isArray(arr) ? arr.length : 0;
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  const backup = { version: PLUGIN_VERSION, timestamp: new Date().toISOString(), entityCounts: counts, state: plugin.state };
  await writeNote(plugin.app, path, JSON.stringify(backup, null, 2));
  new Notice(`Backup saved to ${path} (${total} entities)`);
}

// ── Dice & generators ─────────────────────────────────────────────────────────
function rollDie(n) { return Math.floor(Math.random() * n) + 1; }
function parseFormula(formula) {
  const m = String(formula || '1d20').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  return { count: parseInt(m[1]), sides: parseInt(m[2]), mod: parseInt(m[3] || '0') };
}
function rollFormula(formula, mode) {
  const f = parseFormula(formula) || { count: 1, sides: 20, mod: 0 };
  let rolls = [];
  for (let i = 0; i < f.count; i++) rolls.push(rollDie(f.sides));
  if (mode === 'Advantage') { const r2 = rolls.map(() => rollDie(f.sides)); rolls = rolls.map((v, i) => Math.max(v, r2[i])); }
  if (mode === 'Disadvantage') { const r2 = rolls.map(() => rollDie(f.sides)); rolls = rolls.map((v, i) => Math.min(v, r2[i])); }
  const total = rolls.reduce((s, v) => s + v, 0) + f.mod;
  return { formula, mode, rolls, total, label: `${formula}${mode !== 'Normal' ? ` (${mode})` : ''}` };
}
function roll4d6dl() {
  const r = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)].sort((a, b) => b - a);
  return r[0] + r[1] + r[2];
}

const GEN_TABLES = {
  'NPC Name': {
    first: ['Aldric','Brynn','Cassiel','Dorn','Elowen','Faelan','Gwyn','Haleth','Isara','Jorin',
      'Kessa','Lorn','Mira','Nael','Oryn','Petra','Quill','Reth','Sova','Tylen',
      'Una','Varis','Wren','Xael','Yora','Zeth'],
    last: ['Ashwood','Blackthorn','Coldwater','Dawnmere','Emberfall','Frostholm','Greymantle',
      'Holloway','Ironside','Juniper','Kettleburn','Lakeshore','Mossbridge','Nighthollow',
      'Oakenshield','Pinecroft','Quickwater','Ravenscroft','Stormwind','Thornwall',
      'Underhill','Valeborn','Westmarch','Yarrow'],
  },
  'Settlement Name': {
    prefix: ['Ash','Black','Bright','Cold','Dark','East','Fair','Fell','Gold','Green','Grey',
      'High','Iron','Lake','Long','Marsh','Moor','North','Oak','Red','Silver','Stone','Storm','West','White'],
    suffix: ['bridge','brook','bury','chapel','cliff','croft','dale','fall','fen','ford','gate',
      'haven','hill','hold','hollow','keep','mere','mill','moor','port','reach','rock',
      'shore','stead','stone','vale','water','well','wood'],
  },
  'Tavern Name': {
    adj: ['Broken','Crooked','Dancing','Faded','Gilded','Hanged','Jolly','Laughing','Rusty','Stumbling','Wandering'],
    noun: ['Badger','Blade','Bull','Crown','Dragon','Flagon','Goblin','Hound','Jug','Kettle','Lantern','Ogre','Pig','Pony','Rat','Raven','Shield','Skull','Stag','Sword','Toad','Wyvern'],
  },
  'Quest Hook': {
    who: ['A dying traveler','An old hermit','A desperate merchant','A frightened child','A wounded soldier','A mysterious stranger','The local lord','A temple priest'],
    what: ['asks you to retrieve','begs you to find','needs you to protect','warns you about','hires you to investigate','pleads for you to escort','offers a reward for'],
    where: ['a stolen relic from','a missing person in','a dangerous beast near','a criminal operating in','a cursed location within','ancient ruins beneath','a secret passage through'],
    place: ['the Thornwood','the old mill','the eastern road','the river crossing','the abandoned mine','the city sewers','the ruined temple','the bandit camp'],
  },
  Rumour: {
    source: ['A drunk at the bar claims','Merchants whisper that','The town crier announced','Children\'s rhymes hint','Old records suggest','A traveler swears'],
    content: ['treasure is hidden in','a monster lurks near','the local lord is actually','the missing people went to','strange lights appear at','someone is poisoning'],
    place: ['the old forest','the abandoned chapel','the river caves','the market district','the graveyard','the lord\'s estate','the crossroads'],
  },
  Loot: {
    type: ['A pouch containing','A locked chest with','Scattered coins totaling','A bundle of','A hidden cache of'],
    contents: ['14 gp and a gemstone','a silver dagger (+1)','a spell scroll (2nd level)','50 gp in mixed coinage','an ornate ring (worth 25 gp)','a potion of healing','a mysterious key','a torn map fragment'],
  },
  Weather: {
    condition: ['Clear skies','Overcast','Light rain','Heavy rain','Thunderstorm','Dense fog','Light snow','Blizzard','Sweltering heat','Biting cold'],
    detail: ['with a warm breeze','and poor visibility','making roads muddy','and flash flood risk','limiting overland travel','perfect for ambushes','reducing travel pace by half','with dangerous lightning strikes'],
  },
  'Travel Event': {
    type: ['Encounter','Discovery','Hazard','NPC Meeting','Weather','Supply'],
    events: ['A merchant caravan asks to travel together','Tracks of a large creature cross the path','Abandoned campsite with clues','Collapsed bridge forces a detour','Bandits demand a toll','Wounded traveler needs aid','Strange lights in the distance at night','A wild animal blocks the road','Milestone with scratched warnings','Old battlefield with scattered equipment'],
  },
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
    default: return '[Result]';
  }
}

// ── Modal field helpers ───────────────────────────────────────────────────────
function addField(el, label, value, onChange, type) {
  const s = new Setting(el).setName(label);
  if (type === 'textarea') {
    const ta = s.controlEl.createEl('textarea', { cls: 'te-field-ta' });
    ta.value = String(value || '');
    ta.rows = 3;
    ta.style.width = '100%';
    ta.addEventListener('input', () => onChange(ta.value));
  } else {
    s.addText(t => { t.setValue(String(value || '')); t.onChange(onChange); });
  }
  return s;
}
function addSelect(el, label, value, options, onChange) {
  new Setting(el).setName(label).addDropdown(d => {
    options.forEach(o => d.addOption(o, o));
    d.setValue(value || options[0]);
    d.onChange(onChange);
  });
}
function addToggle(el, label, value, onChange) {
  new Setting(el).setName(label).addToggle(t => { t.setValue(!!value); t.onChange(onChange); });
}
function addNumber(el, label, value, onChange) {
  new Setting(el).setName(label).addText(t => {
    t.inputEl.type = 'number';
    t.setValue(String(value ?? 0));
    t.onChange(v => onChange(Number(v) || 0));
  });
}

// chipField: renders label + chip display + add row. Never re-renders on input.
function chipField(container, label, values, onChange, opts) {
  opts = opts || {};
  const wrap = ce(container, 'div', 'te-chip-field');
  if (label) { const lbl = ce(wrap, 'div', 'setting-item-name'); lbl.style.cssText = 'font-size:.85rem;font-weight:600;margin-bottom:4px'; lbl.textContent = label; }
  const chipRow = ce(wrap, 'div', 'te-chip-row');
  const arr = Array.isArray(values) ? [...values] : [];
  const renderChips = () => {
    clear(chipRow);
    arr.forEach((v, i) => {
      const chip = ce(chipRow, 'span', 'te-chip', v);
      const x = ce(chip, 'button', 'te-chip-x', '×');
      x.title = 'Remove';
      x.addEventListener('click', () => { arr.splice(i, 1); renderChips(); onChange([...arr]); });
    });
  };
  renderChips();
  const addRow = ce(wrap, 'div', 'te-chip-add-row');
  const inp = ce(addRow, 'input'); inp.type = 'text'; inp.placeholder = opts.placeholder || 'Add…'; inp.style.flex = '1';
  if (opts.suggestions && opts.suggestions.length) {
    const sel = ce(addRow, 'select'); sel.style.cssText = 'max-width:160px;font-size:.82rem';
    ce(sel, 'option', '', '— pick —').value = '';
    opts.suggestions.forEach(s => ce(sel, 'option', '', s).value = s);
    sel.addEventListener('change', () => { if (sel.value) { inp.value = sel.value; sel.value = ''; } });
  }
  const addBtn = btn(addRow, '+ Add', 'te-btn te-btn-xs is-sm', () => {
    const v = inp.value.trim();
    if (v && !arr.includes(v)) { arr.push(v); renderChips(); onChange([...arr]); }
    inp.value = '';
    inp.focus();
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });
  return wrap;
}

function modalButtons(el, modal, onSave, saveLabel) {
  const row = ce(el, 'div', 'te-modal-buttons');
  btn(row, 'Cancel', 'te-btn', () => modal.close());
  btn(row, saveLabel || 'Save', 'te-btn is-primary', onSave);
}

// ── Section header builder ────────────────────────────────────────────────────
function pageHead(main, plugin, title, subtitle, actions) {
  const h = ce(main, 'div', 'te-page-head');
  ce(h, 'h1', '', title);
  if (subtitle) ce(h, 'p', 'te-page-subtitle', subtitle);
  // Active campaign chip
  const camp = activeCampaign(plugin.state);
  const chip = ce(h, 'span', 'te-campaign-chip' + (camp ? ' is-set' : ''));
  chip.textContent = camp ? ('📜 ' + camp.name) : '📜 No active campaign';
  if (actions && actions.length) {
    const row = ce(h, 'div', 'te-page-actions');
    actions.forEach(a => btn(row, a.label, 'te-btn' + (a.primary ? ' is-primary' : '') + (a.run ? ' is-run' : '') + (a.danger ? ' is-danger' : ''), a.onClick));
  }
}
function sectionHead(parent, text) { ce(parent, 'h2', 'te-section-head', text); }
function emptyState(parent, title, hint) {
  const e = ce(parent, 'div', 'te-empty');
  ce(e, 'div', 'te-empty-icon', '✨');
  ce(e, 'p', '', title);
  if (hint) ce(e, 'p', '', hint);
}

// ── Generic item cards ────────────────────────────────────────────────────────
const ENTITY_ICONS = {
  campaigns:'📜', worlds:'🌍', cosmologies:'🌌', realms:'✨', regions:'🗺️',
  settlements:'🏘️', locations:'📍', pois:'⭐', routes:'🛤️',
  npcs:'👤', creatures:'🐉', bbegs:'👹', factions:'⚔️',
  cultures:'🎭', languages:'📖', deities:'☀️', pantheons:'🏛️',
  quests:'📋', adventures:'📝', encounters:'⚔️', sessions:'📅',
  milestones:'🏆', secrets:'🔒', handouts:'📣', rules:'⚙️',
  conditions:'💫', damageTypes:'💥', downtime:'⏳', projects:'🔨',
  bastions:'🏰', compendium:'📚', homebrew:'🧪', tables:'🎲',
  characters:'🧙', calendars:'📆', journals:'📓',
};
const ENTITY_LABELS = {
  campaigns:'Campaign', worlds:'World', cosmologies:'Cosmology', realms:'Realm',
  regions:'Region', settlements:'Settlement', locations:'Location', pois:'Point of Interest',
  routes:'Route', npcs:'NPC', creatures:'Creature', bbegs:'BBEG',
  factions:'Faction', cultures:'Culture', languages:'Language', deities:'Deity',
  pantheons:'Pantheon', quests:'Quest', adventures:'Adventure', encounters:'Encounter',
  sessions:'Session', milestones:'Milestone', secrets:'Secret', handouts:'Handout',
  rules:'Rule', conditions:'Condition', damageTypes:'Damage Type', downtime:'Downtime Activity',
  projects:'Project', bastions:'Bastion', compendium:'Compendium Entry', homebrew:'Homebrew Entry',
  tables:'Table', characters:'Character', calendars:'Calendar', journals:'Journal',
};

function itemCards(parent, plugin, key, opts) {
  opts = opts || {};
  const items = safeArr(plugin.state.entities[key]).filter(x => matchesSearch(x, plugin.state.search));
  if (!items.length) { emptyState(parent, `No ${ENTITY_LABELS[key] || key} entries yet.`, opts.hint || 'Use the buttons above to create one.'); return; }
  const g = ce(parent, 'div', 'te-grid');
  items.forEach(item => {
    const c = ce(g, 'div', 'te-card');
    // Header
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', opts.icon || ENTITY_ICONS[key] || '📄');
    ce(hd, 'h3', 'te-card-title', item.name || item.title || 'Untitled');
    // Body
    if (item.summary || item.description) ce(c, 'p', 'te-card-body', (item.summary || item.description || '').slice(0, 120));
    // Meta rows (line-by-line, no tag clutter)
    const meta = ce(c, 'div', 'te-card-meta');
    const metaFields = opts.meta || ['type', 'status', 'category', 'visibility', 'lastSynced'];
    metaFields.forEach(f => {
      const val = item[f];
      if (!val || (Array.isArray(val) && !val.length)) return;
      const row = ce(meta, 'div', 'te-card-meta-row');
      ce(row, 'span', 'te-card-meta-label', f.replace(/([A-Z])/g, ' $1').toLowerCase());
      ce(row, 'span', '', String(Array.isArray(val) ? val.join(', ') : val).slice(0, 80));
    });
    // Actions
    const acts = ce(c, 'div', 'te-card-actions');
    btn(acts, 'Edit', 'te-btn is-sm', () => (opts.onEdit || defaultEdit)(plugin, key, item));
    if (opts.onExtra) opts.onExtra(acts, item);
    btn(acts, 'Sync', 'te-btn is-sm', () => writeEntityNote(plugin, key, item));
    btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => {
      removeItem(plugin.state, key, item.id);
      await plugin.saveState();
      new Notice(`${ENTITY_LABELS[key] || key} deleted.`);
    });
  });
}

function defaultEdit(plugin, key, item) {
  new GenericModal(plugin.app, plugin, key, item).open();
}

// ── PLUGIN CLASS ──────────────────────────────────────────────────────────────
class TTRPGEnginePlugin extends Plugin {
  async onload() {
    let boot;
    try { boot = await beginBoot(this); } catch (e) { boot = { ok: false, reason: String(e) }; }
    if (!boot.ok) { new Notice(`TTRPG Engine blocked: ${boot.reason}`, 10000); return; }

    try {
      const saved = await this.loadData() || {};
      this.state = Object.assign(createDefaultState(), saved);
      if (!this.state.entities || typeof this.state.entities !== 'object') this.state.entities = createDefaultState().entities;
      migrateState(this.state);
    } catch (e) {
      await safeDisable(this.app, 'State load failed', e);
      new Notice('TTRPG Engine: state load failed — see crash report in plugin folder.', 10000);
      return;
    }

    try {
      this.registerView(VIEW_TYPE, leaf => new TTRPGMainView(leaf, this));

      this.addRibbonIcon('castle', 'TTRPG Engine', () => this.activateView());

      const cmd = (id, name, fn) => this.addCommand({ id, name, callback: fn });
      cmd('open', 'Open TTRPG Engine', () => this.activateView());
      cmd('create-campaign', 'Create Campaign', () => { this.activateView(); new CampaignModal(this.app, this).open(); });
      cmd('run-campaign', 'Run / Resume Campaign', () => { this.activateView(); new SessionModal(this.app, this).open(); });
      cmd('roll-dice', 'Roll Dice', () => new DiceModal(this.app, this).open());
      cmd('create-npc', 'Create NPC', () => new NPCModal(this.app, this).open());
      cmd('create-encounter', 'Create Encounter', () => new EncounterModal(this.app, this).open());
      cmd('create-quest', 'Create Quest', () => new QuestModal(this.app, this).open());
      cmd('create-session', 'Create Session Log', () => new SessionModal(this.app, this).open());
      cmd('create-homebrew', 'Create Homebrew Entry', () => new HomebrewModal(this.app, this).open());
      cmd('tile-map', 'Open Tile Map Builder', async () => { this.state.activeSection = 'geography'; await this.saveState(); this.activateView(); });
      cmd('repair', 'Repair / Reindex Data', async () => {
        migrateState(this.state);
        await this.saveState();
        const e = this.state.entities;
        new Notice(`Reindexed. Campaigns:${e.campaigns.length} NPCs:${e.npcs.length} Quests:${e.quests.length} Sessions:${e.sessions.length} Secrets:${e.secrets.length}`, 6000);
      });
      cmd('backup', 'Backup Data', () => exportBackup(this));
      cmd('my-content', 'Open My Content / Saved Items', async () => { this.state.activeSection = 'dashboard'; await this.saveState(); this.activateView(); });
      // Phase 1 — safety commands
      cmd('open-diagnostics',  'TTRPG Engine: Open Diagnostics Report', () => new DiagnosticsModal(this.app, this).open());
      cmd('enable-safe-mode',  'TTRPG Engine: Enable Safe Mode', async () => {
        await enableSafeMode(this.app);
        new Notice('Safe mode enabled. The plugin will not load on next startup.', 8000);
        this.refreshViews();
      });
      cmd('disable-safe-mode', 'TTRPG Engine: Disable Safe Mode', async () => {
        await disableSafeMode(this.app);
        new Notice('Safe mode disabled.');
        this.refreshViews();
      });
      cmd('clear-crash-lock',  'TTRPG Engine: Clear Crash Lock', async () => {
        await clearCrashLock(this.app);
        new Notice('Crash lock cleared — plugin will load normally on next startup.');
      });
      cmd('open-crash-report', 'TTRPG Engine: View Last Crash Report', async () => {
        const report = await readCrashReport(this.app);
        if (!report) { new Notice('No crash report found.'); return; }
        new DiagnosticsModal(this.app, this, report).open();
      });
      // Additional creation commands
      cmd('create-world',    'Create World',    () => new GenericModal(this.app, this, 'worlds').open());
      cmd('create-faction',  'Create Faction',  () => new FactionModal(this.app, this).open());
      cmd('create-location', 'Create Location', () => new GenericModal(this.app, this, 'locations').open());
      cmd('create-creature', 'Create Creature', () => new CreatureModal(this.app, this).open());
      cmd('create-bbeg',     'Create BBEG',     () => new BBEGModal(this.app, this).open());
      cmd('create-character','Create Character Sheet', () => new CharacterModal(this.app, this).open());

      await endBoot(this);
    } catch (e) {
      await safeDisable(this.app, 'Plugin registration failed', e);
      new Notice('TTRPG Engine: startup failed — see crash report.', 10000);
    }
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    adapterRemove(this.app, BOOT_MARKER);
  }

  async saveState() {
    this.state.version = PLUGIN_VERSION;
    await this.saveData(this.state);
    this.refreshViews();
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
      if (leaf.view && leaf.view.render) leaf.view.render();
    });
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
}

// ── MAIN VIEW ─────────────────────────────────────────────────────────────────
class TTRPGMainView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'TTRPG Engine'; }
  getIcon() { return 'castle'; }
  async onOpen() { this.render(); }
  async onClose() {}

  render() {
    const root = this.containerEl.children[1];
    clear(root);
    const state = this.plugin.state;
    root.className = 'ttrpg-shell' + (state.settings.compact ? ' is-compact' : '') + (state.sidebarCollapsed ? ' is-collapsed' : '');

    // ── Top bar
    const top = ce(root, 'header', 'te-topbar');
    ce(top, 'div', 'te-brand', '🏰 TTRPG Engine');
    const modeRow = ce(top, 'div', 'te-mode-toggle');
    const dmBtn = btn(modeRow, 'DM', state.mode === 'DM' ? 'is-active' : '', async () => {
      state.mode = 'DM'; await this.plugin.saveState();
    });
    const pcBtn = btn(modeRow, 'Player', state.mode === 'PLAYER' ? 'is-active' : '', async () => {
      state.mode = 'PLAYER'; await this.plugin.saveState();
    });
    const srch = ce(top, 'input', 'te-search');
    srch.type = 'text'; srch.placeholder = 'Search…'; srch.value = state.search || '';
    let searchTimer = null;
    srch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => { state.search = srch.value; await this.plugin.saveState(); }, 200);
    });
    const safeBadge = ce(top, 'span', 'te-safe-mode-badge');
    safeBadge.textContent = '⚠️ Safe Mode'; safeBadge.style.display = 'none';
    safeModeActive(this.plugin.app).then(active => { if (active) safeBadge.style.display = ''; });
    btn(top, '⚙️ Settings', 'te-btn is-sm', () => new SettingsModal(this.app, this.plugin).open());
    btn(top, '🔧 Diagnostics', 'te-btn is-sm', () => new DiagnosticsModal(this.app, this.plugin).open());

    // ── Body
    const body = ce(root, 'div', 'te-body');

    // ── Sidebar
    const side = ce(body, 'aside', 'te-sidebar');
    const sideTop = ce(side, 'div', 'te-sidebar-top');
    btn(sideTop, state.sidebarCollapsed ? '→' : '←', 'te-collapse-btn', async () => {
      state.sidebarCollapsed = !state.sidebarCollapsed; await this.plugin.saveState();
    });

    const navGroups = [
      { label: 'DM Tools', items: [
        { id: 'dashboard', icon: '🏰', label: 'Dashboard' },
        { id: 'campaigns', icon: '📜', label: 'Campaigns' },
        { id: 'dmscreen', icon: '🖥️', label: 'DM Screen' },
      ]},
      { label: 'World & Story', items: [
        { id: 'world', icon: '🌍', label: 'World & Lore' },
        { id: 'geography', icon: '🗺️', label: 'Geography & Maps' },
        { id: 'npcs', icon: '👤', label: 'NPCs & Creatures' },
        { id: 'factions', icon: '⚔️', label: 'Factions' },
        { id: 'adventure', icon: '📝', label: 'Adventures & Quests' },
        { id: 'encounters', icon: '🎯', label: 'Encounters & Combat' },
      ]},
      { label: 'Campaign Ops', items: [
        { id: 'rules', icon: '⚙️', label: 'Rules & Mechanics' },
        { id: 'downtime', icon: '⏳', label: 'Downtime & Bases' },
        { id: 'sessions', icon: '📅', label: 'Sessions & Timeline' },
        { id: 'secrets', icon: '🔒', label: 'Secrets & Reveals' },
      ]},
      { label: 'Library', items: [
        { id: 'library', icon: '📚', label: 'Compendium & Library' },
        { id: 'homebrew', icon: '🧪', label: 'Homebrew' },
        { id: 'generators', icon: '🎲', label: 'Generators' },
      ]},
      { label: 'Player', items: [
        { id: 'player', icon: '👁️', label: 'Player View' },
      ]},
    ];

    navGroups.forEach(group => {
      const grp = ce(side, 'div', 'te-nav-group');
      ce(grp, 'span', 'te-nav-group-label', group.label);
      group.items.forEach(({ id, icon, label }) => {
        const isActive = state.mode === 'PLAYER' ? id === 'player' : state.activeSection === id;
        const b = btn(grp, '', 'te-nav-btn' + (isActive ? ' is-active' : ''), async () => {
          if (id === 'player') { state.mode = 'PLAYER'; } else { state.mode = 'DM'; }
          state.activeSection = id;
          await this.plugin.saveState();
        });
        ce(b, 'span', 'te-nav-icon', icon);
        ce(b, 'span', 'te-nav-label', label);
      });
    });

    // ── Main content
    const main = ce(body, 'main', 'te-main');
    if (state.mode === 'PLAYER') renderPlayer(main, this.plugin);
    else renderSection(main, this.plugin, state.activeSection || 'dashboard');
  }
}

// ── Section router ─────────────────────────────────────────────────────────────
function renderSection(main, plugin, section) {
  const map = {
    dashboard: renderDashboard,
    campaigns: renderCampaigns,
    dmscreen: renderDmScreen,
    world: renderWorld,
    geography: renderGeography,
    npcs: renderNpcs,
    factions: renderFactions,
    adventure: renderAdventure,
    encounters: renderEncounters,
    rules: renderRules,
    downtime: renderDowntime,
    sessions: renderSessions,
    secrets: renderSecrets,
    library: renderLibrary,
    homebrew: renderHomebrew,
    generators: renderGenerators,
    player: renderPlayer,
  };
  (map[section] || renderDashboard)(main, plugin);
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard(main, plugin) {
  const state = plugin.state;
  pageHead(main, plugin, 'Dungeon Master Console', 'Campaign hub — build, run, and track your whole campaign from here.', [
    { label: '+ New Campaign', primary: true, onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '▶ Run / Resume', run: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
    { label: '🎲 Roll Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ]);
  // Stat grid
  const sg = ce(main, 'div', 'te-stat-grid');
  [
    ['Campaigns', state.entities.campaigns.length],
    ['NPCs', state.entities.npcs.length],
    ['Quests', state.entities.quests.length],
    ['Encounters', state.entities.encounters.length],
    ['Secrets', state.entities.secrets.length],
    ['Sessions', state.entities.sessions.length],
    ['Creatures', state.entities.creatures.length],
    ['Homebrew', state.entities.homebrew.length],
  ].forEach(([label, val]) => {
    const c = ce(sg, 'div', 'te-stat-card');
    ce(c, 'div', 'te-stat-big', val);
    ce(c, 'div', 'te-stat-label', label);
  });
  // Quick nav cards
  sectionHead(main, 'Quick Access');
  const g = ce(main, 'div', 'te-grid');
  const qcard = (g, icon, title, desc, btnLabel, onClick) => {
    const c = ce(g, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', icon);
    ce(hd, 'h3', 'te-card-title', title);
    ce(c, 'p', 'te-card-body', desc);
    const acts = ce(c, 'div', 'te-card-actions');
    btn(acts, btnLabel, 'te-btn is-primary', onClick);
  };
  const camp = activeCampaign(state);
  qcard(g, '📜', 'Active Campaign', camp ? `${camp.name} — ${camp.summary || 'No summary'}` : 'No active campaign. Create one to start.', camp ? 'View Campaigns' : 'New Campaign', async () => { state.activeSection = 'campaigns'; await plugin.saveState(); });
  qcard(g, '🌍', 'World & Lore', 'Worlds, cosmologies, deities, factions, cultures, and languages.', 'Open World', async () => { state.activeSection = 'world'; await plugin.saveState(); });
  qcard(g, '👤', 'NPCs & Creatures', `${state.entities.npcs.length} NPCs and ${state.entities.creatures.length} creatures in your campaign.`, 'Open NPCs', async () => { state.activeSection = 'npcs'; await plugin.saveState(); });
  qcard(g, '📋', 'Active Quests', `${safeArr(state.entities.quests).filter(q => q.status === 'Active').length} active quests running.`, 'Open Quests', async () => { state.activeSection = 'adventure'; await plugin.saveState(); });
  qcard(g, '🖥️', 'DM Screen', 'Quick reference, conditions, combat rules, and session tools.', 'Open DM Screen', async () => { state.activeSection = 'dmscreen'; await plugin.saveState(); });
  qcard(g, '🎲', 'Generators', 'NPC names, quest hooks, loot, taverns, weather, and more.', 'Open Generators', async () => { state.activeSection = 'generators'; await plugin.saveState(); });
  // My content diagnostic
  sectionHead(main, 'My Content / Saved Items');
  const dc = ce(main, 'div', 'te-card');
  const dcHead = ce(dc, 'div', 'te-card-head');
  ce(dcHead, 'span', 'te-card-icon', '📊');
  ce(dcHead, 'h3', 'te-card-title', 'Content Diagnostic');
  const dcGrid = ce(dc, 'div', 'te-stat-grid');
  dcGrid.style.marginTop = '8px';
  const ek = Object.keys(state.entities);
  ek.forEach(k => {
    if (!safeArr(state.entities[k]).length) return;
    const sc = ce(dcGrid, 'div', 'te-stat-card');
    sc.style.padding = '8px';
    ce(sc, 'div', 'te-stat-big', state.entities[k].length);
    ce(sc, 'div', 'te-stat-label', ENTITY_LABELS[k] || k);
  });
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
function renderCampaigns(main, plugin) {
  pageHead(main, plugin, 'Campaigns', 'Create, manage, and switch between your campaigns.', [
    { label: '+ New Campaign', primary: true, onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '▶ Run / Resume', run: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
  ]);
  const campaigns = safeArr(plugin.state.entities.campaigns).filter(c => matchesSearch(c, plugin.state.search));
  if (!campaigns.length) { emptyState(main, 'No campaigns yet.', 'Click "New Campaign" to create your first campaign.'); return; }
  const g = ce(main, 'div', 'te-grid');
  campaigns.forEach(camp => {
    const c = ce(g, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '📜');
    const titleRow = ce(hd, 'div', '');
    titleRow.style.flex = '1';
    ce(titleRow, 'h3', 'te-card-title', camp.name);
    if (camp.id === plugin.state.activeCampaignId) { const badge = ce(titleRow, 'span', 'te-chip', '✓ Active'); badge.style.cssText = 'border-color:var(--te-accent);color:var(--te-accent);font-size:.72rem'; }
    if (camp.summary) ce(c, 'p', 'te-card-body', camp.summary);
    // Line-by-line metadata
    const meta = ce(c, 'div', 'te-card-meta');
    const mf = [
      ['Campaign ID', camp.id],
      ['Status', camp.status],
      ['Theme', camp.theme],
      ['Level Range', camp.levelRange],
      ['Folder', slugify(camp.name) + '/'],
      ['Visibility', camp.visibility],
      ['Created', camp.createdAt ? new Date(camp.createdAt).toLocaleDateString() : ''],
      ['Updated', camp.updatedAt ? new Date(camp.updatedAt).toLocaleDateString() : ''],
      ['Last Synced', camp.lastSynced ? new Date(camp.lastSynced).toLocaleDateString() : 'Never'],
    ];
    mf.forEach(([label, val]) => {
      if (!val) return;
      const row = ce(meta, 'div', 'te-card-meta-row');
      ce(row, 'span', 'te-card-meta-label', label);
      ce(row, 'span', '', String(val));
    });
    const acts = ce(c, 'div', 'te-card-actions');
    if (camp.id !== plugin.state.activeCampaignId) {
      btn(acts, 'Set Active', 'te-btn is-primary is-sm', async () => {
        plugin.state.activeCampaignId = camp.id; await plugin.saveState(); new Notice(`Active campaign: ${camp.name}`);
      });
    }
    btn(acts, 'Edit', 'te-btn is-sm', () => new CampaignModal(plugin.app, plugin, camp).open());
    btn(acts, 'Sync Note', 'te-btn is-sm', () => writeEntityNote(plugin, 'campaigns', camp));
    btn(acts, camp.status === 'Archived' ? 'Unarchive' : 'Archive', 'te-btn is-sm', async () => {
      camp.status = camp.status === 'Archived' ? 'On Hold' : 'Archived';
      upsert(plugin.state, 'campaigns', camp); await plugin.saveState();
    });
    btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => {
      removeItem(plugin.state, 'campaigns', camp.id);
      if (plugin.state.activeCampaignId === camp.id) plugin.state.activeCampaignId = '';
      await plugin.saveState(); new Notice('Campaign deleted.');
    });
  });
}

// ── DM SCREEN ─────────────────────────────────────────────────────────────────
function renderDmScreen(main, plugin) {
  pageHead(main, plugin, 'DM Screen', 'Quick references, conditions, rules, and session tools at a glance.', [
    { label: '▶ Run / Resume', run: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
    { label: '+ New Campaign', onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '🎲 Roll Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ]);
  const g = ce(main, 'div', 'te-grid');

  // Core References card
  const refCard = ce(g, 'div', 'te-card');
  const rh = ce(refCard, 'div', 'te-card-head');
  ce(rh, 'span', 'te-card-icon', '⚙️');
  ce(rh, 'h3', 'te-card-title', 'Core References & Tables');
  const refs = [
    ['Action', 'Attack, Cast Spell, Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use Object'],
    ['Bonus Action', 'Class features, some spells, Off-hand attack (two-weapon), certain items'],
    ['Reaction', 'Opportunity Attack, Shield spell, Readied action, Counterspell'],
    ['Movement', 'Up to Speed per turn. Split freely. Crawl (½ speed). Difficult terrain costs double.'],
    ['Concentration', 'Cast another concentration spell, take damage (CON save ≥10 or ½ dmg), die'],
    ['Death Saves', '3 successes = stable. 3 failures = dead. Nat 20 = 1 HP. Nat 1 = 2 failures.'],
    ['Short Rest', '1+ hours, spend Hit Dice (d + CON mod). Some class features restore on short rest.'],
    ['Long Rest', '8 hours, regain all HP, Hit Dice (½ max), spell slots, most features.'],
  ];
  const refMeta = ce(refCard, 'div', 'te-card-meta');
  refs.forEach(([k, v]) => {
    const row = ce(refMeta, 'div', 'te-card-meta-row');
    ce(row, 'span', 'te-card-meta-label', k);
    ce(row, 'span', 'te-card-body', v);
  });

  // Interaction & Social card
  const socCard = ce(g, 'div', 'te-card');
  const sh = ce(socCard, 'div', 'te-card-head');
  ce(sh, 'span', 'te-card-icon', '🎭');
  ce(sh, 'h3', 'te-card-title', 'Interaction & Social');
  const socRefs = [
    ['Easy DC', '10 — Friendly NPC, simple request, obvious truth'],
    ['Medium DC', '15 — Indifferent NPC, reasonable ask, some resistance'],
    ['Hard DC', '20 — Unfriendly NPC, difficult request, conflicting interests'],
    ['Very Hard', '25 — Hostile NPC, dangerous request, strong personal stakes'],
    ['Insight', 'Contested by target\'s Deception. Detects lies, not full truth.'],
    ['Persuasion', 'Works best when aligned with NPC\'s interests.'],
    ['Deception', 'Sustained lies may require repeated checks.'],
    ['Intimidation', 'Creates frightened or hostile conditions if failed.'],
  ];
  const socMeta = ce(socCard, 'div', 'te-card-meta');
  socRefs.forEach(([k, v]) => {
    const row = ce(socMeta, 'div', 'te-card-meta-row');
    ce(row, 'span', 'te-card-meta-label', k);
    ce(row, 'span', 'te-card-body', v);
  });

  // Combat quick card
  const combCard = ce(g, 'div', 'te-card');
  const ch = ce(combCard, 'div', 'te-card-head');
  ce(ch, 'span', 'te-card-icon', '⚔️');
  ce(ch, 'h3', 'te-card-title', 'Combat Reference');
  const combRefs = [
    ['Opportunity Attack', 'Reaction when hostile creature leaves reach voluntarily.'],
    ['Flanking (optional)', '+2 to attack rolls vs creature with ally on opposite side.'],
    ['Cover', 'Half: +2 AC/DEX. ¾: +5 AC/DEX. Total: untargetable.'],
    ['Grapple', 'Attack action, Athletics vs Athletics/Acrobatics. Speed → 0.'],
    ['Shove', 'Attack action, Athletics vs Athletics/Acrobatics. Knock prone or push 5 ft.'],
    ['Mounted', 'Controlled: shares init, moves as directed. Independent: own init.'],
    ['Chase', 'Dash = exhaustion level on failure. Disengage = no opp attacks.'],
  ];
  const combMeta = ce(combCard, 'div', 'te-card-meta');
  combRefs.forEach(([k, v]) => {
    const row = ce(combMeta, 'div', 'te-card-meta-row');
    ce(row, 'span', 'te-card-meta-label', k);
    ce(row, 'span', 'te-card-body', v);
  });

  // Active quests card
  const questCard = ce(g, 'div', 'te-card');
  const qh = ce(questCard, 'div', 'te-card-head');
  ce(qh, 'span', 'te-card-icon', '📋');
  ce(qh, 'h3', 'te-card-title', 'Active Quests');
  const activeQ = safeArr(plugin.state.entities.quests).filter(q => q.status === 'Active');
  if (!activeQ.length) ce(questCard, 'p', 'te-card-body', 'No active quests.');
  else { const qm = ce(questCard, 'div', 'te-card-meta'); activeQ.slice(0, 5).forEach(q => { const row = ce(qm, 'div', 'te-card-meta-row'); ce(row, 'span', 'te-card-meta-label', q.questType || 'Quest'); ce(row, 'span', '', q.name); }); }

  // NPC quick list
  const npcCard = ce(g, 'div', 'te-card');
  const nh = ce(npcCard, 'div', 'te-card-head');
  ce(nh, 'span', 'te-card-icon', '👤');
  ce(nh, 'h3', 'te-card-title', 'Important NPCs');
  const npcs = safeArr(plugin.state.entities.npcs).slice(0, 6);
  if (!npcs.length) ce(npcCard, 'p', 'te-card-body', 'No NPCs yet.');
  else { const nm = ce(npcCard, 'div', 'te-card-meta'); npcs.forEach(n => { const row = ce(nm, 'div', 'te-card-meta-row'); ce(row, 'span', 'te-card-meta-label', n.role || 'NPC'); ce(row, 'span', '', `${n.name} (${n.status || 'Alive'})`); }); }

  // Conditions (two-column)
  sectionHead(main, 'Conditions');
  const condGrid = ce(main, 'div', 'te-conditions-grid');
  const conditions = [
    { name: 'Blinded', summary: 'Fails sight checks, attacks vs it have advantage, its attacks have disadvantage.' },
    { name: 'Charmed', summary: 'Can\'t attack charmer; charmer has advantage on social checks vs it.' },
    { name: 'Deafened', summary: 'Fails hearing checks automatically.' },
    { name: 'Frightened', summary: 'Disadvantage on attacks/checks while source is visible; can\'t move closer.' },
    { name: 'Grappled', summary: 'Speed 0. Ends if grappler incapacitated or target escapes.' },
    { name: 'Incapacitated', summary: 'No actions or reactions.' },
    { name: 'Invisible', summary: 'Can\'t be seen normally; attacks have advantage vs others, others vs it have disadvantage.' },
    { name: 'Paralyzed', summary: 'Incapacitated, can\'t move or speak. Attacks have adv; within 5 ft = auto-crit.' },
    { name: 'Petrified', summary: 'Turned to stone. Incapacitated, unaware, auto-fail STR/DEX saves, resistant to all damage.' },
    { name: 'Poisoned', summary: 'Disadvantage on attack rolls and ability checks.' },
    { name: 'Prone', summary: 'Must crawl or use half speed to stand. Attacks vs it: adv within 5 ft, else disadv.' },
    { name: 'Restrained', summary: 'Speed 0; disadvantage on DEX saves; attacks vs it have adv, its attacks disadv.' },
    { name: 'Stunned', summary: 'Incapacitated, can\'t move, speaks falteringly. Attacks vs it have advantage.' },
    { name: 'Unconscious', summary: 'Incapacitated, drops held items, falls prone, unaware. Hits from within 5 ft are crits.' },
  ];
  conditions.forEach(cond => {
    const c = ce(condGrid, 'div', 'te-condition-card');
    ce(c, 'div', 'te-condition-name', cond.name);
    ce(c, 'div', 'te-condition-summary', cond.summary);
  });

  // Quick dice roller
  sectionHead(main, 'Quick Dice Roller');
  const diceCard = ce(main, 'div', 'te-card');
  diceCard.style.maxWidth = '480px';
  const dh = ce(diceCard, 'div', 'te-card-head');
  ce(dh, 'span', 'te-card-icon', '🎲');
  ce(dh, 'h3', 'te-card-title', 'Roll Dice');
  const diceRow = ce(diceCard, 'div', 'te-card-actions');
  const diceResult = ce(diceCard, 'div', 'te-result-box', 'Roll a die to see the result here.');
  ['d4','d6','d8','d10','d12','d20','d100'].forEach(die => {
    btn(diceRow, die, 'te-btn is-sm', () => {
      const r = rollFormula('1' + die, 'Normal');
      diceResult.textContent = `${die}: ${r.total}`;
    });
  });
}

// ── WORLD & LORE ──────────────────────────────────────────────────────────────
function renderWorld(main, plugin) {
  pageHead(main, plugin, 'World & Lore', 'Worlds, cosmologies, realms, deities, factions, cultures, languages, and more.', [
    { label: '+ World', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'worlds', null, worldFields).open() },
    { label: '+ Cosmology', onClick: () => new GenericModal(plugin.app, plugin, 'cosmologies', null, cosmologyFields).open() },
    { label: '+ Realm', onClick: () => new GenericModal(plugin.app, plugin, 'realms', null, realmFields).open() },
    { label: '+ Deity', onClick: () => new GenericModal(plugin.app, plugin, 'deities', null, deityFields).open() },
    { label: '+ Faction', onClick: () => new FactionModal(plugin.app, plugin).open() },
    { label: '+ Culture', onClick: () => new GenericModal(plugin.app, plugin, 'cultures', null, cultureFields).open() },
    { label: '+ Language', onClick: () => new GenericModal(plugin.app, plugin, 'languages', null, langFields).open() },
    { label: '🗓️ Calendar', onClick: () => new CalendarModal(plugin.app, plugin).open() },
  ]);

  sectionHead(main, 'Worlds');
  itemCards(main, plugin, 'worlds', { meta: ['worldScale', 'tone', 'premise'] });
  sectionHead(main, 'Cosmologies');
  itemCards(main, plugin, 'cosmologies', { meta: ['type', 'creationMyth'] });
  sectionHead(main, 'Realms & Planes');
  itemCards(main, plugin, 'realms', { meta: ['type', 'parentPlane'] });
  sectionHead(main, 'Deities & Pantheons');
  itemCards(main, plugin, 'deities', { meta: ['domain', 'pantheon', 'alignment'] });
  sectionHead(main, 'Cultures');
  itemCards(main, plugin, 'cultures', { meta: ['language', 'values'] });
  sectionHead(main, 'Languages');
  itemCards(main, plugin, 'languages', { meta: ['script', 'speakers'] });
  sectionHead(main, 'Calendars');
  const cals = safeArr(plugin.state.entities.calendars).concat(plugin.state.calendar && plugin.state.calendar.name ? [plugin.state.calendar] : []);
  if (!cals.length) { emptyState(main, 'No calendars yet.', 'Use the Calendar button above to create one.'); }
  else itemCards(main, plugin, 'calendars', { meta: ['year', 'month', 'day'] });
}

// Field definitions for generic modals
const worldFields = [
  { key: 'name', label: 'World Name', type: 'text' },
  { key: 'worldScale', label: 'World Scale', type: 'select', options: ['Single Region','Continent','Multiple Continents','Archipelago','Planar Fragment','Floating World','Pocket Dimension','Other'] },
  { key: 'premise', label: 'Core Premise', type: 'textarea' },
  { key: 'tone', label: 'Campaign Tone', type: 'select', options: ['Heroic Fantasy','Dark Fantasy','Sword & Sorcery','Political Intrigue','Horror','Mystery','Exploration','Epic','Mythic','Other'] },
  { key: 'geography', label: 'Geography Overview', type: 'textarea' },
  { key: 'climate', label: 'Climate', type: 'text' },
  { key: 'resources', label: 'Key Resources', type: 'text' },
  { key: 'magic', label: 'Magic Rules', type: 'textarea' },
  { key: 'summary', label: 'Summary / Notes', type: 'textarea' },
];
const cosmologyFields = [
  { key: 'name', label: 'Cosmology Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'creationMyth', label: 'Creation Myth', type: 'textarea' },
  { key: 'planes', label: 'Planes / Realms (chip)', type: 'chip' },
  { key: 'portals', label: 'Portals / Gateways', type: 'textarea' },
  { key: 'travelRules', label: 'Planar Travel Rules', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const realmFields = [
  { key: 'name', label: 'Realm Name', type: 'text' },
  { key: 'type', label: 'Realm Type', type: 'select', options: ['Material','Shadow','Ethereal','Astral','Inner Plane','Outer Plane','Feywild','Shadowfell','Demi-plane','Other'] },
  { key: 'parentPlane', label: 'Parent Plane', type: 'text' },
  { key: 'connections', label: 'Connected Realms (chip)', type: 'chip' },
  { key: 'features', label: 'Key Features', type: 'textarea' },
  { key: 'rules', label: 'Special Rules', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const deityFields = [
  { key: 'name', label: 'Deity Name', type: 'text' },
  { key: 'titles', label: 'Titles / Epithets', type: 'text' },
  { key: 'domain', label: 'Divine Domain', type: 'text' },
  { key: 'pantheon', label: 'Pantheon', type: 'text' },
  { key: 'alignment', label: 'Alignment', type: 'select', options: ALIGNMENTS },
  { key: 'symbols', label: 'Symbols', type: 'text' },
  { key: 'worshippers', label: 'Worshippers', type: 'text' },
  { key: 'holySites', label: 'Holy Sites (chip)', type: 'chip' },
  { key: 'clergy', label: 'Clergy Notes', type: 'textarea' },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const cultureFields = [
  { key: 'name', label: 'Culture Name', type: 'text' },
  { key: 'language', label: 'Primary Language', type: 'text' },
  { key: 'values', label: 'Core Values', type: 'text' },
  { key: 'customs', label: 'Customs', type: 'chip' },
  { key: 'taboos', label: 'Taboos', type: 'chip' },
  { key: 'clothing', label: 'Clothing / Appearance', type: 'textarea' },
  { key: 'food', label: 'Food & Drink', type: 'textarea' },
  { key: 'socialStructure', label: 'Social Structure', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const langFields = [
  { key: 'name', label: 'Language Name', type: 'text' },
  { key: 'script', label: 'Script', type: 'text' },
  { key: 'speakers', label: 'Spoken By', type: 'text' },
  { key: 'origin', label: 'Origin', type: 'text' },
  { key: 'summary', label: 'Notes / Sample Words', type: 'textarea' },
];

// ── GEOGRAPHY & MAPS ──────────────────────────────────────────────────────────
function renderGeography(main, plugin) {
  pageHead(main, plugin, 'Geography & Maps', 'Regions, settlements, locations, points of interest, routes, and the Tile Map Builder.', [
    { label: '+ Region', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'regions', null, regionFields).open() },
    { label: '+ Settlement', onClick: () => new GenericModal(plugin.app, plugin, 'settlements', null, settlementFields).open() },
    { label: '+ Location', onClick: () => new GenericModal(plugin.app, plugin, 'locations', null, locationFields).open() },
    { label: '+ POI', onClick: () => new GenericModal(plugin.app, plugin, 'pois', null, poiFields).open() },
    { label: '+ Route', onClick: () => new GenericModal(plugin.app, plugin, 'routes', null, routeFields).open() },
  ]);

  // Tile Map Builder (inline)
  sectionHead(main, 'Tile Map Builder');
  renderTileMapBuilder(main, plugin);

  sectionHead(main, 'Regions');
  itemCards(main, plugin, 'regions', { meta: ['terrain', 'climate', 'population'] });
  sectionHead(main, 'Settlements');
  itemCards(main, plugin, 'settlements', { meta: ['type', 'population', 'region'] });
  sectionHead(main, 'Locations');
  itemCards(main, plugin, 'locations', { meta: ['type', 'parent'] });
  sectionHead(main, 'Points of Interest');
  itemCards(main, plugin, 'pois', { meta: ['type', 'location'] });
  sectionHead(main, 'Routes');
  itemCards(main, plugin, 'routes', { meta: ['from', 'to', 'travelTime'] });
}

const regionFields = [
  { key: 'name', label: 'Region Name', type: 'text' },
  { key: 'terrain', label: 'Terrain', type: 'select', options: ['Plains','Forest','Mountains','Desert','Coast','Arctic','Swamp','Jungle','Hills','Volcanic','Underground','Other'] },
  { key: 'climate', label: 'Climate', type: 'text' },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'resources', label: 'Resources (chip)', type: 'chip' },
  { key: 'hazards', label: 'Hazards (chip)', type: 'chip' },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const settlementFields = [
  { key: 'name', label: 'Settlement Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Thorp','Hamlet','Village','Town','City','Metropolis','Fortress','Port','Outpost','Other'] },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'region', label: 'Region', type: 'text' },
  { key: 'government', label: 'Government', type: 'text' },
  { key: 'notableNPCs', label: 'Notable NPCs (chip)', type: 'chip' },
  { key: 'districts', label: 'Districts (chip)', type: 'chip' },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const locationFields = [
  { key: 'name', label: 'Location Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Dungeon','Ruin','Cave','Wilderness','Building','Landmark','Lair','Shrine','Tower','Other'] },
  { key: 'parent', label: 'Parent (region/settlement)', type: 'text' },
  { key: 'hazards', label: 'Hazards', type: 'textarea' },
  { key: 'loot', label: 'Loot (chip)', type: 'chip' },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const poiFields = [
  { key: 'name', label: 'POI Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Landmark','Shrine','Ruin','Camp','Cave','Crossing','Waypoint','Hidden','Other'] },
  { key: 'location', label: 'Location / Region', type: 'text' },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const routeFields = [
  { key: 'name', label: 'Route Name', type: 'text' },
  { key: 'from', label: 'From', type: 'text' },
  { key: 'to', label: 'To', type: 'text' },
  { key: 'travelTime', label: 'Travel Time', type: 'text' },
  { key: 'terrain', label: 'Terrain / Conditions', type: 'text' },
  { key: 'hazards', label: 'Hazards', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── TILE MAP BUILDER ──────────────────────────────────────────────────────────
function renderTileMapBuilder(parent, plugin) {
  const tmState = plugin.state.tileMap;
  const wrap = ce(parent, 'div', 'te-map-builder');
  let selectedTileType = null;
  let selectedTileId = null;
  let dragging = null;
  let resizing = null;

  // Toolbar
  const toolbar = ce(wrap, 'div', 'te-map-toolbar');
  const mapNameInp = ce(toolbar, 'input');
  mapNameInp.type = 'text'; mapNameInp.value = tmState.mapName || 'Untitled Map';
  mapNameInp.placeholder = 'Map name…'; mapNameInp.style.cssText = 'flex:1;max-width:220px;padding:5px 8px;border:1px solid var(--te-border);border-radius:var(--te-r-sm);background:var(--te-bg);color:var(--te-text);font-size:.88rem';
  mapNameInp.addEventListener('input', () => { tmState.mapName = mapNameInp.value; });

  btn(toolbar, '💾 Save Map', 'te-btn is-primary', async () => {
    tmState.mapName = mapNameInp.value;
    await plugin.saveState();
    // Also write a note
    const folder = campaignFolder(plugin);
    await ensureFolder(plugin.app, `${folder}/Maps`);
    const mapMd = `# Map: ${tmState.mapName}\n\n*Tiles: ${tmState.tiles.length}*\n\n\`\`\`json\n${JSON.stringify(tmState.tiles, null, 2)}\n\`\`\`\n`;
    await writeNote(plugin.app, `${folder}/Maps/${slugify(tmState.mapName)}.md`, mapMd);
    new Notice(`Map saved to ${folder}/Maps/`);
  });
  btn(toolbar, '🗑️ Clear', 'te-btn is-danger', async () => {
    if (confirm('Clear all tiles from the map?')) { tmState.tiles = []; await plugin.saveState(); renderCanvas(); }
  });
  btn(toolbar, 'Delete Selected', 'te-btn is-sm', async () => {
    if (selectedTileId) { tmState.tiles = tmState.tiles.filter(t => t.id !== selectedTileId); selectedTileId = null; await plugin.saveState(); renderCanvas(); }
  });

  const workspace = ce(wrap, 'div', 'te-map-workspace');

  // Palette
  const palette = ce(workspace, 'div', 'te-map-palette');
  const palSearch = ce(palette, 'input', 'te-map-palette-search');
  palSearch.type = 'text'; palSearch.placeholder = '🔍 Search tiles…';

  let filteredAssets = [...TILE_ASSETS];
  const renderPalette = () => {
    // Remove all tile buttons (not the search)
    Array.from(palette.children).forEach(el => { if (el !== palSearch) el.remove(); });
    filteredAssets.forEach(asset => {
      const tileBtn = ce(palette, 'div', 'te-palette-tile' + (selectedTileType === asset.id ? ' is-selected' : ''));
      ce(tileBtn, 'span', 'te-palette-icon', asset.icon);
      ce(tileBtn, 'span', '', asset.label);
      tileBtn.addEventListener('click', () => { selectedTileType = asset.id; renderPalette(); });
    });
  };

  // Search that does NOT lose focus — filter in-place
  palSearch.addEventListener('input', () => {
    const q = palSearch.value.toLowerCase();
    filteredAssets = q ? TILE_ASSETS.filter(a => a.label.toLowerCase().includes(q) || a.id.includes(q)) : [...TILE_ASSETS];
    renderPalette();
    // Restore focus
    palSearch.focus();
  });
  renderPalette();

  // Canvas
  const canvasWrap = ce(workspace, 'div', 'te-map-canvas-wrap');
  const canvas = ce(canvasWrap, 'div', 'te-map-canvas');
  canvas.style.minHeight = '460px';

  const GRID = 60;
  const renderCanvas = () => {
    clear(canvas);
    tmState.tiles.forEach(tile => {
      const asset = TILE_ASSETS.find(a => a.id === tile.type) || { icon: '?', label: tile.type };
      const el = ce(canvas, 'div', 'te-tile' + (tile.id === selectedTileId ? ' is-selected' : ''));
      el.style.cssText = `left:${tile.x}px;top:${tile.y}px;width:${tile.w || GRID}px;height:${tile.h || GRID}px;font-size:${Math.min(tile.w || GRID, tile.h || GRID) * 0.55}px;`;
      el.textContent = asset.icon;
      el.title = asset.label;

      // Select on click
      el.addEventListener('mousedown', e => {
        e.stopPropagation();
        selectedTileId = tile.id;
        renderCanvas();
        // Start drag
        const startX = e.clientX - tile.x;
        const startY = e.clientY - tile.y;
        dragging = { tile, startX, startY };
      });

      // Resize handle
      const handle = ce(el, 'div', 'te-tile-resize');
      handle.addEventListener('mousedown', e => {
        e.stopPropagation();
        selectedTileId = tile.id;
        const startW = tile.w || GRID;
        const startH = tile.h || GRID;
        const startX = e.clientX;
        const startY = e.clientY;
        resizing = { tile, startW, startH, startX, startY };
      });
    });
  };

  // Click canvas to place tile
  canvas.addEventListener('click', async e => {
    if (dragging || resizing) return;
    if (!selectedTileType) { new Notice('Select a tile from the palette first.'); return; }
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / GRID) * GRID;
    const y = Math.floor((e.clientY - rect.top) / GRID) * GRID;
    const newTile = { id: tmState.nextId++, type: selectedTileType, x, y, w: GRID, h: GRID };
    tmState.tiles.push(newTile);
    selectedTileId = newTile.id;
    await plugin.saveState();
    renderCanvas();
  });

  // Mouse move / up for drag and resize
  const onMouseMove = e => {
    if (dragging) {
      const { tile, startX, startY } = dragging;
      tile.x = Math.max(0, Math.floor((e.clientX - startX) / GRID) * GRID);
      tile.y = Math.max(0, Math.floor((e.clientY - startY) / GRID) * GRID);
      renderCanvas();
    }
    if (resizing) {
      const { tile, startW, startH, startX, startY } = resizing;
      tile.w = Math.max(GRID, Math.round((startW + e.clientX - startX) / GRID) * GRID);
      tile.h = Math.max(GRID, Math.round((startH + e.clientY - startY) / GRID) * GRID);
      renderCanvas();
    }
  };
  const onMouseUp = async () => {
    if (dragging || resizing) { dragging = null; resizing = null; await plugin.saveState(); }
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Delete key
  const onKeyDown = async e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTileId && document.activeElement === document.body) {
      tmState.tiles = tmState.tiles.filter(t => t.id !== selectedTileId);
      selectedTileId = null;
      await plugin.saveState(); renderCanvas();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // Cleanup listeners when canvas is removed from DOM
  const observer = new MutationObserver(() => {
    if (!canvas.isConnected) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      observer.disconnect();
    }
  });
  observer.observe(canvas.parentElement || document.body, { childList: true });

  renderCanvas();
}


// ── NPCs & CREATURES ──────────────────────────────────────────────────────────
function renderNpcs(main, plugin) {
  pageHead(main, plugin, 'NPCs & Creatures', 'Full NPC builder, creature stat blocks, BBEG builder, and relationship tracker.', [
    { label: '+ NPC', primary: true, onClick: () => new NPCModal(plugin.app, plugin).open() },
    { label: '+ Creature', onClick: () => new CreatureModal(plugin.app, plugin).open() },
    { label: '+ BBEG', onClick: () => new BBEGModal(plugin.app, plugin).open() },
  ]);

  sectionHead(main, 'NPCs');
  itemCards(main, plugin, 'npcs', { meta: ['race', 'role', 'status', 'faction', 'location'] });
  sectionHead(main, 'Creatures');
  itemCards(main, plugin, 'creatures', { meta: ['creatureType', 'size', 'cr', 'alignment'] });
  sectionHead(main, 'BBEGs');
  itemCards(main, plugin, 'bbegs', { meta: ['title', 'status'] });

  // Relationship Tracker
  sectionHead(main, 'Relationship Tracker');
  renderRelationshipTracker(main, plugin);
}

function renderRelationshipTracker(parent, plugin) {
  const wrap = ce(parent, 'div', 'te-card');
  wrap.style.marginBottom = '16px';
  const hd = ce(wrap, 'div', 'te-card-head');
  ce(hd, 'span', 'te-card-icon', '🕸️');
  ce(hd, 'h3', 'te-card-title', 'NPC Relationships');
  btn(hd, '+ Add Relationship', 'te-btn is-sm is-primary', () => new RelationshipModal(plugin.app, plugin).open());

  const rels = safeArr(plugin.state.relationships);
  if (!rels.length) { ce(wrap, 'p', 'te-card-body', 'No relationships tracked yet. Use the button above to add NPC-to-NPC or NPC-to-PC relationships.'); return; }

  const grid = ce(wrap, 'div', 'te-grid');
  grid.style.marginTop = '8px';
  rels.forEach(rel => {
    const c = ce(grid, 'div', 'te-card');
    c.style.padding = '10px';
    const head = ce(c, 'div', 'te-card-head');
    ce(head, 'span', 'te-card-icon', '🤝');
    ce(head, 'h3', 'te-card-title', `${rel.from} → ${rel.to}`);
    const meta = ce(c, 'div', 'te-card-meta');
    const r1 = ce(meta, 'div', 'te-card-meta-row');
    ce(r1, 'span', 'te-card-meta-label', 'Attitude');
    ce(r1, 'span', '', rel.attitude || 'Neutral');
    if (rel.notes) { const r2 = ce(meta, 'div', 'te-card-meta-row'); ce(r2, 'span', 'te-card-meta-label', 'Notes'); ce(r2, 'span', '', rel.notes); }
    const acts = ce(c, 'div', 'te-card-actions');
    btn(acts, 'Edit', 'te-btn is-sm', () => new RelationshipModal(plugin.app, plugin, rel).open());
    btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => {
      plugin.state.relationships = rels.filter(r => r.id !== rel.id);
      await plugin.saveState(); new Notice('Relationship deleted.');
    });
  });
}

// ── FACTIONS ──────────────────────────────────────────────────────────────────
function renderFactions(main, plugin) {
  pageHead(main, plugin, 'Factions', 'Build factions, track relationships, and manage the political landscape.', [
    { label: '+ Faction', primary: true, onClick: () => new FactionModal(plugin.app, plugin).open() },
  ]);
  sectionHead(main, 'Factions');
  itemCards(main, plugin, 'factions', { meta: ['type', 'ideology', 'territory', 'reputation'] });

  // Faction web summary
  const factions = safeArr(plugin.state.entities.factions);
  if (factions.length > 1) {
    sectionHead(main, 'Faction Web');
    const webCard = ce(main, 'div', 'te-card');
    const wh = ce(webCard, 'div', 'te-card-head');
    ce(wh, 'span', 'te-card-icon', '🕸️');
    ce(wh, 'h3', 'te-card-title', 'Faction Relationships');
    const meta = ce(webCard, 'div', 'te-card-meta');
    factions.forEach(f => {
      if (!f.allies && !f.enemies) return;
      const row = ce(meta, 'div', 'te-card-meta-row');
      ce(row, 'span', 'te-card-meta-label', f.name);
      const allies = safeArr(f.allies).length ? '✅ ' + f.allies.join(', ') : '';
      const enemies = safeArr(f.enemies).length ? '❌ ' + f.enemies.join(', ') : '';
      ce(row, 'span', '', [allies, enemies].filter(Boolean).join(' | ') || 'No relationships set.');
    });
  }
}

// ── ADVENTURES & QUESTS ───────────────────────────────────────────────────────
function renderAdventure(main, plugin) {
  pageHead(main, plugin, 'Adventures & Quests', 'Adventure arcs, quests, objectives, hooks, and campaign progression.', [
    { label: '+ Adventure', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'adventures', null, adventureFields).open() },
    { label: '+ Quest', onClick: () => new QuestModal(plugin.app, plugin).open() },
  ]);
  sectionHead(main, 'Adventures');
  itemCards(main, plugin, 'adventures', { meta: ['arcType', 'status'] });
  sectionHead(main, 'Quests');
  itemCards(main, plugin, 'quests', { meta: ['questType', 'status', 'giver', 'location'] });
}

const adventureFields = [
  { key: 'name', label: 'Adventure Name', type: 'text' },
  { key: 'arcType', label: 'Arc Type', type: 'select', options: ['Main Story','Side Story','Character Arc','Faction Arc','Dungeon Delve','Investigation','Political','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Draft','Active','Completed','Abandoned'] },
  { key: 'premise', label: 'Premise', type: 'textarea' },
  { key: 'acts', label: 'Acts / Chapters', type: 'textarea' },
  { key: 'linkedQuests', label: 'Linked Quests (chip)', type: 'chip' },
  { key: 'linkedNPCs', label: 'Linked NPCs (chip)', type: 'chip' },
  { key: 'secrets', label: 'Secrets', type: 'textarea' },
  { key: 'treasure', label: 'Treasure / Rewards', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── ENCOUNTERS & COMBAT ───────────────────────────────────────────────────────
function renderEncounters(main, plugin) {
  pageHead(main, plugin, 'Encounters & Combat', 'Encounter builder, initiative tracker, and combat tools.', [
    { label: '+ Encounter', primary: true, onClick: () => new EncounterModal(plugin.app, plugin).open() },
    { label: '🎲 Roll Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ]);

  // Initiative Tracker (always visible)
  sectionHead(main, 'Initiative Tracker');
  renderInitiativeTracker(main, plugin);

  sectionHead(main, 'Encounters');
  itemCards(main, plugin, 'encounters', { meta: ['type', 'difficulty', 'location', 'linkedQuest'] });
}

function renderInitiativeTracker(parent, plugin) {
  const it = plugin.state.initiativeTracker;
  const wrap = ce(parent, 'div', 'te-init-track');

  const head = ce(wrap, 'div', 'te-init-head');
  const titleWrap = ce(head, 'div', '');
  ce(titleWrap, 'div', 'te-init-title', `⚔️ Initiative Tracker`);
  ce(titleWrap, 'div', '', it.active ? `Round ${it.round}` : 'Combat not started');
  const headBtns = ce(head, 'div', 'te-card-actions');
  btn(headBtns, 'Add PC', 'te-btn is-sm', () => new AddCombatantModal(plugin.app, plugin, 'PC').open());
  btn(headBtns, 'Add NPC', 'te-btn is-sm', () => new AddCombatantModal(plugin.app, plugin, 'NPC').open());
  btn(headBtns, 'Add Monster', 'te-btn is-sm', () => new AddCombatantModal(plugin.app, plugin, 'Monster').open());
  btn(headBtns, '🎲 Roll All', 'te-btn is-sm is-primary', async () => {
    it.combatants.forEach(c => { if (!c.initLocked) c.initiative = rollDie(20) + (modifier(c.dex) || 0); });
    it.combatants.sort((a, b) => b.initiative - a.initiative);
    it.currentIndex = 0; it.active = true;
    await plugin.saveState();
  });
  if (it.active) {
    btn(headBtns, 'Next Turn ▶', 'te-btn is-sm', async () => {
      it.currentIndex = (it.currentIndex + 1) % Math.max(1, it.combatants.length);
      if (it.currentIndex === 0) it.round++;
      await plugin.saveState();
    });
  }
  btn(headBtns, 'Reset', 'te-btn is-sm is-danger', async () => {
    if (confirm('Reset initiative tracker?')) { it.combatants = []; it.currentIndex = 0; it.round = 1; it.active = false; await plugin.saveState(); }
  });

  const list = ce(wrap, 'div', 'te-combatant-list');
  if (!it.combatants.length) { ce(list, 'p', 'te-card-body', 'No combatants. Add PCs, NPCs, or monsters above, then Roll All Initiative.'); return; }

  it.combatants.forEach((comb, idx) => {
    const row = ce(list, 'div', 'te-combatant-row' + (idx === it.currentIndex && it.active ? ' is-current' : ''));
    ce(row, 'span', 'te-combatant-type', comb.type);
    ce(row, 'span', 'te-combatant-name', comb.name);
    ce(row, 'span', 'te-combatant-init', String(comb.initiative));
    // HP display
    const hpWrap = ce(row, 'span', 'te-combatant-hp');
    hpWrap.textContent = `HP ${comb.hp}/${comb.maxHp}`;
    if (comb.tempHp) hpWrap.textContent += ` +${comb.tempHp} tmp`;
    // Conditions
    if (safeArr(comb.conditions).length) { ce(row, 'span', 'te-combatant-type', comb.conditions.join(', ')); }
    // Remove btn
    const rb = btn(row, '✕', 'te-btn is-sm is-danger', async () => {
      it.combatants.splice(idx, 1);
      if (it.currentIndex >= it.combatants.length) it.currentIndex = 0;
      await plugin.saveState();
    });
    rb.style.marginLeft = 'auto';
  });
}

// ── RULES & MECHANICS ─────────────────────────────────────────────────────────
function renderRules(main, plugin) {
  pageHead(main, plugin, 'Rules & Mechanics', 'Core rules reference, custom rules, conditions, and damage types.', [
    { label: '+ Custom Rule', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'rules', null, ruleFields).open() },
    { label: '🎲 Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ]);

  // DM Quick Reference
  sectionHead(main, 'DM Quick Reference');
  const g = ce(main, 'div', 'te-grid');
  const refSections = [
    ['Combat Actions', '⚔️', 'Attack · Cast Spell · Dash · Disengage · Dodge · Help · Hide · Ready · Search · Use Object · Grapple (Attack action) · Shove (Attack action)'],
    ['Bonus Actions', '⚡', 'Class/feature only · Off-hand attack (TWF) · Spells with Bonus Action cast time · Cunning Action (Rogue) · Flurry (Monk) · Healing Word'],
    ['Reactions', '🔄', 'Opportunity Attack · Shield (spell) · Readied Action trigger · Counterspell · Hellish Rebuke · Absorb Elements'],
    ['Concentration', '🧠', 'Broken by: casting another concentration spell, taking damage (CON save DC max(10, ½dmg)), becoming incapacitated, or death.'],
    ['Resting', '🌙', 'Short Rest: 1+ hr, spend Hit Dice. Long Rest: 8 hr, restore all HP & ½ max Hit Dice & all spell slots.'],
    ['Cover', '🛡️', 'Half Cover: +2 AC, DEX saves. ¾ Cover: +5 AC, DEX saves. Total Cover: untargetable directly.'],
    ['Vision', '👁️', 'Bright → Dim: lightly obscured (disadvantage on Perception). Darkness: heavily obscured, effectively blind for sight-based checks.'],
    ['Travel', '🚶', 'Fast: 4 mph, −5 Passive Perception. Normal: 3 mph. Slow: 2 mph, can attempt Stealth.'],
  ];
  refSections.forEach(([title, icon, text]) => {
    const c = ce(g, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', icon);
    ce(hd, 'h3', 'te-card-title', title);
    ce(c, 'p', 'te-card-body', text);
  });

  // Conditions (two-column)
  sectionHead(main, 'Conditions');
  const condGrid = ce(main, 'div', 'te-conditions-grid');
  safeArr(plugin.state.entities.conditions).forEach(cond => {
    const c = ce(condGrid, 'div', 'te-condition-card');
    ce(c, 'div', 'te-condition-name', cond.name);
    ce(c, 'div', 'te-condition-summary', cond.summary || '');
  });

  sectionHead(main, 'Damage Types');
  itemCards(main, plugin, 'damageTypes', { meta: ['category'] });
  sectionHead(main, 'Custom Rules');
  itemCards(main, plugin, 'rules', { meta: ['category'] });
}

const ruleFields = [
  { key: 'name', label: 'Rule Name', type: 'text' },
  { key: 'category', label: 'Category', type: 'select', options: ['Core','Combat','Magic','Exploration','Social','Downtime','Economy','Optional','House Rule','Other'] },
  { key: 'summary', label: 'Summary', type: 'textarea' },
  { key: 'examples', label: 'Examples', type: 'textarea' },
  { key: 'tags', label: 'Tags (chip)', type: 'chip' },
];

// ── DOWNTIME & BASES ──────────────────────────────────────────────────────────
function renderDowntime(main, plugin) {
  pageHead(main, plugin, 'Downtime & Bases', 'Downtime activities, crafting projects, and bastions / strongholds.', [
    { label: '+ Activity', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'downtime', null, downtimeFields).open() },
    { label: '+ Project', onClick: () => new ProjectModal(plugin.app, plugin).open() },
    { label: '+ Bastion', onClick: () => new GenericModal(plugin.app, plugin, 'bastions', null, bastionFields).open() },
  ]);
  sectionHead(main, 'Downtime Activities');
  itemCards(main, plugin, 'downtime', { meta: ['activityType', 'timeRequired', 'cost'] });
  sectionHead(main, 'Projects & Crafting');
  itemCards(main, plugin, 'projects', {
    meta: ['projectType', 'progress', 'assignedTo'],
    onEdit: (plugin, key, item) => new ProjectModal(plugin.app, plugin, item).open(),
  });
  sectionHead(main, 'Bastions & Strongholds');
  itemCards(main, plugin, 'bastions', { meta: ['location', 'income', 'maintenanceCost'] });
}

const downtimeFields = [
  { key: 'name', label: 'Activity Name', type: 'text' },
  { key: 'activityType', label: 'Activity Type', type: 'select', options: ['Training','Crafting','Research','Carousing','Business','Relationship Building','Recuperation','Spell Research','Faction Work','Buying/Selling Magic Items','Other'] },
  { key: 'timeRequired', label: 'Time Required', type: 'text' },
  { key: 'cost', label: 'Cost (gp)', type: 'text' },
  { key: 'outcomes', label: 'Outcomes', type: 'textarea' },
  { key: 'complications', label: 'Complications (chip)', type: 'chip' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const bastionFields = [
  { key: 'name', label: 'Bastion Name', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'rooms', label: 'Rooms (chip)', type: 'chip' },
  { key: 'facilities', label: 'Facilities (chip)', type: 'chip' },
  { key: 'staff', label: 'Staff (chip)', type: 'chip' },
  { key: 'upgrades', label: 'Upgrades (chip)', type: 'chip' },
  { key: 'income', label: 'Income (gp/period)', type: 'text' },
  { key: 'maintenanceCost', label: 'Maintenance Cost', type: 'text' },
  { key: 'defences', label: 'Defences', type: 'textarea' },
  { key: 'events', label: 'Events / Threats', type: 'textarea' },
  { key: 'linkedSettlement', label: 'Linked Settlement', type: 'text' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── SESSIONS & TIMELINE ───────────────────────────────────────────────────────
function renderSessions(main, plugin) {
  pageHead(main, plugin, 'Sessions & Timeline', 'Session logs, milestones, and the campaign calendar.', [
    { label: '+ Session Log', primary: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
    { label: '▶ Run / Resume', run: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
    { label: '+ Milestone', onClick: () => new GenericModal(plugin.app, plugin, 'milestones', null, milestoneFields).open() },
    { label: '🗓️ Calendar', onClick: () => new CalendarModal(plugin.app, plugin).open() },
  ]);

  // Calendar summary
  const cal = plugin.state.calendar;
  if (cal && cal.name) {
    const calCard = ce(main, 'div', 'te-card');
    calCard.style.marginBottom = '16px';
    const ch = ce(calCard, 'div', 'te-card-head');
    ce(ch, 'span', 'te-card-icon', '🗓️');
    ce(ch, 'h3', 'te-card-title', cal.name || 'Campaign Calendar');
    const cm = ce(calCard, 'div', 'te-card-meta');
    [['Date', `${cal.day} ${cal.month}, Year ${cal.year}`], ['Seasons', cal.seasons], ['Moons', cal.moons], ['Holidays', cal.holidays]].forEach(([k, v]) => {
      if (!v) return;
      const r = ce(cm, 'div', 'te-card-meta-row');
      ce(r, 'span', 'te-card-meta-label', k);
      ce(r, 'span', '', String(v));
    });
  }

  sectionHead(main, 'Session Logs');
  itemCards(main, plugin, 'sessions', {
    meta: ['sessionNumber', 'realDate', 'gameDate'],
    onEdit: (plugin, key, item) => new SessionModal(plugin.app, plugin, item).open(),
  });
  sectionHead(main, 'Milestones');
  itemCards(main, plugin, 'milestones', { meta: ['type', 'achieved'] });
}

const milestoneFields = [
  { key: 'name', label: 'Milestone Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Level Up','Story Beat','Achievement','Quest Complete','Discovery','Relationship','Other'] },
  { key: 'achieved', label: 'Achieved Date', type: 'text' },
  { key: 'linkedSession', label: 'Linked Session', type: 'text' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── SECRETS & REVEALS ─────────────────────────────────────────────────────────
function renderSecrets(main, plugin) {
  pageHead(main, plugin, 'Secrets & Reveals', 'DM-only secrets, reveal tracking, and player-safe handouts.', [
    { label: '+ Secret', primary: true, onClick: () => new SecretModal(plugin.app, plugin).open() },
    { label: '+ Handout', onClick: () => new GenericModal(plugin.app, plugin, 'handouts', null, handoutFields).open() },
    { label: '📤 Export Player Packet', onClick: () => exportPlayerSafePacket(plugin) },
  ]);
  sectionHead(main, 'Secrets (DM Only)');
  itemCards(main, plugin, 'secrets', { meta: ['secretType', 'revealStatus', 'revealTrigger'] });
  sectionHead(main, 'Handouts');
  itemCards(main, plugin, 'handouts', {
    meta: ['type', 'visibility', 'linkedSession'],
    onExtra: (acts, item) => {
      if (item.visibility !== 'player-visible') {
        btn(acts, 'Mark Visible', 'te-btn is-sm', async () => {
          item.visibility = 'player-visible';
          upsert(plugin.state, 'handouts', item);
          await plugin.saveState(); new Notice('Handout marked player-visible.');
        });
      }
    },
  });
}

const handoutFields = [
  { key: 'name', label: 'Handout Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Letter','Map','Clue','Image','Document','Item Description','Rumour','Other'] },
  { key: 'content', label: 'Content', type: 'textarea' },
  { key: 'visibility', label: 'Visibility', type: 'select', options: ['dm-only','player-visible','secret'] },
  { key: 'linkedSession', label: 'Linked Session', type: 'text' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── COMPENDIUM & LIBRARY ──────────────────────────────────────────────────────
function renderLibrary(main, plugin) {
  pageHead(main, plugin, 'Compendium & Library', 'Browse, search, and manage compendium entries. Import JSON or export backups.', [
    { label: '+ Entry', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'compendium', null, compendiumFields).open() },
    { label: '📥 Import JSON', onClick: () => new ImportModal(plugin.app, plugin).open() },
    { label: '💾 Export Backup', onClick: () => exportBackup(plugin) },
  ]);

  // Filter by type
  const types = [...new Set(safeArr(plugin.state.entities.compendium).map(c => c.type).filter(Boolean))];
  if (types.length > 1) {
    const filterRow = ce(main, 'div', 'te-card-actions');
    filterRow.style.marginBottom = '12px';
    ce(filterRow, 'span', 'te-card-meta-label', 'Filter:');
    btn(filterRow, 'All', 'te-btn is-sm is-primary', () => {
      plugin.state.search = ''; plugin.saveState();
    });
    types.forEach(type => btn(filterRow, type, 'te-btn is-sm', () => {
      plugin.state.search = type; plugin.saveState();
    }));
  }

  sectionHead(main, 'Compendium Entries');
  itemCards(main, plugin, 'compendium', { meta: ['type', 'source', 'level'] });
  sectionHead(main, 'Rollable Tables');
  itemCards(main, plugin, 'tables', {
    meta: ['type'],
    onExtra: (acts, item) => {
      btn(acts, 'Roll', 'te-btn is-sm is-primary', () => {
        const result = rollTable(item.summary || item.rows || '');
        new Notice(`Roll result: ${result}`, 6000);
      });
    },
  });
}

function rollTable(rows) {
  const lines = String(rows || '').split('\n').map(l => l.trim()).filter(l => l.includes('|'));
  if (!lines.length) return 'No rows.';
  const entries = lines.map(l => { const parts = l.split('|').map(p => p.trim()); return { result: parts[1] || parts[0], weight: parseInt(parts[2] || '1') || 1 }; });
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = Math.floor(Math.random() * total) + 1;
  for (const e of entries) { r -= e.weight; if (r <= 0) return e.result; }
  return entries[entries.length - 1].result;
}

const compendiumFields = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Ancestry','Class','Background','Subclass','Spell','Item','Weapon','Armour','Magic Item','Monster','Rule','Table','Optional Rule','Other'] },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'level', label: 'Level / CR', type: 'text' },
  { key: 'summary', label: 'Summary', type: 'textarea' },
  { key: 'description', label: 'Full Description', type: 'textarea' },
  { key: 'tags', label: 'Tags (chip)', type: 'chip' },
];

// ── HOMEBREW ──────────────────────────────────────────────────────────────────
function renderHomebrew(main, plugin) {
  pageHead(main, plugin, 'Homebrew', 'Create and manage homebrew content for your campaign.', [
    { label: '+ Homebrew Entry', primary: true, onClick: () => new HomebrewModal(plugin.app, plugin).open() },
  ]);
  sectionHead(main, 'Homebrew Entries');
  itemCards(main, plugin, 'homebrew', {
    meta: ['type', 'status', 'visibility'],
    onEdit: (plugin, key, item) => new HomebrewModal(plugin.app, plugin, item).open(),
  });
}

// ── GENERATORS ────────────────────────────────────────────────────────────────
function renderGenerators(main, plugin) {
  pageHead(main, plugin, 'Generators & Random Tools', 'Generate NPCs, quest hooks, loot, settlement names, weather, and more.', [
    { label: '🎲 Roll Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ]);

  sectionHead(main, 'Generator Tools');
  const g = ce(main, 'div', 'te-grid');
  const genTypes = [
    ['NPC Name', '👤', 'Random NPC first + last name'],
    ['Settlement Name', '🏘️', 'Fantasy settlement name'],
    ['Tavern Name', '🍺', 'Inn or tavern name'],
    ['Quest Hook', '📋', 'Adventure hook premise'],
    ['Rumour', '💬', 'Tavern rumour or lead'],
    ['Loot', '💰', 'Treasure or loot drop'],
    ['Weather', '⛅', 'Current weather conditions'],
    ['Travel Event', '🚶', 'Random travel encounter or event'],
  ];
  genTypes.forEach(([type, icon, desc]) => {
    const c = ce(g, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', icon);
    ce(hd, 'h3', 'te-card-title', type);
    ce(c, 'p', 'te-card-body', desc);
    const acts = ce(c, 'div', 'te-card-actions');
    btn(acts, 'Generate', 'te-btn is-primary', () => new GeneratorModal(plugin.app, plugin, type).open());
  });

  sectionHead(main, 'Generator History');
  const hist = safeArr(plugin.state.generatorHistory);
  if (!hist.length) { emptyState(main, 'No generated results yet.', 'Use the generators above and save anything worth keeping.'); return; }
  const hg = ce(main, 'div', 'te-grid');
  hist.slice(0, 20).forEach(h => {
    const c = ce(hg, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '✨');
    ce(hd, 'h3', 'te-card-title', h.type || 'Generated');
    ce(c, 'p', 'te-card-body', h.result || '');
    if (h.savedAt) { const m = ce(c, 'div', 'te-card-meta'); const r = ce(m, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Saved'); ce(r, 'span', '', new Date(h.savedAt).toLocaleDateString()); }
  });
}

// ── PLAYER VIEW ───────────────────────────────────────────────────────────────
function renderPlayer(main, plugin) {
  const state = plugin.state;
  // Header
  const h = ce(main, 'div', 'te-page-head');
  ce(h, 'h1', '', 'Player View');
  ce(h, 'p', 'te-page-subtitle', 'Player-safe view. DM secrets and unrevealed content are hidden.');
  const actRow = ce(h, 'div', 'te-page-actions');
  btn(actRow, '← Back to DM Mode', 'te-btn', async () => { state.mode = 'DM'; state.activeSection = 'dashboard'; await plugin.saveState(); });
  btn(actRow, '📤 Export Player Packet', 'te-btn is-primary', () => exportPlayerSafePacket(plugin));

  // Player tabs
  const tabs = ['overview', 'character', 'quests', 'handouts', 'journal', 'lore'];
  const tabLabels = { overview:'Overview', character:'Character', quests:'Quests', handouts:'Handouts', journal:'Journal', lore:'Lore' };
  const tabRow = ce(main, 'div', 'te-player-tabs');
  tabs.forEach(t => {
    btn(tabRow, tabLabels[t], 'te-player-tab' + (state.playerTab === t ? ' is-active' : ''), async () => {
      state.playerTab = t; await plugin.saveState();
    });
  });

  const tabContent = ce(main, 'div', '');
  const tab = state.playerTab || 'overview';

  if (tab === 'overview') renderPlayerOverview(tabContent, plugin);
  else if (tab === 'character') renderPlayerCharacter(tabContent, plugin);
  else if (tab === 'quests') renderPlayerQuests(tabContent, plugin);
  else if (tab === 'handouts') renderPlayerHandouts(tabContent, plugin);
  else if (tab === 'journal') renderPlayerJournal(tabContent, plugin);
  else if (tab === 'lore') renderPlayerLore(tabContent, plugin);
}

function renderPlayerOverview(parent, plugin) {
  const camp = activeCampaign(plugin.state);
  if (!camp) { emptyState(parent, 'No active campaign.', 'Ask your DM to set an active campaign.'); return; }
  const c = ce(parent, 'div', 'te-card');
  const hd = ce(c, 'div', 'te-card-head');
  ce(hd, 'span', 'te-card-icon', '📜');
  ce(hd, 'h3', 'te-card-title', camp.name);
  if (camp.summary) ce(c, 'p', 'te-card-body', camp.summary);
  const meta = ce(c, 'div', 'te-card-meta');
  [['Theme', camp.theme], ['Level Range', camp.levelRange]].forEach(([k, v]) => {
    if (!v) return;
    const r = ce(meta, 'div', 'te-card-meta-row');
    ce(r, 'span', 'te-card-meta-label', k);
    ce(r, 'span', '', v);
  });

  // Active quests (player-visible only)
  const visQuests = safeArr(plugin.state.entities.quests).filter(q => q.visibility === 'player-visible' && q.status === 'Active');
  if (visQuests.length) {
    ce(parent, 'h2', 'te-section-head', 'Active Quests');
    const g = ce(parent, 'div', 'te-grid');
    visQuests.forEach(q => {
      const qc = ce(g, 'div', 'te-card');
      const qh = ce(qc, 'div', 'te-card-head');
      ce(qh, 'span', 'te-card-icon', '📋');
      ce(qh, 'h3', 'te-card-title', q.name);
      ce(qc, 'p', 'te-card-body', q.playerSummary || q.summary || '');
    });
  }
}

function renderPlayerCharacter(parent, plugin) {
  const chars = safeArr(plugin.state.entities.characters);
  const acts = ce(parent, 'div', 'te-page-actions');
  acts.style.justifyContent = 'flex-start';
  btn(acts, '+ New Character', 'te-btn is-primary', () => new CharacterModal(plugin.app, plugin).open());
  if (!chars.length) { emptyState(parent, 'No characters yet.', 'Click "New Character" to create your character.'); return; }

  chars.forEach(char => {
    const c = ce(parent, 'div', 'te-card');
    c.style.marginBottom = '16px';
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '🧙');
    ce(hd, 'h3', 'te-card-title', char.name);
    ce(c, 'p', 'te-card-body', `${char.race || ''} ${char.class || ''} ${char.level ? `(Lvl ${char.level})` : ''}`.trim());

    // Ability scores
    const abilityGrid = ce(c, 'div', 'te-ability-grid');
    ['str','dex','con','int','wis','cha'].forEach(ab => {
      const box = ce(abilityGrid, 'div', 'te-ability-box');
      ce(box, 'div', 'te-ability-label', ab.toUpperCase());
      ce(box, 'div', 'te-ability-score', String(char[ab] || 10));
      ce(box, 'div', 'te-ability-mod', modStr(char[ab] || 10));
    });

    // Stats
    const meta = ce(c, 'div', 'te-card-meta');
    [['HP', `${char.hp || 0} / ${char.maxHp || 0}${char.tempHp ? ` (+${char.tempHp} tmp)` : ''}`],
     ['AC', char.ac], ['Speed', char.speed], ['Proficiency', char.level ? `+${profBonus(char.level)}` : ''],
     ['Background', char.background], ['Alignment', char.alignment]].forEach(([k, v]) => {
      if (!v) return;
      const r = ce(meta, 'div', 'te-card-meta-row');
      ce(r, 'span', 'te-card-meta-label', k);
      ce(r, 'span', '', String(v));
    });
    if (safeArr(char.spells).length) {
      const r = ce(meta, 'div', 'te-card-meta-row');
      ce(r, 'span', 'te-card-meta-label', 'Spells');
      ce(r, 'span', '', char.spells.join(', '));
    }
    const cacts = ce(c, 'div', 'te-card-actions');
    btn(cacts, 'Edit', 'te-btn is-sm', () => new CharacterModal(plugin.app, plugin, char).open());
    btn(cacts, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'characters', char.id); await plugin.saveState(); });
  });
}

function renderPlayerQuests(parent, plugin) {
  const visQ = safeArr(plugin.state.entities.quests).filter(q => q.visibility === 'player-visible');
  if (!visQ.length) { emptyState(parent, 'No quests visible to players yet.', 'Your DM will share quests with you as the campaign progresses.'); return; }
  const g = ce(parent, 'div', 'te-grid');
  visQ.forEach(q => {
    const c = ce(g, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '📋');
    ce(hd, 'h3', 'te-card-title', q.name);
    ce(c, 'p', 'te-card-body', q.playerSummary || q.summary || '');
    const meta = ce(c, 'div', 'te-card-meta');
    [['Status', q.status], ['Quest Giver', q.giver], ['Location', q.location]].forEach(([k, v]) => {
      if (!v) return;
      const r = ce(meta, 'div', 'te-card-meta-row');
      ce(r, 'span', 'te-card-meta-label', k);
      ce(r, 'span', '', v);
    });
  });
}

function renderPlayerHandouts(parent, plugin) {
  const vis = safeArr(plugin.state.entities.handouts).filter(h => h.visibility === 'player-visible');
  if (!vis.length) { emptyState(parent, 'No handouts shared yet.', 'Your DM will share handouts, letters, and documents as they become available.'); return; }
  const g = ce(parent, 'div', 'te-grid');
  vis.forEach(h => {
    const c = ce(g, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '📄');
    ce(hd, 'h3', 'te-card-title', h.name);
    if (h.content) ce(c, 'p', 'te-card-body', h.content.slice(0, 300));
    const meta = ce(c, 'div', 'te-card-meta');
    if (h.type) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Type'); ce(r, 'span', '', h.type); }
  });
}

function renderPlayerJournal(parent, plugin) {
  const acts = ce(parent, 'div', 'te-page-actions');
  acts.style.justifyContent = 'flex-start';
  btn(acts, '+ Journal Entry', 'te-btn is-primary', () => new GenericModal(plugin.app, plugin, 'journals', null, journalFields).open());
  const journals = safeArr(plugin.state.entities.journals);
  if (!journals.length) { emptyState(parent, 'No journal entries yet.', 'Write down your party\'s adventures and notes.'); return; }
  itemCards(parent, plugin, 'journals', { meta: ['date', 'session'] });
}

const journalFields = [
  { key: 'name', label: 'Entry Title', type: 'text' },
  { key: 'date', label: 'Real Date', type: 'text' },
  { key: 'session', label: 'Session #', type: 'text' },
  { key: 'summary', label: 'Journal Entry', type: 'textarea' },
];

function renderPlayerLore(parent, plugin) {
  // Show worlds and cultures with player-visible content
  const worlds = safeArr(plugin.state.entities.worlds).filter(w => w.visibility !== 'dm-only' && w.visibility !== 'secret');
  const cultures = safeArr(plugin.state.entities.cultures);
  if (!worlds.length && !cultures.length) { emptyState(parent, 'No lore shared yet.', 'Your DM will share world information as you discover it.'); return; }
  if (worlds.length) {
    ce(parent, 'h2', 'te-section-head', 'World Lore');
    worlds.forEach(w => {
      const c = ce(parent, 'div', 'te-card');
      const hd = ce(c, 'div', 'te-card-head');
      ce(hd, 'span', 'te-card-icon', '🌍');
      ce(hd, 'h3', 'te-card-title', w.name);
      if (w.summary) ce(c, 'p', 'te-card-body', w.summary);
    });
  }
  if (cultures.length) {
    ce(parent, 'h2', 'te-section-head', 'Cultures');
    const g = ce(parent, 'div', 'te-grid');
    cultures.forEach(c => {
      const card = ce(g, 'div', 'te-card');
      const hd = ce(card, 'div', 'te-card-head');
      ce(hd, 'span', 'te-card-icon', '🎭');
      ce(hd, 'h3', 'te-card-title', c.name);
      if (c.summary) ce(card, 'p', 'te-card-body', c.summary);
    });
  }
}


// ── MODALS ────────────────────────────────────────────────────────────────────

// GenericModal — driven by a field definition array
class GenericModal extends Modal {
  constructor(app, plugin, key, item, fields) {
    super(app);
    this.plugin = plugin;
    this.key = key;
    this.fields = fields || [];
    this.item = item || {};
    this.values = Object.assign({ id: uid(key), visibility: 'dm-only', tags: [] }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} ${ENTITY_LABELS[this.key] || this.key}` });
    this.fields.forEach(f => this.renderField(contentEl, f));
    if (!this.fields.find(f => f.key === 'visibility')) {
      addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    }
    modalButtons(contentEl, this, async () => {
      if (!this.values.name && !this.values.title) { new Notice('Name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, this.key, this.values);
      await this.plugin.saveState();
      new Notice(`${ENTITY_LABELS[this.key] || this.key} saved.`);
      this.close();
    });
  }
  renderField(el, f) {
    if (f.type === 'text') addField(el, f.label, this.values[f.key] || '', v => this.values[f.key] = v);
    else if (f.type === 'textarea') addField(el, f.label, this.values[f.key] || '', v => this.values[f.key] = v, 'textarea');
    else if (f.type === 'select') addSelect(el, f.label, this.values[f.key] || (f.options && f.options[0]) || '', f.options || [], v => this.values[f.key] = v);
    else if (f.type === 'number') addNumber(el, f.label, this.values[f.key] || 0, v => this.values[f.key] = v);
    else if (f.type === 'toggle') addToggle(el, f.label, !!this.values[f.key], v => this.values[f.key] = v);
    else if (f.type === 'chip') chipField(el, f.label, this.values[f.key] || [], v => this.values[f.key] = v, f.opts || {});
  }
}

// CampaignModal
class CampaignModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('campaign'), name: '', summary: '', theme: 'Heroic Fantasy',
      levelRange: '1-20', status: 'Active', visibility: 'dm-only',
      notes: '', createdAt: new Date().toISOString(),
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Campaign` });
    addField(contentEl, 'Campaign Name *', this.values.name, v => this.values.name = v);
    addField(contentEl, 'Summary', this.values.summary, v => this.values.summary = v, 'textarea');
    addSelect(contentEl, 'Status', this.values.status, ['Active','On Hold','Completed','Archived'], v => this.values.status = v);
    addSelect(contentEl, 'Theme', this.values.theme, ['Heroic Fantasy','Dark Fantasy','Sword & Sorcery','Political Intrigue','Horror','Mystery','Exploration','Epic','Mythic','Other'], v => this.values.theme = v);
    addField(contentEl, 'Level Range', this.values.levelRange, v => this.values.levelRange = v);
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Campaign name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, 'campaigns', this.values);
      if (!this.plugin.state.activeCampaignId) this.plugin.state.activeCampaignId = this.values.id;
      await this.plugin.saveState();
      await ensureFolder(this.plugin.app, slugify(this.values.name));
      new Notice(`Campaign "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// NPCModal
class NPCModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('npc'), name: '', pronouns: '', race: '', role: '', occupation: '',
      status: 'Alive', location: '', faction: [], attitude: 'Indifferent',
      ac: 10, hp: 10, speed: '30 ft',
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      traits: [], ideals: [], bonds: [], flaws: [],
      motivation: '', secrets: '', appearance: '', voice: '',
      relationships: [], notes: '', visibility: 'dm-only', tags: [],
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} NPC` });

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Identity' });
    addField(s1, 'Name *', this.values.name, v => this.values.name = v);
    addField(s1, 'Pronouns', this.values.pronouns, v => this.values.pronouns = v);
    const raceIn = new Setting(s1).setName('Race / Ancestry').addText(t => {
      const list = contentEl.createEl('datalist');
      list.id = `npc-race-${this.values.id}`;
      ANCESTRIES.forEach(a => { const opt = list.createEl('option'); opt.value = a; });
      t.inputEl.setAttribute('list', list.id);
      t.setValue(this.values.race || '');
      t.onChange(v => this.values.race = v);
    });
    addField(s1, 'Role / Title', this.values.role, v => this.values.role = v);
    addField(s1, 'Occupation', this.values.occupation, v => this.values.occupation = v);
    addSelect(s1, 'Status', this.values.status, ['Alive','Dead','Missing','Captured','Unknown','Retired'], v => this.values.status = v);
    addField(s1, 'Location', this.values.location, v => this.values.location = v);
    chipField(s1, 'Faction(s)', this.values.faction, v => this.values.faction = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Combat Stats' });
    addNumber(s2, 'AC', this.values.ac, v => this.values.ac = v);
    addNumber(s2, 'HP', this.values.hp, v => this.values.hp = v);
    addField(s2, 'Speed', this.values.speed, v => this.values.speed = v);
    const abRow = ce(s2, 'div', '');
    abRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px';
    ['str','dex','con','int','wis','cha'].forEach(ab => {
      const abWrap = ce(abRow, 'div', '');
      new Setting(abWrap).setName(`${ab.toUpperCase()} (${modStr(this.values[ab])})`).addText(t => {
        t.inputEl.type = 'number'; t.setValue(String(this.values[ab]));
        t.onChange(v => { this.values[ab] = parseInt(v) || 10; });
      });
    });

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Personality' });
    addSelect(s3, 'Attitude', this.values.attitude, ['Friendly','Indifferent','Suspicious','Hostile','Fanatic','Unknown'], v => this.values.attitude = v);
    chipField(s3, 'Personality Traits', this.values.traits, v => this.values.traits = v, { suggestions: ['Brave','Cunning','Greedy','Loyal','Cautious','Cheerful','Grim','Wise','Impulsive','Secretive'] });
    chipField(s3, 'Ideals', this.values.ideals, v => this.values.ideals = v);
    chipField(s3, 'Bonds', this.values.bonds, v => this.values.bonds = v);
    chipField(s3, 'Flaws', this.values.flaws, v => this.values.flaws = v);
    addField(s3, 'Motivation', this.values.motivation, v => this.values.motivation = v, 'textarea');
    addField(s3, 'Appearance', this.values.appearance, v => this.values.appearance = v, 'textarea');
    addField(s3, 'Voice / Mannerisms', this.values.voice, v => this.values.voice = v);

    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'DM Notes' });
    addField(s4, 'Secrets (DM only)', this.values.secrets, v => this.values.secrets = v, 'textarea');
    chipField(s4, 'Relationships', this.values.relationships, v => this.values.relationships = v);
    addField(s4, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    addSelect(s4, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('NPC name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, 'npcs', this.values);
      await this.plugin.saveState();
      new Notice(`NPC "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// CreatureModal
class CreatureModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('creature'), name: '', size: 'Medium', creatureType: 'Humanoid',
      cr: '1', alignment: 'True Neutral', ac: 12, hp: 7, speed: '30 ft',
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      senses: '', languages: '', traits: '', actions: '', reactions: '',
      legendaryActions: '', lairActions: '', lore: '', habitat: '', loot: '',
      visibility: 'dm-only', tags: [],
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Creature` });
    addField(contentEl, 'Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Size', this.values.size, SIZES, v => this.values.size = v);
    addSelect(contentEl, 'Creature Type', this.values.creatureType, CREATURE_TYPES, v => this.values.creatureType = v);
    addField(contentEl, 'CR', this.values.cr, v => this.values.cr = v);
    addSelect(contentEl, 'Alignment', this.values.alignment, ALIGNMENTS, v => this.values.alignment = v);

    const statSec = ce(contentEl, 'div', 'te-modal-section');
    statSec.createEl('h3', { text: 'Stats' });
    addNumber(statSec, 'AC', this.values.ac, v => this.values.ac = v);
    addNumber(statSec, 'HP', this.values.hp, v => this.values.hp = v);
    addField(statSec, 'Speed', this.values.speed, v => this.values.speed = v);
    const abRow = ce(statSec, 'div', '');
    abRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px';
    ['str','dex','con','int','wis','cha'].forEach(ab => {
      const abWrap = ce(abRow, 'div', '');
      new Setting(abWrap).setName(`${ab.toUpperCase()} (${modStr(this.values[ab])})`).addText(t => {
        t.inputEl.type = 'number'; t.setValue(String(this.values[ab]));
        t.onChange(v => this.values[ab] = parseInt(v) || 10);
      });
    });
    addField(statSec, 'Senses', this.values.senses, v => this.values.senses = v);
    addField(statSec, 'Languages', this.values.languages, v => this.values.languages = v);

    const abilitySec = ce(contentEl, 'div', 'te-modal-section');
    abilitySec.createEl('h3', { text: 'Abilities & Actions' });
    addField(abilitySec, 'Traits', this.values.traits, v => this.values.traits = v, 'textarea');
    addField(abilitySec, 'Actions', this.values.actions, v => this.values.actions = v, 'textarea');
    addField(abilitySec, 'Reactions', this.values.reactions, v => this.values.reactions = v, 'textarea');
    addField(abilitySec, 'Legendary Actions', this.values.legendaryActions, v => this.values.legendaryActions = v, 'textarea');
    addField(abilitySec, 'Lair Actions', this.values.lairActions, v => this.values.lairActions = v, 'textarea');

    const loreSec = ce(contentEl, 'div', 'te-modal-section');
    loreSec.createEl('h3', { text: 'Lore & Encounter' });
    addField(loreSec, 'Lore', this.values.lore, v => this.values.lore = v, 'textarea');
    addField(loreSec, 'Habitat', this.values.habitat, v => this.values.habitat = v);
    addField(loreSec, 'Loot / Salvage', this.values.loot, v => this.values.loot = v, 'textarea');

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Creature name is required.'); return; }
      upsert(this.plugin.state, 'creatures', this.values);
      await this.plugin.saveState();
      new Notice(`Creature "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// BBEGModal
class BBEGModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('bbeg'), name: '', title: '', status: 'Active',
      goals: [], methods: [], resources: '', lieutenants: [],
      lairLocation: '', mythicPhases: '', escalationClocks: '',
      secrets: '', finalConfrontation: '',
      linkedFactions: [], linkedQuests: [], visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} BBEG / Major Villain` });
    addField(contentEl, 'Villain Name *', this.values.name, v => this.values.name = v);
    addField(contentEl, 'Title / Epithet', this.values.title, v => this.values.title = v);
    addSelect(contentEl, 'Status', this.values.status, ['Active','Defeated','Imprisoned','Unknown','Fled'], v => this.values.status = v);

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Goals & Methods' });
    chipField(s1, 'Goals', this.values.goals, v => this.values.goals = v, { suggestions: ['World domination','Revenge','Immortality','Power','Wealth','Destroy a god','Reshape reality','Other'] });
    chipField(s1, 'Methods', this.values.methods, v => this.values.methods = v, { suggestions: ['Manipulation','Armies','Magic','Assassination','Corruption','Subterfuge','Brute force'] });
    addField(s1, 'Resources', this.values.resources, v => this.values.resources = v, 'textarea');
    chipField(s1, 'Lieutenants', this.values.lieutenants, v => this.values.lieutenants = v);
    addField(s1, 'Lair Location', this.values.lairLocation, v => this.values.lairLocation = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Campaign Arc' });
    addField(s2, 'Mythic Phases', this.values.mythicPhases, v => this.values.mythicPhases = v, 'textarea');
    addField(s2, 'Escalation Clocks', this.values.escalationClocks, v => this.values.escalationClocks = v, 'textarea');
    addField(s2, 'Final Confrontation Notes', this.values.finalConfrontation, v => this.values.finalConfrontation = v, 'textarea');

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'DM Secrets' });
    addField(s3, 'Secrets', this.values.secrets, v => this.values.secrets = v, 'textarea');
    chipField(s3, 'Linked Factions', this.values.linkedFactions, v => this.values.linkedFactions = v);
    chipField(s3, 'Linked Quests', this.values.linkedQuests, v => this.values.linkedQuests = v);

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Villain name is required.'); return; }
      upsert(this.plugin.state, 'bbegs', this.values);
      await this.plugin.saveState();
      new Notice(`BBEG "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// FactionModal
class FactionModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('faction'), name: '', type: '', ideology: '', territory: '',
      leadership: '', goals: [], methods: [], resources: '', ranks: [],
      allies: [], enemies: [], publicFace: '', secretAgenda: '',
      reputation: '', rewards: '', consequences: '', visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Faction` });
    addField(contentEl, 'Faction Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Faction Type', this.values.type || 'Criminal', ['Criminal','Political','Religious','Military','Mercantile','Academic','Secret Society','Resistance','Cult','Guild','Noble House','Other'], v => this.values.type = v);
    addField(contentEl, 'Ideology', this.values.ideology, v => this.values.ideology = v, 'textarea');
    addField(contentEl, 'Territory', this.values.territory, v => this.values.territory = v);
    addField(contentEl, 'Leadership', this.values.leadership, v => this.values.leadership = v);
    chipField(contentEl, 'Goals', this.values.goals, v => this.values.goals = v);
    chipField(contentEl, 'Methods', this.values.methods, v => this.values.methods = v);
    addField(contentEl, 'Resources', this.values.resources, v => this.values.resources = v, 'textarea');
    chipField(contentEl, 'Ranks / Titles', this.values.ranks, v => this.values.ranks = v);
    chipField(contentEl, 'Allies', this.values.allies, v => this.values.allies = v);
    chipField(contentEl, 'Enemies', this.values.enemies, v => this.values.enemies = v);
    addField(contentEl, 'Public Face', this.values.publicFace, v => this.values.publicFace = v, 'textarea');
    addField(contentEl, 'Secret Agenda', this.values.secretAgenda, v => this.values.secretAgenda = v, 'textarea');
    addField(contentEl, 'Reputation', this.values.reputation, v => this.values.reputation = v);
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Faction name is required.'); return; }
      upsert(this.plugin.state, 'factions', this.values);
      await this.plugin.saveState();
      new Notice(`Faction "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// QuestModal
class QuestModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('quest'), name: '', questType: 'Side', status: 'Available',
      giver: '', location: '', relatedNPCs: [], relatedFactions: [],
      objectives: '', stages: '', hooks: [], complications: [],
      rewards: '', consequences: '', secrets: '', playerSummary: '', dmNotes: '',
      linkedEncounters: [], visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Quest` });
    addField(contentEl, 'Quest Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Quest Type', this.values.questType, ['Main','Side','Personal','Faction','Investigation','Escort','Retrieval','Elimination','Exploration','Social','Other'], v => this.values.questType = v);
    addSelect(contentEl, 'Status', this.values.status, ['Available','Active','Completed','Failed','Abandoned'], v => this.values.status = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addField(contentEl, 'Quest Giver', this.values.giver, v => this.values.giver = v);
    addField(contentEl, 'Location', this.values.location, v => this.values.location = v);
    chipField(contentEl, 'Related NPCs', this.values.relatedNPCs, v => this.values.relatedNPCs = v);
    chipField(contentEl, 'Related Factions', this.values.relatedFactions, v => this.values.relatedFactions = v);
    addField(contentEl, 'Objectives', this.values.objectives, v => this.values.objectives = v, 'textarea');
    addField(contentEl, 'Stages / Steps', this.values.stages, v => this.values.stages = v, 'textarea');
    chipField(contentEl, 'Hooks', this.values.hooks, v => this.values.hooks = v);
    chipField(contentEl, 'Complications', this.values.complications, v => this.values.complications = v);
    addField(contentEl, 'Rewards', this.values.rewards, v => this.values.rewards = v, 'textarea');
    addField(contentEl, 'Consequences (failure)', this.values.consequences, v => this.values.consequences = v, 'textarea');
    addField(contentEl, 'Player-Visible Summary', this.values.playerSummary, v => this.values.playerSummary = v, 'textarea');
    addField(contentEl, 'DM Notes (hidden)', this.values.secrets, v => this.values.secrets = v, 'textarea');
    chipField(contentEl, 'Linked Encounters', this.values.linkedEncounters, v => this.values.linkedEncounters = v);
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Quest name is required.'); return; }
      upsert(this.plugin.state, 'quests', this.values);
      await this.plugin.saveState();
      new Notice(`Quest "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// EncounterModal
class EncounterModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('encounter'), name: '', type: 'Combat', location: '',
      participants: [], enemyGroups: '', difficulty: 'Medium',
      terrain: '', tactics: '', objectives: '',
      victoryConditions: '', failureConditions: '', rewards: '',
      linkedQuest: '', notes: '', visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Encounter` });
    addField(contentEl, 'Encounter Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Encounter Type', this.values.type, ['Combat','Social','Exploration','Trap','Chase','Hazard','Skill Challenge','Puzzle','Boss Fight','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Difficulty', this.values.difficulty, ['Trivial','Easy','Medium','Hard','Deadly','Mythic'], v => this.values.difficulty = v);
    addField(contentEl, 'Location', this.values.location, v => this.values.location = v);
    chipField(contentEl, 'Participants (PCs)', this.values.participants, v => this.values.participants = v);
    addField(contentEl, 'Enemy Groups', this.values.enemyGroups, v => this.values.enemyGroups = v, 'textarea');
    addField(contentEl, 'Terrain', this.values.terrain, v => this.values.terrain = v);
    addField(contentEl, 'Tactics', this.values.tactics, v => this.values.tactics = v, 'textarea');
    addField(contentEl, 'Objectives', this.values.objectives, v => this.values.objectives = v, 'textarea');
    addField(contentEl, 'Victory Conditions', this.values.victoryConditions, v => this.values.victoryConditions = v, 'textarea');
    addField(contentEl, 'Failure Conditions', this.values.failureConditions, v => this.values.failureConditions = v, 'textarea');
    addField(contentEl, 'Rewards / Loot', this.values.rewards, v => this.values.rewards = v, 'textarea');
    addField(contentEl, 'Linked Quest', this.values.linkedQuest, v => this.values.linkedQuest = v);
    addField(contentEl, 'DM Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Encounter name is required.'); return; }
      upsert(this.plugin.state, 'encounters', this.values);
      await this.plugin.saveState();
      new Notice(`Encounter "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// SessionModal
class SessionModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('session'), name: '', sessionNumber: '', realDate: new Date().toISOString().slice(0, 10),
      gameDate: '', partyMembers: [], recap: '', prepNotes: '',
      scenes: '', npcsMet: [], questsAdvanced: [], secretsRevealed: [],
      lootAwarded: '', xpMilestones: '', cliffhanger: '', nextSessionNotes: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    const camp = activeCampaign(this.plugin.state);
    const nextNum = safeArr(this.plugin.state.entities.sessions).length + 1;
    if (!this.values.name) this.values.name = `Session ${this.values.sessionNumber || nextNum}`;
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Session Log` });
    addField(contentEl, 'Session Name', this.values.name, v => this.values.name = v);
    addField(contentEl, 'Session #', this.values.sessionNumber || String(nextNum), v => this.values.sessionNumber = v);
    addField(contentEl, 'Real Date', this.values.realDate, v => this.values.realDate = v);
    addField(contentEl, 'In-World Date', this.values.gameDate, v => this.values.gameDate = v);
    chipField(contentEl, 'Party Members Present', this.values.partyMembers, v => this.values.partyMembers = v);
    addField(contentEl, 'Recap / Summary', this.values.recap, v => this.values.recap = v, 'textarea');
    addField(contentEl, 'Prep Notes (DM)', this.values.prepNotes, v => this.values.prepNotes = v, 'textarea');
    addField(contentEl, 'Scenes / Encounters', this.values.scenes, v => this.values.scenes = v, 'textarea');
    chipField(contentEl, 'NPCs Met', this.values.npcsMet, v => this.values.npcsMet = v);
    chipField(contentEl, 'Quests Advanced', this.values.questsAdvanced, v => this.values.questsAdvanced = v);
    chipField(contentEl, 'Secrets Revealed', this.values.secretsRevealed, v => this.values.secretsRevealed = v);
    addField(contentEl, 'Loot Awarded', this.values.lootAwarded, v => this.values.lootAwarded = v, 'textarea');
    addField(contentEl, 'XP / Milestones', this.values.xpMilestones, v => this.values.xpMilestones = v);
    addField(contentEl, 'Cliffhanger', this.values.cliffhanger, v => this.values.cliffhanger = v, 'textarea');
    addField(contentEl, 'Next Session Notes', this.values.nextSessionNotes, v => this.values.nextSessionNotes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) this.values.name = `Session ${this.values.sessionNumber || nextNum}`;
      upsert(this.plugin.state, 'sessions', this.values);
      await this.plugin.saveState();
      new Notice(`Session "${this.values.name}" saved.`);
      this.close();
    }, 'Save Session');
  }
}

// SecretModal
class SecretModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('secret'), name: '', secretType: 'NPC Secret',
      relatedEntities: [], revealTrigger: '', revealStatus: 'Hidden',
      content: '', dmNotes: '', visibility: 'secret',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Secret` });
    addField(contentEl, 'Secret Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Secret Type', this.values.secretType, ['NPC Secret','Faction Secret','Location Secret','World Secret','Quest Twist','Villain Truth','Player Backstory','Cosmology Reveal','Other'], v => this.values.secretType = v);
    addSelect(contentEl, 'Reveal Status', this.values.revealStatus, ['Hidden','Partially Revealed','Fully Revealed'], v => this.values.revealStatus = v);
    addField(contentEl, 'Reveal Trigger', this.values.revealTrigger, v => this.values.revealTrigger = v);
    chipField(contentEl, 'Related Entities', this.values.relatedEntities, v => this.values.relatedEntities = v);
    addField(contentEl, 'Secret Content *', this.values.content, v => this.values.content = v, 'textarea');
    addField(contentEl, 'DM Notes', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Secret name is required.'); return; }
      if (!this.values.content.trim()) { new Notice('Secret content is required.'); return; }
      upsert(this.plugin.state, 'secrets', this.values);
      await this.plugin.saveState();
      new Notice(`Secret "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// CalendarModal
class CalendarModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.values = Object.assign({ name: 'Campaign Calendar', year: 1, month: 'Month 1', day: 1, weekdays: [], months: [], seasons: [], moons: [], holidays: [], importantDates: '', notes: '' }, plugin.state.calendar || {});
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: 'Calendar System' });
    addField(contentEl, 'Calendar Name', this.values.name, v => this.values.name = v);
    addNumber(contentEl, 'Current Year', this.values.year, v => this.values.year = v);
    addField(contentEl, 'Current Month', this.values.month, v => this.values.month = v);
    addNumber(contentEl, 'Current Day', this.values.day, v => this.values.day = v);
    chipField(contentEl, 'Months', this.values.months, v => this.values.months = v, { placeholder: 'Month name…' });
    chipField(contentEl, 'Weekdays', this.values.weekdays, v => this.values.weekdays = v, { placeholder: 'Day name…' });
    chipField(contentEl, 'Seasons', this.values.seasons, v => this.values.seasons = v, { suggestions: ['Spring','Summer','Autumn','Winter','Dry Season','Wet Season','Storm Season','Harvest'] });
    chipField(contentEl, 'Moons', this.values.moons, v => this.values.moons = v, { placeholder: 'Moon name…' });
    chipField(contentEl, 'Holidays', this.values.holidays, v => this.values.holidays = v, { placeholder: 'Holiday name…' });
    addField(contentEl, 'Important Dates', this.values.importantDates, v => this.values.importantDates = v, 'textarea');
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      this.plugin.state.calendar = this.values;
      await this.plugin.saveState();
      new Notice('Calendar saved.');
      this.close();
    });
  }
}

// DiceModal
class DiceModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.formula = '1d20';
    this.mode = 'Normal';
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: '🎲 Dice Roller' });
    const result = ce(contentEl, 'div', 'te-result-box', 'Click a die or enter a formula and roll.');
    const diceRow = ce(contentEl, 'div', 'te-card-actions');
    diceRow.style.flexWrap = 'wrap';
    ['d4','d6','d8','d10','d12','d20','d100'].forEach(die => {
      btn(diceRow, die, 'te-btn', () => { this.formula = '1' + die; formulaIn.value = this.formula; roll(); });
    });
    const formulaIn = ce(contentEl, 'input');
    formulaIn.type = 'text'; formulaIn.value = this.formula; formulaIn.placeholder = '2d6+3';
    formulaIn.style.cssText = 'width:100%;margin:8px 0;padding:6px 10px;border:1px solid var(--te-border);border-radius:var(--te-r-sm);background:var(--te-bg);color:var(--te-text)';
    formulaIn.addEventListener('input', () => this.formula = formulaIn.value);
    addSelect(contentEl, 'Mode', this.mode, ['Normal','Advantage','Disadvantage'], v => this.mode = v);
    const roll = () => {
      const r = rollFormula(this.formula, this.mode);
      result.textContent = `${r.label}: ${r.total}  [${r.rolls.join(', ')}]`;
      this.plugin.state.diceHistory.unshift({ ...r, at: Date.now() });
      if (this.plugin.state.diceHistory.length > 100) this.plugin.state.diceHistory.length = 100;
      this.plugin.saveState();
    };
    btn(contentEl, '🎲 Roll', 'te-btn is-primary', roll);
    // History
    const hist = safeArr(this.plugin.state.diceHistory).slice(0, 10);
    if (hist.length) {
      ce(contentEl, 'div', 'te-section-head', 'Recent Rolls').style.marginTop = '16px';
      hist.forEach(h => { const p = ce(contentEl, 'p', 'te-card-body', `${h.label}: ${h.total}  [${(h.rolls||[]).join(', ')}]`); p.style.margin = '2px 0'; });
    }
  }
}

// GeneratorModal
class GeneratorModal extends Modal {
  constructor(app, plugin, type) {
    super(app);
    this.plugin = plugin;
    this.type = type || 'NPC Name';
    this.result = '';
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: '✨ Generator' });
    const resultBox = ce(contentEl, 'div', 'te-result-box', 'Click Generate to roll a result.');
    addSelect(contentEl, 'Generator Type', this.type, Object.keys(GEN_TABLES), v => this.type = v);
    const generate_ = () => { this.result = generate(this.type, this.plugin.state); resultBox.textContent = this.result; };
    btn(contentEl, '✨ Generate', 'te-btn is-primary', generate_);
    btn(contentEl, '🔄 Reroll', 'te-btn', generate_);
    btn(contentEl, '📋 Copy', 'te-btn', () => { if (this.result) navigator.clipboard.writeText(this.result).then(() => new Notice('Copied!')); });
    btn(contentEl, '💾 Save Result', 'te-btn', async () => {
      if (!this.result) generate_();
      this.plugin.state.generatorHistory.unshift({ id: uid('gen'), type: this.type, result: this.result, savedAt: Date.now() });
      if (this.plugin.state.generatorHistory.length > 200) this.plugin.state.generatorHistory.length = 200;
      await this.plugin.saveState();
      new Notice('Result saved to generator history.');
    });
  }
}

// ProjectModal
class ProjectModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('project'), name: '', projectType: 'Crafting',
      progress: 0, total: 8, materials: '', cost: '', assignedTo: '', notes: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Project` });
    addField(contentEl, 'Project Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Type', this.values.projectType, ['Crafting','Research','Training','Construction','Spell Research','Other'], v => this.values.projectType = v);
    addNumber(contentEl, 'Progress (workdays)', this.values.progress, v => this.values.progress = v);
    addNumber(contentEl, 'Total Required (workdays)', this.values.total, v => this.values.total = v);
    addField(contentEl, 'Materials Required', this.values.materials, v => this.values.materials = v, 'textarea');
    addField(contentEl, 'Cost (gp)', this.values.cost, v => this.values.cost = v);
    addField(contentEl, 'Assigned To', this.values.assignedTo, v => this.values.assignedTo = v);
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Project name is required.'); return; }
      this.values.completed = this.values.progress >= this.values.total;
      upsert(this.plugin.state, 'projects', this.values);
      await this.plugin.saveState();
      new Notice(`Project "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// HomebrewModal
class HomebrewModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('homebrew'), name: '', type: 'Spell', status: 'Draft',
      playerVisible: false, summary: '', description: '', mechanicsText: '', dmNotes: '', tags: [],
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Homebrew Entry` });
    addField(contentEl, 'Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Type', this.values.type, ['Ancestry','Class','Subclass','Background','Feat','Spell','Item','Weapon','Armour','Monster','NPC Template','Rule','Faction','Deity','Plane','Mechanic','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Status', this.values.status, ['Draft','Playtested','Final','Deprecated'], v => this.values.status = v);
    addToggle(contentEl, 'Player-Visible', this.values.playerVisible, v => this.values.playerVisible = v);
    addField(contentEl, 'Summary', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(contentEl, 'Full Description', this.values.description, v => this.values.description = v, 'textarea');
    addField(contentEl, 'Mechanics Text', this.values.mechanicsText, v => this.values.mechanicsText = v, 'textarea');
    addField(contentEl, 'DM Notes (hidden)', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    chipField(contentEl, 'Tags', this.values.tags, v => this.values.tags = v);
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Name is required.'); return; }
      upsert(this.plugin.state, 'homebrew', this.values);
      await this.plugin.saveState();
      new Notice(`Homebrew entry "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// ImportModal
class ImportModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.key = 'compendium';
    this.payload = '[]';
    this.preview = '';
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: '📥 Import JSON' });
    addSelect(contentEl, 'Import Target', this.key, Object.keys(ENTITY_LABELS), v => this.key = v);
    const ta = ce(contentEl, 'textarea');
    ta.placeholder = 'Paste JSON array or object here…';
    ta.rows = 8; ta.style.width = '100%';
    ta.addEventListener('input', () => this.payload = ta.value);
    const previewBox = ce(contentEl, 'div', 'te-result-box', 'Paste JSON above to preview.');
    btn(contentEl, '🔍 Preview', 'te-btn', () => {
      try {
        const data = JSON.parse(this.payload);
        const arr = Array.isArray(data) ? data : [data];
        previewBox.textContent = `Found ${arr.length} item(s). First: ${arr[0]?.name || JSON.stringify(arr[0]).slice(0, 60)}`;
      } catch { previewBox.textContent = 'Invalid JSON — check the format.'; }
    });
    modalButtons(contentEl, this, async () => {
      try {
        const data = JSON.parse(this.payload);
        const arr = Array.isArray(data) ? data : [data];
        arr.forEach(x => upsert(this.plugin.state, this.key, Object.assign({ id: uid(this.key), name: 'Imported Entry' }, x)));
        await this.plugin.saveState();
        new Notice(`Imported ${arr.length} item(s) into ${this.key}.`);
        this.close();
      } catch (e) { new Notice('Import failed: ' + e.message); }
    }, 'Import');
  }
}

// SettingsModal
class SettingsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.values = Object.assign({}, plugin.state.settings);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: '⚙️ TTRPG Engine Settings' });
    const camp = activeCampaign(this.plugin.state);
    new Setting(contentEl).setName('Active Campaign Folder').setDesc(camp ? slugify(camp.name) + '/' : 'No active campaign. Create one first.').addButton(b => {
      b.setButtonText('Change Campaign').onClick(() => { this.close(); this.plugin.state.activeSection = 'campaigns'; this.plugin.saveState(); });
    });
    addToggle(contentEl, 'Compact Mode', this.values.compact, v => this.values.compact = v);
    new Setting(contentEl).setName('Kill Switch').setDesc(`Create ${KILL_SWITCH_FILES[0]} in the plugin folder to prevent loading on next restart.`);
    const diagBtn = btn(contentEl, '🔍 Diagnostic Summary', 'te-btn', () => {
      const e = this.plugin.state.entities;
      const msg = Object.keys(e).map(k => `${ENTITY_LABELS[k] || k}: ${safeArr(e[k]).length}`).join('\n');
      new Notice('Content Summary:\n\n' + msg, 8000);
    });
    diagBtn.style.marginTop = '12px';
    modalButtons(contentEl, this, async () => {
      this.plugin.state.settings = Object.assign(this.plugin.state.settings, this.values);
      await this.plugin.saveState();
      new Notice('Settings saved.');
      this.close();
    });
  }
}

// AddCombatantModal
class AddCombatantModal extends Modal {
  constructor(app, plugin, type) {
    super(app);
    this.plugin = plugin;
    this.type = type || 'NPC';
    this.values = { name: '', initiative: 0, initLocked: false, hp: 10, maxHp: 10, tempHp: 0, ac: 10, dex: 10, conditions: [], type: this.type };
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `Add ${this.type} to Initiative` });
    addField(contentEl, 'Name *', this.values.name, v => this.values.name = v);
    addNumber(contentEl, 'Initiative (or 0 to auto-roll)', this.values.initiative, v => { this.values.initiative = v; this.values.initLocked = v !== 0; });
    addNumber(contentEl, 'Max HP', this.values.maxHp, v => { this.values.maxHp = v; this.values.hp = v; });
    addNumber(contentEl, 'AC', this.values.ac, v => this.values.ac = v);
    addNumber(contentEl, 'DEX score (for init modifier)', this.values.dex, v => this.values.dex = v);
    chipField(contentEl, 'Conditions', this.values.conditions, v => this.values.conditions = v, { suggestions: CONDITIONS_LIST });
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Name is required.'); return; }
      if (!this.values.initLocked) this.values.initiative = rollDie(20) + modifier(this.values.dex);
      this.values.hp = this.values.maxHp;
      this.plugin.state.initiativeTracker.combatants.push(this.values);
      this.plugin.state.initiativeTracker.combatants.sort((a, b) => b.initiative - a.initiative);
      this.plugin.state.initiativeTracker.active = true;
      await this.plugin.saveState();
      new Notice(`${this.values.name} added (init: ${this.values.initiative}).`);
      this.close();
    }, 'Add to Tracker');
  }
}

// RelationshipModal
class RelationshipModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('rel'), from: '', to: '', type: 'NPC-to-NPC',
      attitude: 'Neutral', notes: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Relationship` });
    const npcNames = safeArr(this.plugin.state.entities.npcs).map(n => n.name);
    const charNames = safeArr(this.plugin.state.entities.characters).map(c => c.name);
    const allNames = [...npcNames, ...charNames];
    addSelect(contentEl, 'Relationship Type', this.values.type, ['NPC-to-NPC','NPC-to-PC','Faction-to-NPC','Faction-to-Faction'], v => this.values.type = v);
    addField(contentEl, 'From (NPC/PC name)', this.values.from, v => this.values.from = v);
    addField(contentEl, 'To (NPC/PC name)', this.values.to, v => this.values.to = v);
    addSelect(contentEl, 'Attitude', this.values.attitude, ['Allied','Friendly','Neutral','Suspicious','Hostile','Enemy','Unknown'], v => this.values.attitude = v);
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.from.trim() || !this.values.to.trim()) { new Notice('Both From and To are required.'); return; }
      if (!Array.isArray(this.plugin.state.relationships)) this.plugin.state.relationships = [];
      const idx = this.plugin.state.relationships.findIndex(r => r.id === this.values.id);
      if (idx >= 0) this.plugin.state.relationships[idx] = this.values;
      else this.plugin.state.relationships.unshift(this.values);
      await this.plugin.saveState();
      new Notice('Relationship saved.');
      this.close();
    });
  }
}

// CharacterModal (Player Mode)
class CharacterModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('char'), name: '', race: '', class: '', background: '', level: 1, alignment: 'True Neutral',
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      hp: 0, maxHp: 0, tempHp: 0, ac: 10, speed: '30 ft',
      skills: [], savingThrows: [], features: [], spells: [],
      equipment: [], currency: { gp: 0, sp: 0, cp: 0 },
      backstory: '', notes: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Character` });

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Identity' });
    addField(s1, 'Character Name *', this.values.name, v => this.values.name = v);
    // Race datalist
    new Setting(s1).setName('Race / Ancestry').addText(t => {
      const dl = s1.createEl('datalist'); dl.id = 'char-race-dl';
      ANCESTRIES.forEach(a => { const o = dl.createEl('option'); o.value = a; });
      t.inputEl.setAttribute('list', dl.id);
      t.setValue(this.values.race || '');
      t.onChange(v => this.values.race = v);
    });
    // Class datalist
    new Setting(s1).setName('Class').addText(t => {
      const dl = s1.createEl('datalist'); dl.id = 'char-class-dl';
      CLASSES.forEach(c => { const o = dl.createEl('option'); o.value = c; });
      t.inputEl.setAttribute('list', dl.id);
      t.setValue(this.values.class || '');
      t.onChange(v => this.values.class = v);
    });
    new Setting(s1).setName('Background').addText(t => {
      const dl = s1.createEl('datalist'); dl.id = 'char-bg-dl';
      BACKGROUNDS.forEach(b => { const o = dl.createEl('option'); o.value = b; });
      t.inputEl.setAttribute('list', dl.id);
      t.setValue(this.values.background || '');
      t.onChange(v => this.values.background = v);
    });
    addNumber(s1, 'Level', this.values.level, v => this.values.level = v);
    addSelect(s1, 'Alignment', this.values.alignment, ALIGNMENTS, v => this.values.alignment = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Ability Scores' });
    const rollAllBtn = btn(s2, '🎲 Roll All (4d6 drop lowest)', 'te-btn', () => {
      ['str','dex','con','int','wis','cha'].forEach(ab => { this.values[ab] = roll4d6dl(); });
      this.onOpen(); // re-render with new values
    });
    const abGrid = ce(s2, 'div', '');
    abGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px';
    ['str','dex','con','int','wis','cha'].forEach(ab => {
      const abWrap = ce(abGrid, 'div', '');
      new Setting(abWrap).setName(`${ab.toUpperCase()} — ${modStr(this.values[ab])}`).addText(t => {
        t.inputEl.type = 'number'; t.setValue(String(this.values[ab]));
        t.onChange(v => this.values[ab] = parseInt(v) || 10);
      });
    });

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Combat Stats' });
    addNumber(s3, 'Max HP', this.values.maxHp, v => { this.values.maxHp = v; if (!this.values.hp) this.values.hp = v; });
    addNumber(s3, 'Current HP', this.values.hp, v => this.values.hp = v);
    addNumber(s3, 'Temp HP', this.values.tempHp, v => this.values.tempHp = v);
    addNumber(s3, 'AC', this.values.ac, v => this.values.ac = v);
    addField(s3, 'Speed', this.values.speed, v => this.values.speed = v);

    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'Proficiencies & Features' });
    chipField(s4, 'Skills', this.values.skills, v => this.values.skills = v, { suggestions: ['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation','Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'] });
    chipField(s4, 'Saving Throw Proficiencies', this.values.savingThrows, v => this.values.savingThrows = v, { suggestions: ['STR','DEX','CON','INT','WIS','CHA'] });
    chipField(s4, 'Features & Traits', this.values.features, v => this.values.features = v);

    // Spells (show for spellcasting classes)
    const isSpellcaster = SPELLCASTING_CLASSES.includes(this.values.class);
    if (isSpellcaster) {
      const s5 = ce(contentEl, 'div', 'te-modal-section');
      s5.createEl('h3', { text: 'Spells' });
      chipField(s5, 'Known / Prepared Spells', this.values.spells, v => this.values.spells = v, { placeholder: 'Spell name…' });
    }

    const s6 = ce(contentEl, 'div', 'te-modal-section');
    s6.createEl('h3', { text: 'Equipment & Currency' });
    chipField(s6, 'Equipment', this.values.equipment, v => this.values.equipment = v, { placeholder: 'Item…' });
    const currRow = ce(s6, 'div', '');
    currRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px';
    ['gp','sp','cp'].forEach(coin => {
      const cw = ce(currRow, 'div', '');
      new Setting(cw).setName(coin.toUpperCase()).addText(t => {
        t.inputEl.type = 'number'; t.setValue(String((this.values.currency || {})[coin] || 0));
        t.onChange(v => { if (!this.values.currency) this.values.currency = {}; this.values.currency[coin] = parseInt(v) || 0; });
      });
    });

    addField(contentEl, 'Backstory', this.values.backstory, v => this.values.backstory = v, 'textarea');
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Character name is required.'); return; }
      upsert(this.plugin.state, 'characters', this.values);
      await this.plugin.saveState();
      new Notice(`Character "${this.values.name}" saved.`);
      this.close();
    }, 'Save Character');
  }
}

// ── DiagnosticsModal ──────────────────────────────────────────────────────────
class DiagnosticsModal extends Modal {
  constructor(app, plugin, crashReport) { super(app); this.plugin = plugin; this._crashReport = crashReport || null; }

  async onOpen() {
    this.titleEl.setText(this._crashReport ? 'Last Crash Report' : 'Diagnostics & Integrity Report');
    const { contentEl } = this;
    clear(contentEl);

    // Crash report view
    if (this._crashReport) {
      const pre = ce(contentEl, 'pre', 'te-diag-info');
      pre.style.cssText = 'white-space:pre-wrap;max-height:60vh;overflow-y:auto;padding:12px;border:1px solid var(--te-border);border-radius:var(--te-r-md)';
      pre.textContent = this._crashReport;
      btn(contentEl, 'Clear Crash Lock', 'te-btn is-danger', async () => {
        await clearCrashLock(this.plugin.app);
        new Notice('Crash lock cleared.');
        this.close();
      });
      btn(contentEl, 'Close', 'te-btn is-primary', () => this.close());
      return;
    }

    ce(contentEl, 'p', 'te-diag-info', 'Running diagnostics…');
    const { issues, info, counts } = await runDiagnostics(this.plugin);
    clear(contentEl);

    // System info
    const infoSec = ce(contentEl, 'div', 'te-modal-section');
    infoSec.createEl('h3', { text: 'System Info' });
    info.forEach(line => ce(infoSec, 'p', 'te-diag-info', line));

    // Entity counts
    const nonEmpty = Object.entries(counts).filter(([, v]) => v > 0);
    if (nonEmpty.length) {
      const countSec = ce(contentEl, 'div', 'te-modal-section');
      countSec.createEl('h3', { text: 'Entity Counts' });
      const grid = ce(countSec, 'div', 'te-stat-grid');
      nonEmpty.forEach(([k, v]) => {
        const card = ce(grid, 'div', 'te-stat-card');
        ce(card, 'div', 'te-stat-value', String(v));
        ce(card, 'div', 'te-stat-label', ENTITY_LABELS[k] || k);
      });
    }

    // Issues
    const issuesSec = ce(contentEl, 'div', 'te-modal-section');
    issuesSec.createEl('h3', { text: `Issues (${issues.length})` });
    if (!issues.length) {
      ce(issuesSec, 'p', 'te-diag-ok', '✅ No issues found — data looks healthy.');
    } else {
      issues.forEach(({ sev, msg }) => {
        const row = ce(issuesSec, 'div', `te-diag-issue is-${sev}`);
        ce(row, 'span', 'te-diag-badge', sev === 'error' ? '❌' : '⚠️');
        ce(row, 'span', '', msg);
      });
    }

    // Actions
    const actSec = ce(contentEl, 'div', 'te-modal-section');
    actSec.createEl('h3', { text: 'Actions' });
    const actRow = ce(actSec, 'div', 'te-modal-actions');
    btn(actRow, '🔧 Repair & Reindex', 'te-btn', async () => {
      migrateState(this.plugin.state);
      await this.plugin.saveState();
      new Notice('Data repaired and reindexed.');
      this.onOpen();
    });
    btn(actRow, '💾 Backup Now', 'te-btn', () => exportBackup(this.plugin));
    btn(actRow, '🔓 Clear Crash Lock', 'te-btn', async () => {
      await clearCrashLock(this.plugin.app);
      new Notice('Crash lock cleared.');
      this.onOpen();
    });
    btn(actRow, '📋 View Crash Report', 'te-btn', async () => {
      const report = await readCrashReport(this.plugin.app);
      if (!report) { new Notice('No crash report found.'); return; }
      new DiagnosticsModal(this.app, this.plugin, report).open();
    });
    btn(actRow, '⚠️ Enable Safe Mode', 'te-btn is-danger', async () => {
      await enableSafeMode(this.plugin.app);
      new Notice('Safe mode enabled — plugin will not load on next startup.', 7000);
      this.plugin.refreshViews();
      this.onOpen();
    });
    btn(actRow, '✅ Disable Safe Mode', 'te-btn', async () => {
      await disableSafeMode(this.plugin.app);
      new Notice('Safe mode disabled.');
      this.plugin.refreshViews();
      this.onOpen();
    });
    btn(contentEl, 'Close', 'te-btn is-primary', () => this.close());
  }
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
module.exports = TTRPGEnginePlugin;


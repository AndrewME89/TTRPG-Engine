'use strict';
const { Plugin, ItemView, Modal, Notice, Setting, normalizePath } = require('obsidian');

// ── Constants ────────────────────────────────────────────────────────────────
const VIEW_TYPE = 'ttrpg-engine-view';
const PLUGIN_VERSION = '2.1.0';
const PLUGIN_DIR = '.obsidian/plugins/ttrpg-engine';
const KILL_SWITCH_FILES = [
  `${PLUGIN_DIR}/DISABLE_TTRPG_ENGINE.txt`,
  `${PLUGIN_DIR}/TTRPG_ENGINE_DISABLED.txt`,
  // SAFE_MODE.txt is intentionally NOT a kill switch — it loads a recovery shell instead
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
  // Stale boot marker means the previous boot started but never completed (crash/force-close).
  if (await adapterExists(app, BOOT_MARKER)) {
    const stamp = new Date().toISOString();
    const staleMsg = `TTRPG Engine detected a stale boot marker at ${stamp}.\nThe previous load cycle started but did not complete cleanly — Obsidian may have crashed or the plugin was force-closed.\nUse the "Clear Crash Lock" command to re-enable the plugin after investigation.`;
    await safeDisable(app, 'Stale boot marker — previous load did not complete', new Error(staleMsg));
    return { ok: false, reason: 'Stale boot marker detected — the previous load did not complete cleanly. Plugin blocked for safety.\nUse the "Clear Crash Lock" command to re-enable.' };
  }
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
async function clearCrashLock(app) {
  await adapterRemove(app, LOAD_FAILED);
  await adapterRemove(app, BOOT_MARKER);
  await adapterRemove(app, KILL_SWITCH_FILES[1]);
}
async function readCrashReport(app) { return (await adapterExists(app, CRASH_REPORT)) ? adapterRead(app, CRASH_REPORT) : ''; }

// ── Tile asset constants & helpers ────────────────────────────────────────────
const TILE_ASSET_ROOT = `${PLUGIN_DIR}/assets`;
const TILE_IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','webp','gif','svg']);

function prettifyAssetName(filename) {
  return String(filename || '')
    .replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
    .replace(/\b\d+x\d+\b/gi, '').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Unnamed Tile';
}
function inferAssetTags(path) {
  return String(path || '').toLowerCase().split(/[\/\\_\-\s.]+/).filter(Boolean);
}
function inferTileKind(path) {
  const p = String(path || '').toLowerCase();
  if (p.includes('background') || p.includes('base') || p.includes('floor')) return 'background';
  if (p.includes('wall')) return 'wall';
  if (p.includes('door')) return 'door';
  if (p.includes('room')) return 'room';
  if (p.includes('corridor') || p.includes('hall')) return 'corridor';
  if (p.includes('furniture') || p.includes('table') || p.includes('chair') || p.includes('bed')) return 'furniture';
  if (p.includes('prop') || p.includes('crate') || p.includes('barrel') || p.includes('clutter')) return 'prop';
  if (p.includes('token') || p.includes('creature') || p.includes('npc')) return 'token';
  if (p.includes('terrain') || p.includes('forest') || p.includes('mountain') || p.includes('water')) return 'terrain';
  return 'tile';
}
function inferTileFootprint(path) {
  const p = String(path || '').toLowerCase();
  const explicit = p.match(/(?:^|[^0-9])(\d{1,2})x(\d{1,2})(?:[^0-9]|$)/);
  if (explicit) return { widthCells: Math.max(1, Math.min(20, Number(explicit[1]))), heightCells: Math.max(1, Math.min(20, Number(explicit[2]))) };
  const kind = inferTileKind(p);
  if (kind === 'background') return { widthCells: 8, heightCells: 8 };
  if (kind === 'room')       return { widthCells: 4, heightCells: 4 };
  if (kind === 'corridor')   return { widthCells: 3, heightCells: 1 };
  if (kind === 'wall')       return { widthCells: 2, heightCells: 1 };
  if (kind === 'terrain')    return { widthCells: 2, heightCells: 2 };
  if (kind === 'furniture')  return { widthCells: 2, heightCells: 1 };
  return { widthCells: 1, heightCells: 1 };
}
function assetMatches(asset, query, category) {
  const q = String(query || '').toLowerCase();
  const haystack = [asset.label, asset.filename, asset.category, asset.kind, ...(asset.tags || [])].join(' ').toLowerCase();
  return (!q || haystack.includes(q)) && (!category || category === 'All' || asset.category === category);
}
function fallbackEmojiTileAssets() {
  // Full emoji set for when no image assets are installed — enriched with footprint data
  return TILE_ASSETS.map(a => ({
    ...a, assetId: a.id, src: null, filename: a.id, category: 'Emoji',
    kind: inferTileKind(a.id), tags: [a.id, a.label.toLowerCase()],
    ...inferTileFootprint(a.id),
  }));
}
async function scanPluginTileAssets(plugin) {
  const adapter = plugin.app.vault.adapter;
  const root = normalizePath(TILE_ASSET_ROOT);
  const assets = [];
  async function walk(folder) {
    let listed;
    try { listed = await adapter.list(folder); } catch { return; }
    for (const subfolder of (listed.folders || [])) await walk(subfolder);
    for (const file of (listed.files || [])) {
      const ext = file.split('.').pop().toLowerCase();
      if (!TILE_IMAGE_EXTENSIONS.has(ext)) continue;
      const rel = file.slice(root.length).replace(/^\/+/, '');
      const parts = rel.split('/');
      const filename = parts[parts.length - 1];
      const category = parts.length > 1 ? parts.slice(0, -1).join('/') : 'Uncategorised';
      const footprint = inferTileFootprint(file);
      assets.push({
        id: file, path: file,
        src: adapter.getResourcePath ? adapter.getResourcePath(file) : file,
        label: prettifyAssetName(filename), filename, category,
        extension: ext, kind: inferTileKind(file),
        widthCells: footprint.widthCells, heightCells: footprint.heightCells,
        tags: inferAssetTags(file),
      });
    }
  }
  await walk(root);
  return assets.sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.label).localeCompare(String(b.label)));
}
async function loadTileAssets(plugin) {
  try {
    const assets = await scanPluginTileAssets(plugin);
    return assets.length ? assets : fallbackEmojiTileAssets();
  } catch { return fallbackEmojiTileAssets(); }
}

// ── Tile asset list (legacy emoji — kept for backward compat tile lookup) ─────
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
const ANCESTRIES = [
  'Aasimar','Bugbear','Centaur','Changeling','Deep Gnome','Dragonborn','Drow','Dwarf',
  'Elf','Firbolg','Forest Gnome','Genasi','Gnome','Goblin','Goliath',
  'Half-Elf','Half-Orc','Halfling','High Elf','Hill Dwarf','Hobgoblin','Human',
  'Kalashtar','Kenku','Kobold','Lightfoot Halfling','Lizardfolk','Loxodon',
  'Minotaur','Mountain Dwarf','Orc','Rock Gnome','Shifter','Simic Hybrid',
  'Stout Halfling','Tabaxi','Tiefling','Tortle','Triton',
  'Vedalken','Warforged','Wood Elf','Yuan-ti Pureblood','Other',
];
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
const HIT_DIE_BY_CLASS = { Barbarian: 12, Fighter: 10, Paladin: 10, Ranger: 10, Bard: 8, Cleric: 8, Druid: 8, Monk: 8, Rogue: 8, Warlock: 8, Artificer: 8, Sorcerer: 6, Wizard: 6 };
const NPC_STAT_PRESETS = {
  'Commoner':    { ac: 10, hp: 4,  str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  'Skilled NPC': { ac: 11, hp: 9,  str: 11, dex: 12, con: 11, int: 12, wis: 11, cha: 11 },
  'Combat NPC':  { ac: 14, hp: 26, str: 14, dex: 13, con: 14, int: 10, wis: 11, cha: 10 },
  'Elite NPC':   { ac: 16, hp: 52, str: 16, dex: 14, con: 16, int: 12, wis: 12, cha: 12 },
  'Caster':      { ac: 12, hp: 22, str: 9,  dex: 14, con: 12, int: 16, wis: 14, cha: 11 },
};
// XP required to reach each level (index = level, so [1] = XP for level 2, etc.)
const XP_THRESHOLDS = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
// D&D 5e encounter XP thresholds per character by level [easy, medium, hard, deadly]
const ENCOUNTER_XP_THRESHOLDS = [null,[25,50,75,100],[50,100,150,200],[75,150,225,400],[125,250,375,500],[250,500,750,1100],[300,600,900,1400],[350,750,1100,1700],[450,900,1400,2100],[550,1100,1600,2400],[600,1200,1900,2800],[800,1600,2400,3600],[1000,2000,3000,4500],[1100,2200,3400,5100],[1250,2500,3800,5700],[1400,2800,4300,6400],[1600,3200,4800,7200],[2000,3900,5900,8800],[2100,4200,6300,9500],[2400,4900,7300,10900],[2800,5700,8500,12700]];

// ── Ancestry Hybridiser data ──────────────────────────────────────────────────
const ANCESTRY_DATA = {
  'Dragonborn':       { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:['Fire'],              traits:['Draconic Ancestry','Breath Weapon','Damage Resistance'] },
  'Dwarf':            { size:'Medium', speed:25,  darkvision:60,  creatureType:'Humanoid', resistance:['Poison'],            traits:['Darkvision','Dwarven Resilience','Stonecunning'] },
  'Elf':              { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Keen Senses','Fey Ancestry','Trance'] },
  'Gnome':            { size:'Small',  speed:25,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Gnome Cunning'] },
  'Half-Elf':         { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Fey Ancestry','Skill Versatility'] },
  'Half-Orc':         { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Menacing','Relentless Endurance','Savage Attacks'] },
  'Halfling':         { size:'Small',  speed:25,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Lucky','Brave','Halfling Nimbleness'] },
  'Human':            { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Extra Language','Skill or Feat'] },
  'Tiefling':         { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:['Fire'],              traits:['Darkvision','Hellish Resistance','Infernal Legacy'] },
  'Aasimar':          { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:['Necrotic','Radiant'],traits:['Darkvision','Celestial Resistance','Healing Hands','Light Bearer'] },
  'Genasi':           { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Elemental Heritage'] },
  'Goliath':          { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:["Natural Athlete","Stone's Endurance",'Powerful Build'] },
  'Tabaxi':           { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Feline Agility',"Cat's Claws"] },
  'Kenku':            { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Expert Forgery','Kenku Training','Mimicry'] },
  'Lizardfolk':       { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Hold Breath','Natural Armor','Hungry Jaws'] },
  'Triton':           { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:['Cold'],              traits:['Amphibious','Control Air and Water','Guardian of the Depths'] },
  'Yuan-ti Pureblood':{ size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:['Poison'],           traits:['Darkvision','Innate Spellcasting','Magic Resistance'] },
  'Firbolg':          { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Firbolg Magic','Hidden Step','Powerful Build'] },
  'Bugbear':          { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Long-Limbed','Sneaky','Surprise Attack'] },
  'Goblin':           { size:'Small',  speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Fury of the Small','Nimble Escape'] },
  'Hobgoblin':        { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Martial Training','Saving Face'] },
  'Kobold':           { size:'Small',  speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Pack Tactics','Sunlight Sensitivity'] },
  'Orc':              { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Aggressive','Menacing','Powerful Build'] },
  'Tortle':           { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Claws','Hold Breath','Natural Armor','Shell Defense'] },
  'Changeling':       { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Shapechanger','Changeling Instincts'] },
  'Kalashtar':        { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:['Psychic'],          traits:['Dual Mind','Mental Discipline','Mind Link'] },
  'Shifter':          { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Shifting'] },
  'Warforged':        { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:["Constructed Resilience","Sentry's Rest",'Integrated Protection'] },
  'Centaur':          { size:'Medium', speed:40,  darkvision:0,   creatureType:'Fey',      resistance:[],                   traits:['Charge','Hooves','Equine Build'] },
  'Loxodon':          { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Natural Armor','Powerful Build','Trunk'] },
  'Minotaur':         { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Horns','Goring Rush','Hammering Horns'] },
  'Simic Hybrid':     { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Animal Enhancement'] },
  'Vedalken':         { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Tireless Precision','Partially Amphibious'] },
  'Drow':             { size:'Medium', speed:30,  darkvision:120, creatureType:'Humanoid', resistance:[],                   traits:['Superior Darkvision','Fey Ancestry','Trance','Keen Senses','Drow Magic','Sunlight Sensitivity'] },
  'High Elf':         { size:'Medium', speed:30,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Keen Senses','Fey Ancestry','Trance','Cantrip','Extra Language'] },
  'Wood Elf':         { size:'Medium', speed:35,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Keen Senses','Fey Ancestry','Trance','Fleet of Foot','Mask of the Wild'] },
  'Hill Dwarf':       { size:'Medium', speed:25,  darkvision:60,  creatureType:'Humanoid', resistance:['Poison'],            traits:['Darkvision','Dwarven Resilience','Stonecunning','Dwarven Toughness'] },
  'Mountain Dwarf':   { size:'Medium', speed:25,  darkvision:60,  creatureType:'Humanoid', resistance:['Poison'],            traits:['Darkvision','Dwarven Resilience','Stonecunning','Dwarven Armor Training'] },
  'Lightfoot Halfling':{ size:'Small', speed:25,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:['Lucky','Brave','Halfling Nimbleness','Naturally Stealthy'] },
  'Stout Halfling':   { size:'Small',  speed:25,  darkvision:0,   creatureType:'Humanoid', resistance:['Poison'],            traits:['Lucky','Brave','Halfling Nimbleness','Stout Resilience'] },
  'Forest Gnome':     { size:'Small',  speed:25,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Gnome Cunning','Natural Illusionist','Speak with Small Beasts'] },
  'Rock Gnome':       { size:'Small',  speed:25,  darkvision:60,  creatureType:'Humanoid', resistance:[],                   traits:['Darkvision','Gnome Cunning',"Artificer's Lore",'Tinker'] },
  'Deep Gnome':       { size:'Small',  speed:25,  darkvision:120, creatureType:'Humanoid', resistance:[],                   traits:['Superior Darkvision','Stone Camouflage'] },
  'Other':            { size:'Medium', speed:30,  darkvision:0,   creatureType:'Humanoid', resistance:[],                   traits:[] },
};

const HYBRID_TRAIT_LIBRARY = [
  // Tier 0 — cosmetic / flavour (score 0)
  { id:'cosmetic-feature',  name:'Distinctive Feature',   tier:0, desc:'A cosmetic heritage feature (e.g. pointed ears, scaled skin, unusual eyes). No mechanical effect.' },
  { id:'extra-language',    name:'Extra Language',         tier:0, desc:"Know one additional language from a parent ancestry's cultural heritage." },
  { id:'tool-proficiency',  name:'Tool Proficiency',       tier:0, desc:"Proficiency with one tool from a parent ancestry." },
  // Tier 1 — minor (score 1)
  { id:'skill-proficiency', name:'Skill Proficiency',      tier:1, desc:'Proficiency in one skill relevant to a parent ancestry.' },
  { id:'keen-senses',       name:'Keen Senses',            tier:1, desc:'Proficiency in Perception.' },
  { id:'brave',             name:'Brave',                  tier:1, desc:'Advantage on saving throws against being frightened.' },
  { id:'lucky',             name:'Lucky',                  tier:1, desc:'When you roll a 1 on a d20 attack, check, or save, re-roll and use the new result.' },
  { id:'powerful-build',    name:'Powerful Build',         tier:1, desc:'Count as one size larger for carrying capacity and push/drag/lift.' },
  { id:'natural-weapon',    name:'Natural Weapon',         tier:1, desc:'Unarmed strikes deal 1d4 + STR (slashing or piercing); counts as a simple melee weapon.' },
  { id:'hold-breath',       name:'Hold Breath',            tier:1, desc:'Can hold breath for up to 15 minutes.' },
  { id:'minor-cantrip',     name:'Cantrip',                tier:1, desc:"Know one cantrip from a parent ancestry's spell list (spellcasting ability: INT, WIS, or CHA)." },
  { id:'tough-hide',        name:'Tough Hide',             tier:1, desc:'Natural armour: AC equals 13 + DEX modifier when not wearing armour.' },
  // Tier 2 — medium (score 2)
  { id:'darkvision-60',     name:'Darkvision 60 ft',       tier:2, desc:'See in dim light as bright light and darkness as dim light out to 60 ft.' },
  { id:'damage-resistance', name:'Damage Resistance',      tier:2, desc:'Resistance to one damage type (fire, cold, poison, necrotic, radiant, psychic, lightning, thunder, or acid).' },
  { id:'fey-ancestry',      name:'Fey Ancestry',           tier:2, desc:'Advantage on saves against charm; magic cannot put you to sleep.' },
  { id:'relentless-endurance', name:'Relentless Endurance',tier:2, desc:'When reduced to 0 HP but not killed outright, drop to 1 HP instead (long rest recharge).' },
  { id:'nimble-escape',     name:'Nimble Escape',          tier:2, desc:'You can take the Disengage or Hide action as a bonus action.' },
  { id:'savage-attacks',    name:'Savage Attacks',         tier:2, desc:'On a critical hit with a melee weapon, roll one extra damage die and add it to the damage.' },
  { id:'aggressive',        name:'Aggressive',             tier:2, desc:'As a bonus action, move up to your speed toward a hostile creature you can see or hear.' },
  { id:'innate-spell',      name:'Innate Spellcasting',    tier:2, desc:"Know one 1st-level spell from a parent ancestry; cast it once per long rest without a spell slot." },
  { id:'shifting',          name:'Shifting',               tier:2, desc:'As a bonus action, assume a bestial form for 1 min and gain temp HP equal to your CON modifier.' },
  { id:'poison-resilience', name:'Dwarven Resilience',     tier:2, desc:'Advantage on saves against poison; resistance to poison damage.' },
  { id:'magic-resistance',  name:'Magic Resistance',       tier:2, desc:'Advantage on saving throws against spells and other magical effects.' },
  // Tier 3 — strong (score 3)
  { id:'flight-30',         name:'Flight Speed 30 ft',     tier:3, desc:'Flying speed of 30 ft. Cannot fly in medium or heavy armour.' },
  { id:'darkvision-120',    name:'Darkvision 120 ft',      tier:3, desc:'See in darkness as dim light out to 120 ft.' },
  { id:'dual-resistance',   name:'Dual Damage Resistance', tier:3, desc:"Resistance to two damage types, each from a parent ancestry's heritage." },
  { id:'moderate-spellcasting', name:'Moderate Innate Spellcasting', tier:3, desc:'Know one 1st-level and one 2nd-level spell; cast each once per long rest without a slot.' },
  { id:'pack-tactics',      name:'Pack Tactics',           tier:3, desc:'Advantage on attack rolls against a creature if at least one ally is adjacent to it and not incapacitated.' },
  { id:'constructed-resilience', name:'Constructed Resilience', tier:3, desc:'Advantage vs. poison; resistance to poison; immune to disease; no food/drink/air required; immune to magical sleep.' },
  { id:'divine-heritage',   name:'Divine Heritage',        tier:3, desc:'Celestial/fiendish lineage: advantage on saves against divine effects; healing dice treat 1s as 2s.' },
];

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
  const parentDv = [values.dominantAncestry, values.recessiveAncestry, values.thirdInfluence].filter(Boolean)
    .some(a => (ANCESTRY_DATA[a] || {}).darkvision > 0);
  if (dvTraits.length > 1) warnings.push('Multiple darkvision traits selected (redundant).');
  if (dvTraits.length && parentDv) warnings.push('Darkvision trait selected but a parent ancestry already grants darkvision — consider removing.');
  const resistTraits = traitObjs.filter(t => t.id === 'damage-resistance' || t.id === 'dual-resistance' || t.id === 'poison-resilience');
  if (resistTraits.length > 1) warnings.push('Multiple damage resistance traits selected.');
  const spellTraits = traitObjs.filter(t => t.id === 'minor-cantrip' || t.id === 'innate-spell' || t.id === 'moderate-spellcasting');
  if (spellTraits.length > 1) warnings.push('Multiple innate spellcasting traits selected.');
  if (traitIds.includes('flight-30')) warnings.push('Flight is a very strong trait — recommend DM approval before level 5.');
  if (values.creatureType && values.creatureType !== 'Humanoid') warnings.push(`Non-humanoid type (${values.creatureType}) may affect spells and class features.`);
  const asiTotal = Object.values(values.asi || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
  if (asiTotal > 3 && !values.asiOverride) warnings.push(`ASI total is +${asiTotal} — exceeds +3 without DM override.`);
  return { score, rating, warnings };
}

// ── Level-up constants ────────────────────────────────────────────────────────
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
  1:[2,0,0,0,0,0,0,0,0], 2:[3,0,0,0,0,0,0,0,0], 3:[4,2,0,0,0,0,0,0,0],
  4:[4,3,0,0,0,0,0,0,0], 5:[4,3,2,0,0,0,0,0,0], 6:[4,3,3,0,0,0,0,0,0],
  7:[4,3,3,1,0,0,0,0,0], 8:[4,3,3,2,0,0,0,0,0], 9:[4,3,3,3,1,0,0,0,0],
  10:[4,3,3,3,2,0,0,0,0],11:[4,3,3,3,2,1,0,0,0],12:[4,3,3,3,2,1,0,0,0],
  13:[4,3,3,3,2,1,1,0,0],14:[4,3,3,3,2,1,1,0,0],15:[4,3,3,3,2,1,1,1,0],
  16:[4,3,3,3,2,1,1,1,0],17:[4,3,3,3,2,1,1,1,1],18:[4,3,3,3,3,1,1,1,1],
  19:[4,3,3,3,3,2,1,1,1],20:[4,3,3,3,3,2,2,1,1],
};
const HALF_CASTER_SLOTS = {
  1:[0,0,0,0,0,0,0,0,0], 2:[2,0,0,0,0,0,0,0,0], 3:[3,0,0,0,0,0,0,0,0],
  4:[3,0,0,0,0,0,0,0,0], 5:[4,2,0,0,0,0,0,0,0], 6:[4,2,0,0,0,0,0,0,0],
  7:[4,3,0,0,0,0,0,0,0], 8:[4,3,0,0,0,0,0,0,0], 9:[4,3,2,0,0,0,0,0,0],
  10:[4,3,2,0,0,0,0,0,0],11:[4,3,3,0,0,0,0,0,0],12:[4,3,3,0,0,0,0,0,0],
  13:[4,3,3,1,0,0,0,0,0],14:[4,3,3,1,0,0,0,0,0],15:[4,3,3,2,0,0,0,0,0],
  16:[4,3,3,2,0,0,0,0,0],17:[4,3,3,3,1,0,0,0,0],18:[4,3,3,3,1,0,0,0,0],
  19:[4,3,3,3,2,0,0,0,0],20:[4,3,3,3,2,0,0,0,0],
};
const PACT_SLOTS = {
  1:{slots:1,level:1}, 2:{slots:2,level:1}, 3:{slots:2,level:2}, 4:{slots:2,level:2},
  5:{slots:2,level:3}, 6:{slots:2,level:3}, 7:{slots:2,level:4}, 8:{slots:2,level:4},
  9:{slots:2,level:5},10:{slots:2,level:5},11:{slots:3,level:5},12:{slots:3,level:5},
  13:{slots:3,level:5},14:{slots:3,level:5},15:{slots:3,level:5},16:{slots:3,level:5},
  17:{slots:4,level:5},18:{slots:4,level:5},19:{slots:4,level:5},20:{slots:4,level:5},
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

// ── Option banks (Phase 4) ────────────────────────────────────────────────────
const OPTION_BANKS = {
  tones:        ['Heroic','Dark & Gritty','Epic','Political Intrigue','Horror','Mystery','Comedic','Survival','Heist','Exploration','War','Redemption Arc'],
  genres:       ['High Fantasy','Low Fantasy','Dark Fantasy','Sword & Sorcery','Urban Fantasy','Planar Adventure','Nautical','Western','Steampunk','Post-Apocalyptic','Cosmic Horror'],
  themes:       ['Redemption','Power Corrupts','Found Family','War & Its Cost','Nature vs Civilization','Freedom vs Order','Legacy & Lineage','Faith & Doubt','Identity','Corruption','Sacrifice','Revenge','Love & Loss'],
  formats:      ['West Marches','Linear Campaign','Sandbox','One-Shot','Mini-Campaign','Mega-Campaign','Episodic','Hexcrawl','Dungeon Crawl','Political Drama'],
  rulesets:     ['D&D 5e','D&D 2024','Pathfinder 2e','Old School Essentials','13th Age','Dragonbane','Worlds Without Number','FATE','Custom'],
  levellingMethods: ['Milestone','Experience Points','Session-Based','Hybrid','Custom'],
  restRules:    ['Standard (Short/Long)','Gritty Realism','Slow Burn','Epic (Always Full)','No Short Rests','Custom'],
  deathRules:   ['Standard Death Saves','Instant Death','Permadeath','Death by Agreement','Narrative Death','Custom'],
  magicItemAvailability: ['Very Rare','Rare','Common','Abundant','DMG Standard','Custom'],
  treasureStyles: ['Treasure Tables','Narrative Rewards','Milestone Rewards','Gold Economy','Mixed','Custom'],
  safetyTools:  ['Lines & Veils','X-Card','Open Door Policy','Stars & Wishes','Ritual Start/End','None'],
  campaignLoops:['Explore & Survive','Build & Defend','Quest Chain','Faction War','Political Climb','Mystery Solve','Heist & Score','Custom'],
  worldScales:  ['Village','Region','Country','Continent','World','Planar','Cosmic'],
  climateTypes: ['Temperate','Tropical','Arctic','Arid/Desert','Mediterranean','Subarctic','Highland','Oceanic','Custom'],
  governmentTypes: ['Monarchy','Republic','Theocracy','Oligarchy','Magocracy','Military Junta','Tribal Council','Merchant Council','Noble Council','Democracy','Dictatorship','Anarchy','Colonial Rule','Occupied Territory','Feudal Vassalage','City Council','Elder Council','Divine Mandate','Custom'],
  technologyLevels: ['Stone Age','Bronze Age','Iron Age','Medieval','Renaissance','Early Industrial','Magitech','Custom'],
  magicLevels:  ['Extremely Rare','Rare','Uncommon','Common','Pervasive','All-Encompassing'],
  divineLevels: ['Absent','Silent','Distant','Present','Manifest','Walking Among Mortals'],
  terrainTypes: ['Grassland','Forest','Mountains','Desert','Swamp','Tundra','Coast','Ocean','Jungle','Plains','Hills','Volcanic','Underdark','Feywild','Shadowfell'],
  biomes:       ['Temperate Forest','Rainforest','Boreal Forest','Savanna','Grassland','Desert','Scrubland','Alpine','Tundra','Wetland'],
  cosmologyModels: ['Great Wheel','World Tree','Binary (Light/Dark)','Elemental Planes','Custom Multiverse','Closed World'],
  planeTypes:   ['Material Plane','Feywild','Shadowfell','Astral Sea','Ethereal Plane','Elemental Plane','Outer Plane','Demi-Plane','Custom'],
  regionTypes:  ['Kingdom','Province','Wilderness','Borderland','Occupied Territory','Ancient Ruins','Sacred Land','Contested Zone','Free City-State','Custom'],
  settlementTypes: ['Hamlet','Village','Town','City','Metropolis','Capital','Military Fort','Trading Post','Monastery','Mining Camp','Port','Custom'],
  locationTypes: ['Dungeon','Ruins','Cave System','Tower','Temple','Outpost','Waystation','Lair','Sanctum','Battlefield','Ancient Site','Custom'],
  poiTypes:     ['Landmark','Resource Node','Danger Zone','Crossing','Hidden Cache','Portal','Shrine','Shipwreck','Custom'],
  routeTypes:   ['Road','Trade Route','Wilderness Trail','River Route','Sea Lane','Underground Passage','Teleportation Circle','Custom'],
  dungeonTypes: ['Ancient Ruins','Crypt/Tomb','Cave System','Fortress','Mine','Sewer/Undercity','Temple','Tower','Planar Node','Custom'],
  roomTypes:    ['Entrance','Corridor','Chamber','Vault','Trap Room','Boss Chamber','Puzzle Room','Barracks','Shrine','Storage','Secret Room','Escape Route','Custom'],
  hazardTypes:  ['Cave-In Risk','Toxic Gas','Flooding','Wild Magic Zone','Anti-Magic Zone','Cursed Ground','Unstable Terrain','Extreme Weather','Ley Line Interference'],
  occupations:  ['Farmer','Merchant','Blacksmith','Guard','Soldier','Priest','Healer','Scholar','Noble','Spy','Criminal','Smuggler','Sailor','Hunter','Ranger','Wizard','Bard','Innkeeper','Artisan','Miner','Fisher','Alchemist','Scribe','Servant','Mercenary','Captain','Magistrate'],
  npcRoles:     ['Ally','Rival','Enemy','Mentor','Patron','Quest Giver','Merchant','Informant','Guide','Noble','Guard','Priest','Scholar','Criminal','Spy','Soldier','Captain','Leader','Healer','Artisan','Innkeeper','Villain','Lieutenant','Love Interest','Family','Contact'],
  personalityTraits: ['Brave','Cautious','Greedy','Generous','Proud','Humble','Cunning','Naive','Suspicious','Trusting','Ambitious','Content','Vengeful','Forgiving','Mysterious','Custom'],
  ideals:       ['Justice','Freedom','Power','Knowledge','Faith','Tradition','Ambition','Family','Loyalty','Honour','Wealth','Survival','Redemption','Revenge','Balance','Mercy','Order','Chaos','Beauty','Truth'],
  bonds:        ['A person to protect','A family legacy','A sacred oath','A homeland','A lost loved one','A debt unpaid','A secret kept','A mentor','A rival','A faction','A relic','A prophecy','A place of power','A broken promise','A found family','A forbidden love'],
  flaws:        ['Greedy','Cowardly','Arrogant','Impulsive','Vengeful','Paranoid','Gullible','Cruel','Overconfident','Reckless','Secretive','Addicted','Jealous','Dishonest','Fanatical','Prideful','Naive','Ruthless','Easily bribed'],
  pronouns:     ['he/him','she/her','they/them','he/they','she/they','any pronouns','uses name only'],
  motivations:  ['Wealth','Power','Survival','Revenge','Love','Knowledge','Recognition','Safety','Redemption','Duty','Freedom','Custom'],
  attitudes:    ['Friendly','Indifferent','Suspicious','Hostile','Terrified','Fanatic','Desperate','Bored','Custom'],
  socialClasses:['Destitute','Poor','Working Class','Middle Class','Wealthy','Nobility','Royalty','Custom'],
  factionTypes: ['Military Force','Merchant Guild','Criminal Organization','Religious Order','Political Party','Adventuring Company','Secret Society','Rebel Cell','Government Body','Custom'],
  factionGoals: ['Territorial control','Economic dominance','Political power','Religious influence','Military Conquest','Public safety','Revolution','Restoration of old order','Knowledge Acquisition','Artifact recovery','Monster eradication','Planar access','Trade monopoly','Revenge','Survival','Liberation','Secrecy','Social reform','Infiltrate Institutions','Overthrow Ruler','Forge Alliance Network','Defend Sacred Sites','Seize Artifact','Elevate a Chosen One'],
  factionMethods: ['Diplomacy','Espionage','Blackmail','Assassination','Bribery','Propaganda','Open warfare','Guerrilla tactics','Legal pressure','Trade sanctions','Religious conversion','Magical coercion','Protection rackets','Charity/public goodwill','Academic research','Smuggling','Sabotage','Recruitment','Infiltration','Patronage','Military Force','Economic Pressure','Corruption','Alliance Building','Legal Manoeuvring'],
  factionResources: ['Gold','Troops','Spies','Political influence','Religious authority','Trade routes','Safehouses','Magic items','Spellcasters','Monsters','Mercenaries','Noble Patrons','Public support','Ancient knowledge','Blackmail material','Fortresses','Ships','Artifacts','Informants','Information','Trade Goods','Political Favours','Land','Labour','Contraband','Ships','Sacred Relics','Legal Authority','Owed Debts'],
  creatureSenses:   ['Darkvision','Blindsight','Tremorsense','Truesight','Passive Perception','Keen Smell','Keen Hearing','Keen Sight','Magical Sight','Lifesense','Echolocation'],
  creatureTraits:   ['Amphibious','Pack Tactics','Keen Smell','Keen Hearing','Magic Resistance','Legendary Resistance','Regeneration','Spider Climb','Flyby','Pounce','Charge','Rampage','False Appearance','Sunlight Sensitivity','Turn Resistance','Undead Fortitude','Shapechanger','Innate Spellcasting','Frightful Presence'],
  creatureActions:  ['Bite','Claw','Multiattack','Slam','Gore','Tail','Stinger','Breath Weapon','Spellcasting','Frightful Presence','Swallow','Web','Grapple','Poison Strike','Ranged Attack','Area Burst','Recharge Attack'],
  creatureReactions:['Parry','Shield','Counterspell','Retaliate','Uncanny Dodge','Deflect Attack','Reactive Strike','Legendary Parry','Tail Swipe','Wing Buffet'],
  legendaryActions: ['Detect','Move','Attack','Cast a Cantrip','Tail Attack','Wing Attack','Frightful Glare','Command Ally','Recharge Power','Teleport','Legendary Resistance'],
  lairActions:      ['Difficult Terrain','Summon Minions','Magical Darkness','Grasping Vines','Tremor','Toxic Gas','Flooding','Shadow Burst','Fire Eruption','Ice Shards','Psychic Whispers','Doors Seal','Terrain Shifts','Illusory Duplicates'],
  bbegTitles:       ['The Betrayer','The Undying','The Black Hand','The Red Queen','The Ashen King','The Whispering One','The Wyrm-Touched','The Thorn Saint','The Iron Tyrant','The Pale Duke','The Storm Crown','The Last Prophet','The God-Eater','The Hollow Lord'],
  leadershipStructure: ['Single Leader','Council','Inner Circle','Military Hierarchy','Cell Structure','Noble House','Elder Circle','Triumvirate','Guild Council','Religious Synod','Clan Chiefs','Secret Master','Public Figurehead / Hidden Leader','Distributed Network'],
  powerDynamic:     ['Dominant','Subordinate','Equal','Patron','Client','Rival power','Hidden influence','Publicly loyal','Secretly opposed','Mutually dependent','One-sided dependence','Coerced','Blackmailed','Protected','Manipulated','Feared','Respected'],
  trustLevel:       ['Absolute trust','High trust','Cautious trust','Neutral','Suspicious','Low trust','Open distrust','Betrayed','Secretly loyal','Secretly hostile','Unknown'],
  fearLeverage:     ['Blackmail','Debt','Family hostage','Political scandal','Religious guilt','Magical curse','Legal threat','Financial dependence','Reputation risk','Personal fear','Shared secret','Mutual destruction','Oathbound','Ancient pact','None'],
  relationshipStates: ['Allied','Friendly','Neutral','Tense','Hostile','At War','Ceasefire','Secret Alliance','Custom'],
  reputationLevels: ['Exalted','Revered','Honoured','Friendly','Neutral','Unfriendly','Hostile','Hated'],
  orgStructures:['Hierarchy','Cell Structure','Flat Network','Council','Single Leader','Distributed Cells','Custom'],
  questTypes:   ['Main Quest','Side Quest','Faction Quest','Personal Quest','Bounty','Exploration','Rescue','Heist','Investigation','Delivery','Escort','Custom'],
  questHooks:   ['Direct Request','Notice Board','Rumour','Discovered Clue','NPC in Distress','Enemy Threat','Old Debt','Vision/Dream','Custom'],
  objectiveTypes: ['Kill/Defeat','Retrieve','Protect','Escort','Investigate','Infiltrate','Negotiate','Survive','Discover','Deliver','Custom'],
  complicationTypes: ['Betrayal','Ticking Clock','False Information','Unexpected Ally','Moral Dilemma','Multiple Factions','Hidden Motive','Custom'],
  rewardTypes:  ['Gold','Magic Item','Favour','Information','Title/Rank','Property','Ally','Reputation','XP','Custom'],
  consequenceTypes: ['NPC Death','Faction Shift','World Change','PC Curse','Story Branch','Reputation Loss','Custom'],
  adventureStructures: ['Linear','Sandbox','Node-Based','Three-Act','Five-Room Dungeon','Custom'],
  actTypes:     ['Setup','Rising Action','Climax','Falling Action','Denouement','Interlude','Custom'],
  encounterTypes: ['Combat','Social','Exploration','Skill Challenge','Puzzle','Chase','Stealth','Trap','Random','Boss Fight','Custom'],
  difficultyBands: ['Trivial','Easy','Medium','Hard','Deadly','Legendary'],
  environmentTypes: ['Dungeon','Wilderness','Urban','Underwater','Sky','Planar','Ship','Cave','Temple','Custom'],
  tactics:      ['Ambush','Defensive','Skirmish','Siege','Guerrilla','Direct Assault','Retreat & Regroup','Custom'],
  combatRoles:  ['Frontline','Artillery','Support','Skirmisher','Controller','Leader','Custom'],
  downtimeActivities: ['Carousing','Crafting','Crime','Gambling','Pit Fighting','Relaxation','Religious Service','Research','Scribing','Training','Working','Custom'],
  projectTypes: ['Crafting','Building','Research','Organization','Custom'],
  bastionFeatures: ['Arcane Study','Armory','Barracks','Garden','Library','Smithy','Stable','Storehouse','Sanctuary','War Room','Custom'],
  skillList:    ['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation','Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'],
  tools:        ["Alchemist's Supplies","Brewer's Supplies","Calligrapher's Supplies","Carpenter's Tools","Cartographer's Tools","Cook's Utensils","Disguise Kit","Forgery Kit","Herbalism Kit","Navigator's Tools","Poisoner's Kit","Smith's Tools","Thieves' Tools"],
  spellSchools: ['Abjuration','Conjuration','Divination','Enchantment','Evocation','Illusion','Necromancy','Transmutation'],
  inventoryItemTypes: ['Weapon','Armour','Shield','Ammunition','Potion','Scroll','Ring','Wondrous Item','Tool','Adventuring Gear','Trade Good','Currency','Key','Custom'],
  escalationActions: ['Patrol Increase','Reinforcements','Siege','Assassination Attempt','Political Pressure','Infiltration','Economic Blockade','Divine Intervention','Custom'],
  warFrontTypes:['Active Front','Stalemate','Advance','Retreat','Siege','Guerrilla Campaign','Ceasefire','Custom'],
  incursionTypes:['Raid','Occupation','Corruption Spread','Portal Opening','Army Advance','Arcane Storm','Custom'],
  secretTypes:  ['Character Secret','Faction Secret','World Secret','NPC Secret','Location Secret','Item Secret','Prophecy','Custom'],
  handoutTypes: ['Document','Map','Item','Letter','Clue','Image','Custom'],
  sessionZeroTopics: ['Safety Tools','Tone & Themes','Character Concepts','Party Composition','Table Expectations','Scheduling & Frequency','Absence Policy','Between-Session Communication','Content Lines & Veils','Mature Content','Player vs Player','Character Death','Romance','Retirement Conditions','PvP Combat','Out-of-Character Communication','Custom'],
  climateRules:    ['Standard seasonal cycle','Harsh winters','Long winters','Mild winters','Extreme summers','Monsoon season','Dry season','Wet season','Magical weather','Unstable climate','Permanent winter','Permanent summer','Volcanic climate','Arctic climate','Desert climate','Tropical climate','Temperate climate','Storm season','Flood season','Drought cycle','Supernatural storms','Custom'],
  magicRules:      ['Low magic','High magic','Wild magic zones','Dead magic zones','Ley lines','Magic requires licensing','Divine magic regulated','Arcane magic outlawed','Magic is common','Magic is rare','Magic is feared','Magic is industrialised','Magic corrupts','Magic has a cost','Planar magic leaks','Resurrection is restricted','Teleportation is restricted','Divination is unreliable','Necromancy taboo','Blood magic forbidden','Custom'],
  cosmologyTypes:  ['Great Wheel','World Tree','Material Plane + Echo Planes','Elemental Cosmology','Dualistic Light/Dark','Heaven/Hell Cosmology','Planar Sea','Infinite Realms','Closed World','Dream Cosmology','Mythic Underworld','Custom'],
  planarTravelRules: ['Rare portals only','Stable portals','Unstable portals','Ritual travel','Spell-based travel','Divine permission required','Travel requires a key','Travel requires alignment','Travel causes corruption','Travel causes time dilation','Travel is one-way','Travel is dangerous','Travel attracts guardians','Travel is politically controlled','Custom'],
  ranks:           ['Initiate','Agent','Adept','Officer','Captain','Commander','Master','High Priest','Archmage','Guildmaster','Spymaster','Warden','Knight','Baron','Duke','Elder','Matriarch','Patriarch','Chancellor','Grandmaster','Custom'],
  cultureCustoms:  ['Ancestor worship','Trial by combat','Seasonal festivals','Coming-of-age pilgrimage','Gift-giving etiquette','Hospitality law','Clan oaths','Public storytelling','Mask wearing','Funeral feasts','Sacred animal traditions','Name-day ceremonies','Warrior tattoos','Marriage contracts','Communal childrearing','Ritual duels','Formal guest rights','Sacred silence','Market-day rituals','Custom'],
  cultureTaboos:   ["Speaking the dead's name",'Refusing hospitality','Drawing weapons indoors','Eating sacred animals','Cutting hair','Wearing enemy colours','Touching holy relics','Public magic','Necromancy','Breaking guest rights','Insulting ancestors','Entering temples armed','Lying under oath','Killing surrendered foes','Refusing a duel','Crossing caste boundaries','Custom'],
  socialStructure: ['Clan-based','Noble hierarchy','Merchant oligarchy','Tribal council','Elder council','Caste system','Guild-based','Matriarchal','Patriarchal','Theocratic','Military hierarchy','Communal','Meritocratic','Feudal','Nomadic bands','City-state citizenship','Anarchic communes','Custom'],
  regionalResources: ['Farmland','Fresh water','Timber','Stone','Iron ore','Copper','Silver','Gold','Gems','Salt','Fish','Livestock','Horses','Rare herbs','Spices','Silk','Furs','Coal','Oil','Magical crystals','Ley line access','Ancient ruins','Sacred site','Port access','River access','Trade road','Skilled labour','Custom'],
  worldHazards:    ['Bandits','Monsters','Undead','Fey crossings','Wild magic','Dead magic','Poisonous plants','Disease','Harsh weather','Avalanches','Flooding','Quicksand','Sinkholes','Cursed ground','Haunted ruins','Volcanic activity','Toxic gas','Predators','Political unrest','War zone','Planar instability','Treacherous roads','Custom'],
  travelConditions: ['Clear roads','Muddy roads','Washed-out roads','Snowbound passes','Bandit activity','Monster sightings','Military patrols','Toll roads','Closed borders','Dangerous river crossing','Poor visibility','Magical fog','Extreme heat','Extreme cold','Storms','Supply shortage','Safe caravan route','Unsafe at night','Road under repair','Pilgrim traffic','Refugee traffic','Custom'],
  religiousTaboos: ['Blasphemy','Eating sacred animals','Working on holy days','Entering shrines unclean','Wearing forbidden colours','Speaking divine names','Interfaith marriage','Arcane magic','Necromancy','Blood sacrifice','Refusing confession','Touching holy relics','Breaking pilgrimage vows','Custom'],
  religionPractices: ['Prayer','Sacrifice','Pilgrimage','Ritual Fasting','Meditation','Chanting','Ceremony','Initiation Rite','Coming-of-Age Ritual','Funeral Rite','Wedding Ceremony','Festival','Tithe','Confession','Divination','Blood Ritual','Seasonal Observance','Custom'],
  clergyTypes: ['Priest','Priestess','High Priest','High Priestess','Acolyte','Deacon','Archbishop','Inquisitor','Paladin','Cleric','Druid','Oracle','Shaman','Monk','Abbess','Abbot','Lector','Sexton','Custom'],
  encounterTerrain: ['Open Field','Dense Forest','Underground Cave','Urban Street','Ruined Building','Desert Sands','Coastal Cliff','Swamp','Mountain Pass','River Crossing','Temple Interior','Dungeon Chamber','Tavern','Rooftop','Ship Deck','Feywild Glade','Infernal Wasteland','Custom'],
  districtAtmosphere: ['Bustling','Quiet','Tense','Lawless','Prosperous','Decrepit','Mysterious','Dangerous','Festive','Mourning','Industrious','Scholarly','Devout','Corrupt','Custom'],
  economyTypes: ['Agrarian','Trade Hub','Mining','Fishing','Manufacturing','Magic Industry','Mercantile','Feudal Tribute','Slave Economy','Tourism','Military Contracts','Pastoral','Mixed','Custom'],
  clothingStyles: ['Practical / Functional','Elaborate / Ornate','Minimal','Robes','Armour','Religious Vestments','Merchant Dress','Noble Finery','Peasant Cloth','Military Uniform','Tribal','Runic Embroidered','Seasonal','Gender-Coded','Custom'],
  foodCulture: ['Meat-heavy','Vegetarian','Seafood','Grain-based','Foraging & Wild','Fermented / Preserved','Spiced / Exotic','Communal Feasting','Ritual Meals','Fasting Culture','Nomadic','Agricultural Surplus','Luxury Imports','Custom'],
};

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
const CAMPAIGN_SCOPED_ENTITIES = [
  'acts', 'adventures', 'quests', 'encounters', 'sessions', 'milestones', 'secrets', 'reveals', 'handouts',
  'worlds', 'cosmologies', 'realms', 'regions', 'domains', 'settlements', 'districts', 'locations', 'pois',
  'routes', 'dungeons', 'rooms', 'maps', 'npcs', 'creatures', 'bbegs', 'factions', 'nations', 'religions',
  'cultures', 'languages', 'deities', 'pantheons', 'timelines', 'loot', 'reputations', 'warFronts',
  'incursions', 'endgameStates', 'nobleFamilies', 'hybridAncestries',
];

function createDefaultState() {
  return {
    version: PLUGIN_VERSION,
    mode: 'DM',
    activeSection: 'dashboard',
    activeSubSection: '',
    sidebarCollapsed: false,
    activeCampaignId: '',
    search: '',
    calendar: { name: '', year: 1, month: '', day: 1, moons: '', seasons: '', holidays: '' },
    settings: { compact: false, campaignRootFolder: 'Campaigns', noteRootFolder: '', noteFolderMode: 'workspace', nestLocationsUnderParents: true, nestQuestsUnderAdventures: false },
    initiativeTracker: { combatants: [], currentIndex: 0, round: 1, active: false },
    tileMap: { tiles: [], nextId: 1, mapName: 'Untitled Map', gridSize: 60, width: 1800, height: 1200, assetRoot: TILE_ASSET_ROOT, selectedMapId: '', mapId: '', distanceScale: '5 ft', linkedRegionId: '', linkedSettlementId: '', linkedLocationId: '', linkedDungeonId: '', linkedPoiId: '', linkedEncounterId: '', linkedSessionId: '' },
    playerTab: 'overview',
    entities: {
      campaigns: [],
      worlds: [], cosmologies: [], realms: [],
      regions: [], domains: [], settlements: [], locations: [], pois: [], routes: [],
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
      // Phase 3+ entity types
      maps: [],
      dungeons: [],
      timers: [],
      enemyTemplates: [],
      reputations: [],
      warFronts: [],
      incursions: [],
      endgameStates: [],
      // Phase 254 entity types
      nations: [],
      religions: [],
      districts: [],
      rooms: [],
      timelines: [],
      reveals: [],
      loot: [],
      hybridAncestries: [],
      acts: [],
      nobleFamilies: [],
    },
    relationships: [],
    generatorHistory: [],
    diceHistory: [],
    // Phase 5: workspace state
    workspace: 'DM',
    // Phase 13: session run state
    sessionRunMode: false,
    activeSessionId: '',
    // Phase 14: PC state
    activeCharacterId: '',
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
  if (!state.tileMap.gridSize) state.tileMap.gridSize = 60;
  if (!state.tileMap.width)   state.tileMap.width   = 1800;
  if (!state.tileMap.height)  state.tileMap.height  = 1200;
  if (!state.tileMap.assetRoot) state.tileMap.assetRoot = TILE_ASSET_ROOT;
  if (!('mapId' in state.tileMap)) state.tileMap.mapId = '';
  if (!state.tileMap.distanceScale) state.tileMap.distanceScale = '5 ft';
  if (!('linkedRegionId' in state.tileMap)) state.tileMap.linkedRegionId = '';
  if (!('linkedSettlementId' in state.tileMap)) state.tileMap.linkedSettlementId = '';
  if (!('linkedLocationId' in state.tileMap)) state.tileMap.linkedLocationId = '';
  if (!('linkedDungeonId' in state.tileMap)) state.tileMap.linkedDungeonId = '';
  if (!('linkedPoiId' in state.tileMap)) state.tileMap.linkedPoiId = '';
  if (!('linkedEncounterId' in state.tileMap)) state.tileMap.linkedEncounterId = '';
  if (!('linkedSessionId' in state.tileMap)) state.tileMap.linkedSessionId = '';
  // Migrate old tiles: type→assetId, add widthCells/heightCells
  state.tileMap.tiles.forEach(tile => {
    if (!tile.assetId && tile.type) tile.assetId = tile.type;
    if (!tile.widthCells) tile.widthCells = Math.max(1, Math.round((tile.w || state.tileMap.gridSize) / state.tileMap.gridSize));
    if (!tile.heightCells) tile.heightCells = Math.max(1, Math.round((tile.h || state.tileMap.gridSize) / state.tileMap.gridSize));
    if (!('layer' in tile)) tile.layer = 0;
    if (!('rotation' in tile)) tile.rotation = 0;
  });
  // Ensure relationships array
  if (!Array.isArray(state.relationships)) state.relationships = [];
  // Stamp missing entity IDs / timestamps (Phase 3 schema)
  const now = new Date().toISOString();
  for (const [, arr] of Object.entries(state.entities)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach(item => {
      if (!item.id) item.id = uid('ent');
      if (!item.createdAt) item.createdAt = now;
      if (!item.updatedAt) item.updatedAt = now;
    });
  }
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
function safeFileName(name, fallback) {
  const cleaned = String(name || fallback || 'Untitled')
    .replace(/[\\/:*?"<>|#^[\]]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || String(fallback || 'Untitled');
}
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
function isInActiveCampaignScope(state, entityKey, item) {
  if (!item) return false;
  const campId = state.activeCampaignId || '';
  if (!campId) return true;
  if (!CAMPAIGN_SCOPED_ENTITIES.includes(entityKey)) return true;
  return !item.campaignId || item.campaignId === campId;
}
function toTitleCase(s) {
  return String(s || '').replace(/[\\/:*?"<>|#^[\]]+/g, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100) || 'Untitled';
}
function campaignRootFolder(plugin) {
  const s = plugin.state.settings;
  // campaignRootFolder is the new primary setting; fall back to noteRootFolder for migration compatibility
  const root = s.campaignRootFolder || s.noteRootFolder || 'Campaigns';
  return safeFileName(root, 'Campaigns');
}
function campaignFolderFor(plugin, campaign) {
  const cName = campaign ? safeFileName(campaign.name, 'Unassigned') : 'Unassigned';
  const mode = plugin.state.settings.noteFolderMode || 'workspace';
  if (mode === 'legacy') return cName;
  return `${campaignRootFolder(plugin)}/${cName}`;
}
function campaignFolder(plugin) {
  return campaignFolderFor(plugin, activeCampaign(plugin.state));
}
function globalFolder(plugin) {
  return `${campaignRootFolder(plugin)}/_Global`;
}
function getCampaignMaps(state, scopeId) {
  const byId = new Map();
  ['maps', 'tileMaps'].forEach(key => {
    safeArr(state && state.entities ? state.entities[key] : []).forEach(map => {
      if (!map || !map.id) return;
      if (scopeId && map.campaignId && map.campaignId !== scopeId) return;
      if (!byId.has(map.id)) byId.set(map.id, map);
    });
  });
  return [...byId.values()];
}
function modifier(score) { return Math.floor((Number(score || 10) - 10) / 2); }
function modStr(score) { const m = modifier(score); return (m >= 0 ? '+' : '') + m; }
function profBonus(level) { return Math.ceil(Math.max(1, Number(level || 1)) / 4) + 1; }

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
  CAMPAIGN_SCOPED_ENTITIES.forEach(key => safeArr(e[key]).forEach(item => {
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
  const domainIds = new Set(safeArr(e.domains).map(x => x.id));
  const locationIds = new Set(safeArr(e.locations).map(x => x.id));
  const settlementIds = new Set(safeArr(e.settlements).map(x => x.id));
  safeArr(e.domains).forEach(domain => {
    safeArr(domain.claimedRegionIds).forEach(regionId => {
      if (!regionIds.has(regionId)) issues.push({ sev: 'warn', msg: `Domain "${domain.name || domain.id}": references missing region "${regionId}".` });
    });
    safeArr(domain.settlementIds).forEach(settlementId => {
      if (!settlementIds.has(settlementId)) issues.push({ sev: 'warn', msg: `Domain "${domain.name || domain.id}": references missing settlement "${settlementId}".` });
    });
    safeArr(domain.locationIds).forEach(locationId => {
      if (!locationIds.has(locationId)) issues.push({ sev: 'warn', msg: `Domain "${domain.name || domain.id}": references missing location "${locationId}".` });
    });
    safeArr(domain.factionIds).forEach(factionId => {
      if (!factionIds.has(factionId)) issues.push({ sev: 'warn', msg: `Domain "${domain.name || domain.id}": references missing faction "${factionId}".` });
    });
    if (domain.controllerType && domain.controllerId) {
      const controllerItems = safeArr(e[domain.controllerType]);
      if (!controllerItems.find(item => item.id === domain.controllerId)) {
        issues.push({ sev: 'warn', msg: `Domain "${domain.name || domain.id}": controller "${domain.controllerId}" not found in ${domain.controllerType}.` });
      }
    }
    if (domain.parentRef && !domainIds.has(domain.parentRef)) {
      issues.push({ sev: 'warn', msg: `Domain "${domain.name || domain.id}": parent domain "${domain.parentRef}" was not found.` });
    }
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

  // Tile asset health
  try {
    const assetFolderExists = await adapterExists(plugin.app, TILE_ASSET_ROOT);
    if (!assetFolderExists) {
      issues.push({ sev: 'warn', msg: `Tile asset folder "${TILE_ASSET_ROOT}" not found — palette will use emoji fallbacks. Create the folder and add images for real tiles.` });
    } else {
      const assets = await scanPluginTileAssets(plugin);
      if (!assets.length) {
        issues.push({ sev: 'warn', msg: 'Asset folder exists but contains no image files — add .png/.jpg/.webp files to enable image tiles. See assets/tile-map/README.md for setup instructions.' });
        info.push(`Tile assets: 0 images in ${TILE_ASSET_ROOT} (emoji fallbacks active)`);
      } else {
        // Per-category breakdown
        const catMap = {};
        assets.forEach(a => { const c = a.category || 'Uncategorised'; catMap[c] = (catMap[c] || 0) + 1; });
        const catSummary = Object.entries(catMap).sort((a,b) => a[0].localeCompare(b[0])).map(([c, n]) => `${c}: ${n}`).join(', ');
        info.push(`Tile assets: ${assets.length} images in ${Object.keys(catMap).length} categories — ${catSummary}`);
      }
      // Broken paths in saved maps
      const assetPaths = new Set(assets.map(a => a.path));
      let missingAssetCount = 0;
      const affectedMaps = [];
      safeArr(e.maps).forEach(mapRecord => {
        const tiles = safeArr((mapRecord.tileLayout || {}).tiles);
        const brokenInMap = tiles.filter(t => t.assetPath && !assetPaths.has(t.assetPath)).length;
        if (brokenInMap > 0) { missingAssetCount += brokenInMap; affectedMaps.push(mapRecord.name || mapRecord.id); }
      });
      if (missingAssetCount > 0)
        issues.push({ sev: 'warn', msg: `${missingAssetCount} placed tile(s) in ${affectedMaps.length} map(s) reference missing assets (will show ⚠️): ${affectedMaps.join(', ')}` });
    }
    // Saved maps summary
    const savedMaps = safeArr(e.maps);
    if (savedMaps.length) {
      const totalTiles = savedMaps.reduce((s, m) => s + safeArr((m.tileLayout || {}).tiles).length, 0);
      info.push(`Saved maps: ${savedMaps.length} map(s), ${totalTiles} total placed tiles`);
    }
    // Legacy emoji-only tiles
    const allPlacedTiles = safeArr(e.maps).flatMap(m => safeArr((m.tileLayout || {}).tiles));
    const legacyTiles = allPlacedTiles.filter(t => !t.assetPath && t.type);
    if (legacyTiles.length > 0)
      info.push(`Tile legacy compat: ${legacyTiles.length} emoji-only tile(s) across saved maps (will render via emoji fallback)`);
  } catch (tileErr) {
    issues.push({ sev: 'warn', msg: `Tile asset scan failed: ${tileErr.message}` });
  }

  // Reference data health check (file existence only — no large files loaded)
  const refChecked = new Set();
  for (const [type, filename] of Object.entries(REF_DATA_FILES)) {
    if (refChecked.has(filename)) continue;
    refChecked.add(filename);
    const exists = await adapterExists(plugin.app, `${PLUGIN_DIR}/data/${filename}`);
    if (!exists) {
      issues.push({ sev: 'warn', msg: `Reference data missing: data/${filename}` });
    }
  }

  return { issues, info, counts };
}

// ── Entity picker helpers ─────────────────────────────────────────────────────
function addEntityPicker(el, label, value, plugin, entityKey, onChange) {
  const campId = plugin.state.activeCampaignId || '';
  const items = safeArr(plugin.state.entities[entityKey])
    .filter(item => {
      if (!item) return false;
      if (!campId) return true;
      if (!CAMPAIGN_SCOPED_ENTITIES.includes(entityKey)) return true;
      return !item.campaignId || item.campaignId === campId;
    })
    .slice().sort((a, b) => (a.name || a.title || '').localeCompare(b.name || b.title || ''));
  const opts = items.map(x => x.name || x.title || x.id);
  const vals = items.map(x => x.id);
  const wrap = ce(el, 'div', 'te-field-row');
  ce(wrap, 'label', 'te-field-label', label);
  const sel = ce(wrap, 'select', 'te-field-select');
  sel.style.cssText = 'flex:1;padding:6px 8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  ce(sel, 'option', '', '— none —').value = '';
  vals.forEach((v, i) => { const o = ce(sel, 'option', '', opts[i]); o.value = v; if (v === value) o.selected = true; });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
function addCampaignPicker(el, label, value, plugin, onChange) {
  return addEntityPicker(el, label, value, plugin, 'campaigns', onChange);
}
function addEntityMultiPicker(el, label, valueIds, plugin, entityKey, onChange) {
  const campId = plugin.state.activeCampaignId || '';
  const items = safeArr(plugin.state.entities[entityKey])
    .filter(item => {
      if (!item) return false;
      if (!campId) return true;
      if (!CAMPAIGN_SCOPED_ENTITIES.includes(entityKey)) return true;
      return !item.campaignId || item.campaignId === campId;
    })
    .slice().sort((a, b) => (a.name || a.title || '').localeCompare(b.name || b.title || ''));
  const selected = new Set(safeArr(valueIds));
  const wrap = ce(el, 'div', 'te-field-row'); wrap.style.alignItems = 'flex-start';
  ce(wrap, 'label', 'te-field-label', label);
  const right = ce(wrap, 'div', ''); right.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px';
  const chipRow = ce(right, 'div', 'te-chip-input');
  chipRow.style.cssText = 'flex-wrap:wrap;gap:4px;min-height:28px;padding:2px 0';
  const renderChips = () => {
    clear(chipRow);
    [...selected].forEach(id => {
      const it = items.find(x => x.id === id);
      if (!it) return;
      const chip = ce(chipRow, 'span', 'te-chip');
      chip.textContent = it.name || it.title || id;
      const rm = ce(chip, 'span', ''); rm.textContent = ' ×';
      rm.style.cssText = 'cursor:pointer;margin-left:4px;opacity:.7';
      rm.addEventListener('click', () => { selected.delete(id); renderChips(); onChange([...selected]); });
    });
  };
  const sel = ce(right, 'select', 'te-field-select');
  sel.style.cssText = 'padding:4px 8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  ce(sel, 'option', '', `— add ${label} —`).value = '';
  items.forEach(it => { const o = ce(sel, 'option', '', it.name || it.title || it.id); o.value = it.id; });
  sel.addEventListener('change', () => {
    if (sel.value) { selected.add(sel.value); renderChips(); onChange([...selected]); sel.value = ''; }
  });
  renderChips();
}
const LOCATION_LIKE_ENTITY_TYPES = [
  { key: 'locations', label: 'Location' },
  { key: 'settlements', label: 'Settlement' },
  { key: 'regions', label: 'Region' },
  { key: 'dungeons', label: 'Dungeon' },
  { key: 'rooms', label: 'Room' },
  { key: 'pois', label: 'POI' },
  { key: 'domains', label: 'Domain' },
  { key: 'realms', label: 'Realm / Plane' },
];
const THREAT_LINK_ENTITY_TYPES = [
  { key: 'factions', label: 'Faction' },
  { key: 'quests', label: 'Quest' },
  { key: 'bbegs', label: 'BBEG' },
  { key: 'warFronts', label: 'War Front' },
  { key: 'incursions', label: 'Incursion' },
  { key: 'sessions', label: 'Session' },
  ...LOCATION_LIKE_ENTITY_TYPES,
];
const BBEG_LIEUTENANT_ENTITY_TYPES = [
  { key: 'npcs', label: 'NPC' },
  { key: 'creatures', label: 'Creature' },
  { key: 'bbegs', label: 'BBEG' },
  { key: 'characters', label: 'PC / Character' },
];
const PROJECT_ASSIGNEE_ENTITY_TYPES = [
  { key: 'characters', label: 'PC / Character' },
  { key: 'npcs', label: 'NPC' },
  { key: 'factions', label: 'Faction' },
];
const INCURSION_ORIGIN_ENTITY_TYPES = [
  { key: 'realms', label: 'Realm' },
  { key: 'domains', label: 'Domain' },
  { key: 'factions', label: 'Faction' },
  { key: 'bbegs', label: 'BBEG' },
  { key: 'locations', label: 'Location' },
  { key: 'regions', label: 'Region' },
];
const QA_PLACEHOLDER_VALUES = new Set([
  'remove legacy field',
  'complete noted changes',
  'change to custom input + common options selector',
  'selector for existing entities',
  'should be able to select existing secrets',
  'should be able to select existing deity/archfey',
  'remove campaign selector. entities naturally save to active campaign',
  'remove campaign selector. entities naturally save to the active campaign',
  'remove campaign selector',
  'no text fields',
  'rollable stats + calculation should be available',
  'rollable stats + calaculation should be available',
  'remove unnecessary field',
  'good as is, but what does it connect to?',
  'connect to bbeg selector insted. no text fields',
  'remove race / ancestry (text), but make sure races in data/races.json are selectable options',
]);
const PLACEHOLDER_TEXT_VALUES = new Set([
  'select existing', 'select faction', 'select location', 'select settlement', 'select campaign',
  'select owner', 'select assignee', 'select session', 'select quest', 'select timer',
  'select source', 'select origin', 'none', 'n/a', 'na', 'tbd', 'other', 'custom',
]);
function isQaPlaceholderValue(value) {
  return QA_PLACEHOLDER_VALUES.has(String(value || '').trim().toLowerCase());
}
function isPlaceholderLike(value) {
  const v = String(value || '').trim().toLowerCase();
  return !v || PLACEHOLDER_TEXT_VALUES.has(v) || QA_PLACEHOLDER_VALUES.has(v) || v.startsWith('select ') || v === '— none —' || v === '— select —';
}
function scrubLegacyPlaceholderText(value) {
  return isPlaceholderLike(value) ? '' : String(value || '').trim();
}
function scrubLegacyPlaceholderArray(values) {
  return normalizeListField(values).filter(v => !isPlaceholderLike(v));
}
function sanitizeQaNotesValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeQaNotesValue).filter(v => v !== '' && v != null);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeQaNotesValue(v)]));
  if (typeof value === 'string') return isQaPlaceholderValue(value) ? '' : value;
  return value;
}
function typedEntityRefDisplay(ref, state) {
  if (!ref || !ref.entityType || !ref.id) return '';
  return resolveEntityDisplay(ref.entityType, ref.id, state);
}
function addTypedEntityMultiPicker(el, label, refs, plugin, entityTypes, onChange) {
  const selected = safeArr(refs).map(ref => ref && ref.entityType && ref.id ? { entityType: ref.entityType, id: ref.id } : null).filter(Boolean);
  const wrap = ce(el, 'div', 'te-field-row'); wrap.style.alignItems = 'flex-start';
  ce(wrap, 'label', 'te-field-label', label);
  const right = ce(wrap, 'div', ''); right.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px';
  const chipRow = ce(right, 'div', 'te-chip-input'); chipRow.style.cssText = 'flex-wrap:wrap;gap:4px;min-height:28px;padding:2px 0';
  const renderChips = () => {
    clear(chipRow);
    selected.forEach((ref, idx) => {
      const chip = ce(chipRow, 'span', 'te-chip');
      chip.textContent = `${entityTypes.find(t => t.key === ref.entityType)?.label || ref.entityType}: ${typedEntityRefDisplay(ref, plugin.state) || ref.id}`;
      const rm = ce(chip, 'span', ''); rm.textContent = ' ×'; rm.style.cssText = 'cursor:pointer;margin-left:4px;opacity:.7';
      rm.addEventListener('click', () => { selected.splice(idx, 1); renderChips(); onChange(selected.map(v => ({ ...v }))); });
    });
  };
  const row = ce(right, 'div', ''); row.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
  const typeSel = ce(row, 'select', 'te-field-select'); typeSel.style.cssText = 'padding:4px 8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  entityTypes.forEach(t => { const o = ce(typeSel, 'option', '', t.label); o.value = t.key; });
  const entityWrap = ce(row, 'div', ''); entityWrap.style.flex = '1';
  let currentSel = null;
  const buildSel = () => {
    clear(entityWrap);
    currentSel = addEntityPicker(entityWrap, '', '', plugin, typeSel.value, v => currentSel.value = v);
    currentSel.style.width = '100%';
  };
  typeSel.addEventListener('change', buildSel);
  buildSel();
  btn(row, '+ Add', 'te-btn te-btn-xs is-sm', () => {
    const id = currentSel && currentSel.value;
    if (!id) return;
    if (!selected.some(ref => ref.entityType === typeSel.value && ref.id === id)) {
      selected.push({ entityType: typeSel.value, id });
      renderChips();
      onChange(selected.map(v => ({ ...v })));
    }
    currentSel.value = '';
  });
  renderChips();
}

function resolveEntityDisplay(a, b, c) {
  const state = c || b;
  const entityType = c ? a : '';
  const entityId = c ? b : a;
  if (entityId == null || entityId === '') return '';
  if (typeof entityId !== 'string') return String(entityId);
  const entities = state && state.entities && typeof state.entities === 'object' ? state.entities : {};
  const collections = [
    'domains', 'regions', 'settlements', 'districts', 'locations', 'rooms', 'pois', 'routes', 'maps',
    'npcs', 'characters', 'factions', 'nobleFamilies', 'deities', 'pantheons', 'realms', 'worlds',
    'cultures', 'languages', 'nations', 'religions', 'quests', 'adventures', 'encounters', 'sessions',
    'dungeons', 'creatures', 'bbegs', 'timers', 'warFronts', 'incursions', 'secrets', 'handouts',
    'loot', 'projects', 'bastions', 'downtime', 'acts', 'enemyTemplates', 'hybridAncestries',
  ];
  const orderedCollections = entityType
    ? [entityType, ...collections.filter(key => key !== entityType)]
    : collections;
  let entity = null;
  let foundType = entityType || '';
  for (const key of orderedCollections) {
    entity = safeArr(entities[key]).find(item => item && item.id === entityId);
    if (entity) {
      foundType = key;
      break;
    }
  }
  if (!entity) return entityId;
  if (foundType === 'nobleFamilies' && entity.migratedFactionId) {
    const migratedFaction = safeArr(entities.factions).find(faction => faction && faction.id === entity.migratedFactionId);
    if (migratedFaction) return migratedFaction.name || migratedFaction.title || entity.name || entityId;
  }
  return entity.name || entity.title || entityId;
}

// ── Vault helpers ─────────────────────────────────────────────────────────────
// ── Workspace-based entity note folder map ────────────────────────────────────
const ENTITY_NOTE_FOLDERS = {
  // Campaign Command Centre
  campaigns:       'Campaign Command Centre/Campaign Overview',
  acts:            'Campaign Command Centre/Acts',
  milestones:      'Campaign Command Centre/Milestones',
  // World Atlas
  worlds:          'World Atlas/Worlds',
  cosmologies:     'World Atlas/Cosmology',
  realms:          'World Atlas/Realms',
  regions:         'World Atlas/Regions',
  nations:         'World Atlas/Nations',
  domains:         'World Atlas/Domains',
  settlements:     'World Atlas/Settlements',
  districts:       'World Atlas/Districts',
  locations:       'World Atlas/Locations',
  dungeons:        'World Atlas/Dungeons',
  rooms:           'World Atlas/Dungeons/Rooms',
  pois:            'World Atlas/Points of Interest',
  routes:          'World Atlas/Routes',
  maps:            'World Atlas/Maps',
  // Cast & Powers
  npcs:            'Cast & Powers/NPCs',
  creatures:       'Cast & Powers/Creatures',
  bbegs:           'Cast & Powers/BBEGs',
  factions:        'Cast & Powers/Factions',
  nobleFamilies:   'Cast & Powers/Noble Families',
  hybridAncestries:'Cast & Powers/Hybrid Ancestries',
  cultures:        'Cast & Powers/Cultures',
  languages:       'Cast & Powers/Languages',
  religions:       'Cast & Powers/Religions',
  pantheons:       'Cast & Powers/Pantheons',
  deities:         'Cast & Powers/Deities',
  // Adventure Planner
  adventures:      'Adventure Planner/Adventures',
  quests:          'Adventure Planner/Quests',
  encounters:      'Adventure Planner/Encounters',
  loot:            'Adventure Planner/Loot',
  // Sessions
  sessions:        'Sessions/Session Logs',
  timelines:       'Sessions/Timeline',
  calendars:       'Sessions/Calendar',
  // Secrets & Handouts
  secrets:         'Secrets & Handouts/Secrets',
  reveals:         'Secrets & Handouts/Reveals',
  handouts:        'Secrets & Handouts/Handouts',
  // Compendium
  compendium:      'Compendium/My Content',
  homebrew:        'Compendium/Homebrew',
  tables:          'Compendium/Roll Tables',
  rules:           'Compendium/Rules & Mechanics',
};

// Settlement type subfolder map
const SETTLEMENT_TYPE_FOLDERS = {
  hamlet: 'Hamlets', village: 'Villages', town: 'Towns',
  city: 'Cities', capital: 'Capitals', metropolis: 'Cities',
};

/**
 * Resolve the full vault note path for an entity.
 * @param {string} entityType  - entity collection key (e.g. 'npcs')
 * @param {object} entity      - the entity object
 * @param {object} state       - plugin state
 * @param {object} plugin      - plugin instance (for settings/root)
 * @returns {string}           - full vault-relative path including .md extension
 */
function resolveEntityNotePath(entityType, entity, state, plugin) {
  const mode = state.settings.noteFolderMode || 'workspace';
  const root = safeFileName(state.settings.campaignRootFolder || state.settings.noteRootFolder || 'Campaigns', 'Campaigns');
  const name = safeFileName(entity.name || entity.title || entity.id, 'Untitled');

  // Legacy mode: old flat paths
  if (mode === 'legacy') {
    const camp = activeCampaign(state);
    const campFolder = camp ? safeFileName(camp.name, 'Unassigned') : 'Unassigned';
    const sub = ENTITY_FOLDER_LABELS[entityType] || entityType;
    return normalizePath(`${campFolder}/${sub}/${name}.md`);
  }

  // Flat mode: root/{WorkspaceFolder}/name.md (no campaign subfolder)
  if (mode === 'flat') {
    const sub = ENTITY_NOTE_FOLDERS[entityType] || (ENTITY_FOLDER_LABELS[entityType] || entityType);
    return normalizePath(`${root}/${sub}/${name}.md`);
  }

  // Workspace mode (default): Campaigns/{Campaign}/{Workspace}/{Sub}/{name}.md
  const camp = activeCampaign(state);
  const campName = camp ? safeFileName(camp.name, 'Unassigned') : 'Unassigned';
  const campBase = `${root}/${campName}`;
  const workspaceFolder = ENTITY_NOTE_FOLDERS[entityType];

  if (!workspaceFolder) {
    // Unmapped type: put in Compendium/My Content
    return normalizePath(`${campBase}/Compendium/My Content/${name}.md`);
  }

  // Parent-aware nesting for specific types
  const nestLocations = state.settings.nestLocationsUnderParents !== false;
  const nestQuests = state.settings.nestQuestsUnderAdventures === true;

  if (entityType === 'settlements' && entity.type) {
    const typeKey = String(entity.type).toLowerCase();
    const typeFolder = SETTLEMENT_TYPE_FOLDERS[typeKey];
    if (typeFolder) return normalizePath(`${campBase}/World Atlas/Settlements/${typeFolder}/${name}.md`);
  }

  if (entityType === 'locations' && nestLocations) {
    if (entity.settlementId) {
      const settlement = safeArr(state.entities.settlements).find(s => s.id === entity.settlementId);
      if (settlement) {
        const sName = safeFileName(settlement.name, 'Settlement');
        const typeKey = String(settlement.type || '').toLowerCase();
        const typeFolder = SETTLEMENT_TYPE_FOLDERS[typeKey];
        const sFolder = typeFolder ? `Settlements/${typeFolder}/${sName}` : `Settlements/${sName}`;
        return normalizePath(`${campBase}/World Atlas/${sFolder}/Locations/${name}.md`);
      }
    }
    if (entity.regionId) {
      const region = safeArr(state.entities.regions).find(r => r.id === entity.regionId);
      if (region) {
        return normalizePath(`${campBase}/World Atlas/Regions/${safeFileName(region.name, 'Region')}/Locations/${name}.md`);
      }
    }
  }

  if (entityType === 'districts' && nestLocations) {
    if (entity.settlementId) {
      const settlement = safeArr(state.entities.settlements).find(s => s.id === entity.settlementId);
      if (settlement) {
        const sName = safeFileName(settlement.name, 'Settlement');
        const typeKey = String(settlement.type || '').toLowerCase();
        const typeFolder = SETTLEMENT_TYPE_FOLDERS[typeKey];
        const sFolder = typeFolder ? `Settlements/${typeFolder}/${sName}` : `Settlements/${sName}`;
        return normalizePath(`${campBase}/World Atlas/${sFolder}/Districts/${name}.md`);
      }
    }
  }

  if (entityType === 'pois' && nestLocations) {
    const ref = entity.locationRef || {};
    if (ref.entityType === 'regions' || entity.regionId) {
      const regionId = entity.regionId || ref.entityId;
      const region = safeArr(state.entities.regions).find(r => r.id === regionId);
      if (region) return normalizePath(`${campBase}/World Atlas/Regions/${safeFileName(region.name, 'Region')}/Points of Interest/${name}.md`);
    }
    if (ref.entityType === 'settlements' || entity.settlementId) {
      const settlementId = entity.settlementId || ref.entityId;
      const settlement = safeArr(state.entities.settlements).find(s => s.id === settlementId);
      if (settlement) {
        const sName = safeFileName(settlement.name, 'Settlement');
        return normalizePath(`${campBase}/World Atlas/Settlements/${sName}/Points of Interest/${name}.md`);
      }
    }
  }

  if (entityType === 'rooms' && nestLocations) {
    if (entity.dungeonId) {
      const dungeon = safeArr(state.entities.dungeons).find(d => d.id === entity.dungeonId);
      if (dungeon) return normalizePath(`${campBase}/World Atlas/Dungeons/${safeFileName(dungeon.name, 'Dungeon')}/Rooms/${name}.md`);
    }
    if (entity.locationId) {
      const location = safeArr(state.entities.locations).find(l => l.id === entity.locationId);
      if (location) return normalizePath(`${campBase}/World Atlas/Locations/${safeFileName(location.name, 'Location')}/Rooms/${name}.md`);
    }
  }

  if (entityType === 'quests' && nestQuests && entity.adventureId) {
    const adv = safeArr(state.entities.adventures).find(a => a.id === entity.adventureId);
    if (adv) return normalizePath(`${campBase}/Adventure Planner/Adventures/${safeFileName(adv.name, 'Adventure')}/Quests/${name}.md`);
  }

  if (entityType === 'encounters' && nestQuests) {
    if (entity.adventureId) {
      const adv = safeArr(state.entities.adventures).find(a => a.id === entity.adventureId);
      if (adv) return normalizePath(`${campBase}/Adventure Planner/Adventures/${safeFileName(adv.name, 'Adventure')}/Encounters/${name}.md`);
    }
  }

  return normalizePath(`${campBase}/${workspaceFolder}/${name}.md`);
}

async function ensureFolder(app, folderPath) {
  if (!folderPath || !folderPath.trim()) return;
  const norm = normalizePath(folderPath);
  // Create each path segment recursively
  const parts = norm.split('/').filter(p => p.length > 0);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      if (!(await app.vault.adapter.exists(current))) await app.vault.createFolder(current);
    } catch {}
  }
}
async function writeNote(app, path, content) {
  const norm = normalizePath(path);
  try {
    const existing = app.vault.getAbstractFileByPath(norm);
    if (existing) await app.vault.modify(existing, content);
    else await app.vault.create(norm, content);
  } catch (e) { new Notice('Could not write note: ' + e.message); }
}
const ENTITY_MD_TEMPLATES = {
  npcs: item => {
    let b = `# ${item.name || 'NPC'}\n\n`;
    b += `> **Role:** ${item.role || '—'}  |  **Status:** ${item.status || 'Unknown'}  |  **Visibility:** ${item.visibility || 'dm-only'}\n\n`;
    if (item.race || item.ancestry) b += `**Ancestry/Race:** ${item.race || item.ancestry}\n`;
    if (item.occupation) b += `**Occupation:** ${item.occupation}\n`;
    if (item.location || item.locationId) b += `**Location:** ${item.location || item.locationId}\n`;
    b += '\n';
    b += `## Appearance\n\n${item.appearance || '_No appearance noted._'}\n\n`;
    b += `## Personality\n\n${item.personality || '_No personality noted._'}\n\n`;
    b += `## Motivation\n\n${item.motivation || '_No motivation noted._'}\n\n`;
    if (item.backstory) b += `## Backstory\n\n${item.backstory}\n\n`;
    if (item.relationships || item.factionIds?.length) {
      b += `## Relationships\n\n${item.relationships || ''}`;
      if (item.factionIds?.length) b += `\n**Faction IDs:** ${item.factionIds.join(', ')}`;
      b += '\n\n';
    }
    if (item.questHook) b += `## Quest Hook\n\n${item.questHook}\n\n`;
    b += `## DM Notes\n\n${item.dmNotes || item.notes || '_No notes._'}\n`;
    return b;
  },
  creatures: item => {
    let b = `# ${item.name || 'Creature'}\n\n`;
    b += `> **CR:** ${item.cr || '—'}  |  **Type:** ${item.creatureType || '—'}  |  **Size:** ${item.size || 'Medium'}  |  **Alignment:** ${item.alignment || '—'}\n\n`;
    b += `## Stats\n\n| AC | HP | Speed |\n|---|---|---|\n| ${item.ac || '—'} | ${item.hp || '—'} | ${item.speed || '—'} |\n\n`;
    b += `| STR | DEX | CON | INT | WIS | CHA |\n|---|---|---|---|---|---|\n`;
    b += `| ${item.str||10} | ${item.dex||10} | ${item.con||10} | ${item.int||10} | ${item.wis||10} | ${item.cha||10} |\n\n`;
    if (item.senses) b += `**Senses:** ${item.senses}\n`;
    if (item.languages) b += `**Languages:** ${item.languages}\n`;
    b += '\n';
    if (item.traits) b += `## Traits\n\n${item.traits}\n\n`;
    if (item.actions) b += `## Actions\n\n${item.actions}\n\n`;
    if (item.reactions) b += `## Reactions\n\n${item.reactions}\n\n`;
    if (item.legendaryActions) b += `## Legendary Actions\n\n${item.legendaryActions}\n\n`;
    if (item.lore) b += `## Lore\n\n${item.lore}\n\n`;
    if (item.habitat) b += `**Habitat:** ${item.habitat}\n\n`;
    return b;
  },
  factions: item => {
    let b = `# ${item.name || 'Faction'}\n\n`;
    b += `> **Type:** ${item.type || '—'}  |  **Visibility:** ${item.visibility || 'dm-only'}\n\n`;
    if (item.ideology) b += `## Ideology\n\n${item.ideology}\n\n`;
    b += `## Goals\n\n${safeArr(item.goals).map(g=>`- ${g}`).join('\n') || '_No goals._'}\n\n`;
    b += `## Methods\n\n${safeArr(item.methods).map(m=>`- ${m}`).join('\n') || '_No methods._'}\n\n`;
    if (item.resources) b += `## Resources\n\n${item.resources}\n\n`;
    if (item.leadership || item.leaderNpcId) b += `## Leadership\n\n${item.leadership || ''}${item.leaderNpcId ? `\n**Leader ID:** ${item.leaderNpcId}` : ''}\n\n`;
    if (item.staffRoles?.length) b += `## Staff & Roles\n\n${safeArr(item.staffRoles).map(r=>`- ${r}`).join('\n')}\n\n`;
    if (item.publicFace) b += `## Public Face\n\n${item.publicFace}\n\n`;
    if (item.secretAgenda) b += `## Secret Agenda\n\n_DM Only:_ ${item.secretAgenda}\n\n`;
    if (item.territory) b += `**Territory:** ${item.territory}\n\n`;
    b += `## DM Notes\n\n${item.dmNotes || item.notes || '_No notes._'}\n`;
    return b;
  },
  quests: item => {
    let b = `# ${item.name || 'Quest'}\n\n`;
    b += `> **Type:** ${item.questType || '—'}  |  **Status:** ${item.status || 'Available'}  |  **Visibility:** ${item.visibility || 'dm-only'}\n\n`;
    if (item.playerSummary || item.summary) b += `## Summary\n\n${item.playerSummary || item.summary}\n\n`;
    if (item.giver || item.giverNpcId) b += `**Quest Giver:** ${item.giver || ''}${item.giverNpcId ? ` (ID: ${item.giverNpcId})` : ''}\n\n`;
    if (item.location || item.locationId) b += `**Location:** ${item.location || ''}${item.locationId ? ` (ID: ${item.locationId})` : ''}\n\n`;
    if (item.objectives) b += `## Objectives\n\n${item.objectives}\n\n`;
    if (item.stages) b += `## Stages\n\n${item.stages}\n\n`;
    if (item.hooks?.length) b += `## Hooks\n\n${safeArr(item.hooks).map(h=>`- ${h}`).join('\n')}\n\n`;
    if (item.complications?.length) b += `## Complications\n\n${safeArr(item.complications).map(c=>`- ${c}`).join('\n')}\n\n`;
    if (item.rewards) b += `## Rewards\n\n${item.rewards}\n\n`;
    if (item.consequences) b += `## Consequences\n\n${item.consequences}\n\n`;
    b += `## DM Notes\n\n${item.dmNotes || item.secrets || '_No notes._'}\n`;
    return b;
  },
  encounters: item => {
    let b = `# ${item.name || 'Encounter'}\n\n`;
    b += `> **Type:** ${item.type || 'Combat'}  |  **Difficulty:** ${item.difficulty || 'Medium'}  |  **Visibility:** ${item.visibility || 'dm-only'}\n\n`;
    if (item.location || item.locationId) b += `**Location:** ${item.location || ''}${item.locationId ? ` (ID: ${item.locationId})` : ''}\n\n`;
    if (item.objectives) b += `## Objectives\n\n${item.objectives}\n\n`;
    if (item.terrain) b += `**Terrain:** ${item.terrain}\n\n`;
    if (item.tactics) b += `## Tactics\n\n${item.tactics}\n\n`;
    if (item.enemyGroups) b += `## Enemy Groups\n\n${item.enemyGroups}\n\n`;
    if (item.victoryConditions) b += `**Victory:** ${item.victoryConditions}\n\n`;
    if (item.failureConditions) b += `**Failure:** ${item.failureConditions}\n\n`;
    if (item.rewards) b += `## Rewards / Loot\n\n${item.rewards}\n\n`;
    b += `## DM Notes\n\n${item.notes || item.dmNotes || '_No notes._'}\n`;
    return b;
  },
  sessions: item => {
    let b = `# ${item.name || 'Session'}\n\n`;
    b += `> **Session #:** ${item.sessionNumber || '—'}  |  **Date:** ${item.realDate || '—'}  |  **Status:** ${item.status || 'Planned'}\n\n`;
    if (item.gameDate) b += `**In-World Date:** ${item.gameDate}\n\n`;
    if (item.partyMembers?.length) b += `**Party:** ${safeArr(item.partyMembers).join(', ')}\n\n`;
    if (item.recap) b += `## Recap\n\n${item.recap}\n\n`;
    if (item.scenes) b += `## Scenes\n\n${item.scenes}\n\n`;
    if (item.npcsMet?.length) b += `## NPCs Encountered\n\n${safeArr(item.npcsMet).map(n=>`- ${n}`).join('\n')}\n\n`;
    if (item.questsAdvanced?.length) b += `## Quests Advanced\n\n${safeArr(item.questsAdvanced).map(q=>`- ${q}`).join('\n')}\n\n`;
    if (item.secretsRevealed?.length) b += `## Secrets Revealed\n\n${safeArr(item.secretsRevealed).map(s=>`- ${s}`).join('\n')}\n\n`;
    if (item.lootAwarded) b += `## Loot Awarded\n\n${item.lootAwarded}\n\n`;
    if (item.xpMilestones) b += `**XP / Milestones:** ${item.xpMilestones}\n\n`;
    if (item.cliffhanger) b += `## Cliffhanger\n\n${item.cliffhanger}\n\n`;
    if (item.nextSessionNotes) b += `## Next Session Notes\n\n${item.nextSessionNotes}\n\n`;
    if (item.notes) b += `## Session Notes\n\n${item.notes}\n\n`;
    b += `## DM Prep Notes\n\n${item.prepNotes || '_No prep notes._'}\n`;
    return b;
  },
  secrets: item => {
    let b = `# ${item.name || 'Secret'}\n\n`;
    b += `> **Type:** ${item.secretType || '—'}  |  **Status:** ${item.revealStatus || 'Hidden'}  |  **Visibility:** ${item.visibility || 'secret'}\n\n`;
    if (item.revealTrigger) b += `**Reveal Trigger:** ${item.revealTrigger}\n\n`;
    b += `## Content\n\n${item.content || '_No content._'}\n\n`;
    b += `## DM Notes\n\n${item.dmNotes || '_No notes._'}\n`;
    return b;
  },
  bbegs: item => {
    let b = `# ${item.name || 'Villain'}\n\n`;
    b += `> **Title:** ${item.title || '—'}  |  **Status:** ${item.status || 'Active'}\n\n`;
    b += `## Goals\n\n${safeArr(item.goals).map(g=>`- ${g}`).join('\n') || '_No goals._'}\n\n`;
    b += `## Methods\n\n${safeArr(item.methods).map(m=>`- ${m}`).join('\n') || '_No methods._'}\n\n`;
    if (item.resources) b += `## Resources\n\n${item.resources}\n\n`;
    if (item.mythicPhases) b += `## Mythic Phases\n\n${item.mythicPhases}\n\n`;
    if (item.escalationClocks) b += `## Escalation Clocks\n\n${item.escalationClocks}\n\n`;
    if (item.finalConfrontation) b += `## Final Confrontation\n\n${item.finalConfrontation}\n\n`;
    b += `## Secrets\n\n${item.secrets || '_No secrets._'}\n`;
    return b;
  },
  hybridAncestries: item => {
    let b = `# ${item.name || 'Hybrid Ancestry'}\n\n`;
    b += `> **Parents:** ${[item.dominantAncestry, item.recessiveAncestry].filter(Boolean).join(' × ')}  |  **Status:** ${item.approvalStatus || item.status || 'Pending'}\n\n`;
    b += `**Size:** ${item.size || 'Medium'}  |  **Speed:** ${item.speed || 30} ft  |  **Type:** ${item.creatureType || 'Humanoid'}  |  **Darkvision:** ${item.darkvision ? item.darkvision + ' ft' : 'None'}\n\n`;
    if (item.languages?.length) b += `**Languages:** ${safeArr(item.languages).join(', ')}\n\n`;
    if (item.ageNotes) b += `**Age:** ${item.ageNotes}\n\n`;
    if (item.summary) b += `## Summary\n\n${item.summary}\n\n`;
    if (item.playerNotes) b += `## Player Notes\n\n${item.playerNotes}\n\n`;
    b += `## DM Notes\n\n${item.dmNotes || '_No DM notes._'}\n`;
    return b;
  },
  nobleFamilies: item => {
    let b = `# House ${item.name || 'Unknown'}\n\n`;
    b += `> **Motto:** _${item.motto || 'None'}_  |  **Status:** ${item.status || 'Active'}\n\n`;
    if (item.holdings) b += `## Holdings & Titles\n\n${item.holdings}\n\n`;
    if (item.claims) b += `## Claims & Disputes\n\n${item.claims}\n\n`;
    if (item.debts) b += `## Debts & Obligations\n\n${item.debts}\n\n`;
    if (item.members?.length) b += `## Members\n\n${safeArr(item.members).map(m=>`- ${m}`).join('\n')}\n\n`;
    if (item.alliances?.length) b += `## Alliances\n\n${safeArr(item.alliances).map(a=>`- ${a}`).join('\n')}\n\n`;
    if (item.rivals?.length) b += `## Rivals\n\n${safeArr(item.rivals).map(r=>`- ${r}`).join('\n')}\n\n`;
    b += `## Secrets & Scandals\n\n${item.secrets || '_No secrets._'}\n\n`;
    b += `## DM Notes\n\n${item.dmNotes || '_No notes._'}\n`;
    return b;
  },
  handouts: item => {
    let b = `# ${item.name || 'Handout'}\n\n`;
    b += `> **Type:** ${item.type || '—'}  |  **Visibility:** ${item.visibility || 'dm-only'}\n\n`;
    b += `${item.content || item.description || '_No content._'}\n`;
    return b;
  },
  homebrew: item => {
    const h = normalizeHomebrewRecord(item);
    let b = `# ${h.name || 'Homebrew Entry'}\n\n`;
    b += `> **Category:** ${h.category || '—'}  |  **Type:** ${h.type || '—'}  |  **Status:** ${h.status || 'Draft'}  |  **Visibility:** ${h.visibility || 'dm-only'}\n\n`;
    if (h.sourceEntityType || h.sourceCampaignId) {
      b += `## Source Links\n\n`;
      if (h.sourceEntityType) b += `- Source Entity Type: ${h.sourceEntityType}\n`;
      if (h.sourceEntityId) b += `- Source Entity ID: ${h.sourceEntityId}\n`;
      if (h.sourceCampaignId) b += `- Source Campaign ID: ${h.sourceCampaignId}\n`;
      b += '\n';
    }
    if (h.description) b += `## Description\n\n${h.description}\n\n`;
    if (h.mechanics || h.mechanicsText) b += `## Mechanics\n\n${h.mechanics || h.mechanicsText}\n\n`;
    const rendered = renderHomebrewContent(h);
    if (rendered) b += `${rendered}\n\n`;
    if (h.balance) b += `**Balance Notes:** ${h.balance}\n\n`;
    b += `## DM Notes\n\n${h.dmNotes || h.notes || '_No notes._'}\n`;
    return b;
  },
};
function entityMd(key, item, plugin) {
  const state = plugin ? plugin.state : null;
  const camp = state ? activeCampaign(state) : null;
  const workspace = ENTITY_NOTE_FOLDERS[key] ? ENTITY_NOTE_FOLDERS[key].split('/')[0] : '';
  const today = new Date().toISOString().slice(0, 10);
  const lines = ['---', 'ttrpg-engine: true'];
  lines.push(`entityType: ${key}`);
  if (item.id) lines.push(`entityId: ${item.id}`);
  if (item.campaignId || (camp && camp.id)) lines.push(`campaignId: ${item.campaignId || camp.id}`);
  if (camp) lines.push(`campaign: "${safeFileName(camp.name, '')}"`);
  if (workspace) lines.push(`workspace: ${workspace}`);
  const FM_KEYS = ['name','title','status','type','visibility'];
  FM_KEYS.forEach(k => {
    if (item[k] !== undefined && item[k] !== '') {
      const val = Array.isArray(item[k]) ? item[k].join(', ') : String(item[k] || '');
      lines.push(`${k}: "${val}"`);
    }
  });
  lines.push(`createdBy: TTRPG Engine`);
  lines.push(`createdAt: ${(item.createdAt || '').slice(0, 10) || today}`);
  lines.push(`updatedAt: ${(item.updatedAt || '').slice(0, 10) || today}`);
  lines.push('---', '');
  const tmpl = ENTITY_MD_TEMPLATES[key];
  if (tmpl) lines.push(tmpl(item));
  else lines.push(`# ${item.name || item.title || 'Untitled'}`, '', item.summary || item.description || '');
  return lines.join('\n');
}
async function writeEntityNote(plugin, key, item) {
  const path = resolveEntityNotePath(key, item, plugin.state, plugin);
  const dir = path.replace(/\/[^/]+\.md$/, '');
  await ensureFolder(plugin.app, dir);
  await writeNote(plugin.app, path, entityMd(key, item, plugin));
  item.lastSynced = new Date().toISOString();
  item.syncStatus = 'Synced';
  upsert(plugin.state, key, item);
  await plugin.saveState();
  new Notice(`Saved to ${path}`);
}
async function exportPlayerSafePacket(plugin) {
  const state = plugin.state;
  const folder = campaignFolder(plugin);
  const dir = `${folder}/Secrets & Handouts/Player Packets`;
  await ensureFolder(plugin.app, folder);
  await ensureFolder(plugin.app, dir);
  const camp = activeCampaign(state);
  let md = `# Player Packet — ${camp ? camp.name : 'Campaign'}\n\n`;
  md += `*Exported ${new Date().toLocaleDateString()}*\n\n`;
  const visQ = safeArr(state.entities.quests).filter(q => q.visibility === 'player-visible');
  if (visQ.length) { md += '## Active Quests\n\n'; visQ.forEach(q => { md += `### ${q.name}\n${q.playerSummary || q.summary || ''}\n\n`; }); }
  const visH = safeArr(state.entities.handouts).filter(h => h.visibility === 'player-visible');
  if (visH.length) { md += '## Handouts\n\n'; visH.forEach(h => { md += `### ${h.name}\n${h.content || h.summary || ''}\n\n`; }); }
  const visHybrids = safeArr(state.entities.hybridAncestries).filter(h => h.visibility === 'player-visible');
  if (visHybrids.length) {
    md += '## Hybrid Ancestries\n\n';
    visHybrids.forEach(h => {
      const traitObjs = safeArr(h.traits).map(id => HYBRID_TRAIT_LIBRARY.find(t => t.id === id)).filter(Boolean);
      md += `### ${h.name}\n`;
      md += `**Parents:** ${[h.dominantAncestry, h.recessiveAncestry].filter(Boolean).join(' × ')}\n`;
      md += `**Size:** ${h.size || 'Medium'} | **Speed:** ${h.speed || 30} ft | **Type:** ${h.creatureType || 'Humanoid'} | **Darkvision:** ${h.darkvision || 'None'}\n`;
      if (traitObjs.length) { md += `**Traits:** ${traitObjs.map(t => t.name).join(', ')}\n`; }
      if (h.summary) md += `${h.summary}\n`;
      md += '\n';
    });
  }
  await writeNote(plugin.app, `${dir}/player-packet.md`, md);
  new Notice(`Player packet exported to ${dir}`);
}
async function exportBackup(plugin) {
  const folder = campaignFolder(plugin);
  const dir = `${folder}/Campaign Command Centre/Exports`;
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

// ── Backup / restore helpers ───────────────────────────────────────────────────
function isBackupWrapper(obj) {
  return obj !== null && typeof obj === 'object' && typeof obj.state === 'object' && obj.state !== null &&
    typeof obj.state.entities === 'object' && obj.state.entities !== null;
}
function isRawPluginState(obj) {
  return obj !== null && typeof obj === 'object' && typeof obj.entities === 'object' && obj.entities !== null && !obj.state;
}
function buildBackupWrapperFromRawState(state) {
  const counts = {};
  const ents = state.entities || {};
  for (const [k, arr] of Object.entries(ents)) counts[k] = Array.isArray(arr) ? arr.length : 0;
  return { version: state.version || PLUGIN_VERSION, timestamp: state.updatedAt || null, entityCounts: counts, state };
}
function parseTtrpgBackupJson(rawJson) {
  let obj;
  try { obj = JSON.parse(rawJson); } catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
  if (isBackupWrapper(obj)) {
    if (!obj.entityCounts) {
      const ents = obj.state.entities || {};
      obj.entityCounts = {};
      for (const [k, arr] of Object.entries(ents)) obj.entityCounts[k] = Array.isArray(arr) ? arr.length : 0;
    }
    return obj;
  }
  if (isRawPluginState(obj)) return buildBackupWrapperFromRawState(obj);
  throw new Error('File does not appear to be a TTRPG Engine backup or plugin state file (no entities found).');
}

function _previewBackupInto(el, bk) {
  clear(el);
  ce(el, 'p', '', `Version: ${bk.version || 'unknown'}`);
  ce(el, 'p', '', `Timestamp: ${bk.timestamp ? new Date(bk.timestamp).toLocaleString() : 'Unknown'}`);
  const counts = bk.entityCounts || {};
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  ce(el, 'p', '', `Total entities: ${total}`);
  const top = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => `${ENTITY_LABELS[k] || k}: ${v}`).join(', ');
  if (top) ce(el, 'p', 'te-muted-text', top);
  if (bk.state && bk.state.activeCampaignId) {
    const camp = (safeArr((bk.state.entities || {}).campaigns)).find(c => c.id === bk.state.activeCampaignId);
    if (camp) ce(el, 'p', '', `Active campaign: ${camp.name}`);
  }
}

class RestoreBackupModal extends Modal {
  constructor(app, plugin, preloadedBackup = null) {
    super(app);
    this.plugin = plugin;
    this._pendingBackup = preloadedBackup;
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: '📥 Restore from Backup' });
    ce(contentEl, 'p', 'te-page-subtitle', 'Restores full plugin state — all campaigns, entities, settings, and relationships. A safety backup is saved first.');

    const preview = ce(contentEl, 'div', 'te-card'); preview.style.cssText = 'display:none;padding:12px;margin-top:8px';
    const previewBody = ce(preview, 'div', '');

    const showPreview = (bk) => {
      _previewBackupInto(previewBody, bk);
      preview.style.display = '';
      this._pendingBackup = bk;
    };

    if (this._pendingBackup) {
      showPreview(this._pendingBackup);
    } else {
      const pathWrap = ce(contentEl, 'div', 'te-modal-section');
      let backupPath = '';
      new Setting(pathWrap).setName('Backup file path (in vault)').setDesc('e.g. Campaigns/Exports/backup-2025-01-01.json').addText(t => { t.setPlaceholder('path/to/backup.json'); t.onChange(v => backupPath = v.trim()); });
      btn(contentEl, 'Preview Backup', 'te-btn', async () => {
        if (!backupPath) { new Notice('Enter a file path first.'); return; }
        try {
          const raw = await adapterRead(this.plugin.app, backupPath);
          showPreview(parseTtrpgBackupJson(raw));
        } catch (e) { new Notice(`Could not read backup: ${e.message}`); }
      });
    }

    const actRow = ce(contentEl, 'div', 'te-modal-actions');
    btn(actRow, '⚠️ Restore (Replace All Data)', 'te-btn is-danger', async () => {
      if (!this._pendingBackup) { new Notice('Preview the backup first.'); return; }
      try {
        await exportBackup(this.plugin);
        Object.assign(this.plugin.state, this._pendingBackup.state);
        migrateState(this.plugin.state);
        await this.plugin.saveState();
        new Notice('Backup restored. Previous data was backed up first.');
        this.close();
        this.plugin.refreshViews();
      } catch (e) { new Notice(`Restore failed: ${e.message}`); }
    });
    btn(actRow, 'Cancel', 'te-btn', () => this.close());
  }
  onClose() { clear(this.contentEl); }
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
  'Faction Name': {
    adj: ['Iron','Shadow','Golden','Silver','Blood','Crimson','Storm','Ember','Frost','Twilight','Jade','Obsidian','Copper','Ashen'],
    noun: ['Hand','Circle','Order','Brotherhood','Covenant','Council','League','Shield','Veil','Blade','Crown','Claw','Compact','Accord'],
  },
  'Wild Magic Surge': {
    events: [
      'A burst of fireworks erupts from the caster\'s hands.',
      'The caster turns invisible until the start of their next turn.',
      'The caster grows a long beard of colourful feathers until they sneeze.',
      'All creatures within 30 ft are teleported to random unoccupied spaces.',
      'The caster\'s skin turns bright blue for 24 hours.',
      'A third eye opens on the caster\'s forehead; they gain truesight 60 ft until end of next turn.',
      'The caster is surrounded by faint carnival music only they can hear for 1 minute.',
      'For the next minute the caster can only communicate in rhyme.',
      'The caster summons a unicorn in an unoccupied space within 5 ft.',
      'A shower of 1 gp gems falls in a 30 ft radius around the caster.',
      'The caster is polymorphed into a potted plant until the start of their next turn.',
      'Illusory butterflies fill a 10 ft radius around the caster for 1 minute.',
      'The next spell the caster casts in the next minute is cast at a slot two levels higher.',
      'Gravity reverses in a 10 ft radius for 1 round, then snaps back.',
    ],
  },
  'Dungeon Room': {
    purpose: ['guard post','storage vault','forgotten shrine','torture chamber','crypt','arcane library','alchemist laboratory','throne room','collapsed passage','flooded antechamber','trapped foyer','trophy hall'],
    feature: ['with a pit trap in the centre','containing a sleeping monster','lit by phosphorescent moss','covered in ancient murals','strewn with old bones','hidden behind a secret door','filled with stale air','partially collapsed','watched by a magic eye','ankle-deep in foul water'],
  },
  'NPC Trait': {
    personality: ['nervous and twitchy','gruff but secretly kind','speaks in elaborate riddles','obsessed with past glory','deeply and loudly devout','deeply distrustful of magic','hungry for news from outside','grieving a recent loss','overly formal and stiff','cheerfully nihilistic'],
    quirk: ['constantly fiddles with a coin or trinket','refers to themselves in third person','hums tunelessly when thinking','avoids direct eye contact','gives an elaborate greeting ritual','always mentions their hometown','carries a worn letter they won\'t discuss','chews a sprig of mint leaf'],
  },
  'Plot Twist': {
    events: [
      'A trusted ally is revealed to be working for the enemy.',
      'The villain\'s true goal was not what the party assumed.',
      'An innocent person was falsely accused — the real culprit is someone the party trusts.',
      'The ancient relic is a trap, designed to summon something worse.',
      'The party\'s patron has been lying about their intentions from the start.',
      'The "rescue" target doesn\'t want to be saved.',
      'The map leads to a tomb that belongs to the party member\'s ancestor.',
      'The enemy and a party member share the same prophecy — only one can fulfil it.',
      'The cure is worse than the disease.',
      'The information broker has been selling intel about the party to multiple factions.',
      'The "dead" antagonist has been alive the whole time, watching.',
      'The chosen hero has been the villain all along, in a future the party must prevent.',
    ],
  },
  'Town Event': {
    events: [
      'A merchant caravan arrives with exotic goods — and a hidden stowaway.',
      'The local constable has gone missing; rumours blame the new alchemist.',
      'A festival is underway, but someone stole the sacred idol the night before.',
      'Refugees arrive from a burning village to the north, carrying warnings.',
      'A travelling circus sets up camp; one of the performers is asking strange questions.',
      'The well water has turned an unusual colour; livestock are falling ill.',
      'A duel is scheduled at noon between two prominent citizens.',
      'A wanted poster appears overnight — the face on it looks like one of the party.',
      'The temple has been desecrated; the high priest blames a rival cult.',
      'An anonymous letter is delivered to the party at their inn.',
      'A child claims to have spoken with a ghost in the cemetery.',
      'The town gate is barred from inside; no one will say why.',
    ],
  },
  'Trap': {
    type: ['Mechanical','Magic','Environmental','Alarm','Combination'],
    trigger: ['pressure plate','tripwire','motion sensor (arcane)','false drawer pull','opening a locked chest','crossing a threshold','speaking a phrase aloud'],
    effect: ['releases poisoned darts (DC 15 DEX)','drops a portcullis behind the party','floods the room with 1d6 feet of water','casts Sleep on all creatures in range','triggers a cave-in (6d6 bludgeoning)','summons 1d4 skeletons','brands the nearest creature with a tracking sigil','deals 4d10 fire damage (Reflex DC 14 half)'],
    tell: ['slight depression in the flagstone','faint scorch marks on the walls','a groove worn in the floor by the door','dried blood leading up to the spot','a faint hum when you approach','a suspiciously clean patch of dust'],
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
    case 'Faction Name': return `The ${rnd(t.adj)} ${rnd(t.noun)}`;
    case 'Wild Magic Surge': return rnd(t.events);
    case 'Dungeon Room': return `A ${rnd(t.purpose)} ${rnd(t.feature)}.`;
    case 'NPC Trait': return `${rnd(t.personality)}. ${rnd(t.quirk)}.`;
    case 'Plot Twist': return rnd(t.events);
    case 'Town Event': return rnd(t.events);
    case 'Trap': return `${rnd(t.type)} trap triggered by ${rnd(t.trigger)}: ${rnd(t.effect)}. Tell: ${rnd(t.tell)}.`;
    default: return '[Result]';
  }
}

function generateCompleteNPC(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const FIRST = ['Aldric','Brea','Caelum','Dara','Emory','Fynn','Gael','Hana','Idris','Jora','Kael','Lena','Maren','Noel','Oryn','Priya','Quinn','Reva','Soren','Tara','Uland','Vara','Wren','Xael','Yosef','Zara'];
  const LAST  = ['Ashmore','Blackwood','Cresthill','Dunmore','Embervale','Frostwood','Greymoor','Halloway','Ironvale','Jasperton','Keldram','Lochwood','Merrow','Nighthollow','Ostwick','Pendleton','Quarrystone','Redmoor','Stonehaven','Thornwall','Underhill','Vayne','Whitmore','Yewdale','Zorvath'];
  const ROLES = ['Merchant','Innkeeper','Guard','Priest','Scholar','Noble','Soldier','Artisan','Sailor','Hunter','Blacksmith','Healer','Criminal','Spy','Mercenary','Farmer','Beggar','Bard','Herbalist'];
  const ANCESTRIES = ['Human','Elf','Dwarf','Halfling','Half-Elf','Half-Orc','Tiefling','Gnome','Dragonborn','Aasimar'];
  const ATTITUDES  = ['Friendly','Neutral','Suspicious','Hostile','Desperate','Curious','Cautious','Jovial','Melancholy'];
  const PERSONALITIES = ['nervous and twitchy','gruff but secretly kind','speaks in elaborate metaphors','obsessed with past glory','deeply devout','deeply distrustful of strangers','hungry for news','grieving a recent loss','overly formal','cheerfully cynical'];
  const QUIRKS = ['fiddles with a coin','refers to themselves in third person','hums tunelessly','avoids eye contact','elaborate greeting ritual','always mentions hometown','carries a worn letter','chews a sprig of mint'];
  const MOTIVATIONS = ['seeking revenge','trying to repay a debt','protecting a secret','searching for a lost family member','building wealth','serving their deity','fleeing their past','proving themselves','protecting their community'];
  const SECRETS = ['witnessed a noble crime','is an informant for a faction','carries contraband','has a bounty in another city','is hiding a dangerous skill','knows a prophecy','owes a debt to a demon','is a retired adventurer'];
  const name = `${rnd(FIRST)} ${rnd(LAST)}`;
  return {
    name, ancestry: rnd(ANCESTRIES), role: rnd(ROLES),
    occupation: rnd(ROLES), attitude: rnd(ATTITUDES),
    personality: `${rnd(PERSONALITIES)}. ${rnd(QUIRKS)}.`,
    motivation: rnd(MOTIVATIONS), secret: rnd(SECRETS),
    questHook: generate('Quest Hook', state),
    status: 'Active', visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}

function generateCompleteSettlement(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const name = generate('Settlement Name', state);
  const TYPES = ['Village','Town','City','Hamlet','Keep','Port','Mining Camp','Trading Post','Monastery'];
  const GOVTS = ['Mayor','Council of Elders','Merchant Guild','Local Lord','Temple Authority','Elected Council','Warlord'];
  const PROBLEMS = ['A series of unexplained disappearances','Crops have been failing for months','A new gang of bandits controls trade routes','An ancient ruin nearby attracts dangerous attention','Political tension between two families','A plague spreading from the docks','Strange lights seen at night outside town'];
  const RESOURCES = ['Iron ore','Timber','Farmland','Fishing','Trade crossroads','Magical springs','Ancient ruins','Skilled craftspeople'];
  return {
    name, type: rnd(TYPES), government: rnd(GOVTS),
    population: rnd([50, 100, 200, 500, 1000, 2000, 5000, 10000]),
    economy: rnd(RESOURCES), problems: [rnd(PROBLEMS)],
    status: 'Active', visibility: 'dm-only', campaignId: state.activeCampaignId || '',
    questHook: generate('Quest Hook', state),
    notes: `Notable for its ${rnd(RESOURCES).toLowerCase()} trade.`,
  };
}

function generateCompleteFaction(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const name = generate('Faction Name', state);
  const TYPES = ['Criminal','Political','Religious','Military','Mercantile','Academic','Secret Society','Resistance','Cult','Guild'];
  const GOALS = ['Accumulate wealth and power','Overthrow the current government','Protect the old ways','Spread their faith','Destroy a rival organisation','Find an ancient artefact','Control the trade routes','Uncover forbidden knowledge'];
  const METHODS = ['Manipulation and blackmail','Open military force','Bribery and corruption','Assassination','Subterfuge and espionage','Propaganda','Alliance-building'];
  const PUBLIC_FACES = ['A charitable organisation','A merchant guild','A religious order','A scholarly society','A civic club','A trade union'];
  return {
    name, type: rnd(TYPES),
    goals: [rnd(GOALS), rnd(GOALS)].filter((v,i,a)=>a.indexOf(v)===i),
    methods: [rnd(METHODS)],
    publicFace: rnd(PUBLIC_FACES),
    secretAgenda: rnd(GOALS),
    status: 'Active', visibility: 'dm-only', campaignId: state.activeCampaignId || '',
    notes: generate('Rumour', state),
  };
}

function generateCompleteQuest(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['Main Quest','Side Quest','Faction Quest','Personal Quest','Investigation','Delivery','Rescue','Exploration','Heist','Bounty'];
  const STATUSES = ['Available','Active','Completed'];
  const COMPLICATIONS = ['A key NPC turns out to be the villain','The reward is less than promised','An innocent is caught in the middle','A rival group is after the same goal','The situation is more complex than it appeared'];
  const REWARDS = ['Gold and supplies','A deed to property','A rare magic item','Faction reputation','Information about a bigger threat','A loyal contact','Access to a secret location'];
  const hook = generate('Quest Hook', state);
  const name = hook.split('.')[0].slice(0, 60);
  return {
    name, questType: rnd(TYPES), status: rnd(STATUSES.slice(0,2)),
    summary: hook, objectives: `Investigate and resolve: ${hook}`,
    complications: [rnd(COMPLICATIONS)],
    rewards: rnd(REWARDS),
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}
function generateCompletePOI(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['Shrine','Ruin','Cave','Tower','Monument','Hidden Cache','Ambush Site','Crossing','Well','Grove','Barrow','Beacon'];
  const HAZARDS = ['patrolled by bandits','guarded by beasts','cursed','unstable ground','trapped entrance','contested by rival faction'];
  const HOOKS = ['locals avoid it at night','rumoured treasure inside','a missing person was last seen here','strange lights at night','an old map marks it'];
  const t = rnd(TYPES);
  const name = `The ${rnd(['Broken','Forgotten','Ancient','Hidden','Ruined','Lost','Crumbling','Sunken'])} ${t}`;
  return {
    name, poiType: t,
    summary: `${name} — ${rnd(HAZARDS)}. ${rnd(HOOKS)}.`,
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
    linkedRegionId: '', linkedSettlementId: '',
  };
}
function generateCompleteEncounter(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['Combat','Social','Exploration','Puzzle','Chase','Ambush','Negotiation'];
  const ENEMIES = ['bandits','cultists','undead','mercenaries','guards','beasts','monsters','rival adventurers'];
  const TWISTS = ['reinforcements arrive mid-fight','a hostage is present','the terrain shifts','an NPC switches sides','a third faction intervenes'];
  const t = rnd(TYPES);
  const foe = rnd(ENEMIES);
  return {
    name: `${t}: ${foe.charAt(0).toUpperCase() + foe.slice(1)}`,
    encounterType: t, status: 'Planned',
    summary: `The party faces ${foe}. Twist: ${rnd(TWISTS)}.`,
    enemies: [foe], difficulty: rnd(['Easy','Medium','Hard','Deadly']),
    reward: rnd(['XP','Loot','Information','Favour','None']),
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
    locationType: '', linkedSessionId: '', linkedMapId: '',
  };
}
function generateCompleteTavern(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const ADJ = ['Rusty','Golden','Silver','Broken','Wandering','Drunken','Lucky','Lost','Roaring','Quiet'];
  const NOUN = ['Flagon','Axe','Dragon','Coin','Boot','Lantern','Antler','Wheel','Sword','Fox'];
  const QUALITIES = ['Cheap and cheerful','Upscale and clean','Dingy but welcoming','Rough crowd, strong drinks','Quiet, locals only'];
  const SPECIALS = ['live music tonight','a wanted poster on the wall','a mysterious stranger in the corner','brawl in progress','local festival underway'];
  const name = `The ${rnd(ADJ)} ${rnd(NOUN)}`;
  return {
    name, locationType: 'Tavern',
    summary: `${name}. ${rnd(QUALITIES)}. Notable: ${rnd(SPECIALS)}.`,
    owner: generate('NPC Name', state),
    rumour: generate('Rumour', state),
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
    linkedSettlementId: '',
  };
}
function generateCompleteShop(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['Blacksmith','Alchemist','General Store','Magic Item Dealer','Armourer','Fletcher','Tailor','Jeweller','Herbalist','Fence'];
  const QUIRKS = ['owner is very old and half-deaf','the shop smells strange','suspicious prices','closed on odd days','specialises in rare imports','haunted by a former owner'];
  const t = rnd(TYPES);
  const owner = generate('NPC Name', state);
  return {
    name: `${owner}'s ${t}`,
    locationType: 'Shop',
    summary: `${t} run by ${owner}. ${rnd(QUIRKS)}.`,
    shopType: t, owner,
    inventory: [`Standard ${t.toLowerCase()} stock`, rnd(['One rare item available','A suspicious item for sale','A request for specific materials'])],
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
    linkedSettlementId: '',
  };
}
function generateCompleteRumour(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const SOURCES = ['an old drunk at the bar','a travelling merchant','a nervous local','a child who saw something','a dying soldier','a letter found in the road'];
  const TRUTHS = ['Completely true','Mostly true, exaggerated','Half-true','False — planted misinformation','The speaker believes it but is wrong'];
  const rumour = generate('Rumour', state);
  return {
    name: rumour.split('.')[0].slice(0, 60),
    summary: rumour,
    source: rnd(SOURCES), accuracy: rnd(TRUTHS),
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
    status: 'Unverified',
  };
}
function generateCompleteSecret(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['NPC Secret','Faction Secret','Location Secret','Historical Secret','PC Secret','World Secret'];
  const CONSEQUENCES = ['changes allegiances if revealed','worth a fortune to the right buyer','dangerous to the revealer','undermines a major institution','opens a new quest line'];
  const t = rnd(TYPES);
  const name = generate('NPC Name', state);
  return {
    name: `Secret of ${name}`,
    secretType: t, status: 'Undiscovered',
    summary: `A ${t.toLowerCase()} — ${rnd(CONSEQUENCES)}.`,
    holder: name, consequence: rnd(CONSEQUENCES),
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}
function generateCompleteDungeonRoom(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const PURPOSES = ['Guard Post','Treasure Vault','Prison Cell','Ritual Chamber','Laboratory','Barracks','Chapel','Throne Room','Kitchen','Library','Trap Room','Boss Lair'];
  const FEATURES = ['a crumbling fresco on the wall','a dry fountain in the centre','scattered bones','a locked iron chest','strange symbols on the floor','a collapsed ceiling with a hole above','a single torch still burning','a pool of dark water'];
  const EXITS = ['one door to the north','two doors east and west','a secret passage behind a bookshelf','a trapdoor in the floor','a ladder leading up'];
  const p = rnd(PURPOSES);
  return {
    name: p, roomType: p,
    summary: `${p}. Notable: ${rnd(FEATURES)}. Exits: ${rnd(EXITS)}.`,
    features: [rnd(FEATURES), rnd(FEATURES)],
    exits: rnd(EXITS),
    hazard: rnd(['None','Trap','Patrol','Environmental hazard','Puzzle lock']),
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}
function generateCompleteLoot(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['Coin','Weapon','Armour','Potion','Scroll','Gem','Art Object','Magic Item','Trade Goods','Mundane Gear'];
  const RARITIES = ['Common','Uncommon','Rare','Very Rare','Legendary'];
  const ITEM_POOLS = {
    Coin: ['10 gp','50 gp','1d100 sp','2d6 pp'],
    Weapon: ['longsword','dagger','shortbow','handaxe','spear'],
    Armour: ['leather armour','chain shirt','shield','studded leather'],
    Potion: ['Potion of Healing','Potion of Climbing','Potion of Water Breathing'],
    Scroll: ['Spell scroll (1st level)','Spell scroll (2nd level)','Treasure map scroll'],
    Gem: ['ruby','sapphire','emerald','topaz','diamond'],
    'Art Object': ['silver goblet','painted portrait','carved idol','ornate brooch'],
    'Magic Item': ['Cloak of Elvenkind','Bag of Holding','Ring of Protection','Wand of Magic Missiles'],
    'Trade Goods': ['bolts of silk','spices','rare wood','alchemical supplies'],
    'Mundane Gear': ['rope','torches','rations','crowbar','thieves tools'],
  };
  const t = rnd(TYPES);
  const pool = ITEM_POOLS[t] || ITEM_POOLS.Coin;
  return {
    name: `${rnd(RARITIES)} ${t} Loot`,
    lootType: t, rarity: rnd(RARITIES),
    items: [rnd(pool), rnd(pool)],
    totalValue: `${rnd([10,25,50,100,250,500,1000])} gp`,
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}
function generateCompleteTravelEvent(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const TYPES = ['Encounter','Discovery','Hazard','Rest','NPC Meeting','Weather','Foraging'];
  const result = generate('Travel Event', state);
  const t = rnd(TYPES);
  return {
    name: `Travel Event: ${t}`,
    eventType: t, summary: result,
    duration: rnd(['1 hour','Half day','Full day','Two days']),
    outcome: rnd(['Positive','Neutral','Negative','Mixed']),
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}
function generateCompleteNobleHouse(state) {
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  const NAMES = ['Ashford','Blackwood','Coldwater','Dunmore','Edgemont','Fairhollow','Goldenvale','Harwick','Ironmoor','Jademont','Kessler','Langford'];
  const STATUSES = ['Prosperous','Declining','Rising','Fractured','Exiled','Powerful','Secretive'];
  const MOTTOS = ['Strength Through Unity','We Rise Together','Never Forgive, Never Forget','Blood and Iron','Gold Above All','Honour Without Price','In Shadow We Thrive'];
  const SECRETS = ['a member is secretly a cultist','the house fortune is built on crime','the heir is not legitimate','they owe a debt to a demon','a member is a secret informant'];
  return {
    name: `House ${rnd(NAMES)}`,
    status: rnd(STATUSES), motto: rnd(MOTTOS),
    holdings: rnd(['A county and keep','A merchant fleet','Gold mines','Farmlands and a market town','A secret criminal network']),
    secrets: [rnd(SECRETS)],
    allies: [], enemies: [],
    memberNpcIds: [], heirNpcIds: [], rivalFamilyIds: [],
    visibility: 'dm-only', campaignId: state.activeCampaignId || '',
  };
}
function compileEndSessionReview(session, state) {
  if (!session) return { sections: [], recap: '', markdown: '' };
  const log = Array.isArray(session.eventLog) ? session.eventLog : [];
  const campId = session.campaignId || '';
  const byType = (...types) => log.filter(e => types.includes(e.type)).map(e => e.text);

  const npcs = byType('NPC Met', 'NPC Activated');
  const npcsDeactivated = byType('NPC Deactivated', 'NPC Died');
  const locations = byType('Location Visited', 'Location Changed');
  const mapChanges = byType('Map Changed');
  const secrets = byType('Secret Revealed');
  const quests = byType('Quest Advanced', 'Quest Activated', 'Quest Completed', 'Quest Failed');
  const lootGen = byType('Loot Generated');
  const lootAwarded = byType('Loot Awarded');
  const timersLog = byType('Timer Advanced', 'Timer Removed');
  const notes = byType('Note');
  const hooks = byType('Next Hook');
  const decisions = byType('Player Decision');
  const consequences = byType('Consequence');
  const combatEvents = byType('Combat Started', 'Combat Ended', 'Initiative Advanced', 'Combatant Added', 'Combatant Removed', 'Combatant Defeated', 'Condition Applied', 'Condition Removed');
  const genResults = [...byType('Generator Used'), ...byType('Generator Result')];
  const diceRolls = byType('Dice Rolled');
  const handouts = byType('Handout Shared', 'Handout Shown');
  const factions = byType('Faction Activated', 'Faction Deactivated');

  const activeTimers = safeArr(state.entities.timers).filter(t => !campId || t.campaignId === campId);
  const activeQuests = safeArr(state.entities.quests).filter(q => q.status === 'Active' && (!campId || q.campaignId === campId));

  const sections = [
    { label: 'NPCs Encountered', items: npcs },
    { label: 'Locations Visited', items: locations },
    { label: 'Secrets Revealed', items: secrets },
    { label: 'Quests Advanced', items: quests },
    { label: 'Loot Generated', items: lootGen },
    { label: 'Loot Awarded', items: lootAwarded },
    { label: 'Timer Advances', items: timersLog },
    { label: 'DM Notes', items: notes },
    { label: 'Player Decisions', items: decisions },
    { label: 'Consequences', items: consequences },
    { label: 'Combat Events', items: combatEvents },
    { label: 'Generator Results', items: genResults },
    { label: 'Dice Rolls', items: diceRolls },
    { label: 'Handouts Shared', items: handouts },
    { label: 'Factions', items: factions },
    { label: 'Next Session Hooks', items: hooks },
    { label: 'Active Timers (End State)', items: activeTimers.map(t => `${t.name}: ${t.currentTick || 0}/${t.maxTicks || 6}`) },
    { label: 'Open Quests', items: activeQuests.map(q => q.name) },
  ].filter(s => s.items.length > 0);

  // Minimal YAML frontmatter
  const camp = activeCampaign(state);
  const sessionNum = session.sessionNumber || (safeArr(state.entities.sessions).findIndex(s => s.id === session.id) + 1) || '';
  const lines = [];
  lines.push('---');
  lines.push('ttrpg-engine: true');
  lines.push('entityType: session-review');
  lines.push(`sessionId: ${session.id || ''}`);
  lines.push(`campaignId: ${campId}`);
  lines.push(`createdAt: ${new Date().toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Session Review — ${session.name || 'Session'}`);
  lines.push('');
  if (camp) lines.push(`> **Campaign:** ${camp.name}`);
  if (sessionNum) lines.push(`> **Session #:** ${sessionNum}`);
  if (session.date || session.realDate) lines.push(`> **Date:** ${session.date || session.realDate}`);
  if (session.gameDate) lines.push(`> **In-World Date:** ${session.gameDate}`);
  lines.push('');

  // Executive Recap
  const recapParts = [];
  if (npcs.length) recapParts.push(`The party encountered ${npcs.join(', ')}.`);
  if (locations.length) recapParts.push(`They visited ${locations.join(', ')}.`);
  if (quests.length) recapParts.push(`Quests: ${quests.join('; ')}.`);
  if (secrets.length) recapParts.push(`Secrets revealed: ${secrets.join('; ')}.`);
  if (lootGen.length || lootAwarded.length) recapParts.push(`Loot: ${[...lootGen,...lootAwarded].join(', ')}.`);
  if (hooks.length) recapParts.push(`Next hooks: ${hooks.join('; ')}.`);
  const recap = recapParts.join(' ');
  if (recap) { lines.push('## Executive Recap'); lines.push(''); lines.push(recap); lines.push(''); }

  const addSection = (heading, items, icon = '') => {
    if (!items || !items.length) return;
    lines.push(`## ${icon ? icon + ' ' : ''}${heading}`);
    lines.push('');
    items.forEach(item => lines.push(`- ${item}`));
    lines.push('');
  };

  addSection('Locations & Maps', [...locations, ...mapChanges], '📍');
  addSection('NPCs', [...npcs, ...npcsDeactivated], '👤');
  addSection('Factions', factions, '⚔️');
  addSection('Quests', quests, '📋');
  addSection('Encounters & Combat', combatEvents, '⚔️');
  addSection('Secrets & Handouts', [...secrets, ...handouts], '🔒');
  addSection('Loot & Rewards', [...lootGen, ...lootAwarded], '💰');
  addSection('Generators Used', genResults, '⚡');
  addSection('Dice Rolls', diceRolls, '🎲');
  addSection('Player Decisions', decisions);
  addSection('Consequences', consequences);
  addSection('DM Notes', notes, '📝');
  addSection('Timer Events', timersLog, '⏱️');

  if (activeTimers.length) {
    lines.push('## Timers (End State)'); lines.push('');
    activeTimers.forEach(t => lines.push(`- ${t.name}: ${t.currentTick || 0}/${t.maxTicks || 6} ticks`));
    lines.push('');
  }
  if (activeQuests.length) {
    lines.push('## Open Quests'); lines.push('');
    activeQuests.forEach(q => lines.push(`- ${q.name}`));
    lines.push('');
  }
  addSection('Next Session Hooks', hooks, '🎣');

  if (session.notes && session.notes.trim()) {
    lines.push('## Scratchpad Notes'); lines.push('');
    lines.push(session.notes.trim()); lines.push('');
  }

  // Chronological Event Log
  if (log.length) {
    lines.push('## Chronological Event Log'); lines.push('');
    [...log].forEach(evt => {
      const time = evt.time ? new Date(evt.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      const roundStr = evt.round ? ` (Round ${evt.round})` : '';
      const sessStr = sessionNum ? ` [Session #${sessionNum}]` : '';
      lines.push(`- **[${evt.type}]**${roundStr}${sessStr}${time ? ` \`${time}\`` : ''} ${evt.text}`);
    });
    lines.push('');
  }

  lines.push('## Player Recap'); lines.push('');
  if (recap) { lines.push(recap); } else { lines.push('*(No session events logged.)*'); }
  lines.push('');

  return { sections, recap, sessionName: session.name || 'Session', date: session.date || session.realDate || '', markdown: lines.join('\n') };
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
  const bankOpts = (opts.bank && OPTION_BANKS[opts.bank]) ? OPTION_BANKS[opts.bank] : (opts.suggestions || []);
  if (bankOpts.length) {
    const sel = ce(addRow, 'select'); sel.style.cssText = 'max-width:160px;font-size:.82rem';
    ce(sel, 'option', '', '— pick —').value = '';
    bankOpts.forEach(s => ce(sel, 'option', '', s).value = s);
    sel.addEventListener('change', () => { if (sel.value) { inp.value = sel.value; sel.value = ''; inp.focus(); } });
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
function pageHead(main, plugin, title, subtitle, actions, tabs) {
  const h = ce(main, 'div', 'te-page-head');
  ce(h, 'h1', '', title);
  if (subtitle) ce(h, 'p', 'te-page-subtitle', subtitle);
  // Active campaign chip
  const camp = activeCampaign(plugin.state);
  const chip = ce(h, 'span', 'te-campaign-chip' + (camp ? ' is-set' : ''));
  chip.textContent = camp ? ('📜 ' + camp.name) : '📜 No active campaign';
  // Workspace tabs — rendered below campaign chip, above action buttons
  if (tabs && tabs.length) {
    const state = plugin.state;
    const tabBar = ce(h, 'div', 'te-workspace-tabs');
    tabs.forEach(({ id, label }) => {
      const active = (state.activeSubSection || tabs[0].id) === id;
      btn(tabBar, label, 'te-workspace-tab' + (active ? ' is-active' : ''), async () => {
        state.activeSubSection = id;
        await plugin.saveState();
      });
    });
  }
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
  domains:'ðŸ°',
  campaigns:'📜', worlds:'🌍', cosmologies:'🌌', realms:'✨', regions:'🗺️',
  settlements:'🏘️', locations:'📍', pois:'⭐', routes:'🛤️',
  npcs:'👤', creatures:'🐉', bbegs:'👹', factions:'⚔️',
  cultures:'🎭', languages:'📖', deities:'☀️', pantheons:'🏛️',
  quests:'📋', adventures:'📝', encounters:'⚔️', sessions:'📅',
  milestones:'🏆', secrets:'🔒', handouts:'📣', rules:'⚙️',
  conditions:'💫', damageTypes:'💥', downtime:'⏳', projects:'🔨',
  bastions:'🏰', compendium:'📚', homebrew:'🧪', tables:'🎲',
  characters:'🧙', calendars:'📆', journals:'📓',
  maps:'🗺️', dungeons:'🕳️', timers:'⏱️', enemyTemplates:'⚔️',
  reputations:'⭐', warFronts:'🚩', incursions:'🌊', endgameStates:'🌋',
  nations:'👑', religions:'🕍', districts:'🏙️', rooms:'🚪', timelines:'📅', reveals:'💡', loot:'💰',
  hybridAncestries:'🧬',
  nobleFamilies:'🏰',
  acts:'🎭',
};
const ENTITY_LABELS = {
  domains:'Domain',
  campaigns:'Campaign', worlds:'World', cosmologies:'Cosmology', realms:'Realm',
  regions:'Region', settlements:'Settlement', locations:'Location', pois:'Point of Interest',
  routes:'Route', npcs:'NPC', creatures:'Creature', bbegs:'BBEG',
  factions:'Faction', cultures:'Culture', languages:'Language', deities:'Deity',
  pantheons:'Pantheon', quests:'Quest', adventures:'Adventure', encounters:'Encounter',
  sessions:'Session', milestones:'Milestone', secrets:'Secret', handouts:'Handout',
  rules:'Rule', conditions:'Condition', damageTypes:'Damage Type', downtime:'Downtime Activity',
  projects:'Project', bastions:'Bastion', compendium:'Compendium Entry', homebrew:'Homebrew Entry',
  tables:'Table', characters:'Character', calendars:'Calendar', journals:'Journal',
  maps:'Map', dungeons:'Dungeon', timers:'Escalation Timer', enemyTemplates:'Enemy Template',
  reputations:'Reputation', warFronts:'War Front', incursions:'Realm Incursion', endgameStates:'Ending State',
  nations:'Nation', religions:'Religion', districts:'District', rooms:'Room', timelines:'Timeline Event', reveals:'Reveal', loot:'Loot Entry',
  hybridAncestries:'Hybrid Ancestry',
  nobleFamilies:'Noble Family',
  acts:'Act',
};

const ENTITY_FOLDER_LABELS = {
  domains:'Domains',
  campaigns:'Campaigns', worlds:'Worlds', cosmologies:'Cosmologies', realms:'Realms',
  regions:'Regions', settlements:'Settlements', locations:'Locations', pois:'Points of Interest',
  routes:'Routes', npcs:'NPCs', creatures:'Creatures', bbegs:'BBEGs',
  factions:'Factions', cultures:'Cultures', languages:'Languages', deities:'Deities',
  pantheons:'Pantheons', quests:'Quests', adventures:'Adventures', encounters:'Encounters',
  sessions:'Sessions', milestones:'Milestones', secrets:'Secrets', handouts:'Handouts',
  rules:'Rules', conditions:'Conditions', damageTypes:'Damage Types', downtime:'Downtime Activities',
  projects:'Projects', bastions:'Bastions', compendium:'Compendium', homebrew:'Homebrew',
  tables:'Tables', characters:'Characters', calendars:'Calendars', journals:'Journals',
  maps:'Maps', dungeons:'Dungeons', timers:'Escalation Timers', enemyTemplates:'Enemy Templates',
  reputations:'Reputations', warFronts:'War Fronts', incursions:'Realm Incursions', endgameStates:'Ending States',
  nations:'Nations', religions:'Religions', districts:'Districts', rooms:'Rooms', timelines:'Timeline Events', reveals:'Reveals', loot:'Loot',
  hybridAncestries:'Hybrid Ancestries',
  nobleFamilies:'Noble Families',
};

function itemCards(parent, plugin, key, opts) {
  opts = opts || {};
  const items = opts.items ? opts.items : safeArr(plugin.state.entities[key]).filter(x => matchesSearch(x, plugin.state.search));
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
      const displayVal = Array.isArray(val)
        ? val.map(v => resolveEntityDisplay(String(v), plugin.state) || String(v)).join(', ')
        : (resolveEntityDisplay(String(val), plugin.state) || String(val));
      ce(row, 'span', '', displayVal.slice(0, 80));
    });
    // Actions
    const acts = ce(c, 'div', 'te-card-actions');
    btn(acts, 'Edit', 'te-btn is-sm', () => (opts.onEdit || defaultEdit)(plugin, key, item));
    if (opts.onExtra) opts.onExtra(acts, item);
    btn(acts, 'Write Note', 'te-btn is-sm', () => writeEntityNote(plugin, key, item));
    btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => {
      removeItem(plugin.state, key, item.id);
      await plugin.saveState();
      new Notice(`${ENTITY_LABELS[key] || key} deleted.`);
    });
  });
}

const RICH_EDIT_MAP = {
  npcs:             (p, i) => new NPCModal(p.app, p, i).open(),
  creatures:        (p, i) => new CreatureModal(p.app, p, i).open(),
  deities:          (p, i) => new DeityModal(p.app, p, i).open(),
  bbegs:            (p, i) => new BBEGModal(p.app, p, i).open(),
  factions:         (p, i) => new FactionModal(p.app, p, i).open(),
  quests:           (p, i) => new QuestModal(p.app, p, i).open(),
  encounters:       (p, i) => new EncounterModal(p.app, p, i).open(),
  sessions:         (p, i) => new SessionModal(p.app, p, i).open(),
  secrets:          (p, i) => new SecretModal(p.app, p, i).open(),
  calendars:        (p, i) => new CalendarModal(p.app, p, i).open(),
  homebrew:         (p, i) => openHomebrewEditor(p.app, p, i),
  characters:       (p, i) => new CharacterModal(p.app, p, i).open(),
  hybridAncestries: (p, i) => new HybridAncestryModal(p.app, p, i).open(),
  nobleFamilies:    (p, i) => new NobleFamilyModal(p.app, p, i).open(),
  downtime:         (p, i) => new DowntimeModal(p.app, p, i).open(),
  projects:         (p, i) => new ProjectModal(p.app, p, i).open(),
  bastions:         (p, i) => new BastionModal(p.app, p, i).open(),
  timers:           (p, i) => new TimerModal(p.app, p, i).open(),
  enemyTemplates:   (p, i) => new EnemyTemplateModal(p.app, p, i).open(),
  warFronts:        (p, i) => new WarFrontModal(p.app, p, i).open(),
  incursions:       (p, i) => new IncursionModal(p.app, p, i).open(),
};
function defaultEdit(plugin, key, item) {
  if (RICH_EDIT_MAP[key]) { RICH_EDIT_MAP[key](plugin, item); return; }
  const fields = ENTITY_FIELD_SCHEMAS[key] || [];
  new GenericModal(plugin.app, plugin, key, item, fields).open();
}

// ── PLUGIN CLASS ──────────────────────────────────────────────────────────────
// ── Relationship constants ─────────────────────────────────────────────────────
const RELATIONSHIP_TYPES = [
  'Ally','At War','Blackmailed','Ceasefire','Client','Contact','Creditor','Debtor',
  'Dependent','Employee','Employer','Enemy','Family','Hostile','Informant','Leader',
  'Member','Neutral','Patron','Political Patron','Protective','Religious Authority',
  'Rival','Romantic','Secret Alliance','Spy','Suspicious','Trade Partner','Vassal',
];
const PICKABLE_ENTITY_TYPES = [
  { key:'npcs',          label:'NPC' },
  { key:'characters',    label:'PC / Character' },
  { key:'factions',      label:'Faction' },
  { key:'settlements',   label:'Settlement' },
  { key:'locations',     label:'Location' },
  { key:'regions',       label:'Region' },
  { key:'quests',        label:'Quest' },
];
function addTypedEntityPicker(el, label, typeValue, idValue, plugin, onTypeChange, onIdChange, entityTypes) {
  const typeOptions = Array.isArray(entityTypes) && entityTypes.length ? entityTypes : PICKABLE_ENTITY_TYPES;
  const cur = typeValue || typeOptions[0].key;
  const wrap = ce(el, 'div', 'te-field-row'); wrap.style.alignItems = 'center';
  ce(wrap, 'label', 'te-field-label', label);
  const right = ce(wrap, 'div', ''); right.style.cssText = 'flex:1;display:flex;gap:6px;align-items:center;flex-wrap:wrap';
  const SX = 'padding:6px 8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  const typeSel = ce(right, 'select', 'te-field-select'); typeSel.style.cssText = SX + ';flex:0 0 140px';
  typeOptions.forEach(et => { const o = ce(typeSel, 'option', '', et.label); o.value = et.key; if (et.key === cur) o.selected = true; });
  const entityWrap = ce(right, 'div', ''); entityWrap.style.flex = '1';
  const buildEntitySel = type => {
    clear(entityWrap);
    const items = safeArr(plugin.state.entities[type]).slice().sort((a,b) => (a.name||a.title||'').localeCompare(b.name||b.title||''));
    const sel = ce(entityWrap, 'select', 'te-field-select'); sel.style.cssText = SX + ';width:100%';
    ce(sel, 'option', '', '— select —').value = '';
    items.forEach(it => { const o = ce(sel, 'option', '', it.name||it.title||it.id); o.value = it.id; if (it.id === idValue) o.selected = true; });
    sel.addEventListener('change', () => onIdChange(sel.value));
  };
  buildEntitySel(cur);
  typeSel.addEventListener('change', () => { onTypeChange(typeSel.value); buildEntitySel(typeSel.value); onIdChange(''); });
}

// ── Reference Data Service ────────────────────────────────────────────────────
const REF_DATA_FILES = {
  spells: 'spells.json', feats: 'feats.json', equipment: 'equipment.json',
  backgrounds: 'backgrounds.json', races: 'races.json', skills: 'skills.json',
  languages: 'languages.json', conditions: 'conditions.json', deities: 'deities.json',
  actions: 'actions.json', rewards: 'rewards.json', traps: 'traps.json',
  objects: 'objects.json', vehicles: 'vehicles.json', senses: 'senses.json',
  bestiary: 'bestiary.json', monsterFluff: 'bestiary.json',
  classes: 'class.json', subclasses: 'class.json', classFeatures: 'class.json', subclassFeatures: 'class.json',
  adventures: 'adventure.json', books: 'book.json', generated: 'generated.json',
};
function extractReferenceArray(type, raw) {
  if (Array.isArray(raw)) return raw;
  switch (type) {
    case 'bestiary': return raw.monster || [];
    case 'monsterFluff': return raw.monsterFluff || [];
    case 'classes': return raw.class || [];
    case 'subclasses': return raw.subclass || [];
    case 'classFeatures': return raw.classFeature || [];
    case 'subclassFeatures': return raw.subclassFeature || [];
    case 'adventures': case 'books': return raw.data || [];
    case 'generated': return Array.isArray(raw.data) ? raw.data : [];
    default: return raw.data || [];
  }
}
const SPELL_SCHOOLS = {
  A:'Abjuration', C:'Conjuration', D:'Divination', E:'Enchantment',
  I:'Illusion', N:'Necromancy', T:'Transmutation', V:'Evocation',
};
const REF_TABS = [
  { key:'actions',     label:'Actions',     icon:'⚔️' },
  { key:'backgrounds', label:'Backgrounds', icon:'📜' },
  { key:'bestiary',    label:'Bestiary',    icon:'🐉' },
  { key:'classes',     label:'Classes',     icon:'⚔️' },
  { key:'conditions',  label:'Conditions',  icon:'🩺' },
  { key:'deities',     label:'Deities',     icon:'⚡' },
  { key:'equipment',   label:'Equipment',   icon:'🗡️' },
  { key:'feats',       label:'Feats',       icon:'⭐' },
  { key:'languages',   label:'Languages',   icon:'💬' },
  { key:'objects',     label:'Objects',     icon:'📦' },
  { key:'races',       label:'Races',       icon:'👥' },
  { key:'rewards',     label:'Rewards',     icon:'🏆' },
  { key:'senses',      label:'Senses',      icon:'👁️' },
  { key:'skills',      label:'Skills',      icon:'🎯' },
  { key:'spells',      label:'Spells',      icon:'✨' },
  { key:'subclasses',  label:'Subclasses',  icon:'🎓' },
  { key:'traps',       label:'Traps',       icon:'⚠️' },
  { key:'vehicles',    label:'Vehicles',    icon:'🚢' },
];
class ReferenceDataService {
  constructor(plugin) { this.plugin = plugin; this._cache = {}; this._rawCache = {}; }
  async _loadRaw(filename) {
    if (this._rawCache[filename] !== undefined) return this._rawCache[filename];
    try {
      const raw = await adapterRead(this.plugin.app, `${PLUGIN_DIR}/data/${filename}`);
      this._rawCache[filename] = JSON.parse(raw);
    } catch (e) {
      this._rawCache[filename] = null;
    }
    return this._rawCache[filename];
  }
  async get(type) {
    if (this._cache[type] !== undefined) return this._cache[type];
    const filename = REF_DATA_FILES[type];
    if (!filename) { this._cache[type] = []; return []; }
    const raw = await this._loadRaw(filename);
    if (!raw) { this._cache[type] = []; return []; }
    this._cache[type] = extractReferenceArray(type, raw);
    return this._cache[type];
  }
  search(items, query) {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(it => {
      return [it.name, it.source, it.type, it.school, String(it.level||''), it.pantheon, it.category, it.className, String(it.cr||'')]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }
}

// ── 5e.tools tag / entry renderer ────────────────────────────────────────────
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
function renderEntries(el, entries) {
  safeArr(entries).forEach(entry => {
    if (typeof entry === 'string') {
      if (entry.trim()) ce(el, 'p', 'te-ref-p', renderTag(entry));
    } else if (entry && typeof entry === 'object') {
      switch (entry.type) {
        case 'entries': {
          if (entry.name) { const h = ce(el, 'strong', 'te-ref-sub', entry.name); h.style.display = 'block'; h.style.marginTop = '6px'; }
          renderEntries(el, entry.entries);
          break;
        }
        case 'list': {
          const ul = ce(el, 'ul', 'te-ref-list');
          safeArr(entry.items).forEach(it => {
            if (typeof it === 'string') { ce(ul, 'li', '', renderTag(it)); }
            else if (it && it.type === 'item') {
              const li = ce(ul, 'li', '');
              if (it.name) { const b = ce(li, 'span', ''); b.style.fontWeight = '700'; b.textContent = it.name + ' '; }
              if (it.entry) li.appendChild(document.createTextNode(renderTag(it.entry)));
              else renderEntries(li, it.entries);
            } else if (it) { const li = ce(ul, 'li', ''); renderEntries(li, [it]); }
          });
          break;
        }
        case 'table': {
          const tbl = ce(el, 'table', 'te-ref-table');
          if (entry.colLabels) {
            const tr = ce(ce(tbl, 'thead', ''), 'tr', '');
            entry.colLabels.forEach(h => ce(tr, 'th', '', renderTag(String(h || ''))));
          }
          const tbody = ce(tbl, 'tbody', '');
          safeArr(entry.rows).forEach(row => {
            const tr = ce(tbody, 'tr', '');
            safeArr(row).forEach(cell => {
              const t = typeof cell === 'string' ? cell : (cell?.entry || String(cell?.exact ?? cell?.min ?? ''));
              ce(tr, 'td', '', renderTag(t));
            });
          });
          break;
        }
        case 'item': case 'itemSub': {
          const p = ce(el, 'p', '');
          if (entry.name) { const b = ce(p, 'span', ''); b.style.fontWeight = '700'; b.textContent = entry.name + ': '; }
          if (entry.entry) p.appendChild(document.createTextNode(renderTag(entry.entry)));
          else renderEntries(p, entry.entries);
          break;
        }
        default: if (entry.entries) renderEntries(el, entry.entries);
      }
    }
  });
}
function refItemMeta(type, item) {
  switch (type) {
    case 'spells': {
      const school = SPELL_SCHOOLS[item.school] || item.school || '';
      return item.level === 0 ? `${school} Cantrip` : `Level ${item.level} ${school}`;
    }
    case 'feats': return item.category || '';
    case 'equipment': return [item.type, item.value != null ? `${item.value} gp` : ''].filter(Boolean).join(' · ');
    case 'backgrounds': {
      const skills = Object.keys((safeArr(item.skillProficiencies)[0]) || {});
      return skills.length ? `Skills: ${skills.join(', ')}` : '';
    }
    case 'races': return [Array.isArray(item.size) ? item.size.join('/') : item.size, item.speed ? `${item.speed} ft` : ''].filter(Boolean).join(' · ');
    case 'skills': return item.ability ? `(${item.ability})` : '';
    case 'deities': return [item.pantheon, item.alignment].filter(Boolean).join(' · ');
    case 'languages': return safeArr(item.typicalSpeakers).slice(0, 3).join(', ');
    case 'bestiary': {
      const cr = typeof item.cr === 'object' ? (item.cr.cr || item.cr) : item.cr;
      const type2 = typeof item.type === 'object' ? (item.type.type || '') : (item.type || '');
      return [item.size?.[0], type2, cr ? `CR ${cr}` : ''].filter(Boolean).join(' · ');
    }
    case 'classes': return [item.hd ? `d${item.hd.faces}` : '', item.spellcastingAbility ? `Spellcasting: ${item.spellcastingAbility.toUpperCase()}` : ''].filter(Boolean).join(' · ');
    case 'subclasses': return [item.className, item.source].filter(Boolean).join(' · ');
    case 'adventures': case 'books': return item.source || '';
    default: return item.type || '';
  }
}
function refItemDetail(el, type, item) {
  if (type === 'spells') {
    const school = SPELL_SCHOOLS[item.school] || item.school;
    const castTime = safeArr(item.time).map(t => `${t.number} ${t.unit}`).join(', ');
    const rng = item.range?.distance ? `${item.range.distance.amount} ${item.range.distance.type}` : (item.range?.type || '—');
    const dur = safeArr(item.duration).map(d => {
      if (d.type === 'instant') return 'Instantaneous';
      const base = d.duration ? `${d.duration.amount || ''} ${d.duration.type || ''}`.trim() : d.type;
      return d.concentration ? `Conc., ${base}` : base;
    }).join(', ');
    const grid = ce(el, 'div', 'te-ref-spell-grid');
    [['School', school],['Casting Time', castTime],['Range', rng],['Duration', dur]].forEach(([l, v]) => {
      const c = ce(grid, 'div', ''); ce(c, 'span', 'te-muted-text', l + ': '); c.appendChild(document.createTextNode(v || '—'));
    });
  }
  if (type === 'deities') {
    if (item.domains?.length) ce(el, 'p', 'te-muted-text', `Domains: ${safeArr(item.domains).join(', ')}`);
    if (item.symbol) ce(el, 'p', 'te-muted-text', `Symbol: ${item.symbol}`);
  }
  if (type === 'feats' && item.prerequisite) {
    const prereq = safeArr(item.prerequisite).map(p => Object.entries(p).map(([k,v]) => renderTag(String(v))).join(', ')).join('; ');
    if (prereq) ce(el, 'p', 'te-muted-text', `Prerequisite: ${prereq}`);
  }
  if (type === 'equipment') {
    const meta2 = [item.weight ? `Weight: ${item.weight} lb` : '', item.weaponCategory ? `Cat: ${item.weaponCategory}` : ''].filter(Boolean).join(' · ');
    if (meta2) ce(el, 'p', 'te-muted-text', meta2);
  }
  if (type === 'bestiary') {
    const ac = getMonsterArmorClass(item);
    const hp = getMonsterAverageHp(item);
    const cr = getMonsterCr(item);
    const grid = ce(el, 'div', 'te-stat-grid');
    [['AC', ac], ['Avg HP', hp], ['CR', cr], ['Speed', item.speed ? Object.entries(item.speed).map(([k,v])=>`${k} ${v}ft`).join(', ') : '—']].forEach(([l,v]) => {
      if (v == null || v === '') return;
      const sc = ce(grid, 'div', 'te-stat-card'); ce(sc, 'div', 'te-stat-big', String(v)); ce(sc, 'div', 'te-stat-label', l);
    });
    const abilRow = ce(el, 'div', ''); abilRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0';
    ['str','dex','con','int','wis','cha'].forEach(ab => {
      if (item[ab] == null) return;
      const w = ce(abilRow, 'div', 'te-stat-card'); ce(w, 'div', 'te-stat-big', item[ab]); ce(w, 'div', 'te-stat-label', ab.toUpperCase());
    });
    if (item.trait?.length) { ce(el, 'h4', '', 'Traits'); renderEntries(el, item.trait.map(t => ({ type:'entries', name: t.name, entries: t.entries }))); }
    if (item.action?.length) { ce(el, 'h4', '', 'Actions'); renderEntries(el, item.action.map(a => ({ type:'entries', name: a.name, entries: a.entries }))); }
    if (item.reaction?.length) { ce(el, 'h4', '', 'Reactions'); renderEntries(el, item.reaction.map(r => ({ type:'entries', name: r.name, entries: r.entries }))); }
    if (item.legendary?.length) { ce(el, 'h4', '', 'Legendary Actions'); renderEntries(el, item.legendary.map(l => ({ type:'entries', name: l.name, entries: l.entries }))); }
    return;
  }
  if (type === 'classes') {
    const hd = item.hd ? `d${item.hd.faces}` : '';
    const profs = Array.isArray(item.proficiency) ? item.proficiency.map(p=>p.toUpperCase()).join(', ') : '';
    if (hd) ce(el, 'p', 'te-muted-text', `Hit Die: ${hd}`);
    if (profs) ce(el, 'p', 'te-muted-text', `Saving Throws: ${profs}`);
    if (item.spellcastingAbility) ce(el, 'p', 'te-muted-text', `Spellcasting: ${item.spellcastingAbility.toUpperCase()}`);
    return;
  }
  if (type === 'subclasses') {
    if (item.className) ce(el, 'p', 'te-muted-text', `Class: ${item.className}`);
    if (item.shortName) ce(el, 'p', 'te-muted-text', `Subclass: ${item.shortName}`);
    return;
  }
  renderEntries(el, item.entries);
}

const COMPENDIUM_LOCAL_TYPE_MAP = {
  actions: ['Rule', 'Mechanic'],
  backgrounds: ['Background'],
  bestiary: ['Monster', 'Creature', 'Beast'],
  classes: ['Class'],
  conditions: ['Rule', 'Mechanic'],
  deities: ['Deity'],
  equipment: ['Item', 'Weapon', 'Armour', 'Armor', 'Magic Item'],
  feats: ['Feat'],
  languages: ['Language'],
  races: ['Ancestry', 'Race'],
  spells: ['Spell'],
  subclasses: ['Subclass'],
};

function homebrewMatchesRefTab(item, tab) {
  const types = COMPENDIUM_LOCAL_TYPE_MAP[tab] || [];
  const normalized = normalizeHomebrewRecord(item);
  return types.includes(normalized.homebrewType) || types.includes(normalized.type);
}

function compendiumEntryMatchesRefTab(item, tab) {
  const types = COMPENDIUM_LOCAL_TYPE_MAP[tab] || [];
  return types.includes(item.homebrewType) || types.includes(item.type);
}

function localCompendiumSearchMatch(item, search) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return true;
  const text = [
    item.name,
    item.type,
    item.homebrewType,
    item.category,
    item.summary,
    item.description,
    item.notes,
    item.source,
    safeArr(item.tags).join(' '),
  ].join(' ').toLowerCase();
  return text.includes(q);
}

function buildCompendiumLocalResults(state, tab, search) {
  const homebrew = safeArr(state.entities.homebrew)
    .map(item => normalizeHomebrewRecord(item))
    .filter(item => homebrewMatchesRefTab(item, tab))
    .filter(item => localCompendiumSearchMatch(item, search))
    .map(item => ({ kind: 'homebrew', id: `homebrew:${item.id}`, item }));
  const compendium = safeArr(state.entities.compendium)
    .filter(item => compendiumEntryMatchesRefTab(item, tab))
    .filter(item => localCompendiumSearchMatch(item, search))
    .map(item => ({ kind: 'compendium', id: `compendium:${item.id}`, item }));
  return [...homebrew, ...compendium]
    .sort((a, b) => String(a.item.name || '').localeCompare(String(b.item.name || '')));
}

function renderLocalCompendiumDetail(el, result) {
  const item = result.item || {};
  const summary = item.summary || item.description || item.notes || '';
  if (summary) ce(el, 'p', '', summary);
  const meta = [];
  if (result.kind === 'homebrew') meta.push(`Homebrew Type: ${item.homebrewType}`);
  if (item.category) meta.push(`Category: ${item.category}`);
  if (item.status) meta.push(`Status: ${item.status}`);
  if (item.visibility) meta.push(`Visibility: ${item.visibility}`);
  if (item.sourceCampaignId) meta.push(`Source Campaign: ${item.sourceCampaignId}`);
  if (safeArr(item.tags).length) meta.push(`Tags: ${safeArr(item.tags).join(', ')}`);
  if (meta.length) ce(el, 'p', 'te-muted-text', meta.join(' · '));
}

// ── Compendium section ────────────────────────────────────────────────────────
async function renderReference(main, plugin, tabs) {
  pageHead(main, plugin, 'Library & Homebrew', 'Browse the Compendium and promoted library records.', [
    { label: '📥 Import', onClick: () => new ImportModal(plugin.app, plugin).open() },
    { label: '💾 Export', onClick: () => exportBackup(plugin) },
  ], tabs);
  const dataPath = `${PLUGIN_DIR}/data`;
  const dataExists = await adapterExists(plugin.app, dataPath);
  const rs = { tab: 'spells', search: '', expanded: null, limit: 5 };
  const wrap = ce(main, 'div', '');
  const rebuild = async () => {
    clear(wrap);
    const sRow = ce(wrap, 'div', '');
    sRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;align-items:center';
    const sIn = ce(sRow, 'input', '');
    sIn.type = 'text';
    sIn.placeholder = 'Search name or tag…';
    sIn.value = rs.search;
    sIn.style.cssText = 'flex:1;padding:7px 10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);font-size:.9rem';
    btn(sRow, '× Clear', 'te-btn is-sm', () => {
      rs.search = '';
      rs.expanded = null;
      rs.limit = 5;
      rebuild();
    });

    const tabRow = ce(wrap, 'div', '');
    tabRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px';
    REF_TABS.forEach(t => {
      btn(tabRow, `${t.icon} ${t.label}`, 'te-btn is-sm' + (rs.tab === t.key ? ' is-primary' : ''), () => {
        rs.tab = t.key;
        rs.expanded = null;
        rs.limit = 5;
        rebuild();
      });
    });

    const listEl = ce(wrap, 'div', '');
    const buildList = async () => {
      clear(listEl);
      const all = dataExists ? await plugin.refData.get(rs.tab) : [];
      const filtered = dataExists ? plugin.refData.search(all, rs.search) : [];
      const local = buildCompendiumLocalResults(plugin.state, rs.tab, rs.search);
      const merged = [
        ...local.map(result => ({ kind: result.kind, id: result.id, item: result.item })),
        ...filtered.map(item => ({ kind: 'reference', id: `reference:${rs.tab}:${item.id || item.name}`, item })),
      ];
      const shown = merged.slice(0, rs.limit);

      if (!dataExists) {
        const warn = ce(listEl, 'div', 'te-card');
        warn.style.cssText = 'border-color:var(--te-danger);margin-bottom:12px';
        ce(warn, 'p', 'te-card-body', `⚠️ Data folder not found at ${dataPath}/. Reference entries are unavailable, but local promoted/homebrew results can still appear here.`);
      }

      shown.forEach(result => {
        const card = ce(listEl, 'div', 'te-card te-ref-card');
        const head = ce(card, 'div', 'te-card-head');
        head.style.cursor = 'pointer';
        ce(head, 'h3', 'te-card-title', result.item.name || 'Untitled');
        let meta = '';
        if (result.kind === 'reference') meta = refItemMeta(rs.tab, result.item);
        else if (result.kind === 'homebrew') meta = [result.item.homebrewType, result.item.category].filter(Boolean).join(' · ');
        else meta = [result.item.type, result.item.source].filter(Boolean).join(' · ');
        if (meta) {
          const m = ce(head, 'span', 'te-card-meta-label', meta);
          m.style.marginLeft = '6px';
        }
        if (result.kind === 'reference' && result.item.source) ce(head, 'span', 'te-ref-source', result.item.source);
        if (result.kind !== 'reference') ce(head, 'span', 'te-ref-source', result.kind === 'homebrew' ? 'Homebrew' : 'Compendium');
        const isOpen = rs.expanded === result.id;
        if (isOpen) {
          const body = ce(card, 'div', 'te-ref-detail');
          if (result.kind === 'reference') refItemDetail(body, rs.tab, result.item);
          else renderLocalCompendiumDetail(body, result);
        }
        head.addEventListener('click', () => {
          rs.expanded = isOpen ? null : result.id;
          buildList();
        });
      });

      if (!merged.length) {
        ce(listEl, 'p', 'te-empty-state', rs.search ? `No matches for "${rs.search}".` : `No entries found for "${rs.tab}".`);
      } else if (merged.length > rs.limit) {
        btn(listEl, 'Load more results...', 'te-btn is-sm', () => {
          rs.limit += 5;
          buildList();
        });
      }
    };
    sIn.addEventListener('input', () => {
      rs.search = sIn.value;
      rs.expanded = null;
      rs.limit = 5;
      buildList();
    });
    buildList();
  };
  rebuild();
}

class TTRPGEnginePlugin extends Plugin {
  async onload() {
    let boot;
    try { boot = await beginBoot(this); } catch (e) { boot = { ok: false, reason: String(e) }; }
    if (!boot.ok) {
      // Kill switch is a hard block (user explicitly disabled the plugin)
      if (boot.reason && boot.reason.startsWith('Kill switch')) {
        new Notice(`TTRPG Engine blocked: ${boot.reason}`, 10000);
        return;
      }
      // LOAD_FAILED or stale boot — enable safe mode and fall through to recovery UI
      await enableSafeMode(this.app);
      new Notice(`TTRPG Engine: ${boot.reason.split('\n')[0]} — recovery panel available.`, 10000);
    }

    try {
      const saved = await this.loadData() || {};
      this.state = Object.assign(createDefaultState(), saved);
      if (!this.state.entities || typeof this.state.entities !== 'object') this.state.entities = createDefaultState().entities;
      migrateState(this.state);
    } catch (e) {
      await safeDisable(this.app, 'State load failed', e);
      await enableSafeMode(this.app);
      this.state = createDefaultState();
      new Notice('TTRPG Engine: state load failed — safe mode recovery active.', 10000);
    }

    // Safe mode — register a minimal recovery shell so the DM can fix things without touching files
    if (await safeModeActive(this.app)) {
      this._safeMode = true;
      this.registerView(VIEW_TYPE, leaf => new TTRPGMainView(leaf, this));
      this.addRibbonIcon('castle', 'TTRPG Engine (Safe Mode)', () => this.activateView());
      const scmd = (id, name, fn) => this.addCommand({ id, name, callback: fn });
      scmd('open', 'Open (Safe Mode Recovery)', () => this.activateView());
      scmd('disable-safe-mode', 'Disable safe mode', async () => { await disableSafeMode(this.app); new Notice('Safe mode disabled. Reload Obsidian to restore full operation.', 8000); });
      scmd('backup', 'Backup Data', () => exportBackup(this));
      scmd('repair', 'Repair / reindex data', async () => { migrateState(this.state); await this.saveState(); new Notice('Data repaired and reindexed.'); });
      scmd('clear-crash-lock', 'Clear crash lock', async () => { await clearCrashLock(this.app); new Notice('Crash lock cleared — please reload Obsidian.', 8000); });
      scmd('diagnostics', 'Open diagnostics', () => new DiagnosticsModal(this.app, this).open());
      await endBoot(this);
      return;
    }

    try {
      this.registerView(VIEW_TYPE, leaf => new TTRPGMainView(leaf, this));

      this.addRibbonIcon('castle', 'TTRPG Engine', () => this.activateView());

      const cmd = (id, name, fn) => this.addCommand({ id, name, callback: fn });
      cmd('open', 'Open', () => this.activateView());
      cmd('create-campaign', 'Create campaign', () => { this.activateView(); new CampaignModal(this.app, this).open(); });
      cmd('run-campaign', 'Run / resume campaign', () => { this.activateView(); new SessionModal(this.app, this).open(); });
      cmd('roll-dice', 'Roll dice', () => new DiceModal(this.app, this).open());
      cmd('create-npc', 'Create NPC', () => new NPCModal(this.app, this).open());
      cmd('create-encounter', 'Create encounter', () => new EncounterModal(this.app, this).open());
      cmd('create-quest', 'Create quest', () => new QuestModal(this.app, this).open());
      cmd('create-session', 'Create session log', () => new SessionModal(this.app, this).open());
      cmd('create-homebrew', 'Open homebrew builders', async () => { this.state.activeSection = 'compendium-library'; this.state.activeSubSection = 'homebrew'; await this.saveState(); this.activateView(); });
      cmd('tile-map', 'Open tile map builder', async () => { this.state.activeSection = 'geography'; await this.saveState(); this.activateView(); });
      cmd('repair', 'Repair / reindex data', async () => {
        migrateState(this.state);
        await this.saveState();
        const diag = await runDiagnostics(this);
        const errors = diag.issues.filter(i => i.sev === 'error').length;
        const warns  = diag.issues.filter(i => i.sev === 'warn').length;
        const total  = Object.values(diag.counts).reduce((s, v) => s + v, 0);
        new Notice(
          `Reindexed — ${total} entities. ${errors ? errors + ' errors' : 'No errors'}${warns ? ', ' + warns + ' warnings' : ''}. Open Diagnostics for the full report.`,
          8000
        );
      });
      cmd('backup', 'Backup Data', () => exportBackup(this));
      cmd('my-content', 'Open My Content / Saved Items', async () => { this.state.activeSection = 'dashboard'; await this.saveState(); this.activateView(); });
      // Phase 1 — safety commands
      cmd('open-diagnostics',  'Open diagnostics report', () => new DiagnosticsModal(this.app, this).open());
      cmd('enable-safe-mode',  'Enable safe mode', async () => {
        await enableSafeMode(this.app);
        new Notice('Safe mode enabled. The plugin will not load on next startup.', 8000);
        this.refreshViews();
      });
      cmd('disable-safe-mode', 'Disable safe mode', async () => {
        await disableSafeMode(this.app);
        new Notice('Safe mode disabled.');
        this.refreshViews();
      });
      cmd('clear-crash-lock',  'Clear crash lock', async () => {
        await clearCrashLock(this.app);
        new Notice('Crash lock cleared — plugin will load normally on next startup.');
      });
      cmd('open-crash-report', 'View last crash report', async () => {
        const report = await readCrashReport(this.app);
        if (!report) { new Notice('No crash report found.'); return; }
        new DiagnosticsModal(this.app, this, report).open();
      });
      // Additional creation commands
      cmd('create-world',    'Create world',    () => new GenericModal(this.app, this, 'worlds', null, worldFields).open());
      cmd('create-faction',  'Create faction',  () => new FactionModal(this.app, this).open());
      cmd('create-location', 'Create location', () => new GenericModal(this.app, this, 'locations', null, locationFields).open());
      cmd('create-creature', 'Create creature', () => new CreatureModal(this.app, this).open());
      cmd('create-bbeg',     'Create BBEG',     () => new BBEGModal(this.app, this).open());
      cmd('create-character','Create character sheet', () => new CharacterModal(this.app, this).open());
      // Phase 6 - Campaign Wizard
      cmd('campaign-wizard', 'Open campaign creation wizard', () => new CampaignWizardModal(this.app, this).open());
      // Phase 7 - Campaign Bible
      cmd('campaign-bible', 'Open campaign bible', async () => { this.state.activeSection = 'bible'; await this.saveState(); this.activateView(); });
      // Phase 9 - Dungeons
      cmd('create-dungeon', 'Create dungeon / location', () => new DungeonModal(this.app, this).open());
      // Phase 11 - War Machine
      cmd('create-timer', 'Create escalation timer', () => new TimerModal(this.app, this).open());
      cmd('create-enemy-template', 'Create enemy template', () => new EnemyTemplateModal(this.app, this).open());
      cmd('war-machine', 'Open war machine', async () => { this.state.activeSection = 'war-machine'; await this.saveState(); this.activateView(); });
      // Phase 12 - Faction Matrix
      cmd('faction-matrix', 'Open faction relationship matrix', async () => { this.state.activeSection = 'faction-matrix'; await this.saveState(); this.activateView(); });
      // Phase 13 - Run Session
      cmd('run-session', 'Run / resume session', async () => { this.state.activeSection = 'run-session'; await this.saveState(); this.activateView(); });
      cmd('end-session', 'End current session', async () => { this.state.sessionRunMode = false; this.state.activeSessionId = ''; await this.saveState(); new Notice('Session ended.'); });
      // Phase 14 - PC Companion
      cmd('pc-companion', 'Open PC companion', async () => { this.state.mode = 'PLAYER'; this.state.activeSection = 'pc-overview'; await this.saveState(); this.activateView(); });
      cmd('open-inventory', 'Open PC inventory', async () => { this.state.mode = 'PLAYER'; this.state.activeSection = 'pc-inventory'; await this.saveState(); this.activateView(); });
      cmd('open-spellbook', 'Open spellbook', async () => { this.state.mode = 'PLAYER'; this.state.activeSection = 'pc-spellbook'; await this.saveState(); this.activateView(); });
      cmd('long-rest', 'Long rest', async () => {
        const chars = safeArr(this.state.entities.characters);
        if (!chars.length) { new Notice('No characters found.'); return; }
        chars.forEach(c => { c.hp = c.maxHp || c.hp; c.deathSaves = { successes: 0, failures: 0 }; c.updatedAt = new Date().toISOString(); });
        await this.saveState();
        new Notice(`Long rest complete — HP restored for ${chars.length} character(s).`);
      });
      cmd('short-rest', 'Short rest', async () => {
        const chars = safeArr(this.state.entities.characters);
        if (!chars.length) { new Notice('No characters found.'); return; }
        new Notice(`Short rest taken for ${chars.length} character(s). Use Hit Dice to recover HP.`);
      });
      // Phase 18 - Export
      cmd('export-campaign', 'Export campaign', () => new ExportModal(this.app, this).open());
      cmd('export-player-packet', 'Export player packet', () => exportPlayerSafePacket(this));
      cmd('import-campaign', 'Import campaign', () => new ImportModal(this.app, this).open());
      // Phase 19 - Endgame
      cmd('endgame', 'Open endgame tracker', async () => { this.state.activeSection = 'endgame'; await this.saveState(); this.activateView(); });
      // Phase 251 - Missing create commands
      cmd('create-region',     'Create region',     () => new GenericModal(this.app, this, 'regions', null, regionFields).open());
      cmd('create-settlement', 'Create settlement', () => new GenericModal(this.app, this, 'settlements', null, settlementFields).open());
      cmd('create-secret',     'Create secret',     () => new SecretModal(this.app, this).open());

      this.refData = new ReferenceDataService(this);

      await endBoot(this);
    } catch (e) {
      await safeDisable(this.app, 'Plugin registration failed', e);
      new Notice('TTRPG Engine: startup failed — see crash report.', 10000);
    }
  }

  onunload() {
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

// Persist state without triggering a full view re-render (avoids scroll jump in tile map).
async function saveStateQuiet(plugin) {
  plugin.state.version = PLUGIN_VERSION;
  await plugin.saveData(plugin.state);
}

// Full saveState but restore the .te-main scroll position afterwards.
async function saveStatePreserveScroll(plugin) {
  const main = plugin.view?.containerEl?.querySelector('.te-main');
  const top = main?.scrollTop || 0;
  await plugin.saveState();
  requestAnimationFrame(() => {
    const el = plugin.view?.containerEl?.querySelector('.te-main');
    if (el) el.scrollTop = top;
  });
}

// ── MAIN VIEW ─────────────────────────────────────────────────────────────────
class TTRPGMainView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'TTRPG Engine'; }
  getIcon() { return 'castle'; }
  async onOpen() { this.plugin.view = this; this.render(); }
  async onClose() { if (this.plugin.view === this) this.plugin.view = null; }

  render() {
    const root = this.containerEl.children[1];
    clear(root);
    if (this.plugin._safeMode) { renderSafeModeRecovery(root, this.plugin); return; }
    const state = this.plugin.state;
    root.className = 'ttrpg-shell' + (state.settings.compact ? ' is-compact' : '') + (state.sidebarCollapsed ? ' is-collapsed' : '');

    // ── Top bar
    const top = ce(root, 'header', 'te-topbar');
    ce(top, 'div', 'te-brand', '🏰 TTRPG Engine');
    const modeRow = ce(top, 'div', 'te-mode-toggle');
    btn(modeRow, '⚙️ DM Engine', state.mode === 'DM' ? 'is-active' : '', async () => {
      state.mode = 'DM'; state.activeSection = state.lastDMSection || 'dashboard'; await this.plugin.saveState();
    });
    btn(modeRow, '👤 PC Companion', state.mode === 'PLAYER' ? 'is-active' : '', async () => {
      state.lastDMSection = state.activeSection; state.mode = 'PLAYER'; state.activeSection = 'pc-overview'; await this.plugin.saveState();
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

    const dmNavGroups = [
      { label: 'Command', items: [
        { id: 'dashboard',          icon: '🏰', label: 'Dashboard' },
        { id: 'campaign-command',   icon: '📜', label: 'Campaign Command' },
      ]},
      { label: 'World', items: [
        { id: 'world-atlas',        icon: '🌍', label: 'World Atlas' },
        { id: 'cast-powers',        icon: '👤', label: 'Cast & Powers' },
      ]},
      { label: 'Story', items: [
        { id: 'adventure-planner',  icon: '📝', label: 'Adventure Planner' },
        { id: 'secrets-handouts',   icon: '🔒', label: 'Secrets & Handouts' },
      ]},
      { label: 'Library', items: [
        { id: 'compendium-library', icon: '📚', label: 'Library & Homebrew' },
        { id: 'generators',         icon: '🎲', label: 'Generators' },
      ]},
      { label: 'Tools', items: [
        { id: 'settings-tools',     icon: '⚙️', label: 'Settings & Tools' },
      ]},
    ];

    const pcNavGroups = [
      { label: 'Character', items: [
        { id: 'pc-overview',   icon: '🧙', label: 'Overview' },
        { id: 'pc-character',  icon: '📊', label: 'Character Sheet' },
        { id: 'pc-inventory',  icon: '🎒', label: 'Inventory' },
        { id: 'pc-spellbook',  icon: '📕', label: 'Spellbook' },
        { id: 'hybrid-ancestry', icon: '🧬', label: 'Hybrid Ancestry' },
      ]},
      { label: 'Campaign', items: [
        { id: 'pc-quests',     icon: '📋', label: 'Quest Log' },
        { id: 'pc-handouts',   icon: '📄', label: 'Handouts' },
        { id: 'pc-journal',    icon: '📓', label: 'Journal' },
        { id: 'pc-lore',       icon: '🌐', label: 'World Lore' },
      ]},
    ];

    const navGroups = state.mode === 'PLAYER' ? pcNavGroups : dmNavGroups;
    navGroups.forEach(group => {
      const grp = ce(side, 'div', 'te-nav-group');
      ce(grp, 'span', 'te-nav-group-label', group.label);
      group.items.forEach(({ id, icon, label }) => {
        const isActive = state.activeSection === id;
        const b = btn(grp, '', 'te-nav-btn' + (isActive ? ' is-active' : ''), async () => {
          state.activeSection = id;
          state.activeSubSection = '';
          await this.plugin.saveState();
        });
        ce(b, 'span', 'te-nav-icon', icon);
        ce(b, 'span', 'te-nav-label', label);
      });
    });

    // ── Main content
    const main = ce(body, 'main', 'te-main');
    renderSection(main, this.plugin, state.activeSection || (state.mode === 'PLAYER' ? 'pc-overview' : 'dashboard'));
  }
}

// ── Note migration diagnostic ─────────────────────────────────────────────────
async function diagnoseLegacyNotes(plugin) {
  const app = plugin.app;
  const state = plugin.state;
  const root = safeFileName(state.settings.campaignRootFolder || state.settings.noteRootFolder || 'Campaigns', 'Campaigns');
  const camp = activeCampaign(state);
  if (!camp) return { found: [], report: 'No active campaign — cannot scan legacy paths.' };

  const legacyBase = safeFileName(camp.name, 'Unassigned');
  const found = [];

  // Check each entity type for notes at legacy paths
  for (const [key, arr] of Object.entries(state.entities)) {
    if (!Array.isArray(arr)) continue;
    const legacyFolder = ENTITY_FOLDER_LABELS[key] || key;
    for (const item of arr) {
      const name = safeFileName(item.name || item.title || item.id, 'Untitled');
      const legacyPath = normalizePath(`${legacyBase}/${legacyFolder}/${slugify(item.name || item.title || item.id)}.md`);
      const newPath = resolveEntityNotePath(key, item, state, plugin);
      if (legacyPath !== newPath) {
        const exists = await app.vault.adapter.exists(legacyPath);
        if (exists) {
          found.push({ entityType: key, entityId: item.id, name, legacyPath, newPath });
        }
      }
    }
  }

  const lines = [`# TTRPG Engine — Legacy Note Scan`, `*Scanned: ${new Date().toLocaleDateString()}*`, ''];
  lines.push(`Campaign: **${camp.name}**`);
  lines.push(`Notes found at legacy paths: **${found.length}**`, '');

  if (found.length === 0) {
    lines.push('✅ No legacy notes found outside the configured workspace structure.');
  } else {
    lines.push('> **Note:** Migration is user-triggered. This report is read-only.', '');
    lines.push('| Entity Type | Name | Legacy Path | New Path |');
    lines.push('|---|---|---|---|');
    found.forEach(f => {
      lines.push(`| ${f.entityType} | ${f.name} | \`${f.legacyPath}\` | \`${f.newPath}\` |`);
    });
  }

  return { found, report: lines.join('\n') };
}

async function migrateLegacyNotes(plugin) {
  const { found } = await diagnoseLegacyNotes(plugin);
  const moved = [], skipped = [];

  for (const f of found) {
    const destExists = await plugin.app.vault.adapter.exists(f.newPath);
    if (destExists) { skipped.push(f); continue; }
    try {
      const dir = f.newPath.replace(/\/[^/]+\.md$/, '');
      await ensureFolder(plugin.app, dir);
      const file = plugin.app.vault.getAbstractFileByPath(f.legacyPath);
      if (file) { await plugin.app.vault.rename(file, f.newPath); moved.push(f); }
      else skipped.push(f);
    } catch { skipped.push(f); }
  }

  return { moved, skipped };
}

// ── Repair & reindex ──────────────────────────────────────────────────────────
function repairAndReindex(state) {
  const issues = [];
  const ents = state.entities || {};
  const seenIds = new Set();
  for (const [key, arr] of Object.entries(ents)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((item, i) => {
      if (!item) return;
      // Missing ID
      if (!item.id) { item.id = `${key}-repaired-${Date.now()}-${i}`; issues.push(`${key}[${i}]: assigned missing id`); }
      // Duplicate ID
      if (seenIds.has(item.id)) { const newId = `${item.id}-dup-${i}`; issues.push(`${key}[${i}]: duplicate id ${item.id} → ${newId}`); item.id = newId; }
      seenIds.add(item.id);
      // Missing timestamps
      const now = new Date().toISOString();
      if (!item.createdAt) { item.createdAt = now; issues.push(`${key}[${i}] ${item.id}: added missing createdAt`); }
      if (!item.updatedAt) { item.updatedAt = now; issues.push(`${key}[${i}] ${item.id}: added missing updatedAt`); }
      // Missing campaignId for campaign-owned entities
      if (CAMPAIGN_SCOPED_ENTITIES.includes(key) && !item.campaignId && state.activeCampaignId) {
        item.campaignId = state.activeCampaignId;
        issues.push(`${key}[${i}] ${item.id}: assigned campaignId from activeCampaignId`);
      }
      // Invalid visibility
      const VALID_VIS = ['dm-only','player-visible','secret','revealed'];
      if (item.visibility && !VALID_VIS.includes(item.visibility)) {
        issues.push(`${key}[${i}] ${item.id}: invalid visibility "${item.visibility}" (not changed, requires manual fix)`);
      }
      // Placeholder text saved as field value
      const PLACEHOLDER_STRINGS = ['Select existing', 'Select common options', 'Make noted changes', 'Confirm what this connects to', 'select common', 'select existing'];
      for (const [field, val] of Object.entries(item)) {
        if (typeof val === 'string' && PLACEHOLDER_STRINGS.some(p => val === p)) {
          item[field] = '';
          issues.push(`${key}[${i}] ${item.id}: cleared placeholder text in field "${field}"`);
        }
      }
    });
  }
  // Check relationships — stamp missing campaignId and validate canonical fields
  safeArr(state.relationships).forEach((rel, i) => {
    if (!rel.id) { rel.id = `rel-repaired-${Date.now()}-${i}`; issues.push(`relationship[${i}]: assigned missing id`); }
    if (!rel.campaignId && state.activeCampaignId) {
      rel.campaignId = state.activeCampaignId;
      issues.push(`relationship[${i}] ${rel.id}: assigned missing campaignId`);
    }
    if (rel.fromEntityType && rel.fromId) {
      const arr = safeArr((state.entities || {})[rel.fromEntityType]);
      if (!arr.find(x => x.id === rel.fromId)) issues.push(`relationship[${i}] ${rel.id}: fromId ${rel.fromId} not found in ${rel.fromEntityType}`);
    }
    if (rel.toEntityType && rel.toId) {
      const arr = safeArr((state.entities || {})[rel.toEntityType]);
      if (!arr.find(x => x.id === rel.toId)) issues.push(`relationship[${i}] ${rel.id}: toId ${rel.toId} not found in ${rel.toEntityType}`);
    }
  });
  return issues;
}

// ── Safe mode recovery splash ──────────────────────────────────────────────────
function renderSafeModeRecovery(root, plugin) {
  root.className = 'ttrpg-shell';
  const main = ce(root, 'main', 'te-main');
  const hd = ce(main, 'div', 'te-card'); hd.style.marginBottom = '16px';
  const hh = ce(hd, 'div', 'te-card-head'); ce(hh, 'span', 'te-card-icon', '🔒'); ce(hh, 'h3', 'te-card-title', 'Safe Mode Active');
  ce(hd, 'p', 'te-card-body', 'TTRPG Engine is running in safe mode. Normal plugin features are suspended. Your data is intact — use the recovery options below, then reload Obsidian.');
  const g = ce(main, 'div', 'te-grid');
  const opt = (icon, title, desc, label, onClick) => {
    const c = ce(g, 'div', 'te-card');
    const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', icon); ce(h, 'h3', 'te-card-title', title);
    ce(c, 'p', 'te-card-body', desc);
    btn(ce(c, 'div', 'te-card-actions'), label, 'te-btn is-primary is-sm', onClick);
  };
  opt('✅', 'Disable Safe Mode', 'Re-enable the full plugin. Reload Obsidian after clicking.', 'Disable Safe Mode',
    async () => { await disableSafeMode(plugin.app); new Notice('Safe mode disabled — please reload Obsidian.', 8000); });
  opt('💾', 'Backup Data', 'Export a full backup of your campaign data before making any changes.', 'Backup Now',
    async () => { await exportBackup(plugin); });
  opt('🔧', 'Diagnostics', 'View crash reports, entity counts, data health, and repair tools.', 'Open Diagnostics',
    () => new DiagnosticsModal(plugin.app, plugin).open());
  opt('🔓', 'Clear Crash Lock', 'Remove the crash-lock file preventing normal load.', 'Clear Crash Lock',
    async () => { await clearCrashLock(plugin.app); new Notice('Crash lock cleared — please reload Obsidian.', 6000); });
  opt('🔁', 'Repair / Reindex', 'Scan entities for missing IDs, broken links, and orphaned records.', 'Run Repair',
    async () => {
      const issues = repairAndReindex(plugin.state);
      await plugin.saveState();
      new Notice(issues.length ? `Repair found ${issues.length} issue(s) — see Diagnostics.` : 'No issues found.', 6000);
    });
  opt('📋', 'View Crash Report', 'Read the last crash report recorded by the plugin.', 'View Report',
    async () => {
      const report = await readCrashReport(plugin.app);
      new DiagnosticsModal(plugin.app, plugin, report || 'No crash report found.').open();
    });
}

// ── Section router ─────────────────────────────────────────────────────────────
function renderSection(main, plugin, section) {
  const map = {
    // New workspaces
    dashboard:            renderDashboard,
    'campaign-command':   renderCampaignCommand,
    'world-atlas':        renderWorldAtlas,
    'cast-powers':        renderCastPowers,
    'adventure-planner':  renderAdventurePlanner,
    'secrets-handouts':   renderSecretsHandouts,
    'compendium-library': renderCompendiumLibrary,
    'settings-tools':     renderSettingsTools,
    generators:           renderGenerators,
    // PC Companion
    'pc-overview':        renderPCOverview,
    'pc-character':       renderPCCharacter,
    'pc-inventory':       renderPCInventory,
    'pc-spellbook':       renderPCSpellbook,
    'pc-quests':          renderPCQuests,
    'pc-handouts':        renderPCHandouts,
    'pc-journal':         renderPCJournal,
    'pc-lore':            renderPCLore,
    'hybrid-ancestry':    renderHybridAncestry,
    // Legacy aliases → workspace with pre-set sub-section
    campaigns:            (el, p) => { p.state.activeSubSection = 'campaigns'; renderCampaignCommand(el, p); },
    bible:                (el, p) => { p.state.activeSubSection = 'bible'; renderCampaignCommand(el, p); },
    'run-session':        (el, p) => { p.state.activeSubSection = 'run-session'; renderCampaignCommand(el, p); },
    sessions:             (el, p) => { p.state.activeSubSection = 'sessions'; renderCampaignCommand(el, p); },
    milestones:           (el, p) => { p.state.activeSubSection = 'bible'; renderCampaignCommand(el, p); },
    dmscreen:             (el, p) => { p.state.activeSubSection = 'run-session'; renderCampaignCommand(el, p); },
    world:                (el, p) => { p.state.activeSubSection = 'lore'; renderWorldAtlas(el, p); },
    geography:            (el, p) => { p.state.activeSubSection = 'geography'; renderWorldAtlas(el, p); },
    gazetteer:            (el, p) => { p.state.activeSubSection = 'gazetteer'; renderWorldAtlas(el, p); },
    npcs:                 (el, p) => { p.state.activeSubSection = 'npcs'; renderCastPowers(el, p); },
    factions:             (el, p) => { p.state.activeSubSection = 'factions'; renderCastPowers(el, p); },
    'faction-matrix':     (el, p) => { p.state.activeSubSection = 'matrix'; renderCastPowers(el, p); },
    'relationship-matrix':(el, p) => { p.state.activeSubSection = 'matrix'; renderCastPowers(el, p); },
    'noble-families':     (el, p) => { p.state.activeSubSection = 'noble-families'; renderCastPowers(el, p); },
    adventure:            (el, p) => { p.state.activeSubSection = 'adventures'; renderAdventurePlanner(el, p); },
    encounters:           (el, p) => { p.state.activeSubSection = 'encounters'; renderAdventurePlanner(el, p); },
    downtime:             (el, p) => { p.state.activeSubSection = 'downtime'; renderAdventurePlanner(el, p); },
    'war-machine':        (el, p) => { p.state.activeSubSection = 'war-machine'; renderAdventurePlanner(el, p); },
    endgame:              (el, p) => { p.state.activeSubSection = 'endgame'; renderAdventurePlanner(el, p); },
    secrets:              (el, p) => { renderSecretsHandouts(el, p); },
    library:              (el, p) => { p.state.activeSubSection = 'compendium'; renderCompendiumLibrary(el, p); },
    reference:            (el, p) => { p.state.activeSubSection = 'reference'; renderCompendiumLibrary(el, p); },
    homebrew:             (el, p) => { p.state.activeSubSection = 'homebrew'; renderCompendiumLibrary(el, p); },
    rules:                (el, p) => { p.state.activeSubSection = 'compendium'; renderCompendiumLibrary(el, p); },
    // Legacy fallback
    player:               renderPCOverview,
  };
  (map[section] || renderDashboard)(main, plugin);
}

// ── WORKSPACE HELPERS & CONTAINERS ────────────────────────────────────────────

function workspaceTabs(parent, tabs, plugin) {
  const state = plugin.state;
  const bar = ce(parent, 'div', 'te-workspace-tabs');
  tabs.forEach(({ id, label }) => {
    const active = (state.activeSubSection || tabs[0].id) === id;
    btn(bar, label, 'te-workspace-tab' + (active ? ' is-active' : ''), async () => {
      state.activeSubSection = id;
      await plugin.saveState();
    });
  });
}

function renderCampaignCommand(main, plugin) {
  const state = plugin.state;
  const tabs = [
    { id: 'campaigns',   label: '📜 Campaigns' },
    { id: 'bible',       label: '📖 Campaign Bible' },
    { id: 'sessions',    label: '📅 Sessions' },
    { id: 'run-session', label: '▶ Run Session' },
  ];
  let sub = state.activeSubSection || 'campaigns';
  // Redirect removed tabs to their canonical homes
  if (sub === 'milestones') sub = 'bible';
  if (sub === 'dmscreen')   sub = 'run-session';
  const wrap = ce(main, 'div', 'te-workspace-content');
  if (sub === 'campaigns')        renderCampaigns(wrap, plugin, tabs);
  else if (sub === 'bible')       renderCampaignBible(wrap, plugin, tabs);
  else if (sub === 'sessions')    renderSessions(wrap, plugin, tabs);
  else if (sub === 'run-session') renderRunSession(wrap, plugin, tabs);
  else renderCampaigns(wrap, plugin, tabs);
}

function renderMilestonesSection(main, plugin, tabs) {
  const state = plugin.state;
  const camp = activeCampaign(state);
  pageHead(main, plugin, 'Milestones', 'Track campaign milestones and XP/reward checkpoints.', [
    { label: '+ Milestone', onClick: () => new GenericModal(plugin.app, plugin, 'milestones').open() },
  ], tabs);
  const items = safeArr(state.entities.milestones).filter(m => !camp || m.campaignId === camp.id);
  if (!items.length) { ce(main, 'p', 'te-empty', 'No milestones yet.'); return; }
  const tbl = ce(main, 'div', 'te-list');
  items.forEach(m => {
    const row = ce(tbl, 'div', 'te-list-item');
    ce(row, 'span', 'te-list-name', m.name || 'Unnamed Milestone');
    ce(row, 'span', 'te-list-meta', m.status || '');
    const acts = ce(row, 'div', 'te-list-actions');
    btn(acts, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'milestones', m).open());
    btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(state, 'milestones', m.id); await plugin.saveState(); });
  });
}

function renderWorldAtlas(main, plugin) {
  const state = plugin.state;
  // Redirect legacy gazetteer route to geography
  if (state.activeSubSection === 'gazetteer') state.activeSubSection = 'geography';
  const tabs = [
    { id: 'lore',      label: '🌍 World & Lore' },
    { id: 'geography', label: '🗺️ Geography & Maps' },
    { id: 'tilemap',   label: '🧩 Tile Map Builder' },
  ];
  const sub = state.activeSubSection || 'lore';
  const wrap = ce(main, 'div', 'te-workspace-content');
  if (sub === 'lore')       renderWorld(wrap, plugin, tabs);
  else if (sub === 'tilemap') renderTileMapTab(wrap, plugin, tabs);
  else                      renderGeography(wrap, plugin, tabs);
}

function migrateNobleFamiliesToFactions(plugin) {
  if (!plugin || !plugin.state || !plugin.state.entities) return 0;
  const state = plugin.state;
  const nobles = safeArr(state.entities.nobleFamilies);
  const factions = safeArr(state.entities.factions);
  let created = 0;
  let touched = false;
  nobles.forEach(noble => {
    if (!noble || !noble.id) return;
    const existingFaction = factions.find(faction => faction && (
      faction.id === noble.migratedFactionId ||
      faction.migratedFromNobleFamilyId === noble.id ||
      faction.migratedFromNobleId === noble.id
    ));
    if (existingFaction) {
      if (!noble.migratedToFaction) {
        noble.migratedToFaction = true;
        touched = true;
      }
      if (!noble.migratedFactionId) {
        noble.migratedFactionId = existingFaction.id;
        touched = true;
      }
      if (!existingFaction.migratedFromNobleFamilyId) {
        existingFaction.migratedFromNobleFamilyId = noble.id;
        touched = true;
      }
      if (!existingFaction.migratedFromNobleId) {
        existingFaction.migratedFromNobleId = noble.id;
        touched = true;
      }
      return;
    }
    const newFaction = {
      id: uid('faction'),
      name: noble.name || 'Unnamed House',
      type: 'Noble House',
      notes: noble.motto || '',
      description: noble.summary || noble.motto || '',
      territory: noble.holdings || '',
      members: noble.members || [],
      allies: noble.alliances || [],
      enemies: noble.rivals || [],
      secrets: noble.secrets || '',
      status: noble.status || '',
      campaignId: noble.campaignId || '',
      visibility: noble.visibility || 'dm-only',
      migratedFromNobleFamilyId: noble.id,
      migratedFromNobleId: noble.id,
    };
    upsert(state, 'factions', newFaction);
    noble.migratedToFaction = true;
    noble.migratedFactionId = newFaction.id;
    created++;
    touched = true;
  });
  if (touched && typeof plugin.saveState === 'function') {
    try { plugin.saveState(); } catch {}
  }
  return created;
}

function renderCastPowers(main, plugin) {
  const state = plugin.state;
  migrateNobleFamiliesToFactions(plugin);
  const tabs = [
    { id: 'npcs',            label: '👤 NPCs & Creatures' },
    { id: 'factions',        label: '⚔️ Factions' },
    { id: 'matrix',          label: '🕸️ Relationship Matrix' },
    { id: 'hybrid-ancestry', label: '🧬 Hybrid Ancestry' },
  ];
  let sub = state.activeSubSection || 'npcs';
  // Redirect old noble-families routes to factions
  if (sub === 'noble-families' || sub === 'nobleFamilies') sub = 'factions';
  const wrap = ce(main, 'div', 'te-workspace-content');
  if (sub === 'npcs')                 renderNpcs(wrap, plugin, tabs);
  else if (sub === 'factions')        renderFactions(wrap, plugin, tabs);
  else if (sub === 'matrix')          renderRelationshipMatrix(wrap, plugin, tabs);
  else if (sub === 'hybrid-ancestry') renderHybridAncestry(wrap, plugin, tabs);
  else renderNpcs(wrap, plugin, tabs);
}

function renderNobleFamiliesSection(main, plugin, tabs) {
  const state = plugin.state;
  const camp = activeCampaign(state);
  pageHead(main, plugin, 'Noble Families', 'Aristocratic lineages, dynasties, and houses of power.', [
    { label: '+ Noble Family', onClick: () => new GenericModal(plugin.app, plugin, 'nobleFamilies').open() },
  ], tabs);
  const items = safeArr(state.entities.nobleFamilies).filter(f => !camp || f.campaignId === camp.id);
  if (!items.length) { ce(main, 'p', 'te-empty', 'No noble families yet.'); return; }
  const tbl = ce(main, 'div', 'te-list');
  items.forEach(f => {
    const row = ce(tbl, 'div', 'te-list-item');
    ce(row, 'span', 'te-list-name', f.name || 'Unnamed Family');
    ce(row, 'span', 'te-list-meta', f.motto || '');
    const acts = ce(row, 'div', 'te-list-actions');
    btn(acts, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'nobleFamilies', f).open());
    btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(state, 'nobleFamilies', f.id); await plugin.saveState(); });
  });
}

function renderAdventurePlanner(main, plugin) {
  const state = plugin.state;
  const tabs = [
    { id: 'adventures',  label: '📝 Adventures' },
    { id: 'encounters',  label: '🎯 Encounters' },
    { id: 'downtime',    label: '⏳ Downtime & Bases' },
    { id: 'war-machine', label: '🔧 War Machine' },
    { id: 'endgame',     label: '🌋 Endgame' },
  ];
  const sub = state.activeSubSection || 'adventures';
  const wrap = ce(main, 'div', 'te-workspace-content');
  if (sub === 'adventures')       renderAdventure(wrap, plugin, tabs);
  else if (sub === 'encounters')  renderEncounters(wrap, plugin, tabs);
  else if (sub === 'downtime')    renderDowntime(wrap, plugin, tabs);
  else if (sub === 'war-machine') renderWarMachine(wrap, plugin, tabs);
  else if (sub === 'endgame')     renderEndgame(wrap, plugin, tabs);
  else renderAdventure(wrap, plugin, tabs);
}

function renderSecretsHandouts(main, plugin) {
  renderSecrets(main, plugin);
}

function renderCompendiumLibrary(main, plugin) {
  const state = plugin.state;
  const tabs = [
    { id: 'compendium', label: '📚 Compendium' },
    { id: 'homebrew', label: '🧪 Homebrew' },
  ];
  // Redirect removed legacy compendium sub-sections to their canonical tabs.
  if (state.activeSubSection === 'my-content' || state.activeSubSection === 'reference') state.activeSubSection = 'compendium';
  const sub = state.activeSubSection || 'compendium';
  const wrap = ce(main, 'div', 'te-workspace-content');
  if (sub === 'homebrew') renderHomebrew(wrap, plugin, tabs);
  else renderReference(wrap, plugin, tabs);
}

function renderMyContent(main, plugin, tabs) {
  const state = plugin.state;
  pageHead(main, plugin, 'My Content / Saved Items', 'Overview of everything you have created in this campaign.', [], tabs);
  const ENTITY_NAV = {
    campaigns:'campaign-command', worlds:'world-atlas', cosmologies:'world-atlas', realms:'world-atlas',
    regions:'world-atlas', settlements:'world-atlas', locations:'world-atlas', pois:'world-atlas',
    routes:'world-atlas', npcs:'cast-powers', creatures:'cast-powers', bbegs:'cast-powers',
    factions:'cast-powers', cultures:'world-atlas', languages:'world-atlas',
    deities:'world-atlas', pantheons:'world-atlas', nations:'world-atlas', religions:'world-atlas',
    quests:'adventure-planner', adventures:'adventure-planner', encounters:'adventure-planner',
    sessions:'campaign-command', milestones:'campaign-command', secrets:'secrets-handouts',
    handouts:'secrets-handouts', homebrew:'compendium-library', tables:'compendium-library',
    compendium:'compendium-library', rules:'compendium-library',
    maps:'world-atlas', dungeons:'world-atlas', nobleFamilies:'cast-powers',
    hybridAncestries:'cast-powers', timers:'adventure-planner', enemyTemplates:'adventure-planner',
    acts:'adventure-planner', domains:'world-atlas',
  };
  const sg = ce(main, 'div', 'te-stat-grid');
  const skip = new Set(['characters','journals','calendars','projects','bastions','compendium','tables','rules','conditions','damageTypes','homebrew','generatorHistory','diceHistory']);
  Object.entries(state.entities).forEach(([key, arr]) => {
    if (skip.has(key) || !Array.isArray(arr) || arr.length === 0) return;
    const c = ce(sg, 'div', 'te-stat-card te-stat-card--link');
    ce(c, 'div', 'te-stat-big', arr.length);
    ce(c, 'div', 'te-stat-label', ENTITY_LABELS[key] || key);
    c.addEventListener('click', async () => {
      const dest = ENTITY_NAV[key];
      if (dest) { state.activeSection = dest; state.activeSubSection = ''; await plugin.saveState(); }
    });
  });
}

function renderSettingsTools(main, plugin) {
  const state = plugin.state;
  const tabs = [
    { id: 'diagnostics', label: '🔬 Diagnostics' },
    { id: 'repair',      label: '🔧 Repair & Reindex' },
    { id: 'backup',      label: '💾 Backup & Export' },
    { id: 'import',      label: '📥 Import' },
    { id: 'settings',    label: '⚙️ Settings' },
  ];
  workspaceTabs(main, tabs, plugin);
  const sub = state.activeSubSection || 'diagnostics';
  const wrap = ce(main, 'div', 'te-workspace-content');
  if (sub === 'diagnostics') renderDiagnosticsPanel(wrap, plugin);
  else if (sub === 'repair') renderRepairPanel(wrap, plugin);
  else if (sub === 'backup') renderBackupPanel(wrap, plugin);
  else if (sub === 'import') renderImportPanel(wrap, plugin);
  else if (sub === 'settings') renderSettingsPanel(wrap, plugin);
  else renderDiagnosticsPanel(wrap, plugin);
}

function renderDiagnosticsPanel(main, plugin) {
  pageHead(main, plugin, 'Diagnostics', 'Scan your data for issues.');
  let resultsDiv = null;
  btn(main, '🔬 Run Diagnostics', 'te-btn is-primary', async () => {
    if (resultsDiv) resultsDiv.remove();
    resultsDiv = ce(main, 'div', 'te-diagnostics-results');
    const result = await runDiagnostics(plugin);
    if (result.issues.length === 0) {
      ce(resultsDiv, 'p', 'te-success', '✅ No issues found.');
    } else {
      ce(resultsDiv, 'h3', '', `⚠️ ${result.issues.length} issue(s) found:`);
      result.issues.forEach(i => ce(resultsDiv, 'p', 'te-issue', i));
    }
    if (result.info.length) {
      ce(resultsDiv, 'h3', '', 'Info:');
      result.info.forEach(i => ce(resultsDiv, 'p', 'te-info', i));
    }
  });
  sectionHead(main, 'Reference Data Health');
  ce(main, 'p', 'te-muted', 'Check reference data file counts. Large files (bestiary, adventure, book) are loaded on demand.');
  let refResultsDiv = null;
  btn(main, '📊 Check Reference Data', 'te-btn', async () => {
    if (refResultsDiv) refResultsDiv.remove();
    refResultsDiv = ce(main, 'div', 'te-diagnostics-results');
    ce(refResultsDiv, 'p', 'te-muted-text', 'Loading reference data counts…');
    const keyTypes = ['spells','feats','equipment','backgrounds','races','skills','languages','conditions','deities','bestiary','classes','subclasses'];
    const results = await Promise.all(keyTypes.map(async t => {
      try { const arr = await plugin.refData.get(t); return `${t}: ${arr.length}`; }
      catch { return `${t}: error`; }
    }));
    clear(refResultsDiv);
    results.forEach(r => ce(refResultsDiv, 'p', 'te-info', r));
  });

  sectionHead(main, 'Vault Note Migration');
  ce(main, 'p', 'te-muted', 'Scan for notes saved at legacy (flat) paths. Existing notes are never moved automatically.');
  let migrDiv = null;
  btn(main, '🔍 Scan for Legacy Notes', 'te-btn', async () => {
    if (migrDiv) migrDiv.remove();
    migrDiv = ce(main, 'div', 'te-diagnostics-results');
    ce(migrDiv, 'p', 'te-muted', 'Scanning vault…');
    const { found, report } = await diagnoseLegacyNotes(plugin);
    migrDiv.empty();
    ce(migrDiv, 'p', found.length ? 'te-warn' : 'te-success',
      found.length ? `Found ${found.length} note(s) at legacy paths.` : '✅ No legacy notes found.');
    if (found.length) {
      btn(migrDiv, '📦 Migrate to Workspace Folders', 'te-btn is-primary', async () => {
        const { moved, skipped } = await migrateLegacyNotes(plugin);
        ce(migrDiv, 'p', 'te-success', `✅ Moved: ${moved.length}  Skipped (already exists): ${skipped.length}`);
      });
      const folder = campaignFolder(plugin);
      btn(migrDiv, '💾 Export Migration Report', 'te-btn', async () => {
        await ensureFolder(plugin.app, `${folder}/Campaign Command Centre/Exports`);
        await writeNote(plugin.app, normalizePath(`${folder}/Campaign Command Centre/Exports/migration-report.md`), report);
        new Notice('Migration report exported.');
      });
    }
  });
}

function renderRepairPanel(main, plugin) {
  pageHead(main, plugin, 'Repair & Reindex', 'Fix missing IDs, broken references, and migrate legacy fields.');
  btn(main, '🔧 Run Repair & Reindex', 'te-btn is-primary', async () => {
    const issues = repairAndReindex(plugin.state);
    await plugin.saveState();
    const out = ce(main, 'div', 'te-repair-results');
    ce(out, 'p', 'te-success', `✅ Repair complete. ${issues.length} item(s) processed.`);
    issues.slice(0, 20).forEach(i => ce(out, 'p', 'te-info', i));
  });
}

function renderBackupPanel(main, plugin) {
  pageHead(main, plugin, 'Backup & Export', 'Export your full campaign data as JSON.');
  btn(main, '💾 Export Full Backup', 'te-btn is-primary', () => {
    const blob = JSON.stringify({ version: plugin.state.version, timestamp: new Date().toISOString(), state: plugin.state }, null, 2);
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(blob);
    a.download = 'ttrpg-engine-backup.json';
    a.click();
  });
}

function renderImportPanel(main, plugin) {
  pageHead(main, plugin, 'Import', 'Import or restore campaign data from a JSON file.');

  sectionHead(main, 'Restore or Merge from File');
  ce(main, 'p', 'te-muted-text', 'Select a .json file — either a plugin backup wrapper or a raw data.json from the plugin folder. The file will be inspected before any data is changed.');

  const file = ce(main, 'input', '');
  file.type = 'file';
  file.accept = '.json';
  file.style.display = 'none';

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      file.value = '';
      try {
        const parsed = parseTtrpgBackupJson(ev.target.result);
        new RestoreBackupModal(plugin.app, plugin, parsed).open();
      } catch (e) {
        new Notice(`Could not parse file: ${e.message}`);
      }
    };
    reader.readAsText(f);
  });

  const actRow = ce(main, 'div', 'te-modal-actions');
  btn(actRow, '📂 Open File…', 'te-btn is-primary', () => file.click());
  btn(actRow, '📋 Paste / Merge Entities', 'te-btn', () => new ImportModal(plugin.app, plugin).open());

  sectionHead(main, 'Vault Path Restore');
  ce(main, 'p', 'te-muted-text', 'If your backup is already in the vault, use the full restore modal to load it by path.');
  btn(main, '📥 Restore from Vault Path…', 'te-btn', () => new RestoreBackupModal(plugin.app, plugin).open());
}

function renderSettingsPanel(main, plugin) {
  pageHead(main, plugin, 'Settings', 'Plugin configuration and preferences.');
  ce(main, 'p', 'te-muted', 'Settings configuration available in this panel.');
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard(main, plugin) {
  const state = plugin.state;
  const camp = activeCampaign(state);
  const campId = camp ? camp.id : null;
  const scopedQ = q => !campId || q.campaignId === campId;
  const scopedF = f => !campId || f.campaignId === campId;

  pageHead(main, plugin, 'Dungeon Master Console', camp ? `${camp.name} — live command cockpit` : 'Campaign hub — start here.', [
    { label: '🧙 Campaign Wizard', primary: !camp, onClick: () => new CampaignWizardModal(plugin.app, plugin).open() },
    { label: '+ Quick Campaign', onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '▶ Run Session', primary: !!camp, onClick: async () => { state.activeSection = 'campaigns'; state.activeSubSection = 'run-session'; await plugin.saveState(); } },
    { label: '🎲 Roll Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ]);

  // ── Active Campaign hero card ────────────────────────────────────────────────
  sectionHead(main, 'Active Campaign');
  const ac = ce(main, 'div', 'te-card');
  if (!camp) {
    const hd = ce(ac, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '📜');
    ce(hd, 'h3', 'te-card-title', 'No active campaign');
    ce(ac, 'p', 'te-card-body', 'Set up a campaign to unlock the full cockpit — quests, sessions, maps, and live-play tools all scope to your active campaign.');
    const acts = ce(ac, 'div', 'te-card-actions');
    btn(acts, '🧙 Campaign Wizard', 'te-btn is-primary', () => new CampaignWizardModal(plugin.app, plugin).open());
    btn(acts, '+ Quick Campaign', 'te-btn', () => new CampaignModal(plugin.app, plugin).open());
    btn(acts, 'View All Campaigns', 'te-btn is-sm', async () => { state.activeSection = 'campaigns'; await plugin.saveState(); });
  } else {
    const hd = ce(ac, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '📜');
    const titleWrap = ce(hd, 'div', ''); titleWrap.style.cssText = 'flex:1';
    ce(titleWrap, 'h3', 'te-card-title', camp.name);
    const tagline = camp.tagline || camp.summary || '';
    if (tagline) { const tl = ce(ac, 'p', 'te-card-body', tagline.slice(0, 200)); tl.style.fontStyle = 'italic'; }
    const meta = ce(ac, 'div', 'te-card-meta');
    const mf = [
      ['Ruleset', camp.ruleset || ''],
      ['Level Range', camp.levelRange || ''],
      ['Players', camp.playerCount ? String(camp.playerCount) : ''],
      ['Sessions', String(safeArr(state.entities.sessions).filter(s => s.campaignId === campId).length)],
    ];
    mf.forEach(([label, val]) => {
      if (!val) return;
      const row = ce(meta, 'div', 'te-card-meta-row');
      ce(row, 'span', 'te-card-meta-label', label);
      ce(row, 'span', '', val);
    });
    const acts = ce(ac, 'div', 'te-card-actions');
    btn(acts, '▶ Run Session', 'te-btn is-primary', async () => { state.activeSection = 'campaigns'; state.activeSubSection = 'run-session'; await plugin.saveState(); });
    btn(acts, 'Campaign Bible', 'te-btn is-sm', async () => { state.activeSection = 'campaigns'; state.activeSubSection = 'bible'; await plugin.saveState(); });
    btn(acts, 'Edit Campaign', 'te-btn is-sm', () => new CampaignModal(plugin.app, plugin, camp).open());
    btn(acts, 'Switch Campaign', 'te-btn is-sm', async () => { state.activeSection = 'campaigns'; await plugin.saveState(); });
  }

  // ── Run Session panel ────────────────────────────────────────────────────────
  sectionHead(main, 'Run Session');
  const rs = ce(main, 'div', 'te-card');
  const rsHd = ce(rs, 'div', 'te-card-head');
  ce(rsHd, 'span', 'te-card-icon', '▶');
  ce(rsHd, 'h3', 'te-card-title', state.sessionRunMode ? 'Session in progress' : 'Start a session');
  if (!camp) {
    ce(rs, 'p', 'te-card-body', 'Set an active campaign first to unlock session tools.');
  } else if (state.sessionRunMode) {
    const activeSess = safeArr(state.entities.sessions).find(s => s.id === state.activeSessionId);
    const sessLabel = activeSess ? (activeSess.name || activeSess.title || `Session #${activeSess.sessionNum || '?'}`) : 'Active session';
    ce(rs, 'p', 'te-card-body', `${sessLabel} is running. Resume to continue tracking events, context, and combat.`);
    const acts = ce(rs, 'div', 'te-card-actions');
    btn(acts, '▶ Resume Session', 'te-btn is-primary', async () => { state.activeSection = 'campaigns'; state.activeSubSection = 'run-session'; await plugin.saveState(); });
  } else {
    ce(rs, 'p', 'te-card-body', 'No session running. Start one to track events, NPCs, quests, dice rolls, and more.');
    const acts = ce(rs, 'div', 'te-card-actions');
    btn(acts, '▶ Start Session', 'te-btn is-primary', async () => { state.activeSection = 'campaigns'; state.activeSubSection = 'run-session'; await plugin.saveState(); });
  }
  // Latest session review
  const recentSessions = safeArr(state.entities.sessions)
    .filter(s => !campId || s.campaignId === campId)
    .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  if (recentSessions.length) {
    const latest = recentSessions[0];
    const latestLabel = latest.name || latest.title || `Session #${latest.sessionNum || '?'}`;
    const latestDate = (latest.updatedAt || latest.createdAt || '').slice(0, 10);
    const latestRow = ce(rs, 'div', 'te-card-meta'); latestRow.style.marginTop = '8px';
    const lr = ce(latestRow, 'div', 'te-card-meta-row');
    ce(lr, 'span', 'te-card-meta-label', 'Latest');
    ce(lr, 'span', '', `${latestLabel}${latestDate ? ' — ' + latestDate : ''}`);
    if (!rs.querySelector('.te-card-actions')) {
      const rsa = ce(rs, 'div', 'te-card-actions');
      btn(rsa, 'View All Sessions', 'te-btn is-sm', async () => { state.activeSection = 'sessions'; await plugin.saveState(); });
    } else {
      const rsBtns = rs.querySelector('.te-card-actions');
      btn(rsBtns, 'View All Sessions', 'te-btn is-sm', async () => { state.activeSection = 'sessions'; await plugin.saveState(); });
    }
  }

  // ── Live status: Active Quests & Factions ───────────────────────────────────
  if (camp) {
    const activeQuests = safeArr(state.entities.quests).filter(q => scopedQ(q) && q.status === 'Active');
    const activeFactions = safeArr(state.entities.factions).filter(scopedF);
    if (activeQuests.length || activeFactions.length) {
      const liveRow = ce(main, 'div', ''); liveRow.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap';

      if (activeQuests.length) {
        sectionHead(main, 'Active Quests');
        const qc = ce(main, 'div', 'te-card');
        activeQuests.slice(0, 5).forEach(q => {
          const row = ce(qc, 'div', 'te-card-meta-row');
          ce(row, 'span', '', q.name || q.title || 'Unnamed quest');
          if (q.priority) { const pb = ce(row, 'span', 'te-chip', q.priority); pb.style.cssText = 'font-size:.7rem;margin-left:6px'; }
        });
        if (activeQuests.length > 5) ce(qc, 'div', 'te-muted-text', `+${activeQuests.length - 5} more`);
        const qacts = ce(qc, 'div', 'te-card-actions');
        btn(qacts, 'Open Quests', 'te-btn is-sm', async () => { state.activeSection = 'adventure'; await plugin.saveState(); });
      }

      if (activeFactions.length) {
        sectionHead(main, 'Factions');
        const fc = ce(main, 'div', 'te-card');
        activeFactions.slice(0, 5).forEach(f => {
          const row = ce(fc, 'div', 'te-card-meta-row');
          ce(row, 'span', '', f.name || 'Unnamed faction');
          if (f.alignment) { const ab = ce(row, 'span', 'te-chip', f.alignment); ab.style.cssText = 'font-size:.7rem;margin-left:6px'; }
        });
        if (activeFactions.length > 5) ce(fc, 'div', 'te-muted-text', `+${activeFactions.length - 5} more`);
        const facts = ce(fc, 'div', 'te-card-actions');
        btn(facts, 'Open Factions', 'te-btn is-sm', async () => { state.activeSection = 'world'; await plugin.saveState(); });
      }
    } else {
      // Empty-state CTA when no quests or factions exist yet
      sectionHead(main, 'Campaign Progress');
      const ep = ce(main, 'div', 'te-card');
      ce(ep, 'p', 'te-card-body', 'No active quests or factions yet. Add quests and factions to start tracking campaign pressure here.');
      const epacts = ce(ep, 'div', 'te-card-actions');
      btn(epacts, '+ Add Quest', 'te-btn is-sm', async () => { state.activeSection = 'adventure'; await plugin.saveState(); });
      btn(epacts, '+ Add Faction', 'te-btn is-sm', async () => { state.activeSection = 'world'; await plugin.saveState(); });
    }
  }

  // ── Diagnostics (only when issues detected) ─────────────────────────────────
  const issues = repairAndReindex(state);
  if (issues.length) {
    sectionHead(main, 'Diagnostics');
    const dc = ce(main, 'div', 'te-card');
    dc.style.borderColor = 'var(--te-danger, #c0392b)';
    const dh = ce(dc, 'div', 'te-card-head');
    ce(dh, 'span', 'te-card-icon', '⚠️');
    ce(dh, 'h3', 'te-card-title', `${issues.length} data issue${issues.length > 1 ? 's' : ''} detected`);
    ce(dc, 'p', 'te-card-body', issues.slice(0, 3).join(' • '));
    const dacts = ce(dc, 'div', 'te-card-actions');
    btn(dacts, '🔧 Repair & Reindex', 'te-btn is-primary is-sm', async () => {
      repairAndReindex(state); await plugin.saveState();
      new Notice('Repair complete.');
    });
    btn(dacts, '💾 Backup Now', 'te-btn is-sm', () => exportBackup(plugin));
  }

  // ── Utilities strip ──────────────────────────────────────────────────────────
  sectionHead(main, 'Utilities');
  const uc = ce(main, 'div', 'te-card');
  const uacts = ce(uc, 'div', 'te-card-actions');
  btn(uacts, '💾 Backup Now', 'te-btn is-sm', () => exportBackup(plugin));
  btn(uacts, '📥 Restore Backup', 'te-btn is-sm', () => new RestoreBackupModal(plugin.app, plugin).open());
  if (!issues.length) {
    btn(uacts, '🔧 Repair & Reindex', 'te-btn is-sm', async () => {
      const found = repairAndReindex(state); await plugin.saveState();
      new Notice(found.length ? `Repaired ${found.length} issue(s).` : 'No issues found.');
    });
  }
  btn(uacts, '🎲 Roll Dice', 'te-btn is-sm', () => new DiceModal(plugin.app, plugin).open());
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
function renderCampaigns(main, plugin, tabs) {
  pageHead(main, plugin, 'Campaigns', 'Create, manage, and switch between your campaigns.', [
    { label: '🧙 Campaign Wizard', primary: true, onClick: () => new CampaignWizardModal(plugin.app, plugin).open() },
    { label: '+ Quick Campaign', onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '▶ Run Session', run: true, onClick: async () => { plugin.state.activeSubSection = 'run-session'; await plugin.saveState(); } },
    { label: '📖 Campaign Bible', onClick: async () => { plugin.state.activeSubSection = 'bible'; await plugin.saveState(); } },
  ], tabs);
  const campaigns = safeArr(plugin.state.entities.campaigns).filter(c => matchesSearch(c, plugin.state.search));
  if (!campaigns.length) { emptyState(main, 'No campaigns yet.', 'Click "New Campaign" to create your first campaign.'); return; }
  const stack = ce(main, 'div', '');
  stack.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  campaigns.forEach(camp => {
    const bib = camp.bible || {};
    const c = ce(stack, 'div', 'te-card');
    c.style.width = '100%';
    // Header row
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '📜');
    const titleRow = ce(hd, 'div', '');
    titleRow.style.cssText = 'flex:1;display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    ce(titleRow, 'h3', 'te-card-title', camp.name);
    if (camp.id === plugin.state.activeCampaignId) {
      const badge = ce(titleRow, 'span', 'te-chip', '✓ Active');
      badge.style.cssText = 'border-color:var(--te-accent);color:var(--te-accent);font-size:.72rem';
    }
    if (camp.status && camp.status !== 'Active') {
      const sb = ce(titleRow, 'span', 'te-chip', camp.status);
      sb.style.fontSize = '.72rem';
    }
    // Tagline / premise
    const tagline = camp.tagline || bib.premise || camp.summary || '';
    if (tagline) { const tb = ce(c, 'p', 'te-card-body', tagline.slice(0, 200)); tb.style.fontStyle = 'italic'; }
    // Useful metadata
    const meta = ce(c, 'div', 'te-card-meta');
    const worldName = camp.worldName || (safeArr(plugin.state.entities.worlds).find(w => w.campaignId === camp.id) || {}).name || '';
    const mf = [
      ['World', worldName],
      ['Level Range', camp.levelRange],
      ['Levelling', camp.levellingMethod],
      ['Players', camp.playerCount ? String(camp.playerCount) : ''],
      ['Ruleset', camp.ruleset || (bib.ruleset) || ''],
      ['Tone', camp.tone ? (Array.isArray(camp.tone) ? camp.tone.join(', ') : camp.tone) : (bib.tone || '')],
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
    btn(acts, 'Write Note', 'te-btn is-sm', () => writeEntityNote(plugin, 'campaigns', camp));
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
function renderDmScreen(main, plugin, tabs) {
  pageHead(main, plugin, 'DM Screen', 'Quick references, conditions, rules, and session tools at a glance.', [
    { label: '▶ Run / Resume', run: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
    { label: '+ New Campaign', onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '🎲 Roll Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ], tabs);
  sectionHead(main, 'Quick Reference');
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
function renderWorld(main, plugin, tabs) {
  pageHead(main, plugin, 'World & Lore', 'Worlds, cosmologies, realms, deities, factions, cultures, languages, and more.', [
    { label: '+ World', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'worlds', null, worldFields).open() },
    { label: '+ Cosmology', onClick: () => new GenericModal(plugin.app, plugin, 'cosmologies', null, cosmologyFields).open() },
    { label: '+ Realm', onClick: () => new GenericModal(plugin.app, plugin, 'realms', null, realmFields).open() },
    { label: '+ Deity', onClick: () => new DeityModal(plugin.app, plugin).open() },
    { label: '+ Culture', onClick: () => new GenericModal(plugin.app, plugin, 'cultures', null, cultureFields).open() },
    { label: '+ Language', onClick: () => new GenericModal(plugin.app, plugin, 'languages', null, langFields).open() },
    { label: '+ Nation', onClick: () => new GenericModal(plugin.app, plugin, 'nations', null, nationFields).open() },
    { label: '+ Religion', onClick: () => new GenericModal(plugin.app, plugin, 'religions', null, religionFields).open() },
    { label: '🗓️ Calendar', onClick: () => new CalendarModal(plugin.app, plugin).open() },
  ], tabs);

  sectionHead(main, 'Worlds');
  itemCards(main, plugin, 'worlds', { meta: ['worldScale', 'tone', 'premise'] });
  sectionHead(main, 'Cosmologies');
  itemCards(main, plugin, 'cosmologies', { meta: ['type', 'creationMyth'] });
  sectionHead(main, 'Realms & Planes');
  itemCards(main, plugin, 'realms', { meta: ['type', 'parentPlaneId', 'connectionIds'] });
  sectionHead(main, 'Deities & Pantheons');
  itemCards(main, plugin, 'deities', {
    meta: ['domain', 'pantheonId', 'holySiteIds', 'alignment'],
    onEdit: (p, key, item) => new DeityModal(p.app, p, item).open(),
    onExtra: (acts, item) => btn(acts, 'Save as Homebrew', 'te-btn is-sm', async () => {
      const hb = promoteDeityToHomebrew(plugin, item);
      await plugin.saveState();
      new Notice(`Homebrew "${hb.name}" saved.`);
    }),
  });
  sectionHead(main, 'Cultures');
  itemCards(main, plugin, 'cultures', { meta: ['languageId', 'values'] });
  sectionHead(main, 'Languages');
  itemCards(main, plugin, 'languages', { meta: ['script', 'speakers'] });
  sectionHead(main, 'Calendars');
  const cals = safeArr(plugin.state.entities.calendars).concat(plugin.state.calendar && plugin.state.calendar.name ? [plugin.state.calendar] : []);
  if (!cals.length) { emptyState(main, 'No calendars yet.', 'Use the Calendar button above to create one.'); }
  else itemCards(main, plugin, 'calendars', { meta: ['year', 'month', 'day'] });
  sectionHead(main, 'Nations');
  itemCards(main, plugin, 'nations', { meta: ['type', 'rulerNpcId', 'capitalId'] });
  sectionHead(main, 'Religions');
  itemCards(main, plugin, 'religions', { meta: ['type', 'deityId', 'domainId', 'alignment'] });
}

// Field definitions for generic modals
const worldFields = [
  { key: 'name', label: 'World Name', type: 'text' },
  { key: 'worldScale', label: 'World Scale', type: 'select', options: ['Single Region','Continent','Multiple Continents','Archipelago','Planar Fragment','Floating World','Pocket Dimension','Other'] },
  { key: 'premise', label: 'Core Premise', type: 'textarea' },
  { key: 'tone', label: 'Campaign Tone', type: 'select', options: ['Heroic Fantasy','Dark Fantasy','Sword & Sorcery','Political Intrigue','Horror','Mystery','Exploration','Epic','Mythic','Other'] },
  { key: 'geography', label: 'Geography Overview', type: 'textarea' },
  { key: 'climate', label: 'Climate Rules', type: 'chip', opts: { bank: 'climateRules' } },
  { key: 'resources', label: 'Key Resources', type: 'chip', opts: { bank: 'regionalResources' } },
  { key: 'magic', label: 'Magic Rules', type: 'chip', opts: { bank: 'magicRules' } },
  { key: 'summary', label: 'Summary / Notes', type: 'textarea' },
];
const cosmologyFields = [
  { key: 'name', label: 'Cosmology Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Great Wheel','World Tree','Material Plane + Echo Planes','Elemental Cosmology','Dualistic Light/Dark','Heaven/Hell Cosmology','Planar Sea','Infinite Realms','Closed World','Dream Cosmology','Mythic Underworld','Custom'] },
  { key: 'creationMyth', label: 'Creation Myth', type: 'textarea' },
  { key: 'planeIds', label: 'Planes / Realms', type: 'entityMultiRef', entityType: 'realms' },
  { key: 'planes', label: 'Planes / Realms (legacy text)', type: 'chip', legacy: true },
  { key: 'portalIds', label: 'Portals / Gateways', type: 'entityMultiRef', entityType: 'pois' },
  { key: 'travelRules', label: 'Planar Travel Rules', type: 'chip', opts: { bank: 'planarTravelRules' } },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const realmFields = [
  { key: 'name', label: 'Realm Name', type: 'text' },
  { key: 'type', label: 'Realm Type', type: 'select', options: ['Material','Shadow','Ethereal','Astral','Inner Plane','Outer Plane','Feywild','Shadowfell','Demi-plane','Other'] },
  { key: 'parentPlaneId', label: 'Parent Plane', type: 'entityRef', entityType: 'realms' },
  { key: 'parentPlane', label: 'Parent Plane (legacy text)', type: 'text', legacy: true },
  { key: 'connectionIds', label: 'Connected Realms', type: 'entityMultiRef', entityType: 'realms' },
  { key: 'connections', label: 'Connected Realms (legacy text)', type: 'chip', legacy: true },
  { key: 'features', label: 'Key Features', type: 'chip', opts: { suggestions: ['Time Dilation','Dream Logic','Living Wilderness','Floating Isles','Mirror Cities','Elemental Flux','Custom'] } },
  { key: 'rules', label: 'Special Rules', type: 'chip', opts: { suggestions: ['Magic is amplified','Travel requires a pact','Mortals cannot age','Names have power','Only moonlight opens paths','Custom'] } },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const deityFields = [
  { key: 'name', label: 'Deity Name', type: 'text' },
  { key: 'titles', label: 'Titles / Epithets', type: 'chip', opts: { suggestions: ['The Dawnfather','Lady of Graves','Storm-King','The Trickster','Mother of Wolves','Custom'] } },
  { key: 'domain', label: 'Divine Domain', type: 'chip', opts: { suggestions: ['Life','Light','War','Trickery','Knowledge','Death','Nature','Tempest','Forge','Grave','Order','Peace','Twilight','Arcana','Custom'] } },
  { key: 'pantheonId', label: 'Pantheon', type: 'entityRef', entityType: 'pantheons' },
  { key: 'pantheon', label: 'Pantheon (legacy text)', type: 'text', legacy: true },
  { key: 'alignment', label: 'Alignment', type: 'select', options: ALIGNMENTS },
  { key: 'symbols', label: 'Symbols', type: 'chip', opts: { suggestions: ['Sun disk','Crescent moon','Skull','Hammer','Open eye','Rose','Custom'] } },
  { key: 'worshippers', label: 'Worshippers', type: 'chip', opts: { suggestions: ['Farmers','Nobility','Sailors','Soldiers','Scholars','Outcasts','Custom'] } },
  { key: 'holySiteIds', label: 'Holy Sites', type: 'entityMultiRef', entityType: 'locations' },
  { key: 'holySites', label: 'Holy Sites (legacy text)', type: 'chip', legacy: true },
  { key: 'clergy', label: 'Clergy Notes', type: 'textarea' },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const cultureFields = [
  { key: 'name', label: 'Culture Name', type: 'text' },
  { key: 'languageId', label: 'Primary Language', type: 'entityRef', entityType: 'languages' },
  { key: 'language', label: 'Primary Language (legacy text)', type: 'text', legacy: true },
  { key: 'values', label: 'Core Values', type: 'chip', opts: { suggestions: ['Honor','Hospitality','Ancestor Veneration','Cunning','Duty','Freedom','Tradition','Ambition','Custom'] } },
  { key: 'customs', label: 'Customs', type: 'chip', opts: { bank: 'cultureCustoms' } },
  { key: 'taboos', label: 'Taboos', type: 'chip', opts: { bank: 'cultureTaboos' } },
  { key: 'clothing', label: 'Clothing / Appearance', type: 'chip', opts: { bank: 'clothingStyles' } },
  { key: 'clothingNotes', label: 'Clothing Notes', type: 'textarea' },
  { key: 'food', label: 'Food & Drink', type: 'chip', opts: { bank: 'foodCulture' } },
  { key: 'foodNotes', label: 'Food Notes', type: 'textarea' },
  { key: 'socialStructure', label: 'Social Structure', type: 'chip', opts: { bank: 'socialStructure' } },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const langFields = [
  { key: 'name', label: 'Language Name', type: 'text' },
  { key: 'script', label: 'Script', type: 'text' },
  { key: 'speakers', label: 'Spoken By', type: 'text' },
  { key: 'origin', label: 'Origin (legacy text)', type: 'text', legacy: true },
  { key: 'originText', label: 'Origin / Etymology', type: 'text' },
  { key: 'originCultureId', label: 'Origin Culture (linked)', type: 'entityRef', entityType: 'cultures' },
  { key: 'originRegionId', label: 'Origin Region (linked)', type: 'entityRef', entityType: 'regions' },
  { key: 'originNationId', label: 'Origin Nation (linked)', type: 'entityRef', entityType: 'nations' },
  { key: 'summary', label: 'Notes / Sample Words', type: 'textarea' },
];

// ── GEOGRAPHY & MAPS ──────────────────────────────────────────────────────────
function renderTileMapTab(main, plugin, tabs) {
  pageHead(main, plugin, '🧩 Tile Map Builder', 'Build and save campaign maps tile by tile.', [], tabs);
  renderTileMapBuilder(main, plugin);
  sectionHead(main, 'Saved Maps');
  const savedMaps = safeArr(plugin.state.entities.maps);
  if (!savedMaps.length) {
    emptyState(main, 'No maps saved yet.', 'Build a map above then click "💾 Save Map".');
  } else {
    const mg = ce(main, 'div', 'te-grid');
    savedMaps.forEach(mapRecord => {
      const c = ce(mg, 'div', 'te-card');
      const hd = ce(c, 'div', 'te-card-head');
      ce(hd, 'span', 'te-card-icon', '🗺️');
      ce(hd, 'h3', 'te-card-title', mapRecord.name || 'Untitled Map');
      const meta = ce(c, 'div', 'te-card-meta');
      const layout = mapRecord.tileLayout || {};
      const tileCount = (layout.tiles || []).length;
      const row1 = ce(meta, 'div', 'te-card-meta-row');
      ce(row1, 'span', 'te-card-meta-label', 'tiles');
      ce(row1, 'span', '', String(tileCount));
      if (mapRecord.updatedAt) {
        const row2 = ce(meta, 'div', 'te-card-meta-row');
        ce(row2, 'span', 'te-card-meta-label', 'saved');
        ce(row2, 'span', '', new Date(mapRecord.updatedAt).toLocaleDateString());
      }
      // Show entity links stored on this map
      const linkKeys = ['linkedRegionId','linkedSettlementId','linkedLocationId','linkedDungeonId','linkedPoiId','linkedEncounterId','linkedSessionId'];
      const linkLabels = { linkedRegionId:'Region', linkedSettlementId:'Settlement', linkedLocationId:'Location', linkedDungeonId:'Dungeon', linkedPoiId:'POI', linkedEncounterId:'Encounter', linkedSessionId:'Session' };
      const mapLinks = mapRecord.tileLayout || mapRecord;
      const linkedParts = linkKeys.map(k => {
        const id = mapLinks[k] || mapRecord[k];
        if (!id) return null;
        const entityKey = k.replace('linked','').replace('Id','').toLowerCase() + 's';
        const ent = safeArr(plugin.state.entities[entityKey]).find(e => e.id === id);
        return `${linkLabels[k]}: ${ent ? (ent.name||id) : id}`;
      }).filter(Boolean);
      if (linkedParts.length) {
        const lrow = ce(meta, 'div', 'te-card-meta-row');
        ce(lrow, 'span', 'te-card-meta-label', 'links');
        ce(lrow, 'span', 'te-muted-text', linkedParts.join(' · '));
      }
      const acts = ce(c, 'div', 'te-card-actions');
      btn(acts, '📂 Open & Edit', 'te-btn is-primary is-sm', async () => {
        if (mapRecord.tileLayout) {
          Object.assign(plugin.state.tileMap, mapRecord.tileLayout);
          plugin.state.tileMap.mapId = mapRecord.id;
        }
        new Notice(`Map "${mapRecord.name}" loaded into builder.`);
        await saveStatePreserveScroll(plugin);
      });
      btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => {
        removeItem(plugin.state, 'maps', mapRecord.id);
        new Notice('Map deleted.');
        await saveStatePreserveScroll(plugin);
      });
    });
  }
}

function renderGeography(main, plugin, tabs) {
  pageHead(main, plugin, 'Geography & Maps', 'Regions, settlements, dungeons, locations, and points of interest.', [
    { label: '+ Region', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'regions', null, regionFields).open() },
    { label: '+ Domain', onClick: () => new GenericModal(plugin.app, plugin, 'domains', null, domainFields).open() },
    { label: '+ Settlement', onClick: () => new GenericModal(plugin.app, plugin, 'settlements', null, settlementFields).open() },
    { label: '+ Dungeon', onClick: () => new DungeonModal(plugin.app, plugin).open() },
    { label: '+ Location', onClick: () => new GenericModal(plugin.app, plugin, 'locations', null, locationFields).open() },
    { label: '+ District', onClick: () => new GenericModal(plugin.app, plugin, 'districts', null, districtFields).open() },
    { label: '+ Room', onClick: () => new GenericModal(plugin.app, plugin, 'rooms', null, roomFields).open() },
    { label: '+ POI', onClick: () => new GenericModal(plugin.app, plugin, 'pois', null, poiFields).open() },
    { label: '+ Route', onClick: () => new GenericModal(plugin.app, plugin, 'routes', null, routeFields).open() },
  ], tabs);

  sectionHead(main, 'Regions');
  itemCards(main, plugin, 'regions', { meta: ['terrain', 'climate', 'population'] });
  sectionHead(main, 'Domains');
  itemCards(main, plugin, 'domains', { meta: ['domainType', 'controllerId', 'claimedRegionIds', 'settlementIds'] });
  sectionHead(main, 'Settlements');
  itemCards(main, plugin, 'settlements', { meta: ['type', 'population', 'regionId', 'notableNpcIds', 'districtIds'] });
  sectionHead(main, 'Dungeons & Keyed Locations');
  itemCards(main, plugin, 'dungeons', { meta: ['type', 'threatLevel', 'bossCreatureId', 'bossNpcId', 'linkedRoomIds'] });
  sectionHead(main, 'Districts');
  itemCards(main, plugin, 'districts', { meta: ['type', 'settlementId', 'atmosphere'] });
  sectionHead(main, 'Locations');
  itemCards(main, plugin, 'locations', { meta: ['type', 'regionId', 'settlementId', 'parentRefId', 'lootIds'] });
  sectionHead(main, 'Rooms');
  itemCards(main, plugin, 'rooms', { meta: ['type', 'locationId'] });
  sectionHead(main, 'Points of Interest');
  itemCards(main, plugin, 'pois', { meta: ['type', 'regionId', 'settlementId', 'locationId'] });
  sectionHead(main, 'Routes');
  itemCards(main, plugin, 'routes', { meta: ['fromRefId', 'toRefId', 'travelTime'] });
}

const regionFields = [
  { key: 'name', label: 'Region Name', type: 'text' },
  { key: 'terrain', label: 'Terrain', type: 'select', options: ['Plains','Forest','Mountains','Desert','Coast','Arctic','Swamp','Jungle','Hills','Volcanic','Underground','Other'] },
  { key: 'climate', label: 'Climate', type: 'chip', opts: { bank: 'climateTypes' } },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'resources', label: 'Resources', type: 'chip', opts: { bank: 'regionalResources' } },
  { key: 'hazards', label: 'Hazards', type: 'chip', opts: { bank: 'worldHazards' } },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const settlementFields = [
  { key: 'name', label: 'Settlement Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Thorp','Hamlet','Village','Town','City','Metropolis','Fortress','Port','Outpost','Other'] },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'regionId', label: 'Region', type: 'entityRef', entityType: 'regions' },
  { key: 'region', label: 'Region (legacy text)', type: 'text', legacy: true },
  { key: 'government', label: 'Government', type: 'chip', opts: { bank: 'governmentTypes' } },
  { key: 'notableNpcIds', label: 'Notable NPCs', type: 'entityMultiRef', entityType: 'npcs' },
  { key: 'notableNPCs', label: 'Notable NPCs (legacy text)', type: 'chip', legacy: true },
  { key: 'districtIds', label: 'Districts', type: 'entityMultiRef', entityType: 'districts' },
  { key: 'districts', label: 'Districts (legacy text)', type: 'chip', legacy: true },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const locationFields = [
  { key: 'name', label: 'Location Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Dungeon','Ruin','Cave','Wilderness','Building','Landmark','Lair','Shrine','Tower','Other'] },
  { key: 'regionId', label: 'Parent Region', type: 'entityRef', entityType: 'regions' },
  { key: 'settlementId', label: 'Parent Settlement', type: 'entityRef', entityType: 'settlements' },
  { type: 'typedEntityRef', label: 'Parent Location', typeKey: 'parentRefType', idKey: 'parentRefId', entityTypes: LOCATION_LIKE_ENTITY_TYPES },
  { key: 'parent', label: 'Parent (legacy text)', type: 'text', legacy: true },
  { key: 'hazards', label: 'Hazards', type: 'chip', opts: { bank: 'worldHazards' } },
  { key: 'lootIds', label: 'Loot', type: 'entityMultiRef', entityType: 'loot' },
  { key: 'loot', label: 'Loot (legacy text)', type: 'chip', legacy: true },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const poiFields = [
  { key: 'name', label: 'POI Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Landmark','Shrine','Ruin','Camp','Cave','Crossing','Waypoint','Hidden','Other'] },
  { key: 'regionId', label: 'Region', type: 'entityRef', entityType: 'regions' },
  { key: 'settlementId', label: 'Settlement', type: 'entityRef', entityType: 'settlements' },
  { key: 'locationId', label: 'Location', type: 'entityRef', entityType: 'locations' },
  { key: 'location', label: 'Location (legacy text)', type: 'text', legacy: true },
  { key: 'summary', label: 'Description / Notes', type: 'textarea' },
];
const ROUTE_ENDPOINT_TYPES = [
  { key: 'regions', label: 'Region' },
  { key: 'settlements', label: 'Settlement' },
  { key: 'locations', label: 'Location' },
  { key: 'pois', label: 'POI' },
  { key: 'dungeons', label: 'Dungeon' },
];
const routeFields = [
  { key: 'name', label: 'Route Name', type: 'text' },
  { type: 'typedEntityRef', label: 'From (linked)', typeKey: 'fromRefType', idKey: 'fromRefId', entityTypes: ROUTE_ENDPOINT_TYPES },
  { key: 'from', label: 'From (legacy text)', type: 'text', legacy: true },
  { type: 'typedEntityRef', label: 'To (linked)', typeKey: 'toRefType', idKey: 'toRefId', entityTypes: ROUTE_ENDPOINT_TYPES },
  { key: 'to', label: 'To (legacy text)', type: 'text', legacy: true },
  { key: 'travelTime', label: 'Travel Time', type: 'text' },
  { key: 'terrain', label: 'Terrain', type: 'chip', opts: { bank: 'terrainTypes' } },
  { key: 'conditions', label: 'Travel Conditions', type: 'chip', opts: { bank: 'travelConditions' } },
  { key: 'hazards', label: 'Hazards', type: 'chip', opts: { bank: 'worldHazards' } },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const DOMAIN_TYPES = ['Political','Noble Holding','Divine','Fey Domain / Domain of Delight','Dread Domain','Magical Region','Monster Lair','Faction Territory','Planar Domain','Custom'];
const domainFields = [
  { key: 'name', label: 'Domain Name', type: 'text' },
  { key: 'domainType', label: 'Domain Type', type: 'select', options: DOMAIN_TYPES },
  {
    type: 'typedEntityRef',
    label: 'Controller',
    typeKey: 'controllerType',
    idKey: 'controllerId',
    entityTypes: [
      { key: 'factions', label: 'Faction' },
      { key: 'nations', label: 'Nation' },
      { key: 'religions', label: 'Religion' },
      { key: 'deities', label: 'Deity' },
      { key: 'settlements', label: 'Settlement' },
      { key: 'regions', label: 'Region' },
      { key: 'npcs', label: 'NPC' },
      { key: 'characters', label: 'PC / Character' },
    ],
  },
  { key: 'parentRef', label: 'Parent Domain', type: 'entityRef', entityType: 'domains' },
  { key: 'claimedRegionIds', label: 'Claimed Regions', type: 'entityMultiRef', entityType: 'regions' },
  { key: 'settlementIds', label: 'Settlements', type: 'entityMultiRef', entityType: 'settlements' },
  { key: 'locationIds', label: 'Locations', type: 'entityMultiRef', entityType: 'locations' },
  { key: 'factionIds', label: 'Factions', type: 'entityMultiRef', entityType: 'factions' },
  { key: 'laws', label: 'Laws', type: 'chip', opts: { suggestions: ['Courtly Etiquette','Blood Oath','No Iron','Tithe to the Crown','Hospitality Law','Custom'] } },
  { key: 'resources', label: 'Resources', type: 'chip', opts: { suggestions: ['Farmland','Leyline','Trade Hub','Fey Fruit','Ancient Ruins','Custom'] } },
  { key: 'threats', label: 'Threats', type: 'chip', opts: { suggestions: ['Rebellion','Blight','Bandits','Curse','Planar Breach','Custom'] } },
  // Domain of Delight / Fey Domain fields (shown for all domains; relevant when domainType = Fey Domain / Domain of Delight)
  { key: 'archfeyRulerId', label: 'Archfey Ruler', type: 'entityRef', entityType: 'deities', hint: 'Fey Domain / Domain of Delight' },
  { key: 'archfeyRuler', label: 'Archfey Ruler (legacy text)', type: 'text', hint: 'Fey Domain / Domain of Delight', legacy: true },
  { key: 'delightTheme', label: 'Theme / Emotional Logic', type: 'chip', opts: { suggestions: ['Vanity','Revelry','Grief','Conquest','Melancholy','Delight','Custom'] } },
  { key: 'entranceRules', label: 'Entrance / Exit Rules', type: 'chip', opts: { suggestions: ['Only at twilight','Speak your true name','Offer a gift','Pass through a mirror','Custom'] } },
  { key: 'feyBargains', label: 'Fey Bargains / Geas', type: 'chip', opts: { suggestions: ['Never lie','Pay in memories','Gift for passage','One favor owed','Custom'] } },
  { key: 'timeDistortion', label: 'Time Distortion', type: 'chip', opts: { suggestions: ['1 day = 1 week outside','Time stands still','A season passes overnight','Custom'] } },
  { key: 'planarTraits', label: 'Planar Traits', type: 'chip', opts: { suggestions: ['Living Forest','Mutable Gravity','Perpetual Twilight','Emotion Shapes Reality','Custom'] } },
  { key: 'delightDreadTone', label: 'Tone', type: 'select', options: ['Delight','Dread','Ambiguous','Shifting'] },
  // Shared
  { key: 'summary', label: 'Summary', type: 'textarea' },
  { key: 'campaignId', label: 'Campaign', type: 'campaign' },
  { key: 'visibility', label: 'Visibility', type: 'select', options: ['dm-only','player-visible','secret'] },
];

// ── TILE MAP BUILDER ──────────────────────────────────────────────────────────

// Render all placed tiles onto an offscreen canvas and return a PNG Blob.
async function exportMapToPng(tmState, tileAssets) {
  const W    = tmState.width    || 1800;
  const H    = tmState.height   || 1200;
  const GRID = tmState.gridSize || 60;

  const offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  const ctx = offscreen.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += GRID) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }

  // Pre-load all image assets in parallel
  const imgCache = {};
  const sorted = [...tmState.tiles].sort((a, b) => (a.layer || 0) - (b.layer || 0));
  await Promise.all(
    sorted
      .map(tile => tileAssets.find(a => a.id === (tile.assetId || tile.type)))
      .filter(asset => asset?.src && !imgCache[asset.src])
      .map(asset => new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { imgCache[asset.src] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = asset.src;
      }))
  );

  // Draw each tile
  for (const tile of sorted) {
    const asset = tileAssets.find(a => a.id === (tile.assetId || tile.type));
    const tw  = tile.w || GRID;
    const th  = tile.h || GRID;
    const rad = ((tile.rotation || 0) * Math.PI) / 180;
    ctx.save();
    ctx.translate(tile.x + tw / 2, tile.y + th / 2);
    if (rad) ctx.rotate(rad);
    if (asset?.src && imgCache[asset.src]) {
      ctx.drawImage(imgCache[asset.src], -tw / 2, -th / 2, tw, th);
    } else {
      const icon = asset?.icon || tile.icon || '🧱';
      ctx.font = `${Math.min(tw, th) * 0.6}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#333333';
      ctx.fillText(icon, 0, 0);
    }
    ctx.restore();
  }

  return new Promise((resolve, reject) =>
    offscreen.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')), 'image/png')
  );
}
function renderTileMapBuilder(parent, plugin) {
  const tmState = plugin.state.tileMap;
  let GRID = tmState.gridSize || 60;
  const wrap = ce(parent, 'div', 'te-map-builder');
  let tileAssets = fallbackEmojiTileAssets();
  let selectedTileType = null;
  let selectedTileId = null;
  let dragging = null;
  let resizing = null;
  let selectedCategory = 'All';

  // ── Toolbar row 1: name + actions ─────────────────────────────────────────
  const toolbar = ce(wrap, 'div', 'te-map-toolbar');

  const mapNameInp = ce(toolbar, 'input');
  mapNameInp.type = 'text'; mapNameInp.value = tmState.mapName || 'Untitled Map';
  mapNameInp.placeholder = 'Map name…';
  mapNameInp.addEventListener('input', () => { tmState.mapName = mapNameInp.value; });

  const assetCountLabel = ce(toolbar, 'span', 'te-map-asset-count', '…');

  btn(toolbar, '💾 Save Map', 'te-btn is-primary', async () => {
    tmState.mapName = mapNameInp.value;
    const camp = activeCampaign(plugin.state);
    const missingCount = tmState.tiles.filter(t => {
      const a = tileAssets.find(x => x.id === (t.assetId || t.type));
      return (t.assetPath || t.assetId) && !a;
    }).length;
    const linked = [
      tmState.linkedRegionId && `Region: ${tmState.linkedRegionId}`,
      tmState.linkedSettlementId && `Settlement: ${tmState.linkedSettlementId}`,
      tmState.linkedLocationId && `Location: ${tmState.linkedLocationId}`,
      tmState.linkedDungeonId && `Dungeon: ${tmState.linkedDungeonId}`,
      tmState.linkedPoiId && `POI: ${tmState.linkedPoiId}`,
      tmState.linkedEncounterId && `Encounter: ${tmState.linkedEncounterId}`,
      tmState.linkedSessionId && `Session: ${tmState.linkedSessionId}`,
    ].filter(Boolean);
    const mapRecord = {
      id: tmState.mapId || uid('map'),
      name: tmState.mapName,
      type: 'Tile Map',
      summary: `${tmState.tiles.length} tiles`,
      tileMap: true,
      tileLayout: JSON.parse(JSON.stringify(tmState)),
      assetRoot: TILE_ASSET_ROOT,
      gridSize: tmState.gridSize || 60,
      distanceScale: tmState.distanceScale || '5 ft',
      width: tmState.width || 1800,
      height: tmState.height || 1200,
      campaignId: plugin.state.activeCampaignId || '',
      linkedRegionId: tmState.linkedRegionId || '',
      linkedSettlementId: tmState.linkedSettlementId || '',
      linkedLocationId: tmState.linkedLocationId || '',
      linkedDungeonId: tmState.linkedDungeonId || '',
      linkedPoiId: tmState.linkedPoiId || '',
      linkedEncounterId: tmState.linkedEncounterId || '',
      linkedSessionId: tmState.linkedSessionId || '',
      updatedAt: new Date().toISOString(),
    };
    if (!tmState.mapId) tmState.mapId = mapRecord.id;
    upsert(plugin.state, 'maps', mapRecord);
    await saveStatePreserveScroll(plugin);
    const folder = campaignFolder(plugin);
    // Export PNG
    try {
      const pngPath = normalizePath(`${folder}/World Atlas/Maps/${slugify(tmState.mapName)}.png`);
      const pngDir = pngPath.replace(/\/[^/]+$/, '');
      await ensureFolder(plugin.app, pngDir);
      const blob = await exportMapToPng(tmState, tileAssets);
      const buf  = await blob.arrayBuffer();
      const existing = plugin.app.vault.getAbstractFileByPath(pngPath);
      if (existing) await plugin.app.vault.modifyBinary(existing, buf);
      else          await plugin.app.vault.createBinary(pngPath, buf);
      new Notice(`Map "${tmState.mapName}" saved as PNG (${tmState.tiles.length} tiles) → ${pngPath}`);
    } catch (pngErr) {
      new Notice(`PNG export failed: ${pngErr.message}`, 8000);
    }
  });

  btn(toolbar, '🔄 Reload Assets', 'te-btn', async () => {
    assetCountLabel.textContent = '⟳ Scanning…';
    tileAssets = await loadTileAssets(plugin);
    assetCountLabel.textContent = `${tileAssets.length} asset${tileAssets.length !== 1 ? 's' : ''}`;
    renderCategoryFilter();
    renderPalette();
    renderCanvas();
    new Notice(`${tileAssets.length} tile asset${tileAssets.length !== 1 ? 's' : ''} loaded.`);
  });

  btn(toolbar, '🗑️ Clear Map', 'te-btn is-danger', async () => {
    if (confirm('Clear all tiles from the map?')) {
      tmState.tiles = []; selectedTileId = null;
      await saveStateQuiet(plugin); renderCanvas(); renderInspector();
    }
  });

  btn(toolbar, '+ New Map', 'te-btn', async () => {
    tmState.tiles = []; tmState.mapName = 'Untitled Map'; tmState.mapId = '';
    tmState.nextId = 1; tmState.linkedRegionId = ''; tmState.linkedSettlementId = '';
    tmState.linkedLocationId = ''; tmState.linkedDungeonId = '';
    selectedTileId = null; selectedTileType = null;
    mapNameInp.value = tmState.mapName;
    renderLinksRow();
    await saveStateQuiet(plugin); renderCanvas(); renderInspector();
    new Notice('New blank map started.');
  });

  // ── Toolbar row 2: grid / canvas / scale controls ─────────────────────────
  const metaRow = ce(wrap, 'div', 'te-map-meta-row');

  // Grid size
  const gridLabel = ce(metaRow, 'span', 'te-map-meta-label', 'Grid:');
  gridLabel.style.cssText = 'font-size:.8rem;color:var(--te-muted);white-space:nowrap';
  const gridSel = ce(metaRow, 'select', 'te-map-meta-select');
  [30, 40, 50, 60, 80, 100].forEach(v => {
    const o = ce(gridSel, 'option', '', `${v}px`); o.value = v;
    if (v === (tmState.gridSize || 60)) o.selected = true;
  });
  gridSel.addEventListener('change', async () => {
    GRID = parseInt(gridSel.value, 10);
    tmState.gridSize = GRID;
    canvas.style.backgroundSize = `${GRID}px ${GRID}px`;
    await saveStateQuiet(plugin); renderCanvas();
  });

  // Canvas size presets
  const sizeLabel = ce(metaRow, 'span', 'te-map-meta-label', 'Canvas:');
  sizeLabel.style.cssText = 'font-size:.8rem;color:var(--te-muted);white-space:nowrap;margin-left:8px';
  const sizeSel = ce(metaRow, 'select', 'te-map-meta-select');
  const CANVAS_PRESETS = [
    { label: 'Small Battlemap',  w: 1200, h: 900 },
    { label: 'Standard Map',     w: 1800, h: 1200 },
    { label: 'Large Dungeon',    w: 2400, h: 1800 },
    { label: 'Region Map',       w: 3000, h: 2000 },
    { label: 'Custom…',          w: 0,    h: 0 },
  ];
  CANVAS_PRESETS.forEach(p => {
    const o = ce(sizeSel, 'option', '', p.label); o.value = p.label;
    if (p.w === (tmState.width || 1800) && p.h === (tmState.height || 1200)) o.selected = true;
  });
  const customWInp = ce(metaRow, 'input', 'te-map-meta-input');
  customWInp.type = 'number'; customWInp.min = 600; customWInp.value = tmState.width || 1800;
  customWInp.style.cssText = 'width:70px;display:none';
  customWInp.title = 'Canvas width (px)';
  const customHInp = ce(metaRow, 'input', 'te-map-meta-input');
  customHInp.type = 'number'; customHInp.min = 400; customHInp.value = tmState.height || 1200;
  customHInp.style.cssText = 'width:70px;display:none';
  customHInp.title = 'Canvas height (px)';
  const applyCanvasSize = async (w, h) => {
    tmState.width = w; tmState.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    await saveStateQuiet(plugin);
  };
  sizeSel.addEventListener('change', async () => {
    const preset = CANVAS_PRESETS.find(p => p.label === sizeSel.value);
    if (preset && preset.w) {
      customWInp.style.display = 'none'; customHInp.style.display = 'none';
      await applyCanvasSize(preset.w, preset.h);
    } else {
      customWInp.style.display = ''; customHInp.style.display = '';
    }
  });
  customWInp.addEventListener('change', () => applyCanvasSize(Math.max(600, parseInt(customWInp.value, 10) || 1800), tmState.height));
  customHInp.addEventListener('change', () => applyCanvasSize(tmState.width, Math.max(400, parseInt(customHInp.value, 10) || 1200)));

  // Distance scale
  const scaleLabel = ce(metaRow, 'span', 'te-map-meta-label', '1 sq =');
  scaleLabel.style.cssText = 'font-size:.8rem;color:var(--te-muted);white-space:nowrap;margin-left:8px';
  const scaleInp = ce(metaRow, 'input', 'te-map-meta-input');
  scaleInp.type = 'text'; scaleInp.value = tmState.distanceScale || '5 ft';
  scaleInp.placeholder = '5 ft'; scaleInp.style.cssText = 'width:70px';
  scaleInp.addEventListener('input', async () => { tmState.distanceScale = scaleInp.value; await saveStateQuiet(plugin); });

  // ── Inspector ─────────────────────────────────────────────────────────────
  const inspector = ce(toolbar, 'div', 'te-map-inspector');
  const renderInspector = () => {
    clear(inspector);
    if (!selectedTileId) { ce(inspector, 'span', 'te-map-inspector-label', 'No tile selected'); return; }
    const tile = tmState.tiles.find(t => t.id === selectedTileId);
    if (!tile) return;
    ce(inspector, 'span', 'te-map-inspector-label', tile.assetLabel || tile.type || 'Tile');

    // W/H cell controls
    const addCellControl = (axis, getV, setV) => {
      ce(inspector, 'span', 'te-map-inspector-stat', `${axis}:${getV()}`);
      btn(inspector, '−', 'te-btn is-sm', async () => { setV(Math.max(1, getV() - 1)); await saveStateQuiet(plugin); renderCanvas(); renderInspector(); });
      btn(inspector, '+', 'te-btn is-sm', async () => { setV(getV() + 1); await saveStateQuiet(plugin); renderCanvas(); renderInspector(); });
    };
    addCellControl('W',
      () => tile.widthCells  || 1,
      v  => { tile.widthCells  = v; tile.w = v * GRID; }
    );
    addCellControl('H',
      () => tile.heightCells || 1,
      v  => { tile.heightCells = v; tile.h = v * GRID; }
    );

    // Layer controls
    const maxLayer = tmState.tiles.length > 0 ? Math.max(...tmState.tiles.map(t => t.layer || 0)) : 0;
    const minLayer = tmState.tiles.length > 0 ? Math.min(...tmState.tiles.map(t => t.layer || 0)) : 0;
    btn(inspector, '↑', 'te-btn is-sm', async () => {
      tile.layer = (tile.layer || 0) + 1;
      await saveStateQuiet(plugin); renderCanvas();
    });
    btn(inspector, '↓', 'te-btn is-sm', async () => {
      tile.layer = Math.max(0, (tile.layer || 0) - 1);
      await saveStateQuiet(plugin); renderCanvas();
    });
    btn(inspector, '⏫', 'te-btn is-sm', async () => {
      tile.layer = maxLayer + 1;
      await saveStateQuiet(plugin); renderCanvas();
    });
    btn(inspector, '⏬', 'te-btn is-sm', async () => {
      tile.layer = minLayer > 0 ? minLayer - 1 : 0;
      tmState.tiles.forEach(t => { if (t !== tile) t.layer = Math.max(tile.layer + 1, (t.layer || 0) + 1); });
      await saveStateQuiet(plugin); renderCanvas();
    });

    // Rotation controls
    btn(inspector, '↻90°', 'te-btn is-sm', async () => {
      tile.rotation = ((tile.rotation || 0) + 90) % 360;
      await saveStateQuiet(plugin); renderCanvas();
    });
    btn(inspector, '↺90°', 'te-btn is-sm', async () => {
      tile.rotation = ((tile.rotation || 0) + 270) % 360;
      await saveStateQuiet(plugin); renderCanvas();
    });
    btn(inspector, '⟳0°', 'te-btn is-sm', async () => {
      tile.rotation = 0;
      await saveStateQuiet(plugin); renderCanvas();
    });

    const asset = tileAssets.find(a => a.id === (tile.assetId || tile.type));
    if (asset) {
      btn(inspector, '⟳ Size', 'te-btn is-sm', async () => {
        tile.widthCells = asset.widthCells || 1; tile.heightCells = asset.heightCells || 1;
        tile.w = tile.widthCells * GRID; tile.h = tile.heightCells * GRID;
        await saveStateQuiet(plugin); renderCanvas(); renderInspector();
      });
    }

    btn(inspector, '× Del', 'te-btn is-sm is-danger', async () => {
      tmState.tiles = tmState.tiles.filter(t => t.id !== selectedTileId);
      selectedTileId = null;
      await saveStateQuiet(plugin); renderCanvas(); renderInspector();
    });
  };
  renderInspector();

  // ── Geography links row ───────────────────────────────────────────────────
  const linksRow = ce(wrap, 'div', 'te-map-links-row');
  const renderLinksRow = () => {
    clear(linksRow);
    const addLink = (label, field, entityKey) => {
      const items = safeArr(plugin.state.entities[entityKey]);
      if (!items.length) return;
      const lbl = ce(linksRow, 'span', 'te-map-meta-label', label + ':');
      lbl.style.cssText = 'font-size:.78rem;color:var(--te-muted);white-space:nowrap';
      const sel = ce(linksRow, 'select', 'te-map-meta-select');
      sel.style.maxWidth = '130px';
      const none = ce(sel, 'option', '', '— none —'); none.value = '';
      items.forEach(item => {
        const o = ce(sel, 'option', '', (item.name || item.id).slice(0, 24));
        o.value = item.id;
        if (tmState[field] === item.id) o.selected = true;
      });
      sel.addEventListener('change', async () => { tmState[field] = sel.value; await saveStateQuiet(plugin); });
    };
    addLink('Region',     'linkedRegionId',     'regions');
    addLink('Settlement', 'linkedSettlementId', 'settlements');
    addLink('Location',   'linkedLocationId',   'locations');
    addLink('Dungeon',    'linkedDungeonId',    'dungeons');
    addLink('POI',        'linkedPoiId',        'pois');
    addLink('Encounter',  'linkedEncounterId',  'encounters');
    addLink('Session',    'linkedSessionId',    'sessions');
  };
  renderLinksRow();

  // ── Workspace ─────────────────────────────────────────────────────────────
  const workspace = ce(wrap, 'div', 'te-map-workspace');

  // ── Palette ───────────────────────────────────────────────────────────────
  const palette = ce(workspace, 'div', 'te-map-palette');
  const palControls = ce(palette, 'div', 'te-palette-controls');
  const palSearch = ce(palControls, 'input', 'te-map-palette-search');
  palSearch.type = 'text'; palSearch.placeholder = '🔍 Search tiles…';
  const categorySelect = ce(palControls, 'select', 'te-map-category-filter');

  const renderCategoryFilter = () => {
    clear(categorySelect);
    const cats = ['All', ...new Set(tileAssets.map(a => a.category || 'Uncategorised').filter(Boolean))].sort();
    cats.forEach(c => { const o = ce(categorySelect, 'option', '', c); o.value = c; if (c === selectedCategory) o.selected = true; });
  };

  const palList = ce(palette, 'div', 'te-palette-list');
  const renderPalette = () => {
    clear(palList);
    const q = palSearch.value;
    const visible = tileAssets.filter(a => assetMatches(a, q, selectedCategory));
    if (!visible.length) {
      const empty = ce(palList, 'p', '');
      empty.style.cssText = 'padding:12px;font-size:.8rem;color:var(--te-muted);text-align:center;white-space:pre-line';
      empty.textContent = tileAssets.length === 0
        ? `No assets found.\nPlace images in:\n${TILE_ASSET_ROOT}`
        : 'No tiles match this filter.';
      return;
    }
    visible.forEach(asset => {
      const tileBtn = ce(palList, 'div', 'te-palette-tile' + (selectedTileType === asset.id ? ' is-selected' : ''));
      if (asset.src) {
        const img = ce(tileBtn, 'img', 'te-palette-thumb');
        img.src = asset.src; img.alt = asset.label; img.loading = 'lazy';
      } else {
        ce(tileBtn, 'span', 'te-palette-icon', asset.icon || '🧱');
      }
      const labelWrap = ce(tileBtn, 'div', 'te-palette-label-wrap');
      ce(labelWrap, 'span', 'te-palette-label', asset.label);
      ce(labelWrap, 'span', 'te-palette-meta', `${asset.category ? asset.category + ' ' : ''}${asset.widthCells || 1}×${asset.heightCells || 1}`);
      tileBtn.addEventListener('click', () => { selectedTileType = asset.id; renderPalette(); });
    });
  };

  palSearch.addEventListener('input', () => { renderPalette(); palSearch.focus(); });
  categorySelect.addEventListener('change', () => { selectedCategory = categorySelect.value; renderPalette(); });

  // ── Canvas ────────────────────────────────────────────────────────────────
  const canvasWrap = ce(workspace, 'div', 'te-map-canvas-wrap');
  const canvas = ce(canvasWrap, 'div', 'te-map-canvas');
  canvas.style.cssText = `width:${tmState.width || 1800}px;height:${tmState.height || 1200}px;background-size:${GRID}px ${GRID}px`;

  const renderCanvas = () => {
    clear(canvas);
    const sorted = [...tmState.tiles].sort((a, b) => (a.layer || 0) - (b.layer || 0));
    sorted.forEach(tile => {
      const asset = tileAssets.find(a => a.id === (tile.assetId || tile.type));
      const assetMissing = (tile.assetPath || tile.assetId) && !asset;
      const el = ce(canvas, 'div',
        'te-tile' +
        (tile.id === selectedTileId ? ' is-selected' : '') +
        (assetMissing ? ' is-missing-asset' : '')
      );
      const rot = tile.rotation || 0;
      el.style.cssText = `left:${tile.x}px;top:${tile.y}px;width:${tile.w || GRID}px;height:${tile.h || GRID}px;z-index:${(tile.layer || 0) + 1};${rot ? `transform:rotate(${rot}deg);` : ''}`;
      el.title = tile.assetLabel || asset?.label || tile.type || 'Tile';

      if (assetMissing) {
        el.textContent = '⚠️';
        el.title = `Missing asset: ${tile.assetPath || tile.assetId}`;
      } else if (asset?.src) {
        const img = ce(el, 'img', 'te-tile-img');
        img.src = asset.src; img.alt = asset.label || '';
      } else {
        el.textContent = asset?.icon || tile.icon || '🧱';
        el.style.fontSize = `${Math.min(tile.w || GRID, tile.h || GRID) * 0.55}px`;
      }

      // Delete button when selected
      if (tile.id === selectedTileId) {
        const del = ce(el, 'button', 'te-tile-delete', '×');
        del.title = 'Delete tile';
        del.addEventListener('click', async ev => {
          ev.stopPropagation();
          tmState.tiles = tmState.tiles.filter(t => t.id !== tile.id);
          selectedTileId = null;
          await saveStateQuiet(plugin); renderCanvas(); renderInspector();
        });
      }

      // Resize handle
      const handle = ce(el, 'div', 'te-tile-resize');
      handle.title = 'Resize';
      handle.addEventListener('mousedown', ev => {
        ev.stopPropagation();
        selectedTileId = tile.id;
        const startW = tile.w || GRID, startH = tile.h || GRID;
        const startX = ev.clientX, startY = ev.clientY;
        resizing = { tile, startW, startH, startX, startY };
      });

      // Select + drag
      el.addEventListener('mousedown', ev => {
        if (ev.target.classList.contains('te-tile-delete') || ev.target.classList.contains('te-tile-resize')) return;
        ev.stopPropagation();
        selectedTileId = tile.id;
        renderCanvas(); renderInspector();
        dragging = { tile, startX: ev.clientX - tile.x, startY: ev.clientY - tile.y };
      });
    });
  };

  // Place tile on click
  canvas.addEventListener('click', async ev => {
    if (dragging || resizing) return;
    if (!selectedTileType) { selectedTileId = null; renderCanvas(); renderInspector(); return; }
    const rect = canvas.getBoundingClientRect();
    const scrollLeft = canvasWrap.scrollLeft || 0;
    const scrollTop  = canvasWrap.scrollTop  || 0;
    const x = Math.floor((ev.clientX - rect.left + scrollLeft) / GRID) * GRID;
    const y = Math.floor((ev.clientY - rect.top  + scrollTop)  / GRID) * GRID;
    const asset = tileAssets.find(a => a.id === selectedTileType);
    const widthCells  = asset?.widthCells  || 1;
    const heightCells = asset?.heightCells || 1;
    const newTile = {
      id: tmState.nextId++,
      assetId:       asset?.id       || selectedTileType,
      assetPath:     asset?.path     || '',
      assetSrc:      asset?.src      || '',
      assetLabel:    asset?.label    || selectedTileType,
      assetCategory: asset?.category || '',
      kind:          asset?.kind     || 'tile',
      icon:          asset?.icon     || '',
      x, y,
      widthCells, heightCells,
      w: widthCells  * GRID,
      h: heightCells * GRID,
      layer:    tmState.tiles.length,
      rotation: 0,
      type:     asset?.id || selectedTileType,
    };
    tmState.tiles.push(newTile);
    selectedTileId = newTile.id;
    await saveStateQuiet(plugin); renderCanvas(); renderInspector();
  });

  // Mouse move / up for drag + resize
  const onMouseMove = ev => {
    if (dragging) {
      const { tile, startX, startY } = dragging;
      tile.x = Math.max(0, Math.floor((ev.clientX - startX) / GRID) * GRID);
      tile.y = Math.max(0, Math.floor((ev.clientY - startY) / GRID) * GRID);
      renderCanvas();
    }
    if (resizing) {
      const { tile, startW, startH, startX, startY } = resizing;
      const newW = Math.max(GRID, Math.round((startW + ev.clientX - startX) / GRID) * GRID);
      const newH = Math.max(GRID, Math.round((startH + ev.clientY - startY) / GRID) * GRID);
      tile.w = newW; tile.h = newH;
      tile.widthCells  = Math.max(1, Math.round(newW / GRID));
      tile.heightCells = Math.max(1, Math.round(newH / GRID));
      renderCanvas();
    }
  };
  const onMouseUp = async () => {
    if (dragging || resizing) {
      dragging = null; resizing = null;
      await saveStateQuiet(plugin); renderInspector();
    }
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  const onKeyDown = async ev => {
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    if (!selectedTileId) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    tmState.tiles = tmState.tiles.filter(t => t.id !== selectedTileId);
    selectedTileId = null;
    await saveStateQuiet(plugin); renderCanvas(); renderInspector();
  };
  document.addEventListener('keydown', onKeyDown);

  // Cleanup on DOM removal
  const observer = new MutationObserver(() => {
    if (!canvas.isConnected) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      observer.disconnect();
    }
  });
  observer.observe(canvas.parentElement || document.body, { childList: true });

  // Initial render with emoji fallback, then async scan real assets
  renderCategoryFilter();
  renderPalette();
  renderCanvas();
  loadTileAssets(plugin).then(assets => {
    tileAssets = assets;
    const isEmoji = assets.length === 0 || assets.every(a => !a.src);
    assetCountLabel.textContent = isEmoji ? '⚠ emoji-only' : `${assets.length} asset${assets.length !== 1 ? 's' : ''}`;
    if (isEmoji) {
      assetCountLabel.style.cssText = 'color:var(--te-warn,#e6a817);font-size:.8rem;padding:2px 6px;border-radius:4px;background:var(--te-warn-bg,rgba(230,168,23,0.12))';
      assetCountLabel.title = 'No image assets installed — using emoji placeholders. Add .png/.jpg/.webp files to assets/tile-map/ for real tiles.';
    }
    renderCategoryFilter();
    renderPalette();
    renderCanvas();
  }).catch(() => {
    assetCountLabel.textContent = '⚠ emoji-only';
    assetCountLabel.style.cssText = 'color:var(--te-warn,#e6a817);font-size:.8rem';
    renderCategoryFilter(); renderPalette();
  });
}


// ── NPCs & CREATURES ──────────────────────────────────────────────────────────
function renderNpcs(main, plugin, tabs) {
  pageHead(main, plugin, 'NPCs & Creatures', 'Full NPC builder, creature stat blocks, BBEG builder, and relationship tracker.', [
    { label: '+ NPC', primary: true, onClick: () => new NPCModal(plugin.app, plugin).open() },
    { label: '+ Creature', onClick: () => new CreatureModal(plugin.app, plugin).open() },
    { label: '+ BBEG', onClick: () => new BBEGModal(plugin.app, plugin).open() },
  ], tabs);

  sectionHead(main, 'NPCs');
  itemCards(main, plugin, 'npcs', { meta: ['raceId', 'race', 'role', 'status', 'factionIds', 'locationId', 'pronouns', 'occupation'] });
  sectionHead(main, 'Creatures');
  itemCards(main, plugin, 'creatures', {
    meta: ['creatureType', 'size', 'cr', 'alignment', 'ac', 'hp', 'factionIds'],
    onExtra: (acts, item) => btn(acts, 'Save as Homebrew', 'te-btn is-sm', async () => {
      const hb = promoteCreatureToHomebrew(plugin, item);
      await plugin.saveState();
      new Notice(`Homebrew "${hb.name}" saved.`);
    }),
  });
  sectionHead(main, 'BBEGs');
  itemCards(main, plugin, 'bbegs', { meta: ['title', 'status', 'lairLocationId', 'timerIds', 'linkedFactionIds'] });

  // Relationship Tracker
  sectionHead(main, 'Relationship Tracker');
  renderRelationshipTracker(main, plugin);
}

function getEntityDisplayName(state, entityType, entityId, fallback) {
  if (!entityId) return fallback || '?';
  const arr = safeArr(state.entities[entityType]);
  const entity = arr.find(e => e.id === entityId);
  if (entity) return entity.name || entity.title || entityId;
  return fallback || `[Missing ${entityType}: ${entityId}]`;
}

function renderRelationshipTracker(parent, plugin) {
  const wrap = ce(parent, 'div', 'te-card');
  wrap.style.marginBottom = '16px';
  const hd = ce(wrap, 'div', 'te-card-head');
  ce(hd, 'span', 'te-card-icon', '🕸️');
  ce(hd, 'h3', 'te-card-title', 'NPC Relationships');
  btn(hd, '+ Add Relationship', 'te-btn is-sm is-primary', () => new RelationshipModal(plugin.app, plugin).open());

  const camp = activeCampaign(plugin.state);
  const allRels = safeArr(plugin.state.relationships);
  const rels = camp ? allRels.filter(r => !r.campaignId || r.campaignId === camp.id) : allRels;
  if (!rels.length) { ce(wrap, 'p', 'te-card-body', 'No relationships tracked yet. Use the button above to add NPC-to-NPC or NPC-to-PC relationships.'); return; }

  const grid = ce(wrap, 'div', 'te-grid');
  grid.style.marginTop = '8px';
  rels.forEach(rel => {
    const c = ce(grid, 'div', 'te-card');
    c.style.padding = '10px';
    const head = ce(c, 'div', 'te-card-head');
    ce(head, 'span', 'te-card-icon', '🤝');
    const fromName = rel.fromId
      ? getEntityDisplayName(plugin.state, rel.fromEntityType || 'npcs', rel.fromId, rel.from)
      : (rel.from || '?');
    const toName = rel.toId
      ? getEntityDisplayName(plugin.state, rel.toEntityType || 'npcs', rel.toId, rel.to)
      : (rel.to || '?');
    ce(head, 'h3', 'te-card-title', `${fromName} → ${toName}`);
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
function renderFactions(main, plugin, tabs) {
  pageHead(main, plugin, 'Factions', 'Build factions, track relationships, and manage the political landscape.', [
    { label: '+ Faction', primary: true, onClick: () => new FactionModal(plugin.app, plugin).open() },
  ], tabs);
  sectionHead(main, 'Factions');

  // Noble House filter
  const filterBar = ce(main, 'div', 'te-field-row'); filterBar.style.marginBottom = '8px';
  const factionFilterSel = ce(filterBar, 'select', 'te-field-select');
  ['All Factions', 'Noble Houses'].forEach(opt => { const o = ce(factionFilterSel, 'option', '', opt); o.value = opt; });
  const NOBLE_HOUSE_TYPES = new Set(['Noble House', 'Noble Family']);
  const applyFactionFilter = () => {
    const val = factionFilterSel.value;
    const allFactions = safeArr(plugin.state.entities.factions);
    const filtered = val === 'Noble Houses'
      ? allFactions.filter(f => NOBLE_HOUSE_TYPES.has(f.type) || NOBLE_HOUSE_TYPES.has(f.factionSubtype))
      : allFactions;
    clear(cardsWrap);
    itemCards(cardsWrap, plugin, 'factions', { meta: ['type', 'ideology', 'territoryIds', 'reputation'], items: filtered });
  };
  factionFilterSel.addEventListener('change', applyFactionFilter);
  const cardsWrap = ce(main, 'div', '');
  itemCards(cardsWrap, plugin, 'factions', { meta: ['type', 'ideology', 'territoryIds', 'reputation'] });

  // ── Faction Standing (Reputation) ──────────────────────────────────────────
  const allReps = safeArr(plugin.state.entities.reputations);
  if (allReps.length) {
    sectionHead(main, 'Faction Standing');
    const repGrid = ce(main, 'div', 'te-grid');
    allReps.forEach(rep => {
      const fac = safeArr(plugin.state.entities.factions).find(f => f.id === rep.factionId);
      const c = ce(repGrid, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head');
      ce(h, 'span', 'te-card-icon', '⭐');
      ce(h, 'h3', 'te-card-title', fac ? fac.name : (rep.name || 'Unknown Faction'));
      const lvl = rep.level || 'Neutral';
      const lvlIdx = OPTION_BANKS.reputationLevels.indexOf(lvl);
      const lvlPct = Math.max(5, ((OPTION_BANKS.reputationLevels.length - 1 - lvlIdx) / (OPTION_BANKS.reputationLevels.length - 1)) * 100);
      const pb = ce(c, 'div', 'te-progress-bar'); const pf = ce(pb, 'div', 'te-progress-fill'); pf.style.width = lvlPct + '%';
      ce(c, 'p', 'te-progress-label', `Standing: ${lvl}`);
      if (rep.notes) ce(c, 'p', 'te-card-body', rep.notes.slice(0, 100));
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'reputations', rep, reputationFields).open());
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'reputations', rep.id); await plugin.saveState(); });
    });
  }
  btn(ce(main, 'div', 'te-modal-actions'), '+ Add Faction Standing', 'te-btn', () => {
    const factions = safeArr(plugin.state.entities.factions);
    const rep = { id: uid('rep'), name: 'Party Standing', factionId: factions[0]?.id || '', level: 'Neutral', notes: '', campaignId: plugin.state.activeCampaignId || '' };
    new GenericModal(plugin.app, plugin, 'reputations', rep, reputationFields).open();
  });

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
function renderAdventure(main, plugin, tabs) {
  pageHead(main, plugin, 'Adventures & Quests', 'Adventure arcs, quests, objectives, hooks, and campaign progression.', [
    { label: '+ Adventure', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'adventures', null, adventureFields).open() },
    { label: '+ Quest', onClick: () => new QuestModal(plugin.app, plugin).open() },
  ], tabs);
  sectionHead(main, 'Adventures');
  itemCards(main, plugin, 'adventures', { meta: ['arcType', 'status'] });

  // Quest Status Board
  sectionHead(main, 'Quest Board');
  const allQ = safeArr(plugin.state.entities.quests).filter(q => matchesSearch(q, plugin.state.search));
  const qActive    = allQ.filter(q => q.status === 'Active');
  const qCompleted = allQ.filter(q => q.status === 'Completed');
  const qOther     = allQ.filter(q => q.status !== 'Active' && q.status !== 'Completed');
  const sumRow = ce(main, 'div', ''); sumRow.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px';
  [['Active', qActive.length, 'var(--te-accent)'], ['Completed', qCompleted.length, 'var(--color-green,#22c55e)'], ['Other', qOther.length, 'var(--te-muted)']].forEach(([label, count, color]) => {
    const w = ce(sumRow, 'div', 'te-stat-card'); w.style.minWidth = '80px';
    const big = ce(w, 'div', 'te-stat-big', String(count)); big.style.color = color;
    ce(w, 'div', 'te-stat-label', label);
  });
  if (!allQ.length) { emptyState(main, 'No quests yet.', 'Use "+ Quest" above to create your first quest.'); }
  else {
    if (qActive.length) {
      const ah = ce(main, 'h3', 'te-quest-status-head'); ah.textContent = 'Active'; ah.style.color = 'var(--te-accent)';
      itemCards(main, plugin, 'quests', { meta: ['questType', 'giverNpcId', 'locationId', 'rewardLootIds'], hint: '', items: qActive });
    }
    if (qCompleted.length) {
      const ch = ce(main, 'h3', 'te-quest-status-head'); ch.textContent = 'Completed'; ch.style.color = 'var(--color-green,#22c55e)';
      itemCards(main, plugin, 'quests', { meta: ['questType', 'giverNpcId', 'rewardLootIds'], hint: '', items: qCompleted });
    }
    if (qOther.length) {
      const oh = ce(main, 'h3', 'te-quest-status-head'); oh.textContent = 'Other';
      itemCards(main, plugin, 'quests', { meta: ['questType', 'status', 'giverNpcId', 'rewardLootIds'], hint: '', items: qOther });
    }
  }
}

const actFields = [
  { key: 'name', label: 'Act Name', type: 'text' },
  { key: 'order', label: 'Act Number / Order', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: ['Draft','Active','Completed','Abandoned'] },
  { key: 'levelStart', label: 'Level Start', type: 'number' },
  { key: 'levelEnd', label: 'Level End', type: 'number' },
  { key: 'summary', label: 'Summary / Purpose', type: 'textarea' },
  { key: 'goal', label: 'Act Goal', type: 'textarea' },
  { key: 'turningPoint', label: 'Turning Point', type: 'textarea' },
];
const adventureFields = [
  { key: 'name', label: 'Adventure Name', type: 'text' },
  { key: 'actId', label: 'Parent Act', type: 'entityRef', entityType: 'acts' },
  { key: 'arcType', label: 'Arc Type', type: 'select', options: ['Main Story','Side Story','Character Arc','Faction Arc','Dungeon Delve','Investigation','Political','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Draft','Active','Completed','Abandoned'] },
  { key: 'premise', label: 'Premise', type: 'textarea' },
  { key: 'questIds', label: 'Quests / Scenes', type: 'entityMultiRef', entityType: 'quests' },
  { key: 'acts', label: 'Quests / Scenes (legacy text)', type: 'textarea', legacy: true },
  { key: 'linkedNpcIds', label: 'Linked NPCs', type: 'entityMultiRef', entityType: 'npcs' },
  { key: 'linkedNPCs', label: 'Linked NPCs (legacy chip)', type: 'chip', legacy: true },
  { key: 'secrets', label: 'Secrets (DM notes)', type: 'textarea' },
  { key: 'lootIds', label: 'Treasure / Loot', type: 'entityMultiRef', entityType: 'loot' },
  { key: 'treasure', label: 'Treasure Notes (legacy text)', type: 'textarea', legacy: true },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── ENCOUNTERS & COMBAT ───────────────────────────────────────────────────────
function renderEncounters(main, plugin, tabs) {
  pageHead(main, plugin, 'Encounters & Combat', 'Encounter builder, initiative tracker, and combat tools.', [
    { label: '+ Encounter', primary: true, onClick: () => new EncounterModal(plugin.app, plugin).open() },
    { label: '+ Loot', onClick: () => new GenericModal(plugin.app, plugin, 'loot', null, lootFields).open() },
  ], tabs);

  // Party XP Budget
  const partyChars = safeArr(plugin.state.entities.characters);
  if (partyChars.length) {
    sectionHead(main, 'Party XP Budget');
    const budCard = ce(main, 'div', 'te-card'); budCard.style.marginBottom = '16px';
    const budH = ce(budCard, 'div', 'te-card-head'); ce(budH, 'span', 'te-card-icon', '⚔️'); ce(budH, 'h3', 'te-card-title', `Party of ${partyChars.length}`);
    const totals = [0, 0, 0, 0];
    partyChars.forEach(ch => {
      const lvl = Math.max(1, Math.min(20, parseInt(ch.level) || 1));
      const thresh = ENCOUNTER_XP_THRESHOLDS[lvl];
      if (thresh) thresh.forEach((v, i) => totals[i] += v);
    });
    const budMeta = ce(budCard, 'div', 'te-card-meta');
    const lr = ce(budMeta, 'div', 'te-card-meta-row');
    ce(lr, 'span', 'te-card-meta-label', 'Characters');
    ce(lr, 'span', '', partyChars.map(ch => `${ch.name || 'Char'} Lvl ${ch.level || 1}`).join(' · '));
    [['Easy', totals[0]], ['Medium', totals[1]], ['Hard', totals[2]], ['Deadly', totals[3]]].forEach(([label, xp]) => {
      const r = ce(budMeta, 'div', 'te-card-meta-row');
      ce(r, 'span', 'te-card-meta-label', label);
      ce(r, 'span', '', `${xp.toLocaleString()} XP`);
    });
  }

  // Initiative Tracker (always visible)
  sectionHead(main, 'Initiative Tracker');
  renderInitiativeTracker(main, plugin);

  sectionHead(main, 'Encounters');
  itemCards(main, plugin, 'encounters', { meta: ['type', 'difficulty', 'locationId', 'linkedQuestId', 'linkedMapId', 'rewardLootIds'] });
  sectionHead(main, 'Loot');
  itemCards(main, plugin, 'loot', { meta: ['type', 'rarity', 'value', 'status', 'encounterId', 'claimedById', 'claimedByType'] });
}

function renderInitiativeTracker(parent, plugin) {
  const it = plugin.state.initiativeTracker;
  const wrap = ce(parent, 'div', 'te-init-track');

  const head = ce(wrap, 'div', 'te-init-head');
  const titleWrap = ce(head, 'div', '');
  ce(titleWrap, 'div', 'te-init-title', `⚔️ Combat Tracker`);
  ce(titleWrap, 'div', '', it.active ? `Round ${it.round}` : 'Combat not started');
  const headBtns = ce(head, 'div', 'te-card-actions');
  btn(headBtns, 'Add PC', 'te-btn is-sm', () => new AddCombatantModal(plugin.app, plugin, 'PC').open());
  btn(headBtns, 'Add NPC', 'te-btn is-sm', () => new AddCombatantModal(plugin.app, plugin, 'NPC').open());
  btn(headBtns, 'Add Monster', 'te-btn is-sm', () => new AddCombatantModal(plugin.app, plugin, 'Monster').open());
  btn(headBtns, '🎲 Roll All', 'te-btn is-sm is-primary', async () => {
    it.combatants.forEach(c => { if (!c.initLocked) c.initiative = rollDie(20) + (modifier(c.dex) || 0); });
    it.combatants.sort((a, b) => b.initiative - a.initiative);
    it.currentIndex = 0;
    if (!it.active) { it.active = true; it.round = 1; logSessionEvent(plugin, 'Combat Started', `${it.combatants.length} combatants`); }
    await saveStateQuiet(plugin);
    rebuildList();
  });
  if (it.active) {
    btn(headBtns, 'Next Turn ▶', 'te-btn is-sm', async () => {
      it.currentIndex = (it.currentIndex + 1) % Math.max(1, it.combatants.length);
      if (it.currentIndex === 0) it.round++;
      const cur = it.combatants[it.currentIndex];
      if (cur) logSessionEvent(plugin, 'Initiative Advanced', `Turn: ${cur.name}, Round ${it.round}`);
      await saveStateQuiet(plugin);
      rebuildList();
    });
    btn(headBtns, 'End Combat', 'te-btn is-sm is-danger', async () => {
      it.active = false; it.round = 1; it.currentIndex = 0;
      logSessionEvent(plugin, 'Combat Ended', `${it.combatants.length} combatants`);
      await saveStateQuiet(plugin);
      rebuildList();
    });
  } else {
    btn(headBtns, 'Start Combat', 'te-btn is-sm is-primary', async () => {
      it.active = true; it.round = 1; it.currentIndex = 0;
      logSessionEvent(plugin, 'Combat Started', `${it.combatants.length} combatants`);
      await saveStateQuiet(plugin);
      rebuildList();
    });
  }
  btn(headBtns, 'Reset', 'te-btn is-sm is-danger', async () => {
    if (confirm('Reset combat tracker?')) {
      it.combatants = []; it.currentIndex = 0; it.round = 1; it.active = false;
      await saveStateQuiet(plugin);
      rebuildList();
    }
  });

  const list = ce(wrap, 'div', 'te-combatant-list');
  const rebuildList = () => {
    clear(list);
    if (!it.combatants.length) {
      ce(list, 'p', 'te-card-body', 'No combatants. Add PCs, NPCs, or monsters above, then Roll All Initiative.');
      return;
    }
    it.combatants.forEach((comb, idx) => {
      const row = ce(list, 'div', 'te-combatant-row' + (idx === it.currentIndex && it.active ? ' is-current' : ''));
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--te-border)';
      ce(row, 'span', 'te-combatant-type', comb.type);
      ce(row, 'span', 'te-combatant-name', comb.name);
      ce(row, 'span', 'te-combatant-init', `Init: ${comb.initiative}`);
      // HP editing
      const hpWrap = ce(row, 'span', '');
      hpWrap.style.cssText = 'display:flex;gap:2px;align-items:center;font-size:.82rem';
      ce(hpWrap, 'span', 'te-card-meta-label', 'HP');
      const hpInp = ce(hpWrap, 'input');
      hpInp.type = 'number'; hpInp.value = String(comb.hp || 0);
      hpInp.style.cssText = 'width:44px;padding:2px 4px;font-size:.82rem;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);text-align:center';
      hpInp.addEventListener('change', async () => { comb.hp = parseInt(hpInp.value) || 0; await saveStateQuiet(plugin); });
      if (comb.maxHp) { ce(hpWrap, 'span', '', `/${comb.maxHp}`); }
      if (comb.tempHp) { ce(hpWrap, 'span', 'te-muted-text', `+${comb.tempHp}tmp`); }
      // Dmg/Heal inputs
      const adjWrap = ce(row, 'span', '');
      adjWrap.style.cssText = 'display:flex;gap:2px;align-items:center';
      const adjInp = ce(adjWrap, 'input');
      adjInp.type = 'number'; adjInp.min = '0'; adjInp.placeholder = '0';
      adjInp.style.cssText = 'width:38px;padding:2px 4px;font-size:.75rem;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);text-align:center';
      btn(adjWrap, 'Dmg', 'te-btn is-sm is-danger', async () => {
        const amt = Math.abs(parseInt(adjInp.value) || 0);
        if (!amt) return;
        comb.hp = Math.max(0, (comb.hp || 0) - amt);
        hpInp.value = String(comb.hp);
        adjInp.value = '';
        if (comb.hp === 0) { if (!safeArr(comb.conditions).includes('Dead')) { comb.conditions = [...safeArr(comb.conditions), 'Dead']; logSessionEvent(plugin, 'Combatant Defeated', comb.name); } }
        await saveStateQuiet(plugin);
        rebuildList();
      });
      btn(adjWrap, 'Heal', 'te-btn is-sm', async () => {
        const amt = Math.abs(parseInt(adjInp.value) || 0);
        if (!amt) return;
        comb.hp = comb.maxHp > 0 ? Math.min(comb.maxHp, (comb.hp || 0) + amt) : (comb.hp || 0) + amt;
        hpInp.value = String(comb.hp);
        adjInp.value = '';
        await saveStateQuiet(plugin);
        rebuildList();
      });
      // Conditions
      const condWrap = ce(row, 'div', '');
      condWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;align-items:center;width:100%;margin-top:2px';
      safeArr(comb.conditions).forEach(cond => {
        const chip = ce(condWrap, 'span', 'te-chip', cond);
        chip.style.fontSize = '.72rem';
        const xb = ce(chip, 'button', 'te-chip-x', '×');
        xb.addEventListener('click', async () => {
          comb.conditions = safeArr(comb.conditions).filter(c => c !== cond);
          logSessionEvent(plugin, 'Condition Removed', `${comb.name}: ${cond}`);
          await saveStateQuiet(plugin);
          rebuildList();
        });
      });
      // Add condition select
      const condSel = ce(condWrap, 'select');
      condSel.style.cssText = 'font-size:.72rem;padding:1px 3px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
      ['+ Condition','Blinded','Charmed','Deafened','Exhaustion','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious','Dead'].forEach(c => {
        const o = ce(condSel, 'option', '', c); o.value = c;
      });
      condSel.addEventListener('change', async () => {
        const cond = condSel.value;
        if (!cond || cond === '+ Condition') return;
        if (!safeArr(comb.conditions).includes(cond)) {
          comb.conditions = [...safeArr(comb.conditions), cond];
          if (cond === 'Dead') logSessionEvent(plugin, 'Combatant Defeated', comb.name);
          else logSessionEvent(plugin, 'Condition Applied', `${comb.name}: ${cond}`);
          await saveStateQuiet(plugin);
        }
        condSel.value = '+ Condition';
        rebuildList();
      });
      // Remove combatant
      const rb = btn(row, '✕', 'te-btn is-sm is-danger', async () => {
        logSessionEvent(plugin, 'Combatant Removed', comb.name);
        it.combatants.splice(idx, 1);
        if (it.currentIndex >= it.combatants.length) it.currentIndex = 0;
        await saveStateQuiet(plugin);
        rebuildList();
      });
      rb.style.marginLeft = 'auto';
    });
  };
  rebuildList();
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
function renderDowntime(main, plugin, tabs) {
  pageHead(main, plugin, 'Downtime & Bases', 'Downtime activities, crafting projects, and bastions / strongholds.', [
    { label: '+ Activity', primary: true, onClick: () => new DowntimeModal(plugin.app, plugin).open() },
    { label: '+ Project', onClick: () => new ProjectModal(plugin.app, plugin).open() },
    { label: '+ Bastion', onClick: () => new BastionModal(plugin.app, plugin).open() },
  ], tabs);
  sectionHead(main, 'Downtime Activities');
  itemCards(main, plugin, 'downtime', { items: safeArr(plugin.state.entities.downtime).filter(item => isInActiveCampaignScope(plugin.state, 'downtime', item)), meta: ['activityType', 'timeRequired', 'cost', 'assignedId', 'projectId', 'settlementId', 'locationId'], onEdit: (plugin, key, item) => new DowntimeModal(plugin.app, plugin, item).open() });
  sectionHead(main, 'Projects & Crafting');
  itemCards(main, plugin, 'projects', {
    items: safeArr(plugin.state.entities.projects).filter(item => isInActiveCampaignScope(plugin.state, 'projects', item)),
    meta: ['projectType', 'progress', 'assignedToType', 'assignedToId', 'assignedTo'],
    onEdit: (plugin, key, item) => new ProjectModal(plugin.app, plugin, item).open(),
  });
  sectionHead(main, 'Bastions & Strongholds');
  itemCards(main, plugin, 'bastions', { items: safeArr(plugin.state.entities.bastions).filter(item => isInActiveCampaignScope(plugin.state, 'bastions', item)), meta: ['locationType', 'locationId', 'linkedSettlementId', 'income', 'maintenanceCost'], onEdit: (plugin, key, item) => new BastionModal(plugin.app, plugin, item).open() });
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
function renderSessions(main, plugin, tabs) {
  const state = plugin.state;
  pageHead(main, plugin, 'Sessions & Timeline', 'Session logs and the campaign timeline.', [
    { label: '+ Session Log', primary: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
    { label: '▶ Run / Resume', run: true, onClick: () => new SessionModal(plugin.app, plugin).open() },
    { label: '+ Timeline Event', onClick: () => new GenericModal(plugin.app, plugin, 'timelines', null, timelineFields).open() },
    { label: '🗓️ Calendar', onClick: () => new CalendarModal(plugin.app, plugin).open() },
  ], tabs);

  // Calendar summary with +Day button
  const cal = state.calendar;
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
    const calActs = ce(calCard, 'div', 'te-card-actions');
    btn(calActs, '+ Day', 'te-btn is-sm is-primary', async () => {
      const day = parseInt(cal.day) || 1;
      cal.day = String(day + 1);
      const activeSess = safeArr(state.entities.sessions).find(s => s.id === state.activeSessionId);
      if (activeSess) logSessionEvent(plugin, 'In-Game Date Advanced', `Day advanced to ${cal.day} ${cal.month}, Year ${cal.year}`);
      await saveStateQuiet(plugin);
      new Notice(`Calendar: Day ${cal.day}`);
    });
    btn(calActs, '⚙️ Edit', 'te-btn is-sm', () => new CalendarModal(plugin.app, plugin).open());
  }

  sectionHead(main, 'Session Logs');
  itemCards(main, plugin, 'sessions', {
    meta: ['sessionNumber', 'realDate', 'gameDate'],
    onEdit: (plugin, key, item) => new SessionModal(plugin.app, plugin, item).open(),
  });
  sectionHead(main, 'Timeline Events');
  itemCards(main, plugin, 'timelines', { meta: ['date', 'era', 'type'] });
}

const milestoneFields = [
  { key: 'name', label: 'Milestone Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Level Up','Story Beat','Achievement','Quest Complete','Discovery','Relationship','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Pending','In Progress','Achieved','Skipped'] },
  { key: 'level', label: 'Level / Reward', type: 'text' },
  { key: 'achieved', label: 'Achieved Date', type: 'text' },
  { key: 'linkedSessionId', label: 'Linked Session', type: 'entityRef', entityType: 'sessions' },
  { key: 'actId', label: 'Linked Act', type: 'entityRef', entityType: 'acts' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── SECRETS & REVEALS ─────────────────────────────────────────────────────────
function renderSecrets(main, plugin) {
  pageHead(main, plugin, 'Secrets & Reveals', 'DM-only secrets, reveal tracking, and player-safe handouts.', [
    { label: '+ Secret', primary: true, onClick: () => new SecretModal(plugin.app, plugin).open() },
    { label: '+ Reveal', onClick: () => new GenericModal(plugin.app, plugin, 'reveals', null, revealFields).open() },
    { label: '+ Handout', onClick: () => new GenericModal(plugin.app, plugin, 'handouts', null, handoutFields).open() },
    { label: '📤 Export Player Packet', onClick: () => exportPlayerSafePacket(plugin) },
  ]);
  sectionHead(main, 'Secrets (DM Only)');
  itemCards(main, plugin, 'secrets', { meta: ['secretType', 'revealStatus', 'revealTrigger'] });
  sectionHead(main, 'Reveals');
  itemCards(main, plugin, 'reveals', { meta: ['status', 'sessionId', 'secretId'] });
  sectionHead(main, 'Handouts');
  itemCards(main, plugin, 'handouts', {
    meta: ['type', 'visibility', 'linkedSessionId'],
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
  { key: 'linkedSessionId', label: 'Linked Session', type: 'entityRef', entityType: 'sessions' },
  { key: 'linkedSession', label: 'Linked Session (legacy text)', type: 'text', legacy: true },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// ── COMPENDIUM & LIBRARY ──────────────────────────────────────────────────────

// Classify a stored item into a source bucket at read time (non-destructive).
// 5e reference items are never passed here — they live in refData, not entities.
function classifySourceBucket(item, entityKey) {
  if (entityKey === 'homebrew' || item.source === 'homebrew' || item.isHomebrew) return 'homebrew';
  if (item.source === 'imported' || item.importedAt || item.importSource) return 'imported';
  if (item.source === 'generated' || item.generatedAt || item.isGenerated) return 'generated';
  if (item.campaignId) return 'campaign';
  return 'saved';
}

// Stamp normalized storage metadata onto an item before save.
// Only fills in missing fields — does not overwrite existing values.
function normalizeStorageMetadata(item, overrides) {
  if (!item.source && overrides && overrides.source) item.source = overrides.source;
  if (!item.status) item.status = (overrides && overrides.status) || 'active';
  if (!item.visibility) item.visibility = (overrides && overrides.visibility) || 'dm-only';
  if (!item.campaignId && overrides && overrides.campaignId) item.campaignId = overrides.campaignId;
  if (!item.tags) item.tags = (overrides && overrides.tags) || [];
  return item;
}

const HOMEBREW_STATUS_OPTIONS = ['Draft', 'Approved', 'Retired', 'Needs Review'];
const HOMEBREW_VISIBILITY_OPTIONS = ['dm-only', 'player-visible', 'secret', 'revealed'];

function normalizeListField(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}
function homebrewStatusValue(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'Draft';
  if (raw === 'approved' || raw === 'final' || raw === 'playtested' || raw === 'active') return 'Approved';
  if (raw === 'retired' || raw === 'deprecated' || raw === 'archived') return 'Retired';
  if (raw === 'needs review' || raw === 'needs-review' || raw === 'pending review' || raw === 'pending-review') return 'Needs Review';
  if (raw === 'draft') return 'Draft';
  return status;
}
function homebrewCategoryForType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (!t) return 'Rules & Mechanics';
  if (['ancestry','race / ancestry','race','hybrid ancestry','class','subclass','background','feat','character option'].includes(t)) return 'Character Options';
  if (['rule','mechanic','optional rule','table','rollable table'].includes(t)) return 'Rules & Mechanics';
  if (['item','weapon','armour','armor','magic item','equipment'].includes(t)) return 'Items & Equipment';
  if (['monster','creature','npc template','statblock'].includes(t)) return 'Monsters & Statblocks';
  if (['deity','plane','world lore','realm','pantheon'].includes(t)) return 'Worlds & Planes';
  return 'Rules & Mechanics';
}
function summarizeMarkdownText(markdown) {
  return String(markdown || '')
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/[_`>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
function getHomebrewSummary(item) {
  return item.summary || item.description || item.payload?.summary || summarizeMarkdownText(item.content);
}
function inferHomebrewType(item) {
  if (item.homebrewType) return item.homebrewType;
  if (item.type) return item.type;
  if (item.category === 'Race / Ancestry' || item.sourceHybridId) return 'Hybrid Ancestry';
  if (item.payload?.kind) return item.payload.kind;
  return 'Other';
}
function normalizeHomebrewRecord(item, overrides) {
  const record = Object.assign({}, item || {});
  const now = new Date().toISOString();
  record.id = record.id || (overrides && overrides.id) || uid('homebrew');
  record.homebrewId = record.homebrewId || record.id;
  record.name = record.name || record.title || 'Untitled Homebrew';
  record.homebrewType = (overrides && overrides.homebrewType) || inferHomebrewType(record);
  record.type = (overrides && overrides.type) || record.type || record.homebrewType;
  record.category = record.category || homebrewCategoryForType(record.type);
  record.source = 'homebrew';
  record.status = homebrewStatusValue(record.status || (overrides && overrides.status));
  record.visibility = record.visibility || (record.playerVisible ? 'player-visible' : '') || (overrides && overrides.visibility) || 'dm-only';
  if (!HOMEBREW_VISIBILITY_OPTIONS.includes(record.visibility)) record.visibility = 'dm-only';
  record.tags = normalizeListField(record.tags);
  record.includeInCompendium = !!record.includeInCompendium;
  record.balanceNotes = record.balanceNotes || '';
  if (!record.sourceEntityType && record.sourceHybridId) record.sourceEntityType = 'hybridAncestries';
  if (!record.sourceEntityId && record.sourceHybridId) record.sourceEntityId = record.sourceHybridId;
  if (!record.promotedFromEntityType && record.sourceEntityType) record.promotedFromEntityType = record.sourceEntityType;
  if (!record.promotedFromEntityId && record.sourceEntityId) record.promotedFromEntityId = record.sourceEntityId;
  if (!record.sourceCampaignId) record.sourceCampaignId = record.campaignId || '';
  record.scope = record.scope || ((record.sourceCampaignId || record.campaignId) ? 'campaign' : 'global');
  record.summary = getHomebrewSummary(record);
  record.createdAt = record.createdAt || now;
  record.updatedAt = record.updatedAt || record.createdAt;
  return record;
}
function renderHomebrewContent(item) {
  const h = normalizeHomebrewRecord(item);
  const builder = (typeof HOMEBREW_BUILDERS !== 'undefined' && HOMEBREW_BUILDERS[h.homebrewType]) ? HOMEBREW_BUILDERS[h.homebrewType] : null;
  if ((!h.content || !String(h.content).trim()) && builder && typeof builder.toMarkdown === 'function' && h.payload) {
    return builder.toMarkdown(h.payload, h).trim();
  }
  if (h.content) return h.content;
  if (h.payload?.kind === 'Creature') {
    const p = h.payload;
    let md = `## Statblock\n\n`;
    md += `**Size:** ${p.size || 'Medium'} | **Type:** ${p.creatureType || '—'} | **Alignment:** ${p.alignment || '—'} | **CR:** ${p.cr || '—'}\n\n`;
    md += `| AC | HP | Speed |\n|---|---|---|\n| ${p.ac || '—'} | ${p.hp || '—'} | ${p.speed || '—'} |\n\n`;
    md += `| STR | DEX | CON | INT | WIS | CHA |\n|---|---|---|---|---|---|\n| ${p.abilities?.str ?? p.str ?? 10} | ${p.abilities?.dex ?? p.dex ?? 10} | ${p.abilities?.con ?? p.con ?? 10} | ${p.abilities?.int ?? p.int ?? 10} | ${p.abilities?.wis ?? p.wis ?? 10} | ${p.abilities?.cha ?? p.cha ?? 10} |\n\n`;
    if (normalizeListField(p.senses).length) md += `**Senses:** ${normalizeListField(p.senses).join(', ')}\n\n`;
    if (normalizeListField(p.languages).length) md += `**Languages:** ${normalizeListField(p.languages).join(', ')}\n\n`;
    [['Traits', p.traits], ['Actions', p.actions], ['Reactions', p.reactions], ['Legendary Actions', p.legendaryActions], ['Lair Actions', p.lairActions]]
      .forEach(([label, values]) => {
        const list = normalizeListField(values);
        if (!list.length) return;
        md += `## ${label}\n\n${list.map(v => `- ${v}`).join('\n')}\n\n`;
      });
    if (p.lore) md += `## Lore\n\n${p.lore}\n\n`;
    if (p.habitat) md += `**Habitat:** ${p.habitat}\n\n`;
    if (p.loot) md += `## Loot\n\n${p.loot}\n\n`;
    if (p.notes) md += `## Notes\n\n${p.notes}\n\n`;
    return md.trim();
  }
  if (h.payload?.kind === 'Deity') {
    const p = h.payload;
    let md = '';
    if (p.titles) md += `**Titles:** ${p.titles}\n\n`;
    if (normalizeListField(p.domains || p.domain).length) md += `**Domains:** ${normalizeListField(p.domains || p.domain).join(', ')}\n\n`;
    if (p.symbols) md += `**Symbols:** ${p.symbols}\n\n`;
    if (p.worshippers) md += `**Worshippers:** ${p.worshippers}\n\n`;
    if (p.clergy) md += `## Clergy\n\n${p.clergy}\n\n`;
    if (p.summary) md += `## Summary\n\n${p.summary}\n\n`;
    if (p.notes) md += `## Notes\n\n${p.notes}\n\n`;
    return md.trim();
  }
  return '';
}
function createOrUpdatePromotedHomebrew(plugin, entityKey, entity, recordFactory) {
  const existing = safeArr(plugin.state.entities.homebrew).find(h => {
    const n = normalizeHomebrewRecord(h);
    return n.sourceEntityType === entityKey && n.sourceEntityId === entity.id;
  });
  const record = normalizeHomebrewRecord(recordFactory(existing));
  upsert(plugin.state, 'homebrew', record);
  const linked = Object.assign({}, entity, {
    homebrewId: record.id,
    homebrewIds: [...new Set([...normalizeListField(entity.homebrewIds), record.id])],
    promotedHomebrewId: record.id,
    promotedHomebrewIds: [...new Set([...normalizeListField(entity.promotedHomebrewIds), record.id])],
    updatedAt: new Date().toISOString(),
  });
  upsert(plugin.state, entityKey, linked);
  return record;
}
function promoteCreatureToHomebrew(plugin, creature) {
  const now = new Date().toISOString();
  return createOrUpdatePromotedHomebrew(plugin, 'creatures', creature, existing => ({
    ...(existing || {}),
    id: existing?.id || uid('homebrew'),
    name: creature.name,
    homebrewType: 'Creature',
    type: 'Creature',
    category: 'Monsters & Statblocks',
    payload: {
      kind: 'Creature',
      name: creature.name,
      size: creature.size,
      creatureType: creature.creatureType,
      alignment: creature.alignment,
      ac: creature.ac,
      hp: creature.hp,
      speed: creature.speed,
      abilities: { str: creature.str, dex: creature.dex, con: creature.con, int: creature.int, wis: creature.wis, cha: creature.cha },
      senses: normalizeListField(creature.senses),
      languages: normalizeListField(creature.languages),
      cr: creature.cr,
      traits: normalizeListField(creature.traits),
      actions: normalizeListField(creature.actions),
      reactions: normalizeListField(creature.reactions),
      legendaryActions: normalizeListField(creature.legendaryActions),
      lairActions: normalizeListField(creature.lairActions),
      lore: creature.lore || '',
      habitat: creature.habitat || '',
      loot: creature.loot || '',
      notes: creature.notes || '',
      visibility: creature.visibility || 'dm-only',
      tags: normalizeListField(creature.tags),
      sourceCampaignId: creature.campaignId || '',
    },
    content: renderHomebrewContent({
      type: 'Creature',
      payload: {
        kind: 'Creature',
        size: creature.size, creatureType: creature.creatureType, alignment: creature.alignment, cr: creature.cr,
        ac: creature.ac, hp: creature.hp, speed: creature.speed,
        abilities: { str: creature.str, dex: creature.dex, con: creature.con, int: creature.int, wis: creature.wis, cha: creature.cha },
        senses: normalizeListField(creature.senses), languages: normalizeListField(creature.languages),
        traits: normalizeListField(creature.traits), actions: normalizeListField(creature.actions), reactions: normalizeListField(creature.reactions),
        legendaryActions: normalizeListField(creature.legendaryActions), lairActions: normalizeListField(creature.lairActions),
        lore: creature.lore || '', habitat: creature.habitat || '', loot: creature.loot || '', notes: creature.notes || '',
      },
    }),
    summary: creature.lore || `Promoted from campaign creature${creature.creatureType ? ` (${creature.creatureType})` : ''}.`,
    description: creature.lore || '',
    dmNotes: creature.notes || '',
    status: existing?.status || 'Draft',
    visibility: creature.visibility || existing?.visibility || 'dm-only',
    tags: [...new Set([...(existing?.tags || []), ...normalizeListField(creature.tags), 'promoted', 'creature'])],
    campaignId: creature.campaignId || '',
    sourceCampaignId: creature.campaignId || '',
    sourceEntityType: 'creatures',
    sourceEntityId: creature.id,
    promotedFromEntityType: 'creatures',
    promotedFromEntityId: creature.id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }));
}
function promoteDeityToHomebrew(plugin, deity) {
  const now = new Date().toISOString();
  const domains = normalizeListField(deity.domain || deity.domains);
  return createOrUpdatePromotedHomebrew(plugin, 'deities', deity, existing => ({
    ...(existing || {}),
    id: existing?.id || uid('homebrew'),
    name: deity.name,
    homebrewType: 'Deity',
    type: 'Deity',
    category: 'Worlds & Planes',
    payload: {
      kind: 'Deity',
      name: deity.name,
      titles: deity.titles || '',
      domain: domains,
      domains,
      symbols: deity.symbols || '',
      worshippers: deity.worshippers || '',
      clergy: deity.clergy || '',
      summary: deity.summary || '',
      notes: deity.notes || '',
      pantheon: deity.pantheon || '',
      pantheonId: deity.pantheonId || '',
      alignment: deity.alignment || '',
      sourceCampaignId: deity.campaignId || '',
      visibility: deity.visibility || 'dm-only',
      tags: normalizeListField(deity.tags),
    },
    content: renderHomebrewContent({
      type: 'Deity',
      payload: {
        kind: 'Deity',
        titles: deity.titles || '',
        domains,
        symbols: deity.symbols || '',
        worshippers: deity.worshippers || '',
        clergy: deity.clergy || '',
        summary: deity.summary || '',
        notes: deity.notes || '',
      },
    }),
    summary: deity.summary || `Promoted from campaign deity${domains.length ? ` (${domains.join(', ')})` : ''}.`,
    description: deity.summary || '',
    dmNotes: deity.notes || '',
    status: existing?.status || 'Draft',
    visibility: deity.visibility || existing?.visibility || 'dm-only',
    tags: [...new Set([...(existing?.tags || []), ...normalizeListField(deity.tags), 'promoted', 'deity'])],
    campaignId: deity.campaignId || '',
    sourceCampaignId: deity.campaignId || '',
    sourceEntityType: 'deities',
    sourceEntityId: deity.id,
    promotedFromEntityType: 'deities',
    promotedFromEntityId: deity.id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }));
}

const HOMEBREW_CATEGORY_OPTIONS = ['Character Options', 'Rules & Mechanics', 'Items & Equipment', 'Monsters & Statblocks', 'Worlds & Planes', 'Rollable Tables'];
const HOMEBREW_ABILITY_OPTIONS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const HOMEBREW_LANGUAGE_OPTIONS = ['Common','Dwarvish','Elvish','Gnomish','Halfling','Orc','Draconic','Infernal','Celestial','Sylvan','Undercommon','Abyssal','Primordial','Deep Speech','Giant','Goblin','Telepathy','Custom'];
const HOMEBREW_DAMAGE_TYPES = ['Acid','Bludgeoning','Cold','Fire','Force','Lightning','Necrotic','Piercing','Poison','Psychic','Radiant','Slashing','Thunder','Custom'];
const HOMEBREW_ITEM_TYPES = ['Adventuring Gear','Magic Item','Weapon','Armour','Wondrous Item','Consumable','Tool','Custom'];
const HOMEBREW_ITEM_RARITIES = ['Common','Uncommon','Rare','Very Rare','Legendary','Artifact','Mundane','Custom'];
const HOMEBREW_SPELL_LEVELS = ['0','1','2','3','4','5','6','7','8','9'];
const HOMEBREW_COMPONENTS = ['V', 'S', 'M'];
const HOMEBREW_ITEM_PROPERTY_SUGGESTIONS = ['Ammunition','Attunement','Finesse','Heavy','Light','Loading','Reach','Thrown','Two-Handed','Versatile','Requires Strength','Stealth Disadvantage','Custom'];
const HOMEBREW_ARMOUR_CATEGORIES = ['Light Armour','Medium Armour','Heavy Armour','Shield','Natural Armour','Custom'];
const HOMEBREW_WEAPON_CATEGORIES = ['Simple Melee','Simple Ranged','Martial Melee','Martial Ranged','Natural Weapon','Siege Weapon','Custom'];
const HOMEBREW_POWER_TIERS = ['Ribbon','Minor','Moderate','Major','Capstone','Custom'];
const HOMEBREW_RULE_CATEGORIES = ['Core','Combat','Exploration','Social','Downtime','Spellcasting','Equipment','Optional Rule','Custom'];
const HOMEBREW_MECHANIC_CATEGORIES = ['Combat','Exploration','Social','Resource','Encounter','Crafting','Faction','Magic','Custom'];
const HOMEBREW_PLANE_COSMOLOGIES = ['Great Wheel','World Tree','Material Plane + Echo Planes','Elemental Cosmology','Planar Sea','Dream Cosmology','Mythic Underworld','Custom'];
const HOMEBREW_MOVEMENT_SUGGESTIONS = ['30 ft', '40 ft', '60 ft', 'Fly 30 ft', 'Swim 30 ft', 'Climb 30 ft', 'Burrow 20 ft', 'Hover', 'Custom'];
const HOMEBREW_UI_PLACEHOLDERS = new Set([
  'select common options',
  'select existing',
  'make noted changes',
  'confirm what this connects to',
]);

function scrubHomebrewPlaceholderText(value) {
  const v = String(value || '').trim();
  return HOMEBREW_UI_PLACEHOLDERS.has(v.toLowerCase()) ? '' : v;
}
function sanitizeHomebrewDraftValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeHomebrewDraftValue).filter(v => v !== '' && v != null);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeHomebrewDraftValue(v)]));
  }
  if (typeof value === 'string') return scrubHomebrewPlaceholderText(value);
  return value;
}

function canonicalHomebrewBuilderType(type) {
  const raw = String(type || '').trim();
  if (['Weapon', 'Armour', 'Armor', 'Magic Item'].includes(raw)) return 'Item';
  if (['Monster', 'Creature', 'Beast'].includes(raw)) return 'Creature';
  if (['Race', 'Ancestry', 'Hybrid Ancestry'].includes(raw)) return 'Ancestry';
  return raw;
}
function markdownListSection(title, values) {
  const list = normalizeListField(values);
  return list.length ? `## ${title}\n\n${list.map(v => `- ${v}`).join('\n')}\n\n` : '';
}
function flattenHomebrewPayload(record) {
  const h = normalizeHomebrewRecord(record || {});
  return Object.assign({}, h, h.payload || {});
}
function getCustomHomebrewClassOptions(plugin, item) {
  const current = normalizeHomebrewRecord(item || {});
  const fromHomebrew = safeArr(plugin.state.entities.homebrew)
    .map(h => normalizeHomebrewRecord(h))
    .filter(h => h.homebrewType === 'Class' && h.name)
    .map(h => h.name);
  return [...new Set([...CLASSES, ...fromHomebrew, current.parentClass || '', 'Custom'].filter(Boolean))];
}
function homebrewSummaryFromValues(definition, values) {
  return values.summary
    || values.description
    || values.flavor
    || values.effect
    || values.fullText
    || values.ruleText
    || values.notes
    || definition.label;
}
function hybridAncestryToBuilderValues(values) {
  const traits = safeArr(values.traits).map(id => {
    const found = HYBRID_TRAIT_LIBRARY.find(t => t.id === id);
    return found ? found.name : id;
  }).filter(Boolean);
  return {
    description: values.summary || '',
    flavor: values.summary || '',
    creatureType: values.creatureType || 'Humanoid',
    size: values.size || 'Medium',
    walkingSpeed: values.speed || 30,
    flyingSpeed: 0,
    swimmingSpeed: 0,
    climbingSpeed: 0,
    burrowingSpeed: 0,
    abilityScoreMode: values.asiMode === 'manual' ? 'Custom' : 'Flexible',
    abilityScoreBonuses: [],
    abilityScoreText: values.asiNotes || '',
    age: values.ageNotes || '',
    alignment: '',
    languages: normalizeListField(values.languages || values.languageNotes),
    traits,
    traitText: traits.join('\n'),
    subraces: [],
    subraceNotes: '',
    balanceNotes: values.balanceRating ? `${values.balanceRating} (${values.balanceScore || 0})` : '',
  };
}

const HOMEBREW_BUILDERS = {
  Spell: {
    label: 'Spell',
    category: 'Rules & Mechanics',
    defaults: {
      flavor: '',
      level: '0',
      school: 'Evocation',
      schoolCustom: '',
      castingTime: '1 action',
      range: 'Self',
      components: ['V', 'S'],
      material: '',
      materialCost: '',
      duration: 'Instantaneous',
      targetArea: '',
      savingThrow: '',
      attackRoll: '',
      description: '',
      higherLevels: '',
      spellLists: [],
    },
    sections: [
      { title: 'Identity', fields: [
        { key: 'flavor', label: 'Flavor / Description', type: 'textarea' },
        { key: 'level', label: 'Level', type: 'select', options: HOMEBREW_SPELL_LEVELS },
        { key: 'school', label: 'School', type: 'select', options: [...OPTION_BANKS.spellSchools, 'Custom'] },
        { key: 'schoolCustom', label: 'Custom School', type: 'text', when: v => v.school === 'Custom' },
      ]},
      { title: 'Casting', fields: [
        { key: 'castingTime', label: 'Casting Time', type: 'text' },
        { key: 'range', label: 'Range', type: 'text' },
        { key: 'components', label: 'Components', type: 'chip', opts: { suggestions: HOMEBREW_COMPONENTS } },
        { key: 'material', label: 'Material / Cost', type: 'text' },
        { key: 'duration', label: 'Duration', type: 'text' },
        { key: 'targetArea', label: 'Target / Area', type: 'text' },
        { key: 'savingThrow', label: 'Saving Throw', type: 'text' },
        { key: 'attackRoll', label: 'Attack Roll', type: 'text' },
      ]},
      { title: 'Effect', fields: [
        { key: 'description', label: 'Description / Effect', type: 'textarea' },
        { key: 'higherLevels', label: 'Higher Levels', type: 'textarea' },
        { key: 'spellLists', label: 'Spell Lists', type: 'chip', opts: { suggestions: [...CLASSES, 'Artificer', 'Custom'] } },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Spell',
        flavor: values.flavor || '',
        level: values.level || '0',
        school: values.school === 'Custom' ? (values.schoolCustom || 'Custom') : values.school,
        castingTime: values.castingTime || '',
        range: values.range || '',
        components: normalizeListField(values.components),
        material: values.material || '',
        materialCost: values.materialCost || '',
        duration: values.duration || '',
        targetArea: values.targetArea || '',
        savingThrow: values.savingThrow || '',
        attackRoll: values.attackRoll || '',
        description: values.description || '',
        higherLevels: values.higherLevels || '',
        spellLists: normalizeListField(values.spellLists),
      };
    },
    toMarkdown(payload) {
      let md = '';
      if (payload.flavor) md += `${payload.flavor}\n\n`;
      md += `**Level:** ${payload.level} | **School:** ${payload.school || '—'} | **Casting Time:** ${payload.castingTime || '—'} | **Range:** ${payload.range || '—'}\n\n`;
      md += `**Components:** ${normalizeListField(payload.components).join(', ') || '—'} | **Duration:** ${payload.duration || '—'}\n\n`;
      if (payload.targetArea) md += `**Target / Area:** ${payload.targetArea}\n\n`;
      if (payload.savingThrow) md += `**Saving Throw:** ${payload.savingThrow}\n\n`;
      if (payload.attackRoll) md += `**Attack Roll:** ${payload.attackRoll}\n\n`;
      if (payload.description) md += `## Effect\n\n${payload.description}\n\n`;
      if (payload.higherLevels) md += `## Higher Levels\n\n${payload.higherLevels}\n\n`;
      if (normalizeListField(payload.spellLists).length) md += `**Spell Lists:** ${normalizeListField(payload.spellLists).join(', ')}\n\n`;
      return md.trim();
    },
  },
  Feat: {
    label: 'Feat',
    category: 'Character Options',
    defaults: {
      prerequisite: '',
      description: '',
      mechanicalEffects: '',
      powerTier: 'Moderate',
      variantNotes: '',
    },
    sections: [
      { title: 'Feat', fields: [
        { key: 'prerequisite', label: 'Prerequisite', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'mechanicalEffects', label: 'Mechanical Effects', type: 'textarea' },
        { key: 'powerTier', label: 'Rarity / Power Tier', type: 'select', options: HOMEBREW_POWER_TIERS },
        { key: 'variantNotes', label: 'Variant / Notes', type: 'textarea' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Feat',
        prerequisite: values.prerequisite || '',
        description: values.description || '',
        mechanicalEffects: values.mechanicalEffects || '',
        powerTier: values.powerTier || '',
        variantNotes: values.variantNotes || '',
      };
    },
    toMarkdown(payload) {
      let md = '';
      if (payload.prerequisite) md += `**Prerequisite:** ${payload.prerequisite}\n\n`;
      if (payload.powerTier) md += `**Power Tier:** ${payload.powerTier}\n\n`;
      if (payload.description) md += `## Description\n\n${payload.description}\n\n`;
      if (payload.mechanicalEffects) md += `## Mechanical Effects\n\n${payload.mechanicalEffects}\n\n`;
      if (payload.variantNotes) md += `## Variant Notes\n\n${payload.variantNotes}\n\n`;
      return md.trim();
    },
  },
  Background: {
    label: 'Background',
    category: 'Character Options',
    defaults: {
      flavor: '',
      skillProficiencies: [],
      toolProficiencies: [],
      languages: [],
      startingEquipment: '',
      backgroundFeature: '',
      characteristicTables: '',
      variant: '',
    },
    sections: [
      { title: 'Background', fields: [
        { key: 'flavor', label: 'Flavor / Backstory', type: 'textarea' },
        { key: 'skillProficiencies', label: 'Skill Proficiencies', type: 'chip', opts: { suggestions: OPTION_BANKS.skillList } },
        { key: 'toolProficiencies', label: 'Tool Proficiencies', type: 'chip', opts: { suggestions: OPTION_BANKS.tools } },
        { key: 'languages', label: 'Languages', type: 'chip', opts: { suggestions: HOMEBREW_LANGUAGE_OPTIONS } },
        { key: 'startingEquipment', label: 'Starting Equipment', type: 'textarea' },
        { key: 'backgroundFeature', label: 'Background Feature', type: 'textarea' },
        { key: 'characteristicTables', label: 'Suggested Characteristics Tables', type: 'textarea' },
        { key: 'variant', label: 'Variant', type: 'text' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Background',
        flavor: values.flavor || '',
        skillProficiencies: normalizeListField(values.skillProficiencies),
        toolProficiencies: normalizeListField(values.toolProficiencies),
        languages: normalizeListField(values.languages),
        startingEquipment: values.startingEquipment || '',
        backgroundFeature: values.backgroundFeature || '',
        characteristicTables: values.characteristicTables || '',
        variant: values.variant || '',
      };
    },
    toMarkdown(payload) {
      let md = '';
      if (payload.flavor) md += `${payload.flavor}\n\n`;
      if (normalizeListField(payload.skillProficiencies).length) md += `**Skill Proficiencies:** ${normalizeListField(payload.skillProficiencies).join(', ')}\n\n`;
      if (normalizeListField(payload.toolProficiencies).length) md += `**Tool Proficiencies:** ${normalizeListField(payload.toolProficiencies).join(', ')}\n\n`;
      if (normalizeListField(payload.languages).length) md += `**Languages:** ${normalizeListField(payload.languages).join(', ')}\n\n`;
      if (payload.startingEquipment) md += `## Starting Equipment\n\n${payload.startingEquipment}\n\n`;
      if (payload.backgroundFeature) md += `## Background Feature\n\n${payload.backgroundFeature}\n\n`;
      if (payload.characteristicTables) md += `## Suggested Characteristics\n\n${payload.characteristicTables}\n\n`;
      if (payload.variant) md += `**Variant:** ${payload.variant}\n\n`;
      return md.trim();
    },
  },
  Item: {
    label: 'Item',
    category: 'Items & Equipment',
    defaults: {
      itemType: 'Magic Item',
      itemTypeCustom: '',
      rarity: 'Common',
      rarityCustom: '',
      weight: '',
      cost: '',
      description: '',
      properties: [],
      magicalEffects: '',
      curseDrawback: '',
      attunement: false,
      charges: '',
      weaponCategory: 'Martial Melee',
      damageDice: '',
      damageType: 'Slashing',
      range: '',
      weaponSpecialRules: '',
      armourCategory: 'Light Armour',
      acFormula: '',
      strengthRequirement: '',
      stealthDisadvantage: false,
      armourProperties: [],
    },
    sections: [
      { title: 'Item', fields: [
        { key: 'itemType', label: 'Type', type: 'select', options: HOMEBREW_ITEM_TYPES },
        { key: 'itemTypeCustom', label: 'Custom Item Type', type: 'text', when: v => v.itemType === 'Custom' },
        { key: 'rarity', label: 'Rarity', type: 'select', options: HOMEBREW_ITEM_RARITIES },
        { key: 'rarityCustom', label: 'Custom Rarity', type: 'text', when: v => v.rarity === 'Custom' },
        { key: 'weight', label: 'Weight', type: 'text' },
        { key: 'cost', label: 'Cost', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'properties', label: 'Properties', type: 'chip', opts: { suggestions: HOMEBREW_ITEM_PROPERTY_SUGGESTIONS } },
        { key: 'magicalEffects', label: 'Magical Effects', type: 'textarea' },
        { key: 'curseDrawback', label: 'Curse / Drawback', type: 'textarea' },
        { key: 'attunement', label: 'Requires Attunement', type: 'toggle' },
        { key: 'charges', label: 'Charges', type: 'text' },
      ]},
      { title: 'Weapon Details', fields: [
        { key: 'weaponCategory', label: 'Weapon Category', type: 'select', options: HOMEBREW_WEAPON_CATEGORIES, when: v => v.itemType === 'Weapon' },
        { key: 'damageDice', label: 'Damage Dice', type: 'text', when: v => v.itemType === 'Weapon' },
        { key: 'damageType', label: 'Damage Type', type: 'select', options: HOMEBREW_DAMAGE_TYPES, when: v => v.itemType === 'Weapon' },
        { key: 'range', label: 'Range', type: 'text', when: v => v.itemType === 'Weapon' },
        { key: 'weaponSpecialRules', label: 'Special Rules', type: 'textarea', when: v => v.itemType === 'Weapon' },
      ]},
      { title: 'Armour Details', fields: [
        { key: 'armourCategory', label: 'Armour Category', type: 'select', options: HOMEBREW_ARMOUR_CATEGORIES, when: v => v.itemType === 'Armour' },
        { key: 'acFormula', label: 'AC Formula', type: 'text', when: v => v.itemType === 'Armour' },
        { key: 'strengthRequirement', label: 'Strength Requirement', type: 'text', when: v => v.itemType === 'Armour' },
        { key: 'stealthDisadvantage', label: 'Stealth Disadvantage', type: 'toggle', when: v => v.itemType === 'Armour' },
        { key: 'armourProperties', label: 'Armour Properties', type: 'chip', opts: { suggestions: HOMEBREW_ITEM_PROPERTY_SUGGESTIONS }, when: v => v.itemType === 'Armour' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Item',
        itemType: values.itemType === 'Custom' ? (values.itemTypeCustom || 'Custom') : values.itemType,
        rarity: values.rarity === 'Custom' ? (values.rarityCustom || 'Custom') : values.rarity,
        weight: values.weight || '',
        cost: values.cost || '',
        description: values.description || '',
        properties: normalizeListField(values.properties),
        magicalEffects: values.magicalEffects || '',
        curseDrawback: values.curseDrawback || '',
        attunement: !!values.attunement,
        charges: values.charges || '',
        weaponCategory: values.itemType === 'Weapon' ? (values.weaponCategory || '') : '',
        damageDice: values.itemType === 'Weapon' ? (values.damageDice || '') : '',
        damageType: values.itemType === 'Weapon' ? (values.damageType || '') : '',
        range: values.itemType === 'Weapon' ? (values.range || '') : '',
        weaponSpecialRules: values.itemType === 'Weapon' ? (values.weaponSpecialRules || '') : '',
        armourCategory: values.itemType === 'Armour' ? (values.armourCategory || '') : '',
        acFormula: values.itemType === 'Armour' ? (values.acFormula || '') : '',
        strengthRequirement: values.itemType === 'Armour' ? (values.strengthRequirement || '') : '',
        stealthDisadvantage: values.itemType === 'Armour' ? !!values.stealthDisadvantage : false,
        armourProperties: values.itemType === 'Armour' ? normalizeListField(values.armourProperties) : [],
      };
    },
    toMarkdown(payload) {
      let md = `**Type:** ${payload.itemType || '—'} | **Rarity:** ${payload.rarity || '—'} | **Cost:** ${payload.cost || '—'} | **Weight:** ${payload.weight || '—'}\n\n`;
      if (payload.description) md += `## Description\n\n${payload.description}\n\n`;
      if (normalizeListField(payload.properties).length) md += `**Properties:** ${normalizeListField(payload.properties).join(', ')}\n\n`;
      if (payload.magicalEffects) md += `## Magical Effects\n\n${payload.magicalEffects}\n\n`;
      if (payload.curseDrawback) md += `## Curse / Drawback\n\n${payload.curseDrawback}\n\n`;
      if (payload.attunement) md += `**Attunement:** Required\n\n`;
      if (payload.charges) md += `**Charges:** ${payload.charges}\n\n`;
      if (payload.weaponCategory) {
        md += `## Weapon Details\n\n`;
        md += `**Category:** ${payload.weaponCategory} | **Damage:** ${payload.damageDice || '—'} ${payload.damageType || ''} | **Range:** ${payload.range || '—'}\n\n`;
        if (payload.weaponSpecialRules) md += `${payload.weaponSpecialRules}\n\n`;
      }
      if (payload.armourCategory) {
        md += `## Armour Details\n\n`;
        md += `**Category:** ${payload.armourCategory} | **AC:** ${payload.acFormula || '—'} | **Strength Requirement:** ${payload.strengthRequirement || '—'}\n\n`;
        if (payload.stealthDisadvantage) md += `**Stealth:** Disadvantage\n\n`;
        if (normalizeListField(payload.armourProperties).length) md += `**Armour Properties:** ${normalizeListField(payload.armourProperties).join(', ')}\n\n`;
      }
      return md.trim();
    },
  },
  Creature: {
    label: 'Creature',
    category: 'Monsters & Statblocks',
    defaults: {
      creatureKind: 'Monster',
      size: 'Medium',
      creatureType: 'Humanoid',
      alignment: 'True Neutral',
      ac: '12',
      acSource: '',
      hpAverage: '7',
      hpFormula: '',
      speed: ['30 ft'],
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      savingThrows: [],
      skills: [],
      damageResistances: [],
      damageImmunities: [],
      damageVulnerabilities: [],
      conditionImmunities: [],
      senses: [],
      languages: [],
      cr: '1',
      xp: '',
      traits: [],
      actions: [],
      reactions: [],
      legendaryActions: [],
      lairActions: [],
      regionalEffects: '',
      lore: '',
      notes: '',
    },
    sections: [
      { title: 'Identity', fields: [
        { key: 'creatureKind', label: 'Monster / Creature / Beast', type: 'select', options: ['Monster', 'Creature', 'Beast'] },
        { key: 'size', label: 'Size', type: 'select', options: SIZES },
        { key: 'creatureType', label: 'Type', type: 'select', options: [...CREATURE_TYPES, 'Custom'] },
        { key: 'alignment', label: 'Alignment', type: 'select', options: [...ALIGNMENTS, 'Custom'] },
        { key: 'ac', label: 'AC', type: 'text' },
        { key: 'acSource', label: 'AC Source', type: 'text' },
        { key: 'hpAverage', label: 'HP Average', type: 'text' },
        { key: 'hpFormula', label: 'HP Formula', type: 'text' },
        { key: 'speed', label: 'Speed', type: 'chip', opts: { suggestions: HOMEBREW_MOVEMENT_SUGGESTIONS } },
      ]},
      { title: 'Ability Scores', fields: [
        { key: 'str', label: 'STR', type: 'number' },
        { key: 'dex', label: 'DEX', type: 'number' },
        { key: 'con', label: 'CON', type: 'number' },
        { key: 'int', label: 'INT', type: 'number' },
        { key: 'wis', label: 'WIS', type: 'number' },
        { key: 'cha', label: 'CHA', type: 'number' },
      ]},
      { title: 'Combat & Defenses', fields: [
        { key: 'savingThrows', label: 'Saving Throws', type: 'chip', opts: { suggestions: HOMEBREW_ABILITY_OPTIONS.map(a => `${a} +0`) } },
        { key: 'skills', label: 'Skills', type: 'chip', opts: { suggestions: OPTION_BANKS.skillList } },
        { key: 'damageResistances', label: 'Damage Resistances', type: 'chip', opts: { suggestions: HOMEBREW_DAMAGE_TYPES } },
        { key: 'damageImmunities', label: 'Damage Immunities', type: 'chip', opts: { suggestions: HOMEBREW_DAMAGE_TYPES } },
        { key: 'damageVulnerabilities', label: 'Damage Vulnerabilities', type: 'chip', opts: { suggestions: HOMEBREW_DAMAGE_TYPES } },
        { key: 'conditionImmunities', label: 'Condition Immunities', type: 'chip', opts: { suggestions: [...CONDITIONS_LIST, 'Custom'] } },
        { key: 'senses', label: 'Senses', type: 'chip', opts: { suggestions: OPTION_BANKS.creatureSenses } },
        { key: 'languages', label: 'Languages', type: 'chip', opts: { suggestions: HOMEBREW_LANGUAGE_OPTIONS } },
        { key: 'cr', label: 'CR', type: 'text' },
        { key: 'xp', label: 'XP', type: 'text' },
      ]},
      { title: 'Features', fields: [
        { key: 'traits', label: 'Traits', type: 'chip', opts: { suggestions: OPTION_BANKS.creatureTraits } },
        { key: 'actions', label: 'Actions', type: 'chip', opts: { suggestions: OPTION_BANKS.creatureActions } },
        { key: 'reactions', label: 'Reactions', type: 'chip', opts: { suggestions: OPTION_BANKS.creatureReactions } },
        { key: 'legendaryActions', label: 'Legendary Actions', type: 'chip', opts: { suggestions: OPTION_BANKS.legendaryActions } },
        { key: 'lairActions', label: 'Lair Actions', type: 'chip', opts: { suggestions: OPTION_BANKS.lairActions } },
        { key: 'regionalEffects', label: 'Regional Effects', type: 'textarea' },
        { key: 'lore', label: 'Lore', type: 'textarea' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Creature',
        creatureKind: values.creatureKind || 'Monster',
        size: values.size || 'Medium',
        creatureType: values.creatureType || 'Humanoid',
        alignment: values.alignment || '',
        ac: values.ac || '',
        acSource: values.acSource || '',
        hp: values.hpAverage || '',
        hpAverage: values.hpAverage || '',
        hpFormula: values.hpFormula || '',
        speed: normalizeListField(values.speed),
        abilities: { str: Number(values.str || 10), dex: Number(values.dex || 10), con: Number(values.con || 10), int: Number(values.int || 10), wis: Number(values.wis || 10), cha: Number(values.cha || 10) },
        savingThrows: normalizeListField(values.savingThrows),
        skills: normalizeListField(values.skills),
        damageResistances: normalizeListField(values.damageResistances),
        damageImmunities: normalizeListField(values.damageImmunities),
        damageVulnerabilities: normalizeListField(values.damageVulnerabilities),
        conditionImmunities: normalizeListField(values.conditionImmunities),
        senses: normalizeListField(values.senses),
        languages: normalizeListField(values.languages),
        cr: values.cr || '',
        xp: values.xp || '',
        traits: normalizeListField(values.traits),
        actions: normalizeListField(values.actions),
        reactions: normalizeListField(values.reactions),
        legendaryActions: normalizeListField(values.legendaryActions),
        lairActions: normalizeListField(values.lairActions),
        regionalEffects: values.regionalEffects || '',
        lore: values.lore || '',
        notes: values.notes || '',
      };
    },
    toMarkdown(payload) {
      let md = `**Kind:** ${payload.creatureKind || 'Monster'} | **Size:** ${payload.size || 'Medium'} | **Type:** ${payload.creatureType || '—'} | **Alignment:** ${payload.alignment || '—'}\n\n`;
      md += `| AC | HP | Speed | CR |\n|---|---|---|---|\n| ${payload.ac || '—'}${payload.acSource ? ` (${payload.acSource})` : ''} | ${payload.hpAverage || payload.hp || '—'}${payload.hpFormula ? ` (${payload.hpFormula})` : ''} | ${normalizeListField(payload.speed).join(', ') || '—'} | ${payload.cr || '—'} |\n\n`;
      md += `| STR | DEX | CON | INT | WIS | CHA |\n|---|---|---|---|---|---|\n| ${payload.abilities?.str ?? 10} | ${payload.abilities?.dex ?? 10} | ${payload.abilities?.con ?? 10} | ${payload.abilities?.int ?? 10} | ${payload.abilities?.wis ?? 10} | ${payload.abilities?.cha ?? 10} |\n\n`;
      [['Saving Throws', payload.savingThrows], ['Skills', payload.skills], ['Damage Resistances', payload.damageResistances], ['Damage Immunities', payload.damageImmunities], ['Damage Vulnerabilities', payload.damageVulnerabilities], ['Condition Immunities', payload.conditionImmunities], ['Senses', payload.senses], ['Languages', payload.languages]]
        .forEach(([label, values]) => { if (normalizeListField(values).length) md += `**${label}:** ${normalizeListField(values).join(', ')}\n\n`; });
      md += markdownListSection('Traits', payload.traits);
      md += markdownListSection('Actions', payload.actions);
      md += markdownListSection('Reactions', payload.reactions);
      md += markdownListSection('Legendary Actions', payload.legendaryActions);
      md += markdownListSection('Lair Actions', payload.lairActions);
      if (payload.regionalEffects) md += `## Regional Effects\n\n${payload.regionalEffects}\n\n`;
      if (payload.lore) md += `## Lore\n\n${payload.lore}\n\n`;
      if (payload.notes) md += `## Notes\n\n${payload.notes}\n\n`;
      return md.trim();
    },
  },
  Ancestry: {
    label: 'Race / Ancestry',
    category: 'Character Options',
    defaults: {
      description: '',
      creatureType: 'Humanoid',
      size: 'Medium',
      walkingSpeed: 30,
      flyingSpeed: 0,
      swimmingSpeed: 0,
      climbingSpeed: 0,
      burrowingSpeed: 0,
      abilityScoreMode: 'Flexible',
      abilityScoreBonuses: [],
      abilityScoreText: '',
      age: '',
      alignment: '',
      languages: [],
      traits: [],
      traitText: '',
      subraces: [],
      subraceNotes: '',
    },
    sections: [
      { title: 'Ancestry', fields: [
        { key: 'description', label: 'Description / Flavor', type: 'textarea' },
        { key: 'creatureType', label: 'Creature Type', type: 'select', options: [...CREATURE_TYPES, 'Custom'] },
        { key: 'size', label: 'Size', type: 'select', options: SIZES },
      ]},
      { title: 'Speed', fields: [
        { key: 'walkingSpeed', label: 'Walking Speed', type: 'number' },
        { key: 'flyingSpeed', label: 'Flying Speed', type: 'number' },
        { key: 'swimmingSpeed', label: 'Swimming Speed', type: 'number' },
        { key: 'climbingSpeed', label: 'Climbing Speed', type: 'number' },
        { key: 'burrowingSpeed', label: 'Burrowing Speed', type: 'number' },
      ]},
      { title: 'Traits', fields: [
        { key: 'abilityScoreMode', label: 'Ability Score Increase', type: 'select', options: ['Fixed', 'Flexible', 'Custom'] },
        { key: 'abilityScoreBonuses', label: 'Ability Score Bonuses', type: 'chip', opts: { suggestions: HOMEBREW_ABILITY_OPTIONS.flatMap(a => [`${a} +1`, `${a} +2`]) } },
        { key: 'abilityScoreText', label: 'Custom ASI Rules', type: 'textarea', when: v => v.abilityScoreMode === 'Custom' },
        { key: 'age', label: 'Age', type: 'textarea' },
        { key: 'alignment', label: 'Alignment', type: 'text' },
        { key: 'languages', label: 'Languages', type: 'chip', opts: { suggestions: HOMEBREW_LANGUAGE_OPTIONS } },
        { key: 'traits', label: 'Traits / Features', type: 'chip', opts: { suggestions: OPTION_BANKS.creatureTraits } },
        { key: 'traitText', label: 'Traits / Features Details', type: 'textarea' },
        { key: 'subraces', label: 'Subraces', type: 'chip' },
        { key: 'subraceNotes', label: 'Subrace Notes', type: 'textarea' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Ancestry',
        description: values.description || '',
        creatureType: values.creatureType || 'Humanoid',
        size: values.size || 'Medium',
        speed: {
          walking: Number(values.walkingSpeed || 0),
          flying: Number(values.flyingSpeed || 0),
          swimming: Number(values.swimmingSpeed || 0),
          climbing: Number(values.climbingSpeed || 0),
          burrowing: Number(values.burrowingSpeed || 0),
        },
        abilityScoreMode: values.abilityScoreMode || 'Flexible',
        abilityScoreBonuses: normalizeListField(values.abilityScoreBonuses),
        abilityScoreText: values.abilityScoreText || '',
        age: values.age || '',
        alignment: values.alignment || '',
        languages: normalizeListField(values.languages),
        traits: normalizeListField(values.traits),
        traitText: values.traitText || '',
        subraces: normalizeListField(values.subraces),
        subraceNotes: values.subraceNotes || '',
      };
    },
    toMarkdown(payload) {
      let md = '';
      if (payload.description) md += `${payload.description}\n\n`;
      md += `**Creature Type:** ${payload.creatureType || 'Humanoid'} | **Size:** ${payload.size || 'Medium'}\n\n`;
      md += `**Speed:** Walk ${payload.speed?.walking || 0} ft`;
      ['flying', 'swimming', 'climbing', 'burrowing'].forEach(k => { if (payload.speed?.[k]) md += ` | ${k[0].toUpperCase() + k.slice(1)} ${payload.speed[k]} ft`; });
      md += `\n\n`;
      md += `**Ability Score Increase:** ${payload.abilityScoreMode || 'Flexible'}${normalizeListField(payload.abilityScoreBonuses).length ? ` (${normalizeListField(payload.abilityScoreBonuses).join(', ')})` : ''}\n\n`;
      if (payload.abilityScoreText) md += `${payload.abilityScoreText}\n\n`;
      if (payload.age) md += `## Age\n\n${payload.age}\n\n`;
      if (payload.alignment) md += `**Alignment:** ${payload.alignment}\n\n`;
      if (normalizeListField(payload.languages).length) md += `**Languages:** ${normalizeListField(payload.languages).join(', ')}\n\n`;
      md += markdownListSection('Traits', payload.traits);
      if (payload.traitText) md += `## Trait Details\n\n${payload.traitText}\n\n`;
      if (normalizeListField(payload.subraces).length) md += `**Subraces:** ${normalizeListField(payload.subraces).join(', ')}\n\n`;
      if (payload.subraceNotes) md += `## Subrace Notes\n\n${payload.subraceNotes}\n\n`;
      return md.trim();
    },
  },
  Class: {
    label: 'Class',
    category: 'Character Options',
    defaults: {
      flavor: '',
      hitDie: '8',
      primaryAbility: [],
      savingThrowProficiencies: [],
      skillProficiencies: [],
      armourProficiencies: [],
      weaponProficiencies: [],
      toolProficiencies: [],
      levelTable: '',
      classFeatures: '',
      spellcastingRules: '',
      subclassLevel: '3',
    },
    sections: [
      { title: 'Class Core', fields: [
        { key: 'flavor', label: 'Flavor / Description', type: 'textarea' },
        { key: 'hitDie', label: 'Hit Die', type: 'select', options: ['6', '8', '10', '12'] },
        { key: 'primaryAbility', label: 'Primary Ability', type: 'chip', opts: { suggestions: HOMEBREW_ABILITY_OPTIONS } },
        { key: 'savingThrowProficiencies', label: 'Saving Throw Proficiencies', type: 'chip', opts: { suggestions: HOMEBREW_ABILITY_OPTIONS } },
        { key: 'skillProficiencies', label: 'Skill Proficiencies', type: 'chip', opts: { suggestions: OPTION_BANKS.skillList } },
        { key: 'armourProficiencies', label: 'Armour Proficiencies', type: 'chip', opts: { suggestions: HOMEBREW_ARMOUR_CATEGORIES } },
        { key: 'weaponProficiencies', label: 'Weapon Proficiencies', type: 'chip', opts: { suggestions: HOMEBREW_WEAPON_CATEGORIES } },
        { key: 'toolProficiencies', label: 'Tool Proficiencies', type: 'chip', opts: { suggestions: OPTION_BANKS.tools } },
      ]},
      { title: 'Scaffold', fields: [
        { key: 'levelTable', label: 'Level Table', type: 'textarea' },
        { key: 'classFeatures', label: 'Class Features', type: 'textarea' },
        { key: 'spellcastingRules', label: 'Spellcasting Rules', type: 'textarea' },
        { key: 'subclassLevel', label: 'Subclass Level', type: 'text' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Class',
        flavor: values.flavor || '',
        hitDie: values.hitDie || '8',
        primaryAbility: normalizeListField(values.primaryAbility),
        savingThrowProficiencies: normalizeListField(values.savingThrowProficiencies),
        skillProficiencies: normalizeListField(values.skillProficiencies),
        armourProficiencies: normalizeListField(values.armourProficiencies),
        weaponProficiencies: normalizeListField(values.weaponProficiencies),
        toolProficiencies: normalizeListField(values.toolProficiencies),
        levelTable: values.levelTable || '',
        classFeatures: values.classFeatures || '',
        spellcastingRules: values.spellcastingRules || '',
        subclassLevel: values.subclassLevel || '',
      };
    },
    toMarkdown(payload) {
      let md = '';
      if (payload.flavor) md += `${payload.flavor}\n\n`;
      md += `**Hit Die:** d${payload.hitDie || '8'}\n\n`;
      [['Primary Ability', payload.primaryAbility], ['Saving Throws', payload.savingThrowProficiencies], ['Skills', payload.skillProficiencies], ['Armour Proficiencies', payload.armourProficiencies], ['Weapon Proficiencies', payload.weaponProficiencies], ['Tool Proficiencies', payload.toolProficiencies]]
        .forEach(([label, values]) => { if (normalizeListField(values).length) md += `**${label}:** ${normalizeListField(values).join(', ')}\n\n`; });
      if (payload.levelTable) md += `## Level Table\n\n${payload.levelTable}\n\n`;
      if (payload.classFeatures) md += `## Class Features\n\n${payload.classFeatures}\n\n`;
      if (payload.spellcastingRules) md += `## Spellcasting Rules\n\n${payload.spellcastingRules}\n\n`;
      if (payload.subclassLevel) md += `**Subclass Level:** ${payload.subclassLevel}\n\n`;
      return md.trim();
    },
  },
  Subclass: {
    label: 'Subclass',
    category: 'Character Options',
    defaults: {
      parentClass: 'Custom',
      parentClassCustom: '',
      flavor: '',
      featureLevels: [],
      features: '',
      additionalProficiencies: [],
      spellAdditions: [],
    },
    sections: [
      { title: 'Subclass', fields: [
        { key: 'parentClass', label: 'Parent Class', type: 'dynamicSelect', options: (plugin, item) => getCustomHomebrewClassOptions(plugin, item) },
        { key: 'parentClassCustom', label: 'Custom Parent Class', type: 'text', when: v => v.parentClass === 'Custom' },
        { key: 'flavor', label: 'Flavor', type: 'textarea' },
        { key: 'featureLevels', label: 'Feature Levels', type: 'chip', opts: { suggestions: ['1','2','3','6','10','14','18','20'] } },
        { key: 'features', label: 'Features List', type: 'textarea' },
        { key: 'additionalProficiencies', label: 'Additional Proficiencies', type: 'chip', opts: { suggestions: [...OPTION_BANKS.tools, ...OPTION_BANKS.skillList] } },
        { key: 'spellAdditions', label: 'Spell Additions', type: 'chip' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Subclass',
        parentClass: values.parentClass === 'Custom' ? (values.parentClassCustom || 'Custom') : values.parentClass,
        flavor: values.flavor || '',
        featureLevels: normalizeListField(values.featureLevels),
        features: values.features || '',
        additionalProficiencies: normalizeListField(values.additionalProficiencies),
        spellAdditions: normalizeListField(values.spellAdditions),
      };
    },
    toMarkdown(payload) {
      let md = `**Parent Class:** ${payload.parentClass || '—'}\n\n`;
      if (payload.flavor) md += `${payload.flavor}\n\n`;
      if (normalizeListField(payload.featureLevels).length) md += `**Feature Levels:** ${normalizeListField(payload.featureLevels).join(', ')}\n\n`;
      if (payload.features) md += `## Features\n\n${payload.features}\n\n`;
      if (normalizeListField(payload.additionalProficiencies).length) md += `**Additional Proficiencies:** ${normalizeListField(payload.additionalProficiencies).join(', ')}\n\n`;
      if (normalizeListField(payload.spellAdditions).length) md += `**Spell Additions:** ${normalizeListField(payload.spellAdditions).join(', ')}\n\n`;
      return md.trim();
    },
  },
  Rule: {
    label: 'Rule / House Rule',
    category: 'Rules & Mechanics',
    defaults: {
      ruleCategory: 'Core',
      sourceLabel: '',
      officialEquivalent: '',
      pageReference: '',
      fullText: '',
      mechanicImpact: '',
    },
    sections: [
      { title: 'Rule', fields: [
        { key: 'ruleCategory', label: 'Category', type: 'select', options: HOMEBREW_RULE_CATEGORIES },
        { key: 'sourceLabel', label: 'Source', type: 'text' },
        { key: 'officialEquivalent', label: 'Official Equivalent', type: 'text' },
        { key: 'pageReference', label: 'Page Reference', type: 'text' },
        { key: 'fullText', label: 'Full Text', type: 'textarea' },
        { key: 'mechanicImpact', label: 'Mechanic Impact', type: 'textarea' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Rule',
        ruleCategory: values.ruleCategory || 'Core',
        sourceLabel: values.sourceLabel || '',
        officialEquivalent: values.officialEquivalent || '',
        pageReference: values.pageReference || '',
        fullText: values.fullText || '',
        mechanicImpact: values.mechanicImpact || '',
      };
    },
    toMarkdown(payload) {
      let md = `**Category:** ${payload.ruleCategory || '—'} | **Source:** ${payload.sourceLabel || '—'}\n\n`;
      if (payload.officialEquivalent) md += `**Official Equivalent:** ${payload.officialEquivalent}${payload.pageReference ? ` (${payload.pageReference})` : ''}\n\n`;
      if (payload.fullText) md += `## Full Text\n\n${payload.fullText}\n\n`;
      if (payload.mechanicImpact) md += `## Mechanic Impact\n\n${payload.mechanicImpact}\n\n`;
      return md.trim();
    },
  },
  Mechanic: {
    label: 'Mechanic',
    category: 'Rules & Mechanics',
    defaults: {
      mechanicCategory: 'Combat',
      system: '',
      trigger: '',
      fullRule: '',
      formula: '',
      interactions: '',
      examples: '',
    },
    sections: [
      { title: 'Mechanic', fields: [
        { key: 'mechanicCategory', label: 'Category', type: 'select', options: HOMEBREW_MECHANIC_CATEGORIES },
        { key: 'system', label: 'System', type: 'text' },
        { key: 'trigger', label: 'Trigger / When it Applies', type: 'textarea' },
        { key: 'fullRule', label: 'Full Rule', type: 'textarea' },
        { key: 'formula', label: 'Math / Formula', type: 'text' },
        { key: 'interactions', label: 'Interaction', type: 'textarea' },
        { key: 'examples', label: 'Examples', type: 'textarea' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Mechanic',
        mechanicCategory: values.mechanicCategory || 'Combat',
        system: values.system || '',
        trigger: values.trigger || '',
        fullRule: values.fullRule || '',
        formula: values.formula || '',
        interactions: values.interactions || '',
        examples: values.examples || '',
      };
    },
    toMarkdown(payload) {
      let md = `**Category:** ${payload.mechanicCategory || '—'}${payload.system ? ` | **System:** ${payload.system}` : ''}\n\n`;
      if (payload.trigger) md += `## Trigger\n\n${payload.trigger}\n\n`;
      if (payload.fullRule) md += `## Full Rule\n\n${payload.fullRule}\n\n`;
      if (payload.formula) md += `**Formula:** ${payload.formula}\n\n`;
      if (payload.interactions) md += `## Interaction\n\n${payload.interactions}\n\n`;
      if (payload.examples) md += `## Examples\n\n${payload.examples}\n\n`;
      return md.trim();
    },
  },
  Plane: {
    label: 'Plane',
    category: 'Worlds & Planes',
    defaults: {
      description: '',
      cosmology: 'Great Wheel',
      traits: [],
      inhabitants: [],
      connections: '',
      specialRules: '',
      travelRules: '',
    },
    sections: [
      { title: 'Plane', fields: [
        { key: 'description', label: 'Flavor / Description', type: 'textarea' },
        { key: 'cosmology', label: 'Cosmology', type: 'select', options: HOMEBREW_PLANE_COSMOLOGIES },
        { key: 'traits', label: 'Traits', type: 'chip', opts: { suggestions: OPTION_BANKS.planarTravelRules } },
        { key: 'inhabitants', label: 'Inhabitants', type: 'chip' },
        { key: 'connections', label: 'Connections', type: 'textarea' },
        { key: 'specialRules', label: 'Special Rules', type: 'textarea' },
        { key: 'travelRules', label: 'Travel Rules', type: 'textarea' },
      ]},
    ],
    toPayload(values) {
      return {
        kind: 'Plane',
        description: values.description || '',
        cosmology: values.cosmology || 'Great Wheel',
        traits: normalizeListField(values.traits),
        inhabitants: normalizeListField(values.inhabitants),
        connections: values.connections || '',
        specialRules: values.specialRules || '',
        travelRules: values.travelRules || '',
      };
    },
    toMarkdown(payload) {
      let md = '';
      if (payload.description) md += `${payload.description}\n\n`;
      md += `**Cosmology:** ${payload.cosmology || '—'}\n\n`;
      if (normalizeListField(payload.traits).length) md += `**Traits:** ${normalizeListField(payload.traits).join(', ')}\n\n`;
      if (normalizeListField(payload.inhabitants).length) md += `**Inhabitants:** ${normalizeListField(payload.inhabitants).join(', ')}\n\n`;
      if (payload.connections) md += `## Connections\n\n${payload.connections}\n\n`;
      if (payload.specialRules) md += `## Special Rules\n\n${payload.specialRules}\n\n`;
      if (payload.travelRules) md += `## Travel Rules\n\n${payload.travelRules}\n\n`;
      return md.trim();
    },
  },
};

const HOMEBREW_BUILDER_GROUPS = [
  {
    title: 'Character Options',
    cards: [
      { type: 'Ancestry', label: 'Race / Ancestry', desc: 'Typed ancestry builder with speeds, ASI, languages, traits, and subraces.' },
      { type: 'Background', label: 'Background', desc: 'Typed background builder with proficiencies, equipment, and feature text.' },
      { type: 'Feat', label: 'Feat', desc: 'Typed feat builder with prerequisites, effects, and power tier.' },
      { type: 'Class', label: 'Class', desc: 'Core class schema scaffold with proficiencies, level table, and subclass level.' },
      { type: 'Subclass', label: 'Subclass', desc: 'Typed subclass builder linked to official or custom parent classes.' },
    ],
  },
  {
    title: 'Rules & Mechanics',
    cards: [
      { type: 'Spell', label: 'Spell', desc: 'Typed spell builder with level, school, components, lists, and scaling text.' },
      { type: 'Rule', label: 'Rule / House Rule', desc: 'Typed rule builder with source, equivalent, and impact notes.' },
      { type: 'Mechanic', label: 'Mechanic', desc: 'Typed mechanic builder with trigger, formula, interactions, and examples.' },
    ],
  },
  {
    title: 'Items & Equipment',
    cards: [
      { type: 'Item', label: 'Item / Magic Item', desc: 'Unified item builder with subtype handling for weapon, armour, and magic items.' },
    ],
  },
  {
    title: 'Monsters & Statblocks',
    cards: [
      { type: 'Creature', label: 'Monster / Creature / Beast', desc: 'Typed statblock builder compatible with campaign creature promotion.' },
    ],
  },
  {
    title: 'Worlds & Planes',
    cards: [
      { type: 'Plane', label: 'Plane', desc: 'Typed plane builder with cosmology, traits, inhabitants, and travel rules.' },
    ],
  },
  {
    title: 'Rollable Tables',
    cards: [
      { type: 'Rollable Table', label: 'Rollable Table', desc: 'Open the existing rollable table builder.', special: 'table' },
    ],
  },
];

const HOMEBREW_DIRECT_CREATE_GROUPS = [
  {
    title: 'Character Options',
    buttons: [
      { label: '+ Race / Ancestry', open: (app, plugin) => openHomebrewAncestryModal(app, plugin) },
      { label: '+ Class', open: (app, plugin) => openHomebrewClassModal(app, plugin) },
      { label: '+ Subclass', open: (app, plugin) => openHomebrewSubclassModal(app, plugin) },
      { label: '+ Background', open: (app, plugin) => openHomebrewBackgroundModal(app, plugin) },
      { label: '+ Feat', open: (app, plugin) => openHomebrewFeatModal(app, plugin) },
    ],
  },
  {
    title: 'Items & Equipment',
    buttons: [
      { label: '+ Item / Magic Item', open: (app, plugin) => openHomebrewItemModal(app, plugin) },
      { label: '+ Weapon', open: (app, plugin) => openHomebrewWeaponModal(app, plugin) },
      { label: '+ Armour', open: (app, plugin) => openHomebrewArmourModal(app, plugin) },
    ],
  },
  {
    title: 'Creatures & Encounters',
    buttons: [
      { label: '+ Creature / Monster / Beast', open: (app, plugin) => openHomebrewCreatureModal(app, plugin) },
    ],
  },
  {
    title: 'Rules & Systems',
    buttons: [
      { label: '+ Spell', open: (app, plugin) => openHomebrewSpellModal(app, plugin) },
      { label: '+ Rule / House Rule', open: (app, plugin) => openHomebrewRuleModal(app, plugin) },
      { label: '+ Mechanic', open: (app, plugin) => openHomebrewMechanicModal(app, plugin) },
    ],
  },
  {
    title: 'Worldbuilding',
    buttons: [
      { label: '+ Plane', open: (app, plugin) => openHomebrewPlaneModal(app, plugin) },
    ],
  },
  {
    title: 'Tables',
    buttons: [
      { label: '+ Rollable Table', open: (app, plugin) => openHomebrewRollableTableModal(app, plugin) },
    ],
  },
];

function openHomebrewBuilder(app, plugin, type, item) {
  if (type === 'Rollable Table') { new RollableTableModal(app, plugin, item).open(); return; }
  new TypedHomebrewModal(app, plugin, type, item).open();
}
function openHomebrewSpellModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Spell', Object.assign({ modalLabel: 'Homebrew Spell' }, item || {})); }
function openHomebrewFeatModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Feat', Object.assign({ modalLabel: 'Homebrew Feat' }, item || {})); }
function openHomebrewBackgroundModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Background', Object.assign({ modalLabel: 'Homebrew Background' }, item || {})); }
function openHomebrewAncestryModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Ancestry', Object.assign({ modalLabel: 'Homebrew Race / Ancestry' }, item || {})); }
function openHomebrewClassModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Class', Object.assign({ modalLabel: 'Homebrew Class' }, item || {})); }
function openHomebrewSubclassModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Subclass', Object.assign({ modalLabel: 'Homebrew Subclass' }, item || {})); }
function openHomebrewItemModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Item', Object.assign({ modalLabel: 'Homebrew Item / Magic Item', itemType: 'Magic Item' }, item || {})); }
function openHomebrewWeaponModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Item', Object.assign({ modalLabel: 'Homebrew Weapon', itemType: 'Weapon', type: 'Weapon', homebrewType: 'Item' }, item || {})); }
function openHomebrewArmourModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Item', Object.assign({ modalLabel: 'Homebrew Armour', itemType: 'Armour', type: 'Armour', homebrewType: 'Item' }, item || {})); }
function openHomebrewCreatureModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Creature', Object.assign({ modalLabel: 'Homebrew Creature / Monster / Beast' }, item || {})); }
function openHomebrewRuleModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Rule', Object.assign({ modalLabel: 'Homebrew Rule / House Rule' }, item || {})); }
function openHomebrewPlaneModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Plane', Object.assign({ modalLabel: 'Homebrew Plane' }, item || {})); }
function openHomebrewMechanicModal(app, plugin, item) { openHomebrewBuilder(app, plugin, 'Mechanic', Object.assign({ modalLabel: 'Homebrew Mechanic' }, item || {})); }
function openHomebrewRollableTableModal(app, plugin, item) { new RollableTableModal(app, plugin, item).open(); }
function openHomebrewEditor(app, plugin, item) {
  const h = normalizeHomebrewRecord(item || {});
  const builderType = canonicalHomebrewBuilderType(h.homebrewType || h.type);
  if (HOMEBREW_BUILDERS[builderType]) {
    const seed = Object.assign({}, h);
    if (builderType === 'Item' && !seed.itemType && ['Weapon', 'Armour', 'Armor', 'Magic Item'].includes(h.homebrewType || h.type)) seed.itemType = h.homebrewType === 'Armor' ? 'Armour' : (h.homebrewType || h.type);
    if (builderType === 'Creature' && !seed.creatureKind && ['Monster', 'Creature', 'Beast'].includes(h.homebrewType || h.type)) seed.creatureKind = h.homebrewType || h.type;
    if (builderType === 'Item' && seed.itemType === 'Weapon') seed.modalLabel = 'Homebrew Weapon';
    else if (builderType === 'Item' && seed.itemType === 'Armour') seed.modalLabel = 'Homebrew Armour';
    else if (builderType === 'Item') seed.modalLabel = 'Homebrew Item / Magic Item';
    else if (builderType === 'Creature') seed.modalLabel = 'Homebrew Creature / Monster / Beast';
    else if (builderType === 'Ancestry') seed.modalLabel = 'Homebrew Race / Ancestry';
    else seed.modalLabel = `Homebrew ${builderType}`;
    openHomebrewBuilder(app, plugin, builderType, seed);
    return;
  }
  new HomebrewModal(app, plugin, item).open();
}

function renderLibrary(main, plugin, tabs) {
  return renderReference(main, plugin, tabs);
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

function rollStructuredTable(formula, rows) {
  const structured = (Array.isArray(rows) ? rows : []).filter(r => r.result);
  if (!structured.length) return 'No rows defined.';
  const m = String(formula || '1d6').match(/^(\d+)d(\d+)$/i);
  const count = m ? Math.max(1, parseInt(m[1])) : 1;
  const sides = m ? Math.max(1, parseInt(m[2])) : 6;
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
  const matched = structured.find(r => total >= (Number(r.min) || 1) && total <= (Number(r.max) || Number(r.min) || sides));
  return matched
    ? `${total}: ${matched.result}${matched.notes ? ` — ${matched.notes}` : ''}`
    : `${total}: No matching row.`;
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
function renderHomebrew(main, plugin, tabs) {
  const state = plugin.state;
  pageHead(main, plugin, 'Library & Homebrew', 'Create and manage homebrew content for your campaign.', [], tabs);

  sectionHead(main, 'Creation Buttons');
  HOMEBREW_DIRECT_CREATE_GROUPS.forEach(group => {
    const card = ce(main, 'div', 'te-card');
    card.style.marginBottom = '12px';
    const head = ce(card, 'div', 'te-card-head');
    ce(head, 'h3', 'te-card-title', group.title);
    const grid = ce(card, 'div', 'te-grid');
    grid.style.marginTop = '8px';
    safeArr(group.buttons).forEach(buttonDef => {
      const tile = ce(grid, 'div', 'te-card');
      tile.style.minHeight = 'unset';
      ce(tile, 'h4', 'te-card-title', buttonDef.label);
      const acts = ce(tile, 'div', 'te-card-actions');
      btn(acts, buttonDef.label, 'te-btn is-sm is-primary', () => buttonDef.open(plugin.app, plugin));
    });
  });

  // Local filter state
  const hbFilter = { search: '', status: '', visibility: '', type: '' };

  const filterCard = ce(main, 'div', 'te-card');
  filterCard.style.marginBottom = '12px';
  const filterRow = ce(filterCard, 'div', '');
  filterRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center';

  const searchIn = ce(filterRow, 'input');
  searchIn.type = 'text'; searchIn.placeholder = 'Search name…';
  searchIn.style.cssText = 'flex:1;min-width:140px;padding:4px 8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';

  const statusSel = ce(filterRow, 'select');
  statusSel.style.cssText = 'padding:4px 6px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  [['', 'All Status'], ...HOMEBREW_STATUS_OPTIONS.map(v => [v, v])].forEach(([v, l]) => {
    const o = ce(statusSel, 'option', '', l); o.value = v;
  });

  const visSel = ce(filterRow, 'select');
  visSel.style.cssText = statusSel.style.cssText;
  [['', 'All Visibility'], ['dm-only', 'DM Only'], ['player-visible', 'Player Visible'], ['secret', 'Secret'], ['revealed', 'Revealed']].forEach(([v, l]) => {
    const o = ce(visSel, 'option', '', l); o.value = v;
  });

  const typeSel = ce(filterRow, 'select');
  typeSel.style.cssText = statusSel.style.cssText;
  const hbTypes = [...new Set(safeArr(state.entities.homebrew).map(item => normalizeHomebrewRecord(item).homebrewType).filter(Boolean))].sort();
  [['', 'All Types'], ...hbTypes.map(v => [v, v])].forEach(([v, l]) => {
    const o = ce(typeSel, 'option', '', l); o.value = v;
  });

  btn(filterRow, '× Clear', 'te-btn is-sm', () => {
    searchIn.value = ''; statusSel.value = ''; visSel.value = ''; typeSel.value = '';
    Object.assign(hbFilter, { search: '', status: '', visibility: '', type: '' });
    rebuildHb();
  });

  const contentArea = ce(main, 'div', '');

  const rebuildHb = () => {
    clear(contentArea);
    const q = hbFilter.search.toLowerCase();
    const items = safeArr(state.entities.homebrew).map(item => normalizeHomebrewRecord(item)).filter(item => {
      const searchText = [item.name, item.type, item.homebrewType, item.category, item.summary, safeArr(item.tags).join(' ')].join(' ').toLowerCase();
      if (q && !searchText.includes(q)) return false;
      if (hbFilter.status && item.status !== hbFilter.status) return false;
      if (hbFilter.visibility && item.visibility !== hbFilter.visibility) return false;
      if (hbFilter.type && item.homebrewType !== hbFilter.type) return false;
      return true;
    });
    const all = safeArr(state.entities.homebrew).length;
    sectionHead(contentArea, `Existing Homebrew${items.length !== all ? ` (${items.length} of ${all})` : ''}`);
    if (!items.length) {
      ce(contentArea, 'p', 'te-muted-text', 'No homebrew entries match the current filters.');
    } else {
      itemCards(contentArea, plugin, 'homebrew', {
        items,
        meta: ['homebrewType', 'category', 'status', 'visibility', 'scope'],
        onEdit: (plugin, key, item) => openHomebrewEditor(plugin.app, plugin, item),
      });
    }
  };

  const onChange = () => {
    hbFilter.search = searchIn.value;
    hbFilter.status = statusSel.value;
    hbFilter.visibility = visSel.value;
    hbFilter.type = typeSel.value;
    rebuildHb();
  };
  searchIn.addEventListener('input', onChange);
  statusSel.addEventListener('change', onChange);
  visSel.addEventListener('change', onChange);
  typeSel.addEventListener('change', onChange);

  rebuildHb();
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
    ['NPC Trait', '🎭', 'Personality + distinctive quirk'],
    ['Settlement Name', '🏘️', 'Fantasy settlement name'],
    ['Tavern Name', '🍺', 'Inn or tavern name'],
    ['Faction Name', '⚔️', 'Named organisation or faction'],
    ['Quest Hook', '📋', 'Adventure hook premise'],
    ['Rumour', '💬', 'Tavern rumour or lead'],
    ['Loot', '💰', 'Treasure or loot drop'],
    ['Weather', '⛅', 'Current weather conditions'],
    ['Travel Event', '🚶', 'Random travel encounter or event'],
    ['Dungeon Room', '🚪', 'Room purpose and notable feature'],
    ['Wild Magic Surge', '🌀', 'Chaotic magical mishap result'],
    ['Plot Twist', '🎭', 'Unexpected narrative reversal for your campaign'],
    ['Town Event', '🏘️', 'Random event happening in the current settlement'],
    ['Trap', '⚠️', 'Trap type, trigger, effect, and tell'],
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

  sectionHead(main, 'Complete Entity Generators');
  const ceg = ce(main, 'div', 'te-grid');
  const entityGens = [
    ['Complete NPC', '👤', 'Generate a full NPC — name, ancestry, personality, motivation, secret, and quest hook', generateCompleteNPC, 'npcs', NPCModal],
    ['Complete Settlement', '🏘️', 'Generate a full settlement — name, type, government, economy, problems, and quest hook', generateCompleteSettlement, 'settlements', null],
    ['Complete Faction', '⚔️', 'Generate a full faction — name, type, goals, methods, public face, and secret agenda', generateCompleteFaction, 'factions', FactionModal],
    ['Complete Quest', '📋', 'Generate a full quest — name, type, objectives, complications, and rewards', generateCompleteQuest, 'quests', QuestModal],
    ['Complete POI', '📍', 'Generate a full point of interest — type, hazard, hook, and entity links', generateCompletePOI, 'pois', null],
    ['Complete Encounter', '⚔️', 'Generate a full encounter — type, enemies, difficulty, twist, and reward', generateCompleteEncounter, 'encounters', EncounterModal],
    ['Complete Tavern', '🍺', 'Generate a full tavern — name, quality, owner, rumour, and settlement link', generateCompleteTavern, 'locations', null],
    ['Complete Shop', '🛒', 'Generate a full shop — type, owner, quirk, and stock summary', generateCompleteShop, 'locations', null],
    ['Complete Rumour', '💬', 'Generate a full rumour — text, source, and accuracy rating', generateCompleteRumour, 'secrets', null],
    ['Complete Secret', '🔒', 'Generate a full secret — type, holder, consequence, and status', generateCompleteSecret, 'secrets', null],
    ['Complete Dungeon Room', '🚪', 'Generate a full dungeon room — purpose, features, exits, and hazard', generateCompleteDungeonRoom, 'locations', null],
    ['Complete Loot', '💰', 'Generate a full loot entry — type, rarity, items, and value', generateCompleteLoot, 'loot', null],
    ['Complete Travel Event', '🚶', 'Generate a full travel event — type, summary, duration, and outcome', generateCompleteTravelEvent, 'sessions', null],
    ['Complete Noble House', '🏰', 'Generate a full noble house — name, status, motto, holdings, and secrets', generateCompleteNobleHouse, 'nobleFamilies', NobleFamilyModal],
  ];
  entityGens.forEach(([label, icon, desc, genFn, entityKey, ModalClass]) => {
    const c = ce(ceg, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head'); ce(hd, 'span', 'te-card-icon', icon); ce(hd, 'h3', 'te-card-title', label);
    ce(c, 'p', 'te-card-body', desc);
    const acts = ce(c, 'div', 'te-card-actions');
    btn(acts, 'Generate', 'te-btn is-primary', () => {
      const draft = genFn(plugin.state);
      new EntityDraftModal(plugin.app, plugin, label, draft, entityKey, ModalClass).open();
    });
  });

  sectionHead(main, 'Generator History');
  const activeCamp = activeCampaign(plugin.state);
  const allHist = safeArr(plugin.state.generatorHistory);
  const hist = activeCamp ? allHist.filter(h => !h.campaignId || h.campaignId === activeCamp.id) : allHist;
  if (!hist.length) { emptyState(main, 'No generated results yet.', 'Use the generators above to create content.'); return; }
  const hg = ce(main, 'div', 'te-grid');
  hist.slice(0, 30).forEach((h, i) => {
    const c = ce(hg, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '✨');
    ce(hd, 'h3', 'te-card-title', h.type || 'Generated');
    ce(c, 'p', 'te-card-body', h.result || '');
    const acts = ce(c, 'div', 'te-card-actions');
    // Save as entity buttons based on type
    if (h.type === 'NPC Name') {
      btn(acts, 'Save as NPC', 'te-btn is-sm is-primary', () => new NPCModal(plugin.app, plugin, { name: h.result }).open());
    } else if (h.type === 'Settlement Name') {
      btn(acts, 'Save as Settlement', 'te-btn is-sm is-primary', () => new GenericModal(plugin.app, plugin, 'settlements', { name: h.result }, settlementFields).open());
    } else if (h.type === 'Tavern Name') {
      btn(acts, 'Save as Location', 'te-btn is-sm is-primary', () => new GenericModal(plugin.app, plugin, 'locations', { name: h.result }, locationFields).open());
    } else if (h.type === 'Quest Hook') {
      btn(acts, 'Save as Quest', 'te-btn is-sm is-primary', () => new QuestModal(plugin.app, plugin, { name: h.result.split('.')[0], summary: h.result }).open());
    } else if (h.type === 'Faction Name') {
      btn(acts, 'Save as Faction', 'te-btn is-sm is-primary', () => new FactionModal(plugin.app, plugin, { name: h.result }).open());
    } else if (h.type === 'NPC Trait') {
      btn(acts, 'Save as NPC', 'te-btn is-sm is-primary', () => new NPCModal(plugin.app, plugin, { name: 'New NPC', notes: h.result }).open());
    } else {
      btn(acts, 'Save as Note', 'te-btn is-sm', async () => {
        h.savedAt = new Date().toISOString();
        await writeNote(plugin.app, normalizePath(`${campaignFolder(plugin)}/Compendium/Generated/${slugify(h.type)}-${Date.now()}.md`), `# ${h.type}\n\n${h.result}`);
        await plugin.saveState();
        new Notice('Saved to vault.');
      });
    }
    btn(acts, '× Clear', 'te-btn is-sm', async () => { plugin.state.generatorHistory.splice(i, 1); await plugin.saveState(); });
  });
  if (hist.length > 5) {
    const ra = ce(main, 'div', 'te-modal-actions');
    btn(ra, '🗑️ Clear All History', 'te-btn is-danger', async () => { plugin.state.generatorHistory = []; await plugin.saveState(); new Notice('Generator history cleared.'); });
  }
}

// ── CAMPAIGN BIBLE (Phase 7) ──────────────────────────────────────────────────
function renderCampaignBible(main, plugin, tabs) {
  const state = plugin.state;
  const camp = activeCampaign(state);
  pageHead(main, plugin, 'Campaign Bible', 'Campaign premise, acts, secrets, milestones, and linked campaign structure.', [
    { label: '✏️ Edit Bible', primary: true, onClick: () => new CampaignBibleModal(plugin.app, plugin, camp).open() },
    { label: '+ Act', onClick: () => {
      const newAct = { id: uid('act'), campaignId: camp ? camp.id : '', order: safeArr(state.entities.acts).filter(a => !camp || a.campaignId === camp.id).length + 1 };
      new GenericModal(plugin.app, plugin, 'acts', newAct, actFields).open();
    }},
    { label: '+ Milestone', onClick: () => new GenericModal(plugin.app, plugin, 'milestones', { id: uid('milestone'), campaignId: camp ? camp.id : '' }, milestoneFields).open() },
    { label: '📤 Export', onClick: () => exportCampaignBible(plugin) },
  ], tabs);
  if (!camp) { emptyState(main, 'No active campaign.', 'Create and activate a campaign first.'); return; }

  const bib = camp.bible || {};
  const campId = camp.id;

  // ── Overview ──
  sectionHead(main, 'Campaign Overview');
  const premise = ce(main, 'div', 'te-card');
  const ph = ce(premise, 'div', 'te-card-head');
  ce(ph, 'span', 'te-card-icon', '📜');
  ce(ph, 'h3', 'te-card-title', camp.name);
  if (camp.tagline) { const tl = ce(premise, 'p', 'te-card-body', camp.tagline); tl.style.fontStyle = 'italic'; }
  if (bib.premise) ce(premise, 'p', 'te-card-body', bib.premise);
  const pm = ce(premise, 'div', 'te-card-meta');
  const worldName = camp.worldName || (safeArr(state.entities.worlds).find(w => w.campaignId === campId) || {}).name || '';
  const overviewMeta = [
    ['World', worldName],
    ['Tone', bib.tone || (Array.isArray(camp.tone) ? camp.tone.join(', ') : camp.tone) || ''],
    ['Genre', bib.genre || (Array.isArray(camp.genres) ? camp.genres.join(', ') : '') || ''],
    ['Scope', bib.scope || ''],
    ['Ruleset', bib.ruleset || camp.ruleset || ''],
    ['Level Range', camp.levelRange || ''],
    ['Levelling', camp.levellingMethod || ''],
    ['Players', camp.playerCount ? String(camp.playerCount) : ''],
    ['Format', camp.format || ''],
    ['Status', camp.status || ''],
  ];
  overviewMeta.forEach(([k, v]) => {
    if (!v) return;
    const r = ce(pm, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v);
  });
  if (safeArr(bib.themes).length || safeArr(camp.themes).length) {
    const themes = safeArr(bib.themes).length ? bib.themes : camp.themes;
    const r = ce(pm, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Themes'); ce(r, 'span', '', themes.join(', '));
  }

  // ── Acts ──
  const actEntities = safeArr(state.entities.acts).filter(a => a.campaignId === campId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const bibActs = safeArr(bib.acts);
  sectionHead(main, 'Act Structure');
  if (actEntities.length || bibActs.length) {
    const g = ce(main, 'div', 'te-grid');
    // Entity-backed acts (preferred)
    actEntities.forEach((act, i) => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head');
      ce(h, 'span', 'te-card-icon', `${act.order || i + 1}.`);
      ce(h, 'h3', 'te-card-title', act.name || `Act ${act.order || i + 1}`);
      if (act.status && act.status !== 'Draft') { const sb = ce(h, 'span', 'te-chip', act.status); sb.style.fontSize = '.72rem'; }
      if (act.summary) ce(c, 'p', 'te-card-body', act.summary.slice(0, 120));
      const mt = ce(c, 'div', 'te-card-meta');
      if (act.levelStart || act.levelEnd) {
        const r = ce(mt, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Levels');
        ce(r, 'span', '', `${act.levelStart || '?'}–${act.levelEnd || '?'}`);
      }
      // Linked adventures
      const linkedAdvs = safeArr(state.entities.adventures).filter(a => a.actId === act.id);
      if (linkedAdvs.length) {
        const ar = ce(mt, 'div', 'te-card-meta-row'); ce(ar, 'span', 'te-card-meta-label', 'Adventures');
        ce(ar, 'span', '', linkedAdvs.map(a => a.name).join(', ').slice(0, 80));
      }
      // Linked quests via adventures
      const advIds = linkedAdvs.map(a => a.id);
      const linkedQs = safeArr(state.entities.quests).filter(q => q.adventureId && advIds.includes(q.adventureId));
      if (linkedQs.length) {
        const qr = ce(mt, 'div', 'te-card-meta-row'); ce(qr, 'span', 'te-card-meta-label', 'Quests');
        ce(qr, 'span', '', linkedQs.map(q => q.name).join(', ').slice(0, 80));
      }
      const aa = ce(c, 'div', 'te-card-actions');
      btn(aa, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'acts', act, actFields).open());
      btn(aa, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(state, 'acts', act.id); await plugin.saveState(); });
    });
    // Legacy bible acts (not yet migrated to entities)
    if (!actEntities.length) {
      bibActs.forEach((act, i) => {
        const c = ce(g, 'div', 'te-card');
        const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', `${i + 1}.`); ce(h, 'h3', 'te-card-title', act.title || `Act ${i + 1}`);
        if (act.summary) ce(c, 'p', 'te-card-body', act.summary);
        const aa = ce(c, 'div', 'te-card-actions');
        btn(aa, 'Promote to Entity', 'te-btn is-sm', async () => {
          upsert(state, 'acts', { id: uid('act'), campaignId: campId, name: act.title || `Act ${i + 1}`, order: i + 1, summary: act.summary || '', status: 'Draft', createdAt: new Date().toISOString() });
          await plugin.saveState();
        });
      });
    }
  } else { emptyState(main, 'No acts defined.', 'Click "+ Act" above to create your first act.'); }

  // ── Adventures ──
  const campAdvs = safeArr(state.entities.adventures).filter(a => !a.campaignId || a.campaignId === campId);
  if (campAdvs.length) {
    sectionHead(main, 'Adventures');
    const ag = ce(main, 'div', 'te-grid');
    campAdvs.slice(0, 20).forEach(adv => {
      const c = ce(ag, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '📝'); ce(h, 'h3', 'te-card-title', adv.name);
      if (adv.status) { const sb = ce(h, 'span', 'te-chip', adv.status); sb.style.fontSize = '.72rem'; }
      if (adv.premise || adv.summary) ce(c, 'p', 'te-card-body', (adv.premise || adv.summary || '').slice(0, 100));
      btn(ce(c, 'div', 'te-card-actions'), 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'adventures', adv, adventureFields).open());
    });
  }

  // ── Quests ──
  const campQuests = safeArr(state.entities.quests).filter(q => !q.campaignId || q.campaignId === campId);
  if (campQuests.length) {
    sectionHead(main, 'Quests');
    const qg = ce(main, 'div', 'te-grid');
    campQuests.slice(0, 20).forEach(q => {
      const c = ce(qg, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '📋'); ce(h, 'h3', 'te-card-title', q.name);
      if (q.status) { const sb = ce(h, 'span', 'te-chip', q.status); sb.style.fontSize = '.72rem'; }
      if (q.summary || q.premise) ce(c, 'p', 'te-card-body', (q.summary || q.premise || '').slice(0, 100));
      btn(ce(c, 'div', 'te-card-actions'), 'Edit', 'te-btn is-sm', () => defaultEdit(plugin, 'quests', q));
    });
  }

  // ── Milestones ──
  sectionHead(main, 'Milestones');
  const milestones = safeArr(state.entities.milestones).filter(m => !m.campaignId || m.campaignId === campId);
  if (milestones.length) {
    const g = ce(main, 'div', 'te-grid');
    milestones.forEach(m => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🏆'); ce(h, 'h3', 'te-card-title', m.name);
      if (m.summary) ce(c, 'p', 'te-card-body', m.summary.slice(0, 100));
      const mt = ce(c, 'div', 'te-card-meta');
      [['Level', m.level], ['Status', m.status], ['Type', m.type]].forEach(([k, v]) => { if (!v) return; const r = ce(mt, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'milestones', m, milestoneFields).open());
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(state, 'milestones', m.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No milestones.', 'Click "+ Milestone" above to add milestones.'); }

  // ── Major Factions ──
  const campFactions = safeArr(state.entities.factions).filter(f => !f.campaignId || f.campaignId === campId);
  if (campFactions.length) {
    sectionHead(main, 'Major Factions');
    const fg = ce(main, 'div', 'te-grid');
    campFactions.slice(0, 20).forEach(fac => {
      const c = ce(fg, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '⚔️'); ce(h, 'h3', 'te-card-title', fac.name);
      if (fac.summary) ce(c, 'p', 'te-card-body', fac.summary.slice(0, 100));
      btn(ce(c, 'div', 'te-card-actions'), 'Edit', 'te-btn is-sm', () => defaultEdit(plugin, 'factions', fac));
    });
  }

  // ── Domains ──
  const campDomains = safeArr(state.entities.domains).filter(d => !d.campaignId || d.campaignId === campId);
  if (campDomains.length) {
    sectionHead(main, 'Domains');
    const dg = ce(main, 'div', 'te-grid');
    campDomains.slice(0, 20).forEach(dom => {
      const c = ce(dg, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🏰'); ce(h, 'h3', 'te-card-title', dom.name);
      if (dom.summary) ce(c, 'p', 'te-card-body', dom.summary.slice(0, 100));
      const mt = ce(c, 'div', 'te-card-meta');
      [['Type', dom.type], ['Scale', dom.scale || dom.size]].forEach(([k, v]) => {
        if (!v) return;
        const r = ce(mt, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v));
      });
      btn(ce(c, 'div', 'te-card-actions'), 'Edit', 'te-btn is-sm', () => defaultEdit(plugin, 'domains', dom));
    });
  }

  // ── DM Secrets Register ──
  sectionHead(main, 'DM Secrets Register');
  const dmSecrets = safeArr(state.entities.secrets).filter(s => (!s.campaignId || s.campaignId === campId) && (s.visibility === 'dm-only' || !s.visibility));
  if (dmSecrets.length) {
    const g = ce(main, 'div', 'te-grid');
    dmSecrets.forEach(s => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🔒'); ce(h, 'h3', 'te-card-title', s.name);
      if (s.summary) ce(c, 'p', 'te-card-body', (s.summary || '').slice(0, 120));
      const m = ce(c, 'div', 'te-card-meta');
      if (s.secretType) { const r = ce(m, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'type'); ce(r, 'span', '', s.secretType); }
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new SecretModal(plugin.app, plugin, s).open());
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(state, 'secrets', s.id); await plugin.saveState(); new Notice('Secret deleted.'); });
    });
  } else { emptyState(main, 'No DM secrets.', 'Add secrets in the Secrets & Reveals section.'); }

  if (bib.playerPrimer) {
    sectionHead(main, 'Player Primer');
    const p = ce(main, 'div', 'te-card');
    ce(p, 'p', 'te-card-body', bib.playerPrimer);
    btn(ce(p, 'div', 'te-card-actions'), '📤 Export Player Packet', 'te-btn is-sm is-primary', () => exportPlayerSafePacket(plugin));
  }

  sectionHead(main, 'Session History');
  const sessionLog = safeArr(state.entities.sessions).filter(s => !s.campaignId || s.campaignId === campId).slice().sort((a, b) => {
    const da = new Date(a.date || a.createdAt || 0), db = new Date(b.date || b.createdAt || 0);
    return db - da;
  });
  if (sessionLog.length) {
    const sg = ce(main, 'div', 'te-grid');
    sessionLog.slice(0, 12).forEach(s => {
      const c = ce(sg, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '📅'); ce(h, 'h3', 'te-card-title', s.name || `Session ${s.sessionNumber || ''}`);
      if (s.summary || s.notes) ce(c, 'p', 'te-card-body', (s.summary || s.notes || '').slice(0, 100));
      const m = ce(c, 'div', 'te-card-meta');
      [['Date', s.date || s.realDate], ['Status', s.status], ['Players', s.players]].forEach(([k, v]) => { if (!v) return; const r = ce(m, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v)); });
      btn(ce(c, 'div', 'te-card-actions'), 'View Log', 'te-btn is-sm', async () => { state.activeSubSection = 'sessions'; await plugin.saveState(); });
    });
    if (sessionLog.length > 12) { const ra = ce(main, 'div', 'te-modal-actions'); btn(ra, `View All ${sessionLog.length} Sessions →`, 'te-btn', async () => { state.activeSubSection = 'sessions'; await plugin.saveState(); }); }
  } else { emptyState(main, 'No sessions logged yet.', 'Log sessions in Sessions & Timeline.'); }
}

async function exportCampaignBible(plugin) {
  const state = plugin.state;
  const camp = activeCampaign(state);
  if (!camp) { new Notice('No active campaign.'); return; }
  const bib = camp.bible || {};
  const folder = campaignFolder(plugin);
  const campId = camp.id;
  const lines = [];

  // Minimal YAML frontmatter
  lines.push('---');
  lines.push('ttrpg-engine: true');
  lines.push('entityType: campaign-bible');
  lines.push(`campaignId: ${campId}`);
  lines.push(`createdAt: ${new Date().toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Campaign Bible — ${camp.name}`);
  lines.push(`*Generated ${new Date().toLocaleDateString()}*`);
  lines.push('');

  // Overview
  if (camp.tagline) lines.push(`> ${camp.tagline}\n`);
  if (bib.premise || camp.premise || camp.summary) lines.push(`## Premise\n\n${bib.premise || camp.premise || camp.summary}\n`);

  const meta = [];
  const worldName = camp.worldName || (safeArr(state.entities.worlds).find(w => w.campaignId === campId) || {}).name || '';
  if (worldName) meta.push(`**World:** ${worldName}`);
  if (bib.tone || camp.tone) meta.push(`**Tone:** ${bib.tone || (Array.isArray(camp.tone) ? camp.tone.join(', ') : camp.tone)}`);
  if (bib.genre || camp.genres) meta.push(`**Genre:** ${bib.genre || (Array.isArray(camp.genres) ? camp.genres.join(', ') : camp.genres)}`);
  if (bib.ruleset || camp.ruleset) meta.push(`**Ruleset:** ${bib.ruleset || camp.ruleset}`);
  if (camp.levelRange) meta.push(`**Levels:** ${camp.levelRange}`);
  if (camp.levellingMethod) meta.push(`**Levelling:** ${camp.levellingMethod}`);
  if (camp.playerCount) meta.push(`**Players:** ${camp.playerCount}`);
  if (camp.format) meta.push(`**Format:** ${camp.format}`);
  if (meta.length) lines.push(meta.join(' | ') + '\n');

  const themes = safeArr(bib.themes).length ? bib.themes : safeArr(camp.themes);
  if (themes.length) lines.push(`**Themes:** ${themes.join(', ')}\n`);

  // Acts
  const actEntities = safeArr(state.entities.acts).filter(a => a.campaignId === campId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const bibActs = safeArr(bib.acts);
  const allActs = actEntities.length ? actEntities : bibActs;
  if (allActs.length) {
    lines.push('## Act Structure\n');
    allActs.forEach((act, i) => {
      const num = act.order || i + 1;
      const name = act.name || act.title || `Act ${num}`;
      lines.push(`### Act ${num}: ${name}`);
      if (act.status) lines.push(`*Status: ${act.status}*`);
      if (act.levelStart || act.levelEnd) lines.push(`*Levels ${act.levelStart || '?'}–${act.levelEnd || '?'}*`);
      if (act.summary) lines.push(`\n${act.summary}`);
      if (act.goal) lines.push(`\n**Goal:** ${act.goal}`);
      if (act.turningPoint) lines.push(`\n**Turning Point:** ${act.turningPoint}`);
      const linkedAdvs = actEntities.length ? safeArr(state.entities.adventures).filter(a => a.actId === act.id) : [];
      if (linkedAdvs.length) lines.push(`\n**Adventures:** ${linkedAdvs.map(a => a.name).join(', ')}`);
      lines.push('');
    });
  }

  // Adventures
  const advs = safeArr(state.entities.adventures).filter(a => !a.campaignId || a.campaignId === campId);
  if (advs.length) {
    lines.push('## Adventures\n');
    advs.forEach(adv => {
      lines.push(`### ${adv.name}`);
      if (adv.status) lines.push(`*${adv.status}*`);
      if (adv.premise || adv.summary) lines.push(`\n${adv.premise || adv.summary}`);
      lines.push('');
    });
  }

  // Quests
  const quests = safeArr(state.entities.quests).filter(q => !q.campaignId || q.campaignId === campId);
  if (quests.length) {
    lines.push('## Quests\n');
    quests.forEach(q => {
      const statusStr = q.status ? ` *(${q.status})*` : '';
      lines.push(`- **${q.name}**${statusStr}${q.summary ? ': ' + q.summary.slice(0, 120) : ''}`);
    });
    lines.push('');
  }

  // Milestones
  const milestones = safeArr(state.entities.milestones).filter(m => !m.campaignId || m.campaignId === campId);
  if (milestones.length) {
    lines.push('## Milestones\n');
    milestones.forEach(m => {
      const statusStr = m.status ? ` *(${m.status})*` : '';
      lines.push(`- **${m.name}**${statusStr}${m.summary ? ': ' + m.summary.slice(0, 100) : ''}`);
    });
    lines.push('');
  }

  // Factions
  const factions = safeArr(state.entities.factions).filter(f => !f.campaignId || f.campaignId === campId);
  if (factions.length) {
    lines.push('## Major Factions\n');
    factions.forEach(f => {
      lines.push(`### ${f.name}`);
      if (f.summary) lines.push(f.summary.slice(0, 200));
      lines.push('');
    });
  }

  // Major NPCs
  const npcs = safeArr(state.entities.npcs).filter(n => !n.campaignId || n.campaignId === campId);
  if (npcs.length) {
    lines.push('## Major NPCs\n');
    npcs.slice(0, 30).forEach(n => {
      const role = n.role ? ` — ${n.role}` : '';
      const faction = n.faction ? ` (${n.faction})` : '';
      lines.push(`- **${n.name}**${role}${faction}${n.summary ? ': ' + n.summary.slice(0, 100) : ''}`);
    });
    lines.push('');
  }

  // Sessions summary
  const sessions = safeArr(state.entities.sessions).filter(s => !s.campaignId || s.campaignId === campId).sort((a, b) => {
    const da = new Date(a.date || a.realDate || a.createdAt || 0), db = new Date(b.date || b.realDate || b.createdAt || 0);
    return da - db;
  });
  if (sessions.length) {
    lines.push('## Session History\n');
    sessions.forEach(s => {
      const dateStr = s.date || s.realDate ? ` (${s.date || s.realDate})` : '';
      lines.push(`- **${s.name || 'Session'}**${dateStr}${s.recap || s.summary ? ': ' + (s.recap || s.summary || '').slice(0, 120) : ''}`);
    });
    lines.push('');
  }

  // Secrets summary (DM only)
  const secrets = safeArr(state.entities.secrets).filter(s => (!s.campaignId || s.campaignId === campId) && (s.visibility === 'dm-only' || !s.visibility));
  if (secrets.length) {
    lines.push('## DM Secrets\n');
    secrets.forEach(s => {
      lines.push(`- **${s.name}**${s.secretType ? ' (' + s.secretType + ')' : ''}${s.revealStatus ? ' — ' + s.revealStatus : ''}`);
    });
    lines.push('');
  }

  if (bib.playerPrimer) lines.push(`## Player Primer\n\n${bib.playerPrimer}\n`);
  if (bib.notes) lines.push(`## DM Notes\n\n${bib.notes}\n`);

  const biblePath = `${folder}/Campaign Command Centre/Campaign Bible.md`;
  await ensureFolder(plugin.app, `${folder}/Campaign Command Centre`);
  await writeNote(plugin.app, biblePath, lines.join('\n'));
  new Notice(`Campaign Bible exported to ${biblePath}`);
}

// ── GAZETTEER (Phase 9) ────────────────────────────────────────────────────────
function renderGazetteer(main, plugin, tabs) {
  pageHead(main, plugin, 'Gazetteer', 'Regions, settlements, dungeons, and locations at a glance.', [
    { label: '+ Region', onClick: () => new GenericModal(plugin.app, plugin, 'regions', null, regionFields).open() },
    { label: '+ Domain', onClick: () => new GenericModal(plugin.app, plugin, 'domains', null, domainFields).open() },
    { label: '+ Settlement', onClick: () => new GenericModal(plugin.app, plugin, 'settlements', null, settlementFields).open() },
    { label: '+ Dungeon', primary: true, onClick: () => new DungeonModal(plugin.app, plugin).open() },
  ], tabs);

  const camp = activeCampaign(plugin.state);
  const campFilter = item => !item.campaignId || !camp || item.campaignId === camp.id;

  sectionHead(main, 'Regions');
  const regions = safeArr(plugin.state.entities.regions).filter(campFilter).filter(x => matchesSearch(x, plugin.state.search));
  if (regions.length) {
    const g = ce(main, 'div', 'te-grid');
    regions.forEach(r => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🗺️'); ce(h, 'h3', 'te-card-title', r.name);
      if (r.summary) ce(c, 'p', 'te-card-body', (r.summary || '').slice(0, 100));
      const m = ce(c, 'div', 'te-card-meta');
      [['Type', r.type], ['Government', r.government], ['Hazards', safeArr(r.hazards).join(', ')]].forEach(([k, v]) => { if (!v) return; const row = ce(m, 'div', 'te-card-meta-row'); ce(row, 'span', 'te-card-meta-label', k); ce(row, 'span', '', String(v).slice(0, 60)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'regions', r, regionFields).open());
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'regions', r.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No regions yet.', 'Add regions to build your world geography.'); }

  sectionHead(main, 'Domains');
  const domains = safeArr(plugin.state.entities.domains).filter(campFilter).filter(x => matchesSearch(x, plugin.state.search));
  if (domains.length) {
    const g = ce(main, 'div', 'te-grid');
    domains.forEach(domain => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', ENTITY_ICONS.domains || 'ðŸ°'); ce(h, 'h3', 'te-card-title', domain.name || 'Untitled Domain');
      if (domain.summary) ce(c, 'p', 'te-card-body', (domain.summary || '').slice(0, 100));
      const m = ce(c, 'div', 'te-card-meta');
      [['Type', domain.domainType], ['Controller', resolveEntityDisplay(domain.controllerType, domain.controllerId, plugin.state)], ['Regions', safeArr(domain.claimedRegionIds).map(id => resolveEntityDisplay('regions', id, plugin.state)).join(', ')]].forEach(([k, v]) => {
        if (!v) return; const row = ce(m, 'div', 'te-card-meta-row'); ce(row, 'span', 'te-card-meta-label', k); ce(row, 'span', '', String(v).slice(0, 80));
      });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'domains', domain, domainFields).open());
      btn(a, 'Write Note', 'te-btn is-sm', () => writeEntityNote(plugin, 'domains', domain));
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'domains', domain.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No domains yet.', 'Add domains to track holdings, territories, and spheres of control.'); }

  sectionHead(main, 'Settlements');
  const settlements = safeArr(plugin.state.entities.settlements).filter(campFilter).filter(x => matchesSearch(x, plugin.state.search));
  if (settlements.length) {
    const g = ce(main, 'div', 'te-grid');
    settlements.forEach(s => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🏘️'); ce(h, 'h3', 'te-card-title', s.name);
      if (s.summary) ce(c, 'p', 'te-card-body', (s.summary || '').slice(0, 100));
      const m = ce(c, 'div', 'te-card-meta');
      [['Type', s.type], ['Population', s.population], ['Government', s.government]].forEach(([k, v]) => { if (!v) return; const row = ce(m, 'div', 'te-card-meta-row'); ce(row, 'span', 'te-card-meta-label', k); ce(row, 'span', '', String(v)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'settlements', s, settlementFields).open());
      btn(a, 'Write Note', 'te-btn is-sm', () => writeEntityNote(plugin, 'settlements', s));
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'settlements', s.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No settlements yet.'); }

  sectionHead(main, 'Dungeons & Keyed Locations');
  const dungeons = safeArr(plugin.state.entities.dungeons).filter(campFilter).filter(x => matchesSearch(x, plugin.state.search));
  if (dungeons.length) {
    const g = ce(main, 'div', 'te-grid');
    dungeons.forEach(d => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🕳️'); ce(h, 'h3', 'te-card-title', d.name);
      if (d.summary) ce(c, 'p', 'te-card-body', (d.summary || '').slice(0, 100));
      const m = ce(c, 'div', 'te-card-meta');
      [['Type', d.type], ['Rooms', safeArr(d.rooms).length + ' rooms'], ['Threat Level', d.threatLevel]].forEach(([k, v]) => { if (!v) return; const row = ce(m, 'div', 'te-card-meta-row'); ce(row, 'span', 'te-card-meta-label', k); ce(row, 'span', '', String(v)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new DungeonModal(plugin.app, plugin, d).open());
      btn(a, 'Write Note', 'te-btn is-sm', () => writeEntityNote(plugin, 'dungeons', d));
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'dungeons', d.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No dungeons yet.', 'Use "+ Dungeon" to create a keyed dungeon or location.'); }
}

// ── RUN SESSION (Phase 13) ────────────────────────────────────────────────────
function renderRunSession(main, plugin, tabs) {
  const state = plugin.state;
  const camp = activeCampaign(state);

  // Determine active session
  let activeSess = state.activeSessionId ? safeArr(state.entities.sessions).find(s => s.id === state.activeSessionId) : null;

  // Session start/end & End Session & Open Review action
  const startEndLabel = !state.sessionRunMode ? '▶ Start Session' : '⏹ End Session & Open Review';
  pageHead(main, plugin, '▶ Run Session', 'Live session management — combat, context, events, and notes.', [
    { label: startEndLabel, primary: !state.sessionRunMode, run: state.sessionRunMode,
      onClick: async () => {
        if (!state.sessionRunMode) {
          // Start session
          const newSess = {
            id: uid('sess'),
            name: `Session ${safeArr(state.entities.sessions).length + 1} — ${new Date().toLocaleDateString()}`,
            status: 'Active', date: new Date().toISOString().slice(0, 10),
            campaignId: state.activeCampaignId,
            eventLog: [],
            notes: '',
            sessionContext: {
              currentLocationId: '', currentSettlementId: '', activeNpcIds: [], activeQuestIds: [], activeEncounterIds: [],
              activeFactionIds: [], activeSecretIds: [], activeHandoutIds: [], activeLootIds: [],
              activeTimerIds: [], currentMapId: ''
            }
          };
          upsert(state, 'sessions', newSess);
          state.sessionRunMode = true;
          state.activeSessionId = newSess.id;
          activeSess = newSess;
          logSessionEvent(plugin, 'Session Started', newSess.name);
          await plugin.saveState();
        } else {
          // End session & open review
          const sess = safeArr(state.entities.sessions).find(s => s.id === state.activeSessionId);
          if (sess) {
            logSessionEvent(plugin, 'Session Ended', sess.name);
            sess.status = 'Completed';
            upsert(state, 'sessions', sess);
          }
          state.sessionRunMode = false;
          state.activeSessionId = '';
          await plugin.saveState();
          if (sess) new EndSessionReviewModal(plugin.app, plugin, sess).open();
        }
      }
    },
  ], tabs);

  if (state.sessionRunMode && activeSess) {
    ce(main, 'div', 'te-session-live-badge', '🔴 Session in Progress');
    ce(main, 'p', 'te-page-subtitle', activeSess.name);
  }

  // Ensure sessionContext exists
  if (activeSess) { if (!activeSess.sessionContext) activeSess.sessionContext = {
      currentLocationId: '', currentSettlementId: '', activeNpcIds: [], activeQuestIds: [], activeEncounterIds: [],
      activeFactionIds: [], activeSecretIds: [], activeHandoutIds: [], activeLootIds: [],
      activeTimerIds: [], currentMapId: ''
    };
    if (activeSess.sessionContext.currentSettlementId === undefined) activeSess.sessionContext.currentSettlementId = '';
  }
  const ctx = activeSess ? activeSess.sessionContext : null;
  // Helper for ctx selects: logs when logType provided and value changes
  const ctxSelectLog = (logType, sel, prev, items) => { if (logType && sel.value !== prev) { const found = items.find(x => x.id === sel.value); if (found) logSessionEvent(plugin, logType, found.name); } };

  // ── 2/3 | 1/3 column layout ──────────────────────────────────────────────────
  const colWrap = ce(main, 'div', 'te-run-cols');
  colWrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap';
  const leftCol = ce(colWrap, 'div', 'te-run-left');
  leftCol.style.cssText = 'flex:2 1 400px;min-width:0';
  const rightCol = ce(colWrap, 'div', 'te-run-right');
  rightCol.style.cssText = 'flex:1 1 240px;min-width:220px';

  // ════════════════════════════════════════════════════════
  // LEFT COLUMN
  // ════════════════════════════════════════════════════════

  // ── 1. Session Context ───────────────────────────────────────────────────────
  sectionHead(leftCol, '🎯 Session Context');
  if (activeSess && ctx) {
    const ctxCard = ce(leftCol, 'div', 'te-card'); ctxCard.style.cssText = 'padding:12px;margin-bottom:8px';

    // Tabs: Location | Map | NPCs | Quests | Factions | Encounters
    const CTX_TABS = ['location', 'map', 'npcs', 'quests', 'factions', 'encounters'];
    const CTX_LABELS = ['📍 Location', '🗺️ Map', '👥 NPCs', '📋 Quests', '⚔️ Factions', '🎯 Encounters'];
    let activeCtxTab = 'location';
    const ctxTabRow = ce(ctxCard, 'div', 'te-card-actions'); ctxTabRow.style.flexWrap = 'wrap';
    const ctxContent = ce(ctxCard, 'div', ''); ctxContent.style.marginTop = '8px';
    const scopeId = camp ? camp.id : state.activeCampaignId;
    const selStyle = 'width:100%;padding:4px 6px;font-size:.85rem;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';

    // Campaign-scoped dropdown helper: renders a select that adds to an id array and shows chips
    const renderSelectorChips = (container, label, idArrayKey, entityKey, logType, chipActions) => {
      const chips = ce(container, 'div', 'te-chip-row');
      const rebuildChips = () => {
        clear(chips);
        safeArr(ctx[idArrayKey]).forEach(eid => {
          const ent = safeArr(state.entities[entityKey]).find(x => x.id === eid);
          if (!ent) return;
          const chip = ce(chips, 'span', 'te-chip', ent.name || eid);
          if (chipActions) chipActions(chip, ent, eid, rebuildChips);
          else {
            const x = ce(chip, 'button', 'te-chip-x', '×'); x.title = 'Remove';
            x.addEventListener('click', async () => {
              ctx[idArrayKey] = safeArr(ctx[idArrayKey]).filter(id => id !== eid);
              logSessionEvent(plugin, `${logType} Deactivated`, ent.name);
              upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin);
              rebuildChips();
            });
          }
        });
      };
      rebuildChips();
      const addRow = ce(container, 'div', ''); addRow.style.cssText = 'display:flex;gap:6px;margin-top:6px;align-items:center';
      const sel = ce(addRow, 'select'); sel.style.cssText = 'flex:1;padding:4px 6px;font-size:.85rem;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
      ce(sel, 'option', '', `— select ${label} —`).value = '';
      const campEnts = safeArr(state.entities[entityKey]).filter(e => !scopeId || e.campaignId === scopeId);
      campEnts.forEach(e => { const o = ce(sel, 'option', '', e.name || e.id); o.value = e.id; });
      if (!campEnts.length) ce(addRow, 'span', 'te-muted-text', `No ${label.toLowerCase()} in campaign`);
      btn(addRow, '+ Add', 'te-btn is-sm', async () => {
        const id = sel.value; if (!id) return;
        if (!safeArr(ctx[idArrayKey]).includes(id)) {
          const ent = campEnts.find(e => e.id === id);
          ctx[idArrayKey] = [...safeArr(ctx[idArrayKey]), id];
          if (ent) logSessionEvent(plugin, `${logType} Activated`, ent.name);
          upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin);
          rebuildChips();
        }
        sel.value = '';
      });
      return rebuildChips;
    };

    const renderCtxTab = () => {
      clear(ctxContent);
      if (activeCtxTab === 'location') {
        // Location selector
        const sc = ce(ctxContent, 'div', 'te-stat-card');
        ce(sc, 'div', 'te-stat-label', 'Current Location');
        const sel = ce(sc, 'select'); sel.style.cssText = selStyle;
        ce(sel, 'option', '', '— none —').value = '';
        const locs = safeArr(state.entities.locations).filter(x => !scopeId || x.campaignId === scopeId);
        locs.forEach(x => { const o = ce(sel, 'option', '', x.name || x.id); o.value = x.id; });
        sel.value = ctx.currentLocationId || '';
        sel.addEventListener('change', async () => {
          const prev = ctx.currentLocationId;
          ctx.currentLocationId = sel.value;
          if (sel.value !== prev) {
            const chosen = locs.find(x => x.id === sel.value);
            if (chosen) logSessionEvent(plugin, 'Location Changed', chosen.name);
          }
          upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin);
        });
        if (!locs.length) ce(sc, 'p', 'te-muted-text', 'No locations in campaign yet.');
        // Settlement selector — persists to currentSettlementId
        const sc2 = ce(ctxContent, 'div', 'te-stat-card'); sc2.style.marginTop = '8px';
        ce(sc2, 'div', 'te-stat-label', 'Current Settlement / Town');
        const sel2 = ce(sc2, 'select'); sel2.style.cssText = selStyle;
        ce(sel2, 'option', '', '— none —').value = '';
        const settls = safeArr(state.entities.settlements).filter(x => !scopeId || x.campaignId === scopeId);
        settls.forEach(x => { const o = ce(sel2, 'option', '', x.name || x.id); o.value = x.id; });
        sel2.value = ctx.currentSettlementId || '';
        sel2.addEventListener('change', async () => {
          const prev = ctx.currentSettlementId;
          ctx.currentSettlementId = sel2.value;
          if (sel2.value !== prev) {
            const chosen = settls.find(x => x.id === sel2.value);
            if (chosen) logSessionEvent(plugin, 'Settlement Changed', chosen.name);
          }
          upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin);
        });
        if (!settls.length) ce(sc2, 'p', 'te-muted-text', 'No settlements in campaign yet.');
      } else if (activeCtxTab === 'map') {
        const sc = ce(ctxContent, 'div', 'te-stat-card');
        ce(sc, 'div', 'te-stat-label', 'Current Map');
        const sel = ce(sc, 'select'); sel.style.cssText = selStyle;
        ce(sel, 'option', '', '— none —').value = '';
        const maps = getCampaignMaps(state, scopeId);
        maps.forEach(x => { const o = ce(sel, 'option', '', x.name || 'Untitled'); o.value = x.id; });
        sel.value = ctx.currentMapId || '';
        sel.addEventListener('change', async () => {
          const prev = ctx.currentMapId;
          ctx.currentMapId = sel.value;
          if (sel.value !== prev) {
            const chosen = maps.find(x => x.id === sel.value);
            if (chosen) logSessionEvent(plugin, 'Map Changed', chosen.name || 'map');
          }
          upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin);
          // Show linked metadata for the newly selected map without re-rendering
          renderMapMeta();
        });
        if (!maps.length) ce(sc, 'p', 'te-muted-text', 'No maps in campaign yet.');
        // Linked location/settlement metadata for selected map
        const mapMetaEl = ce(ctxContent, 'div', '');
        const renderMapMeta = () => {
          clear(mapMetaEl);
          const chosenId = ctx.currentMapId;
          if (!chosenId) return;
          const chosenMap = maps.find(m => m.id === chosenId);
          if (!chosenMap) return;
          const meta = ce(mapMetaEl, 'div', 'te-card-meta'); meta.style.marginTop = '8px';
          const linkedLoc = (chosenMap.linkedLocationId || chosenMap.locationId) ? safeArr(state.entities.locations).find(l => l.id === (chosenMap.linkedLocationId || chosenMap.locationId)) : null;
          const linkedSettl = (chosenMap.linkedSettlementId || chosenMap.settlementId) ? safeArr(state.entities.settlements).find(s => s.id === (chosenMap.linkedSettlementId || chosenMap.settlementId)) : null;
          if (linkedLoc) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Location'); ce(r, 'span', '', linkedLoc.name); }
          if (linkedSettl) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Settlement'); ce(r, 'span', '', linkedSettl.name); }
          if (chosenMap.summary) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Summary'); ce(r, 'span', '', chosenMap.summary.slice(0, 80)); }
        };
        renderMapMeta();
        const mapBtns = ce(ctxContent, 'div', 'te-card-actions'); mapBtns.style.marginTop = '8px';
        btn(mapBtns, '🗺️ Open Tile Map', 'te-btn is-sm is-primary', async () => { state.activeSection = 'tile-map'; await saveStatePreserveScroll(plugin); });
      } else if (activeCtxTab === 'npcs') {
        renderSelectorChips(ctxContent, 'NPC', 'activeNpcIds', 'npcs', 'NPC', (chip, npc, npcId, rebuildChips) => {
          const deadBtn = ce(chip, 'button', 'te-chip-x', '💀'); deadBtn.title = 'Mark dead';
          deadBtn.addEventListener('click', async () => {
            npc.status = 'Dead'; upsert(state, 'npcs', npc);
            ctx.activeNpcIds = safeArr(ctx.activeNpcIds).filter(id => id !== npcId);
            logSessionEvent(plugin, 'NPC Died', npc.name);
            upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin); rebuildChips();
          });
          const x = ce(chip, 'button', 'te-chip-x', '×'); x.title = 'Remove from scene';
          x.addEventListener('click', async () => {
            ctx.activeNpcIds = safeArr(ctx.activeNpcIds).filter(id => id !== npcId);
            logSessionEvent(plugin, 'NPC Deactivated', npc.name);
            upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin); rebuildChips();
          });
        });
      } else if (activeCtxTab === 'quests') {
        renderSelectorChips(ctxContent, 'Quest', 'activeQuestIds', 'quests', 'Quest', (chip, q, qId, rebuildChips) => {
          const completeBtn = ce(chip, 'button', 'te-chip-x', '✅'); completeBtn.title = 'Complete quest';
          completeBtn.addEventListener('click', async () => {
            q.status = 'Completed'; upsert(state, 'quests', q);
            ctx.activeQuestIds = safeArr(ctx.activeQuestIds).filter(id => id !== qId);
            logSessionEvent(plugin, 'Quest Completed', q.name);
            upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin); rebuildChips();
          });
          const failBtn = ce(chip, 'button', 'te-chip-x', '❌'); failBtn.title = 'Fail quest';
          failBtn.addEventListener('click', async () => {
            q.status = 'Failed'; upsert(state, 'quests', q);
            ctx.activeQuestIds = safeArr(ctx.activeQuestIds).filter(id => id !== qId);
            logSessionEvent(plugin, 'Quest Failed', q.name);
            upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin); rebuildChips();
          });
          const rmQ = ce(chip, 'button', 'te-chip-x', '×'); rmQ.title = 'Remove from scene';
          rmQ.addEventListener('click', async () => {
            ctx.activeQuestIds = safeArr(ctx.activeQuestIds).filter(id => id !== qId);
            logSessionEvent(plugin, 'Quest Deactivated', q.name);
            upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin); rebuildChips();
          });
        });
      } else if (activeCtxTab === 'factions') {
        renderSelectorChips(ctxContent, 'Faction', 'activeFactionIds', 'factions', 'Faction');
      } else if (activeCtxTab === 'encounters') {
        renderSelectorChips(ctxContent, 'Encounter', 'activeEncounterIds', 'encounters', 'Encounter', (chip, enc, encId, rebuildChips) => {
          const x = ce(chip, 'button', 'te-chip-x', '×'); x.title = 'Remove encounter';
          x.addEventListener('click', async () => {
            ctx.activeEncounterIds = safeArr(ctx.activeEncounterIds).filter(id => id !== encId);
            logSessionEvent(plugin, 'Encounter Deactivated', enc.name);
            upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin); rebuildChips();
          });
        });
      }
    };

    CTX_TABS.forEach((id, i) => {
      btn(ctxTabRow, CTX_LABELS[i], 'te-btn is-sm' + (id === activeCtxTab ? ' is-primary' : ''), () => {
        activeCtxTab = id;
        Array.from(ctxTabRow.querySelectorAll('button')).forEach((b, j) => {
          b.className = 'te-btn is-sm' + (CTX_TABS[j] === activeCtxTab ? ' is-primary' : '');
        });
        renderCtxTab();
      });
    });
    renderCtxTab();
  } else {
    ce(leftCol, 'p', 'te-empty-state', 'Start a session to enable Session Context.');
  }

  // ── 2. Session Event Log ──────────────────────────────────────────────────────
  sectionHead(leftCol, '📋 Session Event Log');
  if (activeSess) {
    if (!Array.isArray(activeSess.eventLog)) activeSess.eventLog = [];
    const logWrap = ce(leftCol, 'div', 'te-card'); logWrap.style.padding = '12px';
    const EVENT_TYPES = ['Note','NPC Met','Location Visited','Quest Advanced','Secret Revealed','Loot Awarded','Combat Started','Combat Ended','Player Decision','Consequence','Timer Advanced','Next Hook'];
    let evtType = 'Note';
    const typeRow = ce(logWrap, 'div', 'te-card-actions'); typeRow.style.flexWrap = 'wrap';
    EVENT_TYPES.forEach(t => {
      btn(typeRow, t, 'te-btn is-sm' + (t === evtType ? ' is-primary' : ''), () => {
        evtType = t;
        Array.from(typeRow.querySelectorAll('button')).forEach((bb, i) => bb.className = 'te-btn is-sm' + (EVENT_TYPES[i] === t ? ' is-primary' : ''));
      });
    });
    const addRow = ce(logWrap, 'div', 'te-chip-add-row'); addRow.style.marginTop = '8px';
    const evtInp = ce(addRow, 'input'); evtInp.type = 'text'; evtInp.placeholder = 'Event note…'; evtInp.style.flex = '1';
    btn(addRow, 'Add', 'te-btn is-primary', async () => {
      const text = evtInp.value.trim(); if (!text) return;
      logSessionEvent(plugin, evtType, text);
      evtInp.value = '';
      await saveStateQuiet(plugin);
      renderLog();
    });
    evtInp.addEventListener('keydown', e => { if (e.key === 'Enter') addRow.querySelector('button').click(); });
    const logList = ce(logWrap, 'div', '');
    logList.style.cssText = 'max-height:240px;overflow-y:auto;margin-top:8px';
    const renderLog = () => {
      clear(logList);
      const events = [...activeSess.eventLog].reverse();
      if (!events.length) { ce(logList, 'p', 'te-empty-state', 'No events yet.'); return; }
      events.forEach(evt => {
        const row = ce(logList, 'div', 'te-card-meta-row');
        row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--te-border);font-size:.85rem;display:flex;gap:6px;align-items:baseline';
        const lbl = ce(row, 'span', 'te-card-meta-label'); lbl.textContent = evt.type;
        ce(row, 'span', '', evt.text);
        const t = ce(row, 'span', 'te-muted-text'); t.style.marginLeft = 'auto'; t.style.fontSize = '.75rem';
        t.textContent = evt.time ? new Date(evt.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      });
    };
    renderLog();
  } else {
    ce(leftCol, 'p', 'te-empty-state', 'Start a session to enable the event log.');
  }

  // ── 3. Session Notes ──────────────────────────────────────────────────────────
  sectionHead(leftCol, '📝 Session Notes');
  if (activeSess) {
    const ta = ce(leftCol, 'textarea', '');
    ta.placeholder = 'Session notes / scratchpad…'; ta.value = activeSess.notes || '';
    ta.style.cssText = 'width:100%;min-height:120px;padding:10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-md);font-family:inherit;resize:vertical;box-sizing:border-box';
    let saveT = null;
    ta.addEventListener('input', () => {
      clearTimeout(saveT);
      saveT = setTimeout(async () => { activeSess.notes = ta.value; upsert(state, 'sessions', activeSess); await saveStateQuiet(plugin); }, 800);
    });
  } else {
    ce(leftCol, 'p', 'te-empty-state', 'Start a session to enable notes.');
  }

  // ── 4. Reference Lookup ───────────────────────────────────────────────────────
  sectionHead(leftCol, '📖 Reference Lookup');
  const refLookupCard = ce(leftCol, 'div', 'te-card'); refLookupCard.style.padding = '12px';
  const REF_TABS = ['Combat','Actions','Conditions','Social','Rest'];
  let activeRefTab = 'Combat';
  const refTabRow = ce(refLookupCard, 'div', 'te-card-actions'); refTabRow.style.flexWrap = 'wrap'; refTabRow.style.marginBottom = '8px';
  const refContent = ce(refLookupCard, 'div', '');
  const REF_DATA = {
    Combat: [
      ['Attack', 'Roll d20 + attack modifier vs AC. Hit deals weapon/spell damage.'],
      ['Cover', 'Half: +2 AC & DEX saves. ¾: +5 AC & DEX saves. Total: can\'t be targeted directly.'],
      ['Concentration', 'Broken by: new concentration spell, damage (DC max(10,½dmg) CON save), incapacitation, death.'],
      ['Death Saves', '3 successes = stable. 3 failures = dead. Nat 20 = regain 1 HP. Nat 1 = 2 failures.'],
      ['Flanking (opt)', 'Two attackers on opposite sides: advantage on melee attacks.'],
    ],
    Actions: [
      ['Action', 'Attack · Cast Spell · Dash · Disengage · Dodge · Help · Hide · Ready · Search · Use Object · Grapple · Shove'],
      ['Bonus Action', 'Class features · Off-hand attack (TWF) · Cunning Action (Rogue) · Healing Word · some spells'],
      ['Reaction', 'Opportunity Attack · Shield spell · Readied Action · Counterspell · Hellish Rebuke'],
      ['Free Action', 'Drop held item · speak briefly · interact with one object (part of move/action normally)'],
      ['Movement', 'Up to Speed per turn. Split freely. Crawl = half speed. Difficult terrain costs double movement.'],
    ],
    Conditions: [
      ['Blinded', 'Auto-fail sight checks. Attack rolls against: adv. Own attacks: disadv.'],
      ['Charmed', 'Can\'t attack charmer. Charmer has adv on social checks against you.'],
      ['Exhaustion', '1:disadv checks 2:half speed 3:disadv attacks/saves 4:half max HP 5:speed=0 6:death'],
      ['Frightened', 'Disadv on checks/attacks while source in sight. Can\'t willingly move closer.'],
      ['Grappled', 'Speed = 0. Escapes with Athletics/Acrobatics vs grappler\'s Athletics.'],
      ['Incapacitated', 'Can\'t take actions or reactions.'],
      ['Paralyzed', 'Incapacitated + can\'t move/speak. Fails STR/DEX saves. Attacks vs: adv. Hits within 5ft: crit.'],
      ['Petrified', 'Transform to stone. Incapacitated + can\'t move/speak. Adv on attacks vs. Resistant to all damage.'],
      ['Poisoned', 'Disadv on attack rolls and ability checks.'],
      ['Prone', 'Disadv on attacks. Attacks vs: adv within 5ft, disadv from range. Stand up = half movement.'],
      ['Restrained', 'Speed = 0. Disadv on attacks & DEX saves. Adv on attacks vs.'],
      ['Stunned', 'Incapacitated. Fails STR/DEX saves. Adv on attacks vs.'],
      ['Unconscious', 'Incapacitated, drops held items, falls prone. Auto-fail STR/DEX saves. Attacks vs: adv + crit within 5ft.'],
    ],
    Social: [
      ['Deception', 'Bluffing, lying, disguise, misdirection.'],
      ['Intimidation', 'Threatening, browbeating, leverage.'],
      ['Persuasion', 'Requests, appeals, goodwill, bribes.'],
      ['Performance', 'Entertainment, storytelling, fitting in.'],
      ['Attitudes', 'Hostile → Indifferent → Friendly. Start from context. Adj = DC 15, Major = DC 20.'],
      ['Insight', 'Actively detect lies: passive Insight vs active Deception. Ask DM if something seems off.'],
    ],
    Rest: [
      ['Short Rest', '≥1 hour. Spend Hit Dice: roll die + CON mod, regain HP. Some class features refresh.'],
      ['Long Rest', '≥8 hours (≤2h light activity). Regain all HP. Regain half max Hit Dice (min 1). All spell slots.'],
      ['Exhaustion', 'Severe activity without food/water/rest may cause exhaustion.'],
    ],
  };
  const renderRefTab = () => {
    clear(refContent);
    const items = REF_DATA[activeRefTab] || [];
    items.forEach(([title, text]) => {
      const row = ce(refContent, 'div', '');
      row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--te-border);font-size:.85rem';
      const lbl = ce(row, 'strong', ''); lbl.textContent = title + ': '; lbl.style.color = 'var(--te-accent)';
      row.appendChild(document.createTextNode(text));
    });
  };
  REF_TABS.forEach(t => {
    btn(refTabRow, t, 'te-btn is-sm' + (t === activeRefTab ? ' is-primary' : ''), () => {
      activeRefTab = t;
      Array.from(refTabRow.querySelectorAll('button')).forEach((b, i) => b.className = 'te-btn is-sm' + (REF_TABS[i] === t ? ' is-primary' : ''));
      renderRefTab();
    });
  });
  renderRefTab();

  // ── 5. Active Location Map ────────────────────────────────────────────────────
  sectionHead(leftCol, '🗺️ Active Location Map');
  const mapCard = ce(leftCol, 'div', 'te-card'); mapCard.style.cssText = 'padding:12px';
  const selectedMapId = ctx ? ctx.currentMapId : '';
  const selectedMap = selectedMapId ? getCampaignMaps(state).find(m => m.id === selectedMapId) : null;
  if (selectedMap) {
    const mapMeta = ce(mapCard, 'div', 'te-card-meta');
    [['Type', selectedMap.type || (selectedMap.tileMap ? 'Tile Map' : '')], ['Scale', selectedMap.distanceScale || (selectedMap.tileLayout || {}).distanceScale || ''], ['Summary', selectedMap.summary || '']].forEach(([k, v]) => {
      if (!v) return;
      const row = ce(mapMeta, 'div', 'te-card-meta-row');
      ce(row, 'span', 'te-card-meta-label', k);
      ce(row, 'span', '', String(v).slice(0, 80));
    });
    const mh = ce(mapCard, 'div', 'te-card-head'); ce(mh, 'span', 'te-card-icon', '🗺️'); ce(mh, 'h3', 'te-card-title', selectedMap.name || 'Map');
    const mapBtns = ce(mapCard, 'div', 'te-card-actions'); mapBtns.style.marginTop = '8px';
    btn(mapBtns, '🗺️ Open Full Map', 'te-btn is-primary is-sm', async () => { state.activeSection = 'tile-map'; state.pendingMapId = selectedMapId; await saveStatePreserveScroll(plugin); });
    ce(mapCard, 'p', 'te-muted-text', 'Switch to the Map tab in Session Context to change the active map.');
  } else {
    ce(mapCard, 'p', 'te-empty-state', 'No active map selected. Use the Map tab in Session Context to select a map.');
    const mapBtns2 = ce(mapCard, 'div', 'te-card-actions'); mapBtns2.style.marginTop = '8px';
    btn(mapBtns2, '🗺️ Open Tile Map', 'te-btn is-sm is-primary', async () => { state.activeSection = 'tile-map'; await saveStatePreserveScroll(plugin); });
  }

  // ── 6. Unified Generator ──────────────────────────────────────────────────────
  sectionHead(leftCol, '⚡ Generator');
  const ugenWrap = ce(leftCol, 'div', 'te-card'); ugenWrap.style.cssText = 'padding:12px';

  const ugenResultEl = ce(ugenWrap, 'div', 'te-result-box', 'Select a type and press Generate.');
  ugenResultEl.style.cssText = 'min-height:48px;padding:10px 12px;border-radius:var(--te-r-md);border:1px solid var(--te-border);margin-bottom:10px;font-size:.9rem;line-height:1.5;white-space:pre-wrap';

  const UNIFIED_GENS = [
    { label: '── Partial Results ──', disabled: true },
    { type: 'NPC Name',        label: 'NPC Name',            partial: true,  saveKey: 'npcs' },
    { type: 'NPC Trait',       label: 'NPC Trait',           partial: true },
    { type: 'Faction Name',    label: 'Faction Name',        partial: true,  saveKey: 'factions' },
    { type: 'Quest Hook',      label: 'Quest Hook',          partial: true,  saveKey: 'quests' },
    { type: 'Plot Twist',      label: 'Plot Twist',          partial: true },
    { type: 'Rumour',          label: 'Rumour',              partial: true },
    { type: 'Tavern Name',     label: 'Tavern Name',         partial: true },
    { type: 'Loot',            label: 'Loot Drop',           partial: true },
    { type: 'Weather',         label: 'Weather',             partial: true },
    { type: 'Travel Event',    label: 'Travel Event',        partial: true },
    { type: 'Dungeon Room',    label: 'Dungeon Room Desc',   partial: true },
    { type: 'Wild Magic Surge',label: 'Wild Magic Surge',    partial: true },
    { type: 'Town Event',      label: 'Town Event',          partial: true },
    { type: 'Trap',            label: 'Trap Description',    partial: true },
    { label: '── Full Entities ──', disabled: true },
    { type: 'Full NPC',          label: 'Full NPC',           partial: false, genFn: generateCompleteNPC,         entityKey: 'npcs',        ModalClass: NPCModal },
    { type: 'Full Encounter',    label: 'Full Encounter',     partial: false, genFn: generateCompleteEncounter,   entityKey: 'encounters',  ModalClass: EncounterModal },
    { type: 'Full Quest',        label: 'Full Quest',         partial: false, genFn: generateCompleteQuest,       entityKey: 'quests',      ModalClass: QuestModal },
    { type: 'Full Faction',      label: 'Full Faction',       partial: false, genFn: generateCompleteFaction,     entityKey: 'factions',    ModalClass: FactionModal },
    { type: 'Full Settlement',   label: 'Full Settlement',    partial: false, genFn: generateCompleteSettlement,  entityKey: 'settlements', ModalClass: null },
    { type: 'Full Tavern',       label: 'Full Tavern',        partial: false, genFn: generateCompleteTavern,      entityKey: 'locations',   ModalClass: null },
    { type: 'Full Shop',         label: 'Full Shop',          partial: false, genFn: generateCompleteShop,        entityKey: 'locations',   ModalClass: null },
    { type: 'Full Rumour',       label: 'Full Rumour',        partial: false, genFn: generateCompleteRumour,      entityKey: 'secrets',     ModalClass: null },
    { type: 'Full Secret',       label: 'Full Secret',        partial: false, genFn: generateCompleteSecret,      entityKey: 'secrets',     ModalClass: null },
    { type: 'Full Loot',         label: 'Full Loot',          partial: false, genFn: generateCompleteLoot,        entityKey: 'loot',        ModalClass: null },
    { type: 'Full POI',          label: 'Full POI',           partial: false, genFn: generateCompletePOI,         entityKey: 'pois',        ModalClass: null },
    { type: 'Full Dungeon Room', label: 'Full Dungeon Room',  partial: false, genFn: generateCompleteDungeonRoom, entityKey: 'locations',   ModalClass: null },
    { type: 'Full Travel Event', label: 'Full Travel Event',  partial: false, genFn: generateCompleteTravelEvent, entityKey: 'secrets',     ModalClass: null },
    { type: 'Full Noble House',  label: 'Full Noble House',   partial: false, genFn: generateCompleteNobleHouse,  entityKey: 'factions',    ModalClass: null },
  ];

  const ugenSelRow = ce(ugenWrap, 'div', 'te-chip-add-row'); ugenSelRow.style.marginBottom = '8px';
  const ugenSel = ce(ugenSelRow, 'select');
  ugenSel.style.cssText = 'flex:1;padding:6px 8px;font-size:.9rem;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  UNIFIED_GENS.forEach(g => {
    const o = ce(ugenSel, 'option', '', g.label);
    if (g.disabled) { o.disabled = true; o.value = ''; } else o.value = g.type;
  });
  ugenSel.value = 'NPC Name';

  let ugenLastType = '', ugenLastResult = '', ugenLastDraft = null;

  const ugenActRow = ce(ugenWrap, 'div', 'te-card-actions');
  ugenActRow.style.cssText = 'margin-top:8px;display:none;flex-wrap:wrap';

  const ugenLogBtn = btn(ugenActRow, 'Log to Session', 'te-btn is-sm', async () => {
    if (!ugenLastResult && !ugenLastDraft) return;
    const text = ugenLastDraft ? `[${ugenLastType}] ${ugenLastDraft.name || 'draft'}` : `[${ugenLastType}] ${ugenLastResult}`;
    logSessionEvent(plugin, 'Generator Used', text);
    logGeneratorHistory(plugin, { type: ugenLastType, result: ugenLastDraft ? (ugenLastDraft.name || '') : ugenLastResult });
    await saveStateQuiet(plugin);
    new Notice('Logged to session.');
  });

  const ugenSaveBtn = btn(ugenActRow, 'Save as Entity', 'te-btn is-sm is-primary', () => {
    if (!ugenLastResult && !ugenLastDraft) return;
    const cfg = UNIFIED_GENS.find(g => g.type === ugenLastType);
    if (!cfg) return;
    if (cfg.partial) {
      if (ugenLastType === 'NPC Name') new NPCModal(plugin.app, plugin, { name: ugenLastResult, campaignId: state.activeCampaignId }).open();
      else if (ugenLastType === 'Faction Name') new FactionModal(plugin.app, plugin, { name: ugenLastResult, campaignId: state.activeCampaignId }).open();
      else if (ugenLastType === 'Quest Hook') new QuestModal(plugin.app, plugin, { name: 'Generated Quest', hooks: [ugenLastResult], campaignId: state.activeCampaignId }).open();
      else new Notice('Copy the result and add it to the relevant entity manually.');
    } else if (ugenLastDraft) {
      if (!ugenLastDraft.campaignId) ugenLastDraft.campaignId = state.activeCampaignId || '';
      new EntityDraftModal(plugin.app, plugin, ugenLastType, ugenLastDraft, cfg.entityKey, cfg.ModalClass).open();
    }
  });

  btn(ugenActRow, 'Copy', 'te-btn is-sm', () => {
    const text = ugenLastDraft ? JSON.stringify(ugenLastDraft, null, 2) : ugenLastResult;
    if (!text) return;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => new Notice('Copied.'));
    else new Notice('Clipboard not available.');
  });

  btn(ugenActRow, 'Clear', 'te-btn is-sm', () => {
    ugenLastResult = ''; ugenLastDraft = null; ugenLastType = '';
    ugenResultEl.textContent = 'Select a type and press Generate.';
    ugenActRow.style.display = 'none';
  });

  const ugenBtnRow = ce(ugenWrap, 'div', 'te-card-actions'); ugenBtnRow.style.marginTop = '4px';
  btn(ugenBtnRow, '⚡ Generate', 'te-btn is-primary', () => {
    const type = ugenSel.value; if (!type) return;
    ugenLastType = type; ugenLastResult = ''; ugenLastDraft = null;
    const cfg = UNIFIED_GENS.find(g => g.type === type);
    if (!cfg) return;
    if (cfg.partial) {
      ugenLastResult = generate(type, state);
      ugenResultEl.textContent = ugenLastResult;
    } else {
      ugenLastDraft = cfg.genFn(state);
      const lines = [];
      for (const [k, v] of Object.entries(ugenLastDraft)) {
        if (['id','campaignId','visibility','updatedAt','createdAt'].includes(k)) continue;
        if (typeof v === 'string' && v) lines.push(`${k}: ${v.slice(0, 80)}`);
        else if (Array.isArray(v) && v.length) lines.push(`${k}: ${v.slice(0, 3).join(', ')}`);
      }
      ugenResultEl.textContent = lines.slice(0, 12).join('\n') || `Generated ${type}`;
    }
    ugenActRow.style.display = '';
    const canSave = cfg.partial ? ['NPC Name','Faction Name','Quest Hook'].includes(type) : true;
    ugenSaveBtn.style.display = canSave ? '' : 'none';
    ugenLogBtn.style.display = activeSess ? '' : 'none';
  });

  // ════════════════════════════════════════════════════════
  // RIGHT COLUMN
  // ════════════════════════════════════════════════════════

  // ── 1. Dice Roller ───────────────────────────────────────────────────────────
  sectionHead(rightCol, '🎲 Dice Roller');
  const diceWrap = ce(rightCol, 'div', 'te-card'); diceWrap.style.cssText = 'padding:12px';
  const diceResultEl = ce(diceWrap, 'div', 'te-result-box', 'Roll a die below.');
  diceResultEl.style.cssText = 'min-height:36px;padding:8px 12px;border-radius:var(--te-r-md);border:1px solid var(--te-border);margin-bottom:8px;font-size:1.1rem;font-weight:600';
  const quickDice = ce(diceWrap, 'div', 'te-card-actions'); quickDice.style.flexWrap = 'wrap';
  ['d4','d6','d8','d10','d12','d20','d100'].forEach(d => {
    btn(quickDice, d, 'te-btn is-sm', async () => {
      const sides = parseInt(d.slice(1));
      const roll = Math.floor(Math.random() * sides) + 1;
      const resultText = `${d}: ${roll}`;
      diceResultEl.textContent = resultText;
      if (activeSess) { logSessionEvent(plugin, 'Dice Rolled', resultText); await saveStateQuiet(plugin); }
    });
  });
  const formulaRow = ce(diceWrap, 'div', 'te-chip-add-row'); formulaRow.style.marginTop = '8px';
  const formulaInp = ce(formulaRow, 'input'); formulaInp.type = 'text'; formulaInp.placeholder = '2d6+3'; formulaInp.style.flex = '1';
  btn(formulaRow, 'Roll', 'te-btn is-primary', async () => {
    const f = formulaInp.value.trim() || '1d20';
    const match = f.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) { diceResultEl.textContent = 'Invalid formula (use NdN or NdN±M)'; return; }
    const count = Math.max(1, Math.min(100, parseInt(match[1]))), sides = parseInt(match[2]), mod = parseInt(match[3] || 0);
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    const resultText = `${f} → ${total}${count > 1 ? ` (${rolls.join(', ')}${mod !== 0 ? ` ${mod > 0 ? '+' : ''}${mod}` : ''})` : ''}`;
    diceResultEl.textContent = resultText;
    if (activeSess) { logSessionEvent(plugin, 'Dice Rolled', resultText); await saveStateQuiet(plugin); }
  });
  formulaInp.addEventListener('keydown', e => { if (e.key === 'Enter') formulaRow.querySelector('button').click(); });

  // ── 2. In-World Calendar ──────────────────────────────────────────────────────
  sectionHead(rightCol, '📅 Calendar');
  const calCard = ce(rightCol, 'div', 'te-card'); calCard.style.cssText = 'padding:12px';
  const campCal = camp
    ? (safeArr(state.entities.calendars).find(c => c.campaignId === camp.id) || state.calendar || null)
    : (state.calendar || null);
  if (campCal && (campCal.name || campCal.day !== undefined || campCal.month || campCal.year !== undefined)) {
    const calMeta = ce(calCard, 'div', 'te-card-meta');
    [
      ['Calendar', campCal.name || 'Campaign Calendar'],
      ['Date', `Day ${campCal.day ?? '—'}, ${campCal.month || '—'}, Year ${campCal.year ?? '—'}`],
      safeArr(campCal.holidays).length ? ['Holidays', safeArr(campCal.holidays).slice(0, 3).join(' · ')] : null,
    ].filter(Boolean).forEach(([label, val]) => {
      const r = ce(calMeta, 'div', 'te-card-meta-row');
      ce(r, 'span', 'te-card-meta-label', label);
      ce(r, 'span', '', String(val).slice(0, 100));
    });
    const calBtns = ce(calCard, 'div', 'te-card-actions'); calBtns.style.marginTop = '8px';
    btn(calBtns, '📅 Manage Calendar', 'te-btn is-sm is-primary', () => new CalendarModal(plugin.app, plugin).open());
    if (typeof campCal.day === 'number') {
      btn(calBtns, '+1 Day', 'te-btn is-sm', async () => {
        campCal.day = (campCal.day || 0) + 1;
        if (campCal.id) upsert(state, 'calendars', campCal);
        else state.calendar = campCal;
        if (activeSess) logSessionEvent(plugin, 'Date Advanced', `Day ${campCal.day}, ${campCal.month || ''}, Year ${campCal.year ?? ''}`);
        await saveStateQuiet(plugin);
        new Notice(`Advanced to Day ${campCal.day}.`);
      });
    }
  } else {
    ce(calCard, 'p', 'te-empty-state', 'No in-world calendar set up for this campaign.');
    const calBtns2 = ce(calCard, 'div', 'te-card-actions'); calBtns2.style.marginTop = '8px';
    btn(calBtns2, '📅 Set Up Calendar', 'te-btn is-sm is-primary', () => new CalendarModal(plugin.app, plugin).open());
  }

  // ── 3. Combat Tracker ─────────────────────────────────────────────────────────
  sectionHead(rightCol, '⚔️ Combat Tracker');
  renderInitiativeTracker(rightCol, plugin);

  // ── 4. Timers ─────────────────────────────────────────────────────────────────
  sectionHead(rightCol, '⏱️ Escalation Timers');
  const timerWrap = ce(rightCol, 'div', '');
  const rebuildTimers = () => {
    clear(timerWrap);
    const timers2 = safeArr(state.entities.timers).filter(t => !state.activeCampaignId || t.campaignId === state.activeCampaignId);
    if (!timers2.length) {
      ce(timerWrap, 'p', 'te-empty-state', 'No timers for this campaign.');
    } else {
      timers2.forEach(t => {
        const c = ce(timerWrap, 'div', 'te-card'); c.style.marginBottom = '8px';
        const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '⏱️'); ce(h, 'h3', 'te-card-title', t.name);
        const maxTicks = Math.max(1, parseInt(t.maxTicks) || 6);
        const curTicks = Math.min(maxTicks, parseInt(t.currentTick) || 0);
        const pct = Math.round((curTicks / maxTicks) * 100);
        const pb = ce(c, 'div', 'te-progress-bar'); const pf = ce(pb, 'div', 'te-progress-fill'); pf.style.width = pct + '%';
        ce(c, 'p', 'te-progress-label', `${curTicks} / ${maxTicks} ticks (${pct}%)`);
        if (t.consequence) { const m = ce(c, 'div', 'te-card-meta'); const r = ce(m, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Consequence'); ce(r, 'span', '', String(t.consequence).slice(0, 80)); }
        const a = ce(c, 'div', 'te-card-actions');
        btn(a, '+Tick', 'te-btn is-sm is-run', async () => {
          t.currentTick = Math.min(maxTicks, curTicks + 1);
          upsert(state, 'timers', t);
          logSessionEvent(plugin, 'Timer Advanced', `${t.name} → ${t.currentTick}/${maxTicks}`);
          await saveStateQuiet(plugin);
          rebuildTimers();
        });
        btn(a, 'Edit', 'te-btn is-sm', () => new TimerModal(plugin.app, plugin, t).open());
        btn(a, 'Delete', 'te-btn is-sm is-danger', async () => {
          removeItem(state, 'timers', t.id);
          logSessionEvent(plugin, 'Timer Removed', t.name);
          await saveStateQuiet(plugin);
          rebuildTimers();
        });
      });
    }
    btn(timerWrap, '+ New Timer', 'te-btn is-sm', () => new TimerModal(plugin.app, plugin).open());
  };
  rebuildTimers();

  // ── 5. Secrets Panel ─────────────────────────────────────────────────────────
  sectionHead(rightCol, '🔒 Secrets');
  const secWrap = ce(rightCol, 'div', 'te-card'); secWrap.style.padding = '12px';
  const campSecrets = safeArr(state.entities.secrets).filter(s => !state.activeCampaignId || s.campaignId === state.activeCampaignId);
  const pendingHandouts = safeArr(state.entities.handouts).filter(h => (!state.activeCampaignId || h.campaignId === state.activeCampaignId) && h.visibility === 'dm-only');
  if (!campSecrets.length && !pendingHandouts.length) {
    ce(secWrap, 'p', 'te-empty-state', 'No secrets for this campaign.');
  } else {
    campSecrets.forEach(s => {
      const row = ce(secWrap, 'div', '');
      row.style.cssText = 'padding:5px 0;border-bottom:1px solid var(--te-border);display:flex;gap:6px;align-items:center;font-size:.85rem';
      const statusIcon = s.revealStatus === 'Fully Revealed' ? '✅' : s.revealStatus === 'Partially Revealed' ? '🔓' : '🔒';
      ce(row, 'span', '', statusIcon);
      const nm = ce(row, 'span', ''); nm.textContent = s.name; nm.style.flex = '1';
      if (s.revealStatus !== 'Fully Revealed') {
        btn(row, 'Reveal', 'te-btn is-sm is-primary', async () => {
          s.revealStatus = 'Fully Revealed'; s.visibility = 'revealed'; s.revealedAt = new Date().toISOString();
          upsert(state, 'secrets', s);
          logSessionEvent(plugin, 'Secret Revealed', s.name);
          await saveStateQuiet(plugin);
          new Notice(`"${s.name}" revealed!`);
        });
      }
    });
    if (pendingHandouts.length) {
      ce(secWrap, 'div', 'te-stat-label', 'Handouts').style.marginTop = '8px';
      pendingHandouts.forEach(h => {
        const row = ce(secWrap, 'div', '');
        row.style.cssText = 'padding:5px 0;border-bottom:1px solid var(--te-border);display:flex;gap:6px;align-items:center;font-size:.85rem';
        ce(row, 'span', '', '📄');
        const nm = ce(row, 'span', ''); nm.textContent = h.name; nm.style.flex = '1';
        btn(row, 'Share', 'te-btn is-sm is-primary', async () => {
          h.visibility = 'player-visible'; upsert(state, 'handouts', h);
          logSessionEvent(plugin, 'Handout Shared', h.name);
          await saveStateQuiet(plugin); new Notice(`"${h.name}" shared.`);
        });
      });
    }
  }
}

// ── WAR MACHINE (Phase 11) ────────────────────────────────────────────────────
function renderWarMachine(main, plugin, tabs) {
  pageHead(main, plugin, 'War Machine', 'Enemy templates, escalation timers, and hostile force management.', [
    { label: '+ Enemy Template', primary: true, onClick: () => new EnemyTemplateModal(plugin.app, plugin).open() },
    { label: '+ Timer', onClick: () => new TimerModal(plugin.app, plugin).open() },
  ], tabs);

  sectionHead(main, 'Escalation Timers');
  const timers = safeArr(plugin.state.entities.timers).filter(t => isInActiveCampaignScope(plugin.state, 'timers', t) && matchesSearch(t, plugin.state.search));
  if (timers.length) {
    const g = ce(main, 'div', 'te-grid');
    timers.forEach(t => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '⏱️'); ce(h, 'h3', 'te-card-title', t.name);
      if (t.summary) ce(c, 'p', 'te-card-body', (t.summary || '').slice(0, 100));
      // Progress bar
      const maxTicks = Math.max(1, parseInt(t.maxTicks) || 6);
      const curTicks = Math.min(maxTicks, parseInt(t.currentTick) || 0);
      const pct = Math.round((curTicks / maxTicks) * 100);
      const pb = ce(c, 'div', 'te-progress-bar');
      const pf = ce(pb, 'div', 'te-progress-fill'); pf.style.width = pct + '%';
      ce(c, 'p', 'te-progress-label', `${curTicks} / ${maxTicks} ticks (${pct}%)`);
      const meta = ce(c, 'div', 'te-card-meta');
      [['Status', t.status], ['Faction', resolveEntityDisplay('factions', t.factionId || '', plugin.state) || scrubLegacyPlaceholderText(t.faction)], ['Quest', resolveEntityDisplay('quests', t.questId || '', plugin.state)], ['BBEG', resolveEntityDisplay('bbegs', t.bbegId || '', plugin.state)], ['Consequence', t.consequence]].forEach(([k, v]) => { if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v).slice(0, 80)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, '+Tick', 'te-btn is-sm is-run', async () => { t.currentTick = Math.min(maxTicks, curTicks + 1); upsert(plugin.state, 'timers', t); await saveStateQuiet(plugin); });
      btn(a, 'Edit', 'te-btn is-sm', () => new TimerModal(plugin.app, plugin, t).open());
      btn(a, 'Reset', 'te-btn is-sm', async () => { t.currentTick = 0; upsert(plugin.state, 'timers', t); await saveStateQuiet(plugin); });
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'timers', t.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No timers yet.', 'Escalation timers track ticking threats and countdown events.'); }

  sectionHead(main, 'Enemy Templates');
  const templates = safeArr(plugin.state.entities.enemyTemplates).filter(t => isInActiveCampaignScope(plugin.state, 'enemyTemplates', t) && matchesSearch(t, plugin.state.search));
  if (templates.length) {
    const g = ce(main, 'div', 'te-grid');
    templates.forEach(t => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '⚔️'); ce(h, 'h3', 'te-card-title', t.name);
      if (t.summary) ce(c, 'p', 'te-card-body', (t.summary || '').slice(0, 100));
      const meta = ce(c, 'div', 'te-card-meta');
      [['CR', t.cr], ['Type', t.type], ['Faction', resolveEntityDisplay('factions', t.factionId || '', plugin.state) || scrubLegacyPlaceholderText(t.faction)], ['Role', t.role], ['AC', t.ac], ['HP', t.hp]].forEach(([k, v]) => { if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new EnemyTemplateModal(plugin.app, plugin, t).open());
      btn(a, 'Add to Encounter', 'te-btn is-sm is-primary', () => { plugin.state.activeSection = 'encounters'; plugin.saveState(); });
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'enemyTemplates', t.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No enemy templates.', 'Build reusable enemy stat blocks for your factions and encounters.'); }
}

// ── FACTION MATRIX (Phase 12) ─────────────────────────────────────────────────
function renderFactionMatrix(main, plugin, tabs) { renderRelationshipMatrix(main, plugin, tabs); }
function renderRelationshipMatrix(main, plugin, tabs) {
  const state = plugin.state;
  const allRels = safeArr(state.relationships);

  pageHead(main, plugin, 'Relationship Matrix', 'Map connections between factions, NPCs, PCs, settlements, quests, and other campaign entities.', [
    { label: '+ Relationship', primary: true, onClick: () => new RelationshipModal(plugin.app, plugin).open() },
  ], tabs);

  // Helper to resolve entity name from type + id
  const resolveName = (type, id) => {
    return resolveEntityDisplay(type, id, state) || id;
  };

  // ── All relationships ──────────────────────────────────────────────────────
  sectionHead(main, `All Relationships (${allRels.length})`);
  if (allRels.length) {
    // Group filter buttons
    const filterRow = ce(main, 'div', 'te-card-actions'); filterRow.style.marginBottom = '10px';
    const filters = ['All','NPC','Faction','PC','Settlement'];
    let activeFilter = 'All';
    const listEl = ce(main, 'div', 'te-grid');
    const renderRelList = () => {
      clear(listEl);
      const shown = allRels.filter(r => {
        if (activeFilter === 'All') return true;
        const label = (t => PICKABLE_ENTITY_TYPES.find(x => x.key === t)?.label || t);
        const fromLabel = label(r.fromEntityType || '');
        const toLabel = label(r.toEntityType || '');
        return fromLabel.includes(activeFilter) || toLabel.includes(activeFilter);
      });
      if (!shown.length) { ce(listEl, 'p', 'te-empty-state', 'No relationships match this filter.'); return; }
      shown.forEach(rel => {
        const fromName = rel.fromId ? resolveName(rel.fromEntityType, rel.fromId) : (rel.from || '?');
        const toName = rel.toId ? resolveName(rel.toEntityType, rel.toId) : (rel.to || '?');
        const fromLabel = rel.fromEntityType ? (PICKABLE_ENTITY_TYPES.find(x => x.key === rel.fromEntityType)?.label || rel.fromEntityType) : '';
        const toLabel = rel.toEntityType ? (PICKABLE_ENTITY_TYPES.find(x => x.key === rel.toEntityType)?.label || rel.toEntityType) : '';
        const c = ce(listEl, 'div', 'te-card');
        const h = ce(c, 'div', 'te-card-head');
        ce(h, 'span', 'te-card-icon', '🕸️');
        ce(h, 'h3', 'te-card-title', `${fromName} ↔ ${toName}`);
        const metaDiv = ce(c, 'div', 'te-card-meta');
        [['Type', rel.relationshipType || rel.type || ''], ['Attitude', rel.attitude || ''], ['From', fromLabel], ['To', toLabel], ['Notes', (rel.notes || '').slice(0, 80)]].forEach(([k, v]) => {
          if (!v) return; const r2 = ce(metaDiv, 'div', 'te-card-meta-row'); ce(r2, 'span', 'te-card-meta-label', k); ce(r2, 'span', '', v);
        });
        const acts = ce(c, 'div', 'te-card-actions');
        btn(acts, 'Edit', 'te-btn is-sm', () => new RelationshipModal(plugin.app, plugin, rel).open());
        btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => {
          state.relationships = state.relationships.filter(x => x.id !== rel.id);
          await plugin.saveState();
        });
      });
    };
    filters.forEach(f => {
      btn(filterRow, f, 'te-btn is-sm' + (f === activeFilter ? ' is-primary' : ''), () => {
        activeFilter = f;
        // update button styles
        Array.from(filterRow.querySelectorAll('button')).forEach((b, i) => {
          b.className = 'te-btn is-sm' + (filters[i] === f ? ' is-primary' : '');
        });
        renderRelList();
      });
    });
    renderRelList();
  } else {
    emptyState(main, 'No relationships yet.', 'Use "+ Relationship" to link any two entities.');
  }

  // ── Noble Families ─────────────────────────────────────────────────────────
  const showLegacyNobleFamilies = false;
  if (showLegacyNobleFamilies) sectionHead(main, 'Legacy Noble Families');
  const nobles = showLegacyNobleFamilies ? safeArr(state.entities.nobleFamilies).filter(x => matchesSearch(x, state.search)) : [];
  if (nobles.length) {
    const ng = ce(main, 'div', 'te-grid');
    nobles.forEach(nf => {
      const c = ce(ng, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🏰'); ce(h, 'h3', 'te-card-title', nf.name || 'Untitled');
      if (nf.motto) ce(c, 'p', 'te-card-body', `"${nf.motto}"`);
      const meta = ce(c, 'div', 'te-card-meta');
      [['Status', nf.status], ['Holdings', (nf.holdings || '').slice(0, 60)], ['Managed As', nf.migratedFactionId ? resolveEntityDisplay('factions', nf.migratedFactionId, state) : 'Faction / Noble House workflow']].forEach(([k, v]) => {
        if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v);
      });
      const acts = ce(c, 'div', 'te-card-actions');
      if (nf.migratedFactionId) {
        btn(acts, 'Open Noble House Faction', 'te-btn is-sm', () => {
          const faction = safeArr(state.entities.factions).find(item => item.id === nf.migratedFactionId);
          if (faction) new FactionModal(plugin.app, plugin, faction).open();
        });
      }
      const legacyLbl = ce(acts, 'span', 'te-muted-text');
      legacyLbl.textContent = 'Legacy record only';
      legacyLbl.style.fontSize = '.82rem';
    });
  } else if (showLegacyNobleFamilies) { emptyState(main, 'No legacy noble families found.', 'Manage active noble houses as Factions with the "Noble House" type.'); }

}

// ── ENDGAME (Phase 19) ────────────────────────────────────────────────────────
function renderEndgame(main, plugin, tabs) {
  const state = plugin.state;
  pageHead(main, plugin, 'Endgame & Realm Tracker', 'War fronts, realm incursions, broken cosmology reveals, and ending states.', [
    { label: '+ War Front', onClick: () => new WarFrontModal(plugin.app, plugin).open() },
    { label: '+ Incursion', onClick: () => new IncursionModal(plugin.app, plugin).open() },
    { label: '+ Ending State', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'endgameStates', null, endgameStateFields).open() },
  ], tabs);

  sectionHead(main, 'War Fronts');
  itemCards(main, plugin, 'warFronts', { items: safeArr(state.entities.warFronts).filter(item => isInActiveCampaignScope(state, 'warFronts', item)), meta: ['type', 'status', 'factionId', 'locationId', 'strength', 'timerIds'], hint: 'Add war fronts to track active conflicts across your realm.', onEdit: (plugin, key, item) => new WarFrontModal(plugin.app, plugin, item).open() });

  sectionHead(main, 'Realm Incursions');
  itemCards(main, plugin, 'incursions', { items: safeArr(state.entities.incursions).filter(item => isInActiveCampaignScope(state, 'incursions', item)), meta: ['type', 'status', 'originId', 'threat', 'warFrontIds', 'timerIds'], hint: 'Track planar incursions and realm-scale threats.', onEdit: (plugin, key, item) => new IncursionModal(plugin.app, plugin, item).open() });

  sectionHead(main, 'Ending States & Consequences');
  itemCards(main, plugin, 'endgameStates', { meta: ['type', 'status', 'trigger', 'consequence'], hint: 'Define the possible endings and major consequences for your campaign.' });

  sectionHead(main, 'Faction Final Alignments');
  const factions = safeArr(state.entities.factions);
  if (factions.length) {
    const g = ce(main, 'div', 'te-grid');
    factions.forEach(f => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '⚔️'); ce(h, 'h3', 'te-card-title', f.name);
      const meta = ce(c, 'div', 'te-card-meta');
      [['Endgame Stance', f.endgameStance], ['Final Goal', f.finalGoal], ['Fate', f.fate]].forEach(([k, v]) => { if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Set Endgame', 'te-btn is-sm', () => new FactionModal(plugin.app, plugin, f).open());
    });
  }
}

// ── PLAYER VIEW (old entry point kept for routing) ────────────────────────────
function renderPlayer(main, plugin) { renderPCOverview(main, plugin); }

// ── PC COMPANION (Phases 14-15) ───────────────────────────────────────────────
function renderPCOverview(main, plugin) {
  const state = plugin.state;
  pageHead(main, plugin, '👤 PC Companion', 'Your character dashboard — player-safe view.', [
    { label: '📤 Export Packet', onClick: () => exportPlayerSafePacket(plugin) },
    { label: '← DM Engine', onClick: async () => { state.mode = 'DM'; state.activeSection = state.lastDMSection || 'dashboard'; await plugin.saveState(); } },
  ]);

  const chars = safeArr(state.entities.characters);
  const camp = activeCampaign(state);

  if (camp) {
    sectionHead(main, 'Campaign');
    const cc = ce(main, 'div', 'te-card');
    const ch = ce(cc, 'div', 'te-card-head'); ce(ch, 'span', 'te-card-icon', '📜'); ce(ch, 'h3', 'te-card-title', camp.name);
    if (camp.summary) ce(cc, 'p', 'te-card-body', camp.summary);
  }

  sectionHead(main, 'Characters');
  if (!chars.length) {
    emptyState(main, 'No characters yet.', 'Use the Character Sheet section to create your character.');
    const a = ce(main, 'div', 'te-modal-actions');
    btn(a, '+ New Character', 'te-btn is-primary', () => new CharacterModal(plugin.app, plugin).open());
  } else {
    const g = ce(main, 'div', 'te-grid');
    chars.forEach(char => {
      const c = ce(g, 'div', 'te-card');
      const hd = ce(c, 'div', 'te-card-head'); ce(hd, 'span', 'te-card-icon', '🧙'); ce(hd, 'h3', 'te-card-title', char.name);
      ce(c, 'p', 'te-card-body', `${char.race || ''} ${char.class || ''} ${char.level ? `• Level ${char.level}` : ''}`.trim());
      const hpBar = ce(c, 'div', 'te-progress-bar');
      const maxHp = parseInt(char.maxHp) || 1;
      const curHp = Math.max(0, parseInt(char.hp) || 0);
      const pf = ce(hpBar, 'div', 'te-progress-fill'); pf.style.width = Math.round((curHp / maxHp) * 100) + '%';
      if (curHp <= maxHp * 0.25) pf.style.background = 'var(--te-danger)';
      ce(c, 'p', 'te-progress-label', `HP: ${curHp} / ${maxHp}${char.ac ? ` | AC: ${char.ac}` : ''}${char.speed ? ` | Speed: ${char.speed}` : ''}`);
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'View Sheet', 'te-btn is-sm is-primary', async () => { state.activeCharacterId = char.id; state.activeSection = 'pc-character'; await plugin.saveState(); });
      btn(a, 'Edit', 'te-btn is-sm', () => new CharacterModal(plugin.app, plugin, char).open());
    });
    const ra = ce(main, 'div', 'te-modal-actions');
    btn(ra, '+ New Character', 'te-btn', () => new CharacterModal(plugin.app, plugin).open());
    btn(ra, '💤 Long Rest', 'te-btn is-primary', async () => {
      chars.forEach(c => { c.hp = c.maxHp || c.hp; c.updatedAt = new Date().toISOString(); upsert(state, 'characters', c); });
      await plugin.saveState(); new Notice('Long Rest complete — HP restored.');
    });
    btn(ra, '🛌 Short Rest', 'te-btn', () => new Notice('Short Rest taken. Use Hit Dice to recover HP.'));
  }

  sectionHead(main, 'Active Quests');
  const visQ = safeArr(state.entities.quests).filter(q => q.visibility === 'player-visible' && q.status === 'Active');
  if (visQ.length) {
    const g = ce(main, 'div', 'te-grid');
    visQ.forEach(q => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '📋'); ce(h, 'h3', 'te-card-title', q.name);
      ce(c, 'p', 'te-card-body', q.playerSummary || q.summary || '');
    });
  } else { emptyState(main, 'No active quests visible.'); }
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

// Field arrays for entity types that previously used bare GenericModal calls
const reputationFields = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'factionId', label: 'Faction', type: 'entityRef', entityType: 'factions' },
  { key: 'faction', label: 'Faction (legacy text)', type: 'text', legacy: true },
  { key: 'level', label: 'Reputation Level', type: 'select', options: ['Exalted','Revered','Honoured','Friendly','Neutral','Unfriendly','Hostile','Hated'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
const warFrontFields = [
  { key: 'name', label: 'War Front Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Active Front','Stalemate','Advance','Retreat','Siege','Guerrilla Campaign','Ceasefire','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Active','Escalating','Stalemate','Cooling Down','Resolved'] },
  { key: 'factionId', label: 'Primary Faction', type: 'entityRef', entityType: 'factions' },
  { key: 'faction', label: 'Primary Faction (legacy text)', type: 'text', legacy: true },
  { type: 'typedEntityRef', label: 'Location', typeKey: 'locationType', idKey: 'locationId', entityTypes: LOCATION_LIKE_ENTITY_TYPES },
  { key: 'location', label: 'Location (legacy text)', type: 'text', legacy: true },
  { key: 'strength', label: 'Enemy Strength', type: 'chip', opts: { suggestions: ['Weak','Pressured','Evenly Matched','Strong','Overwhelming','Breaking','Custom'] } },
  { key: 'timerIds', label: 'Linked Timers', type: 'entityMultiRef', entityType: 'timers' },
  { key: 'incursionIds', label: 'Linked Incursions', type: 'entityMultiRef', entityType: 'incursions' },
  { key: 'questIds', label: 'Linked Quests', type: 'entityMultiRef', entityType: 'quests' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const incursionFields = [
  { key: 'name', label: 'Incursion Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Raid','Occupation','Corruption Spread','Portal Opening','Army Advance','Arcane Storm','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Emerging','Active','Critical','Contained','Repelled'] },
  { type: 'typedEntityRef', label: 'Origin', typeKey: 'originType', idKey: 'originId', entityTypes: INCURSION_ORIGIN_ENTITY_TYPES },
  { key: 'origin', label: 'Origin (legacy text)', type: 'text', legacy: true },
  { key: 'threat', label: 'Threat Level', type: 'select', options: ['Low','Medium','High','Critical','Existential'] },
  { key: 'progress', label: 'Current Progress', type: 'text' },
  { key: 'warFrontIds', label: 'Linked War Fronts', type: 'entityMultiRef', entityType: 'warFronts' },
  { key: 'timerIds', label: 'Linked Timers', type: 'entityMultiRef', entityType: 'timers' },
  { key: 'factionIds', label: 'Factions', type: 'entityMultiRef', entityType: 'factions' },
  { key: 'locationIds', label: 'Locations', type: 'entityMultiRef', entityType: 'locations' },
  { key: 'sessionIds', label: 'Sessions', type: 'entityMultiRef', entityType: 'sessions' },
  { key: 'questIds', label: 'Quests', type: 'entityMultiRef', entityType: 'quests' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const endgameStateFields = [
  { key: 'name', label: 'Ending State Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Victory','Defeat','Pyrrhic Victory','Bittersweet','Ambiguous','Tragedy','Transcendence','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Possible','Likely','Inevitable','Averted','Achieved'] },
  { key: 'trigger', label: 'Trigger Condition', type: 'textarea' },
  { key: 'consequence', label: 'World Consequence', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

const nationFields = [
  { key: 'name', label: 'Nation Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Empire','Kingdom','Republic','City-State','Confederation','Theocracy','Tribal Land','Occupied Territory','Other'] },
  { key: 'rulerNpcId', label: 'Ruler / Leader', type: 'entityRef', entityType: 'npcs' },
  { key: 'ruler', label: 'Ruler (legacy text)', type: 'text', legacy: true },
  { key: 'capitalId', label: 'Capital', type: 'entityRef', entityType: 'settlements' },
  { key: 'capital', label: 'Capital (legacy text)', type: 'text', legacy: true },
  { key: 'government', label: 'Government', type: 'chip', opts: { bank: 'governmentTypes' } },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'military', label: 'Military Strength', type: 'text' },
  { key: 'economy', label: 'Economy', type: 'chip', opts: { bank: 'economyTypes' } },
  { key: 'allyIds', label: 'Allies', type: 'entityMultiRef', entityType: 'factions' },
  { key: 'allies', label: 'Allies (legacy text)', type: 'chip', legacy: true },
  { key: 'enemyIds', label: 'Enemies', type: 'entityMultiRef', entityType: 'factions' },
  { key: 'enemies', label: 'Enemies (legacy text)', type: 'chip', legacy: true },
  { key: 'history', label: 'History', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const religionFields = [
  { key: 'name', label: 'Religion Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Monotheistic','Polytheistic','Animistic','Druidic','Ancestor Worship','Cult','Secret Society','Philosophical','Other'] },
  { key: 'deityId', label: 'Primary Deity', type: 'entityRef', entityType: 'deities' },
  { key: 'deity', label: 'Primary Deity (legacy text)', type: 'text', legacy: true },
  { key: 'alignment', label: 'Alignment', type: 'select', options: ALIGNMENTS },
  { key: 'domainId', label: 'Domain (linked)', type: 'entityRef', entityType: 'domains' },
  { key: 'domain', label: 'Domain / Aspect (legacy text)', type: 'text', legacy: true },
  { key: 'practices', label: 'Practices & Rituals', type: 'chip', opts: { bank: 'religionPractices' } },
  { key: 'practicesNotes', label: 'Practices Notes', type: 'textarea' },
  { key: 'symbols', label: 'Symbols (chip)', type: 'chip' },
  { key: 'holyDays', label: 'Holy Days', type: 'chip' },
  { key: 'clergy', label: 'Clergy / Hierarchy', type: 'chip', opts: { bank: 'clergyTypes' } },
  { key: 'clergyNotes', label: 'Clergy Notes', type: 'text' },
  { key: 'templeIds', label: 'Temples / Holy Sites', type: 'entityMultiRef', entityType: 'locations' },
  { key: 'temples', label: 'Temples (legacy text)', type: 'chip', legacy: true },
  { key: 'restrictions', label: 'Taboos & Restrictions', type: 'chip', opts: { bank: 'religiousTaboos' } },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const districtFields = [
  { key: 'name', label: 'District Name', type: 'text' },
  { key: 'settlementId', label: 'Settlement', type: 'entityRef', entityType: 'settlements' },
  { key: 'type', label: 'Type', type: 'select', options: ['Market','Residential','Noble Quarter','Docks','Temple District','Slums','Military','Industrial','Foreign Quarter','Ruined','Underground','Other'] },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'atmosphere', label: 'Atmosphere', type: 'chip', opts: { bank: 'districtAtmosphere' } },
  { key: 'notableLocationIds', label: 'Notable Locations', type: 'entityMultiRef', entityType: 'locations' },
  { key: 'notableLocations', label: 'Notable Locations (legacy text)', type: 'chip', legacy: true },
  { key: 'factionIds', label: 'Active Factions', type: 'entityMultiRef', entityType: 'factions' },
  { key: 'factions', label: 'Active Factions (legacy text)', type: 'chip', legacy: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const roomFields = [
  { key: 'name', label: 'Room Name', type: 'text' },
  { type: 'typedEntityRef', label: 'Parent Location / Dungeon (linked)', typeKey: 'locationType', idKey: 'locationId',
    entityTypes: [{ key: 'locations', label: 'Location' }, { key: 'dungeons', label: 'Dungeon' }] },
  { key: 'type', label: 'Room Type', type: 'select', options: ['Entrance','Corridor','Chamber','Guard Post','Secret Room','Boss Chamber','Treasure Room','Trap Room','Rest Area','Shrine','Prison','Workshop','Library','Other'] },
  { key: 'features', label: 'Features', type: 'chip', opts: { suggestions: ['Collapsed Pillars','Runic Circle','Hidden Cache','Flooded Floor','Whispering Walls','Custom'] } },
  { key: 'traps', label: 'Traps (chip — not entity-backed)', type: 'chip', opts: { bank: 'hazardTypes' } },
  { key: 'connectedRoomIds', label: 'Connected Rooms', type: 'entityMultiRef', entityType: 'rooms' },
  { key: 'connections', label: 'Connected Rooms (legacy text)', type: 'chip', legacy: true },
  { key: 'lootIds', label: 'Loot', type: 'entityMultiRef', entityType: 'loot' },
  { key: 'loot', label: 'Loot (legacy text)', type: 'textarea', legacy: true },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const timelineFields = [
  { key: 'name', label: 'Event Name', type: 'text' },
  { key: 'date', label: 'In-World Date', type: 'text' },
  { key: 'era', label: 'Era / Age', type: 'text' },
  { key: 'type', label: 'Event Type', type: 'select', options: ['World Event','Campaign Event','Session Event','Character Event','Faction Event','Discovery','Battle','Political','Catastrophe','Other'] },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'impact', label: 'World Impact', type: 'textarea' },
  { key: 'linkedSessionId', label: 'Linked Session', type: 'entityRef', entityType: 'sessions' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const revealFields = [
  { key: 'name', label: 'Reveal Name', type: 'text' },
  { key: 'secretId', label: 'Related Secret', type: 'entityRef', entityType: 'secrets' },
  { key: 'status', label: 'Status', type: 'select', options: ['Pending','Delivered','Deflected','Spoiled','Skipped'] },
  { key: 'sessionId', label: 'Delivery Session', type: 'entityRef', entityType: 'sessions' },
  { key: 'session', label: 'Delivery Session (legacy text)', type: 'text', legacy: true },
  { key: 'trigger', label: 'Trigger / Method', type: 'textarea' },
  { key: 'effect', label: 'Story Effect', type: 'textarea' },
  { key: 'playerReaction', label: 'Player Reaction', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const lootFields = [
  { key: 'name', label: 'Item Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Weapon','Armour','Magic Item','Consumable','Valuables','Currency','Trade Good','Mundane','Other'] },
  { key: 'rarity', label: 'Rarity', type: 'select', options: ['Common','Uncommon','Rare','Very Rare','Legendary','Artifact'] },
  { key: 'value', label: 'Value (gp)', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'encounterId', label: 'Source Encounter', type: 'entityRef', entityType: 'encounters' },
  { key: 'status', label: 'Status', type: 'select', options: ['Available','Claimed','Sold','Lost','Destroyed'] },
  { type: 'typedEntityRef', label: 'Claimed By (linked)', typeKey: 'claimedByType', idKey: 'claimedById',
    entityTypes: [
      { key: 'characters', label: 'PC / Character' },
      { key: 'npcs', label: 'NPC' },
      { key: 'factions', label: 'Faction' },
    ],
  },
  { key: 'claimedBy', label: 'Claimed By (legacy text)', type: 'text', legacy: true },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];

// Central schema lookup — maps every entity key to its GenericModal field array.
// Used by defaultEdit() so every Edit button opens a schema-aware form.
const ENTITY_FIELD_SCHEMAS = {
  worlds: worldFields,
  cosmologies: cosmologyFields,
  realms: realmFields,
  deities: deityFields,
  cultures: cultureFields,
  languages: langFields,
  regions: regionFields,
  domains: domainFields,
  settlements: settlementFields,
  locations: locationFields,
  pois: poiFields,
  routes: routeFields,
  adventures: adventureFields,
  rules: ruleFields,
  downtime: downtimeFields,
  bastions: bastionFields,
  milestones: milestoneFields,
  acts: actFields,
  handouts: handoutFields,
  compendium: compendiumFields,
  journals: journalFields,
  reputations: reputationFields,
  warFronts: warFrontFields,
  incursions: incursionFields,
  endgameStates: endgameStateFields,
  nations: nationFields,
  religions: religionFields,
  districts: districtFields,
  rooms: roomFields,
  timelines: timelineFields,
  reveals: revealFields,
  loot: lootFields,
  hybridAncestries: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'dominantAncestry', label: 'Dominant Ancestry', type: 'text' },
    { key: 'recessiveAncestry', label: 'Recessive Ancestry', type: 'text' },
    { key: 'size', label: 'Size', type: 'select', options: ['Tiny','Small','Medium','Large','Huge','Gargantuan'] },
    { key: 'creatureType', label: 'Creature Type', type: 'text' },
    { key: 'dominantCultureId', label: 'Dominant Culture', type: 'entityRef', entityType: 'cultures' },
    { key: 'dominantCulture', label: 'Dominant Culture (text)', type: 'text', legacy: true },
    { key: 'recessiveCultureId', label: 'Recessive Culture', type: 'entityRef', entityType: 'cultures' },
    { key: 'recessiveCulture', label: 'Recessive Culture (text)', type: 'text', legacy: true },
    { key: 'raisedInId', label: 'Raised In', type: 'entityRef', entityType: 'cultures' },
    { key: 'raisedIn', label: 'Raised In (text)', type: 'text', legacy: true },
    { key: 'visibility', label: 'Visibility', type: 'select', options: ['dm-only','player-visible'] },
    { key: 'summary', label: 'Summary', type: 'textarea' },
  ],
  damageTypes: [
    { key: 'name', label: 'Damage Type', type: 'text' },
    { key: 'summary', label: 'Description', type: 'textarea' },
    { key: 'immunity', label: 'Common Immunities', type: 'text' },
    { key: 'resistance', label: 'Common Resistances', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  tables: [
    { key: 'name', label: 'Table Name', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'content', label: 'Table Content (one entry per line)', type: 'textarea' },
    { key: 'summary', label: 'Description', type: 'textarea' },
    { key: 'visibility', label: 'Visibility', type: 'select', options: ['dm-only','player-visible'] },
  ],
  // Noble Families — legacy entity type kept for backward compat; new entries migrate to Factions with type='Noble House'
  nobleFamilies: [
    { key: 'name', label: 'House / Family Name', type: 'text' },
    { key: 'motto', label: 'Motto', type: 'text' },
    { key: 'headOfHouse', label: 'Head of House', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: ['Ruling','Noble','Gentry','Declining','Exiled','Extinct','Unknown'] },
    { key: 'holdings', label: 'Holdings', type: 'text' },
    { key: 'claims', label: 'Claims', type: 'textarea' },
    { key: 'debts', label: 'Debts', type: 'textarea' },
    { key: 'members', label: 'Members', type: 'textarea' },
    { key: 'secrets', label: 'Secrets & Scandals', type: 'textarea' },
    { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'visibility', label: 'Visibility', type: 'select', options: ['dm-only','player-visible','secret'] },
  ],
};

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


// ── PC COMPANION extra sections ───────────────────────────────────────────────
function renderPCCharacter(main, plugin) {
  const state = plugin.state;
  const chars = safeArr(state.entities.characters);
  pageHead(main, plugin, 'Character Sheet', '', [
    { label: '+ New Character', primary: !chars.length, onClick: () => new CharacterModal(plugin.app, plugin).open() },
  ]);
  if (!chars.length) { emptyState(main, 'No characters yet.', 'Create your first character to get started.'); return; }

  const activeId = state.activeCharacterId;
  const char = chars.find(c => c.id === activeId) || chars[0];

  // Character selector if multiple
  if (chars.length > 1) {
    const sel = ce(main, 'select', ''); sel.style.cssText = 'margin-bottom:12px;padding:6px 10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
    chars.forEach(c => { const o = ce(sel, 'option', '', c.name); o.value = c.id; if (c.id === char.id) o.selected = true; });
    sel.addEventListener('change', async () => { state.activeCharacterId = sel.value; await plugin.saveState(); });
  }

  // Full character display
  const c = ce(main, 'div', 'te-card');
  c.style.marginBottom = '16px';
  const hd = ce(c, 'div', 'te-card-head'); ce(hd, 'span', 'te-card-icon', '🧙'); ce(hd, 'h3', 'te-card-title', char.name);
  ce(c, 'p', 'te-card-body', `${char.race || ''} ${char.class || ''} ${char.background ? `(${char.background})` : ''}${char.level ? ` • Level ${char.level}` : ''}`.trim());

  // HP tracker
  const hpWrap = ce(c, 'div', ''); hpWrap.style.cssText = 'display:flex;gap:8px;align-items:center;padding:12px 0;flex-wrap:wrap';
  const maxHp = parseInt(char.maxHp) || 1;
  let curHp = parseInt(char.hp) || 0;
  const hpBar = ce(hpWrap, 'div', 'te-progress-bar'); hpBar.style.flex = '1';
  const pf = ce(hpBar, 'div', 'te-progress-fill'); pf.style.width = Math.round((Math.max(0, curHp) / maxHp) * 100) + '%';
  if (curHp <= maxHp * 0.25) pf.style.background = 'var(--te-danger)';
  else if (curHp <= maxHp * 0.5) pf.style.background = 'var(--color-yellow, #f5a623)';
  const hpLabel = ce(hpWrap, 'span', '', `HP: ${curHp}/${maxHp}`);
  const hpInp = ce(hpWrap, 'input'); hpInp.type = 'number'; hpInp.value = String(curHp);
  hpInp.style.cssText = 'width:70px;padding:4px 6px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  hpInp.placeholder = 'Set HP';
  btn(hpWrap, 'Set HP', 'te-btn is-sm', async () => { const v = parseInt(hpInp.value); if (!isNaN(v)) { char.hp = v; upsert(state, 'characters', char); await saveStateQuiet(plugin); } });
  btn(hpWrap, '-1', 'te-btn is-sm is-danger', async () => { char.hp = Math.max(0, (parseInt(char.hp) || 0) - 1); upsert(state, 'characters', char); await saveStateQuiet(plugin); });
  btn(hpWrap, '+1', 'te-btn is-sm', async () => { char.hp = Math.min(parseInt(char.maxHp) || 999, (parseInt(char.hp) || 0) + 1); upsert(state, 'characters', char); await saveStateQuiet(plugin); });

  // XP progress bar
  if (typeof char.xp === 'number') {
    const lvl = Math.max(1, Math.min(19, char.level || 1));
    const curXp = char.xp;
    const prevXp = XP_THRESHOLDS[lvl] || 0;
    const nextXp = XP_THRESHOLDS[lvl + 1];
    const xpWrap = ce(c, 'div', ''); xpWrap.style.padding = '6px 0';
    if (nextXp && lvl < 20) {
      const pct = Math.min(100, Math.max(0, Math.round(((curXp - prevXp) / Math.max(1, nextXp - prevXp)) * 100)));
      ce(xpWrap, 'p', 'te-progress-label', `XP: ${curXp.toLocaleString()} / ${nextXp.toLocaleString()} — Level ${lvl} → ${lvl + 1}`);
      const xpBar = ce(xpWrap, 'div', 'te-progress-bar');
      const xpFill = ce(xpBar, 'div', 'te-progress-fill'); xpFill.style.width = pct + '%'; xpFill.style.background = 'var(--color-purple,#8b5cf6)';
    } else {
      ce(xpWrap, 'p', 'te-progress-label', `XP: ${curXp.toLocaleString()} — Max Level`);
    }
  }

  // Stat grid (initiative = DEX mod if not overridden)
  const calcInit = char.initiative != null ? char.initiative : modStr(char.dex || 10);
  const sg = ce(c, 'div', 'te-stat-grid'); sg.style.marginTop = '8px';
  [['AC', char.ac], ['Speed', char.speed], ['Initiative', calcInit], ['Prof.', char.level ? '+' + profBonus(char.level) : '']].forEach(([k, v]) => { if (!v && v !== 0) return; const sc = ce(sg, 'div', 'te-stat-card'); ce(sc, 'div', 'te-stat-big', String(v)); ce(sc, 'div', 'te-stat-label', k); });

  // Ability scores
  const abilityGrid = ce(c, 'div', 'te-ability-grid');
  ['str','dex','con','int','wis','cha'].forEach(ab => {
    const box = ce(abilityGrid, 'div', 'te-ability-box');
    ce(box, 'div', 'te-ability-label', ab.toUpperCase());
    ce(box, 'div', 'te-ability-score', String(char[ab] || 10));
    ce(box, 'div', 'te-ability-mod', modStr(char[ab] || 10));
  });

  // Saving throws + passive perception
  const ST_LABELS = ['STR','DEX','CON','INT','WIS','CHA'];
  const ST_KEYS   = ['str','dex','con','int','wis','cha'];
  const stHead = ce(c, 'div', ''); stHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:var(--te-gap-sm) 0 4px';
  ce(stHead, 'span', 'te-card-meta-label', 'Saving Throws');
  const passPerc = 10 + modifier(char.wis || 10) + (safeArr(char.skills).includes('Perception') ? profBonus(char.level || 1) : 0);
  ce(stHead, 'span', 'te-progress-label', `Passive Perception: ${passPerc}`);
  const stGrid = ce(c, 'div', 'te-ability-grid');
  ST_KEYS.forEach((ab, i) => {
    const prof = safeArr(char.savingThrows).includes(ST_LABELS[i]);
    const val  = modifier(char[ab] || 10) + (prof ? profBonus(char.level || 1) : 0);
    const box  = ce(stGrid, 'div', 'te-ability-box' + (prof ? ' is-proficient' : ''));
    ce(box, 'div', 'te-ability-label', ST_LABELS[i]);
    ce(box, 'div', 'te-ability-score', (val >= 0 ? '+' : '') + val);
    if (prof) ce(box, 'div', 'te-ability-mod', '●');
  });

  const meta = ce(c, 'div', 'te-card-meta');
  [['Alignment', char.alignment], ['Background', char.background]].forEach(([k, v]) => { if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v); });
  if (safeArr(char.skills).length) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Skills'); ce(r, 'span', '', char.skills.join(', ')); }
  if (safeArr(char.features).length) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Features'); ce(r, 'span', '', char.features.join(', ')); }
  if (char.backstory) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Backstory'); ce(r, 'span', '', char.backstory.slice(0, 120)); }

  // Death saves (only when HP = 0)
  if ((parseInt(char.hp) || 0) === 0) {
    const dsWrap = ce(c, 'div', ''); dsWrap.style.padding = '8px 0';
    ce(dsWrap, 'div', 'te-card-meta-label', 'Death Saving Throws');
    const ds = char.deathSaves || { successes: 0, failures: 0 };
    const dsRow = ce(dsWrap, 'div', 'te-death-saves');
    ['Successes','Failures'].forEach(kind => {
      const row = ce(dsRow, 'div', 'te-death-save-row');
      ce(row, 'span', 'te-death-save-label', kind === 'Successes' ? '✓ Successes' : '✗ Failures');
      for (let i = 0; i < 3; i++) {
        const count = kind === 'Successes' ? ds.successes : ds.failures;
        const filled = i < count;
        const b = ce(row, 'div', 'te-save-bubble' + (filled ? (kind === 'Successes' ? ' is-success' : ' is-failure') : ''));
        b.addEventListener('click', async () => {
          if (!char.deathSaves) char.deathSaves = { successes: 0, failures: 0 };
          const cur = kind === 'Successes' ? char.deathSaves.successes : char.deathSaves.failures;
          const next = i < cur ? i : i + 1;
          if (kind === 'Successes') char.deathSaves.successes = next;
          else char.deathSaves.failures = next;
          upsert(state, 'characters', char); await saveStateQuiet(plugin);
        });
      }
    });
    btn(dsWrap, 'Reset', 'te-btn is-sm is-danger', async () => { char.deathSaves = { successes: 0, failures: 0 }; upsert(state, 'characters', char); await saveStateQuiet(plugin); });
  }

  const a = ce(c, 'div', 'te-card-actions');
  btn(a, 'Full Edit', 'te-btn is-sm is-primary', () => new CharacterModal(plugin.app, plugin, char).open());
  btn(a, '💤 Long Rest', 'te-btn is-sm', async () => { char.hp = char.maxHp || char.hp; upsert(state, 'characters', char); await plugin.saveState(); new Notice('Long Rest — HP restored.'); });
  btn(a, 'Write Note', 'te-btn is-sm', () => writeEntityNote(plugin, 'characters', char));
}

async function renderPCInventory(main, plugin) {
  const state = plugin.state;
  pageHead(main, plugin, '🎒 Inventory', 'Track equipment, currency, and carried items.', []);
  const chars = safeArr(state.entities.characters);
  if (!chars.length) { emptyState(main, 'No characters yet.', 'Create a character first.'); return; }
  const char = chars.find(c => c.id === state.activeCharacterId) || chars[0];

  sectionHead(main, 'Coin Purse');
  const coins = char.currency || {};
  const coinRow = ce(main, 'div', ''); coinRow.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px';
  ['pp','gp','ep','sp','cp'].forEach(coin => {
    const w = ce(coinRow, 'div', 'te-stat-card'); w.style.minWidth = '70px';
    const inp = ce(w, 'input'); inp.type = 'number'; inp.value = String(coins[coin] || 0);
    inp.style.cssText = 'width:100%;text-align:center;font-size:1.2rem;font-weight:700;background:transparent;border:0;color:var(--te-text)';
    ce(w, 'div', 'te-stat-label', coin.toUpperCase());
    inp.addEventListener('change', async () => { if (!char.currency) char.currency = {}; char.currency[coin] = parseInt(inp.value) || 0; upsert(state, 'characters', char); await saveStateQuiet(plugin); });
  });

  sectionHead(main, 'Equipment & Items');
  const items = safeArr(char.equipment);
  if (items.length) {
    const g = ce(main, 'div', 'te-grid');
    items.forEach((item, i) => {
      const isObj = item && typeof item === 'object';
      const name = isObj ? (item.name || 'Item') : item;
      const meta = isObj ? [item.category, item.type, item.quantity > 1 ? `×${item.quantity}` : null].filter(Boolean).join(' · ') : '';
      const equipped = isObj ? item.equipped : false;
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head');
      ce(h, 'span', 'te-card-icon', equipped ? '✅' : '🎒');
      ce(h, 'h3', 'te-card-title', name);
      if (meta) { const m = ce(h, 'span', 'te-card-meta-label', meta); m.style.marginLeft = '6px'; }
      const a = ce(c, 'div', 'te-card-actions');
      if (isObj) {
        btn(a, equipped ? 'Unequip' : 'Equip', 'te-btn is-sm', async () => { char.equipment[i] = { ...item, equipped: !equipped }; upsert(state, 'characters', char); await plugin.saveState(); });
      }
      btn(a, 'Remove', 'te-btn is-sm is-danger', async () => { char.equipment = char.equipment.filter((_, j) => j !== i); upsert(state, 'characters', char); await plugin.saveState(); });
    });
  }
  const addRow = ce(main, 'div', ''); addRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap';
  const inp = ce(addRow, 'input'); inp.type = 'text'; inp.placeholder = 'Item name…'; inp.style.flex = '1';
  btn(addRow, '+ Add', 'te-btn is-sm is-primary', async () => {
    const v = inp.value.trim();
    if (v) { if (!char.equipment) char.equipment = []; char.equipment.push({ name: v, type: '', category: '', quantity: 1, equipped: false, sourceKey: 'custom' }); upsert(state, 'characters', char); await plugin.saveState(); inp.value = ''; }
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addRow.querySelector('button').click(); } });

  // Equipment Browser (backed by equipment.json via ReferenceDataService)
  sectionHead(main, 'Equipment Browser');
  const allEquip = await plugin.refData.get('equipment');
  const ebs = { search: '', expanded: null };
  const eWrap = ce(main, 'div', '');
  const rebuildEquipBrowser = () => {
    clear(eWrap);
    const sRow = ce(eWrap, 'div', ''); sRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
    const sIn = ce(sRow, 'input'); sIn.type = 'text'; sIn.placeholder = 'Search equipment…'; sIn.value = ebs.search;
    sIn.style.cssText = 'flex:1;padding:7px 10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);font-size:.9rem';
    sIn.addEventListener('input', () => { ebs.search = sIn.value; ebs.expanded = null; rebuildEquipBrowser(); });
    if (!allEquip.length) { ce(eWrap, 'p', 'te-empty-state', 'Equipment data not loaded. Ensure data/equipment.json is present.'); return; }
    const filtered = plugin.refData.search(allEquip, ebs.search).slice(0, 80);
    const listEl = ce(eWrap, 'div', 'te-grid');
    filtered.forEach(eq => {
      const carried = safeArr(char.equipment).some(it => (typeof it === 'string' ? it : it.name) === eq.name);
      const c = ce(listEl, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); h.style.cursor = 'pointer';
      ce(h, 'h3', 'te-card-title', eq.name);
      const m = ce(h, 'span', 'te-card-meta-label', refItemMeta('equipment', eq)); m.style.marginLeft = '6px';
      const isOpen = ebs.expanded === eq.name;
      if (isOpen) { const d = ce(c, 'div', 'te-ref-detail'); refItemDetail(d, 'equipment', eq); }
      h.addEventListener('click', () => { ebs.expanded = isOpen ? null : eq.name; rebuildEquipBrowser(); });
      const a = ce(c, 'div', 'te-card-actions');
      if (carried) {
        const lbl = ce(a, 'span', 'te-muted-text'); lbl.textContent = '✓ Carried'; lbl.style.fontSize = '.82rem';
      } else {
        btn(a, '+ Carry', 'te-btn is-sm is-primary', async () => {
          if (!char.equipment) char.equipment = []; char.equipment.push({ name: eq.name, type: eq.type || '', category: eq.category || '', quantity: 1, equipped: false, sourceKey: 'equipment' }); upsert(state, 'characters', char); await plugin.saveState(); new Notice(`"${eq.name}" added to inventory.`);
        });
      }
    });
    if (!filtered.length) ce(listEl, 'p', 'te-empty-state', `No equipment matches "${ebs.search}".`);
  };
  rebuildEquipBrowser();
}

async function renderPCSpellbook(main, plugin) {
  const state = plugin.state;
  pageHead(main, plugin, '📕 Spellbook', 'Known and prepared spells — backed by the full 5e spell list.');
  const chars = safeArr(state.entities.characters);
  if (!chars.length) { emptyState(main, 'No characters yet.'); return; }
  const char = chars.find(c => c.id === state.activeCharacterId) || chars[0];
  const isSpellcasterChar = SPELLCASTING_CLASSES.includes(char.class);
  if (!isSpellcasterChar) { emptyState(main, `${char.name} is a ${char.class || 'non-spellcasting class'}.`, 'Spellbook is available for spellcasting classes only.'); return; }

  // Spell Slots Tracker
  sectionHead(main, 'Spell Slots');
  ce(main, 'p', 'te-progress-label', 'Click a bubble to mark it used. Set max slots for each level. Resets on long rest.');
  const slotWrap = ce(main, 'div', 'te-spell-slots');
  for (let lvl = 1; lvl <= 9; lvl++) {
    const slotData = (char.spellSlots || {})[lvl] || { max: 0, used: 0 };
    if (lvl > 1 && slotData.max === 0) continue;
    const row = ce(slotWrap, 'div', 'te-slot-row');
    ce(row, 'span', 'te-slot-label', `Level ${lvl}`);
    const bubbles = ce(row, 'div', 'te-slot-bubbles');
    for (let i = 0; i < Math.max(slotData.max, 0); i++) {
      const b = ce(bubbles, 'div', 'te-slot-bubble' + (i < slotData.used ? ' is-used' : ''));
      b.addEventListener('click', async () => {
        if (!char.spellSlots) char.spellSlots = {};
        if (!char.spellSlots[lvl]) char.spellSlots[lvl] = { max: slotData.max, used: 0 };
        const cur = char.spellSlots[lvl].used || 0;
        char.spellSlots[lvl].used = i < cur ? i : Math.min(i + 1, char.spellSlots[lvl].max);
        upsert(state, 'characters', char); await saveStateQuiet(plugin);
      });
    }
    const maxInp = ce(row, 'input'); maxInp.type = 'number'; maxInp.min = '0'; maxInp.max = '9'; maxInp.value = String(slotData.max || 0);
    maxInp.title = 'Set maximum slots';
    maxInp.style.cssText = 'width:46px;font-size:.82rem;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);padding:2px 6px;text-align:center';
    maxInp.addEventListener('change', async () => {
      if (!char.spellSlots) char.spellSlots = {};
      const newMax = Math.max(0, Math.min(9, parseInt(maxInp.value) || 0));
      char.spellSlots[lvl] = { max: newMax, used: Math.min(newMax, (char.spellSlots[lvl] || {}).used || 0) };
      upsert(state, 'characters', char); await saveStateQuiet(plugin);
    });
  }
  const resetRow = ce(main, 'div', ''); resetRow.style.marginBottom = '16px';
  btn(resetRow, '↺ Long Rest — Reset Slots', 'te-btn is-sm', async () => {
    if (char.spellSlots) { Object.keys(char.spellSlots).forEach(k => { char.spellSlots[k].used = 0; }); }
    upsert(state, 'characters', char); await plugin.saveState(); new Notice('Spell slots reset (Long Rest).');
  });

  // Known Spells — use knownSpells field; fall back to legacy char.spells
  if (!char.knownSpells || !char.knownSpells.length) {
    if (safeArr(char.spells).length) { char.knownSpells = [...safeArr(char.spells)]; char.spells = []; }
  }
  const allRefSpells = await plugin.refData.get('spells');

  const renderSpellList = (parent, spellNames, onRemove) => {
    if (!spellNames.length) { ce(parent, 'p', 'te-empty-state', 'None yet.'); return; }
    const g = ce(parent, 'div', 'te-grid');
    spellNames.forEach((spellName, i) => {
      const refSpell = allRefSpells.find(s => s.name.toLowerCase() === spellName.toLowerCase());
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '✨'); ce(h, 'h3', 'te-card-title', spellName);
      if (refSpell) { const m = ce(h, 'span', 'te-card-meta-label', refItemMeta('spells', refSpell)); m.style.marginLeft = '6px'; }
      if (refSpell) {
        const detail = ce(c, 'div', 'te-ref-detail'); detail.style.display = 'none';
        refItemDetail(detail, 'spells', refSpell);
        h.style.cursor = 'pointer';
        h.addEventListener('click', () => { detail.style.display = detail.style.display === 'none' ? '' : 'none'; });
      }
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Remove', 'te-btn is-sm is-danger', async () => { onRemove(i); upsert(state, 'characters', char); await plugin.saveState(); new Notice(`"${spellName}" removed.`); });
    });
  };

  sectionHead(main, `${char.name}'s Known Spells`);
  const knownSpells = safeArr(char.knownSpells);
  renderSpellList(main, knownSpells, i => { char.knownSpells.splice(i, 1); });

  sectionHead(main, 'Prepared Spells');
  ce(main, 'p', 'te-progress-label', 'Mark spells as prepared from your known list, or add prepared-only spells here.');
  const preparedSpells = safeArr(char.preparedSpells);
  renderSpellList(main, preparedSpells, i => { char.preparedSpells.splice(i, 1); });
  const prepAddRow = ce(main, 'div', ''); prepAddRow.style.cssText = 'display:flex;gap:8px;margin-top:6px';
  const prepInp = ce(prepAddRow, 'input'); prepInp.type = 'text'; prepInp.placeholder = 'Spell name to prepare…'; prepInp.style.flex = '1';
  btn(prepAddRow, '+ Prepare', 'te-btn is-sm is-primary', async () => {
    const v = prepInp.value.trim();
    if (v && !safeArr(char.preparedSpells).includes(v)) { if (!char.preparedSpells) char.preparedSpells = []; char.preparedSpells.push(v); upsert(state, 'characters', char); await plugin.saveState(); new Notice(`"${v}" marked as prepared.`); prepInp.value = ''; }
  });

  // Spell Browser (search + level filter)
  sectionHead(main, 'Spell Browser');
  const bs = { search: '', level: 'all', expanded: null };
  const browserWrap = ce(main, 'div', '');
  const rebuildBrowser = () => {
    clear(browserWrap);
    const filterRow = ce(browserWrap, 'div', ''); filterRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px';
    const LEVELS = [['all','All'],['0','Cantrip'],['1','1'],['2','2'],['3','3'],['4','4'],['5','5'],['6','6'],['7','7'],['8','8'],['9','9']];
    LEVELS.forEach(([val, lbl]) => btn(filterRow, lbl, 'te-btn is-sm' + (bs.level === val ? ' is-primary' : ''), () => { bs.level = val; bs.expanded = null; rebuildBrowser(); }));
    const sRow = ce(browserWrap, 'div', ''); sRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
    const sIn = ce(sRow, 'input'); sIn.type = 'text'; sIn.placeholder = `Search ${char.class} spells…`; sIn.value = bs.search;
    sIn.style.cssText = 'flex:1;padding:7px 10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);font-size:.9rem';
    sIn.addEventListener('input', () => { bs.search = sIn.value; bs.expanded = null; rebuildBrowser(); });
    const listEl = ce(browserWrap, 'div', 'te-grid');
    let filtered = plugin.refData.search(allRefSpells, bs.search);
    if (bs.level !== 'all') filtered = filtered.filter(s => String(s.level) === bs.level);
    const shown = filtered.slice(0, 80);
    if (!shown.length) { listEl.className = ''; ce(listEl, 'p', 'te-empty-state', bs.search ? `No spells match "${bs.search}".` : 'No spells available.'); }
    shown.forEach(sp => {
      const known = safeArr(char.knownSpells).some(n => n.toLowerCase() === sp.name.toLowerCase());
      const c = ce(listEl, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); h.style.cursor = 'pointer';
      ce(h, 'h3', 'te-card-title', sp.name);
      const m = ce(h, 'span', 'te-card-meta-label', refItemMeta('spells', sp)); m.style.marginLeft = '6px';
      const isOpen = bs.expanded === sp.name;
      if (isOpen) { const d = ce(c, 'div', 'te-ref-detail'); refItemDetail(d, 'spells', sp); }
      h.addEventListener('click', () => { bs.expanded = isOpen ? null : sp.name; rebuildBrowser(); });
      const a = ce(c, 'div', 'te-card-actions');
      if (known) {
        const lbl = ce(a, 'span', 'te-muted-text'); lbl.textContent = '✓ Known'; lbl.style.fontSize = '.82rem';
      } else {
        btn(a, '+ Learn', 'te-btn is-sm is-primary', async () => {
          if (!char.knownSpells) char.knownSpells = []; if (!char.knownSpells.includes(sp.name)) { char.knownSpells.push(sp.name); upsert(state, 'characters', char); await plugin.saveState(); new Notice(`"${sp.name}" added to spellbook.`); }
        });
      }
    });
    if (filtered.length > 80) ce(browserWrap, 'p', 'te-empty-state', `Showing 80 of ${filtered.length} — refine your search.`);
  };
  rebuildBrowser();
}

function renderPCQuests(main, plugin) {
  pageHead(main, plugin, '📋 Quest Log', 'Quests visible to the party.');
  renderPlayerQuests(main, plugin);
}
function renderPCHandouts(main, plugin) {
  pageHead(main, plugin, '📄 Handouts', 'Handouts and documents shared by the DM.');
  renderPlayerHandouts(main, plugin);
}
function renderPCJournal(main, plugin) {
  pageHead(main, plugin, '📓 Journal', 'Session journals and personal notes.');
  renderPlayerJournal(main, plugin);
}
function renderPCLore(main, plugin) {
  pageHead(main, plugin, '🌐 World Lore', 'Player-safe world information.');
  renderPlayerLore(main, plugin);
  const nations = safeArr(plugin.state.entities.nations).filter(n => n.visibility !== 'dm-only' && n.visibility !== 'secret');
  if (nations.length) {
    sectionHead(main, 'Nations');
    const ng = ce(main, 'div', 'te-grid');
    nations.forEach(n => {
      const c = ce(ng, 'div', 'te-card');
      const hd = ce(c, 'div', 'te-card-head'); ce(hd, 'span', 'te-card-icon', '👑'); ce(hd, 'h3', 'te-card-title', n.name);
      const meta = ce(c, 'div', 'te-card-meta');
      [['Type', n.type], ['Ruler', n.ruler], ['Capital', n.capital]].forEach(([k, v]) => { if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v); });
      if (n.summary) ce(c, 'p', 'te-card-body', n.summary.slice(0, 120));
    });
  }
  const religions = safeArr(plugin.state.entities.religions).filter(r => r.visibility !== 'dm-only' && r.visibility !== 'secret');
  if (religions.length) {
    sectionHead(main, 'Religions');
    const rg = ce(main, 'div', 'te-grid');
    religions.forEach(r => {
      const c = ce(rg, 'div', 'te-card');
      const hd = ce(c, 'div', 'te-card-head'); ce(hd, 'span', 'te-card-icon', '🕍'); ce(hd, 'h3', 'te-card-title', r.name);
      const meta = ce(c, 'div', 'te-card-meta');
      [['Type', r.type], ['Deity', r.deity], ['Domain', r.domain]].forEach(([k, v]) => { if (!v) return; const row = ce(meta, 'div', 'te-card-meta-row'); ce(row, 'span', 'te-card-meta-label', k); ce(row, 'span', '', v); });
      if (r.summary) ce(c, 'p', 'te-card-body', r.summary.slice(0, 120));
    });
  }
}

// ── HYBRID ANCESTRY (Phase 257) ───────────────────────────────────────────────
function renderHybridAncestry(main, plugin, tabs) {
  const state = plugin.state;
  const isPC = state.mode === 'PLAYER';
  const all = safeArr(state.entities.hybridAncestries);
  const visible = isPC ? all.filter(h => h.visibility === 'player-visible') : all;
  if (!isPC) {
    pageHead(main, plugin, '🧬 Hybrid Ancestry Builder', 'Design and balance custom mixed-heritage ancestries for PCs and NPCs.', [
      { label: '+ New Hybrid', primary: true, onClick: () => new HybridAncestryModal(plugin.app, plugin).open() },
    ], tabs);
    const sg = ce(main, 'div', 'te-stat-grid');
    const approved = all.filter(h => h.approvalStatus === 'DM Approved');
    const pending = all.filter(h => !h.approvalStatus || h.approvalStatus === 'Pending Review');
    [['Total Hybrids', all.length], ['DM Approved', approved.length], ['Pending Review', pending.length]].forEach(([l, v]) => {
      const sc = ce(sg, 'div', 'te-stat-card'); ce(sc, 'div', 'te-stat-big', v); ce(sc, 'div', 'te-stat-label', l);
    });
  } else {
    pageHead(main, plugin, '🧬 Hybrid Ancestry', 'Player-visible hybrid ancestries shared by your DM.', [], tabs);
  }
  sectionHead(main, isPC ? 'Available Ancestries' : 'All Hybrid Ancestries');
  if (!visible.length) {
    emptyState(main, 'No hybrid ancestries yet.', isPC ? 'Your DM will share ancestries here.' : 'Click "+ New Hybrid" to design your first hybrid ancestry.');
    return;
  }
  const g = ce(main, 'div', 'te-grid');
  visible.filter(h => matchesSearch(h, state.search)).forEach(h => {
    const balance = computeHybridBalance(h);
    const c = ce(g, 'div', 'te-card');
    const hd = ce(c, 'div', 'te-card-head');
    ce(hd, 'span', 'te-card-icon', '🧬');
    ce(hd, 'h3', 'te-card-title', h.name || 'Untitled Hybrid');
    if (!isPC && h.approvalStatus) {
      const badge = ce(hd, 'span', 'te-chip', h.approvalStatus);
      badge.style.cssText = 'margin-left:auto;font-size:.75rem;flex-shrink:0';
    }
    const meta = ce(c, 'div', 'te-card-meta');
    const parents = [h.dominantAncestry, h.recessiveAncestry].filter(Boolean).join(' × ');
    if (parents) { const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Parents'); ce(r, 'span', '', parents); }
    [['Size', h.size], ['Type', h.creatureType]].forEach(([k, v]) => {
      if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v);
    });
    // Balance bar
    const bmRow = ce(c, 'div', 'te-balance-row');
    const bmBar = ce(bmRow, 'div', 'te-balance-meter');
    const pct = Math.min(100, Math.round((balance.score / 10) * 100));
    const bmFill = ce(bmBar, 'div', 'te-balance-fill');
    bmFill.style.width = pct + '%';
    bmFill.classList.add({ Underpowered:'is-weak', Balanced:'is-balanced', Strong:'is-strong', Overpowered:'is-over' }[balance.rating] || '');
    ce(bmRow, 'span', 'te-balance-label', `${balance.rating} (${balance.score})`);
    if (!isPC && balance.warnings.length) {
      const wEl = ce(c, 'div', 'te-hybrid-warning-badge');
      wEl.title = balance.warnings.join('\n');
      wEl.textContent = `⚠️ ${balance.warnings.length} warning${balance.warnings.length > 1 ? 's' : ''}`;
    }
    if (h.summary) ce(c, 'p', 'te-card-body', h.summary.slice(0, 120));
    const acts = ce(c, 'div', 'te-card-actions');
    if (!isPC) {
      btn(acts, 'Edit', 'te-btn is-sm is-primary', () => new HybridAncestryModal(plugin.app, plugin, h).open());
      btn(acts, 'Use as PC', 'te-btn is-sm', () => new CharacterModal(plugin.app, plugin, { race: h.name }).open());
      btn(acts, 'Use as NPC', 'te-btn is-sm', () => new NPCModal(plugin.app, plugin, { race: h.name }).open());
      btn(acts, '× Delete', 'te-btn is-sm is-danger', async () => {
        removeItem(state, 'hybridAncestries', h.id);
        await plugin.saveState();
        new Notice(`"${h.name}" deleted.`);
      });
    }
  });
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
      this.values = sanitizeQaNotesValue(this.values);
      if (CAMPAIGN_SCOPED_ENTITIES.includes(this.key) && !this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, this.key, this.values);
      await this.plugin.saveState();
      new Notice(`${ENTITY_LABELS[this.key] || this.key} saved.`);
      this.close();
    });
  }
  renderField(el, f) {
    if (f.legacy) return;
    if (f.type === 'text') addField(el, f.label, this.values[f.key] || '', v => this.values[f.key] = v);
    else if (f.type === 'textarea') addField(el, f.label, this.values[f.key] || '', v => this.values[f.key] = v, 'textarea');
    else if (f.type === 'select') addSelect(el, f.label, this.values[f.key] || (f.options && f.options[0]) || '', f.options || [], v => this.values[f.key] = v);
    else if (f.type === 'number') addNumber(el, f.label, this.values[f.key] || 0, v => this.values[f.key] = v);
    else if (f.type === 'toggle') addToggle(el, f.label, !!this.values[f.key], v => this.values[f.key] = v);
    else if (f.type === 'chip') chipField(el, f.label, normalizeListField(this.values[f.key]), v => this.values[f.key] = v, f.opts || {});
    else if (f.type === 'entityRef') addEntityPicker(el, f.label, this.values[f.key] || '', this.plugin, f.entityType || '', v => this.values[f.key] = v);
    else if (f.type === 'entityMultiRef') addEntityMultiPicker(el, f.label, this.values[f.key] || [], this.plugin, f.entityType || '', v => this.values[f.key] = v);
    else if (f.type === 'typedEntityRef') addTypedEntityPicker(
      el,
      f.label,
      this.values[f.typeKey] || '',
      this.values[f.idKey] || '',
      this.plugin,
      v => this.values[f.typeKey] = v,
      v => this.values[f.idKey] = v,
      f.entityTypes || []
    );
    else if (f.type === 'typedEntityMultiRef') addTypedEntityMultiPicker(el, f.label, safeArr(this.values[f.key]), this.plugin, f.entityTypes || [], v => this.values[f.key] = v);
  }
}

class DeityModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({ id: uid('deities'), visibility: 'dm-only', tags: [] }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Deity` });
    deityFields.forEach(f => {
      if (f.type === 'text') addField(contentEl, f.label, this.values[f.key] || '', v => this.values[f.key] = v);
      else if (f.type === 'textarea') addField(contentEl, f.label, this.values[f.key] || '', v => this.values[f.key] = v, 'textarea');
      else if (f.type === 'select') addSelect(contentEl, f.label, this.values[f.key] || (f.options && f.options[0]) || '', f.options || [], v => this.values[f.key] = v);
      else if (f.type === 'chip') chipField(contentEl, f.label, this.values[f.key] || [], v => this.values[f.key] = v, f.opts || {});
      else if (f.type === 'entityRef') addEntityPicker(contentEl, f.label, this.values[f.key] || '', this.plugin, f.entityType || '', v => this.values[f.key] = v);
      else if (f.type === 'entityMultiRef') addEntityMultiPicker(contentEl, f.label, this.values[f.key] || [], this.plugin, f.entityType || '', v => this.values[f.key] = v);
    });
    if (!this.values.tags) this.values.tags = [];
    chipField(contentEl, 'Tags', this.values.tags, v => this.values.tags = v);
    addField(contentEl, 'Notes', this.values.notes || '', v => this.values.notes = v, 'textarea');
    addSelect(contentEl, 'Visibility', this.values.visibility, HOMEBREW_VISIBILITY_OPTIONS, v => this.values.visibility = v);
    const actRow = ce(contentEl, 'div', 'te-modal-actions');
    btn(actRow, 'Save', 'te-btn is-primary', async () => {
      if (!this.values.name) { new Notice('Name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, 'deities', this.values);
      await this.plugin.saveState();
      new Notice('Deity saved.');
      this.close();
    });
    btn(actRow, 'Save as Homebrew', 'te-btn', async () => {
      if (!this.values.name) { new Notice('Name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, 'deities', this.values);
      const hb = promoteDeityToHomebrew(this.plugin, this.values);
      await this.plugin.saveState();
      new Notice(`Homebrew "${hb.name}" saved.`);
      this.close();
    });
    btn(actRow, 'Cancel', 'te-btn', () => this.close());
  }
}

// CampaignModal
class CampaignModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('campaign'), name: '', tagline: '', summary: '', premise: '',
      status: 'Active', visibility: 'dm-only', format: '', ruleset: 'D&D 5e',
      levelRange: '1-20', levellingMethod: 'Milestone',
      restRules: 'Standard (Short/Long)', deathRules: 'Standard Death Saves',
      magicItemAvailability: 'Common', playerCount: 4,
      tone: [], genres: [], themes: [], campaignLoops: [],
      worldName: '', worldPremise: '', worldScale: '',
      partyNotes: '', structureNotes: '', playerPrimer: '',
      notes: '', createdAt: new Date().toISOString(),
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Campaign` });

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Identity' });
    addField(s1, 'Campaign Name *', this.values.name, v => this.values.name = v);
    addField(s1, 'Tagline / One-liner', this.values.tagline, v => this.values.tagline = v);
    addField(s1, 'Premise', this.values.premise, v => this.values.premise = v, 'textarea');
    addSelect(s1, 'Status', this.values.status, ['Active','On Hold','Completed','Archived'], v => this.values.status = v);
    addSelect(s1, 'Visibility', this.values.visibility, ['dm-only','player-visible'], v => this.values.visibility = v);
    addSelect(s1, 'Format', this.values.format, OPTION_BANKS.formats, v => this.values.format = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Rules & Tone' });
    addSelect(s2, 'Ruleset', this.values.ruleset, OPTION_BANKS.rulesets, v => this.values.ruleset = v);
    addField(s2, 'Level Range (e.g. 1-10)', this.values.levelRange, v => this.values.levelRange = v);
    addSelect(s2, 'Levelling Method', this.values.levellingMethod, OPTION_BANKS.levellingMethods, v => this.values.levellingMethod = v);
    addSelect(s2, 'Rest Rules', this.values.restRules, OPTION_BANKS.restRules, v => this.values.restRules = v);
    addSelect(s2, 'Death Rules', this.values.deathRules, OPTION_BANKS.deathRules, v => this.values.deathRules = v);
    addSelect(s2, 'Magic Item Availability', this.values.magicItemAvailability, OPTION_BANKS.magicItemAvailability, v => this.values.magicItemAvailability = v);
    chipField(s2, 'Tone(s)', safeArr(this.values.tone), v => this.values.tone = v, { bank: 'tones' });
    chipField(s2, 'Genre(s)', safeArr(this.values.genres), v => this.values.genres = v, { bank: 'genres' });
    chipField(s2, 'Themes', safeArr(this.values.themes), v => this.values.themes = v, { bank: 'themes' });
    chipField(s2, 'Campaign Loops', safeArr(this.values.campaignLoops), v => this.values.campaignLoops = v, { bank: 'campaignLoops' });

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'World Details' });
    addField(s3, 'World Name', this.values.worldName, v => this.values.worldName = v);
    addField(s3, 'World Premise', this.values.worldPremise, v => this.values.worldPremise = v, 'textarea');
    addSelect(s3, 'World Scale', this.values.worldScale, OPTION_BANKS.worldScales, v => this.values.worldScale = v);

    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'Player & Party' });
    addNumber(s4, 'Player Count', this.values.playerCount, v => this.values.playerCount = v);
    addField(s4, 'Party Notes', this.values.partyNotes, v => this.values.partyNotes = v, 'textarea');
    addField(s4, 'Structure Notes', this.values.structureNotes, v => this.values.structureNotes = v, 'textarea');
    addField(s4, 'Player Primer (player-safe intro)', this.values.playerPrimer, v => this.values.playerPrimer = v, 'textarea');

    const s5 = ce(contentEl, 'div', 'te-modal-section');
    s5.createEl('h3', { text: 'DM Notes' });
    addField(s5, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Campaign name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      if (!this.values.summary) this.values.summary = this.values.premise || this.values.tagline || '';
      upsert(this.plugin.state, 'campaigns', this.values);
      if (!this.plugin.state.activeCampaignId) this.plugin.state.activeCampaignId = this.values.id;
      await this.plugin.saveState();
      await ensureFolder(this.plugin.app, campaignFolderFor(this.plugin, this.values));
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
      id: uid('npc'), name: '', pronouns: '', race: '', raceId: '', role: '', occupation: '',
      status: 'Alive', location: '', locationId: '', faction: [], factionIds: [], attitude: 'Indifferent',
      campaignId: '', ac: 10, hp: 10, speed: '30 ft',
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
    chipField(s1, 'Pronouns', safeArr(this.values.pronouns), v => this.values.pronouns = v, { bank: 'pronouns' });
    addEntityPicker(s1, 'Ancestry / Race (linked)', this.values.raceId || '', this.plugin, 'hybridAncestries', v => this.values.raceId = v);
    ce(s1, 'p', 'te-progress-label', 'Use the linked ancestry selector for campaign and hybrid ancestries. Official race names remain preserved in legacy data but are no longer edited as free text here.');
    chipField(s1, 'Role / Title', safeArr(this.values.role), v => this.values.role = v, { bank: 'npcRoles' });
    chipField(s1, 'Occupation', safeArr(this.values.occupation), v => this.values.occupation = v, { bank: 'occupations' });
    addSelect(s1, 'Status', this.values.status, ['Alive','Dead','Missing','Captured','Unknown','Retired'], v => this.values.status = v);
    addEntityPicker(s1, 'Location', this.values.locationId, this.plugin, 'settlements', v => this.values.locationId = v);
    addEntityMultiPicker(s1, 'Faction(s)', this.values.factionIds, this.plugin, 'factions', v => this.values.factionIds = v);
    chipField(s1, 'Tags', this.values.tags, v => this.values.tags = v, { suggestions: ['Merchant','Noble','Informant','Villain','Ally','Enemy','Quest Giver','Recurring','Secret Keeper','Combat','Social','City','Wilderness'] });

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Combat Stats' });

    // NPC preset selector
    const presetRow = ce(s2, 'div', ''); presetRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap';
    ce(presetRow, 'span', 'te-muted-text', 'Preset:');
    Object.keys(NPC_STAT_PRESETS).forEach(name => {
      btn(presetRow, name, 'te-btn is-sm', () => {
        const p = NPC_STAT_PRESETS[name];
        Object.assign(this.values, p);
        this.onOpen();
      });
    });

    const acInput = { el: null }; const hpInput = { el: null };
    new Setting(s2).setName('AC').addText(t => { t.inputEl.type = 'number'; t.setValue(String(this.values.ac)); t.onChange(v => this.values.ac = parseInt(v) || 0); acInput.el = t.inputEl; });
    const acSugRow = ce(s2, 'div', ''); acSugRow.style.cssText = 'font-size:.82rem;color:var(--te-muted);margin:-6px 0 8px 0;display:flex;align-items:center;gap:8px';
    const dexMod = () => Math.floor((this.values.dex - 10) / 2);
    const acSugLabel = ce(acSugRow, 'span', ''); acSugLabel.textContent = `Suggested: 10 + DEX mod (${dexMod() >= 0 ? '+' : ''}${dexMod()}) = ${10 + dexMod()}`;
    btn(acSugRow, 'Apply', 'te-btn is-sm', () => { this.values.ac = 10 + dexMod(); this.onOpen(); });

    new Setting(s2).setName('HP').addText(t => { t.inputEl.type = 'number'; t.setValue(String(this.values.hp)); t.onChange(v => this.values.hp = parseInt(v) || 0); hpInput.el = t.inputEl; });
    const hpSugRow = ce(s2, 'div', ''); hpSugRow.style.cssText = 'font-size:.82rem;color:var(--te-muted);margin:-6px 0 8px 0;display:flex;align-items:center;gap:8px';
    const conMod = () => Math.floor((this.values.con - 10) / 2);
    const hpSug = () => Math.max(1, 8 + conMod());
    const hpSugLabel = ce(hpSugRow, 'span', ''); hpSugLabel.textContent = `Suggested: 1d8 avg (5) + CON mod (${conMod() >= 0 ? '+' : ''}${conMod()}) = ${hpSug()}`;
    btn(hpSugRow, 'Apply', 'te-btn is-sm', () => { this.values.hp = hpSug(); this.onOpen(); });

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
    // Roll Stats button
    btn(s2, '🎲 Roll Stats (4d6 drop lowest)', 'te-btn is-sm', () => {
      ['str','dex','con','int','wis','cha'].forEach(ab => { this.values[ab] = roll4d6dl(); });
      this.onOpen();
    });

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Personality' });
    addSelect(s3, 'Attitude', this.values.attitude, ['Friendly','Indifferent','Suspicious','Hostile','Fanatic','Unknown'], v => this.values.attitude = v);
    chipField(s3, 'Personality Traits', this.values.traits, v => this.values.traits = v, { suggestions: ['Brave','Cunning','Greedy','Loyal','Cautious','Cheerful','Grim','Wise','Impulsive','Secretive'] });
    chipField(s3, 'Ideals', safeArr(this.values.ideals), v => this.values.ideals = v, { bank: 'ideals' });
    chipField(s3, 'Bonds', safeArr(this.values.bonds), v => this.values.bonds = v, { bank: 'bonds' });
    chipField(s3, 'Flaws', safeArr(this.values.flaws), v => this.values.flaws = v, { bank: 'flaws' });
    addField(s3, 'Motivation', this.values.motivation, v => this.values.motivation = v, 'textarea');
    addField(s3, 'Appearance', this.values.appearance, v => this.values.appearance = v, 'textarea');
    addField(s3, 'Voice / Mannerisms', this.values.voice, v => this.values.voice = v);

    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'DM Notes' });
    addField(s4, 'Secrets (DM only)', this.values.secrets, v => this.values.secrets = v, 'textarea');
    addEntityMultiPicker(s4, 'Relationships (linked)', safeArr(this.values.relationshipIds), this.plugin, 'relationships', v => this.values.relationshipIds = v);
    chipField(s4, 'Relationships (notes)', safeArr(this.values.relationships), v => this.values.relationships = v);
    addField(s4, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    addSelect(s4, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('NPC name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
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
      visibility: 'dm-only', tags: [], campaignId: '', factionIds: [],
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
    btn(statSec, '🎲 Roll Stats (4d6 drop lowest)', 'te-btn is-sm', () => {
      ['str','dex','con','int','wis','cha'].forEach(ab => { this.values[ab] = roll4d6dl(); });
      this.onOpen();
    });
    chipField(statSec, 'Senses', safeArr(this.values.senses), v => this.values.senses = v, { bank: 'creatureSenses' });
    // Languages: migrate legacy string to array, then show chip field with bank
    if (typeof this.values.languages === 'string') this.values.languages = this.values.languages ? [this.values.languages] : [];
    const langSuggestions = ['Common','Dwarvish','Elvish','Gnomish','Halfling','Orc','Draconic','Infernal','Celestial','Sylvan','Undercommon','Abyssal','Primordial','Deep Speech','Giant','Goblin','Telepathy'];
    chipField(statSec, 'Languages', safeArr(this.values.languages), v => this.values.languages = v, { suggestions: langSuggestions });
    { const sel = statSec.lastElementChild && statSec.lastElementChild.querySelector('select'); if (sel) this.plugin.refData.get('languages').then(langs => { const ex = new Set(langSuggestions); [...new Set(langs.map(l => l.name).filter(Boolean))].filter(n => !ex.has(n)).forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); }); }).catch(()=>{}); }

    const abilitySec = ce(contentEl, 'div', 'te-modal-section');
    abilitySec.createEl('h3', { text: 'Abilities & Actions' });
    chipField(abilitySec, 'Traits', safeArr(this.values.traits), v => this.values.traits = v, { bank: 'creatureTraits' });
    chipField(abilitySec, 'Actions', safeArr(this.values.actions), v => this.values.actions = v, { bank: 'creatureActions' });
    chipField(abilitySec, 'Reactions', safeArr(this.values.reactions), v => this.values.reactions = v, { bank: 'creatureReactions' });
    chipField(abilitySec, 'Legendary Actions', safeArr(this.values.legendaryActions), v => this.values.legendaryActions = v, { bank: 'legendaryActions' });
    chipField(abilitySec, 'Lair Actions', safeArr(this.values.lairActions), v => this.values.lairActions = v, { bank: 'lairActions' });

    const loreSec = ce(contentEl, 'div', 'te-modal-section');
    loreSec.createEl('h3', { text: 'Lore & Encounter' });
    addField(loreSec, 'Lore', this.values.lore, v => this.values.lore = v, 'textarea');
    addField(loreSec, 'Habitat', this.values.habitat, v => this.values.habitat = v);
    addField(loreSec, 'Loot / Salvage', this.values.loot, v => this.values.loot = v, 'textarea');
    addEntityMultiPicker(contentEl, 'Linked Factions', safeArr(this.values.factionIds), this.plugin, 'factions', v => this.values.factionIds = v);

    const actRow = ce(contentEl, 'div', 'te-modal-actions');
    btn(actRow, 'Save', 'te-btn is-primary', async () => {
      if (!this.values.name.trim()) { new Notice('Creature name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, 'creatures', this.values);
      await this.plugin.saveState();
      new Notice(`Creature "${this.values.name}" saved.`);
      this.close();
    });
    btn(actRow, 'Save as Homebrew', 'te-btn', async () => {
      if (!this.values.name.trim()) { new Notice('Creature name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      upsert(this.plugin.state, 'creatures', this.values);
      const hb = promoteCreatureToHomebrew(this.plugin, this.values);
      await this.plugin.saveState();
      new Notice(`Homebrew "${hb.name}" saved.`);
      this.close();
    });
    btn(actRow, 'Cancel', 'te-btn', () => this.close());
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
      goals: [], methods: [], resources: '', lieutenants: [], motivation: '',
      linkedNpcIds: [], lieutenantIds: [], lieutenantRefs: [],
      lairLocation: '', lairLocationType: 'locations', mythicPhases: '', escalationClocks: '', timerIds: [],
      secrets: '', finalConfrontation: '',
      linkedFactions: [], linkedQuests: [], visibility: 'dm-only', campaignId: '',
      linkedFactionIds: [], linkedQuestIds: [],
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} BBEG / Major Villain` });
    addField(contentEl, 'Villain Name *', this.values.name, v => this.values.name = v);
    chipField(contentEl, 'Title / Epithet', safeArr(this.values.title), v => this.values.title = v, { bank: 'bbegTitles' });
    addSelect(contentEl, 'Status', this.values.status, ['Active','Defeated','Imprisoned','Unknown','Fled'], v => this.values.status = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Goals & Methods' });
    chipField(s1, 'Goals', this.values.goals, v => this.values.goals = v, { suggestions: ['World domination','Revenge','Immortality','Power','Wealth','Destroy a god','Reshape reality','Other'] });
    chipField(s1, 'Methods', this.values.methods, v => this.values.methods = v, { suggestions: ['Manipulation','Armies','Magic','Assassination','Corruption','Subterfuge','Brute force'] });
    chipField(s1, 'Resources', safeArr(this.values.resources), v => this.values.resources = v, { bank: 'factionResources' });
    addField(s1, 'Motivation / Backstory', this.values.motivation || '', v => this.values.motivation = v, 'textarea');
    addEntityMultiPicker(s1, 'Lieutenants (linked NPCs)', safeArr(this.values.lieutenantIds), this.plugin, 'npcs', v => this.values.lieutenantIds = v);
    addTypedEntityMultiPicker(s1, 'Lieutenants (other linked actors)', safeArr(this.values.lieutenantRefs), this.plugin, BBEG_LIEUTENANT_ENTITY_TYPES, v => this.values.lieutenantRefs = v);
    addTypedEntityPicker(s1, 'Lair Location (linked)', this.values.lairLocationType || 'locations', this.values.lairLocationId || '', this.plugin, v => this.values.lairLocationType = v, v => this.values.lairLocationId = v, LOCATION_LIKE_ENTITY_TYPES);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Campaign Arc' });
    addField(s2, 'Mythic Phases', this.values.mythicPhases, v => this.values.mythicPhases = v, 'textarea');
    addEntityMultiPicker(s2, 'Escalation Timers', safeArr(this.values.timerIds), this.plugin, 'timers', v => this.values.timerIds = v);
    btn(s2, '+ New Timer', 'te-btn is-sm', () => new TimerModal(this.plugin.app, this.plugin, { name: `${this.values.name || 'Villain'} Escalation`, bbegId: this.values.id || '', campaignId: this.values.campaignId || this.plugin.state.activeCampaignId || '' }).open());
    addField(s2, 'Final Confrontation Notes', this.values.finalConfrontation, v => this.values.finalConfrontation = v, 'textarea');

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'DM Secrets' });
    addField(s3, 'Secrets', this.values.secrets, v => this.values.secrets = v, 'textarea');
    addEntityMultiPicker(s3, 'Linked Factions', safeArr(this.values.linkedFactionIds), this.plugin, 'factions', v => this.values.linkedFactionIds = v);
    addEntityMultiPicker(s3, 'Linked Quests', safeArr(this.values.linkedQuestIds), this.plugin, 'quests', v => this.values.linkedQuestIds = v);

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Villain name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.lairLocation = scrubLegacyPlaceholderText(this.values.lairLocation);
      this.values.lieutenants = scrubLegacyPlaceholderArray(this.values.lieutenants);
      this.values.escalationClocks = scrubLegacyPlaceholderArray(this.values.escalationClocks);
      this.values.linkedFactions = scrubLegacyPlaceholderArray(this.values.linkedFactions);
      this.values.linkedQuests = scrubLegacyPlaceholderArray(this.values.linkedQuests);
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
      leadership: [], leaderNpcId: '', campaignId: '',
      goals: [], methods: [], resources: [], ranks: [],
      allies: [], allyIds: [], enemies: [], enemyIds: [],
      publicFace: '', secretAgenda: '',
      reputation: '', rewards: '', consequences: '', visibility: 'dm-only',
      staffRoles: [], memberNpcIds: [], memberPcIds: [], territoryIds: [], linkedQuestIds: [],
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Faction` });
    addField(contentEl, 'Faction Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Faction Type', this.values.type || 'Criminal', ['Criminal','Political','Religious','Military','Mercantile','Academic','Secret Society','Resistance','Cult','Guild','Noble House','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addField(contentEl, 'Ideology', this.values.ideology, v => this.values.ideology = v, 'textarea');
    chipField(contentEl, 'Leadership Structure', safeArr(this.values.leadershipStructure), v => this.values.leadershipStructure = v, { bank: 'leadershipStructure' });
    addEntityMultiPicker(contentEl, 'Leaders / Key Staff (NPCs)', safeArr(this.values.leaderNpcIds), this.plugin, 'npcs', v => this.values.leaderNpcIds = v);
    addEntityPicker(contentEl, 'Primary Leader NPC', this.values.leaderNpcId, this.plugin, 'npcs', v => this.values.leaderNpcId = v);
    chipField(contentEl, 'Leadership', normalizeListField(this.values.leadership), v => this.values.leadership = v, { suggestions: ['Council','Single Leader','Triumvirate','Hidden Patron','Rotating Officers','Custom'] });
    chipField(contentEl, 'Goals', safeArr(this.values.goals), v => this.values.goals = v, { bank: 'factionGoals' });
    chipField(contentEl, 'Methods', safeArr(this.values.methods), v => this.values.methods = v, { bank: 'factionMethods' });
    chipField(contentEl, 'Resources', safeArr(this.values.resources), v => this.values.resources = v, { bank: 'factionResources' });
    chipField(contentEl, 'Ranks / Titles', safeArr(this.values.ranks), v => this.values.ranks = v, { bank: 'ranks' });
    addEntityMultiPicker(contentEl, 'Allied Factions', this.values.allyIds, this.plugin, 'factions', v => this.values.allyIds = v);
    addEntityMultiPicker(contentEl, 'Enemy Factions', this.values.enemyIds, this.plugin, 'factions', v => this.values.enemyIds = v);
    addField(contentEl, 'Public Face', this.values.publicFace, v => this.values.publicFace = v, 'textarea');
    addField(contentEl, 'Secret Agenda', this.values.secretAgenda, v => this.values.secretAgenda = v, 'textarea');
    addSelect(contentEl, 'Reputation Level', this.values.reputation || 'Neutral', ['Exalted','Revered','Honoured','Friendly','Neutral','Unfriendly','Hostile','Hated'], v => this.values.reputation = v);

    const sSt = ce(contentEl, 'div', 'te-modal-section');
    sSt.createEl('h3', { text: 'Staff & Roles' });
    ce(sSt, 'p', 'te-progress-label', 'Track key personnel. Format: Name — Role (Rank)');
    chipField(sSt, 'Staff / Roles', safeArr(this.values.staffRoles), v => this.values.staffRoles = v,
      { suggestions: ['Leader','Second-in-command','Quartermaster','Spy','Recruiter','Agent','Informant','Commander','Diplomat','Treasurer','Enforcer','Defector'] });

    addEntityMultiPicker(contentEl, 'Member NPCs', this.values.memberNpcIds, this.plugin, 'npcs', v => this.values.memberNpcIds = v);
    addEntityMultiPicker(contentEl, 'Member PCs', this.values.memberPcIds, this.plugin, 'characters', v => this.values.memberPcIds = v);
    addEntityMultiPicker(contentEl, 'Territories (Regions)', this.values.territoryIds, this.plugin, 'regions', v => this.values.territoryIds = v);
    addEntityMultiPicker(contentEl, 'Linked Quests', this.values.linkedQuestIds, this.plugin, 'quests', v => this.values.linkedQuestIds = v);

    // Reputation records for this faction
    const repSection = ce(contentEl, 'div', 'te-modal-section');
    repSection.createEl('h3', { text: 'Reputation Records' });
    const reps = safeArr(this.plugin.state.entities.reputations)
      .filter(r => r.factionId === this.values.id || r.faction === this.values.name);
    if (reps.length === 0) {
      ce(repSection, 'p', 'te-progress-label', 'No reputation records linked to this faction.');
    } else {
      reps.forEach(rep => {
        const row = ce(repSection, 'div', 'te-list-item');
        ce(row, 'span', 'te-list-meta', `${rep.level || '?'} — ${rep.notes || rep.name || ''}`);
      });
    }
    const addRepBtn = ce(repSection, 'button', 'te-btn is-sm', '+ Add Reputation');
    addRepBtn.addEventListener('click', () => {
      new GenericModal(this.plugin.app, this.plugin, 'reputations', { factionId: this.values.id }, reputationFields).open();
    });

    // Legacy territory text field
    const legSec = ce(contentEl, 'div', 'te-modal-section');
    const legDetails = legSec.createEl('details');
    legDetails.createEl('summary', { text: 'Legacy / Advanced' });
    addField(legDetails, 'Territory (legacy text)', this.values.territory, v => this.values.territory = v);

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Faction name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.allyIds = safeArr(this.values.allyIds).filter(id => id && id !== this.values.id);
      this.values.enemyIds = safeArr(this.values.enemyIds).filter(id => id && id !== this.values.id);
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
      adventureId: '',
      giver: '', giverNpcId: '', location: '', locationId: '', locationType: '', campaignId: '',
      relatedNPCs: [], relatedNpcIds: [], relatedFactions: [], relatedFactionIds: [],
      objectives: '', stages: '', hooks: [], complications: [],
      rewards: '', rewardLootIds: [], consequences: '', secrets: '', playerSummary: '', dmNotes: '',
      linkedEncounters: [], linkedEncounterIds: [], visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Quest` });
    addField(contentEl, 'Quest Name *', this.values.name, v => this.values.name = v);
    addEntityPicker(contentEl, 'Parent Adventure', this.values.adventureId, this.plugin, 'adventures', v => this.values.adventureId = v);
    addSelect(contentEl, 'Quest Type', this.values.questType, ['Main','Side','Personal','Faction','Investigation','Escort','Retrieval','Elimination','Exploration','Social','Other'], v => this.values.questType = v);
    addSelect(contentEl, 'Status', this.values.status, ['Available','Active','Completed','Failed','Abandoned'], v => this.values.status = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addEntityPicker(contentEl, 'Quest Giver (NPC)', this.values.giverNpcId, this.plugin, 'npcs', v => this.values.giverNpcId = v);
    addSelect(contentEl, 'Location Type', this.values.locationType || 'settlements', ['regions','settlements','locations','pois'], v => {
      this.values.locationType = v;
      this.values.locationId = '';
      this.onOpen();
    });
    addEntityPicker(contentEl, 'Location', this.values.locationId, this.plugin, this.values.locationType || 'settlements', v => this.values.locationId = v);
    addEntityMultiPicker(contentEl, 'Related NPCs', this.values.relatedNpcIds, this.plugin, 'npcs', v => this.values.relatedNpcIds = v);
    addEntityMultiPicker(contentEl, 'Related Factions', this.values.relatedFactionIds, this.plugin, 'factions', v => this.values.relatedFactionIds = v);
    addField(contentEl, 'Objectives', this.values.objectives, v => this.values.objectives = v, 'textarea');
    addField(contentEl, 'Stages / Steps', this.values.stages, v => this.values.stages = v, 'textarea');
    chipField(contentEl, 'Hooks', normalizeListField(this.values.hooks), v => this.values.hooks = v, { suggestions: ['Rumor spreads','A patron pleads for help','Ancient map discovered','Faction summons the party','Custom'] });
    chipField(contentEl, 'Complications', normalizeListField(this.values.complications), v => this.values.complications = v, { suggestions: ['Time pressure','Rival adventurers','False lead','Betrayal','Political fallout','Custom'] });
    addEntityMultiPicker(contentEl, 'Rewards / Loot (linked)', safeArr(this.values.rewardLootIds), this.plugin, 'loot', v => this.values.rewardLootIds = v);
    addField(contentEl, 'Rewards (notes)', this.values.rewards, v => this.values.rewards = v, 'textarea');
    chipField(contentEl, 'Consequences (failure)', normalizeListField(this.values.consequences), v => this.values.consequences = v, { suggestions: ['Faction angered','Settlement endangered','Villain advances','Resource loss','Secret exposed','Custom'] });
    addField(contentEl, 'Player-Visible Summary', this.values.playerSummary, v => this.values.playerSummary = v, 'textarea');
    addField(contentEl, 'DM Notes (hidden from players)', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    addField(contentEl, 'Secrets (DM only)', this.values.secrets, v => this.values.secrets = v, 'textarea');
    addEntityMultiPicker(contentEl, 'Linked Encounters', this.values.linkedEncounterIds, this.plugin, 'encounters', v => this.values.linkedEncounterIds = v);
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Quest name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
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
      id: uid('encounter'), name: '', type: 'Combat', location: '', locationId: '', locationType: '',
      adventureId: '', questId: '',
      participants: [], participantPcIds: [], participantNpcIds: [], enemyTemplateIds: [], creatureIds: [], enemyGroups: '', difficulty: 'Medium',
      terrain: [], tactics: [], objectives: '',
      victoryConditions: '', failureConditions: '', rewards: '', rewardLootIds: [],
      linkedQuest: '', linkedQuestId: '', linkedSessionId: '', linkedMapId: '', campaignId: '',
      notes: '', visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Encounter` });
    addField(contentEl, 'Encounter Name *', this.values.name, v => this.values.name = v);
    addEntityPicker(contentEl, 'Parent Adventure', this.values.adventureId, this.plugin, 'adventures', v => this.values.adventureId = v);
    addEntityPicker(contentEl, 'Parent Quest', this.values.questId, this.plugin, 'quests', v => this.values.questId = v);
    addSelect(contentEl, 'Encounter Type', this.values.type, ['Combat','Social','Exploration','Trap','Chase','Hazard','Skill Challenge','Puzzle','Boss Fight','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Difficulty', this.values.difficulty, ['Trivial','Easy','Medium','Hard','Deadly','Mythic'], v => this.values.difficulty = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addSelect(contentEl, 'Location Type', this.values.locationType || 'settlements', ['regions','settlements','locations','pois','dungeons'], v => { this.values.locationType = v; this.values.locationId = ''; this.onOpen(); });
    addEntityPicker(contentEl, 'Location', this.values.locationId, this.plugin, this.values.locationType || 'settlements', v => this.values.locationId = v);
    addEntityMultiPicker(contentEl, 'PC Participants', this.values.participantPcIds, this.plugin, 'characters', v => this.values.participantPcIds = v);
    addEntityMultiPicker(contentEl, 'NPC Participants', this.values.participantNpcIds, this.plugin, 'npcs', v => this.values.participantNpcIds = v);
    addEntityMultiPicker(contentEl, 'Enemy Templates', this.values.enemyTemplateIds, this.plugin, 'enemyTemplates', v => this.values.enemyTemplateIds = v);
    addEntityMultiPicker(contentEl, 'Creatures', this.values.creatureIds, this.plugin, 'creatures', v => this.values.creatureIds = v);
    addField(contentEl, 'Enemy Groups (description)', this.values.enemyGroups, v => this.values.enemyGroups = v, 'textarea');
    chipField(contentEl, 'Terrain', safeArr(this.values.terrain), v => this.values.terrain = v, { bank: 'encounterTerrain' });
    chipField(contentEl, 'Tactics', safeArr(this.values.tactics), v => this.values.tactics = v, { bank: 'tactics' });
    addField(contentEl, 'Objectives', this.values.objectives, v => this.values.objectives = v, 'textarea');
    addField(contentEl, 'Victory Conditions', this.values.victoryConditions, v => this.values.victoryConditions = v, 'textarea');
    addField(contentEl, 'Failure Conditions', this.values.failureConditions, v => this.values.failureConditions = v, 'textarea');
    addEntityMultiPicker(contentEl, 'Rewards / Loot (linked)', safeArr(this.values.rewardLootIds), this.plugin, 'loot', v => this.values.rewardLootIds = v);
    addField(contentEl, 'Rewards / Loot (notes)', this.values.rewards, v => this.values.rewards = v, 'textarea');
    addEntityPicker(contentEl, 'Linked Quest', this.values.linkedQuestId, this.plugin, 'quests', v => this.values.linkedQuestId = v);
    addEntityPicker(contentEl, 'Linked Session', this.values.linkedSessionId || '', this.plugin, 'sessions', v => this.values.linkedSessionId = v);
    addEntityPicker(contentEl, 'Linked Map', this.values.linkedMapId || '', this.plugin, 'maps', v => this.values.linkedMapId = v);
    addField(contentEl, 'DM Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Encounter name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
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
      lootAwarded: '', xpMilestones: '', cliffhanger: '', nextSessionNotes: '', campaignId: '',
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
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
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
      relatedEntities: [], relatedEntityRefs: [], revealTrigger: '', revealStatus: 'Hidden',
      content: '', dmNotes: '', visibility: 'secret', campaignId: '',
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
    addTypedEntityMultiPicker(contentEl, 'Related Entities', safeArr(this.values.relatedEntityRefs), this.plugin, PICKABLE_ENTITY_TYPES, v => this.values.relatedEntityRefs = v);
    addField(contentEl, 'Secret Content *', this.values.content, v => this.values.content = v, 'textarea');
    addField(contentEl, 'DM Notes', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Secret name is required.'); return; }
      if (!this.values.content.trim()) { new Notice('Secret content is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
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
    const camp = activeCampaign(plugin.state);
    // Load from entities.calendars if a campaign-scoped calendar exists, else fall back to singleton
    const existing = camp
      ? safeArr(plugin.state.entities.calendars).find(c => c.campaignId === camp.id)
      : null;
    const base = existing || plugin.state.calendar || {};
    this.values = Object.assign({ name: 'Campaign Calendar', year: 1, month: 'Month 1', day: 1, weekdays: [], months: [], seasons: [], moons: [], holidays: [], importantDates: '', notes: '' }, base);
    if (!this.values.id) this.values.id = uid('cal');
    if (camp && !this.values.campaignId) this.values.campaignId = camp.id;
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
      // Save to both the singleton (legacy) and entities.calendars (canonical)
      this.plugin.state.calendar = this.values;
      upsert(this.plugin.state, 'calendars', this.values);
      await this.plugin.saveState();
      new Notice('Calendar saved.');
      this.close();
      this.plugin.refreshViews();
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

// EndSessionReviewModal — compile and display full end-of-session review
class EndSessionReviewModal extends Modal {
  constructor(app, plugin, session) {
    super(app);
    this.plugin = plugin;
    this.session = session;
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `📊 End Session Review` });
    if (this.session) {
      contentEl.createEl('h3', { text: this.session.name || 'Session', cls: 'te-page-subtitle' });
    }
    const review = compileEndSessionReview(this.session, this.plugin.state);
    if (!review.sections.length) {
      ce(contentEl, 'p', 'te-empty-state', 'No events logged for this session. Use the Event Log to track what happened.');
    } else {
      review.sections.forEach(sec => {
        const secEl = ce(contentEl, 'div', 'te-modal-section');
        secEl.style.cssText = 'margin-bottom:12px';
        secEl.createEl('h4', { text: sec.label });
        sec.items.forEach(item => {
          const row = ce(secEl, 'div', 'te-card-meta-row');
          row.style.cssText = 'padding:3px 0;border-bottom:1px solid var(--te-border);font-size:.85rem';
          ce(row, 'span', '', item);
        });
      });
      if (review.recap) {
        const recapEl = ce(contentEl, 'div', 'te-modal-section');
        recapEl.style.cssText = 'margin-top:16px;padding:12px;background:var(--te-bg-alt);border-radius:var(--te-r-md)';
        recapEl.createEl('h4', { text: '🎤 Player-Safe Recap' });
        const p = ce(recapEl, 'p', ''); p.textContent = review.recap;
        p.style.cssText = 'margin-top:6px;font-style:italic;line-height:1.5';
        btn(recapEl, '📋 Copy Recap', 'te-btn is-sm', () => {
          navigator.clipboard.writeText(review.recap).then(() => new Notice('Recap copied!'));
        });
      }
    }
    const actRow = ce(contentEl, 'div', 'te-modal-actions');
    btn(actRow, '📝 Export as Note', 'te-btn is-primary', async () => {
      if (!this.session) return;
      const folder = campaignFolder(this.plugin);
      const sessionDir = `${folder}/Sessions/Session Logs`;
      await ensureFolder(this.plugin.app, sessionDir);
      await writeNote(this.plugin.app, normalizePath(`${sessionDir}/${slugify(review.sessionName)}-review.md`), review.markdown || '');
      new Notice('Session review exported as note.');
    });
    btn(actRow, 'Close', 'te-btn', () => this.close());
  }
}

// Central generator history logger
function logGeneratorHistory(plugin, entry) {
  if (!plugin.state.generatorHistory) plugin.state.generatorHistory = [];
  const camp = activeCampaign(plugin.state);
  const histItem = normalizeStorageMetadata({ id: uid('gen'), savedAt: Date.now(), campaignId: camp ? camp.id : '', ...entry }, { source: 'generated', status: 'generated' });
  plugin.state.generatorHistory.unshift(histItem);
  if (plugin.state.generatorHistory.length > 200) plugin.state.generatorHistory.length = 200;
}

// Central session event logger — appends to the active session's eventLog without causing click-jump.
function logSessionEvent(plugin, type, text, data) {
  const sess = plugin.state.activeSessionId
    ? safeArr(plugin.state.entities.sessions).find(s => s.id === plugin.state.activeSessionId)
    : null;
  if (!sess) return;
  if (!Array.isArray(sess.eventLog)) sess.eventLog = [];
  const tracker = plugin.state.initiativeTracker;
  const round = (tracker && tracker.active) ? tracker.round : undefined;
  const entry = { id: uid('evt'), type, text, time: new Date().toISOString() };
  if (round !== undefined) entry.round = round;
  if (data && Object.keys(data).length) entry.data = data;
  sess.eventLog.push(entry);
  upsert(plugin.state, 'sessions', sess);
}

// EntityDraftModal — preview/edit a generated entity before saving
class EntityDraftModal extends Modal {
  constructor(app, plugin, generatorLabel, draft, entityKey, ModalClass) {
    super(app);
    this.plugin = plugin;
    this.generatorLabel = generatorLabel;
    this.draft = draft;
    this.entityKey = entityKey;
    this.ModalClass = ModalClass;
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `Generated: ${this.generatorLabel}` });
    // Log to history when the draft is first shown
    logGeneratorHistory(this.plugin, {
      type: this.generatorLabel,
      targetEntityType: this.entityKey,
      title: this.draft.name || 'Untitled',
      summary: this.draft.summary || this.draft.premise || '',
      draftData: { ...this.draft },
      status: 'generated',
    });
    const previewCard = ce(contentEl, 'div', 'te-modal-section');
    previewCard.style.cssText = 'background:var(--te-bg-alt);padding:12px;border-radius:var(--te-r-md);margin-bottom:12px';
    previewCard.createEl('h3', { text: this.draft.name || 'Untitled' });
    const previewKeys = Object.entries(this.draft).filter(([k]) => !['id','campaignId','visibility','status'].includes(k));
    previewKeys.forEach(([k, v]) => {
      if (!v || (Array.isArray(v) && !v.length)) return;
      const row = ce(previewCard, 'div', 'te-card-meta-row');
      const lbl = ce(row, 'span', 'te-card-meta-label'); lbl.textContent = k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
      const val = ce(row, 'span', '');
      val.textContent = Array.isArray(v) ? v.join(', ') : String(v);
    });
    const actRow = ce(contentEl, 'div', 'te-modal-actions');
    btn(actRow, 'Save as Entity', 'te-btn is-primary', async () => {
      // Update history entry to 'saved'
      const hist = this.plugin.state.generatorHistory;
      const entry = hist.find(h => h.type === this.generatorLabel && h.status === 'generated');
      if (entry) entry.status = 'saved';
      if (this.ModalClass) {
        this.close();
        new this.ModalClass(this.plugin.app, this.plugin, this.draft).open();
      } else {
        const d = { ...this.draft, id: uid(this.entityKey) };
        upsert(this.plugin.state, this.entityKey, d);
        await this.plugin.saveState();
        new Notice(`${this.generatorLabel} saved.`);
        this.close();
        this.plugin.refreshViews();
      }
    });
    btn(actRow, 'Regenerate', 'te-btn', () => { this.close(); /* caller must re-open */ });
    btn(actRow, 'Discard', 'te-btn', () => this.close());
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
      logGeneratorHistory(this.plugin, { type: this.type, result: this.result });
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
      progress: 0, total: 8, materials: '', cost: '', assignedTo: '', assignedToType: 'characters', assignedToId: '', downtimeId: '', bastionId: '', questId: '', sessionId: '', notes: '',
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
    chipField(contentEl, 'Materials Required', normalizeListField(this.values.materials), v => this.values.materials = v, { suggestions: ['Timber','Stone','Iron','Rare Herbs','Spell Components','Custom'] });
    addField(contentEl, 'Cost (gp)', this.values.cost, v => this.values.cost = v);
    addTypedEntityPicker(contentEl, 'Assigned To (linked)', this.values.assignedToType || 'characters', this.values.assignedToId || '', this.plugin, v => this.values.assignedToType = v, v => this.values.assignedToId = v, PROJECT_ASSIGNEE_ENTITY_TYPES);
    addField(contentEl, 'Assigned To (legacy/custom)', this.values.assignedTo, v => this.values.assignedTo = v);
    addEntityPicker(contentEl, 'Linked Downtime', this.values.downtimeId || '', this.plugin, 'downtime', v => this.values.downtimeId = v);
    addEntityPicker(contentEl, 'Linked Bastion', this.values.bastionId || '', this.plugin, 'bastions', v => this.values.bastionId = v);
    addEntityPicker(contentEl, 'Linked Quest', this.values.questId || '', this.plugin, 'quests', v => this.values.questId = v);
    addEntityPicker(contentEl, 'Linked Session', this.values.sessionId || '', this.plugin, 'sessions', v => this.values.sessionId = v);
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Project name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.completed = this.values.progress >= this.values.total;
      this.values.assignedTo = scrubLegacyPlaceholderText(this.values.assignedTo);
      upsert(this.plugin.state, 'projects', this.values);
      await this.plugin.saveState();
      new Notice(`Project "${this.values.name}" saved.`);
      this.close();
    });
  }
}

class DowntimeModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('downtime'), name: '', activityType: 'Training', timeRequired: '', cost: '', outcomes: '',
      complications: [], summary: '', assignedType: 'characters', assignedId: '', partyName: '',
      settlementId: '', locationId: '', projectId: '', bastionId: '', sessionId: '', campaignId: plugin.state.activeCampaignId || '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Downtime Activity' : 'New Downtime Activity');
    addField(contentEl, 'Activity Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Activity Type', this.values.activityType, ['Training','Crafting','Research','Carousing','Business','Relationship Building','Recuperation','Spell Research','Faction Work','Buying/Selling Magic Items','Other'], v => this.values.activityType = v);
    addField(contentEl, 'Time Required', this.values.timeRequired, v => this.values.timeRequired = v);
    addField(contentEl, 'Cost (gp)', this.values.cost, v => this.values.cost = v);
    addTypedEntityPicker(contentEl, 'Assigned Character / NPC', this.values.assignedType || 'characters', this.values.assignedId || '', this.plugin, v => this.values.assignedType = v, v => this.values.assignedId = v, [{ key: 'characters', label: 'PC / Character' }, { key: 'npcs', label: 'NPC' }]);
    addField(contentEl, 'Assigned Party / Group (custom)', this.values.partyName, v => this.values.partyName = v);
    addEntityPicker(contentEl, 'Settlement', this.values.settlementId || '', this.plugin, 'settlements', v => this.values.settlementId = v);
    addEntityPicker(contentEl, 'Location', this.values.locationId || '', this.plugin, 'locations', v => this.values.locationId = v);
    addEntityPicker(contentEl, 'Linked Project', this.values.projectId || '', this.plugin, 'projects', v => this.values.projectId = v);
    addEntityPicker(contentEl, 'Linked Bastion', this.values.bastionId || '', this.plugin, 'bastions', v => this.values.bastionId = v);
    addEntityPicker(contentEl, 'Linked Session', this.values.sessionId || '', this.plugin, 'sessions', v => this.values.sessionId = v);
    chipField(contentEl, 'Complications', safeArr(this.values.complications), v => this.values.complications = v, { suggestions: OPTION_BANKS.complicationTypes });
    chipField(contentEl, 'Outcomes', normalizeListField(this.values.outcomes), v => this.values.outcomes = v, { suggestions: ['Progress made','New contact','Complication triggered','Resource gained','Reputation change','Custom'] });
    addField(contentEl, 'Notes', this.values.summary, v => this.values.summary = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Activity name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.partyName = scrubLegacyPlaceholderText(this.values.partyName);
      this.values.complications = scrubLegacyPlaceholderArray(this.values.complications);
      upsert(this.plugin.state, 'downtime', this.values);
      await this.plugin.saveState();
      new Notice(`Downtime "${this.values.name}" saved.`);
      this.close();
    });
  }
}

class BastionModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('bastion'), name: '', location: '', locationType: 'locations', locationId: '', linkedSettlement: '', linkedSettlementId: '',
      rooms: [], facilities: [], staff: [], upgrades: [], income: '', maintenanceCost: '', defences: [], events: [],
      projectIds: [], downtimeIds: [], timerIds: [], summary: '', campaignId: plugin.state.activeCampaignId || '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Bastion' : 'New Bastion');
    addField(contentEl, 'Bastion Name *', this.values.name, v => this.values.name = v);
    addTypedEntityPicker(contentEl, 'Location (linked)', this.values.locationType || 'locations', this.values.locationId || '', this.plugin, v => this.values.locationType = v, v => this.values.locationId = v, LOCATION_LIKE_ENTITY_TYPES);
    addEntityPicker(contentEl, 'Linked Settlement', this.values.linkedSettlementId || '', this.plugin, 'settlements', v => this.values.linkedSettlementId = v);
    chipField(contentEl, 'Rooms', safeArr(this.values.rooms), v => this.values.rooms = v);
    chipField(contentEl, 'Facilities', safeArr(this.values.facilities), v => this.values.facilities = v, { suggestions: OPTION_BANKS.bastionFeatures });
    chipField(contentEl, 'Staff', normalizeListField(this.values.staff), v => this.values.staff = v, { suggestions: ['Steward','Guard Captain','Sage','Caretaker','Smith','Custom'] });
    chipField(contentEl, 'Upgrades', normalizeListField(this.values.upgrades), v => this.values.upgrades = v, { suggestions: ['Reinforced Walls','Arcane Ward','Expanded Barracks','Secret Exit','Workshop','Custom'] });
    addField(contentEl, 'Income (gp/period)', this.values.income, v => this.values.income = v);
    addField(contentEl, 'Maintenance Cost', this.values.maintenanceCost, v => this.values.maintenanceCost = v);
    chipField(contentEl, 'Defences', safeArr(this.values.defences), v => this.values.defences = v, { suggestions: ['Walls','Moat','Gatehouse','Watchtower','Guard Patrols','Wards','Ballistae','Traps','Hidden Exits','Custom'] });
    chipField(contentEl, 'Events / Threats', safeArr(this.values.events), v => this.values.events = v, { suggestions: ['Raid','Fire','Political Pressure','Monster Attack','Sabotage','Supply Shortage','Festival','Visitor','Inspection','Custom'] });
    addEntityMultiPicker(contentEl, 'Linked Projects', safeArr(this.values.projectIds), this.plugin, 'projects', v => this.values.projectIds = v);
    addEntityMultiPicker(contentEl, 'Linked Downtime', safeArr(this.values.downtimeIds), this.plugin, 'downtime', v => this.values.downtimeIds = v);
    addEntityMultiPicker(contentEl, 'Linked Timers', safeArr(this.values.timerIds), this.plugin, 'timers', v => this.values.timerIds = v);
    addField(contentEl, 'Notes', this.values.summary, v => this.values.summary = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Bastion name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.location = scrubLegacyPlaceholderText(this.values.location);
      this.values.linkedSettlement = scrubLegacyPlaceholderText(this.values.linkedSettlement);
      this.values.defences = scrubLegacyPlaceholderArray(this.values.defences);
      this.values.events = scrubLegacyPlaceholderArray(this.values.events);
      upsert(this.plugin.state, 'bastions', this.values);
      await this.plugin.saveState();
      new Notice(`Bastion "${this.values.name}" saved.`);
      this.close();
    });
  }
}

class WarFrontModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('warfront'), name: '', type: 'Active Front', status: 'Active', factionId: '', faction: '', locationType: 'locations', locationId: '', location: '',
      strength: '', timerIds: [], incursionIds: [], questIds: [], summary: '', campaignId: plugin.state.activeCampaignId || '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit War Front' : 'New War Front');
    addField(contentEl, 'War Front Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Type', this.values.type, ['Active Front','Stalemate','Advance','Retreat','Siege','Guerrilla Campaign','Ceasefire','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Status', this.values.status, ['Active','Escalating','Stalemate','Cooling Down','Resolved'], v => this.values.status = v);
    addEntityPicker(contentEl, 'Primary Faction', this.values.factionId || '', this.plugin, 'factions', v => this.values.factionId = v);
    addTypedEntityPicker(contentEl, 'Location (linked)', this.values.locationType || 'locations', this.values.locationId || '', this.plugin, v => this.values.locationType = v, v => this.values.locationId = v, LOCATION_LIKE_ENTITY_TYPES);
    chipField(contentEl, 'Strength', normalizeListField(this.values.strength), v => this.values.strength = v, { suggestions: ['Weak','Pressured','Evenly Matched','Strong','Overwhelming','Breaking','Custom'] });
    addEntityMultiPicker(contentEl, 'Linked Timers', safeArr(this.values.timerIds), this.plugin, 'timers', v => this.values.timerIds = v);
    addEntityMultiPicker(contentEl, 'Linked Incursions', safeArr(this.values.incursionIds), this.plugin, 'incursions', v => this.values.incursionIds = v);
    addEntityMultiPicker(contentEl, 'Linked Quests', safeArr(this.values.questIds), this.plugin, 'quests', v => this.values.questIds = v);
    addField(contentEl, 'Notes', this.values.summary, v => this.values.summary = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('War Front name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.faction = scrubLegacyPlaceholderText(this.values.faction);
      this.values.location = scrubLegacyPlaceholderText(this.values.location);
      this.values.strength = scrubLegacyPlaceholderArray(this.values.strength);
      upsert(this.plugin.state, 'warFronts', this.values);
      await this.plugin.saveState();
      new Notice(`War Front "${this.values.name}" saved.`);
      this.close();
    });
  }
}

class IncursionModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('incursion'), name: '', type: 'Raid', status: 'Emerging', originType: 'realms', originId: '', origin: '',
      threat: 'Low', progress: '', warFrontIds: [], timerIds: [], factionIds: [], locationIds: [], sessionIds: [], questIds: [], campaignThreats: [], summary: '', campaignId: plugin.state.activeCampaignId || '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Incursion' : 'New Incursion');
    addField(contentEl, 'Incursion Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Type', this.values.type, ['Raid','Occupation','Corruption Spread','Portal Opening','Army Advance','Arcane Storm','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Status', this.values.status, ['Emerging','Active','Critical','Contained','Repelled'], v => this.values.status = v);
    addTypedEntityPicker(contentEl, 'Origin (linked)', this.values.originType || 'realms', this.values.originId || '', this.plugin, v => this.values.originType = v, v => this.values.originId = v, INCURSION_ORIGIN_ENTITY_TYPES);
    addSelect(contentEl, 'Threat Level', this.values.threat, ['Low','Medium','High','Critical','Existential'], v => this.values.threat = v);
    addField(contentEl, 'Current Progress', this.values.progress, v => this.values.progress = v);
    addEntityMultiPicker(contentEl, 'Linked War Fronts', safeArr(this.values.warFrontIds), this.plugin, 'warFronts', v => this.values.warFrontIds = v);
    addEntityMultiPicker(contentEl, 'Linked Timers', safeArr(this.values.timerIds), this.plugin, 'timers', v => this.values.timerIds = v);
    addEntityMultiPicker(contentEl, 'Active Factions', safeArr(this.values.factionIds), this.plugin, 'factions', v => this.values.factionIds = v);
    addEntityMultiPicker(contentEl, 'Impacted Locations', safeArr(this.values.locationIds), this.plugin, 'locations', v => this.values.locationIds = v);
    addEntityMultiPicker(contentEl, 'Linked Sessions', safeArr(this.values.sessionIds), this.plugin, 'sessions', v => this.values.sessionIds = v);
    addEntityMultiPicker(contentEl, 'Linked Quests', safeArr(this.values.questIds), this.plugin, 'quests', v => this.values.questIds = v);
    chipField(contentEl, 'Campaign Threats', safeArr(this.values.campaignThreats), v => this.values.campaignThreats = v, { suggestions: ['Border Collapse','Crisis of Faith','Refugee Wave','Planar Breach','Supply Crisis','Political Panic','Custom'] });
    addField(contentEl, 'Notes', this.values.summary, v => this.values.summary = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Incursion name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.origin = scrubLegacyPlaceholderText(this.values.origin);
      this.values.campaignThreats = scrubLegacyPlaceholderArray(this.values.campaignThreats);
      upsert(this.plugin.state, 'incursions', this.values);
      await this.plugin.saveState();
      new Notice(`Incursion "${this.values.name}" saved.`);
      this.close();
    });
  }
}

// RollableTableModal
class RollableTableModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    const now = new Date().toISOString();
    this.values = Object.assign({
      id: uid('table'), name: '', category: '', diceFormula: '1d6', rows: [],
      visibility: 'dm-only', tags: [], source: '', status: 'Draft',
      campaignId: '', createdAt: now, updatedAt: now,
    }, this.item);
    if (!Array.isArray(this.values.rows)) this.values.rows = [];
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Rollable Table` });

    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(contentEl, 'Table Name *', this.values.name, v => this.values.name = v);
    addField(contentEl, 'Category', this.values.category, v => this.values.category = v);
    addField(contentEl, 'Dice Formula (e.g. 1d6, 2d10)', this.values.diceFormula, v => this.values.diceFormula = v);
    addSelect(contentEl, 'Status', this.values.status, ['Draft','Approved','Retired','Needs Review'], v => this.values.status = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret','revealed'], v => this.values.visibility = v);
    addField(contentEl, 'Source', this.values.source, v => this.values.source = v);
    chipField(contentEl, 'Tags', this.values.tags, v => this.values.tags = v);

    // Rows editor
    const rowsHead = contentEl.createEl('div'); rowsHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px';
    rowsHead.createEl('h3', { text: 'Table Rows (Min / Max / Result)' }).style.margin = '0';
    const rowsWrap = contentEl.createEl('div');

    const rebuildRows = () => {
      clear(rowsWrap);
      safeArr(this.values.rows).forEach((row, i) => {
        const rowDiv = ce(rowsWrap, 'div', '');
        rowDiv.style.cssText = 'display:grid;grid-template-columns:52px 52px 1fr auto;gap:6px;margin-bottom:6px;align-items:center';
        const minIn = ce(rowDiv, 'input'); minIn.type = 'number'; minIn.placeholder = 'Min'; minIn.value = row.min ?? '';
        minIn.style.cssText = 'padding:4px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
        minIn.addEventListener('change', () => { this.values.rows[i].min = parseInt(minIn.value) || 1; });
        const maxIn = ce(rowDiv, 'input'); maxIn.type = 'number'; maxIn.placeholder = 'Max'; maxIn.value = row.max ?? '';
        maxIn.style.cssText = minIn.style.cssText;
        maxIn.addEventListener('change', () => { this.values.rows[i].max = parseInt(maxIn.value) || parseInt(minIn.value) || 1; });
        const resultIn = ce(rowDiv, 'input'); resultIn.type = 'text'; resultIn.placeholder = 'Result text…'; resultIn.value = row.result || '';
        resultIn.style.cssText = 'padding:4px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
        resultIn.addEventListener('input', () => { this.values.rows[i].result = resultIn.value; });
        btn(rowDiv, '×', 'te-btn is-sm is-danger', () => { this.values.rows.splice(i, 1); rebuildRows(); });
      });
      const addRow = ce(rowsWrap, 'div', 'te-card-actions'); addRow.style.marginTop = '4px';
      btn(addRow, '+ Add Row', 'te-btn is-sm', () => {
        const last = this.values.rows[this.values.rows.length - 1];
        const nextMin = last ? ((Number(last.max) || Number(last.min) || 0) + 1) : 1;
        this.values.rows.push({ min: nextMin, max: nextMin, result: '', notes: '' });
        rebuildRows();
      });
    };
    rebuildRows();

    // Roll preview
    const rollSec = contentEl.createEl('div'); rollSec.style.cssText = 'margin-top:12px;padding:12px;border:1px solid var(--te-border);border-radius:var(--te-r-md)';
    rollSec.createEl('div', { cls: 'te-stat-label', text: 'Test Roll' });
    const rollResult = ce(rollSec, 'div', 'te-result-box', 'Press Roll to test the table.');
    rollResult.style.cssText = 'padding:8px 12px;margin:8px 0;border:1px solid var(--te-border);border-radius:var(--te-r-sm);min-height:32px;font-size:.9rem';
    const rollBtnRow = ce(rollSec, 'div', 'te-card-actions');
    btn(rollBtnRow, '🎲 Roll', 'te-btn is-primary is-sm', () => {
      const result = rollStructuredTable(this.values.diceFormula || '1d6', this.values.rows);
      rollResult.textContent = result;
      const activeSess = this.plugin.state.activeSessionId
        ? safeArr(this.plugin.state.entities.sessions).find(s => s.id === this.plugin.state.activeSessionId)
        : null;
      if (activeSess) {
        const existingLog = rollBtnRow.querySelector('.te-log-btn');
        if (!existingLog) {
          const logB = btn(rollBtnRow, 'Log to Session', 'te-btn is-sm te-log-btn', async () => {
            logSessionEvent(this.plugin, 'Table Rolled', `[${this.values.name || 'Table'}] ${result}`);
            await saveStateQuiet(this.plugin);
            new Notice('Logged to session.');
          });
        }
      }
    });

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Table name is required.'); return; }
      this.values.updatedAt = new Date().toISOString();
      if (!this.values.createdAt) this.values.createdAt = this.values.updatedAt;
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      upsert(this.plugin.state, 'tables', this.values);
      await this.plugin.saveState();
      new Notice(`Table "${this.values.name}" saved.`);
      this.close();
    });
  }
}

class TypedHomebrewModal extends Modal {
  constructor(app, plugin, homebrewType, item) {
    super(app);
    this.plugin = plugin;
    this.homebrewType = homebrewType;
    this.definition = HOMEBREW_BUILDERS[homebrewType];
    this.item = item || {};
    this.modalLabel = this.item.modalLabel || `Homebrew ${this.definition ? this.definition.label : homebrewType}`;
    const base = normalizeHomebrewRecord(Object.assign({
      id: uid('homebrew'),
      homebrewType,
      type: homebrewType,
      category: this.definition ? this.definition.category : homebrewCategoryForType(homebrewType),
      status: 'Draft',
      visibility: 'dm-only',
      scope: plugin.state.activeCampaignId ? 'campaign' : 'global',
      campaignId: plugin.state.activeCampaignId || '',
      sourceCampaignId: plugin.state.activeCampaignId || '',
      tags: [],
      includeInCompendium: false,
      balanceNotes: '',
      dmNotes: '',
    }, this.item));
    const hybridDefaults = homebrewType === 'Ancestry' && base.sourceHybridId ? hybridAncestryToBuilderValues(base) : {};
    this.values = Object.assign({}, this.definition ? this.definition.defaults : {}, hybridDefaults, flattenHomebrewPayload(base));
    this.values.homebrewType = homebrewType;
    this.values.type = this.item.type || base.type || homebrewType;
    this.values.category = this.definition ? this.definition.category : base.category;
    this.values.tags = normalizeListField(this.values.tags);
    this.values.includeInCompendium = !!base.includeInCompendium;
    if (homebrewType === 'Item' && !this.values.itemType && ['Weapon', 'Armour', 'Armor', 'Magic Item'].includes(base.homebrewType || base.type)) {
      this.values.itemType = base.homebrewType === 'Armor' ? 'Armour' : (base.homebrewType || base.type);
    }
    if (homebrewType === 'Creature' && !this.values.creatureKind && ['Monster', 'Creature', 'Beast'].includes(base.homebrewType || base.type)) {
      this.values.creatureKind = base.homebrewType || base.type;
    }
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} ${this.modalLabel}` });
    const meta = ce(contentEl, 'div', 'te-modal-section');
    meta.createEl('h3', { text: 'Homebrew Metadata' });
    addField(meta, 'Name *', this.values.name || '', v => this.values.name = v);
    addSelect(meta, 'Status', this.values.status || 'Draft', HOMEBREW_STATUS_OPTIONS, v => this.values.status = v);
    addSelect(meta, 'Visibility', this.values.visibility || 'dm-only', HOMEBREW_VISIBILITY_OPTIONS, v => this.values.visibility = v);
    addSelect(meta, 'Scope', this.values.scope || 'global', ['campaign', 'global'], v => this.values.scope = v);
    addToggle(meta, 'Include in Compendium', !!this.values.includeInCompendium, v => this.values.includeInCompendium = v);
    chipField(meta, 'Tags', safeArr(this.values.tags), v => this.values.tags = v);
    addField(meta, 'Balance Notes', this.values.balanceNotes || '', v => this.values.balanceNotes = v, 'textarea');
    addField(meta, 'DM Notes', this.values.dmNotes || '', v => this.values.dmNotes = v, 'textarea');

    safeArr(this.definition.sections).forEach(section => {
      const sec = ce(contentEl, 'div', 'te-modal-section');
      sec.createEl('h3', { text: section.title });
      safeArr(section.fields).forEach(field => this.renderField(sec, field));
    });

    modalButtons(contentEl, this, async () => {
      if (!String(this.values.name || '').trim()) { new Notice('Name is required.'); return; }
      if (this.values.scope === 'campaign') {
        this.values.campaignId = this.plugin.state.activeCampaignId || this.values.campaignId || '';
        this.values.sourceCampaignId = this.values.sourceCampaignId || this.values.campaignId || '';
      } else {
        this.values.campaignId = '';
      }
      const cleanedValues = sanitizeHomebrewDraftValue(this.values);
      const payload = sanitizeHomebrewDraftValue(this.definition.toPayload(cleanedValues, this.plugin));
      const content = this.definition.toMarkdown(payload, cleanedValues);
      const now = new Date().toISOString();
      const savedType = this.homebrewType === 'Item'
        ? (cleanedValues.itemType || this.item.type || this.homebrewType)
        : (this.homebrewType === 'Creature' ? (cleanedValues.creatureKind || this.item.type || this.homebrewType) : (this.item.type || this.homebrewType));
      const record = normalizeHomebrewRecord({
        ...this.item,
        ...cleanedValues,
        homebrewType: this.homebrewType,
        type: savedType,
        category: this.definition.category,
        payload,
        content,
        summary: homebrewSummaryFromValues(this.definition, cleanedValues),
        description: cleanedValues.description || cleanedValues.flavor || cleanedValues.fullText || cleanedValues.notes || this.item.description || '',
        sourceCampaignId: cleanedValues.sourceCampaignId || cleanedValues.campaignId || '',
        includeInCompendium: !!cleanedValues.includeInCompendium,
        balanceNotes: cleanedValues.balanceNotes || '',
        dmNotes: cleanedValues.dmNotes || '',
        updatedAt: now,
        createdAt: cleanedValues.createdAt || now,
      });
      upsert(this.plugin.state, 'homebrew', record);
      await this.plugin.saveState();
      new Notice(`${this.definition.label} "${record.name}" saved.`);
      this.close();
    });
  }
  renderField(parent, field) {
    if (field.when && !field.when(this.values)) return;
    const options = typeof field.options === 'function' ? field.options(this.plugin, this.item) : field.options;
    if (field.type === 'text') addField(parent, field.label, this.values[field.key] || '', v => this.values[field.key] = v);
    else if (field.type === 'textarea') addField(parent, field.label, this.values[field.key] || '', v => this.values[field.key] = v, 'textarea');
    else if (field.type === 'select' || field.type === 'dynamicSelect') addSelect(parent, field.label, this.values[field.key] || ((options && options[0]) || ''), options || [], v => { this.values[field.key] = v; this.onOpen(); });
    else if (field.type === 'number') addNumber(parent, field.label, this.values[field.key] || 0, v => this.values[field.key] = v);
    else if (field.type === 'toggle') addToggle(parent, field.label, !!this.values[field.key], v => this.values[field.key] = v);
    else if (field.type === 'chip') chipField(parent, field.label, safeArr(this.values[field.key]), v => this.values[field.key] = v, field.opts || {});
  }
}

class HomebrewTypeChooserModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: 'Homebrew Builder Index' });
    ce(contentEl, 'p', 'te-muted-text', 'Choose a type-specific builder. Promotion keeps the original campaign record and creates a linked reusable Homebrew record.');
    HOMEBREW_BUILDER_GROUPS.forEach(group => {
      const sec = ce(contentEl, 'div', 'te-modal-section');
      sec.createEl('h3', { text: group.title });
      group.cards.forEach(card => {
        const row = ce(sec, 'div', 'te-card');
        const head = ce(row, 'div', 'te-card-head');
        ce(head, 'h4', 'te-card-title', card.label);
        ce(row, 'p', 'te-card-body', card.desc);
        const acts = ce(row, 'div', 'te-card-actions');
        btn(acts, card.label, 'te-btn is-sm is-primary', () => {
          this.close();
          if (card.special === 'table') new RollableTableModal(this.app, this.plugin).open();
          else openHomebrewBuilder(this.app, this.plugin, card.type);
        });
      });
      if (group.title === 'Character Options') {
        const hybridRow = ce(sec, 'div', 'te-card');
        const head = ce(hybridRow, 'div', 'te-card-head');
        ce(head, 'h4', 'te-card-title', 'Hybrid Ancestry');
        ce(hybridRow, 'p', 'te-card-body', 'Open the existing hybrid ancestry builder. Hybrid saves remain compatible with the ancestry homebrew schema.');
        const acts = ce(hybridRow, 'div', 'te-card-actions');
        btn(acts, 'Hybrid Ancestry', 'te-btn is-sm', () => {
          this.close();
          new HybridAncestryModal(this.app, this.plugin).open();
        });
      }
    });
  }
}

// HomebrewModal
class HomebrewModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = normalizeHomebrewRecord(Object.assign({
      id: uid('homebrew'),
      name: '',
      category: 'Rules & Mechanics',
      type: 'Rule',
      status: 'Draft',
      visibility: 'dm-only',
      scope: plugin.state.activeCampaignId ? 'campaign' : 'global',
      campaignId: plugin.state.activeCampaignId || '',
      sourceCampaignId: plugin.state.activeCampaignId || '',
      summary: '',
      description: '',
      mechanicsText: '',
      dmNotes: '',
      tags: [],
      content: '',
    }, this.item));
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Homebrew Entry` });
    addField(contentEl, 'Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Category', this.values.category, ['Character Options','Rules & Mechanics','Items & Equipment','Monsters & Statblocks','Worlds & Planes','Rollable Tables'], v => this.values.category = v);
    addSelect(contentEl, 'Type', this.values.type, ['Ancestry','Hybrid Ancestry','Class','Subclass','Background','Feat','Spell','Item','Weapon','Armour','Monster','Creature','NPC Template','Rule','Faction','Deity','Plane','World Lore','Mechanic','Rollable Table','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Status', this.values.status, HOMEBREW_STATUS_OPTIONS, v => this.values.status = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, HOMEBREW_VISIBILITY_OPTIONS, v => this.values.visibility = v);
    addSelect(contentEl, 'Scope', this.values.scope, ['campaign','global'], v => this.values.scope = v);
    addField(contentEl, 'Summary', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(contentEl, 'Full Description', this.values.description, v => this.values.description = v, 'textarea');
    addField(contentEl, 'Mechanics Text', this.values.mechanicsText, v => this.values.mechanicsText = v, 'textarea');
    addField(contentEl, 'Content Payload / Markdown', this.values.content, v => this.values.content = v, 'textarea');
    addField(contentEl, 'DM Notes (hidden)', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    chipField(contentEl, 'Tags', this.values.tags, v => this.values.tags = v);
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Name is required.'); return; }
      if (this.values.scope === 'campaign') {
        this.values.campaignId = this.plugin.state.activeCampaignId || this.values.campaignId || '';
        this.values.sourceCampaignId = this.values.sourceCampaignId || this.values.campaignId || '';
      } else {
        this.values.campaignId = '';
      }
      this.values.updatedAt = new Date().toISOString();
      if (!this.values.createdAt) this.values.createdAt = this.values.updatedAt;
      this.values = normalizeHomebrewRecord(this.values);
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
    this.key = 'npcs';
    this.payload = '';
    this._parsed = null;
    this._importType = 'entities'; // 'entities' | 'backup'
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText('📥 Import Campaign Data');

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Import Type' });
    const typeRow = ce(s1, 'div', 'te-modal-actions');
    const setType = (t) => { this._importType = t; this.onOpen(); };
    btn(typeRow, 'Merge Entity Data', 'te-btn' + (this._importType === 'entities' ? ' is-primary' : ''), () => setType('entities'));
    btn(typeRow, 'Restore Full Backup', 'te-btn' + (this._importType === 'backup' ? ' is-primary' : ''), () => setType('backup'));

    if (this._importType === 'entities') {
      addSelect(s1, 'Target Entity Type', this.key, Object.keys(ENTITY_LABELS), v => this.key = v);
      ce(s1, 'p', 'te-muted-text', 'Merges a JSON array of items into the selected entity type. Does not modify settings, relationships, or campaign state.');
    } else {
      ce(s1, 'p', 'te-muted-text', 'Replaces ALL plugin data — entities, settings, relationships, activeCampaignId. A safety backup is saved first. To load a file directly, use the Import panel.');
    }

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Paste JSON' });
    const ta = ce(s2, 'textarea');
    ta.placeholder = this._importType === 'backup' ? 'Paste full backup or raw plugin state JSON…' : 'Paste JSON array of entities…';
    ta.rows = 8; ta.style.cssText = 'width:100%;resize:vertical;padding:8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
    if (this.payload) ta.value = this.payload;
    ta.addEventListener('input', () => { this.payload = ta.value; this._parsed = null; });

    const previewBox = ce(contentEl, 'div', 'te-result-box');
    previewBox.style.cssText = 'margin:8px 0;padding:10px;background:var(--te-bg-alt);border-radius:var(--te-r-md);font-size:.82rem;white-space:pre-wrap;max-height:140px;overflow-y:auto';
    previewBox.textContent = 'Paste JSON above, then click Preview.';

    btn(s2, '🔍 Preview', 'te-btn', () => {
      try {
        if (this._importType === 'backup') {
          const bk = parseTtrpgBackupJson(this.payload);
          const ents = bk.state.entities || {};
          const counts = Object.entries(ents).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${k}: ${v.length}`);
          previewBox.textContent = `Backup v${bk.version || '?'} — ${bk.timestamp ? new Date(bk.timestamp).toLocaleString() : 'no timestamp'}\n\nEntities:\n${counts.join('\n')}`;
          this._parsed = bk;
        } else {
          const raw = JSON.parse(this.payload);
          const arr = Array.isArray(raw) ? raw : [raw];
          const first = arr[0];
          previewBox.textContent = `${arr.length} item(s) → ${this.key}\n\nFirst item: ${first ? (first.name || first.title || JSON.stringify(first).slice(0, 100)) : '(empty)'}`;
          this._parsed = arr;
        }
      } catch (e) { previewBox.textContent = `Parse error: ${e.message}`; this._parsed = null; }
    });

    const btnRow = ce(contentEl, 'div', 'te-modal-buttons');
    btn(btnRow, 'Cancel', 'te-btn', () => this.close());
    btn(btnRow, '✅ Import', 'te-btn is-primary', async () => {
      if (!this._parsed) { new Notice('Click Preview first to validate the JSON.'); return; }
      await exportBackup(this.plugin);
      if (this._importType === 'backup') {
        try {
          Object.assign(this.plugin.state, this._parsed.state);
          migrateState(this.plugin.state);
          await this.plugin.saveState();
          new Notice('Full backup restored. Previous data was backed up first.');
          this.close();
          this.plugin.refreshViews();
        } catch (e) { new Notice(`Restore failed: ${e.message}`); }
      } else {
        const campId = this.plugin.state.activeCampaignId || '';
        this._parsed.forEach(x => {
          const item = Object.assign({ id: uid(this.key), name: 'Imported Entry' }, x);
          normalizeStorageMetadata(item, { source: 'imported', campaignId: campId });
          upsert(this.plugin.state, this.key, item);
        });
        await this.plugin.saveState();
        new Notice(`Merged ${this._parsed.length} item(s) into ${this.key}. A safety backup was saved first.`);
        this.close();
      }
    });
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
    new Setting(contentEl).setName('Campaign Root Folder').setDesc('Top-level vault folder for all campaign notes (default: Campaigns).')
      .addText(t => { t.setValue(this.values.campaignRootFolder || 'Campaigns'); t.onChange(v => this.values.campaignRootFolder = v.trim() || 'Campaigns'); });
    new Setting(contentEl).setName('Note Folder Mode').setDesc('workspace = nested workspace folders (recommended), flat = simple folders under root, legacy = old flat structure')
      .addDropdown(d => {
        d.addOption('workspace', 'Workspace (recommended)');
        d.addOption('flat', 'Flat');
        d.addOption('legacy', 'Legacy');
        d.setValue(this.values.noteFolderMode || 'workspace');
        d.onChange(v => this.values.noteFolderMode = v);
      });
    addToggle(contentEl, 'Nest Locations Under Parent Settlements/Regions', this.values.nestLocationsUnderParents !== false, v => this.values.nestLocationsUnderParents = v);
    addToggle(contentEl, 'Nest Quests & Encounters Under Adventures', this.values.nestQuestsUnderAdventures || false, v => this.values.nestQuestsUnderAdventures = v);
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

// ── Monster helper functions ──────────────────────────────────────────────────
function getMonsterArmorClass(m) {
  if (!m || m.ac == null) return 10;
  if (typeof m.ac === 'number') return m.ac;
  if (Array.isArray(m.ac)) {
    const first = m.ac[0];
    if (typeof first === 'number') return first;
    if (first && typeof first.ac === 'number') return first.ac;
  }
  return 10;
}
function getMonsterAverageHp(m) {
  if (!m || m.hp == null) return 10;
  if (typeof m.hp === 'number') return m.hp;
  if (m.hp && typeof m.hp.average === 'number') return m.hp.average;
  return 10;
}
function getMonsterDex(m) { return (m && typeof m.dex === 'number') ? m.dex : 10; }
function getMonsterInitiativeMod(m) { return modifier(getMonsterDex(m)); }
function getMonsterCr(m) {
  if (!m || m.cr == null) return '';
  if (typeof m.cr === 'string' || typeof m.cr === 'number') return String(m.cr);
  if (typeof m.cr === 'object') return String(m.cr.cr || m.cr);
  return '';
}
const CR_XP = { '0':10,'1/8':25,'1/4':50,'1/2':100,'1':200,'2':450,'3':700,'4':1100,'5':1800,'6':2300,'7':2900,'8':3900,'9':5000,'10':5900,'11':7200,'12':8400,'13':10000,'14':11500,'15':13000,'16':15000,'17':18000,'18':20000,'19':22000,'20':25000,'21':33000,'22':41000,'23':50000,'24':62000,'25':75000,'26':90000,'27':105000,'28':120000,'29':135000,'30':155000 };
function getMonsterXp(m) { return CR_XP[getMonsterCr(m)] || 0; }
function normaliseBestiaryMonsterForCombat(m) {
  return {
    name: m.name || 'Monster',
    type: 'Monster',
    ac: getMonsterArmorClass(m),
    hp: getMonsterAverageHp(m),
    maxHp: getMonsterAverageHp(m),
    tempHp: 0,
    dex: getMonsterDex(m),
    initiative: 0, initLocked: false,
    conditions: [],
    cr: getMonsterCr(m),
    xp: getMonsterXp(m),
    sourceReferenceType: 'bestiary',
    sourceReferenceName: m.name || '',
    sourceReferenceSource: m.source || '',
  };
}

// AddCombatantModal
class AddCombatantModal extends Modal {
  constructor(app, plugin, type) {
    super(app);
    this.plugin = plugin;
    this.type = type || 'NPC';
    this.values = { name: '', initiative: 0, initLocked: false, hp: 10, maxHp: 10, tempHp: 0, ac: 10, dex: 10, conditions: [], type: this.type };
    this.mode = 'manual'; // 'manual' | 'entity' | 'bestiary'
    this.selectedEntityType = 'npcs';
    this.selectedEntityId = '';
  }
  onOpen() {
    const { contentEl } = this;
    this._render(contentEl);
  }
  _render(contentEl) {
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `Add ${this.type} to Initiative` });

    // Mode toggle
    const modeRow = ce(contentEl, 'div', 'te-modal-actions');
    modeRow.style.marginBottom = '12px';
    btn(modeRow, 'Pick Existing Entity', this.mode === 'entity' ? 'te-btn is-primary is-sm' : 'te-btn is-sm', () => { this.mode = 'entity'; this._render(contentEl); });
    btn(modeRow, 'Enter Manually', this.mode === 'manual' ? 'te-btn is-primary is-sm' : 'te-btn is-sm', () => { this.mode = 'manual'; this._render(contentEl); });
    if (this.type === 'Monster') {
      btn(modeRow, 'Pick from Bestiary', this.mode === 'bestiary' ? 'te-btn is-primary is-sm' : 'te-btn is-sm', () => { this.mode = 'bestiary'; this._render(contentEl); });
    }

    if (this.mode === 'bestiary') {
      const bestiaryWrap = ce(contentEl, 'div', '');
      const searchIn = ce(bestiaryWrap, 'input', '');
      searchIn.type = 'text'; searchIn.placeholder = 'Search bestiary…';
      searchIn.style.cssText = 'width:100%;margin-bottom:8px;padding:6px 8px;border-radius:var(--te-r-md);border:1px solid var(--te-border);background:var(--te-bg);color:var(--te-text)';
      const listWrap = ce(bestiaryWrap, 'div', '');
      listWrap.style.cssText = 'max-height:300px;overflow-y:auto';
      const buildBestiaryList = async (q) => {
        clear(listWrap);
        ce(listWrap, 'p', 'te-muted-text', 'Loading bestiary…');
        const monsters = await this.plugin.refData.get('bestiary');
        clear(listWrap);
        if (!monsters.length) { ce(listWrap, 'p', 'te-empty-state', 'No bestiary data found.'); return; }
        const filtered = q ? monsters.filter(m => (m.name||'').toLowerCase().includes(q.toLowerCase()) || (getMonsterCr(m)||'').includes(q)) : monsters;
        filtered.slice(0, 40).forEach(m => {
          const row = ce(listWrap, 'div', 'te-card');
          row.style.cssText = 'padding:6px 10px;cursor:pointer;margin-bottom:3px;display:flex;justify-content:space-between;align-items:center';
          row.onmouseenter = () => row.style.background = 'var(--te-bg-alt)';
          row.onmouseleave = () => row.style.background = '';
          const left = ce(row, 'div', '');
          ce(left, 'strong', '', m.name || 'Unknown');
          const typeStr = typeof m.type === 'object' ? (m.type.type || '') : (m.type || '');
          if (typeStr) ce(left, 'span', 'te-muted-text', ` ${typeStr}`);
          const right2 = ce(row, 'div', 'te-muted-text');
          const cr = getMonsterCr(m);
          right2.textContent = [cr ? `CR ${cr}` : '', `AC ${getMonsterArmorClass(m)}`, `HP ${getMonsterAverageHp(m)}`].filter(Boolean).join(' · ');
          row.addEventListener('click', () => {
            const combatant = normaliseBestiaryMonsterForCombat(m);
            Object.assign(this.values, combatant);
            this.mode = 'manual';
            this._render(contentEl);
          });
        });
        if (filtered.length > 40) ce(listWrap, 'p', 'te-empty-state', `Showing 40 of ${filtered.length} — refine search.`);
        else if (!filtered.length) ce(listWrap, 'p', 'te-empty-state', 'No matches.');
      };
      buildBestiaryList('');
      searchIn.addEventListener('input', () => buildBestiaryList(searchIn.value));
      const cancelRow = ce(contentEl, 'div', 'te-modal-actions');
      cancelRow.style.marginTop = '10px';
      btn(cancelRow, 'Cancel', 'te-btn', () => this.close());
      return; // don't render manual fields in bestiary mode
    }

    if (this.mode === 'entity') {
      // Entity type selector
      new Setting(contentEl).setName('Entity Type').addDropdown(d => {
        d.addOption('npcs', 'NPCs'); d.addOption('characters', 'PCs');
        d.setValue(this.selectedEntityType);
        d.onChange(v => { this.selectedEntityType = v; this.selectedEntityId = ''; this._render(contentEl); });
      });
      const options = safeArr(this.plugin.state.entities[this.selectedEntityType]);
      if (!options.length) {
        ce(contentEl, 'p', 'te-muted', `No ${this.selectedEntityType} found. Add some first or use manual entry.`);
      } else {
        new Setting(contentEl).setName('Select Entity').addDropdown(d => {
          d.addOption('', '— Select —');
          options.forEach(e => d.addOption(e.id, e.name || e.id));
          d.setValue(this.selectedEntityId || '');
          d.onChange(v => {
            this.selectedEntityId = v;
            if (v) {
              const entity = options.find(e => e.id === v);
              if (entity) {
                this.values.name = entity.name || '';
                this.values.maxHp = entity.hp || entity.maxHp || 10;
                this.values.hp = this.values.maxHp;
                this.values.ac = entity.ac || 10;
                this.values.dex = entity.dex || 10;
                this.values.sourceEntityType = this.selectedEntityType;
                this.values.sourceEntityId = v;
                this._render(contentEl);
              }
            }
          });
        });
      }
    }

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
      id: uid('rel'), campaignId: '',
      fromEntityType: 'npcs', fromId: '', toEntityType: 'factions', toId: '',
      relationshipType: 'Neutral', attitude: 'Neutral',
      influence: '', trust: '', fear: '', notes: '', dmNotes: '',
      visibility: 'dm-only',
      // Legacy text fields kept for backward compatibility
      from: '', to: '', type: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Relationship` });
    addTypedEntityPicker(contentEl, 'From',
      this.values.fromEntityType, this.values.fromId, this.plugin,
      v => this.values.fromEntityType = v, v => this.values.fromId = v);
    addTypedEntityPicker(contentEl, 'To',
      this.values.toEntityType, this.values.toId, this.plugin,
      v => this.values.toEntityType = v, v => this.values.toId = v);
    addSelect(contentEl, 'Relationship Type', this.values.relationshipType, RELATIONSHIP_TYPES, v => this.values.relationshipType = v);
    addSelect(contentEl, 'Attitude', this.values.attitude, ['Allied','Friendly','Neutral','Suspicious','Hostile','Enemy','Unknown'], v => this.values.attitude = v);
    chipField(contentEl, 'Power Dynamic / Influence', safeArr(this.values.powerDynamic), v => this.values.powerDynamic = v, { bank: 'powerDynamic' });
    addSelect(contentEl, 'Trust Level', this.values.trustLevel || this.values.trust || 'Neutral', ['Absolute trust','High trust','Cautious trust','Neutral','Suspicious','Low trust','Open distrust','Betrayed','Secretly loyal','Secretly hostile','Unknown'], v => this.values.trustLevel = v);
    chipField(contentEl, 'Fear / Leverage', safeArr(this.values.fearLeverage), v => this.values.fearLeverage = v, { bank: 'fearLeverage' });
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    addField(contentEl, 'DM Notes (hidden)', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    modalButtons(contentEl, this, async () => {
      if (!this.values.fromId || !this.values.toId) { new Notice('Both From and To entities must be selected.'); return; }
      // Stamp campaignId from active campaign if not already set
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
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

// NobleFamilyModal
class NobleFamilyModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
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
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Noble Family` });

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Identity' });
    addCampaignPicker(s1, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(s1, 'House Name *', this.values.name, v => this.values.name = v);
    addField(s1, 'House Motto', this.values.motto, v => this.values.motto = v);
    addSelect(s1, 'Status', this.values.status, ['Ruling','Noble','Gentry','Declining','Exiled','Extinct','Unknown'], v => this.values.status = v);
    addSelect(s1, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addEntityPicker(s1, 'Head of House (NPC)', this.values.headOfHouseId, this.plugin, 'npcs', v => this.values.headOfHouseId = v);
    addEntityPicker(s1, 'Home Region', this.values.regionId, this.plugin, 'regions', v => this.values.regionId = v);
    addEntityPicker(s1, 'Seat / Settlement', this.values.settlementId, this.plugin, 'settlements', v => this.values.settlementId = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Holdings & Claims' });
    addField(s2, 'Holdings & Titles', this.values.holdings, v => this.values.holdings = v, 'textarea');
    addField(s2, 'Claims & Disputes', this.values.claims, v => this.values.claims = v, 'textarea');
    addField(s2, 'Debts & Obligations', this.values.debts, v => this.values.debts = v, 'textarea');

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Relations' });
    addEntityMultiPicker(s3, 'Allied Factions', this.values.factionIds, this.plugin, 'factions', v => this.values.factionIds = v);
    addEntityMultiPicker(s3, 'Related Quests', this.values.relatedQuestIds, this.plugin, 'quests', v => this.values.relatedQuestIds = v);
    addEntityMultiPicker(s3, 'Member NPCs', this.values.memberNpcIds, this.plugin, 'npcs', v => this.values.memberNpcIds = v);
    addEntityMultiPicker(s3, 'Heir NPCs', this.values.heirNpcIds, this.plugin, 'npcs', v => this.values.heirNpcIds = v);
    addEntityMultiPicker(s3, 'Rival Noble Families', this.values.rivalFamilyIds, this.plugin, 'nobleFamilies', v => this.values.rivalFamilyIds = v);
    chipField(s3, 'Members (names)', safeArr(this.values.members), v => this.values.members = v);
    chipField(s3, 'Alliances (house names)', safeArr(this.values.alliances), v => this.values.alliances = v);
    chipField(s3, 'Rivals (house names)', safeArr(this.values.rivals), v => this.values.rivals = v);

    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'DM Notes' });
    addField(s4, 'Secrets & Scandals', this.values.secrets, v => this.values.secrets = v, 'textarea');
    addField(s4, 'Summary (player-visible)', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(s4, 'DM Notes', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('House name is required.'); return; }
      upsert(this.plugin.state, 'nobleFamilies', this.values);
      await this.plugin.saveState();
      new Notice(`Noble Family "${this.values.name}" saved.`);
      this.close();
    }, 'Save Noble Family');
  }
}

class RefDataPickerModal extends Modal {
  constructor(app, items, label, onPick) {
    super(app);
    this.items = items || [];
    this.label = label;
    this.onPick = onPick;
    this.search = '';
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `Pick ${this.label}` });
    const searchEl = ce(contentEl, 'input');
    searchEl.type = 'text'; searchEl.placeholder = `Search ${this.label}...`;
    searchEl.style.cssText = 'width:100%;margin-bottom:10px;padding:6px 8px;border-radius:var(--te-r-md);border:1px solid var(--te-border)';
    const listEl = ce(contentEl, 'div', '');
    listEl.style.cssText = 'max-height:400px;overflow-y:auto';
    const render = () => {
      clear(listEl);
      const q = this.search.toLowerCase();
      const filtered = (q ? this.items.filter(it => (it.name||'').toLowerCase().includes(q) || (it.source||'').toLowerCase().includes(q)) : this.items).slice(0, 50);
      if (!filtered.length) { ce(listEl, 'p', 'te-empty-state', 'No results.'); return; }
      filtered.forEach(it => {
        const row = ce(listEl, 'div', 'te-card');
        row.style.cssText = 'padding:8px 10px;cursor:pointer;margin-bottom:4px';
        row.onmouseenter = () => row.style.background = 'var(--te-bg-alt)';
        row.onmouseleave = () => row.style.background = '';
        const h = ce(row, 'div', ''); h.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
        ce(h, 'strong', '', it.name || 'Unknown');
        ce(h, 'span', 'te-stat-label', it.source || '');
        if (it.prerequisite) ce(row, 'p', 'te-card-body', `Req: ${it.prerequisite}`);
        if (it.entries && it.entries.length) ce(row, 'p', 'te-card-body', String(it.entries[0] || '').slice(0, 120) + '…');
        row.addEventListener('click', () => { this.onPick(it); this.close(); });
      });
    };
    searchEl.addEventListener('input', () => { this.search = searchEl.value; render(); });
    render();
  }
  onClose() { clear(this.contentEl); }
}

// LevelUpModal
class LevelUpModal extends Modal {
  constructor(app, plugin, character, fromLevel, toLevel) {
    super(app);
    this.plugin = plugin;
    this.char = character;
    this.fromLevel = fromLevel;
    this.toLevel = toLevel;
    this.cls = character.class || '';
    this.hitDie = HIT_DICE[this.cls] || 8;
    this.hpChoice = 'average';
    this.hpRoll = 0;
    this.hpManual = 0;
    this.asiChoice = 'asi';
    this.asiDeltas = {};
    this.featChosen = '';
    this.spellsAdded = [];
    this.subclassChosen = character.subclass || '';
    this.rulesetOverride = character.ruleset || 'PHB';
    this.isAsiLevel = getAsiLevels(this.cls).includes(toLevel);
    this.isCaster  = isSpellcaster(this.cls);
    this.newSlots  = getSpellSlotsForLevel(this.cls, toLevel);
    this.levelHistory = Array.isArray(character.levelHistory) ? character.levelHistory : [];
    this.avgHp = Math.floor(this.hitDie / 2) + 1;
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `🎉 Level Up! ${this.char.name || 'Character'} → Level ${this.toLevel}` });

    const sumCard = ce(contentEl, 'div', 'te-modal-section');
    sumCard.style.cssText = 'background:var(--te-bg-alt);border-radius:var(--te-r-md);padding:12px;margin-bottom:12px';
    ce(sumCard, 'p', '', `Level ${this.fromLevel} → ${this.toLevel}  |  Class: ${this.cls || 'Unknown'}  |  Hit Die: d${this.hitDie}`);
    const pbOld = profBonus(this.fromLevel), pbNew = profBonus(this.toLevel);
    if (pbNew > pbOld) ce(sumCard, 'p', 'te-card-body', `⚡ Proficiency Bonus increases: +${pbOld} → +${pbNew}`);

    // HP section
    const sHP = ce(contentEl, 'div', 'te-modal-section');
    sHP.createEl('h3', { text: 'HP Increase' });
    const hpResult = ce(sHP, 'div', '');
    hpResult.style.cssText = 'padding:8px;border:1px solid var(--te-accent);border-radius:var(--te-r-md);margin-bottom:8px;font-weight:600;background:var(--te-bg-alt)';
    hpResult.textContent = `HP gained: ${this.avgHp} (average of d${this.hitDie})`;
    addSelect(sHP, 'HP Method', this.hpChoice, ['average','roll','manual'], v => {
      this.hpChoice = v;
      if (v === 'average') hpResult.textContent = `HP gained: ${this.avgHp} (average)`;
    });
    const rollRow = ce(sHP, 'div', 'te-card-actions');
    btn(rollRow, `🎲 Roll d${this.hitDie}`, 'te-btn is-sm', () => {
      this.hpRoll = rollDie(this.hitDie); this.hpChoice = 'roll';
      hpResult.textContent = `HP gained: ${this.hpRoll} (rolled d${this.hitDie})`;
    });
    const hpManInp = ce(sHP, 'input'); hpManInp.type = 'number'; hpManInp.placeholder = 'Manual HP amount'; hpManInp.style.cssText = 'width:100%;margin-top:6px';
    hpManInp.addEventListener('input', () => {
      this.hpManual = parseInt(hpManInp.value) || 0; this.hpChoice = 'manual';
      hpResult.textContent = `HP gained: ${this.hpManual} (manual)`;
    });

    // ASI / Feat section
    if (this.isAsiLevel) {
      const sASI = ce(contentEl, 'div', 'te-modal-section');
      sASI.createEl('h3', { text: `ASI or Feat (Level ${this.toLevel})` });
      ce(sASI, 'p', 'te-card-body', 'You reached an ASI/Feat level. Choose one option.');
      addSelect(sASI, 'Choice', this.asiChoice, ['asi','feat'], v => {
        this.asiChoice = v;
        asiSection.style.display = v === 'asi' ? '' : 'none';
        featSection.style.display = v === 'feat' ? '' : 'none';
      });
      const asiSection = ce(sASI, 'div', '');
      ce(asiSection, 'p', 'te-card-body', 'Spend +2 on one ability score, or +1/+1 on two (max 20 each).');
      const ABILITIES = ['str','dex','con','int','wis','cha'];
      const totLabel = ce(asiSection, 'div', 'te-card-body', 'Spent: 0 / 2');
      const updateTot = () => {
        const tot = Object.values(this.asiDeltas).reduce((s,v)=>s+(parseInt(v)||0),0);
        totLabel.textContent = `Spent: ${tot} / 2`;
        totLabel.style.color = tot > 2 ? 'var(--te-danger)' : tot === 2 ? 'var(--te-accent)' : '';
      };
      const abRow = ce(asiSection, 'div', '');
      abRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px';
      ABILITIES.forEach(ab => {
        const abWrap = ce(abRow, 'div', '');
        const cur = parseInt(this.char[ab]) || 10;
        new Setting(abWrap).setName(`${ab.toUpperCase()} (${cur})`).addDropdown(d => {
          d.addOption('0','±0'); d.addOption('1','+1'); d.addOption('2','+2');
          d.setValue('0'); d.onChange(v => { this.asiDeltas[ab] = parseInt(v)||0; updateTot(); });
        });
      });
      const featSection = ce(sASI, 'div', '');
      featSection.style.display = 'none';
      const featDisplay = ce(featSection, 'div', 'te-picker-display');
      featDisplay.style.cssText = 'padding:6px 8px;background:var(--te-bg-alt);border-radius:var(--te-r-md);font-size:.85rem;margin-bottom:6px';
      featDisplay.textContent = this.featChosen || '— No feat selected —';
      const featRow = ce(featSection, 'div', 'te-card-actions');
      btn(featRow, '📖 Browse Feats', 'te-btn is-sm', async () => {
        const feats = await this.plugin.refData.get('feats');
        new RefDataPickerModal(this.plugin.app, feats, 'Feat', feat => {
          this.featChosen = feat.name;
          featDisplay.textContent = feat.name + (feat.prerequisite ? ` (Req: ${feat.prerequisite})` : '');
        }).open();
      });
      addField(featSection, 'Or type feat name', this.featChosen, v => { this.featChosen = v; featDisplay.textContent = v || '— No feat selected —'; });
      ce(featSection, 'p', 'te-card-body', 'Browse from the feat compendium or type manually. Check prerequisites before selecting.');
    }

    // Spell slots section
    if (this.isCaster && this.newSlots) {
      const sSp = ce(contentEl, 'div', 'te-modal-section');
      sSp.createEl('h3', { text: 'Updated Spell Slots' });
      const oldSlots = getSpellSlotsForLevel(this.cls, this.fromLevel);
      const grid = ce(sSp, 'div', '');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:6px;font-size:.82rem';
      this.newSlots.forEach((slots, i) => {
        if (slots === 0) return;
        const oldCount = oldSlots ? (oldSlots[i] || 0) : 0;
        const gained = slots - oldCount;
        const cell = ce(grid, 'div', 'te-card'); cell.style.padding = '8px;text-align:center';
        ce(cell, 'div', '', `Lvl ${i+1}`);
        ce(cell, 'div', 'te-stat-big', String(slots));
        if (gained > 0) { const g = ce(cell, 'div', ''); g.style.color = 'var(--te-accent)'; g.textContent = `+${gained}`; }
      });
      ce(sSp, 'p', 'te-card-body', 'Visit the Spellbook to add spells for your new available levels.');
    } else if (this.isCaster && SPELLCASTER_TYPE[this.cls] === 'pact') {
      const pact = PACT_SLOTS[this.toLevel];
      if (pact) {
        const sSp = ce(contentEl, 'div', 'te-modal-section');
        sSp.createEl('h3', { text: 'Warlock Pact Slots' });
        ce(sSp, 'p', '', `${pact.slots} slot(s) of spell level ${pact.level}`);
      }
    }

    // Subclass selection (level 3 is the usual subclass choice level for most classes)
    const subclassLevels = { Wizard:2, Cleric:1, Druid:2, Sorcerer:1, Warlock:1, Artificer:3 };
    const isSubclassLevel = this.toLevel === (subclassLevels[this.cls] || 3);
    if (isSubclassLevel || this.subclassChosen) {
      const sSub = ce(contentEl, 'div', 'te-modal-section');
      sSub.createEl('h3', { text: 'Subclass' });
      if (isSubclassLevel) ce(sSub, 'p', 'te-card-body', `Level ${this.toLevel} is when ${this.cls || 'your class'} typically chooses a subclass.`);
      addField(sSub, 'Subclass Name', this.subclassChosen, v => this.subclassChosen = v);
    }

    // Spell selection for casters (known/prepared spells gained at this level)
    if (this.isCaster) {
      const sSpSel = ce(contentEl, 'div', 'te-modal-section');
      sSpSel.createEl('h3', { text: 'Spell Selection' });
      const casterType = (typeof SPELLCASTER_TYPE !== 'undefined' ? SPELLCASTER_TYPE : {})[this.cls] || 'full';
      ce(sSpSel, 'p', 'te-card-body', casterType === 'half' ? `Paladin/Ranger: you may learn new spells available at your new spell level.` : casterType === 'pact' ? `Warlock: choose spells known from your expanded list.` : `Add any new spells you're learning or preparing at level ${this.toLevel}.`);
      const addedDisplay = ce(sSpSel, 'div', '');
      addedDisplay.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;min-height:28px;padding:4px;background:var(--te-bg-alt);border-radius:var(--te-r-md);margin-bottom:8px';
      const rebuildAdded = () => {
        clear(addedDisplay);
        if (!this.spellsAdded.length) { ce(addedDisplay, 'span', 'te-empty-state', 'No spells added yet.'); return; }
        this.spellsAdded.forEach((sp, i) => {
          const chip = ce(addedDisplay, 'span', 'te-chip');
          chip.textContent = sp; chip.style.cssText = 'padding:2px 8px;background:var(--te-accent-light,rgba(109,99,255,.15));border-radius:12px;font-size:.82rem;display:inline-flex;align-items:center;gap:4px';
          const rm = ce(chip, 'span', '', '×'); rm.style.cursor = 'pointer';
          rm.addEventListener('click', () => { this.spellsAdded.splice(i,1); rebuildAdded(); });
        });
      };
      rebuildAdded();
      const spellBtnRow = ce(sSpSel, 'div', 'te-card-actions');
      btn(spellBtnRow, '📖 Browse Spells', 'te-btn is-sm', async () => {
        const allSpells = await this.plugin.refData.get('spells');
        const maxSpellLevel = Math.ceil(this.toLevel / 2);
        const classSpells = allSpells.filter(s => {
          const lvl = typeof s.level === 'number' ? s.level : parseInt(s.level) || 0;
          return lvl <= maxSpellLevel;
        });
        new RefDataPickerModal(this.plugin.app, classSpells.length ? classSpells : allSpells, 'Spell', spell => {
          const name = spell.name || 'Spell';
          if (!this.spellsAdded.includes(name)) { this.spellsAdded.push(name); rebuildAdded(); }
        }).open();
      });
      addField(sSpSel, 'Or add spell by name', '', v => {
        if (v.trim() && !this.spellsAdded.includes(v.trim())) { this.spellsAdded.push(v.trim()); rebuildAdded(); }
      });
    }

    // Class features section
    const sFeats = ce(contentEl, 'div', 'te-modal-section');
    sFeats.createEl('h3', { text: 'Class Features' });
    const CLASS_FEATURE_HINTS = {
      Barbarian: { 2:'Reckless Attack, Danger Sense', 3:'Primal Path', 4:'ASI', 5:'Extra Attack, Fast Movement', 6:'Path Feature', 7:'Feral Instinct', 8:'ASI', 9:'Brutal Critical' },
      Bard: { 2:'Jack of All Trades, Song of Rest', 3:'Expertise, Bard College', 4:'ASI', 5:'Font of Inspiration', 6:'Countercharm, College Feature', 10:'Magical Secrets', 12:'ASI', 14:'Magical Secrets' },
      Cleric: { 2:'Channel Divinity, Divine Domain Feature', 3:'Channel Divinity 2/rest', 4:'ASI', 5:'Destroy Undead', 6:'Channel Divinity 3/rest', 8:'Divine Strike/Potent Spellcasting' },
      Druid: { 2:'Wild Shape, Druid Circle', 4:'ASI, Wild Shape Improvement', 6:'Circle Feature', 8:'ASI', 10:'Circle Feature', 12:'ASI' },
      Fighter: { 2:'Action Surge', 3:'Martial Archetype', 4:'ASI', 5:'Extra Attack', 6:'ASI', 7:'Archetype Feature', 8:'ASI', 9:'Indomitable' },
      Monk: { 2:'Ki, Unarmored Movement', 3:'Monastic Tradition, Deflect Missiles', 4:'ASI, Slow Fall', 5:'Extra Attack, Stunning Strike', 6:'Ki-Empowered Strikes, Tradition Feature' },
      Paladin: { 2:'Divine Smite, Fighting Style, Spellcasting', 3:'Channel Divinity, Sacred Oath', 4:'ASI', 5:'Extra Attack', 6:'Aura of Protection' },
      Ranger: { 2:'Fighting Style, Spellcasting, Primeval Awareness', 3:'Ranger Archetype, Primeval Awareness', 4:'ASI', 5:'Extra Attack', 6:'Favored Enemy Improvement' },
      Rogue: { 2:'Cunning Action', 3:'Roguish Archetype', 4:'ASI', 5:'Uncanny Dodge', 6:'Expertise', 7:'Evasion', 8:'ASI', 9:'Roguish Archetype Feature' },
      Sorcerer: { 2:'Font of Magic', 3:'Metamagic', 4:'ASI', 6:'Sorcerous Origin Feature', 8:'ASI', 10:'Metamagic', 12:'ASI', 14:'Sorcerous Origin Feature' },
      Warlock: { 2:'Eldritch Invocations', 3:'Pact Boon', 4:'ASI', 5:'Eldritch Invocation', 6:'Otherworldly Patron Feature', 7:'Eldritch Invocation', 8:'ASI' },
      Wizard: { 2:'Arcane Tradition', 4:'ASI', 6:'Arcane Tradition Feature', 8:'ASI', 10:'Arcane Tradition Feature', 12:'ASI', 14:'Arcane Tradition Feature' },
    };
    const hint = (CLASS_FEATURE_HINTS[this.cls] || {})[this.toLevel];
    if (hint) ce(sFeats, 'p', 'te-card-body', `📋 Suggested for ${this.cls} level ${this.toLevel}: ${hint}`);
    else ce(sFeats, 'p', 'te-card-body', `Check your ${this.cls || 'class'} description for features gained at level ${this.toLevel}.`);
    addField(sFeats, 'Features / Notes (optional)', this._featureNotes || '', v => this._featureNotes = v, 'textarea');

    // Ruleset override
    const sRule = ce(contentEl, 'div', 'te-modal-section');
    sRule.createEl('h3', { text: 'Ruleset' });
    addSelect(sRule, 'Ruleset', this.rulesetOverride, ['PHB','PHB 2024','Homebrew','Manual Override'], v => this.rulesetOverride = v);
    addToggle(sRule, 'Manual override (skip automation)', this._manualOverride || false, v => this._manualOverride = v);

    const actRow = ce(contentEl, 'div', 'te-modal-actions');
    btn(actRow, 'Apply Level Up', 'te-btn is-primary', async () => {
      let hpGain = this.avgHp;
      if (this.hpChoice === 'roll')   hpGain = this.hpRoll;
      if (this.hpChoice === 'manual') hpGain = this.hpManual;

      const asiApplied = {};
      if (this.isAsiLevel && this.asiChoice === 'asi') {
        ['str','dex','con','int','wis','cha'].forEach(ab => {
          const delta = parseInt(this.asiDeltas[ab]) || 0;
          if (delta > 0) { this.char[ab] = Math.min(20, (parseInt(this.char[ab])||10) + delta); asiApplied[ab] = delta; }
        });
      }

      const oldMaxHp = parseInt(this.char.maxHp) || parseInt(this.char.hp) || 0;
      this.char.maxHp = oldMaxHp + hpGain;

      if (this.isCaster && this.newSlots) {
        const slotsObj = {};
        this.newSlots.forEach((s, i) => { if (s > 0) slotsObj[String(i+1)] = { max: s, used: 0 }; });
        this.char.spellSlots = slotsObj;
      }

      // Apply subclass choice
      if (this.subclassChosen) this.char.subclass = this.subclassChosen;
      // Apply ruleset
      if (this.rulesetOverride) this.char.ruleset = this.rulesetOverride;
      // Apply spells added
      if (this.spellsAdded.length) {
        const existing = safeArr(this.char.knownSpells || this.char.spells);
        this.char.knownSpells = [...new Set([...existing, ...this.spellsAdded])];
      }
      const histEntry = {
        fromLevel: this.fromLevel, toLevel: this.toLevel,
        date: new Date().toISOString().slice(0,10),
        hpGain, hpMethod: this.hpChoice,
        asiChoice: this.asiChoice, asiApplied,
        featChosen: this.asiChoice === 'feat' ? (this.featChosen || '') : '',
        subclassChosen: this.subclassChosen || '',
        spellsAdded: this.spellsAdded,
        featureNotes: this._featureNotes || '',
        ruleset: this.rulesetOverride || '',
      };
      this.levelHistory.push(histEntry);
      this.char.levelHistory = this.levelHistory;
      upsert(this.plugin.state, 'characters', this.char);
      await this.plugin.saveState();
      const asiMsg = Object.keys(asiApplied).length ? ` ASI applied: ${Object.entries(asiApplied).map(([k,v])=>`+${v} ${k.toUpperCase()}`).join(', ')}.` : '';
      const subMsg = this.subclassChosen ? ` Subclass: ${this.subclassChosen}.` : '';
      const spMsg = this.spellsAdded.length ? ` ${this.spellsAdded.length} spell(s) added.` : '';
      new Notice(`${this.char.name} is now level ${this.toLevel}! Max HP +${hpGain}.${asiMsg}${subMsg}${spMsg}`, 8000);
      this.close();
    });
    btn(actRow, 'Skip', 'te-btn', () => this.close());
  }
}

// CharacterModal (Player Mode)
class CharacterModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('char'), name: '', race: '', class: '', subclass: '', background: '', level: 1, alignment: 'True Neutral',
      campaignId: '',
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      hp: 0, maxHp: 0, tempHp: 0, ac: 10, speed: '30 ft',
      skills: [], savingThrows: [], features: [], spells: [],
      equipment: [], currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
      xp: 0, spellSlots: {}, deathSaves: { successes: 0, failures: 0 },
      backstory: '', notes: '', languages: [], knownSpells: [], preparedSpells: [],
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Character` });

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Identity' });
    addCampaignPicker(s1, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(s1, 'Character Name *', this.values.name, v => this.values.name = v);
    // Race datalist — populated from data/races.json + hardcoded fallback + hybrid ancestries
    new Setting(s1).setName('Race / Ancestry').addText(t => {
      const dl = s1.createEl('datalist'); dl.id = 'char-race-dl';
      const hybridNames = safeArr(this.plugin.state.entities.hybridAncestries).map(h => h.name).filter(Boolean);
      [...ANCESTRIES, ...hybridNames].forEach(a => { const o = dl.createEl('option'); o.value = a; });
      t.inputEl.setAttribute('list', dl.id);
      t.setValue(this.values.race || '');
      t.onChange(v => this.values.race = v);
      this.plugin.refData.get('races').then(races => {
        const refNames = [...new Set(races.map(r => r.name).filter(Boolean))];
        const existing = new Set([...ANCESTRIES, ...hybridNames]);
        refNames.filter(n => !existing.has(n)).forEach(n => { const o = dl.createEl('option'); o.value = n; });
      }).catch(() => {});
    });
    // Class datalist
    new Setting(s1).setName('Class').addText(t => {
      const dl = s1.createEl('datalist'); dl.id = 'char-class-dl';
      CLASSES.forEach(c => { const o = dl.createEl('option'); o.value = c; });
      t.inputEl.setAttribute('list', dl.id);
      t.setValue(this.values.class || '');
      t.onChange(v => this.values.class = v);
      this.plugin.refData.get('classes').then(classes => {
        const existing = new Set(CLASSES);
        [...new Set(classes.map(c => c.name).filter(Boolean))].filter(n => !existing.has(n)).forEach(n => {
          const o = dl.createEl('option'); o.value = n;
        });
      }).catch(()=>{});
    });
    // Subclass datalist
    new Setting(s1).setName('Subclass').addText(t => {
      const subDl = s1.createEl('datalist'); subDl.id = 'char-subclass-dl';
      t.inputEl.setAttribute('list', subDl.id);
      t.setValue(this.values.subclass || '');
      t.onChange(v => this.values.subclass = v);
      this.plugin.refData.get('subclasses').then(subs => {
        const cls = this.values.class || '';
        const filtered = cls ? subs.filter(s => !s.className || s.className.toLowerCase() === cls.toLowerCase()) : subs;
        [...new Set(filtered.map(s => s.name || s.shortName).filter(Boolean))].forEach(n => {
          const o = subDl.createEl('option'); o.value = n;
        });
      }).catch(()=>{});
    });
    new Setting(s1).setName('Background').addText(t => {
      const dl = s1.createEl('datalist'); dl.id = 'char-bg-dl';
      BACKGROUNDS.forEach(b => { const o = dl.createEl('option'); o.value = b; });
      t.inputEl.setAttribute('list', dl.id);
      t.setValue(this.values.background || '');
      t.onChange(v => this.values.background = v);
      this.plugin.refData.get('backgrounds').then(bgs => {
        const refNames = [...new Set(bgs.map(b => b.name).filter(Boolean))];
        const existing = new Set(BACKGROUNDS);
        refNames.filter(n => !existing.has(n)).forEach(n => { const o = dl.createEl('option'); o.value = n; });
      }).catch(() => {});
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
    // Max HP suggestion: hit die avg + CON mod per level
    {
      const conMod = Math.floor((this.values.con - 10) / 2);
      const hitDie = HIT_DIE_BY_CLASS[this.values.class] || 8;
      const lvl = this.values.level || 1;
      const avgRoll = Math.ceil(hitDie / 2) + 1;
      const sugMaxHp = hitDie + conMod + (lvl - 1) * (avgRoll + conMod);
      const mhpSug = ce(s3, 'div', ''); mhpSug.style.cssText = 'font-size:.82rem;color:var(--te-muted);margin:-6px 0 8px 0;display:flex;align-items:center;gap:8px';
      ce(mhpSug, 'span', '', `Suggested (d${hitDie}, Lvl ${lvl}, CON ${conMod >= 0 ? '+' : ''}${conMod}): ${sugMaxHp}`);
      btn(mhpSug, 'Apply', 'te-btn is-sm', () => { this.values.maxHp = sugMaxHp; if (!this.values.hp) this.values.hp = sugMaxHp; this.onOpen(); });
    }
    addNumber(s3, 'Current HP', this.values.hp, v => this.values.hp = v);
    addNumber(s3, 'Temp HP', this.values.tempHp, v => this.values.tempHp = v);
    addNumber(s3, 'AC', this.values.ac, v => this.values.ac = v);
    // AC suggestion: 10 + DEX mod (unarmored baseline)
    {
      const dexMod = Math.floor((this.values.dex - 10) / 2);
      const acSug = ce(s3, 'div', ''); acSug.style.cssText = 'font-size:.82rem;color:var(--te-muted);margin:-6px 0 8px 0;display:flex;align-items:center;gap:8px';
      ce(acSug, 'span', '', `Unarmored baseline: 10 + DEX mod (${dexMod >= 0 ? '+' : ''}${dexMod}) = ${10 + dexMod}`);
      btn(acSug, 'Apply', 'te-btn is-sm', () => { this.values.ac = 10 + dexMod; this.onOpen(); });
    }
    addField(s3, 'Speed', this.values.speed, v => this.values.speed = v);
    addNumber(s3, 'Experience Points (XP)', this.values.xp || 0, v => this.values.xp = v);

    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'Proficiencies & Features' });
    chipField(s4, 'Skills', this.values.skills, v => this.values.skills = v, { suggestions: ['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation','Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival'] });
    { const sel = s4.lastElementChild && s4.lastElementChild.querySelector('select'); if (sel) this.plugin.refData.get('skills').then(skills => { const ex = new Set(['Acrobatics','Animal Handling','Arcana','Athletics','Deception','History','Insight','Intimidation','Investigation','Medicine','Nature','Perception','Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival']); [...new Set(skills.map(s => s.name).filter(Boolean))].filter(n => !ex.has(n)).forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); }); }).catch(()=>{}); }
    chipField(s4, 'Languages', safeArr(this.values.languages), v => this.values.languages = v, { suggestions: ['Common','Dwarvish','Elvish','Gnomish','Halfling','Orc','Draconic','Infernal','Celestial','Sylvan','Undercommon','Abyssal','Primordial','Deep Speech','Giant','Goblin','Thieves\' Cant'] });
    { const sel = s4.lastElementChild && s4.lastElementChild.querySelector('select'); if (sel) this.plugin.refData.get('languages').then(langs => { const ex = new Set(['Common','Dwarvish','Elvish','Gnomish','Halfling','Orc','Draconic','Infernal','Celestial','Sylvan','Undercommon','Abyssal','Primordial','Deep Speech','Giant','Goblin','Thieves\' Cant']); [...new Set(langs.map(l => l.name).filter(Boolean))].filter(n => !ex.has(n)).forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); }); }).catch(()=>{}); }
    chipField(s4, 'Saving Throw Proficiencies', this.values.savingThrows, v => this.values.savingThrows = v, { suggestions: ['STR','DEX','CON','INT','WIS','CHA'] });
    chipField(s4, 'Features & Traits', this.values.features, v => this.values.features = v);

    // Spell section (shown for any character — casters fill it in)
    const sCast = ce(contentEl, 'div', 'te-modal-section');
    sCast.createEl('h3', { text: 'Spells' });
    ce(sCast, 'p', 'te-card-body', 'Track your known or prepared spells. Browse by class with the picker.');
    const spellDisplay = ce(sCast, 'div', '');
    spellDisplay.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;min-height:28px;padding:4px;background:var(--te-bg-alt);border-radius:var(--te-r-md)';
    const spellsRef = { val: safeArr(this.values.knownSpells) };
    const rebuildSpellDisplay = () => {
      clear(spellDisplay);
      if (!spellsRef.val.length) { ce(spellDisplay, 'span', 'te-empty-state', 'No spells added yet.'); return; }
      spellsRef.val.forEach((sp, i) => {
        const chip = ce(spellDisplay, 'span', 'te-chip');
        chip.textContent = typeof sp === 'string' ? sp : (sp.name || 'Spell');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--te-accent-light,rgba(109,99,255,.15));border-radius:12px;font-size:.82rem;cursor:pointer';
        const rm = ce(chip, 'span', '', '×'); rm.style.cursor = 'pointer';
        rm.addEventListener('click', () => { spellsRef.val.splice(i, 1); this.values.knownSpells = spellsRef.val; rebuildSpellDisplay(); });
      });
    };
    rebuildSpellDisplay();
    const spellActRow = ce(sCast, 'div', 'te-card-actions');
    btn(spellActRow, '📖 Browse Spells', 'te-btn is-sm', async () => {
      const allSpells = await this.plugin.refData.get('spells');
      const cls = this.values.class || '';
      const filtered = cls ? allSpells.filter(s => !s.classes || !s.classes.length || String(s.classes||'').toLowerCase().includes(cls.toLowerCase())) : allSpells;
      new RefDataPickerModal(this.plugin.app, filtered.length ? filtered : allSpells, 'Spell', spell => {
        const name = spell.name || 'Spell';
        if (!spellsRef.val.includes(name)) { spellsRef.val.push(name); this.values.knownSpells = spellsRef.val; rebuildSpellDisplay(); }
      }).open();
    });

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
    currRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px';
    ['pp','gp','ep','sp','cp'].forEach(coin => {
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
      const prevLevel = parseInt(this.item.level) || 1;
      const newLevel  = parseInt(this.values.level) || 1;
      upsert(this.plugin.state, 'characters', this.values);
      await this.plugin.saveState();
      new Notice(`Character "${this.values.name}" saved.`);
      if (newLevel > prevLevel) new LevelUpModal(this.app, this.plugin, this.values, prevLevel, newLevel).open();
      this.close();
    }, 'Save Character');
  }
}

// ── HybridAncestryModal (Phase 257) ──────────────────────────────────────────
class HybridAncestryModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('hybrid'), name: '', dominantAncestry: '', recessiveAncestry: '', thirdInfluence: '',
      campaignId: '',
      visibility: 'dm-only', status: 'Draft', approvalStatus: 'Pending Review',
      size: 'Medium', speed: 30, ageNotes: '', creatureType: 'Humanoid',
      languages: [], darkvision: 'None',
      asiMethod: 'Flexible (+2/+1 or +1/+1/+1)', asi: {}, asiOverride: false,
      traits: [], traitBudget: 6,
      appearance: '', dominantCulture: '', recessiveCulture: '', raisedCulture: '', namingConventions: '',
      playerNotes: '', summary: '',
      dmNotes: '', balanceNotes: '', balanceRating: '', balanceScore: 0, warnings: [],
      linkedNotePath: '', syncStatus: 'Local',
      createdAt: new Date().toISOString(), updatedAt: '', archived: false,
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Hybrid Ancestry` });

    // Section 1: Identity
    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Identity' });
    addField(s1, 'Ancestry Name *', this.values.name, v => this.values.name = v);
    const hybridNames = safeArr(this.plugin.state.entities.hybridAncestries)
      .filter(h => h.id !== this.values.id).map(h => h.name);
    const allAncOptions = [...ANCESTRIES, ...hybridNames];
    const makeAncDl = (suffix, val, setter) => {
      new Setting(s1).setName(suffix).addText(t => {
        const dl = s1.createEl('datalist'); dl.id = `hybrid-${this.values.id}-${suffix.toLowerCase().replace(/\s+/g,'-')}`;
        allAncOptions.forEach(a => { const o = dl.createEl('option'); o.value = a; });
        t.inputEl.setAttribute('list', dl.id);
        t.setValue(val || '');
        t.onChange(setter);
        this.plugin.refData.get('races').then(races => {
          const refNames = [...new Set(races.map(r => r.name).filter(Boolean))];
          const existing = new Set(allAncOptions);
          refNames.filter(n => !existing.has(n)).forEach(n => { const o = dl.createEl('option'); o.value = n; });
        }).catch(() => {});
      });
    };
    makeAncDl('Dominant Ancestry', this.values.dominantAncestry, v => this.values.dominantAncestry = v);
    makeAncDl('Recessive Ancestry', this.values.recessiveAncestry, v => this.values.recessiveAncestry = v);
    makeAncDl('Third Influence (optional)', this.values.thirdInfluence, v => this.values.thirdInfluence = v);
    addSelect(s1, 'Visibility', this.values.visibility, ['dm-only','player-visible'], v => this.values.visibility = v);
    addSelect(s1, 'Status', this.values.status, ['Draft','Active','Deprecated','Archived'], v => this.values.status = v);
    addSelect(s1, 'Approval Status', this.values.approvalStatus, ['Pending Review','DM Approved','Player Approved','Rejected'], v => this.values.approvalStatus = v);

    // Section 2: Parent Ancestry Reference
    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Parent Ancestry Reference' });
    const refGrid = ce(s2, 'div', '');
    refGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px';
    ['dominant','recessive'].forEach(role => {
      const key = role === 'dominant' ? this.values.dominantAncestry : this.values.recessiveAncestry;
      const data = key ? ANCESTRY_DATA[key] : null;
      const cell = ce(refGrid, 'div', 'te-card'); cell.style.cssText = 'padding:10px;font-size:.85rem';
      ce(cell, 'strong', '', `${role.charAt(0).toUpperCase()+role.slice(1)}: ${key || '—'}`);
      if (data) {
        ce(cell, 'p', 'te-progress-label', `Size: ${data.size} • Speed: ${data.speed} ft • DV: ${data.darkvision ? data.darkvision+' ft' : 'None'}`);
        if (data.resistance && data.resistance.length) ce(cell, 'p', 'te-progress-label', `Resistance: ${data.resistance.join(', ')}`);
        if (data.traits && data.traits.length) ce(cell, 'p', 'te-progress-label', `Traits: ${data.traits.join(', ')}`);
      } else {
        ce(cell, 'p', 'te-progress-label', 'Enter an ancestry name above to see reference data.');
      }
    });
    ce(s2, 'p', 'te-progress-label', 'Reference only. Actual mechanics are set in the sections below.');

    // Section 3: Core Basics
    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Core Basics' });
    addSelect(s3, 'Size', this.values.size, SIZES, v => this.values.size = v);
    addNumber(s3, 'Speed (ft)', this.values.speed || 30, v => this.values.speed = v);
    addSelect(s3, 'Creature Type', this.values.creatureType, CREATURE_TYPES, v => this.values.creatureType = v);
    addSelect(s3, 'Darkvision', this.values.darkvision || 'None', ['None','30 ft','60 ft','90 ft','120 ft'], v => this.values.darkvision = v);
    chipField(s3, 'Languages', safeArr(this.values.languages), v => this.values.languages = v, { suggestions: ['Common','Dwarvish','Elvish','Gnomish','Halfling','Orc','Draconic','Infernal','Celestial','Sylvan','Undercommon','Abyssal','Primordial'] });
    addField(s3, 'Age & Lifespan Notes', this.values.ageNotes, v => this.values.ageNotes = v);

    // Section 4: Ability Score Improvements
    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'Ability Score Improvements' });
    addSelect(s4, 'ASI Method', this.values.asiMethod, ['Flexible (+2/+1 or +1/+1/+1)','Standard (+2/+1)','Manual','Lineage Match'], v => this.values.asiMethod = v);
    ce(s4, 'p', 'te-progress-label', 'Assign ASI bonuses below. Total should not exceed +3 without DM override (toggle below).');
    const asiGrid = ce(s4, 'div', '');
    asiGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px';
    if (!this.values.asi) this.values.asi = {};
    const asiVals = this.values.asi;
    const asiTotalEl = ce(s4, 'p', 'te-progress-label', '');
    // refreshBalance defined below s5; late-bind via closure so ASI inputs can call it
    let refreshBalance = () => {};
    const updateAsiTotal = () => {
      const total = Object.values(asiVals).reduce((s, v) => s + (parseInt(v) || 0), 0);
      asiTotalEl.textContent = `Current ASI total: +${total}${total > 3 ? ' ⚠️ Exceeds +3' : ' ✓'}`;
      refreshBalance();
    };
    ['str','dex','con','int','wis','cha'].forEach(ab => {
      const w = ce(asiGrid, 'div', '');
      new Setting(w).setName(ab.toUpperCase()).addText(t => {
        t.inputEl.type = 'number'; t.inputEl.min = '0'; t.inputEl.max = '4';
        t.setValue(String(asiVals[ab] || 0));
        t.onChange(v => { asiVals[ab] = parseInt(v) || 0; updateAsiTotal(); });
      });
    });
    // Insert asiTotalEl after the grid (was created before grid to be appended after)
    s4.appendChild(asiTotalEl);
    updateAsiTotal();
    new Setting(s4).setName('DM Override — allow ASI > +3').addToggle(t => {
      t.setValue(this.values.asiOverride || false);
      t.onChange(v => { this.values.asiOverride = v; refreshBalance(); });
    });

    // Section 5: Traits (with live balance refresh)
    const s5 = ce(contentEl, 'div', 'te-modal-section');
    s5.createEl('h3', { text: 'Traits' });
    const bmWrap = ce(s5, 'div', 'te-balance-row'); bmWrap.style.marginBottom = '8px';
    const bmBar = ce(bmWrap, 'div', 'te-balance-meter');
    const bmFill = ce(bmBar, 'div', 'te-balance-fill');
    const bmLabel = ce(bmWrap, 'span', 'te-balance-label', '');
    const wBox = ce(s5, 'div', 'te-hybrid-warning-box'); wBox.style.display = 'none';
    refreshBalance = () => {
      const b = computeHybridBalance(this.values);
      const pct = Math.min(100, Math.round((b.score / 10) * 100));
      bmFill.style.width = pct + '%';
      bmFill.className = 'te-balance-fill ' + ({ Underpowered:'is-weak', Balanced:'is-balanced', Strong:'is-strong', Overpowered:'is-over' }[b.rating] || '');
      bmLabel.textContent = `Balance: ${b.rating} (${b.score}/10)`;
      clear(wBox);
      if (b.warnings.length) {
        wBox.style.display = '';
        b.warnings.forEach(w => { const d = ce(wBox, 'div', 'te-hybrid-warning-item'); d.textContent = `⚠️ ${w}`; });
      } else { wBox.style.display = 'none'; }
    };
    refreshBalance();
    ce(s5, 'p', 'te-progress-label', 'Tier 0 = cosmetic (0 pts) • Tier 1 = minor (1 pt) • Tier 2 = medium (2 pts) • Tier 3 = strong (3 pts). Balanced: 4–6 pts total.');
    const tierNames = ['Tier 0 — Cosmetic / Flavour','Tier 1 — Minor','Tier 2 — Medium','Tier 3 — Strong'];
    [0,1,2,3].forEach(tier => {
      const tierTraits = HYBRID_TRAIT_LIBRARY.filter(t => t.tier === tier);
      if (!tierTraits.length) return;
      ce(s5, 'div', 'te-quest-status-head', tierNames[tier]);
      const tGrid = ce(s5, 'div', 'te-trait-grid');
      tierTraits.forEach(trait => {
        const isOn = safeArr(this.values.traits).includes(trait.id);
        const card = ce(tGrid, 'div', 'te-trait-chip' + (isOn ? ' is-active te-selected' : ''));
        card.setAttribute('role', 'checkbox');
        card.setAttribute('aria-checked', String(isOn));
        card.setAttribute('tabindex', '0');
        card.style.cursor = 'pointer';
        if (isOn) { card.style.outline = '2px solid var(--interactive-accent)'; card.style.background = 'var(--background-modifier-active-hover)'; }
        const nameRow = ce(card, 'div', ''); nameRow.style.cssText = 'font-size:.84rem;font-weight:600';
        nameRow.textContent = trait.name;
        const tierBadge = ce(nameRow, 'span', 'te-muted-text'); tierBadge.textContent = ` (+${tier})`;
        ce(card, 'p', 'te-trait-desc', trait.desc);
        const toggle = () => {
          const active = card.getAttribute('aria-checked') === 'true';
          const next = !active;
          card.setAttribute('aria-checked', String(next));
          card.classList.toggle('is-active', next);
          card.classList.toggle('te-selected', next);
          card.style.outline = next ? '2px solid var(--interactive-accent)' : '';
          card.style.background = next ? 'var(--background-modifier-active-hover)' : '';
          const cur = safeArr(this.values.traits);
          this.values.traits = next ? (cur.includes(trait.id) ? cur : [...cur, trait.id]) : cur.filter(id => id !== trait.id);
          refreshBalance();
        };
        card.addEventListener('click', toggle);
        card.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
      });
    });

    // Section 6: Culture & Appearance
    const s6 = ce(contentEl, 'div', 'te-modal-section');
    s6.createEl('h3', { text: 'Culture & Appearance' });
    addField(s6, 'Appearance', this.values.appearance, v => this.values.appearance = v, 'textarea');
    addEntityPicker(s6, 'Dominant Culture', this.values.dominantCultureId || '', this.plugin, 'cultures', v => this.values.dominantCultureId = v);
    addEntityPicker(s6, 'Recessive Culture', this.values.recessiveCultureId || '', this.plugin, 'cultures', v => this.values.recessiveCultureId = v);
    addEntityPicker(s6, 'Raised In', this.values.raisedInId || '', this.plugin, 'cultures', v => this.values.raisedInId = v);
    addField(s6, 'Naming Conventions', this.values.namingConventions, v => this.values.namingConventions = v, 'textarea');

    // Section 7: Player Notes
    const s7 = ce(contentEl, 'div', 'te-modal-section');
    s7.createEl('h3', { text: 'Player Notes' });
    addField(s7, 'Summary / Lore Blurb (player-visible)', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(s7, 'Player Notes', this.values.playerNotes, v => this.values.playerNotes = v, 'textarea');

    // Section 8: DM Notes
    const s8 = ce(contentEl, 'div', 'te-modal-section');
    s8.createEl('h3', { text: 'DM Notes' });
    addField(s8, 'DM Notes (hidden from players)', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    addField(s8, 'Balance Notes', this.values.balanceNotes, v => this.values.balanceNotes = v, 'textarea');

    // Action row
    const actRow = ce(contentEl, 'div', 'te-card-actions');
    actRow.style.cssText = 'flex-wrap:wrap;gap:6px;margin:12px 0';
    btn(actRow, 'Use for New PC', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Enter an ancestry name first.'); return; }
      const b = computeHybridBalance(this.values);
      this.values.balanceRating = b.rating; this.values.balanceScore = b.score; this.values.warnings = b.warnings;
      this.values.updatedAt = new Date().toISOString();
      if (!this.values.createdAt) this.values.createdAt = new Date().toISOString();
      upsert(this.plugin.state, 'hybridAncestries', this.values);
      await this.plugin.saveState();
      new CharacterModal(this.plugin.app, this.plugin, { race: this.values.name, hybridAncestryId: this.values.id }).open();
    });
    btn(actRow, 'Use for New NPC', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Enter an ancestry name first.'); return; }
      const b = computeHybridBalance(this.values);
      this.values.balanceRating = b.rating; this.values.balanceScore = b.score; this.values.warnings = b.warnings;
      this.values.updatedAt = new Date().toISOString();
      if (!this.values.createdAt) this.values.createdAt = new Date().toISOString();
      upsert(this.plugin.state, 'hybridAncestries', this.values);
      await this.plugin.saveState();
      new NPCModal(this.plugin.app, this.plugin, { race: this.values.name, hybridAncestryId: this.values.id }).open();
    });
    btn(actRow, 'Save as Homebrew', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Name required first.'); return; }
      const existingHb = safeArr(this.plugin.state.entities.homebrew).find(h => h.sourceHybridId === this.values.id || h.name === this.values.name);
      const hb = normalizeHomebrewRecord(existingHb
        ? {
          ...existingHb,
          homebrewType: 'Ancestry',
          type: 'Hybrid Ancestry',
          category: 'Character Options',
          payload: { kind: 'Ancestry', ...HOMEBREW_BUILDERS.Ancestry.toPayload(hybridAncestryToBuilderValues(this.values)) },
          content: this._toMarkdown(),
          summary: this.values.summary || existingHb.summary || '',
          balanceNotes: this.values.balanceRating ? `${this.values.balanceRating} (${this.values.balanceScore || 0})` : (existingHb.balanceNotes || ''),
          updatedAt: new Date().toISOString(),
          visibility: this.values.visibility,
        }
        : {
          id: uid('homebrew'),
          sourceHybridId: this.values.id,
          sourceEntityType: 'hybridAncestries',
          sourceEntityId: this.values.id,
          promotedFromEntityType: 'hybridAncestries',
          promotedFromEntityId: this.values.id,
          homebrewId: '',
          name: this.values.name,
          homebrewType: 'Ancestry',
          type: 'Hybrid Ancestry',
          category: 'Character Options',
          payload: { kind: 'Ancestry', ...HOMEBREW_BUILDERS.Ancestry.toPayload(hybridAncestryToBuilderValues(this.values)) },
          content: this._toMarkdown(),
          summary: this.values.summary || '',
          tags: ['hybrid', 'ancestry'],
          balanceNotes: this.values.balanceRating ? `${this.values.balanceRating} (${this.values.balanceScore || 0})` : '',
          visibility: this.values.visibility,
          sourceCampaignId: this.plugin.state.activeCampaignId || '',
          campaignId: this.plugin.state.activeCampaignId || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      upsert(this.plugin.state, 'homebrew', hb);
      await this.plugin.saveState();
      new Notice(existingHb ? `Homebrew "${hb.name}" updated.` : `Homebrew entry "${hb.name}" created.`);
    });
    btn(actRow, 'Save as Compendium', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Name required first.'); return; }
      const existingComp = safeArr(this.plugin.state.entities.compendium).find(e => e.sourceHybridId === this.values.id || e.name === this.values.name);
      const entry = existingComp
        ? { ...existingComp, content: this._toMarkdown(), updatedAt: new Date().toISOString() }
        : { id: uid('comp'), sourceHybridId: this.values.id, name: this.values.name, category: 'Ancestry', content: this._toMarkdown(), tags: ['hybrid'], visibility: 'player-visible', createdAt: new Date().toISOString() };
      upsert(this.plugin.state, 'compendium', entry);
      await this.plugin.saveState();
      new Notice(existingComp ? `Compendium "${entry.name}" updated.` : `Compendium entry "${entry.name}" created.`);
    });
    btn(actRow, 'Export Player-Safe Note', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Save the hybrid first.'); return; }
      const folder = campaignFolder(this.plugin);
      const hybridDir = `${folder}/Cast & Powers/Hybrid Ancestries`;
      await ensureFolder(this.plugin.app, hybridDir);
      const fname = safeFileName(this.values.name, 'Hybrid Ancestry');
      const notePath = normalizePath(`${hybridDir}/${fname}.md`);
      await writeNote(this.plugin.app, notePath, this._toMarkdown(true));
      this.values.linkedNotePath = notePath;
      this.values.syncStatus = 'Exported';
      this.values.lastExportedAt = new Date().toISOString();
      upsert(this.plugin.state, 'hybridAncestries', this.values);
      await this.plugin.saveState();
      new Notice(`Player-safe note exported to ${notePath}`);
    });

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Ancestry name is required.'); return; }
      const b = computeHybridBalance(this.values);
      this.values.balanceRating = b.rating;
      this.values.balanceScore = b.score;
      this.values.warnings = b.warnings;
      this.values.updatedAt = new Date().toISOString();
      if (!this.values.createdAt) this.values.createdAt = new Date().toISOString();
      upsert(this.plugin.state, 'hybridAncestries', this.values);
      await this.plugin.saveState();
      new Notice(`Hybrid ancestry "${this.values.name}" saved.`);
      this.close();
    }, 'Save Hybrid');
  }
  _toMarkdown(playerSafe) {
    const v = this.values;
    const traitObjs = safeArr(v.traits).map(id => HYBRID_TRAIT_LIBRARY.find(t => t.id === id)).filter(Boolean);
    let md = `# ${v.name || 'Hybrid Ancestry'}\n\n`;
    md += `**Parents:** ${[v.dominantAncestry, v.recessiveAncestry].filter(Boolean).join(' × ')}`;
    if (v.thirdInfluence) md += ` (with ${v.thirdInfluence} influence)`;
    md += `\n\n**Size:** ${v.size} | **Speed:** ${v.speed} ft | **Type:** ${v.creatureType} | **Darkvision:** ${v.darkvision || 'None'}\n\n`;
    const asiEntries = Object.entries(v.asi || {}).filter(([, val]) => parseInt(val) > 0);
    if (asiEntries.length) md += `**ASI:** ${asiEntries.map(([k, val]) => `+${val} ${k.toUpperCase()}`).join(', ')}\n\n`;
    if (safeArr(v.languages).length) md += `**Languages:** ${v.languages.join(', ')}\n\n`;
    if (traitObjs.length) { md += `## Traits\n\n`; traitObjs.forEach(t => { md += `### ${t.name} *(Tier ${t.tier})*\n${t.desc}\n\n`; }); }
    if (v.appearance) md += `## Appearance\n${v.appearance}\n\n`;
    if (v.summary) md += `## Lore\n${v.summary}\n\n`;
    if (v.playerNotes) md += `## Player Notes\n${v.playerNotes}\n\n`;
    if (!playerSafe && v.dmNotes) md += `## DM Notes\n${v.dmNotes}\n\n`;
    if (!playerSafe && v.balanceNotes) md += `## Balance Notes\n${v.balanceNotes}\n\n`;
    if (!playerSafe) md += `## Balance Rating\n**${v.balanceRating}** (score: ${v.balanceScore}/10)\n\n`;
    return md;
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

// ── CampaignWizardModal (Phase 6) — 12-step campaign creation wizard ──────────
class CampaignWizardModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 0;
    this.data = {
      id: uid('campaign'), name: '', tagline: '', premise: '', status: 'Active',
      tone: [], genres: [], themes: [], format: '', ruleset: 'D&D 5e', levelRange: '1-20',
      levellingMethod: 'Milestone', restRules: 'Standard (Short/Long)', deathRules: 'Standard Death Saves',
      magicItemAvailability: 'Common', treasureStyle: 'Mixed', safetyTools: [], sessionZeroTopics: [],
      playerCount: 4, partyNotes: '', worldName: '', worldPremise: '', worldScale: '',
      structureNotes: '', campaignLoops: [], factionNames: [], milestoneNames: [], secretSummary: '', playerPrimer: '',
      createFolders: true, startingNote: true,
      bible: { premise: '', tone: '', genre: '', scope: '', themes: [], acts: [], playerPrimer: '', notes: '' },
      createdAt: new Date().toISOString(),
    };
  }

  get stepDefs() {
    return [
      { title: '1. Campaign Identity',     key: 'identity' },
      { title: '2. Concept & Premise',     key: 'concept' },
      { title: '3. Tone, Genre & Themes',  key: 'tone' },
      { title: '4. Rules Baseline',        key: 'rules' },
      { title: '5. Player & Party Setup',  key: 'party' },
      { title: '6. World Assumptions',     key: 'world' },
      { title: '7. Structure & Scope',     key: 'structure' },
      { title: '8. Progression & Milestones', key: 'progression' },
      { title: '9. Factions & Conflict',   key: 'factions' },
      { title: '10. Secrets & Primer',     key: 'secrets' },
      { title: '11. Folder / Note Output', key: 'output' },
      { title: '12. Review & Create',      key: 'review' },
    ];
  }

  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText('Campaign Creation Wizard');
    // Step indicator
    const steps = ce(contentEl, 'div', 'te-wizard-steps');
    this.stepDefs.forEach((s, i) => {
      const cls = i < this.step ? 'te-wizard-step is-done' : i === this.step ? 'te-wizard-step is-active' : 'te-wizard-step';
      ce(steps, 'span', cls, String(i + 1));
    });
    const def = this.stepDefs[this.step];
    const sec = ce(contentEl, 'div', 'te-modal-section');
    sec.createEl('h3', { text: def.title });
    this[`renderStep_${def.key}`](sec);
    // Navigation
    const nav = ce(contentEl, 'div', 'te-modal-buttons');
    if (this.step > 0) btn(nav, '← Back', 'te-btn', () => { this.step--; this.onOpen(); });
    if (this.step < this.stepDefs.length - 1) {
      btn(nav, 'Next →', 'te-btn is-primary', () => {
        if (this.step === 0 && !this.data.name.trim()) { new Notice('Campaign name is required.'); return; }
        this.step++; this.onOpen();
      });
    } else {
      btn(nav, '🎉 Create Campaign', 'te-btn is-primary', async () => this.createCampaign());
    }
    btn(nav, 'Cancel', 'te-btn', () => this.close());
  }

  renderStep_identity(el) {
    addField(el, 'Campaign Name *', this.data.name, v => this.data.name = v);
    addField(el, 'Tagline / One-liner', this.data.tagline, v => this.data.tagline = v);
    addField(el, 'Format', this.data.format, v => this.data.format = v);
    addSelect(el, 'Campaign Format', this.data.format, OPTION_BANKS.formats, v => this.data.format = v);
  }
  renderStep_concept(el) {
    addField(el, 'Campaign Premise (2-3 sentences)', this.data.premise, v => this.data.premise = v, 'textarea');
  }
  renderStep_tone(el) {
    chipField(el, 'Tone(s)', this.data.tone, v => this.data.tone = v, { bank: 'tones' });
    chipField(el, 'Genre(s)', this.data.genres, v => this.data.genres = v, { bank: 'genres' });
    chipField(el, 'Themes', this.data.themes, v => this.data.themes = v, { bank: 'themes' });
  }
  renderStep_rules(el) {
    addSelect(el, 'Ruleset', this.data.ruleset, OPTION_BANKS.rulesets, v => this.data.ruleset = v);
    addField(el, 'Level Range (e.g. 1-10)', this.data.levelRange, v => this.data.levelRange = v);
    addSelect(el, 'Levelling Method', this.data.levellingMethod, OPTION_BANKS.levellingMethods, v => this.data.levellingMethod = v);
    addSelect(el, 'Rest Rules', this.data.restRules, OPTION_BANKS.restRules, v => this.data.restRules = v);
    addSelect(el, 'Death Rules', this.data.deathRules, OPTION_BANKS.deathRules, v => this.data.deathRules = v);
    addSelect(el, 'Magic Item Availability', this.data.magicItemAvailability, OPTION_BANKS.magicItemAvailability, v => this.data.magicItemAvailability = v);
    chipField(el, 'Safety Tools', this.data.safetyTools, v => this.data.safetyTools = v, { bank: 'safetyTools' });
  }
  renderStep_party(el) {
    addNumber(el, 'Player Count', this.data.playerCount, v => this.data.playerCount = v);
    chipField(el, 'Session Zero Topics', this.data.sessionZeroTopics, v => this.data.sessionZeroTopics = v, { bank: 'sessionZeroTopics' });
    addField(el, 'Party Notes', this.data.partyNotes, v => this.data.partyNotes = v, 'textarea');
  }
  renderStep_world(el) {
    addField(el, 'World Name', this.data.worldName, v => this.data.worldName = v);
    addField(el, 'World Premise', this.data.worldPremise, v => this.data.worldPremise = v, 'textarea');
    addSelect(el, 'World Scale', this.data.worldScale, OPTION_BANKS.worldScales, v => this.data.worldScale = v);
  }
  renderStep_structure(el) {
    addField(el, 'Structure Notes (acts, arcs, chapters)', this.data.structureNotes, v => this.data.structureNotes = v, 'textarea');
    chipField(el, 'Core Campaign Loops', this.data.campaignLoops, v => this.data.campaignLoops = v, { bank: 'campaignLoops' });
  }
  renderStep_progression(el) {
    chipField(el, 'Milestones (add key milestones, e.g. "Level 5 after Act 1")', this.data.milestoneNames || [], v => this.data.milestoneNames = v, { placeholder: 'Milestone name…' });
    addField(el, 'Milestone Notes', this.data.bible.notes, v => this.data.bible.notes = v, 'textarea');
  }
  renderStep_factions(el) {
    chipField(el, 'Major Factions (add names)', this.data.factionNames, v => this.data.factionNames = v, { placeholder: 'Faction name…' });
  }
  renderStep_secrets(el) {
    addField(el, 'DM Secret Summary (will be stored as a secret)', this.data.secretSummary, v => this.data.secretSummary = v, 'textarea');
    addField(el, 'Player Primer (player-safe intro)', this.data.playerPrimer, v => this.data.playerPrimer = v, 'textarea');
  }
  renderStep_output(el) {
    addToggle(el, 'Create campaign folder structure in vault', this.data.createFolders, v => this.data.createFolders = v);
    addToggle(el, 'Create starter campaign note', this.data.startingNote, v => this.data.startingNote = v);
  }
  renderStep_review(el) {
    const d = this.data;
    const rows = [
      ['Name', d.name], ['Tagline', d.tagline], ['Format', d.format], ['Ruleset', d.ruleset],
      ['Level Range', d.levelRange], ['Levelling', d.levellingMethod], ['Rests', d.restRules],
      ['Players', String(d.playerCount)], ['World', d.worldName], ['Magic Items', d.magicItemAvailability],
      ['Tones', d.tone.join(', ')], ['Genres', d.genres.join(', ')], ['Themes', d.themes.join(', ')],
      ['Factions', d.factionNames.join(', ')], ['Safety Tools', d.safetyTools.join(', ')],
    ];
    rows.forEach(([k, v]) => { if (!v) return; const r = ce(el, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v); });
  }

  async createCampaign() {
    const d = this.data;
    d.summary = d.premise || d.tagline || '';
    d.bible = { premise: d.premise, tone: d.tone.join(', '), genre: d.genres.join(', '), scope: d.worldScale, themes: d.themes, playerPrimer: d.playerPrimer, acts: [], notes: d.bible.notes };
    upsert(this.plugin.state, 'campaigns', d);
    this.plugin.state.activeCampaignId = d.id;

    // Create world if named
    if (d.worldName) {
      const world = { id: uid('world'), name: d.worldName, summary: d.worldPremise || '', scale: d.worldScale, campaignId: d.id };
      upsert(this.plugin.state, 'worlds', world);
    }
    // Create factions
    d.factionNames.forEach(name => {
      upsert(this.plugin.state, 'factions', { id: uid('faction'), name, summary: '', campaignId: d.id });
    });
    // Create milestones — only add those not already present (avoid duplicates on repeated save)
    const existingMilestoneNames = new Set(
      safeArr(this.plugin.state.entities.milestones)
        .filter(m => m.campaignId === d.id)
        .map(m => m.name)
    );
    const now = new Date().toISOString();
    safeArr(d.milestoneNames).forEach((name, i) => {
      if (!name || existingMilestoneNames.has(name)) return;
      upsert(this.plugin.state, 'milestones', {
        id: uid('milestone'),
        campaignId: d.id,
        name,
        level: '',
        summary: '',
        order: i,
        status: 'Pending',
        visibility: 'dm-only',
        tags: [],
        createdAt: now,
        updatedAt: now,
      });
    });
    // Create DM secret
    if (d.secretSummary) {
      upsert(this.plugin.state, 'secrets', { id: uid('secret'), name: `Campaign Secret — ${d.name}`, summary: d.secretSummary, visibility: 'dm-only', campaignId: d.id });
    }
    // Create folder structure
    if (d.createFolders) {
      const base = campaignFolder(this.plugin);
      for (const ws of [
        'Campaign Command Centre/Campaign Overview',
        'Campaign Command Centre/Acts',
        'Campaign Command Centre/Milestones',
        'Campaign Command Centre/Exports',
        'World Atlas/Worlds', 'World Atlas/Regions', 'World Atlas/Domains', 'World Atlas/Settlements',
        'World Atlas/Locations', 'World Atlas/Dungeons', 'World Atlas/Maps',
        'Cast & Powers/NPCs', 'Cast & Powers/Factions',
        'Adventure Planner/Adventures', 'Adventure Planner/Quests', 'Adventure Planner/Encounters',
        'Sessions/Session Logs',
        'Secrets & Handouts/Secrets', 'Secrets & Handouts/Handouts',
        'Compendium/Homebrew', 'Compendium/Generated',
      ]) {
        await ensureFolder(this.plugin.app, `${base}/${ws}`);
      }
    }
    // Create starter note
    if (d.startingNote) {
      const base = campaignFolder(this.plugin);
      let md = `# ${d.name}\n\n> ${d.tagline || ''}\n\n## Premise\n\n${d.premise || ''}\n\n`;
      if (d.playerPrimer) md += `## Player Primer\n\n${d.playerPrimer}\n\n`;
      md += `## Rules Baseline\n\n- **Ruleset:** ${d.ruleset}\n- **Levels:** ${d.levelRange}\n- **Levelling:** ${d.levellingMethod}\n- **Rests:** ${d.restRules}\n`;
      await ensureFolder(this.plugin.app, `${base}/Campaign Command Centre`);
      await writeNote(this.plugin.app, normalizePath(`${base}/Campaign Command Centre/Campaign Overview.md`), md);
    }
    await this.plugin.saveState();
    new Notice(`Campaign "${d.name}" created!`, 5000);
    this.close();
    this.plugin.state.activeSection = 'campaigns';
    this.plugin.refreshViews();
  }
}

// ── CampaignBibleModal ────────────────────────────────────────────────────────
// Canonical textual bible fields only. Acts are entity-backed (see renderCampaignBible).
class CampaignBibleModal extends Modal {
  constructor(app, plugin, campaign) {
    super(app);
    this.plugin = plugin;
    this.camp = campaign;
    this.values = Object.assign({}, campaign || {});
    if (!this.values.bible) this.values.bible = { premise: '', tone: '', genre: '', scope: '', themes: [], acts: [], playerPrimer: '', notes: '' };
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText('Campaign Bible — Edit Textual Fields');
    if (!this.camp) { ce(contentEl, 'p', '', 'No active campaign. Create a campaign first.'); btn(contentEl, 'Close', 'te-btn', () => this.close()); return; }
    const b = this.values.bible;

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Core Premise' });
    addField(s1, 'Premise', b.premise, v => b.premise = v, 'textarea');
    addSelect(s1, 'Tone', b.tone, OPTION_BANKS.tones, v => b.tone = v);
    addSelect(s1, 'Genre', b.genre, OPTION_BANKS.genres, v => b.genre = v);
    addSelect(s1, 'World Scale', b.scope, OPTION_BANKS.worldScales, v => b.scope = v);
    chipField(s1, 'Themes', safeArr(b.themes), v => b.themes = v, { bank: 'themes' });

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Player Primer' });
    addField(s2, 'Player-safe intro for Session Zero / player packet', b.playerPrimer, v => b.playerPrimer = v, 'textarea');

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'DM Notes' });
    addField(s3, 'Internal DM notes', b.notes, v => b.notes = v, 'textarea');

    if (safeArr(b.acts).length) {
      const legacyNote = ce(contentEl, 'div', 'te-modal-section');
      legacyNote.createEl('h3', { text: 'Legacy Embedded Acts' });
      ce(legacyNote, 'p', 'te-card-body', `This campaign has ${b.acts.length} legacy embedded act(s). Use the "Promote to Entity" action in Campaign Bible to migrate them to entity-backed acts.`);
    }

    modalButtons(contentEl, this, async () => {
      this.values.bible = b;
      upsert(this.plugin.state, 'campaigns', this.values);
      await this.plugin.saveState();
      new Notice('Campaign Bible saved.');
      this.close();
    }, 'Save Bible');
  }
}

// ── DungeonModal (Phase 9) ────────────────────────────────────────────────────
class DungeonModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({
      id: uid('dungeon'), name: '', type: 'Ancient Ruins', summary: '', threatLevel: '',
      boss: '', bossRef: null, bossNpcId: '', bossCreatureId: '',
      rooms: [], linkedRoomIds: [],
      regionId: '', campaignId: '', visibility: 'dm-only', notes: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Dungeon' : 'New Dungeon / Keyed Location');

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Overview' });
    addField(s1, 'Dungeon Name *', this.values.name, v => this.values.name = v);
    addSelect(s1, 'Type', this.values.type, OPTION_BANKS.dungeonTypes, v => this.values.type = v);
    addField(s1, 'Summary', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(s1, 'Threat Level / CR Range', this.values.threatLevel, v => this.values.threatLevel = v);
    addEntityPicker(s1, 'Linked Region', this.values.regionId, this.plugin, 'regions', v => this.values.regionId = v);
    addSelect(s1, 'Visibility', this.values.visibility, ['dm-only','player-visible'], v => this.values.visibility = v);

    // Boss / Key Enemy — structured selector
    const bossSec = ce(contentEl, 'div', 'te-modal-section');
    bossSec.createEl('h3', { text: 'Boss / Key Enemy' });
    // Entity pickers for structured reference
    addEntityPicker(bossSec, 'Boss — NPC', this.values.bossNpcId || '', this.plugin, 'npcs', v => {
      this.values.bossNpcId = v;
      if (v) { const npc = safeArr(this.plugin.state.entities.npcs).find(n => n.id === v); this.values.bossRef = { sourceType: 'npc', id: v, name: npc ? npc.name : v, source: 'entity' }; }
    });
    addEntityPicker(bossSec, 'Boss — Creature', this.values.bossCreatureId || '', this.plugin, 'creatures', v => {
      this.values.bossCreatureId = v;
      if (v) { const cr = safeArr(this.plugin.state.entities.creatures).find(c => c.id === v); this.values.bossRef = { sourceType: 'creature', id: v, name: cr ? cr.name : v, source: 'entity' }; }
    });
    // Bestiary reference picker
    const bestiaryRow = ce(bossSec, 'div', 'te-card-actions');
    ce(bestiaryRow, 'span', 'te-muted-text', 'Boss — Bestiary: ');
    const bestiaryLabel = ce(bestiaryRow, 'span', '');
    bestiaryLabel.textContent = this.values.bossRef && this.values.bossRef.source === 'bestiary' ? this.values.bossRef.name : '(none)';
    btn(bestiaryRow, '🐉 Pick from Bestiary', 'te-btn is-sm', async () => {
      const bestiary = await this.plugin.refData.get('bestiary');
      new RefDataPickerModal(this.plugin.app, bestiary, 'Monster', monster => {
        this.values.bossRef = { sourceType: 'bestiary', id: monster.id || monster.name, name: monster.name, source: 'bestiary' };
        bestiaryLabel.textContent = monster.name;
        if (!this.values.boss) this.values.boss = monster.name;
      }).open();
    });
    // Show resolved boss reference
    if (this.values.bossRef) {
      const refRow = ce(bossSec, 'div', ''); refRow.style.cssText = 'font-size:.82rem;color:var(--te-muted);margin-top:4px';
      refRow.textContent = `Structured ref: ${this.values.bossRef.sourceType} — ${this.values.bossRef.name} (${this.values.bossRef.source})`;
    }

    // Rooms & Keyed Areas
    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Rooms & Keyed Areas' });

    // Link existing Room entities
    addEntityMultiPicker(s2, 'Linked Room Entities', safeArr(this.values.linkedRoomIds), this.plugin, 'rooms', v => this.values.linkedRoomIds = v);

    // Quick-create a new Room entity pre-linked to this dungeon
    btn(s2, '+ Create New Room (linked)', 'te-btn is-sm', () => {
      const dungeonId = this.values.id;
      const newRoom = { id: uid('room'), name: '', type: 'Chamber', description: '', dungeonId, locationType: 'dungeons', locationId: dungeonId, campaignId: this.values.campaignId || '', visibility: this.values.visibility || 'dm-only' };
      new GenericModal(this.plugin.app, this.plugin, 'rooms', newRoom, roomFields).open();
    });

    // Legacy inline rooms (preserved for backwards compat display)
    const rooms = Array.isArray(this.values.rooms) ? this.values.rooms : [];
    if (rooms.length) {
      const legacyHead = ce(s2, 'div', ''); legacyHead.style.cssText = 'font-size:.82rem;color:var(--te-muted);margin:8px 0 4px';
      legacyHead.textContent = 'Legacy inline rooms:';
      const roomList = ce(s2, 'div', '');
      const renderRooms = () => {
        clear(roomList);
        rooms.forEach((room, i) => {
          const row = ce(roomList, 'div', ''); row.style.cssText = 'border:1px solid var(--te-border);border-radius:var(--te-r-sm);padding:10px;margin-bottom:8px';
          addField(row, `Room ${i + 1} — Name`, room.name || '', v => room.name = v);
          addSelect(row, 'Type', room.type || 'Chamber', OPTION_BANKS.roomTypes, v => room.type = v);
          addField(row, 'Description', room.description || '', v => room.description = v, 'textarea');
          addField(row, 'Enemies / Hazards', room.enemies || '', v => room.enemies = v);
          addField(row, 'Treasure', room.treasure || '', v => room.treasure = v);
          btn(row, '× Remove', 'te-btn is-sm is-danger', () => { rooms.splice(i, 1); renderRooms(); });
        });
      };
      renderRooms();
      btn(s2, '+ Add Inline Room', 'te-btn is-sm', () => { rooms.push({ name: '', type: 'Chamber', description: '', enemies: '', treasure: '' }); this.values.rooms = rooms; renderRooms(); });
    } else {
      btn(s2, '+ Add Inline Room', 'te-btn is-sm', () => { rooms.push({ name: '', type: 'Chamber', description: '', enemies: '', treasure: '' }); this.values.rooms = rooms; this.onOpen(); });
    }

    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Dungeon name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      this.values.rooms = rooms;
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      upsert(this.plugin.state, 'dungeons', this.values);
      await this.plugin.saveState();
      new Notice(`Dungeon "${this.values.name}" saved.`);
      this.close();
    }, 'Save Dungeon');
  }
}

// ── TimerModal (Phase 11) ─────────────────────────────────────────────────────
class TimerModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({ id: uid('timer'), name: '', summary: '', faction: '', factionId: '', questId: '', bbegId: '', warFrontId: '', incursionId: '', sessionId: '', locationType: 'locations', locationId: '', threatLabel: '', status: 'Active', maxTicks: 6, currentTick: 0, consequence: '', escalationSteps: [], notes: '' }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Escalation Timer' : 'New Escalation Timer');
    addField(contentEl, 'Timer Name *', this.values.name, v => this.values.name = v);
    addField(contentEl, 'Summary / What this represents', this.values.summary, v => this.values.summary = v, 'textarea');
    addEntityPicker(contentEl, 'Faction / Owner', this.values.factionId || '', this.plugin, 'factions', v => this.values.factionId = v);
    addField(contentEl, 'Faction / Owner (legacy/custom)', this.values.faction, v => this.values.faction = v);
    addEntityPicker(contentEl, 'Linked Quest', this.values.questId || '', this.plugin, 'quests', v => this.values.questId = v);
    addEntityPicker(contentEl, 'Linked BBEG', this.values.bbegId || '', this.plugin, 'bbegs', v => this.values.bbegId = v);
    addEntityPicker(contentEl, 'Linked War Front', this.values.warFrontId || '', this.plugin, 'warFronts', v => this.values.warFrontId = v);
    addEntityPicker(contentEl, 'Linked Incursion', this.values.incursionId || '', this.plugin, 'incursions', v => this.values.incursionId = v);
    addEntityPicker(contentEl, 'Linked Session', this.values.sessionId || '', this.plugin, 'sessions', v => this.values.sessionId = v);
    addTypedEntityPicker(contentEl, 'Linked Location / Threat Source', this.values.locationType || 'locations', this.values.locationId || '', this.plugin, v => this.values.locationType = v, v => this.values.locationId = v, THREAT_LINK_ENTITY_TYPES);
    addField(contentEl, 'Campaign-level Threat / Custom Label', this.values.threatLabel, v => this.values.threatLabel = v);
    addSelect(contentEl, 'Status', this.values.status, ['Active','Paused','Triggered','Complete'], v => this.values.status = v);
    addNumber(contentEl, 'Max Ticks (stages)', this.values.maxTicks, v => this.values.maxTicks = v);
    addNumber(contentEl, 'Current Tick', this.values.currentTick, v => this.values.currentTick = v);
    addField(contentEl, 'Final Consequence (when timer fires)', this.values.consequence, v => this.values.consequence = v, 'textarea');
    chipField(contentEl, 'Escalation Actions per Tick', safeArr(this.values.escalationSteps), v => this.values.escalationSteps = v, { bank: 'escalationActions', placeholder: 'Action at this tick…' });
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Timer name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.faction = scrubLegacyPlaceholderText(this.values.faction);
      this.values.threatLabel = scrubLegacyPlaceholderText(this.values.threatLabel);
      this.values.escalationSteps = scrubLegacyPlaceholderArray(this.values.escalationSteps);
      upsert(this.plugin.state, 'timers', this.values);
      await this.plugin.saveState();
      new Notice(`Timer "${this.values.name}" saved.`);
      this.close();
    }, 'Save Timer');
  }
}

// ── EnemyTemplateModal (Phase 11) ─────────────────────────────────────────────
class EnemyTemplateModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({ id: uid('enemy'), name: '', type: 'Humanoid', size: 'Medium', cr: '', ac: '', hp: '', speed: '', acFormula: '', hpFormula: '', speedFormula: '', alignment: 'Neutral Evil', faction: '', role: 'Frontline', tactics: [], traits: [], actions: [], summary: '', notes: '' }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Enemy Template' : 'New Enemy Template');

    const s1 = ce(contentEl, 'div', 'te-modal-section');
    s1.createEl('h3', { text: 'Stats' });
    addField(s1, 'Name *', this.values.name, v => this.values.name = v);
    addSelect(s1, 'Type', this.values.type, CREATURE_TYPES, v => this.values.type = v);
    addSelect(s1, 'Size', this.values.size, SIZES, v => this.values.size = v);
    addField(s1, 'Challenge Rating', this.values.cr, v => this.values.cr = v);
    addField(s1, 'Armour Class', this.values.ac, v => this.values.ac = v);
    addField(s1, 'Armour Class Formula', this.values.acFormula, v => this.values.acFormula = v);
    addField(s1, 'Hit Points', this.values.hp, v => this.values.hp = v);
    addField(s1, 'Hit Points Formula', this.values.hpFormula, v => this.values.hpFormula = v);
    addField(s1, 'Speed', this.values.speed, v => this.values.speed = v);
    addField(s1, 'Speed Formula', this.values.speedFormula, v => this.values.speedFormula = v);
    const calcRow = ce(s1, 'div', 'te-card-actions');
    btn(calcRow, 'Roll AC', 'te-btn is-sm', () => { if (this.values.acFormula) { const r = rollFormula(this.values.acFormula); this.values.ac = String(r.total); this.onOpen(); } });
    btn(calcRow, 'Roll HP', 'te-btn is-sm', () => { if (this.values.hpFormula) { const r = rollFormula(this.values.hpFormula); this.values.hp = String(r.total); this.onOpen(); } });
    btn(calcRow, 'Apply Speed', 'te-btn is-sm', () => { if (this.values.speedFormula) { this.values.speed = this.values.speedFormula; this.onOpen(); } });
    addSelect(s1, 'Alignment', this.values.alignment, ALIGNMENTS, v => this.values.alignment = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Faction & Role' });
    addEntityPicker(s2, 'Faction', this.values.factionId, this.plugin, 'factions', v => this.values.factionId = v);
    ce(s2, 'p', 'te-progress-label', 'Enemy Templates are reusable encounter stat packages. Use faction links for ownership; legacy manual faction tags are preserved silently but no longer edited here.');
    addSelect(s2, 'Combat Role', this.values.role, OPTION_BANKS.combatRoles, v => this.values.role = v);
    chipField(s2, 'Tactics', safeArr(this.values.tactics), v => this.values.tactics = v, { bank: 'tactics' });

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Traits & Actions' });
    chipField(s3, 'Special Traits', safeArr(this.values.traits), v => this.values.traits = v, { placeholder: 'Trait name…' });
    chipField(s3, 'Actions', safeArr(this.values.actions), v => this.values.actions = v, { placeholder: 'Attack or action…' });
    addField(s3, 'Summary', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(s3, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Enemy name is required.'); return; }
      this.values = sanitizeQaNotesValue(this.values);
      if (!this.values.campaignId) this.values.campaignId = this.plugin.state.activeCampaignId || '';
      this.values.faction = scrubLegacyPlaceholderText(this.values.faction);
      this.values.tactics = scrubLegacyPlaceholderArray(this.values.tactics);
      upsert(this.plugin.state, 'enemyTemplates', this.values);
      await this.plugin.saveState();
      new Notice(`Enemy Template "${this.values.name}" saved.`);
      this.close();
    }, 'Save Template');
  }
}

// ── FactionRelationshipModal (Phase 12) ───────────────────────────────────────
class FactionRelationshipModal extends Modal {
  constructor(app, plugin, item) {
    super(app);
    this.plugin = plugin;
    this.item = item || {};
    this.values = Object.assign({ id: uid('rel'), type: 'faction-faction', fromId: '', toId: '', status: 'Neutral', notes: '', history: '' }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Faction Relationship' : 'New Faction Relationship');
    addEntityPicker(contentEl, 'Faction A (from)', this.values.fromId, this.plugin, 'factions', v => this.values.fromId = v);
    addEntityPicker(contentEl, 'Faction B (to)', this.values.toId, this.plugin, 'factions', v => this.values.toId = v);
    addSelect(contentEl, 'Relationship Status', this.values.status, OPTION_BANKS.relationshipStates, v => this.values.status = v);
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    addField(contentEl, 'History / Background', this.values.history, v => this.values.history = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.fromId || !this.values.toId) { new Notice('Both factions are required.'); return; }
      if (this.values.fromId === this.values.toId) { new Notice('A faction cannot have a relationship with itself.'); return; }
      if (!this.plugin.state.relationships) this.plugin.state.relationships = [];
      const idx = this.plugin.state.relationships.findIndex(r => r.id === this.values.id);
      if (idx >= 0) this.plugin.state.relationships[idx] = this.values;
      else this.plugin.state.relationships.unshift(this.values);
      await this.plugin.saveState();
      new Notice('Faction relationship saved.');
      this.close();
    }, 'Save Relationship');
  }
}

// ── ExportModal (Phase 18) ────────────────────────────────────────────────────
class ExportModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText('Export Campaign');
    const camp = activeCampaign(this.plugin.state);
    ce(contentEl, 'p', 'te-diag-info', camp ? `Active campaign: ${camp.name}` : 'No active campaign selected.');

    const s = ce(contentEl, 'div', 'te-modal-section');
    s.createEl('h3', { text: 'Export Options' });
    const g = ce(s, 'div', 'te-grid');
    const option = (icon, title, desc, onClick) => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', icon); ce(h, 'h3', 'te-card-title', title);
      ce(c, 'p', 'te-card-body', desc);
      btn(ce(c, 'div', 'te-card-actions'), title, 'te-btn is-primary is-sm', onClick);
    };
    option('💾', 'Full Backup', 'Export complete plugin state as versioned JSON.', async () => { await exportBackup(this.plugin); });
    option('📤', 'Player Packet', 'Export player-safe quests, handouts, and primer.', () => exportPlayerSafePacket(this.plugin));
    option('📖', 'Campaign Bible', 'Export premise, acts, and DM notes as Markdown.', () => exportCampaignBible(this.plugin));
    option('🗒️', 'Session Logs', 'Export all session notes as Markdown files.', async () => {
      const sessions = safeArr(this.plugin.state.entities.sessions);
      const folder = campaignFolder(this.plugin);
      for (const sess of sessions) { await writeEntityNote(this.plugin, 'sessions', sess); }
      new Notice(`Exported ${sessions.length} session logs.`);
    });
    option('👤', 'All NPCs', 'Export all NPCs as individual Markdown notes.', async () => {
      const npcs = safeArr(this.plugin.state.entities.npcs);
      const folder = campaignFolder(this.plugin);
      for (const npc of npcs) { await writeEntityNote(this.plugin, 'npcs', npc); }
      new Notice(`Exported ${npcs.length} NPCs.`);
    });
    btn(contentEl, 'Close', 'te-btn', () => this.close());
  }
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
module.exports = TTRPGEnginePlugin;


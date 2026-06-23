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
  governmentTypes: ['Monarchy','Republic','Theocracy','Oligarchy','Militocracy','Tribal Council','Magocracy','Meritocracy','Anarchy','Occupied Territory','Custom'],
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
  occupations:  ['Merchant','Farmer','Guard','Priest','Wizard','Rogue','Scholar','Noble','Soldier','Artisan','Sailor','Hunter','Innkeeper','Blacksmith','Healer','Criminal','Spy','Mercenary','Custom'],
  npcRoles:     ['Ally','Enemy','Neutral','Quest Giver','Merchant','Informant','Guide','Rival','Mentor','Student','Family','Love Interest','Custom'],
  personalityTraits: ['Brave','Cautious','Greedy','Generous','Proud','Humble','Cunning','Naive','Suspicious','Trusting','Ambitious','Content','Vengeful','Forgiving','Mysterious','Custom'],
  ideals:       ['Greater Good','Nation','Tradition','Power','Freedom','Knowledge','Charity','Redemption','Loyalty','Justice','Nature','Custom'],
  bonds:        ['A person to protect','A debt to repay','A secret to keep','A sacred oath','A lost homeland','A family legacy','A revenge to pursue','A cause to champion','Custom'],
  flaws:        ['Greedy','Cowardly','Arrogant','Impulsive','Obsessive','Paranoid','Deceptive','Addicted','Vain','Cruel','Naive','Custom'],
  motivations:  ['Wealth','Power','Survival','Revenge','Love','Knowledge','Recognition','Safety','Redemption','Duty','Freedom','Custom'],
  attitudes:    ['Friendly','Indifferent','Suspicious','Hostile','Terrified','Fanatic','Desperate','Bored','Custom'],
  socialClasses:['Destitute','Poor','Working Class','Middle Class','Wealthy','Nobility','Royalty','Custom'],
  factionTypes: ['Military Force','Merchant Guild','Criminal Organization','Religious Order','Political Party','Adventuring Company','Secret Society','Rebel Cell','Government Body','Custom'],
  factionGoals: ['Territorial Control','Economic Dominance','Political Power','Religious Supremacy','Knowledge/Power','Protection','Revenge','Survival','Restoration','Chaos','Custom'],
  factionMethods: ['Diplomacy','Espionage','Military Force','Economic Pressure','Propaganda','Assassination','Corruption','Alliance Building','Custom'],
  factionResources: ['Gold','Troops','Information','Magic','Trade Goods','Political Favours','Land','Artifacts','Labour','Custom'],
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
    tileMap: { tiles: [], nextId: 1, mapName: 'Untitled Map', gridSize: 60, width: 1800, height: 1200, assetRoot: TILE_ASSET_ROOT, selectedMapId: '', mapId: '', distanceScale: '5 ft', linkedRegionId: '', linkedSettlementId: '', linkedLocationId: '', linkedDungeonId: '', linkedPoiId: '', linkedEncounterId: '', linkedSessionId: '' },
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
function toTitleCase(s) {
  return String(s || '').replace(/[\\/:*?"<>|#^[\]]+/g, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100) || 'Untitled';
}
function campaignFolder(plugin) {
  const c = activeCampaign(plugin.state);
  return c ? (toTitleCase(c.name) || 'Unassigned') : 'Unassigned';
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

  return { issues, info, counts };
}

// ── Entity picker helpers ─────────────────────────────────────────────────────
function addEntityPicker(el, label, value, plugin, entityKey, onChange) {
  const items = safeArr(plugin.state.entities[entityKey])
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
  const items = safeArr(plugin.state.entities[entityKey])
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
    let b = `# ${item.name || 'Homebrew Entry'}\n\n`;
    b += `> **Type:** ${item.type || '—'}  |  **Status:** ${item.status || 'Draft'}\n\n`;
    if (item.description) b += `## Description\n\n${item.description}\n\n`;
    if (item.mechanics) b += `## Mechanics\n\n${item.mechanics}\n\n`;
    if (item.balance) b += `**Balance Notes:** ${item.balance}\n\n`;
    b += `## DM Notes\n\n${item.dmNotes || item.notes || '_No notes._'}\n`;
    return b;
  },
};
function entityMd(key, item) {
  const FM_KEYS = ['name','title','status','type','campaignId','visibility','updatedAt'];
  const lines = ['---'];
  FM_KEYS.forEach(k => {
    if (item[k] !== undefined && item[k] !== '') {
      const val = Array.isArray(item[k]) ? item[k].join(', ') : String(item[k] || '');
      lines.push(`${k}: ${val}`);
    }
  });
  lines.push('---', '');
  const tmpl = ENTITY_MD_TEMPLATES[key];
  if (tmpl) lines.push(tmpl(item));
  else lines.push(`# ${item.name || item.title || 'Untitled'}`, '', item.summary || item.description || '');
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

class RestoreBackupModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: '📥 Restore from Backup' });
    ce(contentEl, 'p', 'te-page-subtitle', 'Enter the vault path to a backup JSON file (e.g. My Campaign/Backups/backup-2025-01-01.json). This will replace all plugin data — backup first!');
    const pathWrap = ce(contentEl, 'div', 'te-modal-section');
    let backupPath = '';
    new Setting(pathWrap).setName('Backup file path (in vault)').addText(t => { t.setPlaceholder('Campaign/Backups/backup-….json'); t.onChange(v => backupPath = v.trim()); });
    const preview = ce(contentEl, 'div', 'te-card'); preview.style.cssText = 'display:none;padding:12px;margin-top:8px';
    const previewBody = ce(preview, 'div', '');
    btn(contentEl, 'Preview Backup', 'te-btn', async () => {
      if (!backupPath) { new Notice('Enter a file path first.'); return; }
      try {
        const raw = await adapterRead(this.plugin.app, backupPath);
        const bk = JSON.parse(raw);
        if (!bk.state || !bk.version) { new Notice('Invalid backup file — missing state or version.'); return; }
        clear(previewBody);
        ce(previewBody, 'p', '', `Version: ${bk.version}`);
        ce(previewBody, 'p', '', `Timestamp: ${bk.timestamp ? new Date(bk.timestamp).toLocaleString() : 'Unknown'}`);
        const counts = bk.entityCounts || {};
        const total = Object.values(counts).reduce((s, v) => s + v, 0);
        ce(previewBody, 'p', '', `Total entities: ${total}`);
        const top = Object.entries(counts).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).slice(0, 8).map(([k,v]) => `${ENTITY_LABELS[k]||k}: ${v}`).join(', ');
        ce(previewBody, 'p', 'te-muted-text', top);
        preview.style.display = '';
        this._pendingBackup = bk;
      } catch (e) { new Notice(`Could not read backup: ${e.message}`); }
    });
    const actRow = ce(contentEl, 'div', 'te-modal-actions');
    btn(actRow, '⚠️ Restore (Replace All Data)', 'te-btn is-danger', async () => {
      if (!this._pendingBackup) { new Notice('Preview the backup first.'); return; }
      await exportBackup(this.plugin);
      Object.assign(this.plugin.state, this._pendingBackup.state);
      migrateState(this.plugin.state);
      await this.plugin.saveState();
      new Notice('Backup restored. Previous data backed up first.');
      this.close();
      this.plugin.refreshViews();
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
  maps:'🗺️', dungeons:'🕳️', timers:'⏱️', enemyTemplates:'⚔️',
  reputations:'⭐', warFronts:'🚩', incursions:'🌊', endgameStates:'🌋',
  nations:'👑', religions:'🕍', districts:'🏙️', rooms:'🚪', timelines:'📅', reveals:'💡', loot:'💰',
  hybridAncestries:'🧬',
  nobleFamilies:'🏰',
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
  maps:'Map', dungeons:'Dungeon', timers:'Escalation Timer', enemyTemplates:'Enemy Template',
  reputations:'Reputation', warFronts:'War Front', incursions:'Realm Incursion', endgameStates:'Ending State',
  nations:'Nation', religions:'Religion', districts:'District', rooms:'Room', timelines:'Timeline Event', reveals:'Reveal', loot:'Loot Entry',
  hybridAncestries:'Hybrid Ancestry',
  nobleFamilies:'Noble Family',
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
      ce(row, 'span', '', String(Array.isArray(val) ? val.join(', ') : val).slice(0, 80));
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
  bbegs:            (p, i) => new BBEGModal(p.app, p, i).open(),
  factions:         (p, i) => new FactionModal(p.app, p, i).open(),
  quests:           (p, i) => new QuestModal(p.app, p, i).open(),
  encounters:       (p, i) => new EncounterModal(p.app, p, i).open(),
  sessions:         (p, i) => new SessionModal(p.app, p, i).open(),
  secrets:          (p, i) => new SecretModal(p.app, p, i).open(),
  calendars:        (p, i) => new CalendarModal(p.app, p, i).open(),
  homebrew:         (p, i) => new HomebrewModal(p.app, p, i).open(),
  characters:       (p, i) => new CharacterModal(p.app, p, i).open(),
  hybridAncestries: (p, i) => new HybridAncestryModal(p.app, p, i).open(),
  nobleFamilies:    (p, i) => new NobleFamilyModal(p.app, p, i).open(),
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
  { key:'nobleFamilies', label:'Noble Family' },
  { key:'settlements',   label:'Settlement' },
  { key:'locations',     label:'Location' },
  { key:'regions',       label:'Region' },
  { key:'quests',        label:'Quest' },
];
function addTypedEntityPicker(el, label, typeValue, idValue, plugin, onTypeChange, onIdChange) {
  const cur = typeValue || PICKABLE_ENTITY_TYPES[0].key;
  const wrap = ce(el, 'div', 'te-field-row'); wrap.style.alignItems = 'center';
  ce(wrap, 'label', 'te-field-label', label);
  const right = ce(wrap, 'div', ''); right.style.cssText = 'flex:1;display:flex;gap:6px;align-items:center;flex-wrap:wrap';
  const SX = 'padding:6px 8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
  const typeSel = ce(right, 'select', 'te-field-select'); typeSel.style.cssText = SX + ';flex:0 0 140px';
  PICKABLE_ENTITY_TYPES.forEach(et => { const o = ce(typeSel, 'option', '', et.label); o.value = et.key; if (et.key === cur) o.selected = true; });
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
};
const SPELL_SCHOOLS = {
  A:'Abjuration', C:'Conjuration', D:'Divination', E:'Enchantment',
  I:'Illusion', N:'Necromancy', T:'Transmutation', V:'Evocation',
};
const REF_TABS = [
  { key:'spells',      label:'Spells',      icon:'✨' },
  { key:'feats',       label:'Feats',       icon:'⭐' },
  { key:'equipment',   label:'Equipment',   icon:'🗡️' },
  { key:'backgrounds', label:'Backgrounds', icon:'📜' },
  { key:'races',       label:'Races',       icon:'👥' },
  { key:'skills',      label:'Skills',      icon:'🎯' },
  { key:'languages',   label:'Languages',   icon:'💬' },
  { key:'conditions',  label:'Conditions',  icon:'🩺' },
  { key:'deities',     label:'Deities',     icon:'⚡' },
  { key:'actions',     label:'Actions',     icon:'⚔️' },
  { key:'rewards',     label:'Rewards',     icon:'🏆' },
  { key:'traps',       label:'Traps',       icon:'⚠️' },
  { key:'vehicles',    label:'Vehicles',    icon:'🚢' },
  { key:'objects',     label:'Objects',     icon:'📦' },
  { key:'senses',      label:'Senses',      icon:'👁️' },
];
class ReferenceDataService {
  constructor(plugin) { this.plugin = plugin; this._cache = {}; }
  async get(type) {
    if (this._cache[type]) return this._cache[type];
    const filename = REF_DATA_FILES[type];
    if (!filename) return [];
    try {
      const raw = await adapterRead(this.plugin.app, `${PLUGIN_DIR}/data/${filename}`);
      this._cache[type] = JSON.parse(raw);
    } catch { this._cache[type] = []; }
    return this._cache[type];
  }
  search(items, query) {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(it => {
      return [it.name, it.source, it.type, it.school, String(it.level||''), it.pantheon, it.category]
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
  renderEntries(el, item.entries);
}

// ── 5e Reference section ──────────────────────────────────────────────────────
async function renderReference(main, plugin) {
  pageHead(main, plugin, '5e Reference', 'Searchable rules reference — spells, feats, equipment, races, backgrounds, and more.');
  const dataPath = `${PLUGIN_DIR}/data`;
  const dataExists = await adapterExists(plugin.app, dataPath);
  if (!dataExists) {
    const warn = ce(main, 'div', 'te-card'); warn.style.cssText = 'border-color:var(--te-danger)';
    ce(warn, 'p', 'te-card-body', `⚠️ Data folder not found at ${dataPath}/. Install the plugin's data folder to enable this section.`);
    return;
  }
  const rs = { tab: 'spells', search: '', expanded: null };
  const wrap = ce(main, 'div', '');
  const rebuild = async () => {
    clear(wrap);
    // Tab row
    const tabRow = ce(wrap, 'div', ''); tabRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px';
    REF_TABS.forEach(t => {
      btn(tabRow, `${t.icon} ${t.label}`, 'te-btn is-sm' + (rs.tab === t.key ? ' is-primary' : ''), () => {
        rs.tab = t.key; rs.search = ''; rs.expanded = null; rebuild();
      });
    });
    // Search
    const sRow = ce(wrap, 'div', ''); sRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;align-items:center';
    const sIn = ce(sRow, 'input', '');
    sIn.type = 'text'; sIn.placeholder = `Search ${rs.tab}…`; sIn.value = rs.search;
    sIn.style.cssText = 'flex:1;padding:7px 10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);font-size:.9rem';
    const listEl = ce(wrap, 'div', '');
    const buildList = async () => {
      clear(listEl);
      const all = await plugin.refData.get(rs.tab);
      if (!all.length) { ce(listEl, 'p', 'te-empty-state', `No data for "${rs.tab}". Check that data/${REF_DATA_FILES[rs.tab]} is present.`); return; }
      const filtered = plugin.refData.search(all, rs.search);
      const shown = filtered.slice(0, 120);
      shown.forEach(item => {
        const card = ce(listEl, 'div', 'te-card te-ref-card');
        const head = ce(card, 'div', 'te-card-head');
        head.style.cursor = 'pointer';
        ce(head, 'h3', 'te-card-title', item.name);
        const meta = refItemMeta(rs.tab, item);
        if (meta) { const m = ce(head, 'span', 'te-card-meta-label', meta); m.style.marginLeft = '6px'; }
        if (item.source) { const s = ce(head, 'span', 'te-ref-source', item.source); }
        const isOpen = rs.expanded === item.id;
        if (isOpen) {
          const body = ce(card, 'div', 'te-ref-detail');
          refItemDetail(body, rs.tab, item);
        }
        head.addEventListener('click', () => { rs.expanded = isOpen ? null : item.id; buildList(); });
      });
      if (filtered.length > 120) ce(listEl, 'p', 'te-empty-state', `Showing 120 of ${filtered.length} — refine your search to see more.`);
      else if (!filtered.length) ce(listEl, 'p', 'te-empty-state', `No matches for "${rs.search}".`);
    };
    sIn.addEventListener('input', () => { rs.search = sIn.value; rs.expanded = null; buildList(); });
    buildList();
  };
  rebuild();
}

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
      cmd('create-homebrew', 'Create homebrew entry', () => new HomebrewModal(this.app, this).open());
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
      { label: 'DM Tools', items: [
        { id: 'dashboard',   icon: '🏰', label: 'Dashboard' },
        { id: 'campaigns',   icon: '📜', label: 'Campaigns' },
        { id: 'bible',       icon: '📖', label: 'Campaign Bible' },
        { id: 'dmscreen',    icon: '🖥️', label: 'DM Screen' },
        { id: 'run-session', icon: '▶️', label: 'Run Session' },
      ]},
      { label: 'World & Story', items: [
        { id: 'world',       icon: '🌍', label: 'World & Lore' },
        { id: 'geography',   icon: '🗺️', label: 'Geography & Maps' },
        { id: 'gazetteer',   icon: '📍', label: 'Gazetteer' },
        { id: 'npcs',        icon: '👤', label: 'NPCs & Creatures' },
        { id: 'factions',    icon: '⚔️', label: 'Factions' },
        { id: 'faction-matrix', icon: '🕸️', label: 'Relationship Matrix' },
        { id: 'adventure',   icon: '📝', label: 'Adventures & Quests' },
        { id: 'encounters',  icon: '🎯', label: 'Encounters & Combat' },
        { id: 'hybrid-ancestry', icon: '🧬', label: 'Hybrid Ancestry' },
      ]},
      { label: 'Campaign Ops', items: [
        { id: 'rules',       icon: '⚙️', label: 'Rules & Mechanics' },
        { id: 'downtime',    icon: '⏳', label: 'Downtime & Bases' },
        { id: 'sessions',    icon: '📅', label: 'Sessions & Timeline' },
        { id: 'secrets',     icon: '🔒', label: 'Secrets & Reveals' },
        { id: 'war-machine', icon: '🔧', label: 'War Machine' },
        { id: 'endgame',     icon: '🌋', label: 'Endgame' },
      ]},
      { label: 'Library', items: [
        { id: 'library',     icon: '📚', label: 'Compendium & Library' },
        { id: 'reference',   icon: '📖', label: '5e Reference' },
        { id: 'homebrew',    icon: '🧪', label: 'Homebrew' },
        { id: 'generators',  icon: '🎲', label: 'Generators' },
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
      const CAMPAIGN_OWNED = ['npcs','creatures','bbegs','factions','quests','encounters','sessions','secrets','handouts','regions','settlements','locations','dungeons','maps','timers','enemyTemplates','nobleFamilies','hybridAncestries'];
      if (CAMPAIGN_OWNED.includes(key) && !item.campaignId && state.activeCampaignId) {
        item.campaignId = state.activeCampaignId;
        issues.push(`${key}[${i}] ${item.id}: assigned campaignId from activeCampaignId`);
      }
      // Invalid visibility
      const VALID_VIS = ['dm-only','player-visible','secret','revealed'];
      if (item.visibility && !VALID_VIS.includes(item.visibility)) {
        issues.push(`${key}[${i}] ${item.id}: invalid visibility "${item.visibility}" (not changed, requires manual fix)`);
      }
    });
  }
  // Check relationships
  safeArr(state.relationships).forEach((rel, i) => {
    if (!rel.id) { rel.id = `rel-repaired-${Date.now()}-${i}`; issues.push(`relationship[${i}]: assigned missing id`); }
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
    // DM Engine
    dashboard: renderDashboard,
    campaigns: renderCampaigns,
    bible: renderCampaignBible,
    'run-session': renderRunSession,
    dmscreen: renderDmScreen,
    world: renderWorld,
    geography: renderGeography,
    gazetteer: renderGazetteer,
    npcs: renderNpcs,
    factions: renderFactions,
    'faction-matrix': renderFactionMatrix,
    'relationship-matrix': renderRelationshipMatrix,
    adventure: renderAdventure,
    encounters: renderEncounters,
    rules: renderRules,
    downtime: renderDowntime,
    sessions: renderSessions,
    secrets: renderSecrets,
    'war-machine': renderWarMachine,
    endgame: renderEndgame,
    library: renderLibrary,
    reference: renderReference,
    homebrew: renderHomebrew,
    generators: renderGenerators,
    // Legacy
    player: renderPCOverview,
    // PC Companion
    'pc-overview':   renderPCOverview,
    'pc-character':  renderPCCharacter,
    'pc-inventory':  renderPCInventory,
    'pc-spellbook':  renderPCSpellbook,
    'pc-quests':     renderPCQuests,
    'pc-handouts':   renderPCHandouts,
    'pc-journal':    renderPCJournal,
    'pc-lore':       renderPCLore,
    'hybrid-ancestry': renderHybridAncestry,
  };
  (map[section] || renderDashboard)(main, plugin);
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard(main, plugin) {
  const state = plugin.state;
  pageHead(main, plugin, 'Dungeon Master Console', 'Campaign hub — build, run, and track your whole campaign from here.', [
    { label: '🧙 Campaign Wizard', primary: true, onClick: () => new CampaignWizardModal(plugin.app, plugin).open() },
    { label: '+ Quick Campaign', onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '▶ Run Session', run: true, onClick: async () => { state.activeSection = 'run-session'; await plugin.saveState(); } },
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
  // My content — clickable stat cards navigating to their section
  sectionHead(main, 'My Content / Saved Items');
  const ENTITY_NAV = {
    campaigns:'campaigns', worlds:'world', cosmologies:'world', realms:'world', regions:'geography',
    settlements:'gazetteer', locations:'gazetteer', pois:'gazetteer', routes:'gazetteer',
    npcs:'npcs', creatures:'npcs', bbegs:'npcs', factions:'world',
    cultures:'world', languages:'world', deities:'world', pantheons:'world', nations:'world', religions:'world',
    quests:'adventure', adventures:'adventure', encounters:'adventure',
    sessions:'sessions', milestones:'sessions', secrets:'secrets', handouts:'secrets',
    homebrew:'homebrew', tables:'library', compendium:'library', rules:'library',
    characters:'pc-character', journals:'pc-journal',
    maps:'geography', dungeons:'geography', nobleFamilies:'relationship-matrix',
    hybridAncestries:'hybrid-ancestry', timers:'war-machine', enemyTemplates:'war-machine',
    warFronts:'endgame', incursions:'endgame', endgameStates:'endgame',
  };
  const dc = ce(main, 'div', 'te-card');
  const dcHead = ce(dc, 'div', 'te-card-head');
  ce(dcHead, 'span', 'te-card-icon', '📊');
  ce(dcHead, 'h3', 'te-card-title', 'Content Summary — click any tile to navigate');
  const backupRow = ce(dc, 'div', 'te-card-actions');
  btn(backupRow, '💾 Backup Now', 'te-btn is-sm', () => exportBackup(plugin));
  btn(backupRow, '📥 Restore Backup', 'te-btn is-sm', () => new RestoreBackupModal(plugin.app, plugin).open());
  btn(backupRow, '🔧 Repair & Reindex', 'te-btn is-sm', async () => {
    const issues = repairAndReindex(state); await plugin.saveState();
    new Notice(issues.length ? `Repaired ${issues.length} issue(s).` : 'No issues found.');
  });
  const dcGrid = ce(dc, 'div', 'te-stat-grid');
  dcGrid.style.marginTop = '8px';
  const ek = Object.keys(state.entities);
  ek.forEach(k => {
    if (!safeArr(state.entities[k]).length) return;
    const sc = ce(dcGrid, 'div', 'te-stat-card');
    sc.style.cssText = 'padding:8px;cursor:pointer;transition:box-shadow .15s';
    sc.title = `Go to ${ENTITY_LABELS[k] || k}`;
    ce(sc, 'div', 'te-stat-big', state.entities[k].length);
    ce(sc, 'div', 'te-stat-label', ENTITY_LABELS[k] || k);
    if (ENTITY_NAV[k]) {
      sc.addEventListener('click', async () => { state.activeSection = ENTITY_NAV[k]; await plugin.saveState(); });
      sc.addEventListener('mouseenter', () => { sc.style.boxShadow = '0 0 0 2px var(--te-accent)'; });
      sc.addEventListener('mouseleave', () => { sc.style.boxShadow = ''; });
    }
  });
}

// ── CAMPAIGNS ─────────────────────────────────────────────────────────────────
function renderCampaigns(main, plugin) {
  pageHead(main, plugin, 'Campaigns', 'Create, manage, and switch between your campaigns.', [
    { label: '🧙 Campaign Wizard', primary: true, onClick: () => new CampaignWizardModal(plugin.app, plugin).open() },
    { label: '+ Quick Campaign', onClick: () => new CampaignModal(plugin.app, plugin).open() },
    { label: '▶ Run Session', run: true, onClick: async () => { plugin.state.activeSection = 'run-session'; await plugin.saveState(); } },
    { label: '📖 Campaign Bible', onClick: async () => { plugin.state.activeSection = 'bible'; await plugin.saveState(); } },
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
function renderWorld(main, plugin) {
  pageHead(main, plugin, 'World & Lore', 'Worlds, cosmologies, realms, deities, factions, cultures, languages, and more.', [
    { label: '+ World', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'worlds', null, worldFields).open() },
    { label: '+ Cosmology', onClick: () => new GenericModal(plugin.app, plugin, 'cosmologies', null, cosmologyFields).open() },
    { label: '+ Realm', onClick: () => new GenericModal(plugin.app, plugin, 'realms', null, realmFields).open() },
    { label: '+ Deity', onClick: () => new GenericModal(plugin.app, plugin, 'deities', null, deityFields).open() },
    { label: '+ Faction', onClick: () => new FactionModal(plugin.app, plugin).open() },
    { label: '+ Culture', onClick: () => new GenericModal(plugin.app, plugin, 'cultures', null, cultureFields).open() },
    { label: '+ Language', onClick: () => new GenericModal(plugin.app, plugin, 'languages', null, langFields).open() },
    { label: '+ Nation', onClick: () => new GenericModal(plugin.app, plugin, 'nations', null, nationFields).open() },
    { label: '+ Religion', onClick: () => new GenericModal(plugin.app, plugin, 'religions', null, religionFields).open() },
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
  sectionHead(main, 'Nations');
  itemCards(main, plugin, 'nations', { meta: ['type', 'ruler', 'capital'] });
  sectionHead(main, 'Religions');
  itemCards(main, plugin, 'religions', { meta: ['type', 'deity', 'alignment'] });
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
    { label: '+ District', onClick: () => new GenericModal(plugin.app, plugin, 'districts', null, districtFields).open() },
    { label: '+ Room', onClick: () => new GenericModal(plugin.app, plugin, 'rooms', null, roomFields).open() },
    { label: '+ POI', onClick: () => new GenericModal(plugin.app, plugin, 'pois', null, poiFields).open() },
    { label: '+ Route', onClick: () => new GenericModal(plugin.app, plugin, 'routes', null, routeFields).open() },
  ]);

  // Tile Map Builder (inline)
  sectionHead(main, 'Tile Map Builder');
  renderTileMapBuilder(main, plugin);

  // Saved Maps
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
      const acts = ce(c, 'div', 'te-card-actions');
      btn(acts, '📂 Open in Builder', 'te-btn is-primary is-sm', async () => {
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

  sectionHead(main, 'Regions');
  itemCards(main, plugin, 'regions', { meta: ['terrain', 'climate', 'population'] });
  sectionHead(main, 'Settlements');
  itemCards(main, plugin, 'settlements', { meta: ['type', 'population', 'region'] });
  sectionHead(main, 'Districts');
  itemCards(main, plugin, 'districts', { meta: ['type', 'settlementId', 'atmosphere'] });
  sectionHead(main, 'Locations');
  itemCards(main, plugin, 'locations', { meta: ['type', 'parent'] });
  sectionHead(main, 'Rooms');
  itemCards(main, plugin, 'rooms', { meta: ['type', 'locationId'] });
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
    await ensureFolder(plugin.app, `${folder}/Maps`);
    // Export PNG
    try {
      const blob = await exportMapToPng(tmState, tileAssets);
      const buf  = await blob.arrayBuffer();
      const pngPath = normalizePath(`${folder}/Maps/${slugify(tmState.mapName)}.png`);
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
    assetCountLabel.textContent = `${assets.length} asset${assets.length !== 1 ? 's' : ''}`;
    renderCategoryFilter();
    renderPalette();
    renderCanvas();
  }).catch(() => {
    assetCountLabel.textContent = 'emoji mode';
    renderCategoryFilter(); renderPalette();
  });
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
      itemCards(main, plugin, 'quests', { meta: ['questType', 'giver', 'location'], hint: '', items: qActive });
    }
    if (qCompleted.length) {
      const ch = ce(main, 'h3', 'te-quest-status-head'); ch.textContent = 'Completed'; ch.style.color = 'var(--color-green,#22c55e)';
      itemCards(main, plugin, 'quests', { meta: ['questType', 'giver'], hint: '', items: qCompleted });
    }
    if (qOther.length) {
      const oh = ce(main, 'h3', 'te-quest-status-head'); oh.textContent = 'Other';
      itemCards(main, plugin, 'quests', { meta: ['questType', 'status', 'giver'], hint: '', items: qOther });
    }
  }
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
    { label: '+ Loot', onClick: () => new GenericModal(plugin.app, plugin, 'loot', null, lootFields).open() },
    { label: '🎲 Roll Dice', onClick: () => new DiceModal(plugin.app, plugin).open() },
  ]);

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
  itemCards(main, plugin, 'encounters', { meta: ['type', 'difficulty', 'location', 'linkedQuest'] });
  sectionHead(main, 'Loot');
  itemCards(main, plugin, 'loot', { meta: ['type', 'rarity', 'value', 'status'] });
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
    { label: '+ Timeline Event', onClick: () => new GenericModal(plugin.app, plugin, 'timelines', null, timelineFields).open() },
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
  sectionHead(main, 'Timeline Events');
  itemCards(main, plugin, 'timelines', { meta: ['date', 'era', 'type'] });
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
    { label: '+ Reveal', onClick: () => new GenericModal(plugin.app, plugin, 'reveals', null, revealFields).open() },
    { label: '+ Handout', onClick: () => new GenericModal(plugin.app, plugin, 'handouts', null, handoutFields).open() },
    { label: '📤 Export Player Packet', onClick: () => exportPlayerSafePacket(plugin) },
  ]);
  sectionHead(main, 'Secrets (DM Only)');
  itemCards(main, plugin, 'secrets', { meta: ['secretType', 'revealStatus', 'revealTrigger'] });
  sectionHead(main, 'Reveals');
  itemCards(main, plugin, 'reveals', { meta: ['status', 'session', 'secretId'] });
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
  const hist = safeArr(plugin.state.generatorHistory);
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
        await writeNote(plugin.app, `${campaignFolder(plugin)}/Generated/${slugify(h.type)}-${Date.now()}.md`, `# ${h.type}\n\n${h.result}`);
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
function renderCampaignBible(main, plugin) {
  const state = plugin.state;
  const camp = activeCampaign(state);
  pageHead(main, plugin, 'Campaign Bible', 'Campaign premise, secrets, act structure, and publication blueprint.', [
    { label: '✏️ Edit Bible', primary: true, onClick: () => new CampaignBibleModal(plugin.app, plugin, camp).open() },
    { label: '📤 Export', onClick: () => exportCampaignBible(plugin) },
  ]);
  if (!camp) { emptyState(main, 'No active campaign.', 'Create and activate a campaign first.'); return; }

  const bib = camp.bible || {};
  sectionHead(main, 'Campaign Premise');
  const premise = ce(main, 'div', 'te-card');
  const ph = ce(premise, 'div', 'te-card-head');
  ce(ph, 'span', 'te-card-icon', '📜');
  ce(ph, 'h3', 'te-card-title', camp.name);
  if (bib.premise) ce(premise, 'p', 'te-card-body', bib.premise);
  const pm = ce(premise, 'div', 'te-card-meta');
  [['Tone', bib.tone], ['Genre', bib.genre], ['Scope', bib.scope], ['Ruleset', bib.ruleset]].forEach(([k, v]) => {
    if (!v) return;
    const r = ce(pm, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v);
  });
  if (safeArr(bib.themes).length) { const r = ce(pm, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Themes'); ce(r, 'span', '', bib.themes.join(', ')); }

  sectionHead(main, 'Act Structure');
  const acts = safeArr(bib.acts);
  if (acts.length) {
    const g = ce(main, 'div', 'te-grid');
    acts.forEach((act, i) => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', `${i + 1}.`); ce(h, 'h3', 'te-card-title', act.title || `Act ${i + 1}`);
      if (act.summary) ce(c, 'p', 'te-card-body', act.summary);
    });
  } else { emptyState(main, 'No acts defined.', 'Edit the Campaign Bible to add your act structure.'); }

  sectionHead(main, 'DM Secrets Register');
  const dmSecrets = safeArr(state.entities.secrets).filter(s => s.visibility === 'dm-only' || !s.visibility);
  if (dmSecrets.length) {
    const g = ce(main, 'div', 'te-grid');
    dmSecrets.forEach(s => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🔒'); ce(h, 'h3', 'te-card-title', s.name);
      if (s.summary) ce(c, 'p', 'te-card-body', (s.summary || '').slice(0, 120));
      const m = ce(c, 'div', 'te-card-meta');
      if (s.type) { const r = ce(m, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'type'); ce(r, 'span', '', s.type); }
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new SecretModal(plugin.app, plugin, s).open());
    });
  } else { emptyState(main, 'No DM secrets.', 'Add secrets in the Secrets & Reveals section.'); }

  sectionHead(main, 'Milestone Progression');
  const milestones = safeArr(state.entities.milestones);
  if (milestones.length) {
    const g = ce(main, 'div', 'te-grid');
    milestones.forEach(m => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🏆'); ce(h, 'h3', 'te-card-title', m.name);
      if (m.summary) ce(c, 'p', 'te-card-body', m.summary);
      const mt = ce(c, 'div', 'te-card-meta');
      [['Level', m.level], ['Status', m.status]].forEach(([k, v]) => { if (!v) return; const r = ce(mt, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'milestones', m, milestoneFields).open());
    });
  } else { emptyState(main, 'No milestones.', 'Add milestones in Adventures & Quests.'); }

  if (bib.playerPrimer) {
    sectionHead(main, 'Player Primer');
    const p = ce(main, 'div', 'te-card');
    ce(p, 'p', 'te-card-body', bib.playerPrimer);
    btn(ce(p, 'div', 'te-card-actions'), '📤 Export Player Packet', 'te-btn is-sm is-primary', () => exportPlayerSafePacket(plugin));
  }

  sectionHead(main, 'Session History');
  const sessionLog = safeArr(state.entities.sessions).slice().sort((a, b) => {
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
      btn(ce(c, 'div', 'te-card-actions'), 'View Log', 'te-btn is-sm', async () => { state.activeSection = 'sessions'; await plugin.saveState(); });
    });
    if (sessionLog.length > 12) { const ra = ce(main, 'div', 'te-modal-actions'); btn(ra, `View All ${sessionLog.length} Sessions →`, 'te-btn', async () => { state.activeSection = 'sessions'; await plugin.saveState(); }); }
  } else { emptyState(main, 'No sessions logged yet.', 'Log sessions in Sessions & Timeline.'); }
}

async function exportCampaignBible(plugin) {
  const camp = activeCampaign(plugin.state);
  if (!camp) { new Notice('No active campaign.'); return; }
  const bib = camp.bible || {};
  const folder = campaignFolder(plugin);
  let md = `# Campaign Bible — ${camp.name}\n\n`;
  md += `*Generated ${new Date().toLocaleDateString()}*\n\n`;
  if (bib.premise) md += `## Premise\n\n${bib.premise}\n\n`;
  if (bib.tone) md += `**Tone:** ${bib.tone} | **Genre:** ${bib.genre || '—'} | **Scope:** ${bib.scope || '—'} | **Ruleset:** ${bib.ruleset || '—'}\n\n`;
  if (safeArr(bib.themes).length) md += `**Themes:** ${bib.themes.join(', ')}\n\n`;
  if (safeArr(bib.acts).length) { md += `## Act Structure\n\n`; bib.acts.forEach((a, i) => { md += `### Act ${i + 1}: ${a.title || ''}\n\n${a.summary || ''}\n\n`; }); }
  if (bib.playerPrimer) md += `## Player Primer\n\n${bib.playerPrimer}\n\n`;
  await writeNote(plugin.app, `${folder}/Campaign Bible.md`, md);
  new Notice(`Campaign Bible exported to ${folder}/Campaign Bible.md`);
}

// ── GAZETTEER (Phase 9) ────────────────────────────────────────────────────────
function renderGazetteer(main, plugin) {
  pageHead(main, plugin, 'Gazetteer', 'Regions, settlements, dungeons, and locations at a glance.', [
    { label: '+ Region', onClick: () => new GenericModal(plugin.app, plugin, 'regions', null, regionFields).open() },
    { label: '+ Settlement', onClick: () => new GenericModal(plugin.app, plugin, 'settlements', null, settlementFields).open() },
    { label: '+ Dungeon', primary: true, onClick: () => new DungeonModal(plugin.app, plugin).open() },
  ]);

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
function renderRunSession(main, plugin) {
  const state = plugin.state;
  const camp = activeCampaign(state);
  pageHead(main, plugin, '▶ Run Session', 'Live session management — initiative, reveals, handouts, and notes.', [
    { label: state.sessionRunMode ? '⏹ End Session' : '▶ Start Session', primary: !state.sessionRunMode, run: state.sessionRunMode,
      onClick: async () => {
        if (!state.sessionRunMode) {
          const newSess = { id: uid('sess'), name: `Session ${safeArr(state.entities.sessions).length + 1} — ${new Date().toLocaleDateString()}`, status: 'Active', date: new Date().toISOString().slice(0, 10), campaignId: state.activeCampaignId };
          upsert(state, 'sessions', newSess);
          state.sessionRunMode = true;
          state.activeSessionId = newSess.id;
        } else {
          const sess = safeArr(state.entities.sessions).find(s => s.id === state.activeSessionId);
          if (sess) { sess.status = 'Completed'; upsert(state, 'sessions', sess); }
          state.sessionRunMode = false;
          state.activeSessionId = '';
        }
        await plugin.saveState();
      }
    },
  ]);

  if (state.sessionRunMode) {
    const badge = ce(main, 'div', 'te-session-live-badge', '🔴 Session in Progress');
    const sess = safeArr(state.entities.sessions).find(s => s.id === state.activeSessionId);
    if (sess) ce(main, 'p', 'te-page-subtitle', sess.name);
  }

  sectionHead(main, 'Initiative Tracker');
  renderInitiativeTracker(main, plugin);

  sectionHead(main, 'Reveal Queue — Secrets & Handouts');
  const pending = safeArr(state.entities.secrets).filter(s => s.status === 'Ready to Reveal');
  const pendingHandouts = safeArr(state.entities.handouts).filter(h => h.visibility === 'dm-only');
  if (pending.length || pendingHandouts.length) {
    const g = ce(main, 'div', 'te-grid');
    pending.forEach(s => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🔓'); ce(h, 'h3', 'te-card-title', s.name);
      if (s.summary) ce(c, 'p', 'te-card-body', s.summary);
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, '✅ Reveal Now', 'te-btn is-sm is-primary', async () => {
        s.visibility = 'revealed'; s.status = 'Revealed'; s.revealedAt = new Date().toISOString();
        upsert(state, 'secrets', s); await plugin.saveState(); new Notice(`"${s.name}" revealed!`);
      });
    });
    pendingHandouts.forEach(h => {
      const c = ce(g, 'div', 'te-card');
      const hd = ce(c, 'div', 'te-card-head'); ce(hd, 'span', 'te-card-icon', '📄'); ce(hd, 'h3', 'te-card-title', h.name);
      if (h.content) ce(c, 'p', 'te-card-body', h.content.slice(0, 120));
      const mt = ce(c, 'div', 'te-card-meta');
      if (h.type) { const r = ce(mt, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', 'Type'); ce(r, 'span', '', h.type); }
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, '📤 Share with Players', 'te-btn is-sm is-primary', async () => {
        h.visibility = 'player-visible'; upsert(state, 'handouts', h); await plugin.saveState(); new Notice(`"${h.name}" shared with players.`);
      });
    });
  } else { emptyState(main, 'No secrets or handouts queued for reveal.', 'Mark secrets as "Ready to Reveal" or create handouts in Secrets & Reveals.'); }

  sectionHead(main, 'Session Notes');
  const notesId = state.activeSessionId;
  if (notesId) {
    const sess = safeArr(state.entities.sessions).find(s => s.id === notesId);
    if (sess) {
      const ta = ce(main, 'textarea', '');
      ta.placeholder = 'Session notes…'; ta.value = sess.notes || '';
      ta.style.cssText = 'width:100%;min-height:120px;padding:10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-md);font-family:inherit;resize:vertical';
      let saveT = null;
      ta.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(async () => { sess.notes = ta.value; upsert(state, 'sessions', sess); await plugin.saveState(); }, 800); });
    }
  } else {
    ce(main, 'p', 'te-empty-state', 'Start a session to enable notes.');
  }

  // ── Inline Dice Roller ────────────────────────────────────────────────────
  sectionHead(main, '🎲 Quick Dice Roller');
  const diceWrap = ce(main, 'div', 'te-card'); diceWrap.style.cssText = 'padding:12px';
  const diceResultEl = ce(diceWrap, 'div', 'te-result-box', 'Enter a formula and roll.');
  diceResultEl.style.cssText = 'min-height:36px;padding:8px 12px;border-radius:var(--te-r-md);border:1px solid var(--te-border);margin-bottom:8px;font-size:1.1rem;font-weight:600';
  const quickDice = ce(diceWrap, 'div', 'te-card-actions'); quickDice.style.flexWrap = 'wrap';
  ['d4','d6','d8','d10','d12','d20','d100'].forEach(d => {
    btn(quickDice, d, 'te-btn is-sm', () => {
      const sides = parseInt(d.slice(1));
      const roll = Math.floor(Math.random() * sides) + 1;
      diceResultEl.textContent = `${d}: ${roll}`;
    });
  });
  const formulaRow = ce(diceWrap, 'div', 'te-chip-add-row'); formulaRow.style.marginTop = '8px';
  const formulaInp = ce(formulaRow, 'input'); formulaInp.type = 'text'; formulaInp.placeholder = '2d6+3'; formulaInp.style.flex = '1';
  btn(formulaRow, 'Roll', 'te-btn is-primary', () => {
    const f = formulaInp.value.trim() || '1d20';
    const match = f.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) { diceResultEl.textContent = 'Invalid formula (use NdN or NdN±M)'; return; }
    const count = Math.max(1, Math.min(100, parseInt(match[1]))), sides = parseInt(match[2]), mod = parseInt(match[3] || 0);
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0) + mod;
    diceResultEl.textContent = `${f} → ${total}${count > 1 ? ` (${rolls.join(', ')}${mod !== 0 ? ` ${mod > 0 ? '+' : ''}${mod}` : ''})` : ''}`;
  });
  formulaInp.addEventListener('keydown', e => { if (e.key === 'Enter') formulaRow.querySelector('button').click(); });

  // ── Quick Generators ──────────────────────────────────────────────────────
  sectionHead(main, '⚡ Quick Generators');
  const genWrap = ce(main, 'div', 'te-card'); genWrap.style.cssText = 'padding:12px';
  const genResultEl = ce(genWrap, 'div', 'te-result-box', 'Pick a type and generate.');
  genResultEl.style.cssText = 'min-height:40px;padding:8px 12px;border-radius:var(--te-r-md);border:1px solid var(--te-border);margin-bottom:8px;font-size:.95rem;line-height:1.4';
  let lastGenType = 'NPC Name', lastGenResult = '';
  const genTypeRow = ce(genWrap, 'div', 'te-card-actions'); genTypeRow.style.flexWrap = 'wrap';
  const GEN_QUICK = ['NPC Name','NPC Trait','Quest Hook','Rumour','Faction Name','Dungeon Room','Wild Magic Surge','Weather','Travel Event','Loot','Tavern Name'];
  let activeGenBtn = null;
  GEN_QUICK.forEach(t => {
    const b = btn(genTypeRow, t, 'te-btn is-sm' + (t === lastGenType ? ' is-primary' : ''), () => {
      lastGenType = t;
      Array.from(genTypeRow.querySelectorAll('button')).forEach(x => x.className = 'te-btn is-sm');
      b.className = 'te-btn is-sm is-primary';
    });
    if (t === lastGenType) activeGenBtn = b;
  });
  const genActRow = ce(genWrap, 'div', 'te-card-actions'); genActRow.style.marginTop = '8px';
  btn(genActRow, 'Generate', 'te-btn is-primary', () => {
    lastGenResult = generate(lastGenType, state);
    genResultEl.textContent = lastGenResult;
    saveAsBtn.style.display = ['NPC Name','Faction Name','Quest Hook'].includes(lastGenType) ? '' : 'none';
  });
  const saveAsBtn = btn(genActRow, 'Save as Entity', 'te-btn', () => {
    if (!lastGenResult) return;
    if (lastGenType === 'NPC Name') new NPCModal(plugin.app, plugin, { name: lastGenResult }).open();
    else if (lastGenType === 'Faction Name') new FactionModal(plugin.app, plugin, { name: lastGenResult }).open();
    else if (lastGenType === 'Quest Hook') new QuestModal(plugin.app, plugin, { name: 'Generated Quest', hooks: [lastGenResult] }).open();
  });
  saveAsBtn.style.display = 'none';

  // ── Active NPC Quick Look ─────────────────────────────────────────────────
  sectionHead(main, '👥 Active NPCs');
  const npcLookWrap = ce(main, 'div', 'te-card'); npcLookWrap.style.padding = '12px';
  const campNpcs = safeArr(state.entities.npcs).filter(n => !state.activeCampaignId || n.campaignId === state.activeCampaignId);
  if (campNpcs.length) {
    const npcSearch = { q: '' };
    const npcSIn = ce(npcLookWrap, 'input'); npcSIn.type = 'text'; npcSIn.placeholder = 'Search NPCs…';
    npcSIn.style.cssText = 'width:100%;padding:6px 10px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);font-size:.9rem;margin-bottom:8px';
    const npcListEl = ce(npcLookWrap, 'div', '');
    const rebuildNpcs = () => {
      clear(npcListEl);
      const q = npcSearch.q.toLowerCase();
      const shown = campNpcs.filter(n => !q || (n.name||'').toLowerCase().includes(q) || (n.role||'').toLowerCase().includes(q)).slice(0, 20);
      if (!shown.length) { ce(npcListEl, 'p', 'te-empty-state', q ? 'No NPCs match.' : 'No NPCs in this campaign.'); return; }
      shown.forEach(npc => {
        const row = ce(npcListEl, 'div', 'te-card-meta-row');
        row.style.cssText = 'padding:6px 4px;border-bottom:1px solid var(--te-border);display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap';
        const nm = ce(row, 'strong', ''); nm.textContent = npc.name; nm.style.minWidth = '120px';
        if (npc.role) { const r = ce(row, 'span', 'te-card-meta-label'); r.textContent = npc.role; }
        if (npc.attitude) { const a = ce(row, 'span', 'te-muted-text'); a.textContent = npc.attitude; a.style.fontSize = '.82rem'; }
        if (npc.motivation) { const m = ce(row, 'span', 'te-muted-text'); m.textContent = `"${npc.motivation}"`; m.style.fontSize = '.82rem'; m.style.fontStyle = 'italic'; m.style.flex = '1'; }
      });
    };
    npcSIn.addEventListener('input', () => { npcSearch.q = npcSIn.value; rebuildNpcs(); });
    rebuildNpcs();
  } else {
    ce(npcLookWrap, 'p', 'te-empty-state', 'No NPCs in the active campaign.');
  }

  // ── Active Quests ─────────────────────────────────────────────────────────
  sectionHead(main, '📋 Active Quests');
  const questWrap = ce(main, 'div', '');
  const activeQuests = safeArr(state.entities.quests).filter(q => q.status === 'Active' && (!state.activeCampaignId || q.campaignId === state.activeCampaignId));
  if (activeQuests.length) {
    const qg = ce(questWrap, 'div', 'te-grid');
    activeQuests.slice(0, 12).forEach(q => {
      const c = ce(qg, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head');
      ce(h, 'span', 'te-card-icon', ENTITY_ICONS.quests || '📋');
      ce(h, 'h3', 'te-card-title', q.name);
      if (q.questType) { const m = ce(h, 'span', 'te-card-meta-label', q.questType); m.style.marginLeft = '6px'; }
      if (q.summary) ce(c, 'p', 'te-card-body', q.summary.slice(0, 100));
      const objs = safeArr(q.objectives);
      if (objs.length) {
        const ol = ce(c, 'ul', ''); ol.style.cssText = 'margin:4px 0 0 16px;padding:0;font-size:.82rem;color:var(--te-muted)';
        objs.slice(0, 3).forEach(obj => { const li = ce(ol, 'li', ''); li.textContent = typeof obj === 'string' ? obj : (obj.text || ''); });
        if (objs.length > 3) ce(ol, 'li', 'te-muted-text', `+ ${objs.length - 3} more`);
      }
    });
  } else {
    ce(questWrap, 'p', 'te-empty-state', 'No active quests. Mark a quest as Active in the Quest Tracker.');
  }

  // ── Conditions Reference ──────────────────────────────────────────────────
  sectionHead(main, '⚡ Conditions Reference');
  const condWrap = ce(main, 'div', 'te-card'); condWrap.style.padding = '12px';
  const condLoading = ce(condWrap, 'p', 'te-muted-text', 'Loading conditions…');
  plugin.refData.get('conditions').then(allConds => {
    condLoading.remove();
    if (!allConds.length) { ce(condWrap, 'p', 'te-empty-state', 'Conditions data not loaded. Ensure data/conditions.json is present.'); return; }
    const condList = ce(condWrap, 'div', '');
    let condExpanded = null;
    const renderConds = () => {
      clear(condList);
      allConds.forEach(cond => {
        const row = ce(condList, 'div', '');
        row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--te-border)';
        const headRow = ce(row, 'div', '');
        headRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:2px 0';
        const nameEl = ce(headRow, 'strong', ''); nameEl.textContent = cond.name;
        const isOpen = condExpanded === cond.name;
        const arrow = ce(headRow, 'span', 'te-muted-text'); arrow.textContent = isOpen ? '▲' : '▼'; arrow.style.fontSize = '.75rem';
        if (isOpen) {
          const body = ce(row, 'div', ''); body.style.cssText = 'padding:4px 8px;font-size:.85rem;color:var(--te-text)';
          renderEntries(body, cond.entries);
        }
        headRow.addEventListener('click', () => { condExpanded = isOpen ? null : cond.name; renderConds(); });
      });
    };
    renderConds();
  });

  // ── Session Event Log ─────────────────────────────────────────────────────
  sectionHead(main, '📋 Session Event Log');
  const sess = state.activeSessionId ? safeArr(state.entities.sessions).find(s => s.id === state.activeSessionId) : null;
  if (sess) {
    if (!Array.isArray(sess.eventLog)) sess.eventLog = [];
    const logWrap = ce(main, 'div', 'te-card'); logWrap.style.padding = '12px';
    const EVENT_TYPES = ['Note','NPC Met','Location Visited','Quest Advanced','Secret Revealed','Loot Awarded','Combat Started','Combat Ended','Player Decision','Consequence','Timer Advanced','Next Hook'];
    let evtType = 'Note';
    const typeRow = ce(logWrap, 'div', 'te-card-actions'); typeRow.style.flexWrap = 'wrap';
    EVENT_TYPES.forEach(t => {
      const b = btn(typeRow, t, 'te-btn is-sm' + (t === evtType ? ' is-primary' : ''), () => {
        evtType = t;
        Array.from(typeRow.querySelectorAll('button')).forEach((bb,i) => bb.className = 'te-btn is-sm' + (EVENT_TYPES[i] === t ? ' is-primary' : ''));
      });
    });
    const addRow = ce(logWrap, 'div', 'te-chip-add-row'); addRow.style.marginTop = '8px';
    const evtInp = ce(addRow, 'input'); evtInp.type = 'text'; evtInp.placeholder = 'Event note…'; evtInp.style.flex = '1';
    btn(addRow, 'Add', 'te-btn is-primary', async () => {
      const text = evtInp.value.trim(); if (!text) return;
      sess.eventLog.push({ type: evtType, text, time: new Date().toISOString() });
      evtInp.value = '';
      upsert(state, 'sessions', sess); await plugin.saveState();
      renderLog();
    });
    evtInp.addEventListener('keydown', e => { if (e.key === 'Enter') addRow.querySelector('button').click(); });
    const logList = ce(logWrap, 'div', ''); logList.style.marginTop = '8px';
    const renderLog = () => {
      clear(logList);
      const events = [...sess.eventLog].reverse();
      if (!events.length) { ce(logList, 'p', 'te-empty-state', 'No events yet. Add notes above.'); return; }
      events.forEach((evt, i) => {
        const row = ce(logList, 'div', 'te-card-meta-row');
        row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--te-border);font-size:.85rem';
        const lbl = ce(row, 'span', 'te-card-meta-label'); lbl.textContent = evt.type;
        ce(row, 'span', '', evt.text);
        const t = ce(row, 'span', 'te-muted-text'); t.style.marginLeft = 'auto'; t.textContent = evt.time ? new Date(evt.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      });
    };
    renderLog();
  } else {
    ce(main, 'p', 'te-empty-state', 'Start a session to enable the event log.');
  }
}

// ── WAR MACHINE (Phase 11) ────────────────────────────────────────────────────
function renderWarMachine(main, plugin) {
  pageHead(main, plugin, 'War Machine', 'Enemy templates, escalation timers, and hostile force management.', [
    { label: '+ Enemy Template', primary: true, onClick: () => new EnemyTemplateModal(plugin.app, plugin).open() },
    { label: '+ Timer', onClick: () => new TimerModal(plugin.app, plugin).open() },
  ]);

  sectionHead(main, 'Escalation Timers');
  const timers = safeArr(plugin.state.entities.timers).filter(t => matchesSearch(t, plugin.state.search));
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
      [['Status', t.status], ['Faction', t.faction], ['Consequence', t.consequence]].forEach(([k, v]) => { if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v).slice(0, 80)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, '+Tick', 'te-btn is-sm is-run', async () => { t.currentTick = Math.min(maxTicks, curTicks + 1); upsert(plugin.state, 'timers', t); await plugin.saveState(); });
      btn(a, 'Edit', 'te-btn is-sm', () => new TimerModal(plugin.app, plugin, t).open());
      btn(a, 'Reset', 'te-btn is-sm', async () => { t.currentTick = 0; upsert(plugin.state, 'timers', t); await plugin.saveState(); });
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'timers', t.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No timers yet.', 'Escalation timers track ticking threats and countdown events.'); }

  sectionHead(main, 'Enemy Templates');
  const templates = safeArr(plugin.state.entities.enemyTemplates).filter(t => matchesSearch(t, plugin.state.search));
  if (templates.length) {
    const g = ce(main, 'div', 'te-grid');
    templates.forEach(t => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '⚔️'); ce(h, 'h3', 'te-card-title', t.name);
      if (t.summary) ce(c, 'p', 'te-card-body', (t.summary || '').slice(0, 100));
      const meta = ce(c, 'div', 'te-card-meta');
      [['CR', t.cr], ['Type', t.type], ['Faction', t.faction], ['Role', t.role], ['AC', t.ac], ['HP', t.hp]].forEach(([k, v]) => { if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', String(v)); });
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new EnemyTemplateModal(plugin.app, plugin, t).open());
      btn(a, 'Add to Encounter', 'te-btn is-sm is-primary', () => { plugin.state.activeSection = 'encounters'; plugin.saveState(); });
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(plugin.state, 'enemyTemplates', t.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No enemy templates.', 'Build reusable enemy stat blocks for your factions and encounters.'); }
}

// ── FACTION MATRIX (Phase 12) ─────────────────────────────────────────────────
function renderFactionMatrix(main, plugin) { renderRelationshipMatrix(main, plugin); }
function renderRelationshipMatrix(main, plugin) {
  const state = plugin.state;
  const allRels = safeArr(state.relationships);

  pageHead(main, plugin, 'Relationship Matrix', 'Map connections between factions, NPCs, PCs, noble families, settlements, and quests.', [
    { label: '+ Relationship', primary: true, onClick: () => new RelationshipModal(plugin.app, plugin).open() },
    { label: '+ Noble Family', onClick: () => new NobleFamilyModal(plugin.app, plugin).open() },
    { label: '+ Faction', onClick: () => new FactionModal(plugin.app, plugin).open() },
  ]);

  // Helper to resolve entity name from type + id
  const resolveName = (type, id) => {
    const arr = safeArr(state.entities[type]);
    const ent = arr.find(x => x.id === id);
    return ent ? (ent.name || ent.title || id) : id;
  };

  // ── All relationships ──────────────────────────────────────────────────────
  sectionHead(main, `All Relationships (${allRels.length})`);
  if (allRels.length) {
    // Group filter buttons
    const filterRow = ce(main, 'div', 'te-card-actions'); filterRow.style.marginBottom = '10px';
    const filters = ['All','NPC','Faction','PC','Noble Family','Settlement'];
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
  sectionHead(main, 'Noble Families & Houses');
  const nobles = safeArr(state.entities.nobleFamilies).filter(x => matchesSearch(x, state.search));
  if (nobles.length) {
    const ng = ce(main, 'div', 'te-grid');
    nobles.forEach(nf => {
      const c = ce(ng, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🏰'); ce(h, 'h3', 'te-card-title', nf.name || 'Untitled');
      if (nf.motto) ce(c, 'p', 'te-card-body', `"${nf.motto}"`);
      const meta = ce(c, 'div', 'te-card-meta');
      [['Status', nf.status], ['Holdings', (nf.holdings || '').slice(0, 60)]].forEach(([k, v]) => {
        if (!v) return; const r = ce(meta, 'div', 'te-card-meta-row'); ce(r, 'span', 'te-card-meta-label', k); ce(r, 'span', '', v);
      });
      const acts = ce(c, 'div', 'te-card-actions');
      btn(acts, 'Edit', 'te-btn is-sm', () => new NobleFamilyModal(plugin.app, plugin, nf).open());
      btn(acts, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(state, 'nobleFamilies', nf.id); await plugin.saveState(); });
    });
  } else { emptyState(main, 'No noble families yet.', 'Use "+ Noble Family" to add houses.'); }

  // ── Faction Reputation ─────────────────────────────────────────────────────
  sectionHead(main, 'Faction Reputation');
  const factions = safeArr(state.entities.factions);
  const reps = safeArr(state.entities.reputations).filter(x => matchesSearch(x, state.search));
  if (reps.length) {
    const g = ce(main, 'div', 'te-grid');
    reps.forEach(rep => {
      const fac = factions.find(f => f.id === rep.factionId);
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '⭐'); ce(h, 'h3', 'te-card-title', fac ? fac.name : 'Unknown Faction');
      const lvl = rep.level || 'Neutral';
      const lvlIdx = OPTION_BANKS.reputationLevels.indexOf(lvl);
      const lvlPct = Math.max(5, ((OPTION_BANKS.reputationLevels.length - 1 - lvlIdx) / (OPTION_BANKS.reputationLevels.length - 1)) * 100);
      const pb = ce(c, 'div', 'te-progress-bar'); const pf = ce(pb, 'div', 'te-progress-fill'); pf.style.width = lvlPct + '%';
      ce(c, 'p', 'te-progress-label', `Reputation: ${lvl}`);
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Edit', 'te-btn is-sm', () => new GenericModal(plugin.app, plugin, 'reputations', rep, reputationFields).open());
      btn(a, 'Delete', 'te-btn is-sm is-danger', async () => { removeItem(state, 'reputations', rep.id); await plugin.saveState(); });
    });
  }
  btn(ce(main, 'div', 'te-modal-actions'), '+ Add Reputation', 'te-btn', () => {
    const rep = { id: uid('rep'), name: 'Party Reputation', factionId: factions[0]?.id || '', level: 'Neutral', notes: '' };
    new GenericModal(plugin.app, plugin, 'reputations', rep, reputationFields).open();
  });
}

// ── ENDGAME (Phase 19) ────────────────────────────────────────────────────────
function renderEndgame(main, plugin) {
  const state = plugin.state;
  pageHead(main, plugin, 'Endgame & Realm Tracker', 'War fronts, realm incursions, broken cosmology reveals, and ending states.', [
    { label: '+ War Front', onClick: () => new GenericModal(plugin.app, plugin, 'warFronts', null, warFrontFields).open() },
    { label: '+ Incursion', onClick: () => new GenericModal(plugin.app, plugin, 'incursions', null, incursionFields).open() },
    { label: '+ Ending State', primary: true, onClick: () => new GenericModal(plugin.app, plugin, 'endgameStates', null, endgameStateFields).open() },
  ]);

  sectionHead(main, 'War Fronts');
  itemCards(main, plugin, 'warFronts', { meta: ['type', 'status', 'faction', 'location'], hint: 'Add war fronts to track active conflicts across your realm.' });

  sectionHead(main, 'Realm Incursions');
  itemCards(main, plugin, 'incursions', { meta: ['type', 'status', 'origin', 'threat'], hint: 'Track planar incursions and realm-scale threats.' });

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
  { key: 'factionId', label: 'Faction ID', type: 'text' },
  { key: 'level', label: 'Reputation Level', type: 'select', options: ['Exalted','Revered','Honoured','Friendly','Neutral','Unfriendly','Hostile','Hated'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
const warFrontFields = [
  { key: 'name', label: 'War Front Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Active Front','Stalemate','Advance','Retreat','Siege','Guerrilla Campaign','Ceasefire','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Active','Escalating','Stalemate','Cooling Down','Resolved'] },
  { key: 'faction', label: 'Primary Faction', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'strength', label: 'Enemy Strength', type: 'text' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const incursionFields = [
  { key: 'name', label: 'Incursion Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Raid','Occupation','Corruption Spread','Portal Opening','Army Advance','Arcane Storm','Other'] },
  { key: 'status', label: 'Status', type: 'select', options: ['Emerging','Active','Critical','Contained','Repelled'] },
  { key: 'origin', label: 'Origin', type: 'text' },
  { key: 'threat', label: 'Threat Level', type: 'select', options: ['Low','Medium','High','Critical','Existential'] },
  { key: 'progress', label: 'Current Progress', type: 'text' },
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
  { key: 'ruler', label: 'Ruler / Leader', type: 'text' },
  { key: 'capital', label: 'Capital', type: 'text' },
  { key: 'government', label: 'Government', type: 'text' },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'military', label: 'Military Strength', type: 'text' },
  { key: 'economy', label: 'Economy', type: 'text' },
  { key: 'allies', label: 'Allies (chip)', type: 'chip' },
  { key: 'enemies', label: 'Enemies (chip)', type: 'chip' },
  { key: 'history', label: 'History', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const religionFields = [
  { key: 'name', label: 'Religion Name', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Monotheistic','Polytheistic','Animistic','Druidic','Ancestor Worship','Cult','Secret Society','Philosophical','Other'] },
  { key: 'deity', label: 'Primary Deity / Focus', type: 'text' },
  { key: 'alignment', label: 'Alignment', type: 'select', options: ALIGNMENTS },
  { key: 'domain', label: 'Domain / Aspect', type: 'text' },
  { key: 'practices', label: 'Practices & Rituals', type: 'textarea' },
  { key: 'symbols', label: 'Symbols (chip)', type: 'chip' },
  { key: 'holyDays', label: 'Holy Days', type: 'text' },
  { key: 'clergy', label: 'Clergy / Hierarchy', type: 'text' },
  { key: 'temples', label: 'Temples / Holy Sites (chip)', type: 'chip' },
  { key: 'restrictions', label: 'Taboos & Restrictions', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const districtFields = [
  { key: 'name', label: 'District Name', type: 'text' },
  { key: 'settlementId', label: 'Settlement', type: 'text' },
  { key: 'type', label: 'Type', type: 'select', options: ['Market','Residential','Noble Quarter','Docks','Temple District','Slums','Military','Industrial','Foreign Quarter','Ruined','Underground','Other'] },
  { key: 'population', label: 'Population', type: 'text' },
  { key: 'atmosphere', label: 'Atmosphere', type: 'text' },
  { key: 'notableLocations', label: 'Notable Locations (chip)', type: 'chip' },
  { key: 'factions', label: 'Active Factions (chip)', type: 'chip' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const roomFields = [
  { key: 'name', label: 'Room Name', type: 'text' },
  { key: 'locationId', label: 'Location / Dungeon', type: 'text' },
  { key: 'type', label: 'Room Type', type: 'select', options: ['Entrance','Corridor','Chamber','Guard Post','Secret Room','Boss Chamber','Treasure Room','Trap Room','Rest Area','Shrine','Prison','Workshop','Library','Other'] },
  { key: 'features', label: 'Features (chip)', type: 'chip' },
  { key: 'traps', label: 'Traps', type: 'textarea' },
  { key: 'loot', label: 'Loot / Treasure', type: 'textarea' },
  { key: 'connections', label: 'Connected Rooms (chip)', type: 'chip' },
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
  { key: 'linkedSessionId', label: 'Linked Session', type: 'text' },
  { key: 'summary', label: 'Notes', type: 'textarea' },
];
const revealFields = [
  { key: 'name', label: 'Reveal Name', type: 'text' },
  { key: 'secretId', label: 'Related Secret', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['Pending','Delivered','Deflected','Spoiled','Skipped'] },
  { key: 'session', label: 'Delivery Session', type: 'text' },
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
  { key: 'encounterId', label: 'Source Encounter', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['Available','Claimed','Sold','Lost','Destroyed'] },
  { key: 'claimedBy', label: 'Claimed By', type: 'text' },
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
  settlements: settlementFields,
  locations: locationFields,
  pois: poiFields,
  routes: routeFields,
  adventures: adventureFields,
  rules: ruleFields,
  downtime: downtimeFields,
  bastions: bastionFields,
  milestones: milestoneFields,
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
  nobleFamilies: [
    { key: 'name', label: 'House / Family Name', type: 'text' },
    { key: 'motto', label: 'House Motto', type: 'text' },
    { key: 'headOfHouse', label: 'Head of House', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: ['Ruling','Noble','Gentry','Declining','Exiled','Extinct','Unknown'] },
    { key: 'holdings', label: 'Holdings & Titles', type: 'textarea' },
    { key: 'claims', label: 'Claims & Disputes', type: 'textarea' },
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
  btn(hpWrap, 'Set HP', 'te-btn is-sm', async () => { const v = parseInt(hpInp.value); if (!isNaN(v)) { char.hp = v; upsert(state, 'characters', char); await plugin.saveState(); } });
  btn(hpWrap, '-1', 'te-btn is-sm is-danger', async () => { char.hp = Math.max(0, (parseInt(char.hp) || 0) - 1); upsert(state, 'characters', char); await plugin.saveState(); });
  btn(hpWrap, '+1', 'te-btn is-sm', async () => { char.hp = Math.min(parseInt(char.maxHp) || 999, (parseInt(char.hp) || 0) + 1); upsert(state, 'characters', char); await plugin.saveState(); });

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
          upsert(state, 'characters', char); await plugin.saveState();
        });
      }
    });
    btn(dsWrap, 'Reset', 'te-btn is-sm is-danger', async () => { char.deathSaves = { successes: 0, failures: 0 }; upsert(state, 'characters', char); await plugin.saveState(); });
  }

  const a = ce(c, 'div', 'te-card-actions');
  btn(a, 'Full Edit', 'te-btn is-sm is-primary', () => new CharacterModal(plugin.app, plugin, char).open());
  btn(a, '💤 Long Rest', 'te-btn is-sm', async () => { char.hp = char.maxHp || char.hp; upsert(state, 'characters', char); await plugin.saveState(); new Notice('Long Rest — HP restored.'); });
  btn(a, 'Sync Note', 'te-btn is-sm', () => writeEntityNote(plugin, 'characters', char));
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
    inp.addEventListener('change', async () => { if (!char.currency) char.currency = {}; char.currency[coin] = parseInt(inp.value) || 0; upsert(state, 'characters', char); await plugin.saveState(); });
  });

  sectionHead(main, 'Equipment & Items');
  const items = safeArr(char.equipment);
  if (items.length) {
    const g = ce(main, 'div', 'te-grid');
    items.forEach((item, i) => {
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head'); ce(h, 'span', 'te-card-icon', '🎒'); ce(h, 'h3', 'te-card-title', item);
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Remove', 'te-btn is-sm is-danger', async () => { char.equipment = char.equipment.filter((_, j) => j !== i); upsert(state, 'characters', char); await plugin.saveState(); });
    });
  }
  const addRow = ce(main, 'div', ''); addRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap';
  const inp = ce(addRow, 'input'); inp.type = 'text'; inp.placeholder = 'Item name…'; inp.style.flex = '1';
  btn(addRow, '+ Add', 'te-btn is-sm is-primary', async () => {
    const v = inp.value.trim();
    if (v) { if (!char.equipment) char.equipment = []; char.equipment.push(v); upsert(state, 'characters', char); await plugin.saveState(); inp.value = ''; }
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
      const carried = safeArr(char.equipment).includes(eq.name);
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
          if (!char.equipment) char.equipment = []; char.equipment.push(eq.name); upsert(state, 'characters', char); await plugin.saveState(); new Notice(`"${eq.name}" added to inventory.`);
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
        upsert(state, 'characters', char); await plugin.saveState();
      });
    }
    const maxInp = ce(row, 'input'); maxInp.type = 'number'; maxInp.min = '0'; maxInp.max = '9'; maxInp.value = String(slotData.max || 0);
    maxInp.title = 'Set maximum slots';
    maxInp.style.cssText = 'width:46px;font-size:.82rem;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm);padding:2px 6px;text-align:center';
    maxInp.addEventListener('change', async () => {
      if (!char.spellSlots) char.spellSlots = {};
      const newMax = Math.max(0, Math.min(9, parseInt(maxInp.value) || 0));
      char.spellSlots[lvl] = { max: newMax, used: Math.min(newMax, (char.spellSlots[lvl] || {}).used || 0) };
      upsert(state, 'characters', char); await plugin.saveState();
    });
  }
  const resetRow = ce(main, 'div', ''); resetRow.style.marginBottom = '16px';
  btn(resetRow, '↺ Long Rest — Reset Slots', 'te-btn is-sm', async () => {
    if (char.spellSlots) { Object.keys(char.spellSlots).forEach(k => { char.spellSlots[k].used = 0; }); }
    upsert(state, 'characters', char); await plugin.saveState(); new Notice('Spell slots reset (Long Rest).');
  });

  // Known Spells (from char.spells array)
  sectionHead(main, `${char.name}'s Known / Prepared Spells`);
  const knownSpells = safeArr(char.spells);
  const allRefSpells = await plugin.refData.get('spells');
  if (knownSpells.length) {
    const g = ce(main, 'div', 'te-grid');
    knownSpells.forEach((spellName, i) => {
      const refSpell = allRefSpells.find(s => s.name.toLowerCase() === spellName.toLowerCase());
      const c = ce(g, 'div', 'te-card');
      const h = ce(c, 'div', 'te-card-head');
      ce(h, 'span', 'te-card-icon', '✨');
      ce(h, 'h3', 'te-card-title', spellName);
      if (refSpell) { const m = ce(h, 'span', 'te-card-meta-label', refItemMeta('spells', refSpell)); m.style.marginLeft = '6px'; }
      if (refSpell) {
        const detail = ce(c, 'div', 'te-ref-detail'); detail.style.display = 'none';
        refItemDetail(detail, 'spells', refSpell);
        h.style.cursor = 'pointer';
        h.addEventListener('click', () => { detail.style.display = detail.style.display === 'none' ? '' : 'none'; });
      }
      const a = ce(c, 'div', 'te-card-actions');
      btn(a, 'Remove', 'te-btn is-sm is-danger', async () => {
        char.spells = char.spells.filter((_, j) => j !== i); upsert(state, 'characters', char); await plugin.saveState(); new Notice(`"${spellName}" removed.`);
      });
    });
  } else {
    ce(main, 'p', 'te-empty-state', 'No spells added yet. Browse the spell list below to add spells.');
  }

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
      const known = knownSpells.some(n => n.toLowerCase() === sp.name.toLowerCase());
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
          if (!char.spells) char.spells = []; if (!char.spells.includes(sp.name)) { char.spells.push(sp.name); upsert(state, 'characters', char); await plugin.saveState(); new Notice(`"${sp.name}" added to spellbook.`); }
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
function renderHybridAncestry(main, plugin) {
  const state = plugin.state;
  const isPC = state.mode === 'PLAYER';
  const all = safeArr(state.entities.hybridAncestries);
  const visible = isPC ? all.filter(h => h.visibility === 'player-visible') : all;
  if (!isPC) {
    pageHead(main, plugin, '🧬 Hybrid Ancestry Builder', 'Design and balance custom mixed-heritage ancestries for PCs and NPCs.', [
      { label: '+ New Hybrid', primary: true, onClick: () => new HybridAncestryModal(plugin.app, plugin).open() },
    ]);
    const sg = ce(main, 'div', 'te-stat-grid');
    const approved = all.filter(h => h.approvalStatus === 'DM Approved');
    const pending = all.filter(h => !h.approvalStatus || h.approvalStatus === 'Pending Review');
    [['Total Hybrids', all.length], ['DM Approved', approved.length], ['Pending Review', pending.length]].forEach(([l, v]) => {
      const sc = ce(sg, 'div', 'te-stat-card'); ce(sc, 'div', 'te-stat-big', v); ce(sc, 'div', 'te-stat-label', l);
    });
  } else {
    pageHead(main, plugin, '🧬 Hybrid Ancestry', 'Player-visible hybrid ancestries shared by your DM.');
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
    addCampaignPicker(s1, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(s1, 'Name *', this.values.name, v => this.values.name = v);
    addField(s1, 'Pronouns', this.values.pronouns, v => this.values.pronouns = v);
    const raceIn = new Setting(s1).setName('Race / Ancestry').addText(t => {
      const list = contentEl.createEl('datalist');
      list.id = `npc-race-${this.values.id}`;
      const hybridNames = safeArr(this.plugin.state.entities.hybridAncestries).map(h => h.name).filter(Boolean);
      [...ANCESTRIES, ...hybridNames].forEach(a => { const opt = list.createEl('option'); opt.value = a; });
      t.inputEl.setAttribute('list', list.id);
      t.setValue(this.values.race || '');
      t.onChange(v => this.values.race = v);
    });
    addField(s1, 'Role / Title', this.values.role, v => this.values.role = v);
    addField(s1, 'Occupation', this.values.occupation, v => this.values.occupation = v);
    addSelect(s1, 'Status', this.values.status, ['Alive','Dead','Missing','Captured','Unknown','Retired'], v => this.values.status = v);
    addEntityPicker(s1, 'Location', this.values.locationId, this.plugin, 'settlements', v => this.values.locationId = v);
    addEntityMultiPicker(s1, 'Faction(s)', this.values.factionIds, this.plugin, 'factions', v => this.values.factionIds = v);

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
      visibility: 'dm-only', tags: [], campaignId: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Creature` });
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
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
      linkedFactions: [], linkedQuests: [], visibility: 'dm-only', campaignId: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} BBEG / Major Villain` });
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
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
      leadership: '', leaderNpcId: '', campaignId: '',
      goals: [], methods: [], resources: '', ranks: [],
      allies: [], allyIds: [], enemies: [], enemyIds: [],
      publicFace: '', secretAgenda: '',
      reputation: '', rewards: '', consequences: '', visibility: 'dm-only',
      staffRoles: [],
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Faction` });
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(contentEl, 'Faction Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Faction Type', this.values.type || 'Criminal', ['Criminal','Political','Religious','Military','Mercantile','Academic','Secret Society','Resistance','Cult','Guild','Noble House','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addField(contentEl, 'Ideology', this.values.ideology, v => this.values.ideology = v, 'textarea');
    addField(contentEl, 'Territory', this.values.territory, v => this.values.territory = v);
    addEntityPicker(contentEl, 'Leader NPC', this.values.leaderNpcId, this.plugin, 'npcs', v => this.values.leaderNpcId = v);
    addField(contentEl, 'Leadership (text)', this.values.leadership, v => this.values.leadership = v);
    chipField(contentEl, 'Goals', this.values.goals, v => this.values.goals = v);
    chipField(contentEl, 'Methods', this.values.methods, v => this.values.methods = v);
    addField(contentEl, 'Resources', this.values.resources, v => this.values.resources = v, 'textarea');
    chipField(contentEl, 'Ranks / Titles', this.values.ranks, v => this.values.ranks = v);
    addEntityMultiPicker(contentEl, 'Allied Factions', this.values.allyIds, this.plugin, 'factions', v => this.values.allyIds = v);
    addEntityMultiPicker(contentEl, 'Enemy Factions', this.values.enemyIds, this.plugin, 'factions', v => this.values.enemyIds = v);
    addField(contentEl, 'Public Face', this.values.publicFace, v => this.values.publicFace = v, 'textarea');
    addField(contentEl, 'Secret Agenda', this.values.secretAgenda, v => this.values.secretAgenda = v, 'textarea');
    addField(contentEl, 'Reputation', this.values.reputation, v => this.values.reputation = v);

    const sSt = ce(contentEl, 'div', 'te-modal-section');
    sSt.createEl('h3', { text: 'Staff & Roles' });
    ce(sSt, 'p', 'te-progress-label', 'Track key personnel. Format: Name — Role (Rank)');
    chipField(sSt, 'Staff / Roles', safeArr(this.values.staffRoles), v => this.values.staffRoles = v,
      { suggestions: ['Leader','Second-in-command','Quartermaster','Spy','Recruiter','Agent','Informant','Commander','Diplomat','Treasurer','Enforcer','Defector'] });

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
      giver: '', giverNpcId: '', location: '', locationId: '', campaignId: '',
      relatedNPCs: [], relatedNpcIds: [], relatedFactions: [], relatedFactionIds: [],
      objectives: '', stages: '', hooks: [], complications: [],
      rewards: '', consequences: '', secrets: '', playerSummary: '', dmNotes: '',
      linkedEncounters: [], linkedEncounterIds: [], visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Quest` });
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(contentEl, 'Quest Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Quest Type', this.values.questType, ['Main','Side','Personal','Faction','Investigation','Escort','Retrieval','Elimination','Exploration','Social','Other'], v => this.values.questType = v);
    addSelect(contentEl, 'Status', this.values.status, ['Available','Active','Completed','Failed','Abandoned'], v => this.values.status = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addEntityPicker(contentEl, 'Quest Giver (NPC)', this.values.giverNpcId, this.plugin, 'npcs', v => this.values.giverNpcId = v);
    addEntityPicker(contentEl, 'Location', this.values.locationId, this.plugin, 'settlements', v => this.values.locationId = v);
    addEntityMultiPicker(contentEl, 'Related NPCs', this.values.relatedNpcIds, this.plugin, 'npcs', v => this.values.relatedNpcIds = v);
    addEntityMultiPicker(contentEl, 'Related Factions', this.values.relatedFactionIds, this.plugin, 'factions', v => this.values.relatedFactionIds = v);
    addField(contentEl, 'Objectives', this.values.objectives, v => this.values.objectives = v, 'textarea');
    addField(contentEl, 'Stages / Steps', this.values.stages, v => this.values.stages = v, 'textarea');
    chipField(contentEl, 'Hooks', this.values.hooks, v => this.values.hooks = v);
    chipField(contentEl, 'Complications', this.values.complications, v => this.values.complications = v);
    addField(contentEl, 'Rewards', this.values.rewards, v => this.values.rewards = v, 'textarea');
    addField(contentEl, 'Consequences (failure)', this.values.consequences, v => this.values.consequences = v, 'textarea');
    addField(contentEl, 'Player-Visible Summary', this.values.playerSummary, v => this.values.playerSummary = v, 'textarea');
    addField(contentEl, 'DM Notes (hidden)', this.values.secrets, v => this.values.secrets = v, 'textarea');
    addEntityMultiPicker(contentEl, 'Linked Encounters', this.values.linkedEncounterIds, this.plugin, 'encounters', v => this.values.linkedEncounterIds = v);
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
      id: uid('encounter'), name: '', type: 'Combat', location: '', locationId: '',
      participants: [], participantPcIds: [], participantNpcIds: [], enemyGroups: '', difficulty: 'Medium',
      terrain: '', tactics: '', objectives: '',
      victoryConditions: '', failureConditions: '', rewards: '',
      linkedQuest: '', linkedQuestId: '', campaignId: '',
      notes: '', visibility: 'dm-only',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Encounter` });
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(contentEl, 'Encounter Name *', this.values.name, v => this.values.name = v);
    addSelect(contentEl, 'Encounter Type', this.values.type, ['Combat','Social','Exploration','Trap','Chase','Hazard','Skill Challenge','Puzzle','Boss Fight','Other'], v => this.values.type = v);
    addSelect(contentEl, 'Difficulty', this.values.difficulty, ['Trivial','Easy','Medium','Hard','Deadly','Mythic'], v => this.values.difficulty = v);
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    addEntityPicker(contentEl, 'Location', this.values.locationId, this.plugin, 'settlements', v => this.values.locationId = v);
    addEntityMultiPicker(contentEl, 'PC Participants', this.values.participantPcIds, this.plugin, 'characters', v => this.values.participantPcIds = v);
    addEntityMultiPicker(contentEl, 'NPC Participants', this.values.participantNpcIds, this.plugin, 'npcs', v => this.values.participantNpcIds = v);
    addField(contentEl, 'Enemy Groups', this.values.enemyGroups, v => this.values.enemyGroups = v, 'textarea');
    addField(contentEl, 'Terrain', this.values.terrain, v => this.values.terrain = v);
    addField(contentEl, 'Tactics', this.values.tactics, v => this.values.tactics = v, 'textarea');
    addField(contentEl, 'Objectives', this.values.objectives, v => this.values.objectives = v, 'textarea');
    addField(contentEl, 'Victory Conditions', this.values.victoryConditions, v => this.values.victoryConditions = v, 'textarea');
    addField(contentEl, 'Failure Conditions', this.values.failureConditions, v => this.values.failureConditions = v, 'textarea');
    addField(contentEl, 'Rewards / Loot', this.values.rewards, v => this.values.rewards = v, 'textarea');
    addEntityPicker(contentEl, 'Linked Quest', this.values.linkedQuestId, this.plugin, 'quests', v => this.values.linkedQuestId = v);
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
      relatedEntities: [], revealTrigger: '', revealStatus: 'Hidden',
      content: '', dmNotes: '', visibility: 'secret', campaignId: '',
    }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl);
    contentEl.addClass('te-modal');
    contentEl.createEl('h2', { text: `${this.item.id ? 'Edit' : 'New'} Secret` });
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
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
      if (this.ModalClass) {
        this.close();
        new this.ModalClass(this.plugin.app, this.plugin, this.draft).open();
      } else {
        const d = { ...this.draft, id: uid(this.entityKey) };
        upsert(this.plugin.state, this.entityKey, d);
        await this.plugin.saveState();
        new Notice(`${this.generatorLabel} saved.`);
        this.close();
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
    btn(typeRow, 'Entity Array', 'te-btn' + (this._importType === 'entities' ? ' is-primary' : ''), () => setType('entities'));
    btn(typeRow, 'Full Backup', 'te-btn' + (this._importType === 'backup' ? ' is-primary' : ''), () => setType('backup'));

    if (this._importType === 'entities') {
      addSelect(s1, 'Target Entity Type', this.key, Object.keys(ENTITY_LABELS), v => this.key = v);
    }

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Paste JSON' });
    const ta = ce(s2, 'textarea');
    ta.placeholder = this._importType === 'backup' ? 'Paste full backup JSON…' : 'Paste JSON array of entities…';
    ta.rows = 8; ta.style.cssText = 'width:100%;resize:vertical;padding:8px;background:var(--te-bg);color:var(--te-text);border:1px solid var(--te-border);border-radius:var(--te-r-sm)';
    if (this.payload) ta.value = this.payload;
    ta.addEventListener('input', () => { this.payload = ta.value; this._parsed = null; });

    const previewBox = ce(contentEl, 'div', 'te-result-box');
    previewBox.style.cssText = 'margin:8px 0;padding:10px;background:var(--te-bg-alt);border-radius:var(--te-r-md);font-size:.82rem;white-space:pre-wrap;max-height:120px;overflow-y:auto';
    previewBox.textContent = 'Paste JSON above, then click Preview.';

    btn(s2, '🔍 Preview', 'te-btn', () => {
      try {
        const raw = JSON.parse(this.payload);
        if (this._importType === 'backup') {
          const state = raw.state || raw;
          const counts = Object.entries(state.entities || {}).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${k}: ${v.length}`);
          previewBox.textContent = `Backup v${raw.version || '?'}, ${raw.timestamp || '?'}\n\nEntities:\n${counts.join('\n')}`;
          this._parsed = raw;
        } else {
          const arr = Array.isArray(raw) ? raw : [raw];
          previewBox.textContent = `${arr.length} item(s) → ${this.key}\n\nFirst item: ${arr[0]?.name || arr[0]?.title || JSON.stringify(arr[0]).slice(0, 80)}`;
          this._parsed = arr;
        }
      } catch (e) { previewBox.textContent = `JSON parse error: ${e.message}`; this._parsed = null; }
    });

    const btnRow = ce(contentEl, 'div', 'te-modal-buttons');
    btn(btnRow, 'Cancel', 'te-btn', () => this.close());
    btn(btnRow, '✅ Import', 'te-btn is-primary', async () => {
      if (!this._parsed) { new Notice('Click Preview first to validate the JSON.'); return; }
      // Safety backup before import
      await exportBackup(this.plugin);
      if (this._importType === 'backup') {
        const src = this._parsed.state || this._parsed;
        if (!src.entities) { new Notice('Invalid backup format — no entities found.'); return; }
        let imported = 0;
        for (const [k, arr] of Object.entries(src.entities)) {
          if (Array.isArray(arr)) { arr.forEach(x => { upsert(this.plugin.state, k, x); imported++; }); }
        }
        await this.plugin.saveState();
        new Notice(`Imported ${imported} entities from backup. A safety backup was saved first.`);
      } else {
        this._parsed.forEach(x => upsert(this.plugin.state, this.key, Object.assign({ id: uid(this.key), name: 'Imported Entry' }, x)));
        await this.plugin.saveState();
        new Notice(`Imported ${this._parsed.length} item(s) into ${this.key}. A safety backup was saved first.`);
      }
      this.close();
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
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addTypedEntityPicker(contentEl, 'From',
      this.values.fromEntityType, this.values.fromId, this.plugin,
      v => this.values.fromEntityType = v, v => this.values.fromId = v);
    addTypedEntityPicker(contentEl, 'To',
      this.values.toEntityType, this.values.toId, this.plugin,
      v => this.values.toEntityType = v, v => this.values.toId = v);
    addSelect(contentEl, 'Relationship Type', this.values.relationshipType, RELATIONSHIP_TYPES, v => this.values.relationshipType = v);
    addSelect(contentEl, 'Attitude', this.values.attitude, ['Allied','Friendly','Neutral','Suspicious','Hostile','Enemy','Unknown'], v => this.values.attitude = v);
    addField(contentEl, 'Influence / Power Dynamic', this.values.influence, v => this.values.influence = v);
    addField(contentEl, 'Trust Level', this.values.trust, v => this.values.trust = v);
    addField(contentEl, 'Fear / Leverage', this.values.fear, v => this.values.fear = v);
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    addField(contentEl, 'DM Notes (hidden)', this.values.dmNotes, v => this.values.dmNotes = v, 'textarea');
    addSelect(contentEl, 'Visibility', this.values.visibility, ['dm-only','player-visible','secret'], v => this.values.visibility = v);
    modalButtons(contentEl, this, async () => {
      if (!this.values.fromId || !this.values.toId) { new Notice('Both From and To entities must be selected.'); return; }
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
      addField(featSection, 'Feat Name', this.featChosen, v => this.featChosen = v);
      ce(featSection, 'p', 'te-card-body', 'Enter the feat name. Use the 5e Reference section to look up prerequisites.');
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

    // Class features note
    const sFeats = ce(contentEl, 'div', 'te-modal-section');
    sFeats.createEl('h3', { text: 'Class Features' });
    ce(sFeats, 'p', 'te-card-body', `Check your ${this.cls || 'class'} description for features gained at level ${this.toLevel}. Use the 5e Reference section to find class features.`);
    addField(sFeats, 'Features / Notes (optional)', '', v => this._featureNotes = v);

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

      const histEntry = {
        fromLevel: this.fromLevel, toLevel: this.toLevel,
        date: new Date().toISOString().slice(0,10),
        hpGain, hpMethod: this.hpChoice,
        asiChoice: this.asiChoice, asiApplied,
        featChosen: this.asiChoice === 'feat' ? (this.featChosen || '') : '',
        spellsAdded: this.spellsAdded,
        featureNotes: this._featureNotes || '',
      };
      this.levelHistory.push(histEntry);
      this.char.levelHistory = this.levelHistory;
      upsert(this.plugin.state, 'characters', this.char);
      await this.plugin.saveState();
      const asiMsg = Object.keys(asiApplied).length ? ` ASI applied: ${Object.entries(asiApplied).map(([k,v])=>`+${v} ${k.toUpperCase()}`).join(', ')}.` : '';
      new Notice(`${this.char.name} is now level ${this.toLevel}! Max HP +${hpGain}.${asiMsg}`, 8000);
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
      id: uid('char'), name: '', race: '', class: '', background: '', level: 1, alignment: 'True Neutral',
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      hp: 0, maxHp: 0, tempHp: 0, ac: 10, speed: '30 ft',
      skills: [], savingThrows: [], features: [], spells: [],
      equipment: [], currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
      xp: 0, spellSlots: {}, deathSaves: { successes: 0, failures: 0 },
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
      const hybridNames = safeArr(this.plugin.state.entities.hybridAncestries).map(h => h.name).filter(Boolean);
      [...ANCESTRIES, ...hybridNames].forEach(a => { const o = dl.createEl('option'); o.value = a; });
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
    addNumber(s3, 'Experience Points (XP)', this.values.xp || 0, v => this.values.xp = v);

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
        const card = ce(tGrid, 'div', 'te-trait-chip' + (isOn ? ' is-active' : ''));
        card.setAttribute('role', 'checkbox');
        card.setAttribute('aria-checked', String(isOn));
        card.setAttribute('tabindex', '0');
        card.style.cursor = 'pointer';
        const nameRow = ce(card, 'div', ''); nameRow.style.cssText = 'font-size:.84rem;font-weight:600';
        nameRow.textContent = trait.name;
        const tierBadge = ce(nameRow, 'span', 'te-muted-text'); tierBadge.textContent = ` (+${tier})`;
        ce(card, 'p', 'te-trait-desc', trait.desc);
        const toggle = () => {
          const active = card.getAttribute('aria-checked') === 'true';
          const next = !active;
          card.setAttribute('aria-checked', String(next));
          card.classList.toggle('is-active', next);
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
    addField(s6, 'Dominant Culture', this.values.dominantCulture, v => this.values.dominantCulture = v);
    addField(s6, 'Recessive Culture', this.values.recessiveCulture, v => this.values.recessiveCulture = v);
    addField(s6, 'Raised In', this.values.raisedCulture, v => this.values.raisedCulture = v);
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
    addField(s8, 'Linked Note Path', this.values.linkedNotePath, v => this.values.linkedNotePath = v);

    // Action row
    const actRow = ce(contentEl, 'div', 'te-card-actions');
    actRow.style.cssText = 'flex-wrap:wrap;gap:6px;margin:12px 0';
    btn(actRow, 'Use for New PC', 'te-btn is-sm', () => {
      if (!this.values.name.trim()) { new Notice('Enter an ancestry name first.'); return; }
      new CharacterModal(this.plugin.app, this.plugin, { race: this.values.name }).open();
    });
    btn(actRow, 'Use for New NPC', 'te-btn is-sm', () => {
      if (!this.values.name.trim()) { new Notice('Enter an ancestry name first.'); return; }
      new NPCModal(this.plugin.app, this.plugin, { race: this.values.name }).open();
    });
    btn(actRow, 'Save as Homebrew', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Name required first.'); return; }
      const hb = { id: uid('homebrew'), name: this.values.name, category: 'Race / Ancestry', content: this._toMarkdown(), tags: ['hybrid','ancestry'], visibility: this.values.visibility, createdAt: new Date().toISOString() };
      upsert(this.plugin.state, 'homebrew', hb);
      await this.plugin.saveState();
      new Notice(`Homebrew entry "${hb.name}" created.`);
    });
    btn(actRow, 'Save as Compendium', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Name required first.'); return; }
      const entry = { id: uid('comp'), name: this.values.name, category: 'Ancestry', content: this._toMarkdown(), tags: ['hybrid'], visibility: 'player-visible', createdAt: new Date().toISOString() };
      upsert(this.plugin.state, 'compendium', entry);
      await this.plugin.saveState();
      new Notice(`Compendium entry "${entry.name}" created.`);
    });
    btn(actRow, 'Export Player-Safe', 'te-btn is-sm', async () => {
      if (!this.values.name.trim()) { new Notice('Save the hybrid first.'); return; }
      const folder = campaignFolder(this.plugin);
      await ensureFolder(this.plugin.app, folder);
      const fname = this.values.name.replace(/[\\/:*?"<>|]/g, '_');
      await writeNote(this.plugin.app, `${folder}/${fname}-ancestry.md`, this._toMarkdown(true));
      new Notice(`Player-safe ancestry note exported.`);
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
      structureNotes: '', campaignLoops: [], factionNames: [], secretSummary: '', playerPrimer: '',
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
    addField(el, 'Milestone Notes (e.g. Level up at each major arc)', this.data.bible.notes, v => this.data.bible.notes = v, 'textarea');
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
    // Create DM secret
    if (d.secretSummary) {
      upsert(this.plugin.state, 'secrets', { id: uid('secret'), name: `Campaign Secret — ${d.name}`, summary: d.secretSummary, visibility: 'dm-only', campaignId: d.id });
    }
    // Create folder structure
    if (d.createFolders) {
      const folder = slugify(d.name);
      for (const sub of ['NPCs','Quests','Encounters','Sessions','Secrets','Handouts','Factions','Regions','Settlements','Compendium','Backups']) {
        await ensureFolder(this.plugin.app, `${folder}/${sub}`);
      }
    }
    // Create starter note
    if (d.startingNote) {
      const folder = slugify(d.name);
      let md = `# ${d.name}\n\n> ${d.tagline || ''}\n\n## Premise\n\n${d.premise || ''}\n\n`;
      if (d.playerPrimer) md += `## Player Primer\n\n${d.playerPrimer}\n\n`;
      md += `## Rules Baseline\n\n- **Ruleset:** ${d.ruleset}\n- **Levels:** ${d.levelRange}\n- **Levelling:** ${d.levellingMethod}\n- **Rests:** ${d.restRules}\n`;
      await writeNote(this.plugin.app, `${folder}/${slugify(d.name)}.md`, md);
    }
    await this.plugin.saveState();
    new Notice(`Campaign "${d.name}" created!`, 5000);
    this.close();
    this.plugin.state.activeSection = 'campaigns';
    this.plugin.refreshViews();
  }
}

// ── CampaignBibleModal (Phase 7) ──────────────────────────────────────────────
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
    this.titleEl.setText('Campaign Bible');
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
    s2.createEl('h3', { text: 'Act Structure' });
    const acts = Array.isArray(b.acts) ? b.acts : [];
    const actList = ce(s2, 'div', '');
    const renderActs = () => {
      clear(actList);
      acts.forEach((act, i) => {
        const row = ce(actList, 'div', ''); row.style.cssText = 'border:1px solid var(--te-border);border-radius:var(--te-r-sm);padding:10px;margin-bottom:8px';
        addField(row, `Act ${i + 1} Title`, act.title || '', v => { act.title = v; });
        addField(row, 'Summary', act.summary || '', v => { act.summary = v; }, 'textarea');
        btn(row, '× Remove', 'te-btn is-sm is-danger', () => { acts.splice(i, 1); renderActs(); });
      });
    };
    renderActs();
    btn(s2, '+ Add Act', 'te-btn is-sm', () => { acts.push({ title: '', summary: '' }); b.acts = acts; renderActs(); });

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Player Primer' });
    addField(s3, 'Player-safe intro for Session Zero / player packet', b.playerPrimer, v => b.playerPrimer = v, 'textarea');

    const s4 = ce(contentEl, 'div', 'te-modal-section');
    s4.createEl('h3', { text: 'DM Notes' });
    addField(s4, 'Internal DM notes', b.notes, v => b.notes = v, 'textarea');

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
    this.values = Object.assign({ id: uid('dungeon'), name: '', type: 'Ancient Ruins', summary: '', threatLevel: '', boss: '', rooms: [], visibility: 'dm-only', notes: '' }, this.item);
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
    addField(s1, 'Boss / Key Enemy', this.values.boss, v => this.values.boss = v);
    addEntityPicker(s1, 'Linked Region', this.values.regionId, this.plugin, 'regions', v => this.values.regionId = v);
    addCampaignPicker(s1, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addSelect(s1, 'Visibility', this.values.visibility, ['dm-only','player-visible'], v => this.values.visibility = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Rooms & Keyed Areas' });
    const rooms = Array.isArray(this.values.rooms) ? this.values.rooms : [];
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
    btn(s2, '+ Add Room', 'te-btn is-sm', () => { rooms.push({ name: '', type: 'Chamber', description: '', enemies: '', treasure: '' }); this.values.rooms = rooms; renderRooms(); });

    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Dungeon name is required.'); return; }
      this.values.rooms = rooms;
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
    this.values = Object.assign({ id: uid('timer'), name: '', summary: '', faction: '', status: 'Active', maxTicks: 6, currentTick: 0, consequence: '', escalationSteps: [], notes: '' }, this.item);
  }
  onOpen() {
    const { contentEl } = this;
    clear(contentEl); contentEl.addClass('te-modal');
    this.titleEl.setText(this.item.id ? 'Edit Escalation Timer' : 'New Escalation Timer');
    addField(contentEl, 'Timer Name *', this.values.name, v => this.values.name = v);
    addField(contentEl, 'Summary / What this represents', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(contentEl, 'Faction / Owner', this.values.faction, v => this.values.faction = v);
    addSelect(contentEl, 'Status', this.values.status, ['Active','Paused','Triggered','Complete'], v => this.values.status = v);
    addNumber(contentEl, 'Max Ticks (stages)', this.values.maxTicks, v => this.values.maxTicks = v);
    addNumber(contentEl, 'Current Tick', this.values.currentTick, v => this.values.currentTick = v);
    addField(contentEl, 'Final Consequence (when timer fires)', this.values.consequence, v => this.values.consequence = v, 'textarea');
    chipField(contentEl, 'Escalation Actions per Tick', safeArr(this.values.escalationSteps), v => this.values.escalationSteps = v, { bank: 'escalationActions', placeholder: 'Action at this tick…' });
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);
    addField(contentEl, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Timer name is required.'); return; }
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
    this.values = Object.assign({ id: uid('enemy'), name: '', type: 'Humanoid', size: 'Medium', cr: '', ac: '', hp: '', speed: '', alignment: 'Neutral Evil', faction: '', role: 'Frontline', tactics: [], traits: [], actions: [], summary: '', notes: '' }, this.item);
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
    addField(s1, 'Hit Points', this.values.hp, v => this.values.hp = v);
    addField(s1, 'Speed', this.values.speed, v => this.values.speed = v);
    addSelect(s1, 'Alignment', this.values.alignment, ALIGNMENTS, v => this.values.alignment = v);

    const s2 = ce(contentEl, 'div', 'te-modal-section');
    s2.createEl('h3', { text: 'Faction & Role' });
    addEntityPicker(s2, 'Faction', this.values.factionId, this.plugin, 'factions', v => this.values.factionId = v);
    addField(s2, 'Faction Tag (manual)', this.values.faction, v => this.values.faction = v);
    addSelect(s2, 'Combat Role', this.values.role, OPTION_BANKS.combatRoles, v => this.values.role = v);
    chipField(s2, 'Tactics', safeArr(this.values.tactics), v => this.values.tactics = v, { bank: 'tactics' });

    const s3 = ce(contentEl, 'div', 'te-modal-section');
    s3.createEl('h3', { text: 'Traits & Actions' });
    chipField(s3, 'Special Traits', safeArr(this.values.traits), v => this.values.traits = v, { placeholder: 'Trait name…' });
    chipField(s3, 'Actions', safeArr(this.values.actions), v => this.values.actions = v, { placeholder: 'Attack or action…' });
    addField(s3, 'Summary', this.values.summary, v => this.values.summary = v, 'textarea');
    addField(s3, 'Notes', this.values.notes, v => this.values.notes = v, 'textarea');
    addCampaignPicker(contentEl, 'Campaign', this.values.campaignId, this.plugin, v => this.values.campaignId = v);

    modalButtons(contentEl, this, async () => {
      if (!this.values.name.trim()) { new Notice('Enemy name is required.'); return; }
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
    option('👤', 'All NPCs', 'Sync all NPCs as individual Markdown notes.', async () => {
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


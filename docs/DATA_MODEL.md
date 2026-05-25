# Data Model

The current plugin state is persisted through Obsidian's plugin data API.

## Top-level state areas

- `version`
- `mode`
- `activeSection`
- `sidebarCollapsed`
- `activeCampaignId`
- `search`
- `calendar`
- `settings`
- `initiativeTracker`
- `tileMap`
- `playerTab`
- `entities`
- `relationships`
- `generatorHistory`
- `diceHistory`
- `workspace`
- `sessionRunMode`
- `activeSessionId`
- `activeCharacterId`

## Main entity collections

- campaigns
- worlds
- cosmologies
- realms
- regions
- settlements
- locations
- pois
- routes
- npcs
- creatures
- bbegs
- factions
- cultures
- languages
- deities
- pantheons
- quests
- adventures
- encounters
- sessions
- milestones
- secrets
- handouts
- rules
- conditions
- damageTypes
- downtime
- projects
- bastions
- compendium
- homebrew
- tables
- characters
- calendars
- journals
- maps
- dungeons
- timers
- enemyTemplates
- reputations
- warFronts
- incursions
- endgameStates

## Rule

Tabs and modals should not own truth. The state layer owns truth.

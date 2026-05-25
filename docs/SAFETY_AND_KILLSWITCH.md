# Safety and Kill Switch

The current plugin includes safety files that can block plugin loading or force a safe state.

## Kill-switch files

Inside the installed plugin folder:

```txt
.obsidian/plugins/ttrpg-engine/DISABLE_TTRPG_ENGINE.txt
.obsidian/plugins/ttrpg-engine/TTRPG_ENGINE_DISABLED.txt
.obsidian/plugins/ttrpg-engine/SAFE_MODE.txt
```

If one of these files exists, the plugin should avoid normal boot behaviour.

## Crash-lock files

```txt
.obsidian/plugins/ttrpg-engine/TTRPG_ENGINE_BOOTING.txt
.obsidian/plugins/ttrpg-engine/TTRPG_ENGINE_LOAD_FAILED.txt
.obsidian/plugins/ttrpg-engine/TTRPG_ENGINE_LAST_CRASH.txt
```

## Recovery steps

1. Close Obsidian.
2. Open the installed plugin folder.
3. Remove `TTRPG_ENGINE_LOAD_FAILED.txt` if you are ready to retry.
4. Remove `SAFE_MODE.txt` if you want normal loading.
5. Reopen Obsidian.

## Design rule

Safe mode should load only the minimum needed commands: diagnostics, backup, clear crash lock, disable safe mode, and repair/reindex.

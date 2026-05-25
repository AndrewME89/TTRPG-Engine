# Refactor Map

This document maps the current monolith into the future clean architecture.

## `src/core/`

Move:

- plugin class
- boot lifecycle
- kill switch helpers
- crash lock helpers
- logging
- constants

## `src/state/`

Move:

- `createDefaultState`
- `migrateState`
- `upsert`
- `removeItem`
- diagnostics
- backup/export backup

## `src/ui/`

Move:

- `ce`
- `btn`
- `clear`
- `pageHead`
- `sectionHead`
- `emptyState`
- `itemCards`
- sidebar/topbar rendering

## `src/tabs/`

Move each `render*` section into a separate file.

## `src/modals/`

Move modal classes and form helpers.

## `src/maps/`

Move all tile map builder logic and tile asset scanning.

## `src/data/`

Move option banks, D&D lists, defaults, and schemas.

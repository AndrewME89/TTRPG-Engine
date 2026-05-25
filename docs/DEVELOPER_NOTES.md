# Developer Notes

## Current architecture

The current plugin runtime is a large CommonJS file. This is not ideal, but it is preserved because it currently contains the working feature set.

## Refactor principle

Do not refactor by deleting. Extract one stable section at a time.

Good extraction order:

1. Constants and utilities.
2. State/defaults/migration.
3. Safety helpers.
4. Generic UI helpers.
5. Render tabs.
6. Modals.
7. Tile map builder.

Bad extraction order:

- Splitting everything at once.
- Converting to TypeScript before boundaries are stable.
- Deleting legacy state compatibility because it looks ugly.

Ugly compatibility code is still better than user data loss.

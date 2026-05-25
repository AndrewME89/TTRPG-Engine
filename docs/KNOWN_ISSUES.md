# Known Issues

- Runtime is still a large JavaScript monolith.
- UI is not yet split into modules.
- Automated tests are scaffolded but not implemented.
- `styles.css` is theme-compliant overall, but a few hardcoded fallback colours remain for safety/danger text and canvas export internals.
- Tile assets are loaded from the installed plugin folder, so release packaging/copying matters.

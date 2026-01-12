# Changelog

## [0.0.1] - 2026-01-12

### Added
- TextMate injection grammar to highlight `@layer` in SCSS.
- Highlighting for cascade layer names after `@layer` (including dotted names like `utilities.buttons`) using theme-native scopes.
- Hover tooltip for `@layer` with a short explanation and examples.
- Hover tooltip for cascade layer names in both forms:
  - `@layer reset, tokens, base;`
  - `@layer utilities { ... }`
- Workspace-wide detection of layer order declarations (`@layer ...;`) using stable VS Code APIs.
- Layer name hover includes:
  - Position in declared order (e.g. `6 / 7`)
  - Declared order line with the hovered layer **bolded**
  - Clickable link to jump to the order declaration file/line.
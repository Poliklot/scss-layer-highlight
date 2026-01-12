# SCSS @layer Highlight

Highlights **CSS Cascade Layers** (`@layer`) in **SCSS** (and CSS) and adds helpful **hover tooltips**:
- documentation for `@layer`
- layer name info (including order and navigation to the declaration)

## Features

### Syntax highlighting (theme-native)
- Highlights `@layer` as an at-rule keyword.
- Highlights layer names after `@layer`, including:
  - Single name: `@layer utilities;`
  - Multiple names: `@layer theme, layout, utilities;`
  - Dotted names: `@layer utilities.buttons;`

> The extension intentionally uses common TextMate scopes so your editor theme controls the colors.

### Hover tooltips
- Hover on `@layer` shows quick docs + examples + MDN link.
- Hover on a **layer name** shows:
  - `Cascade layer name: <name>`
  - `Order in this list: X / N` (when an order is declared)
  - The declared order line with the hovered name **bolded**
  - A clickable link to jump to the order declaration (`@layer ...;`)

Works for both:
```scss
@layer reset, tokens, base, layout, components, utilities, overrides;
```

and:
```scss
@layer utilities {
  .btn { /* ... */ }
}
```

## How order is detected

The extension scans your workspace for `@layer ...;` **order declarations** and uses the best match for the hovered layer name:
- Prefer a declaration that **includes** the hovered layer.
- If multiple exist, prefer the one with the **largest** list.
- If none are found, it falls back to the local list on the current line.

The scan uses stable APIs only (`workspace.findFiles` + `workspace.fs.readFile`), so it is safe for Marketplace builds.

## Theming / Colors

This extension uses common scopes so colors come from your theme “natively”:
- `@layer` → `keyword.control.at-rule.layer.css`
- layer names → `entity.name.type.css`

If you want to override styles anyway:

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    {
      "scope": "keyword.control.at-rule.layer.css",
      "settings": { "fontStyle": "bold" }
    },
    {
      "scope": "entity.name.type.css",
      "settings": { "fontStyle": "underline" }
    }
  ]
}
```

## Troubleshooting

### Highlighting doesn’t work in my SCSS files
Your SCSS grammar root scope may differ.

1. Open an `.scss` file
2. Run: **Developer: Inspect Editor Tokens and Scopes**
3. Click somewhere in the file
4. Check the top-most scope (often `source.css.scss`, sometimes `source.scss`)

If your root scope is `source.scss`, update the injection targets:
- `package.json`: add `"source.scss"` to `injectTo`
- grammar: add `L:source.scss` to `injectionSelector`

### Performance notes
The workspace scan:
- runs once on activation
- re-runs on file save
- ignores large files and common build folders (`node_modules`, `dist`, etc.)

## Development

Install dependencies:
```bash
npm i
```

Package a VSIX:
```bash
npx vsce package
```

Run locally in VS Code:
- Open this project in VS Code
- Press `F5` to launch the Extension Development Host

## License
MIT

Made with ❤️ by [Poliklot](https://github.com/Poliklot)
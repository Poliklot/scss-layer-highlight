const vscode = require("vscode");

/** ---------- Parsing helpers ---------- */

function findAtLayerRange(lineText) {
  const m = /@layer\b/i.exec(lineText);
  if (!m) return null;
  return { start: m.index, end: m.index + m[0].length };
}

function findPreludeEnd(lineText, fromIndex) {
  const brace = lineText.indexOf("{", fromIndex);
  const semi = lineText.indexOf(";", fromIndex);
  if (brace === -1 && semi === -1) return lineText.length;
  if (brace === -1) return semi;
  if (semi === -1) return brace;
  return Math.min(brace, semi);
}

function isCursorInLayerPrelude(lineText, cursorCharacter) {
  const atLayer = findAtLayerRange(lineText);
  if (!atLayer) return false;
  const preludeEnd = findPreludeEnd(lineText, atLayer.end);
  return cursorCharacter >= atLayer.start && cursorCharacter <= preludeEnd;
}

function findLayerNames(lineText, searchFromIndex, searchToIndex) {
  const prelude = lineText.slice(searchFromIndex, searchToIndex);
  const nameRe = /-?[_a-zA-Z][\w-]*(?:\.-?[_a-zA-Z][\w-]*)*/g;

  const names = [];
  let m;
  while ((m = nameRe.exec(prelude))) {
    const absStart = searchFromIndex + m.index;
    const absEnd = absStart + m[0].length;
    names.push({ name: m[0], start: absStart, end: absEnd });
  }
  return names;
}

function parseLayerList(listText) {
  return listText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatDeclaredOrderBold(order, highlightName) {
  const parts = order.map((n) => (n === highlightName ? `**${n}**` : n));
  return `@layer ${parts.join(", ")};`;
}

/** ---------- Workspace order cache (stable APIs only) ---------- */

const decoder = new TextDecoder("utf-8");

// Candidates: multiple "@layer ...;" statements across workspace
// We’ll pick the “best” one for a given layer name.
let workspaceCandidates = []; // { order: string[], loc: { uri, line, char }, preview: string }
let scanPromise = null;
let scanTimer = null;

function scheduleWorkspaceScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanPromise = scanWorkspaceForOrder().catch(() => {
      // swallow errors; hover will just fallback
    });
  }, 200);
}

async function ensureWorkspaceScan() {
  if (!scanPromise) {
    scanPromise = scanWorkspaceForOrder().catch(() => {});
  }
  await scanPromise;
}

function countLineChar(text, index) {
  // Compute (line, char) from absolute index
  let line = 0;
  let lastNl = -1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, char: index - (lastNl + 1) };
}

function makePreview(statement) {
  // Keep it readable & short
  return statement
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function scanWorkspaceForOrder() {
  workspaceCandidates = [];

  // Scan common style files; exclude big folders
  const include = "**/*.{scss,css,sass}";
  const exclude = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**,**/out/**,**/coverage/**}";
  const uris = await vscode.workspace.findFiles(include, exclude, 2000);

  const re = /@layer\s+([^;{]+);/gi;

  for (const uri of uris) {
    let bytes;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      continue;
    }

    // Skip huge files (e.g. generated)
    if (bytes.byteLength > 1_500_000) continue;

    const text = decoder.decode(bytes);

    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const listPart = m[1];
      const names = parseLayerList(listPart);
      if (!names.length) continue;

      // Normalize order: keep first occurrence of each name
      const order = [];
      for (const n of names) if (!order.includes(n)) order.push(n);

      const statement = m[0];
      const pos = countLineChar(text, m.index);

      workspaceCandidates.push({
        order,
        loc: { uri, line: pos.line, char: pos.char },
        preview: makePreview(statement)
      });
    }
  }
}

function pickBestCandidateForLayer(layerName) {
  if (!workspaceCandidates.length) return null;

  // Prefer candidates that explicitly contain the hovered layer.
  const containing = workspaceCandidates
    .filter((c) => c.order.includes(layerName))
    .sort((a, b) => b.order.length - a.order.length);

  if (containing.length) return containing[0];

  // Otherwise fallback to the “largest” order statement in workspace
  const sorted = [...workspaceCandidates].sort((a, b) => b.order.length - a.order.length);
  return sorted[0] || null;
}

/** ---------- Command link to jump to declaration ---------- */

const OPEN_DECL_CMD = "scssLayerHighlight.openOrderDeclaration";

function makeOpenDeclarationLink(candidate) {
  if (!candidate?.loc) return null;

  const args = [
    {
      uri: candidate.loc.uri.toString(),
      line: candidate.loc.line,
      character: candidate.loc.char
    }
  ];

  const cmdUri = vscode.Uri.parse(
    `command:${OPEN_DECL_CMD}?${encodeURIComponent(JSON.stringify(args))}`
  );

  const fileName = candidate.loc.uri.path.split("/").pop() || "file";
  const line1 = (candidate.loc.line ?? 0) + 1;

  return { cmdUri, label: `${fileName}:${line1}` };
}

/** ---------- Hover builders ---------- */

function makeAtLayerHover() {
  const md = new vscode.MarkdownString();
  md.appendMarkdown("**CSS Cascade Layers — `@layer`**\n\n");
  md.appendMarkdown(
    "Defines cascade layers and helps control override order between groups of styles.\n\n"
  );
  md.appendMarkdown("**Examples:**\n");
  md.appendCodeblock(
    "@layer theme, layout, utilities;\n\n@layer utilities {\n  /* styles */\n}\n\n@layer {\n  /* anonymous layer */\n}",
    "css"
  );
  md.appendMarkdown(
    "\nTip: layer names can be comma-separated and can be dotted (e.g. `utilities.buttons`).\n"
  );
  md.appendMarkdown("\n[MDN: @layer](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer)\n");
  return md;
}

function makeLayerNameHover(name, candidate, localFallbackOrder) {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  md.appendMarkdown(`**Cascade layer name:** \`${name}\`\n\n`);

  const order = candidate?.order?.length ? candidate.order : localFallbackOrder;
  const idx = order.indexOf(name);

  if (idx !== -1 && order.length > 1) {
    md.appendMarkdown(`Order in this list: **${idx + 1} / ${order.length}**\n\n`);
    md.appendMarkdown(
      "This list establishes a layer order for the stylesheet. Later layers generally win over earlier layers when specificity is equal.\n\n"
    );

    md.appendMarkdown("**Declared order:**\n\n");
    md.appendMarkdown(`${formatDeclaredOrderBold(order, name)}\n\n`);

    // Jump link + preview
    if (candidate) {
      const link = makeOpenDeclarationLink(candidate);
      if (link) {
        md.appendMarkdown(`**Order declared in:** [${link.label}](${link.cmdUri})\n\n`);
      }
      if (candidate.preview) {
        md.appendMarkdown("**Declaration preview:**\n\n");
        md.appendCodeblock(candidate.preview, "scss");
      }
    }
  } else {
    md.appendMarkdown(
      "This is a named cascade layer. You can declare an explicit order using a comma-separated list.\n\n"
    );
    md.appendCodeblock("@layer reset, tokens, base, layout, components, utilities, overrides;", "css");
  }

  md.appendMarkdown("\n[MDN: @layer](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer)\n");
  return md;
}

/** ---------- Extension entry ---------- */

function activate(context) {
  // Command used by hover links
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_DECL_CMD, async (arg) => {
      if (!arg?.uri) return;
      const uri = vscode.Uri.parse(arg.uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      const pos = new vscode.Position(arg.line ?? 0, arg.character ?? 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    })
  );

  // Initial scan + refresh on save
  scheduleWorkspaceScan();
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      scheduleWorkspaceScan();
    })
  );

  const hoverProvider = vscode.languages.registerHoverProvider(
    [{ language: "scss" }, { language: "css" }],
    {
      async provideHover(document, position) {
        const line = document.lineAt(position.line).text;
        if (!isCursorInLayerPrelude(line, position.character)) return;

        const atLayer = findAtLayerRange(line);
        if (!atLayer) return;

        const preludeEnd = findPreludeEnd(line, atLayer.end);
        const localNames = findLayerNames(line, atLayer.end, preludeEnd);

        // Hover on "@layer"
        if (position.character >= atLayer.start && position.character <= atLayer.end) {
          const range = new vscode.Range(position.line, atLayer.start, position.line, atLayer.end);
          return new vscode.Hover(makeAtLayerHover(), range);
        }

        // Hover on a layer name
        const hit = localNames.find(
          (n) => position.character >= n.start && position.character <= n.end
        );
        if (!hit) return;

        // Ensure workspace scan finished (first hover after launch)
        await ensureWorkspaceScan();

        const candidate = pickBestCandidateForLayer(hit.name);
        const fallbackOrder = localNames.map((n) => n.name);
        const range = new vscode.Range(position.line, hit.start, position.line, hit.end);

        return new vscode.Hover(
          makeLayerNameHover(hit.name, candidate, fallbackOrder),
          range
        );
      }
    }
  );

  context.subscriptions.push(hoverProvider);
}

function deactivate() {}

module.exports = { activate, deactivate };

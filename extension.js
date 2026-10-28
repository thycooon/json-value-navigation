const vscode = require("vscode");

/** @type {vscode.TextDocument | null} */
let __doc = null;
/** @type {Map<number, vscode.Position>} */
let __posCache = new Map();

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("jsonValueNavigation.next", () => navigate(1)),
    vscode.commands.registerCommand("jsonValueNavigation.previous", () => navigate(-1)),
    vscode.window.onDidChangeActiveTextEditor(() => {
      __doc = null;
      __posCache = new Map();
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

// ──────────────────────────────────────────────────────────
// Navigation entry point
// ──────────────────────────────────────────────────────────

/**
 * @param {number} direction  1 = next, -1 = previous
 */
function navigate(direction) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (editor.document.languageId !== "json" && editor.document.languageId !== "jsonc") return;

  const document = editor.document;
  const text = document.getText();

  // Reset position cache if document changed
  if (__doc !== document) {
    __doc = document;
    __posCache = new Map();
  }

  // Parse
  /** @type {{ root: JsonNode | null }} */
  let parsed;
  try {
    parsed = parseJsonTree(text);
  } catch {
    return;
  }
  if (!parsed.root) return;

  // Read settings
  const cfg = vscode.workspace.getConfiguration("jsonValueNavigation");
  /** @type {{ enterNestedContainers: boolean, iterateContainerItems: boolean, minNestingLevel: number }} */
  const opts = {
    enterNestedContainers: /** @type {boolean} */ (cfg.get("enterNestedContainers", false)),
    iterateContainerItems: /** @type {boolean} */ (cfg.get("iterateContainerItems", false)),
    minNestingLevel: Math.max(0, /** @type {number} */ (cfg.get("minNestingLevel", 0)))
  };

  // Build targets
  const targets = buildNavigationValues(parsed.root, opts);
  if (targets.length === 0) return;

  // Find the right target relative to cursor
  const cursorOffset = document.offsetAt(editor.selection.active);

  /** @type {number} */
  let targetIndex = -1;
  if (direction === 1) {
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].startOffset > cursorOffset) {
        targetIndex = i;
        break;
      }
    }
  } else {
    for (let i = targets.length - 1; i >= 0; i--) {
      if (targets[i].endOffset < cursorOffset) {
        targetIndex = i;
        break;
      }
    }
  }
  if (targetIndex === -1) return;

  const t = targets[targetIndex];
  const range = new vscode.Range(
    posAt(document, t.rangeStart),
    posAt(document, t.rangeEnd)
  );

  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

// ──────────────────────────────────────────────────────────
// Target-building logic (core)
// ──────────────────────────────────────────────────────────

/**
 * @typedef {{ startOffset: number, endOffset: number, rangeStart: number, rangeEnd: number }} Target
 *   startOffset / endOffset – full JSON value extent (incl. quotes/brackets) – used for navigation
 *   rangeStart / rangeEnd   – actual visual selection (without quotes/brackets)
 */

/**
 * @param {JsonNode} root
 * @param {{ enterNestedContainers: boolean, iterateContainerItems: boolean, minNestingLevel: number }} opts
 * @returns {Target[]}
 */
function buildNavigationValues(root, opts) {
  /** @type {Target[]} */
  const out = [];
  collect(root, opts, out);
  out.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  return out;
}

/**
 * Recursively collect navigation targets.
 *
 * @param {JsonNode} node
 * @param {{ enterNestedContainers: boolean, iterateContainerItems: boolean, minNestingLevel: number }} opts
 * @param {Target[]} out
 */
function collect(node, opts, out) {
  const isContainer = node.type === "object" || node.type === "array";

  // --- Below minimum nesting level: container → transparent, primitive → skip ---
  if (node.depth < opts.minNestingLevel) {
    if (isContainer) {
      const children = node.children || [];
      for (const c of children) collect(c, opts, out);
    }
    return;
  }

  // --- At or above minimum nesting level ---
  if (node.type === "string") {
    const rStart = node.start + 1;
    const rEnd = Math.max(rStart, node.end - 1);
    out.push({ startOffset: node.start, endOffset: node.end, rangeStart: rStart, rangeEnd: rEnd });
  } else if (node.type === "number" || node.type === "true" || node.type === "false" || node.type === "null") {
    out.push({ startOffset: node.start, endOffset: node.end, rangeStart: node.start, rangeEnd: node.end });
  } else {
    // Container (object or array)
    const children = node.children || [];

    if (!opts.enterNestedContainers) {
      const rStart = node.start + 1;
      const rEnd = Math.max(rStart, node.end - 1);
      out.push({ startOffset: node.start, endOffset: node.end, rangeStart: rStart, rangeEnd: rEnd });
    } else if (children.length === 0) {
      out.push({ startOffset: node.start, endOffset: node.end, rangeStart: node.start + 1, rangeEnd: node.start + 1 });
    } else if (!opts.iterateContainerItems) {
      const rStart = node.start + 1;
      const rEnd = Math.max(rStart, node.end - 1);
      out.push({ startOffset: node.start, endOffset: node.end, rangeStart: rStart, rangeEnd: rEnd });
    } else {
      for (const c of children) collect(c, opts, out);
    }
  }
}

// ──────────────────────────────────────────────────────────
// Position helper (cached)
// ──────────────────────────────────────────────────────────

/**
 * @param {vscode.TextDocument} doc
 * @param {number} offset
 * @returns {vscode.Position}
 */
function posAt(doc, offset) {
  let p = __posCache.get(offset);
  if (!p) {
    p = doc.positionAt(offset);
    __posCache.set(offset, p);
  }
  return p;
}

// ──────────────────────────────────────────────────────────
// JSON / JSONC tree parser
// ──────────────────────────────────────────────────────────

/**
 * @typedef {"string"|"number"|"true"|"false"|"null"|"array"|"object"} JsonType
 * @typedef {{ type: JsonType, start: number, end: number, depth: number, children?: JsonNode[] }} JsonNode
 */

/**
 * @param {string} text
 * @returns {{ root: JsonNode | null }}
 */
function parseJsonTree(text) {
  let i = 0;
  const n = text.length;

  /** @param {string} c */
  const isWS = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";

  function skipWS() {
    while (i < n) {
      if (isWS(text[i])) { i++; continue; }
      if (text[i] === "/" && i + 1 < n && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
        continue;
      }
      if (text[i] === "/" && i + 1 < n && text[i + 1] === "*") {
        i += 2;
        while (i + 1 < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      break;
    }
  }

  /**
   * Parses a string starting at position i. Returns the end offset (exclusive).
   * @returns {number}
   */
  function parseString() {
    if (text[i] !== '"') throw new Error('Expected string at ' + i);
    i++;
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") { i += 2; continue; }
      if (ch === '"') { i++; return i; }
      if (ch === "\n" || ch === "\r") throw new Error("Unterminated string");
      i++;
    }
    throw new Error("Unterminated string");
  }

  /**
   * @param {number} depth
   * @returns {JsonNode}
   */
  function parseValue(depth) {
    skipWS();
    if (i >= n) throw new Error("Unexpected end of input");
    const ch = text[i];

    if (ch === '"') {
      const strStart = i;
      const strEnd = parseString();
      return { type: "string", start: strStart, end: strEnd, depth };
    }
    if (ch === "{") return parseObject(depth);
    if (ch === "[") return parseArray(depth);

    if (ch === "t") { i += 4; return { type: "true",  start: i - 4, end: i, depth }; }
    if (ch === "f") { i += 5; return { type: "false", start: i - 5, end: i, depth }; }
    if (ch === "n") { i += 4; return { type: "null",  start: i - 4, end: i, depth }; }

    // Number
    const numStart = i;
    if (ch === "-") i++;
    while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    if (i < n && text[i] === ".") { i++; while (i < n && text[i] >= "0" && text[i] <= "9") i++; }
    if (i < n && (text[i] === "e" || text[i] === "E")) {
      i++;
      if (i < n && (text[i] === "+" || text[i] === "-")) i++;
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    }
    return { type: "number", start: numStart, end: i, depth };
  }

  /**
   * @param {number} depth
   * @returns {JsonNode}
   */
  function parseObject(depth) {
    const objStart = i;
    i++; // consume '{'
    /** @type {JsonNode[]} */
    const children = [];
    skipWS();
    if (i < n && text[i] === "}") {
      i++;
      return { type: "object", start: objStart, end: i, depth, children };
    }
    while (i < n) {
      skipWS();
      if (i >= n) break;
      parseString(); // key
      skipWS();
      if (text[i] !== ":") throw new Error("Expected ':' at " + i);
      i++;
      const child = parseValue(depth + 1);
      children.push(child);
      skipWS();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; break; }
      throw new Error("Expected ',' or '}' at " + i);
    }
    return { type: "object", start: objStart, end: i, depth, children };
  }

  /**
   * @param {number} depth
   * @returns {JsonNode}
   */
  function parseArray(depth) {
    const arrStart = i;
    i++; // consume '['
    /** @type {JsonNode[]} */
    const children = [];
    skipWS();
    if (i < n && text[i] === "]") {
      i++;
      return { type: "array", start: arrStart, end: i, depth, children };
    }
    while (i < n) {
      skipWS();
      if (i >= n) break;
      const child = parseValue(depth + 1);
      children.push(child);
      skipWS();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "]") { i++; break; }
      throw new Error("Expected ',' or ']' at " + i);
    }
    return { type: "array", start: arrStart, end: i, depth, children };
  }

  // Entry
  skipWS();
  if (i >= n) return { root: null };
  const root = parseValue(0);
  return { root };
}
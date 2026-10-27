const vscode = require("vscode");

/**
 * @typedef {{ start: vscode.Position, end: vscode.Position }} ValueRange
 */

/**
 * @typedef {"string"|"number"|"true"|"false"|"null"|"array"|"object"} JsonType
 */

/**
 * @typedef {{
 *   type: JsonType,
 *   start: number, // value start offset (opening quote/bracket/token start)
 *   end: number,   // value end offset (exclusive)
 *   children?: JsonNode[]
 * }} JsonNode
 */

/**
 * @typedef {{
 *   startOffset: number,
 *   endOffset: number,
 *   range: ValueRange
 * }} NavValue
 */

/** @type {vscode.TextDocument | null} */
let __doc = null;
/** @type {Map<number, vscode.Position> | null} */
let __posCache = null;

/**
 * @param {vscode.ExtensionContext} context
 * @returns {void}
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("jsonValueNavigation.next", () => navigate(1)),
    vscode.commands.registerCommand("jsonValueNavigation.previous", () => navigate(-1)),
    vscode.window.onDidChangeActiveTextEditor(
      /** @param {vscode.TextEditor | undefined} editor */ (editor) => {
        __doc = editor ? editor.document : null;
        __posCache = null;
      }
    )
  );
}

/** @returns {void} */
function deactivate() {}

module.exports = { activate, deactivate };

/**
 * @param {number} direction
 * @returns {void}
 */
function navigate(direction) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "json") return;

  const document = editor.document;
  const text = document.getText();
  __doc = document;
  __posCache = new Map();

  /** @type {{root: JsonNode | null, wrapperArray: JsonNode | null}} */
  let parsed;
  try {
    parsed = parseJsonTree(text);
  } catch {
    return;
  }
  if (!parsed.root) return;

  const cfg = vscode.workspace.getConfiguration("jsonValueNavigation");
  const enterNestedContainers = cfg.get("enterNestedContainers", true);
  const iterateContainerItems = cfg.get("iterateContainerItems", true);
  const ignoreTopLevelArrayWrapper = cfg.get("ignoreTopLevelArrayWrapper", true);

  const values = buildNavigationValues(parsed.root, {
    enterNestedContainers,
    iterateContainerItems,
    ignoreTopLevelArrayWrapper,
    wrapperArray: parsed.wrapperArray
  });

  if (values.length === 0) return;

  const nextSelections = editor.selections.map((selection) => {
    // stable anchor for both directions
    const anchor = selection.isEmpty ? selection.active : selection.end;
    const anchorOffset = document.offsetAt(anchor);

    const idx = direction > 0
      ? findNextIndex(values, anchorOffset)
      : findPrevIndex(values, anchorOffset);

    if (idx < 0) return selection;

    const target = values[idx];
    return new vscode.Selection(target.range.start, target.range.end);
  });

  editor.selections = nextSelections;

  if (editor.selection) {
    editor.revealRange(
      new vscode.Range(editor.selection.start, editor.selection.end),
      vscode.TextEditorRevealType.InCenter
    );
  }
}

/**
 * @param {NavValue[]} values
 * @param {number} anchorOffset
 * @returns {number}
 */
function findNextIndex(values, anchorOffset) {
  for (let i = 0; i < values.length; i++) {
    if (values[i].startOffset > anchorOffset) return i;
  }
  return -1;
}

/**
 * @param {NavValue[]} values
 * @param {number} anchorOffset
 * @returns {number}
 */
function findPrevIndex(values, anchorOffset) {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i].endOffset < anchorOffset) return i;
  }
  return -1;
}

/**
 * @param {string} text
 * @returns {{root: JsonNode | null, wrapperArray: JsonNode | null}}
 */
function parseJsonTree(text) {
  let i = 0;
  const n = text.length;

  /** @param {string} c */
  const isWS = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";

  function skipWS() {
    while (i < n && isWS(text[i])) i++;
  }

  function parseStringBounds() {
    const start = i;
    if (text[i] !== '"') throw new Error("expected string");
    i++;

    while (i < n) {
      const ch = text[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        return { start, end: i };
      }
      if (ch === "\n" || ch === "\r") throw new Error("invalid string");
      i++;
    }
    throw new Error("unterminated string");
  }

  function parseNumberNode() {
    const start = i;

    if (text[i] === "-") i++;

    if (text[i] === "0") {
      i++;
    } else {
      if (!(text[i] >= "1" && text[i] <= "9")) throw new Error("invalid number");
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    }

    if (text[i] === ".") {
      i++;
      if (!(text[i] >= "0" && text[i] <= "9")) throw new Error("invalid number");
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    }

    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!(text[i] >= "0" && text[i] <= "9")) throw new Error("invalid number");
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
    }

    /** @type {JsonNode} */
    const node = { type: "number", start, end: i };
    return node;
  }

  /**
   * @param {string} lit
   * @param {"true"|"false"|"null"} type
   * @returns {JsonNode}
   */
  function parseLiteral(lit, type) {
    const start = i;
    if (text.slice(i, i + lit.length) !== lit) throw new Error("invalid literal");
    i += lit.length;
    return { type, start, end: i };
  }

  function parseArrayNode() {
    const start = i;
    i++; // [
    skipWS();

    /** @type {JsonNode[]} */
    const children = [];

    if (text[i] === "]") {
      i++;
      return /** @type {JsonNode} */ ({ type: "array", start, end: i, children });
    }

    while (i < n) {
      skipWS();
      const v = parseValueNode();
      children.push(v);
      skipWS();

      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return /** @type {JsonNode} */ ({ type: "array", start, end: i, children });
      }
      throw new Error("invalid array");
    }

    throw new Error("unterminated array");
  }

  function parseObjectNode() {
    const start = i;
    i++; // {
    skipWS();

    /** @type {JsonNode[]} */
    const children = [];

    if (text[i] === "}") {
      i++;
      return /** @type {JsonNode} */ ({ type: "object", start, end: i, children });
    }

    while (i < n) {
      skipWS();
      parseStringBounds(); // key (ignored for nav targets)
      skipWS();
      if (text[i] !== ":") throw new Error("missing colon");
      i++;
      skipWS();

      const val = parseValueNode();
      children.push(val);

      skipWS();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return /** @type {JsonNode} */ ({ type: "object", start, end: i, children });
      }
      throw new Error("invalid object");
    }

    throw new Error("unterminated object");
  }

  function parseValueNode() {
    skipWS();
    const ch = text[i];

    if (ch === '"') {
      const s = parseStringBounds();
      return /** @type {JsonNode} */ ({ type: "string", start: s.start, end: s.end });
    }
    if (ch === "{") return parseObjectNode();
    if (ch === "[") return parseArrayNode();
    if (ch === "t") return parseLiteral("true", "true");
    if (ch === "f") return parseLiteral("false", "false");
    if (ch === "n") return parseLiteral("null", "null");
    return parseNumberNode();
  }

  skipWS();
  if (i >= n) return { root: null, wrapperArray: null };
  const root = parseValueNode();
  skipWS();
  if (i !== n) throw new Error("trailing content");

  const wrapperArray = root.type === "array" ? root : null;
  return { root, wrapperArray };
}

/**
 * @param {JsonNode} root
 * @param {{
 *   enterNestedContainers: boolean,
 *   iterateContainerItems: boolean,
 *   ignoreTopLevelArrayWrapper: boolean,
 *   wrapperArray: JsonNode | null
 * }} opts
 * @returns {NavValue[]}
 */
function buildNavigationValues(root, opts) {
  /** @type {NavValue[]} */
  const out = [];

  /**
   * @param {JsonNode} node
   */
  function visit(node) {
    if (node.type === "object") {
      const enterObject = opts.enterNestedContainers;

      if (enterObject) {
        // Enter object -> iterate its values.
        // BUT if empty object, still create a stop inside {}
        const children = node.children || [];
        if (children.length === 0) out.push(containerInnerRange(node.start, node.end));
        else children.forEach(visit);
      } else {
        // Not entering -> container itself is value target
        out.push(containerInnerRange(node.start, node.end));
      }
      return;
    }

    if (node.type === "array") {
      const isWrapper =
        !!opts.wrapperArray &&
        node.start === opts.wrapperArray.start &&
        node.end === opts.wrapperArray.end;

      const enterArray =
        (opts.enterNestedContainers && opts.iterateContainerItems) ||
        (opts.ignoreTopLevelArrayWrapper && isWrapper);

      if (enterArray) {
        // Enter array -> iterate items.
        // BUT if empty array, still create a stop inside []
        const children = node.children || [];
        if (children.length === 0) out.push(containerInnerRange(node.start, node.end));
        else children.forEach(visit);
      } else {
        // Not entering -> container itself is value target
        out.push(containerInnerRange(node.start, node.end));
      }
      return;
    }

    if (node.type === "string") {
      out.push(stringInnerRange(node.start, node.end));
      return;
    }

    // primitive
    out.push(tokenRange(node.start, node.end));
  }

  visit(root);

  out.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  return out;
}

/**
 * @param {number} startOffset
 * @param {number} endOffset
 * @returns {NavValue}
 */
function tokenRange(startOffset, endOffset) {
  return {
    startOffset,
    endOffset,
    range: {
      start: positionAtCached(startOffset),
      end: positionAtCached(endOffset)
    }
  };
}

/**
 * String value: select content only. Empty => caret between quotes.
 * @param {number} startOffset quote start
 * @param {number} endOffset quote end+1
 * @returns {NavValue}
 */
function stringInnerRange(startOffset, endOffset) {
  const innerStart = startOffset + 1;
  const innerEnd = Math.max(innerStart, endOffset - 1);
  return {
    startOffset,
    endOffset,
    range: {
      start: positionAtCached(innerStart),
      end: positionAtCached(innerEnd)
    }
  };
}

/**
 * Container value: select content only. Empty => caret between brackets.
 * @param {number} startOffset opening bracket
 * @param {number} endOffset closing bracket+1
 * @returns {NavValue}
 */
function containerInnerRange(startOffset, endOffset) {
  const innerStart = startOffset + 1;
  const innerEnd = Math.max(innerStart, endOffset - 1);
  return {
    startOffset,
    endOffset,
    range: {
      start: positionAtCached(innerStart),
      end: positionAtCached(innerEnd)
    }
  };
}

/**
 * @param {number} offset
 * @returns {vscode.Position}
 */
function positionAtCached(offset) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return new vscode.Position(0, 0);

  const doc = editor.document;

  if (__doc !== doc || !__posCache) {
    __doc = doc;
    __posCache = new Map();
  }

  const cached = __posCache.get(offset);
  if (cached) return cached;

  const p = doc.positionAt(offset);
  __posCache.set(offset, p);
  return p;
}
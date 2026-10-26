const vscode = require("vscode");

/**
 * @typedef {{ start: number, end: number }} ValueRange
 */

/**
 * @param {string} text
 * @returns {ValueRange[]}
 */
function parseValues(text) {
  /** @type {ValueRange[]} */
  const values = [];
  let i = 0;

  function whitespace() {
    while (/\s/.test(text[i] || "") && i < text.length) {
      i++;
    }
  }

  function parseString() {
    const quote = i++;
    const contentStart = i;

    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }

      if (text[i] === '"') {
        const contentEnd = i;
        i++;

        values.push({
          start: contentStart,
          end: contentEnd
        });
        return;
      }

      i++;
    }

    throw new Error("Unterminated JSON string");
  }

  function parseValue() {
    whitespace();

    if (i >= text.length) {
      throw new Error("Unexpected end of JSON");
    }

    const ch = text[i];

    if (ch === '"') {
      parseString();
      return;
    }

    if (ch === "{") {
      i++;
      whitespace();

      if (text[i] === "}") {
        values.push({ start: i, end: i });
        i++;
        return;
      }

      while (i < text.length) {
        whitespace();

        if (text[i] !== '"') {
          throw new Error("Expected object property");
        }

        // Skip the property name; only navigate values.
        i++;
        while (i < text.length) {
          if (text[i] === "\\") {
            i += 2;
          } else if (text[i] === '"') {
            i++;
            break;
          } else {
            i++;
          }
        }

        whitespace();

        if (text[i++] !== ":") {
          throw new Error("Expected ':'");
        }

        parseValue();
        whitespace();

        if (text[i] === "}") {
          i++;
          return;
        }

        if (text[i++] !== ",") {
          throw new Error("Expected ','");
        }
      }

      throw new Error("Unterminated object");
    }

    if (ch === "[") {
      i++;
      whitespace();

      if (text[i] === "]") {
        // Empty array: position immediately after '['.
        values.push({ start: i, end: i });
        i++;
        return;
      }

      while (i < text.length) {
        parseValue();
        whitespace();

        if (text[i] === "]") {
          i++;
          return;
        }

        if (text[i++] !== ",") {
          throw new Error("Expected ','");
        }
      }

      throw new Error("Unterminated array");
    }

    // Numbers, true, false, and null.
    const start = i;

    while (
      i < text.length &&
      !/[\s,\]}]/.test(text[i])
    ) {
      i++;
    }

    if (i === start) {
      throw new Error("Invalid JSON value");
    }

    values.push({ start, end: i });
  }

  parseValue();
  whitespace();

  if (i !== text.length) {
    throw new Error("Unexpected trailing content");
  }

  return values.sort(
    (a, b) => a.start - b.start || a.end - b.end
  );
}

/**
 * @param {number} direction
 */
function navigate(direction) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const text = editor.document.getText();

  let values;

  try {
    values = parseValues(text);
  } catch {
    vscode.window.setStatusBarMessage(
      "JSON Value Navigation: invalid JSON",
      2000
    );
    return;
  }

  if (!values.length) return;

  const position = editor.selection.active;
  const offset = editor.document.offsetAt(position);

  let target;

  if (direction > 0) {
    // If inside a value, move to the following value.
    target = values.find(value => value.start > offset);

    // Empty containers can share offsets with nearby tokens.
    if (!target) return;
  } else {
    // Find the previous value, skipping the current value.
    for (let j = values.length - 1; j >= 0; j--) {
      if (values[j].end < offset) {
        target = values[j];
        break;
      }
    }

    if (!target) return;
  }

  const start = editor.document.positionAt(target.start);
  const end = editor.document.positionAt(target.end);

  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(
    new vscode.Range(start, end),
    vscode.TextEditorRevealType.InCenter
  );
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jsonValueNavigation.next",
      () => navigate(1)
    ),
    vscode.commands.registerCommand(
      "jsonValueNavigation.previous",
      () => navigate(-1)
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
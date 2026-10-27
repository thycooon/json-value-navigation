# JSON Value Navigation

Navigate between JSON values in Visual Studio Code without moving through every character manually.

JSON Value Navigation lets you jump to the next or previous JSON value in document order. It supports strings, numbers, booleans, `null`, arrays, objects, and nested structures.

## Features

- **Next value / Previous value** — navigate through JSON values in document order.
- **String values** — select string content without the surrounding quotation marks.
- **Empty strings** — place the cursor between the quotation marks.
- **Primitive values** — navigate to numbers, `true`, `false`, and `null`.
- **Nested arrays and objects** — configure whether navigation enters containers and visits their values individually or treats a container as one value.
- **Empty containers** — place the cursor inside empty arrays and objects when they are treated as navigation stops.
- **Top-level array wrapper** — optionally skip the outermost array and navigate its items directly.
- **Multiple selections** — navigate each cursor or selection independently.

## Settings

Open **Settings** and search for `JSON Value Navigation`, or edit your `settings.json` directly.

| Setting | Default | Description |
| --- | --- | --- |
| `jsonValueNavigation.enterNestedContainers` | `true` | Enter nested objects and arrays rather than treating every container as one value. |
| `jsonValueNavigation.iterateContainerItems` | `true` | When entering arrays, visit their items individually. When disabled, treat an array as a single value. |
| `jsonValueNavigation.ignoreTopLevelArrayWrapper` | `true` | Skip the outermost array wrapper and navigate its items directly when the JSON document's root is an array. |

### Example settings

```json
{
  "jsonValueNavigation.enterNestedContainers": true,
  "jsonValueNavigation.iterateContainerItems": true,
  "jsonValueNavigation.ignoreTopLevelArrayWrapper": true
}
```

## Keyboard Shortcuts

| Command | Default shortcut |
| --- | --- |
| JSON Value Navigation: Next Value | `Ctrl+Alt+Shift+Right` |
| JSON Value Navigation: Previous Value | `Ctrl+Alt+Shift+Left` |

If these shortcuts conflict with other extensions or your keyboard layout, change them in **File → Preferences → Keyboard Shortcuts** (Windows/Linux) or **Code → Settings → Keyboard Shortcuts** (macOS).

You can also search for the commands by name in the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS).

## Examples

### Navigate through strings and primitives

Given:

```json
{
  "name": "Alice",
  "age": 20,
  "active": true,
  "nickname": ""
}
```

Navigation visits the values in document order: `Alice`, `20`, `true`, and the empty string. String selections exclude the quotation marks; for an empty string, the cursor sits between them.

### Navigate through arrays

Given:

```json
{
  "items": ["apple", "banana", "cherry"]
}
```

With container-item navigation enabled, navigation visits `apple`, `banana`, and `cherry` individually.

### Navigate through nested values

Given:

```json
{
  "user": {
    "name": "Alice",
    "active": true
  },
  "scores": [10, 20]
}
```

When nested-container navigation is enabled, navigation follows the values inside the object and array in document order. Depending on the settings, a container can instead be treated as one value.

### Navigate a root array

Given:

```json
[
  {"id": 1},
  {"id": 2}
]
```

When `ignoreTopLevelArrayWrapper` is enabled, navigation can move through the root array's items without stopping on the outer array itself.

## Installation

### Install from a VSIX file

1. Package the extension:

   ```bash
   vsce package
   ```

2. In VS Code, open the Extensions view.
3. Select the `...` menu.
4. Choose **Install from VSIX...**.
5. Select the generated `.vsix` file.

Alternatively, install it from the terminal:

```bash
code --install-extension json-value-navigation-1.1.0.vsix
```

Replace the filename with the VSIX file you generated (or downloaded).

## Requirements

- Visual Studio Code.
- A JSON document open in the editor.

## Known Limitations

Navigation parses the document as standard JSON. Invalid or incomplete JSON and JSON with comments are not supported by the parser.

Very large documents may require substantial time and memory because the document is read and parsed when a navigation command runs.

Also at some point in (very) large JSON files this extension stops working entirely (probably because of large file optimizations done internally by VS Code).

## Development

To run the extension locally:

1. Open the extension project in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. Open a JSON file in the new window.
4. Run the navigation commands or use their keyboard shortcuts.

To check JavaScript types, if the project has a `jsconfig.json` configured for TypeScript checking:

```bash
npx tsc --project jsconfig.json
```

## Feedback and Contributions

Bug reports, feature requests, and contributions are welcome.

[GitHub repository](https://github.com/thycooon/json-value-navigation)

## License

This extension is distributed under the terms specified in [LICENSE.md](LICENSE.md). See that file for permitted use and restrictions on modification and redistribution.

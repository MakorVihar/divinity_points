# Development Environment Setup

## One-time setup

```bash
# 1. Clone the repo and enter it
git clone https://github.com/MakorVihar/divinity_points
cd divinity_points

# 2. Drop these config files into the root (they don't change your JS at all)
#    package.json, jsconfig.json, globals.d.ts, module.json
#    foundry-config.yaml
#    .vscode/settings.json, .vscode/launch.json, .vscode/extensions.json

# 3. Edit foundry-config.yaml to match your machine
#    installPath  — where Foundry is installed
#    dataPath     — where Foundry stores its data (worlds, systems, modules)
```

```yaml
# foundry-config.yaml
installPath: "D:/Program Files/Foundry Virtual Tabletop"
dataPath: "C:/Users/YourName/AppData/Local/FoundryVTT/Data"
```

```bash
# 4. Install dev dependencies and create symlinks
#    The postinstall script (tools/create-symlinks.mjs) runs automatically
#    and creates three symlinks in the project root:
#
#      foundry/      → Foundry's client/ and common/ source (for type hints)
#      dnd5e-system/ → your installed dnd5e system (for type hints)
#
npm install

# 5. Symlink your module folder into Foundry's data directory
#    so Foundry always serves your live source files.

# macOS / Linux:
ln -s /path/to/divinity_points \
      ~/foundrydata/Data/modules/dnd5e-divinitypoints

# Windows — no Administrator needed if Developer Mode is on
# (Settings → Privacy & Security → For developers → Developer Mode)
New-Item -ItemType SymbolicLink `
  -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\dnd5e-divinitypoints" `
  -Target "C:\path\to\divinity_points"
```

> **Windows note:** `npm install` uses junction points for the `foundry/` and
> `dnd5e-system/` symlinks, which work without elevation. The module symlink
> in step 5 is a real symlink and requires Developer Mode or an Administrator
> terminal. If you see an EPERM error during `npm install`, the script will
> tell you exactly what to do.

## Enable hot reload in Foundry

Open `<your foundry data dir>/Config/options.json` and add:

```json
{
  "hotReload": true
}
```

Or set it in Foundry's UI: **Configuration → Enable Hot Reload**.

With `module.json` updated (already done in this setup), Foundry will
automatically reload your CSS, HBS templates, and language JSON the
moment you save them — no browser refresh needed.

> **Note:** JavaScript changes still require a full page refresh (F5).
> That's a Foundry limitation; JS re-execution would corrupt the live game state.

## IntelliSense / type checking

Type hints come from two sources, both symlinked into the project by `npm install`:

- **`foundry/`** — Foundry v14's own built-in `.d.mts` declaration files.
  Covers `game`, `canvas`, `Hooks`, `Actor`, `Item`, `CONFIG`, and all other
  Foundry globals. No third-party types package needed — Foundry ships these itself.

- **`dnd5e-system/`** — the live dnd5e system source from your Foundry data
  directory. Referenced by `globals.d.ts` via a relative path (`./dnd5e-system/dnd5e.mjs`)
  so there are no machine-specific paths checked into the repo.

### Opt in per-file (recommended while migrating)

Add this comment to the top of any `.js` file to activate type checking for it:

```js
// @ts-check
```

You'll immediately get red squiggles for type errors and full autocomplete
on `game`, `canvas`, `Hooks`, `Actor`, `Item`, `CONFIG`, `dnd5e.applications`, etc.

### Opt in globally (noisier)

Change `"checkJs": false` → `"checkJs": true` in `jsconfig.json`.
Every `.js` file gets checked. Useful once the codebase is clean.

### Annotating your own types with JSDoc

```js
// @ts-check

/**
 * @param {Actor} actor
 * @returns {Item | undefined}
 */
function getDivinityPointsItem(actor) {
  return actor.items.find((i) => i.type === "feat");
}
```

No TypeScript syntax, no build step — just JSDoc comments that VS Code
understands.

## Debugging in VS Code

1. Start Foundry normally (`node main.js --port=30000`)
2. Open Chrome and go to `http://localhost:30000`
3. In VS Code, press **F5** and choose **"Attach to Foundry (Chrome)"**

> Chrome must be launched with remote debugging enabled. Start it with:
>
> ```
> # macOS
> /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
>
> # Windows
> chrome.exe --remote-debugging-port=9222
>
> # Linux
> google-chrome --remote-debugging-port=9222
> ```
>
> Or use the **"Launch Foundry in Chrome"** config in launch.json which
> handles this automatically.

Once attached:

- Set breakpoints by clicking the gutter in any `.js` file
- Inspect variables in the **Run and Debug** panel
- Use the **Debug Console** to run expressions in the paused context

## Type-check from the terminal

```bash
npm run check        # one-shot check
npm run watch        # re-checks on every file save
```

This runs `tsc --noEmit` — it only reports type errors, never compiles
or modifies your files.

## Resetting the symlinks

If you move your Foundry install, change your data path, or update the dnd5e
system, delete the generated folders and re-run the script:

```bash
rm -rf foundry/ dnd5e-system/   # macOS / Linux
rd /s /q foundry dnd5e-system   # Windows (Command Prompt)

npm run createSymlinks
```

Then reload VS Code: **Ctrl+Shift+P → Reload Window**.

## Project structure

```
divinity_points/
├── .vscode/
│   ├── extensions.json     ← install these when VS Code prompts you
│   ├── launch.json         ← F5 debugger configs
│   └── settings.json       ← editor + IntelliSense settings
├── css/
│   └── dp-styles.css       ← hot-reloaded by Foundry on save
├── lang/
│   └── en.json             ← hot-reloaded by Foundry on save
├── scripts/
│   ├── main.js             ← entry point (add // @ts-check here first)
│   ├── constants.js
│   ├── divinitypoints.js
│   ├── actor-bar-config.js
│   └── settings-form.js
├── templates/
│   └── *.hbs               ← hot-reloaded by Foundry on save
├── tools/
│   └── create-symlinks.mjs ← run automatically by npm install
├── dnd5e-system/           ← symlink → Foundry data/systems/dnd5e  [generated]
├── foundry/                ← symlink → Foundry install client/common [generated]
├── foundry-config.yaml     ← machine-specific paths (not committed to git)
├── globals.d.ts            ← dnd5e + module-specific type declarations
├── jsconfig.json           ← enables IntelliSense on .js files
├── module.json             ← updated with hotReload flags
└── package.json            ← dev tooling (typescript only)
```

> `foundry/`, `dnd5e-system/`, and `foundry-config.yaml` are in `.gitignore`
> — they're machine-specific and regenerated by `npm install`.

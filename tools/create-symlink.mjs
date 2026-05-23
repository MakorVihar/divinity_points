import * as fs from "fs";
import yaml from "js-yaml";
import path from "path";

console.log("Reforging Symlinks");

// ── Windows junction vs symlink ─────────────────────────────────────────────
//
// On Windows, fs.promises.symlink() for *directories* requires either:
//   (a) Developer Mode enabled  (Settings → Privacy & Security → For developers)
//   (b) the process to run as Administrator
//
// Neither is guaranteed in a normal dev workflow, so the old code silently
// failed with EPERM, leaving the foundry/ directory empty and IntelliSense
// seeing nothing.
//
// Junction points are a Windows-native alternative for directory links.
// They work without elevated privileges and are transparent to Node.js / tsc.
// We use them for directories on Windows; plain symlinks everywhere else and
// for files (Node's 'junction' type only applies to directories).
//
const isWindows = process.platform === "win32";

/**
 * Create a symlink (or junction on Windows directories), skipping if it
 * already exists and surfacing any other error clearly.
 *
 * @param {string} target   Absolute path to the thing being linked to.
 * @param {string} linkPath Where the link should be created.
 * @param {'dir'|'file'} kind
 */
async function link(target, linkPath, kind) {
  // Resolve the target to an absolute path — required for Windows junctions.
  const absTarget = path.resolve(target);

  // Choose the symlink type.
  //   'junction' — Windows directories, no elevation needed.
  //   'file'     — files on all platforms (Windows too).
  //   undefined  — directories on macOS/Linux (POSIX doesn't use a type).
  let type;
  if (kind === "dir") {
    type = isWindows ? "junction" : undefined;
  } else {
    type = "file";
  }

  try {
    await fs.promises.symlink(absTarget, linkPath, type);
    console.log(`  ✓ linked  ${linkPath}  →  ${absTarget}`);
  } catch (e) {
    if (e.code === "EEXIST") {
      console.log(`  – exists  ${linkPath}`);
    } else if (e.code === "EPERM") {
      // Give an actionable error instead of silently doing nothing.
      console.error(
        `  ✗ EPERM   ${linkPath}\n` +
          `    On Windows you need either:\n` +
          `      • Developer Mode on  (Settings → Privacy & Security → For developers)\n` +
          `      • OR run this terminal as Administrator\n` +
          `    Then delete the foundry/ folder and run "npm install" again.`,
      );
    } else {
      console.error(`  ✗ error   ${linkPath}: ${e.message}`);
      throw e;
    }
  }
}

if (!fs.existsSync("foundry-config.yaml")) {
  console.error(
    "foundry-config.yaml not found — create it in the project root with:\n" + '  installPath: "C:/path/to/FoundryVTT"  # your Foundry install directory',
  );
  process.exit(1);
}

// Hoisted to outer scope so both the fileRoot block and the dnd5e block
// below can access foundryConfig.dataPath.
let foundryConfig;
let fileRoot = "";

try {
  const fc = await fs.promises.readFile("foundry-config.yaml", "utf-8");
  foundryConfig = yaml.load(fc);

  if (!foundryConfig?.installPath) {
    throw new Error("foundry-config.yaml must contain an `installPath` key.");
  }

  // Electron installs (the standard download) nest under resources/app.
  // Node.js installs (self-hosted / headless) do not.
  const nested = fs.existsSync(path.join(foundryConfig.installPath, "resources", "app"));

  fileRoot = nested ? path.join(foundryConfig.installPath, "resources", "app") : foundryConfig.installPath;

  console.log(`Foundry root: ${fileRoot}`);
} catch (err) {
  console.error(`Error reading foundry-config.yaml: ${err.message}`);
  process.exit(1);
}

// Verify the detected root actually looks like a Foundry install.
if (!fs.existsSync(path.join(fileRoot, "client"))) {
  console.error(
    `Could not find a "client" directory under ${fileRoot}.\n` +
      `Check that installPath in foundry-config.yaml points to your Foundry\n` +
      `install directory (the one that contains "resources/app" on Windows).`,
  );
  process.exit(1);
}

// Create the foundry/ directory that will hold all the links.
try {
  await fs.promises.mkdir("foundry");
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}

// ── Directory links (client/, common/) ─────────────────────────────────────
for (const dir of ["client", "common"]) {
  await link(path.join(fileRoot, dir), path.join("foundry", dir), "dir");
}

// ── Language files ──────────────────────────────────────────────────────────
const langSrc = path.join(fileRoot, "public", "lang");
if (fs.existsSync(langSrc)) {
  await link(langSrc, path.join("foundry", "lang"), "dir");
} else {
  console.log(`  – skipped foundry/lang (not found at ${langSrc})`);
}

// ── Foundry's own tsconfig.json ─────────────────────────────────────────────
// This is a *file* link, so it works on Windows without elevation regardless.
const tsconfigSrc = path.join(fileRoot, "tsconfig.json");
if (fs.existsSync(tsconfigSrc)) {
  await link(tsconfigSrc, path.join("foundry", "tsconfig.json"), "file");
} else {
  console.log(`  – skipped foundry/tsconfig.json (not found at ${tsconfigSrc})`);
}

// ── dnd5e system ──────────────────────────────────────────────────────────
if (foundryConfig.dataPath) {
  const dnd5eSrc = path.join(foundryConfig.dataPath, "systems", "dnd5e");
  if (fs.existsSync(dnd5eSrc)) {
    await link(dnd5eSrc, "dnd5e-system", "dir");
  } else {
    console.log(`  – skipped dnd5e-system (not found at ${dnd5eSrc})`);
  }
} else {
  console.log("  – skipped dnd5e-system (no dataPath in foundry-config.yaml)");
}

console.log("\nDone. If VS Code is open, reload the window (Ctrl+Shift+P → Reload Window).");

/**
 * main.js
 *
 * The entry point for the Divinity Points module.
 * Foundry loads this file first (as declared in module.json → esmodules).
 *
 * This file is responsible for:
 *  1. Registering all module settings (the options players/GMs see in Settings)
 *  2. Registering "Divinity Points" as a native consumption type in dnd5e
 *  3. Creating the starter item in the world on first load
 *  4. Wiring up all Foundry event hooks (things that run when game events fire)
 *
 * HOW HOOKS WORK:
 *   Hooks.on("eventName", callback) tells Foundry to call your function
 *   whenever that event fires. Examples:
 *     - "init"        → fires when the module first loads
 *     - "ready"       → fires when the world is fully loaded
 *     - "createItem"  → fires when any item is created
 *     - "updateActor" → fires when any actor is updated
 *
 * HOW SETTINGS WORK:
 *   game.settings.register(...) declares a setting.
 *   game.settings.get(moduleName, key) reads the current value.
 *   game.settings.set(moduleName, key, value) saves a new value.
 *   Settings with config: true appear in the Module Settings UI.
 *   Settings with config: false are hidden (used to store internal state).
 */

// ── Imports ────────────────────────────────────────────────────────────────────
// ES module imports — each file exports the things it wants to share.

import { DP_MODULE_NAME } from "./constants.js";
import { DivinityPoints, buildConsumptionConfig, validateDpConsumption } from "./divinitypoints.js";
import { ActorDivinityPointsConfig, DP_BASE_SHEET_MISSING } from "./actor-bar-config.js";
import { DpSettingsForm } from "./settings-form.js";

// ── Rename tracking ────────────────────────────────────────────────────────────
// When the GM renames the resource (e.g. "Divinity Points" → "Ki Points"),
// the onChange handler needs to know BOTH the old name and the new name
// so it can find and update all existing items.
//
// Foundry's onChange(newName) only gives us the new name. To get the old name
// reliably, we track it ourselves in this variable, seeded at startup and
// updated every time the setting changes.
let _lastDpResource = "Divinity Points";

// ── init hook ─────────────────────────────────────────────────────────────────
// The "init" hook fires during Foundry's startup sequence, before any world
// data is available. This is the right place to register settings and tell
// dnd5e about our new consumption type.
Hooks.on("init", () => {
  console.log(`${DP_MODULE_NAME} | Module initialising`);

  // ── Handlebars helper ──────────────────────────────────────────────────────────
  // Handlebars is the templating language used in .hbs template files.
  // This registers a custom helper called "dpFormat" that wraps game.i18n.format,
  // allowing templates to format localised strings with variable substitution.
  Handlebars.registerHelper("dpFormat", (path, ...args) => {
    return game.i18n.format(path, args[0].hash);
  });

  // ── Register the resource name setting FIRST ─────────────────────────────
  // Other code in this block reads this setting (e.g. to label the consumption
  // type), so it must be registered before those reads happen.
  game.settings.register(DP_MODULE_NAME, "dpResource", {
    name: `${DP_MODULE_NAME}.resourceLabel`, // display name (from en.json)
    hint: `${DP_MODULE_NAME}.resourceNote`, // descriptive hint text
    scope: "world", // "world" = stored per-world, "client" = per-user
    config: true, // true = visible in Module Settings UI
    type: String,
    default: "Divinity Points",

    // onChange fires whenever the GM saves a new value in the settings menu.
    // We capture the OLD name before updating our tracker, then rename all
    // existing items in the world to match the new name.
    onChange: async (newName) => {
      if (!game.user.isGM) return; // only the GM should rename items

      const oldName = _lastDpResource; // the name it was BEFORE this change
      _lastDpResource = newName; // update our tracker to the new name

      if (oldName && oldName !== newName) {
        await DivinityPoints.updateAllDpItemSources(newName, oldName);
      }
    },
  });

  // Seed the rename tracker with whatever name is saved in this world.
  // If this fails (e.g. first ever load), the default value stays.
  try {
    _lastDpResource = game.settings.get(DP_MODULE_NAME, "dpResource");
  } catch (e) {
    // Setting not yet saved — default value is fine
  }

  // ── Register "Divinity Points" as a native dnd5e consumption type ─────────
  // This makes "Divinity Points" appear in the Type dropdown on any activity's
  // Consumption tab, exactly like "Spell Slots" or "Item Uses".
  //
  // buildConsumptionConfig() returns a plain object with the functions dnd5e
  // expects: consume() handles the actual deduction, consumptionLabels()
  // provides the hint text shown in the usage dialog.
  CONFIG.DND5E.activityConsumptionTypes.divinityPoints = buildConsumptionConfig();

  // Register "Divinity Points" as a class feature subtype so it appears
  // correctly in the Feature Type dropdown on the item sheet.
  game.dnd5e.config.featureTypes.class.subtypes.dp = game.settings.get(DP_MODULE_NAME, "dpResource");

  // ── Bar colour settings (shown via a custom colour-picker form) ───────────
  // These three settings are managed through the "Configure Bar Colours" button
  // (DpSettingsForm), not shown as plain inputs in the settings list.
  // They still need to be registered here so get/set works everywhere.
  game.settings.registerMenu(DP_MODULE_NAME, "colorMenu", {
    name: `${DP_MODULE_NAME}.colorSettingsTitle`,
    label: `${DP_MODULE_NAME}.colorSettingsButton`,
    hint: `${DP_MODULE_NAME}.colorSettingsHint`,
    icon: "fas fa-palette",
    type: DpSettingsForm, // the class that renders the colour picker form
    restricted: true, // only GMs can open it
  });

  // Left gradient colour of the resource bar (hidden from plain settings list)
  game.settings.register(DP_MODULE_NAME, "dpColorL", {
    scope: "world",
    config: false, // hidden — managed by DpSettingsForm
    type: String,
    default: "#4a1060",
    onChange: () => DivinityPoints.setDpColors(), // re-apply CSS vars immediately
  });

  // Right gradient colour of the resource bar
  game.settings.register(DP_MODULE_NAME, "dpColorR", {
    scope: "world",
    config: false,
    type: String,
    default: "#c89020",
    onChange: () => DivinityPoints.setDpColors(),
  });

  // Whether the bar gradient animates (scrolls left-to-right)
  game.settings.register(DP_MODULE_NAME, "dpAnimateBar", {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => DivinityPoints.setDpColors(),
  });

  // ── Visible settings (shown in Module Settings UI) ─────────────────────────

  // Show the resource bar on character sheets
  game.settings.register(DP_MODULE_NAME, "dpActivateBar", {
    name: `${DP_MODULE_NAME}.dpResourceBarActive`,
    hint: `${DP_MODULE_NAME}.dpResourceBarActiveHint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Restrict item configuration (gear icon on the bar) to GMs only
  game.settings.register(DP_MODULE_NAME, "dpGmOnly", {
    name: `${DP_MODULE_NAME}.dpGmOnly`,
    hint: `${DP_MODULE_NAME}.dpGmOnlyNote`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Send usage messages as private whispers to the GM only
  game.settings.register(DP_MODULE_NAME, "dpChatPrivate", {
    name: `${DP_MODULE_NAME}.dpChatPrivate`,
    hint: `${DP_MODULE_NAME}.dpChatPrivateHint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Prevent an ability from firing if the actor doesn't have enough DP
  game.settings.register(DP_MODULE_NAME, "dpBlockOnInsufficient", {
    name: `${DP_MODULE_NAME}.dpBlockOnInsufficient`,
    hint: `${DP_MODULE_NAME}.dpBlockOnInsufficientHint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Apply the saved bar colours to the page CSS variables immediately
  DivinityPoints.setDpColors();

  // Expose helper functions to the global window so GMs can use them in macros:
  //   getDivinityPointsItem(actor) → returns the DP item or false
  //   alterDivinityPoints(actor, uses, max) → programmatically change DP
  // Example: game.modules.get("dnd5e-divinitypoints")?.api?.alterDivinityPoints(actor, 1);
  const mod = game.modules.get(DP_MODULE_NAME);
  if (mod) {
    mod.api = {
      getDivinityPointsItem: DivinityPoints.getDivinityPointsItem.bind(DivinityPoints),
      alterDivinityPoints: DivinityPoints.alterDivinityPoints.bind(DivinityPoints),
    };
  }
});

// ── ready hook ────────────────────────────────────────────────────────────────
// The "ready" hook fires after the world has fully loaded and all documents
// (actors, items, etc.) are available. This is where we create the starter
// item if it doesn't already exist.
Hooks.on("ready", async () => {
  // Only the GM needs to create/manage the world item
  if (!game.user.isGM) return;

  if (DP_BASE_SHEET_MISSING) {
    ui.notifications.error(game.i18n.localize(`${DP_MODULE_NAME}.cannotExtendDndSheet`), { permanent: true });
  }

  // Check whether the Divinity Points item already exists in the world's
  // Items directory. We identify it by its source.custom field matching
  // the current resource name setting.
  const existingItem = game.items.find((i) => i.type === "feat" && i.system?.source?.custom === DivinityPoints.settings.dpResource);

  // Item exists — exit early
  if (existingItem) return;

  // Item is missing (either first run, or GM deleted it) — recreate it
  // Description shown on the item's sheet
  const description = [
    "<h1>Divinity Points</h1>",
    "<p>Your connection to the divine grants you a pool of <strong>Divinity Points</strong>",
    "equal to your Divinity modifier.</p>",
    "<p>These points fuel special class features and abilities. You regain expended",
    "Divinity Points according to the recovery settings on this item.</p>",
    "<p>To make an ability spend Divinity Points, open the ability's item sheet,",
    "go to <em>Activation → Consumption</em>, add a new consumption entry,",
    "and choose <strong>Divinity Points</strong> from the Type dropdown.</p>",
    "<hr />",
    "<p><em>Maximum Divinity Points = Divinity modifier (<code>@abilities.cua_0.mod</code>)</em></p>",
  ].join("\n");

  try {
    const resourceName = game.settings.get(DP_MODULE_NAME, "dpResource");

    const created = await Item.create({
      name: resourceName,
      type: "feat",
      img: "icons/magic/holy/prayer-hands-glowing-yellow.webp",
      system: {
        description: { value: description, chat: "" },
        // source.custom is how we identify this item as THE Divinity Points item
        source: { custom: resourceName },
        type: { value: "class", subtype: "dp" },
        uses: {
          // @abilities.cua_0.mod is the Divinity ability modifier from dnd5e-custom-skills
          max: "@abilities.cua_0.mod",
          spent: 0,
          // Edit recovery on the item sheet to configure long rest behaviour.
          // Default: recover all on long rest.
          recovery: [{ period: "lr", type: "recoverAll" }],
        },
      },
    });

    // Show a permanent notification pointing the GM to the new item
    ui.notifications.info(
      game.i18n.format(`${DP_MODULE_NAME}.starterItemReady`, {
        name: created.name,
        dpResource: resourceName,
      }),
      { permanent: true },
    );
  } catch (err) {
    console.error(`${DP_MODULE_NAME} | Failed to create starter item:`, err);
  }
});

// ── Item lifecycle hooks ──────────────────────────────────────────────────────

// Fires when any item is created anywhere (world, actor sheet, etc.)
// If the newly created item is our DP feature, run the first-drop setup.
Hooks.on("createItem", async (item) => {
  if (DivinityPoints.isDivinityItem(item)) {
    await DivinityPoints.processFirstDrop(item);
  }
});

// Fires just before an item is deleted.
// If the item being deleted is the tracked DP item on an actor, clean up
// the actor flag that points to it so the module doesn't get confused.
Hooks.on("preDeleteItem", (item) => {
  const actor = item.parent; // null if this is a world item (not on an actor)
  if (!actor) return;

  const trackedItemId = DivinityPoints.getActorFlagDpItem(actor);
  if (item._id === trackedItemId) {
    // Remove the flag by setting it to null with the special "-=" prefix
    actor.update({ [`flags.dnd5e-divinitypoints.-=item`]: null });
  }
});

// ── Consumption validation hook ───────────────────────────────────────────────
// Fires before dnd5e processes the consumption for any activity use.
// IMPORTANT: This hook MUST be synchronous (no async/await).
// dnd5e uses Hooks.call() which is synchronous — it checks if any handler
// returned exactly `false` to cancel the action. An async function returns
// a Promise object (which is truthy), so it can never cancel anything.
//
// validateDpConsumption() returns false synchronously to block, or undefined
// to allow. Chat messages inside it are fire-and-forget (no await needed).
Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig) => {
  return validateDpConsumption(activity, usageConfig);
});

// ── Character sheet render hooks ──────────────────────────────────────────────
// This fires whenever a character sheet is rendered (opened or refreshed).
// We use it to inject the Divinity Points bar into the sheet sidebar.
Hooks.on("renderActorSheetV2", async (sheet, html) => {
  try {
    await DivinityPoints.alterCharacterSheet(sheet, html);
  } catch (err) {
    console.error(`${DP_MODULE_NAME} | Failed to render bar on sheet:`, err);
  }
});

Hooks.on("quenchReady", (quench) => {
  import("../tests/tests.js").then(({ registerTests }) => {
    registerTests(quench);
  });
});

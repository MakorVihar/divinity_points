import { DP_MODULE_NAME } from "./constants.js";
import { DivinityPoints, buildConsumptionConfig, validateDpConsumption } from "./divinitypoints.js";
import { ActorDivinityPointsConfig } from "./actor-bar-config.js";
import { DpSettingsForm } from "./settings-form.js";

Handlebars.registerHelper("dpFormat", (path, ...args) => {
  return game.i18n.format(path, args[0].hash);
});

// Stores the last known resource name so onChange always has the old value,
// regardless of whether Foundry commits before or after calling onChange.
let _lastDpResource = "Divinity Points";

Hooks.on("init", () => {
  console.log(`${DP_MODULE_NAME} | Initialising Divinity Points module`);

  // ── Register dpResource FIRST — other init code depends on it ────────────
  game.settings.register(DP_MODULE_NAME, "dpResource", {
    name:    `${DP_MODULE_NAME}.resourceLabel`,
    hint:    `${DP_MODULE_NAME}.resourceNote`,
    scope:   "world",
    config:  true,
    type:    String,
    default: "Divinity Points",
    onChange: async (newName) => {
      if (!game.user.isGM) return;
      const oldName = _lastDpResource;
      _lastDpResource = newName;
      if (oldName && oldName !== newName)
        await DivinityPoints.updateAllDpItemSources(newName, oldName);
    },
  });

  // Seed _lastDpResource from whatever is saved in the world
  try { _lastDpResource = game.settings.get(DP_MODULE_NAME, "dpResource"); } catch(e) {}

  CONFIG.DND5E.activityConsumptionTypes.divinityPoints = buildConsumptionConfig();

  game.dnd5e.config.featureTypes.class.subtypes.dp =
    game.settings.get(DP_MODULE_NAME, "dpResource");

  // ── Settings ──────────────────────────────────────────────────────────────

  game.settings.registerMenu(DP_MODULE_NAME, "colorMenu", {
    name:       `${DP_MODULE_NAME}.colorSettingsTitle`,
    label:      `${DP_MODULE_NAME}.colorSettingsButton`,
    hint:       `${DP_MODULE_NAME}.colorSettingsHint`,
    icon:       "fas fa-palette",
    type:       DpSettingsForm,
    restricted: true,
  });

  game.settings.register(DP_MODULE_NAME, "dpColorL", {
    scope: "world", config: false, type: String, default: "#4a1060",
    onChange: () => DivinityPoints.setDpColors(),
  });
  game.settings.register(DP_MODULE_NAME, "dpColorR", {
    scope: "world", config: false, type: String, default: "#c89020",
    onChange: () => DivinityPoints.setDpColors(),
  });
  game.settings.register(DP_MODULE_NAME, "dpAnimateBar", {
    scope: "world", config: false, type: Boolean, default: true,
    onChange: () => DivinityPoints.setDpColors(),
  });

  game.settings.register(DP_MODULE_NAME, "dpActivateBar", {
    name: `${DP_MODULE_NAME}.dpResourceBarActive`, hint: `${DP_MODULE_NAME}.dpResourceBarActiveHint`,
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(DP_MODULE_NAME, "dpGmOnly", {
    name: `${DP_MODULE_NAME}.dpGmOnly`, hint: `${DP_MODULE_NAME}.dpGmOnlyNote`,
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(DP_MODULE_NAME, "dpChatPrivate", {
    name: `${DP_MODULE_NAME}.dpChatPrivate`, hint: `${DP_MODULE_NAME}.dpChatPrivateHint`,
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(DP_MODULE_NAME, "dpBlockOnInsufficient", {
    name: `${DP_MODULE_NAME}.dpBlockOnInsufficient`,
    hint: `${DP_MODULE_NAME}.dpBlockOnInsufficientHint`,
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(DP_MODULE_NAME, "dpLongRestRecovery", {
    name: `${DP_MODULE_NAME}.dpLongRestRecovery`,
    hint: `${DP_MODULE_NAME}.dpLongRestRecoveryHint`,
    scope: "world", config: true, type: String, default: "one",
    choices: {
      one:  `${DP_MODULE_NAME}.dpRecoveryOne`,
      half: `${DP_MODULE_NAME}.dpRecoveryHalf`,
      all:  `${DP_MODULE_NAME}.dpRecoveryAll`,
    },
  });
  game.settings.register(DP_MODULE_NAME, "starterItemCreated", {
    scope: "world", config: false, type: Boolean, default: false,
  });

  DivinityPoints.setDpColors();
  window.getDivinityPointsItem = DivinityPoints.getDivinityPointsItem.bind(DivinityPoints);
  window.alterDivinityPoints   = DivinityPoints.alterDivinityPoints.bind(DivinityPoints);
});

Hooks.on("ready", async () => {
  if (!game.user.isGM) return;

  const existing = game.items.find(
    i => i.type === "feat" &&
      i.system?.source?.custom === DivinityPoints.settings.dpResource
  );
  if (existing) {
    await game.settings.set(DP_MODULE_NAME, "starterItemCreated", true);
    return;
  }

  await game.settings.set(DP_MODULE_NAME, "starterItemCreated", false);

  const description = [
    "<h1>Divinity Points</h1>",
    "<p>Your connection to the divine grants you a pool of <strong>Divinity Points</strong>",
    "equal to your Divinity modifier.</p>",
    "<p>These points fuel special class features and abilities. You regain all expended",
    "Divinity Points when you finish a <strong>long rest</strong>.</p>",
    "<p>To make an ability spend Divinity Points, open the ability's item sheet,",
    "go to <em>Activation → Consumption</em>, add a new consumption entry,",
    "and choose <strong>Divinity Points</strong> from the Type dropdown.</p>",
    "<hr />",
    "<p><em>Maximum Divinity Points = Divinity modifier (<code>@abilities.cua_0.mod</code>)</em></p>",
  ].join("\n");

  try {
    const created = await Item.create({
      name:   game.settings.get(DP_MODULE_NAME, "dpResource"),
      type:   "feat",
      img:    "icons/magic/holy/prayer-hands-glowing-yellow.webp",
      system: {
        description: { value: description, chat: "" },
        source:      { custom: game.settings.get(DP_MODULE_NAME, "dpResource") },
        type:        { value: "class", subtype: "dp" },
        uses: {
          max:      "@abilities.cua_0.mod",
          spent:    0,
          recovery: [],
        },
      },
    });
    await game.settings.set(DP_MODULE_NAME, "starterItemCreated", true);
    ui.notifications.info(
      game.i18n.format(`${DP_MODULE_NAME}.starterItemReady`, {
        name:       created.name,
        dpResource: game.settings.get(DP_MODULE_NAME, "dpResource"),
      }),
      { permanent: true }
    );
  } catch (err) {
    console.error(`${DP_MODULE_NAME} | Failed to create starter item:`, err);
  }
});

Hooks.on("createItem", (item) => {
  if (DivinityPoints.isDivinityItem(item)) DivinityPoints.processFirstDrop(item);
});

Hooks.on("preDeleteItem", (item) => {
  const actor = item.parent;
  if (!actor) return;
  if (item._id === DivinityPoints.getActorFlagDpItem(actor))
    actor.update({ [`flags.dnd5edivinitypoints.-=item`]: null });
});

Hooks.on("updateActor", async (actor) => {
  if (!DivinityPoints.isActorCharacter(actor)) return;
  if (!DivinityPoints.userHasActorOwnership(actor)) return;
  const dpItem = DivinityPoints.getDivinityPointsItem(actor);
  if (dpItem) await DivinityPoints.recalculateMax(actor, dpItem);
});

// Long rest recovery — amount controlled by dpLongRestRecovery setting
Hooks.on("dnd5e.restCompleted", async (actor, result) => {
  await DivinityPoints.handleLongRest(actor, result);
});

// SYNCHRONOUS — dnd5e uses Hooks.call() which cannot await async handlers.
Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig, messageConfig) => {
  return validateDpConsumption(activity, usageConfig, messageConfig);
});

Hooks.on("renderActorSheet5eCharacter2", (app, html, data) => {
  DivinityPoints.alterCharacterSheet(app, html, data, "v2");
});
Hooks.on("renderActorSheetV2", (app, html, data) => {
  DivinityPoints.alterCharacterSheet(app, html, data, "v2");
});
Hooks.on("renderActorSheet5eCharacter", (app, html, data) => {
  DivinityPoints.alterCharacterSheet(app, html, data, "v1");
});
Hooks.on("renderNPCActorSheet", (app, html, data) => {
  DivinityPoints.alterCharacterSheet(app, html, data, "npc");
});
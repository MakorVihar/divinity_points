/**
 * divinitypoints.js
 *
 * The core logic file. Contains:
 *
 *  1. buildConsumptionConfig()  — creates the object dnd5e needs to treat
 *                                  "Divinity Points" as a native consumption type
 *
 *  2. validateDpConsumption()   — validates DP availability before an ability
 *                                  fires (runs synchronously in a Foundry hook)
 *
 *  3. class DivinityPoints      — all other module logic as static methods:
 *       - Reading settings
 *       - Finding the DP item on an actor
 *       - Injecting the resource bar onto character sheets
 *       - Handling item drops, max recalculation, rename propagation
 *
 * WHY STATIC METHODS?
 *   We never create instances of DivinityPoints (you won't see `new DivinityPoints()`).
 *   All methods are static, meaning you call them as DivinityPoints.someMethod().
 *   This is just a convenient way to group related utility functions under one name.
 */

import { DP_MODULE_NAME, DP_ITEM_ID } from "./constants.js";
import { ActorDivinityPointsConfig } from "./actor-bar-config.js";

// ──────────────────────────────────────────────────────────────────────────────
// Private helper: send a styled chat message
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Creates a chat message on behalf of an actor.
 *
 * @param {string}   content   - HTML content of the message (already formatted)
 * @param {string}   actorName - The name shown as the speaker
 * @param {User[]}   whisper   - If non-empty, message is only visible to these users.
 *                               Pass [] for a public message.
 */
function dpChatMessage(content, actorName, whisper) {
  ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ alias: actorName }),
    isContentVisible: false, // hides the speaker portrait header
    isAuthor: true,
    whisper,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// buildConsumptionConfig
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Builds the configuration object that registers "Divinity Points" as a
 * native consumption type in dnd5e's activity system.
 *
 * HOW dnd5e CONSUMPTION TYPES WORK:
 *   CONFIG.DND5E.activityConsumptionTypes is a plain object where each key
 *   is a consumption type name and each value is an object with at least:
 *     - label             : string shown in the Type dropdown
 *     - consume(config, updates) : function called to perform the deduction
 *     - consumptionLabels(...) : function that returns hint text for the dialog
 *
 *   When an activity is used, dnd5e calls:
 *     typeConfig.consume.call(consumptionTargetInstance, config, updates)
 *   where `this` inside consume() is the ConsumptionTargetData instance,
 *   giving access to this.actor, this.item, this.value, this.resolveCost(), etc.
 *
 * @returns {object} The consumption type config object
 */
export function buildConsumptionConfig() {
  const config = {
    /**
     * Performs the Divinity Points deduction when an ability is used.
     *
     * This is called AFTER validateDpConsumption() has already confirmed
     * there are enough points. It still re-checks as a safety net for
     * non-deterministic cost formulas (e.g. "1d4" costs can't be pre-checked).
     *
     * HOW THE UPDATES SYSTEM WORKS:
     *   dnd5e passes an `updates` object that collects all changes to apply
     *   atomically. By pushing into updates.item we tell dnd5e "also update
     *   this item's spent count". dnd5e then applies all updates together and
     *   records them in the chat message flags — which is what makes the
     *   Refund button work automatically.
     *
     * @param {object} config  - The activity's usage configuration from the dialog
     * @param {object} updates - Pending update payload: { actor, item[], rolls[] }
     */
    async consume(config, updates) {
      const actor = this.actor;
      const dpItem = actor ? DivinityPoints.getDivinityPointsItem(actor) : null;

      // Determine who sees the chat message (everyone, or GM-only)
      const whisper = DivinityPoints.settings.dpChatPrivate ? game.users.filter((u) => u.isGM) : [];

      // If no DP item is on the sheet, post an error and abort silently.
      // The hook-level block (validateDpConsumption) should have caught this
      // already, but this is a fallback.
      if (!dpItem) {
        dpChatMessage(
          `<i style='color:red;'>${game.i18n.format(`${DP_MODULE_NAME}.noDpItem`, {
            actorName: actor?.name ?? "?",
            dpResource: DivinityPoints.settings.dpResource,
          })}</i>`,
          actor?.name ?? "?",
          whisper,
        );
        return;
      }

      // Resolve the cost — this evaluates any formula (e.g. "@scale.monk.ki")
      // and applies scaling if the activity supports it.
      const costRoll = await this.resolveCost({ config, rolls: updates.rolls });
      const cost = Math.max(0, Math.floor(costRoll.total));
      if (cost <= 0) return; // cost of 0 = nothing to deduct

      const spent = dpItem.system.uses.spent ?? 0;
      const available = dpItem.system.uses.max - spent;

      // Guard against going below zero (safety net for non-deterministic formulas)
      if (available < cost) {
        dpChatMessage(
          `<i style='color:red;'>${game.i18n.format(`${DP_MODULE_NAME}.notEnoughDp`, { actorName: actor.name, dpResource: dpItem.name })}</i>`,
          actor.name,
          whisper,
        );
        return; // don't push the update — DP would go negative
      }

      // Push the deduction into dnd5e's updates pipeline.
      // updates.item is an array of { _id, ...fields } objects.
      // If another hook already added an entry for this item, merge into it.
      if (!Array.isArray(updates.item)) updates.item = [];
      const existingEntry = updates.item.find((u) => u._id === dpItem._id);
      if (existingEntry) {
        existingEntry["system.uses.spent"] = (existingEntry["system.uses.spent"] ?? spent) + cost;
      } else {
        updates.item.push({
          _id: dpItem._id,
          "system.uses.spent": spent + cost,
        });
      }

      // Post the success message to chat
      dpChatMessage(
        `<i style='color:green;'>${game.i18n.format(`${DP_MODULE_NAME}.usedDp`, {
          actorName: actor.name,
          dpCost: cost,
          dpResource: dpItem.name,
          remaining: available - cost,
        })}</i>`,
        actor.name,
        whisper,
      );
    },

    /**
     * Returns label and hint text shown in the activity usage dialog.
     * Called by dnd5e when rendering the consumption row in the dialog.
     *
     * @param {object} config  - The current usage configuration
     * @param {object} options - Additional options (e.g. { consumed: bool })
     * @returns {{ label: string, hint: string, warn: boolean }}
     */
    consumptionLabels(config, options = {}) {
      const actor = this.actor;
      const dpItem = actor ? DivinityPoints.getDivinityPointsItem(actor) : null;
      const name = dpItem?.name ?? DivinityPoints.settings.dpResource;
      const available = dpItem ? dpItem.system.uses.max - (dpItem.system.uses.spent ?? 0) : 0;

      // Evaluate the cost formula synchronously for display purposes only
      const costRoll = this.resolveCost({ config, evaluate: false });
      const simpleCost = costRoll.isDeterministic ? costRoll.evaluateSync().total : NaN; // non-deterministic formulas (dice) can't be pre-calculated

      return {
        label: game.i18n.format(`${DP_MODULE_NAME}.consumptionLabel`, {
          dpResource: name,
        }),
        hint: game.i18n.format(`${DP_MODULE_NAME}.dpAvailableHint`, {
          current: available,
          max: dpItem?.system.uses.max ?? 0,
          dpResource: name,
        }),
        // warn: true turns the hint text orange to alert the player
        warn: !isNaN(simpleCost) && simpleCost > available,
      };
    },
  };

  // The `label` property needs to be a live getter so the Type dropdown always
  // shows the current resource name, even after a rename.
  // Object.defineProperty lets us attach a getter to an existing object.
  Object.defineProperty(config, "label", {
    get() {
      return DivinityPoints.settings.dpResource;
    },
    enumerable: true,
    configurable: true,
  });

  return config;
}

// ──────────────────────────────────────────────────────────────────────────────
// validateDpConsumption
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Validates that the actor has enough Divinity Points before an ability fires.
 * Registered on the dnd5e.preActivityConsumption hook in main.js.
 *
 * CRITICAL: This function MUST be synchronous (no async/await).
 *
 * WHY SYNCHRONOUS?
 *   Foundry's Hooks.call() runs callbacks one by one and checks if any returned
 *   exactly `false`. If it sees `false`, it cancels the upstream action.
 *   An `async` function immediately returns a Promise object — which is truthy —
 *   so Foundry would never see the `false` return value and the ability would
 *   always fire regardless.
 *
 * PATTERN:
 *   - All validation is synchronous (deterministic formulas only)
 *   - ChatMessage.create() is called without `await` (fire-and-forget)
 *   - Returns `false` synchronously to block, or `undefined` to allow
 *
 * @param {Activity} activity    - The dnd5e activity being used
 * @param {object}   usageConfig - Configuration from the usage dialog
 * @returns {false|undefined}    - false to block, undefined to allow
 */
export function validateDpConsumption(activity, usageConfig) {
  const actor = activity?.actor;
  if (!actor || !DivinityPoints.isActorCharacter(actor)) return;

  // Only run if this activity has at least one "divinityPoints" consumption target
  const dpTargets = (activity?.consumption?.targets ?? []).filter((t) => t.type === "divinityPoints");
  if (!dpTargets.length) return;

  const shouldBlock = DivinityPoints.settings.dpBlockOnInsufficient;
  const whisper = DivinityPoints.settings.dpChatPrivate ? game.users.filter((u) => u.isGM) : [];

  const dpItem = DivinityPoints.getDivinityPointsItem(actor);
  const available = dpItem ? dpItem.system.uses.max - (dpItem.system.uses.spent ?? 0) : 0;

  // ── Case 1: No DP item on the sheet ───────────────────────────────────────
  if (!dpItem) {
    dpChatMessage(
      `<i style='color:red;'>${game.i18n.format(`${DP_MODULE_NAME}.noDpItem`, {
        actorName: actor.name,
        dpResource: DivinityPoints.settings.dpResource,
      })}</i>`,
      actor.name,
      whisper,
    );
    if (shouldBlock) return false; // block the ability
    return; // allow with just a warning
  }

  // ── Calculate total cost synchronously ────────────────────────────────────
  // We can only check deterministic formulas (plain numbers, @attribute lookups).
  // Dice-based formulas (e.g. "1d4") can't be evaluated until the activity
  // fires, so we skip the block check for those and let consume() handle them.
  let totalCost = 0;
  let hasNonDeterministic = false;

  for (const target of dpTargets) {
    try {
      const roll = target.resolveCost({ config: usageConfig, evaluate: false });
      if (roll.isDeterministic) {
        totalCost += Math.max(0, Math.floor(roll.evaluateSync().total));
      } else {
        hasNonDeterministic = true;
      }
    } catch (e) {
      hasNonDeterministic = true; // treat evaluation errors as non-deterministic
    }
  }

  // Can't pre-check non-deterministic costs — allow through, consume() will validate
  if (hasNonDeterministic) return;

  // ── Case 2: Not enough DP ─────────────────────────────────────────────────
  if (totalCost > 0 && available < totalCost) {
    dpChatMessage(
      `<i style='color:red;'>${game.i18n.format(`${DP_MODULE_NAME}.notEnoughDp`, { actorName: actor.name, dpResource: dpItem.name })}</i>`,
      actor.name,
      whisper,
    );
    if (shouldBlock) return false; // this false is what cancels the activity
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DivinityPoints class
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Central class for all Divinity Points module logic.
 * All methods are static — call them as DivinityPoints.methodName().
 */
export class DivinityPoints {
  // ── Settings ───────────────────────────────────────────────────────────────

  /**
   * Fallback settings used when game.settings is not yet available
   * (e.g. very early in the init cycle before settings are registered).
   */
  static get defaultSettings() {
    return {
      dpResource: "Divinity Points",
      dpActivateBar: true,
      dpAnimateBar: true,
      dpColorL: "#4a1060",
      dpColorR: "#c89020",
      dpGmOnly: true,
      dpChatPrivate: true,
      dpBlockOnInsufficient: true,
    };
  }

  /**
   * Reads all module settings from Foundry's settings store.
   * Falls back to defaultSettings if the store isn't ready yet.
   *
   * @returns {object} All current setting values
   */
  static get settings() {
    if (!game?.settings) return DivinityPoints.defaultSettings;
    try {
      return {
        dpResource: game.settings.get(DP_MODULE_NAME, "dpResource"),
        dpActivateBar: game.settings.get(DP_MODULE_NAME, "dpActivateBar"),
        dpAnimateBar: game.settings.get(DP_MODULE_NAME, "dpAnimateBar"),
        dpColorL: game.settings.get(DP_MODULE_NAME, "dpColorL"),
        dpColorR: game.settings.get(DP_MODULE_NAME, "dpColorR"),
        dpGmOnly: game.settings.get(DP_MODULE_NAME, "dpGmOnly"),
        dpChatPrivate: game.settings.get(DP_MODULE_NAME, "dpChatPrivate"),
        dpBlockOnInsufficient: game.settings.get(DP_MODULE_NAME, "dpBlockOnInsufficient"),
      };
    } catch (e) {
      return DivinityPoints.defaultSettings;
    }
  }

  // ── CSS / Visual ───────────────────────────────────────────────────────────

  /**
   * Applies the current bar colour settings as CSS custom properties on the
   * root HTML element. This makes them available to the stylesheet via
   * var(--dp-left-color) etc., so both the bar and the settings preview update
   * instantly without a page reload.
   */
  static setDpColors() {
    const s = DivinityPoints.settings;
    document.documentElement.style.setProperty("--dp-left-color", s.dpColorL);
    document.documentElement.style.setProperty("--dp-right-color", s.dpColorR);
    // "dp-scroll" is the CSS keyframes animation name defined in dp-styles.css
    document.documentElement.style.setProperty("--dp-animation-name", s.dpAnimateBar ? "dp-scroll" : "none");
  }

  // ── Actor helpers ──────────────────────────────────────────────────────────

  /**
   * Returns true if the actor is a playable character or NPC.
   * Used to skip vehicles, hazards, etc.
   *
   * @param {Actor} actor
   * @returns {boolean}
   */
  static isActorCharacter(actor) {
    const type = foundry.utils.getProperty(actor, "type");
    return type === "character" || type === "npc";
  }

  /**
   * Returns true if the current user has full ownership of the actor.
   * Permission level 3 = OWNER in Foundry.
   *
   * @param {Actor} actor
   * @returns {boolean}
   */
  static userHasActorOwnership(actor) {
    return actor.permission === 3;
  }

  /**
   * Reads the actor flag that stores which item ID is the DP item.
   * We store this when the item is first dropped so we can find it
   * reliably even after it's been renamed.
   *
   * @param {Actor} actor
   * @returns {string|false} The item _id, or false if not set
   */
  static getActorFlagDpItem(actor) {
    const id = actor?.flags?.dnd5edivinitypoints?.item;
    return typeof id === "string" && id.trim().length > 0 ? id : false;
  }

  // ── Item identification ────────────────────────────────────────────────────

  /**
   * Returns true if an item is (or was) a Divinity Points feature.
   * Used to detect when the item is dragged onto a character sheet.
   *
   * We match on three criteria (any one is enough):
   *  1. The item came from our compendium (via sourceId flag)
   *  2. The item's source.custom field matches the current resource name
   *  3. The item's display name matches the current resource name
   *     (covers the case where someone renamed the item manually)
   *
   * @param {Item} item
   * @returns {boolean}
   */
  static isDivinityItem(item) {
    if (item.type !== "feat") return false;

    return (
      // Compendium origin check (legacy — no compendium is currently shipped)
      item.flags?.core?.sourceId === `Compendium.${DP_MODULE_NAME}.module-items.Item.${DP_ITEM_ID}` ||
      // Source label check (primary identifier)
      item.system?.source?.custom === DivinityPoints.settings.dpResource ||
      // Name match (fallback for manually renamed items)
      item.name === DivinityPoints.settings.dpResource
    );
  }

  /**
   * Alternative identifier used during rename operations.
   * During a rename, source.custom hasn't been updated yet, so we can't
   * use isDivinityItem(). Instead we check whether any actor's flag points
   * to this item's ID.
   *
   * @param {Item} item
   * @returns {boolean}
   */
  static isDivinityItemByFlag(item) {
    // Actor-embedded item: check if the owning actor's flag points to this ID
    if (item.parent?.documentName === "Actor") {
      return DivinityPoints.getActorFlagDpItem(item.parent) === item._id;
    }

    // World item: check if any actor in the game has flagged this ID
    if (item.type !== "feat") return false;
    for (const actor of game.actors ?? []) {
      if (DivinityPoints.getActorFlagDpItem(actor) === item._id) return true;
    }
    return false;
  }

  /**
   * Finds and returns the Divinity Points item embedded on the given actor.
   *
   * Search order:
   *  1. Look up the item directly by the stored flag ID (fastest and most reliable)
   *  2. Fall back to searching all feats for a matching source.custom label
   *
   * @param {Actor} actor
   * @returns {Item|false} The DP item, or false if not found
   */
  static getDivinityPointsItem(actor) {
    if (!actor) return false;

    const items = foundry.utils.getProperty(actor, "items");
    const flagId = DivinityPoints.getActorFlagDpItem(actor);

    // Primary lookup: the flag stores the item's _id for O(1) retrieval
    if (flagId) {
      const found = items.get(flagId);
      if (found) return found;
    }

    // Fallback: scan feats for the source.custom match
    // This handles actors whose flag was lost or never set
    return items.find((i) => i.type === "feat" && i.system?.source?.custom === DivinityPoints.settings.dpResource) ?? false;
  }

  // ── Formula evaluation ─────────────────────────────────────────────────────

  /**
   * Evaluates a roll formula against an actor's roll data.
   * Roll data includes things like @abilities.str.mod, @prof, @classes.monk.levels.
   *
   * Example: withActorData("@abilities.cua_0.mod", actor) → 4
   *
   * @param {string|number} formula - The formula to evaluate
   * @param {Actor}         actor   - Provides the data for @ variable lookups
   * @returns {Promise<number>} The evaluated result, or 0 on failure
   */
  static async withActorData(formula, actor) {
    if (formula === null || formula === undefined) return 0;

    const str = String(formula).replace(/\n/g, " ").trim();
    if (!str.length) return 0;

    try {
      const rollData = actor.getRollData(); // all the @ variables for this actor
      rollData.flags = actor.flags; // include flags in case formula uses them
      const roll = await Roll.create(str, rollData).evaluate();
      return roll.total;
    } catch (e) {
      console.warn(`${DP_MODULE_NAME} | Formula evaluation failed: "${str}"`, e);
      return 0;
    }
  }

  // ── Item updates ───────────────────────────────────────────────────────────

  /**
   * Updates the Divinity Points item's uses fields.
   * Pass null for any parameter you don't want to change.
   *
   * Examples:
   *   updateDivinityItem(item, 3, null, null)    → set current value to 3
   *   updateDivinityItem(item, null, 5, null)    → set maximum to 5
   *   updateDivinityItem(item, null, null, 2)    → set spent to 2
   *
   * HOW dnd5e TRACKS USES:
   *   Items store uses as { max, spent } where:
   *     current value = max - spent
   *   So "3 out of 5" = { max: 5, spent: 2 }
   *
   * @param {Item}         item
   * @param {number|null}  value - New current value (calculates spent from max - value)
   * @param {number|null}  max   - New maximum
   * @param {number|null}  spent - New spent count (direct)
   */
  static async updateDivinityItem(item, value = null, max = null, spent = null) {
    if (!item) return;

    const update = {};

    if (max !== null) update["system.uses.max"] = max;
    if (spent !== null) update["system.uses.spent"] = spent;
    if (value !== null) {
      // Convert from "current value" to "spent" (dnd5e's internal format)
      const effectiveMax = max ?? item.system.uses.max;
      update["system.uses.spent"] = effectiveMax - value;
    }

    if (Object.keys(update).length > 0) {
      await item.update(update);
    }
  }

  // ── First drop handling ────────────────────────────────────────────────────

  /**
   * Called when a Divinity Points item is dropped onto a character sheet
   * for the first time.
   *
   * Responsibilities:
   *  1. Prevent duplicates (show error if actor already has a DP item)
   *  2. Fix stale source.custom if the item was renamed manually
   *  3. Store the item's _id in the actor's flags for fast future lookups
   *  4. Calculate the initial maximum from the divinity modifier formula
   *
   * @param {Item} item - The newly created actor-embedded item
   */
  static async processFirstDrop(item) {
    const actor = item.parent; // the actor it was dropped onto
    if (!actor || !DivinityPoints.userHasActorOwnership(actor)) return;

    // ── Duplicate check ─────────────────────────────────────────────────────
    if (DivinityPoints.getActorFlagDpItem(actor)) {
      ui.notifications.error(
        game.i18n.format(`${DP_MODULE_NAME}.alreadyDpItemOwned`, {
          dpResource: DivinityPoints.settings.dpResource,
        }),
      );
      // Rename the duplicate so the GM can see what happened and delete it
      await item.update({
        name: item.name + " (" + game.i18n.localize(`${DP_MODULE_NAME}.duplicated`) + ")",
      });
      return;
    }

    // ── Heal stale source.custom ─────────────────────────────────────────────
    // If the world item was manually renamed without updating source.custom,
    // fix it now so future lookups work correctly.
    const currentResourceName = DivinityPoints.settings.dpResource;
    if (item.system?.source?.custom !== currentResourceName) {
      await item.update({ "system.source.custom": currentResourceName });
    }

    // ── Store item ID in actor flags ─────────────────────────────────────────
    // This allows getDivinityPointsItem() to find it instantly by ID rather
    // than scanning all feats by name.
    await actor.update({
      flags: { dnd5edivinitypoints: { item: item._id } },
    });

    // ── Set initial maximum from formula ─────────────────────────────────────
    await DivinityPoints.recalculateMax(actor, item);
  }

  // ── Maximum recalculation ──────────────────────────────────────────────────

  /**
   * Re-evaluates the item's max formula against the actor's current data
   * and updates the item if the value has changed.
   *
   * This is called:
   *  - When the item is first dropped onto a sheet
   *  - Every time the actor is updated (level up, ability score change, etc.)
   *
   * Formula example: "@abilities.cua_0.mod" evaluates to the divinity modifier.
   *
   * @param {Actor} actor
   * @param {Item}  dpItem
   */
  static async recalculateMax(actor, dpItem) {
    if (!dpItem) return;

    const formula = dpItem.system?.uses?.max;

    // Only re-evaluate if the max is a formula (contains @)
    // Plain numbers are left alone (manual overrides)
    if (typeof formula === "string" && formula.includes("@")) {
      const newMax = await DivinityPoints.withActorData(formula, actor);

      if (isNaN(newMax)) return;

      // Don't let spent exceed the new maximum
      const newSpent = Math.min(dpItem.system.uses.spent ?? 0, newMax);
      await DivinityPoints.updateDivinityItem(dpItem, null, newMax, newSpent);
    }
  }

  // ── Rename propagation ─────────────────────────────────────────────────────

  /**
   * Updates the name and source.custom field on every Divinity Points item
   * in the world when the resource name setting is changed.
   *
   * Searches both the world Items directory and every actor's item list.
   *
   * @param {string} newName - The name to rename items TO
   * @param {string} oldName - The name to look for (items currently named this)
   */
  static async updateAllDpItemSources(newName, oldName) {
    if (!game.user.isGM) return;
    console.log(`${DP_MODULE_NAME} | Renaming items: "${oldName}" → "${newName}"`);

    // Update items in the world Items directory
    for (const item of game.items) {
      if (item.type === "feat" && item.system?.source?.custom === oldName) {
        await item.update({ name: newName, "system.source.custom": newName });
      }
    }

    // Update items embedded on actors (the copies on character sheets)
    for (const actor of game.actors) {
      for (const item of actor.items) {
        if (item.type === "feat" && item.system?.source?.custom === oldName) {
          await item.update({ name: newName, "system.source.custom": newName });
        }
      }
    }
  }

  // ── Macro helper ───────────────────────────────────────────────────────────

  /**
   * Programmatically set an actor's Divinity Points.
   * Exposed on window.alterDivinityPoints so macros can call it.
   *
   * Examples (in a Foundry macro):
   *   alterDivinityPoints(actor, 0)        // set current to 0 (empty)
   *   alterDivinityPoints(actor, 5)        // set current to 5
   *   alterDivinityPoints(actor, 3, 10)    // set current to 3, max to 10
   *
   * @param {Actor}         actor - The actor to modify
   * @param {number|string} uses  - New current value (supports formulas)
   * @param {number|string} max   - New maximum (optional, leave undefined to keep current)
   */
  static async alterDivinityPoints(actor, uses, max) {
    if (!actor || !DivinityPoints.isActorCharacter(actor)) return;

    const dpItem = DivinityPoints.getDivinityPointsItem(actor);
    if (!dpItem) return;

    let currentMax = await DivinityPoints.withActorData(dpItem.system.uses.max, actor);
    let currentVal = currentMax - (dpItem.system.uses.spent ?? 0);

    // Override max if a new value was provided
    if (max !== undefined && max !== null && max !== "") currentMax = await DivinityPoints.withActorData(String(max), actor);

    // Override current value if a new value was provided, clamped to [0, max]
    if (uses !== undefined && uses !== null && uses !== "")
      currentVal = Math.max(0, Math.min(await DivinityPoints.withActorData(String(uses), actor), currentMax));

    await DivinityPoints.updateDivinityItem(dpItem, currentVal, currentMax, currentMax - currentVal);
  }

  // ── Character sheet bar injection ──────────────────────────────────────────

  /**
   * Injects the Divinity Points bar into a rendered character sheet.
   * Called from the render hooks in main.js.
   *
   * HOW THE BAR WORKS:
   *  1. Renders a Handlebars template (divinity-points-sheet-tracker.hbs)
   *  2. Finds the right sidebar location based on sheet type
   *  3. Inserts the bar HTML into the DOM
   *  4. Attaches click handlers for editing the value and opening config
   *
   * @param {Application} app  - The sheet application instance
   * @param {jQuery|HTMLElement} html - The rendered sheet HTML
   * @param {object} data      - Sheet data (contains actor, editable flag, etc.)
   * @param {string} type      - Sheet variant: "v2", "v1", or "npc"
   */
  static async alterCharacterSheet(app, html, context, type) {
    // In v13, actor came from data.actor. In v14 context structure differs —
    // always pull directly from the application instance instead.
    const actor = app.actor ?? app.document;
    const editable = app.isEditable ?? app.options?.editable ?? true;

    // Skip if actor type isn't character/npc, or bar is disabled
    if (!["character", "npc"].includes(actor?.type)) return;
    if (!DivinityPoints.settings.dpActivateBar) return;

    const dpItem = DivinityPoints.getDivinityPointsItem(actor);
    if (!dpItem) return; // actor doesn't have DP — nothing to show

    // Calculate display values
    const max = dpItem.system.uses.max;
    const spent = dpItem.system.uses.spent ?? 0;
    const value = max - spent; // current points
    const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0; // bar fill %

    // Render the bar template with all the data it needs
    const rendered = await foundry.applications.handlebars.renderTemplate(`modules/${DP_MODULE_NAME}/templates/divinity-points-sheet-tracker.hbs`, {
      isV2: type === "v2",
      isNPC: type === "npc",
      editable: editable,
      name: dpItem.name,
      _id: dpItem._id,
      max,
      value,
      percent,
    });

    // Wrap the rendered HTML in a container div for easy removal on re-render
    const container = $('<div class="dp-bar-container"></div>').append(rendered);

    // Find where to insert the bar — location differs per sheet type
    let sidebarSelector = ".sidebar .stats"; // default
    let insertAfter = true; // true = after, false = prepend inside

    if (app.classList?.value?.includes("tidy5e-sheet")) {
      // Tidy5e sheet has a different sidebar structure
      sidebarSelector = ".attributes .side-panel, .tidy-tab.favorites";
      insertAfter = false;
    } else if (type === "v2") {
      sidebarSelector = ".sidebar .stats > .meter-group:last";
    } else if (type === "npc") {
      sidebarSelector = ".sheet-body .sidebar";
      insertAfter = false;
    } else {
      // Legacy v1 sheet
      sidebarSelector = ".header-details .attributes";
    }

    // Remove any previous bar (prevents duplicates when the sheet re-renders)
    $(`${sidebarSelector} .dp-bar-container`, $(html)).remove();

    // Insert the bar in the correct position
    if (insertAfter) {
      $(sidebarSelector, $(html)).after(container);
    } else {
      $(sidebarSelector, $(html)).prepend(container);
    }

    // ── Event handlers ──────────────────────────────────────────────────────

    // Gear icon → open the config popup (to edit max, add recovery periods, etc.)
    $(".config-button.divinityPoints", $(html))
      .off("click")
      .on("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        new ActorDivinityPointsConfig({ document: dpItem }).render(true);
      });

    // Click on the value label → replace with an editable input
    $(".progress.dp-points .label", $(html))
      .off("click")
      .on("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $(".progress.dp-points .label", $(html)).attr("hidden", "hidden");
        const input = $(".progress.dp-points input.dp_value", $(html));
        input.removeAttr("hidden").focus().select();
      });

    // Input field: save on blur (clicking away) or pressing Enter
    $(".progress.dp-points input.dp_value", $(html))
      .off("blur keydown")
      .on("blur", async (e) => {
        await DivinityPoints._handleBarValueChange(dpItem, e, $(html), max);
      })
      .on("keydown", (e) => {
        if (e.key === "Enter") e.target.blur(); // triggers the blur handler above
      });
  }

  /**
   * Saves the new value typed into the bar's editable input field.
   * Called when the input loses focus (blur event).
   *
   * @param {Item}   item  - The DP item to update
   * @param {Event}  event - The blur event (contains the new value)
   * @param {jQuery} html  - The sheet HTML (to restore the label display)
   * @param {number} max   - The current maximum (to clamp the value)
   */
  static async _handleBarValueChange(item, event, html, max) {
    let newValue = parseInt($(event.target).val());

    // Clamp to valid range: [0, max]
    if (isNaN(newValue) || newValue < 0) newValue = 0;
    if (newValue > max) newValue = max;

    await DivinityPoints.updateDivinityItem(item, newValue, null, max - newValue);

    // Restore the label and hide the input
    $(".progress.dp-points .label", html).removeAttr("hidden");
    $(event.target).attr("hidden", "hidden");
  }
}

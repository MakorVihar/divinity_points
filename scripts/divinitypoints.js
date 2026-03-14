import { DP_MODULE_NAME, DP_ITEM_ID } from "./constants.js";
import { ActorDivinityPointsConfig } from "./actor-bar-config.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function dpChatMessage(content, actorName, whisper) {
  ChatMessage.create({
    content,
    speaker:          ChatMessage.getSpeaker({ alias: actorName }),
    isContentVisible: false,
    isAuthor:         true,
    whisper,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Consumption config — plain object registered in CONFIG.DND5E.activityConsumptionTypes
//
// From consumption-targets-field.mjs:
//   const typeConfig = CONFIG.DND5E.activityConsumptionTypes[this.type];
//   if ( !typeConfig?.consume ) throw new Error("Consumption types must define consumption method.");
//   await typeConfig.consume.call(this, config, updates);
// ──────────────────────────────────────────────────────────────────────────────

export function buildConsumptionConfig() {
  return {
    // Read the setting at call time so it reflects any rename
    get label() { return DivinityPoints.settings.dpResource; },

    // consume() is only called when preActivityConsumption did NOT block.
    // It still re-validates availability, because non-deterministic formulas
    // can't be checked synchronously in the hook.
    async consume(config, updates) {
      const actor  = this.actor;
      const dpItem = actor ? DivinityPoints.getDivinityPointsItem(actor) : null;
      const whisper = DivinityPoints.settings.dpChatPrivate
        ? game.users.filter(u => u.isGM) : [];

      if (!dpItem) {
        dpChatMessage(
          `<i style='color:red;'>${game.i18n.format(`${DP_MODULE_NAME}.noDpItem`,
            { actorName: actor?.name ?? "?" })}</i>`,
          actor?.name ?? "?", whisper
        );
        // Don't push anything — DP just wasn't deducted, activity still fires.
        // Blocking is handled in the synchronous preActivityConsumption hook.
        return;
      }

      const costRoll = await this.resolveCost({ config, rolls: updates.rolls });
      const cost     = Math.max(0, Math.floor(costRoll.total));
      if (cost <= 0) return;

      const spent     = dpItem.system.uses.spent ?? 0;
      const available = dpItem.system.uses.max - spent;

      if (available < cost) {
        dpChatMessage(
          `<i style='color:red;'>${game.i18n.format(`${DP_MODULE_NAME}.notEnoughDp`,
            { actorName: actor.name, dpResource: dpItem.name })}</i>`,
          actor.name, whisper
        );
        // Don't push — prevents going below zero. Activity fires unless blocked by hook.
        return;
      }

      // Happy path — push into updates.item so dnd5e records it for Refund.
      if (!Array.isArray(updates.item)) updates.item = [];
      const existing = updates.item.find(u => u._id === dpItem._id);
      if (existing) {
        existing["system.uses.spent"] = (existing["system.uses.spent"] ?? spent) + cost;
      } else {
        updates.item.push({ _id: dpItem._id, "system.uses.spent": spent + cost });
      }

      dpChatMessage(
        `<i style='color:green;'>${game.i18n.format(`${DP_MODULE_NAME}.usedDp`, {
          actorName:  actor.name,
          dpCost:     cost,
          dpResource: dpItem.name,
          remaining:  available - cost,
        })}</i>`,
        actor.name, whisper
      );
    },

    consumptionLabels(config, options = {}) {
      const actor  = this.actor;
      const dpItem = actor ? DivinityPoints.getDivinityPointsItem(actor) : null;
      const name   = dpItem?.name ?? DivinityPoints.settings.dpResource;
      const available = dpItem
        ? (dpItem.system.uses.max - (dpItem.system.uses.spent ?? 0)) : 0;

      const costRoll   = this.resolveCost({ config, evaluate: false });
      const simpleCost = costRoll.isDeterministic
        ? costRoll.evaluateSync().total : NaN;

      return {
        label: game.i18n.format(`${DP_MODULE_NAME}.consumptionLabel`, { dpResource: name }),
        hint:  game.i18n.format(`${DP_MODULE_NAME}.dpAvailableHint`, {
          current:    available,
          max:        dpItem?.system.uses.max ?? 0,
          dpResource: name,
        }),
        warn: !isNaN(simpleCost) && simpleCost > available,
      };
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// validateDpConsumption — registered on dnd5e.preActivityConsumption
//
// MUST be synchronous. dnd5e calls:
//   if ( Hooks.call("dnd5e.preActivityConsumption", ...) === false ) return false;
// Hooks.call is synchronous — an async handler returns a Promise (truthy),
// so it can never block. We therefore do everything synchronously here:
//   • use resolveCost({ evaluate: false }) + evaluateSync() for deterministic formulas
//   • fire ChatMessage.create() as fire-and-forget (no await)
//   • return false synchronously to block
// ──────────────────────────────────────────────────────────────────────────────

export function validateDpConsumption(activity, usageConfig) {
  const actor = activity?.actor;
  if (!actor || !DivinityPoints.isActorCharacter(actor)) return;

  const dpTargets = (activity?.consumption?.targets ?? [])
    .filter(t => t.type === "divinityPoints");
  if (!dpTargets.length) return;

  const shouldBlock = DivinityPoints.settings.dpBlockOnInsufficient;
  const whisper     = DivinityPoints.settings.dpChatPrivate
    ? game.users.filter(u => u.isGM) : [];

  const dpItem    = DivinityPoints.getDivinityPointsItem(actor);
  const available = dpItem
    ? (dpItem.system.uses.max - (dpItem.system.uses.spent ?? 0)) : 0;

  // ── No DP item on the sheet ──────────────────────────────────────────────
  if (!dpItem) {
    dpChatMessage(
      `<i style='color:red;'>${game.i18n.format(
        `${DP_MODULE_NAME}.noDpItem`, { actorName: actor.name }
      )}</i>`,
      actor.name, whisper
    );
    if (shouldBlock) return false;
    return;
  }

  // ── Sum cost synchronously across all DP targets ─────────────────────────
  let totalCost = 0;
  let hasNonDeterministic = false;

  for (const t of dpTargets) {
    try {
      const roll = t.resolveCost({ config: usageConfig, evaluate: false });
      if (roll.isDeterministic) {
        totalCost += Math.max(0, Math.floor(roll.evaluateSync().total));
      } else {
        hasNonDeterministic = true;
      }
    } catch (e) {
      hasNonDeterministic = true;
    }
  }

  // Non-deterministic formulas can't be checked here — consume() will handle them.
  if (hasNonDeterministic) return;

  // ── Not enough DP ────────────────────────────────────────────────────────
  if (totalCost > 0 && available < totalCost) {
    dpChatMessage(
      `<i style='color:red;'>${game.i18n.format(
        `${DP_MODULE_NAME}.notEnoughDp`,
        { actorName: actor.name, dpResource: dpItem.name }
      )}</i>`,
      actor.name, whisper
    );
    if (shouldBlock) return false; // synchronous — Hooks.call sees this
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DivinityPoints — all other module logic
// ──────────────────────────────────────────────────────────────────────────────
export class DivinityPoints {

  static get defaultSettings() {
    return {
      dpResource:            "Divinity Points",
      dpActivateBar:         true,
      dpAnimateBar:          true,
      dpColorL:              "#4a1060",
      dpColorR:              "#c89020",
      dpGmOnly:              true,
      dpChatPrivate:         false,
      dpBlockOnInsufficient: true,
    };
  }

  static get settings() {
    if (!game?.settings) return DivinityPoints.defaultSettings;
    try {
      return {
        dpResource:            game.settings.get(DP_MODULE_NAME, "dpResource"),
        dpActivateBar:         game.settings.get(DP_MODULE_NAME, "dpActivateBar"),
        dpAnimateBar:          game.settings.get(DP_MODULE_NAME, "dpAnimateBar"),
        dpColorL:              game.settings.get(DP_MODULE_NAME, "dpColorL"),
        dpColorR:              game.settings.get(DP_MODULE_NAME, "dpColorR"),
        dpGmOnly:              game.settings.get(DP_MODULE_NAME, "dpGmOnly"),
        dpChatPrivate:         game.settings.get(DP_MODULE_NAME, "dpChatPrivate"),
        dpBlockOnInsufficient: game.settings.get(DP_MODULE_NAME, "dpBlockOnInsufficient"),
      };
    } catch (e) {
      return DivinityPoints.defaultSettings;
    }
  }

  static setDpColors() {
    const s = DivinityPoints.settings;
    document.documentElement.style.setProperty("--dp-left-color",  s.dpColorL);
    document.documentElement.style.setProperty("--dp-right-color", s.dpColorR);
    document.documentElement.style.setProperty(
      "--dp-animation-name", s.dpAnimateBar ? "dp-scroll" : "none"
    );
  }

  static isActorCharacter(actor) {
    const t = foundry.utils.getProperty(actor, "type");
    return t === "character" || t === "npc";
  }

  static userHasActorOwnership(actor) {
    return actor.permission === 3;
  }

  static getActorFlagDpItem(actor) {
    const id = actor?.flags?.dnd5edivinitypoints?.item;
    return typeof id === "string" && id.trim().length > 0 ? id : false;
  }

  static isDivinityItem(item) {
    return (
      item.type === "feat" && (
        item.flags?.core?.sourceId ===
          `Compendium.${DP_MODULE_NAME}.module-items.Item.${DP_ITEM_ID}` ||
        item.system?.source?.custom === DivinityPoints.settings.dpResource
      )
    );
  }

  /**
   * Identifies a DP item using only the actor flag — used during rename so we
   * don't depend on source.custom matching the (about-to-change) setting value.
   */
  static isDivinityItemByFlag(item) {
    // World item: check if any actor has flagged this item ID
    if (item.parent?.documentName === "Actor") {
      return DivinityPoints.getActorFlagDpItem(item.parent) === item._id;
    }
    // World-level item: match by source.custom equaling any known non-empty value
    // (we can't know the old name, so match any feat whose source.custom is set
    //  and whose ID is referenced in any actor flag)
    if (item.type !== "feat") return false;
    for (const actor of game.actors ?? []) {
      if (DivinityPoints.getActorFlagDpItem(actor) === item._id) return true;
    }
    return false;
  }

  static getDivinityPointsItem(actor) {
    if (!actor) return false;
    const items  = foundry.utils.getProperty(actor, "items");
    // Primary: stored item ID in actor flags
    const flagId = DivinityPoints.getActorFlagDpItem(actor);
    if (flagId) {
      const found = items.get(flagId);
      if (found) return found;
    }
    // Fallback: source.custom match (kept in sync with setting via onChange)
    return items.find(i =>
      i.type === "feat" &&
      i.system?.source?.custom === DivinityPoints.settings.dpResource
    ) ?? false;
  }

  static async withActorData(formula, actor) {
    if (formula === null || formula === undefined) return 0;
    const str = String(formula).replace(/\n/g, " ").trim();
    if (!str.length) return 0;
    try {
      const data = actor.getRollData();
      data.flags = actor.flags;
      const r = await Roll.create(str, data).evaluate();
      return r.total;
    } catch (e) {
      console.warn(`${DP_MODULE_NAME} | Formula evaluation failed: "${str}"`, e);
      return 0;
    }
  }

  static async updateDivinityItem(item, value = null, max = null, spent = null) {
    if (!item) return;
    const update = {};
    if (max   !== null) update["system.uses.max"]   = max;
    if (spent !== null) update["system.uses.spent"] = spent;
    if (value !== null) {
      const effectiveMax = max ?? item.system.uses.max;
      update["system.uses.spent"] = effectiveMax - value;
    }
    if (Object.keys(update).length) await item.update(update);
  }

  static async processFirstDrop(item) {
    const actor = item.parent;
    if (!actor || !DivinityPoints.userHasActorOwnership(actor)) return;

    if (DivinityPoints.getActorFlagDpItem(actor)) {
      ui.notifications.error(
        game.i18n.format(`${DP_MODULE_NAME}.alreadyDpItemOwned`,
          { dpResource: DivinityPoints.settings.dpResource })
      );
      await item.update({
        name: item.name + " (" +
          game.i18n.localize(`${DP_MODULE_NAME}.duplicated`) + ")",
      });
      return;
    }

    await actor.update({ flags: { dnd5edivinitypoints: { item: item._id } } });
    await DivinityPoints.recalculateMax(actor, item);
  }

  static async recalculateMax(actor, dpItem) {
    if (!dpItem) return;
    const formula = dpItem.system?.uses?.max;
    if (typeof formula === "string" && formula.includes("@")) {
      const newMax = await DivinityPoints.withActorData(formula, actor);
      if (!isNaN(newMax)) {
        const spent = Math.min(dpItem.system.uses.spent ?? 0, newMax);
        await DivinityPoints.updateDivinityItem(dpItem, null, newMax, spent);
      }
    }
  }

  static async alterDivinityPoints(actor, uses, max) {
    if (!actor || !DivinityPoints.isActorCharacter(actor)) return;
    const dpItem = DivinityPoints.getDivinityPointsItem(actor);
    if (!dpItem) return;

    let currentMax = await DivinityPoints.withActorData(dpItem.system.uses.max, actor);
    let currentVal = currentMax - (dpItem.system.uses.spent ?? 0);

    if (max  !== undefined && max  !== null && max  !== "")
      currentMax = await DivinityPoints.withActorData(String(max), actor);
    if (uses !== undefined && uses !== null && uses !== "")
      currentVal = Math.max(0, Math.min(
        await DivinityPoints.withActorData(String(uses), actor), currentMax
      ));

    await DivinityPoints.updateDivinityItem(
      dpItem, currentVal, currentMax, currentMax - currentVal
    );
  }

  static async alterCharacterSheet(app, html, data, type) {
    if (!["character", "npc"].includes(data.actor?.type)) return;
    if (!DivinityPoints.settings.dpActivateBar) return;

    const actor  = data.actor;
    const dpItem = DivinityPoints.getDivinityPointsItem(actor);
    if (!dpItem) return;

    const max     = dpItem.system.uses.max;
    const spent   = dpItem.system.uses.spent ?? 0;
    const value   = max - spent;
    const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;

    const rendered = await foundry.applications.handlebars.renderTemplate(
      `modules/${DP_MODULE_NAME}/templates/divinity-points-sheet-tracker.hbs`,
      {
        isV2: type === "v2", isNPC: type === "npc",
        editable: data.editable,
        name: dpItem.name, _id: dpItem._id, max, value, percent,
      }
    );

    const container = $('<div class="dp-bar-container"></div>').append(rendered);

    let sidebarSel = ".sidebar .stats";
    let append     = true;
    if (app.classList?.value?.includes("tidy5e-sheet")) {
      sidebarSel = ".attributes .side-panel, .tidy-tab.favorites"; append = false;
    } else if (type === "v2") {
      sidebarSel = ".sidebar .stats > .meter-group:last";
    } else if (type === "npc") {
      sidebarSel = ".sheet-body .sidebar"; append = false;
    } else {
      sidebarSel = ".header-details .attributes";
    }

    $(`${sidebarSel} .dp-bar-container`, html).remove();
    if (append) $(sidebarSel, html).after(container);
    else        $(sidebarSel, html).prepend(container);

    $(".config-button.divinityPoints", html).off("click").on("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      new ActorDivinityPointsConfig({ document: dpItem }).render(true);
    });

    $(".progress.dp-points .label", html).off("click").on("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      $(".progress.dp-points .label", html).attr("hidden", "hidden");
      const input = $(".progress.dp-points input.dp_value", html);
      input.removeAttr("hidden").focus().select();
    });

    $(".progress.dp-points input.dp_value", html)
      .off("blur keydown")
      .on("blur", async (e) => {
        await DivinityPoints._handleBarValueChange(dpItem, e, html, max);
      })
      .on("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  }

  /**
   * Called when dpResource setting changes. Updates source.custom AND the
   * item name on every Divinity Points item in the world and on every actor
   * sheet so everything stays in sync with the new name.
   */
  static async updateAllDpItemSources(newName, oldName) {
    if (!game.user.isGM) return;
    console.log(`${DP_MODULE_NAME} | Renaming DP items: "${oldName}" → "${newName}"`);

    // World items
    for (const item of game.items) {
      if (item.type === "feat" && item.system?.source?.custom === oldName) {
        await item.update({ name: newName, "system.source.custom": newName });
      }
    }
    // Actor-embedded items
    for (const actor of game.actors) {
      for (const item of actor.items) {
        if (item.type === "feat" && item.system?.source?.custom === oldName) {
          await item.update({ name: newName, "system.source.custom": newName });
        }
      }
    }
  }

  static async _handleBarValueChange(item, event, html, max) {
    let v = parseInt($(event.target).val());
    if (isNaN(v) || v < 0) v = 0;
    if (v > max) v = max;
    await DivinityPoints.updateDivinityItem(item, v, null, max - v);
    $(".progress.dp-points .label", html).removeAttr("hidden");
    $(event.target).attr("hidden", "hidden");
  }
}
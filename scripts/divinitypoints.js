import { DP_MODULE_NAME, DP_ITEM_ID } from "./constants.js";
import { ActorDivinityPointsConfig } from "./actor-bar-config.js";

/**
 * Returns the plain config object registered in CONFIG.DND5E.activityConsumptionTypes.
 *
 * From consumption-targets-field.mjs the base consume() method does:
 *   const typeConfig = CONFIG.DND5E.activityConsumptionTypes[this.type];
 *   if ( !typeConfig?.consume ) throw new Error("Consumption types must define consumption method.");
 *   await typeConfig.consume.call(this, config, updates);
 *
 * So the value must be a plain object { label, consume, consumptionLabels? }.
 * consume() is called with `this` = the ConsumptionTargetData instance, which
 * exposes this.activity, this.actor, this.item, this.value, this.resolveCost().
 */
export function buildConsumptionConfig() {
  return {
    label: game.i18n.localize(`${DP_MODULE_NAME}.consumptionTypeLabel`),

    /**
     * Called as: typeConfig.consume.call(consumptionTargetDataInstance, config, updates)
     * `this` is the ConsumptionTargetData instance for this target entry.
     */
    async consume(config, updates) {
      const actor  = this.actor;
      const dpItem = actor ? DivinityPoints.getDivinityPointsItem(actor) : null;

      if (!dpItem) {
        const { ConsumptionError } = dnd5e.dataModels.activity.ConsumptionTargetData
          ? { ConsumptionError: class extends Error { constructor(...a) { super(...a); this.name = "ConsumptionError"; } } }
          : dnd5e.data?.activity?.fields ?? {};
        throw new Error(
          game.i18n.format(`${DP_MODULE_NAME}.noDpItem`, { actorName: actor?.name ?? "?" })
        );
      }

      // Use resolveCost() — the proper helper on ConsumptionTargetData that
      // handles scaling, roll formulas, etc.
      const costRoll = await this.resolveCost({ config, rolls: updates.rolls });
      const cost = Math.max(0, Math.floor(costRoll.total));
      if (cost <= 0) return;

      const spent     = dpItem.system.uses.spent ?? 0;
      const available = dpItem.system.uses.max - spent;

      if (available < cost) {
        throw new Error(
          game.i18n.format(`${DP_MODULE_NAME}.notEnoughDp`, {
            actorName:  actor.name,
            dpResource: dpItem.name,
          })
        );
      }

      // Push into updates.item — same array used by all built-in types.
      // dnd5e applies it atomically and records it in chat message flags
      // so the Refund button works automatically.
      if (!Array.isArray(updates.item)) updates.item = [];
      const existing = updates.item.find(u => u._id === dpItem._id);
      if (existing) {
        existing["system.uses.spent"] = (existing["system.uses.spent"] ?? spent) + cost;
      } else {
        updates.item.push({ _id: dpItem._id, "system.uses.spent": spent + cost });
      }
    },

    /**
     * Called as: typeConfig.consumptionLabels.call(consumptionTargetDataInstance, config, options)
     * Returns { label, hint, warn } shown in the usage dialog.
     */
    consumptionLabels(config, options = {}) {
      const actor  = this.actor;
      const dpItem = actor ? DivinityPoints.getDivinityPointsItem(actor) : null;
      const name   = dpItem?.name
        ?? game.i18n.localize(`${DP_MODULE_NAME}.consumptionTypeLabel`);
      const available = dpItem
        ? (dpItem.system.uses.max - (dpItem.system.uses.spent ?? 0))
        : 0;

      const costRoll    = this.resolveCost({ config, evaluate: false });
      const simpleCost  = costRoll.isDeterministic
        ? costRoll.evaluateSync().total
        : NaN;
      const costDisplay = costRoll.isDeterministic ? String(simpleCost) : costRoll.formula;

      return {
        label: game.i18n.format(`${DP_MODULE_NAME}.consumptionLabel`, { dpResource: name }),
        hint:  game.i18n.format(`${DP_MODULE_NAME}.dpAvailableHint`, {
          current: available,
          max:     dpItem?.system.uses.max ?? 0,
          dpResource: name,
        }),
        warn: !isNaN(simpleCost) && simpleCost > available,
      };
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// DivinityPoints — all other module logic
// ──────────────────────────────────────────────────────────────────────────────
export class DivinityPoints {

  static get defaultSettings() {
    return {
      dpResource:    "Divinity Points",
      dpActivateBar: true,
      dpAnimateBar:  true,
      dpColorL:      "#4a1060",
      dpColorR:      "#c89020",
      dpGmOnly:      true,
      dpChatPrivate: false,
    };
  }

  static get settings() {
    if (!game?.settings) return DivinityPoints.defaultSettings;
    try {
      return {
        dpResource:    game.settings.get(DP_MODULE_NAME, "dpResource"),
        dpActivateBar: game.settings.get(DP_MODULE_NAME, "dpActivateBar"),
        dpAnimateBar:  game.settings.get(DP_MODULE_NAME, "dpAnimateBar"),
        dpColorL:      game.settings.get(DP_MODULE_NAME, "dpColorL"),
        dpColorR:      game.settings.get(DP_MODULE_NAME, "dpColorR"),
        dpGmOnly:      game.settings.get(DP_MODULE_NAME, "dpGmOnly"),
        dpChatPrivate: game.settings.get(DP_MODULE_NAME, "dpChatPrivate"),
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
    const sourceOk = (
      item.flags?.core?.sourceId ===
        `Compendium.${DP_MODULE_NAME}.module-items.Item.${DP_ITEM_ID}` ||
      item.system?.source?.custom === DivinityPoints.settings.dpResource
    );
    return item.type === "feat" && sourceOk;
  }

  static getDivinityPointsItem(actor) {
    if (!actor) return false;
    const items  = foundry.utils.getProperty(actor, "items");
    const flagId = DivinityPoints.getActorFlagDpItem(actor);
    if (flagId) {
      const found = items.get(flagId);
      if (found) return found;
    }
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
        game.i18n.localize(`${DP_MODULE_NAME}.alreadyDpItemOwned`)
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
      currentMax = await DivinityPoints.withActorData(String(max),  actor);
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

  static async _handleBarValueChange(item, event, html, max) {
    let v = parseInt($(event.target).val());
    if (isNaN(v) || v < 0) v = 0;
    if (v > max) v = max;
    await DivinityPoints.updateDivinityItem(item, v, null, max - v);
    $(".progress.dp-points .label", html).removeAttr("hidden");
    $(event.target).attr("hidden", "hidden");
  }
}

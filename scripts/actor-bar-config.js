/**
 * actor-bar-config.js
 *
 * Defines the popup configuration sheet that opens when the GM clicks the
 * gear icon on the Divinity Points bar in a character sheet.
 *
 * This sheet lets the GM:
 *  - View and manually override the current value and maximum
 *  - Add or remove recovery entries (e.g. recover on long rest)
 *  - Recalculate the maximum from the formula (@abilities.cua_0.mod)
 *
 * HOW ApplicationV2 WORKS:
 *   In Foundry v13+, sheets are built using the ApplicationV2 API.
 *   The key concepts are:
 *
 *   static DEFAULT_OPTIONS  — configuration object (window size, CSS classes, etc.)
 *   static PARTS            — maps part names to Handlebars template files.
 *                             Each part is rendered separately and merged.
 *   _preparePartContext()   — called before rendering; returns the data object
 *                             that gets passed to the template as variables.
 *   _processSubmitData()    — called when the form is submitted; receives the
 *                             parsed form data and applies the changes.
 *   static actions          — handlers for data-action buttons in the template.
 *                             Button: <button data-action="myAction">
 *                             Handler: static myAction(event, target) { ... }
 *
 *   BaseConfigSheetV2 is dnd5e's base class for item config sheets — it handles
 *   common boilerplate like submit/close/render lifecycle.
 */

import { DP_MODULE_NAME } from "./constants.js";
import { DivinityPoints } from "./divinitypoints.js";

// actor-bar-config.js
const _BaseConfigSheet = dnd5e?.applications?.actor?.BaseConfigSheetV2;

if (!_BaseConfigSheet) {
  console.error(
    `${DP_MODULE_NAME} | dnd5e.applications.actor.BaseConfigSheetV2 not found — the dnd5e system may have changed its API. The Divinity Points config sheet will not work.`,
  );
}

export const DP_BASE_SHEET_MISSING = !_BaseConfigSheet;

export class ActorDivinityPointsConfig extends (_BaseConfigSheet ?? class {}) {
  constructor(options) {
    // Merge our options into any options passed by the caller
    foundry.utils.mergeObject(options ?? {}, {
      // CSS classes applied to the window element
      classes: ["standard-form", "config-sheet", "themed", "sheet", "dnd5e2", "divinitypoints", "application"],
      position: { width: 420 },
      submitOnClose: true, // save when the user closes the window
      editable: true,
      submitOnChange: false, // don't save on every keystroke
      closeOnSubmit: false, // keep the window open after saving
      // Register named action handlers (called by data-action buttons in the template)
      actions: {
        deleteRecovery: ActorDivinityPointsConfig._deleteRecovery,
        addRecovery: ActorDivinityPointsConfig._addRecovery,
      },
    });
    super(options);
  }

  // ── Template configuration ─────────────────────────────────────────────────

  /**
   * Maps part names to Handlebars template paths.
   * "config" renders the main form content.
   */
  static PARTS = {
    config: {
      template: `modules/${DP_MODULE_NAME}/templates/divinity-points-popup-config.hbs`,
    },
  };

  // ── Data preparation ───────────────────────────────────────────────────────

  /**
   * Prepares the data that gets passed to the Handlebars template.
   * Called automatically by Foundry before each render.
   *
   * @param {string} partId  - Which PART is being rendered (always "config" here)
   * @param {object} context - The shared context object (built up across parts)
   * @param {object} options - Render options
   * @returns {object} The context object with our data added to it
   */
  async _preparePartContext(partId, context, options) {
    // Let the parent class add its own data first
    context = await super._preparePartContext(partId, context, options);

    // Add our item's uses data
    const uses = this.document.system.uses;
    context.uses = { ...uses, value: uses.max - (uses.spent ?? 0) };

    // Add a "value" property (current uses = max - spent) for the template
    context.uses.value = context.uses.max - (context.uses.spent ?? 0);
    context.img = this.document.img;
    context.name = this.document.name;

    // Build the list of recovery period options (Short Rest, Long Rest, etc.)
    // Filtered to exclude deprecated periods
    context.recoveryPeriods = [
      ...Object.entries(CONFIG.DND5E.limitedUsePeriods)
        .filter(([, { deprecated }]) => !deprecated)
        .map(([value, { label }]) => ({
          value,
          label,
          group: game.i18n.localize("DND5E.DurationTime"),
        })),
      {
        value: "recharge",
        label: game.i18n.localize("DND5E.USES.Recovery.Recharge.Label"),
      },
    ];

    // Build the list of recovery type options (Recover All, Lose All, Formula)
    context.recoveryTypes = [
      {
        value: "recoverAll",
        label: game.i18n.localize("DND5E.USES.Recovery.Type.RecoverAll"),
      },
      {
        value: "loseAll",
        label: game.i18n.localize("DND5E.USES.Recovery.Type.LoseAll"),
      },
      {
        value: "formula",
        label: game.i18n.localize("DND5E.USES.Recovery.Type.Formula"),
      },
    ];

    // Prepare each existing recovery entry with index and source data
    let recovery = this.document.system.uses.recovery ?? [];
    if (!Array.isArray(recovery)) recovery = Object.values(recovery);

    context.usesRecovery = recovery.map((data, index) => ({
      data,
      prefix: `uses.recovery.${index}.`, // used as field name prefix in the form
      source: context.uses?.recovery[index] ?? data,
      // For "recharge" type, provide the dice-face options
      formulaOptions: data.period === "recharge" ? data.recharge?.options : null,
    }));

    return context;
  }

  // ── Form submission ────────────────────────────────────────────────────────

  /**
   * Processes the form data when the user saves.
   * Called automatically when the form is submitted (or closed, due to submitOnClose).
   *
   * @param {Event}     event      - The submit event
   * @param {HTMLForm}  form       - The form element
   * @param {object}    submitData - Parsed form field values
   */
  async _processSubmitData(event, form, submitData) {
    const item = this.document;
    // Parse all named form fields into a structured object
    const fde = new foundry.applications.ux.FormDataExtended(form);
    const data = foundry.utils.expandObject(fde.object);

    // Build a minimal update object — only send what actually changed
    const originalUses = item.system.uses;
    const deltaUses = {};
    if (data.uses.max !== originalUses.max) deltaUses.max = data.uses.max;
    if (data.uses.max !== originalUses.max || data.uses.value !== originalUses.max - (originalUses.spent ?? 0)) {
      deltaUses.spent = (deltaUses.max ?? originalUses.max) - data.uses.value;
    }

    // Apply the update via the parent class
    await super._processSubmitData(event, form, Object.keys(deltaUses).length ? { "system.uses": deltaUses } : {});

    //   this.document.system.uses = changedUses;
    this.render(); // refresh the popup to show updated values
  }

  // ── Action handlers ────────────────────────────────────────────────────────
  // These are called when the user clicks a button with the matching data-action.
  // They are static and called with `this` = the ActorDivinityPointsConfig instance.

  /**
   * Adds a new (empty) recovery entry to the item.
   * Called by: <button data-action="addRecovery">
   */
  static _addRecovery(event, target) {
    const uses = foundry.utils.duplicate(this.document.system.uses);
    uses.recovery = [...(uses.recovery || []), {}]; // append empty entry
    this.document.update({ "system.uses.recovery": uses.recovery });
  }

  /**
   * Removes a recovery entry by its index.
   * Called by: <button data-action="deleteRecovery" data-index="N">
   */
  static _deleteRecovery(event, target) {
    const idx = Number(target.closest("[data-index]").dataset.index);
    const uses = foundry.utils.duplicate(this.document.system.uses);

    if (!Array.isArray(uses.recovery)) {
      uses.recovery = Object.values(uses.recovery || {});
    }

    uses.recovery.splice(idx, 1); // remove the entry at this index
    this.document.update({ "system.uses.recovery": uses.recovery });
  }

  // ── Window title ───────────────────────────────────────────────────────────

  /**
   * The text shown in the window title bar.
   * @returns {string}
   */
  get title() {
    return `${game.i18n.localize(`${DP_MODULE_NAME}.ItemConfig`)}: ${this.document.name}`;
  }
}

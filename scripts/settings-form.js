/**
 * settings-form.js
 *
 * A custom settings form that provides a colour picker for the resource bar
 * gradient colours and an animation toggle.
 *
 * It is registered in main.js via game.settings.registerMenu() and opens when
 * the GM clicks "Configure Bar Colours" in Module Settings.
 *
 * WHY A CUSTOM FORM?
 *   Foundry's built-in settings UI renders colours as plain text inputs.
 *   By using a custom form we can embed Foundry's native <color-picker>
 *   web component, which provides a proper colour swatch + hex input.
 *
 * HOW ApplicationV2 SETTINGS FORMS WORK:
 *   The form is an ApplicationV2 application (Foundry v13+ API).
 *   Key parts:
 *
 *   static DEFAULT_OPTIONS  — window configuration
 *   static PARTS            — maps "form" and "footer" to template files.
 *                             "footer" uses Foundry's built-in form-footer.hbs
 *                             which renders the Save Changes button.
 *   _prepareContext()       — returns data for the template
 *   _onChangeForm()         — called on every input change (used for live preview)
 *   _onRender()             — called after the form is first rendered
 *   static #onSubmit()      — private method called when the form is saved.
 *                             The # prefix means it's a private class field
 *                             (only accessible inside this class).
 */

import { DP_MODULE_NAME } from "./constants.js";
import { DivinityPoints } from "./divinitypoints.js";

// Destructure the ApplicationV2 API classes from Foundry's global namespace
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * HandlebarsApplicationMixin is a "mixin" — a function that takes a base class
 * and returns a new class that adds Handlebars template rendering capabilities.
 *
 * Pattern: class MyClass extends SomeMixin(BaseClass)
 * This gives MyClass the features of both SomeMixin and BaseClass.
 */
export class DpSettingsForm extends HandlebarsApplicationMixin(ApplicationV2) {

  // ── Window configuration ───────────────────────────────────────────────────

  static DEFAULT_OPTIONS = {
    id:      "dp-settings-form",
    classes: ["dnd5e-divinitypoints", "dp-settings-form"],

    // form: configuration for the <form> element behaviour
    form: {
      handler:        DpSettingsForm.#onSubmit, // called when form is submitted
      closeOnSubmit:  true,                     // close window after saving
      submitOnChange: false,                    // don't auto-save on every change
    },

    position: { width: 420 },
    tag:      "form", // renders the application root as a <form> element

    window: {
      contentClasses: ["standard-form"],
      icon:           "fas fa-palette",
      // Title is a localisation key — Foundry resolves it from en.json
      title:          `${DP_MODULE_NAME}.colorSettingsTitle`,
    },
  };

  // ── Template parts ─────────────────────────────────────────────────────────

  static PARTS = {
    // Main form content — our custom template with colour pickers
    form: {
      template: `modules/${DP_MODULE_NAME}/templates/dp-settings-form.hbs`,
    },
    // Save button — Foundry's built-in footer template renders a submit button
    // using the `buttons` array we pass from _prepareContext()
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  };

  // ── Data preparation ───────────────────────────────────────────────────────

  /**
   * Returns the data object that gets passed to the Handlebars template.
   * Variable names here become available in the .hbs template as {{colorL}} etc.
   *
   * @returns {object}
   */
  _prepareContext() {
    return {
      colorL:  game.settings.get(DP_MODULE_NAME, "dpColorL"),
      colorR:  game.settings.get(DP_MODULE_NAME, "dpColorR"),
      animate: game.settings.get(DP_MODULE_NAME, "dpAnimateBar"),
      // The footer template expects a `buttons` array
      buttons: [
        { type: "submit", icon: "fa-solid fa-save", label: "SETTINGS.Save" },
      ],
    };
  }

  // ── Live preview ───────────────────────────────────────────────────────────

  /**
   * Called automatically whenever any form field changes (colour picker, checkbox).
   * We use this to update the preview bar in real time without saving.
   *
   * HOW THE PREVIEW WORKS:
   *   The preview bar (.dp-preview-fill) has its background set via inline styles.
   *   We read the current picker values and apply them directly — no need to
   *   wait for the form to be saved.
   *
   * @param {object} formConfig - Internal form configuration (unused here)
   * @param {Event}  event      - The input change event
   */
  _onChangeForm(formConfig, event) {
    // Let the parent class do its normal handling first
    super._onChangeForm(formConfig, event);

    const form = this.element;
    if (!form) return;

    // Read the current values from the form fields.
    // The ?. (optional chaining) returns undefined if the element isn't found,
    // and ?? falls back to the saved setting value.
    const colorL  = form.querySelector("color-picker[name='colorL']")?.value
      ?? game.settings.get(DP_MODULE_NAME, "dpColorL");
    const colorR  = form.querySelector("color-picker[name='colorR']")?.value
      ?? game.settings.get(DP_MODULE_NAME, "dpColorR");
    const animate = form.querySelector("input[name='animate']")?.checked ?? true;

    // Update the preview bar's inline styles directly
    const fill = form.querySelector(".dp-preview-fill");
    if (fill) {
      fill.style.background      = `linear-gradient(to right, ${colorL}, ${colorR}, ${colorL})`;
      fill.style.backgroundSize  = "200% 100%";
      fill.style.animationName   = animate ? "dp-scroll" : "none";
    }
  }

  /**
   * Called once after the form finishes rendering for the first time.
   * We trigger _onChangeForm to set the initial preview state.
   *
   * @param {object} context - The prepared context data
   * @param {object} options - Render options
   */
  _onRender(context, options) {
    // Pass empty objects — _onChangeForm doesn't need real arguments here
    this._onChangeForm({}, {});
  }

  // ── Save handler ───────────────────────────────────────────────────────────

  /**
   * Saves all settings when the form is submitted.
   * The # prefix makes this a private class method — it can only be referenced
   * inside this class (e.g. in DEFAULT_OPTIONS.form.handler above).
   *
   * @param {Event}          event    - The submit event
   * @param {HTMLFormElement} form    - The form element
   * @param {FormDataExtended} formData - Parsed form field values
   */
  static async #onSubmit(event, form, formData) {
    // expandObject converts flat "key.subkey" paths into nested objects
    const data = foundry.utils.expandObject(formData.object);

    // Save each setting — fall back to the default if the value is missing
    await game.settings.set(DP_MODULE_NAME, "dpColorL",    data.colorL  ?? "#4a1060");
    await game.settings.set(DP_MODULE_NAME, "dpColorR",    data.colorR  ?? "#c89020");
    await game.settings.set(DP_MODULE_NAME, "dpAnimateBar", data.animate ?? true);

    // Re-apply CSS variables so the character sheet bar updates immediately
    DivinityPoints.setDpColors();
  }
}
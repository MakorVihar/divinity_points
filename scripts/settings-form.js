import { DP_MODULE_NAME } from "./constants.js";
import { DivinityPoints } from "./divinitypoints.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DpSettingsForm extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dp-settings-form",
    classes: ["dnd5e-divinitypoints", "dp-settings-form"],
    form: {
      handler:        DpSettingsForm.#onSubmit,
      closeOnSubmit:  true,
      submitOnChange: false,
    },
    position: { width: 420 },
    tag: "form",
    window: {
      contentClasses: ["standard-form"],
      icon:  "fas fa-palette",
      title: `${DP_MODULE_NAME}.colorSettingsTitle`,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${DP_MODULE_NAME}/templates/dp-settings-form.hbs`,
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  };

  _prepareContext() {
    return {
      colorL:  game.settings.get(DP_MODULE_NAME, "dpColorL"),
      colorR:  game.settings.get(DP_MODULE_NAME, "dpColorR"),
      animate: game.settings.get(DP_MODULE_NAME, "dpAnimateBar"),
      buttons: [
        { type: "submit", icon: "fa-solid fa-save", label: "SETTINGS.Save" },
      ],
    };
  }

  /** Update preview bar live whenever a color or animate value changes */
  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);
    const form = this.element;
    if (!form) return;

    const colorL  = form.querySelector("color-picker[name='colorL']")?.value
      ?? game.settings.get(DP_MODULE_NAME, "dpColorL");
    const colorR  = form.querySelector("color-picker[name='colorR']")?.value
      ?? game.settings.get(DP_MODULE_NAME, "dpColorR");
    const animate = form.querySelector("input[name='animate']")?.checked ?? true;

    const fill = form.querySelector(".dp-preview-fill");
    if (fill) {
      fill.style.background = `linear-gradient(to right, ${colorL}, ${colorR}, ${colorL})`;
      fill.style.backgroundSize = "200% 100%";
      fill.style.animationName  = animate ? "dp-scroll" : "none";
    }
  }

  /** Set preview on initial render */
  _onRender(context, options) {
    this._onChangeForm({}, {});
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await game.settings.set(DP_MODULE_NAME, "dpColorL",    data.colorL  ?? "#4a1060");
    await game.settings.set(DP_MODULE_NAME, "dpColorR",    data.colorR  ?? "#c89020");
    await game.settings.set(DP_MODULE_NAME, "dpAnimateBar", data.animate ?? true);
    DivinityPoints.setDpColors();
  }
}
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
    position: { width: 400 },
    tag: "form",
    window: {
      contentClasses: ["standard-form"],
      icon:  "fas fa-khanda",
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

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await game.settings.set(DP_MODULE_NAME, "dpColorL",    data.colorL  ?? "#4a1060");
    await game.settings.set(DP_MODULE_NAME, "dpColorR",    data.colorR  ?? "#c89020");
    await game.settings.set(DP_MODULE_NAME, "dpAnimateBar", data.animate ?? true);
    DivinityPoints.setDpColors();
  }
}

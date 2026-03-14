import { DP_MODULE_NAME } from "./constants.js";
import { DivinityPoints } from "./divinitypoints.js";

export class ActorDivinityPointsConfig extends dnd5e.applications.actor.BaseConfigSheetV2 {

  constructor(options) {
    foundry.utils.mergeObject(options ?? {}, {
      classes: ['standard-form', 'config-sheet', 'themed', 'sheet', 'dnd5e2', 'divinitypoints', 'application'],
      position: { width: 420 },
      submitOnClose: true,
      editable: true,
      submitOnChange: false,
      closeOnSubmit: false,
      actions: {
        updateDpMax:    ActorDivinityPointsConfig._updateDpMax,
        deleteRecovery: ActorDivinityPointsConfig._deleteRecovery,
        addRecovery:    ActorDivinityPointsConfig._addRecovery,
      },
    });
    super(options);
  }

  static PARTS = {
    config: { template: `modules/${DP_MODULE_NAME}/templates/divinity-points-popup-config.hbs` },
  };

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);

    context.uses       = this.document.system.uses;
    context.uses.value = context.uses.max - (context.uses.spent ?? 0);
    context.img        = this.document.img;
    context.name       = this.document.name;

    context.recoveryPeriods = [
      ...Object.entries(CONFIG.DND5E.limitedUsePeriods)
        .filter(([, { deprecated }]) => !deprecated)
        .map(([value, { label }]) => ({ value, label, group: game.i18n.localize('DND5E.DurationTime') })),
      { value: 'recharge', label: game.i18n.localize('DND5E.USES.Recovery.Recharge.Label') },
    ];

    context.recoveryTypes = [
      { value: 'recoverAll', label: game.i18n.localize('DND5E.USES.Recovery.Type.RecoverAll') },
      { value: 'loseAll',    label: game.i18n.localize('DND5E.USES.Recovery.Type.LoseAll') },
      { value: 'formula',    label: game.i18n.localize('DND5E.USES.Recovery.Type.Formula') },
    ];

    let recovery = this.document.system.uses.recovery ?? [];
    if (!Array.isArray(recovery)) recovery = Object.values(recovery);
    context.usesRecovery = recovery.map((data, index) => ({
      data,
      prefix: `uses.recovery.${index}.`,
      source: context.uses?.recovery[index] ?? data,
      formulaOptions: data.period === 'recharge' ? data.recharge?.options : null,
    }));

    return context;
  }

  async _processSubmitData(event, form, submitData) {
    const item = this.document;
    const fde  = new foundry.applications.ux.FormDataExtended(form);
    const data = foundry.utils.expandObject(fde.object);

    const original    = foundry.utils.duplicate(item.system.uses);
    data.uses.spent   = data.uses.max - data.uses.value;

    const delta = {};
    if (data.uses.max   !== original.max)   delta.max   = data.uses.max;
    if (data.uses.value !== original.value) delta.spent = data.uses.spent;

    const changedUses = foundry.utils.mergeObject(item.system.uses, data.uses);
    await super._processSubmitData(event, form, Object.keys(delta).length ? { 'system.uses': delta } : {});
    this.document.system.uses = changedUses;
    this.render();
  }

  static _addRecovery(event, target) {
    const uses = foundry.utils.duplicate(this.document.system.uses);
    uses.recovery = [...(uses.recovery || []), {}];
    this.document.update({ 'system.uses.recovery': uses.recovery });
  }

  static _deleteRecovery(event, target) {
    const idx  = Number(target.closest('[data-index]').dataset.index);
    const uses = foundry.utils.duplicate(this.document.system.uses);
    if (!Array.isArray(uses.recovery)) uses.recovery = Object.values(uses.recovery || {});
    uses.recovery.splice(idx, 1);
    this.document.update({ 'system.uses.recovery': uses.recovery });
  }

  static async _updateDpMax(event, target) {
    await DivinityPoints.recalculateMax(this.document.parent, this.document);
    this.render(true);
  }

  get title() {
    return `${game.i18n.localize(`${DP_MODULE_NAME}.ItemConfig`)}: ${this.document.name}`;
  }
}

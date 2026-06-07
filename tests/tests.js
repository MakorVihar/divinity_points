/**
 * tests.js
 *
 * Quench test batches for the Divinity Points module.
 *
 * REGISTRATION PATTERN:
 *   This file is loaded via dynamic import() from within the "quenchReady"
 *   hook in main.js. By the time that hook fires, both "ready" and
 *   "quenchReady" have already completed, so the global `quench` object is
 *   guaranteed to exist. registerTests() is called immediately with the quench
 *   instance passed from the hook — no Hooks wrapper or globalThis.quench
 *   guard needed.
 */

import { DP_MODULE_NAME } from "../scripts/constants.js";
import { DivinityPoints, buildConsumptionConfig, validateDpConsumption } from "../scripts/divinitypoints.js";

// ── Shared test helper ────────────────────────────────────────────────────────

/**
 * makeActor(overrides)
 *
 * Builds a plain object shaped like the parts of a Foundry Actor that this
 * module actually reads. Using a plain object rather than a real database actor
 * keeps unit-style tests fast and free of side effects.
 *
 * The `items` collection mirrors the Map-like API that Foundry's EmbeddedCollection
 * exposes: .get(id) and .find(fn). item.update() merges changes in memory.
 */
function makeActor(overrides = {}) {
  const resourceName = game.settings.get(DP_MODULE_NAME, "dpResource") ?? "Divinity Points";

  const dpItem = {
    _id: "item001",
    type: "feat",
    name: resourceName,
    system: {
      uses: { max: 5, spent: 2 },
      source: { custom: resourceName },
    },
    update: async function (data) {
      // Merge flat dotted keys (e.g. "system.uses.spent") directly onto the
      // object so assertions can read them back as dpItem["system.uses.spent"].
      Object.assign(this, data);
    },
    parent: null, // filled in below
  };

  const itemsMap = new Map([["item001", dpItem]]);
  const items = {
    get: (id) => itemsMap.get(id),
    find: (fn) => [...itemsMap.values()].find(fn) ?? false,
  };

  const actor = {
    type: "character",
    name: "Test Hero",
    permission: 3,
    flags: { dnd5edivinitypoints: { item: dpItem._id } },
    items,
    getRollData: () => ({ abilities: { cua_0: { mod: 4 } } }),
    update: async function (data) {
      foundry.utils.mergeObject(this, data);
    },
    ...overrides,
  };

  dpItem.parent = actor;
  return { actor, dpItem };
}

// ── Batch registration ────────────────────────────────────────────────────────

export function registerTests(quench) {
  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 1 — Static helpers
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.static-helpers",
    (context) => {
      const { describe, it, assert } = context;

      describe("isActorCharacter", () => {
        it("returns true for type 'character'", () => {
          assert.strictEqual(DivinityPoints.isActorCharacter({ type: "character" }), true);
        });
        it("returns true for type 'npc'", () => {
          assert.strictEqual(DivinityPoints.isActorCharacter({ type: "npc" }), true);
        });
        it("returns false for type 'vehicle'", () => {
          assert.strictEqual(DivinityPoints.isActorCharacter({ type: "vehicle" }), false);
        });
        it("returns false when type is undefined", () => {
          assert.strictEqual(DivinityPoints.isActorCharacter({}), false);
        });
      });

      describe("userHasActorOwnership", () => {
        it("returns true for permission level 3 (OWNER)", () => {
          assert.ok(DivinityPoints.userHasActorOwnership({ permission: 3 }));
        });
        it("returns false for permission level 2 (OBSERVER)", () => {
          assert.ok(!DivinityPoints.userHasActorOwnership({ permission: 2 }));
        });
        it("returns false for permission level 0 (NONE)", () => {
          assert.ok(!DivinityPoints.userHasActorOwnership({ permission: 0 }));
        });
      });

      describe("getActorFlagDpItem", () => {
        it("returns the item id when the flag is set", () => {
          const actor = { flags: { dnd5edivinitypoints: { item: "abc123" } } };
          assert.strictEqual(DivinityPoints.getActorFlagDpItem(actor), "abc123");
        });
        it("returns false for an empty string flag", () => {
          assert.strictEqual(DivinityPoints.getActorFlagDpItem({ flags: { dnd5edivinitypoints: { item: "" } } }), false);
        });
        it("returns false when the flag namespace is absent", () => {
          assert.strictEqual(DivinityPoints.getActorFlagDpItem({ flags: {} }), false);
        });
        it("returns false when actor is null", () => {
          assert.strictEqual(DivinityPoints.getActorFlagDpItem(null), false);
        });
      });

      describe("isDivinityItem", () => {
        it("returns true when source.custom matches the resource name", () => {
          const name = DivinityPoints.settings.dpResource;
          assert.ok(DivinityPoints.isDivinityItem({ type: "feat", name: "Other", system: { source: { custom: name } } }));
        });
        it("returns true when item name matches the resource name (fallback)", () => {
          const name = DivinityPoints.settings.dpResource;
          assert.ok(DivinityPoints.isDivinityItem({ type: "feat", name, system: { source: { custom: "wrong" } } }));
        });
        it("returns false when item type is not 'feat'", () => {
          const name = DivinityPoints.settings.dpResource;
          assert.ok(!DivinityPoints.isDivinityItem({ type: "spell", name, system: { source: { custom: name } } }));
        });
        it("returns false when neither name nor source.custom matches", () => {
          assert.ok(!DivinityPoints.isDivinityItem({ type: "feat", name: "Unrelated", system: { source: { custom: "Also Unrelated" } } }));
        });
      });

      describe("getDivinityPointsItem", () => {
        it("returns false when actor is null", () => {
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(null), false);
        });
        it("finds the item via the actor flag (primary lookup)", () => {
          const { actor, dpItem } = makeActor();
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor)._id, dpItem._id);
        });
        it("falls back to scanning feats by source.custom when flag is missing", () => {
          const { actor, dpItem } = makeActor();
          actor.flags = {};
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor)._id, dpItem._id);
        });
        it("returns false when no items match", () => {
          const { actor } = makeActor();
          actor.flags = {};
          actor.items = { get: () => undefined, find: () => false };
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor), false);
        });
      });

      describe("defaultSettings", () => {
        it("has a dpResource string", () => {
          assert.strictEqual(typeof DivinityPoints.defaultSettings.dpResource, "string");
        });
        it("has boolean values for all toggle settings", () => {
          const s = DivinityPoints.defaultSettings;
          for (const key of ["dpActivateBar", "dpAnimateBar", "dpGmOnly", "dpChatPrivate", "dpBlockOnInsufficient"]) {
            assert.strictEqual(typeof s[key], "boolean", `${key} should be boolean`);
          }
        });
        it("default colours are valid 6-digit hex strings", () => {
          const { dpColorL, dpColorR } = DivinityPoints.defaultSettings;
          assert.match(dpColorL, /^#[0-9a-fA-F]{6}$/);
          assert.match(dpColorR, /^#[0-9a-fA-F]{6}$/);
        });
      });
    },
    { displayName: "Divinity Points: Static Helpers" },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 2 — updateDivinityItem
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.update-divinity-item",
    (context) => {
      const { describe, it, assert } = context;

      describe("spent/max arithmetic", () => {
        it("sets max when only max is provided", async () => {
          const { dpItem } = makeActor();
          await DivinityPoints.updateDivinityItem(dpItem, null, 10);
          assert.strictEqual(dpItem["system.uses.max"], 10);
        });

        it("sets spent correctly from value when only value is provided", async () => {
          const { dpItem } = makeActor(); // max=5, spent=2
          await DivinityPoints.updateDivinityItem(dpItem, 4, null);
          // spent = max(5) - value(4) = 1
          assert.strictEqual(dpItem["system.uses.spent"], 1);
        });

        it("derives spent from the new max when both value and max are provided", async () => {
          const { dpItem } = makeActor();
          await DivinityPoints.updateDivinityItem(dpItem, 3, 8);
          // spent = newMax(8) - value(3) = 5
          assert.strictEqual(dpItem["system.uses.spent"], 5);
          assert.strictEqual(dpItem["system.uses.max"], 8);
        });

        it("does nothing when both arguments are null", async () => {
          const { dpItem } = makeActor();
          await DivinityPoints.updateDivinityItem(dpItem, null, null);
          // No dotted keys should have been written
          assert.strictEqual(dpItem["system.uses.spent"], undefined);
        });

        it("does nothing when item is falsy", async () => {
          // Should not throw for null or undefined
          await DivinityPoints.updateDivinityItem(null, 3, 5);
          await DivinityPoints.updateDivinityItem(undefined, 3, 5);
        });
      });
    },
    { displayName: "Divinity Points: updateDivinityItem" },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 3 — withActorData
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.with-actor-data",
    (context) => {
      const { describe, it, assert, before, after } = context;

      // A real Actor is required so Roll.create() can resolve @-variables
      // against genuine roll data. We create one temporarily and delete it after.
      let actor;

      before(async () => {
        actor = await Actor.create({ name: "DP withActorData Test (delete me)", type: "character" });
      });

      after(async () => {
        await actor?.delete();
      });

      it("returns 0 for null", async () => {
        assert.strictEqual(await DivinityPoints.withActorData(null, actor), 0);
      });

      it("returns 0 for an empty string", async () => {
        assert.strictEqual(await DivinityPoints.withActorData("", actor), 0);
      });

      it("evaluates a plain integer", async () => {
        assert.strictEqual(await DivinityPoints.withActorData("5", actor), 5);
      });

      it("evaluates simple arithmetic", async () => {
        assert.strictEqual(await DivinityPoints.withActorData("2 + 3", actor), 5);
      });

      it("returns a number (not throws) for an invalid formula", async () => {
        const result = await DivinityPoints.withActorData("@nonexistent.path", actor);
        assert.strictEqual(typeof result, "number");
      });

      it("evaluates @abilities.str.mod using the actor's real roll data", async () => {
        const expected = actor.getRollData().abilities?.str?.mod ?? 0;
        assert.strictEqual(await DivinityPoints.withActorData("@abilities.str.mod", actor), expected);
      });
    },
    { displayName: "Divinity Points: withActorData" },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 4 — validateDpConsumption
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.validate-dp-consumption",
    (context) => {
      const { describe, it, assert, before, after } = context;

      function makeActivity({ actor, cost = 2, isDeterministic = true, type = "divinityPoints" } = {}) {
        return {
          actor,
          consumption: {
            targets: [
              {
                type,
                resolveCost: () => ({
                  isDeterministic,
                  evaluateSync: () => ({ total: cost }),
                }),
              },
            ],
          },
        };
      }

      describe("early exits", () => {
        it("returns undefined when activity has no actor", () => {
          assert.strictEqual(validateDpConsumption({ actor: null }, {}), undefined);
        });
        it("returns undefined for non-character actor types", () => {
          const { actor } = makeActor({ type: "vehicle" });
          assert.strictEqual(validateDpConsumption(makeActivity({ actor }), {}), undefined);
        });
        it("returns undefined when there are no divinityPoints targets", () => {
          const { actor } = makeActor();
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, type: "spellSlot" }), {}), undefined);
        });
        it("returns undefined for non-deterministic costs (lets consume() handle them)", () => {
          const { actor } = makeActor();
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, isDeterministic: false }), {}), undefined);
        });
      });

      describe("with dpBlockOnInsufficient = true", () => {
        before(() => game.settings.set(DP_MODULE_NAME, "dpBlockOnInsufficient", true));

        it("returns false when the actor has no DP item", () => {
          const { actor } = makeActor();
          actor.flags = {};
          actor.items = { get: () => undefined, find: () => false };
          assert.strictEqual(validateDpConsumption(makeActivity({ actor }), {}), false);
        });

        it("returns false when available points are less than the cost", () => {
          // available = max(5) - spent(4) = 1, cost = 2
          const { actor } = makeActor();
          actor.items.get("item001").system.uses = { max: 5, spent: 4 };
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, cost: 2 }), {}), false);
        });

        it("returns undefined (allows) when points exactly equal the cost", () => {
          // available = max(5) - spent(3) = 2, cost = 2
          const { actor } = makeActor();
          actor.items.get("item001").system.uses = { max: 5, spent: 3 };
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, cost: 2 }), {}), undefined);
        });

        it("returns undefined when available points exceed the cost", () => {
          // available = 5, cost = 2
          const { actor } = makeActor();
          actor.items.get("item001").system.uses = { max: 5, spent: 0 };
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, cost: 2 }), {}), undefined);
        });
      });

      describe("with dpBlockOnInsufficient = false (warn-only)", () => {
        before(() => game.settings.set(DP_MODULE_NAME, "dpBlockOnInsufficient", false));
        after(() => game.settings.set(DP_MODULE_NAME, "dpBlockOnInsufficient", true));

        it("returns undefined even when points are insufficient", () => {
          const { actor } = makeActor();
          actor.items.get("item001").system.uses = { max: 5, spent: 5 }; // 0 available
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, cost: 3 }), {}), undefined);
        });
      });
    },
    { displayName: "Divinity Points: validateDpConsumption" },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 5 — buildConsumptionConfig
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.build-consumption-config",
    (context) => {
      const { describe, it, assert, before } = context;

      let config;
      before(() => {
        config = buildConsumptionConfig();
      });

      describe("shape", () => {
        it("has a consume function", () => {
          assert.strictEqual(typeof config.consume, "function");
        });
        it("has a consumptionLabels function", () => {
          assert.strictEqual(typeof config.consumptionLabels, "function");
        });
        it("label getter returns the current dpResource setting", () => {
          assert.strictEqual(config.label, DivinityPoints.settings.dpResource);
        });
        it("label getter reflects setting changes dynamically", async () => {
          const original = game.settings.get(DP_MODULE_NAME, "dpResource");
          await game.settings.set(DP_MODULE_NAME, "dpResource", "TEST_NAME");
          assert.strictEqual(config.label, "TEST_NAME");
          await game.settings.set(DP_MODULE_NAME, "dpResource", original);
        });
      });

      describe("consumptionLabels", () => {
        function makeTarget({ actor, cost = 2, isDeterministic = true } = {}) {
          return {
            actor,
            resolveCost: () => ({
              isDeterministic,
              evaluateSync: () => ({ total: cost }),
            }),
          };
        }

        it("returns an object with label, hint, and warn", () => {
          const { actor } = makeActor();
          const result = config.consumptionLabels.call(makeTarget({ actor }), {}, {});
          assert.ok("label" in result);
          assert.ok("hint" in result);
          assert.ok("warn" in result);
        });

        it("sets warn=true when cost exceeds available points", () => {
          const { actor } = makeActor();
          actor.items.get("item001").system.uses = { max: 5, spent: 4 }; // available=1
          const result = config.consumptionLabels.call(makeTarget({ actor, cost: 3 }), {}, {});
          assert.strictEqual(result.warn, true);
        });

        it("sets warn=false when cost is within available points", () => {
          const { actor } = makeActor();
          actor.items.get("item001").system.uses = { max: 5, spent: 0 }; // available=5
          const result = config.consumptionLabels.call(makeTarget({ actor, cost: 2 }), {}, {});
          assert.strictEqual(result.warn, false);
        });

        it("sets warn=false for non-deterministic costs", () => {
          const { actor } = makeActor();
          const result = config.consumptionLabels.call(makeTarget({ actor, isDeterministic: false }), {}, {});
          assert.strictEqual(result.warn, false);
        });
      });
    },
    { displayName: "Divinity Points: buildConsumptionConfig" },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 6 — alterDivinityPoints
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.alter-divinity-points",
    (context) => {
      const { describe, it, assert } = context;

      describe("guard clauses", () => {
        it("does nothing when actor is null", async () => {
          await DivinityPoints.alterDivinityPoints(null, 3);
        });
        it("does nothing for non-character actor types", async () => {
          const { actor, dpItem } = makeActor({ type: "vehicle" });
          await DivinityPoints.alterDivinityPoints(actor, 3);
          assert.strictEqual(dpItem["system.uses.spent"], undefined); // update was never called
        });
        it("does nothing when the actor has no DP item", async () => {
          const { actor } = makeActor();
          actor.flags = {};
          actor.items = { get: () => undefined, find: () => false };
          await DivinityPoints.alterDivinityPoints(actor, 3); // should not throw
        });
      });

      describe("value clamping", () => {
        it("clamps a negative value to 0 (fully spent)", async () => {
          const { actor, dpItem } = makeActor(); // max=5
          await DivinityPoints.alterDivinityPoints(actor, -5);
          // spent = max(5) - clamp(-5 → 0) = 5
          assert.strictEqual(dpItem["system.uses.spent"], 5);
        });

        it("clamps a value above max down to max (fully available)", async () => {
          const { actor, dpItem } = makeActor(); // max=5
          await DivinityPoints.alterDivinityPoints(actor, 999);
          // spent = max(5) - clamp(999 → 5) = 0
          assert.strictEqual(dpItem["system.uses.spent"], 0);
        });

        it("sets a value exactly at max (boundary)", async () => {
          const { actor, dpItem } = makeActor(); // max=5
          await DivinityPoints.alterDivinityPoints(actor, 5);
          assert.strictEqual(dpItem["system.uses.spent"], 0);
        });

        it("sets a value of 0 correctly (fully spent)", async () => {
          const { actor, dpItem } = makeActor(); // max=5
          await DivinityPoints.alterDivinityPoints(actor, 0);
          assert.strictEqual(dpItem["system.uses.spent"], 5);
        });
      });

      describe("updating max", () => {
        it("updates max when only max is provided", async () => {
          const { actor, dpItem } = makeActor();
          await DivinityPoints.alterDivinityPoints(actor, undefined, 10);
          assert.strictEqual(dpItem["system.uses.max"], 10);
        });
      });
    },
    { displayName: "Divinity Points: alterDivinityPoints" },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 7 — World integration (real database round-trips)
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.world-integration",
    (context) => {
      const { describe, it, assert, before, after } = context;

      describe("getDivinityPointsItem on a real embedded item", () => {
        let actor, dpItem;

        before(async () => {
          const resourceName = DivinityPoints.settings.dpResource;
          actor = await Actor.create({ name: "DP Integration Test (delete me)", type: "character" });
          [dpItem] = await actor.createEmbeddedDocuments("Item", [
            {
              name: resourceName,
              type: "feat",
              system: { source: { custom: resourceName } },
            },
          ]);
          await actor.update({ flags: { dnd5edivinitypoints: { item: dpItem.id } } });
        });

        after(async () => {
          await actor?.delete();
        });

        it("finds the item via the actor flag", () => {
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor).id, dpItem.id);
        });

        it("finds the item by source.custom scan when flag is cleared", async () => {
          await actor.update({ "flags.dnd5edivinitypoints.-=item": null });
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor).id, dpItem.id);
          await actor.update({ flags: { dnd5edivinitypoints: { item: dpItem.id } } });
        });

        it("isDivinityItem returns true for the real item", () => {
          assert.ok(DivinityPoints.isDivinityItem(dpItem));
        });
      });

      describe("processFirstDrop duplicate prevention", () => {
        let actor;

        before(async () => {
          const resourceName = DivinityPoints.settings.dpResource;
          actor = await Actor.create({ name: "DP Duplicate Test (delete me)", type: "character" });
          const [first] = await actor.createEmbeddedDocuments("Item", [
            {
              name: resourceName,
              type: "feat",
              system: { source: { custom: resourceName } },
            },
          ]);
          await actor.update({ flags: { dnd5edivinitypoints: { item: first.id } } });
        });

        after(async () => {
          await actor?.delete();
        });

        it("renames a duplicate item so the GM can identify it", async () => {
          const resourceName = DivinityPoints.settings.dpResource;
          const [duplicate] = await actor.createEmbeddedDocuments("Item", [
            {
              name: resourceName,
              type: "feat",
              system: { source: { custom: resourceName } },
            },
          ]);
          await DivinityPoints.processFirstDrop(duplicate);
          const updated = actor.items.get(duplicate.id);
          assert.ok(updated.name !== resourceName, "duplicate should be renamed");
          assert.ok(updated.name.length > resourceName.length, "renamed item should have a suffix");
        });
      });
    },
    { displayName: "Divinity Points: World Integration" },
  );
} // end registerTests

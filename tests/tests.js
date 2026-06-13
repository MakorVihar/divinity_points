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
 * Creates a real Foundry Actor with a real embedded "feat" item acting as the
 * Divinity Points resource, and stores its id in the actor's flags. Returns
 * { actor, dpItem }. Caller is responsible for deleting the actor afterwards
 * (e.g. in an `after`/`afterEach` hook) via `actor.delete()`.
 *
 * NOTE: `overrides.type` (if provided) is applied to the actor's type at
 * creation time. Other overrides are NOT supported as a generic merge —
 * callers needing a non-character actor should pass { type: "vehicle" } etc.
 */
async function makeActor(overrides = {}) {
  const resourceName = game.settings.get(DP_MODULE_NAME, "dpResource") ?? "Divinity Points";

  const actor = await Actor.create({
    name: "Test Hero",
    type: overrides.type ?? "character",
  });

  const [dpItem] = await actor.createEmbeddedDocuments("Item", [
    {
      name: resourceName,
      type: "feat",
      system: {
        uses: { max: 5, spent: 2 },
        source: { custom: resourceName },
      },
    },
  ]);

  await actor.setFlag("dnd5e-divinitypoints", "item", dpItem.id);

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

      describe("getActorFlagDpItem", () => {
        let actor;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
          }
        });

        it("returns the item id when the flag is set", async () => {
          actor = await Actor.create({ name: "Test Actor", type: "character" });
          await actor.setFlag("dnd5e-divinitypoints", "item", "abc123");

          assert.strictEqual(DivinityPoints.getActorFlagDpItem(actor), "abc123");
        });

        it("returns false for an empty string flag", async () => {
          actor = await Actor.create({ name: "Test Actor", type: "character" });
          await actor.setFlag("dnd5e-divinitypoints", "item", "");

          assert.strictEqual(DivinityPoints.getActorFlagDpItem(actor), false);
        });

        it("returns false when the flag namespace is absent", async () => {
          actor = await Actor.create({ name: "Test Actor", type: "character" });

          assert.strictEqual(DivinityPoints.getActorFlagDpItem(actor), false);
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
        let actor, dpItem;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("returns false when actor is null", () => {
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(null), false);
        });
        it("finds the item via the actor flag (primary lookup)", async () => {
          ({ actor, dpItem } = await makeActor());
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor).id, dpItem.id);
        });
        it("falls back to scanning feats by source.custom when flag is missing", async () => {
          ({ actor, dpItem } = await makeActor());
          await actor.unsetFlag("dnd5e-divinitypoints", "item");
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor).id, dpItem.id);
        });
        it("returns false when no items match", async () => {
          actor = await Actor.create({ name: "Test Actor", type: "character" });
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
        let actor, dpItem;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("sets max when only max is provided", async () => {
          ({ actor, dpItem } = await makeActor());
          await DivinityPoints.updateDivinityItem(dpItem, null, 10);
          assert.strictEqual(dpItem.system.uses.max, 10);
        });

        it("sets spent correctly from value when only value is provided", async () => {
          ({ actor, dpItem } = await makeActor()); // max=5, spent=2
          await DivinityPoints.updateDivinityItem(dpItem, 4, null);
          // spent = max(5) - value(4) = 1
          assert.strictEqual(dpItem.system.uses.spent, 1);
        });

        it("derives spent from the new max when both value and max are provided", async () => {
          ({ actor, dpItem } = await makeActor());
          await DivinityPoints.updateDivinityItem(dpItem, 3, 8);
          // spent = newMax(8) - value(3) = 5
          assert.strictEqual(dpItem.system.uses.spent, 5);
          assert.strictEqual(dpItem.system.uses.max, 8);
        });

        it("does nothing when both arguments are null", async () => {
          ({ actor, dpItem } = await makeActor());
          const spentBefore = dpItem.system.uses.spent;
          const maxBefore = dpItem.system.uses.max;
          await DivinityPoints.updateDivinityItem(dpItem, null, null);
          // Nothing should have changed
          assert.strictEqual(dpItem.system.uses.spent, spentBefore);
          assert.strictEqual(dpItem.system.uses.max, maxBefore);
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
      const { describe, it, assert, before, after, afterEach } = context;

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
        let actor, dpItem;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("returns undefined when activity has no actor", () => {
          assert.strictEqual(validateDpConsumption({ actor: null }, {}), undefined);
        });
        it("returns undefined for non-character actor types", async () => {
          ({ actor, dpItem } = await makeActor({ type: "vehicle" }));
          assert.strictEqual(validateDpConsumption(makeActivity({ actor }), {}), undefined);
        });
        it("returns undefined when there are no divinityPoints targets", async () => {
          ({ actor, dpItem } = await makeActor());
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, type: "spellSlot" }), {}), undefined);
        });
        it("returns undefined for non-deterministic costs (lets consume() handle them)", async () => {
          ({ actor, dpItem } = await makeActor());
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, isDeterministic: false }), {}), undefined);
        });
      });

      describe("with dpBlockOnInsufficient = true", () => {
        let actor, dpItem;

        before(() => game.settings.set(DP_MODULE_NAME, "dpBlockOnInsufficient", true));

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("returns false when the actor has no DP item", async () => {
          actor = await Actor.create({ name: "Test Actor", type: "character" });
          assert.strictEqual(validateDpConsumption(makeActivity({ actor }), {}), false);
        });

        it("returns false when available points are less than the cost", async () => {
          // available = max(5) - spent(4) = 1, cost = 2
          ({ actor, dpItem } = await makeActor());
          await dpItem.update({ "system.uses.spent": 4 });
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, cost: 2 }), {}), false);
        });

        it("returns undefined (allows) when points exactly equal the cost", async () => {
          // available = max(5) - spent(3) = 2, cost = 2
          ({ actor, dpItem } = await makeActor());
          await dpItem.update({ "system.uses.spent": 3 });
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, cost: 2 }), {}), undefined);
        });

        it("returns undefined when available points exceed the cost", async () => {
          // available = 5, cost = 2
          ({ actor, dpItem } = await makeActor());
          await dpItem.update({ "system.uses.spent": 0 });
          assert.strictEqual(validateDpConsumption(makeActivity({ actor, cost: 2 }), {}), undefined);
        });
      });

      describe("with dpBlockOnInsufficient = false (warn-only)", () => {
        let actor, dpItem;

        before(() => game.settings.set(DP_MODULE_NAME, "dpBlockOnInsufficient", false));
        after(() => game.settings.set(DP_MODULE_NAME, "dpBlockOnInsufficient", true));

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("returns undefined even when points are insufficient", async () => {
          ({ actor, dpItem } = await makeActor());
          await dpItem.update({ "system.uses.spent": 5 }); // 0 available
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
      const { describe, it, assert, before, afterEach } = context;

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
          // Stub the settings getter so the live `label` getter sees "TEST_NAME"
          // without touching the real game.settings store — avoids onChange side
          // effects (updateAllDpItemSources) AND avoids racing other concurrently
          // running tests that read the real dpResource setting (which would post
          // chat messages with "TEST_NAME" instead of the real resource name).
          const realGet = game.settings.get;
          game.settings.get = function (module, key) {
            if (module === DP_MODULE_NAME && key === "dpResource") return "TEST_NAME";
            return realGet.call(this, module, key);
          };

          try {
            assert.strictEqual(config.label, "TEST_NAME");
          } finally {
            game.settings.get = realGet;
          }
        });
      });

      describe("consumptionLabels", () => {
        let actor, dpItem;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        function makeTarget({ actor, cost = 2, isDeterministic = true } = {}) {
          return {
            actor,
            resolveCost: () => ({
              isDeterministic,
              evaluateSync: () => ({ total: cost }),
            }),
          };
        }

        it("returns an object with label, hint, and warn", async () => {
          ({ actor, dpItem } = await makeActor());
          const result = config.consumptionLabels.call(makeTarget({ actor }), {}, {});
          assert.ok("label" in result);
          assert.ok("hint" in result);
          assert.ok("warn" in result);
        });

        it("sets warn=true when cost exceeds available points", async () => {
          ({ actor, dpItem } = await makeActor());
          await dpItem.update({ "system.uses.spent": 4 }); // available=1
          const result = config.consumptionLabels.call(makeTarget({ actor, cost: 3 }), {}, {});
          assert.strictEqual(result.warn, true);
        });

        it("sets warn=false when cost is within available points", async () => {
          ({ actor, dpItem } = await makeActor());
          await dpItem.update({ "system.uses.spent": 0 }); // available=5
          const result = config.consumptionLabels.call(makeTarget({ actor, cost: 2 }), {}, {});
          assert.strictEqual(result.warn, false);
        });

        it("sets warn=false for non-deterministic costs", async () => {
          ({ actor, dpItem } = await makeActor());
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
      const { describe, it, assert, afterEach } = context;

      describe("guard clauses", () => {
        let actor, dpItem;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("does nothing when actor is null", async () => {
          await DivinityPoints.alterDivinityPoints(null, 3);
        });
        it("does nothing for non-character actor types", async () => {
          ({ actor, dpItem } = await makeActor({ type: "vehicle" }));
          const spentBefore = dpItem.system.uses.spent;
          await DivinityPoints.alterDivinityPoints(actor, 3);
          assert.strictEqual(dpItem.system.uses.spent, spentBefore); // update was never called
        });
        it("does nothing when the actor has no DP item", async () => {
          actor = await Actor.create({ name: "Test Actor", type: "character" });
          await DivinityPoints.alterDivinityPoints(actor, 3); // should not throw
        });
      });

      describe("value clamping", () => {
        let actor, dpItem;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("clamps a negative value to 0 (fully spent)", async () => {
          ({ actor, dpItem } = await makeActor()); // max=5
          await DivinityPoints.alterDivinityPoints(actor, -5);
          // spent = max(5) - clamp(-5 → 0) = 5
          assert.strictEqual(dpItem.system.uses.spent, 5);
        });

        it("clamps a value above max down to max (fully available)", async () => {
          ({ actor, dpItem } = await makeActor()); // max=5
          await DivinityPoints.alterDivinityPoints(actor, 999);
          // spent = max(5) - clamp(999 → 5) = 0
          assert.strictEqual(dpItem.system.uses.spent, 0);
        });

        it("sets a value exactly at max (boundary)", async () => {
          ({ actor, dpItem } = await makeActor()); // max=5
          await DivinityPoints.alterDivinityPoints(actor, 5);
          assert.strictEqual(dpItem.system.uses.spent, 0);
        });

        it("sets a value of 0 correctly (fully spent)", async () => {
          ({ actor, dpItem } = await makeActor()); // max=5
          await DivinityPoints.alterDivinityPoints(actor, 0);
          assert.strictEqual(dpItem.system.uses.spent, 5);
        });
      });

      describe("updating max", () => {
        let actor, dpItem;

        afterEach(async () => {
          if (actor) {
            await actor.delete();
            actor = null;
            dpItem = null;
          }
        });

        it("updates max when only max is provided", async () => {
          ({ actor, dpItem } = await makeActor());
          await DivinityPoints.alterDivinityPoints(actor, undefined, 10);
          assert.strictEqual(dpItem.system.uses.max, 10);
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
          await actor.setFlag("dnd5e-divinitypoints", "item", dpItem.id);
        });

        after(async () => {
          await actor?.delete();
        });

        it("finds the item via the actor flag", () => {
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor).id, dpItem.id);
        });

        it("finds the item by source.custom scan when flag is cleared", async () => {
          await actor.unsetFlag("dnd5e-divinitypoints", "item");
          assert.strictEqual(DivinityPoints.getDivinityPointsItem(actor).id, dpItem.id);
          await actor.setFlag("dnd5e-divinitypoints", "item", dpItem.id);
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
          await actor.setFlag("dnd5e-divinitypoints", "item", first.id);
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

          // createEmbeddedDocuments triggers the "createItem" hook in main.js, which
          // calls DivinityPoints.processFirstDrop(duplicate) automatically (since
          // this item matches isDivinityItem). That call is async and not awaited
          // by the hook dispatcher, so poll until the rename takes effect rather
          // than calling processFirstDrop again ourselves.
          const resourceNameLength = resourceName.length;
          let updated = actor.items.get(duplicate.id);

          for (let i = 0; i < 20 && updated.name.length === resourceNameLength; i++) {
            await new Promise((r) => setTimeout(r, 25));
            updated = actor.items.get(duplicate.id);
          }

          assert.ok(updated.name !== resourceName, "duplicate should be renamed");
          assert.ok(updated.name.length > resourceName.length, "renamed item should have a suffix");
        });
      });
    },
    { displayName: "Divinity Points: World Integration" },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH 8 — ActorDivinityPointsConfig base class resolution
  // ═══════════════════════════════════════════════════════════════════════════

  quench.registerBatch(
    "dnd5e-divinitypoints.actor-bar-config",
    (context) => {
      const { describe, it, assert } = context;

      describe("base class resolution", () => {
        it("dnd5e.applications.actor.BaseConfigSheetV2 exists in this environment", () => {
          // This is the path actor-bar-config.js depends on at module-evaluation
          // time. If dnd5e restructures its applications namespace, this is the
          // canary that should fail first, before users hit the silent fallback.
          assert.ok(
            dnd5e?.applications?.actor?.BaseConfigSheetV2,
            "dnd5e.applications.actor.BaseConfigSheetV2 is missing — actor-bar-config.js will use its fallback base class",
          );
        });

        it("DP_BASE_SHEET_MISSING reflects whether the real base class was found", async () => {
          const { DP_BASE_SHEET_MISSING } = await import("../scripts/actor-bar-config.js");
          const expected = !dnd5e?.applications?.actor?.BaseConfigSheetV2;
          assert.strictEqual(DP_BASE_SHEET_MISSING, expected);
        });

        it("ActorDivinityPointsConfig extends a class with a render method", async () => {
          // Whether it's BaseConfigSheetV2 or the bare fallback, the resulting
          // class should at minimum be constructible and chainable — verifying
          // the fallback branch (class {}) wouldn't silently produce something
          // unusable for `new ActorDivinityPointsConfig({...})`.
          const { ActorDivinityPointsConfig } = await import("../scripts/actor-bar-config.js");
          assert.strictEqual(typeof ActorDivinityPointsConfig, "function");

          // Should be a subclass of either BaseConfigSheetV2 or the fallback —
          // either way it should have a prototype chain longer than Object.
          const proto = Object.getPrototypeOf(ActorDivinityPointsConfig.prototype);
          assert.notStrictEqual(proto, null);
          assert.notStrictEqual(proto, Object.prototype);
        });
      });
    },
    { displayName: "Divinity Points: ActorDivinityPointsConfig" },
  );
} // end registerTests

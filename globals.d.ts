/**
 * globals.d.ts
 *
 * Declares globals and type augmentations specific to this module.
 * Covers three categories:
 *   1. The `dnd5e` global object and its key surfaces
 *   2. dnd5e extensions to Foundry's CONFIG
 *   3. Module-specific window globals and actor flag shapes
 */

// ── 1. The `dnd5e` global ──────────────────────────────────────────────────────
//
// dnd5e registers itself as `globalThis.dnd5e` at runtime. Including the source
// files in jsconfig.json gives us the types, but TypeScript doesn't know they
// become a global. This declaration bridges that gap.
//
// If the import path can't resolve (e.g. your symlink layout differs), replace
// `typeof _dnd5e` with the manual shape below — both produce the same result
// for IntelliSense purposes.

import type * as _dnd5e from "./dnd5e-system/dnd5e.mjs";

declare global {
  // The dnd5e global — typed from the real system source.
  // Gives you autocomplete on dnd5e.applications, dnd5e.documents, etc.
  const dnd5e: typeof _dnd5e;

  // ── 2. CONFIG extensions ─────────────────────────────────────────────────────
  //
  // foundry-vtt-types knows CONFIG.DND5E exists but not the specific keys this
  // module adds to it. Declaring them here prevents "property does not exist"
  // errors when writing to CONFIG.DND5E.activityConsumptionTypes.

  namespace CONFIG {
    namespace DND5E {
      interface ActivityConsumptionTypes {
        divinityPoints: unknown;
      }
    }
  }

  // game.dnd5e — the system's runtime config object hanging off `game`.
  // Augmenting the Game interface tells TypeScript it exists alongside
  // game.actors, game.items, etc.
  interface Game {
    dnd5e: {
      config: typeof _dnd5e.config;
    };
  }

  // ── 3. Module globals and flags ───────────────────────────────────────────────
  //
  // main.js attaches these to window so GMs can call them from macros.

  interface Window {
    getDivinityPointsItem: (actor: Actor) => Item | false;
    alterDivinityPoints: (actor: Actor, uses: number, max: number) => Promise<void>;
  }
}

// This export turns the file into a module, which is required for the
// `import type` above to work inside a .d.ts file.
export {};

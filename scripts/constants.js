/**
 * constants.js
 *
 * Central place for values that are shared across multiple files.
 * Keeping them here means you only need to change them in one place.
 *
 * These are ES module exports — other files import them with:
 *   import { DP_MODULE_NAME } from "./constants.js";
 */

/**
 * The unique identifier for this module as defined in module.json.
 * Foundry uses this string as a namespace for settings, flags, etc.
 * Change this only if you rename the module itself.
 */
export const DP_MODULE_NAME = "dnd5e-divinitypoints";

/**
 * The ID of the "Divinity Points" feature item as it would appear
 * in a compendium pack. Currently unused (no pack is shipped),
 * but kept for legacy compatibility with any items that were
 * created from a compendium in older versions.
 */
export const DP_ITEM_ID = "DivinityPnts001a";

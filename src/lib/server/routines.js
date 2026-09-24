/**
 * Loader for `routines.json` — the single source of truth for routine ids,
 * labels and symbols (memo §12; implementation-considerations §8).
 *
 * Every consumer (the pure reconcile core, the command surfaces, the device
 * poll and the UI) reads the vocabulary from here. Nothing hard-codes a label
 * or an artwork path.
 */

import catalogue from "../routines.json";

/** @type {ReadonlyArray<{id: string, label: string, symbol: string}>} */
export const routines = Object.freeze(
  catalogue.routines.map((routine) => Object.freeze({ ...routine })),
);

/** The three routine ids, in catalogue order. The remote's start vocabulary. */
export const ROUTINE_IDS = Object.freeze(routines.map((routine) => routine.id));

/** The default routine (the first in the catalogue) — used by the UI's initial paint. */
export const DEFAULT_ROUTINE_ID = ROUTINE_IDS[0];

/** @param {string} id */
export function isRoutineId(id) {
  return ROUTINE_IDS.includes(id);
}

/** @param {string} id */
export function getRoutine(id) {
  return routines.find((routine) => routine.id === id) ?? null;
}

/** The catalogue as exposed to the UI (a fresh array each call; never mutated). */
export function getRoutines() {
  return routines.map((routine) => ({ ...routine }));
}

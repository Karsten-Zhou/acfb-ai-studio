// Pure reasoning-control logic: given a model's declared reasoning traits,
// decide which levels to offer and what wire params a chosen level maps to.
//
// Kept free of any catalogue access so it can be unit-tested directly; the
// model-keyed wrappers live in shared/generated/traits.ts.

import { REASONING_EFFORTS, type ReasoningEffort } from "./chat";

/** A model's reasoning-related schema traits. */
export interface ReasoningTraits {
  /** Values of the graded `reasoning_effort` enum (empty when absent). */
  graded: readonly string[];
  /**
   * The chat-template on/off knob's parameter name (e.g. `enable_thinking`),
   * when the model documents one that can actually be turned off. Absent when
   * there is no toggle, or it is pinned to a single value.
   */
  toggle?: string;
}

/** How a model's reasoning depth can be adjusted. */
export type ReasoningControl = "graded" | "toggle" | "none";

export function reasoningControl(traits: ReasoningTraits): ReasoningControl {
  if (traits.graded.length > 0) return "graded";
  if (traits.toggle) return "toggle";
  return "none";
}

/**
 * The levels to offer for a model, ascending. `none` is offered only when the
 * model can actually disable reasoning — through a toggle or a `none` graded
 * value. A toggle-only model is binary, so its single "on" level is arbitrary;
 * `medium` is used as the representative.
 */
export function reasoningOptions(traits: ReasoningTraits): ReasoningEffort[] {
  const control = reasoningControl(traits);
  if (control === "none") return [];
  if (control === "toggle") return ["none", "medium"];

  const options = new Set<ReasoningEffort>();
  if (traits.graded.includes("none") || traits.toggle) {
    options.add("none");
  }
  for (const value of traits.graded) {
    if ((REASONING_EFFORTS as readonly string[]).includes(value)) {
      options.add(value as ReasoningEffort);
    }
  }
  return REASONING_EFFORTS.filter((effort) => options.has(effort));
}

/**
 * Snap `effort` to the nearest level in `options` by ordinal distance, or
 * `undefined` when there is nothing to choose from. Used when the stored
 * default was chosen for a different model whose scale does not overlap this
 * one's.
 */
export function normalizeReasoningEffort(
  effort: ReasoningEffort,
  options: readonly ReasoningEffort[],
): ReasoningEffort | undefined {
  if (options.length === 0) return undefined;
  if (options.includes(effort)) return effort;

  const target = REASONING_EFFORTS.indexOf(effort);
  let best = options[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  // `<=` so that, when two levels are equidistant (e.g. `medium` between
  // `low` and `high`), the higher one wins — erring toward more reasoning.
  for (const option of options) {
    const distance = Math.abs(REASONING_EFFORTS.indexOf(option) - target);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

/** Wire params that carry a chosen reasoning level to Workers AI. */
export interface ReasoningParams {
  reasoning_effort?: string;
  chat_template_kwargs?: Record<string, boolean>;
}

/**
 * Map `effort` onto the model's wire params. `none` turns the toggle off and,
 * where the enum lists it, sends `reasoning_effort: "none"`; any other level
 * turns the toggle on and is forwarded only when the model declares it. A
 * model with neither knob yields no params.
 */
export function reasoningParams(
  traits: ReasoningTraits,
  effort: ReasoningEffort,
): ReasoningParams {
  const params: ReasoningParams = {};
  if (traits.toggle) {
    params.chat_template_kwargs = { [traits.toggle]: effort !== "none" };
  }
  if (traits.graded.includes(effort)) {
    params.reasoning_effort = effort;
  }
  return params;
}

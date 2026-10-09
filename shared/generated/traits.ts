/**
 * Runtime introspection for Cloudflare Workers AI models.
 *
 * Every answer here was computed once at sync time by the sync script and
 * frozen into data/traits.json. Lookups are plain object reads, so this
 * module is cheap to import in both the Worker and the browser.
 */
import raw from "./data/traits.json";
import {
  TraitsFileSchema,
  type ModelTraits,
  type ModelInput,
  type OutputFormat,
  type ParamInfo,
} from "./schema";
import type { ReasoningEffort } from "../chat";
import { reasoningOptions, type ReasoningTraits } from "../reasoning";

const parsed = TraitsFileSchema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `[generated/traits] traits.json failed schema validation.\n` +
      `Run \`bun run sync:models\` to regenerate.\n${issues}`,
  );
}

const file = parsed.data;

export const TRAITS_GENERATED_AT: string = file.generatedAt;

function traits(modelName: string): ModelTraits | undefined {
  return file.traits[modelName];
}

/** True if the model's input schema declares this parameter. */
export function acceptsParam(modelName: string, path: string): boolean {
  return traits(modelName)?.params[path] !== undefined;
}

/** Every parameter the model accepts, as dotted paths. */
export function acceptedParams(modelName: string): readonly string[] {
  return Object.keys(traits(modelName)?.params ?? {});
}

/** Raw metadata for a parameter, or `undefined` if the model doesn't take it. */
export function getParamInfo(
  modelName: string,
  path: string,
): ParamInfo | undefined {
  return traits(modelName)?.params[path];
}

export interface ParamBounds {
  min?: number;
  max?: number;
}

/** Numeric bounds, or `undefined` if neither bound is declared. */
export function getBounds(
  modelName: string,
  path: string,
): ParamBounds | undefined {
  const info = traits(modelName)?.params[path];
  if (!info) return undefined;
  if (info.min === undefined && info.max === undefined) return undefined;
  return { min: info.min, max: info.max };
}

/** Schema-declared default, or `undefined`. */
export function getDefault(modelName: string, path: string): unknown {
  return traits(modelName)?.params[path]?.default;
}

/** Response encoding the model emits. */
export function getOutputFormat(modelName: string): OutputFormat {
  return traits(modelName)?.output ?? "json";
}

/** True when the model's input is a multipart body. */
export function isMultipartModel(modelName: string): boolean {
  return traits(modelName)?.multipart === true;
}

/**
 * Input shape and image support, as derived from the model's input schema.
 *
 * Detection deliberately reads the schema rather than the catalogue's `vision`
 * capability flag, which is unreliable: `@cf/cloudflare/clef*` (a decision
 * model) and `@cf/swiss-ai/apertus-v1.5-8b` (not universally available) are
 * both flagged `vision` upstream but document no image input. Whether a model
 * can accept media is decided per model elsewhere; this flag is only about
 * whether the schema declares the input.
 */
export function getInputTraits(modelName: string): ModelInput {
  return traits(modelName)?.input ?? { messages: false, image: false };
}

/** True if the model documents image input (content part or legacy `image`). */
export function supportsImageInput(modelName: string): boolean {
  return getInputTraits(modelName).image;
}
// ---------------------------------------------------------------------------
// Reasoning controls
// ---------------------------------------------------------------------------

/** The graded `reasoning_effort` levels a model declares, in schema order. */
export function getReasoningEnum(modelName: string): string[] {
  const info = getParamInfo(modelName, "reasoning_effort");
  return (info?.enum ?? []).filter((v): v is string => typeof v === "string");
}

/**
 * The chat-template on/off knob, when the model documents one that can actually
 * be turned off. Cloudflare is not consistent about the key (`enable_thinking`
 * vs `thinking`), and some models pin it to `true` (`enum: [true]`) — a knob
 * that cannot be disabled is not adjustable, so it is reported as absent.
 */
function thinkingToggle(modelName: string): string | undefined {
  for (const param of ["enable_thinking", "thinking"] as const) {
    if (!acceptsParam(modelName, `chat_template_kwargs.${param}`)) continue;
    const info = getParamInfo(modelName, `chat_template_kwargs.${param}`);
    const bools = (info?.enum ?? []).filter(
      (v): v is boolean => typeof v === "boolean",
    );
    // An enum of only `true` means reasoning cannot be disabled: no control.
    if (bools.length > 0 && !bools.includes(false)) return undefined;
    return param;
  }
  return undefined;
}

/** A model's reasoning traits, in the shape the pure logic consumes. */
export function getReasoningTraits(modelName: string): ReasoningTraits {
  return {
    graded: getReasoningEnum(modelName),
    toggle: thinkingToggle(modelName),
  };
}

/** The reasoning levels offered for a model, ascending; `[]` when none. */
export function getReasoningOptions(modelName: string): ReasoningEffort[] {
  return reasoningOptions(getReasoningTraits(modelName));
}

/** True when the model offers any adjustable reasoning level. */
export function hasReasoningControl(modelName: string): boolean {
  return getReasoningOptions(modelName).length > 0;
}

// ---------------------------------------------------------------------------
// Tool calling
// ---------------------------------------------------------------------------

/**
 * True when the model's input schema declares the OpenAI-style `tools`
 * parameter. This — not the catalogue's `function_calling` capability flag — is
 * authoritative: the flag is set on several models whose published schema has no
 * `tools` (or `functions`) property at all, and offering tools to those would
 * fail at inference.
 */
export function supportsToolCalling(modelName: string): boolean {
  return (
    acceptsParam(modelName, "tools") || acceptsParam(modelName, "functions")
  );
}

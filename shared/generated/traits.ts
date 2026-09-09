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
  type OutputFormat,
  type ParamInfo,
} from "./schema";

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

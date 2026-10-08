/**
 * Introspection of Cloudflare Workers AI *input* JSON Schemas for image-input
 * support.
 *
 * Runs once per sync inside scripts/sync-cloudflare-models.ts; the result is
 * frozen into data/traits.json so the runtime never parses a schema. Nothing
 * here is imported by the Worker or the browser.
 *
 * Everything is derived from the schema Cloudflare publishes for a model, so
 * the app never keeps its own list of which models take images.
 *
 * Audio and video input are deliberately NOT supported. Cloudflare exposes no
 * audio/video input capability anywhere — not as a catalogue property, not as a
 * docs badge — and the `input_audio`/`video_url` content parts are shared
 * OpenAI-compatible vocabulary that even text-only models (and models with no
 * such tower, e.g. gemma-4-26b-a4b-it) list. Offering them therefore fails at
 * inference with a hard upstream error, so they are not modelled at all.
 */

/** The subset of JSON Schema this pipeline reads. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
  $defs?: Record<string, JsonSchema>;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  enum?: unknown[];
}

/** Which input shape a model documents. */
export interface ModelInput {
  /**
   * The schema documents the OpenAI-style `messages` chat shape. When false,
   * the model takes a legacy top-level `prompt` (and possibly `image`).
   */
  messages: boolean;
  /**
   * True when the model documents image input, either as an `image_url`
   * content part (messages shape) or a legacy top-level `image` param.
   */
  image: boolean;
}

/** Resolve a local `$ref` like `#/definitions/foo` or `#/$defs/foo`. */
export function resolveRef(ref: string, root: JsonSchema): JsonSchema | null {
  if (!ref.startsWith("#/")) return null;
  let cur: unknown = root;
  for (const seg of ref.slice(2).split("/")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return (cur as JsonSchema | undefined) ?? null;
}

/**
 * Flatten a schema into the concrete object variants it can be, following
 * `$ref` and fanning out across `oneOf`/`anyOf`/`allOf`, so every accepted
 * shape is seen without a per-model visitor.
 */
export function schemaVariants(
  schema: JsonSchema | undefined,
  root: JsonSchema,
  depth = 0,
): JsonSchema[] {
  if (!schema || depth > 12) return [];
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    return resolved ? schemaVariants(resolved, root, depth + 1) : [];
  }
  const variants = schema.oneOf ?? schema.anyOf ?? schema.allOf;
  if (variants) {
    return variants.flatMap((v) => schemaVariants(v, root, depth + 1));
  }
  return [schema];
}

/** True when any `messages[].content[]` part declares `type: "image_url"`. */
function messagesAcceptImages(
  messages: JsonSchema | undefined,
  root: JsonSchema,
): boolean {
  if (!messages) return false;
  for (const message of schemaVariants(messages.items, root)) {
    const content = message.properties?.["content"];
    if (!content) continue;
    for (const variant of schemaVariants(content, root)) {
      // Only the array form carries typed parts; the string form is plain text.
      if (variant.type !== "array") continue;
      for (const part of schemaVariants(variant.items, root)) {
        const types = part.properties?.["type"]?.enum;
        if (Array.isArray(types) && types.includes("image_url")) return true;
      }
    }
  }
  return false;
}

/** Derive a model's input shape and image support from its input schema. */
export function detectModelInput(schema: JsonSchema | null): ModelInput {
  if (!schema) return { messages: false, image: false };

  let messages = false;
  let hasImageParam = false;
  for (const variant of schemaVariants(schema, schema)) {
    for (const key of Object.keys(variant.properties ?? {})) {
      if (key === "messages") messages = true;
      if (key === "image") hasImageParam = true;
    }
  }

  let image = hasImageParam;
  if (!image && messages) {
    for (const variant of schemaVariants(schema, schema)) {
      if (messagesAcceptImages(variant.properties?.["messages"], schema)) {
        image = true;
        break;
      }
    }
  }

  return { messages, image };
}

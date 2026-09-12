import { Hono } from "hono";
import { imageRequestSchema, type ImageRequest } from "@shared/api";
import { zValidator } from "@hono/zod-validator";
import { errorResponse, upstreamError, UserFacingError } from "./errors";
import {
  dimensionsOfBase64,
  dimensionsOfBytes,
  type ImageDimensions,
} from "./image-dimensions";
import { readSyncMeta } from "./sync-storage";
import { SYNC_SOFT_LIMIT_BYTES, softLimitMessage } from "@shared/sync";
import { FREE_MODEL_BY_NAME } from "@shared/generated/models";
import {
  acceptsParam,
  getBounds,
  getOutputFormat,
  isMultipartModel,
  type ParamBounds,
} from "@shared/generated/traits";
import type { OutputFormat } from "@shared/generated/schema";

const app = new Hono<{ Bindings: Env }>();

app.post("/", zValidator("json", imageRequestSchema), async ({ env, req }) => {
  const body = req.valid("json");

  const known = body.model ? FREE_MODEL_BY_NAME.get(body.model) : undefined;
  if (!known) {
    return Response.json(
      { error: `Unknown model: ${body.model ?? "(none provided)"}` },
      { status: 400 },
    );
  }
  if (known.task !== "text-to-image") {
    return Response.json(
      { error: `${known.name} is not a text-to-image model` },
      { status: 400 },
    );
  }

  const multipart = isMultipartModel(known.name);
  const outputFormat = getOutputFormat(known.name);

  // The client refuses to generate once its local copy of the history reaches
  // the soft limit; this is the authoritative version of that check, using the
  // size actually stored in KV. Only metadata is read, so it is cheap.
  try {
    const { bytes } = await readSyncMeta(env);
    if (bytes >= SYNC_SOFT_LIMIT_BYTES) {
      return Response.json({ error: softLimitMessage(bytes) }, { status: 413 });
    }
  } catch (err) {
    // Fail open: a storage hiccup must not stop image generation, and the sync
    // upload still enforces the hard 25 MiB limit on write.
    console.error("Draw: could not read the sync size:", err);
  }

  const options = multipart
    ? { multipart: buildMultipart(known.name, body) }
    : buildOptions(known.name, body);

  // `env.AI.run` is the only upstream call, so its failure is marked here rather
  // than sniffed from the error's shape later (see `upstreamError`).
  let result: unknown;
  try {
    result = await env.AI.run(known.name, options);
  } catch (err) {
    return errorResponse(upstreamError(err));
  }

  try {
    const image = await normalizeImage(result, outputFormat);

    if (!image.ok) {
      throw new UserFacingError(image.reason);
    }

    return Response.json({
      image: image.data,
      model: known.name,
      width: image.width,
      height: image.height,
      seed: body.seed,
    });
  } catch (err) {
    return errorResponse(err);
  }
});

/**
 * Build the `multipart` option for FLUX.2 [dev]/[klein] models.
 *
 * FormData doesn't expose its serialized body or boundary; constructing a
 * `Response` from it forces serialization and generates the multipart
 * Content-Type header the runtime needs to parse the fields.
 */
function buildMultipart(
  modelName: string,
  body: ImageRequest,
): { body: ReadableStream | null; contentType: string } {
  const form = new FormData();
  form.append("prompt", body.prompt);

  if (body.seed !== undefined && acceptsParam(modelName, "seed")) {
    form.append("seed", String(body.seed));
  }
  // Width/height are a pair in the multipart schema; only emit them together.
  if (
    acceptsParam(modelName, "width") &&
    acceptsParam(modelName, "height") &&
    body.width !== undefined &&
    body.height !== undefined
  ) {
    form.append(
      "width",
      String(clamp(body.width, getBounds(modelName, "width"))),
    );
    form.append(
      "height",
      String(clamp(body.height, getBounds(modelName, "height"))),
    );
  }

  const formResponse = new Response(form);
  return {
    body: formResponse.body,
    contentType: formResponse.headers.get("content-type") ?? "",
  };
}

/**
 * Build the JSON options object for a flat-schema image model. Only emits
 * parameters the model declares, and clamps every numeric value to the
 * schema's declared bounds so Workers AI never returns a 5006.
 */
function buildOptions(
  modelName: string,
  body: ImageRequest,
): Record<string, unknown> {
  const options: Record<string, unknown> = { prompt: body.prompt };

  if (
    body.negativePrompt !== undefined &&
    acceptsParam(modelName, "negative_prompt")
  ) {
    options.negative_prompt = body.negativePrompt;
  }

  // Width/height are optional everywhere: Cloudflare never marks them
  // required, and a model may not accept them at all. Only forward a value the
  // client explicitly set *and* the model declares; otherwise stay silent and
  // let Workers AI apply the model's own default.
  for (const key of ["width", "height"] as const) {
    const value = body[key];
    if (value === undefined || !acceptsParam(modelName, key)) continue;
    options[key] = clamp(value, getBounds(modelName, key));
  }

  // `num_steps` and `steps` are two names for the same knob across model
  // families. Pick whichever the model declares; never emit both.
  if (body.numSteps !== undefined) {
    if (acceptsParam(modelName, "num_steps")) {
      options.num_steps = clamp(
        body.numSteps,
        getBounds(modelName, "num_steps"),
      );
    } else if (acceptsParam(modelName, "steps")) {
      options.steps = clamp(body.numSteps, getBounds(modelName, "steps"));
    }
  }

  if (body.guidance !== undefined && acceptsParam(modelName, "guidance")) {
    options.guidance = clamp(body.guidance, getBounds(modelName, "guidance"));
  }
  if (body.seed !== undefined && acceptsParam(modelName, "seed")) {
    options.seed = body.seed;
  }

  return options;
}

/**
 * Clamp to declared bounds. `ParamBounds` has optional `min`/`max` because
 * Cloudflare's schemas declare them independently — e.g. `num_steps` may
 * declare only `maximum: 20`. Missing bounds are treated as unbounded.
 */
function clamp(value: number, bounds: ParamBounds | undefined): number {
  if (!bounds) return value;
  const min = bounds.min ?? Number.NEGATIVE_INFINITY;
  const max = bounds.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Output normalization
// ---------------------------------------------------------------------------

type NormalizedImage =
  | ({ ok: true; data: string } & ImageDimensions)
  | { ok: false; reason: string };

async function normalizeImage(
  result: unknown,
  output: OutputFormat,
): Promise<NormalizedImage> {
  if (output === "json") {
    if (!result || typeof result !== "object") {
      return {
        ok: false,
        reason: `Expected a JSON object with an "image" field but got ${describeValue(result)}`,
      };
    }
    const image = (result as { image?: unknown }).image;
    if (typeof image !== "string") {
      return {
        ok: false,
        reason: `Response had no "image" string field (keys: ${Object.keys(result).join(", ") || "none"})`,
      };
    }
    if (!image) {
      return { ok: false, reason: 'Response had an empty "image" field' };
    }
    return {
      ok: true,
      data: `data:image/png;base64,${image}`,
      ...dimensionsOfBase64(image),
    };
  }

  if (!(result instanceof ReadableStream)) {
    return {
      ok: false,
      reason: `Expected a binary ${output} stream but got ${describeValue(result)}`,
    };
  }
  const bytes = new Uint8Array(await new Response(result).arrayBuffer());
  if (bytes.byteLength === 0) {
    return { ok: false, reason: `Received an empty ${output} stream` };
  }
  return {
    ok: true,
    data: `data:${output};base64,${bytesToBase64(bytes)}`,
    ...dimensionsOfBytes(bytes),
  };
}

// ---------------------------------------------------------------------------
// Output size sniffing lives in `./image-dimensions` — `image-size` reads only
// the PNG/JPEG header, so real dimensions are available for every model,
// including the ones that take no width/height at all (FLUX).

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const type = typeof value;
  if (type !== "object") return `${type} (${String(value).slice(0, 80)})`;
  return `object (${JSON.stringify(value).slice(0, 120)})`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default app;

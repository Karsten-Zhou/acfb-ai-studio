/**
 * Sync Cloudflare Workers AI model catalogue and precomputed per-model
 * parameter traits.
 *
 * This script only writes JSON data files. All TypeScript wrappers that
 * consume these files live in shared/generated/*.ts and are hand-written,
 * so they are fully type-checked by tsc.
 *
 * Types and Zod validators for the emitted JSON come from
 * shared/generated/schema.ts, which is the single source of truth. After
 * building each payload we re-parse it with the same schema before writing,
 * so the script can never emit something the runtime will reject.
 *
 * The introspection work (walking each model's JSON Schema to extract
 * accepted parameters, bounds, defaults, output format) happens here, once
 * per sync. At runtime, consumers read the precomputed traits.json — no
 * schema compilation, no library dependency, no cold-start cost.
 *
 * Environment variables:
 *   MY_CF_ACCOUNT_ID  (required)
 *   MY_CF_API_TOKEN   (required, needs AI read permission)
 *
 * Usage:
 *   bun run ./scripts/sync-cloudflare-models.ts
 *   pnpm sync:models
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  GENERATED_DATA_VERSION,
  ModelsFileSchema,
  TraitsFileSchema,
  type ModelInfo,
  type ModelTask,
  type ModelsFile,
  type OutputFormat,
  type ParamInfo,
  type TraitsFile,
} from "../shared/generated/schema";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ACCOUNT_ID = process.env.MY_CF_ACCOUNT_ID;
const API_TOKEN = process.env.MY_CF_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("[sync-models] Missing MY_CF_ACCOUNT_ID or MY_CF_API_TOKEN.");
  process.exit(1);
}

const OUT_DIR = path.resolve(process.cwd(), "shared/generated/data");
const MODELS_FILE = path.join(OUT_DIR, "models.json");
const TRAITS_FILE = path.join(OUT_DIR, "traits.json");

/** Cloudflare task display names mapped to our internal discriminants. */
const TASK_MAP: Record<string, ModelTask> = {
  "Text Generation": "text-generation",
  "Text-to-Image": "text-to-image",
};

/**
 * Schema file names depend on the task type.
 *   Text models  → streaming-input.json / streaming-output.json
 *   Image models → schema-input.json    / schema-output.json
 */
function schemaFileNames(task: ModelTask): { input: string; output: string } {
  return task === "text-generation"
    ? { input: "streaming-input.json", output: "streaming-output.json" }
    : { input: "schema-input.json", output: "schema-output.json" };
}

// ---------------------------------------------------------------------------
// Cloudflare API response types
// ---------------------------------------------------------------------------

interface CloudflareModelProperty {
  property_id: string;
  value: unknown;
}

interface CloudflareModel {
  id: string;
  name: string;
  description?: string;
  task?: { id: string; name: string; description?: string };
  created_at?: string;
  tags?: string[];
  properties?: CloudflareModelProperty[];
}

interface CloudflareSearchResponse {
  success: boolean;
  result: CloudflareModel[];
  errors: unknown;
  messages: unknown;
  result_info: {
    page: number;
    per_page: number;
    total_count: number;
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchAllModels(): Promise<CloudflareModel[]> {
  const out: CloudflareModel[] = [];
  let page = 1;

  for (;;) {
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}` +
      `/ai/models/search?per_page=100&page=${page}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });

    if (!res.ok) {
      throw new Error(
        `[sync-models] HTTP ${res.status} from Cloudflare API: ${await res.text()}`,
      );
    }

    const json = (await res.json()) as CloudflareSearchResponse;

    if (!json.success) {
      throw new Error(
        `[sync-models] Cloudflare API returned success=false: ` +
          `${JSON.stringify(json.errors)}`,
      );
    }

    out.push(...json.result);

    const { page: currentPage, per_page, total_count } = json.result_info;
    if (currentPage * per_page >= total_count) break;
    page = currentPage + 1;
  }

  return out;
}

/**
 * Fetch a single JSON Schema document. Returns `null` on 404 or network
 * failure so that a single missing document does not abort the whole sync.
 */
async function fetchSchemaDoc(
  urlPath: string,
  fileName: string,
): Promise<unknown | null> {
  const url =
    `https://developers.cloudflare.com/workers-ai/models/` +
    `${urlPath}/${fileName}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Normalisation of the model catalogue
// ---------------------------------------------------------------------------

const isTrue = (v: unknown): boolean => v === true || v === "true";

function propRecord(
  props: CloudflareModelProperty[] = [],
): Record<string, unknown> {
  return Object.fromEntries(props.map((p) => [p.property_id, p.value]));
}

function normalize(raw: CloudflareModel): ModelInfo | null {
  const parts = String(raw.name).split("/");
  const task = raw.task ? TASK_MAP[raw.task.name] : undefined;
  if (!task) return null;

  const props = propRecord(raw.properties);
  const isText = task === "text-generation";

  const provider: string = parts[1] ?? "unknown";
  const urlPath: string = parts.slice(2).join("/") || provider;

  const pricingRaw = props["price"];
  const contextWindowRaw = props["context_window"];
  const termsRaw = props["terms"] ?? props["info"];

  const contextWindow =
    typeof contextWindowRaw === "string" || typeof contextWindowRaw === "number"
      ? Number(contextWindowRaw)
      : null;

  return {
    id: raw.id,
    name: raw.name,
    urlPath,
    provider,
    task,
    description: raw.description ?? "",
    capabilities: {
      streaming: isText,
      functionCalling: isTrue(props["function_calling"]),
      reasoning: isTrue(props["reasoning"]),
      vision: isTrue(props["vision"]),
      lora: isTrue(props["lora"]),
      beta: isTrue(props["beta"]),
      partner: isTrue(props["partner"]),
      asyncQueue: isTrue(props["async_queue"]),
      realtime: isTrue(props["realtime"]),
      requireWorkersPaid: isTrue(props["require_workers_paid"]),
    },
    contextWindow:
      contextWindow !== null && Number.isFinite(contextWindow)
        ? contextWindow
        : null,
    pricing: Array.isArray(pricingRaw)
      ? (pricingRaw as ModelInfo["pricing"])
      : null,
    terms: typeof termsRaw === "string" ? termsRaw : null,
    createdAt: raw.created_at ?? "",
  };
}

// ---------------------------------------------------------------------------
// Local JSON Schema walker
//
// We only walk these schemas once per sync, so a ~60-line walker is simpler
// than pulling in a schema-compilation library just for this script. At
// runtime, consumers read the precomputed traits.json — no library needed.
// ---------------------------------------------------------------------------

interface JsonSchema {
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
  enum?: unknown[];
}

/** Resolve a local `$ref` like "#/definitions/foo" or "#/$defs/foo". */
function resolveRef(ref: string, root: JsonSchema): JsonSchema | null {
  if (!ref.startsWith("#/")) return null;

  let cur: unknown = root;
  for (const seg of ref.slice(2).split("/")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return (cur as JsonSchema | undefined) ?? null;
}

/**
 * Walk a schema and record every property as a dotted path. Recurses into
 * nested objects and fans out across oneOf/anyOf/allOf so that a parameter
 * declared in any variant is captured.
 */
function walkParams(
  schema: JsonSchema,
  prefix: string,
  out: Record<string, ParamInfo>,
  root: JsonSchema,
  depth = 0,
): void {
  // Guard against pathological recursion; Cloudflare schemas are shallow.
  if (depth > 10) return;

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (resolved) walkParams(resolved, prefix, out, root, depth + 1);
    return;
  }

  const variants = schema.oneOf ?? schema.anyOf ?? schema.allOf;
  if (variants) {
    for (const v of variants) walkParams(v, prefix, out, root, depth + 1);
    return;
  }

  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;

    // Record the property itself. Merge with any prior entry so that a
    // property declared in multiple oneOf variants keeps all its metadata.
    const prev = out[path] ?? {};
    const info: ParamInfo = { ...prev };
    if (typeof sub.type === "string") info.type = sub.type;
    if (typeof sub.minimum === "number") info.min = sub.minimum;
    if (typeof sub.maximum === "number") info.max = sub.maximum;
    if (sub.default !== undefined) info.default = sub.default;
    if (Array.isArray(sub.enum)) info.enum = sub.enum;
    out[path] = info;

    // Recurse into nested objects so that e.g. `chat_template_kwargs` also
    // produces `chat_template_kwargs.enable_thinking`.
    if (sub.properties || sub.$ref) {
      walkParams(sub, prefix ? `${prefix}.${key}` : key, out, root, depth + 1);
    }
  }
}

/**
 * Derive the response encoding from the model's output schema.
 *   { type: 'object', properties: { image: ... } }  → 'json'
 *   { type: 'string', format: 'binary', ... }        → 'image/png' | 'image/jpeg'
 * Anything unrecognised defaults to 'json'.
 */
function computeOutputFormat(output: unknown): OutputFormat {
  if (!output || typeof output !== "object") return "json";
  const o = output as Record<string, unknown>;

  if (o["type"] === "object") {
    const props = o["properties"] as Record<string, unknown> | undefined;
    if (props?.["image"]) return "json";
  }
  if (o["type"] === "string" && o["format"] === "binary") {
    return o["contentMediaType"] === "image/jpeg" ? "image/jpeg" : "image/png";
  }
  return "json";
}

// ---------------------------------------------------------------------------
// File writing
// ---------------------------------------------------------------------------

async function writeIfChanged(file: string, content: string): Promise<boolean> {
  try {
    if ((await readFile(file, "utf8")) === content) return false;
  } catch {
    /* file does not exist yet */
  }
  await writeFile(file, content);
  return true;
}

function formatIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const raw = await fetchAllModels();
  const models: ModelInfo[] = raw
    .map(normalize)
    .filter((x): x is ModelInfo => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`[sync-models] ${models.length} text/image models matched`);

  const traits: TraitsFile["traits"] = {};

  await Promise.all(
    models.map(async (m) => {
      const { input: inFile, output: outFile } = schemaFileNames(m.task);
      const [input, output] = await Promise.all([
        fetchSchemaDoc(m.urlPath, inFile),
        fetchSchemaDoc(m.urlPath, outFile),
      ]);

      const params: Record<string, ParamInfo> = {};
      if (input && typeof input === "object") {
        const root = input as JsonSchema;
        walkParams(root, "", params, root);
      }

      traits[m.name] = {
        params,
        output: computeOutputFormat(output),
        multipart: "multipart" in params,
      };
    }),
  );

  const totalParams = Object.values(traits).reduce(
    (sum, t) => sum + Object.keys(t.params).length,
    0,
  );
  console.log(
    `[sync-models] traits computed: ${totalParams} parameter entries ` +
      `across ${Object.keys(traits).length} models`,
  );

  const generatedAt = new Date().toISOString();

  const modelsPayload: ModelsFile = {
    version: GENERATED_DATA_VERSION,
    generatedAt,
    models,
  };

  const traitsPayload: TraitsFile = {
    version: GENERATED_DATA_VERSION,
    generatedAt,
    traits,
  };

  // Self-check: refuse to write JSON that our own runtime wrapper will reject.
  const modelsCheck = ModelsFileSchema.safeParse(modelsPayload);
  if (!modelsCheck.success) {
    throw new Error(
      `[sync-models] internal error: produced models.json does not satisfy ` +
        `ModelsFileSchema.\n${formatIssues(modelsCheck.error.issues)}`,
    );
  }

  const traitsCheck = TraitsFileSchema.safeParse(traitsPayload);
  if (!traitsCheck.success) {
    throw new Error(
      `[sync-models] internal error: produced traits.json does not satisfy ` +
        `TraitsFileSchema.\n${formatIssues(traitsCheck.error.issues)}`,
    );
  }

  const w1 = await writeIfChanged(
    MODELS_FILE,
    JSON.stringify(modelsPayload, null, 2) + "\n",
  );
  const w2 = await writeIfChanged(
    TRAITS_FILE,
    JSON.stringify(traitsPayload, null, 2) + "\n",
  );

  console.log(
    `[sync-models] models.json ${w1 ? "updated" : "unchanged"}, ` +
      `traits.json ${w2 ? "updated" : "unchanged"}`,
  );
}

main().catch((err: unknown) => {
  console.error("[sync-models] failed:", err);
  process.exit(1);
});

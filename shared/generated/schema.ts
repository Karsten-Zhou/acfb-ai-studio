/**
 * Zod schemas describing the shape of the JSON files emitted by
 * scripts/sync-cloudflare-models.ts.
 *
 * Single source of truth for both the sync script and the runtime wrappers.
 */
import { z } from "zod";

/** Bump when the shape of models.json / traits.json changes. */
export const GENERATED_DATA_VERSION = 1;

// ---------------------------------------------------------------------------
// models.json
// ---------------------------------------------------------------------------

export const ModelTaskSchema = z.enum(["text-generation", "text-to-image"]);

export const ModelPricingSchema = z.object({
  unit: z.string(),
  price: z.number(),
  currency: z.string(),
});

export const ModelCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  functionCalling: z.boolean(),
  reasoning: z.boolean(),
  vision: z.boolean(),
  lora: z.boolean(),
  beta: z.boolean(),
  partner: z.boolean(),
  asyncQueue: z.boolean(),
  realtime: z.boolean(),
  requireWorkersPaid: z.boolean(),
});

export const ModelInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  urlPath: z.string().min(1),
  provider: z.string().min(1),
  task: ModelTaskSchema,
  description: z.string(),
  capabilities: ModelCapabilitiesSchema,
  contextWindow: z.number().int().positive().nullable(),
  pricing: z.array(ModelPricingSchema).nullable(),
  terms: z.string().nullable(),
  createdAt: z.string(),
});

export const ModelsFileSchema = z.object({
  version: z.literal(GENERATED_DATA_VERSION),
  generatedAt: z.string(),
  models: z.array(ModelInfoSchema),
});

// ---------------------------------------------------------------------------
// traits.json
// ---------------------------------------------------------------------------

/**
 * Precomputed per-parameter metadata. Every field is optional because
 * Cloudflare's schemas are sparse: a property may declare only `maximum`,
 * only `default`, or nothing at all.
 */
export const ParamInfoSchema = z.object({
  type: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
  description: z.string().optional(),
});

export const OutputFormatSchema = z.enum(["json", "image/png", "image/jpeg"]);

export const ModelTraitsSchema = z.object({
  /** Flattened dotted paths of every property the input schema declares. */
  params: z.record(z.string(), ParamInfoSchema),
  output: OutputFormatSchema,
  multipart: z.boolean(),
});

export const TraitsFileSchema = z.object({
  version: z.literal(GENERATED_DATA_VERSION),
  generatedAt: z.string(),
  traits: z.record(z.string(), ModelTraitsSchema),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type ModelTask = z.infer<typeof ModelTaskSchema>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type ModelsFile = z.infer<typeof ModelsFileSchema>;

export type ParamInfo = z.infer<typeof ParamInfoSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type ModelTraits = z.infer<typeof ModelTraitsSchema>;
export type TraitsFile = z.infer<typeof TraitsFileSchema>;

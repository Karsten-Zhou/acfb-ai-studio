/**
 * Types describing the raw Workers AI model catalog snapshot
 * (`shared/full-model-list.json`). Importing the JSON directly into both the
 * client and the server is fine because `resolveJsonModule` + bundler module
 * resolution are enabled in every tsconfig.
 */

export interface CatalogProperty {
  property_id: string;
  value: string | boolean | number | unknown;
}

export interface CatalogTask {
  id: string;
  name: string;
  description: string;
}

export interface CatalogModel {
  /** Catalog UUID (unused by the app — the `name` field is the model id). */
  id: string;
  /** The full Workers AI model id, e.g. "@cf/..." */
  name: string;
  /** Friendly display name added to the catalog snapshot. */
  nickname?: string;
  /** Vendor / model description from the catalog. */
  description?: string;
  task?: CatalogTask;
  tags?: string[];
  properties?: CatalogProperty[];
}

/** True if the catalog entry belongs to the given task name. */
export function isTask(model: CatalogModel, taskName: string): boolean {
  return model.task?.name === taskName;
}

/** True if the catalog entry belongs to paid-only groups. */
export function isPaidOnly(model: CatalogModel): boolean {
  return (
    model.properties?.some(
      (p) => p.property_id === "require_workers_paid" && p.value === "true",
    ) ?? false
  );
}

/** Read a single property value as a string (undefined when absent). */
export function prop(model: CatalogModel, id: string): string | undefined {
  const p = model.properties?.find((p) => p.property_id === id);
  const v = p?.value;
  return typeof v === "string" ? v : undefined;
}

/** Read a boolean-flag property ("true" / missing). */
export function flag(model: CatalogModel, id: string): boolean {
  return prop(model, id) === "true";
}

// Human readable model labels for the UI
export const FREE_TEXT_GENERATION_MODEL_LABELS: Record<string, string> = {
  // Aisingapore / Gemma
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it": "Gemma SEA-LION v4 27B IT",

  // DeepSeek
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b":
    "DeepSeek R1 Distill Qwen 32B",

  // Google / Gemma
  "@cf/google/gemma-2b-it-lora": "Gemma 2B",
  "@cf/google/gemma-4-26b-a4b-it": "Gemma 4 26B-A4B",
  "@cf/google/gemma-7b-it-lora": "Gemma 7B IT",

  // IBM / Granite
  "@cf/ibm-granite/granite-4.0-h-micro": "Granite 4.0 H Micro",

  // Meta / Llama
  "@cf/meta-llama/llama-2-7b-chat-hf-lora": "Llama 2 7B Chat HF (LoRA)",
  "@cf/meta/llama-3.1-8b-instruct-fp8": "Llama 3.1 8B Instruct (FP8)",
  "@cf/meta/llama-3.2-11b-vision-instruct": "Llama 3.2 11B Vision Instruct",
  "@cf/meta/llama-3.2-1b-instruct": "Llama 3.2 1B Instruct",
  "@cf/meta/llama-3.2-3b-instruct": "Llama 3.2 3B Instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast":
    "Llama 3.3 70B Instruct (FP8 Fast)",
  "@cf/meta/llama-4-scout-17b-16e-instruct": "Llama 4 Scout 17B-16E Instruct",
  "@cf/meta/llama-guard-3-8b": "Llama Guard 3 8B",

  // Mistral
  "@cf/mistral/mistral-7b-instruct-v0.2-lora":
    "Mistral 7B Instruct v0.2 (LoRA)",
  "@cf/mistralai/mistral-small-3.1-24b-instruct":
    "Mistral Small 3.1 24B Instruct",

  // Nvidia / Nemotron
  "@cf/nvidia/nemotron-3-120b-a12b": "Nemotron 3 120B-A12B",

  // OpenAI / GPT-OSS
  "@cf/openai/gpt-oss-120b": "GPT-OSS 120B",
  "@cf/openai/gpt-oss-20b": "GPT-OSS 20B",

  // Qwen
  "@cf/qwen/qwen2.5-coder-32b-instruct": "Qwen 2.5 Coder 32B Instruct",
  "@cf/qwen/qwen3-30b-a3b-fp8": "Qwen 3 30B-A3B (FP8)",
  "@cf/qwen/qwen3.8-27b": "Qwen 3.8 27B",
  "@cf/qwen/qwq-32b": "QwQ 32B",

  // Zhipu AI / GLM
  "@cf/zai-org/glm-4.7-flash": "GLM 4.7 Flash",
} as const;

// The catalogue of tools a tool-calling model may invoke.
//
// A tool is only ever offered to a model whose input schema declares the
// OpenAI-style `tools` parameter (see `supportsToolCalling` in
// `@shared/generated/traits`), so a model that cannot consume tool definitions
// never receives one. This module is pure data: the wire encoding and the
// execution both live on the server (`server/tools.ts`).

/** A tool the app can offer to a tool-calling model. */
export interface ToolDefinition {
  /** Stable id; also the function name sent to the model. */
  id: string;
  /** English display label used in the picker and the tool-call UI. */
  label: string;
  /** What the tool does, shown to the model so it can decide to call it. */
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "get_current_datetime",
    label: "Current date & time",
    description:
      "Return the current date and time. Use this whenever the user asks " +
      'about "now", "today" or anything relative to the current moment. ' +
      "Optionally pass an IANA timezone; otherwise the user's timezone is used.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            'IANA timezone name, e.g. "America/New_York" or "Europe/Berlin". ' +
            "Defaults to the user's local timezone.",
        },
      },
      required: [],
    },
  },
];

export const TOOL_BY_ID: ReadonlyMap<string, ToolDefinition> = new Map(
  TOOLS.map((tool) => [tool.id, tool]),
);

/** Look up tool definitions for `ids`, dropping any unknown id. */
export function resolveTools(ids: readonly string[]): ToolDefinition[] {
  return ids
    .map((id) => TOOL_BY_ID.get(id))
    .filter((tool): tool is ToolDefinition => tool !== undefined);
}

/**
 * Encode tool ids into the `tools` array Workers AI expects. The documented
 * traditional function-calling flow uses the flat `{ name, description,
 * parameters }` shape (Cloudflare's schema also accepts the OpenAI nested
 * form, but the flat one is what the docs and examples use).
 */
export function toWireTools(ids: readonly string[]): unknown[] {
  return resolveTools(ids).map((tool) => ({
    name: tool.id,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

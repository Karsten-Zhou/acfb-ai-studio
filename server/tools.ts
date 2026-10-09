// Server-side execution of the tools defined in `@shared/tools`.
//
// A tool-calling model emits a name + JSON-argument string; this module turns
// that into a result string (or an error string) that is fed back to the model
// in a `tool`-role message. Only tools the app itself defines can run — an
// unknown name from a model is rejected rather than dispatched, so a
// hallucinated tool can never do anything.

import type { ToolCall } from "@shared/chat";

/** The outcome of running one tool call, ready to serialize for the model. */
export interface ToolExecution {
  id: string;
  name: string;
  /** Serialized result (usually JSON) on success. */
  result?: string;
  /** Human-readable failure reason; `result` may carry a diagnostic too. */
  error?: string;
}

/** Run a single tool call. Never throws: failures become an `error` field. */
export async function executeToolCall(call: ToolCall): Promise<ToolExecution> {
  let args: Record<string, unknown>;
  try {
    args = parseArguments(call.arguments);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: call.id, name: call.name, error: message };
  }

  try {
    switch (call.name) {
      case "get_current_datetime":
        return {
          id: call.id,
          name: call.name,
          result: JSON.stringify(currentDateTime(args)),
        };
      default:
        return {
          id: call.id,
          name: call.name,
          error: `Unknown tool: ${call.name}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: call.id, name: call.name, error: message };
  }
}

/**
 * Parse a tool-call arguments string. Models occasionally emit an empty string
 * or a bare object for a no-argument call, so those normalise to `{}` rather
 * than failing.
 */
function parseArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Could not parse tool arguments as JSON: ${raw}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * The current date and time, in the requested IANA timezone when given and the
 * runtime's local timezone otherwise. Emits structured fields (ISO string,
 * formatted text, weekday, and the timezone actually used) so the model has
 * everything it needs to answer naturally.
 */
function currentDateTime(
  args: Record<string, unknown>,
): Record<string, string> {
  const now = new Date();
  const requested =
    typeof args.timezone === "string" && args.timezone.trim()
      ? args.timezone.trim()
      : undefined;

  // `Intl` throws on an unknown timezone; fall back to the runtime default.
  let timeZone: string | undefined = requested;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(now);
  } catch {
    timeZone = undefined;
  }

  const effectiveZone =
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: effectiveZone,
  }).format(now);

  return {
    iso: now.toISOString(),
    formatted,
    timezone: effectiveZone,
    unix: String(Math.floor(now.getTime() / 1000)),
  };
}

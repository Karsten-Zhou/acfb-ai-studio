// zValidator hook: turn request-validation failures into the canonical
// `{ error }` body with HTTP 400.

import type { Context } from "hono";
import z from "zod";
import { formatZodIssues } from "@shared/sync";

// Loosely typed: generic over every validated schema.
type ValidationOutcome =
  { success: true; data: unknown } | { success: false; error: z.ZodError };

export function zodErrorHook(result: unknown, c: Context): Response | void {
  const outcome = result as ValidationOutcome;
  if (!outcome.success) {
    return c.json(
      {
        error: `Invalid request: ${formatZodIssues(outcome.error.issues)}`,
      },
      400,
    );
  }
}

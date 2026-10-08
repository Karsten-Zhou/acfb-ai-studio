// The wire contract for API failures, shared by the browser and the Worker.
//
// Every failed API response is `{ error, code? }`:
//   - `error` — a message already written for the user, safe to display as-is.
//   - `code`  — a machine-readable marker, used ONLY when the client must offer
//     a specific recovery action. Every code costs a UI branch, so add one
//     deliberately rather than casually.

import z from "zod";

/** The stored sync payload is unreadable and needs an explicit reset. */
export const CORRUPT_STATE = "corrupt-state";

export const apiErrorCodeSchema = z.enum([CORRUPT_STATE]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** Body of every failed API response. The schema is the single source of truth. */
export const apiErrorBodySchema = z.object({
  error: z.string().min(1),
  code: apiErrorCodeSchema.optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

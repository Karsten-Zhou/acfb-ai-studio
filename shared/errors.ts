// The wire contract for API failures, shared by the browser and the Worker.
//
// Every failed API response is `{ error, code? }`:
//   - `error` — a message already written for the user, safe to display as-is.
//   - `code`  — a machine-readable marker, used ONLY when the client must offer
//     a specific recovery action. Every code costs a UI branch, so add one
//     deliberately rather than casually.

/** The stored sync payload is unreadable and needs an explicit reset. */
export const CORRUPT_STATE = "corrupt-state";

export type ApiErrorCode = typeof CORRUPT_STATE;

/** Body of every failed API response. */
export interface ApiErrorBody {
  error: string;
  code?: ApiErrorCode;
}

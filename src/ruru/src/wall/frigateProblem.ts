/** Why Frigate's cameras could not be read, as the wall explains it. */
export type FrigateProblem =
  /** Nothing answered, or the address is not one Ruru can use. */
  | { kind: "unreachable" }
  /** Frigate answered with an HTTP error. */
  | { kind: "status"; status: number }
  /** Something answered, but not with what Frigate sends. */
  | { kind: "unexpected" };

/**
 * Sorts a `frigate_cameras` error by the message of `FrigateError` in
 * src-tauri/src/frigate.rs. Anything else, such as an address that isn't a
 * URL, counts as unreachable.
 */
export function frigateProblem(error: string): FrigateProblem {
  const status = /answered with HTTP (\d{3})/.exec(error);
  if (status) return { kind: "status", status: Number(status[1]) };
  if (error.startsWith("Frigate's answer was not understood")) return { kind: "unexpected" };
  return { kind: "unreachable" };
}

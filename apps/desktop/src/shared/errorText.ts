/** Tauri `invoke` rejects with the Rust command's plain `Err` string; other callers throw `Error` objects. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

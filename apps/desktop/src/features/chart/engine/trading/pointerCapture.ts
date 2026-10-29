/** Releases a pointer capture the browser may already have dropped; a missing capture is not an error. */
export function releaseCapture(host: HTMLElement, event: { pointerId?: number }): void {
  if (event.pointerId === undefined) {
    return;
  }
  try {
    host.releasePointerCapture(event.pointerId);
  } catch {
    /* already released */
  }
}

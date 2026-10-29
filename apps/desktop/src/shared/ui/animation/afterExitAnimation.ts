/**
 * Runs `done` once a backdrop's own exit animation has finished, so a modal
 * stays mounted (and its focus trap active) for exactly as long as the CSS
 * animation plays, without mirroring its duration in code.
 *
 * Invariant: only an `animationend` whose target is `element` counts. The inner
 * panel animates too, and its `animationend` bubbles to the backdrop, so it must
 * not be mistaken for the backdrop finishing. With reduced motion (CSS disables
 * the animation, so no event would ever arrive) or no element, `done` runs
 * immediately. Returns a cancel function that detaches the listener.
 */
export function afterExitAnimation(element: HTMLElement | null, done: () => void): () => void {
  if (element === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done();
    return () => {};
  }
  // Not `{ once: true }`: that would also spend the listener on a bubbled inner-panel
  // event the target filter ignores, and the backdrop's own event would never arrive.
  const controller = new AbortController();
  element.addEventListener(
    'animationend',
    (event) => {
      if (event.target !== element) {
        return;
      }
      controller.abort();
      done();
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}

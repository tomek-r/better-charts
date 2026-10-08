# Inline ESLint suppression audit

Date: 2026-10-08. Owner request: inspect every inline suppression.

The production frontend contained 21 directives: 20 suppressed exhaustive hook dependencies and one suppressed settings initialization in an effect. All are removed. No lint rules, thresholds, tests, or configuration exceptions are weakened.

| File                                                                                                           | Directives | Resolution                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Chart lifecycle](../../apps/desktop/src/features/chart/effects/useChartLifecycle.ts)                          |         11 | Include stable chart refs, setters, and actions. Symbol/timeframe reset triggers and renderer lifetime remain intact.                              |
| [Overlay synchronization](../../apps/desktop/src/features/chart/effects/useChartOverlaySync.ts)                |          1 | Include stable refs and select the three displayed values instead of depending on a freshly allocated display object.                              |
| [Pointer gestures](../../apps/desktop/src/features/chart/effects/useChartGestures.ts)                          |          1 | Pass narrow gesture ports and list stable dependencies. Only fresh workspace dispatch callbacks need the existing latest-callback helper.          |
| [Gesture diagnostics](../../apps/desktop/src/features/chart/effects/useChartGestureDiagnostics.ts)             |          1 | Depend on the six chart refs used by the diagnostic interface.                                                                                     |
| [Bridge bootstrap](../../apps/desktop/src/features/bridge/effects/useBridgeBootstrapEffects.ts)                |          1 | Build setter/ref ports inside the effect from stable store APIs and refs; list those dependencies without subscribing to changing runtime packets. |
| [Bridge overlays](../../apps/desktop/src/features/bridge/effects/useBridgeStreamEffects.ts)                    |          1 | Include refs/actions and current data; retain scalar quote dependencies so time-only quote changes do not trigger synchronization.                 |
| [Ticket entry](../../apps/desktop/src/features/order-ticket/effects/useOrderTicketEntryEffects.ts)             |          2 | Include stable draft setters without changing quote/drag eligibility checks.                                                                       |
| [Ticket check/volume](../../apps/desktop/src/features/order-ticket/effects/useOrderTicketOrderCheckEffects.ts) |          2 | Include stable reset dependencies. The volume mirror reads current values through a stable callback and retains preview/drag triggers.             |
| [Settings dialog](../../apps/desktop/src/features/settings/AppSettingsDialog.tsx)                              |          1 | Derive untouched inputs from loaded settings; keep an independent draft once the user edits. Remove the initialization effect.                     |

## Behavior that must remain intact

The Escape listener needs both the staged-active ref and the unstage callback in its dependency list. They are stable, so this does not reinstall the listener on quote or draft updates. The old comment recorded a deliberately omitted dependency from an earlier extraction; that justification is obsolete after the store/action migration.

The volume mirror deliberately does not trigger when `volumeManual` changes: clearing the field returns it to automatic mode, and immediately mirroring the old preview would refill it before the user could type. Its stable callback reads the latest committed draft when a preview or drag-state change actually triggers synchronization.

Bridge listeners and chart gesture state must survive ordinary account, quote, and draft renders. Dependencies therefore use stable store APIs, refs, and action callbacks rather than complete runtime objects. Reconnect, paging anchors, pending candles, stale responses, and execution gates retain their existing owners and checks.

Settings keep the current loaded values until editing starts. Subsequent asynchronous settings updates cannot overwrite an edited draft; the existing modal focus and closing behavior remain in place.

## Validation

- `pnpm check`: passed (TypeScript, ESLint, Prettier).
- `pnpm build`: passed.
- `pnpm test:e2e`: 261 passed.
- `git diff --check`: passed.
- Source inventory: zero remaining inline suppression directives.

Final validation used the corrected, frozen source. Initial checks found an incorrect store setter path and shadowed bootstrap refs; these were fixed before the successful rerun. No failing version was committed.

The browser suite covers reconnect/history paging, listener cleanup, pointer/keyboard gestures, staged drags, check freshness, manual volume edits, asynchronous settings, and render isolation. Real Tauri/MT5 testing is outside this audit.

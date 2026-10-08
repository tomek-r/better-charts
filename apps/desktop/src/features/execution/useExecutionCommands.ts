// ExecutionProvider owns command state. WorkspaceLifecycle registers the
// observational listener at its original effect slot. Dispatch gates, draft
// identity checks, single in-flight target, and no-retry behavior stay unchanged.
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SubscriptionScope } from '../../shared/bridge/subscriptionScope';
import type { ChartController } from '../chart/engine/chartController';
import type {
  AccountSnapshot,
  CommandError,
  CommandUpdate,
  ExecutionQueueView,
  PendingModification,
} from '../../shared/bridge/types';
import type { PositionOverlayState } from '../chart/engine/positionOverlay';
import { useErrorNotification, useNotifyError } from '../../shared/ui/ErrorNotifications';
import { useDomainField, type DomainStore } from '../../shared/state/domainStore';

export interface ExecutionStoreState {
  executionQueue: ExecutionQueueView | undefined;
  closingTarget: string | undefined;
  closeCancelStatus:
    | {
        kind: 'locked' | 'error';
        text: string;
        source: 'portfolio' | 'draft';
      }
    | undefined;
}

export function useExecutionCommands({
  account,
  setPendingModification,
  positionOverlayState,
  chart,
  store,
}: {
  account: AccountSnapshot | undefined;
  setPendingModification: Dispatch<SetStateAction<PendingModification | undefined>>;
  positionOverlayState: { current: PositionOverlayState };
  chart: { current: ChartController | null };
  store: DomainStore<ExecutionStoreState>;
}) {
  const positionOverlayRef = positionOverlayState;
  // The former Order panel is gone, but its queue view still supplies the
  // authoritative dispatch gate used by the ticket and chart actions.
  const [executionQueue, setExecutionQueue] = useDomainField(store, 'executionQueue');
  // UX close/cancel: the single in-flight portfolio/draft target (mirrors submittingSide)
  // and the last close/cancel outcome line — its `source` decides where it renders.
  const [closingTarget, setClosingTarget] = useDomainField(store, 'closingTarget');
  const [closeCancelStatus, setCloseCancelStatus] = useDomainField(store, 'closeCancelStatus');
  useErrorNotification(closeCancelStatus?.text);
  // UX close/cancel/modify actions: full-close MVP for portfolio rows plus
  // confirmed close/cancel/modify drafts. One busy target at a time (mirrors
  // submitOrder's submittingSide); success is silent (owner — no confirmation
  // copy), a dispatch-locked rejection reuses
  // submitOrder's locked copy, and a confirmed draft clears only once its
  // command was accepted. Every draft outcome is identity-checked against the
  // exact draft object it acted on (a newer drag (last wins) replaces state with
  // a fresh object), so no outcome can touch a different draft. An
  // auto-dispatched SL/TP drag passes keep-on-success — success marks that exact
  // draft `sent` instead of clearing it (the overlay keeps staging the new
  // level); a drop (single-flight) or failure marks it NOT SENT — a protective
  // SL must never look sent.
  const runCloseCancel = async (
    source: 'portfolio' | 'draft',
    key: string,
    verb: 'Close' | 'Cancel' | 'Modify',
    send: () => Promise<unknown>,
    actedDraft?: PendingModification,
    keepOnSuccess = false,
  ) => {
    if (closingTarget) {
      if (actedDraft) {
        setCloseCancelStatus({
          kind: 'error',
          text: `${verb} not sent — another command was in flight. Try again.`,
          source,
        });
        setPendingModification((previous) => (previous === actedDraft ? { ...previous, sendFailed: true } : previous));
      }
      return;
    }
    if (!account?.accountLogin || !account.brokerServer) {
      setCloseCancelStatus({ kind: 'error', text: 'Account snapshot unavailable.', source });
      if (actedDraft) {
        setPendingModification((previous) => (previous === actedDraft ? { ...previous, sendFailed: true } : previous));
      }
      return;
    }
    setClosingTarget(key);
    try {
      await send();
      setCloseCancelStatus(undefined); // owner: success is silent — no confirmation copy
      if (source === 'draft') {
        if (keepOnSuccess && actedDraft) {
          setPendingModification((previous) =>
            previous === actedDraft ? { ...previous, sent: true, sendFailed: false } : previous,
          );
        } else {
          setPendingModification((previous) =>
            actedDraft === undefined || previous === actedDraft ? undefined : previous,
          );
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setCloseCancelStatus(
        /dispatch is disabled/i.test(text)
          ? { kind: 'locked', text: 'Dispatch locked — nothing was sent to MT5. Owner approval required.', source }
          : { kind: 'error', text, source },
      );
      if (source === 'draft' && actedDraft) {
        setPendingModification((previous) => (previous === actedDraft ? { ...previous, sendFailed: true } : previous));
      }
      // Reality wins: a rejected command drops any kept drag preview (the line
      // must not keep a level MT5 never accepted).
      if (positionOverlayState.current.drag !== null) {
        positionOverlayRef.current.drag = null;
        chart.current?.refreshOverlays();
      }
    } finally {
      setClosingTarget(undefined);
    }
  };
  const requestClosePosition = (source: 'portfolio' | 'draft', positionId: string, actedDraft?: PendingModification) =>
    runCloseCancel(
      source,
      `Close:position:${positionId}`,
      'Close',
      () =>
        invoke('close_position', {
          accountLogin: account?.accountLogin,
          brokerServer: account?.brokerServer,
          positionId,
          volume: null,
        }),
      actedDraft,
    );
  const requestCancelOrder = (source: 'portfolio' | 'draft', orderId: string, actedDraft?: PendingModification) =>
    runCloseCancel(
      source,
      `Cancel:order:${orderId}`,
      'Cancel',
      () =>
        invoke('cancel_order', { accountLogin: account?.accountLogin, brokerServer: account?.brokerServer, orderId }),
      actedDraft,
    );
  // Modify drafts: same busy/status path as close/cancel. `targetKind` uses
  // the backend's wire strings ("position"/"pending_order"); explicit nulls are
  // the backend's "leave this level unchanged" signal; the decimal string "0"
  // removes the selected SL/TP. Shared by live level-clear chips, pending-order
  // price drags and SL/TP drag auto-send (keepDraftOnSuccess), all using the
  // same modify_order serialization.
  const requestModifyDraft = (draft: PendingModification, keepDraftOnSuccess = false) => {
    if (!draft.targetId) {
      return;
    }
    const isPosition = draft.kind === 'positionModify';
    void runCloseCancel(
      'draft',
      `Modify:${isPosition ? 'position' : 'order'}:${draft.targetId}`,
      'Modify',
      () =>
        invoke('modify_order', {
          accountLogin: account?.accountLogin,
          brokerServer: account?.brokerServer,
          targetKind: isPosition ? 'position' : 'pending_order',
          targetId: draft.targetId,
          stopLoss: draft.stopLoss ?? null,
          takeProfit: draft.takeProfit ?? null,
          price: draft.price ?? null,
        }),
      draft,
      keepDraftOnSuccess,
    );
  };
  return {
    executionQueue,
    setExecutionQueue,
    closingTarget,
    closeCancelStatus,
    runCloseCancel,
    requestClosePosition,
    requestCancelOrder,
    requestModifyDraft,
  };
}

export type ExecutionCommandState = ReturnType<typeof useExecutionCommands>;

/** Register the observational listener and initial queue read at its former App effect slot. */
export function useExecutionCommandEffects(execution: ExecutionCommandState): void {
  const { setExecutionQueue } = execution;
  const notifyError = useNotifyError();
  // Both operations are observational; a failure does not invent a command state.
  useEffect(() => {
    let disposed = false;
    const subscriptions = new SubscriptionScope();
    void subscriptions
      .register([
        listen<CommandUpdate>('execution-command-update', (event) => {
          if (!disposed && event.payload.status === 'rejected') {
            notifyError(event.payload.message || `Order rejected by MT5 (code ${event.payload.retcode ?? 'unknown'}).`);
          }
        }),
        listen<CommandError>('execution-command-error', (event) => {
          if (!disposed) {
            notifyError(event.payload.message);
          }
        }),
      ])
      .catch(() => undefined);
    void invoke<ExecutionQueueView>('get_execution_queue_status')
      .then((view) => {
        if (!disposed) {
          setExecutionQueue(view);
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      subscriptions.dispose();
    };
  }, [setExecutionQueue, notifyError]);
}

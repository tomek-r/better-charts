// ExecutionProvider owns command state. WorkspaceLifecycle registers the
// observational listener at its original effect slot. Dispatch gates, draft
// identity checks, single in-flight target, and no-retry behavior stay unchanged.
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SubscriptionScope } from '../../shared/bridge/subscriptionScope';
import { errorText } from '../../shared/errorText';
import type { ChartController } from '../chart/engine/surface/chartController';
import type {
  AccountSnapshot,
  CommandError,
  CommandUpdate,
  ExecutionQueueView,
  PendingModification,
} from '../../shared/bridge/types';
import type { PositionOverlayState } from '../chart/engine/trading/positionOverlayTypes';
import { useErrorNotification, useNotifyError } from '../../shared/ui/notification/ErrorNotifications';
import { describeRejection } from './tradeRejection';
import { dispatchStatusFromError, type DispatchStatus } from './dispatchStatus';
import { useStoreField, type FieldStore } from '../../shared/store/fieldStore';

export type CloseCancelSource = 'portfolio' | 'draft';

/** The last close/cancel outcome line; its `source` decides where it renders. */
export type CloseCancelStatus = DispatchStatus & { source: CloseCancelSource };

export interface ExecutionStoreState {
  executionQueue: ExecutionQueueView | undefined;
  closingTarget: string | undefined;
  closeCancelStatus: CloseCancelStatus | undefined;
}

/** The in-flight target key of a full or partial close of one position. */
export function closeTargetKey(positionId: string): string {
  return `Close:position:${positionId}`;
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
  store: FieldStore<ExecutionStoreState>;
}) {
  // The alias keeps react-hooks/immutability from flagging the ref mutation as a prop mutation.
  const positionOverlayRef = positionOverlayState;
  // The former Order panel is gone, but its queue view still supplies the
  // authoritative dispatch gate used by the ticket and chart actions.
  const [executionQueue, setExecutionQueue] = useStoreField(store, 'executionQueue');
  // The single in-flight portfolio/draft target (mirrors submittingSide).
  const [closingTarget, setClosingTarget] = useStoreField(store, 'closingTarget');
  const [closeCancelStatus, setCloseCancelStatus] = useStoreField(store, 'closeCancelStatus');
  useErrorNotification(closeCancelStatus?.text);
  const accountArgs = { accountLogin: account?.accountLogin, brokerServer: account?.brokerServer };
  // Marks only the exact draft object the command acted on: a newer drag (last wins)
  // replaces state with a fresh object, so no outcome can touch a different draft.
  const markDraftSendFailed = (actedDraft: PendingModification) =>
    setPendingModification((previous) => (previous === actedDraft ? { ...previous, sendFailed: true } : previous));
  // One busy target at a time; success is silent (owner: no confirmation copy).
  // A confirmed draft clears only once its command was accepted. An auto-dispatched
  // SL/TP drag passes keep-on-success and is marked `sent` instead of cleared (the
  // overlay keeps staging the new level); a drop or failure marks it NOT SENT, so a
  // protective SL never looks sent.
  const runCloseCancel = async (
    source: CloseCancelSource,
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
        markDraftSendFailed(actedDraft);
      }
      return;
    }
    if (!account?.accountLogin || !account.brokerServer) {
      setCloseCancelStatus({ kind: 'error', text: 'Account snapshot unavailable.', source });
      if (actedDraft) {
        markDraftSendFailed(actedDraft);
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
      const text = errorText(error);
      setCloseCancelStatus({ ...dispatchStatusFromError(text), source });
      if (source === 'draft' && actedDraft) {
        markDraftSendFailed(actedDraft);
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
  // `volume` null = full close; a decimal string closes only that part.
  const requestClosePosition = (
    source: CloseCancelSource,
    positionId: string,
    actedDraft?: PendingModification,
    volume: string | null = null,
  ) =>
    runCloseCancel(
      source,
      closeTargetKey(positionId),
      'Close',
      () => invoke('close_position', { ...accountArgs, positionId, volume }),
      actedDraft,
    );
  const requestCancelOrder = (source: CloseCancelSource, orderId: string, actedDraft?: PendingModification) =>
    runCloseCancel(
      source,
      `Cancel:order:${orderId}`,
      'Cancel',
      () => invoke('cancel_order', { ...accountArgs, orderId }),
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
          ...accountArgs,
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
            notifyError(describeRejection(event.payload));
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

import type { RefObject } from 'react';
import type { Mt5FileReport } from '../../../../shared/bridge/types';
import {
  outcomeSummary,
  RESTART_CONFIRM_TEXT,
  RESTART_DONE_TEXT,
  RESTART_PHRASE,
  RESTART_RUNNING_TEXT,
  splitAtRestartPhrase,
} from './installText';
import type { RestartStep } from './useInstallToMt5';

/** The restart phrase as a button: styled like a link, it only opens the confirmation. */
function RestartLink({ linkRef, onOpen }: { linkRef: RefObject<HTMLButtonElement | null>; onOpen: () => void }) {
  return (
    <button ref={linkRef} type="button" className="setup-guide-install-restart" onClick={onOpen}>
      {RESTART_PHRASE}
    </button>
  );
}

/** One settled done line: its sentence, with the restart phrase as the only clickable words. */
function DoneLineText({
  text,
  linkRef,
  onOpen,
}: {
  text: string;
  linkRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  const parts = splitAtRestartPhrase(text);
  if (parts === undefined) {
    return <>{text}</>;
  }
  return (
    <>
      {parts.lead}
      <RestartLink linkRef={linkRef} onOpen={onOpen} />
      {parts.trail}
    </>
  );
}

/** The confirmation that replaces the done line, in the row it already reserved. */
function RestartConfirmation({
  confirmRef,
  onConfirm,
  onCancel,
}: {
  confirmRef: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <span className="setup-guide-install-confirm-text">{RESTART_CONFIRM_TEXT}</span>
      <button ref={confirmRef} type="button" className="setup-guide-install-confirm" onClick={onConfirm}>
        Restart MT5
      </button>
      <button type="button" className="setup-guide-install-confirm" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}

/**
 * The done line of a clean report and the restart it may offer: the confirmation, the
 * progress line and the result each replace the line inside the row it already
 * reserved, so the dialog keeps its height.
 */
export function RestartWithEa({
  files,
  doneLine,
  restartStep,
  linkRef,
  confirmRef,
  onOpen,
  onConfirm,
  onCancel,
}: {
  files: Mt5FileReport[];
  doneLine: string;
  restartStep: RestartStep;
  linkRef: RefObject<HTMLButtonElement | null>;
  confirmRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <p
      className={`setup-guide-install-done${restartStep === 'confirm' ? ' is-confirming' : ''}`}
      title={restartStep === 'idle' ? `${doneLine} ${outcomeSummary(files)}` : undefined}
    >
      {restartStep === 'idle' && <DoneLineText text={doneLine} linkRef={linkRef} onOpen={onOpen} />}
      {restartStep === 'confirm' && (
        <RestartConfirmation confirmRef={confirmRef} onConfirm={onConfirm} onCancel={onCancel} />
      )}
      {restartStep === 'running' && <span role="status">{RESTART_RUNNING_TEXT}</span>}
      {restartStep === 'done' && RESTART_DONE_TEXT}
    </p>
  );
}

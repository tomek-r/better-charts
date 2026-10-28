import { ErrorNotification } from '../../shared/ui/notification/ErrorNotifications';
import { afterExitAnimation } from '../../shared/ui/animation/afterExitAnimation';
import { ModalDialog, ModalDialogButton, ModalDialogCloseButton } from '../../shared/ui/dialog/ModalDialog';
import { Suspense, use, useEffect, useRef, useState, type SubmitEvent, type ReactNode } from 'react';
import { LazySetupGuideModal } from './setup/setup-guide-modal/LazySetupGuideModal';
import type { AppSettingsData, DetectedSettingsField } from './appSettingsData';
import { saveAppSettings } from './appSettingsCommands';
import { bridgeSettingsIssue } from './bridgeSettingsValidation';
import { SectionInfoIcon } from './SectionInfoIcon';
import { SettingsTextField } from './SettingsTextField';
import { FRAME_BYTES } from '../../shared/bridge/config';
import type { MT5BridgeSettings } from '../../shared/bridge/types';

const SETTINGS_CATEGORIES = [
  { name: 'MT5 setup', icon: '⇄' },
  { name: 'Trading', icon: '⌁' },
] as const;

type Category = (typeof SETTINGS_CATEGORIES)[number]['name'];

const BYTES_PER_MIB = 1024 * 1024;

/** Notes that this load filled the field from an MT5 installation found on this computer. */
function DetectedHint({ detected, field }: { detected: DetectedSettingsField[]; field: DetectedSettingsField }) {
  if (!detected.includes(field)) {
    return null;
  }
  return <span className="settings-detected-hint">Detected on this computer</span>;
}

function SettingsContent({ loadRequest, children }: { loadRequest: Promise<void> | undefined; children: ReactNode }) {
  if (loadRequest) {
    use(loadRequest);
  }
  return children;
}

export function AppSettingsDialog({
  settings,
  loadRequest,
  closing,
  guideOpen,
  guideFinishing,
  loadError,
  onClose,
  onOpenGuide,
  onCloseGuide,
  onGuideFinished,
  onExited,
  onSaved,
}: {
  closing: boolean;
  settings: AppSettingsData | undefined;
  loadRequest: Promise<void>;
  /** The setup guide is opened through the settings store, so other surfaces can open it too. */
  guideOpen: boolean;
  /** The setup completed: the guide fades out slowly before it goes. */
  guideFinishing: boolean;
  loadError: string | undefined;
  onClose: () => void;
  onOpenGuide: () => void;
  onCloseGuide: () => void;
  /** The guide's exit animation ended, so the finished screen may take the window. */
  onGuideFinished: () => void;
  onExited: () => void;
  onSaved: (settings: AppSettingsData) => void;
}) {
  const [editedDraft, setEditedDraft] = useState<MT5BridgeSettings>();
  const draft = editedDraft ?? settings?.mt5BridgeSettings;
  // Detection hints describe the load, so an edit during the session leaves them as they are.
  const detectedFields = settings?.detectedFields ?? [];
  const [category, setCategory] = useState<Category>('MT5 setup');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const guideTrigger = useRef<HTMLElement | null>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  // Unmounting happens when the backdrop's own exit animation ends; reopening
  // (closing back to false) cancels a pending exit through this cleanup.
  useEffect(() => {
    if (closing) {
      return afterExitAnimation(backdrop.current, onExited);
    }
  }, [closing, onExited]);
  const busy = saving || closing;
  // When the guide closes, return focus to the element that opened it.
  useEffect(() => {
    if (!guideOpen && guideTrigger.current?.isConnected) {
      guideTrigger.current.focus();
    }
  }, [guideOpen]);
  const change = <K extends keyof MT5BridgeSettings>(key: K, value: MT5BridgeSettings[K]) => {
    if (draft) {
      setEditedDraft({ ...draft, [key]: value });
    }
    setError(undefined);
  };
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draft || busy) {
      return;
    }
    const issue = bridgeSettingsIssue(draft, settings?.platform);
    if (issue) {
      setCategory('MT5 setup');
      setError(issue);
      return;
    }
    setSaving(true);
    try {
      const next = await saveAppSettings(draft);
      onSaved(next);
    } catch {
      setError('Could not save settings. Check the values and try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalDialog
      title="App settings"
      layout="scrollable"
      size="wide"
      backdropRef={backdrop}
      backdropClassName="settings-backdrop"
      className="settings-dialog"
      bodyClassName="settings-body"
      bodyDisabled={busy}
      closing={closing}
      onDismiss={() => {
        if (!busy) {
          onClose();
        }
      }}
      onSubmit={(event) => void save(event)}
      headerActions={<ModalDialogCloseButton label="Close settings" disabled={busy} onClick={onClose} />}
      footerNote="Changes apply after restarting Better Charts."
      actions={
        <>
          <ModalDialogButton variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </ModalDialogButton>
          {/* Both labels share one grid cell, so the button keeps the wider width and Cancel never moves. */}
          <ModalDialogButton type="submit" className="modal-dialog-save" disabled={!draft || busy || !!loadError}>
            <span className="modal-dialog-save-label" data-shown={!saving}>
              Save
            </span>
            <span className="modal-dialog-save-label" data-shown={saving}>
              Saving…
            </span>
          </ModalDialogButton>
        </>
      }
      overlay={
        guideOpen && (
          <LazySetupGuideModal onClose={onCloseGuide} onFinished={onGuideFinished} finishing={guideFinishing} />
        )
      }
    >
      <nav className="settings-nav" aria-label="Settings categories">
        {SETTINGS_CATEGORIES.map(({ name, icon }) => (
          <button
            type="button"
            key={name}
            aria-current={category === name ? 'page' : undefined}
            onClick={() => setCategory(name)}
          >
            <span aria-hidden="true">{icon}</span>
            {name}
          </button>
        ))}
      </nav>
      <div className="settings-content" key={category}>
        {loadError && <ErrorNotification message={loadError} />}
        <Suspense fallback={<p role="status">Loading settings…</p>}>
          <SettingsContent loadRequest={!draft && !loadError ? loadRequest : undefined}>
            {settings?.firstLaunch && (
              <p className="settings-intro">Welcome to Better Charts. Set up your MT5 connection to get started.</p>
            )}
            {draft && category === 'MT5 setup' && (
              <>
                <h3 className="settings-section-title">
                  Bridge connection
                  <button
                    type="button"
                    className="section-info-trigger"
                    aria-label="How to set up the bridge connection"
                    aria-haspopup="dialog"
                    aria-expanded={guideOpen}
                    disabled={busy}
                    onClick={(event) => {
                      guideTrigger.current = event.currentTarget;
                      onOpenGuide();
                    }}
                  >
                    <SectionInfoIcon />
                  </button>
                </h3>
                <SettingsTextField
                  label="Address"
                  value={draft.address}
                  autoComplete="off"
                  onChange={(value) => change('address', value)}
                />
                <p className="settings-hint">Local host and port. Use the same host and port in the EA inputs.</p>
                <SettingsTextField
                  label="Token"
                  type={showToken ? 'text' : 'password'}
                  value={draft.token}
                  autoComplete="off"
                  onChange={(value) => change('token', value)}
                />
                <label className="settings-checkbox">
                  <input type="checkbox" checked={showToken} onChange={(event) => setShowToken(event.target.checked)} />
                  Show token
                </label>
                <p className="settings-hint">
                  Use the identical token in the EA's InpBridgeToken. Saved locally on this device.
                </p>
                <h3>Transfer limits</h3>
                <label className="settings-field">
                  Maximum frame bytes
                  <input
                    type="number"
                    min={FRAME_BYTES.min}
                    max={FRAME_BYTES.max}
                    step="1"
                    value={Number.isNaN(draft.maxFrameBytes) ? '' : draft.maxFrameBytes}
                    onChange={(event) => change('maxFrameBytes', Number(event.target.value))}
                  />
                </label>
                <p className="settings-hint">
                  Negotiated with the EA. Default: {FRAME_BYTES.default} bytes ({FRAME_BYTES.default / BYTES_PER_MIB}{' '}
                  MiB).
                </p>
              </>
            )}
            {draft && category === 'Trading' && (
              <>
                <h3>Trading permissions</h3>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.tradingEnabled}
                    onChange={(event) => change('tradingEnabled', event.target.checked)}
                  />
                  Allow order execution
                </label>
                <p className="settings-hint">
                  Enable to allow Better Charts to submit, modify, and close trades. MT5, the EA, and the account must
                  also permit trading, and reconciliation must be complete.
                </p>
                <p className="settings-hint">Keep disabled for charting without order execution.</p>
              </>
            )}
            {draft && category === 'MT5 setup' && (
              <>
                <h3>Terminal startup</h3>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.autoStartMt5}
                    onChange={(event) => change('autoStartMt5', event.target.checked)}
                  />
                  Start MT5 when Better Charts launches
                </label>
                <p className="settings-hint">Saving settings does not start MT5. Startup runs on the next launch.</p>
                <SettingsTextField
                  label="MT5 executable path"
                  value={draft.terminalPath}
                  onChange={(value) => change('terminalPath', value)}
                >
                  <DetectedHint detected={detectedFields} field="terminalPath" />
                </SettingsTextField>
                {settings?.platform !== 'windows' && (
                  <>
                    <SettingsTextField
                      label="Wine binary path"
                      value={draft.wineBinary}
                      onChange={(value) => change('wineBinary', value)}
                    >
                      <DetectedHint detected={detectedFields} field="wineBinary" />
                    </SettingsTextField>
                    <SettingsTextField
                      label="Wine prefix path"
                      value={draft.winePrefix}
                      onChange={(value) => change('winePrefix', value)}
                    >
                      <DetectedHint detected={detectedFields} field="winePrefix" />
                    </SettingsTextField>
                  </>
                )}
                <SettingsTextField
                  label="Startup configuration path (optional)"
                  value={draft.configPath}
                  onChange={(value) => change('configPath', value)}
                />
              </>
            )}
            {settings && settings.overriddenKeys.length > 0 && (
              <p className="settings-hint">
                Environment or .env values override saved settings: {settings.overriddenKeys.join(', ')}.
              </p>
            )}
            {error && <ErrorNotification message={error} />}
          </SettingsContent>
        </Suspense>
      </div>
    </ModalDialog>
  );
}

import { ErrorNotification } from '../../shared/ui/ErrorNotifications';
import { Suspense, use, useEffect, useRef, useState, type SubmitEvent, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SetupGuideModal } from './setup-guide/SetupGuideModal';
import type { AppSettingsData } from './settingsTypes';
import { FRAME_BYTES } from '../../shared/bridge/limits';
import type { MT5BridgeSettings } from '../../shared/bridge/types';

type Category = 'MT5 setup' | 'Trading';

/** Loopback host and port; compiled once rather than on every save. */
const LOOPBACK_ADDRESS = /^(127(?:\.[0-9]{1,3}){3}|\[::1\]):([0-9]+)$/;

export function AppSettingsDialog({
  settings,
  loadRequest,
  closing,
  loadError,
  onClose,
  onSaved,
}: {
  closing: boolean;
  settings: AppSettingsData | undefined;
  loadRequest: Promise<void>;
  loadError: string | undefined;
  onClose: () => void;
  onSaved: (settings: AppSettingsData) => void;
}) {
  const [editedDraft, setEditedDraft] = useState<MT5BridgeSettings>();
  const draft = editedDraft ?? settings?.mt5BridgeSettings;
  const [category, setCategory] = useState<Category>('MT5 setup');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const savingRef = useRef(saving || closing);
  useEffect(() => {
    savingRef.current = saving || closing;
  }, [saving, closing]);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handler = (event: KeyboardEvent) => {
      // A nested setup guide on top of the content owns the key (the chart
      // already yields to [data-app-settings-dialog]); let it handle Escape/Tab.
      if (document.querySelector('[data-setup-guide]')) {
        return;
      }
      // Keep modal keystrokes away from the chart's global drawing/order shortcuts.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!savingRef.current) {
          closeRef.current();
        }
      }
      if (event.key !== 'Tab') {
        return;
      }
      const controls = Array.from(
        panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ??
          [],
      );
      if (controls.length === 0) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);
  const change = <K extends keyof MT5BridgeSettings>(key: K, value: MT5BridgeSettings[K]) => {
    if (draft) {
      setEditedDraft({ ...draft, [key]: value });
    }
    setError(undefined);
  };
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draft || saving || closing) {
      return;
    }
    if (!draft.token.trim()) {
      setCategory('MT5 setup');
      setError('Enter a nonempty token and use the same token in the MT5 EA.');
      return;
    }
    const address = LOOPBACK_ADDRESS.exec(draft.address.trim());
    if (
      !address ||
      Number(address[2]) < 1 ||
      Number(address[2]) > 65535 ||
      (address[1] !== '[::1]' && address[1].split('.').some((part) => Number(part) > 255))
    ) {
      setCategory('MT5 setup');
      setError('Use a local address with a port from 1 to 65535, for example 127.0.0.1:8765.');
      return;
    }
    if (
      !Number.isInteger(draft.maxFrameBytes) ||
      draft.maxFrameBytes < FRAME_BYTES.min ||
      draft.maxFrameBytes > FRAME_BYTES.max
    ) {
      setCategory('MT5 setup');
      setError(`Maximum frame bytes must be an integer from ${FRAME_BYTES.min} to ${FRAME_BYTES.max}.`);
      return;
    }
    if (
      draft.autoStartMt5 &&
      (!draft.terminalPath.trim() ||
        (settings?.platform !== 'windows' && (!draft.winePrefix.trim() || !draft.wineBinary.trim())))
    ) {
      setCategory('MT5 setup');
      setError('Provide the terminal path and, on macOS or Linux, the Wine binary and prefix.');
      return;
    }
    setSaving(true);
    try {
      const next = await invoke<AppSettingsData>('save_app_settings', { settings: draft });
      onSaved(next);
    } catch {
      setError('Could not save settings. Check the values and try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={`settings-backdrop${closing ? ' is-closing' : ''}`}>
      <div
        ref={panel}
        className="settings-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="settings-title"
        data-app-settings-dialog
      >
        <header className="settings-header">
          <h2 id="settings-title">App settings</h2>
          <button type="button" aria-label="Close settings" disabled={saving || closing} onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={(event) => void save(event)} noValidate>
          <fieldset className="settings-body" disabled={saving || closing}>
            <nav className="settings-nav" aria-label="Settings categories">
              {(['MT5 setup', 'Trading'] as const).map((item, index) => (
                <button
                  type="button"
                  key={item}
                  aria-current={category === item ? 'page' : undefined}
                  onClick={() => setCategory(item)}
                >
                  <span aria-hidden="true">{['⇄', '⌁'][index]}</span>
                  {item}
                </button>
              ))}
            </nav>
            <div className="settings-content" key={category}>
              {loadError && <ErrorNotification message={loadError} />}
              <Suspense fallback={<p role="status">Loading settings…</p>}>
                <SettingsContent loadRequest={!draft && !loadError ? loadRequest : undefined}>
                  {settings?.firstLaunch && (
                    <p className="settings-intro">
                      Welcome to Better Charts. Set up your MT5 connection to get started.
                    </p>
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
                          disabled={saving || closing}
                          onClick={() => setGuideOpen(true)}
                        >
                          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
                            <circle cx="8" cy="4.6" r="1" fill="currentColor" />
                            <path d="M8 7.2v4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                          </svg>
                        </button>
                      </h3>
                      <label className="settings-field">
                        Address
                        <input
                          value={draft.address}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => change('address', event.target.value)}
                        />
                      </label>
                      <p className="settings-hint">Local host and port. Use the same host and port in the EA inputs.</p>
                      <label className="settings-field">
                        Token
                        <input
                          type={showToken ? 'text' : 'password'}
                          value={draft.token}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => change('token', event.target.value)}
                        />
                      </label>
                      <label className="settings-checkbox">
                        <input
                          type="checkbox"
                          checked={showToken}
                          onChange={(event) => setShowToken(event.target.checked)}
                        />
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
                        Negotiated with the EA. Default: {FRAME_BYTES.default} bytes (
                        {FRAME_BYTES.default / (1024 * 1024)} MiB).
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
                        Enable to allow Better Charts to submit, modify, and close trades. MT5, the EA, and the account
                        must also permit trading, and reconciliation must be complete.
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
                      <p className="settings-hint">
                        Saving settings does not start MT5. Startup runs on the next launch.
                      </p>
                      <label className="settings-field">
                        MT5 executable path
                        <input
                          value={draft.terminalPath}
                          spellCheck={false}
                          onChange={(event) => change('terminalPath', event.target.value)}
                        />
                      </label>
                      {settings?.platform !== 'windows' && (
                        <>
                          <label className="settings-field">
                            Wine binary path
                            <input
                              value={draft.wineBinary}
                              spellCheck={false}
                              onChange={(event) => change('wineBinary', event.target.value)}
                            />
                          </label>
                          <label className="settings-field">
                            Wine prefix path
                            <input
                              value={draft.winePrefix}
                              spellCheck={false}
                              onChange={(event) => change('winePrefix', event.target.value)}
                            />
                          </label>
                        </>
                      )}
                      <label className="settings-field">
                        Startup configuration path (optional)
                        <input
                          value={draft.configPath}
                          spellCheck={false}
                          onChange={(event) => change('configPath', event.target.value)}
                        />
                      </label>
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
          </fieldset>
          <footer className="settings-footer">
            <p>Changes apply after restarting Better Charts.</p>
            <button type="button" className="settings-cancel" disabled={saving || closing} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="settings-save" disabled={!draft || saving || closing || !!loadError}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </form>
        {guideOpen && <SetupGuideModal onClose={() => setGuideOpen(false)} />}
      </div>
    </div>
  );
}

function SettingsContent({ loadRequest, children }: { loadRequest: Promise<void> | undefined; children: ReactNode }) {
  if (loadRequest) {
    use(loadRequest);
  }
  return children;
}

import { save } from '@tauri-apps/plugin-dialog';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DownloadIcon } from '../../../shared/ui/DownloadIcon';

// The EA and tick-history reader already ship with the app as Tauri resources
// (see tauri.conf.json). The guide downloads them to a folder the user picks:
// the dialog plugin opens a native "Save As" dialog, then a command copies the
// bundled file to the chosen path.
const BUNDLED_RESOURCES = [
  {
    resourcePath: 'mql5/Experts/BetterChartsBridge.mq5',
    fileName: 'BetterChartsBridge.mq5',
    kind: 'Expert Advisor (EA)',
  },
  {
    resourcePath: 'mql5/Indicators/BetterChartsTickHistoryReader.mq5',
    fileName: 'BetterChartsTickHistoryReader.mq5',
    kind: 'Tick-history indicator',
  },
] as const;

/** Open a native "Save As" dialog, then copy the bundled resource to the path. */
async function downloadResource(resourcePath: string, fileName: string): Promise<void> {
  const destination = await save({
    defaultPath: fileName,
    filters: [{ name: 'MQL5 source', extensions: ['mq5'] }],
  });
  if (destination) {
    await invoke('save_bundled_resource', { resource: resourcePath, destination });
  }
}

/** A simple overlay that sits on top of the open settings content. */
export function SetupGuideModal({ onClose }: { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const shellAvailable = isTauri();
  const requestClose = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    setClosing(true);
    backdrop.current?.addEventListener('animationend', () => onClose(), { once: true });
  }, [onClose]);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [requestClose]);

  return (
    <div ref={backdrop} className={`setup-guide-backdrop${closing ? ' is-closing' : ''}`}>
      <div className="setup-guide" role="dialog" aria-modal="true" aria-labelledby="setup-guide-title" data-setup-guide>
        <div className="setup-guide-header">
          <h2 id="setup-guide-title">Set up the MT5 bridge</h2>
          <button
            ref={closeButton}
            type="button"
            className="setup-guide-close"
            onClick={requestClose}
            aria-label="Close setup guide"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <path
                d="M5.2 5.2l7.6 7.6M12.8 5.2L5.2 12.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>

        <ol className="setup-guide-steps">
          <li>
            Download the files below — a save dialog lets you choose the folder.
            <div className="setup-guide-downloads">
              {BUNDLED_RESOURCES.map((resource) => (
                <button
                  key={resource.resourcePath}
                  type="button"
                  className="setup-guide-download"
                  data-resource={resource.resourcePath}
                  disabled={!shellAvailable}
                  onClick={() => {
                    void downloadResource(resource.resourcePath, resource.fileName);
                  }}
                >
                  <DownloadIcon />
                  <span className="setup-guide-download-file">{resource.fileName}</span>
                  <span className="setup-guide-download-kind">{resource.kind}</span>
                </button>
              ))}
            </div>
          </li>
          <li>
            In MetaTrader 5, open <strong>MQL5</strong> in the Navigator tree, then <strong>Expert Advisors</strong>{' '}
            (right-click &rarr; Show in Data Folder) and <strong>Indicators</strong>.
          </li>
          <li>
            Copy <code>BetterChartsBridge.mq5</code> into the <code>Experts</code> folder and{' '}
            <code>BetterChartsTickHistoryReader.mq5</code> into the <code>Indicators</code> folder.
          </li>
          <li>
            Press <strong>F7</strong> in MetaEditor to compile both (aim for 0 errors) and attach the EA to any chart.
          </li>
          <li>
            Back here, the connection switches to <strong>connected</strong> — the bridge is ready.
          </li>
        </ol>
      </div>
    </div>
  );
}

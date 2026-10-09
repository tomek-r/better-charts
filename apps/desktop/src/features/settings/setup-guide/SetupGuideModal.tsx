import { save } from '@tauri-apps/plugin-dialog';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';

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

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 2v8m0 0 3.2-3.2M8 10 4.8 6.8M3 13.5h10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// Matches the settings modal exit animation.
const CLOSE_DURATION_MS = 180;

/** A simple overlay that sits on top of the open settings content. */
export function SetupGuideModal({ onClose }: { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const shellAvailable = isTauri();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Fade out like the settings modal (skipped under reduced motion), then unmount.
  const requestClose = useCallback(() => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), CLOSE_DURATION_MS);
  }, []);

  // Take focus on open, close on Escape, return focus to the trigger when dismissed.
  useEffect(() => {
    const previous = document.activeElement;
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
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [requestClose]);

  return (
    <div className={`setup-guide-backdrop${closing ? ' is-closing' : ''}`}>
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

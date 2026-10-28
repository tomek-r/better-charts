import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { DownloadIcon } from './DownloadIcon';
import { useAppSettingsView } from '../AppSettingsProvider';

// The EA and tick-history reader already ship with the app as Tauri resources
// (see tauri.conf.json). The manual steps download them to a folder the user picks:
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

/** How long the copy button confirms the token before it offers the copy again. */
const COPIED_CONFIRMATION_MS = 2_000;

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

/** The fallback route, folded away so the automatic install stays the obvious one. */
export function ManualInstall() {
  const { settings } = useAppSettingsView();
  const shellAvailable = isTauri();
  const token = settings?.mt5BridgeSettings.token;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyToken(): Promise<void> {
    if (!token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // A refused clipboard leaves the button as it was, so the user can try again.
    }
  }

  return (
    <details className="setup-guide-manual">
      <summary>Install manually instead</summary>
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
          Copy <code>BetterChartsBridge.mq5</code> into the <code>{'Experts\\Advisors'}</code> folder and{' '}
          <code>BetterChartsTickHistoryReader.mq5</code> into the <code>Indicators</code> folder.
        </li>
        <li>
          Press <strong>F7</strong> in MetaEditor to compile both (aim for 0 errors) and attach the EA to any chart.
        </li>
        <li>
          Attach the EA to a chart, open its <strong>Inputs</strong> tab and paste this app's bridge token into{' '}
          <strong>InpBridgeToken</strong>.
          <div className="setup-guide-token">
            <button type="button" className="setup-guide-secondary" disabled={!token} onClick={() => void copyToken()}>
              {copied ? 'Token copied' : 'Copy token'}
            </button>
          </div>
        </li>
        <li>
          Back here, the connection switches to <strong>connected</strong> — the bridge is ready.
        </li>
      </ol>
    </details>
  );
}

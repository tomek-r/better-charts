import type { Dispatch, SetStateAction } from 'react';

/** Static brand mark: hoisted so a re-render reuses the same element. */
const brandMark = (
  <span className="brand-mark" aria-hidden="true">
    <svg width="27" height="27" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="brand-icon-bg" x1="128" y1="128" x2="896" y2="896" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-raised)" />
          <stop offset="1" stopColor="var(--color-root)" />
        </linearGradient>
        <linearGradient id="brand-icon-chart" x1="244" y1="720" x2="796" y2="284" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="var(--color-info)" />
        </linearGradient>
      </defs>
      <rect x="32" y="32" width="960" height="960" rx="224" fill="url(#brand-icon-bg)" />
      <path
        d="M224 740L384 574L510 650L690 422L800 494"
        fill="none"
        stroke="url(#brand-icon-chart)"
        strokeWidth="72"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="800" cy="494" r="46" fill="var(--color-info)" />
    </svg>
  </span>
);

export function TopBar({
  panelOpen,
  setPanelOpen,
  setSearchOpen,
  openSettings,
}: {
  openSettings: () => void;
  panelOpen: boolean;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        {brandMark}
        <span>Better Charts</span>
        <small>v{__APP_VERSION__}</small>
      </div>
      <div className="topbar-actions">
        <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search symbols">
          <span className="search-trigger-label">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <circle cx="8.7" cy="8.7" r="5.4" />
              <path d="m12.7 12.7 4 4" />
            </svg>
            Search symbols
          </span>
          <kbd>⌘K</kbd>
        </button>
        <button
          className="panel-toggle"
          aria-label="Toggle trade panel"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>Panel</span>
        </button>
        <button className="settings-trigger" aria-label="App settings" onClick={openSettings}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m9.4 3-.5 2-1.5.9-2-.6-2.6 4.4 1.5 1.4v1.8l-1.5 1.4 2.6 4.4 2-.6 1.5.9.5 2h5.2l.5-2 1.5-.9 2 .6 2.6-4.4-1.5-1.4v-1.8l1.5-1.4-2.6-4.4-2 .6-1.5-.9-.5-2Z" />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
        </button>
      </div>
    </header>
  );
}

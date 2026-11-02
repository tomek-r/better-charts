import type { ButtonHTMLAttributes, ComponentType } from 'react';
import './settings-nav.css';

/** One row of a settings dialog's left column: the tab it opens, the title beside it and the icon before it. */
export interface SettingsNavTab<Id extends string = string> {
  readonly id: Id;
  readonly title: string;
  readonly Icon: ComponentType;
}

/** How a nav reports its current row: a settings page, or the tab whose panel is open beside it. */
type SettingsNavSelection = { readonly kind: 'page' } | { readonly kind: 'tabs'; readonly panelId: string };

/** The id a tab row is given, which the panel it controls names back in its `aria-labelledby`. */
export function settingsNavTabId(panelId: string, tabId: string): string {
  return `${panelId}-tab-${tabId}`;
}

/** What marks a row as current: `aria-current` names a page, a tab names the panel it controls. */
function rowState(
  tabId: string,
  selected: boolean,
  selection: SettingsNavSelection,
): ButtonHTMLAttributes<HTMLButtonElement> {
  if (selection.kind === 'page') {
    return { 'aria-current': selected ? 'page' : undefined };
  }
  return {
    role: 'tab',
    id: settingsNavTabId(selection.panelId, tabId),
    'aria-controls': selection.panelId,
    'aria-selected': selected,
  };
}

interface SettingsNavProps<Id extends string> {
  /** The accessible name of the column, e.g. "Chart settings". */
  readonly label: string;
  readonly selection: SettingsNavSelection;
  readonly tabs: readonly SettingsNavTab<Id>[];
  readonly selectedId: Id;
  readonly onSelect: (id: Id) => void;
}

/**
 * The left column both settings dialogs draw: one row per tab, the current row marked with the accent
 * border, the accent-tinted fill and the accent text. A nav of pages is a landmark; a nav of tabs is the
 * tab list of the panel beside it, so each row carries the id that panel points back to.
 */
export function SettingsNav<Id extends string>({ label, selection, tabs, selectedId, onSelect }: SettingsNavProps<Id>) {
  const rows = tabs.map(({ id, title, Icon }) => (
    <button key={id} type="button" onClick={() => onSelect(id)} {...rowState(id, id === selectedId, selection)}>
      <span className="settings-nav-icon" aria-hidden="true">
        <Icon />
      </span>
      {title}
    </button>
  ));
  if (selection.kind === 'tabs') {
    return (
      <div className="settings-nav" role="tablist" aria-label={label} aria-orientation="vertical">
        {rows}
      </div>
    );
  }
  return (
    <nav className="settings-nav" aria-label={label}>
      {rows}
    </nav>
  );
}

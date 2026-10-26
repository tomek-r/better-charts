import { useId, type KeyboardEvent } from 'react';
import type { SettingsPanelProps, SettingsTab } from './settingsTabModel';

/** Arrow keys step between tabs and wrap around; Home and End jump to the ends (WAI-ARIA tabs pattern). */
const TAB_KEY_STEPS: Readonly<Partial<Record<string, number>>> = { ArrowRight: 1, ArrowLeft: -1 };

/** The tab the key lands on, or undefined when the key is not a tab key. */
function targetTabIndex(key: string, current: number, count: number): number | undefined {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }
  const step = TAB_KEY_STEPS[key];
  return step === undefined ? undefined : (current + step + count) % count;
}

interface SettingsTabsProps extends SettingsPanelProps {
  readonly tabs: readonly SettingsTab[];
  /** The open tab; the first tab while it is undefined or names no tab. The owner can switch tabs too. */
  readonly selectedId: string | undefined;
  readonly onSelect: (tabId: string) => void;
}

/**
 * The tablist and the panel of the selected tab. Selection follows focus, so an arrow key both moves
 * to and opens the next tab; only the selected tab sits in the tab order.
 */
export function SettingsTabs({ tabs, values, onChange, coordinates, selectedId, onSelect }: SettingsTabsProps) {
  const idPrefix = useId();
  const selected = tabs.find((tab) => tab.id === selectedId) ?? tabs[0];

  const moveWithKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = targetTabIndex(event.key, tabs.indexOf(selected), tabs.length);
    if (index === undefined) {
      return;
    }
    event.preventDefault();
    onSelect(tabs[index].id);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[index].focus();
  };

  return (
    <>
      <div className="drawing-settings-tabs" role="tablist" aria-label="Drawing settings" onKeyDown={moveWithKey}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            className="drawing-settings-tab"
            type="button"
            role="tab"
            aria-selected={tab === selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={tab === selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div
        id={`${idPrefix}-panel`}
        className="drawing-settings-panel"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${selected.id}`}
      >
        {selected.render({ values, onChange, coordinates })}
      </div>
    </>
  );
}

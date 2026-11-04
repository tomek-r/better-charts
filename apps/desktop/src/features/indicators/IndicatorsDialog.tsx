import { useRef, useState } from 'react';
import { ModalDialog, ModalDialogCloseButton } from '../../shared/ui/dialog/ModalDialog';
import { matchingIndicators } from './indicatorSearch';
import { CHART_INDICATOR_PLUGINS, type RegisteredChartIndicatorPlugin } from './registry';

const DIALOG_TITLE = 'Indicators';
const DIALOG_CLASS_NAME = 'indicators-dialog';
const CLOSE_LABEL = 'Close indicators';
const SEARCH_LABEL = 'Search indicators';
const SEARCH_PLACEHOLDER = 'Search';
const LIST_LABEL = 'Indicators';
const EMPTY_TEXT = 'No indicators found.';

/**
 * The list of registered indicators behind a search field; choosing one hands it to the caller, which
 * attaches it and closes the dialog.
 */
export function IndicatorsDialog({
  onChoose,
  onDismiss,
}: {
  onChoose: (plugin: RegisteredChartIndicatorPlugin) => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const matches = matchingIndicators(CHART_INDICATOR_PLUGINS, query);

  const chooseFirstMatch = () => {
    const [first] = matches;
    if (first) {
      onChoose(first);
    }
  };

  return (
    <ModalDialog
      title={DIALOG_TITLE}
      className={DIALOG_CLASS_NAME}
      headerActions={<ModalDialogCloseButton label={CLOSE_LABEL} onClick={onDismiss} />}
      initialFocusRef={searchRef}
      onDismiss={onDismiss}
    >
      <input
        ref={searchRef}
        type="search"
        className="indicators-dialog-search"
        aria-label={SEARCH_LABEL}
        placeholder={SEARCH_PLACEHOLDER}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            chooseFirstMatch();
          }
        }}
      />
      {matches.length === 0 ? (
        <p className="indicators-dialog-empty" role="status">
          {EMPTY_TEXT}
        </p>
      ) : (
        <ul className="indicators-dialog-list" aria-label={LIST_LABEL}>
          {matches.map((plugin) => (
            <li key={plugin.id}>
              <button type="button" className="indicators-dialog-row" onClick={() => onChoose(plugin)}>
                {plugin.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalDialog>
  );
}

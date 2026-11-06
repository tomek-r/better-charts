import { useRef, useState } from 'react';
import { ModalDialog, ModalDialogCloseButton } from '../../shared/ui/dialog/ModalDialog';
import { useModalExit } from '../../shared/ui/dialog/useModalExit';
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
 * attaches it, and the dialog then leaves with the exit animation. Escape, the × and a backdrop click
 * close it without choosing.
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
  const { backdropRef, closing, close } = useModalExit(onDismiss);
  const matches = matchingIndicators(CHART_INDICATOR_PLUGINS, query);

  const choose = (plugin: RegisteredChartIndicatorPlugin) => {
    if (closing) {
      // The dialog is already leaving: a press that arrives during the exit is a second press, not a choice.
      return;
    }
    onChoose(plugin);
    close();
  };

  const chooseFirstMatch = () => {
    const [first] = matches;
    if (first) {
      choose(first);
    }
  };

  return (
    <ModalDialog
      title={DIALOG_TITLE}
      className={DIALOG_CLASS_NAME}
      backdropClassName="drawing-settings-backdrop"
      backdropRef={backdropRef}
      closing={closing}
      headerActions={<ModalDialogCloseButton label={CLOSE_LABEL} onClick={close} />}
      initialFocusRef={searchRef}
      onDismiss={close}
    >
      <input
        ref={searchRef}
        type="search"
        className="indicators-dialog-search"
        aria-label={SEARCH_LABEL}
        placeholder={SEARCH_PLACEHOLDER}
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
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
              <button type="button" className="indicators-dialog-row" onClick={() => choose(plugin)}>
                {plugin.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalDialog>
  );
}

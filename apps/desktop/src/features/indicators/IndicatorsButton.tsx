import { useState } from 'react';
import { IndicatorsDialog } from './IndicatorsDialog';
import { IndicatorsIcon } from './IndicatorsIcon';
import { useAttachIndicator } from './useAttachIndicator';
import './indicators.css';

/** The chart header's Indicators button and the dialog of indicators it opens. */
export function IndicatorsButton() {
  const [open, setOpen] = useState(false);
  const attach = useAttachIndicator();

  return (
    <>
      <button
        type="button"
        className="chart-header-button indicators-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <IndicatorsIcon className="indicators-trigger-icon" />
        <span>Indicators</span>
      </button>
      {open && (
        <IndicatorsDialog
          onChoose={(plugin) => {
            attach(plugin);
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </>
  );
}

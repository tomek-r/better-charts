import { targetKey, type InstallTarget } from './installTargets';

/** The data folder the install writes into: plain text for one, a select when there is a choice. */
export function DataFolderChoice({
  targets,
  selected,
  disabled,
  onChoose,
}: {
  targets: InstallTarget[];
  selected: InstallTarget;
  disabled: boolean;
  onChoose: (key: string) => void;
}) {
  if (targets.length === 1) {
    return (
      <p className="setup-guide-install-target">
        {selected.label}: <code>{selected.mql5Path}</code>
      </p>
    );
  }
  return (
    <label className="setup-guide-install-field">
      MetaTrader 5 data folder
      <select value={targetKey(selected)} disabled={disabled} onChange={(event) => onChoose(event.target.value)}>
        {targets.map((target) => (
          <option key={targetKey(target)} value={targetKey(target)}>
            {target.label}: {target.mql5Path}
          </option>
        ))}
      </select>
    </label>
  );
}

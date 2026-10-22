import { installationFolder, targetKey, type InstallTarget } from './installTargets';

/** The two MQL5 folder layouts named the way a user knows them, never by path. */
const LAYOUT_NAMES: Record<InstallTarget['layout'], string> = {
  portable: 'portable data folder',
  standard: 'user data folder',
};

/** The folder the installation lives in, so the user can tell two installations apart by where they sit. */
function InstallationFolder({ target }: { target: InstallTarget }) {
  return <p className="setup-guide-install-target">MetaTrader 5 folder: {installationFolder(target.terminalPath)}</p>;
}

/** Where the install writes, named by the folder the chosen installation lives in. */
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
    return <InstallationFolder target={selected} />;
  }
  return (
    <>
      <label className="setup-guide-install-field">
        MetaTrader 5 data folder
        <select value={targetKey(selected)} disabled={disabled} onChange={(event) => onChoose(event.target.value)}>
          {targets.map((target) => (
            <option key={targetKey(target)} value={targetKey(target)}>
              {target.label} — {LAYOUT_NAMES[target.layout]}
            </option>
          ))}
        </select>
      </label>
      <InstallationFolder target={selected} />
    </>
  );
}

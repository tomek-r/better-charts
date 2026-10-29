import { useId } from 'react';
import { Select, type SelectOption } from '../../../../../shared/ui/select/Select';
import { installationFolder, targetKey, type InstallTarget } from './installTargets';

/** The two MQL5 folder layouts named the way a user knows them, never by path. */
const LAYOUT_NAMES: Record<InstallTarget['layout'], string> = {
  portable: 'portable data folder',
  standard: 'user data folder',
};

/** The folder the installation lives in, so the user can tell two installations apart by where they sit. */
function InstallationFolder({ target }: { target: InstallTarget }) {
  return (
    <p className="setup-guide-install-target">
      MetaTrader 5 folder: <span className="setup-guide-install-path">{installationFolder(target.terminalPath)}</span>
    </p>
  );
}

function folderOption(target: InstallTarget): SelectOption {
  return { value: targetKey(target), label: `${target.label} — ${LAYOUT_NAMES[target.layout]}` };
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
  const fieldId = useId();
  if (targets.length === 1) {
    return <InstallationFolder target={selected} />;
  }
  return (
    <>
      <div className="setup-guide-install-field">
        <label htmlFor={fieldId}>MetaTrader 5 data folder</label>
        <Select
          id={fieldId}
          options={targets.map(folderOption)}
          value={targetKey(selected)}
          disabled={disabled}
          onChange={onChoose}
        />
      </div>
      <InstallationFolder target={selected} />
    </>
  );
}

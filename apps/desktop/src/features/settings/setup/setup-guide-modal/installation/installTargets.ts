import type { Mt5DataFolderView, Mt5InstallationView } from '../../../../../shared/bridge/types';

/** One installation paired with one of its data folders: exactly what an install request names. */
export interface InstallTarget {
  terminalPath: string;
  label: string;
  layout: Mt5DataFolderView['layout'];
  mql5Path: string;
}

/** Every installation × data folder pair, in the order the backend listed them. */
export function installTargets(installations: Mt5InstallationView[]): InstallTarget[] {
  return installations.flatMap(({ terminalPath, label, dataFolders }) =>
    dataFolders.map((folder) => ({ terminalPath, label, layout: folder.layout, mql5Path: folder.mql5Path })),
  );
}

/** Identifies one target in the folder select; a path holds no line break, so the join is unambiguous. */
export function targetKey(target: InstallTarget): string {
  return `${target.terminalPath}\n${target.mql5Path}`;
}

/** Where the installation lives: the folder holding `terminal64.exe`. */
export function installationFolder(terminalPath: string): string {
  const lastSeparator = Math.max(terminalPath.lastIndexOf('\\'), terminalPath.lastIndexOf('/'));
  if (lastSeparator === -1) {
    return terminalPath;
  }
  return terminalPath.slice(0, lastSeparator);
}

/** The target the folder select currently names, or the first one the backend listed. */
export function chooseTarget(targets: InstallTarget[], selectedKey: string | undefined): InstallTarget | undefined {
  return targets.find((target) => targetKey(target) === selectedKey) ?? targets[0];
}

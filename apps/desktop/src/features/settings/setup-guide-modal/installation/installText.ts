import type {
  Mt5CompiledView,
  Mt5FileReport,
  Mt5InstallFile,
  Mt5InstallOutcome,
} from '../../../../shared/bridge/types';

/** The `.mq5` file each report entry names, as it appears in the MT5 folders. */
export const FILE_NAMES: Record<Mt5InstallFile, string> = {
  expertAdvisor: 'BetterChartsBridge.mq5',
  indicator: 'BetterChartsTickHistoryReader.mq5',
};

/** What the install step did, in the words the result row shows. */
export const OUTCOME_WORDS: Record<Mt5InstallOutcome, string> = {
  installed: 'Installed',
  updated: 'Updated',
  unchanged: 'Already up to date',
};

/** Discovery found nothing: the guide then offers the folder picker and the manual steps. */
export const MT5_NOT_FOUND_TEXT = 'MetaTrader 5 was not found. Use Choose folder… or the manual steps.';

/** The pressed button's label while the install runs; the other button keeps its own. */
export const INSTALLING_TEXT = 'Installing…';

/** The restart button's label once every file compiled clean and MT5 is reopening. */
export const RESTARTING_TEXT = 'Restarting MT5…';

/** Counted noun with its plural, so a compile line reads "1 error" and "2 errors". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** MetaEditor's summary for one file; a file the run never reached has no result to show. */
export function compileText(compiled: Mt5CompiledView | null): string {
  if (!compiled) {
    return 'Not compiled: the indicator has errors';
  }
  if (compiled.errors === 0 && compiled.warnings === 0) {
    return 'Compiled, 0 errors';
  }
  return `${counted(compiled.errors, 'error')}, ${counted(compiled.warnings, 'warning')}`;
}

/** Every file compiled clean: no errors and no warnings left to fix in MetaEditor. */
export function everyFileCompiledClean(files: Mt5FileReport[]): boolean {
  return (
    files.length > 0 &&
    files.every((file) => file.compiled !== null && file.compiled.errors === 0 && file.compiled.warnings === 0)
  );
}

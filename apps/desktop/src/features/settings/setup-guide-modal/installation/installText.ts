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

/** Discovery found nothing: the manual steps below are then the only route. */
export const MT5_NOT_FOUND_TEXT = 'MetaTrader 5 was not found on this computer. Use the manual steps below.';

/** The words of a done line that open the restart confirmation; the line's one clickable part. */
export const RESTART_PHRASE = 'restart MT5 with the EA attached';

/**
 * A done line that ends on the restart phrase, so a line can never drift from the
 * words it turns into a button.
 */
function restartLine(lead: string): string {
  return `${lead}${RESTART_PHRASE}.`;
}

/** A first install leaves the EA off every chart, so the success line names both routes to a connection. */
const FIRST_INSTALL_DONE_TEXT = restartLine(
  'Installed and compiled. Drag BetterChartsBridge onto a chart in MT5 and enter the token, or ',
);

/** An updated EA that a live bridge is attached to: MT5 reloads it and the link returns by itself. */
const RECONNECT_DONE_TEXT = 'Installed and compiled. MT5 reloads the EA and the bridge reconnects.';

/** An updated EA with no bridge: nothing reloads it, so the user has to reattach it. */
const REATTACH_DONE_TEXT = restartLine('Installed and compiled. Reattach BetterChartsBridge in MT5. Or ');

/** Asked before anything closes: the restart takes MT5 down, so it never starts on a single click. */
export const RESTART_CONFIRM_TEXT = 'MT5 will close and reopen with the EA attached.';

/** The restart is under way and the dialog can do nothing else until the backend answers. */
export const RESTART_RUNNING_TEXT = 'Restarting MT5…';

/** The restart succeeded. Algo Trading is the terminal's own switch, so it stays with the user. */
export const RESTART_DONE_TEXT = 'MT5 is restarting with the EA attached. Enable Algo Trading in MT5 if it is off.';

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

/** What each file became, as the success line's tooltip spells it out. */
export function outcomeSummary(files: Mt5FileReport[]): string {
  return files.map((file) => `${FILE_NAMES[file.file]} ${OUTCOME_WORDS[file.outcome].toLowerCase()}`).join(', ');
}

/**
 * The success line of a clean report, from what happened to the EA and whether a
 * bridge was connected when Install was pressed: a first install has no attached EA
 * to reload, and an update only comes back by itself while a bridge is live.
 */
export function installDoneText(files: Mt5FileReport[], bridgeConnected: boolean): string {
  if (files.some((file) => file.file === 'expertAdvisor' && file.outcome === 'installed')) {
    return FIRST_INSTALL_DONE_TEXT;
  }
  return bridgeConnected ? RECONNECT_DONE_TEXT : REATTACH_DONE_TEXT;
}

/**
 * A done line split around its restart phrase: `lead` and `trail` stay plain text.
 * The reconnect line has no phrase, so it has nothing to click and stays text only.
 */
export function splitAtRestartPhrase(text: string): { lead: string; trail: string } | undefined {
  const at = text.indexOf(RESTART_PHRASE);
  return at === -1 ? undefined : { lead: text.slice(0, at), trail: text.slice(at + RESTART_PHRASE.length) };
}

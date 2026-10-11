import type { CommandUpdate } from '../../shared/bridge/types';

/**
 * Actionable advice per MT5 trade return code (MQL5 docs, "Trade Server Return
 * Codes"). Only codes a trader can act on are listed; everything else shows the
 * EA's own message untouched rather than an invented explanation.
 */
const RETCODE_HINTS: Readonly<Record<number, string>> = {
  10004: 'The price moved before the broker could fill; try again.',
  10006: 'The broker rejected the request.',
  10013: 'The broker considers the request invalid.',
  10014: 'The volume is invalid for this symbol.',
  10016:
    "SL/TP is too close to the current price or on the wrong side. Move it further away (the broker's minimum distance applies).",
  10018: 'The market is closed.',
  10019: 'Not enough free margin.',
  10021: 'There are no quotes to process the request.',
  10025: 'Nothing to change: the level is already set.',
  10026: 'The broker has disabled automated trading for this account.',
  10027: 'Enable Algo Trading in MetaTrader 5.',
  10029: "Price is within the broker's freeze level; SL/TP can't be changed this close to the market.",
  10044: 'The broker allows only closing positions right now.',
};

type RejectionFields = Pick<CommandUpdate, 'retcode' | 'message'>;

/** Sentence shown when a command is rejected; the EA message plus a hint for known retcodes. */
export function describeRejection({ retcode, message }: RejectionFields): string {
  const reported = message?.trim() || `Order rejected by MT5 (code ${retcode ?? 'unknown'}).`;
  const hint = retcode == null ? undefined : RETCODE_HINTS[retcode];
  return hint ? `${reported} ${hint}` : reported;
}

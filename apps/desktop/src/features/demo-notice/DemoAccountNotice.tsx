import { isSimulatedEnvironment } from '../account-badge/accountEnvironment';
import { useAccountEnvironment } from '../account-badge/useAccountEnvironment';

/**
 * What the strip says, in reading order. The sentences are spaced, never separated by a glyph, so the
 * text carries no punctuation the reader has to interpret.
 */
const NOTICE_SENTENCES = [
  'Demo account. No real money is involved.',
  "Orders here use your broker's demo funds.",
  'Switch to a real account in MT5 to trade live.',
];

/**
 * Marquee notice along the bottom edge of the top bar while the connected account is a demo (or
 * contest) account. It states which environment the account runs in, so the kind comes from the same
 * source as the top-bar badge and the two can never disagree. A real account, and a bridge without
 * an account (disconnected), show nothing.
 */
export function DemoAccountNotice() {
  const environment = useAccountEnvironment();
  if (!isSimulatedEnvironment(environment?.kind)) {
    return null;
  }
  // The strip is absolutely positioned against the bar (demo-notice.css), so arriving with the first
  // account snapshot moves neither the bar's own items nor the chart below it.
  return (
    <div className="demo-notice">
      {/* Assistive tech reads the sentences once; the scrolling copy beside it is decoration. The
          `demo-notice-readable` class names this copy for the marquee test, which reads its text. */}
      <span className="demo-notice-readable visually-hidden">{NOTICE_SENTENCES.join(' ')}</span>
      <span className="demo-notice-text" aria-hidden="true">
        {NOTICE_SENTENCES.map((sentence) => (
          <span key={sentence} className="demo-notice-sentence">
            {sentence}
          </span>
        ))}
      </span>
    </div>
  );
}

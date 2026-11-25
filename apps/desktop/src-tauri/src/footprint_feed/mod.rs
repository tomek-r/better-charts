//! The trades behind a footprint: the wire's ticks of each loaded bar, the newest-first read that
//! fills them, and the live re-read of the forming bar.
//!
//! A bar's prices carry no trades, so a footprint can only answer from the raw ticks inside the bar.
//! The read asks for them over the desktop's indicator ticks route (no wire change), newest bar
//! first, and stops once the oldest loaded bar is covered or the tick budget is spent. A bar's
//! footprint is either computed from all of its ticks or not at all: a bar is kept only when every
//! page covering it, from its open through its end, held its whole range, and a bar a read stopped
//! inside keeps no ticks and reads as `na`, as the bars the read never reached do.
//!
//! The forming bar's ticks come from MT5's tick history too, never from the sampled quotes: an
//! accepted quote of the chart symbol re-reads them to the broker's time, at most once per
//! [`FORMING_REREAD_INTERVAL`], and the bar the chart leaves behind is read once more to its own end,
//! which is what makes it complete. A read starts at the bar's open, and once a whole one has covered
//! the bar up to a millisecond M, the next asks only from M — M included, because MT5 may still add
//! ticks to it — and its whole answer replaces the bar's ticks from M on, so the ticks before M are
//! never read again nor counted twice. A read that does not come back whole drops the bar's ticks and
//! the one after starts at the bar's open again.

use rust_decimal::Decimal;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};
use trading_core::footprint::FootprintTick;
use trading_core::protocol::{MarketCandle, MarketTick};

/// Most ticks one footprint read keeps. A deeper read costs the EA's reader one page at a time, and a
/// footprint's history is limited to the recent bars too; the bars beyond the budget read `na`.
pub(crate) const FOOTPRINT_TICK_BUDGET: usize = 500_000;
/// Shortest interval between two live re-reads of the forming bar. Quotes arrive far more often than
/// a bar's tick history needs reading again, and every re-read costs the EA a tick page.
pub(crate) const FORMING_REREAD_INTERVAL: Duration = Duration::from_millis(1_000);
/// Bars one page asks for first. The read doubles it while a page fits and halves it when one holds
/// too many ticks, so a sparse window costs few pages and a dense one stays within the EA's page.
const FIRST_PAGE_BARS: usize = 1;
/// Shortest span a bar can have. A page asks for a range that ends after it starts, and a tick falls
/// in the millisecond it carries.
const MINIMUM_BAR_SPAN_MS: i64 = 1;

/// One bar of a footprint read: when it opened, and when the bar after it did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BarSpan {
    pub(crate) open_ms: i64,
    pub(crate) end_ms: i64,
}

/// The bars of `candles` as a footprint read sees them, oldest first. The newest bar is still forming,
/// so its end is `read_end_ms` when that is later: the read then reaches the ticks of the bar in
/// progress.
pub(crate) fn footprint_window(candles: &[MarketCandle], read_end_ms: i64) -> Vec<BarSpan> {
    let mut window = Vec::with_capacity(candles.len());
    for (index, candle) in candles.iter().enumerate() {
        let following_open = candles.get(index + 1).map(|next| next.time_ms);
        let end_ms = following_open.unwrap_or(read_end_ms);
        window.push(BarSpan {
            open_ms: candle.time_ms,
            end_ms: end_ms.max(candle.time_ms + MINIMUM_BAR_SPAN_MS),
        });
    }
    window
}

/// The bars the quote path follows: the chart's forming bar, whose read runs to the broker's time, and
/// the bar before it, whose read ends where the forming bar opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FormingBars {
    pub(crate) forming: BarSpan,
    /// The bar the chart's window holds just before the forming one, if the window has one.
    pub(crate) closed: Option<BarSpan>,
}

/// The last two bars of `candles` as the quote path follows them; `None` when the window is empty.
pub(crate) fn forming_bars(candles: &[MarketCandle], read_end_ms: i64) -> Option<FormingBars> {
    let tail = footprint_window(candles.get(candles.len().saturating_sub(2)..)?, read_end_ms);
    let forming = *tail.last()?;
    let closed = tail.first().filter(|_| tail.len() == 2).copied();
    Some(FormingBars { forming, closed })
}

/// The trades of each bar of `bars`, keyed by the bar's opening time. A tick belongs to the bar whose
/// `[open, next open)` holds its time; the newest bar is open-ended, and a tick before the first bar
/// belongs to no bar of the window and is dropped.
pub(crate) fn group_ticks(
    ticks: &[MarketTick],
    bars: &[BarSpan],
) -> BTreeMap<i64, Vec<FootprintTick>> {
    let mut by_bar: BTreeMap<i64, Vec<FootprintTick>> = BTreeMap::new();
    for tick in ticks {
        let (Some(index), Some(trade)) = (bar_of(bars, tick.time_ms), to_trade_tick(tick)) else {
            continue;
        };
        by_bar.entry(bars[index].open_ms).or_default().push(trade);
    }
    by_bar
}

/// The index of the bar whose `[open, next open)` holds `time_ms`, or `None` before the first bar.
fn bar_of(bars: &[BarSpan], time_ms: i64) -> Option<usize> {
    bars.partition_point(|bar| bar.open_ms <= time_ms)
        .checked_sub(1)
}

/// One wire tick as a footprint trade: the price it moved at, the volume it moved and the side its
/// flags name. `None` when the wire names no positive price to trade at.
pub(crate) fn to_trade_tick(tick: &MarketTick) -> Option<FootprintTick> {
    Some(FootprintTick::from_flags(
        tick.time_ms,
        traded_price(tick)?,
        traded_volume(tick),
        tick.flags,
    ))
}

/// The price the tick traded at: the last price when the broker reports one, the bid otherwise.
fn traded_price(tick: &MarketTick) -> Option<Decimal> {
    positive_decimal(&tick.last).or_else(|| positive_decimal(&tick.bid))
}

/// The volume the tick moved: the real volume when the symbol reports one, the tick count otherwise,
/// which is all a forex tick carries. `0` means "no volume", which the footprint counts as one trade.
fn traded_volume(tick: &MarketTick) -> Decimal {
    positive_decimal(&tick.volume_real).unwrap_or_else(|| Decimal::from(tick.volume))
}

/// `value` as a decimal above zero; `None` when the wire text is not one.
fn positive_decimal(value: &str) -> Option<Decimal> {
    let decimal = value.parse::<Decimal>().ok()?;
    (decimal > Decimal::ZERO).then_some(decimal)
}

/// One page of a footprint read: the bars it covers, and the ticks it may bring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TickPage {
    /// The first bar the page covers; its range starts at that bar's opening time.
    pub(crate) first_bar: usize,
    pub(crate) from_ms: i64,
    pub(crate) to_ms: i64,
    pub(crate) max_ticks: u32,
}

/// What one page answered with: its ticks, and whether it held the whole range it was asked for.
#[derive(Debug, Clone, Copy)]
pub(crate) struct PageAnswer<'a> {
    pub(crate) ticks: &'a [MarketTick],
    pub(crate) complete: bool,
}

/// What a finished footprint read kept: the ticks of the bars it took whole, and the one bar it
/// stopped inside, whose ticks are dropped.
pub(crate) struct FootprintRead {
    /// The ticks of each bar the read took whole, keyed by the bar's opening time.
    pub(crate) ticks: BTreeMap<i64, Vec<FootprintTick>>,
    /// The bar the read stopped inside, if it stopped in one.
    pub(crate) incomplete: Option<i64>,
}

/// The ticks of one window, read from the newest bar back, a page at a time.
///
/// A page answers with the oldest ticks of the range it asked for, so only a page that held its whole
/// range can be used: the read asks for fewer bars when one holds too many, then walks back from the
/// newest bar until the oldest is covered or the tick budget is spent.
pub(crate) struct FootprintTicks {
    bars: Vec<BarSpan>,
    ticks_by_bar: BTreeMap<i64, Vec<FootprintTick>>,
    /// Where the next page of a bar that did not fit in one page starts; `None` when no bar is half
    /// read.
    within_from_ms: Option<i64>,
    /// The bar the read stopped inside: it holds ticks no page returned, so it keeps none.
    stopped_in: Option<i64>,
    /// Bars `[unread_from ..]` are read whole.
    unread_from: usize,
    /// How many bars one page asks for.
    page_bars: usize,
    read_ticks: usize,
    tick_budget: usize,
    /// The page the read waits for, once it asked for one.
    awaiting: Option<TickPage>,
}

impl FootprintTicks {
    /// A read of `bars`, or `None` when there is nothing to read.
    pub(crate) fn new(bars: Vec<BarSpan>, tick_budget: usize) -> Option<Self> {
        if bars.is_empty() || tick_budget == 0 {
            return None;
        }
        let unread_from = bars.len();
        Some(Self {
            unread_from,
            bars,
            ticks_by_bar: BTreeMap::new(),
            within_from_ms: None,
            stopped_in: None,
            page_bars: FIRST_PAGE_BARS,
            read_ticks: 0,
            tick_budget,
            awaiting: None,
        })
    }

    /// The page to ask the EA for next: the newest bars no page has answered yet, within the ticks the
    /// budget has left. `None` once the window is covered, the budget is spent, or a bar stopped the
    /// read inside itself.
    pub(crate) fn next_page(&mut self, page_bound: u32) -> Option<TickPage> {
        self.awaiting = self.planned_page(page_bound);
        if self.awaiting.is_none() {
            self.end_inside_a_bar();
        }
        self.awaiting
    }

    /// Folds the answer to the awaited page in. A page that did not hold its whole range is only
    /// usable while it pages through a single bar, where the ticks it returned are that bar's first
    /// ones. The answer is validated against the page it answers, so it never brings more ticks than
    /// the page asked for.
    pub(crate) fn accept(&mut self, answer: PageAnswer<'_>) {
        let Some(page) = self.awaiting.take() else {
            return;
        };
        let ticks = answer.ticks;
        if answer.complete || ticks.is_empty() {
            self.read_page(page, ticks);
            return;
        }
        if page.first_bar + 1 != self.unread_from {
            // The range held more ticks than a page, so the answer covers only its oldest bars and
            // none of them borders the bars already read. Ask for fewer bars instead.
            self.page_bars = self.halved_page_bars();
            return;
        }
        match resumed_after(ticks, page.from_ms) {
            Some(resumes_at) => {
                // The bar holds more ticks than a page: keep what came before its last millisecond,
                // which the next page asks for again.
                self.keep_before_last_millisecond(ticks);
                self.within_from_ms = Some(resumes_at);
            }
            // A single millisecond holds more ticks than a page, so no page can carry the rest of
            // this bar: it is not read whole.
            None => self.stop_in_paging_bar(),
        }
    }

    /// Ends the read here and answers what it kept: a bar it was paging through when a page could not
    /// carry its rest, the budget ran out or the EA stopped answering keeps no ticks.
    pub(crate) fn finish(mut self) -> FootprintRead {
        self.end_inside_a_bar();
        let mut ticks = self.ticks_by_bar;
        if let Some(open_ms) = self.stopped_in {
            ticks.remove(&open_ms);
        }
        FootprintRead {
            ticks,
            incomplete: self.stopped_in,
        }
    }

    /// The page the read would ask for, without remembering it.
    fn planned_page(&self, page_bound: u32) -> Option<TickPage> {
        if self.unread_from == 0 || self.stopped_in.is_some() {
            return None;
        }
        let remaining = self.tick_budget.checked_sub(self.read_ticks)?;
        if remaining == 0 {
            return None;
        }
        let max_ticks = page_bound.min(u32::try_from(remaining).unwrap_or(u32::MAX));
        let end_bar = *self.bars.get(self.unread_from - 1)?;
        let (first_bar, from_ms) = match self.within_from_ms {
            Some(from_ms) => (self.unread_from - 1, from_ms),
            None => {
                let first_bar = self.unread_from.saturating_sub(self.page_bars);
                (first_bar, self.bars.get(first_bar)?.open_ms)
            }
        };
        Some(TickPage {
            first_bar,
            from_ms,
            to_ms: end_bar.end_ms,
            max_ticks,
        })
    }

    /// Keeps the page's ticks and marks its bars read.
    fn read_page(&mut self, page: TickPage, ticks: &[MarketTick]) {
        self.keep(ticks);
        self.unread_from = page.first_bar;
        self.within_from_ms = None;
        self.page_bars = self.doubled_page_bars();
    }

    /// Groups `ticks` into their bars and keeps them.
    fn keep(&mut self, ticks: &[MarketTick]) {
        for (open_ms, trades) in group_ticks(ticks, &self.bars) {
            self.ticks_by_bar.entry(open_ms).or_default().extend(trades);
        }
        self.read_ticks += ticks.len();
    }

    /// Keeps the ticks of `ticks` before its last millisecond, which the next page asks for again, and
    /// counts every tick the page returned against the budget.
    fn keep_before_last_millisecond(&mut self, ticks: &[MarketTick]) {
        let kept = ticks_before_last_millisecond(ticks);
        self.keep(kept);
        self.read_ticks += ticks.len() - kept.len();
    }

    /// The bar the read pages through: the newest bar no page has taken whole yet.
    fn paging_bar(&self) -> Option<i64> {
        self.bars
            .get(self.unread_from.checked_sub(1)?)
            .map(|bar| bar.open_ms)
    }

    /// A read that ends while it pages through one bar stopped inside it: that bar holds ticks no page
    /// returned.
    fn end_inside_a_bar(&mut self) {
        if self.within_from_ms.is_none() {
            return;
        }
        self.stop_in_paging_bar();
    }

    /// Stops the read in the bar it pages through: the bar keeps none of the ticks read so far.
    fn stop_in_paging_bar(&mut self) {
        self.within_from_ms = None;
        self.stopped_in = self.paging_bar();
    }

    /// How many bars the page after a page that fitted asks for.
    fn doubled_page_bars(&self) -> usize {
        (self.page_bars * 2)
            .min(self.bars.len())
            .max(FIRST_PAGE_BARS)
    }

    /// How many bars the page after a page that held too many ticks asks for.
    fn halved_page_bars(&self) -> usize {
        (self.page_bars / 2).max(FIRST_PAGE_BARS)
    }
}

/// The millisecond the next page of a half-read bar resumes at: the last tick's, which the page did
/// not hold whole. `None` when the page cannot move on, because every tick it returned sits in the
/// millisecond the page started at.
fn resumed_after(ticks: &[MarketTick], from_ms: i64) -> Option<i64> {
    ticks
        .last()
        .map(|tick| tick.time_ms)
        .filter(|last| *last > from_ms)
}

/// `ticks` without the ones of the last millisecond they carry, which the next page asks for again.
fn ticks_before_last_millisecond(ticks: &[MarketTick]) -> &[MarketTick] {
    let Some(last_ms) = ticks.last().map(|tick| tick.time_ms) else {
        return ticks;
    };
    let kept = ticks.partition_point(|tick| tick.time_ms < last_ms);
    ticks.split_at(kept).0
}

/// What one answered page left to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PageOutcome {
    /// The page to ask the EA for next.
    Next(TickPage),
    /// The read is covered, spent or stopped: the observer hears the ticks.
    Finished,
    /// The read was dropped before this page arrived, because the chart changed.
    Idle,
}

/// What one accepted quote changed in the feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FormingStep {
    /// The page the live read asks the EA for, if any.
    pub(crate) page: Option<TickPage>,
    /// Whether ticks left the readable set without a read finishing: the observer must recompute now,
    /// or it would keep a bar that stopped being read whole.
    pub(crate) ticks_dropped: bool,
}

impl FormingStep {
    /// A quote that changed nothing.
    const NOTHING: Self = Self {
        page: None,
        ticks_dropped: false,
    };
}

/// One live read: a single bar, read over the window read's own machinery from its open, or from the
/// last millisecond a whole read of it reached, to the end this read goes to.
struct LiveRead {
    /// The bar being read, with the end this read goes to.
    span: BarSpan,
    /// Whether this read finishes the bar the chart left instead of following the forming one.
    closing: bool,
    /// Where an incremental read asks from; `None` for a read of the whole bar from its open.
    resume: Option<ResumePoint>,
    /// The pages of this read, over the bar's span or over the range `resume` names.
    read: FootprintTicks,
}

/// Where an incremental live read starts, and what the whole read before it keeps.
struct ResumePoint {
    /// The last millisecond a whole read of the bar reached, which the page asks for again: MT5 may
    /// still add ticks to it, so it is never kept as it is.
    from_ms: i64,
    /// The ticks of that whole read before `from_ms`, which the page's ticks are added to.
    kept_before: Vec<FootprintTick>,
}

/// What a finished live read answered for its bar.
struct LiveKept {
    /// The bar the read was of.
    open_ms: i64,
    /// Whether the read was the last one of the bar the chart left.
    closing: bool,
    /// Whether the read stopped inside the bar, so it never held its whole range.
    incomplete: bool,
    /// The bar's ticks the read kept.
    ticks: Vec<FootprintTick>,
}

impl LiveRead {
    /// A read of `span` alone from its open; `None` when a one-bar read is not a window to read.
    fn new(span: BarSpan, closing: bool) -> Option<Self> {
        Self::build(span, closing, None)
    }

    /// A read of `span` from `from_ms`, the millisecond a whole read of the bar reached, added to the
    /// ticks that read kept before it.
    fn resumed(
        span: BarSpan,
        closing: bool,
        from_ms: i64,
        kept_before: Vec<FootprintTick>,
    ) -> Option<Self> {
        Self::build(
            span,
            closing,
            Some(ResumePoint {
                from_ms,
                kept_before,
            }),
        )
    }

    /// A read of `span` whose pages ask for the range `resume` names, or for the bar's whole span.
    fn build(span: BarSpan, closing: bool, resume: Option<ResumePoint>) -> Option<Self> {
        let asked = resume.as_ref().map_or(span, |point| BarSpan {
            open_ms: point.from_ms,
            end_ms: span.end_ms,
        });
        Some(Self {
            span,
            closing,
            resume,
            read: FootprintTicks::new(vec![asked], FOOTPRINT_TICK_BUDGET)?,
        })
    }

    /// The millisecond this read asks from, when a whole read already covers the bar before it.
    fn resumed_from(&self) -> Option<i64> {
        self.resume.as_ref().map(|point| point.from_ms)
    }

    /// Ends the read and answers the ticks it kept for its bar: a resumed read's page comes after the
    /// ticks of the whole read before it, which the page never asked for.
    fn finish(self) -> LiveKept {
        let Self {
            span,
            closing,
            resume,
            read,
        } = self;
        let kept = read.finish();
        let page_from_ms = resume.as_ref().map_or(span.open_ms, |point| point.from_ms);
        let mut ticks = resume.map_or_else(Vec::new, |point| point.kept_before);
        let mut page_ticks = kept.ticks;
        if let Some(page) = page_ticks.remove(&page_from_ms) {
            ticks.extend(page);
        }
        LiveKept {
            open_ms: span.open_ms,
            closing,
            incomplete: kept.incomplete.is_some(),
            ticks,
        }
    }
}

/// The last millisecond `ticks` reaches, if it holds any. The ticks of a whole read are in time order,
/// so the last one is the latest.
fn last_tick_ms(ticks: &[FootprintTick]) -> Option<i64> {
    ticks.last().map(|tick| tick.time_ms)
}

/// The footprint ticks of the chart symbol: the reads that fill them, and the ticks an observer reads.
#[derive(Default)]
pub(crate) struct FootprintFeed {
    /// The window the ticks belong to, oldest bar first.
    bars: Vec<BarSpan>,
    /// The ticks of each bar a read took whole, keyed by the bar's opening time.
    ticks_by_bar: BTreeMap<i64, Vec<FootprintTick>>,
    /// The bars a read stopped inside: their ticks never reach the observer.
    incomplete: Vec<i64>,
    /// The window read in flight, if any.
    read: Option<FootprintTicks>,
    /// The chart's forming bar, once the quote path follows one.
    forming: Option<BarSpan>,
    /// The oldest bar the live reads own: the window read never answers for it or the bars above it.
    live_from: Option<i64>,
    /// The forming bar's ticks from its last whole re-read.
    forming_ticks: Option<Vec<FootprintTick>>,
    /// The live read in flight, if any.
    live: Option<LiveRead>,
    /// When the forming bar may be re-read again.
    next_forming_read_at: Option<Instant>,
}

impl FootprintFeed {
    /// Replaces the feed with a read of `bars` and answers the page to ask for first.
    pub(crate) fn start(&mut self, bars: Vec<BarSpan>, page_bound: u32) -> Option<TickPage> {
        *self = Self::default();
        self.bars = bars.clone();
        self.read = FootprintTicks::new(bars, FOOTPRINT_TICK_BUDGET);
        self.read.as_mut()?.next_page(page_bound)
    }

    /// Folds one answered page of the window read in.
    pub(crate) fn accept_page(&mut self, answer: PageAnswer<'_>, page_bound: u32) -> PageOutcome {
        let next_page = {
            let Some(read) = self.read.as_mut() else {
                return PageOutcome::Idle;
            };
            read.accept(answer);
            read.next_page(page_bound)
        };
        match next_page {
            Some(page) => PageOutcome::Next(page),
            None => {
                self.finish_read();
                PageOutcome::Finished
            }
        }
    }

    /// Follows the chart's forming bar after an accepted quote at `now`: the bar's first re-read, then
    /// at most one per [`FORMING_REREAD_INTERVAL`]. A bar the chart has left behind is read once more
    /// to its own end instead, which is what makes it complete. Answers the page to ask the EA for.
    pub(crate) fn follow_forming_bar(
        &mut self,
        forming: FormingBars,
        now: Instant,
        page_bound: u32,
    ) -> FormingStep {
        if self.bars.is_empty() {
            return FormingStep::NOTHING;
        }
        let bar = forming.forming;
        let left = self
            .forming
            .filter(|current| current.open_ms != bar.open_ms);
        let closed_page = match left {
            Some(current) => self.leave_forming_bar(current, forming.closed, page_bound),
            None => None,
        };
        if self.live_from.is_none() {
            self.live_from = Some(bar.open_ms);
        }
        // The forming bar's ticks come from the live re-reads, so a window read of it stops short of
        // the broker's time and is dropped.
        let from_window = self.ticks_by_bar.remove(&bar.open_ms).is_some();
        let ticks_dropped = left.is_some() || from_window;
        self.forming = Some(bar);
        if let Some(page) = closed_page {
            return FormingStep {
                page: Some(page),
                ticks_dropped,
            };
        }
        if self.live.is_some() || self.next_forming_read_at.is_some_and(|at| now < at) {
            return FormingStep {
                page: None,
                ticks_dropped,
            };
        }
        self.next_forming_read_at = Some(now + FORMING_REREAD_INTERVAL);
        FormingStep {
            page: self.start_live_read(bar, false, page_bound),
            ticks_dropped,
        }
    }

    /// Folds one answered live page in: a whole read replaces the bar's ticks, and the pages of a bar
    /// that did not fit follow. A page asked from the last millisecond a whole read reached ends the
    /// read when it does not hold its range, because only a whole range answers for a bar.
    pub(crate) fn accept_live_page(
        &mut self,
        answer: PageAnswer<'_>,
        page_bound: u32,
    ) -> PageOutcome {
        if self.incremental_page_failed(answer) {
            return self.fall_back_from_incremental_read(page_bound);
        }
        let next_page = {
            let Some(live) = self.live.as_mut() else {
                return PageOutcome::Idle;
            };
            live.read.accept(answer);
            live.read.next_page(page_bound)
        };
        match next_page {
            Some(page) => PageOutcome::Next(page),
            None => {
                self.finish_live_read();
                PageOutcome::Finished
            }
        }
    }

    /// Whether the answer ends an incremental read instead of feeding it: a page asked from the last
    /// millisecond a whole read reached that did not hold its range. The read then has no whole range
    /// to keep, and asking that millisecond again would page for ever.
    fn incremental_page_failed(&self, answer: PageAnswer<'_>) -> bool {
        !answer.complete
            && matches!(self.live.as_ref(), Some(live) if live.resumed_from().is_some())
    }

    /// Falls back from an incremental read that did not come back whole to the read the bar had before
    /// it: the forming bar's ticks are dropped, so it reads `na` until a whole re-read of it lands and
    /// the next re-read starts at its open, while the closed bar's last read starts over at its own
    /// open, because no later read answers for that bar.
    fn fall_back_from_incremental_read(&mut self, page_bound: u32) -> PageOutcome {
        let Some(live) = self.live.take() else {
            return PageOutcome::Idle;
        };
        if !live.closing {
            self.forming_ticks = None;
            return PageOutcome::Finished;
        }
        match self.start_live_read_from_open(live.span, live.closing, page_bound) {
            Some(page) => PageOutcome::Next(page),
            None => PageOutcome::Finished,
        }
    }

    /// Ends the live read where it stands, because the EA could not answer it: an incremental read
    /// falls back like one that did not come back whole, and a bar a read stopped inside keeps no
    /// ticks. Answers whether ticks left the readable set, so the observer recomputes at once.
    pub(crate) fn abandon_live_read(&mut self) -> bool {
        let Some(live) = self.live.take() else {
            return false;
        };
        let incremental = live.resumed_from().is_some();
        let closing = live.closing;
        let kept = live.finish();
        if incremental && !closing {
            self.forming_ticks = None;
            return true;
        }
        if incremental || kept.incomplete {
            return self.drop_partial_bar(kept.open_ms);
        }
        false
    }

    /// Keeps what the window read took whole and drops the bar it stopped inside. The bars the live
    /// reads own — the forming one and everything the chart formed since the follow began — are left to
    /// them, because a window page of such a bar stops before its end.
    pub(crate) fn finish_read(&mut self) {
        let Some(read) = self.read.take() else {
            return;
        };
        let read = read.finish();
        if let Some(incomplete) = read.incomplete {
            if !self.follow_owns(incomplete) {
                self.drop_partial_bar(incomplete);
            }
        }
        for (open_ms, ticks) in read.ticks {
            if self.follow_owns(open_ms) {
                continue;
            }
            self.ticks_by_bar.entry(open_ms).or_insert(ticks);
        }
    }

    /// The bars a read took whole, with their ticks, oldest first.
    pub(crate) fn complete_bars(&self) -> impl Iterator<Item = (i64, &[FootprintTick])> + '_ {
        self.ticks_by_bar
            .iter()
            .filter(|(open_ms, _)| !self.is_incomplete(**open_ms))
            .map(|(open_ms, ticks)| (*open_ms, ticks.as_slice()))
    }

    /// The open times of the bars a read stopped inside: they read `na` like unread bars.
    pub(crate) fn incomplete_bars(&self) -> &[i64] {
        &self.incomplete
    }

    /// How many bars a read took whole. Only a live read of the bar the chart left adds one, so a
    /// host that publishes the window tells a closed bar landing complete by this count growing.
    pub(crate) fn complete_bar_count(&self) -> usize {
        self.complete_bars().count()
    }

    /// The forming bar's opening time and the ticks its last whole re-read kept, once the quote path
    /// follows one and that re-read landed whole.
    pub(crate) fn forming_bar(&self) -> Option<(i64, &[FootprintTick])> {
        let forming = self.forming?;
        let ticks = self.forming_ticks.as_deref()?;
        Some((forming.open_ms, ticks))
    }

    /// Whether a read stopped inside the bar that opened at `open_ms`.
    fn is_incomplete(&self, open_ms: i64) -> bool {
        self.incomplete_bars().contains(&open_ms)
    }

    /// Whether the live reads answer for the bar that opened at `open_ms`: the forming bar and every
    /// bar the chart formed since the follow began.
    fn follow_owns(&self, open_ms: i64) -> bool {
        self.live_from.is_some_and(|from| open_ms >= from)
    }

    /// Hands every tick read whole so far to the observer. A bar no read took whole is left out, so it
    /// reads `na`.
    pub(crate) fn complete_ticks(&self) -> BTreeMap<i64, Vec<FootprintTick>> {
        let mut ticks: BTreeMap<i64, Vec<FootprintTick>> = self
            .complete_bars()
            .map(|(open_ms, bar_ticks)| (open_ms, bar_ticks.to_vec()))
            .collect();
        if let (Some(forming), Some(forming_ticks)) = (self.forming, &self.forming_ticks) {
            ticks.insert(forming.open_ms, forming_ticks.clone());
        }
        ticks
    }

    /// Forgets the window, the ticks it holds and both reads: another chart computes from here.
    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }

    /// The chart moved on: the bar it left stops being live and is read once more to its own end,
    /// from the last millisecond its whole re-reads reached when that leaves a range to ask for. Its
    /// live ticks stop before that end, so they are dropped until the read lands whole.
    fn leave_forming_bar(
        &mut self,
        left: BarSpan,
        closed: Option<BarSpan>,
        page_bound: u32,
    ) -> Option<TickPage> {
        self.next_forming_read_at = None;
        self.live = None;
        self.ticks_by_bar.remove(&left.open_ms);
        let closed = closed.filter(|closed| closed.open_ms == left.open_ms);
        let page = closed.and_then(|closed| self.start_live_read(closed, true, page_bound));
        self.forming_ticks = None;
        page
    }

    /// Asks for the first page of a live read of `span` and remembers it as the read in flight: from
    /// the last millisecond a whole read of the bar reached when that leaves a range to ask for, from
    /// the bar's open otherwise.
    fn start_live_read(
        &mut self,
        span: BarSpan,
        closing: bool,
        page_bound: u32,
    ) -> Option<TickPage> {
        let live = match self.resume_from(span) {
            Some(from_ms) => {
                let kept_before = self.forming_ticks_before(from_ms);
                LiveRead::resumed(span, closing, from_ms, kept_before)?
            }
            None => LiveRead::new(span, closing)?,
        };
        self.begin_live_read(live, page_bound)
    }

    /// Asks for the first page of a live read of `span` from the bar's open, whatever the whole reads
    /// of it reached: the read a bar had before the re-reads were incremental.
    fn start_live_read_from_open(
        &mut self,
        span: BarSpan,
        closing: bool,
        page_bound: u32,
    ) -> Option<TickPage> {
        let live = LiveRead::new(span, closing)?;
        self.begin_live_read(live, page_bound)
    }

    /// Asks for `live`'s first page and keeps the read in flight.
    fn begin_live_read(&mut self, mut live: LiveRead, page_bound: u32) -> Option<TickPage> {
        let page = live.read.next_page(page_bound);
        self.live = Some(live);
        page
    }

    /// The millisecond a new live read of `span` resumes at: the last one the forming bar's whole
    /// re-read reached, when that leaves a range to ask for. The forming bar's ticks are always those
    /// of its last whole re-read, so a bar without one starts at its open.
    fn resume_from(&self, span: BarSpan) -> Option<i64> {
        let read_to_ms = last_tick_ms(self.forming_ticks.as_deref()?)?;
        (read_to_ms > span.open_ms && read_to_ms < span.end_ms).then_some(read_to_ms)
    }

    /// The forming bar's ticks before `from_ms`: the ones a read resumed at it keeps, because only the
    /// millisecond it resumes at is asked for again.
    fn forming_ticks_before(&self, from_ms: i64) -> Vec<FootprintTick> {
        self.forming_ticks
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|tick| tick.time_ms < from_ms)
            .copied()
            .collect()
    }

    /// Takes what the finished live read kept: the forming bar's ticks, or the closed bar's, which then
    /// counts as complete.
    fn finish_live_read(&mut self) {
        let Some(live) = self.live.take() else {
            return;
        };
        let kept = live.finish();
        if kept.incomplete {
            self.drop_partial_bar(kept.open_ms);
            return;
        }
        if kept.closing {
            self.keep_complete_bar(kept.open_ms, kept.ticks);
            return;
        }
        // A whole re-read of the forming bar answers for the bar as far as it has formed.
        self.incomplete.retain(|bar| *bar != kept.open_ms);
        self.forming_ticks = Some(kept.ticks);
    }

    /// Keeps the ticks of a bar a live read took whole, in place of any earlier read of it.
    fn keep_complete_bar(&mut self, open_ms: i64, ticks: Vec<FootprintTick>) {
        self.ticks_by_bar.insert(open_ms, ticks);
        self.incomplete.retain(|bar| *bar != open_ms);
    }

    /// Drops a bar a read stopped inside: no read took it whole, so it reads `na`. The forming bar is
    /// left alone, because its ticks come from its re-reads and another one follows. Answers whether
    /// the bar lost its ticks.
    fn drop_partial_bar(&mut self, open_ms: i64) -> bool {
        if self
            .forming
            .is_some_and(|forming| forming.open_ms == open_ms)
        {
            return false;
        }
        self.ticks_by_bar.remove(&open_ms);
        if !self.incomplete.contains(&open_ms) {
            self.incomplete.push(open_ms);
        }
        true
    }
}

#[cfg(test)]
mod tests;

//! The trades behind a footprint from MT5's counted pages instead of the raw ticks: one
//! `tick_history_request` with `footprint_counts` per bar, folded into the levels the existing
//! footprint rows already read.
//!
//! A counted page answers with the volume each side traded at each price inside the range it was
//! asked for, and with the tick-rule carry the next page continues from. One request covers one bar —
//! the window's newest bar first — or the rest of a bar from the millisecond its last page reached,
//! so a bar holding more trades than a page costs as many pages as its trades need. The carry is what
//! makes those pages one read: a page boundary moves the tick rule but not a trade, so a price
//! counted on two pages is one level whose sides sum, and a trade whose side the tick rule decides
//! keeps the side the page before it left.
//!
//! Counts cannot be resumed inside a millisecond: a page whose `through_ms` is its `from_ms`
//! certified no progress, so the bar it belongs to stops the read as incomplete instead of being
//! asked for again. A bar is whole only when its last page came back `complete`; the bars a read took
//! whole are handed on as [`FootprintTick`]s — one per level and side — which is what the footprint
//! rows and the engine already read, so a counts read and a raw ticks read paint the same chart.
//!
//! The forming bar is read the same way: [`CountsLive`] keeps one bar's counts across the pages of
//! one re-read and moves its end to the broker's time as the bar forms, so a whole re-read answers
//! for the bar as far as it has formed.

// The bridge pages these reads whenever the connected EA negotiated `tick_footprint_counts`; the raw
// tick path stays for the EAs that did not.

use super::{BarSpan, FootprintFeed, FormingBars, FormingStep, FORMING_REREAD_INTERVAL};
use rust_decimal::Decimal;
use std::collections::BTreeMap;
use std::time::Instant;
use trading_core::footprint::{FootprintTick, TickSide};
use trading_core::protocol::{
    FootprintCarry, FootprintLevel, TickFootprintHistoryRequest, TickFootprintHistorySnapshot,
    TickHistoryRequest,
};

/// Pages one counted window read may ask for: a bar costs one page, and a bar holding more trades than
/// a page costs the pages its trades need, so even a dense window of a thousand bars fits.
const MAX_COUNTS_PAGES: usize = 2048;

/// A counts page counts the trades per price instead of carrying the raw ticks: the flag that makes
/// the peer answer with `tick_footprint_history_snapshot`, and the only page this read understands.
const COUNTS_REQUESTED: bool = true;

/// One page of a counted read: the bar it counts into, the range of that bar still to count, and the
/// state the page needs from the pages before it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CountsPage {
    /// Opening time of the bar the page belongs to: the bar its levels count into.
    pub(crate) open_ms: i64,
    /// First millisecond the page counts: the bar's open, or the millisecond the bar's last page
    /// stopped at, which MT5 may still have added ticks to.
    pub(crate) from_ms: i64,
    /// End of the bar's range, excluded as the wire excludes it.
    pub(crate) to_ms: i64,
    /// Whether each counted trade is weighted by the volume it moved instead of counting one.
    pub(crate) real_volume: bool,
    /// Tick-rule state the bar's last page left, passed back so the page classifies its trades like
    /// one whole read would; `None` at the bar's open, because a bar starts a fresh range.
    pub(crate) carry: Option<FootprintCarry>,
}

impl CountsPage {
    /// The wire request for this page of `symbol`, asking for at most `max_ticks` records.
    pub(crate) fn request(&self, symbol: &str, max_ticks: u32) -> TickFootprintHistoryRequest {
        TickFootprintHistoryRequest {
            history: TickHistoryRequest {
                symbol: symbol.to_owned(),
                from_ms: self.from_ms,
                to_ms: self.to_ms,
                max_ticks,
            },
            footprint_counts: COUNTS_REQUESTED,
            real_volume: self.real_volume,
            carry: self.carry.clone(),
            bar_opens: Vec::new(),
            first_open_ms: None,
        }
    }
}

/// The bars of one window read as counted trades: the newest bar first, one page per bar, and the bar
/// in progress continued from the millisecond its last page reached with the carry that page returned.
///
/// A bar is whole only when its last page came back complete, and its levels merge across the pages
/// that continue it, because the carry carries the tick rule over the page boundary and not the
/// trades. A bar a page stopped inside — a page that certified no progress — keeps no ticks, and no
/// bar under it is read.
pub(crate) struct CountsRead {
    /// The window's bars, oldest first.
    bars: Vec<BarSpan>,
    /// How many of the newest bars no page has taken whole yet.
    unread: usize,
    /// The bar whose pages the read is collecting, once a page has asked for one.
    counting: Option<BarCounts>,
    /// The bar a page stopped the read inside: it keeps no ticks, and the read ends there.
    stopped_in: Option<i64>,
    /// How many pages the read has asked for, and the most it may ask.
    pages: usize,
    max_pages: usize,
    /// The bars taken whole since the last call, keyed by their opening time.
    whole: BTreeMap<i64, Vec<FootprintTick>>,
}

impl CountsRead {
    /// A read of `bars`, newest first, that asks for at most `max_pages` pages; `None` when the window
    /// holds no bar to read.
    pub(crate) fn new(bars: Vec<BarSpan>, max_pages: usize) -> Option<Self> {
        if bars.is_empty() {
            return None;
        }
        let unread = bars.len();
        Some(Self {
            bars,
            unread,
            counting: None,
            stopped_in: None,
            pages: 0,
            max_pages,
            whole: BTreeMap::new(),
        })
    }

    /// The page to ask for next: the newest bar no page has reached, or the rest of the bar in
    /// progress. `None` once every bar is whole, a bar stopped the read, or the page limit is spent.
    pub(crate) fn next_page(&mut self) -> Option<CountsPage> {
        if self.done() {
            return None;
        }
        if self.counting.is_none() {
            self.counting = self.newest_unread().map(BarCounts::new);
        }
        let page = self.counting.as_ref()?.page();
        self.pages += 1;
        Some(page)
    }

    /// Folds the answer to the page the read asked for in. An answer for any other page is ignored,
    /// and a page that made no progress stops the bar it belongs to and ends the read.
    pub(crate) fn accept(&mut self, answer: &TickFootprintHistorySnapshot) {
        let Some(counting) = self.counting.as_mut() else {
            return;
        };
        let open_ms = counting.span.open_ms;
        let fold = counting.fold_page(answer);
        match fold {
            Fold::Foreign | Fold::Continues => {}
            Fold::Stalled => self.stop(open_ms),
            Fold::Complete => self.keep_whole_bar(),
        }
    }

    /// The bars the read has taken whole since the last call, keyed by their opening time.
    pub(crate) fn take_whole_bars(&mut self) -> BTreeMap<i64, Vec<FootprintTick>> {
        std::mem::take(&mut self.whole)
    }

    /// The bar a page stopped the read inside, if one did.
    pub(crate) fn stopped_in(&self) -> Option<i64> {
        self.stopped_in
    }

    /// Whether the read asks for no more pages.
    fn done(&self) -> bool {
        self.stopped_in.is_some() || self.pages >= self.max_pages
    }

    /// The newest bar no page has taken whole yet.
    fn newest_unread(&self) -> Option<BarSpan> {
        self.bars.get(self.unread.checked_sub(1)?).copied()
    }

    /// Keeps the bar whose counting finished as whole and marks it read, so the next page asks for the
    /// bar under it.
    fn keep_whole_bar(&mut self) {
        let Some(counting) = self.counting.take() else {
            return;
        };
        self.whole.insert(counting.span.open_ms, counting.ticks());
        self.unread = self.unread.saturating_sub(1);
    }

    /// Ends the read in the bar it was counting: its levels are dropped, because a bar is kept only
    /// when every page of its own range answered.
    fn stop(&mut self, open_ms: i64) {
        self.counting = None;
        self.stopped_in = Some(open_ms);
    }
}

/// One bar counted as the chart forms it, or as the chart left it behind.
///
/// Every page asks from the last millisecond a page reached — the bar's open at first — to the bar's
/// end, with the carry read so far, and its levels merge into the ones already counted. The read is
/// whole only when it is the read of the bar the chart left and its last page reached the bar's end
/// complete; a forming bar keeps gaining trades, so reaching its end now means nothing.
pub(crate) struct CountsLive {
    /// The bar, with the end this read goes to.
    counts: BarCounts,
    /// Whether this read finishes the bar the chart left instead of following the forming one.
    closing: bool,
}

impl CountsLive {
    /// A read of `span` from its open: `closing` for the read that finishes the bar the chart left.
    pub(crate) fn new(span: BarSpan, closing: bool) -> Self {
        Self {
            counts: BarCounts::new(span),
            closing,
        }
    }

    /// The page to ask for next, or `None` once a page reached the bar's end.
    pub(crate) fn next_page(&self) -> Option<CountsPage> {
        if self.counts.read_to_end() {
            return None;
        }
        Some(self.counts.page())
    }

    /// Folds the answer to the page this read asks for in. A no-progress answer, and one for another
    /// page, leaves the state unchanged, so the read asks the same page again.
    pub(crate) fn accept(&mut self, answer: &TickFootprintHistorySnapshot) {
        self.counts.fold_page(answer);
    }

    /// The trades counted so far: one per level and side.
    pub(crate) fn ticks(&self) -> Vec<FootprintTick> {
        self.counts.ticks()
    }

    /// The bar this read is of, with the end it reaches.
    pub(crate) fn span(&self) -> BarSpan {
        self.counts.span
    }

    /// Whether this read finishes the bar the chart left instead of following the forming one.
    pub(crate) fn closing(&self) -> bool {
        self.closing
    }

    /// Whether this read follows the bar that opened at `open_ms`, so the chart leaving that bar
    /// finishes this read instead of starting another one.
    pub(crate) fn holds(&self, open_ms: i64) -> bool {
        !self.closing && self.counts.span.open_ms == open_ms
    }

    /// Whether the read answered for the bar as the chart left it: a closing read whose last page
    /// reached the bar's end complete.
    pub(crate) fn is_whole(&self) -> bool {
        self.closing && self.counts.read_to_end()
    }

    /// Moves the read's end to a later broker time, so the forming bar asks for the trades it gained
    /// since; an end at or before the one already read changes nothing.
    pub(crate) fn set_end(&mut self, end_ms: i64) {
        self.counts.span.end_ms = self.counts.span.end_ms.max(end_ms);
    }

    /// Turns this forming read into the closing read of the same bar: it keeps the levels, the carry
    /// and the millisecond it reached, and asks on to `end_ms`, where the bar the chart left closed.
    pub(crate) fn close(&mut self, end_ms: i64) {
        self.closing = true;
        self.counts.span.end_ms = end_ms;
    }
}

/// The levels one bar's pages have counted so far, and where its last page stopped.
///
/// A page boundary moves the tick-rule carry but no trade, so the levels of a price counted on two
/// pages sum into one.
struct BarCounts {
    /// The bar being counted, with the end its read goes to.
    span: BarSpan,
    /// The millisecond the last page stopped at: the page after it asks from there.
    through_ms: i64,
    /// The tick rule's state after the last page, which the next one continues from.
    carry: Option<FootprintCarry>,
    /// The volume each side traded at each price, ascending by price.
    levels: BTreeMap<Decimal, (Decimal, Decimal)>,
}

impl BarCounts {
    /// The counts of `span` before any page answered: its read starts at the bar's open with no carry,
    /// because a bar starts a fresh range.
    fn new(span: BarSpan) -> Self {
        Self {
            span,
            through_ms: span.open_ms,
            carry: None,
            levels: BTreeMap::new(),
        }
    }

    /// The page this bar's read asks for next: from the last millisecond a page reached to the bar's
    /// end.
    fn page(&self) -> CountsPage {
        CountsPage {
            open_ms: self.span.open_ms,
            from_ms: self.through_ms,
            to_ms: self.span.end_ms,
            real_volume: self.span.real_volume,
            carry: self.carry.clone(),
        }
    }

    /// Whether `answer` answers the page this bar's read asks for. A page of any other range — a stale
    /// answer, one of another bar — is not this read's and never moves it.
    fn awaits(&self, answer: &TickFootprintHistorySnapshot) -> bool {
        answer.from_ms == self.through_ms && answer.to_ms == self.span.end_ms
    }

    /// Folds the answer to the awaited page in: its levels merge into the bar's, and its boundary and
    /// carry become the ones the next page asks from.
    fn fold_page(&mut self, answer: &TickFootprintHistorySnapshot) -> Fold {
        if !self.awaits(answer) {
            return Fold::Foreign;
        }
        // A page ending where it started certified no progress. Counts cannot be resumed inside a
        // millisecond, so neither the rest of this bar nor a bar under it is read.
        if answer.through_ms <= self.through_ms {
            return Fold::Stalled;
        }
        merge_levels(&mut self.levels, &answer.levels);
        self.through_ms = answer.through_ms;
        self.carry.clone_from(&answer.carry);
        if answer.complete {
            return Fold::Complete;
        }
        Fold::Continues
    }

    /// Whether the last page read reached the bar's end, which only a complete page does on the
    /// wire's own rules.
    fn read_to_end(&self) -> bool {
        self.through_ms >= self.span.end_ms
    }

    /// The bar's trades so far, one per level and side.
    fn ticks(&self) -> Vec<FootprintTick> {
        level_ticks(self.span.open_ms, &self.levels)
    }
}

/// What folding one answered page into a bar left to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fold {
    /// The answer was not the page the bar's read asked for: the bar did not move.
    Foreign,
    /// The page moved the read on, and the rest of the bar follows.
    Continues,
    /// The page reached the bar's end complete, so the bar is whole.
    Complete,
    /// The page certified no progress, so the bar stopped the read.
    Stalled,
}

/// The trades of one bar's levels, as the footprint rows read them: per price ascending one buy tick
/// and then one sell tick, each carrying the volume its side traded, and no tick for a side that
/// traded nothing.
pub(crate) fn level_ticks(
    open_ms: i64,
    levels: &BTreeMap<Decimal, (Decimal, Decimal)>,
) -> Vec<FootprintTick> {
    let mut ticks = Vec::with_capacity(levels.len() * 2);
    for (price, (buy, sell)) in levels {
        if *buy > Decimal::ZERO {
            ticks.push(FootprintTick {
                time_ms: open_ms,
                price: *price,
                volume: *buy,
                side: TickSide::Buy,
            });
        }
        if *sell > Decimal::ZERO {
            ticks.push(FootprintTick {
                time_ms: open_ms,
                price: *price,
                volume: *sell,
                side: TickSide::Sell,
            });
        }
    }
    ticks
}

/// Adds each of a page's `levels` to the bar's counts, summing both sides of a price the pages before
/// it already counted.
fn merge_levels(counted: &mut BTreeMap<Decimal, (Decimal, Decimal)>, levels: &[FootprintLevel]) {
    for level in levels {
        let Some((price, buy, sell)) = counted_level(level) else {
            continue;
        };
        let sides = counted
            .entry(price)
            .or_insert((Decimal::ZERO, Decimal::ZERO));
        sides.0 += buy;
        sides.1 += sell;
    }
}

/// The price and the two sides of one wire level; `None` when a text is no decimal, which is a
/// validation bug upstream and leaves the level out of the bar rather than failing the read.
fn counted_level(level: &FootprintLevel) -> Option<(Decimal, Decimal, Decimal)> {
    let price = level.price.parse::<Decimal>().ok()?;
    let buy = level.buy.parse::<Decimal>().ok()?;
    let sell = level.sell.parse::<Decimal>().ok()?;
    Some((price, buy, sell))
}

/// What one answered counts page left to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CountsOutcome {
    /// The page to ask the EA for next.
    Next(CountsPage),
    /// The read is covered, spent or stopped: the observer hears the ticks.
    Finished,
    /// The read was dropped before this page arrived, because the chart changed.
    Idle,
}

impl FootprintFeed {
    /// Replaces the feed with a counts read of `bars` and answers the page to ask for first.
    pub(crate) fn start_counts(&mut self, bars: Vec<BarSpan>) -> Option<CountsPage> {
        *self = Self::default();
        self.bars = bars.clone();
        self.counts_read = CountsRead::new(bars, MAX_COUNTS_PAGES);
        self.read_started = Some(Instant::now());
        let page = self.counts_read.as_mut()?.next_page();
        self.note_counts_page(page)
    }

    /// Folds one answered page of the counts window read in, handing the bars it took whole to the feed
    /// as it goes: the observer and the chart see them before the read ends, and a bar the read has not
    /// reached names no state at all.
    pub(crate) fn accept_counts_page(
        &mut self,
        answer: &TickFootprintHistorySnapshot,
    ) -> CountsOutcome {
        let Some(read) = self.counts_read.as_mut() else {
            return CountsOutcome::Idle;
        };
        read.accept(answer);
        let next_page = read.next_page();
        let whole = read.take_whole_bars();
        self.read_pages += 1;
        self.read_page_ticks = self
            .read_page_ticks
            .saturating_add(usize::try_from(answer.loaded_ticks).unwrap_or(usize::MAX));
        self.keep_read_bars(whole);
        match next_page {
            Some(page) => match self.note_counts_page(Some(page)) {
                Some(page) => CountsOutcome::Next(page),
                None => CountsOutcome::Finished,
            },
            None => {
                self.finish_counts_read();
                CountsOutcome::Finished
            }
        }
    }

    /// Ends the counts window read where it stands and drops the bar it stopped inside, which keeps no
    /// ticks and so reads `na`; the bars the live reads own are left to them.
    pub(crate) fn finish_counts_read(&mut self) {
        let Some(mut read) = self.counts_read.take() else {
            return;
        };
        let stopped_in = read.stopped_in();
        let whole = read.take_whole_bars();
        self.keep_read_bars(whole);
        let Some(open_ms) = stopped_in.filter(|open_ms| !self.follow_owns(*open_ms)) else {
            return;
        };
        self.drop_partial_bar(open_ms);
    }

    /// Follows the chart's forming bar in counts mode after an accepted quote at `now`: the bar's first
    /// read, then at most one per [`FORMING_REREAD_INTERVAL`], each asking only for the trades the bar
    /// gained since the one before. A bar the chart has left behind is read on from the millisecond its
    /// forming read reached, which is what finishes it without losing the levels it already counted.
    pub(crate) fn follow_forming_bar_counts(
        &mut self,
        forming: FormingBars,
        now: Instant,
    ) -> FormingStep<CountsPage> {
        if self.bars.is_empty() {
            return FormingStep::NOTHING;
        }
        let change = self.begin_follow(forming);
        if let Some(left) = change.left {
            let left_bar = self.leave_forming_bar_counts(left, forming.closed);
            return FormingStep {
                page: left_bar.page,
                ticks_dropped: change.ticks_dropped,
                window_changed: left_bar.window_changed,
            };
        }
        if self.counts_live_awaited || !self.reread_due(now) {
            return FormingStep {
                page: None,
                ticks_dropped: change.ticks_dropped,
                window_changed: false,
            };
        }
        self.next_forming_read_at = Some(now + FORMING_REREAD_INTERVAL);
        FormingStep {
            page: self.start_counts_live_read(forming.forming, false),
            ticks_dropped: change.ticks_dropped,
            window_changed: false,
        }
    }

    /// Folds one answered page of the forming bar's counts read in: its levels grow with every page, and
    /// a read that reached its end answers for the bar as far as it has formed. The closing read of the
    /// bar the chart left starts the following forming bar's first read the moment it lands, so that
    /// bar is never left blank until the next quote.
    pub(crate) fn accept_counts_live_page(
        &mut self,
        answer: &TickFootprintHistorySnapshot,
    ) -> CountsOutcome {
        let Some(live) = self.counts_live.as_mut() else {
            return CountsOutcome::Idle;
        };
        live.accept(answer);
        let next_page = live.next_page();
        self.counts_live_awaited = next_page.is_some();
        let closed_bar_landed = next_page.is_none() && live.closing();
        if let Some(page) = next_page {
            return CountsOutcome::Next(page);
        }
        self.finish_counts_live_read();
        if !closed_bar_landed {
            return CountsOutcome::Finished;
        }
        match self.start_forming_bar_counts_read() {
            Some(page) => CountsOutcome::Next(page),
            None => CountsOutcome::Finished,
        }
    }

    /// Starts the following forming bar's first read, from its open as a bar's first read always does,
    /// and holds the next re-read back by one interval as the quote path would.
    fn start_forming_bar_counts_read(&mut self) -> Option<CountsPage> {
        let forming = self.forming?;
        self.next_forming_read_at = Some(Instant::now() + FORMING_REREAD_INTERVAL);
        self.start_counts_live_read(forming, false)
    }

    /// Whether the counts read in flight finishes the bar the chart left, whose footprint the window
    /// holds provisionally until that read lands.
    pub(crate) fn closing_counts_live_read(&self) -> bool {
        self.counts_live.as_ref().is_some_and(CountsLive::closing)
    }

    /// Ends the counts read of the forming bar where it stands, because the EA could not answer it: the
    /// forming bar loses the trades this read had counted and reads `na` until a whole re-read lands,
    /// and the bar the chart left keeps no ticks. Answers whether ticks left the readable set, so the
    /// observer recomputes at once.
    pub(crate) fn abandon_counts_live_read(&mut self) -> bool {
        self.counts_live_awaited = false;
        let Some(live) = self.counts_live.take() else {
            return false;
        };
        let open_ms = live.span().open_ms;
        if live.closing() {
            return self.drop_partial_bar(open_ms);
        }
        self.forming_ticks = None;
        true
    }

    /// Notes the counts page the read just asked for, so the timing lines cover one bar and the time it
    /// takes the EA to answer it.
    fn note_counts_page(&mut self, page: Option<CountsPage>) -> Option<CountsPage> {
        self.page_bars = usize::from(page.is_some());
        self.page_queued = page.is_some().then(Instant::now);
        page
    }

    /// Asks for the page a forming-bar counts re-read needs. The read keeps the levels it has counted
    /// and its end moves to the broker's time, so a later re-read asks only for the trades the bar
    /// gained; `closing` starts the read of the bar the chart left.
    fn start_counts_live_read(&mut self, span: BarSpan, closing: bool) -> Option<CountsPage> {
        if self.counts_live.is_none() {
            self.counts_live = Some(CountsLive::new(span, closing));
        }
        let live = self.counts_live.as_mut()?;
        live.set_end(span.end_ms);
        let page = live.next_page();
        self.counts_live_awaited = page.is_some();
        page
    }

    /// Keeps what a counts live read answered for its bar: the bar the chart left, once the read
    /// reached its end — which is what makes it whole — or the forming bar's counted trades as of this
    /// read. A forming read stays for the next re-read, which asks only for the trades it gained.
    fn finish_counts_live_read(&mut self) {
        let Some(live) = self.counts_live.as_ref() else {
            return;
        };
        let span = live.span();
        let ticks = live.ticks();
        if live.is_whole() {
            self.counts_live = None;
            self.keep_complete_bar(span.open_ms, ticks);
            return;
        }
        self.incomplete.retain(|bar| *bar != span.open_ms);
        self.forming_ticks = Some(ticks);
    }

    /// The chart left its forming bar: the read that follows it becomes the read that finishes it, so
    /// the levels it already counted stay the bar's footprint while the rest of the bar lands. A bar
    /// no forming read holds is read from its open, and its window ticks go as before.
    fn leave_forming_bar_counts(
        &mut self,
        left: BarSpan,
        closed: Option<BarSpan>,
    ) -> LeftBarCounts {
        self.next_forming_read_at = None;
        self.forming_ticks = None;
        let closed = closed.filter(|closed| closed.open_ms == left.open_ms);
        if let (Some(closed), true) = (closed, self.counts_live_holds(left.open_ms)) {
            return self.close_counts_live_bar(closed);
        }
        let window_changed = self.discard_counts_live();
        self.ticks_by_bar.remove(&left.open_ms);
        let page = closed.and_then(|closed| self.start_counts_live_read(closed, true));
        LeftBarCounts {
            page,
            window_changed,
        }
    }

    /// Finishes the bar the chart left with the levels its forming read counted: they become the bar's
    /// footprint at once, and the read asks on for the rest of the bar.
    fn close_counts_live_bar(&mut self, closed: BarSpan) -> LeftBarCounts {
        let page = self.ask_rest_of_bar(closed.open_ms, closed.end_ms);
        if page.is_none() {
            self.finish_counts_live_read();
        }
        LeftBarCounts {
            page,
            window_changed: true,
        }
    }

    /// Turns the forming read of the bar at `open_ms` into its closing read and asks on to `end_ms`,
    /// keeping the levels counted so far as the bar's provisional footprint. Answers the page, or `None`
    /// when the read already covers the bar.
    fn ask_rest_of_bar(&mut self, open_ms: i64, end_ms: i64) -> Option<CountsPage> {
        self.counts_live_awaited = false;
        let live = self.counts_live.as_mut()?;
        live.close(end_ms);
        let page = live.next_page()?;
        let ticks = live.ticks();
        self.ticks_by_bar.insert(open_ms, ticks);
        self.counts_live_awaited = true;
        Some(page)
    }

    /// Drops the counts read in flight, and with it the provisional footprint of the bar a closing read
    /// would have finished: no read finishes that bar any more, so it keeps none. Answers whether the
    /// window's bars changed.
    fn discard_counts_live(&mut self) -> bool {
        self.counts_live_awaited = false;
        let Some(live) = self.counts_live.take() else {
            return false;
        };
        live.closing() && self.drop_partial_bar(live.span().open_ms)
    }

    /// Whether the counts read in flight follows the bar that opened at `open_ms`.
    fn counts_live_holds(&self, open_ms: i64) -> bool {
        self.counts_live
            .as_ref()
            .is_some_and(|live| live.holds(open_ms))
    }
}

/// What leaving the forming bar left for the quote path: the page the closing read asks for, and whether
/// the bars the window publishes changed with the counted footprint the bar kept.
struct LeftBarCounts {
    page: Option<CountsPage>,
    window_changed: bool,
}

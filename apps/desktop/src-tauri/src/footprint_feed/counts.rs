//! The trades behind a footprint from MT5's counted pages instead of the raw ticks: one
//! `tick_history_request` with `footprint_counts` per run of bars, folded into the levels the existing
//! footprint rows already read.
//!
//! A counted page answers with the volume each side traded at each price inside the range it was asked
//! for — one entry per bar when the request listed the bars' opens — and with the tick-rule carry the
//! next page continues from. A page covers a run of the newest unread bars, sized from the candles' own
//! tick counts, so a window costs the pages its ticks need instead of one request per bar; a bar holding
//! more trades than a page costs the pages its trades need, because the page after an incomplete one
//! continues the bar it stopped inside from the millisecond it reached and lists the opens after it, so
//! the rest of the run follows in the same request. The carry is what makes those pages one read: a page
//! boundary moves the tick rule but not a trade, so a price counted on two pages is one level whose sides
//! sum, and a trade whose side the tick rule decides keeps the side the page before it left.
//!
//! Counts cannot be resumed inside a millisecond: a page whose `through_ms` is its `from_ms` certified no
//! progress, so the bar it belongs to stops the read as incomplete instead of being asked for again. A
//! page that loaded no tick at all, while the candles of its bars count volume, is not that case: MT5
//! loads a symbol's tick history in the background, so such a page is asked again a few times and its
//! bars are left unread rather than counted empty. A bar is whole once a page counted its whole range;
//! the bars a read took whole are handed on as [`FootprintTick`]s — one per level and side — which is
//! what the footprint rows and the engine already read, so a counts read and a raw ticks read paint the
//! same chart.
//!
//! The forming bar is read one bar at a time: [`CountsLive`] keeps one bar's counts across the pages of
//! one re-read and moves its end to the broker's time as the bar forms, so a whole re-read answers for
//! the bar as far as it has formed.

// The bridge pages these reads whenever the connected EA negotiated `tick_footprint_counts`; the raw
// tick path stays for the EAs that did not.

use super::{
    counted_ticks, widened_estimate, BarSpan, FootprintFeed, FormingBars, FormingStep,
    FORMING_REREAD_INTERVAL,
};
use rust_decimal::Decimal;
use std::collections::BTreeMap;
use std::ops::Range;
use std::time::Instant;
use trading_core::footprint::{FootprintTick, TickSide};
use trading_core::protocol::{
    FootprintCarry, FootprintLevel, TickFootprintHistoryRequest, TickFootprintHistorySnapshot,
    TickHistoryRequest,
};

/// Pages one counted window read may ask for: a page covers the run of bars its tick counts fit, and a
/// bar holding more trades than a page costs the pages its trades need, so even a dense window of a
/// thousand bars fits.
const MAX_COUNTS_PAGES: usize = 2048;

/// A counts page counts the trades per price instead of carrying the raw ticks: the flag that makes
/// the peer answer with `tick_footprint_history_snapshot`, and the only page this read understands.
const COUNTS_REQUESTED: bool = true;

/// How many answers in a row a counted read tolerates that loaded no tick at all: MT5 loads a symbol's
/// tick history in the background, so an indicator's `CopyTicks` answers an empty page meanwhile, and
/// that page is worth asking again rather than counting its bars empty.
pub(crate) const MAX_UNLOADED_RETRIES: usize = 3;

/// One page of a counted read: the bars it counts into, the range of the first of them still to count,
/// and the state the page needs from the pages before it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CountsPage {
    /// The bars the page counts into, oldest first: the wire starts at the first one's open, or inside it
    /// when a page before this one stopped there, and ends at the last one's end.
    pub(crate) bars: Vec<BarSpan>,
    /// First millisecond the page counts: the first bar's open, or the millisecond its last page stopped
    /// at, which MT5 may still have added ticks to.
    pub(crate) from_ms: i64,
    /// Whether each counted trade is weighted by the volume it moved instead of counting one. Every bar
    /// of a page shares it, because one request carries one rule.
    pub(crate) real_volume: bool,
    /// Tick-rule state the page starts from: the one a page that stopped inside the first bar left, and
    /// `None` at a bar's open, because a bar starts a fresh range.
    pub(crate) carry: Option<FootprintCarry>,
}

impl CountsPage {
    /// The end of the page's range, excluded as the wire excludes it: the last of its bars' end.
    pub(crate) fn to_ms(&self) -> i64 {
        self.bars.last().map_or(self.from_ms, |bar| bar.end_ms)
    }

    /// Whether `answer` answers this page: its range is the page's own. A stale answer, and one for
    /// another page, never moves the read.
    fn awaits(&self, answer: &TickFootprintHistorySnapshot) -> bool {
        answer.from_ms == self.from_ms && answer.to_ms == self.to_ms()
    }

    /// The open the page's range starts in, named only when the page covers more than one bar: the wire
    /// asks for it with the listed opens, and a page of one bar keeps the request shape a bar's page has
    /// always had.
    fn first_open_ms(&self) -> Option<i64> {
        if self.bars.len() < 2 {
            return None;
        }
        self.bars.first().map(|bar| bar.open_ms)
    }

    /// The opens of the page's bars after the first one: every listed open starts a fresh tick rule.
    fn bar_opens(&self) -> Vec<i64> {
        self.bars.iter().skip(1).map(|bar| bar.open_ms).collect()
    }

    /// The wire request for this page of `symbol`, asking for at most `max_ticks` records.
    pub(crate) fn request(&self, symbol: &str, max_ticks: u32) -> TickFootprintHistoryRequest {
        TickFootprintHistoryRequest {
            history: TickHistoryRequest {
                symbol: symbol.to_owned(),
                from_ms: self.from_ms,
                to_ms: self.to_ms(),
                max_ticks,
            },
            footprint_counts: COUNTS_REQUESTED,
            real_volume: self.real_volume,
            carry: self.carry.clone(),
            bar_opens: self.bar_opens(),
            first_open_ms: self.first_open_ms(),
        }
    }
}

/// The bars of one window read as counted trades: a page per run of newest unread bars, sized from the
/// candles' tick counts, and a bar continued from the millisecond its last page reached with the carry
/// that page returned.
///
/// A bar is whole once a page counted its whole range, and its levels merge across the pages that
/// continue it, because the carry carries the tick rule over a page boundary and not the trades. A bar a
/// page stopped inside — a page that certified no progress, or one that never loaded its ticks — keeps no
/// ticks, and no bar under it is read.
pub(crate) struct CountsRead {
    /// The window's bars, oldest first.
    bars: Vec<BarSpan>,
    /// Whether each bar is whole: no page asks for one again, and a page is one range, so a run never
    /// crosses a whole bar.
    whole: Vec<bool>,
    /// The bar a page stopped inside, once one left it half counted: the page after it continues from
    /// `through_ms`.
    counting: Option<BarCounts>,
    /// The page the read waits for, once it asked for one.
    awaiting: Option<CountsPage>,
    /// The bar a page stopped the read inside: it keeps no ticks, and the read ends there.
    stopped_in: Option<i64>,
    /// How many answers in a row loaded no tick, which the read asks again within
    /// [`MAX_UNLOADED_RETRIES`].
    unloaded_answers: usize,
    /// How many pages the read has asked for, and the most it may ask.
    pages: usize,
    max_pages: usize,
    /// The bars taken whole since the last call, keyed by their opening time.
    whole_bars: BTreeMap<i64, Vec<FootprintTick>>,
}

impl CountsRead {
    /// A read of `bars`, newest first, that asks for at most `max_pages` pages; `None` when the window
    /// holds no bar to read.
    pub(crate) fn new(bars: Vec<BarSpan>, max_pages: usize) -> Option<Self> {
        if bars.is_empty() {
            return None;
        }
        let count = bars.len();
        Some(Self {
            bars,
            whole: vec![false; count],
            counting: None,
            awaiting: None,
            stopped_in: None,
            unloaded_answers: 0,
            pages: 0,
            max_pages,
            whole_bars: BTreeMap::new(),
        })
    }

    /// The page to ask for next, covering at most `max_ticks` records: the newest unread run of bars one
    /// page's tick estimate fits, or the rest of the bar a page stopped inside and the run after it.
    /// `None` once every bar is whole, a bar stopped the read, or the page limit is spent.
    pub(crate) fn next_page(&mut self, max_ticks: u32) -> Option<CountsPage> {
        let page = self.planned_page(max_ticks)?;
        self.awaiting = Some(page.clone());
        self.pages += 1;
        Some(page)
    }

    /// Folds the answer to the page the read asked for in. An answer for any other page is ignored; an
    /// answer that loaded no tick of a page whose ticks exist leaves every bar as it was, so the page is
    /// asked again; and a page that certified no progress stops the bar it started in and ends the read.
    pub(crate) fn accept(&mut self, answer: &TickFootprintHistorySnapshot) {
        let Some(page) = self.asked_page(answer) else {
            return;
        };
        if answered_without_ticks(&page, answer) {
            self.retry_unloaded(&page);
            return;
        }
        self.unloaded_answers = 0;
        // A page ending where it started certified no progress. Counts cannot be resumed inside a
        // millisecond, so neither the rest of that bar nor a bar under it is read.
        if answer.through_ms <= page.from_ms {
            self.stop_in_first_bar(&page);
            return;
        }
        let whole = whole_bar_count(&page, answer);
        self.keep_whole_bars(&page, answer, whole);
        if answer.complete {
            self.counting = None;
            return;
        }
        self.continue_bar(&page, answer, whole);
    }

    /// Counts an answer that loaded no tick and stops the read in the page's first bar once the page has
    /// answered that way too often to be asked again, as the no-progress case does: the ticks may still
    /// arrive, so the bars stay unread rather than counted empty.
    fn retry_unloaded(&mut self, page: &CountsPage) {
        self.unloaded_answers += 1;
        if self.unloaded_answers > MAX_UNLOADED_RETRIES {
            self.stop_in_first_bar(page);
        }
    }

    /// Stops the read in the first bar of `page`, which keeps no ticks, and asks for no page after it.
    fn stop_in_first_bar(&mut self, page: &CountsPage) {
        self.stopped_in = page.bars.first().map(|bar| bar.open_ms);
        self.counting = None;
    }

    /// The bars the read has taken whole since the last call, keyed by their opening time.
    pub(crate) fn take_whole_bars(&mut self) -> BTreeMap<i64, Vec<FootprintTick>> {
        std::mem::take(&mut self.whole_bars)
    }

    /// The bar a page stopped the read inside, if one did.
    pub(crate) fn stopped_in(&self) -> Option<i64> {
        self.stopped_in
    }

    /// The page the answer answers, taken out of the one the read waits for: `None` when it waits for
    /// none, or for another page.
    fn asked_page(&mut self, answer: &TickFootprintHistorySnapshot) -> Option<CountsPage> {
        if !self
            .awaiting
            .as_ref()
            .is_some_and(|page| page.awaits(answer))
        {
            return None;
        }
        self.awaiting.take()
    }

    /// The page the read asks for next, or `None` when it asks for none.
    fn planned_page(&self, max_ticks: u32) -> Option<CountsPage> {
        let run = self.planned_run(max_ticks)?;
        let bars = self.bars.get(run)?;
        let start = bars.first()?;
        Some(CountsPage {
            bars: bars.to_vec(),
            from_ms: self
                .counting
                .as_ref()
                .map_or(start.open_ms, |counts| counts.through_ms),
            real_volume: start.real_volume,
            carry: self
                .counting
                .as_ref()
                .and_then(|counts| counts.carry.clone()),
        })
    }

    /// The bars the next page covers, as the half-open range of their indexes: from the bar a page
    /// stopped inside, or from the oldest bar of the newest run whose tick counts fit one page, through
    /// the newest unread bar.
    fn planned_run(&self, max_ticks: u32) -> Option<Range<usize>> {
        if self.done() {
            return None;
        }
        let newest = self.newest_unread()?;
        let first = match self.counting.as_ref() {
            // A page always names the newest unread bar last, so the rest of a half counted bar is the
            // first bar of the page that continues it.
            Some(counts) => self.bar_index(counts.span.open_ms)?,
            None => self.estimated_run_start(newest, max_ticks),
        };
        Some(first..newest + 1)
    }

    /// Whether the read asks for no more pages.
    fn done(&self) -> bool {
        self.stopped_in.is_some() || self.pages >= self.max_pages || self.newest_unread().is_none()
    }

    /// The newest bar no page has counted whole yet.
    fn newest_unread(&self) -> Option<usize> {
        self.whole.iter().rposition(|whole| !whole)
    }

    /// The index in the window of the bar opening at `open_ms`.
    fn bar_index(&self, open_ms: i64) -> Option<usize> {
        self.bars
            .binary_search_by_key(&open_ms, |bar| bar.open_ms)
            .ok()
    }

    /// The oldest bar of the run of unread bars ending at `newest` whose estimated ticks fit
    /// `max_ticks`: a page always covers the newest unread bar, and the bars under it while the estimate
    /// holds. The run stops before a bar a page already counted whole — a page is one range — before a bar
    /// whose candle reported no tick count, which is read alone, and before a bar counted under another
    /// `real_volume` rule, which one request cannot carry.
    fn estimated_run_start(&self, newest: usize, max_ticks: u32) -> usize {
        let Some(newest_bar) = self.bars.get(newest) else {
            return newest;
        };
        let Some(newest_ticks) = counted_ticks(newest_bar) else {
            return newest;
        };
        let mut counted = newest_ticks;
        let mut first = newest;
        while let Some(older) = first.checked_sub(1) {
            if self.whole.get(older).copied().unwrap_or(true) {
                break;
            }
            let Some(bar) = self.bars.get(older) else {
                break;
            };
            if bar.real_volume != newest_bar.real_volume {
                break;
            }
            let Some(older_ticks) = counted_ticks(bar) else {
                break;
            };
            let widened = counted.saturating_add(older_ticks);
            if !estimate_fits(widened, max_ticks) {
                break;
            }
            counted = widened;
            first = older;
        }
        first
    }

    /// Marks the first `count` bars of `page` whole and hands their ticks out. Each bar's levels are the
    /// ones the answer counted into it — none for a bar it left out, which counted no trade — added to
    /// the ones a page before it counted into the same bar.
    fn keep_whole_bars(
        &mut self,
        page: &CountsPage,
        answer: &TickFootprintHistorySnapshot,
        count: usize,
    ) {
        let Some(first_bar) = page.bars.first() else {
            return;
        };
        let Some(first) = self.bar_index(first_bar.open_ms) else {
            return;
        };
        for (offset, bar) in page.bars.iter().take(count).enumerate() {
            let mut levels = self.carried_levels(bar.open_ms);
            merge_levels(&mut levels, levels_of(page, answer, bar.open_ms));
            self.whole_bars
                .insert(bar.open_ms, level_ticks(bar.open_ms, &levels));
            self.mark_whole(first + offset);
        }
    }

    /// Marks the window bar at `index` whole, so that no page asks for it again.
    fn mark_whole(&mut self, index: usize) {
        if let Some(whole) = self.whole.get_mut(index) {
            *whole = true;
        }
    }

    /// The levels a page before this one counted into the bar opening at `open_ms`, taken out of the bar
    /// the read was counting, and none for any other bar: a page that continues a bar names it first.
    fn carried_levels(&mut self, open_ms: i64) -> BTreeMap<Decimal, (Decimal, Decimal)> {
        match self.counting.take() {
            Some(counts) if counts.span.open_ms == open_ms => counts.levels,
            other => {
                self.counting = other;
                BTreeMap::new()
            }
        }
    }

    /// Keeps the bar the page counted only in part, so the page after it continues from the millisecond it
    /// reached.
    fn continue_bar(
        &mut self,
        page: &CountsPage,
        answer: &TickFootprintHistorySnapshot,
        whole: usize,
    ) {
        let Some(bar) = page.bars.get(whole) else {
            return;
        };
        let mut counts = match self.counting.take() {
            Some(counts) if counts.span.open_ms == bar.open_ms => counts,
            _ => BarCounts::new(*bar),
        };
        counts.count_page(page, answer);
        self.counting = Some(counts);
    }
}

/// Whether a page of `max_ticks` records holds the bars whose candles counted `counted` ticks in all,
/// widened by the estimate margin the raw tick path sizes its pages by.
fn estimate_fits(counted: u64, max_ticks: u32) -> bool {
    widened_estimate(counted) <= u64::from(max_ticks)
}

/// How many of the page's bars the answer counted whole: every bar of a complete page, and otherwise the
/// bars whose end the page reached before it stopped.
fn whole_bar_count(page: &CountsPage, answer: &TickFootprintHistorySnapshot) -> usize {
    if answer.complete {
        return page.bars.len();
    }
    page.bars
        .partition_point(|bar| bar.end_ms <= answer.through_ms)
}

/// Whether a complete `answer` loaded no tick for `page` although the page's ticks exist: the page
/// starts at the open of its first bar — a page continuing a bar from mid-bar legitimately finds no
/// tick before the millisecond it starts at — and a bar of it counts volume under a candle that
/// reported a tick count. Such an answer says nothing about the page's trades, so it never counts a
/// bar; an incomplete answer that loaded nothing made no progress, and stops the read instead.
fn answered_without_ticks(page: &CountsPage, answer: &TickFootprintHistorySnapshot) -> bool {
    if !answer.complete || answer.loaded_ticks > 0 {
        return false;
    }
    let starts_at_open = page
        .bars
        .first()
        .is_some_and(|bar| page.from_ms == bar.open_ms);
    starts_at_open && page.bars.iter().any(|bar| counted_ticks(bar).is_some())
}

/// The levels the answer counted into the bar opening at `open_ms`: the page's entry for it, the page's
/// own levels when it asked for one bar, or none when it counted no trade into that bar.
fn levels_of<'a>(
    page: &CountsPage,
    answer: &'a TickFootprintHistorySnapshot,
    open_ms: i64,
) -> &'a [FootprintLevel] {
    if page.bars.len() == 1 {
        return &answer.levels;
    }
    match answer.bars.iter().find(|bar| bar.open_ms == open_ms) {
        Some(bar) => bar.levels.as_slice(),
        None => &[],
    }
}

/// The carry a page continuing the bar opening at `open_ms` starts from: the answer's own carry when its
/// last counted bar is that bar — or when the page asked for one bar, which is that bar — and none
/// otherwise, because a bar's open starts a fresh tick rule and the page's last trade was one of a bar
/// that has already ended.
fn continuation_carry(
    page: &CountsPage,
    answer: &TickFootprintHistorySnapshot,
    open_ms: i64,
) -> Option<FootprintCarry> {
    let counted_last = answer.bars.last().is_some_and(|bar| bar.open_ms == open_ms);
    if page.bars.len() > 1 && !counted_last {
        return None;
    }
    answer.carry.clone()
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

    /// Folds the answer to the page this read asks for in. A no-progress answer, one that loaded no tick
    /// of a bar whose candle counts trades, and one for another page leave the state unchanged, so the
    /// read asks the same page again.
    pub(crate) fn accept(&mut self, answer: &TickFootprintHistorySnapshot) {
        self.counts.accept_page(answer);
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
/// pages sum into one, and a bar's page covers that bar alone.
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
    /// end, over this bar alone.
    fn page(&self) -> CountsPage {
        CountsPage {
            bars: vec![self.span],
            from_ms: self.through_ms,
            real_volume: self.span.real_volume,
            carry: self.carry.clone(),
        }
    }

    /// Folds the answer to the page this bar's read asks for in, when it is that page and moved the bar
    /// on: its levels merge into the bar's, and its boundary and carry become the ones the next page asks
    /// from. A page of another range, one that certified no progress, and one that loaded no tick of a bar
    /// whose candle counts trades, leave the bar untouched.
    fn accept_page(&mut self, answer: &TickFootprintHistorySnapshot) {
        let continuing = self.page();
        if !continuing.awaits(answer) || answer.through_ms <= self.through_ms {
            return;
        }
        if answered_without_ticks(&continuing, answer) {
            return;
        }
        self.count_page(&continuing, answer);
    }

    /// Merges the answer to `continuing` into the bar's counts: its levels, the millisecond it reached
    /// and the carry the page after it continues from.
    fn count_page(&mut self, continuing: &CountsPage, answer: &TickFootprintHistorySnapshot) {
        let levels = levels_of(continuing, answer, self.span.open_ms);
        merge_levels(&mut self.levels, levels);
        self.through_ms = answer.through_ms;
        self.carry = continuation_carry(continuing, answer, self.span.open_ms);
    }

    /// Whether the last page read reached the bar's end, which only a complete page does on the wire's
    /// own rules.
    fn read_to_end(&self) -> bool {
        self.through_ms >= self.span.end_ms
    }

    /// The bar's trades so far, one per level and side.
    fn ticks(&self) -> Vec<FootprintTick> {
        level_ticks(self.span.open_ms, &self.levels)
    }
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
    /// Replaces the feed with a counts read of `bars` and answers the page to ask for first, covering at
    /// most `page_bound` records.
    pub(crate) fn start_counts(
        &mut self,
        bars: Vec<BarSpan>,
        page_bound: u32,
    ) -> Option<CountsPage> {
        *self = Self::default();
        self.bars = bars.clone();
        self.counts_read = CountsRead::new(bars, MAX_COUNTS_PAGES);
        self.read_started = Some(Instant::now());
        let page = self.counts_read.as_mut()?.next_page(page_bound);
        self.note_counts_page(page)
    }

    /// Folds one answered page of the counts window read in, handing the bars it took whole to the feed
    /// as it goes: the observer and the chart see them before the read ends, and a bar the read has not
    /// reached names no state at all.
    pub(crate) fn accept_counts_page(
        &mut self,
        answer: &TickFootprintHistorySnapshot,
        page_bound: u32,
    ) -> CountsOutcome {
        let Some(read) = self.counts_read.as_mut() else {
            return CountsOutcome::Idle;
        };
        read.accept(answer);
        let next_page = read.next_page(page_bound);
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

    /// Notes the counts page the read just asked for, so the timing lines cover the bars it counts and
    /// the time it takes the EA to answer it.
    fn note_counts_page(&mut self, page: Option<CountsPage>) -> Option<CountsPage> {
        self.page_bars = page.as_ref().map_or(0, |page| page.bars.len());
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

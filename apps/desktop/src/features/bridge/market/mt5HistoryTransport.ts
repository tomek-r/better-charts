import { invoke } from '@tauri-apps/api/core';
import type { HistoryTransport } from '../../chart/engine/bars/mt5DataAdapter';

/** The chart's history requests, carried by the desktop backend's bridge commands. */
export const mt5HistoryTransport: HistoryTransport = {
  requestHistory: (request) => invoke('request_history', request),
  requestHistoryPage: (request) => invoke('request_history_page', request),
};

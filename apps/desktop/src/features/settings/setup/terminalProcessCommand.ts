import { invoke } from '@tauri-apps/api/core';
import type { Mt5BackendStatus, TerminalProcess } from '../../../shared/bridge/types';

/** Whether the MetaTrader 5 terminal process runs; a rejected inspection is `unknown`, not a stopped terminal. */
export async function loadTerminalProcess(): Promise<TerminalProcess> {
  try {
    const status = await invoke<Mt5BackendStatus>('get_mt5_backend_status');
    return status.terminalProcess;
  } catch {
    return 'unknown';
  }
}

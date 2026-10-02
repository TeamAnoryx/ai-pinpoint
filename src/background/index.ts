/**
 * Service worker entry (Phase 0 stub). Phase 1 wires rpc-server and store; Phase 6 wires
 * commands and context menu. No DOM, no host knowledge, no network (ARCHITECTURE.md I1, I6).
 */
import { logger } from '@shared/logger';

const log = logger('background');

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed', details.reason);
});

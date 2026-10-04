import type { ErrorCode } from '@shared/rpc';

/** A failure with a structured code. The RPC server turns it into `{ ok: false, error }`. */
export class StoreError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

const QUOTA_MESSAGE = /quota/i;

/** chrome.storage rejects over-quota writes with a plain Error mentioning the quota. */
export function isQuotaError(err: unknown): boolean {
  return err instanceof Error && QUOTA_MESSAGE.test(err.message);
}

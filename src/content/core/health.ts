/**
 * Capability probe → degraded-mode state (ARCHITECTURE.md §10). Pure evaluation; the engine
 * owns when to probe and what to do about it.
 */
import { OBSERVER_ROOT_TIMEOUT_MS } from '@shared/constants';
import type { AdapterProbeResult } from '@content/adapters/types';

export type HealthState =
  | 'healthy'
  | 'degraded:no-mount'
  | 'degraded:no-messages'
  | 'degraded:no-thread'
  | 'disabled:adapter-error';

export interface Health {
  state: HealthState;
  /** The real adapter's probe failed and generic discovery is in use (ADAPTERS.md §6). */
  fallback: boolean;
  /** Some selector resolved only at tier 4 — host drift early warning (ADAPTERS.md §1). */
  drift: boolean;
}

export interface HealthInput {
  probe: AdapterProbeResult | null;
  /** Thread scope is transient (no id in the URL). */
  transient: boolean;
  fallback: boolean;
  drift: boolean;
  /** Milliseconds since boot; "no messages" is only reported after the boot timeout. */
  elapsedMs: number;
  adapterFailed: boolean;
}

export const HEALTHY: Health = { state: 'healthy', fallback: false, drift: false };

export function evaluateHealth(input: HealthInput): Health {
  const base = { fallback: input.fallback, drift: input.drift };
  if (input.adapterFailed) return { ...base, state: 'disabled:adapter-error' };
  const probe = input.probe;
  if (!probe || probe.messageNodes === 0) {
    const waited = input.elapsedMs >= OBSERVER_ROOT_TIMEOUT_MS;
    if (waited && !input.transient) return { ...base, state: 'degraded:no-messages' };
  }
  if (input.transient) return { ...base, state: 'degraded:no-thread' };
  if (probe && probe.messageNodes > 0 && probe.actionBarMounts === 0) {
    return { ...base, state: 'degraded:no-mount' };
  }
  return { ...base, state: 'healthy' };
}

export function sameHealth(a: Health, b: Health): boolean {
  return a.state === b.state && a.fallback === b.fallback && a.drift === b.drift;
}

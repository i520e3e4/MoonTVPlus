export const AUTOMATIC_SOURCE_SWITCH_COOLDOWN_MS = 60_000;
export const MAX_AUTOMATIC_SOURCE_SWITCHES_PER_EPISODE = 2;
export const SUSTAINED_BUFFERING_SWITCH_DELAY_MS = 12_000;

export interface PlaybackFailoverGuardState {
  switchCount: number;
  lastSwitchAt: number;
}

export type PlaybackFailoverDecision =
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'limit' };

export function createPlaybackFailoverGuardState(): PlaybackFailoverGuardState {
  return { switchCount: 0, lastSwitchAt: 0 };
}

export function resetPlaybackFailoverGuard(
  state: PlaybackFailoverGuardState
): void {
  state.switchCount = 0;
  state.lastSwitchAt = 0;
}

export function evaluatePlaybackFailover(params: {
  state: PlaybackFailoverGuardState;
  now: number;
  ignoreCooldown?: boolean;
}): PlaybackFailoverDecision {
  const { state, now, ignoreCooldown = false } = params;
  if (state.switchCount >= MAX_AUTOMATIC_SOURCE_SWITCHES_PER_EPISODE) {
    return { allowed: false, reason: 'limit' };
  }
  if (
    !ignoreCooldown &&
    state.lastSwitchAt > 0 &&
    now - state.lastSwitchAt < AUTOMATIC_SOURCE_SWITCH_COOLDOWN_MS
  ) {
    return { allowed: false, reason: 'cooldown' };
  }
  return { allowed: true };
}

export function recordPlaybackFailover(
  state: PlaybackFailoverGuardState,
  now: number
): void {
  state.switchCount += 1;
  state.lastSwitchAt = now;
}

import {
  AUTOMATIC_SOURCE_SWITCH_COOLDOWN_MS,
  createPlaybackFailoverGuardState,
  evaluatePlaybackFailover,
  recordPlaybackFailover,
  resetPlaybackFailoverGuard,
} from '../playback-failover-guard';

describe('playback failover guard', () => {
  it('blocks repeated automatic switches during the cooldown window', () => {
    const state = createPlaybackFailoverGuardState();
    recordPlaybackFailover(state, 10_000);

    expect(evaluatePlaybackFailover({ state, now: 20_000 })).toEqual({
      allowed: false,
      reason: 'cooldown',
    });
    expect(
      evaluatePlaybackFailover({
        state,
        now: 10_000 + AUTOMATIC_SOURCE_SWITCH_COOLDOWN_MS,
      })
    ).toEqual({ allowed: true });
  });

  it('allows startup failures to bypass cooldown but still enforces a limit', () => {
    const state = createPlaybackFailoverGuardState();
    recordPlaybackFailover(state, 10_000);
    expect(
      evaluatePlaybackFailover({
        state,
        now: 12_000,
        ignoreCooldown: true,
      })
    ).toEqual({ allowed: true });

    recordPlaybackFailover(state, 12_000);
    expect(
      evaluatePlaybackFailover({
        state,
        now: 14_000,
        ignoreCooldown: true,
      })
    ).toEqual({ allowed: false, reason: 'limit' });
  });

  it('resets only when starting a new episode or a manual recovery', () => {
    const state = createPlaybackFailoverGuardState();
    recordPlaybackFailover(state, 10_000);
    resetPlaybackFailoverGuard(state);
    expect(state).toEqual({ switchCount: 0, lastSwitchAt: 0 });
  });
});

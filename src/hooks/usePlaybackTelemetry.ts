'use client';

import { useCallback, useEffect, useRef } from 'react';

function createSessionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function usePlaybackTelemetry(sourceKey: string, deviceType: 'web' | 'tv') {
  const state = useRef({
    sessionId: createSessionId(),
    startedAt: Date.now(),
    bufferingCount: 0,
    reportedSuccess: false,
    reportedFailure: false,
  });

  useEffect(() => {
    state.current = {
      sessionId: createSessionId(),
      startedAt: Date.now(),
      bufferingCount: 0,
      reportedSuccess: false,
      reportedFailure: false,
    };
  }, [sourceKey]);

  const submit = useCallback(
    (payload: Record<string, unknown>) => {
      if (!sourceKey) return;
      void fetch('/api/telemetry/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          sessionId: state.current.sessionId,
          sourceKey,
          deviceType,
          bufferingCount: state.current.bufferingCount,
          ...payload,
        }),
      }).catch(() => undefined);
    },
    [deviceType, sourceKey]
  );

  const markWaiting = useCallback(() => {
    state.current.bufferingCount += 1;
    return state.current.bufferingCount;
  }, []);

  const markPlaying = useCallback(() => {
    if (state.current.reportedSuccess) return;
    state.current.reportedSuccess = true;
    submit({
      success: true,
      startupMs: Date.now() - state.current.startedAt,
    });
  }, [submit]);

  const markFailure = useCallback(
    (failureReason: string) => {
      if (state.current.reportedFailure || state.current.reportedSuccess) return;
      state.current.reportedFailure = true;
      submit({
        success: false,
        startupMs: Date.now() - state.current.startedAt,
        failureReason: failureReason.slice(0, 120),
      });
    },
    [submit]
  );

  return { markWaiting, markPlaying, markFailure };
}

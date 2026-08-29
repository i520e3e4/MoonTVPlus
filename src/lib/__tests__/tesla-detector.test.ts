import {
  getTeslaPlaybackMode,
  isTeslaWebCodecsModeEnabled,
  setTeslaPlaybackMode,
} from '@/lib/tesla-detector';

describe('Tesla playback mode', () => {
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Chrome/120',
    });
  });

  afterAll(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });
  });

  it('uses Tesla UA detection in automatic mode', () => {
    expect(getTeslaPlaybackMode()).toBe('auto');
    expect(isTeslaWebCodecsModeEnabled()).toBe(false);

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Tesla/2026.1',
    });
    expect(isTeslaWebCodecsModeEnabled()).toBe(true);
  });

  it('allows manual Tesla and standard overrides', () => {
    setTeslaPlaybackMode('tesla');
    expect(getTeslaPlaybackMode()).toBe('tesla');
    expect(isTeslaWebCodecsModeEnabled()).toBe(true);

    setTeslaPlaybackMode('standard');
    expect(getTeslaPlaybackMode()).toBe('standard');
    expect(isTeslaWebCodecsModeEnabled()).toBe(false);

    setTeslaPlaybackMode('auto');
    expect(getTeslaPlaybackMode()).toBe('auto');
  });
});

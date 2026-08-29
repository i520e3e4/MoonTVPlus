/**
 * Tesla 车机浏览器检测与 WebCodecs 播放模式开关
 */

const STORAGE_KEY = 'moontv_tesla_webcodecs_mode';

/** 通过 UA 判断是否为 Tesla 车机浏览器（宽松匹配，Tesla 浏览器 UA 含 "Tesla"） */
export function isTeslaBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /tesla/i.test(ua);
}

/**
 * 是否启用 WebCodecs 播放模式：
 *   - 用户手动开关优先；
 *   - 未设置时回退到 UA 自动检测。
 */
export function isTeslaWebCodecsModeEnabled(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'on') return true;
      if (saved === 'off') return false;
    }
  } catch {
    /* ignore */
  }
  return isTeslaBrowser();
}

/** 手动设置 WebCodecs 播放模式开关（持久化到 localStorage） */
export function setTeslaWebCodecsMode(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    }
  } catch {
    /* ignore */
  }
}

/** 清除手动开关，恢复 UA 自动检测 */
export function resetTeslaWebCodecsMode(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

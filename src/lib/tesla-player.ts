/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * libmedia 播放引擎适配层（Tesla 车载 WebCodecs 模式）
 *
 * 移植自 tesla-media-hub-cf 的 `public/js/iptv-player.js`：
 *   - 底层引擎为 libmedia（zhaohappy/libmedia）的 AVPlayer（KIT Player 封装），
 *     打包产物位于 public/assets/ 与 public/wasm/；
 *   - 完全无 `<video>` 标签：Worker 解封装 → WebCodecs 解码 → Canvas 渲染 + WebAudio 同步，
 *     从而绕过 Tesla 车机浏览器在行驶时暂停 `<video>` 的限制，实现行车连续播放。
 *
 * 对外时间单位统一为「秒（number）」；底层 KIT Player 的 currentTime/duration/seek
 * 单位均为「微秒（number）」，此处负责 /1e6 与 *1e6 的换算。
 */

/** libmedia 打包产物的入口模块（webpack chunk 入口，导出 Player 类） */
// 显式标注 string（而非字面量类型），避免 TS 对 import(GUARD_URL) 做静态模块解析报错
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
const GUARD_URL: string = '/assets/guard-e6d89b7c.js';

const DECODE_PRESET_HARDWARE = 'hardware';
const DECODE_PRESET_SOFTWARE = 'software';
// 车机弱网下硬解 15s 不出帧属正常, 软解再保留 10s
const FIRST_VIDEO_FRAME_TIMEOUT_MS = 15_000;
const FIRST_AUDIO_FRAME_TIMEOUT_MS = 22_000;
const MAX_DECODE_FALLBACK_LEVEL = 2; // hardware -> software -> 重建 (重新请求源 URL)
const MICROSECONDS_PER_SECOND = 1_000_000;
const MIN_PLAYBACK_RATE = 0.5;
const MAX_PLAYBACK_RATE = 2;

/**
 * 播放源预热：在真正创建 Player 之前先 HEAD/小段请求一次 manifest。
 * - 成功：返回原始 URL，立即交给 Player。
 * - 失败（超时/5xx）：直接抛错, 让前端 UI 触发 "使用代理播放" 按钮。
 *
 * 车机弱网场景下, 如果上游 m3u8 已经 5xx 或 DNS 失败, 不必等 libmedia
 * 内部 15s 超时才能给出错误, 用户能更快看到重试入口。
 */
async function probeSourceReachable(
  url: string,
  signal?: AbortSignal
): Promise<void> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Range: 'bytes=0-2047',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`probe HTTP ${response.status}`);
    }
    // 不消费 body, 让 libmedia 重新拉完整流
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export interface TeslaPlayerCallbacks {
  /** 首帧（视频或音频）渲染成功 */
  onFirstFrame?: () => void;
  /** 播放失败 */
  onError?: (error: Error) => void;
  /** 播放结束 */
  onEnded?: () => void;
  /** 时间更新（单位：秒） */
  onTime?: (currentTimeSeconds: number, durationSeconds: number) => void;
  /** 状态提示（如硬解回退软解） */
  onStatus?: (message: string) => void;
}

export interface TeslaPlayerOptions extends TeslaPlayerCallbacks {
  /** 是否直播模式，默认 false（点播） */
  live?: boolean;
  /** Returns true when a newer playback request has superseded this one. */
  isCancelled?: () => boolean;
}

export interface TeslaPlayerHandle {
  /** Clears the container by default; stale initializations can opt out. */
  destroy: (clearContainer?: boolean) => void;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
  /** Returns the effective rate accepted by the WebCodecs engine. */
  setPlaybackRate: (rate: number) => number;
  getCurrentTime: () => number;
  getDuration: () => number;
}

/** 检测浏览器是否具备 WebCodecs 播放能力 */
export function isWebCodecsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'VideoDecoder' in window &&
    'AudioDecoder' in window &&
    typeof window.Worker === 'function'
  );
}

let moduleCache: any = null;
let moduleLoading: Promise<any> | null = null;

function loadPlayerModule(): Promise<any> {
  if (moduleCache) return Promise.resolve(moduleCache);
  if (!moduleLoading) {
    // webpackIgnore 让 Next.js/webpack 保留为运行时动态 import（public/ 静态资产，无需打包）
    moduleLoading = import(/* webpackIgnore: true */ GUARD_URL)
      .then((mod) => {
        moduleCache = mod;
        return mod;
      })
      .catch((error) => {
        moduleLoading = null;
        throw error;
      });
  }
  return moduleLoading;
}

function toSeconds(value: unknown): number {
  if (typeof value === 'bigint') return Number(value) / MICROSECONDS_PER_SECOND;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value / MICROSECONDS_PER_SECOND : 0;
  }
  return 0;
}

/**
 * 创建并启动一个 WebCodecs 播放实例（无 `<video>` 标签）。
 * @param container 播放器挂载容器（KIT Player 会向其内部注入 canvas）
 * @param url 播放地址（HLS / MP4 / MPEG-TS 等）
 * @param opts 回调与配置
 */
export async function createTeslaPlayer(
  container: HTMLElement,
  url: string,
  opts: TeslaPlayerOptions = {}
): Promise<TeslaPlayerHandle> {
  if (!isWebCodecsSupported()) {
    throw new Error('当前浏览器不支持 WebCodecs（播放所需）');
  }

  const mod = await loadPlayerModule();
  if (opts.isCancelled?.()) {
    throw new Error('播放器初始化已取消');
  }
  const Player = mod.m || mod.default || mod.Player;
  if (typeof Player !== 'function') {
    throw new Error('播放库未导出 Player');
  }

  const live = opts.live === true;
  const errorMsg = live ? '直播源无响应' : '片源无响应';

  // 把 URL 在创建 Player 前转成绝对地址, 同时给 probe 用
  let absoluteUrl = url;
  try {
    absoluteUrl = new URL(
      url,
      typeof location !== 'undefined' ? location.href : undefined
    ).href;
  } catch {
    absoluteUrl = url;
  }

  // 预热探测：弱网下若源已经 5xx / 超时, 直接让上层 UI 触发换源/代理
  // libmedia 自身的 15s 超时在车机上往往演变成"假死几分钟"
  if (!opts.isCancelled?.()) {
    try {
      await probeSourceReachable(absoluteUrl);
    } catch (probeErr) {
      throw new Error(
        `${errorMsg}（${(probeErr as Error)?.message || '源不可达'}）`
      );
    }
    if (opts.isCancelled?.()) {
      throw new Error('播放器初始化已取消');
    }
  }

  let decodePresetId = DECODE_PRESET_HARDWARE;
  let player: any = null;
  let destroyed = false;
  // 区分视频与音频首帧, 避免音频先到触发 "firstFrame" 但画面其实黑屏
  let firstVideoOk = false;
  let firstAudioOk = false;
  let videoFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let audioFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackLevel = 0;
  // The player can be rebuilt while falling back from hardware to software
  // decoding. Keep the requested rate outside the player instance so it is
  // restored on the replacement instance as well.
  let requestedPlaybackRate = 1;

  const normalizePlaybackRate = (rate: number) => {
    if (!Number.isFinite(rate)) return 1;
    return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
  };

  const applyPlaybackRate = (rate = requestedPlaybackRate) => {
    const effectiveRate = normalizePlaybackRate(rate);
    requestedPlaybackRate = effectiveRate;
    if (!player) return effectiveRate;

    try {
      // KIT Player does not expose a public rate setter. Its `god` AVPlayer
      // does, and applies the rate to both audio tempo and video rendering.
      const god = player.god;
      if (god && typeof god.setPlaybackRate === 'function') {
        god.setPlaybackRate(effectiveRate);
      } else if (typeof player.setPlaybackRate === 'function') {
        player.setPlaybackRate(effectiveRate);
      } else if (typeof player.setPlayRate === 'function') {
        player.setPlayRate(effectiveRate);
      } else if ('playbackRate' in player) {
        player.playbackRate = effectiveRate;
      }
    } catch {
      // The requested rate remains queued and will be retried on first frame.
    }
    return effectiveRate;
  };

  const clearTimers = () => {
    if (videoFallbackTimer) {
      clearTimeout(videoFallbackTimer);
      videoFallbackTimer = null;
    }
    if (audioFallbackTimer) {
      clearTimeout(audioFallbackTimer);
      audioFallbackTimer = null;
    }
  };

  const markVideoFirstFrame = () => {
    if (firstVideoOk) return;
    firstVideoOk = true;
    // 视频先到时不等音频: 让前端尽快进入播放态
    if (videoFallbackTimer) {
      clearTimeout(videoFallbackTimer);
      videoFallbackTimer = null;
    }
    opts.onFirstFrame?.();
  };
  const markAudioFirstFrame = () => {
    if (firstAudioOk) return;
    firstAudioOk = true;
    if (audioFallbackTimer) {
      clearTimeout(audioFallbackTimer);
      audioFallbackTimer = null;
    }
  };

  const destroy = (clearContainer = true) => {
    destroyed = true;
    clearTimers();
    const current = player;
    player = null;
    if (!current) return;
    try {
      const god = current.god;
      current.god = null;
      if (god && typeof god.destroy === 'function') god.destroy();
    } catch {
      /* ignore */
    }
    try {
      if (typeof current.destroy === 'function') current.destroy();
    } catch {
      /* ignore */
    }
    if (clearContainer && container) container.innerHTML = '';
  };

  const start = async (fallback: boolean) => {
    if (destroyed || opts.isCancelled?.()) return;
    if (fallback) decodePresetId = DECODE_PRESET_SOFTWARE;

    // 重建前先销毁旧实例（切换硬/软解或重试）
    if (player) {
      try {
        if (typeof player.destroy === 'function') player.destroy();
      } catch {
        /* ignore */
      }
      player = null;
    }
    if (container) container.innerHTML = '';
    if (opts.isCancelled?.()) return;

    player = new Player({
      container,
      loop: false,
      isLive: live,
      decodePresetId,
    });
    const activePlayer = player;

    const restorePlaybackRate = () => {
      if (player === activePlayer) applyPlaybackRate();
    };

    player.on('time', () => {
      // 首帧未出来前不向外抛时间, 避免上层误判"已开始播放"
      if (firstVideoOk) {
        restorePlaybackRate();
        if (typeof opts.onTime === 'function') {
          let currentTimeSeconds = 0;
          let durationSeconds = 0;
          try {
            currentTimeSeconds = toSeconds(player.currentTime);
          } catch {
            /* ignore */
          }
          try {
            durationSeconds = toSeconds(player.duration);
          } catch {
            /* ignore */
          }
          opts.onTime(currentTimeSeconds, durationSeconds);
        }
      }
    });
    player.on('firstVideoRendered', () => {
      restorePlaybackRate();
      markVideoFirstFrame();
    });
    player.on('firstAudioRendered', () => {
      restorePlaybackRate();
      markAudioFirstFrame();
    });
    player.on('ended', () => {
      opts.onEnded?.();
    });

    try {
      if (opts.isCancelled?.()) return;
      // 确保 URL 为绝对地址：libmedia 的 IO 在 Worker 里 fetch，相对路径会解析失败
      // （MoonTVPlus 的代理地址形如 /api/proxy-m3u8?...，需基于当前页面 origin 转成绝对 URL）
      player.loadSource(absoluteUrl, { isLive: live }, true);
      // Applying after loadSource covers engines that initialise their render
      // threads during source loading rather than in the constructor.
      restorePlaybackRate();
    } catch (error) {
      opts.onError?.(error as Error);
      return;
    }

    // 首帧超时：硬解无响应则回退软解重建；软解仍无响应则重新请求源 URL 重建 (走 cold retry)。
    // 车机编码格式多, HEVC 软解也不一定出帧, 这里把第三次当作强制冷重置.
    videoFallbackTimer = setTimeout(() => {
      if (destroyed || firstVideoOk) return;
      clearTimers();
      if (fallbackLevel < MAX_DECODE_FALLBACK_LEVEL) {
        fallbackLevel += 1;
        if (decodePresetId === DECODE_PRESET_HARDWARE) {
          opts.onStatus?.('硬解无响应，切换兼容模式…');
        } else {
          opts.onStatus?.('正在重新拉取流…');
        }
        void start(fallbackLevel >= 1);
      } else {
        opts.onError?.(new Error(errorMsg));
      }
    }, FIRST_VIDEO_FRAME_TIMEOUT_MS);

    audioFallbackTimer = setTimeout(() => {
      if (destroyed || firstAudioOk) return;
      // 仅音频帧未到时不再重建 player, 但给上层一个提示 (音画同步异常多源自此)
      console.warn('[Tesla Player] 音频帧超时未渲染, 可能音画不同步');
    }, FIRST_AUDIO_FRAME_TIMEOUT_MS);
  };

  await start(false);

  return {
    destroy,
    pause() {
      try {
        if (player && typeof player.pause === 'function') player.pause();
      } catch {
        /* ignore */
      }
    },
    resume() {
      try {
        if (player && typeof player.play === 'function') player.play();
      } catch {
        /* ignore */
      }
    },
    seek(seconds: number) {
      try {
        if (!player) return;
        const target = Math.max(0, Number(seconds) * MICROSECONDS_PER_SECOND);
        if (typeof player.seek === 'function') {
          player.seek(target);
        } else {
          player.currentTime = target;
        }
      } catch {
        /* ignore */
      }
    },
    setPlaybackRate(rate: number) {
      return applyPlaybackRate(rate);
    },
    getCurrentTime() {
      try {
        return toSeconds(player?.currentTime);
      } catch {
        return 0;
      }
    },
    getDuration() {
      try {
        return toSeconds(player?.duration);
      } catch {
        return 0;
      }
    },
  };
}

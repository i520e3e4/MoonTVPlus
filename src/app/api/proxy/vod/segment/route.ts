/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { validateProxyUrlServerSide } from '@/lib/server/ssrf';
import { buildProxyStreamHeaders } from '@/lib/server/proxy-headers';

export const runtime = 'nodejs';

/**
 * 带超时与重试的上游分片拉取。Cloudflare Worker 单请求 30s CPU 配额非常紧张,
 * 车机弱网下分片往往 hang 住超过 30s, 这里主动 12s abort 并重试 1 次,
 * 仍失败则直接向客户端抛 504, 让 HLS.js / libmedia 走分片重试或切线路。
 */
async function fetchSegmentWithRetry(
  url: string,
  options: { timeoutMs?: number; referer: string; signal?: AbortSignal } = {
    referer: '',
  }
): Promise<Response> {
  const { timeoutMs = 12_000, referer, signal: outerSignal } = options;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort();
      else outerSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': referer,
        },
      });
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);

      if (
        response.ok ||
        (response.status >= 400 && response.status < 500)
      ) {
        return response;
      }

      // 5xx 重试
      console.warn(
        `[Proxy-Segment] upstream ${new URL(url).host} returned ${response.status}, attempt ${attempt}/${maxAttempts}`
      );
      try {
        await response.text();
      } catch {
        /* ignore */
      }
    } catch (error) {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
      console.warn(
        `[Proxy-Segment] attempt ${attempt}/${maxAttempts} failed:`,
        (error as Error)?.message
      );
      if (attempt >= maxAttempts) {
        throw error;
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }

  throw new Error('segment fetch exhausted retries');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  if (!source) {
    return NextResponse.json({ error: 'Missing source' }, { status: 400 });
  }

  // 定义直链播放模式常量
  const DIRECT_PLAY_SOURCE = 'directplay';

  // 直链播放模式：跳过源站配置检查，直接代理
  if (source !== DIRECT_PLAY_SOURCE) {
    // 检查该视频源是否启用了代理模式
    const config = await getConfig();
    const videoSource = config.SourceConfig?.find((s: any) => s.key === source);

    if (!videoSource) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    if (!videoSource.proxyMode) {
      return NextResponse.json({ error: 'Proxy mode not enabled for this source' }, { status: 403 });
    }
  }

  let response: Response | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const decodedUrl = decodeURIComponent(url);

    // 安全校验：防 SSRF 拦截请求内网或非法 URL (强制检查所有代理请求)
    const isSafeUrl = await validateProxyUrlServerSide(decodedUrl);
    if (!isSafeUrl) {
      return NextResponse.json({ error: 'Proxy request to local or invalid network is forbidden' }, { status: 403 });
    }

    response = await fetchSegmentWithRetry(decodedUrl, {
      referer: decodedUrl,
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 });
    }

    const headers = buildProxyStreamHeaders(
      response.headers.get('Content-Type') || 'video/mp2t',
      response.headers.get('content-length')
    );

    // 使用流式传输，避免占用内存
    let isCancelled = false;

    const stream = new ReadableStream({
      start(controller) {
        if (!response?.body) {
          controller.close();
          return;
        }

        reader = response.body.getReader();

        function pump() {
          if (isCancelled || !reader) {
            return;
          }

          reader.read().then(({ done, value }) => {
            if (isCancelled) {
              return;
            }

            if (done) {
              controller.close();
              cleanup();
              return;
            }

            controller.enqueue(value);
            pump();
          }).catch((error) => {
            if (!isCancelled) {
              controller.error(error);
              cleanup();
            }
          });
        }

        function cleanup() {
          if (reader) {
            try {
              reader.releaseLock();
            } catch (e) {
              // reader 可能已经被释放，忽略错误
            }
            reader = null;
          }
        }

        pump();
      },
      cancel() {
        isCancelled = true;
        // 当流被取消时，确保释放所有资源
        if (reader) {
          try {
            reader.releaseLock();
          } catch (e) {
            // reader 可能已经被释放，忽略错误
          }
          reader = null;
        }

        if (response?.body) {
          try {
            response.body.cancel();
          } catch (e) {
            // 忽略取消时的错误
          }
        }
      }
    });

    return new Response(stream, { headers });
  } catch (error) {
    // 确保在错误情况下也释放资源
    if (reader) {
      try {
        (reader as ReadableStreamDefaultReader<Uint8Array>).releaseLock();
      } catch (e) {
        // 忽略错误
      }
    }

    if (response?.body) {
      try {
        response.body.cancel();
      } catch (e) {
        // 忽略错误
      }
    }

    return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 });
  }
}

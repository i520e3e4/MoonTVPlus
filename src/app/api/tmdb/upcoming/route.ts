import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getTMDBUpcomingContent } from '@/lib/tmdb.client';

// 内存缓存对象
interface CacheItem {
  data: any;
  timestamp: number;
}

let cache: CacheItem | null = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1小时（毫秒）

// 该接口原先只做进程内缓存，未下发任何 HTTP 缓存头，
// 导致浏览器与 Cloudflare 边缘每次都要回源。补上后可被边缘直接命中。
const CACHE_MAX_AGE_SECONDS = 3600;
const cacheHeaders = {
  'Cache-Control': `public, max-age=${CACHE_MAX_AGE_SECONDS}, s-maxage=${CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=86400`,
  'CDN-Cache-Control': `public, s-maxage=${CACHE_MAX_AGE_SECONDS}`,
};

export async function GET(request: NextRequest) {
  try {
    // 检查缓存是否存在且未过期
    const now = Date.now();
    if (cache && now - cache.timestamp < CACHE_DURATION) {
      return NextResponse.json(
        {
          code: 200,
          data: cache.data,
          cached: true,
          cacheAge: Math.floor((now - cache.timestamp) / 1000), // 缓存年龄（秒）
        },
        { headers: cacheHeaders }
      );
    }

    // 缓存不存在或已过期，获取新数据
    const config = await getConfig();
    const tmdbApiKey = config.SiteConfig?.TMDBApiKey;
    const tmdbProxy = config.SiteConfig?.TMDBProxy;
    const tmdbReverseProxy = config.SiteConfig?.TMDBReverseProxy;

    if (!tmdbApiKey) {
      return NextResponse.json(
        { code: 400, message: 'TMDB API Key 未配置' },
        { status: 400 }
      );
    }

    // 调用TMDB API获取数据
    const result = await getTMDBUpcomingContent(tmdbApiKey, tmdbProxy, tmdbReverseProxy);

    if (result.code !== 200) {
      return NextResponse.json(
        { code: result.code, message: '获取TMDB数据失败' },
        { status: result.code === 401 ? 401 : 500 }
      );
    }

    // 更新缓存
    cache = {
      data: result.list,
      timestamp: now,
    };

    return NextResponse.json(
      {
        code: 200,
        data: result.list,
        cached: false,
      },
      { headers: cacheHeaders }
    );
  } catch (error) {
    console.error('获取TMDB即将上映数据失败:', error);
    return NextResponse.json(
      { code: 500, message: '服务器内部错误' },
      { status: 500 }
    );
  }
}

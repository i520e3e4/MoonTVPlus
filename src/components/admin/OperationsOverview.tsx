'use client';

import {
  Activity,
  Gauge,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Overview {
  configuredSources: number;
  totalSources: number;
  healthySources: number;
  degradedSources: number;
  circuitOpenSources: number;
  searchSuccessRate: number;
  playbackSuccessRate: number;
  averageStartupMs: number;
  generatedAt: string;
}

interface SourceRow {
  key: string;
  name: string;
  healthScore: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  consecutiveFailures: number;
  averageStartupMs: number;
  bufferingCount: number;
  adSegments: number;
  circuitOpen: boolean;
}

const percent = (value: number) =>
  value > 0 ? `${(value * 100).toFixed(1)}%` : '暂无数据';

export default function OperationsOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewResponse, sourcesResponse] = await Promise.all([
        fetch('/api/admin/overview', { cache: 'no-store' }),
        fetch('/api/admin/source-health', { cache: 'no-store' }),
      ]);
      if (!overviewResponse.ok || !sourcesResponse.ok) {
        throw new Error('健康数据加载失败');
      }
      const [overviewData, sourceData] = await Promise.all([
        overviewResponse.json(),
        sourcesResponse.json(),
      ]);
      setOverview(overviewData);
      setSources(sourceData.sources || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const visibleSources = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    return keyword
      ? sources.filter(
          (source) =>
            source.name.toLowerCase().includes(keyword) ||
            source.key.toLowerCase().includes(keyword)
        )
      : sources;
  }, [filter, sources]);

  const recheckWeakSources = async () => {
    const keys = sources
      .filter((source) => source.healthScore < 70 || source.circuitOpen)
      .slice(0, 12)
      .map((source) => source.key);
    if (keys.length === 0) return;
    setRechecking(true);
    try {
      await fetch('/api/admin/source-health/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      await refresh();
    } finally {
      setRechecking(false);
    }
  };

  const cards = [
    {
      label: '已配置资源',
      value: overview?.configuredSources ?? '—',
      detail: `${overview?.healthySources ?? 0} 个健康`,
      icon: Server,
    },
    {
      label: '搜索成功率',
      value: overview ? percent(overview.searchSuccessRate) : '—',
      detail: '渐进式 4 × 3 调度',
      icon: Zap,
    },
    {
      label: '播放成功率',
      value: overview ? percent(overview.playbackSuccessRate) : '—',
      detail: '按播放汇总事件计算',
      icon: ShieldCheck,
    },
    {
      label: '平均首帧',
      value: overview?.averageStartupMs
        ? `${(overview.averageStartupMs / 1000).toFixed(1)}s`
        : '暂无数据',
      detail: `${overview?.circuitOpenSources ?? 0} 个源熔断`,
      icon: Gauge,
    },
  ];

  return (
    <section className='mb-6 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-black/20 backdrop-blur-xl'>
      <div className='flex flex-col gap-4 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-violet-500/10 p-5 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <div className='flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300'>
            <Activity size={15} />
            Operations center
          </div>
          <h2 className='mt-1 text-xl font-semibold text-white'>运行概览与资源健康</h2>
          <p className='mt-1 text-sm text-slate-400'>
            搜索、播放、熔断和首帧指标均来自匿名聚合事件。
          </p>
        </div>
        <div className='flex gap-2'>
          <button
            onClick={() => refresh()}
            className='rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/10'
          >
            刷新
          </button>
          <button
            onClick={recheckWeakSources}
            disabled={rechecking}
            className='flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50'
          >
            <RefreshCw size={15} className={rechecking ? 'animate-spin' : ''} />
            检测低分源
          </button>
        </div>
      </div>

      <div className='grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4'>
        {cards.map(({ label, value, detail, icon: Icon }) => (
          <div
            key={label}
            className='rounded-xl border border-white/10 bg-white/[0.04] p-4'
          >
            <div className='flex items-center justify-between text-sm text-slate-400'>
              {label}
              <Icon size={17} className='text-cyan-300' />
            </div>
            <div className='mt-2 text-2xl font-semibold text-white'>
              {loading ? '…' : value}
            </div>
            <div className='mt-1 text-xs text-slate-500'>{detail}</div>
          </div>
        ))}
      </div>

      <div className='border-t border-white/10 p-4'>
        <div className='mb-3 flex items-center justify-between gap-3'>
          <h3 className='font-medium text-white'>资源中心</h3>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder='筛选名称或 key'
            className='w-48 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400'
          />
        </div>
        <div className='max-h-80 overflow-auto rounded-xl border border-white/10'>
          <table className='w-full min-w-[720px] text-left text-sm'>
            <thead className='sticky top-0 z-10 bg-slate-900 text-xs uppercase text-slate-400'>
              <tr>
                <th className='px-4 py-3'>资源</th>
                <th className='px-4 py-3'>健康度</th>
                <th className='px-4 py-3'>P50 / P95</th>
                <th className='px-4 py-3'>首帧</th>
                <th className='px-4 py-3'>缓冲 / 广告</th>
                <th className='px-4 py-3'>状态</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-white/5'>
              {visibleSources.map((source) => (
                <tr key={source.key} className='text-slate-300 hover:bg-white/5'>
                  <td className='px-4 py-3'>
                    <div className='font-medium text-white'>{source.name}</div>
                    <div className='text-xs text-slate-500'>{source.key}</div>
                  </td>
                  <td className='px-4 py-3'>
                    <span
                      className={
                        source.healthScore >= 70
                          ? 'text-emerald-300'
                          : source.healthScore >= 50
                          ? 'text-amber-300'
                          : 'text-rose-300'
                      }
                    >
                      {source.healthScore.toFixed(0)}
                    </span>
                  </td>
                  <td className='px-4 py-3'>
                    {source.p50LatencyMs || 0} / {source.p95LatencyMs || 0} ms
                  </td>
                  <td className='px-4 py-3'>
                    {source.averageStartupMs
                      ? `${(source.averageStartupMs / 1000).toFixed(1)}s`
                      : '—'}
                  </td>
                  <td className='px-4 py-3'>
                    {source.bufferingCount} / {source.adSegments}
                  </td>
                  <td className='px-4 py-3'>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        source.circuitOpen
                          ? 'bg-rose-500/15 text-rose-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                      }`}
                    >
                      {source.circuitOpen ? '熔断' : '在线'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


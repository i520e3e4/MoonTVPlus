#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const timeoutMs = Number(args.get('--timeout') || 6000);
const concurrency = Math.max(1, Number(args.get('--concurrency') || 6));
const queries = (args.get('--queries') || '哪吒之魔童闹海,流浪地球')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

async function readInput() {
  if (args.has('--file')) return readFile(args.get('--file'), 'utf8');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function extractSources(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed) && parsed.every((item) => item?.api)) return parsed;
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results || [])
    : [];
  const encoded = rows.find((row) => typeof row?.sources === 'string')?.sources;
  if (!encoded)
    throw new Error(
      'Input does not contain a source array or D1 sources field'
    );
  return JSON.parse(encoded);
}

async function fetchTimed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'MoonTVPlus-Source-Audit/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    return { response, latencyMs: Math.round(performance.now() - startedAt) };
  } finally {
    clearTimeout(timer);
  }
}

function collectM3u8(items) {
  for (const item of items) {
    const value = String(item?.vod_play_url || '');
    const match = value.match(/https?:\/\/[^$#\s]+\.m3u8(?:\?[^$#\s]*)?/i);
    if (match) return match[0];
  }
  return null;
}

function readResolution(manifest) {
  const matches = [...manifest.matchAll(/RESOLUTION=(\d+)x(\d+)/gi)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[2])));
}

async function auditSource(site) {
  const result = {
    key: site.key,
    name: site.name,
    protocol: String(site.api).startsWith('https://') ? 'https' : 'http',
    searchesOk: 0,
    resultCount: 0,
    medianSearchMs: null,
    manifestOk: false,
    manifestMs: null,
    maxHeight: null,
    error: null,
  };
  const latencies = [];
  let manifestUrl = null;

  try {
    for (const query of queries) {
      const separator = site.api.includes('?') ? '&' : '?';
      const url = `${site.api}${separator}ac=videolist&wd=${encodeURIComponent(
        query
      )}`;
      const { response, latencyMs } = await fetchTimed(url);
      if (!response.ok) throw new Error(`search-http-${response.status}`);
      const data = await response.json();
      const items = Array.isArray(data?.list) ? data.list : [];
      result.searchesOk += 1;
      result.resultCount += items.length;
      latencies.push(latencyMs);
      manifestUrl ||= collectM3u8(items);
    }

    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      result.medianSearchMs = latencies[Math.floor(latencies.length / 2)];
    }

    if (manifestUrl) {
      const { response, latencyMs } = await fetchTimed(manifestUrl);
      result.manifestMs = latencyMs;
      if (response.ok) {
        const manifest = await response.text();
        result.manifestOk = manifest.includes('#EXTM3U');
        result.maxHeight = readResolution(manifest);
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  const searchRate = result.searchesOk / Math.max(1, queries.length);
  const latencyScore =
    result.medianSearchMs === null
      ? 0
      : Math.max(0, 1 - result.medianSearchMs / 6000);
  const playableScore = result.manifestOk ? 1 : 0;
  const resolutionScore = result.maxHeight
    ? Math.min(1, result.maxHeight / 1080)
    : result.manifestOk
    ? 0.5
    : 0;
  const protocolScore = result.protocol === 'https' ? 1 : 0;
  result.auditScore =
    Math.round(
      (searchRate * 25 +
        latencyScore * 20 +
        playableScore * 35 +
        resolutionScore * 15 +
        protocolScore * 5) *
        10
    ) / 10;
  return result;
}

async function mapConcurrent(items, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        output[index] = await worker(items[index]);
      }
    })
  );
  return output;
}

const sources = extractSources(await readInput());
const results = await mapConcurrent(
  sources.filter((site) => !site.disabled),
  auditSource
);
results.sort(
  (a, b) => b.auditScore - a.auditScore || a.key.localeCompare(b.key)
);
process.stdout.write(
  `${JSON.stringify(
    { auditedAt: new Date().toISOString(), queries, results },
    null,
    2
  )}\n`
);

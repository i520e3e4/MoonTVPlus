export interface ProgressiveProbeOptions {
  batchSize: number;
  maxCandidates: number;
  enoughSuccessfulResults: number;
  shouldStop?: (
    results: Array<ProgressiveProbeResult<unknown, unknown>>
  ) => boolean;
}

export interface ProgressiveProbeResult<TCandidate, TResult> {
  candidate: TCandidate;
  result: TResult | null;
}

/**
 * Probe candidates in small, ordered waves. This keeps a large source list
 * from opening dozens of manifests and media fragments at the same time.
 */
export async function probeCandidatesProgressively<
  TCandidate,
  TResult
>(params: {
  candidates: TCandidate[];
  probe: (candidate: TCandidate) => Promise<TResult | null>;
  options: ProgressiveProbeOptions;
}): Promise<Array<ProgressiveProbeResult<TCandidate, TResult>>> {
  const { candidates, probe, options } = params;
  const batchSize = Math.max(1, Math.floor(options.batchSize));
  const maxCandidates = Math.min(
    candidates.length,
    Math.max(1, Math.floor(options.maxCandidates))
  );
  const enoughSuccessfulResults = Math.max(
    1,
    Math.floor(options.enoughSuccessfulResults)
  );
  const results: Array<ProgressiveProbeResult<TCandidate, TResult>> = [];
  let successfulResults = 0;

  for (let start = 0; start < maxCandidates; start += batchSize) {
    const batch = candidates.slice(
      start,
      Math.min(start + batchSize, maxCandidates)
    );
    const batchResults = await Promise.all(
      batch.map(async (candidate) => {
        try {
          return { candidate, result: await probe(candidate) };
        } catch {
          return { candidate, result: null };
        }
      })
    );
    results.push(...batchResults);
    successfulResults += batchResults.filter(
      (item) => item.result !== null
    ).length;

    const customStop = options.shouldStop?.(
      results as Array<ProgressiveProbeResult<unknown, unknown>>
    );
    if (customStop || successfulResults >= enoughSuccessfulResults) break;
  }

  return results;
}

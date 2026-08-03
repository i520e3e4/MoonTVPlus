import { probeCandidatesProgressively } from '../source-probe-plan';

describe('progressive playback probes', () => {
  it('stops after the first healthy wave', async () => {
    const visited: number[] = [];
    const results = await probeCandidatesProgressively({
      candidates: [1, 2, 3, 4, 5, 6],
      probe: async (candidate) => {
        visited.push(candidate);
        return candidate;
      },
      options: {
        batchSize: 3,
        maxCandidates: 6,
        enoughSuccessfulResults: 3,
      },
    });

    expect(visited).toEqual([1, 2, 3]);
    expect(results.map((item) => item.candidate)).toEqual([1, 2, 3]);
  });

  it('continues with the next ordered wave when probes fail', async () => {
    const visited: number[] = [];
    const results = await probeCandidatesProgressively({
      candidates: [1, 2, 3, 4, 5, 6],
      probe: async (candidate) => {
        visited.push(candidate);
        return candidate >= 3 ? candidate : null;
      },
      options: {
        batchSize: 2,
        maxCandidates: 6,
        enoughSuccessfulResults: 2,
      },
    });

    expect(visited).toEqual([1, 2, 3, 4]);
    expect(results.filter((item) => item.result !== null)).toHaveLength(2);
  });

  it('keeps scanning when successful results have not met a quality gate', async () => {
    const visited: number[] = [];
    const results = await probeCandidatesProgressively({
      candidates: [720, 720, 720, 1080, 720, 720],
      probe: async (candidate) => {
        visited.push(candidate);
        return candidate;
      },
      options: {
        batchSize: 3,
        maxCandidates: 6,
        enoughSuccessfulResults: Number.MAX_SAFE_INTEGER,
        shouldStop: (items) =>
          items.filter((item) => item.result !== null).length >= 3 &&
          items.some((item) => item.result === 1080),
      },
    });

    expect(visited).toEqual([720, 720, 720, 1080, 720, 720]);
    expect(results).toHaveLength(6);
  });
});

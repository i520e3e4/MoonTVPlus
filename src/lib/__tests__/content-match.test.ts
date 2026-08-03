import {
  calculateContentMatchScore,
  normalizeContentTitle,
} from '../content-match';

describe('content match scoring', () => {
  it('normalizes punctuation, spaces and full-width text', () => {
    expect(normalizeContentTitle('《凡人 修仙传》（2020）')).toBe(
      '凡人修仙传2020'
    );
  });

  it('accepts a recognized season or edition suffix', () => {
    expect(
      calculateContentMatchScore({
        requestedTitle: '凡人修仙传',
        candidateTitle: '凡人修仙传年番',
      })
    ).toBeGreaterThanOrEqual(90);
  });

  it('penalizes a different release year', () => {
    const sameYear = calculateContentMatchScore({
      requestedTitle: '英雄',
      candidateTitle: '英雄',
      requestedYear: '2002',
      candidateYear: '2002',
    });
    const remake = calculateContentMatchScore({
      requestedTitle: '英雄',
      candidateTitle: '英雄',
      requestedYear: '2002',
      candidateYear: '2025',
    });
    expect(sameYear - remake).toBe(28);
  });

  it('does not accept an unrelated longer title for a short query', () => {
    expect(
      calculateContentMatchScore({
        requestedTitle: '英雄',
        candidateTitle: '英雄联盟',
      })
    ).toBe(0);
  });

  it('rejects conflicting identity metadata', () => {
    expect(
      calculateContentMatchScore({
        requestedTitle: '英雄',
        candidateTitle: '英雄',
        requestedDoubanId: 1295644,
        candidateDoubanId: 9999999,
      })
    ).toBe(0);
  });
});

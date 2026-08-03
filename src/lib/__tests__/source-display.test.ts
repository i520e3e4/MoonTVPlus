import {
  getSourceDisplayLabel,
  getSourceDisplayName,
  isCorruptedSourceName,
} from '../source-display';

describe('source display labels', () => {
  it('repairs known source names corrupted during config import', () => {
    expect(isCorruptedSourceName('??????')).toBe(true);
    expect(getSourceDisplayName('jinying', '??????')).toBe('金鹰资源');
    expect(getSourceDisplayLabel('jinying', '??????')).toBe(
      '金鹰资源 · jinying'
    );
  });

  it('keeps valid configured names and always exposes the interface key', () => {
    expect(getSourceDisplayLabel('custom', '自建高清源')).toBe(
      '自建高清源 · custom'
    );
  });

  it('uses the interface key when an unknown name is corrupted', () => {
    expect(getSourceDisplayName('custom', '���')).toBe('接口 custom');
  });
});

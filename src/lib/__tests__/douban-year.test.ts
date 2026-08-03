import {
  ALL_DOUBAN_YEARS,
  createDoubanYearOptions,
  filterDoubanItemsByYear,
} from '../douban-year';

const items = [
  { id: '1', title: 'A', poster: '', rate: '', year: '2026' },
  { id: '2', title: 'B', poster: '', rate: '', year: '2025-01-01' },
  { id: '3', title: 'C', poster: '', rate: '', year: '' },
];

describe('douban year filtering', () => {
  it('keeps the original list when all years are selected', () => {
    expect(filterDoubanItemsByYear(items, ALL_DOUBAN_YEARS)).toBe(items);
  });

  it('matches the exact release year', () => {
    expect(filterDoubanItemsByYear(items, '2025')).toEqual([items[1]]);
  });

  it('builds descending year options with an all-years entry', () => {
    expect(createDoubanYearOptions(2026, 2024)).toEqual([
      { label: '全部年份', value: 'all' },
      { label: '2026', value: '2026' },
      { label: '2025', value: '2025' },
      { label: '2024', value: '2024' },
    ]);
  });
});

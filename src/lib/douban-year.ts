import type { DoubanItem } from './types';

export const ALL_DOUBAN_YEARS = 'all';

export interface DoubanYearOption {
  label: string;
  value: string;
}

export function createDoubanYearOptions(
  currentYear = new Date().getFullYear(),
  earliestYear = 1950
): DoubanYearOption[] {
  const options: DoubanYearOption[] = [
    { label: '全部年份', value: ALL_DOUBAN_YEARS },
  ];

  for (let year = currentYear; year >= earliestYear; year -= 1) {
    options.push({ label: String(year), value: String(year) });
  }

  return options;
}

export function filterDoubanItemsByYear(
  items: DoubanItem[],
  selectedYear: string
): DoubanItem[] {
  if (!selectedYear || selectedYear === ALL_DOUBAN_YEARS) {
    return items;
  }

  return items.filter((item) => {
    const itemYear = String(item.year || '').match(/(?:19|20)\d{2}/)?.[0];
    return itemYear === selectedYear;
  });
}

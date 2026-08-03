const KNOWN_SOURCE_NAMES: Record<string, string> = {
  jinying: '金鹰资源',
  haohua: '豪华资源',
  huya: '虎牙资源',
  subo: '速播资源',
  guangsu: '光速资源',
  hongniu: '红牛资源',
  dazhong: '大众资源',
  modu: '魔都动漫',
  ikun: 'ikun资源',
  iqiyi: '爱奇艺资源',
  ruyi: '如意资源',
};

export function isCorruptedSourceName(value?: string | null): boolean {
  const normalized = value?.trim() || '';
  if (!normalized) return true;

  return (
    /^[?？�\s]+$/.test(normalized) ||
    normalized.includes('Ã') ||
    normalized.includes('Â') ||
    normalized.includes('锟斤拷')
  );
}

export function getSourceDisplayName(
  sourceKey: string,
  sourceName?: string | null
): string {
  if (!isCorruptedSourceName(sourceName))
    return sourceName?.trim() || sourceKey;
  return KNOWN_SOURCE_NAMES[sourceKey] || `接口 ${sourceKey}`;
}

export function getSourceDisplayLabel(
  sourceKey: string,
  sourceName?: string | null
): string {
  const name = getSourceDisplayName(sourceKey, sourceName);
  return name === sourceKey ? sourceKey : `${name} · ${sourceKey}`;
}

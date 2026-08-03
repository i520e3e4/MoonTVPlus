export interface ContentMatchInput {
  requestedTitle: string;
  candidateTitle: string;
  requestedYear?: string;
  candidateYear?: string;
  requestedDoubanId?: number;
  candidateDoubanId?: number;
}

function normalizeFullWidth(value: string): string {
  return value.replace(/[\uff01-\uff5e]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0)
  );
}

export function normalizeContentTitle(value: string): string {
  return normalizeFullWidth(value || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(
      /[《》〈〉「」『』【】[\]()（）{}<>·•・:：,，.。!！?？'"“”‘’_-]/g,
      ''
    );
}

function bigrams(value: string): Set<string> {
  const output = new Set<string>();
  if (value.length < 2) {
    if (value) output.add(value);
    return output;
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    output.add(value.slice(index, index + 2));
  }
  return output;
}

function titleSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (longer.startsWith(shorter)) {
    const suffix = longer.slice(shorter.length);
    const recognizedEdition =
      /^(第?[0-9一二三四五六七八九十百]+[季部篇章]|[\u4e00-\u9fff]{1,8}篇|年番|特别篇|特別篇|完结篇|完結篇|重制版|重製版|剧场版|劇場版|season[0-9]+|s[0-9]+)$/i.test(
        suffix
      );
    if (recognizedEdition) return 0.94;
    const containmentRatio = shorter.length / longer.length;
    if (shorter.length >= 4 && containmentRatio >= 0.7) {
      return Math.max(0.82, containmentRatio);
    }
  }

  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  let overlap = 0;
  leftPairs.forEach((pair) => {
    if (rightPairs.has(pair)) overlap += 1;
  });
  return (2 * overlap) / Math.max(1, leftPairs.size + rightPairs.size);
}

function normalizeYear(value?: string): string | null {
  const match = value?.match(/(?:19|20)\d{2}/);
  return match?.[0] || null;
}

/**
 * Returns a conservative 0-100 confidence that two search results describe
 * the same work. Identity metadata wins; title similarity is then adjusted by
 * year so a fast stream from the wrong remake cannot outrank the right item.
 */
export function calculateContentMatchScore(input: ContentMatchInput): number {
  if (
    input.requestedDoubanId &&
    input.candidateDoubanId &&
    input.requestedDoubanId !== input.candidateDoubanId
  ) {
    return 0;
  }
  if (
    input.requestedDoubanId &&
    input.candidateDoubanId === input.requestedDoubanId
  ) {
    return 100;
  }

  const requested = normalizeContentTitle(input.requestedTitle);
  const candidate = normalizeContentTitle(input.candidateTitle);
  const similarity = titleSimilarity(requested, candidate);
  if (similarity < 0.72) return 0;

  let score = similarity * 100;
  const requestedYear = normalizeYear(input.requestedYear);
  const candidateYear = normalizeYear(input.candidateYear);
  if (requestedYear && candidateYear && requestedYear !== candidateYear) {
    score -= 28;
  } else if (requestedYear && !candidateYear) {
    score -= 3;
  }

  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
}

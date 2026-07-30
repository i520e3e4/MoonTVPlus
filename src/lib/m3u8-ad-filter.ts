export interface AdFilterRule {
  sourceKey: string;
  blockedDomains: string[];
  pathPatterns: string[];
  maxIntroAdSeconds: number;
  removeScte35: boolean;
  enabled: boolean;
}

export interface AdFilterDecision {
  line: number;
  uri: string;
  duration: number;
  confidence: number;
  reasons: string[];
  removed: boolean;
}

export interface AdFilterResult {
  content: string;
  decisions: AdFilterDecision[];
  removedSegments: number;
  fellBack: boolean;
}

export const DEFAULT_AD_FILTER_RULE: AdFilterRule = {
  sourceKey: '*',
  blockedDomains: ['ads.example'],
  pathPatterns: [
    '/ad/',
    '/ads/',
    '/advert/',
    '/advertisement/',
    '/adjump',
    'redtraffic',
    'sponsor',
  ],
  maxIntroAdSeconds: 45,
  removeScte35: true,
  enabled: true,
};

function parseDuration(line: string): number {
  const match = line.match(/^#EXTINF:([\d.]+)/i);
  return match ? Number(match[1]) || 0 : 0;
}

function getHostname(uri: string): string {
  try {
    return new URL(uri, 'https://relative.invalid').hostname.toLowerCase();
  } catch {
    return '';
  }
}

function selectRules(
  sourceKey: string,
  rules: AdFilterRule[]
): AdFilterRule[] {
  const enabled = rules.filter(
    (rule) =>
      rule.enabled && (rule.sourceKey === '*' || rule.sourceKey === sourceKey)
  );
  return enabled.length > 0 ? enabled : [DEFAULT_AD_FILTER_RULE];
}

function scoreSegment(params: {
  uri: string;
  duration: number;
  inCue: boolean;
  introElapsed: number;
  rules: AdFilterRule[];
}): { confidence: number; reasons: string[] } {
  const { uri, duration, inCue, introElapsed, rules } = params;
  const lowerUri = uri.toLowerCase();
  const hostname = getHostname(uri);
  let confidence = 0;
  const reasons: string[] = [];

  for (const rule of rules) {
    if (
      rule.blockedDomains.some(
        (domain) =>
          hostname === domain.toLowerCase() ||
          hostname.endsWith(`.${domain.toLowerCase()}`)
      )
    ) {
      confidence = Math.max(confidence, 0.98);
      reasons.push('blocked-domain');
    }

    if (
      rule.pathPatterns.some((pattern) =>
        lowerUri.includes(pattern.toLowerCase())
      )
    ) {
      confidence = Math.max(confidence, 0.96);
      reasons.push('path-pattern');
    }

    if (inCue && rule.removeScte35) {
      confidence = Math.max(confidence, 1);
      reasons.push('scte35-or-daterange');
    }

    // Intro duration is only supporting evidence. It never removes a segment
    // by itself because short legitimate openings are common.
    if (
      rule.maxIntroAdSeconds > 0 &&
      introElapsed <= rule.maxIntroAdSeconds &&
      duration > 0 &&
      duration <= 6 &&
      confidence >= 0.65
    ) {
      confidence = Math.min(1, confidence + 0.03);
      reasons.push('intro-short-segment');
    }
  }

  return { confidence, reasons: Array.from(new Set(reasons)) };
}

export function filterM3u8Ads(params: {
  sourceKey?: string;
  content: string;
  rules?: AdFilterRule[];
  removeThreshold?: number;
}): AdFilterResult {
  const {
    sourceKey = '',
    content,
    rules = [DEFAULT_AD_FILTER_RULE],
    removeThreshold = 0.9,
  } = params;
  if (!content || !content.trimStart().startsWith('#EXT')) {
    return { content, decisions: [], removedSegments: 0, fellBack: false };
  }

  const selectedRules = selectRules(sourceKey, rules);
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  const decisions: AdFilterDecision[] = [];
  let inCue = false;
  let introElapsed = 0;
  let mediaSegments = 0;
  let keptSegments = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const upperLine = line.toUpperCase();

    if (
      upperLine.startsWith('#EXT-X-CUE-OUT') ||
      upperLine.includes('SCTE35-OUT') ||
      (upperLine.startsWith('#EXT-X-DATERANGE') &&
        /CLASS=.*(AD|INTERSTITIAL)|SCTE35/i.test(line))
    ) {
      inCue = true;
      output.push(line);
      continue;
    }
    if (
      upperLine.startsWith('#EXT-X-CUE-IN') ||
      upperLine.includes('SCTE35-IN')
    ) {
      inCue = false;
      output.push(line);
      continue;
    }

    if (upperLine.startsWith('#EXTINF:')) {
      const duration = parseDuration(line);
      const uriIndex = index + 1;
      const uri = lines[uriIndex] || '';
      if (!uri || uri.startsWith('#')) {
        output.push(line);
        continue;
      }

      mediaSegments += 1;
      const decision = scoreSegment({
        uri,
        duration,
        inCue,
        introElapsed,
        rules: selectedRules,
      });
      const removed = decision.confidence >= removeThreshold;
      decisions.push({
        line: index + 1,
        uri,
        duration,
        confidence: decision.confidence,
        reasons: decision.reasons,
        removed,
      });
      introElapsed += duration;

      if (removed) {
        index = uriIndex;
        continue;
      }

      output.push(line, uri);
      keptSegments += 1;
      index = uriIndex;
      continue;
    }

    // Discontinuities are meaningful for codecs, encryption and timelines.
    // Preserve them unless a future parser can prove the full block is an ad.
    output.push(line);
  }

  const removedSegments = decisions.filter((decision) => decision.removed).length;
  const invalidResult =
    mediaSegments > 0 &&
    (keptSegments === 0 ||
      !output.some((line) => line.trim().toUpperCase() === '#EXTM3U'));

  if (invalidResult) {
    return {
      content,
      decisions,
      removedSegments: 0,
      fellBack: true,
    };
  }

  return {
    content: output.join('\n'),
    decisions,
    removedSegments,
    fellBack: false,
  };
}

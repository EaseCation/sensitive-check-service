import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const NETEASE_INIT_URL = "http://optsdk.gameyw.netease.com";
const G79_DECRYPT_KEY = "c42bf7f39d476db3";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_CACHE_FILE = join(process.cwd(), ".cache", "g79-rules.json");

type RuleMap = Record<string, string>;
type RegexGroups = Record<string, RuleMap>;

export type G79RuleSet = {
  regex: RegexGroups;
  [key: string]: unknown;
};

type CacheFile = {
  updatedAt: string;
  sourceUrl: string;
  hash: string;
  rules: G79RuleSet;
};

export type G79StoreStatus = {
  loadedFromCache: boolean;
  hasRules: boolean;
  hash: string | null;
  sourceUrl: string | null;
  updatedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  refreshIntervalMs: number;
  categoryCount: number;
};

type Snapshot = {
  updatedAt: string;
  sourceUrl: string;
  hash: string;
  rules: G79RuleSet;
};

type CompiledRule = {
  id: string;
  source: string;
  regex: RegExp | null;
  error: string | null;
};

type RuleGroupSummary = {
  name: string;
  patternCount: number;
  compiledPatternCount: number;
  invalidPatternCount: number;
};

type MatchRange = {
  value: string;
  start: number;
  end: number;
};

export type G79RuleHit = {
  rule: string;
  id: string;
  pattern: string;
  violations: string[];
  ranges: MatchRange[];
  replacedText: string;
};

export type G79CheckResult = {
  text: string;
  requestedRules: string[];
  resolvedRules: string[];
  unknownRules: string[];
  mode: "first-match" | "all-results";
  matched: boolean;
  checkedGroupCount: number;
  checkedPatternCount: number;
  invalidPatternCount: number;
  violationWords: string[];
  replacedText: string;
  firstHit: G79RuleHit | null;
  hitCount: number;
  hits?: G79RuleHit[];
};

export type G79CheckMode = "all" | "first";

export class G79RuleStore {
  private readonly cachePath: string;
  private readonly refreshIntervalMs: number;
  private snapshot: Snapshot | null = null;
  private compiledGroups: Record<string, CompiledRule[]> = {};
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshPromise: Promise<Snapshot> | null = null;
  private loadedFromCache = false;
  private lastAttemptAt: string | null = null;
  private lastError: string | null = null;

  constructor(options?: { cachePath?: string; refreshIntervalMs?: number }) {
    this.cachePath = options?.cachePath ?? DEFAULT_CACHE_FILE;
    this.refreshIntervalMs = options?.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
  }

  async initialize() {
    await this.loadCacheIfPresent();

    if (this.snapshot) {
      console.log(`Loaded g79 rules from cache: ${this.cachePath}`);
      void this.refresh("startup");
    } else {
      await this.refresh("startup");
    }

    this.refreshTimer = setInterval(() => {
      void this.refresh("interval");
    }, this.refreshIntervalMs);
  }

  getRules() {
    return this.snapshot?.rules ?? null;
  }

  getAvailableRuleNames() {
    return Object.keys(this.compiledGroups).sort((left, right) => left.localeCompare(right));
  }

  getRuleSummaries(): RuleGroupSummary[] {
    return this.getAvailableRuleNames().map((name) => {
      const group = this.compiledGroups[name] ?? [];
      const compiledPatternCount = group.filter((entry) => entry.regex !== null).length;

      return {
        name,
        patternCount: group.length,
        compiledPatternCount,
        invalidPatternCount: group.length - compiledPatternCount,
      };
    });
  }

  checkText(
    text: string,
    requestedRules: string[],
    options?: { mode?: G79CheckMode },
  ) {
    if (!this.snapshot) {
      throw new Error("g79 rules are not loaded yet.");
    }

    const requested = normalizeRequestedRules(requestedRules);
    const resolved = this.resolveRuleNames(requested);
    const mode = options?.mode ?? "all";
    const stopAtFirstHit = mode === "first";
    const hits: G79RuleHit[] = [];
    const allRanges: MatchRange[] = [];
    const violationWords: string[] = [];
    let checkedGroupCount = 0;
    let checkedPatternCount = 0;
    let invalidPatternCount = 0;

    for (const ruleName of resolved.resolvedRules) {
      checkedGroupCount += 1;
      const group = this.compiledGroups[ruleName] ?? [];

      for (const entry of group) {
        if (!entry.regex) {
          invalidPatternCount += 1;
          continue;
        }

        checkedPatternCount += 1;
        const ranges = collectMatchRanges(entry.regex, text);

        if (ranges.length === 0) {
          continue;
        }

        const hit = {
          rule: ruleName,
          id: entry.id,
          pattern: entry.source,
          violations: uniqueValues(ranges.map((range) => range.value)),
          ranges,
          replacedText: maskText(text, ranges),
        } satisfies G79RuleHit;

        hits.push(hit);
        appendUnique(violationWords, hit.violations);
        allRanges.push(...ranges);

        if (stopAtFirstHit) {
          return {
            text,
            requestedRules: requested,
            resolvedRules: resolved.resolvedRules,
            unknownRules: resolved.unknownRules,
            mode: "first-match",
            matched: true,
            checkedGroupCount,
            checkedPatternCount,
            invalidPatternCount,
            violationWords: hit.violations,
            replacedText: hit.replacedText,
            firstHit: hit,
            hitCount: 1,
          } satisfies G79CheckResult;
        }
      }
    }

    const replacedText = allRanges.length > 0 ? maskText(text, allRanges) : text;
    const firstHit = hits[0] ?? null;

    return {
      text,
      requestedRules: requested,
      resolvedRules: resolved.resolvedRules,
      unknownRules: resolved.unknownRules,
      mode: stopAtFirstHit ? "first-match" : "all-results",
      matched: hits.length > 0,
      checkedGroupCount,
      checkedPatternCount,
      invalidPatternCount,
      violationWords: firstHit ? violationWords : [],
      replacedText,
      firstHit,
      hitCount: hits.length,
      ...(!stopAtFirstHit ? { hits } : {}),
    } satisfies G79CheckResult;
  }

  getStatus(): G79StoreStatus {
    return {
      loadedFromCache: this.loadedFromCache,
      hasRules: this.snapshot !== null,
      hash: this.snapshot?.hash ?? null,
      sourceUrl: this.snapshot?.sourceUrl ?? null,
      updatedAt: this.snapshot?.updatedAt ?? null,
      lastAttemptAt: this.lastAttemptAt,
      lastError: this.lastError,
      refreshIntervalMs: this.refreshIntervalMs,
      categoryCount: Object.keys(this.snapshot?.rules.regex ?? {}).length,
    };
  }

  async refresh(reason: "startup" | "interval" | "manual") {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performRefresh(reason).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  dispose() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async loadCacheIfPresent() {
    try {
      const raw = await readFile(this.cachePath, "utf8");
      const parsed = JSON.parse(raw) as CacheFile;

      if (!parsed?.rules?.regex || typeof parsed.sourceUrl !== "string") {
        throw new Error("Cache file format is invalid.");
      }

      this.snapshot = {
        updatedAt: parsed.updatedAt,
        sourceUrl: parsed.sourceUrl,
        hash: parsed.hash,
        rules: parsed.rules,
      };
      this.compiledGroups = compileRegexGroups(parsed.rules.regex);
      this.loadedFromCache = true;
      this.lastError = null;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Failed to load cache: ${message}`;
      console.warn(this.lastError);
    }
  }

  private async performRefresh(reason: "startup" | "interval" | "manual") {
    this.lastAttemptAt = new Date().toISOString();

    try {
      const sourceUrl = await resolveG79DownloadUrl();
      const rules = await fetchAndDecryptG79Rules(sourceUrl);
      const hash = stableHash(rules);
      const updatedAt = new Date().toISOString();

      this.snapshot = {
        updatedAt,
        sourceUrl,
        hash,
        rules,
      };
      this.compiledGroups = compileRegexGroups(rules.regex);
      this.loadedFromCache = false;
      this.lastError = null;

      await persistCache(this.cachePath, this.snapshot);

      console.log(`[g79] Refreshed rules (${reason}) hash=${hash}`);
      return this.snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `Failed to refresh g79 rules: ${message}`;
      console.warn(`[g79] ${this.lastError}`);

      if (this.snapshot) {
        return this.snapshot;
      }

      throw error;
    }
  }

  private resolveRuleNames(requestedRules: string[]) {
    const availableRules = this.getAvailableRuleNames();
    const ruleNameLookup = new Map(
      availableRules.map((ruleName) => [ruleName.toLowerCase(), ruleName]),
    );

    if (requestedRules.includes("all")) {
      return {
        resolvedRules: availableRules,
        unknownRules: [] as string[],
      };
    }

    const resolvedRules: string[] = [];
    const unknownRules: string[] = [];

    for (const requestedRule of requestedRules) {
      const resolvedRule = ruleNameLookup.get(requestedRule.toLowerCase());

      if (!resolvedRule) {
        unknownRules.push(requestedRule);
        continue;
      }

      if (!resolvedRules.includes(resolvedRule)) {
        resolvedRules.push(resolvedRule);
      }
    }

    return {
      resolvedRules,
      unknownRules,
    };
  }

}

async function persistCache(cachePath: string, snapshot: Snapshot) {
  await mkdir(dirname(cachePath), { recursive: true });

  const cacheFile: CacheFile = {
    updatedAt: snapshot.updatedAt,
    sourceUrl: snapshot.sourceUrl,
    hash: snapshot.hash,
    rules: snapshot.rules,
  };

  await writeFile(cachePath, JSON.stringify(cacheFile, null, 2), "utf8");
}

async function resolveG79DownloadUrl() {
  const attempts = [
    { endpointGameId: "android_g79", payloadGameId: "android_g79" },
    { endpointGameId: "android_g79", payloadGameId: "g79" },
  ];

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      return await requestDownloadUrl(attempt.endpointGameId, attempt.payloadGameId);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Could not resolve g79 download URL.");
}

async function requestDownloadUrl(endpointGameId: string, payloadGameId: string) {
  const payload = {
    version: "3.7.15.287970",
    sys: "android",
    deviceid: "865f7d278a212e94",
    network: "wifi",
    info: {},
    gameid: payloadGameId,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const response = await fetch(`${NETEASE_INIT_URL}/initbox_${endpointGameId}.html`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: encodedPayload,
  });

  if (!response.ok) {
    throw new Error(`Init request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as { url?: unknown };

  if (typeof data.url !== "string" || data.url.length === 0) {
    throw new Error("Init response did not contain a usable url.");
  }

  return data.url;
}

async function fetchAndDecryptG79Rules(sourceUrl: string) {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Rule download failed with status ${response.status}.`);
  }

  const encryptedBase64 = await response.text();
  const encryptedBytes = Uint8Array.from(Buffer.from(encryptedBase64.trim(), "base64"));
  const decryptedBytes = rc4(encryptedBytes, Buffer.from(G79_DECRYPT_KEY, "utf8"));
  const decryptedText = new TextDecoder().decode(decryptedBytes);
  const parsed = JSON.parse(decryptedText) as G79RuleSet;

  return decodePcreUnicodeInObject(parsed);
}

function rc4(data: Uint8Array, key: Uint8Array) {
  const s = new Uint8Array(256);

  for (let index = 0; index < 256; index += 1) {
    s[index] = index;
  }

  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + s[index] + key[index % key.length]) & 0xff;
    [s[index], s[j]] = [s[j], s[index]];
  }

  const output = new Uint8Array(data.length);
  let i = 0;
  j = 0;

  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    const k = s[(s[i] + s[j]) & 0xff];
    output[index] = data[index] ^ k;
  }

  return output;
}

function decodePcreUnicodeInObject(value: unknown): any {
  if (Array.isArray(value)) {
    return value.map((item) => decodePcreUnicodeInObject(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, nestedValue]) => [
      key,
      decodePcreUnicodeInObject(nestedValue),
    ]);

    return Object.fromEntries(entries);
  }

  if (typeof value === "string") {
    return value.replace(/\\x\{([0-9a-fA-F]+)\}/g, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
  }

  return value;
}

function stableHash(value: unknown) {
  const normalized = JSON.stringify(sortValue(value));
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizeRequestedRules(requestedRules: string[]) {
  const normalized: string[] = [];

  for (const ruleName of requestedRules) {
    const trimmed = ruleName.trim();

    if (!trimmed) {
      continue;
    }

    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }

  return normalized;
}

function appendUnique(target: string[], values: string[]) {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function collectMatchRanges(regex: RegExp, text: string) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const runtimeRegex = new RegExp(regex.source, flags);
  const ranges: MatchRange[] = [];

  for (const match of text.matchAll(runtimeRegex)) {
    const value = match[0] ?? "";
    const start = match.index ?? -1;

    if (!value || start < 0) {
      continue;
    }

    ranges.push({
      value,
      start,
      end: start + value.length,
    });
  }

  return ranges;
}

function maskText(text: string, ranges: MatchRange[]) {
  if (ranges.length === 0) {
    return text;
  }

  const masked = [...text];
  const mergedRanges = mergeRanges(ranges);

  for (const range of mergedRanges) {
    for (let index = range.start; index < range.end && index < masked.length; index += 1) {
      masked[index] = "*";
    }
  }

  return masked.join("");
}

function mergeRanges(ranges: MatchRange[]) {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: MatchRange[] = [];

  for (const current of sorted) {
    const previous = merged[merged.length - 1];

    if (!previous || current.start > previous.end) {
      merged.push({ ...current });
      continue;
    }

    previous.end = Math.max(previous.end, current.end);
  }

  return merged;
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}

function compileRegexGroups(groups: RegexGroups) {
  return Object.fromEntries(
    Object.entries(groups).map(([groupName, patterns]) => [
      groupName,
      Object.entries(patterns).map(([id, source]) => compileRule(id, source)),
    ]),
  );
}

function compileRule(id: string, source: string): CompiledRule {
  try {
    const compiled = createRuntimeRegex(source);

    return {
      id,
      source,
      regex: compiled,
      error: null,
    };
  } catch (error) {
    return {
      id,
      source,
      regex: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createRuntimeRegex(source: string) {
  const extracted = extractLeadingFlags(source);
  return new RegExp(extracted.pattern, extracted.flags);
}

function extractLeadingFlags(source: string) {
  let pattern = source;
  const flags = new Set<string>();

  while (true) {
    const match = pattern.match(/^\(\?([A-Za-z]+)\)/);
    if (!match) {
      break;
    }

    for (const flag of match[1]) {
      if ("imsu".includes(flag)) {
        flags.add(flag);
      }
    }

    pattern = pattern.slice(match[0].length);
  }

  return {
    pattern,
    flags: [...flags].join(""),
  };
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortValue(nestedValue)]),
    );
  }

  return value;
}

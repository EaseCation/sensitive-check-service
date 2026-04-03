import { Elysia } from "elysia";
import { G79RuleStore, type G79CheckMode } from "./rules/g79-store";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const isDevelopment = Reflect.get(process.env, "NODE_ENV") === "development";

const g79Store = new G79RuleStore({
  cachePath: process.env.RULE_CACHE_PATH,
});

await g79Store.initialize();

type CheckRequestBody = {
  text?: unknown;
  rule?: unknown;
  rules?: unknown;
  ruleNames?: unknown;
  mode?: unknown;
  includeDetails?: unknown;
  details?: unknown;
  preserveFormatting?: unknown;
};

const app = new Elysia()
  .get("/", () => ({
    success: true,
    message: "ok",
    data: {
      service: "sensitive-check-service",
    },
  }))
  .get("/rules", () => ({
    success: true,
    message: "ok",
    data: {
      count: g79Store.getAvailableRuleNames().length,
      rules: ["all", ...g79Store.getAvailableRuleNames()],
      details: g79Store.getRuleSummaries(),
    },
  }))
  .get("/health", () => ({
    success: true,
    message: "ok",
    data: {
      timestamp: Math.floor(Date.now() / 1000),
      g79: g79Store.getStatus(),
    },
  }))
  .post("/check", ({ body, set }) => {
    const startedAt = performance.now();
    const payload = (body ?? {}) as CheckRequestBody;
    const text = typeof payload.text === "string" ? payload.text : null;
    const requestedRules = extractRequestedRules(payload);
    const mode = resolveCheckMode(payload.mode);
    const includeDetails = resolveBooleanFlag(payload.includeDetails, payload.details);
    const preserveFormatting = resolveBooleanFlag(payload.preserveFormatting);

    if (text === null) {
      set.status = 400;
      return {
        success: false,
        message: "`text` must be a string.",
      };
    }

    if (requestedRules.length === 0) {
      set.status = 400;
      return {
        success: false,
        message: "Provide `rule` or `rules`.",
      };
    }

    if (!mode) {
      set.status = 400;
      return {
        success: false,
        message: "`mode` must be `all` or `first`.",
      };
    }

    const checkOptions = {
      mode,
      preserveFormatting,
    };
    const result = g79Store.checkText(text, requestedRules, checkOptions);

    if (result.resolvedRules.length === 0) {
      set.status = 400;
      return {
        success: false,
        message: "No valid rule names were provided.",
        availableRules: ["all", ...g79Store.getAvailableRuleNames()],
      };
    }

    const usedTimeMs = Number((performance.now() - startedAt).toFixed(4));

    return {
      success: true,
      message: "ok",
      data: {
        pass: !result.matched,
        violationWords: result.violationWords,
        replacedText: result.matched ? result.replacedText : "",
        hitRuleIds: buildHitRuleIds(result),
        usedTimeMs,
        ...(includeDetails
          ? {
              details: {
                hits: buildResponseHits(result.hits ?? []),
              },
            }
          : {}),
      },
    };
  })
  .listen({
    hostname: host,
    port,
  });

console.log(`Elysia is running at http://${host}:${app.server?.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    g79Store.dispose();
    process.exit(0);
  });
}

function extractRequestedRules(body: CheckRequestBody) {
  const candidates = [body.rule, body.rules, body.ruleNames];
  const rules: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      rules.push(candidate);
      continue;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string") {
          rules.push(item);
        }
      }
    }
  }

  return rules;
}

function resolveCheckMode(value: unknown): G79CheckMode | null {
  if (value === undefined) {
    return "all";
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "all") {
    return "all";
  }

  if (normalized === "first") {
    return "first";
  }

  return null;
}

function resolveBooleanFlag(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return false;
}

function buildHitRuleIds(result: ReturnType<G79RuleStore["checkText"]>) {
  if (result.hits && result.hits.length > 0) {
    return [...new Set(result.hits.map((hit) => hit.displayId))];
  }

  if (result.firstHit) {
    return [result.firstHit.displayId];
  }

  return [] as string[];
}

function buildResponseHits(hits: NonNullable<ReturnType<G79RuleStore["checkText"]>["hits"]>) {
  if (isDevelopment) {
    return hits;
  }

  return hits.map(({ pattern, ...hit }) => hit);
}

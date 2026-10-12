/**
 * 登录失败限速（单服务器内存实现，重启即清零，可接受）。
 *
 * - 按“用户名”限速为主键：与客户端 IP 无关，伪造 X-Forwarded-For 无法绕过；
 * - 另设一个全局限速桶，防止用不同用户名撞库；
 * - 仅在显式配置 DIRECTOR_TRUST_PROXY=1 时才信任代理头并附加 IP 维度。
 */

type Bucket = {
  failures: number;
  windowStart: number;
};

const MAX_FAILURES_PER_USERNAME = 5;
const MAX_FAILURES_GLOBAL = 100;
const WINDOW_MS = 10 * 60 * 1000; // 10 分钟

const usernameBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { failures: 0, windowStart: 0 };

function bucketAllows(bucket: Bucket, max: number, now: number): boolean {
  if (now - bucket.windowStart > WINDOW_MS) {
    bucket.windowStart = now;
    bucket.failures = 0;
    return true;
  }
  return bucket.failures < max;
}

function registerFailure(bucket: Bucket, now: number) {
  if (now - bucket.windowStart > WINDOW_MS) {
    bucket.windowStart = now;
    bucket.failures = 0;
  }
  bucket.failures += 1;
}

function retryAfterSeconds(bucket: Bucket, now: number): number {
  const elapsed = now - bucket.windowStart;
  return Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000));
}

export type LoginRateKey = {
  username: string;
  /** 仅在 DIRECTOR_TRUST_PROXY=1 时由调用方传入，否则为空 */
  ip?: string;
};

function normalizeKey(key: LoginRateKey): string[] {
  const keys = [`u:${key.username.trim().toLowerCase()}`];
  if (key.ip) keys.push(`ip:${key.ip}`);
  return keys;
}

/** 该登录尝试是否被拒绝（拒绝时应返回 429，不进入密码校验） */
export function loginRateLimited(key: LoginRateKey): { blocked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const keys = normalizeKey(key);
  const buckets: Bucket[] = keys.map((k) => {
    if (k === "global") return globalBucket;
    let b = usernameBuckets.get(k);
    if (!b) {
      b = { failures: 0, windowStart: now };
      usernameBuckets.set(k, b);
    }
    return b;
  });
  buckets.push(globalBucket);

  let worst = 0;
  for (const bucket of buckets) {
    const max = bucket === globalBucket ? MAX_FAILURES_GLOBAL : MAX_FAILURES_PER_USERNAME;
    if (!bucketAllows(bucket, max, now)) {
      worst = Math.max(worst, retryAfterSeconds(bucket, now));
    }
  }
  return { blocked: worst > 0, retryAfterSeconds: worst };
}

export function registerLoginFailure(key: LoginRateKey): void {
  const now = Date.now();
  for (const k of normalizeKey(key)) {
    let b = usernameBuckets.get(k);
    if (!b) {
      b = { failures: 0, windowStart: now };
      usernameBuckets.set(k, b);
    }
    registerFailure(b, now);
  }
  registerFailure(globalBucket, now);
}

export function clearLoginFailures(key: LoginRateKey): void {
  for (const k of normalizeKey(key)) {
    usernameBuckets.delete(k);
  }
}

/** 防止 Map 无限增长：失败记录数上限，超限时整体清空（保守做法，只影响攻击者体验） */
export function pruneLoginRateBuckets(): void {
  if (usernameBuckets.size > 5000) usernameBuckets.clear();
}

/** 仅在部署方显式声明信任代理时才读取代理头 */
export function trustedClientIp(request: Request): string | undefined {
  if (process.env.DIRECTOR_TRUST_PROXY !== "1") return undefined;
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return request.headers.get("x-real-ip") || undefined;
  return forwarded.split(",")[0]?.trim() || undefined;
}

// A token bucket per client address, held in memory.
//
// In memory is right here rather than lazy: the service runs on one Fly
// machine with one volume, so there is no second process to share a counter
// with. If it ever grows past one machine this has to move to the database or
// to Redis, and the comment is here so that is a decision rather than a
// surprise.

export class RateLimiter {
  constructor({ burst, perMinute }) {
    this.burst = Math.max(1, burst);
    this.refillPerMs = Math.max(perMinute, 1) / 60000;
    this.buckets = new Map();
  }

  // True if the caller may proceed. Buckets for addresses that have not been
  // seen in a while are dropped as they are found, so the map cannot grow
  // without bound from one-off callers.
  allow(key, now = Date.now()) {
    let b = this.buckets.get(key);
    if (b === undefined) {
      b = { tokens: this.burst, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) * this.refillPerMs);
    b.at = now;
    if (this.buckets.size > 10000) this.sweep(now);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // How long, in whole seconds, until this caller has a token again. For the
  // Retry-After header, so a client backs off by the real figure rather than
  // by a guess.
  retryAfter(key, now = Date.now()) {
    const b = this.buckets.get(key);
    if (b === undefined || b.tokens >= 1) return 0;
    return Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerMs / 1000));
  }

  sweep(now = Date.now()) {
    const idleMs = (this.burst / this.refillPerMs) * 2;
    for (const [key, b] of this.buckets) {
      if (now - b.at > idleMs) this.buckets.delete(key);
    }
  }
}

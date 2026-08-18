function createRateLimit({ windowMs, max, key = (req) => req.ip }) {
  const attempts = new Map();
  let requestCount = 0;

  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = String(key(req) || "unknown");
    const current = attempts.get(bucketKey);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : current;
    bucket.count += 1;
    attempts.set(bucketKey, bucket);

    requestCount += 1;
    if (requestCount % 250 === 0) {
      for (const [candidate, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(candidate);
      }
    }

    if (bucket.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please wait and try again.",
      });
    }
    return next();
  };
}

module.exports = { createRateLimit };

export class HostMatcher {
  constructor(text) {
    this.rules = text
      .split(/[\r\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(HostMatcher.parseRule);
  }

  static parseRule(line) {
    let s = line
      .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
      .replace(/^\/\//, "");
    const slash = s.indexOf("/");
    let host = slash < 0 ? s : s.substring(0, slash);
    const path = slash < 0 ? "/" : s.substring(slash);
    const wildcard = host.startsWith("*.");
    if (wildcard) host = host.substring(1);
    return { host: host.toLowerCase(), wildcard, pathPrefix: path };
  }

  get isEmpty() {
    return this.rules.length === 0;
  }

  matches(rawUrl) {
    let url;
    try {
      const s = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
      url = new URL(s);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const authority = url.hostname.toLowerCase();
    const path = url.pathname || "/";
    return this.rules.some(
      (r) =>
        (r.wildcard ? authority.endsWith(r.host) : authority === r.host) &&
        path.startsWith(r.pathPrefix),
    );
  }
}

class LookupSource {
  static BATCH = 50;
  // Mirrors the server-side per-link limit: one overlong link fails the
  // whole batch, so overlong links are skipped client-side instead.
  static MAX_URL_LENGTH = 2048;

  constructor(endpoint, hosts, timeout) {
    this.endpoint = new URL(endpoint);
    this.hosts = hosts;
    this.timeout = timeout;
    this.cache = new Map();
    // url -> in-flight batch promise, so concurrent pages sharing an URL
    // that is not cached yet reuse one POST instead of racing duplicates.
    this.pending = new Map();
    this.rateLimitedAt = 0;
    this.warned = new Set();
  }

  supports(url) {
    return this.hosts.matches(url);
  }

  // A 429 pauses lookups for a minute instead of disabling them forever:
  // long-running processes (astro dev) share one resolver.
  static RATE_LIMIT_COOLDOWN = 60000;

  async resolve(urls) {
    const result = new Map();
    const fresh = [];
    const asked = [];
    const waitables = [];
    for (const url of urls) {
      const cached = this.cache.get(url);
      if (cached) {
        result.set(url, cached);
        continue;
      }
      if (url.length > LookupSource.MAX_URL_LENGTH) continue;
      const pending = this.pending.get(url);
      if (pending) {
        asked.push(url);
        waitables.push(pending);
      } else {
        fresh.push(url);
      }
    }
    const cooling =
      this.rateLimitedAt > 0 &&
      Date.now() - this.rateLimitedAt < LookupSource.RATE_LIMIT_COOLDOWN;
    if (fresh.length > 0 && !cooling) {
      for (let i = 0; i < fresh.length; i += LookupSource.BATCH) {
        const batch = fresh.slice(i, i + LookupSource.BATCH);
        const running = this.runBatch(batch);
        for (const url of batch) this.pending.set(url, running);
        asked.push(...batch);
        waitables.push(running);
        running.finally(() => {
          for (const url of batch) this.pending.delete(url);
        });
      }
    }
    await Promise.allSettled(waitables);
    for (const url of asked) {
      const variants = this.cache.get(url);
      if (variants) result.set(url, variants);
    }
    return result;
  }

  // Never rejects: failures are warned about once and yield no entries.
  runBatch(batch) {
    return this.lookup(batch).then(
      (resolved) => {
        for (const [url, variants] of resolved) this.cache.set(url, variants);
        return resolved;
      },
      (err) => {
        this.warnOnce(
          "network",
          `[imgnest] variant lookup at ${this.endpoint} failed, images keep their original URLs (${err?.message ?? err})`,
        );
        return new Map();
      },
    );
  }

  async lookup(batch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: batch }),
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 429) {
          this.rateLimitedAt = Date.now();
        }
        this.warnOnce(
          `http-${res.status}`,
          `[imgnest] variant lookup at ${this.endpoint} answered ${res.status}; matching images keep their original URLs${res.status === 429 ? " (rate limited, pausing lookups for a minute; raise variant_lookup_per_minute server-side if needed)" : ""}`,
        );
        return new Map();
      }
      const body = await res.json();
      return LookupSource.parse(batch, body);
    } finally {
      clearTimeout(timer);
    }
  }

  warnOnce(key, message) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  static parse(batch, body) {
    const items = body?.data?.items ?? body?.items;
    const result = new Map();
    if (!Array.isArray(items)) return result;
    for (let i = 0; i < batch.length && i < items.length; i++) {
      const item = items[i];
      const variants = [];
      if (item.found !== false) {
        for (const v of item.variants ?? []) {
          if (v.url && v.width > 0) {
            variants.push({
              url: v.url,
              width: v.width,
              height: v.height && v.height > 0 ? v.height : undefined,
            });
          }
        }
      }
      variants.sort((a, b) => a.width - b.width);
      result.set(batch[i], variants);
    }
    return result;
  }

  describe() {
    return `lookup:${this.endpoint}`;
  }
}

class TemplateSource {
  constructor(hosts, widths, template) {
    this.hosts = hosts;
    this.widths = widths.filter((w) => w > 0).sort((a, b) => a - b);
    this.template = template;
  }

  supports(url) {
    return (
      this.template.includes("{width}") &&
      this.widths.length > 0 &&
      this.hosts.matches(url)
    );
  }

  async resolve(urls) {
    const result = new Map();
    for (const url of urls) {
      result.set(
        url,
        this.widths.map((w) => ({ url: this.build(url, w), width: w })),
      );
    }
    return result;
  }

  build(url, width) {
    const sep = url.includes("?") ? "&" : "?";
    // Replacer functions: a URL containing "$&" or "$'" would otherwise be
    // mangled by String.replace's replacement patterns.
    return this.template
      .replace(/\{url\}/g, () => url)
      .replace(/\{sep\}/g, () => sep)
      .replace(/\{width\}/g, () => String(width));
  }

  describe() {
    return `template:${this.template}:${this.widths}`;
  }
}

export class VariantResolver {
  constructor(options) {
    this.timeout = options.timeout || 5000;
    this.sources = (options.sources || [])
      .map((cfg) => this.buildSource(cfg))
      .filter((s) => s !== null);
  }

  buildSource(cfg) {
    const hosts = new HostMatcher(cfg.hosts || "");
    if (hosts.isEmpty) return null;

    if (cfg.type === "template") {
      if (!cfg.template || !cfg.template.includes("{width}")) return null;
      const rawWidths = Array.isArray(cfg.widths)
        ? cfg.widths.join(",")
        : cfg.widths;
      const widths = (rawWidths || "400,800,1600")
        .split(/[,\s]+/)
        .filter((s) => /^\d{1,5}$/.test(s))
        .map(Number);
      return new TemplateSource(hosts, widths, cfg.template);
    }

    if (!cfg.endpoint) return null;
    try {
      return new LookupSource(cfg.endpoint, hosts, this.timeout);
    } catch {
      return null;
    }
  }

  pick(url) {
    return this.sources.find((s) => s.supports(url));
  }

  async resolve(urls) {
    const grouped = new Map();
    for (const url of urls) {
      const source = this.pick(url);
      if (source) {
        if (!grouped.has(source)) grouped.set(source, []);
        grouped.get(source).push(url);
      }
    }
    const results = await Promise.all(
      [...grouped.entries()].map(([src, u]) => src.resolve(u)),
    );
    const merged = new Map();
    for (const r of results) {
      for (const [k, v] of r) merged.set(k, v);
    }
    return merged;
  }

  get hasSources() {
    return this.sources.length > 0;
  }
}

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

  constructor(endpoint, hosts, timeout) {
    this.endpoint = new URL(endpoint);
    this.hosts = hosts;
    this.timeout = timeout;
  }

  supports(url) {
    return this.hosts.matches(url);
  }

  async resolve(urls) {
    const batches = [];
    for (let i = 0; i < urls.length; i += LookupSource.BATCH) {
      batches.push(urls.slice(i, i + LookupSource.BATCH));
    }
    const results = await Promise.all(
      batches.map((batch) => this.lookup(batch)),
    );
    const merged = new Map();
    for (const r of results) {
      for (const [k, v] of r) merged.set(k, v);
    }
    return merged;
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
      const body = await res.json();
      return LookupSource.parse(batch, body);
    } finally {
      clearTimeout(timer);
    }
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
    return this.template
      .replace("{url}", url)
      .replace("{sep}", sep)
      .replace("{width}", String(width));
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
      const widths = (cfg.widths || "400,800,1600")
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

import { describe, it, expect } from "vitest";
import { HostMatcher, VariantResolver } from "../lib/resolver.js";

describe("HostMatcher", () => {
  it("matches exact host", () => {
    const m = new HostMatcher("img.example.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("https://other.com/a.webp")).toBe(false);
  });

  it("matches host with path prefix", () => {
    const m = new HostMatcher("img.example.com/blog/");
    expect(m.matches("https://img.example.com/blog/a.webp")).toBe(true);
    expect(m.matches("https://img.example.com/other/a.webp")).toBe(false);
  });

  it("matches wildcard host", () => {
    const m = new HostMatcher("*.example.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("https://cdn.example.com/a.webp")).toBe(true);
    expect(m.matches("https://example.com/a.webp")).toBe(false);
  });

  it("matches multiple hosts", () => {
    const m = new HostMatcher("img.example.com\ncdn.other.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("https://cdn.other.com/a.webp")).toBe(true);
    expect(m.matches("https://unknown.com/a.webp")).toBe(false);
  });

  it("strips protocol from host", () => {
    const m = new HostMatcher("https://img.example.com");
    expect(m.matches("https://img.example.com/a.webp")).toBe(true);
    expect(m.matches("http://img.example.com/a.webp")).toBe(true);
  });

  it("handles protocol-relative URLs", () => {
    const m = new HostMatcher("img.example.com");
    expect(m.matches("//img.example.com/a.webp")).toBe(true);
  });

  it("isEmpty when no rules", () => {
    expect(new HostMatcher("").isEmpty).toBe(true);
    expect(new HostMatcher("  \n  ").isEmpty).toBe(true);
    expect(new HostMatcher("img.example.com").isEmpty).toBe(false);
  });

  it("rejects non-http URLs", () => {
    const m = new HostMatcher("img.example.com");
    expect(m.matches("ftp://img.example.com/a.webp")).toBe(false);
    expect(m.matches("data:image/png;base64,abc")).toBe(false);
    expect(m.matches("")).toBe(false);
  });
});

describe("VariantResolver", () => {
  it("creates template source", () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}x-oss-process=image/resize,w_{width}",
          widths: "400,800,1600",
        },
      ],
    });
    expect(resolver.hasSources).toBe(true);
  });

  it("skips source without hosts", () => {
    const resolver = new VariantResolver({
      sources: [{ type: "lookup", hosts: "", endpoint: "https://img.example.com/api/variants" }],
    });
    expect(resolver.hasSources).toBe(false);
  });

  it("skips template source without {width}", () => {
    const resolver = new VariantResolver({
      sources: [{ type: "template", hosts: "img.example.com", template: "{url}?w=100" }],
    });
    expect(resolver.hasSources).toBe(false);
  });

  it("skips lookup source without endpoint", () => {
    const resolver = new VariantResolver({
      sources: [{ type: "lookup", hosts: "img.example.com" }],
    });
    expect(resolver.hasSources).toBe(false);
  });

  it("resolves template source URLs", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400,800",
        },
      ],
    });

    const result = await resolver.resolve(["https://img.example.com/photo.webp"]);
    const variants = result.get("https://img.example.com/photo.webp");
    expect(variants).toHaveLength(2);
    expect(variants[0].width).toBe(400);
    expect(variants[0].url).toBe("https://img.example.com/photo.webp?w_400");
    expect(variants[1].width).toBe(800);
    expect(variants[1].url).toBe("https://img.example.com/photo.webp?w_800");
  });

  it("resolves template source with existing query string", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400",
        },
      ],
    });

    const result = await resolver.resolve(["https://img.example.com/photo.webp?v=1"]);
    const variants = result.get("https://img.example.com/photo.webp?v=1");
    expect(variants[0].url).toBe("https://img.example.com/photo.webp?v=1&w_400");
  });

  it("returns empty for unmatched URLs", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400",
        },
      ],
    });

    const result = await resolver.resolve(["https://other.com/photo.webp"]);
    expect(result.size).toBe(0);
  });

  it("handles multiple sources with different hosts", async () => {
    const resolver = new VariantResolver({
      sources: [
        {
          type: "template",
          hosts: "img.example.com",
          template: "{url}{sep}w_{width}",
          widths: "400",
        },
        {
          type: "template",
          hosts: "cdn.other.com",
          template: "{url}{sep}resize,w_{width}",
          widths: "800",
        },
      ],
    });

    const result = await resolver.resolve([
      "https://img.example.com/a.webp",
      "https://cdn.other.com/b.webp",
      "https://unknown.com/c.webp",
    ]);
    expect(result.size).toBe(2);
    expect(result.get("https://img.example.com/a.webp")[0].url).toContain("w_400");
    expect(result.get("https://cdn.other.com/b.webp")[0].url).toContain("w_800");
  });
});

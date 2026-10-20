import { describe, it, expect } from "vitest";
import { VariantResolver } from "../lib/resolver.js";
import {
  collectImgUrls,
  rewriteTree,
  buildSrcset,
  isImageUrl,
  isPlaceholderSrcset,
} from "../lib/rewrite.js";

const variants400_800 = [
  { url: "https://img.example.com/a_400.webp", width: 400, height: 300 },
  { url: "https://img.example.com/a_800.webp", width: 800, height: 600 },
];

function makeResolver() {
  return new VariantResolver({
    sources: [
      {
        type: "template",
        hosts: "img.example.com",
        template: "{url}{sep}w_{width}",
        widths: "400,800",
      },
    ],
  });
}

function makeTree(imgNodes) {
  return {
    type: "element",
    tagName: "html",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "body",
        properties: {},
        children: imgNodes,
      },
    ],
  };
}

function makeImg(properties) {
  return { type: "element", tagName: "img", properties };
}

describe("buildSrcset", () => {
  it("builds srcset string", () => {
    expect(buildSrcset(variants400_800)).toBe(
      "https://img.example.com/a_400.webp 400w, https://img.example.com/a_800.webp 800w",
    );
  });

  it("encodes spaces in URLs", () => {
    const v = [{ url: "https://img.example.com/a b.webp", width: 400 }];
    expect(buildSrcset(v)).toBe("https://img.example.com/a%20b.webp 400w");
  });
});

describe("isImageUrl", () => {
  it("accepts http URLs", () => {
    expect(isImageUrl("https://img.example.com/a.webp")).toBe(true);
    expect(isImageUrl("http://img.example.com/a.webp")).toBe(true);
    expect(isImageUrl("//img.example.com/a.webp")).toBe(true);
  });

  it("rejects non-image values", () => {
    expect(isImageUrl(null)).toBe(false);
    expect(isImageUrl("")).toBe(false);
    expect(isImageUrl("data:image/png;base64,abc")).toBe(false);
    expect(isImageUrl("/relative/path.webp")).toBe(false);
  });
});

describe("isPlaceholderSrcset", () => {
  it("empty srcset is placeholder", () => {
    expect(isPlaceholderSrcset(null, "https://img.example.com/a.webp", null)).toBe(true);
    expect(isPlaceholderSrcset("", "https://img.example.com/a.webp", null)).toBe(true);
  });

  it("srcset with same URL as candidate is placeholder", () => {
    expect(
      isPlaceholderSrcset(
        "https://img.example.com/a.webp 1x",
        "https://img.example.com/a.webp",
        "https://img.example.com/a.webp",
      ),
    ).toBe(true);
  });

  it("srcset with different URL is not placeholder", () => {
    expect(
      isPlaceholderSrcset(
        "https://img.example.com/a_400.webp 400w",
        "https://img.example.com/a.webp",
        "https://img.example.com/a.webp",
      ),
    ).toBe(false);
  });
});

describe("collectImgUrls", () => {
  it("collects img src URLs from hast tree", () => {
    const tree = makeTree([
      makeImg({ src: "https://img.example.com/a.webp" }),
      makeImg({ src: "https://img.example.com/b.webp" }),
    ]);
    const urls = collectImgUrls(tree);
    expect(urls).toContain("https://img.example.com/a.webp");
    expect(urls).toContain("https://img.example.com/b.webp");
  });

  it("collects from lazy load properties", () => {
    const tree = makeTree([
      makeImg({ dataSrc: "https://img.example.com/a.webp", src: "placeholder.gif" }),
    ]);
    const urls = collectImgUrls(tree);
    expect(urls).toContain("https://img.example.com/a.webp");
  });

  it("deduplicates URLs", () => {
    const tree = makeTree([
      makeImg({ src: "https://img.example.com/a.webp" }),
      makeImg({ src: "https://img.example.com/a.webp" }),
    ]);
    const urls = collectImgUrls(tree);
    expect(urls).toHaveLength(1);
  });

  it("ignores non-http URLs", () => {
    const tree = makeTree([makeImg({ src: "/local/image.webp" })]);
    const urls = collectImgUrls(tree);
    expect(urls).toHaveLength(0);
  });

  it("ignores non-img elements", () => {
    const tree = makeTree([
      { type: "element", tagName: "p", properties: {}, children: [] },
    ]);
    const urls = collectImgUrls(tree);
    expect(urls).toHaveLength(0);
  });
});

describe("rewriteTree", () => {
  it("adds srcSet to img elements", () => {
    const tree = makeTree([makeImg({ src: "https://img.example.com/a.webp" })]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const changed = rewriteTree(tree, variants, { sizes: "100vw" });
    expect(changed).toBe(true);
    const img = tree.children[0].children[0];
    expect(img.properties.srcSet).toContain("400w");
    expect(img.properties.srcSet).toContain("800w");
    expect(img.properties.sizes).toBe("100vw");
  });

  it("adds onError fallback by default", () => {
    const tree = makeTree([makeImg({ src: "https://img.example.com/a.webp" })]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    rewriteTree(tree, variants, { fallbackOnError: true });
    const img = tree.children[0].children[0];
    expect(img.properties.onError).toContain("this.onerror=null");
  });

  it("skips onError when disabled", () => {
    const tree = makeTree([makeImg({ src: "https://img.example.com/a.webp" })]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    rewriteTree(tree, variants, { fallbackOnError: false });
    const img = tree.children[0].children[0];
    expect(img.properties.onError).toBeUndefined();
  });

  it("adds width/height when writeDimensions is true and height is known", () => {
    const tree = makeTree([makeImg({ src: "https://img.example.com/a.webp" })]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    rewriteTree(tree, variants, { writeDimensions: true });
    const img = tree.children[0].children[0];
    expect(img.properties.width).toBe(800);
    expect(img.properties.height).toBe(600);
  });

  it("does not overwrite existing srcSet with real variants", () => {
    const tree = makeTree([
      makeImg({
        src: "https://img.example.com/a.webp",
        srcSet: "https://img.example.com/a_400.webp 400w",
      }),
    ]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const changed = rewriteTree(tree, variants, {});
    expect(changed).toBe(false);
  });

  it("does not overwrite existing sizes", () => {
    const tree = makeTree([
      makeImg({ src: "https://img.example.com/a.webp", sizes: "50vw" }),
    ]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    rewriteTree(tree, variants, { sizes: "100vw" });
    const img = tree.children[0].children[0];
    expect(img.properties.sizes).toBe("50vw");
  });

  it("handles lazy load dataSrc", () => {
    const tree = makeTree([
      makeImg({ dataSrc: "https://img.example.com/a.webp", src: "placeholder.gif" }),
    ]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    rewriteTree(tree, variants, {});
    const img = tree.children[0].children[0];
    expect(img.properties.dataSrcset).toContain("400w");
    expect(img.properties.dataResponsiveSrc).toBe("https://img.example.com/a.webp");
  });

  it("ignores images not matching any source", () => {
    const tree = makeTree([makeImg({ src: "https://other.com/a.webp" })]);
    const variants = new Map([["https://img.example.com/a.webp", variants400_800]]);
    const changed = rewriteTree(tree, variants, {});
    expect(changed).toBe(false);
  });

  it("returns false when no images match", () => {
    const tree = makeTree([]);
    const variants = new Map();
    const changed = rewriteTree(tree, variants, {});
    expect(changed).toBe(false);
  });

  it("processes multiple images on the same page", () => {
    const tree = makeTree([
      makeImg({ src: "https://img.example.com/a.webp" }),
      makeImg({ src: "https://img.example.com/b.webp" }),
    ]);
    const variants = new Map([
      ["https://img.example.com/a.webp", variants400_800],
      ["https://img.example.com/b.webp", [{ url: "https://img.example.com/b_400.webp", width: 400 }]],
    ]);
    const changed = rewriteTree(tree, variants, {});
    expect(changed).toBe(true);
    const imgs = tree.children[0].children;
    expect(imgs[0].properties.srcSet).toContain("a_400.webp");
    expect(imgs[1].properties.srcSet).toContain("b_400.webp");
  });
});

describe("review fixes", () => {
  const variants = new Map([
    ["https://img.example.com/a.webp", variants400_800],
  ]);

  function imgNode(props) {
    return { type: "element", tagName: "img", properties: props, children: [] };
  }

  function singleTree(node) {
    return { type: "root", children: [node] };
  }

  it("protects valid compact srcset without whitespace after the comma", () => {
    const node = imgNode({
      src: "https://img.example.com/a.webp",
      srcSet: "https://img.example.com/a.webp 1x,https://img.example.com/a_800.webp 2x",
    });
    rewriteTree(singleTree(node), variants, {});
    expect(node.properties.srcSet).toBe("https://img.example.com/a.webp 1x,https://img.example.com/a_800.webp 2x");
  });

  it("treats placeholder srcset with trailing comma as replaceable", () => {
    expect(isPlaceholderSrcset("https://img.example.com/a.webp 1x,", "https://img.example.com/a.webp", "https://img.example.com/a.webp")).toBe(true);
  });
});

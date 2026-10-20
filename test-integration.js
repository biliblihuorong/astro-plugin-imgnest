// Test Astro plugin with real blog data
import { VariantResolver } from "./lib/resolver.js";
import { collectImgUrls, rewriteTree } from "./lib/rewrite.js";

// Simulate a hast tree that Astro's markdown pipeline would produce
const SAMPLE_TREE = {
  type: "element",
  tagName: "html",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "head",
      properties: {},
      children: [
        { type: "element", tagName: "title", properties: {}, children: [{ type: "text", value: "Test Post" }] },
      ],
    },
    {
      type: "element",
      tagName: "body",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "article",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "h1",
              properties: {},
              children: [{ type: "text", value: "Thinkpad T14 Gen2A" }],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "第一张图片（Markdown 渲染后）：" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: {
                src: "https://img.ning.moe/ShellBlogImg/2026/10/6ad4b31622f41.webp",
                alt: "photo1",
              },
              children: [],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "第二张图片：" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: {
                src: "https://img.ning.moe/i/1/23/01/30/63d759cdaccfe.webp",
                alt: "photo2",
              },
              children: [],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "懒加载图片：" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: {
                dataSrc: "https://img.ning.moe/ShellBlogImg/1/2026/05/15/6a0704dc3843c.webp",
                src: "placeholder.gif",
                alt: "lazy",
              },
              children: [],
            },
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: "不匹配的域名：" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: {
                src: "https://other-cdn.com/image.png",
                alt: "external",
              },
              children: [],
            },
            {
              type: "element",
              tagName: "img",
              properties: {
                src: "https://img.ning.moe/ShellBlogImg/1/2026/05/16/6a07e2b1ad9c2.webp",
                alt: "photo4",
              },
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

async function main() {
  const resolver = new VariantResolver({
    sources: [
      {
        type: "lookup",
        hosts: "img.ning.moe",
        endpoint: "https://imgnest.ning.moe/api/variants",
      },
    ],
    timeout: 10000,
  });

  console.log("=== Astro Plugin Test ===\n");
  console.log("Sources:", resolver.hasSources ? "OK" : "FAIL");

  // Step 1: Collect URLs from hast tree
  const urls = collectImgUrls(SAMPLE_TREE);
  console.log(`\nCollected ${urls.length} image URLs from hast tree:`);
  urls.forEach((u) => console.log(`  - ${u}`));

  // Step 2: Resolve variants
  const variants = await resolver.resolve(urls);
  console.log(`\nResolved variants for ${variants.size} images:`);
  for (const [url, vs] of variants) {
    console.log(`  - ${url}: ${vs.length} variants (${vs.map((v) => v.width).join(", ")}w)`);
  }

  // Step 3: Rewrite tree
  const changed = rewriteTree(SAMPLE_TREE, variants, {
    sizes: "(max-width: 800px) 100vw, 800px",
    writeDimensions: true,
    fallbackOnError: true,
  });
  console.log(`\nTree modified: ${changed}`);

  // Step 4: Verify results by walking the tree
  const imgNodes = [];
  function walk(node) {
    if (node.type === "element" && node.tagName === "img") {
      imgNodes.push(node);
    }
    if (node.children) node.children.forEach(walk);
  }
  walk(SAMPLE_TREE);

  const checks = [
    {
      name: "photo1 has srcSet",
      test: imgNodes[0].properties.srcSet?.includes("6ad4b31622f41_w400_v1.webp 400w"),
    },
    {
      name: "photo1 has sizes",
      test: imgNodes[0].properties.sizes === "(max-width: 800px) 100vw, 800px",
    },
    {
      name: "photo1 has onError fallback",
      test: imgNodes[0].properties.onError?.includes("this.onerror=null"),
    },
    {
      name: "photo1 has width/height (writeDimensions)",
      test: imgNodes[0].properties.width === 800 && imgNodes[0].properties.height === 566,
    },
    {
      name: "photo2 has no srcSet (no variants from API)",
      test: !imgNodes[1].properties.srcSet,
    },
    {
      name: "lazy img has dataSrcset",
      test: imgNodes[2].properties.dataSrcset?.includes("6a0704dc3843c_w400_v1.webp 400w"),
    },
    {
      name: "lazy img has dataResponsiveSrc marker",
      test: imgNodes[2].properties.dataResponsiveSrc === "https://img.ning.moe/ShellBlogImg/1/2026/05/15/6a0704dc3843c.webp",
    },
    {
      name: "external image NOT modified",
      test: !imgNodes[3].properties.srcSet,
    },
    {
      name: "photo4 has srcSet",
      test: imgNodes[4].properties.srcSet?.includes("6a07e2b1ad9c2_w400_v1.webp 400w"),
    },
  ];

  console.log("\n--- Checks ---");
  let passed = 0;
  for (const c of checks) {
    const status = c.test ? "PASS" : "FAIL";
    console.log(`  [${status}] ${c.name}`);
    if (c.test) passed++;
  }

  console.log(`\nResult: ${passed}/${checks.length} checks passed`);

  // Print all img node properties
  console.log("\n--- Image node properties ---");
  imgNodes.forEach((node, i) => {
    console.log(`\nimg[${i}] (${node.properties.alt || "no alt"}):`);
    for (const [k, v] of Object.entries(node.properties)) {
      const val = typeof v === "string" && v.length > 100 ? v.substring(0, 100) + "..." : v;
      console.log(`  ${k}: ${val}`);
    }
  });

  if (passed < checks.length) process.exit(1);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});

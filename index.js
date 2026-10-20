import { VariantResolver } from "./lib/resolver.js";
import { collectImgUrls, rewriteTree } from "./lib/rewrite.js";

export default function imgnestIntegration(options) {
  if (!options?.sources?.length) {
    return { name: "astro-plugin-imgnest" };
  }

  const resolver = new VariantResolver(options);
  const rewriteOptions = {
    sizes: options.sizes || "(max-width: 800px) 100vw, 800px",
    writeDimensions: options.writeDimensions || false,
    fallbackOnError: options.fallbackOnError !== false,
  };

  return {
    name: "astro-plugin-imgnest",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        if (!resolver.hasSources) return;

        updateConfig({
          markdown: {
            rehypePlugins: [
              function rehypeImgnest() {
                return async (tree) => {
                  if (!resolver.hasSources) return;

                  const urls = collectImgUrls(tree);
                  if (urls.length === 0) return;

                  let variants;
                  try {
                    variants = await resolver.resolve(urls);
                  } catch {
                    return;
                  }
                  if (variants.size === 0) return;

                  rewriteTree(tree, variants, rewriteOptions);
                };
              },
            ],
          },
        });
      },
    },
  };
}

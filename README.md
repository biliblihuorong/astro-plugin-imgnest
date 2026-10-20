# astro-plugin-imgnest

English | [简体中文](./README.zh-CN.md)

Astro integration for ImgNest responsive images. At build time it scans images in Markdown pages, batch-queries ImgNest's variant lookup API, and automatically adds `srcset` and `sizes` to `<img>` tags.

## Requirements

An ImgNest server with responsive variants enabled. The public lookup endpoint (`POST /api/variants`) must be reachable from your build machine — no CORS setup is needed, because queries are made by Node, not the browser.

## Install

```bash
npm install astro-plugin-imgnest
```

## Usage

In `astro.config.mjs`:

```ts
import { defineConfig } from "astro/config";
import imgnestIntegration from "astro-plugin-imgnest";

export default defineConfig({
  integrations: [
    imgnestIntegration({
      sources: [
        {
          type: "lookup",
          hosts: "img.example.com",
          endpoint: "https://img.example.com/api/variants",
        },
      ],
      sizes: "(max-width: 800px) 100vw, 800px",
    }),
  ],
});
```

## Image sources

### Lookup API (ImgNest)

```ts
{
  type: "lookup",
  hosts: "img.example.com",
  endpoint: "https://img.example.com/api/variants",
}
```

At build time the plugin sends `POST {endpoint}` with `{"urls": [...]}`, in batches of at most 50 URLs — exactly the ImgNest `/api/variants` protocol.

### CDN URL template

For CDNs that can resize on the fly (Alibaba Cloud OSS, Tencent Cloud COS, Qiniu, etc.):

```ts
{
  type: "template",
  hosts: "img.example.com",
  template: "{url}{sep}x-oss-process=image/resize,w_{width}",
  widths: "400,800,1600",
}
```

No requests are made; variant URLs are built from the template. `{url}` is the original image URL, `{sep}` becomes `?` or `&` automatically, and `{width}` is the variant width.

## Options

| Option | Default | Description |
|---|---|---|
| `sources` | (required) | Image source list, matched in order |
| `sizes` | `(max-width: 800px) 100vw, 800px` | Default `sizes` added when an image has none |
| `writeDimensions` | `false` | Write the largest variant's `width`/`height` |
| `fallbackOnError` | `true` | Remove `srcset` and fall back to the original when a variant fails to load |
| `timeout` | `5000` | Lookup timeout in milliseconds |

## Scope and behavior

- Processes Markdown pages (`.md`) through a rehype plugin: both `![]()` images and inline `<img>` tags in Markdown.
- Does **not** process `.mdx` pages or `<img>` rendered inside Astro components — Astro's `markdown.rehypePlugins` only applies to `.md` pages.
- The rehype plugin is **appended** to your own `markdown.rehypePlugins`, so your existing rehype config is preserved.
- Images that already have a `srcset` are skipped; an existing `sizes` is never overwritten.
- Lazy-load attributes (`data-src`, `data-lazy-src`, `data-original`) take priority over `src`.
- The original URL is kept as the last `srcset` entry, and with `fallbackOnError` an `onerror` handler removes the `srcset` if a variant fails to load, so images always fall back to the original.
- Lookup results are cached for the whole build: every URL is queried once, no matter how many pages use it.
- On a non-200 answer (for example ImgNest's default rate limit of 60 lookups per minute per IP) the plugin logs a warning once and keeps the original URLs; on `429` it stops querying for the rest of the build. Raise `variant_lookup_per_minute` on your ImgNest server if your site is large.
- URLs longer than 2048 characters (the server-side limit) are skipped instead of failing the whole batch.

## License

MIT

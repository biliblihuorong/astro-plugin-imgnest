const LAZY_PROPS = ["dataSrc", "dataLazySrc", "dataOriginal"];
const MARKER = "dataResponsiveSrc";
const FALLBACK_SCRIPT = "this.onerror=null;this.removeAttribute('srcset')";
const FALLBACK_LAZY = `${FALLBACK_SCRIPT};this.src=this.getAttribute('data-responsive-src')`;

function isImageUrl(value) {
  if (!value) return false;
  const v = String(value).trim().toLowerCase();
  return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//");
}

function hasText(value) {
  return value != null && String(value).trim().length > 0;
}

function isPlaceholderSrcset(srcset, url, src) {
  if (!hasText(srcset)) return true;
  const items = String(srcset).split(/,\s+|,$/);
  for (const item of items) {
    const parts = item.trim().split(/\s+/);
    if (!parts[0]) continue;
    if (parts[0] !== url && parts[0] !== (src || "").trim()) return false;
  }
  return true;
}

function findCandidate(properties) {
  for (const name of LAZY_PROPS) {
    const value = properties[name];
    if (isImageUrl(value)) {
      return { url: String(value).trim(), fromLazyAttr: true };
    }
  }
  const src = properties.src;
  if (isImageUrl(src)) {
    return { url: String(src).trim(), fromLazyAttr: false };
  }
  return null;
}

function buildSrcset(variants, originalUrl) {
  const entries = variants.map(
    (v) => `${v.url.replace(/ /g, "%20")} ${v.width}w`,
  );
  if (originalUrl) {
    const alreadyIncluded = variants.some((v) => v.url === originalUrl);
    if (!alreadyIncluded) {
      const w = variants.length > 0 ? Math.max(variants[variants.length - 1].width + 1, 9999) : 9999;
      entries.push(`${originalUrl.replace(/ /g, "%20")} ${w}w`);
    }
  }
  return entries.join(", ");
}

export function collectImgUrls(tree) {
  const urls = new Set();
  visit(tree, "element", (node) => {
    if (node.tagName !== "img") return;
    const candidate = findCandidate(node.properties || {});
    if (candidate) urls.add(candidate.url);
  });
  return [...urls];
}

export function rewriteTree(tree, variants, options) {
  let changed = false;
  visit(tree, "element", (node) => {
    if (node.tagName !== "img") return;
    const props = node.properties || (node.properties = {});
    const candidate = findCandidate(props);
    if (!candidate) return;

    const v = variants.get(candidate.url);
    if (!v || v.length === 0) return;

    if (candidate.url === props[MARKER]) return;

    const srcsetProp = candidate.fromLazyAttr ? "dataSrcset" : "srcSet";
    const existingSrcset = props[srcsetProp];
    const src = props.src;

    if (!isPlaceholderSrcset(existingSrcset, candidate.url, src)) return;

    props[srcsetProp] = buildSrcset(v, candidate.url);
    changed = true;

    if (candidate.fromLazyAttr) {
      props[MARKER] = candidate.url;
    }

    if (
      options.fallbackOnError !== false &&
      srcsetProp === "srcSet" &&
      !props.onError
    ) {
      props.onError = candidate.fromLazyAttr ? FALLBACK_LAZY : FALLBACK_SCRIPT;
    }

    if (!hasText(props.sizes) && hasText(options.sizes)) {
      props.sizes = options.sizes.trim();
    }

    if (options.writeDimensions) {
      const largest = v[v.length - 1];
      if (largest.height && !props.width && !props.height) {
        props.width = largest.width;
        props.height = largest.height;
      }
    }
  });
  return changed;
}

function visit(tree, type, visitor) {
  if (!tree) return;
  if (tree.type === type) visitor(tree);
  if (tree.children) {
    for (const child of tree.children) {
      visit(child, type, visitor);
    }
  }
  if (tree.content?.type) {
    visit(tree.content, type, visitor);
  }
}

export { isImageUrl, isPlaceholderSrcset, findCandidate, buildSrcset };

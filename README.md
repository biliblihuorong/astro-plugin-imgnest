# astro-plugin-imgnest

ImgNest 响应式图片的 Astro 集成插件。构建时通过 rehype 插件扫描 Markdown 和组件中的图片，批量查询 ImgNest 的衍生版本接口，自动为 `<img>` 补上 `srcset` 和 `sizes`。

## 安装

```bash
npm install astro-plugin-imgnest
```

## 配置

在 `astro.config.mjs` 中使用：

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

## 图片来源

### 查询接口（ImgNest）

```ts
{
  type: "lookup",
  hosts: "img.example.com",
  endpoint: "https://img.example.com/api/variants",
}
```

构建时向 `POST {endpoint}` 发送 `{"urls": [...]}` 批量查询。

### URL 规则（CDN）

```ts
{
  type: "template",
  hosts: "img.example.com",
  template: "{url}{sep}x-oss-process=image/resize,w_{width}",
  widths: "400,800,1600",
}
```

不发请求，按模板拼接 URL。`{url}` 为原图地址，`{sep}` 自动为 `?` 或 `&`，`{width}` 为宽度值。

## 配置项

| 选项 | 默认值 | 说明 |
|---|---|---|
| `sources` | （必填） | 图片来源列表，按顺序匹配 |
| `sizes` | `(max-width: 800px) 100vw, 800px` | 图片没有 `sizes` 时补上的默认值 |
| `writeDimensions` | `false` | 写入最大版本的 `width`/`height` |
| `fallbackOnError` | `true` | 衍生图加载失败时撤下 `srcset`，回退到原图 |
| `timeout` | `5000` | 查询超时时间（毫秒） |

## 处理范围

通过 rehype 插件处理 hast（HTML AST）树，覆盖：

- Markdown 文件中的图片（`![]()` 和内嵌 `<img>`）
- Astro 组件中渲染的 `<img>` 元素
- 已有 `srcset` 的图片跳过
- 懒加载属性（`data-src`、`data-lazy-src`、`data-original`）优先于 `src`

## 许可证

MIT

# `mhy160.js` 代码说明

## 整体数据流程

```text
用户输入关键词
  → search.load()
  → getHtml() 请求漫画160搜索页
  → parseSearchResults() 生成 Comic 列表

用户打开某部漫画
  → comic.loadInfo(漫画ID)
  → 解析标题、封面、简介、章节目录
  → 反转章节数组，生成 ep_<章节ID> 键
  → 返回 ComicDetails

用户打开某个章节
  → comic.loadEp(漫画ID, ep_<章节ID>)
  → 还原章节ID并请求章节页
  → parsePid() 读取图片分流编号
  → parseImagePaths() 解码图片路径
  → buildImageUrl() 选择域名并编码路径
  → 返回 { images: [图片URL, ...] }
  → 阅读器通过 onImageLoad() 附带 Referer 加载图片
```

脚本提供内容数据和请求配置，阅读界面、图片下载、缓存、预加载、应用内收藏和历史记录由宿主处理。

## 宿主依赖

| 接口 | 在本脚本中的用途 |
| --- | --- |
| `ComicSource` | 漫画源基类；提供设置读取等能力。 |
| `Network.get(url, headers)` | 请求网站页面，并取得状态码、响应头和页面正文。 |
| `HtmlDocument` | 搜索页 DOM 解析器；提供 CSS 选择器和元素属性、文本访问。 |
| `Convert.decodeBase64` | 将章节图片路径字符串解码为字节。 |
| `Convert.decodeUtf8` | 将这些字节转换为包含中文路径的字符串。 |
| `Comic` | 搜索结果和探索页作品条目的数据结构。 |
| `ComicDetails` | 作品详情和章节目录的数据结构。 |
| `this.loadSetting("imageHost")` | 读取用户选择的图片资源域名。 |

这些对象由 VeneraNext 注入。脚本没有 Node.js 的模块导出、命令行入口或独立服务启动逻辑。

## 页面请求与错误处理

`headers` getter 提供移动端浏览器 UA 和站点 Referer。`getHtml(path, noCache)` 将 `baseUrl` 与路径拼接后执行请求；`noCache = true` 时额外传入 `cache-time: no`。搜索使用此选项，它控制宿主的页面请求缓存，不等同于清理阅读器图片缓存。

请求后的处理顺序是：

1. 检查响应头或正文是否具有 Cloudflare 质询页特征。
2. 检出质询页时抛出 `CloudflareException: <完整URL>`。这也覆盖状态码为 200 的质询页。
3. 状态码不是 200 时抛出 `HTTP <状态码> : <路径>`。
4. 正文不是字符串时抛出「漫画160 返回的页面不是文本」。
5. 正常时返回 HTML 文本。

`getHtml` 不捕获宿主网络层抛出的异常。搜索和详情因此能把验证或网络失败传给应用；探索页的首页推荐则单独捕获错误，保留已生成的直达入口。

UA 的键使用小写 `user-agent`。源码注释说明，宿主在保存验证网页的 Cookie/UA 后会覆盖这个键；修改时需要同时核对所用应用的网络实现。

## 搜索解析

`search.load(keyword, options, page)` 会去除关键词首尾空白。空关键词或 `page > 1` 直接得到 `{ comics: [], maxPage: 1 }`，其他情况请求：

```text
/statics/search.aspx?key=<encodeURIComponent编码后的关键词>
```

`parseSearchResults(html)` 先创建 `HtmlDocument`，定位 `#listbody`，然后遍历其中的 `li`：

- 链接：寻找 `a[href*="/kanmanhua/"]`，从目录链接提取数字漫画 ID。
- 名称：优先读取 `.txtA` 的文本，回退到链接的 `title`、链接文本或漫画 ID。
- 副标题：读取 `.info` 的文本。
- 封面：优先使用 `data-src`，其次 `data-original`，最后 `src`。
- 地址转换：`absoluteUrl` 处理 HTTP(S) 地址、`//` 地址、根相对路径和普通相对路径。
- 去重：相同漫画 ID 只保留第一次出现的条目。

解析器通过 `finally` 调用 `doc.dispose()` 释放文档。存在空 `#listbody` 时返回正常空结果；缺少这个容器则抛出页面格式变化错误。

当前不会向站点传递搜索筛选项，也没有提取搜索分页信息。

## 探索页

探索页采用兼容接口 `singlePageWithMultiPart`，返回 `{ "分区名": Comic[] }`。

「常用直达」来自 `builtinIndex`，目前只有《中国惊奇先生》。生成列表不请求网络，但封面地址、目录和图片仍是线上资源。

「首页推荐」请求首页，再通过正则提取目录链接、标题和封面。仅匹配当前正则要求的属性顺序和标签组合；无法获取首页、无法匹配或没有结果时，不加入该分区。

## 详情和章节顺序

`comic.loadInfo(id)` 请求 `/kanmanhua/{id}/`：

| 数据 | 提取方法 |
| --- | --- |
| 封面 | `og:image`，并把匹配的尺寸后缀归一化到 `@!180x240`。 |
| 简介 | `meta name="description"`。 |
| 标题 | 优先 `og:novel:book_name`，其次页面 `<title>`，最后回退到漫画 ID；会删除末尾「漫画」。 |
| 章节 | 先截取 `ul#chapterList_ul_1`，再解析其中符合格式的章节链接和名称。 |
| 标签 | 固定 `{}`，满足 `ComicDetails` 的对象类型要求。 |

站点目录预期从新到旧，因此脚本先反转章节数组，再按该顺序写入对象。使用 `ep_` 前缀是为了避免 JavaScript 对纯整数对象键自动按数值重新排序。

例如，站点页面包含较新的 `200.html` 和较旧的 `100.html` 时，插件预期返回：

```javascript
{
    "ep_100": "较早章节",
    "ep_200": "较新章节"
}
```

前缀是阅读器使用的章节标识，网站请求仍使用原始数字。此处的目录和元信息正则对 HTML 格式有要求，不具备完整 DOM 解析器的容错能力。

## 图片路径与域名

`comic.loadEp(comicId, epId)` 删除章节键开头的 `ep_`，请求 `/kanmanhua/{comicId}/{pid}.html`。随后使用章节页面中的 `qTcms_S_p_id` 判断域名分流；这个页面变量才是分流依据。

`parseImagePaths` 的流程为：

1. 按当前正则匹配 `url_e="..."`。
2. 删除 Base64 字符串中的空白，调用 `Convert.decodeBase64`。
3. 调用 `Convert.decodeUtf8` 解码文本，保留中文路径。
4. 按 `$qingtiandy$` 或 `$pingtiand$` 分隔符拆分。
5. 只保留以 `/` 开头的非空路径。

示意输入的解码结果可以是：

```text
/demo/第1话/001.jpg$qingtiandy$/demo/第1话/002.jpg
```

`buildImageUrl(path, pid)` 有手动设置时使用选定域名；否则，`pid > 542724` 使用 `newHosts[0]`，其余使用老域名 `mhpic6.tgmhfc.uk`。最后通过 `encodeURI(path)` 编码路径，与 `https://<域名>` 拼接。

返回值形状是 `{ images: string[] }`。脚本只生成图片地址，没有在此函数中下载图片，也没有检查各域名是否在线。

## 图片和链接回调

`comic.onImageLoad` 和同步的 `comic.onThumbnailLoad` 都返回图片原始 URL，并添加 `Referer: https://m.mh160mh.com/`。封面单独提供回调，因为它不会自动继承正文图片请求头。

`comic.link` 声明三个站点域名，`linkToId(url)` 从 `/kanmanhua/(数字)/` 中提取漫画 ID。匹配章节链接时同样只返回作品 ID，当前没有根据链接里的章节号直接定位章节。

## 维护时优先关注的位置

| 站点或需求变化 | 相关代码 |
| --- | --- |
| 网站页面域名或 Referer 改变 | `baseUrl`、`referer`、两个图片回调中的 Referer 常量、`comic.link.domains`。 |
| 搜索 HTML 改变 | `parseSearchResults` 的选择器及目录链接正则。 |
| 首页布局改变 | `explore[0].load` 中的正则。 |
| 目录结构改变或出现分组 | `comic.loadInfo` 中的目录容器和章节正则。 |
| 图片变量、分隔符或编码改变 | `parseImagePaths`、`decodeB64Utf8`、`parsePid`。 |
| 图片域名或分流阈值改变 | `newHosts`、`settings.imageHost.options`、`buildImageUrl`。 |
| 需要真正的域名故障切换 | 目前没有实现，需要另行设计失败重试及图片回调。 |
| 需要作者标签或追更日期 | `comic.loadInfo` 的 `tags` 和可选 `updateTime`。 |
| 发布脚本新版本 | 同步修改脚本 `version` 与 `index.json` 中的版本；保留 `key = "mh160"`。 |
| 需要脚本自身在线更新 | 为 `url` 填写真实、可访问且直接返回 JS 的原始文件地址。 |

这些是当前实现的维护位置说明。本次发布没有更改原脚本的抓取或解析逻辑。

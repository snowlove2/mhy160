/**
 * 漫画160 (mh160mh.com) — VeneraNext 漫画源
 *
 * 支持全站在线搜索、漫画目录和章节阅读。
 * 站点机制：
 *  - 目录页 /kanmanhua/{id}/ ，章节在 ul#chapterList_ul_1 的 li>a 里，最新在前（需反转）。
 *  - 章节页 /kanmanhua/{id}/{pid}.html ，正文图片路径 base64 存在变量 url_e 中，
 *    以 "$qingtiandy$" 分隔；是 UTF-8 中文路径。
 *  - 图片必须带 Referer，否则 404。域名按 qTcms_S_p_id 分流：
 *      p_id > 542724 → 新域名池 (xwdf / mhreswhm / qwe123 / resmhpic / reszxc / mhpic7fr .tgmhfc.uk)
 *      否则          → mhpic6.tgmhfc.uk
 *  - 封面在 p.miyeye.cn，同样需要 Referer。
 *  - 搜索： /statics/search.aspx?key=关键词
 */
class MH160 extends ComicSource {
    name = "漫画160";
    key = "mh160";
    version = "1.0.1";
    minAppVersion = "1.0.0";
    url = "";

    baseUrl = "https://m.mh160mh.com";
    referer = "https://m.mh160mh.com/";
    // 新章节图片域名池，任一可用
    newHosts = [
        "xwdf.tgmhfc.uk",
        "mhreswhm.tgmhfc.uk",
        "qwe123.tgmhfc.uk",
        "resmhpic.tgmhfc.uk",
        "reszxc.tgmhfc.uk",
        "mhpic7fr.tgmhfc.uk",
    ];

    settings = {
        imageHost: {
            title: "图片资源站域名",
            type: "select",
            options: [
                { value: "", text: "自动(推荐)" },
                { value: "xwdf.tgmhfc.uk" },
                { value: "mhreswhm.tgmhfc.uk" },
                { value: "qwe123.tgmhfc.uk" },
                { value: "resmhpic.tgmhfc.uk" },
                { value: "reszxc.tgmhfc.uk" },
                { value: "mhpic7fr.tgmhfc.uk" },
                { value: "mhpic6.tgmhfc.uk", text: "mhpic6(老章节)" },
            ],
            default: "",
        },
    };

    get headers() {
        return {
            // 有 cf_clearance 时，宿主以验证网页的 UA 覆盖这个小写键。
            "user-agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "referer": this.referer,
        };
    }

    async getHtml(path, noCache = false) {
        const url = this.baseUrl + path;
        const headers = this.headers;
        if (noCache) headers["cache-time"] = "no";
        // 不 catch：宿主识别 CloudflareException 后显示“验证”按钮，
        // 保存验证网页的 Cookie/UA，再重试原来的搜索。
        const res = await Network.get(url, headers);
        const body = res.body;
        const responseHeaders = res.headers || {};
        const mitigated = Object.keys(responseHeaders).some(key =>
            key.toLowerCase() === "cf-mitigated" &&
            String(responseHeaders[key]).toLowerCase() === "challenge"
        );
        const challenge = typeof body === "string" && (
            /<title[^>]*>\s*(?:Just a moment|Attention Required)/i.test(body) ||
            /\b_cf_chl_opt\s*=/.test(body) ||
            /id=["']challenge-form["']/i.test(body)
        );
        // 兼容没有在网络层识别质询页的宿主版本，包括返回 200 的质询页。
        if (mitigated || challenge) throw "CloudflareException: " + url;
        if (res.status !== 200) {
            throw "HTTP " + res.status + " : " + path;
        }
        if (typeof body !== "string") throw "漫画160 返回的页面不是文本";
        return body;
    }

    // 仅供探索页“常用直达”使用；搜索结果始终来自站点。
    builtinIndex = {
        "中国惊奇先生": {
            id: "15111",
            title: "中国惊奇先生",
            cover: "https://p.miyeye.cn/mh160xiaotuku/2013-11/21/2013112193637610.jpg@!180x240",
        },
    };

    /** 用 Convert 解码 base64(UTF-8) 文本 */
    decodeB64Utf8(s) {
        const bytes = Convert.decodeBase64(String(s).replace(/\s/g, ""));
        if (!bytes) return "";
        return Convert.decodeUtf8(bytes);
    }

    /** 章节页里取出 url_e 的图片路径数组 */
    parseImagePaths(html) {
        const m = html.match(/url_e="([^"]+)"/);
        if (!m) return [];
        const decoded = this.decodeB64Utf8(m[1]);
        if (!decoded) return [];
        return decoded.split(/\$(?:qingtiandy|pingtiand)\$/).filter(p => p && p.charAt(0) === "/");
    }

    /** 章节页里取出 qTcms_S_p_id，用于判断图片域名分流 */
    parsePid(html) {
        const m = html.match(/qTcms_S_p_id="(\d+)"/);
        return m ? parseInt(m[1], 10) : 0;
    }

    /** 把图片相对路径拼成完整 URL */
    buildImageUrl(path, pid) {
        let host = this.loadSetting("imageHost");
        if (!host) {
            host = pid > 542724 ? this.newHosts[0] : "mhpic6.tgmhfc.uk";
        }
        return "https://" + host + encodeURI(path);
    }

    /** 搜索封面可能是相对地址，也可能使用延迟加载属性。 */
    absoluteUrl(value) {
        if (!value) return "";
        const url = String(value).trim();
        if (/^https?:\/\//i.test(url)) return url;
        if (url.indexOf("//") === 0) return "https:" + url;
        if (url.charAt(0) === "/") return this.baseUrl + url;
        return this.baseUrl + "/" + url;
    }

    parseSearchResults(html) {
        const doc = new HtmlDocument(html);
        try {
            const list = doc.querySelector("#listbody");
            if (!list) throw "漫画160 搜索页面格式变化，请更新漫画源";
            const comics = [];
            const seen = {};
            for (const item of list.querySelectorAll("li")) {
                const link = item.querySelector('a[href*="/kanmanhua/"]');
                const href = link ? link.attributes["href"] || "" : "";
                const match = href.match(/\/kanmanhua\/(\d+)\/(?:[?#].*)?$/);
                if (!match || seen[match[1]]) continue;
                seen[match[1]] = true;
                const name = item.querySelector(".txtA");
                const info = item.querySelector(".info");
                const image = item.querySelector("img");
                const attrs = image ? image.attributes : {};
                comics.push(new Comic({
                    id: match[1],
                    title: (name ? name.text : link.attributes["title"] || link.text || match[1]).trim(),
                    subtitle: info ? info.text.trim() : "",
                    cover: this.absoluteUrl(attrs["data-src"] || attrs["data-original"] || attrs["src"]),
                }));
            }
            return { comics: comics, maxPage: 1 };
        } finally {
            doc.dispose();
        }
    }

    // ---------------- 搜索 ----------------
    // 搜索失败直接交给宿主处理，不能把验证失败/网络错误伪装成“没有结果”。
    search = {
        optionList: [],
        load: async (keyword, options, page) => {
            const query = String(keyword || "").trim();
            if (!query || page > 1) return { comics: [], maxPage: 1 };
            const html = await this.getHtml("/statics/search.aspx?key=" + encodeURIComponent(query), true);
            return this.parseSearchResults(html);
        },
    };

    // ---------------- 探索：直达 + 首页推荐 ----------------
    // 第一个分区「常用直达」不经过任何网络请求，直接列出内置作品，
    // 可直接进入已知漫画目录，与在线搜索互不干扰。
    explore = [
        {
            title: "漫画160",
            type: "singlePageWithMultiPart",
            load: async () => {
                const parts = {};

                // 1) 常用直达（离线，必定可用）
                const quick = [];
                for (const key in this.builtinIndex) {
                    const c = this.builtinIndex[key];
                    quick.push(new Comic({ id: c.id, title: c.title, cover: c.cover }));
                }
                parts["常用直达"] = quick;

                // 2) 首页推荐（联网，失败则忽略，不影响上面的直达）
                try {
                    const html = await this.getHtml("/");
                    const re = /<a[^>]*href="\/kanmanhua\/(\d+)\/"[^>]*title="([^"]*)"[^>]*>\s*<img[^>]*src="([^"]+)"/g;
                    const seen = {};
                    const comics = [];
                    let m;
                    while ((m = re.exec(html)) !== null) {
                        if (seen[m[1]]) continue;
                        seen[m[1]] = true;
                        comics.push(new Comic({ id: m[1], title: m[2], cover: m[3] }));
                    }
                    if (comics.length > 0) parts["首页推荐"] = comics;
                } catch (e) {
                    // 首页失败无所谓，常用直达已在上面
                }
                return parts;
            },
        },
    ];

    // ---------------- 漫画详情 ----------------
    comic = {
        loadInfo: async (id) => {
            const html = await this.getHtml("/kanmanhua/" + id + "/");
            let title = "", cover = "", description = "";
            const ogImg = html.match(/<meta property="og:image" content="([^"]+)"/);
            if (ogImg) cover = ogImg[1].replace(/@!180x240.*$/, "@!180x240");
            const desc = html.match(/<meta name="description" content="([^"]+)"/);
            if (desc) description = desc[1];

            // 章节只在 ul#chapterList_ul_1 内，用整块正则截取，避免遍历整页 2000+ 节点
            const ulMatch = html.match(/<ul[^>]*id="chapterList_ul_1"[\s\S]*?<\/ul>/);
            const chaptersList = [];
            if (ulMatch) {
                const re = /<li><a href="\/kanmanhua\/\d+\/(\d+)\.html"[^>]*>([^<]+)<\/a><\/li>/g;
                let m;
                while ((m = re.exec(ulMatch[0])) !== null) {
                    chaptersList.push({ id: m[1], title: m[2].trim() });
                }
            }
            // 目录页没有 h1，标题从 og:novel:book_name 或 <title> 提取
            const ogName = html.match(/<meta property="og:novel:book_name" content="([^"]+)"/);
            if (ogName) {
                title = ogName[1].replace(/漫画$/, "").trim();
            }
            if (!title) {
                const t = html.match(/<title[^>]*>([^<]*)</i);
                title = t ? t[1].split(/[,，]/)[0].replace(/漫画$/, "").trim() : id;
            }
            // 站点目录为最新在前，反转为从旧到新的阅读顺序；用 ep_ 前缀避免整数键排序问题
            chaptersList.reverse();
            const chapters = {};
            for (let i = 0; i < chaptersList.length; i++) {
                chapters["ep_" + chaptersList[i].id] = chaptersList[i].title;
            }
            return new ComicDetails({
                title: title,
                cover: cover,
                description: description,
                tags: {},   // 必填：按命名空间分组的对象，无标签时用空对象；缺失会报 Invalid data
                chapters: chapters,
            });
        },

        loadEp: async (comicId, epId) => {
            const pid = epId && epId.indexOf("ep_") === 0 ? epId.slice(3) : epId;
            const html = await this.getHtml("/kanmanhua/" + comicId + "/" + pid + ".html");
            const sitePid = this.parsePid(html);
            const paths = this.parseImagePaths(html);
            const images = paths.map(p => this.buildImageUrl(p, sitePid));
            return { images: images };
        },

        // 正文图片与封面都需 Referer
        onImageLoad: (imageKey) => ({
            url: imageKey,
            headers: { "Referer": "https://m.mh160mh.com/" },
        }),

        onThumbnailLoad: (imageKey) => ({
            url: imageKey,
            headers: { "Referer": "https://m.mh160mh.com/" },
        }),

        // 支持直接粘贴站点链接
        link: {
            domains: ["mh160mh.com", "www.mh160mh.com", "m.mh160mh.com"],
            linkToId: (url) => {
                const m = url.match(/\/kanmanhua\/(\d+)\//);
                return m ? m[1] : null;
            },
        },
    };
}

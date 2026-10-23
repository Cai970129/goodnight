# goodnight

一个面向手机的睡前听书网页。使用原生 HTML、CSS 和 JavaScript 模块，书籍信息通过 JSON 配置维护。

## 代码结构

```text
goodnight/
├── index.html                    # 页面入口
├── asserts/                      # 软件资源
│   ├── css/main.css              # 页面样式
│   ├── images/                   # 网站图标与播放头像
│   ├── vendor/pdfjs/             # PDF 在线阅读组件及许可
│   └── js/
│       ├── app.js                # 初始化与模块协调
│       ├── pdf-reader.js         # PDF 加载、翻页与缩放
│       ├── player.js             # 音频播放与状态
│       ├── library.js            # 书库加载与配置校验
│       ├── ui.js                 # 界面渲染与交互
│       ├── storage.js            # 收藏与设置存储
│       └── timer.js              # 睡眠定时
├── books/
│   ├── catalog.json              # 书籍列表与顺序
│   ├── 01-MaoYu/
│   │   ├── book.json             # 书籍与章节配置
│   │   ├── images/
│   │   ├── audio/
│   │   └── pdf/
│   └── 02-WuXuBiJi/
│       ├── book.json
│       ├── images/
│       ├── audio/
│       │   └── 01-XieZuoZhiYe/    # 第一章 · 写作之夜
│       │       ├── 01.mp3
│       │       ├── 02.mp3
│       │       └── 03.mp3
│       └── pdf/
└── manifest.webmanifest          # 网站名称、图标与桌面入口配置
```

## 当前实现的功能

- **首页与播放**：默认《猫鱼》，支持播放、暂停、进度跳转、上一节和下一节；刷新后从头开始，不自动播放
- **收听控制**：支持 0.75×、1×、1.25×、1.5×、2× 倍速；默认开启顺序连播，可手动关闭，书末停止。书架、收藏、设置和 PDF 阅读页面也可以播放或暂停当前音频。
- **书架与目录**：书籍独立加载，按目录顺序展示；支持多书切换、书名/作者搜索、分类筛选、章节/分节搜索、逐章展开/收起和全部展开/收起；搜索自动展开匹配内容，清空搜索恢复折叠状态；缺失音频的分节不可播放。
- **睡眠定时**：15 分钟、30 分钟、当前节结束、当前章结束；支持替换和取消，定时停止优先于连播，刷新后定时取消。
- **收藏与设置**：收藏列表、倍速和连播设置在当前浏览器保存；清除前需要确认，清除不会暂停当前播放或取消定时。
- **书籍资料**：支持封面、简介、配图与摘录切换，以及 PDF 页面内阅读，支持翻页、输入页码、适合宽度和缩放；阅读时可控制音频，也可单独打开 PDF 原文件。
- **播放异常处理**：提供必要的错误提示和重试，避免切书时旧请求覆盖当前状态。
- **系统媒体控制**：在支持的浏览器中提供系统面板的播放、暂停、上下节和进度控制。

“当前节结束”针对正在播放的音频分节；“当前章结束”针对完整章节，包含该章的全部分节。系统限制浏览器后台运行时，定时停止可能延后。

换书、手动换节或切换章节均保留已选择的定时模式。“当前节结束”和“当前章结束”随当前播放内容生效，按分钟的定时继续沿用原截止时间。

## 书籍列表

| 书籍 | 作者 | 朗读人 | 可收听内容 | 其他资源 | 待补充音频 |
| --- | --- | --- | --- | --- | --- |
| 《猫鱼》 | 陈冲 | Carrie | 前言、第一章《平江路的老房子》上 | 封面、六组配图与摘录 | 第一章《平江路的老房子》中 |
| 《务虚笔记》 | 史铁生 | yangLieee | 第一章《写作之夜》，共三节 | 封面、三组配图与摘录、[PDF 原文](books/02-WuXuBiJi/pdf/wu-xu-bi-ji.pdf) | 第二章《残疾与爱情》 |

## 添加一本新的听书

### 1. 放置书籍资源

在 `books/` 下按照现有编号新建目录，例如 `03-NewBook/`。每本书分别保存图片、音频和 PDF，软件资源仍放在 `asserts/`。

```text
books/03-NewBook/
├── book.json
├── images/
│   └── cover.jpg
├── audio/
│   └── 01-ChapterName/
│       ├── 01.mp3
│       └── 02.mp3
└── pdf/
    └── book.pdf
```

同一章有多个音频时，放在同一个章节目录中，按收听顺序命名。没有 PDF 时可以保留空的 `pdf/` 目录；Git 不跟踪空目录。

### 2. 编写书籍配置

创建 `books/03-NewBook/book.json`：

```json
{
  "id": "03-NewBook",
  "title": "书名",
  "author": "作者",
  "narrator": "Carrie",
  "category": "小说",
  "description": "这本书的内容介绍。",
  "cover": "images/cover.jpg",
  "banners": [],
  "pdf": "pdf/book.pdf",
  "chapters": [
    {
      "id": "chapter-01",
      "title": "第一章 · 章节名称",
      "tracks": [
        {
          "id": "chapter-01-part-01",
          "title": "第 1 节",
          "src": "audio/01-ChapterName/01.mp3"
        },
        {
          "id": "chapter-01-part-02",
          "title": "第 2 节",
          "src": "audio/01-ChapterName/02.mp3"
        }
      ]
    }
  ]
}
```

- `narrator` 为本书的朗读人，填写 `Carrie` 显示女生头像，填写 `yangLieee` 显示男生头像，名称区分大小写。主播放器和小播放器自动使用相同头像；未填写或其他名称使用网站图标，书籍仍可加载。
- `description` 只介绍书籍内容，不填写资源数量、分节安排、上传进度或操作说明。
- `id` 使用英文字母、数字、短横线或下划线，并以字母或数字开头。书籍 ID 在书库中唯一，章节和分节 ID 各自在本书内唯一。
- `chapters` 和 `tracks` 数组的顺序决定章节与分节的展示、连播顺序。
- 图片、音频和 PDF 路径均相对于本书的 `book.json`，资源必须位于本书目录内。
- 缺少封面、PDF 或某一节音频时，对应的 `cover`、`pdf`、`src` 填写 `null`，不要填写尚不存在的文件路径。音频缺失的分节会显示为不可播放。
- 音轨可选填 `duration`，单位为秒，用于目录时长展示；播放时仍读取音频实际时长。
- 如需顶部图文，参照现有书籍填写 `banners`：每项包含 `image`、`quote`、`source`，可选填写 HTTPS 原文链接 `sourceURL`。图片来源及许可说明保存在本书的 `images/SOURCES.md`。

### 3. 加入书架

在 `books/catalog.json` 的 `books` 数组中添加：

```json
{
  "id": "03-NewBook",
  "manifest": "03-NewBook/book.json"
}
```

`id` 必须与新书配置一致。书架按该数组的顺序展示，目录编号用于保持资源目录清晰；新增书籍不改变默认首页《猫鱼》。

### 4. 本地检查并更新书籍列表

本地工作目录保留了一个无需额外依赖的 Node.js 预览入口，支持 HTTP Range：

```sh
node .local/scripts/serve.mjs
```

`.local/` 仅保留本地预览入口和原始媒体备份，不提交到 GitHub。新克隆仓库、尚无此目录时，可使用 Python 3 做基础页面和资源预览：

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

浏览器访问 `http://localhost:8000/`，从书架选择新书，检查封面、章节顺序、各节播放、连播、定时和 PDF 入口。页面通过请求加载 JSON，需要通过 HTTP 服务访问。

Python 简易服务不作为分段加载、未下载位置跳转的验收环境。检查这些行为及正式部署时，应使用支持 HTTP Range 的静态服务；发送 `Range: bytes=0-99` 后应返回 `206 Partial Content` 和 `Content-Range`。

最后更新本文的“书籍列表”，如实填写可收听内容和待补充音频。

### 5. 控制资源体积

当前网页播放音频采用约 96 kbps 单声道；MP3 与 M4A 格式按原路径保留。封面使用适合小尺寸显示的压缩图片，书架封面按需加载。

新增音频时先备份原件，再生成播放副本，核对时长、解码、试听和进度跳转。压缩属于有损转换，原件保存在独立备份中；本地处理的原始文件位于不提交的 `.local/originals/`。重复优化应从原件开始，避免多次有损转码。

## 本地阅读

已配置 PDF 的书籍，可在“关于这本书”标题右侧点击“在线阅读 PDF”，直接在网页内翻页阅读。支持上一页、下一页、输入页码及缩放，返回收听不影响当前音频和定时。没有 PDF 的书籍不显示阅读入口。

PDF 阅读组件随网站部署，只在进入阅读页面后加载，无需外部阅读服务。书籍较大时首次加载需要等待；加载失败或超时可重试，重试保留当前页码和缩放；也可点击“打开原文件”，交由浏览器或系统阅读器打开。正文以页面图像显示，文本选择和全文搜索可使用原文件阅读器。网页不保存阅读进度，也不提供任意本地文件导入。

PDF 文件保存在对应书籍的 `pdf/` 目录中，也可以直接使用本地阅读器打开。新增书籍只需配置 `pdf` 路径即可使用页面内阅读。

## GitHub 在线阅读

在 GitHub 仓库中点击书籍列表的“PDF 原文”，即可进入 PDF 文件预览页。GitHub 提供 PDF 渲染支持，详见 [GitHub 文档](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files#rendering-pdf-documents)。

如果希望在线使用完整的听书网页，可通过 GitHub Pages 发布当前静态站点。在仓库的 **Settings → Pages** 中选择 **Deploy from a branch → main → /(root)** 并保存；发布成功后使用 Pages 显示的网址访问，再点击书籍的“在线阅读 PDF”进行阅读。配置方式参见 [GitHub Pages 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

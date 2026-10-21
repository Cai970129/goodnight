# goodnight

一个面向手机的睡前听书网页。使用原生 HTML、CSS 和 JavaScript 模块，书籍信息通过 JSON 配置维护。

## 代码结构

```text
goodnight/
├── index.html                    # 页面入口
├── asserts/                      # 软件资源
│   ├── css/main.css              # 页面样式
│   ├── images/icon.svg           # 网站图标
│   └── js/
│       ├── app.js                # 初始化与模块协调
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

- **首页与播放**：默认《猫鱼》，支持播放、暂停、进度跳转、上一节和下一节；刷新后从头开始，不自动播放。
- **收听控制**：支持 0.75×、1×、1.25×、1.5×、2× 倍速及可开关的顺序连播，书末停止。
- **书架与目录**：书籍独立加载，按目录顺序展示；支持多书切换、书名/作者搜索、分类筛选、章节/分节搜索；缺失音频的分节不可播放。
- **睡眠定时**：15 分钟、30 分钟、当前节结束、当前章结束；支持替换和取消，定时停止优先于连播，刷新后定时取消。
- **收藏与设置**：收藏列表、倍速和连播设置在当前浏览器保存；清除前需要确认。
- **书籍资料**：支持封面、简介、配图与摘录切换，以及 PDF 原文入口（浏览器支持时可保存）。
- **播放异常处理**：提供必要的错误提示和重试，避免切书时旧请求覆盖当前状态。
- **系统媒体控制**：在支持的浏览器中提供系统面板的播放、暂停、上下节和进度控制。

“当前节结束”针对正在播放的音频分节；“当前章结束”针对完整章节，包含该章的全部分节。系统限制浏览器后台运行时，定时停止可能延后。

## 书籍列表

| 书籍 | 作者 | 可收听内容 | 其他资源 | 待补充音频 |
| --- | --- | --- | --- | --- |
| 《猫鱼》 | 陈冲 | 前言 | 封面、三组配图与摘录 | 第一章 |
| 《务虚笔记》 | 史铁生 | 第一章《写作之夜》，共三节 | 封面、三组配图与摘录、[PDF 原文](books/02-WuXuBiJi/pdf/wu-xu-bi-ji.pdf) | 第二章《残疾与爱情》 |

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

在仓库根目录使用 Python 3 启动静态服务：

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

浏览器访问 `http://localhost:8000/`，从书架选择新书，检查封面、章节顺序、各节播放、连播、定时和 PDF 入口。页面通过请求加载 JSON，需要通过 HTTP 服务访问。

最后更新本文的“书籍列表”，如实填写可收听内容和待补充音频。

## 本地阅读

已配置 PDF 的书籍，可在“关于这本书”标题右侧点击“PDF 原文”，由浏览器或系统 PDF 阅读器打开。PDF 文件保存在对应书籍的 `pdf/` 目录中，也可以直接使用本地阅读器打开；保存到设备后可离线阅读。

当前网页没有内置独立阅读器，也不提供任意本地文件导入或 EPUB/TXT 阅读功能。

## GitHub 在线阅读

在 GitHub 仓库中点击书籍列表的“PDF 原文”，即可进入 PDF 文件预览页。GitHub 提供 PDF 渲染支持，详见 [GitHub 文档](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files#rendering-pdf-documents)。

如果希望在线使用完整的听书网页，可通过 GitHub Pages 发布当前静态站点。在仓库的 **Settings → Pages** 中选择 **Deploy from a branch → main → /(root)** 并保存；发布成功后使用 Pages 显示的网址访问，再点击书籍的“PDF 原文”进行阅读。配置方式参见 [GitHub Pages 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

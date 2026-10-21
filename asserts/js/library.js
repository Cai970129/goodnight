const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function requireText(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}不能为空`);
    return value.trim();
}

export function resolveResource(path, manifestURL) {
    if (path == null) return null;
    requireText(path, '资源路径');
    const base = new URL('.', manifestURL);
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) {
        throw new Error('资源路径必须位于本书目录中');
    }
    return url.href;
}

export function parseBook(data, manifestURL, expectedId) {
    if (!data || typeof data.id !== 'string' || data.id !== expectedId || !idPattern.test(data.id)) throw new Error('书籍 ID 不匹配');
    const book = {
        id: data.id, title: requireText(data.title, '书名'), author: requireText(data.author, '作者'),
        description: typeof data.description === 'string' ? data.description : '',
        category: typeof data.category === 'string' ? data.category : '',
        cover: resolveResource(data.cover, manifestURL), pdf: resolveResource(data.pdf, manifestURL),
        chapters: [], tracks: [], banners: []
    };
    if (!Array.isArray(data.chapters)) throw new Error('章节配置必须为数组');
    const chapterIds = new Set(), trackIds = new Set();
    for (const entry of data.chapters) {
        if (!entry || typeof entry.id !== 'string' || !idPattern.test(entry.id) || chapterIds.has(entry.id)) throw new Error('章节 ID 无效或重复');
        chapterIds.add(entry.id);
        const chapter = { id: entry.id, title: requireText(entry.title, '章节名称'), tracks: [] };
        if (!Array.isArray(entry.tracks)) throw new Error('分节配置必须为数组');
        for (const item of entry.tracks) {
            if (!item || typeof item.id !== 'string' || !idPattern.test(item.id) || trackIds.has(item.id)) throw new Error('分节 ID 无效或重复');
            trackIds.add(item.id);
            const title = requireText(item.title, '分节名称');
            const track = {
                id: item.id, title, chapterId: chapter.id,
                label: entry.tracks.length === 1 && title === chapter.title ? title : `${chapter.title} · ${title}`,
                src: resolveResource(item.src, manifestURL), duration: Number.isFinite(item.duration) ? item.duration : null
            };
            chapter.tracks.push(track);
            book.tracks.push(track);
        }
        book.chapters.push(chapter);
    }
    for (const banner of data.banners || []) {
        book.banners.push({ image: resolveResource(banner.image, manifestURL), quote: requireText(banner.quote, '摘录'), source: requireText(banner.source, '摘录出处') });
    }
    return book;
}

async function fetchJSON(url, fetcher) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetcher(url, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error(`读取失败（${response.status}）`);
        return await response.json();
    } finally { clearTimeout(timeout); }
}

export async function loadLibrary(catalogURL = new URL('../../books/catalog.json', import.meta.url), fetcher = fetch) {
    const url = new URL(catalogURL);
    const catalog = await fetchJSON(url.href, fetcher);
    if (catalog.version !== 1 || !Array.isArray(catalog.books)) throw new Error('书架配置格式不正确');
    const seen = new Set();
    const entries = await Promise.all(catalog.books.map(async entry => {
        const id = entry?.id;
        if (typeof id !== 'string' || !idPattern.test(id) || seen.has(id)) return { id: String(id || ''), error: '书籍 ID 无效或重复' };
        seen.add(id);
        try {
            const manifestURL = new URL(requireText(entry.manifest, '配置路径'), url);
            if (manifestURL.origin !== url.origin || !manifestURL.pathname.startsWith(new URL('.', url).pathname)) throw new Error('书籍配置必须位于 books 目录中');
            return parseBook(await fetchJSON(manifestURL.href, fetcher), manifestURL, id);
        } catch (error) { return { id, error: error.name === 'AbortError' ? '读取超时，请重试' : error.message }; }
    }));
    return { books: entries.filter(entry => !entry.error), errors: entries.filter(entry => entry.error) };
}

export function adjacentTrack(book, trackId, direction) {
    const index = book.tracks.findIndex(track => track.id === trackId);
    for (let i = index + direction; i >= 0 && i < book.tracks.length; i += direction) {
        if (book.tracks[i].src) return book.tracks[i];
    }
    return null;
}

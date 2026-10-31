import { byId } from './ui.js';

const vendor = new URL('../vendor/pdfjs/', import.meta.url);
const build = '?v=6.4.299-legacy';
let library, loadAttempt = 0;

async function withTimeout(promise) {
    let timeout;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timeout = setTimeout(() => {
                const error = new Error('PDF operation timed out'); error.name = 'TimeoutError';
                reject(error);
            }, 60000);
        })]);
    } finally { clearTimeout(timeout); }
}
function loadPDFJS() {
    const query = `${build}${loadAttempt ? '&retry=' + loadAttempt : ''}`;
    return library ||= import(new URL(`pdf-compat.js${query}`, import.meta.url).href)
        .then(() => import(new URL(`pdf.min.mjs${query}`, vendor).href))
        .then(pdfjs => {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(`pdf-worker.js${build}`, import.meta.url).href;
            return pdfjs;
        }).catch(error => { library = null; ++loadAttempt; throw error; });
}

function errorMessage(error, phase) {
    const message = error?.message || '';
    if (error?.name === 'TimeoutError') return 'PDF 加载超时，请稍后重试。';
    if (error?.name === 'InvalidPDFException') return 'PDF 文件无法解析或已损坏。';
    if (error?.name === 'PasswordException') return '这份 PDF 需要密码，暂时无法在页面内阅读。';
    if (error?.status === 404) return 'PDF 文件未找到，请稍后重试。';
    if (/does not match the Worker version/i.test(message)) return 'PDF 阅读组件版本不一致，请刷新页面后重试。';
    if (/not a function|is not defined|unsupported|not supported/i.test(message) || (phase === 'engine' && error?.name === 'SyntaxError')) {
        return '当前浏览器无法启动 PDF 阅读器，请更新浏览器后重试。';
    }
    if (phase === 'engine' || /worker|dynamically imported module/i.test(message)) return 'PDF 阅读组件加载失败，请刷新页面后重试。';
    if (phase === 'render') return 'PDF 页面显示失败，请稍后重试。';
    if (navigator.onLine === false) return '当前处于离线状态，连接网络后重试。';
    return 'PDF 文件加载失败，请稍后重试。';
}

export class PDFReader {
    constructor(back) {
        this.generation = 0; this.renderGeneration = 0;
        this.cache = new Map(); this.prefetchTask = null; this.swipe = null; this.swipeAt = 0;
        byId('readerBack').addEventListener('click', back);
        byId('pdfRetry').addEventListener('click', () => this.open(this.book, this.page, byId('pdfZoom').value));
        byId('pdfPrev').addEventListener('click', () => this.go(this.page - 1));
        byId('pdfNext').addEventListener('click', () => this.go(this.page + 1));
        byId('pdfPage').addEventListener('change', () => this.go(Number(byId('pdfPage').value)));
        byId('pdfPage').addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); this.go(Number(event.target.value)); }
        });
        byId('pdfZoom').addEventListener('change', () => this.render(true));
        const stage = byId('pdfStage');
        stage.addEventListener('touchstart', event => {
            this.swipe = event.touches.length === 1
                ? { x: event.touches[0].clientX, y: event.touches[0].clientY, left: stage.scrollLeft }
                : null;
        }, { passive: true });
        stage.addEventListener('touchcancel', () => { this.swipe = null; }, { passive: true });
        stage.addEventListener('touchend', event => {
            const start = this.swipe; this.swipe = null;
            if (!start || !this.document || event.changedTouches.length !== 1) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
            if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
            this.swipeAt = Date.now();
            const scrollable = stage.scrollWidth > stage.clientWidth + 1;
            if (scrollable && Math.abs(stage.scrollLeft - start.left) > 12) return;
            if (dx < 0 && (!scrollable || stage.scrollLeft + stage.clientWidth >= stage.scrollWidth - 1)) this.go(this.page + 1);
            else if (dx > 0 && (!scrollable || stage.scrollLeft <= 0)) this.go(this.page - 1);
        }, { passive: true });
        stage.addEventListener('click', event => {
            if (!this.document || Date.now() - this.swipeAt < 350) return;
            const rect = stage.getBoundingClientRect(), x = event.clientX - rect.left;
            if (x < rect.width * .25) this.go(this.page - 1);
            else if (x > rect.width * .75) this.go(this.page + 1);
        });
        document.addEventListener('keydown', event => {
            if (byId('readerView').hidden || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.target.closest?.('input, select, textarea, [contenteditable]')) return;
            const delta = { ArrowLeft: -1, PageUp: -1, ArrowRight: 1, PageDown: 1 }[event.key];
            if (!delta) return;
            event.preventDefault(); this.go(this.page + delta);
        });
        this.observer = new ResizeObserver(entries => {
            const width = Math.round(entries[0].contentRect.width);
            if (width > 0 && width !== this.width) {
                this.width = width;
                if (this.document) this.render(true);
            }
        });
        this.observer.observe(stage);
    }
    close() {
        ++this.generation; ++this.renderGeneration;
        this.renderTask?.cancel(); this.renderTask = null;
        this.prefetchTask?.cancel(); this.prefetchTask = null;
        this.cache.clear(); this.swipe = null;
        const task = this.loadingTask; this.loadingTask = null; this.document = null;
        if (task) task.destroy().catch(() => {});
        byId('pdfCanvasHost').replaceChildren();
        this.busy(false); this.controls();
    }
    fail(error, phase) {
        this.close();
        byId('pdfErrorText').textContent = errorMessage(error, phase);
        console.warn('PDF 阅读失败', error);
        byId('pdfPageStatus').textContent = '';
        byId('pdfError').hidden = false;
    }
    async open(book, page = 1, zoom = '1') {
        this.close(); this.book = book; this.page = page;
        const generation = this.generation;
        byId('readerTitle').textContent = `《${book.title}》`;
        byId('pdfPages').textContent = '—'; byId('pdfPage').value = page;
        byId('pdfZoom').value = zoom; byId('pdfError').hidden = true;
        byId('pdfPageStatus').textContent = ''; this.busy(true);
        let phase = 'engine';
        try {
            const pdfjs = await withTimeout(loadPDFJS());
            if (generation !== this.generation) return;
            phase = 'document';
            this.loadingTask = pdfjs.getDocument({
                url: book.pdf,
                cMapUrl: new URL('cmaps/', vendor).href, cMapPacked: true,
                standardFontDataUrl: new URL('standard_fonts/', vendor).href,
                wasmUrl: new URL('wasm/', vendor).href, iccUrl: new URL('iccs/', vendor).href,
                isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144
            });
            const pdf = await withTimeout(this.loadingTask.promise);
            if (generation !== this.generation) return;
            this.document = pdf;
            this.page = Math.min(page, pdf.numPages);
            byId('pdfPage').value = this.page;
            byId('pdfPages').textContent = pdf.numPages;
            byId('pdfPage').max = pdf.numPages;
            this.controls(); await this.render();
        } catch (error) {
            if (generation === this.generation) this.fail(error, phase);
        }
    }
    controls() {
        const loaded = !!this.document;
        byId('pdfPrev').disabled = !loaded || this.page <= 1;
        byId('pdfNext').disabled = !loaded || this.page >= this.document.numPages;
        byId('pdfPage').disabled = byId('pdfZoom').disabled = !loaded;
    }
    busy(value) {
        byId('pdfStage').setAttribute('aria-busy', String(value));
        byId('pdfLoading').hidden = !value;
    }
    go(page) {
        if (!this.document) return;
        const target = Math.min(this.document.numPages, Math.max(1, Math.trunc(page) || 1));
        byId('pdfPage').value = target;
        if (target === this.page) return;
        this.page = target;
        byId('mainContent').scrollTop = 0;
        this.controls(); this.render();
    }
    cacheKey(number, width, zoom, height) {
        return `${number}:${width}:${zoom === 'page' ? Math.round(height) : zoom}`;
    }
    cacheCanvas(key, canvas) {
        this.cache.delete(key); this.cache.set(key, canvas);
        while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
    }
    paint(canvas, number, scroll) {
        const stage = byId('pdfStage');
        byId('pdfCanvasHost').replaceChildren(canvas);
        stage.scrollLeft = scroll === null ? 0 : scroll * Math.max(0, stage.scrollWidth - stage.clientWidth);
        stage.style.touchAction = stage.scrollWidth > stage.clientWidth + 1 ? 'auto' : 'pan-y pinch-zoom';
        byId('pdfPageStatus').textContent = `第 ${number} 页，共 ${this.document.numPages} 页`;
    }
    async drawPage(number, width, zoom, height, generation, onTask) {
        if (generation !== this.renderGeneration) throw new Error('Stale render');
        const page = await withTimeout(this.document.getPage(number));
        if (generation !== this.renderGeneration) throw new Error('Stale render');
        const base = page.getViewport({ scale: 1 });
        const scale = zoom === 'page' ? Math.min(width / base.width, height / base.height) : width / base.width * Number(zoom);
        const viewport = page.getViewport({ scale });
        // Bound memory on mobile while preserving crisp text at normal zoom.
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (viewport.width * viewport.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `《${this.book.title}》第 ${number} 页`);
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        onTask(task);
        await withTimeout(task.promise);
        if (generation !== this.renderGeneration) throw new Error('Stale render');
        return canvas;
    }
    prefetch(number, width, zoom, height, generation) {
        if (generation !== this.renderGeneration) return;
        const pdf = this.document;
        if (!pdf) return;
        const pages = [number + 1, number - 1].filter(page => page >= 1 && page <= pdf.numPages);
        let index = 0;
        const next = async () => {
            if (generation !== this.renderGeneration) return;
            const page = pages[index++];
            if (page === undefined) { this.prefetchTask = null; return; }
            const key = this.cacheKey(page, width, zoom, height);
            if (this.cache.has(key)) { next(); return; }
            let task;
            try {
                const canvas = await this.drawPage(page, width, zoom, height, generation, value => { task = value; this.prefetchTask = value; });
                if (generation === this.renderGeneration) this.cacheCanvas(key, canvas);
            } catch { task?.cancel(); }
            if (this.prefetchTask === task) this.prefetchTask = null;
            next();
        };
        next();
    }
    async render(preserveScroll = false) {
        if (!this.document) return;
        const generation = ++this.renderGeneration, number = this.page;
        this.renderTask?.cancel(); this.renderTask = null;
        this.prefetchTask?.cancel(); this.prefetchTask = null;
        this.busy(true); byId('pdfError').hidden = true;
        const stage = byId('pdfStage'), main = byId('mainContent'), width = stage.clientWidth;
        if (!width) { this.busy(false); return; }
        const top = stage.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
        const height = Math.max(180, main.clientHeight - top - 12);
        const zoom = byId('pdfZoom').value;
        const scroll = preserveScroll && stage.scrollWidth > stage.clientWidth
            ? stage.scrollLeft / (stage.scrollWidth - stage.clientWidth) : null;
        const key = this.cacheKey(number, width, zoom, height);
        try {
            const cached = this.cache.get(key);
            if (cached) {
                this.cache.delete(key); this.cache.set(key, cached);
                this.paint(cached, number, scroll); this.busy(false);
                this.prefetch(number, width, zoom, height, generation);
                return;
            }
            const canvas = await this.drawPage(number, width, zoom, height, generation, task => { this.renderTask = task; });
            if (generation !== this.renderGeneration) return;
            this.renderTask = null;
            this.cacheCanvas(key, canvas);
            this.paint(canvas, number, scroll); this.busy(false);
            this.prefetch(number, width, zoom, height, generation);
        } catch (error) {
            if (generation !== this.renderGeneration || error.name === 'RenderingCancelledException') return;
            this.fail(error, 'render');
        }
    }
}

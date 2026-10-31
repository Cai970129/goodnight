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
        byId('readerBack').addEventListener('click', back);
        byId('pdfRetry').addEventListener('click', () => this.open(this.book, this.page, byId('pdfZoom').value));
        byId('pdfPrev').addEventListener('click', () => this.go(this.page - 1));
        byId('pdfNext').addEventListener('click', () => this.go(this.page + 1));
        byId('pdfPage').addEventListener('change', () => this.go(Number(byId('pdfPage').value)));
        byId('pdfPage').addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); this.go(Number(event.target.value)); }
        });
        byId('pdfZoom').addEventListener('change', () => this.render());
        this.observer = new ResizeObserver(entries => {
            const width = Math.round(entries[0].contentRect.width);
            if (width > 0 && width !== this.width) {
                this.width = width;
                if (this.document) this.render();
            }
        });
        this.observer.observe(byId('pdfStage'));
    }
    close() {
        ++this.generation; ++this.renderGeneration;
        this.renderTask?.cancel(); this.renderTask = null;
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
                isEvalSupported: false, enableXfa: false
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
    async render() {
        if (!this.document) return;
        const generation = ++this.renderGeneration, pdf = this.document, number = this.page;
        this.renderTask?.cancel(); this.renderTask = null;
        this.busy(true); byId('pdfError').hidden = true;
        try {
            const page = await withTimeout(pdf.getPage(number));
            if (generation !== this.renderGeneration) return;
            const width = byId('pdfStage').clientWidth;
            if (!width) { this.busy(false); return; }
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: width / base.width * Number(byId('pdfZoom').value) });
            // Bound memory on mobile while preserving crisp text at normal zoom.
            const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (viewport.width * viewport.height)));
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
            canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
            canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `《${this.book.title}》第 ${number} 页`);
            this.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
            await withTimeout(this.renderTask.promise);
            if (generation !== this.renderGeneration) return;
            this.renderTask = null;
            byId('pdfCanvasHost').replaceChildren(canvas); byId('pdfStage').scrollLeft = 0;
            byId('pdfPageStatus').textContent = `第 ${number} 页，共 ${pdf.numPages} 页`;
            this.busy(false);
        } catch (error) {
            if (generation !== this.renderGeneration || error.name === 'RenderingCancelledException') return;
            this.fail(error, 'render');
        }
    }
}

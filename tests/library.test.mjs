import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBook, resolveResource, adjacentTrack, loadLibrary } from '../asserts/js/library.js';

const manifestURL = new URL('https://example.com/books/test/book.json');
const bookData = () => ({
    id: 'test',
    title: '测试书',
    author: '作者',
    narrator: 'Carrie',
    description: '简介',
    category: '小说',
    cover: 'images/cover.webp',
    pdf: 'pdf/book.pdf',
    banners: [{
        image: 'images/banner.webp',
        quote: '摘录',
        source: '出处',
        sourceURL: 'https://example.com/source'
    }],
    chapters: [{
        id: 'chapter-01',
        title: '第一章',
        pdfPage: 3,
        tracks: [
            { id: 'part-01', title: '第 1 节', src: 'audio/01.opus', duration: 12.5 },
            { id: 'part-02', title: '第 2 节', src: null },
            { id: 'part-03', title: '第 3 节', src: 'audio/03.opus', duration: 20 }
        ]
    }]
});

test('resolveResource keeps resources inside the book and requires HTTPS source links', () => {
    assert.equal(resolveResource('images/cover.webp', manifestURL), 'https://example.com/books/test/images/cover.webp');
    assert.equal(resolveResource(null, manifestURL), null);
    assert.throws(() => resolveResource('../other/cover.webp', manifestURL), /本书目录/);
    assert.throws(() => resolveResource('https://other.example/cover.webp', manifestURL), /本书目录/);
    assert.throws(() => resolveResource('images/cover.webp?x=1', manifestURL), /本书目录/);
});

test('parseBook builds chapters, tracks, banners, and labels', () => {
    const book = parseBook(bookData(), manifestURL, 'test');
    assert.equal(book.id, 'test');
    assert.equal(book.cover, 'https://example.com/books/test/images/cover.webp');
    assert.equal(book.chapters[0].pdfPage, 3);
    assert.equal(book.tracks[0].label, '第一章 · 第 1 节');
    assert.equal(book.tracks[0].duration, 12.5);
    assert.equal(book.tracks[1].src, null);
    assert.equal(book.tracks[2].label, '第一章 · 第 3 节');
    assert.equal(book.banners[0].sourceURL, 'https://example.com/source');
});

test('parseBook rejects duplicate ids, unsafe paths, and non-HTTPS banner links', () => {
    const duplicateTrack = bookData();
    duplicateTrack.chapters[0].tracks[1].id = 'part-01';
    assert.throws(() => parseBook(duplicateTrack, manifestURL, 'test'), /分节 ID/);

    const duplicateChapter = bookData();
    duplicateChapter.chapters.push({ ...duplicateChapter.chapters[0] });
    assert.throws(() => parseBook(duplicateChapter, manifestURL, 'test'), /章节 ID/);

    const badBanner = bookData();
    badBanner.banners[0].sourceURL = 'http://example.com/source';
    assert.throws(() => parseBook(badBanner, manifestURL, 'test'), /HTTPS/);

    const missingTitle = bookData();
    missingTitle.chapters[0].tracks[0].title = ' ';
    assert.throws(() => parseBook(missingTitle, manifestURL, 'test'), /分节名称/);
});

test('adjacentTrack skips unavailable tracks and stops at book edges', () => {
    const book = parseBook(bookData(), manifestURL, 'test');
    assert.equal(adjacentTrack(book, 'part-01', 1).id, 'part-03');
    assert.equal(adjacentTrack(book, 'part-03', -1).id, 'part-01');
    assert.equal(adjacentTrack(book, 'part-01', -1), null);
    assert.equal(adjacentTrack(book, 'part-03', 1), null);
});

test('loadLibrary reports progressive updates and isolates a failed book', async () => {
    const catalogURL = new URL('https://example.com/books/catalog.json');
    const responses = new Map([
        [catalogURL.href, {
            version: 1,
            books: [
                { id: 'test', manifest: 'test/book.json' },
                { id: 'broken', manifest: 'broken/book.json' }
            ]
        }],
        ['https://example.com/books/test/book.json', bookData()]
    ]);
    const fetcher = async url => {
        const data = responses.get(url);
        if (!data) throw new Error('not found');
        return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
    };
    const updates = [];
    const result = await loadLibrary(catalogURL, fetcher, snapshot => updates.push(snapshot));

    assert.equal(result.books.length, 1);
    assert.equal(result.books[0].tracks.length, 3);
    assert.equal(result.errors[0].id, 'broken');
    assert.equal(updates.length, 2);
});

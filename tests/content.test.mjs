import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const booksDir = path.join(root, 'books');
const catalog = JSON.parse(fs.readFileSync(path.join(booksDir, 'catalog.json'), 'utf8'));

function inside(parent, relative) {
    const target = path.resolve(parent, relative);
    assert.ok(target.startsWith(parent + path.sep), `${relative} escapes ${parent}`);
    return target;
}

function readJSON(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('catalog points at valid book manifests', () => {
    assert.equal(catalog.version, 1);
    assert.ok(Array.isArray(catalog.books) && catalog.books.length > 0);
    const ids = new Set();
    for (const entry of catalog.books) {
        assert.match(entry.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
        assert.ok(!ids.has(entry.id), `duplicate catalog id ${entry.id}`);
        ids.add(entry.id);
        const manifest = inside(booksDir, entry.manifest);
        assert.equal(path.basename(path.dirname(manifest)), entry.id);
        assert.equal(readJSON(manifest).id, entry.id);
    }
});

test('book manifests reference existing local resources and unique ids', () => {
    for (const entry of catalog.books) {
        const bookDir = path.join(booksDir, entry.id);
        const book = readJSON(path.join(bookDir, 'book.json'));
        assert.equal(book.id, entry.id);
        assert.ok(book.title && book.author);
        if (book.cover) assert.ok(fs.existsSync(inside(bookDir, book.cover)), `${book.id} cover missing`);
        if (book.pdf) assert.ok(fs.existsSync(inside(bookDir, book.pdf)), `${book.id} pdf missing`);
        for (const banner of book.banners || []) {
            assert.ok(fs.existsSync(inside(bookDir, banner.image)), `${book.id} banner missing`);
        }

        const trackIds = new Set();
        const chapterIds = new Set();
        const audioFiles = new Set();
        for (const chapter of book.chapters) {
            assert.match(chapter.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
            assert.ok(!chapterIds.has(chapter.id), `${book.id} duplicate chapter ${chapter.id}`);
            chapterIds.add(chapter.id);
            if (chapter.pdfPage != null) assert.ok(Number.isInteger(chapter.pdfPage) && chapter.pdfPage > 0);
            for (const track of chapter.tracks) {
                assert.match(track.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
                assert.ok(!trackIds.has(track.id), `${book.id} duplicate track ${track.id}`);
                trackIds.add(track.id);
                if (track.duration != null) assert.ok(Number.isFinite(track.duration) && track.duration > 0);
                if (track.src) {
                    const file = inside(bookDir, track.src);
                    assert.ok(fs.existsSync(file), `${book.id} audio missing: ${track.src}`);
                    audioFiles.add(path.relative(bookDir, file));
                }
            }
        }

        const audioRoot = path.join(bookDir, 'audio');
        if (fs.existsSync(audioRoot)) {
            const files = fs.readdirSync(audioRoot, { recursive: true, withFileTypes: true })
                .filter(item => item.isFile() && item.name.endsWith('.opus'))
                .map(item => {
                    const full = path.join(item.parentPath, item.name);
                    return path.relative(bookDir, full);
                });
            for (const file of files) assert.ok(audioFiles.has(file), `${book.id} unreferenced audio: ${file}`);
        }
    }
});

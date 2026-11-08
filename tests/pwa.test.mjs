import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const exists = name => fs.existsSync(path.join(root, name));
const pngSize = name => {
    const buffer = fs.readFileSync(path.join(root, name));
    assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

test('manifest exposes the expected install icons', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'));
    const icons = new Map(manifest.icons.map(icon => [icon.src, icon]));
    assert.deepEqual(pngSize('asserts/images/icon-192.png'), { width: 192, height: 192 });
    assert.deepEqual(pngSize('asserts/images/icon-512.png'), { width: 512, height: 512 });
    assert.deepEqual(pngSize('asserts/images/icon-maskable-512.png'), { width: 512, height: 512 });
    assert.deepEqual(pngSize('asserts/images/apple-touch-icon.png'), { width: 180, height: 180 });
    assert.equal(icons.get('./asserts/images/icon-192.png').sizes, '192x192');
    assert.equal(icons.get('./asserts/images/icon-512.png').purpose, 'any');
    assert.equal(icons.get('./asserts/images/icon-maskable-512.png').purpose, 'maskable');
});

test('HTML loads the LCP image directly and links the iOS icon', () => {
    const html = read('index.html');
    assert.match(html, /id="bannerImg"[^>]*src="books\/01-MaoYu\/images\/游泳\.webp"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /name="mobile-web-app-capable"/);
    assert.doesNotMatch(html, /data-initial-src/);
});

test('service worker precaches existing shell assets and handles fetch', () => {
    const source = read('sw.js');
    assert.match(source, /addEventListener\('fetch'/);
    assert.match(source, /addEventListener\('install'/);
    const shell = source.match(/const SHELL = \[([\s\S]*?)\];/)[1];
    const assets = [...shell.matchAll(/'([^']+)'/g)].map(match => match[1]);
    assert.ok(assets.includes('./index.html'));
    assert.ok(assets.includes('./asserts/js/app.js'));
    for (const asset of assets) {
        const target = asset === './' ? '.' : asset.slice(2);
        assert.ok(exists(target), `service worker shell asset missing: ${asset}`);
    }
});

"""Run with: python3 -B -m unittest discover -s tools -p 'test_*.py'."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audio_import', Path(__file__).with_name('import-audio.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'Requires FFmpeg')
class ImportAudioTests(unittest.TestCase):
    def setUp(self):
        local = module.ROOT / '.local'
        local.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='import-test-', dir=local)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.book_dir = self.root / 'books/test-book'
        self.book_dir.mkdir(parents=True)
        self.source = self.root / 'incoming'
        self.source.mkdir()
        self.book = dict(id='test-book', title='测试书', author='作者', chapters=[dict(
            id='chapter-01', title='第一章', pdfPage=19,
            tracks=[dict(id='part-01', title='已有标题', src=None)])])
        self.manifest = self.book_dir / 'book.json'
        self.manifest.write_text(json.dumps(self.book, ensure_ascii=False))
        self.readme = self.root / 'README.md'
        self.readme.write_text('| 《测试书》 | 作者 | Carrie | 原内容 | PDF | 第一章 |\n')
        self.args = ['--book', 'test-book', '--chapter', 'chapter-01', '--input', str(self.source)]

    def audio(self, name='录音1.mp3', frequency=440, low=False):
        target = self.source / name
        subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                        f'sine=frequency={frequency}:duration=1.5', '-ar', '48000', '-ac', '1' if low else '2',
                        '-c:a', 'libmp3lame', '-b:a', '96k' if low else '320k', str(target)], check=True)
        return target

    def execute(self, *extra):
        if '--apply' in extra and '--start' not in extra:
            extra = (*extra, '--start', '1')
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return module.main([*self.args, *extra], self.root)

    def config(self):
        return json.loads(self.manifest.read_text())

    def test_preview_is_read_only_and_uses_natural_sort(self):
        self.audio('录音–1.mp3')
        self.audio('录音10.mp3')
        self.audio('录音2.mp3')
        original = self.manifest.read_bytes()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(module.main(self.args, self.root), 0)
        self.assertLess(output.getvalue().index('录音–1.mp3'), output.getvalue().index('录音2.mp3'))
        self.assertLess(output.getvalue().index('录音2.mp3'), output.getvalue().index('录音10.mp3'))
        self.assertEqual(original, self.manifest.read_bytes())
        self.assertFalse((self.root / '.local').exists())
        self.assertFalse((self.book_dir / 'audio').exists())

    def test_apply_requires_a_fixed_start_and_rerunning_cannot_duplicate(self):
        self.audio()
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(module.main([*self.args, '--apply'], self.root), 1)
        self.assertEqual(self.execute('--apply', '--start', '1'), 0)
        before = self.manifest.read_bytes()
        self.assertEqual(self.execute('--apply', '--start', '1'), 1)
        self.assertEqual(before, self.manifest.read_bytes())

    def test_apply_backs_up_imports_updates_and_deletes_only_after_success(self):
        one = self.audio('录音2.mp3', 440)
        two = self.audio('录音10.mp3', 880)
        hashes = {p.name: module.digest(p) for p in [one, two]}
        self.assertEqual(self.execute('--apply', '--delete-source'), 0)
        tracks = self.config()['chapters'][0]['tracks']
        self.assertEqual([t['id'] for t in tracks], ['part-01', 'part-02'])
        self.assertEqual(tracks[0]['title'], '已有标题')
        self.assertEqual(self.config()['chapters'][0]['pdfPage'], 19)
        self.assertFalse(self.source.exists())
        backups = list((self.root / '.local/originals/audio-imports').iterdir())
        self.assertEqual(len(backups), 1)
        for name, fingerprint in hashes.items():
            self.assertEqual(module.digest(backups[0] / name), fingerprint)
        self.assertTrue((backups[0] / 'book.json').exists())
        self.assertIn('第一章（2 节）', self.readme.read_text())
        self.assertFalse((self.root / '.local/import-audio.lock').exists())
        for track in tracks:
            audio = self.book_dir / track['src']
            self.assertTrue(audio.is_file())
            self.assertLess(audio.stat().st_size, 30000)

    def test_low_bitrate_opus_is_copied_without_reencoding(self):
        original = self.source / '录音1.opus'
        subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                        'sine=frequency=440:duration=1.5', '-ac', '1', '-c:a', 'libopus', '-b:a', '24k',
                        str(original)], check=True)
        fingerprint = module.digest(original)
        self.assertEqual(self.execute('--apply'), 0)
        self.assertEqual(module.digest(self.book_dir / self.config()['chapters'][0]['tracks'][0]['src']), fingerprint)
        self.assertTrue(original.exists())

    def test_m4a_is_converted_to_mono_opus(self):
        target = self.source / '录音1.m4a'
        subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                        'sine=frequency=440:duration=1.5', '-ar', '48000', '-ac', '2',
                        '-c:a', 'aac', '-b:a', '192k', str(target)], check=True)
        self.assertEqual(self.execute('--apply'), 0)
        track = self.config()['chapters'][0]['tracks'][0]
        self.assertTrue(track['src'].endswith('01.opus'))
        raw = json.loads(module.command(['ffprobe', '-v', 'error', '-show_entries',
                         'stream=codec_name,channels', '-of', 'json', str(self.book_dir / track['src'])]).stdout)
        self.assertEqual(raw['streams'][0]['codec_name'], 'opus')
        self.assertEqual(raw['streams'][0]['channels'], 1)

    def test_higher_bitrate_opus_is_reduced_and_low_mp3_is_converted(self):
        opus = self.source / '录音1.opus'
        subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                        'sine=frequency=440:duration=1.5', '-ac', '1', '-c:a', 'libopus', '-b:a', '64k',
                        str(opus)], check=True)
        mp3 = self.audio('录音2.mp3', low=True)
        self.assertEqual(self.execute('--apply'), 0)
        for track, source in zip(self.config()['chapters'][0]['tracks'], [opus, mp3]):
            output = self.book_dir / track['src']
            self.assertEqual(output.suffix, '.opus')
            self.assertLess(output.stat().st_size, source.stat().st_size)
            self.assertNotEqual(module.digest(output), module.digest(source))

    def test_collision_fails_without_changing_existing_files(self):
        self.audio()
        folder = self.book_dir / 'audio/chapter-01'
        folder.mkdir(parents=True)
        target = folder / '01.opus'
        target.write_bytes(b'existing')
        before = self.manifest.read_bytes()
        self.assertEqual(self.execute('--apply', '--delete-source'), 1)
        self.assertEqual(target.read_bytes(), b'existing')
        self.assertEqual(before, self.manifest.read_bytes())
        self.assertTrue(self.source.exists())

    def test_occupied_track_duplicate_id_bad_start_and_unsafe_paths_fail(self):
        self.audio()
        for extra in [('--start', '0'), ('--start', '5'), ('--audio-dir', '../outside'), ('--audio-dir', 'images')]:
            with self.subTest(extra=extra):
                self.assertEqual(self.execute('--apply', *extra), 1)
        self.book['chapters'][0]['tracks'].append(dict(id='part-01', title='重复', src=None))
        self.manifest.write_text(json.dumps(self.book))
        self.assertEqual(self.execute('--apply'), 1)
        self.book['chapters'][0]['tracks'].pop()
        self.book['chapters'][0]['tracks'][0]['src'] = 'audio/old.mp3'
        self.manifest.write_text(json.dumps(self.book))
        self.assertEqual(self.execute('--apply', '--start', '1'), 1)

    def test_audio_directory_symlink_cannot_escape_the_book(self):
        self.audio()
        outside = self.root / 'outside'
        outside.mkdir()
        (self.book_dir / 'audio').symlink_to(outside, target_is_directory=True)
        self.assertEqual(self.execute('--apply'), 1)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertTrue(self.source.exists())

    def test_non_audio_prevents_source_directory_deletion(self):
        self.audio()
        (self.source / 'note.txt').write_text('keep')
        self.assertEqual(self.execute('--apply', '--delete-source'), 1)
        self.assertTrue((self.source / 'note.txt').exists())
        self.assertEqual(self.execute('--apply'), 0)
        self.assertTrue(self.source.exists())

    def test_corrupt_input_keeps_original_and_configuration(self):
        (self.source / 'broken.mp3').write_bytes(b'not audio')
        before = self.manifest.read_bytes()
        self.assertEqual(self.execute('--apply', '--repair', '--delete-source'), 1)
        self.assertEqual(before, self.manifest.read_bytes())
        self.assertTrue((self.source / 'broken.mp3').exists())

    def test_publication_failure_rolls_back_config_and_outputs(self):
        self.audio()
        before = self.manifest.read_bytes()
        readme = self.readme.read_bytes()
        write = module.atomic_write
        def fail_readme(path, data, stage):
            if path == self.readme:
                raise OSError('simulated write failure')
            write(path, data, stage)
        with patch.object(module, 'atomic_write', side_effect=fail_readme):
            self.assertEqual(self.execute('--apply', '--delete-source'), 1)
        self.assertEqual(before, self.manifest.read_bytes())
        self.assertEqual(readme, self.readme.read_bytes())
        self.assertEqual(list(self.book_dir.rglob('*.opus')), [])
        self.assertTrue(self.source.exists())
        self.assertFalse((self.root / '.local/import-audio.lock').exists())

    def test_changed_source_is_never_deleted_after_import(self):
        original = self.audio()
        old_hash = module.digest(original)
        compress = module.compress
        def change_source(plan, output):
            result = compress(plan, output)
            original.write_bytes(b'new recording content')
            return result
        with patch.object(module, 'compress', side_effect=change_source):
            self.assertEqual(self.execute('--apply', '--delete-source'), 2)
        self.assertEqual(original.read_bytes(), b'new recording content')
        self.assertTrue((self.book_dir / self.config()['chapters'][0]['tracks'][0]['src']).exists())
        saved = next((self.root / '.local/originals/audio-imports').glob('*/录音1.mp3'))
        self.assertEqual(module.digest(saved), old_hash)

    def test_repair_is_explicit_and_output_is_clean(self):
        original = self.audio()
        real_command = module.command
        def warned(args):
            result = real_command(args)
            if args[0] == 'ffmpeg' and '-progress' in args:
                result.stderr = 'simulated recoverable decoder warning'
            return result
        with patch.object(module, 'command', side_effect=warned):
            self.assertEqual(self.execute('--apply'), 1)
            self.assertEqual(self.execute('--apply', '--repair'), 0)
        self.assertTrue(original.exists())


if __name__ == '__main__':
    unittest.main()

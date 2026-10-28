#!/usr/bin/env python3
"""Preview or import a chapter's recordings. Requires Python 3.10+, FFmpeg and ffprobe."""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
AUDIO_TYPES = {'.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg'}
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]*\Z')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else hash_stream(stream)


def hash_stream(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(chunk)
    return result.hexdigest()


def command(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f"{args[0]} 执行失败：{result.stderr[:1000]}")
    return result


def within(path, parent):
    path = path.resolve()
    if not path.is_relative_to(parent.resolve()):
        raise ValueError(f'路径超出允许目录：{path}')
    return path


def analyze(path, repair):
    raw = json.loads(command(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                              '-show_entries', 'format=duration,bit_rate:stream=codec_name,channels,bit_rate',
                              '-of', 'json', str(path)]).stdout)
    if not raw.get('streams'):
        raise ValueError(f'没有可用音轨：{path.name}')
    duration = float(raw['format']['duration'])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError(f'音频时长无效：{path.name}')
    decoded = command(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-i', str(path),
                       '-map', '0:a:0', '-af', 'asetpts=N/SR/TB', '-f', 'null', '-', '-progress', 'pipe:1'])
    times = re.findall(r'^out_time_us=(\d+)$', decoded.stdout, re.M)
    actual = int(times[-1]) / 1000000 if times else 0
    if actual <= 0 or abs(actual - duration) > 1:
        raise ValueError(f'{path.name} 解码时长与声明时长相差超过1秒，停止导入，请检查原件')
    warning = decoded.stderr.strip()
    if warning and not repair:
        raise ValueError(f'{path.name} 检测到解码错误。检查原件后可使用 --repair 允许有限修复：\n{warning[:800]}')
    stream = raw['streams'][0]
    bitrate = int(stream.get('bit_rate') or raw['format'].get('bit_rate') or 0)
    extension = '.m4a' if path.suffix.lower() == '.m4a' and stream['codec_name'] == 'aac' else '.mp3'
    reusable = (not warning and stream['channels'] == 1 and 0 < bitrate <= 100800
                and ((extension == '.mp3' and path.suffix.lower() == '.mp3' and stream['codec_name'] == 'mp3') or extension == '.m4a'))
    return dict(duration=duration, extension=extension, reusable=reusable, warning=warning,
                size=path.stat().st_size, sha256=digest(path))


def natural_key(path):
    return [(0, int(part)) if part.isdigit() else (1, part.casefold())
            for part in re.split(r'(\d+)', re.sub(r'[\s_—–-]+', '', path.name))]


def require_text(data, key):
    if not isinstance(data.get(key), str) or not data[key].strip():
        raise ValueError(f'{key} 必须为非空文字')


def validate_book(book, book_id, directory):
    if not isinstance(book, dict) or book.get('id') != book_id or not isinstance(book.get('chapters'), list):
        raise ValueError('书籍 ID 或章节配置无效')
    require_text(book, 'title')
    require_text(book, 'author')
    chapters, tracks = set(), set()
    for chapter in book['chapters']:
        if not isinstance(chapter, dict):
            raise ValueError('章节配置必须为对象')
        name = chapter.get('id', '')
        if not isinstance(name, str) or not ID.fullmatch(name) or name in chapters:
            raise ValueError('章节 ID 无效或重复')
        chapters.add(name)
        require_text(chapter, 'title')
        if chapter.get('pdfPage') is not None and (type(chapter['pdfPage']) is not int or chapter['pdfPage'] < 1):
            raise ValueError('章节 pdfPage 必须为正整数')
        if not isinstance(chapter.get('tracks'), list):
            raise ValueError('分节配置必须为数组')
        for track in chapter['tracks']:
            if not isinstance(track, dict):
                raise ValueError('分节配置必须为对象')
            name = track.get('id', '')
            if not isinstance(name, str) or not ID.fullmatch(name) or name in tracks:
                raise ValueError('分节 ID 无效或重复')
            tracks.add(name)
            require_text(track, 'title')
            if track.get('src') is not None:
                path = within(directory / track['src'], within(directory / 'audio', directory))
                if not path.is_file():
                    raise ValueError(f'已配置的音频不存在：{path}')


def prepare(args, root):
    if not ID.fullmatch(args.book):
        raise ValueError('书籍 ID 无效')
    directory = within(root / 'books' / args.book, root / 'books')
    manifest = directory / 'book.json'
    original = manifest.read_bytes()
    book = json.loads(original)
    validate_book(book, args.book, directory)
    chapter = next((c for c in book['chapters'] if c['id'] == args.chapter), None)
    if chapter is None:
        raise ValueError('未找到指定章节，请先在 book.json 创建该章节')
    source = args.input.resolve()
    if not source.is_dir() or args.input.is_symlink():
        raise ValueError('输入必须是音频目录')
    for protected in [root / 'books', root / 'asserts', root / 'tools', root / '.git', root / '.local' / 'originals']:
        if source.is_relative_to(protected.resolve()) or protected.resolve().is_relative_to(source):
            raise ValueError('不能从运行资源、原始备份或项目上层目录导入')
    files = sorted((p for p in source.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_TYPES), key=natural_key)
    if not files or any(p.is_symlink() for p in files):
        raise ValueError('输入目录没有支持的音频，或包含音频符号链接')
    if args.delete_source and set(source.iterdir()) != set(files):
        raise ValueError('--delete-source 要求目录只包含本次导入的音频，不可含其他文件或子目录')
    tracks = chapter['tracks']
    start = args.start if args.start is not None else next((n for n, track in enumerate(tracks, 1) if not track.get('src')), len(tracks) + 1)
    if start < 1 or start > len(tracks) + 1:
        raise ValueError('--start 必须为已有待补分节的位置或末尾下一节，不能跳号')
    parents = {str(Path(t['src']).parent) for t in tracks if t.get('src')}
    folder = args.audio_dir or (next(iter(parents)) if len(parents) == 1 else f'audio/{chapter["id"]}')
    destination = within(directory / folder, within(directory / 'audio', directory))
    if not str(folder).startswith('audio/') and folder != 'audio':
        raise ValueError('--audio-dir 必须位于本书的 audio/ 中')
    if source == destination or source.is_relative_to(destination) or destination.is_relative_to(source):
        raise ValueError('源目录与目标目录不能重叠')
    prefix = next((re.sub(r'\d+$', '', t['id']) for t in tracks if re.search(r'\d+$', t['id'])), chapter['id'] + '-')
    all_ids = {t['id'] for c in book['chapters'] for t in c['tracks']}
    plans = []
    # Prepare the complete batch before writing; never overwrite existing audio.
    for offset, path in enumerate(files):
        number = start + offset
        if number <= len(tracks) and tracks[number - 1].get('src'):
            raise ValueError(f'第 {number} 节已存在音频，停止导入，不覆盖')
        info = analyze(path, args.repair)
        target = destination / f'{number:02}{info["extension"]}'
        if target.exists() or target.is_symlink():
            raise ValueError(f'目标文件已存在，不覆盖：{target}')
        track = copy.deepcopy(tracks[number - 1]) if number <= len(tracks) else {
            'id': f'{prefix}{number:02}', 'title': f'第 {number} 节'}
        if number > len(tracks) and track['id'] in all_ids:
            raise ValueError(f'新分节 ID 重复：{track["id"]}')
        all_ids.add(track['id'])
        plans.append(dict(source=path, target=target, number=number, track=track, **info))
    return dict(book=book, chapter=chapter, manifest=manifest, original=original,
                directory=directory, source=source, files=files, plans=plans)


def compress(plan, output):
    if plan['reusable']:
        shutil.copy2(plan['source'], output)
    else:
        codec = ['-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'] if output.suffix == '.m4a' else [
            '-c:a', 'libmp3lame', '-b:a', '96k', '-write_xing', '1']
        command(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-i', str(plan['source']),
                 '-map', '0:a:0', '-vn', '-af', 'aresample=async=1:first_pts=0,apad',
                 '-t', str(plan['duration']), '-ac', '1', '-ar', '48000', *codec,
                 '-map_metadata', '-1', str(output)])
    command(['ffmpeg', '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', str(output),
             '-map', '0:a:0', '-f', 'null', '-'])
    raw = json.loads(command(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                              'format=duration:stream=channels', '-of', 'json', str(output)]).stdout)
    duration = float(raw['format']['duration'])
    if abs(duration - plan['duration']) > .1 or raw['streams'][0]['channels'] != 1:
        raise ValueError(f'输出时长或声道验证失败：{output.name}')
    if not plan['reusable'] and output.stat().st_size >= plan['size']:
        raise ValueError(f'{plan["source"].name} 转码后未减小体积，请保留原件并单独检查')
    return round(duration, 3)


def update_readme(path, book):
    if not path.exists():
        return None, None
    original = path.read_bytes()
    lines = original.decode('utf-8').splitlines(keepends=True)
    for n, line in enumerate(lines):
        cells = [cell.strip() for cell in line.split('|')]
        if len(cells) == 8 and cells[1] == f'《{book["title"]}》':
            available, pending = [], []
            for chapter in book['chapters']:
                count = sum(bool(t.get('src')) for t in chapter['tracks'])
                if count:
                    available.append(f'{chapter["title"]}（{count} 节）')
                missing = [t['title'] for t in chapter['tracks'] if not t.get('src')]
                if missing:
                    pending.append(f'{chapter["title"]}（{"、".join(missing)}）')
            cells[4] = '；'.join(available) or '—'
            cells[6] = '；'.join(pending) or '—'
            lines[n] = '| ' + ' | '.join(cells[1:-1]) + ' |\n'
            return original, ''.join(lines).encode('utf-8')
    return original, None


def atomic_write(path, data, stage):
    temporary = stage / (path.name + '.new')
    temporary.write_bytes(data)
    temporary.chmod(path.stat().st_mode & 0o777)
    os.replace(temporary, path)


def apply_import(prepared, args, root):
    local = root / '.local'
    local.mkdir(exist_ok=True)
    lock = local / 'import-audio.lock'
    try:
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError('已有导入任务或遗留锁 .local/import-audio.lock，请确认后再处理') from None
    os.close(handle)
    created, backup = [], None
    try:
        with tempfile.TemporaryDirectory(prefix='audio-import-', dir=local) as temporary:
            stage = Path(temporary)
            backup = Path(tempfile.mkdtemp(prefix=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-'), dir=make_backup_dir(local)))
            shutil.copy2(prepared['manifest'], backup / 'book.json')
            for plan in prepared['plans']:
                saved = backup / plan['source'].name
                shutil.copy2(plan['source'], saved)
                if digest(saved) != plan['sha256']:
                    raise ValueError('原件在分析后发生变化，备份校验失败，停止导入')
                output = stage / plan['target'].name
                duration = compress({**plan, 'source': saved}, output)
                plan['track'].update(src=plan['target'].relative_to(prepared['directory']).as_posix(), duration=duration)
                tracks = prepared['chapter']['tracks']
                if plan['number'] <= len(tracks):
                    tracks[plan['number'] - 1] = plan['track']
                else:
                    tracks.append(plan['track'])
            readme = root / 'README.md'
            before_readme, after_readme = update_readme(readme, prepared['book'])
            if after_readme is not None:
                (backup / 'README.md').write_bytes(before_readme)
            if prepared['manifest'].read_bytes() != prepared['original']:
                raise ValueError('book.json 已发生变化，停止导入，请重新预览')
            if before_readme is not None and readme.read_bytes() != before_readme:
                raise ValueError('README.md 已发生变化，停止导入')
            manifest_written = readme_written = False
            try:
                for plan in prepared['plans']:
                    within(plan['target'], within(prepared['directory'] / 'audio', prepared['directory']))
                    plan['target'].parent.mkdir(parents=True, exist_ok=True)
                    os.link(stage / plan['target'].name, plan['target'])  # Atomic no-overwrite publication.
                    created.append(plan['target'])
                data = (json.dumps(prepared['book'], ensure_ascii=False, indent=2) + '\n').encode('utf-8')
                atomic_write(prepared['manifest'], data, stage)
                manifest_written = True
                if after_readme is not None:
                    atomic_write(readme, after_readme, stage)
                    readme_written = True
            except BaseException:
                if manifest_written:
                    atomic_write(prepared['manifest'], prepared['original'], stage)
                if readme_written:
                    atomic_write(readme, before_readme, stage)
                for path in created:
                    path.unlink(missing_ok=True)
                raise
            if after_readme is None:
                print('提示：README 未找到对应的六列表格行，请手动补充书籍列表。')
    finally:
        lock.unlink(missing_ok=True)
        if backup:
            print(f'原件与配置备份：{backup.relative_to(root)}')
    if args.delete_source:
        try:
            if set(prepared['source'].iterdir()) != set(prepared['files']):
                raise ValueError('源目录内容发生变化')
            for plan in prepared['plans']:
                if digest(plan['source']) != plan['sha256']:
                    raise ValueError('源音频内容发生变化')
            for path in prepared['files']:
                path.unlink()
            prepared['source'].rmdir()
            print('源目录已删除。')
        except (OSError, ValueError) as error:
            print(f'提示：导入已完成，但源目录未完全清理：{error}；原件备份完整。', file=sys.stderr)
            return False
    return True


def make_backup_dir(local):
    path = local / 'originals' / 'audio-imports'
    path.mkdir(parents=True, exist_ok=True)
    return path


def main(argv=None, root=ROOT):
    parser = argparse.ArgumentParser(description='音频导入：默认只分析与预览；--apply 才写入。')
    parser.add_argument('--book', required=True, help='书籍 ID，例如 02-WuXuBiJi')
    parser.add_argument('--chapter', required=True, help='章节 ID，例如 chapter-01')
    parser.add_argument('--input', required=True, type=Path, help='单章音频的输入目录，按文件名数字顺序排列')
    parser.add_argument('--start', type=int, help='从第几节导入；预览可推断，执行时必须明确指定')
    parser.add_argument('--audio-dir', help='本书内的目标目录，例如 audio/01-XieZuoZhiYe')
    parser.add_argument('--apply', action='store_true', help='执行备份、压缩、验证和配置更新')
    parser.add_argument('--repair', action='store_true', help='允许解码警告且时长差不超过1秒的原件转码修复')
    parser.add_argument('--delete-source', action='store_true', help='仅在执行成功且原件备份校验后删除源目录')
    args = parser.parse_args(argv)
    try:
        if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
            raise ValueError('请先安装 FFmpeg（包含 ffmpeg 与 ffprobe）')
        if args.apply and args.start is None:
            raise ValueError('执行时必须用 --start 明确起始节，避免重复追加；请先不加 --apply 预览')
        prepared = prepare(args, root.resolve())
        for plan in prepared['plans']:
            action = '直接复用' if plan['reusable'] else '96kbps 单声道转码'
            print(f'{plan["source"].name} → {plan["target"].relative_to(root)} | 第{plan["number"]}节 | {plan["duration"]:.3f}秒 | {action}')
            if plan['warning']:
                print(f'  原件有解码警告，修复模式已启用：{plan["warning"][:500]}')
        if not args.apply:
            print(f'预览完成，没有写入或删除文件。确认排列和章节后，使用 --start {prepared["plans"][0]["number"]} --apply 执行。')
            return 0
        cleaned = apply_import(prepared, args, root.resolve())
        total = sum(plan['target'].stat().st_size for plan in prepared['plans'])
        print(f'完成：导入{len(prepared["plans"])}节，输出共{total / 1000000:.2f}MB。')
        return 0 if cleaned else 2
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'导入失败：{error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

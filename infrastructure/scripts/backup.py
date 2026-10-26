#!/usr/bin/env python3
"""Consistent PostgreSQL + local storage backup; application writers pause briefly."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ['docker', 'compose']


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def capture(args):
    return run(args, capture_output=True, text=True).stdout.strip()


def configuration():
    config = json.loads(capture(COMPOSE + ['config', '--format', 'json']))
    service = config['services']['ventilyator-api']
    storage = next(v['source'] for v in service['volumes'] if v['target'] == '/app/storage')
    return service['image'], storage


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_archive(path):
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Архив содержит небезопасный путь, ссылку или специальный файл')


def inspect_backup(directory):
    directory = directory.resolve(strict=True)
    if (directory / 'manifest.json').is_symlink():
        raise ValueError('Manifest не должен быть символической ссылкой')
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('format') != 1 or set(manifest.get('files', {})) != {'database.dump', 'storage.tar.gz', 'configuration.env'}:
        raise ValueError('Неподдерживаемый или неполный backup')
    for name, expected in manifest['files'].items():
        path = directory / name
        if path.is_symlink() or not path.is_file() or digest(path) != expected:
            raise ValueError(f'Нарушена целостность: {name}')
    validate_archive(directory / 'storage.tar.gz')
    return manifest


def running_writers():
    running = capture(COMPOSE + ['ps', '--services', '--status', 'running']).splitlines()
    return [s for s in ['ventilyator-api', 'ventilyator-worker'] if s in running]


def restart_writers(writers):
    # Start the same containers: images may already have been rebuilt for an
    # upgrade whose migrations have not run yet.
    run(COMPOSE + ['start', *writers], stdout=subprocess.DEVNULL)
    deadline = time.monotonic() + 180
    ids = capture(COMPOSE + ['ps', '-q', *writers]).splitlines()
    while time.monotonic() < deadline:
        states = capture(['docker', 'inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', *ids]).splitlines()
        if states and all(state in ['healthy', 'running'] for state in states):
            return
        if any(state in ['unhealthy', 'exited', 'dead'] for state in states):
            raise RuntimeError('API/worker не восстановили работоспособность после копирования')
        time.sleep(1)
    raise TimeoutError('API/worker не готовы после копирования')


def backup(output=None):
    os.umask(0o077)
    image, storage = configuration()
    parent = Path(output).resolve() if output else ROOT / '.local' / 'backups'
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory = parent / f'ventilyator-{stamp}-{uuid.uuid4().hex[:8]}'
    directory.mkdir(mode=0o700)
    writers = running_writers()
    try:
        if writers:
            print('Приостановка API и worker для согласованной копии.', flush=True)
            run(COMPOSE + ['stop', *writers], stdout=subprocess.DEVNULL)
        with (directory / 'database.dump').open('xb') as target:
            run(COMPOSE + ['exec', '-T', 'ventilyator-postgres', 'pg_dump', '-U', 'ventilyator', '-d', 'ventilyator', '-Fc', '--no-owner', '--no-privileges'], stdout=target)
        print('PostgreSQL сохранён. Архивация файлов и ключа SMTP.', flush=True)
        with (directory / 'storage.tar.gz').open('xb') as target:
            run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH', '-v', f'{storage}:/source:ro', '--entrypoint', 'tar', image, '-czf', '-', '-C', '/source', '.'], stdout=target)
        shutil.copyfile(ROOT / '.env', directory / 'configuration.env')
        os.chmod(directory / 'configuration.env', 0o600)
        names = ['database.dump', 'storage.tar.gz', 'configuration.env']
        revision = capture(['git', 'rev-parse', 'HEAD'])
        migrations = json.loads(capture(COMPOSE + ['exec', '-T', 'ventilyator-postgres', 'psql', '-U', 'ventilyator', '-d', 'ventilyator', '-Atc', "SELECT COALESCE(json_object_agg(migration_name,checksum),'{}'::json) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"]))
        manifest = {'format': 1, 'createdAt': stamp, 'revision': revision, 'migrations': migrations, 'files': {name: digest(directory / name) for name in names}, 'redisSessions': 'not-restored'}
        (directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        inspect_backup(directory)
        print(f'Backup проверен: {directory}', flush=True)
        return directory
    finally:
        if writers:
            restart_writers(writers)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', help='Каталог резервных копий; по умолчанию .local/backups')
    parser.add_argument('--verify', type=Path, help='Только проверить готовую копию')
    args = parser.parse_args()
    if args.verify:
        inspect_backup(args.verify)
        print('Контрольные суммы и пути в архиве проверены.')
    else:
        backup(args.output)


if __name__ == '__main__':
    main()

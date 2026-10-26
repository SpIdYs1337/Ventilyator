#!/usr/bin/env python3
"""Restore a verified backup only into an empty, separately prepared installation."""
import argparse
import os
from pathlib import Path
import subprocess
from backup import ROOT, COMPOSE, capture, configuration, digest, inspect_backup, run, running_writers, restart_writers


def restore(directory, apply=False):
    os.umask(0o077)
    directory = Path(directory).resolve(strict=True)
    manifest = inspect_backup(directory)
    for name, checksum in manifest.get('migrations', {}).items():
        if not name.replace('_', '').isalnum():
            raise ValueError('Некорректное имя миграции в manifest')
        path = ROOT / 'packages/database/prisma/migrations' / name / 'migration.sql'
        if not path.is_file() or digest(path) != checksum:
            raise ValueError('Для этой копии нужна совместимая версия исходников и миграций')
    print(f'Проверена копия {manifest["createdAt"]}, формат {manifest["format"]}.', flush=True)
    if not apply:
        print('Проверка без изменений. Для пустой подготовленной установки добавьте --apply-empty-target.')
        return
    image, storage = configuration()
    writers = running_writers()
    success = False
    modified = False
    try:
        if writers:
            run(COMPOSE + ['stop', *writers], stdout=subprocess.DEVNULL)
        exists = capture(COMPOSE + ['exec', '-T', 'ventilyator-postgres', 'psql', '-U', 'ventilyator', '-d', 'ventilyator', '-Atc', "SELECT to_regclass('public.\"User\"') IS NOT NULL;"])
        if exists == 't':
            users = capture(COMPOSE + ['exec', '-T', 'ventilyator-postgres', 'psql', '-U', 'ventilyator', '-d', 'ventilyator', '-Atc', 'SELECT COUNT(*) FROM "User";'])
            organizations = capture(COMPOSE + ['exec', '-T', 'ventilyator-postgres', 'psql', '-U', 'ventilyator', '-d', 'ventilyator', '-Atc', 'SELECT COUNT(*) FROM "Organization";'])
            if users != '0' or organizations != '0':
                raise ValueError('Целевая база не пуста. Восстановление поверх пользователей запрещено.')
        code = "const f=require('node:fs');let n=0;function walk(p){for(const e of f.readdirSync(p,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('symlink');if(e.isDirectory())walk(p+'/'+e.name);else n++}}walk('/target');console.log(n)"
        files = capture(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'DAC_READ_SEARCH', '-v', f'{storage}:/target:ro', '--entrypoint', 'node', image, '-e', code])
        if files != '0':
            raise ValueError('Целевое файловое хранилище не пусто; перезапись запрещена.')
        print('Пустая цель подтверждена. Восстановление PostgreSQL.', flush=True)
        modified = True
        with (directory / 'database.dump').open('rb') as source:
            run(COMPOSE + ['exec', '-T', 'ventilyator-postgres', 'pg_restore', '-U', 'ventilyator', '-d', 'ventilyator', '--clean', '--if-exists', '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction'], stdin=source, stdout=subprocess.DEVNULL)
        print('Восстановление файлов и ключа SMTP.', flush=True)
        with (directory / 'storage.tar.gz').open('rb') as source:
            run(['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '-v', f'{storage}:/target', '--entrypoint', 'tar', image, '-xzf', '-', '--no-same-owner', '-C', '/target'], stdin=source)
        # Cached sessions/queues are transient. The outbox in PostgreSQL recreates pending mail jobs.
        run(COMPOSE + ['exec', '-T', 'ventilyator-redis', 'redis-cli', 'FLUSHDB'], stdout=subprocess.DEVNULL)
        run(COMPOSE + ['run', '--rm', '-T', 'ventilyator-migrate'], stdout=subprocess.DEVNULL)
        success = True
        print('Восстановление завершено. Текущий .env сохранён; после запуска войдите заново.', flush=True)
    finally:
        if writers and (success or not modified):
            restart_writers(writers)
        elif writers:
            print('API и worker оставлены остановленными: проверьте причину отказа перед запуском.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('--apply-empty-target', action='store_true', help='Применить только после проверки пустой БД и хранилища')
    args = parser.parse_args()
    restore(args.backup, args.apply_empty_target)


if __name__ == '__main__':
    main()

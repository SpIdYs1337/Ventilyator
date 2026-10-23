#!/usr/bin/env python3
"""Select explicit HTTP access on a private test LAN without regenerating credentials."""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import tempfile

PRIVATE_NETWORKS = tuple(ipaddress.IPv4Network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))


def configure(root: Path, address: str, port: int = 80) -> str:
    ip = ipaddress.IPv4Address(address)
    if not any(ip in network for network in PRIVATE_NETWORKS):
        raise ValueError('Укажите частный IPv4-адрес сервера из локальной сети.')
    if not 1 <= port <= 65535:
        raise ValueError('Порт должен быть от 1 до 65535.')
    env = root / '.env'
    if env.is_symlink() or not env.is_file():
        raise ValueError('Нужен существующий обычный файл .env установленного приложения.')
    if env.stat().st_uid != os.geteuid():
        raise ValueError('Запустите скрипт от владельца .env без sudo.')
    original = env.read_text()
    origin = f'http://{ip}' + (f':{port}' if port != 80 else '')
    updates = {
        'BIND_IP': str(ip),
        'LAN_HTTP_PORT': str(port),
        'LAN_HTTP_ORIGIN': origin,
        'COMPOSE_FILE': 'docker-compose.yml:docker-compose.lan.yml',
    }
    lines = []
    seen = set()
    for line in original.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        key = match.group(1) if match else None
        if key in updates:
            lines.append(f'{key}={updates[key]}')
            seen.add(key)
        else:
            lines.append(line)
    lines.extend(f'{key}={value}' for key, value in updates.items() if key not in seen)
    updated = '\n'.join(lines) + '\n'
    if updated == original:
        return origin
    local = root / '.local'
    if local.is_symlink() or (local.exists() and not local.is_dir()):
        raise ValueError('.local должен быть обычным каталогом.')
    local.mkdir(exist_ok=True)
    backup = local / 'env.before-lan-http'
    try:
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass  # Preserve the first configuration backup on repeated calls.
    else:
        with os.fdopen(fd, 'w') as stream:
            stream.write(original)
            stream.flush()
            os.fsync(stream.fileno())
    fd, temporary = tempfile.mkstemp(prefix='.env.lan-', dir=root)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, env)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return origin


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ip', help='Частный IPv4-адрес Ubuntu-сервера')
    parser.add_argument('--port', type=int, default=80)
    args = parser.parse_args()
    try:
        origin = configure(Path(__file__).resolve().parents[2], args.ip, args.port)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Не удалось настроить LAN HTTP: {error}\n')
    print(f'Тестовый HTTP-доступ: {origin}')
    print('Пароли, база данных и существующие пользователи сохранены.')
    print('HTTP передаёт пароль без шифрования; используйте только изолированную тестовую сеть.')
    print('Примените: docker compose up -d --no-build --wait --wait-timeout 180')


if __name__ == '__main__':
    main()

#!/bin/sh
set -eu
# Выполняется однократно на сервере. Не меняет владельцев существующих данных.
root=${1:-/srv/ventilyator}
case "$root" in /*) ;; *) echo 'Требуется абсолютный путь' >&2; exit 1;; esac
for item in postgres:70 redis:999 storage:1000 config:1000 backups:1000 logs:1000; do
  name=${item%:*}
  owner=${item#*:}
  path="$root/$name"
  if [ ! -e "$path" ]; then install -d -m 0700 -o "$owner" -g "$owner" "$path"; fi
  if [ -L "$path" ]; then echo "Символические ссылки запрещены: $path" >&2; exit 1; fi
done
for name in caddy tls; do
  if [ ! -e "$root/config/$name" ]; then install -d -m 0700 -o 1000 -g 1000 "$root/config/$name"; fi
done
echo 'Каталоги подготовлены; существующие данные не изменены.'

# Установка через GitHub на чистую Ubuntu Server 24.04 LTS

Требования: Bash, sudo, постоянный IP, 4 CPU, 8 GB RAM, от 40 GB SSD и место под данные. Интернет требуется для установки и сборки. Node.js, PostgreSQL и Redis на Ubuntu отдельно не устанавливаются.

Текущая версия — инфраструктура и базовый локальный Identity. Проекты, задачи, документы и уведомления ещё не реализованы; IMAP завершён частично. Подготовка сервера не означает готовность всей платформы к эксплуатации. См. ROADMAP.md и DEVELOPMENT.md.

## 1. Обновить Ubuntu

Подключитесь по SSH под администратором с sudo. Проверьте постоянный адрес сервера; примеры ниже используют 192.168.1.50.

```bash
ip -br address
ip route
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git python3 openssl nano
```

При наличии /var/run/reboot-required выполните `sudo reboot` и подключитесь снова. Настройте постоянный адрес через DHCP reservation либо сетевые настройки организации.

## 2. Установить Docker и Compose

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
docker run --rm hello-world
```

newgrp открывает оболочку с обновлённой группой. Доступ к Docker даёт административные полномочия — предоставляйте его только администраторам. Compose должен быть не ниже 2.24.4 для поддержки !override; актуальный plugin официального Docker-репозитория подходит.

## 3. Клонировать main из GitHub

```bash
sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" /opt/ventilyator
git clone --branch main --single-branch https://github.com/SpIdYs1337/Ventilyator.git /opt/ventilyator
cd /opt/ventilyator
git log -1 --oneline
test -f docker-compose.yml
test -f infrastructure/scripts/configure.py
```

Каталог должен быть новым и пустым. Для закрытого репозитория используйте разрешённый организацией SSH-доступ или credential manager. Не вставляйте токены в URL команд и историю shell. GitHub не нужен для обычной работы уже установленного приложения.

## 4. Создать конфигурацию и каталоги

Замените IP и имя своими значениями:

```bash
vnt_server_ip='192.168.1.50'
vnt_app_host='ventilyator.company.local'
python3 infrastructure/scripts/configure.py --host "$vnt_app_host" --data-root /srv/ventilyator
stat -c '%a %n' .env
sudo sh infrastructure/scripts/prepare-host.sh /srv/ventilyator
```

Ожидаются права .env 600. Скрипт создаёт случайные пароли PostgreSQL/Redis и отказывается перезаписывать .env. Не публикуйте его и не пытайтесь регенерировать для существующей БД.

Данные находятся в /srv/ventilyator/postgres, redis, storage, config, backups и logs. Скрипт задаёт владельцев новым каталогам: PostgreSQL UID 70, Redis UID 999, приложение/Caddy UID 1000. Не меняйте произвольно владельцев существующих данных.

## 5. Ограничить публикацию веб-портов IP локальной сети

```bash
mkdir -p .local
cat > .local/compose.server.yml <<'YAML'
services:
  ventilyator-proxy:
    ports: !override
      - "${BIND_IP:?Set BIND_IP}:80:8080"
      - "${BIND_IP:?Set BIND_IP}:443:8443"
YAML
printf '\nBIND_IP=%s\nCOMPOSE_FILE=docker-compose.yml:.local/compose.server.yml\n' "$vnt_server_ip" >> .env
docker compose config --quiet
```

Добавление выполняется один раз. Обычные команды docker compose далее автоматически используют override. PostgreSQL и Redis наружу не публикуются. Проверьте, что порты 80/443 свободны. Разрешите доступ из нужной сети на сетевом firewall; опубликованные Docker-порты могут обходить обычные правила UFW. Перенаправление портов из интернета для внутренней установки не требуется.

## 6. Настроить DNS

Создайте в DNS организации запись ventilyator.company.local → 192.168.1.50. Для отдельного клиента допустима запись hosts:

```text
192.168.1.50 ventilyator.company.local
```

Linux: /etc/hosts. Windows: C:\Windows\System32\drivers\etc\hosts, редактирование администратором. APP_HOST и APP_ORIGIN должны совпадать с реальным адресом браузера; production требует HTTPS.

## 7. Собрать и запустить

```bash
cd /opt/ventilyator
docker compose build ventilyator-api ventilyator-web ventilyator-proxy
docker compose up -d --no-build --wait --wait-timeout 180
docker compose ps -a
docker compose logs --tail=100 ventilyator-migrate
```

Образ API используется также worker и миграциями. Ожидаются healthy PostgreSQL/Redis/API/worker/web, работающий proxy и migrate Exited (0). Миграции автоматически применяются через Prisma migrate deploy; db push и reset для постоянной базы не используются.

Для сборки нужны официальные репозитории Ubuntu/Debian, registry.npmjs.org, Docker Hub/CDN и binaries.prisma.sh. При 403/503 исправьте сетевой доступ или корпоративный proxy; не отключайте TLS, package integrity, apt signatures или Prisma checksums. Dockerfile поддерживает build secret corporate_ca. Скрипт cloud-build.py относится к облачной среде и не нужен на обычной Ubuntu без соответствующих bindings.

## 8. Настроить доверие к HTTPS CA

Caddy по умолчанию использует внутренний CA. Экспортируйте только публичный root certificate:

```bash
docker compose exec -T ventilyator-proxy cat /data/caddy/pki/authorities/local/root.crt > "$HOME/ventilyator-root-ca.crt"
openssl x509 -in "$HOME/ventilyator-root-ca.crt" -noout -subject -fingerprint -sha256
sudo install -m 0644 "$HOME/ventilyator-root-ca.crt" /usr/local/share/ca-certificates/ventilyator.crt
sudo update-ca-certificates
curl --fail --show-error --resolve "${vnt_app_host}:443:${vnt_server_ip}" "https://${vnt_app_host}/api/health/live"
curl --fail --show-error --resolve "${vnt_app_host}:443:${vnt_server_ip}" "https://${vnt_app_host}/api/health/ready"
```

Оба запроса должны вернуть 200; readiness — {"status":"ok"}. --resolve работает до настройки DNS и сохраняет проверку имени сервера. Не используйте curl -k. Если SSH-сессия была закрыта, повторно задайте vnt_server_ip/vnt_app_host из шага 4.

## 9. Создать администратора

Выполняется один раз на новой базе. Замените ADMIN_EMAIL, ADMIN_NAME, ORGANIZATION_NAME. Пароль вводится без эха и не сохраняется в argv/environment. Временный файл принадлежит UID 1000 и удаляется через trap; это работает и при отличающемся UID администратора Ubuntu.

```bash
cd /opt/ventilyator
(
  set -euo pipefail
  sudo -v
  vnt_password_file=$(sudo mktemp /run/ventilyator-admin.XXXXXXXX)
  trap 'unset vnt_admin_password; sudo rm -f -- "$vnt_password_file"' EXIT
  read -r -s -p 'Пароль администратора, 14–256 символов: ' vnt_admin_password
  printf '\n'
  if [ "${#vnt_admin_password}" -lt 14 ] || [ "${#vnt_admin_password}" -gt 256 ]; then
    printf 'Недопустимая длина пароля.\n' >&2
    exit 1
  fi
  sudo chown 1000:1000 "$vnt_password_file"
  sudo chmod 0600 "$vnt_password_file"
  printf '%s' "$vnt_admin_password" | sudo tee "$vnt_password_file" > /dev/null
  unset vnt_admin_password
  docker compose run --rm -T \
    -e ADMIN_EMAIL=admin@company.local \
    -e 'ADMIN_NAME=Администратор' \
    -e 'ORGANIZATION_NAME=Моя организация' \
    -e ADMIN_PASSWORD_FILE=/run/admin-password \
    -v "$vnt_password_file:/run/admin-password:ro" \
    ventilyator-api node apps/api/dist/create-admin.js
)
```

Сохраните выбранный пароль в менеджере паролей. После появления первого пользователя повторный bootstrap запрещён. Остальные локальные пользователи создаются через веб-панель администратора.

## 10. Подготовить клиентский компьютер

На компьютере пользователя скачайте публичный CA с сервера (замените SSH-имя и IP):

```bash
scp ubuntu@192.168.1.50:ventilyator-root-ca.crt .
```

Сверьте SHA-256-отпечаток с показанным на сервере. Windows/PowerShell — доверие для текущего пользователя:

```powershell
certutil -user -addstore Root .\ventilyator-root-ca.crt
```

Ubuntu-клиент:

```bash
sudo install -m 0644 ventilyator-root-ca.crt /usr/local/share/ca-certificates/ventilyator.crt
sudo update-ca-certificates
```

При необходимости отдельно импортируйте CA в собственное хранилище Firefox. В организации CA распространяется централизованно. Приватный ключ CA не передавайте клиентам.

Откройте https://ventilyator.company.local, войдите администратором, затем «Администрирование → Пользователи → Добавить сотрудника». Проверьте вход нового пользователя, отсутствие у Team Member административного доступа и завершение сессии в «Мои устройства». Почтовые настройки для локального входа не требуются.

## 11. Проверить перезапуск и автозапуск

```bash
cd /opt/ventilyator
docker compose restart
docker compose up -d --wait --wait-timeout 180
docker compose ps -a
```

Проверьте повторный вход и наличие пользователя, затем выполните sudo reboot. После нового SSH-подключения:

```bash
cd /opt/ventilyator
systemctl is-active docker
docker compose ps -a
```

Приложения используют restart: unless-stopped; вручную остановленные контейнеры нужно запускать docker compose up -d. Миграция остаётся Exited (0), это нормально. Не удаляйте каталоги данных для перезапуска.

## 12. Корпоративный сертификат вместо внутреннего CA

Если организация уже выдала сертификат для вашего точного DNS-имени, этот вариант заменяет внутренний CA. Нужны полная цепочка и соответствующий приватный ключ:

```bash
sudo install -o 1000 -g 1000 -m 0644 /путь/к/fullchain.pem /srv/ventilyator/config/tls/fullchain.pem
sudo install -o 1000 -g 1000 -m 0600 /путь/к/private.key /srv/ventilyator/config/tls/private.key
cd /opt/ventilyator
nano .env
```

Установите:

```dotenv
TLS_CERT=/etc/ventilyator/tls/fullchain.pem
TLS_KEY=/etc/ventilyator/tls/private.key
```

Примените:

```bash
docker compose up -d --no-deps --force-recreate ventilyator-proxy
```

Клиенты должны доверять CA организации. Внутренние порты Caddy — 8080/8443, внешние — 80/443.

## 13. Диагностика и оставшиеся работы

```bash
cd /opt/ventilyator
docker compose ps -a
docker compose logs --tail=100 ventilyator-api ventilyator-worker ventilyator-web ventilyator-proxy
docker compose logs -f ventilyator-api ventilyator-worker
```

Не выводите docker compose config без --quiet в общедоступные логи: он содержит значения секретов. Не удаляйте /srv/ventilyator и не используйте down -v или повторную генерацию .env для устранения ошибки.

В облачной среде проверены сборка, 9 unit и 16 API/Identity/BullMQ-проверок, Prisma migrate/schema diff, сохранность PostgreSQL/Redis/storage при пересоздании контейнеров, HTTPS и readiness при отказе worker. Отдельная чистая Ubuntu, браузерные E2E и последняя оптимизация кеширующего слоя Docker требуют проверки на целевом сервере.

SMTP, автоматизированные backup/restore и IMAP-настройки через веб пока не готовы. Перед эксплуатацией необходимо закончить соответствующие этапы и проверить восстановление резервной копии. История фактических проверок — DEVELOPMENT.md.

# Разработка и проверки

Нужны Node 24 LTS, pnpm 11.25.0, Python 3, Docker и Compose ≥2.24.4. Работайте в существующем checkout. Пакеты зафиксированы lockfile, prerelease не используются.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
python3 -m unittest discover -s tests/unit -p 'test_*.py'
```

В облачной среде используйте writable cache: XDG_CACHE_HOME=/workspace/.cache, XDG_DATA_HOME=/workspace/.cache/data, DOCKER_CONFIG=/workspace/.cache/docker, pnpm --store-dir /workspace/.cache/pnpm-store. BuildKit сохраняет store и metadata/cache отдельно. Proxy/доверенный CA поддерживаются через локальный cloud-build.py override. TLS, lockfile/integrity, supply-chain policies и Prisma checksum не отключаются. Нужен доступ к binaries.prisma.sh/registry/Docker Hub.

## Интеграционные проверки

Только изолированная development-установка, никогда production. Сценарии создают случайные временные данные; API-наборы удаляют свои организации. PostgreSQL/Redis/storage настоящие, ответы не подменяются.

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
docker compose exec -T ventilyator-api node tests/integration/smoke.cjs
docker compose exec -T ventilyator-api node tests/integration/work.cjs
python3 tests/integration/migrations.py
python3 tests/integration/backup_restore.py
```

Migrations создаёт и удаляет отдельную временную базу, не меняя исходную. Backup/restore намеренно приостанавливает API/worker и запускает отдельный Compose project с пустыми данными/другими паролями/портом 18081. Не запускайте его параллельно API/E2E/persistence-тестам. Для override тестовой среды передайте VENTILYATOR_TEST_COMPOSE_FILES; по умолчанию base:dev.

## Почтовая интеграция и файлы

Набор platform.cjs поднимает локальные TLS SMTP, STARTTLS SMTP и IMAP fixtures. Сертификат выдаётся временным тестовым CA, hostname и TLS реально проверяются, worker действительно доставляет письмо на локальный fixture. Наружу почта не отправляется. API и worker должны видеть именно тестовый CA-файл; используйте только development override:

```bash
mkdir -p .local
cat > .local/mail-test.yml <<'YAML'
services:
  ventilyator-api:
    environment:
      MAIL_CA_FILE: /app/storage/.keys/platform-test-ca.pem
  ventilyator-worker:
    environment:
      MAIL_CA_FILE: /app/storage/.keys/platform-test-ca.pem
YAML
export COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml:.local/mail-test.yml
docker compose up -d --no-build --wait --wait-timeout 180
docker compose exec -T ventilyator-api node tests/integration/platform.cjs
```

Fixture создаёт/удаляет только временные тестовые сертификаты, SMTP-ключ приложения сохраняется. Проверяется ClamAV INSTREAM на локальном имитаторе: clean/found/недоступность обязательного сканера. Это проверка протокола, не антивирусной базы настоящего clamd.

После почтовых проверок вернитесь к обычному base:dev Compose. Настоящие корпоративные SMTP/IMAP/CA не использовались.

## Браузерные сценарии

На development-базе с отдельным администратором и закрытым файлом его пароля:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  ADMIN_EMAIL=admin@company.local \
  ADMIN_PASSWORD_FILE="$PWD/.local/admin-password" pnpm test:e2e
```

Можно установить браузер через `pnpm exec playwright install chromium`; здесь CDN отвечал403, поэтому использован системный Chromium154. Пароль не печатается и не передаётся argv. Trace/HAR выключены. Не запускайте набор многократно с одним email без учёта лимита 12 входов за 15 минут; защиту входа не отключайте. E2E-данные сохраняются в development-базе для проверки интерфейса, используйте отдельную тестовую организацию. settings.spec.ts сохраняет IMAP-настройки этой организации с тестовым доменом и выключает IMAP после проверки; не запускайте его на организации с рабочей почтовой конфигурацией.

Desktop и Pixel7 emulation проходят локального пользователя/сессии, проект/приглашение/задачу/статус/историю, чек-лист/ручное время/таймер, личный черновик/публикацию/восстановление, файл с точными байтами, Markdown-таблицу/изображение/оглавление и повторное открытие. Мобильная проверка включает отсутствие горизонтального overflow документа. Это Chromium emulation, не испытание всех реальных iOS/Android устройств.

## Результаты этой работы

| Проверка | Результат |
|---|---|
| Frozen dependencies, Prisma Client, все 8 пакетов/apps | Сборка успешна |
| TypeScript strict / ESLint | Успешно |
| TypeScript unit | 27 passed: документы/XSS/структура/таблицы, Markdown, файловые границы, AES-GCM vault, HTTP JSON/empty/error ответы, упоминания и атрибуты ссылок |
| Python unit | 12 passed: LAN-конфигурация и проверка backup/архивов |
| Identity/API/BullMQ | 16 passed |
| Проекты/задачи/ACL/конкурентные записи | 26 passed |
| Знания/planning/files/поиск/настройки/почта | 43 passed; в том числе worker SMTP TLS, STARTTLS verify, IMAP login/link/provision, дедупликация сроков и обязательный ClamAV-протокол |
| SQL migrations | 3 passed на отдельной свежей базе: цепочка, сохранение REVIEW/пользователя, backfill разрешения |
| Schema drift | No difference detected |
| Backup/restore | 4 passed: согласованная копия, отдельное восстановление с другими паролями БД/Redis, ключ SMTP, запрет перезаписи |
| Browser desktop/mobile | 14 passed; документы/упоминания/опубликованные чек-листы, ссылки без popup, показатели рабочего стола, задачи/время, пользователи, первый вход/сохранение IMAP и компактный режим с перезагрузкой |
| Полный deploy.sh | Выполнен: сборка → согласованный backup → migrate → запуск и healthchecks |
| Docker backend/web/proxy | Сборка и полный запуск успешны; API/worker/web/PG/Redis healthy, migrate Exited0 |
| Целевой чистый Ubuntu / корпоративная почта / настоящий ClamAV | Не проверены |

В ходе браузерных проверок исправлены проверка актуальных table align attrs Tiptap и мобильный фокус: DOM focus происходит до создания ProseMirror-транзакции, чтобы не отправлять устаревшую transaction. Чек-лист сохраняется асинхронно с оптимистичным отображением и откатом при ошибке. Реальные тесты повторяются после изменений, а не объявляются успешными по сборке.

Vite предупреждает о чанке редактора примерно998kB и основном чанке примерно522kB до gzip. Редактор вынесен из первоначальной загрузки по маршруту; дальнейшее уменьшение остаётся задачей оптимизации. Vitest предупреждает о будущем изменении configLoader для CommonJS-конфига; текущие тесты проходят. Нагрузочные испытания, аудит безопасности и полный паритет Jira/Confluence не выполнены.

Ранее в этой же среде проверены HTTPS Caddy с trusted CA/hostname, LAN cookie/CSRF/Swagger404, сохранность PostgreSQL/Redis/storage после пересоздания и readiness503 при остановленном worker с восстановлением200. Это не приёмка пользовательского Ubuntu. Публикация облачного снимка/восстановление в новой облачной задаче не выполнялись.

## Исправление почты и компактного режима

Воспроизведена пользовательская ошибка: до первого сохранения /admin/mail возвращал HTTP200 без тела, вкладка показывала JSON parse error. После исправления этот запрос возвращает JSON с выключенными SMTP/IMAP и портами465/993, не создавая запись настроек. Клиент совместим и с пустым ответом старого API. Интеграция проверяет заголовок/содержимое и отсутствие побочной записи; 6 новых unit проверяют пустой200,204, JSON null, обычный JSON, некорректный JSON и безопасную обработку ошибок.

Компактный режим проверен по реальному уменьшению ширины sidebar/отступов, сохранению после reload, работе именованных навигационных ссылок и обратному переключению. На мобильном экране меню остаётся с подписями. Первый набор из12 E2E после почтового исправления выполнен на собранных образах без source mounts. Текущий расширенный набор содержит14 успешных E2E и43 платформенных проверки, включая IMAP TLS/link/provision и SMTP fixture. Корпоративный сервер пользователя не подключался.

## Знания и навигация рабочего стола

Добавлены упоминания активных сотрудников с доступом к пространству: Rich JSON хранит UUID и проверенное имя, комментарии — @email. Внутренние уведомления создаются при публикации/комментарии, не при сохранении черновика. API-проверки запрещают межорганизационные упоминания и проверяют адресные уведомления.

Чек-лист опубликованной страницы изменяется отдельным endpoint с revision/index/checked, создаёт новую версию и аудит, не меняет личные черновики. Проверены запрет для наблюдателя/чужой организации, конфликт устаревшей revision и сохранность черновика.

Метрики рабочего стола ведут в проекты и /my-tasks с фильтрами overdue/upcoming/completed. API проверяет соответствие фильтров счётчикам и не выдаёт чужие/неназначенные задачи. Ссылки редактора открываются в текущей вкладке, включая старый target=_blank; клавиши Ctrl/Cmd сохраняют обычное поведение браузера. Браузерный тест проверяет внутренний маршрут и внешний адрес, ответ которого локально перехватывается fixture (без обращения к реальному внешнему сайту), отсутствие popup и возврат на страницу. Все14 E2E и43+26+16 API-проверок прошли на итоговых Docker-образах без source mounts.

## Возобновление облачной development-среды

```bash
bash infrastructure/scripts/cloud-install.sh
bash infrastructure/scripts/cloud-start.sh
```

Для пересборки текущих исходников:

```bash
python3 infrastructure/scripts/cloud-build.py
DOCKER_CONFIG=/workspace/.cache/docker docker compose \
  -f docker-compose.yml -f docker-compose.dev.yml -f .local/cloud-build.yml \
  build ventilyator-api ventilyator-web ventilyator-proxy
bash infrastructure/scripts/cloud-start.sh
```

Не коммитьте .env, .local, пароли, backups и test-results. На маленьком облачном диске VFS build cache может занимать значительно больше места, чем размер образов; удаляйте только неиспользуемый обычный build cache, сохраняя данные и dependency cache. Production-update выполняется по DEPLOYMENT.md.

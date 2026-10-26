# Ventilyator API

Все маршруты имеют префикс `/api`. В development OpenAPI доступен по `/api/docs`; в production отключён, LAN-прокси также его закрывает. Авторизация — cookie `ventilyator_session`. Все методы, кроме GET/HEAD/OPTIONS, требуют `Origin`, совпадающий с APP_ORIGIN, и `X-Ventilyator-Request: 1`. Ответы API имеют `Cache-Control: no-store`.

| Метод и путь | Доступ и результат |
|---|---|
| GET /health/live | Публичный liveness |
| GET /health/ready | 200 при готовности всех зависимостей, иначе 503 без конфигурации |
| POST /auth/login | `{email,password,remember?,provider?:local\|imap}`, cookie |
| GET /auth/me | Текущий пользователь и его разрешения, без хеша пароля |
| GET /auth/sessions | Метаданные устройств текущего пользователя |
| DELETE /auth/sessions/:id | Отзыв своей сессии |
| POST /auth/logout | Отзыв текущей сессии и удаление cookie |
| POST /auth/logout-all | Отзыв всех собственных сессий |
| GET /admin/system | system:read; состояние четырёх компонентов |
| GET /admin/users | users:manage; q, offset, limit, массив пользователей своей организации |
| POST /admin/users | users:manage; email, name, password, roleId; локальный пользователь |
| GET /admin/roles | users:manage / roles:manage / mail:manage; роли своей организации |
| POST /admin/roles | roles:manage; name и permissions, без повышения собственных полномочий |
| GET /admin/audit | audit:read; последние 100 событий своей организации |
| DELETE /admin/sessions/:id | sessions:revoke; только в собственной организации |

Неверный вход — 401 с общим сообщением, отсутствие разрешения — 403, чужая роль/сессия администратора — 404, превышение попыток — 429. DTO проверяются Zod и отвергают неизвестные поля. Коллекции имеют явные ограничения; проверьте конкретный формат перед интеграцией. Общего cursor API пока нет.

## Проекты и задачи

Для краткости ниже `P=/projects/:projectId`, `T=P/tasks/:taskId`. В URL используются UUID; номер вида VNT-1 предназначен для отображения.

| Метод и путь | Поведение |
|---|---|
| GET /projects | Доступные проекты; archived=true/false, offset, limit |
| POST /projects | key, name, description?; projects:create/manage |
| GET P | Проект, участники, myRole и счётчики |
| PATCH P | version + name/description/archived; администратор проекта |
| GET P/people | Активные сотрудники своей организации для приглашения; q, offset, limit; администратор проекта |
| PUT P/members | userId, role=MANAGER/MEMBER/VIEWER; добавление или изменение роли |
| DELETE P/members/:userId | Удаление участника со снятием назначений |
| GET P/tasks | q, status, mine=true/false, offset, limit |
| POST P/tasks | title; description/type/priority/assigneeId/dueAt/startsAt/labels/estimateMinutes/storyPoints/parentId/sprintId необязательны |
| GET T | Карточка задачи |
| PATCH T | version + изменяемые поля; допускается status |
| GET T/comments | Комментарии, от новых к старым, offset/limit |
| POST T/comments | body; участник с правом изменения |
| GET T/events | История, от новых к старым, offset/limit |

Коллекции возвращают `{items,total,offset,limit}`; limit по умолчанию 50, максимум 100. PATCH требует числовую актуальную version; устаревшее изменение и запись в архивный проект возвращают 409. Для комментариев версия задачи не нужна. Даты dueAt — ISO 8601 с часовым поясом или null. assigneeId=null снимает назначение. Автор, организация, номер и история определяются сервером; неизвестные поля отклоняются. Чужой или недоступный объект возвращает 404, запись наблюдателем — 403. Подробности прав — в docs/projects-tasks.md.

## Планирование и расширения задач

Ниже P/T имеют тот же смысл; write требует участника с правом записи, менеджерские действия — MANAGER.

| Метод и путь | Поведение |
|---|---|
| GET/POST P/sprints | Список до 100 / создание спринта (менеджер) |
| PUT P/sprints/:id | status ACTIVE/CLOSED, менеджер; один активный спринт |
| PUT P/workflow | statuses/transitions, заголовок If-Match: версия проекта; менеджер |
| GET T/details | Чек-лист, подзадачи, зависимости, записи времени, собственный таймер, наблюдатели и ссылки |
| POST T/checklist | label |
| PUT/DELETE T/checklist/:id | done / удаление |
| POST T/dependencies | dependsOnId; запрет циклов |
| DELETE T/dependencies/:id | Удаление связи |
| POST T/time | minutes, startedAt ISO8601, note? |
| DELETE T/time/:id | Своя запись или менеджер проекта |
| POST T/timer/start / T/timer/stop | Один постоянный таймер на пользователя |
| PUT T/watch | enabled |
| POST T/pages | pageId; доступ к обоим объектам |
| DELETE T/pages/:pageId | Удаление связи |
| GET P/reports | Статусы, сотрудники, время, задачи, truncated при >10000 |

## Знания

S=/knowledge/spaces/:spaceId, D=S/pages/:pageId.

| Метод и путь | Поведение |
|---|---|
| GET/POST /knowledge/spaces | Доступные пространства / создание |
| GET/PATCH S | Пространство / version + name/description/archived, менеджер |
| GET S/people | q, первые 100 доступных сотрудников для приглашения |
| PUT S/members | userId, role MANAGER/MEMBER/VIEWER |
| DELETE S/members/:userId | Исключение, владелец защищён |
| GET/POST S/pages | q/archived, до 2000 / title,parentId? |
| GET D | Опубликованное содержимое и только собственный draft |
| PUT D/draft | title, content Rich JSON, baseRevision; личный черновик |
| POST D/publish | Те же поля, атомарная публикация и версия; stale →409 |
| PATCH D | revision + parentId/archived/sortOrder |
| GET D/versions | offset, 50 неизменяемых версий |
| POST D/restore/:number | revision текущей страницы; создаёт новую публикацию |
| GET/POST D/comments | offset, 50 комментариев / body |
| GET/POST D/tasks | Доступные связанные задачи / projectId,title, атомарное создание |

Неопубликованная страница видна автору/менеджеру пространства. PageDraft другого редактора не возвращается. Сервер ограничивает структуру документа, объём, URL и вложенность.

## Файлы

| Метод и путь | Поведение |
|---|---|
| GET /files/task/:id или /files/page/:id | trash=true/false, до 200 объектов с версиями |
| POST /files/task/:id/uploads или /files/page/:id/uploads | name,size,objectId? для новой версии; билет id/objectId/number/expiresAt |
| PUT /files/uploads/:id | Сырые байты application/octet-stream, точный заявленный размер |
| GET /files/:id/download | version?, inline=1 только для безопасного изображения, ACL при каждом запросе |
| PATCH /files/:id | name? / deleted? |
| GET /files/status | storage:manage, квота/диск/операции своей организации |
| PUT /files/quota | storage:manage, bytes |
| POST /files/reconcile | storage:manage, до 100 просроченных/failed операций |

## Рабочий стол и уведомления

| Метод и путь | Поведение |
|---|---|
| GET /dashboard | Задачи/сроки/активность/проекты/страницы и preferences |
| GET /search | q, Russian/simple full text задач/страниц, проекты; ACL |
| GET /notifications | offset, q=unread для непрочитанных |
| POST /notifications/read-all | Отметить свои уведомления |
| POST /notifications/:id/read | Отметить одно своё |
| PUT /preferences | widgets[], emailEnabled |

## Дополнительное администрирование

| Метод и путь | Поведение |
|---|---|
| PATCH /admin/users/:id | users:manage; name, active?, roleId? |
| POST /admin/users/:id/password | users:manage; password и отзыв сессий |
| PUT /admin/users/:id/imap | users:manage; enabled, явное связывание |
| POST /auth/password | currentPassword,password; проверка текущего и отзыв сессий |
| PUT/DELETE /admin/roles/:id | roles:manage; name/permissions / удалить только неиспользуемую |
| GET/PUT /admin/mail | mail:manage; настройки без выдачи секретов / сохранить |
| POST /admin/mail/test-smtp | Проверить сохранённый TLS/STARTTLS SMTP |
| POST /admin/mail/test-email | Поставить тестовое письмо себе в outbox |
| POST /admin/mail/test-imap | email,password, настоящий TLS IMAP LOGIN без сохранения пароля |
| GET /admin/mail/deliveries | Последние 100 статусов доставок своей организации |

Схемы точных допустимых полей и ограничений: packages/validation/src. Чужой объект →404, запрет записи →403, конкурентная версия/WIP/цикл зависимостей →409 или400 в зависимости от действия. Неизвестные поля отклоняются, файловая система клиентом не адресуется.

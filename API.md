# Ventilyator API v0.1

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
| GET /admin/users | users:manage; первые 100 пользователей своей организации |
| POST /admin/users | users:manage; email, name, password, roleId; локальный пользователь |
| GET /admin/roles | users:manage; роли своей организации |
| POST /admin/roles | roles:manage; name и permissions, без повышения собственных полномочий |
| GET /admin/audit | audit:read; последние 100 событий своей организации |
| DELETE /admin/sessions/:id | sessions:revoke; только в собственной организации |

Неверный вход — 401 с общим сообщением, отсутствие разрешения — 403, чужая роль/сессия администратора — 404, превышение попыток — 429. DTO проверяются Zod и отвергают неизвестные поля. Для будущих коллекций необходимы полноценные cursor-pagination и фильтры; текущие небольшие административные списки имеют явное ограничение 100.

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
| POST P/tasks | title; description/type/priority/assigneeId/dueAt необязательны |
| GET T | Карточка задачи |
| PATCH T | version + изменяемые поля; допускается status |
| GET T/comments | Комментарии, от новых к старым, offset/limit |
| POST T/comments | body; участник с правом изменения |
| GET T/events | История, от новых к старым, offset/limit |

Коллекции возвращают `{items,total,offset,limit}`; limit по умолчанию 50, максимум 100. PATCH требует числовую актуальную version; устаревшее изменение и запись в архивный проект возвращают 409. Для комментариев версия задачи не нужна. Даты dueAt — ISO 8601 с часовым поясом или null. assigneeId=null снимает назначение. Автор, организация, номер и история определяются сервером; неизвестные поля отклоняются. Чужой или недоступный объект возвращает 404, запись наблюдателем — 403. Подробности прав — в docs/projects-tasks.md.

# Ventilyator API v0.1

Все маршруты имеют префикс `/api`. В development OpenAPI доступен по `/api/docs`; в production отключён. Авторизация — cookie `ventilyator_session`. Все POST/DELETE требуют `Origin`, совпадающий с APP_ORIGIN, и `X-Ventilyator-Request: 1`. Ответы API имеют `Cache-Control: no-store`.

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

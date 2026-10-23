import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
void i18n.use(initReactI18next).init({ lng: 'ru', fallbackLng: 'ru', interpolation: { escapeValue: false }, resources: { ru: { translation: { home: 'Обзор', sessions: 'Мои устройства', admin: 'Администрирование', logout: 'Выйти', workspace: 'Рабочее пространство' } }, en: { translation: { home: 'Overview', sessions: 'My devices', admin: 'Administration', logout: 'Sign out', workspace: 'Workspace' } } } });

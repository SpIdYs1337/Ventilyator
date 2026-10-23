import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const usePreferences = create<{ dark: boolean; compact: boolean; toggleTheme: () => void; toggleCompact: () => void }>()(persist(set => ({ dark: false, compact: false, toggleTheme: () => set(s => ({ dark: !s.dark })), toggleCompact: () => set(s => ({ compact: !s.compact })) }), { name: 'ventilyator-preferences' }));

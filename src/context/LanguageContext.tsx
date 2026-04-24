import React, { createContext, useContext, useState, useCallback } from 'react';
import en from '../i18n/en.json';
import km from '../i18n/km.json';

type Language = 'en' | 'km';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const translations: Record<Language, Record<string, any>> = { en, km };

const getNestedValue = (obj: Record<string, any>, path: string): string | undefined => {
    const keys = path.split('.');
    let current: any = obj;
    for (const key of keys) {
        if (current === undefined || current === null) return undefined;
        current = current[key];
    }
    return typeof current === 'string' ? current : undefined;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState<Language>(() => {
        const saved = localStorage.getItem('pos_language');
        return (saved === 'km' || saved === 'en') ? saved : 'en';
    });

    const setLanguage = useCallback((lang: Language) => {
        setLanguageState(lang);
        localStorage.setItem('pos_language', lang);
    }, []);

    const t = useCallback((key: string): string => {
        // Try current language first, fall back to English
        const value = getNestedValue(translations[language], key);
        if (value !== undefined) return value;

        // Fallback to English
        const fallback = getNestedValue(translations.en, key);
        if (fallback !== undefined) return fallback;

        // Return key itself as last resort
        return key;
    }, [language]);

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = (): LanguageContextType => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};

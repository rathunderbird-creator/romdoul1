import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
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

    // <html lang> follows the language picked, so CSS can adjust for Khmer
    // (e.g. html[lang="km"] menu labels: Khmer has no capitals, so the small
    // uppercase English style reads too small) and screen readers and the
    // browser know the page's language.
    useEffect(() => {
        document.documentElement.lang = language;
    }, [language]);

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

// The translator when a LanguageProvider is above, else undefined (shared
// form fields that also render in the dev previews).
// eslint-disable-next-line react-refresh/only-export-components -- a hook next to its context, like useLanguage below.
export const useOptionalLanguage = (): LanguageContextType | undefined => useContext(LanguageContext);

export const useLanguage = (): LanguageContextType => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};

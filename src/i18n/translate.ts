// Translation outside React components (store alerts, helpers, confirm()
// texts built in plain functions): the same lookup as LanguageContext's t(),
// for the language currently chosen (pos_language). In components, use t()
// from useLanguage() so the text follows a language switch immediately.
//
// fill() puts values into a translated text: fill('Saved {n} orders', { n: 3 }).
import en from './en.json';
import km from './km.json';

type Dict = Record<string, unknown>;
const translations: Record<'en' | 'km', Dict> = { en, km };

const lookup = (obj: Dict, path: string): string | undefined => {
    let cur: unknown = obj;
    for (const k of path.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Dict)[k];
    }
    return typeof cur === 'string' ? cur : undefined;
};

const currentLanguage = (): 'en' | 'km' => {
    try { return localStorage.getItem('pos_language') === 'km' ? 'km' : 'en'; } catch { return 'en'; }
};

export const fill = (text: string, vars?: Record<string, string | number>): string =>
    vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;

// tNow('ui.store.saveFailed') or tNow('ui.store.savedN', { n: 3 }).
export const tNow = (key: string, vars?: Record<string, string | number>): string =>
    fill(lookup(translations[currentLanguage()], key) ?? lookup(translations.en, key) ?? key, vars);

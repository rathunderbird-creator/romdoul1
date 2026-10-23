import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type AppLayout = 'classic' | 'modern';
export type ThemeMode = 'light' | 'dark';
export type SidebarColor = 'default' | 'navy-amber' | 'ocean';

interface ThemeContextType {
    themeColor: string;
    fontSize: number; // in pixels
    layout: AppLayout; // 'classic' = black sidebar, 'modern' = light grouped sidebar
    mode: ThemeMode;   // light or dark color scheme (body.theme-dark)
    sidebarColor: SidebarColor; // 'default' = each layout's own look, 'navy-amber'/'ocean' = a shared scheme on both Classic and Modern
    setThemeColor: (color: string) => void;
    setFontSize: (size: number) => void;
    setLayout: (layout: AppLayout) => void;
    setMode: (mode: ThemeMode) => void;
    setSidebarColor: (color: SidebarColor) => void;
    resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Default Values
const DEFAULT_THEME_COLOR = '#3B82F6'; // Default Blue
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LAYOUT: AppLayout = 'modern';
const DEFAULT_SIDEBAR_COLOR: SidebarColor = 'default';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Initialize State from LocalStorage
    const [themeColor, setThemeColorState] = useState<string>(() => {
        return localStorage.getItem('jbl_pos_theme_color') || DEFAULT_THEME_COLOR;
    });

    const [fontSize, setFontSizeState] = useState<number>(() => {
        const saved = localStorage.getItem('jbl_pos_font_size');
        return saved ? parseInt(saved, 10) : DEFAULT_FONT_SIZE;
    });

    const [layout, setLayoutState] = useState<AppLayout>(() => {
        // Respect an explicit choice either way; anything else gets the default.
        const saved = localStorage.getItem('jbl_pos_layout');
        return saved === 'classic' || saved === 'modern' ? saved : DEFAULT_LAYOUT;
    });

    const [mode, setModeState] = useState<ThemeMode>(() => {
        return localStorage.getItem('jbl_pos_theme_mode') === 'dark' ? 'dark' : 'light';
    });

    const [sidebarColor, setSidebarColorState] = useState<SidebarColor>(() => {
        // Respect an explicit choice either way; anything else gets the default.
        const saved = localStorage.getItem('jbl_pos_sidebar_color');
        return saved === 'default' || saved === 'navy-amber' || saved === 'ocean' ? saved : DEFAULT_SIDEBAR_COLOR;
    });

    // Apply Styles
    useEffect(() => {
        const root = document.documentElement;

        // Update Primary Color
        root.style.setProperty('--color-primary', themeColor);

        // Generate lighter/hover variants simply (could be more sophisticated)
        // For now, we'll keep it simple or use CSS color-mix if supported, 
        // but let's stick to just updating the main one for now and maybe opacity for others if needed.
        // A simple way to get a lighter version without a color library:
        root.style.setProperty('--color-primary-hover', themeColor); // Just use same for now or handle in CSS

        localStorage.setItem('jbl_pos_theme_color', themeColor);
    }, [themeColor]);

    useEffect(() => {
        const root = document.documentElement;
        // Retired mechanism: the whole codebase styles text in absolute px, so
        // changing the rem base never showed anywhere.
        root.style.fontSize = '';

        // Text size drives the app zoom instead — the same "one knob" the
        // compact-UI scale in index.css uses, and the only change that reaches
        // inline-px styles uniformly. 14 is the baseline (desktop 0.88, phone 1);
        // --app-zoom keeps --vh-full/--vw-full compensating correctly.
        const desktop = window.matchMedia('(min-width: 768px)');
        const apply = () => {
            const zoom = (desktop.matches ? 0.88 : 1) * (fontSize / 14);
            document.body.style.setProperty('zoom', String(zoom));
            root.style.setProperty('--app-zoom', String(zoom));
        };
        apply();
        desktop.addEventListener('change', apply);

        localStorage.setItem('jbl_pos_font_size', fontSize.toString());
        return () => desktop.removeEventListener('change', apply);
    }, [fontSize]);

    // The body class lets CSS restyle the chrome (sidebar width, content
    // background) without touching every inline-styled page.
    useEffect(() => {
        document.body.classList.toggle('layout-modern', layout === 'modern');
        localStorage.setItem('jbl_pos_layout', layout);
    }, [layout]);

    // The body class restyles both sidebars' CSS variables (see index.css) —
    // Classic's --classic-sidebar-* and Modern's --modern-sidebar-*.
    useEffect(() => {
        document.body.classList.toggle('sidebar-navy-amber', sidebarColor === 'navy-amber');
        document.body.classList.toggle('sidebar-ocean', sidebarColor === 'ocean');
        localStorage.setItem('jbl_pos_sidebar_color', sidebarColor);
    }, [sidebarColor]);

    const setThemeColor = (color: string) => {
        setThemeColorState(color);
    };

    const setLayout = (next: AppLayout) => {
        setLayoutState(next);
    };

    const setSidebarColor = (next: SidebarColor) => {
        setSidebarColorState(next);
    };

    // Dark scheme: one body class flips the CSS variables (see index.css).
    useEffect(() => {
        document.body.classList.toggle('theme-dark', mode === 'dark');
        localStorage.setItem('jbl_pos_theme_mode', mode);
    }, [mode]);

    const setMode = (next: ThemeMode) => {
        setModeState(next);
    };

    const setFontSize = (size: number) => {
        setFontSizeState(size);
    };

    const resetTheme = () => {
        setThemeColor(DEFAULT_THEME_COLOR);
        setFontSize(DEFAULT_FONT_SIZE);
        setSidebarColor(DEFAULT_SIDEBAR_COLOR);
    };

    return (
        <ThemeContext.Provider value={{
            themeColor,
            fontSize,
            layout,
            mode,
            sidebarColor,
            setThemeColor,
            setFontSize,
            setLayout,
            setMode,
            setSidebarColor,
            resetTheme
        }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};

import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type AppLayout = 'classic' | 'modern';
export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
    themeColor: string;
    fontSize: number; // in pixels
    layout: AppLayout; // 'classic' = black sidebar, 'modern' = light grouped sidebar
    mode: ThemeMode;   // light or dark color scheme (body.theme-dark)
    setThemeColor: (color: string) => void;
    setFontSize: (size: number) => void;
    setLayout: (layout: AppLayout) => void;
    setMode: (mode: ThemeMode) => void;
    resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Default Values
const DEFAULT_THEME_COLOR = '#3B82F6'; // Default Blue
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LAYOUT: AppLayout = 'classic';

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
        return localStorage.getItem('jbl_pos_layout') === 'modern' ? 'modern' : DEFAULT_LAYOUT;
    });

    const [mode, setModeState] = useState<ThemeMode>(() => {
        return localStorage.getItem('jbl_pos_theme_mode') === 'dark' ? 'dark' : 'light';
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
        // Update Base Font Size on Body
        root.style.fontSize = `${fontSize}px`;

        localStorage.setItem('jbl_pos_font_size', fontSize.toString());
    }, [fontSize]);

    // The body class lets CSS restyle the chrome (sidebar width, content
    // background) without touching every inline-styled page.
    useEffect(() => {
        document.body.classList.toggle('layout-modern', layout === 'modern');
        localStorage.setItem('jbl_pos_layout', layout);
    }, [layout]);

    const setThemeColor = (color: string) => {
        setThemeColorState(color);
    };

    const setLayout = (next: AppLayout) => {
        setLayoutState(next);
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
    };

    return (
        <ThemeContext.Provider value={{
            themeColor,
            fontSize,
            layout,
            mode,
            setThemeColor,
            setFontSize,
            setLayout,
            setMode,
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

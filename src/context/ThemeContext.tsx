import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface ThemeContextType {
    themeColor: string;
    fontSize: number; // in pixels
    isDarkMode: boolean;
    setThemeColor: (color: string) => void;
    setFontSize: (size: number) => void;
    toggleTheme: () => void;
    resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Default Values
const DEFAULT_THEME_COLOR = '#3B82F6'; // Default Blue
const DEFAULT_FONT_SIZE = 14;

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Initialize State from LocalStorage
    const [themeColor, setThemeColorState] = useState<string>(() => {
        return localStorage.getItem('jbl_pos_theme_color') || DEFAULT_THEME_COLOR;
    });

    const [fontSize, setFontSizeState] = useState<number>(() => {
        const saved = localStorage.getItem('jbl_pos_font_size');
        return saved ? parseInt(saved, 10) : DEFAULT_FONT_SIZE;
    });

    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
        const saved = localStorage.getItem('jbl_pos_dark_mode');
        return saved === 'true';
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
        // Update Base Font Size on Body (index.css should use this or just set it on body)
        // In index.css, body { font-size: 14px; } is set. We can override it via style attribute on document.body or :root variable.
        // Let's assume we update a variable or the body directly.
        // The index.css uses 14px. Let's try setting it on the body directly or a variable.
        // Ideally we should update the variable if index.css uses one. 
        // Index.css has: font-size: 14px;
        // We will change root style to override.
        root.style.fontSize = `${fontSize}px`;

        localStorage.setItem('jbl_pos_font_size', fontSize.toString());
    }, [fontSize]);

    // Apply Dark Mode
    useEffect(() => {
        const root = document.documentElement;
        if (isDarkMode) {
            root.style.setProperty('--color-bg', '#111827');
            root.style.setProperty('--color-surface', '#1F2937');
            root.style.setProperty('--color-text-main', '#F9FAFB');
            root.style.setProperty('--color-text-secondary', '#9CA3AF');
            root.style.setProperty('--color-border', '#374151');
            root.style.setProperty('--color-surface-hover', '#374151');
            root.style.setProperty('--shadow-sm', '0 1px 2px 0 rgba(0, 0, 0, 0.3)');
        } else {
            root.style.setProperty('--color-bg', '#F3F4F6');
            root.style.setProperty('--color-surface', '#FFFFFF');
            root.style.setProperty('--color-text-main', '#111827');
            root.style.setProperty('--color-text-secondary', '#4B5563');
            root.style.setProperty('--color-border', '#E5E7EB');
            root.style.setProperty('--color-surface-hover', '#F9FAFB');
            root.style.setProperty('--shadow-sm', '0 1px 2px 0 rgba(0, 0, 0, 0.05)');
        }
        localStorage.setItem('jbl_pos_dark_mode', isDarkMode.toString());
    }, [isDarkMode]);

    const setThemeColor = (color: string) => {
        setThemeColorState(color);
    };

    const setFontSize = (size: number) => {
        setFontSizeState(size);
    };

    const toggleTheme = () => {
        setIsDarkMode(prev => !prev);
    };

    const resetTheme = () => {
        setThemeColor(DEFAULT_THEME_COLOR);
        setFontSize(DEFAULT_FONT_SIZE);
        setIsDarkMode(false);
    };

    return (
        <ThemeContext.Provider value={{
            themeColor,
            fontSize,
            isDarkMode,
            setThemeColor,
            setFontSize,
            toggleTheme,
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

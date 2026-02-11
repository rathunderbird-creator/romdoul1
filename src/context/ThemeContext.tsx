import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface ThemeContextType {
    themeColor: string;
    fontSize: number; // in pixels
    setThemeColor: (color: string) => void;
    setFontSize: (size: number) => void;
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

    const setThemeColor = (color: string) => {
        setThemeColorState(color);
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
            setThemeColor,
            setFontSize,
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

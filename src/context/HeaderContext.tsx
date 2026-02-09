import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface HeaderContent {
    title: ReactNode;
    actions?: ReactNode;
}

interface HeaderContextType {
    headerContent: HeaderContent | null;
    setHeaderContent: (content: HeaderContent | null) => void;
}

const HeaderContext = createContext<HeaderContextType | undefined>(undefined);

export const HeaderProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [headerContent, setHeaderContent] = useState<HeaderContent | null>(null);

    return (
        <HeaderContext.Provider value={{ headerContent, setHeaderContent }}>
            {children}
        </HeaderContext.Provider>
    );
};

export const useHeader = () => {
    const context = useContext(HeaderContext);
    if (!context) {
        throw new Error('useHeader must be used within a HeaderProvider');
    }
    return context;
};

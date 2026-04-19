import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ActivityLog {
    id: string;
    action: string;
    description: string;
    user_id: string;
    user_name: string;
    metadata: Record<string, any>;
    created_at: string;
}

interface ActivityLogContextType {
    logs: ActivityLog[];
    unreadCount: number;
    isOpen: boolean;
    isLoading: boolean;
    togglePanel: () => void;
    closePanel: () => void;
    markAllRead: () => void;
    logActivity: (action: string, description: string, userId?: string, userName?: string, metadata?: Record<string, any>) => Promise<void>;
    refreshLogs: () => Promise<void>;
}

const ActivityLogContext = createContext<ActivityLogContextType | null>(null);

export const useActivityLog = () => {
    const ctx = useContext(ActivityLogContext);
    if (!ctx) throw new Error('useActivityLog must be used within ActivityLogProvider');
    return ctx;
};

export const ActivityLogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [lastReadAt, setLastReadAt] = useState<string>(() => {
        return localStorage.getItem('activity_log_last_read') || new Date(0).toISOString();
    });

    const fetchLogs = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) {
                console.error('Failed to fetch activity logs:', error);
                return;
            }

            const fetched = (data || []) as ActivityLog[];
            setLogs(fetched);

            // Count unread
            const unread = fetched.filter(l => l.created_at > lastReadAt).length;
            setUnreadCount(unread);
        } catch (err) {
            console.error('Activity log fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [lastReadAt]);

    useEffect(() => {
        fetchLogs();
        // Poll every 60s for new logs
        const interval = setInterval(fetchLogs, 60000);
        return () => clearInterval(interval);
    }, [fetchLogs]);

    // Listen for activity-log events dispatched from StoreContext (or anywhere)
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail) {
                logActivity(detail.action, detail.description, detail.userId, detail.userName, detail.metadata);
            }
        };
        window.addEventListener('activity-log', handler);
        return () => window.removeEventListener('activity-log', handler);
    }, []);

    const logActivity = async (
        action: string,
        description: string,
        userId?: string,
        userName?: string,
        metadata?: Record<string, any>
    ) => {
        const newLog = {
            action,
            description,
            user_id: userId || 'system',
            user_name: userName || 'System',
            metadata: metadata || {},
        };

        // Fire and forget - don't block UI
        supabase.from('activity_logs').insert(newLog).then(({ error }) => {
            if (error) {
                console.error('Failed to log activity:', error);
            } else {
                // Add to local state immediately
                setLogs(prev => [{
                    ...newLog,
                    id: Date.now().toString(),
                    created_at: new Date().toISOString()
                }, ...prev].slice(0, 50));
                setUnreadCount(prev => prev + 1);
            }
        });
    };

    const togglePanel = () => setIsOpen(prev => !prev);
    const closePanel = () => setIsOpen(false);

    const markAllRead = () => {
        const now = new Date().toISOString();
        setLastReadAt(now);
        localStorage.setItem('activity_log_last_read', now);
        setUnreadCount(0);
    };

    const refreshLogs = fetchLogs;

    return (
        <ActivityLogContext.Provider value={{
            logs, unreadCount, isOpen, isLoading,
            togglePanel, closePanel, markAllRead, logActivity, refreshLogs
        }}>
            {children}
        </ActivityLogContext.Provider>
    );
};

// Utility to dispatch activity log events from anywhere (including StoreContext)
// ActivityLogContext listens for these events and persists them

export interface ActivityEvent {
    action: string;
    description: string;
    userId?: string;
    userName?: string;
    metadata?: Record<string, any>;
}

export const dispatchActivity = (event: ActivityEvent) => {
    window.dispatchEvent(new CustomEvent('activity-log', { detail: event }));
};

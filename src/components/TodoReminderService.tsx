import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import {
    toLocalDateStr,
    nowHHMM,
    isReminderDue,
    claimReminder,
    sendTelegramReminder,
    type ReminderTodo,
} from '../utils/todoReminders';

const POLL_INTERVAL_MS = 60_000;

/**
 * Headless. Mounted once at app level so task reminders fire on every page, not only
 * while the Todo page happens to be open — an 08:00 reminder is no use if staff are
 * on the Orders screen at 08:00.
 *
 * Telegram is the primary channel (it reaches phones); the in-app toast and desktop
 * notification are secondary and only reach whoever is at the machine.
 *
 * Scope: this still requires the POS to be open *somewhere*. A reminder whose time
 * passes while every client is closed fires late, on next open, rather than never.
 * Reminders that must arrive with the app shut need server-side scheduling
 * (Supabase Edge Function + pg_cron).
 */
const TodoReminderService: React.FC = () => {
    const { showToast } = useToast();
    // Keep the latest toast fn without making it a dependency of the interval, so the
    // poll timer isn't torn down and recreated on unrelated re-renders.
    const toastRef = useRef(showToast);
    useEffect(() => {
        toastRef.current = showToast;
    }, [showToast]);

    useEffect(() => {
        let cancelled = false;

        const checkReminders = async () => {
            const today = toLocalDateStr(new Date());
            const time = nowHHMM();

            const { data, error } = await supabase
                .from('todos')
                .select('id, title, due_date, remind_at, last_reminded_on')
                .eq('status', 'open')
                .not('remind_at', 'is', null);

            if (error) {
                console.error('Reminder poll failed:', error.message);
                return;
            }

            for (const todo of (data || []) as ReminderTodo[]) {
                if (cancelled) return;
                if (!isReminderDue(todo, today, time)) continue;

                // Claim before sending: whichever client wins the write sends, so a
                // shop running the POS on several machines gets one message, not five.
                if (!(await claimReminder(todo.id, today))) continue;

                const delivered = await sendTelegramReminder(todo.title, todo.due_date);

                toastRef.current(`⏰ ${todo.title}`, delivered ? 'success' : 'error');
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification(todo.title, {
                        body: todo.due_date ? `Due ${todo.due_date}` : 'Task reminder',
                        tag: `todo-${todo.id}`,
                    });
                }
                if (!delivered) {
                    console.warn(
                        'Task reminder not sent to Telegram: no notification config whose name contains "todo". ' +
                        'Add one under Settings → Telegram.'
                    );
                }
            }
        };

        void checkReminders();
        const timer = setInterval(() => void checkReminders(), POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    return null;
};

export default TodoReminderService;

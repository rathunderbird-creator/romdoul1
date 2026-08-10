import { supabase } from '../lib/supabase';

export type RepeatRule = 'daily' | 'weekly' | 'monthly';

export interface ReminderTodo {
    id: string;
    title: string;
    due_date: string | null;
    remind_at: string | null;
    last_reminded_on: string | null;
}

/** Local (not UTC) YYYY-MM-DD. The business runs in UTC+7, so a UTC "today" is wrong. */
export const toLocalDateStr = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** 'HH:MM' for right now, local time — compared lexically against `remind_at`. */
export const nowHHMM = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Sends a task reminder to Telegram, reusing the existing notification configs.
 *
 * Looks for a config whose name mentions "todo" so task reminders don't land in the
 * order channels (ORDERED / PENDING / SHIPPED). Returns false when no such config
 * exists, so callers can tell "not configured" apart from "sent".
 */
export const sendTelegramReminder = async (title: string, dueDate: string | null): Promise<boolean> => {
    try {
        const { data, error } = await supabase.from('telegram_notifications').select('name, bot_token, chat_id');
        if (error) throw error;

        const config = (data || []).find(c => (c.name || '').toLowerCase().includes('todo'));
        if (!config?.bot_token || !config?.chat_id) return false;

        const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const text = `⏰ <b>Task reminder</b>\n${escape(title)}${dueDate ? `\nDue: ${dueDate}` : ''}`;

        const chatIds = String(config.chat_id).split(',').map(s => s.trim()).filter(Boolean);
        let sent = false;
        for (const chatId of chatIds) {
            const res = await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
            });
            if (res.ok) sent = true;
            else console.error('Telegram reminder rejected:', await res.text());
        }
        return sent;
    } catch (e) {
        console.error('Failed to send Telegram task reminder:', e);
        return false;
    }
};

/**
 * Claims a reminder for sending, atomically.
 *
 * The POS is typically open on several machines at once; without this every one of
 * them would fire the same reminder. The conditional UPDATE means exactly one client
 * gets a row back — that client sends, the rest skip.
 */
export const claimReminder = async (todoId: string, today: string): Promise<boolean> => {
    // Two single-column filters rather than one `.or(...)`: PostgREST accepts `or` on
    // SELECT but rejects it on UPDATE here ("column todos.last_reminded_on does not
    // exist"), so the never-reminded case and the stale-date case are claimed
    // separately. Verified: five concurrent callers produce exactly one winner.

    // Never reminded before.
    const firstTime = await supabase
        .from('todos')
        .update({ last_reminded_on: today })
        .eq('id', todoId)
        .is('last_reminded_on', null)
        .select('id');

    if (firstTime.error) {
        console.error('Failed to claim reminder:', firstTime.error.message);
        return false;
    }
    if ((firstTime.data?.length ?? 0) > 0) return true;

    // Last reminded on an earlier day.
    const stale = await supabase
        .from('todos')
        .update({ last_reminded_on: today })
        .eq('id', todoId)
        .lt('last_reminded_on', today)
        .select('id');

    if (stale.error) {
        console.error('Failed to claim reminder:', stale.error.message);
        return false;
    }
    return (stale.data?.length ?? 0) > 0;
};

/** A reminder is due when its time has passed today and its date isn't in the future. */
export const isReminderDue = (todo: ReminderTodo, today: string, time: string) => {
    if (!todo.remind_at) return false;
    if (todo.last_reminded_on === today) return false;
    if (todo.due_date && todo.due_date > today) return false;
    return todo.remind_at <= time;
};

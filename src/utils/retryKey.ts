// Ids for saves that may be retried after a lost reply. When the network
// drops after the database saved something, the app sees an error although
// the save went through; trying again must not save it twice. So a save
// takes its row id from here: a failed call keeps its id, an identical call
// shortly after (the retry) gets the same one, and the database function
// then reports the earlier save instead of repeating it. A call that worked
// lets its id go, so the next identical save is a new one.
const RETRY_WINDOW_MS = 10 * 60 * 1000;

const newId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
};

export function createRetryKeys() {
    const pending = new Map<string, { ids: string[]; at: number }>();
    return {
        // `count` ids for the call described by `signature` (the same ids as
        // a failed identical call made within the retry window).
        take(signature: string, count = 1): string[] {
            const now = Date.now();
            for (const [k, v] of pending) if (now - v.at > RETRY_WINDOW_MS) pending.delete(k);
            const held = pending.get(signature);
            if (held && held.ids.length === count) {
                held.at = now;
                return held.ids;
            }
            const ids = Array.from({ length: count }, newId);
            pending.set(signature, { ids, at: now });
            return ids;
        },
        // The call worked (or was reported as already saved): its ids are spent.
        release(signature: string) {
            pending.delete(signature);
        },
    };
}

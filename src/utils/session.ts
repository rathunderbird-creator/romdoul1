// SEC-1: the stored session (user id + the token minted by login_with_pin)
// that guarded database functions re-verify server-side. StoreContext owns
// the login lifecycle and mirrors it here (setSessionAuth) so plain utils
// can attach the session to RPC calls without importing React context.
//
// localStorage is the source of truth across reloads (same keys StoreContext
// writes); the in-memory copy covers kiosk browsers whose storage is full or
// blocked (localStorage.setItem throws at login time).

const SESSION_TOKEN_KEY = 'pos_session_token_v1';

let inMemoryUserId: string | null = null;
let inMemoryToken: string | null = null;

// StoreContext calls this on login (with the minted token), and with nulls
// on logout / a failed session re-verification.
export const setSessionAuth = (userId: string | null, token: string | null): void => {
    inMemoryUserId = userId;
    inMemoryToken = token;
};

export interface SessionArg {
    user_id: string;
    token: string;
}

// The p_session argument for guarded database functions, or null when this
// terminal holds no server-minted session (not logged in, or the store had
// not run add_auth_guards.sql at login time). The database accepts null
// while session enforcement is off, so a null here never blocks a save.
export const getSessionArg = (): SessionArg | null => {
    let userId: string | null = null;
    let token: string | null = null;
    try {
        const saved = localStorage.getItem('currentUser');
        if (saved) userId = (JSON.parse(saved) as { id?: string })?.id || null;
    } catch { /* corrupt or blocked storage — fall back to memory */ }
    try {
        token = localStorage.getItem(SESSION_TOKEN_KEY);
    } catch { /* blocked storage — fall back to memory */ }
    if (!userId) userId = inMemoryUserId;
    if (!token) token = inMemoryToken;
    return userId && token ? { user_id: userId, token } : null;
};

// Matches the exact refusal sg_check raises ('Your session has expired —
// log in again.'): this terminal's token is gone from users.session_tokens
// (revoked, or rotated out by 8 newer logins), so the only fix is a fresh
// login. StoreContext registers the handler that forces the logout.
export const isSessionExpiredError = (message: unknown): boolean =>
    /session has expired/i.test(String(message || ''));

let onSessionExpired: ((message: string) => void) | null = null;

export const registerSessionExpiredHandler = (handler: ((message: string) => void) | null): void => {
    onSessionExpired = handler;
};

export const notifySessionExpired = (message: string): void => {
    if (onSessionExpired) onSessionExpired(message);
};

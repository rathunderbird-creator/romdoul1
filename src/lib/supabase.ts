
import { createClient } from '@supabase/supabase-js';

// Access environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Missing Supabase Environment Variables. Real-time data will not work.');
}

// On an unstable connection a request can black-hole: no response, no error,
// so loading bars spin forever with nothing to retry. Cap every API request
// at 60s — generous enough for a 1000-row chunk on a slow link — so a stall
// surfaces as an error the pages' existing retry/error UI can handle.
const REQUEST_TIMEOUT_MS = 60_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const callerSignal = init?.signal;
    // Keep a caller-supplied abort signal working (query.abortSignal(...)):
    // race it against the timeout where AbortSignal.any exists (Chrome 116+ /
    // Electron ≥ 27); on anything older the caller's signal wins unchanged.
    const signal = callerSignal
        ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([callerSignal, timeout]) : callerSignal)
        : timeout;
    return fetch(input, { ...init, signal });
};

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
    global: { fetch: fetchWithTimeout },
});

// Dev previews only: refuse every database write.
//
// Preview pages run against the live database with the anon key and no
// login, and some tables (custom_locations among them) have no RLS, so a Save
// / Shutdown / Delete pressed in a preview would change real rows. Import this
// module FIRST in a preview entry: it wraps window.fetch so any request to
// the Supabase URL other than GET / HEAD / OPTIONS (insert, update, upsert,
// delete, rpc, storage upload, ...) is answered locally with a 403 and never
// leaves the browser. Reads keep working.
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const realFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (supabaseUrl && url.startsWith(supabaseUrl) && !READ_METHODS.has(method)) {
        console.warn('[preview] database write blocked:', method, url);
        const body = JSON.stringify({ code: 'PREVIEW', message: 'Dev preview: database writes are blocked.', details: null, hint: null });
        return Promise.resolve(new Response(body, { status: 403, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
};

export {};

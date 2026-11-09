// Runs one call per key at a time: an identical call made while the first is
// still running gets the first call's promise instead of starting a second run.
export function createInFlightGuard() {
    const running = new Map<string, Promise<unknown>>();
    return <T>(key: string, run: () => Promise<T>): Promise<T> => {
        const existing = running.get(key);
        if (existing) return existing as Promise<T>;
        const started = run().finally(() => running.delete(key));
        running.set(key, started);
        return started;
    };
}

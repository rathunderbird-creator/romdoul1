// Vite Polyfills for MapLibre and other Node-dependent libraries
if (typeof window !== 'undefined') {
    (window as any).global = window;
}

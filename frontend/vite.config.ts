import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            // Single-CP backend (existing).
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
            // Fleet manager — REST under /fleet/<thing> and WS at /fleet/ws.
            // The regex is required so the bare `/fleet` page itself is
            // served by Vite (the SPA route), not proxied to the manager
            // which would 404 since it has no HTML at that path.
            '^/fleet/.+': {
                target: 'http://localhost:3100',
                changeOrigin: true,
                ws: true,
            },
        },
        // The SPA needs a fallback so `/fleet` (and any future
        // sub-routes) serve index.html. Vite's `historyApiFallback`
        // is on by default for `/`, but only resolves to index.html
        // for paths that don't have an extension; that fits us.
    },
})

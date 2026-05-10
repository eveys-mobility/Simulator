import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        // CSMS tests open real WebSocket servers. They're fast (~50ms
        // each) but timing-sensitive — fail loudly rather than retry.
        testTimeout: 10_000,
    },
});

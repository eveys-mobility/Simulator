// Dev-mode worker entry. The supervisor spawns this `.cjs` file from
// the worker_threads API; node loads it natively without any loader
// hooks (which is fine, it's plain CommonJS). We then register
// tsx/cjs synchronously, after which `require('./worker.ts')`
// transparently transpiles + loads the TypeScript worker module.
//
// Production (post-`npm run build`) replaces this with a direct path
// to `dist/fleet/src/worker.js`; the supervisor picks the right one
// based on whether `__filename` ends in `.ts`.
require('tsx/cjs');
require('./worker.ts');

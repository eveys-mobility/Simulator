export { runConformanceCase, runConformanceSuite } from './runner.js';
export type { ConformanceCase, ConformanceContext, CaseResult, SuiteResult } from './runner.js';
export { CORE_CASES } from './cases/core.js';
export { SMART_CHARGING_CASES } from './cases/smart-charging.js';
export { REMOTE_TRIGGER_CASES } from './cases/remote-trigger.js';

import { CORE_CASES } from './cases/core.js';
import { REMOTE_TRIGGER_CASES } from './cases/remote-trigger.js';
import { SMART_CHARGING_CASES } from './cases/smart-charging.js';

/** Every bundled conformance case across every profile, in profile
 *  order (Core → SmartCharging → RemoteTrigger). REST endpoints,
 *  the SPA, and CI gates all use this so adding a new profile's
 *  cases is a one-import change. */
export const ALL_CASES = [...CORE_CASES, ...SMART_CHARGING_CASES, ...REMOTE_TRIGGER_CASES];

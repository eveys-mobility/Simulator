export { runConformanceCase, runConformanceSuite } from './runner.js';
export type { ConformanceCase, ConformanceContext, CaseResult, SuiteResult } from './runner.js';
export { CORE_CASES } from './cases/core.js';
export { CONCURRENT_TX_CASES } from './cases/concurrent-tx.js';
export { SMART_CHARGING_CASES } from './cases/smart-charging.js';
export { REMOTE_TRIGGER_CASES } from './cases/remote-trigger.js';
export { RESERVATION_CASES } from './cases/reservation.js';
export { LOCAL_AUTH_LIST_CASES } from './cases/local-auth-list.js';
export { FIRMWARE_MANAGEMENT_CASES } from './cases/firmware-management.js';
export { NEGATIVE_CASES } from './cases/negatives.js';

import { CONCURRENT_TX_CASES } from './cases/concurrent-tx.js';
import { CORE_CASES } from './cases/core.js';
import { FIRMWARE_MANAGEMENT_CASES } from './cases/firmware-management.js';
import { LOCAL_AUTH_LIST_CASES } from './cases/local-auth-list.js';
import { NEGATIVE_CASES } from './cases/negatives.js';
import { REMOTE_TRIGGER_CASES } from './cases/remote-trigger.js';
import { RESERVATION_CASES } from './cases/reservation.js';
import { SMART_CHARGING_CASES } from './cases/smart-charging.js';

/** Every bundled conformance case across every profile. REST
 *  endpoints, the SPA, and CI gates all use this so adding a new
 *  profile's cases is a one-import change. Negatives and ConcurrentTx
 *  cases are tagged with their target profile so the SPA still
 *  groups them into the same profile section as the positives. */
export const ALL_CASES = [
    ...CORE_CASES,
    ...CONCURRENT_TX_CASES,
    ...SMART_CHARGING_CASES,
    ...REMOTE_TRIGGER_CASES,
    ...RESERVATION_CASES,
    ...LOCAL_AUTH_LIST_CASES,
    ...FIRMWARE_MANAGEMENT_CASES,
    ...NEGATIVE_CASES,
];

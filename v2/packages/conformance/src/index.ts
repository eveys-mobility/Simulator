export { runConformanceCase, runConformanceSuite } from './runner.js';
export type { ConformanceCase, ConformanceContext, CaseResult, SuiteResult } from './runner.js';
export { CORE_CASES } from './cases/core.js';
export { SMART_CHARGING_CASES } from './cases/smart-charging.js';
export { REMOTE_TRIGGER_CASES } from './cases/remote-trigger.js';
export { RESERVATION_CASES } from './cases/reservation.js';
export { LOCAL_AUTH_LIST_CASES } from './cases/local-auth-list.js';
export { FIRMWARE_MANAGEMENT_CASES } from './cases/firmware-management.js';

import { CORE_CASES } from './cases/core.js';
import { FIRMWARE_MANAGEMENT_CASES } from './cases/firmware-management.js';
import { LOCAL_AUTH_LIST_CASES } from './cases/local-auth-list.js';
import { REMOTE_TRIGGER_CASES } from './cases/remote-trigger.js';
import { RESERVATION_CASES } from './cases/reservation.js';
import { SMART_CHARGING_CASES } from './cases/smart-charging.js';

/** Every bundled conformance case across every profile. REST
 *  endpoints, the SPA, and CI gates all use this so adding a new
 *  profile's cases is a one-import change. Order: built features
 *  first (Core → SmartCharging → RemoteTrigger), then the not-built
 *  ones (Reservation → LocalAuthListManagement → FirmwareManagement)
 *  so the SPA renders the green sections at the top. */
export const ALL_CASES = [
    ...CORE_CASES,
    ...SMART_CHARGING_CASES,
    ...REMOTE_TRIGGER_CASES,
    ...RESERVATION_CASES,
    ...LOCAL_AUTH_LIST_CASES,
    ...FIRMWARE_MANAGEMENT_CASES,
];

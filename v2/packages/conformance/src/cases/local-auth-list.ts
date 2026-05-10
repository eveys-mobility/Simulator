import type { ConformanceCase } from '../runner.js';

/**
 * OCPP 1.6 LocalAuthListManagement profile.
 *
 * The simulator advertises the profile in `SupportedFeatureProfiles`
 * but doesn't actually implement the local authorization list yet.
 * `SendLocalList` and `GetLocalListVersion` fall through to the
 * default arm and return CALLERROR `NotImplemented` — which is
 * spec-correct (§1.4), and what these cases assert.
 *
 * `ClearCache` *does* respond Accepted today; that's covered as a
 * positive case to surface that the cache surface is wired even if
 * the list isn't yet.
 */
export const LOCAL_AUTH_LIST_CASES: ConformanceCase[] = [
    {
        id: 'local-auth.send-local-list-not-implemented',
        title: 'SendLocalList returns NotImplemented (list not modelled)',
        profile: 'LocalAuthListManagement',
        unimplemented: 'LocalAuthList not built yet — simulator answers NotImplemented per §1.4',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            try {
                await handle.rawCall('SendLocalList', {
                    listVersion: 1,
                    updateType: 'Full',
                    localAuthorizationList: [
                        { idTag: 'TAG', idTagInfo: { status: 'Accepted' } },
                    ],
                });
                throw new Error('expected NotImplemented CALLERROR, got CALLRESULT');
            } catch (err) {
                const m = err instanceof Error ? err.message : String(err);
                if (!m.startsWith('NotImplemented:')) {
                    throw new Error(`expected "NotImplemented: ..." error, got "${m}"`);
                }
            }
        },
    },

    {
        id: 'local-auth.get-local-list-version-not-implemented',
        title: 'GetLocalListVersion returns NotImplemented (list not modelled)',
        profile: 'LocalAuthListManagement',
        unimplemented: 'LocalAuthList not built yet — simulator answers NotImplemented per §1.4',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            try {
                await handle.rawCall('GetLocalListVersion', {});
                throw new Error('expected NotImplemented CALLERROR, got CALLRESULT');
            } catch (err) {
                const m = err instanceof Error ? err.message : String(err);
                if (!m.startsWith('NotImplemented:')) {
                    throw new Error(`expected "NotImplemented: ..." error, got "${m}"`);
                }
            }
        },
    },

    {
        id: 'local-auth.clear-cache-accepted',
        title: 'ClearCache returns Accepted (the cache surface is wired)',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = (await handle.rawCall('ClearCache', {})) as { status: string };
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
        },
    },
];

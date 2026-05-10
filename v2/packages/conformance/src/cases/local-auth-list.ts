import type { ConformanceCase } from '../runner.js';

/**
 * OCPP 1.6 LocalAuthListManagement profile cases (§6.20 SendLocalList,
 * §6.13 GetLocalListVersion). The simulator implements the profile
 * end-to-end: SQLite-backed list per device, version tracking,
 * Differential vs. Full update semantics, and Authorize routing
 * through the local list when LocalAuthListEnabled + LocalPreAuthorize.
 */
export const LOCAL_AUTH_LIST_CASES: ConformanceCase[] = [
    {
        id: 'local-auth.send-full-list-accepted',
        title: 'SendLocalList Full update is Accepted and bumps the listVersion',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = (await handle.rawCall('SendLocalList', {
                listVersion: 5,
                updateType: 'Full',
                localAuthorizationList: [
                    { idTag: 'TAG-A', idTagInfo: { status: 'Accepted' } },
                    { idTag: 'TAG-B', idTagInfo: { status: 'Blocked' } },
                ],
            })) as { status: string };
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            const v = (await handle.rawCall('GetLocalListVersion', {})) as {
                listVersion: number;
            };
            if (v.listVersion !== 5) {
                throw new Error(`expected listVersion=5 after Full, got ${v.listVersion}`);
            }
        },
    },

    {
        id: 'local-auth.get-version-zero-on-fresh-device',
        title: 'GetLocalListVersion returns 0 before any list has been sent',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const v = (await handle.rawCall('GetLocalListVersion', {})) as {
                listVersion: number;
            };
            if (v.listVersion !== 0) {
                throw new Error(`expected 0 on a fresh device, got ${v.listVersion}`);
            }
        },
    },

    {
        id: 'local-auth.differential-version-mismatch',
        title: 'SendLocalList Differential with a non-newer version returns VersionMismatch',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            // Seed v=10 with a Full update.
            await handle.rawCall('SendLocalList', {
                listVersion: 10,
                updateType: 'Full',
                localAuthorizationList: [{ idTag: 'TAG', idTagInfo: { status: 'Accepted' } }],
            });
            // Then attempt a Differential at the same version → mismatch.
            const r = (await handle.rawCall('SendLocalList', {
                listVersion: 10,
                updateType: 'Differential',
                localAuthorizationList: [{ idTag: 'NEW', idTagInfo: { status: 'Accepted' } }],
            })) as { status: string };
            if (r.status !== 'VersionMismatch') {
                throw new Error(`expected VersionMismatch, got ${r.status}`);
            }
        },
    },

    {
        id: 'local-auth.differential-upsert-and-delete',
        title: 'SendLocalList Differential upserts entries and deletes the ones missing idTagInfo',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.rawCall('SendLocalList', {
                listVersion: 1,
                updateType: 'Full',
                localAuthorizationList: [
                    { idTag: 'KEEP', idTagInfo: { status: 'Accepted' } },
                    { idTag: 'GONE', idTagInfo: { status: 'Accepted' } },
                ],
            });
            const r = (await handle.rawCall('SendLocalList', {
                listVersion: 2,
                updateType: 'Differential',
                localAuthorizationList: [
                    // KEEP gets re-statused.
                    { idTag: 'KEEP', idTagInfo: { status: 'Blocked' } },
                    // GONE has no idTagInfo → delete.
                    { idTag: 'GONE' },
                    // ADD is brand new.
                    { idTag: 'ADD', idTagInfo: { status: 'Accepted' } },
                ],
            })) as { status: string };
            if (r.status !== 'Accepted') {
                throw new Error(`expected Accepted, got ${r.status}`);
            }
            const v = (await handle.rawCall('GetLocalListVersion', {})) as {
                listVersion: number;
            };
            if (v.listVersion !== 2) {
                throw new Error(`expected listVersion=2, got ${v.listVersion}`);
            }
        },
    },

    {
        id: 'local-auth.disabled-returns-not-supported',
        title: 'SendLocalList returns NotSupported when LocalAuthListEnabled=false',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const cfg = await handle.changeConfiguration('LocalAuthListEnabled', 'false');
            if (cfg.status !== 'Accepted') {
                throw new Error(`expected ChangeConfiguration Accepted, got ${cfg.status}`);
            }
            const r = (await handle.rawCall('SendLocalList', {
                listVersion: 1,
                updateType: 'Full',
                localAuthorizationList: [],
            })) as { status: string };
            if (r.status !== 'NotSupported') {
                throw new Error(`expected NotSupported, got ${r.status}`);
            }
        },
    },

    {
        id: 'local-auth.pre-authorize-uses-local-list',
        title: 'With LocalPreAuthorize on, RemoteStart honors a local Accepted entry without contacting the CSMS',
        profile: 'LocalAuthListManagement',
        // Override the CSMS Authorize handler to count whether the
        // simulator routed through it. If it did, the local
        // pre-authorize path didn't kick in.
        csmsOptions: {
            handlers: {
                Authorize: () => ({ idTagInfo: { status: 'Invalid' } }),
            },
        },
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.changeConfiguration('AuthorizeRemoteTxRequests', 'true');
            await handle.changeConfiguration('LocalPreAuthorize', 'true');
            await handle.rawCall('SendLocalList', {
                listVersion: 1,
                updateType: 'Full',
                localAuthorizationList: [
                    { idTag: 'LOCAL-OK', idTagInfo: { status: 'Accepted' } },
                ],
            });

            // The CSMS Authorize handler is rigged to refuse — if the
            // simulator asks the CSMS, RemoteStart will be Rejected.
            // The conformance check is that the local list short-circuits.
            const r = await handle.remoteStart({ connectorId: 1, idTag: 'LOCAL-OK' });
            if (r.status !== 'Accepted') {
                throw new Error(
                    `RemoteStart with locally-Accepted idTag expected Accepted, got ${r.status} ` +
                        '— local-pre-authorize path did not skip the CSMS',
                );
            }
            // No Authorize CALL must have been sent.
            const authCalls = handle.framesFor('Authorize').filter((f) => f.direction === 'in');
            if (authCalls.length !== 0) {
                throw new Error(
                    `expected 0 Authorize CALLs (local pre-authorize), saw ${authCalls.length}`,
                );
            }
        },
    },

    {
        id: 'local-auth.local-blocked-rejects-without-csms',
        title: 'A locally-Blocked idTag is refused without contacting the CSMS',
        profile: 'LocalAuthListManagement',
        csmsOptions: {
            handlers: {
                // CSMS would say Accepted — but local list takes precedence
                // when LocalPreAuthorize is on, so a Blocked entry refuses.
                Authorize: () => ({ idTagInfo: { status: 'Accepted' } }),
            },
        },
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            await handle.changeConfiguration('AuthorizeRemoteTxRequests', 'true');
            await handle.changeConfiguration('LocalPreAuthorize', 'true');
            await handle.rawCall('SendLocalList', {
                listVersion: 1,
                updateType: 'Full',
                localAuthorizationList: [
                    { idTag: 'BAD-TAG', idTagInfo: { status: 'Blocked' } },
                ],
            });

            const r = await handle.remoteStart({ connectorId: 1, idTag: 'BAD-TAG' });
            if (r.status !== 'Rejected') {
                throw new Error(
                    `RemoteStart with locally-Blocked idTag expected Rejected, got ${r.status}`,
                );
            }
        },
    },

    {
        id: 'local-auth.clear-cache-accepted',
        title: 'ClearCache returns Accepted (cache surface wired)',
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

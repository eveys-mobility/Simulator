import type { ConformanceCase } from '../runner.js';

/**
 * Negative / failure-injection conformance cases. Spec-correct
 * behaviour matters most when the CSMS sends something *wrong* —
 * the CP must signal the right rejection rather than silently
 * accept or hang. These cases confirm the simulator does that
 * across the profiles whose handlers do real validation today.
 *
 * Cases covering the *spec-correct rejection* of unsupported
 * features (ReserveNow before §6.18 was implemented, etc.) are
 * not here — they were a transitional artefact and got removed
 * once the feature shipped.
 */
export const NEGATIVE_CASES: ConformanceCase[] = [
    {
        id: 'neg.smart.set-profile-on-missing-connector-rejected',
        title: 'SetChargingProfile TxDefaultProfile on a non-existent connector → Rejected',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.setChargingProfile(99, {
                chargingProfileId: 1,
                stackLevel: 0,
                chargingProfilePurpose: 'TxDefaultProfile',
                chargingProfileKind: 'Absolute',
                chargingSchedule: {
                    startSchedule: new Date().toISOString(),
                    chargingRateUnit: 'W',
                    chargingSchedulePeriod: [{ startPeriod: 0, limit: 7000 }],
                },
            });
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected on missing connector, got ${r.status}`);
            }
        },
    },

    {
        id: 'neg.smart.set-profile-malformed-rejected',
        title: 'SetChargingProfile with a malformed body → Rejected',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            // Send a payload that fails zod parsing — the simulator
            // should answer Rejected rather than crash or accept.
            const r = (await handle.rawCall('SetChargingProfile', {
                connectorId: 0,
                csChargingProfiles: { totally: 'not a profile' },
            })) as { status: string };
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected on malformed body, got ${r.status}`);
            }
        },
    },

    {
        id: 'neg.smart.get-composite-on-missing-connector-rejected',
        title: 'GetCompositeSchedule on a non-existent connector → Rejected',
        profile: 'SmartCharging',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = await handle.getCompositeSchedule({
                connectorId: 99,
                duration: 60,
                chargingRateUnit: 'W',
            });
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected on missing connector, got ${r.status}`);
            }
        },
    },

    {
        id: 'neg.local-auth.send-list-over-max-length-failed',
        title: 'SendLocalList exceeding LocalAuthListMaxLength → Failed',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            // LocalAuthListMaxLength is a read-only capability the CP
            // declares (default 1000). Build a 1001-entry list to
            // exceed it without trying to mutate the spec value.
            const list = Array.from({ length: 1001 }, (_, i) => ({
                idTag: `TAG-${i}`,
                idTagInfo: { status: 'Accepted' as const },
            }));
            const r = (await handle.rawCall('SendLocalList', {
                listVersion: 1,
                updateType: 'Full',
                localAuthorizationList: list,
            })) as { status: string };
            if (r.status !== 'Failed') {
                throw new Error(`expected Failed on over-max list, got ${r.status}`);
            }
        },
    },

    {
        id: 'neg.local-auth.send-list-malformed-failed',
        title: 'SendLocalList with a malformed body → Failed',
        profile: 'LocalAuthListManagement',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = (await handle.rawCall('SendLocalList', {
                // listVersion missing, list has the wrong shape
                updateType: 'Full',
                localAuthorizationList: [{ notAnIdTag: true }],
            })) as { status: string };
            if (r.status !== 'Failed') {
                throw new Error(`expected Failed on malformed body, got ${r.status}`);
            }
        },
    },

    {
        id: 'neg.core.remote-start-empty-id-tag-rejected',
        title: 'RemoteStart with an empty idTag → Rejected',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            await handle.waitForStatus('Available', 1);
            // The typed helper requires a non-empty string; bypass via
            // rawCall to send the empty value over the wire.
            const r = (await handle.rawCall('RemoteStartTransaction', {
                connectorId: 1,
                idTag: '',
            })) as { status: string };
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected on empty idTag, got ${r.status}`);
            }
        },
    },

    {
        id: 'neg.core.change-availability-bad-type-rejected',
        title: 'ChangeAvailability with an unknown type → Rejected',
        profile: 'Core',
        run: async ({ handle }) => {
            await handle.waitForBoot();
            const r = (await handle.rawCall('ChangeAvailability', {
                connectorId: 1,
                type: 'Sideways', // not Operative / Inoperative
            })) as { status: string };
            if (r.status !== 'Rejected') {
                throw new Error(`expected Rejected on bad type, got ${r.status}`);
            }
        },
    },
];

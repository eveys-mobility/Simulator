import type { AcWiring, DCBatteryProfile, PhaseMode } from '../domain.js';
import { computePhaseFrame } from './ac-phase.js';
import { computeDCFrame, type DCFrame } from './dc-soc.js';

/**
 * OCPP 1.6 §8.2 sampledValue. We keep the wire shape verbatim so it
 * encodes straight into the MeterValues CALL — no remap needed.
 *
 * `phase` is omitted for totals. For per-line-to-neutral readings it's
 * "L1" / "L2" / "L3"; for line-to-line it's "L1-L2" / "L2-L3" / "L3-L1".
 */
export interface SampledValue {
    value: string;
    measurand?: string;
    phase?: string;
    unit?: string;
    location?: 'Cable' | 'EV' | 'Inlet' | 'Outlet' | 'Body';
    context?: 'Sample.Periodic' | 'Sample.Clock' | 'Transaction.Begin' | 'Transaction.End';
}

const DEFAULT_FREQUENCY_HZ = 50;
const DEFAULT_OUTLET_LOCATION: SampledValue['location'] = 'Outlet';

/**
 * AC measurands for one tick. Splits the total power across phases per
 * `phaseMode`, pairs each phase's current with the configured nominal
 * voltage. Optionally adds line-to-line voltage entries.
 *
 * Total entries (no `phase` field): Energy.Active.Import.Register (Wh),
 * Power.Active.Import (W), Frequency (Hz).
 *
 * The result is filtered against the requested measurand set by the
 * caller — this function emits the full menu.
 */
export function computeAcMeasurands(args: {
    totalPowerKw: number;
    energyWh: number;
    phaseMode: PhaseMode;
    wiring: AcWiring;
}): SampledValue[] {
    const { totalPowerKw, energyWh, phaseMode, wiring } = args;
    const frame = computePhaseFrame(totalPowerKw, phaseMode);
    // Override the phase model's hardcoded 230V with whatever the device
    // is configured for (some installations are 220V or 240V).
    const v = wiring.nominalVoltageV;

    const phases =
        wiring.phases === 1
            ? ([['L1', frame.l1]] as const)
            : ([
                  ['L1', frame.l1],
                  ['L2', frame.l2],
                  ['L3', frame.l3],
              ] as const);

    const out: SampledValue[] = [
        {
            measurand: 'Energy.Active.Import.Register',
            value: String(Math.round(energyWh)),
            unit: 'Wh',
            location: DEFAULT_OUTLET_LOCATION,
        },
        {
            measurand: 'Power.Active.Import',
            value: String(Math.round(frame.totalKw * 1000)),
            unit: 'W',
            location: DEFAULT_OUTLET_LOCATION,
        },
        {
            measurand: 'Frequency',
            value: DEFAULT_FREQUENCY_HZ.toFixed(1),
        },
    ];

    for (const [tag, reading] of phases) {
        const currentA = reading.powerW > 0 ? reading.powerW / v : 0;
        out.push(
            { measurand: 'Voltage', phase: tag, value: v.toFixed(1), unit: 'V' },
            { measurand: 'Current.Import', phase: tag, value: currentA.toFixed(2), unit: 'A' },
            {
                measurand: 'Power.Active.Import',
                phase: tag,
                value: Math.round(reading.powerW).toString(),
                unit: 'W',
            },
        );
    }

    if (wiring.reportLineToLine && wiring.phases === 3) {
        const ll = wiring.lineToLineV;
        out.push(
            { measurand: 'Voltage', phase: 'L1-L2', value: ll.toFixed(1), unit: 'V' },
            { measurand: 'Voltage', phase: 'L2-L3', value: ll.toFixed(1), unit: 'V' },
            { measurand: 'Voltage', phase: 'L3-L1', value: ll.toFixed(1), unit: 'V' },
        );
    }

    return out;
}

/**
 * DC measurands for one tick. The DC charging curve gives us voltage,
 * current, instantaneous power, delivered energy, and SoC — all reported
 * unphased.
 */
export function computeDcMeasurands(args: {
    profile: DCBatteryProfile;
    elapsedSec: number;
    energyWh: number;
}): { measurands: SampledValue[]; frame: DCFrame } {
    const frame = computeDCFrame(args.profile, args.elapsedSec, args.energyWh);
    const measurands: SampledValue[] = [
        {
            measurand: 'Energy.Active.Import.Register',
            value: String(Math.round(args.energyWh)),
            unit: 'Wh',
            location: DEFAULT_OUTLET_LOCATION,
        },
        {
            measurand: 'Power.Active.Import',
            value: String(Math.round(frame.powerW)),
            unit: 'W',
            location: DEFAULT_OUTLET_LOCATION,
        },
        { measurand: 'Voltage', value: frame.voltageV.toFixed(1), unit: 'V' },
        { measurand: 'Current.Import', value: frame.currentA.toFixed(2), unit: 'A' },
        {
            measurand: 'SoC',
            value: frame.socPct.toFixed(1),
            unit: 'Percent',
            location: 'EV',
        },
    ];
    return { measurands, frame };
}

/**
 * Filter a measurand list against the OCPP `MeterValuesSampledData`
 * config key — a CSV of OCPP measurand names. Empty/undefined string
 * means "no filter" (return everything). Unknown names in the CSV are
 * ignored; comparison is case-sensitive (OCPP measurand names are).
 */
export function filterMeasurands(
    values: SampledValue[],
    csv: string | null | undefined,
): SampledValue[] {
    if (!csv || !csv.trim()) return values;
    const allowed = new Set(
        csv
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );
    return values.filter((v) => v.measurand && allowed.has(v.measurand));
}

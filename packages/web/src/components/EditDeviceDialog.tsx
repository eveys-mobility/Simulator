import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, type DeviceWithRuntime } from '@/lib/api';
import type { PhaseMode } from '@ocpp-sim/core';

interface Props {
    device: DeviceWithRuntime;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface FormState {
    displayName: string;
    vendor: string;
    firmwareVersion: string;
    maxPowerKw: string;
    ocppUrl: string;
    authPasswordDraft: string;
    /** True when the user typed something into the password field — only
     *  then do we send it. Distinguishes "leave alone" from "clear". */
    authPasswordDirty: boolean;
    /** True when the user explicitly clicked Clear, sending empty string. */
    authPasswordCleared: boolean;
    phaseMode: PhaseMode;
    // AC wiring (only meaningful when device.type === 'AC')
    acPhases: '1' | '3';
    acNominalV: string;
    acLineToLineV: string;
    acReportLineToLine: boolean;
    // DC profile, present only when device.type === 'DC'
    capacityKwh: string;
    chargerMaxKw: string;
    nominalVoltageV: string;
    initialSocPct: string;
    targetSocPct: string;
    rampUpSeconds: string;
}

const RESPAWN_KEYS = ['vendor', 'firmwareVersion', 'maxPowerKw', 'ocppUrl'] as const;

function formFromDevice(d: DeviceWithRuntime): FormState {
    return {
        displayName: d.displayName,
        vendor: d.vendor,
        firmwareVersion: d.firmwareVersion,
        maxPowerKw: String(d.maxPowerKw),
        ocppUrl: d.ocppUrl,
        authPasswordDraft: '',
        authPasswordDirty: false,
        authPasswordCleared: false,
        phaseMode: d.phaseMode,
        acPhases: (d.acWiring?.phases ?? 3).toString() as '1' | '3',
        acNominalV: String(d.acWiring?.nominalVoltageV ?? 230),
        acLineToLineV: String(d.acWiring?.lineToLineV ?? 400),
        acReportLineToLine: !!d.acWiring?.reportLineToLine,
        capacityKwh: d.dcProfile ? String(d.dcProfile.capacityKwh) : '60',
        chargerMaxKw: d.dcProfile ? String(d.dcProfile.chargerMaxKw) : '100',
        nominalVoltageV: d.dcProfile ? String(d.dcProfile.nominalVoltageV) : '400',
        initialSocPct: d.dcProfile ? String(d.dcProfile.initialSocPct) : '20',
        targetSocPct: d.dcProfile ? String(d.dcProfile.targetSocPct) : '80',
        rampUpSeconds: d.dcProfile ? String(d.dcProfile.rampUpSeconds) : '25',
    };
}

export function EditDeviceDialog({ device, open, onOpenChange }: Props) {
    const qc = useQueryClient();
    const [form, setForm] = useState<FormState>(() => formFromDevice(device));
    const [error, setError] = useState<string | null>(null);

    // When the dialog closes, reset to the current device for the next open.
    const handleOpenChange = (next: boolean) => {
        if (!next) {
            setForm(formFromDevice(device));
            setError(null);
        }
        onOpenChange(next);
    };

    const respawnPending = useMemo(() => {
        const changed: string[] = [];
        if (form.vendor !== device.vendor) changed.push('vendor');
        if (form.firmwareVersion !== device.firmwareVersion) changed.push('firmware');
        if (Number(form.maxPowerKw) !== device.maxPowerKw) changed.push('max power');
        if (form.ocppUrl !== device.ocppUrl) changed.push('OCPP URL');
        if (form.authPasswordDirty || form.authPasswordCleared) changed.push('auth password');
        return changed;
    }, [form, device]);

    const save = useMutation({
        mutationFn: () => {
            const body: Parameters<typeof api.updateDevice>[1] = {};
            if (form.displayName.trim() !== device.displayName)
                body.displayName = form.displayName.trim();
            if (form.vendor.trim() !== device.vendor) body.vendor = form.vendor.trim();
            if (form.firmwareVersion.trim() !== device.firmwareVersion)
                body.firmwareVersion = form.firmwareVersion.trim();
            const mp = Number(form.maxPowerKw);
            if (Number.isFinite(mp) && mp > 0 && mp !== device.maxPowerKw) body.maxPowerKw = mp;
            if (form.ocppUrl.trim() !== device.ocppUrl) body.ocppUrl = form.ocppUrl.trim();
            if (form.authPasswordDirty && form.authPasswordDraft)
                body.authPassword = form.authPasswordDraft;
            else if (form.authPasswordCleared) body.authPassword = '';
            if (form.phaseMode !== device.phaseMode) body.phaseMode = form.phaseMode;
            if (device.type === 'AC') {
                const ac = {
                    phases: (Number(form.acPhases) === 1 ? 1 : 3) as 1 | 3,
                    nominalVoltageV: Number(form.acNominalV),
                    lineToLineV: Number(form.acLineToLineV),
                    reportLineToLine: form.acReportLineToLine,
                };
                const original = device.acWiring;
                const changed =
                    !original ||
                    ac.phases !== original.phases ||
                    ac.nominalVoltageV !== original.nominalVoltageV ||
                    ac.lineToLineV !== original.lineToLineV ||
                    ac.reportLineToLine !== original.reportLineToLine;
                if (changed) body.acWiring = ac;
            }
            if (device.type === 'DC') {
                const dc = {
                    capacityKwh: Number(form.capacityKwh),
                    chargerMaxKw: Number(form.chargerMaxKw),
                    nominalVoltageV: Number(form.nominalVoltageV),
                    initialSocPct: Number(form.initialSocPct),
                    targetSocPct: Number(form.targetSocPct),
                    rampUpSeconds: Number(form.rampUpSeconds),
                };
                const original = device.dcProfile;
                const changed =
                    !original ||
                    (Object.keys(dc) as (keyof typeof dc)[]).some((k) => dc[k] !== original[k]);
                if (changed) body.dcProfile = dc;
            }
            return api.updateDevice(device.id, body);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['devices'] });
            qc.invalidateQueries({ queryKey: ['devices', device.id] });
            onOpenChange(false);
        },
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });

    const set =
        <K extends keyof FormState>(key: K) =>
        (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
            setForm((f) => ({ ...f, [key]: e.target.value as FormState[K] }));

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <Badge variant={device.type === 'DC' ? 'dc' : 'ac'}>{device.type}</Badge>
                        <DialogTitle>Edit device</DialogTitle>
                    </div>
                    <DialogDescription className="font-mono text-xs">{device.id}</DialogDescription>
                </DialogHeader>

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        setError(null);
                        save.mutate();
                    }}
                    className="space-y-4"
                >
                    <Section title="Identity">
                        <Field label="Display name">
                            <Input
                                value={form.displayName}
                                onChange={set('displayName')}
                                required
                                maxLength={80}
                            />
                        </Field>
                        <Field label="Type">
                            <div className="flex h-10 items-center px-3 text-sm text-muted-foreground border rounded-md bg-secondary/40">
                                {device.type} (locked — set at creation)
                            </div>
                        </Field>
                        <Field label="Vendor">
                            <Input
                                value={form.vendor}
                                onChange={set('vendor')}
                                required
                                maxLength={80}
                            />
                        </Field>
                        <Field label="Firmware version">
                            <Input
                                value={form.firmwareVersion}
                                onChange={set('firmwareVersion')}
                                required
                                maxLength={40}
                            />
                        </Field>
                    </Section>

                    <Section title="Connection">
                        <Field label="OCPP URL">
                            <Input
                                type="url"
                                value={form.ocppUrl}
                                onChange={set('ocppUrl')}
                                required
                                placeholder="ws://gateway.example:19000"
                            />
                        </Field>
                        <Field label="Max power (kW)">
                            <Input
                                type="number"
                                value={form.maxPowerKw}
                                onChange={set('maxPowerKw')}
                                step="0.1"
                                min="0.1"
                                max="1000"
                                required
                            />
                        </Field>
                        <Field label="OCPP auth password">
                            <div className="flex gap-2">
                                <Input
                                    type="password"
                                    autoComplete="new-password"
                                    value={form.authPasswordDraft}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            authPasswordDraft: e.target.value,
                                            authPasswordDirty: true,
                                            authPasswordCleared: false,
                                        }))
                                    }
                                    placeholder={
                                        device.hasAuthPassword
                                            ? '•••••• (set)'
                                            : 'leave blank for anonymous'
                                    }
                                />
                                {device.hasAuthPassword && !form.authPasswordCleared && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setForm((f) => ({
                                                ...f,
                                                authPasswordDraft: '',
                                                authPasswordDirty: false,
                                                authPasswordCleared: true,
                                            }))
                                        }
                                    >
                                        Clear
                                    </Button>
                                )}
                                {form.authPasswordCleared && (
                                    <span className="self-center text-xs text-muted-foreground">
                                        will clear on save
                                    </span>
                                )}
                            </div>
                        </Field>
                    </Section>

                    {device.type === 'AC' ? (
                        <Section title="AC settings">
                            <Field label="Phases">
                                <select
                                    value={form.acPhases}
                                    onChange={set('acPhases')}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    <option value="3">3-phase (L1, L2, L3)</option>
                                    <option value="1">Single phase (L1 only)</option>
                                </select>
                            </Field>
                            <Field label="Phase mode">
                                <select
                                    value={form.phaseMode}
                                    onChange={set('phaseMode')}
                                    disabled={form.acPhases === '1'}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                                >
                                    <option value="balanced">Balanced</option>
                                    <option value="imbalanced">Imbalanced (60/30/10)</option>
                                    <option value="single-phase">All on L1</option>
                                </select>
                            </Field>
                            <Field label="Nominal voltage L-N (V)">
                                <Input
                                    type="number"
                                    value={form.acNominalV}
                                    onChange={set('acNominalV')}
                                    step="1"
                                    min="100"
                                    max="500"
                                />
                            </Field>
                            <Field label="Line-to-line voltage (V)">
                                <Input
                                    type="number"
                                    value={form.acLineToLineV}
                                    onChange={set('acLineToLineV')}
                                    step="1"
                                    min="100"
                                    max="800"
                                    disabled={form.acPhases === '1'}
                                />
                            </Field>
                            <label className="col-span-full inline-flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={form.acReportLineToLine}
                                    onChange={(e) =>
                                        setForm((f) => ({
                                            ...f,
                                            acReportLineToLine: e.target.checked,
                                        }))
                                    }
                                    disabled={form.acPhases === '1'}
                                    className="h-4 w-4 rounded border-input bg-background"
                                />
                                <span>
                                    Also report L1-L2 / L2-L3 / L3-L1 voltage in MeterValues
                                </span>
                            </label>
                        </Section>
                    ) : (
                        <Section title="DC battery profile">
                            <p className="text-xs text-muted-foreground -mt-1 mb-2">
                                Profile changes apply on the next session — a running tick loop
                                keeps its captured profile.
                            </p>
                            <Field label="Capacity (kWh)">
                                <Input
                                    type="number"
                                    value={form.capacityKwh}
                                    onChange={set('capacityKwh')}
                                    step="1"
                                    min="1"
                                />
                            </Field>
                            <Field label="Charger max (kW)">
                                <Input
                                    type="number"
                                    value={form.chargerMaxKw}
                                    onChange={set('chargerMaxKw')}
                                    step="1"
                                    min="1"
                                />
                            </Field>
                            <Field label="Nominal voltage (V)">
                                <Input
                                    type="number"
                                    value={form.nominalVoltageV}
                                    onChange={set('nominalVoltageV')}
                                    step="10"
                                    min="100"
                                />
                            </Field>
                            <Field label="Ramp-up (s)">
                                <Input
                                    type="number"
                                    value={form.rampUpSeconds}
                                    onChange={set('rampUpSeconds')}
                                    step="1"
                                    min="0"
                                />
                            </Field>
                            <Field label="Initial SoC (%)">
                                <Input
                                    type="number"
                                    value={form.initialSocPct}
                                    onChange={set('initialSocPct')}
                                    step="1"
                                    min="0"
                                    max="100"
                                />
                            </Field>
                            <Field label="Target SoC (%)">
                                <Input
                                    type="number"
                                    value={form.targetSocPct}
                                    onChange={set('targetSocPct')}
                                    step="1"
                                    min="1"
                                    max="100"
                                />
                            </Field>
                        </Section>
                    )}

                    {respawnPending.length > 0 && (
                        <div className="flex items-start gap-2 rounded-md border border-brand-orange/40 bg-brand-orange/10 p-3 text-sm text-brand-orange">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                            <div>
                                Saving will reconnect the simulator:{' '}
                                <span className="font-medium">{respawnPending.join(', ')}</span>{' '}
                                changed. The device will briefly go offline and re-announce to the
                                gateway.
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
                            {error}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleOpenChange(false)}
                            disabled={save.isPending}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={save.isPending}>
                            {save.isPending ? 'Saving…' : 'Save'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

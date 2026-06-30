import { z } from 'zod';

/**
 * OCPP 1.6 FirmwareManagement profile (§6.7 GetDiagnostics, §6.19
 * UpdateFirmware) plus their CP-initiated status notifications
 * (§6.6 DiagnosticsStatusNotification, §6.10 FirmwareStatusNotification).
 *
 * The simulator models the state walks: UpdateFirmware moves through
 * Downloading → Downloaded → Installing → Installed; GetDiagnostics
 * moves through Uploading → Uploaded. No actual transfer happens —
 * timers fire the notifications so a CSMS can verify the state-machine
 * end-to-end without standing up an HTTP server.
 */

export const FirmwareStatus = z.enum([
    /** Idle — no firmware update in progress. Not used over the wire
     *  on the trigger path; the simulator emits a real intermediate
     *  status (e.g. Installed) when triggered. */
    'Idle',
    'Downloading',
    'Downloaded',
    'DownloadFailed',
    'Installing',
    'InstallationFailed',
    'Installed',
]);
export type FirmwareStatus = z.infer<typeof FirmwareStatus>;

export const DiagnosticsStatus = z.enum(['Idle', 'Uploading', 'Uploaded', 'UploadFailed']);
export type DiagnosticsStatus = z.infer<typeof DiagnosticsStatus>;

export const UpdateFirmwareReqSchema = z.object({
    /** URL the CP would download the firmware from. The simulator
     *  doesn't actually fetch it — the value is logged but the
     *  state walk runs regardless. */
    location: z.string().min(1),
    /** ISO-8601. Time at which the CP should *start* retrieving the
     *  firmware. Past values trigger immediately. */
    retrieveDate: z.string().datetime(),
    /** Optional retry budget if the download fails. Defaults vary by
     *  CP. The simulator never simulates failures, so it doesn't use
     *  these — but it accepts and stores them per spec. */
    retries: z.number().int().nonnegative().optional(),
    retryInterval: z.number().int().nonnegative().optional(),
});
export type UpdateFirmwareReq = z.infer<typeof UpdateFirmwareReqSchema>;

export const GetDiagnosticsReqSchema = z.object({
    /** URL the CP should upload the diagnostics file to. Same caveat
     *  as UpdateFirmware.location — we don't actually upload. */
    location: z.string().min(1),
    retries: z.number().int().nonnegative().optional(),
    retryInterval: z.number().int().nonnegative().optional(),
    /** ISO-8601 bounds for which diagnostics to include. Stored but
     *  not used by the simulator. */
    startTime: z.string().datetime().optional(),
    stopTime: z.string().datetime().optional(),
});
export type GetDiagnosticsReq = z.infer<typeof GetDiagnosticsReqSchema>;

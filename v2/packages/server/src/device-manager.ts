import { EventEmitter } from 'node:events';
import type { Device } from '@ocpp-sim/core';
import { Simulator } from './simulator.js';

/**
 * Owns the live `Simulator` for every device in the database.
 * The store is the source of truth for which devices exist; the
 * manager reflects that in-process. UI and REST routes use this.
 *
 * Re-emits child events with `deviceId` attached so the WS hub
 * can fan out without touching every Simulator individually.
 */
export class DeviceManager extends EventEmitter {
    private sims = new Map<string, Simulator>();

    list(): Simulator[] {
        return [...this.sims.values()];
    }

    get(id: string): Simulator | undefined {
        return this.sims.get(id);
    }

    async spawn(device: Device): Promise<void> {
        if (this.sims.has(device.id)) return;
        const sim = new Simulator(device);
        sim.on('state', (s) => this.emit('state', { deviceId: device.id, ...s }));
        sim.on('tick', (t) => this.emit('tick', t));
        sim.on('session', (s) => this.emit('session', { deviceId: device.id, ...s }));
        sim.on('frame', (f) => this.emit('frame', { deviceId: device.id, ...f }));
        sim.on('error', (e) => this.emit('errored', { deviceId: device.id, error: e }));
        this.sims.set(device.id, sim);
        try {
            await sim.start();
        } catch (err) {
            // Boot can fail if the gateway is unreachable; the OcppClient
            // schedules its own reconnect, so we keep the simulator alive
            // and let it come online later. Surface the error for logging.
            this.emit('errored', { deviceId: device.id, error: err });
        }
    }

    async despawn(id: string): Promise<void> {
        const sim = this.sims.get(id);
        if (!sim) return;
        try {
            // Stop any active sessions on the way out.
            for (const c of sim.snapshot().connectors) {
                if (c.transactionId !== null) {
                    await sim.stopSession(c.id, 'PowerLoss').catch(() => undefined);
                }
            }
        } finally {
            sim.stop();
            this.sims.delete(id);
        }
    }

    /**
     * Tear down + bring back up with a fresh device row. Used by edits
     * that change socket-affecting fields (ocppUrl, vendor, firmwareVersion,
     * maxPowerKw): the new BootNotification has to reannounce, and the
     * model name + max-power feed into the gateway's view of the device.
     */
    async respawn(device: Device): Promise<void> {
        await this.despawn(device.id);
        await this.spawn(device);
    }

    /** True if any connector has an open transaction. */
    hasActiveSession(id: string): boolean {
        const sim = this.sims.get(id);
        if (!sim) return false;
        return sim.snapshot().connectors.some((c) => c.transactionId !== null);
    }

    async stopAll(): Promise<void> {
        await Promise.all([...this.sims.keys()].map((id) => this.despawn(id)));
    }
}

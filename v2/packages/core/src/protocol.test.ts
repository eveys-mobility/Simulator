import { describe, expect, it } from 'vitest';
import {
    BootNotificationReqSchema,
    BootNotificationResSchema,
    MessageType,
    ProtocolError,
    decodeFrame,
    encodeCall,
    encodeError,
    encodeResult,
} from './protocol.js';

describe('OCPP frame codec', () => {
    it('round-trips a CALL', () => {
        const wire = encodeCall('abc', 'BootNotification', { chargePointVendor: 'Eveys', chargePointModel: 'X' });
        const decoded = decodeFrame(wire);
        expect(decoded[0]).toBe(MessageType.CALL);
        expect(decoded[1]).toBe('abc');
        expect(decoded[2]).toBe('BootNotification');
    });

    it('round-trips a CALLRESULT', () => {
        const wire = encodeResult('xyz', { status: 'Accepted' });
        const decoded = decodeFrame(wire);
        expect(decoded[0]).toBe(MessageType.CALLRESULT);
        expect(decoded[1]).toBe('xyz');
    });

    it('round-trips a CALLERROR', () => {
        const wire = encodeError('xyz', 'GenericError', 'oops');
        const decoded = decodeFrame(wire);
        expect(decoded[0]).toBe(MessageType.CALLERROR);
        expect(decoded[2]).toBe('GenericError');
        expect(decoded[3]).toBe('oops');
    });

    it('rejects malformed JSON', () => {
        expect(() => decodeFrame('not json')).toThrow(ProtocolError);
    });

    it('rejects unknown message-type id', () => {
        expect(() => decodeFrame('[99,"abc",{}]')).toThrow(ProtocolError);
    });

    it('rejects too-short array', () => {
        expect(() => decodeFrame('[2]')).toThrow(ProtocolError);
    });
});

describe('payload schemas', () => {
    it('validates a BootNotification request', () => {
        const ok = BootNotificationReqSchema.safeParse({
            chargePointVendor: 'Eveys',
            chargePointModel: 'Eveys-22kW-AC',
        });
        expect(ok.success).toBe(true);
    });

    it('rejects vendor that exceeds 20 chars', () => {
        const bad = BootNotificationReqSchema.safeParse({
            chargePointVendor: 'x'.repeat(21),
            chargePointModel: 'm',
        });
        expect(bad.success).toBe(false);
    });

    it('validates a BootNotification response', () => {
        const ok = BootNotificationResSchema.safeParse({
            status: 'Accepted',
            currentTime: '2026-05-09T10:00:00Z',
            interval: 300,
        });
        expect(ok.success).toBe(true);
    });
});

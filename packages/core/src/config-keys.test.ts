import { describe, expect, it } from 'vitest';
import { CONFIG_KEY_INDEX, STANDARD_CONFIG_KEYS } from './config-keys.js';

describe('STANDARD_CONFIG_KEYS', () => {
    it('every key has a non-empty description', () => {
        // The description surfaces on the OcppConfigCard. A blank one
        // makes the page useless as a reference and forces operators
        // back to the OCPP 1.6 spec. Catch that drift here.
        const missing = STANDARD_CONFIG_KEYS.filter(
            (k) => !k.description || k.description.trim().length < 10,
        ).map((k) => k.key);
        expect(missing, `keys with missing/too-short description: ${missing.join(', ')}`).toEqual(
            [],
        );
    });

    it('descriptions stay terse — operator-facing one-liners, not spec quotes', () => {
        // A soft cap. If the line gets long it stops fitting the row in
        // the UI and the operator is reading instead of glancing.
        const tooLong = STANDARD_CONFIG_KEYS.filter((k) => (k.description ?? '').length > 200).map(
            (k) => `${k.key} (${(k.description ?? '').length} chars)`,
        );
        expect(tooLong, `descriptions over 200 chars: ${tooLong.join('; ')}`).toEqual([]);
    });

    it('CONFIG_KEY_INDEX has an entry for every standard key', () => {
        expect(CONFIG_KEY_INDEX.size).toBe(STANDARD_CONFIG_KEYS.length);
        for (const k of STANDARD_CONFIG_KEYS) {
            expect(CONFIG_KEY_INDEX.get(k.key)).toBe(k);
        }
    });

    it('no duplicate keys', () => {
        const seen = new Set<string>();
        const dups: string[] = [];
        for (const k of STANDARD_CONFIG_KEYS) {
            if (seen.has(k.key)) dups.push(k.key);
            seen.add(k.key);
        }
        expect(dups).toEqual([]);
    });
});

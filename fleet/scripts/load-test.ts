/**
 * Spawn N AC + M DC CPs against a running fleet manager, measure
 * boot time + per-session-start latency, then tear down. Useful for
 * stress-testing the supervisor + WS pubsub before a release.
 *
 * Usage:
 *   FLEET_BASE_URL=http://localhost:3100 \
 *     npx tsx scripts/load-test.ts \
 *     --ac=20 --dc=2 --sessions=10
 *
 * Defaults: --ac=10 --dc=1 --sessions=5.
 *
 * Tear-down: every CP this script created is deleted at the end,
 * even on error. Existing CPs (e.g. ones created via the UI) are
 * untouched.
 */

import { setTimeout as delay } from 'node:timers/promises';

interface Args {
    ac: number;
    dc: number;
    sessions: number;
    base: string;
}

function parseArgs(): Args {
    const args: Args = {
        ac: 10,
        dc: 1,
        sessions: 5,
        base: process.env.FLEET_BASE_URL ?? 'http://localhost:3100',
    };
    for (const arg of process.argv.slice(2)) {
        const m = /^--(ac|dc|sessions|base)=(.+)$/.exec(arg);
        if (!m) continue;
        const [, key, value] = m;
        if (key === 'base') args.base = value;
        else (args as any)[key] = Number(value);
    }
    return args;
}

interface FleetCP {
    cp_id: string;
    online: boolean;
    connector_status: Record<number, string>;
    type: 'AC' | 'DC';
}

async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${url} → HTTP ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
}

const sortNumeric = (arr: number[]): number[] => arr.slice().sort((a, b) => a - b);
const percentile = (arr: number[], p: number): number => {
    if (arr.length === 0) return 0;
    const sorted = sortNumeric(arr);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
};

async function main(): Promise<void> {
    const args = parseArgs();
    console.log(`[load-test] target=${args.base} ac=${args.ac} dc=${args.dc} sessions=${args.sessions}`);

    // Pre-create a group so the LB endpoint has somewhere to put
    // the sessions.
    const groupResp = await api<{ group: { id: number } }>(args.base + '/fleet/groups', {
        method: 'POST',
        body: JSON.stringify({
            name: `load-test-${Date.now()}`,
            type: 'AC',
            lb_strategy: 'least_active',
            lb_enabled: true,
        }),
    });
    const groupId = groupResp.group.id;
    console.log(`[load-test] created group #${groupId}`);

    const ourCps: string[] = [];
    const cleanup = async (): Promise<void> => {
        console.log(`[load-test] cleaning up: ${ourCps.length} CPs + group #${groupId}`);
        await Promise.allSettled(ourCps.map((id) => api(args.base + `/fleet/cps/${id}`, { method: 'DELETE' })));
        await api(args.base + `/fleet/groups/${groupId}`, { method: 'DELETE' }).catch(() => undefined);
    };

    try {
        // ----- Boot -----
        const bootStart = Date.now();
        const acIds: string[] = [];
        for (let i = 0; i < args.ac; i++) {
            const r = await api<{ cp: { cp_id: string } }>(args.base + '/fleet/cps', {
                method: 'POST',
                body: JSON.stringify({ type: 'AC', display_name: `LT-AC-${i + 1}`, group_id: groupId }),
            });
            acIds.push(r.cp.cp_id);
            ourCps.push(r.cp.cp_id);
        }
        const dcIds: string[] = [];
        for (let i = 0; i < args.dc; i++) {
            const r = await api<{ cp: { cp_id: string } }>(args.base + '/fleet/cps', {
                method: 'POST',
                body: JSON.stringify({
                    type: 'DC',
                    display_name: `LT-DC-${i + 1}`,
                    dc_profile: { capacity_kwh: 60, charger_max_kw: 100 },
                }),
            });
            dcIds.push(r.cp.cp_id);
            ourCps.push(r.cp.cp_id);
        }

        // Wait for everyone in the group to reach online + Available.
        const targets = new Set(acIds);
        let onlineCount = 0;
        const onlineDeadline = Date.now() + 60_000;
        while (Date.now() < onlineDeadline) {
            const all = await api<{ cps: FleetCP[] }>(args.base + '/fleet/cps');
            onlineCount = all.cps.filter((c) =>
                targets.has(c.cp_id) && c.online && c.connector_status[1] === 'Available',
            ).length;
            if (onlineCount === args.ac) break;
            await delay(500);
        }
        const bootMs = Date.now() - bootStart;
        if (onlineCount < args.ac) {
            console.error(`[load-test] only ${onlineCount}/${args.ac} AC CPs reached Available within 60s`);
        } else {
            console.log(`[load-test] all ${args.ac} AC CPs online in ${bootMs} ms`);
        }

        // ----- Concurrent sessions -----
        const sessionLatencies: number[] = [];
        const sessionPromises: Array<Promise<void>> = [];
        for (let i = 0; i < args.sessions; i++) {
            sessionPromises.push((async () => {
                const t0 = Date.now();
                try {
                    await api(args.base + `/fleet/groups/${groupId}/sessions`, {
                        method: 'POST',
                        body: JSON.stringify({ id_tag: `LT-${i}` }),
                    });
                    sessionLatencies.push(Date.now() - t0);
                } catch (err) {
                    console.warn(`[load-test] session ${i} failed: ${(err as Error).message}`);
                }
            })());
        }
        await Promise.all(sessionPromises);

        if (sessionLatencies.length > 0) {
            console.log(`[load-test] session-start latency (n=${sessionLatencies.length}):`);
            console.log(`             p50=${percentile(sessionLatencies, 50)}ms`);
            console.log(`             p95=${percentile(sessionLatencies, 95)}ms`);
            console.log(`             p99=${percentile(sessionLatencies, 99)}ms`);
            console.log(`             max=${Math.max(...sessionLatencies)}ms`);
        }

        // Let charging run a moment so the meter ticks land — proves
        // the workers stay alive under load, not just connect-and-die.
        await delay(3000);
        const post = await api<{ cps: FleetCP[] }>(args.base + '/fleet/cps');
        const stillOnline = post.cps.filter((c) => targets.has(c.cp_id) && c.online).length;
        console.log(`[load-test] post-load: ${stillOnline}/${args.ac} AC CPs still online`);
    } finally {
        await cleanup();
    }
}

main().catch((err) => {
    console.error('[load-test] fatal:', err);
    process.exit(1);
});

import * as fs from 'fs';
import * as path from 'path';

export interface IdTagInfo {
    status: 'Accepted' | 'Blocked' | 'Expired' | 'Invalid' | 'ConcurrentTx';
    expiryDate?: Date;
    parentIdTag?: string;
}

export interface LocalAuthListEntry {
    idTag: string;
    idTagInfo: IdTagInfo;
}

export class LocalAuthList {
    private chargePointId: string;
    private dataDir: string;
    private listFile: string;
    private version: number = 0;
    private entries: Map<string, IdTagInfo> = new Map();
    private maxLength: number;

    constructor(chargePointId: string, maxLength: number = 100) {
        this.chargePointId = chargePointId;
        this.maxLength = maxLength;
        this.dataDir = path.join(process.cwd(), 'data');
        this.listFile = path.join(this.dataDir, `local_auth_list_${chargePointId}.json`);

        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Load existing list
        this.loadList();
    }

    /**
     * Get authorization info for an ID tag
     */
    public getIdTagInfo(idTag: string): IdTagInfo | undefined {
        const info = this.entries.get(idTag);

        if (!info) {
            return undefined;
        }

        // Check if tag is expired
        if (info.expiryDate && new Date(info.expiryDate) < new Date()) {
            return {
                ...info,
                status: 'Expired'
            };
        }

        return info;
    }

    /**
     * Add or update an ID tag
     */
    public setIdTag(idTag: string, info: IdTagInfo): boolean {
        if (this.entries.size >= this.maxLength && !this.entries.has(idTag)) {
            console.warn(`[LocalAuthList] Cannot add tag ${idTag}: list is full (${this.maxLength} entries)`);
            return false;
        }

        this.entries.set(idTag, info);
        this.version++;
        this.saveList();

        console.log(`[LocalAuthList] Added/updated tag ${idTag}, version now ${this.version}`);
        return true;
    }

    /**
     * Remove an ID tag
     */
    public removeIdTag(idTag: string): boolean {
        const removed = this.entries.delete(idTag);

        if (removed) {
            this.version++;
            this.saveList();
            console.log(`[LocalAuthList] Removed tag ${idTag}, version now ${this.version}`);
        }

        return removed;
    }

    /**
     * Clear all entries
     */
    public clearList(): void {
        this.entries.clear();
        this.version++;
        this.saveList();
        console.log(`[LocalAuthList] Cleared all entries, version now ${this.version}`);
    }

    /**
     * Update entire list (for SendLocalList OCPP command)
     */
    public updateList(entries: LocalAuthListEntry[], updateType: 'Full' | 'Differential'): boolean {
        try {
            if (updateType === 'Full') {
                this.entries.clear();
            }

            for (const entry of entries) {
                if (this.entries.size >= this.maxLength && !this.entries.has(entry.idTag)) {
                    console.warn(`[LocalAuthList] List full, cannot add ${entry.idTag}`);
                    continue;
                }
                this.entries.set(entry.idTag, entry.idTagInfo);
            }

            this.version++;
            this.saveList();

            console.log(`[LocalAuthList] Updated list (${updateType}): ${this.entries.size} entries, version ${this.version}`);
            return true;
        } catch (error) {
            console.error('[LocalAuthList] Error updating list:', error);
            return false;
        }
    }

    /**
     * Get current version
     */
    public getVersion(): number {
        return this.version;
    }

    /**
     * Get all entries
     */
    public getAllEntries(): LocalAuthListEntry[] {
        return Array.from(this.entries.entries()).map(([idTag, idTagInfo]) => ({
            idTag,
            idTagInfo
        }));
    }

    /**
     * Get entry count
     */
    public getCount(): number {
        return this.entries.size;
    }

    /**
     * Check if tag exists
     */
    public hasIdTag(idTag: string): boolean {
        return this.entries.has(idTag);
    }

    /**
     * Load list from file
     */
    private loadList(): void {
        try {
            if (fs.existsSync(this.listFile)) {
                const data = fs.readFileSync(this.listFile, 'utf-8');
                const stored = JSON.parse(data);

                this.version = stored.version || 0;
                this.entries.clear();

                for (const entry of stored.entries || []) {
                    // Convert date strings back to Date objects
                    if (entry.idTagInfo.expiryDate) {
                        entry.idTagInfo.expiryDate = new Date(entry.idTagInfo.expiryDate);
                    }
                    this.entries.set(entry.idTag, entry.idTagInfo);
                }

                console.log(`[LocalAuthList] Loaded ${this.entries.size} entries, version ${this.version}`);
            } else {
                console.log('[LocalAuthList] No existing list file found, starting fresh');
                // Add default test tags
                this.addDefaultTags();
            }
        } catch (error) {
            console.error('[LocalAuthList] Error loading list:', error);
            this.entries.clear();
            this.version = 0;
            this.addDefaultTags();
        }
    }

    /**
     * Save list to file
     */
    private saveList(): void {
        try {
            const data = {
                version: this.version,
                entries: this.getAllEntries()
            };

            fs.writeFileSync(this.listFile, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error('[LocalAuthList] Error saving list:', error);
        }
    }

    /**
     * Add default test tags
     */
    private addDefaultTags(): void {
        const defaultTags = [
            {
                idTag: 'TEST-TAG-001',
                idTagInfo: {
                    status: 'Accepted' as const,
                    expiryDate: new Date('2099-12-31T23:59:59Z')
                }
            },
            {
                idTag: 'ADMIN-TAG',
                idTagInfo: {
                    status: 'Accepted' as const,
                    expiryDate: new Date('2099-12-31T23:59:59Z')
                }
            },
            {
                idTag: 'DEMO-TAG',
                idTagInfo: {
                    status: 'Accepted' as const,
                    expiryDate: new Date('2099-12-31T23:59:59Z')
                }
            }
        ];

        for (const tag of defaultTags) {
            this.entries.set(tag.idTag, tag.idTagInfo);
        }

        this.version = 1;
        this.saveList();

        console.log('[LocalAuthList] Added default test tags');
    }
}

import { IdTagInfo } from './LocalAuthList';

interface CacheEntry {
    idTag: string;
    idTagInfo: IdTagInfo;
    timestamp: Date;
    expiresAt: Date;
}

export class AuthorizationCache {
    private cache: Map<string, CacheEntry> = new Map();
    private ttlSeconds: number;
    private maxEntries: number;

    constructor(ttlSeconds: number = 86400, maxEntries: number = 100) {
        this.ttlSeconds = ttlSeconds; // Default: 24 hours
        this.maxEntries = maxEntries;

        // Cleanup expired entries every hour
        setInterval(() => this.cleanupExpired(), 3600000);
    }

    /**
     * Get cached authorization info
     */
    public get(idTag: string): IdTagInfo | undefined {
        const entry = this.cache.get(idTag);

        if (!entry) {
            return undefined;
        }

        // Check if expired
        if (new Date() > entry.expiresAt) {
            this.cache.delete(idTag);
            console.log(`[AuthorizationCache] Expired entry removed for ${idTag}`);
            return undefined;
        }

        console.log(`[AuthorizationCache] Cache hit for ${idTag}`);
        return entry.idTagInfo;
    }

    /**
     * Add or update cache entry
     */
    public set(idTag: string, idTagInfo: IdTagInfo): void {
        // If cache is full and this is a new entry, remove oldest
        if (this.cache.size >= this.maxEntries && !this.cache.has(idTag)) {
            this.evictOldest();
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);

        this.cache.set(idTag, {
            idTag,
            idTagInfo,
            timestamp: now,
            expiresAt
        });

        console.log(`[AuthorizationCache] Cached ${idTag}, expires at ${expiresAt.toISOString()}`);
    }

    /**
     * Remove entry from cache
     */
    public remove(idTag: string): boolean {
        const removed = this.cache.delete(idTag);
        if (removed) {
            console.log(`[AuthorizationCache] Removed ${idTag} from cache`);
        }
        return removed;
    }

    /**
     * Clear entire cache
     */
    public clear(): void {
        const count = this.cache.size;
        this.cache.clear();
        console.log(`[AuthorizationCache] Cleared ${count} entries`);
    }

    /**
     * Get cache statistics
     */
    public getStats(): {
        size: number;
        maxEntries: number;
        ttlSeconds: number;
        oldestEntry?: Date;
        newestEntry?: Date;
    } {
        const entries = Array.from(this.cache.values());

        return {
            size: this.cache.size,
            maxEntries: this.maxEntries,
            ttlSeconds: this.ttlSeconds,
            oldestEntry: entries.length > 0
                ? new Date(Math.min(...entries.map(e => e.timestamp.getTime())))
                : undefined,
            newestEntry: entries.length > 0
                ? new Date(Math.max(...entries.map(e => e.timestamp.getTime())))
                : undefined
        };
    }

    /**
     * Get all cached entries (for debugging)
     */
    public getAllEntries(): CacheEntry[] {
        return Array.from(this.cache.values());
    }

    /**
     * Cleanup expired entries
     */
    private cleanupExpired(): void {
        const now = new Date();
        let removed = 0;

        for (const [idTag, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(idTag);
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`[AuthorizationCache] Cleaned up ${removed} expired entries`);
        }
    }

    /**
     * Evict oldest entry (LRU)
     */
    private evictOldest(): void {
        let oldestTag: string | null = null;
        let oldestTime = Date.now();

        for (const [idTag, entry] of this.cache.entries()) {
            if (entry.timestamp.getTime() < oldestTime) {
                oldestTime = entry.timestamp.getTime();
                oldestTag = idTag;
            }
        }

        if (oldestTag) {
            this.cache.delete(oldestTag);
            console.log(`[AuthorizationCache] Evicted oldest entry: ${oldestTag}`);
        }
    }
}

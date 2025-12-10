import { LocalAuthList, IdTagInfo } from './LocalAuthList';
import { AuthorizationCache } from './AuthorizationCache';
import { ConfigurationManager } from './ConfigurationManager';
import { ChargePoint } from './ChargePoint';

export class AuthorizationManager {
    private localAuthList: LocalAuthList;
    private authCache: AuthorizationCache;
    private configManager: ConfigurationManager;
    private chargePoint: ChargePoint;
    private activeTransactions: Map<string, number> = new Map(); // idTag -> transactionId

    constructor(
        chargePoint: ChargePoint,
        configManager: ConfigurationManager,
        chargePointId: string
    ) {
        this.chargePoint = chargePoint;
        this.configManager = configManager;

        // Initialize components
        const maxListLength = configManager.getValueAsNumber('LocalAuthListMaxLength', 100);
        this.localAuthList = new LocalAuthList(chargePointId, maxListLength);
        this.authCache = new AuthorizationCache(86400, 100); // 24 hours, 100 entries

        console.log('[AuthorizationManager] Initialized');
    }

    /**
     * Authorize an ID tag following the proper flow:
     * 1. Check authorization cache (if enabled)
     * 2. Check local authorization list (if enabled)
     * 3. Ask central system (if connected)
     * 4. Reject or allow offline (based on configuration)
     */
    public async authorize(idTag: string): Promise<IdTagInfo> {
        console.log(`[AuthorizationManager] Authorizing ${idTag}`);

        // Step 1: Check authorization cache
        if (this.configManager.getValueAsBoolean('AuthorizationCacheEnabled', true)) {
            const cachedInfo = this.authCache.get(idTag);
            if (cachedInfo) {
                console.log(`[AuthorizationManager] Using cached authorization for ${idTag}: ${cachedInfo.status}`);
                return cachedInfo;
            }
        }

        // Step 2: Check local authorization list
        if (this.configManager.getValueAsBoolean('LocalAuthListEnabled', true)) {
            const localInfo = this.localAuthList.getIdTagInfo(idTag);
            if (localInfo) {
                console.log(`[AuthorizationManager] Found ${idTag} in local list: ${localInfo.status}`);

                // Cache the result
                if (this.configManager.getValueAsBoolean('AuthorizationCacheEnabled', true)) {
                    this.authCache.set(idTag, localInfo);
                }

                return localInfo;
            }
        }

        // Step 3: Ask central system (if connected)
        if (this.chargePoint.isConnectedToServer()) {
            try {
                console.log(`[AuthorizationManager] Requesting authorization from central system for ${idTag}`);
                const response = await this.chargePoint.sendAuthorize(idTag);

                // Cache the result
                if (this.configManager.getValueAsBoolean('AuthorizationCacheEnabled', true)) {
                    this.authCache.set(idTag, response.idTagInfo);
                }

                console.log(`[AuthorizationManager] Central system response for ${idTag}: ${response.idTagInfo.status}`);
                return response.idTagInfo;
            } catch (error) {
                console.error(`[AuthorizationManager] Error authorizing with central system:`, error);
                // Fall through to offline handling
            }
        }

        // Step 4: Offline handling
        const allowOffline = this.configManager.getValueAsBoolean('AllowOfflineTxForUnknownId', false);

        if (allowOffline) {
            console.log(`[AuthorizationManager] Offline mode: Accepting unknown tag ${idTag}`);
            return {
                status: 'Accepted'
            };
        } else {
            console.log(`[AuthorizationManager] Offline mode: Rejecting unknown tag ${idTag}`);
            return {
                status: 'Invalid'
            };
        }
    }

    /**
     * Check if ID tag has a concurrent transaction
     */
    public hasConcurrentTransaction(idTag: string): boolean {
        return this.activeTransactions.has(idTag);
    }

    /**
     * Register active transaction for an ID tag
     */
    public registerActiveTransaction(idTag: string, transactionId: number): void {
        this.activeTransactions.set(idTag, transactionId);
        console.log(`[AuthorizationManager] Registered active transaction ${transactionId} for ${idTag}`);
    }

    /**
     * Unregister active transaction for an ID tag
     */
    public unregisterActiveTransaction(idTag: string): void {
        this.activeTransactions.delete(idTag);
        console.log(`[AuthorizationManager] Unregistered active transaction for ${idTag}`);
    }

    /**
     * Get local authorization list
     */
    public getLocalAuthList(): LocalAuthList {
        return this.localAuthList;
    }

    /**
     * Get authorization cache
     */
    public getAuthCache(): AuthorizationCache {
        return this.authCache;
    }

    /**
     * Clear authorization cache
     */
    public clearCache(): void {
        this.authCache.clear();
    }

    /**
     * Get statistics
     */
    public getStatistics(): {
        localListVersion: number;
        localListCount: number;
        cacheStats: any;
        activeTransactions: number;
    } {
        return {
            localListVersion: this.localAuthList.getVersion(),
            localListCount: this.localAuthList.getCount(),
            cacheStats: this.authCache.getStats(),
            activeTransactions: this.activeTransactions.size
        };
    }
}

import type { IStorage } from '../storage/storage.interface';
import type { TransformChain } from '../transform/transform-chain';
import { getByteSize } from '../vault/helpers';
import type { DataRecord, StorageStats } from '../vault/types';

/**
 * Collects storage statistics independently from the vault.
 *
 * This is a detachable concern — you can create a statistics collector
 * when you need metrics, or skip it entirely for production where
 * stats are not needed (zero overhead).
 *
 * @example Attach statistics
 * ```typescript
 * const vault = getStorageSlice('DATA');
 * const stats = new StorageStatistics(vault);
 * console.log(stats.collect());
 * ```
 *
 * @example Skip statistics (no collector, no overhead)
 * ```typescript
 * const vault = getStorageSlice('DATA');
 * // No stats collector — nothing to remove
 * ```
 */
class StorageStatistics {
  constructor(
    private storage: IStorage,
    private storageKey: string,
    private transformChain: TransformChain,
    private maxSizeBytes: number
  ) {}

  /**
   * Collects and returns current storage statistics.
   *
   * @param getAllData - A function that reads and parses all data from the vault.
   *                     This is injected to avoid duplicating the vault's read logic.
   * @returns A StorageStats object with item count, size, quota usage, etc.
   */
  collect(getAllData: () => DataRecord): StorageStats {
    if (!this.storage.isAvailable()) {
      return {
        itemCount: 0,
        sizeBytes: 0,
        stringLength: 0,
        maxSizeBytes: this.maxSizeBytes,
        quotaPercentage: 0,
        storageType: 'unavailable',
      };
    }

    const data = getAllData();
    const itemCount = Object.keys(data).length;
    const dataStr = JSON.stringify(data);
    const sizeBytes = getByteSize(dataStr);
    const quotaPercentage = (sizeBytes / this.maxSizeBytes) * 100;

    return {
      itemCount,
      sizeBytes,
      stringLength: dataStr.length,
      maxSizeBytes: this.maxSizeBytes,
      quotaPercentage,
      storageType: this.storage.getStorageType(),
    };
  }
}

export { StorageStatistics };

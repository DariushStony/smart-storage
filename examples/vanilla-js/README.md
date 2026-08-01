# Vanilla JavaScript Example

This example demonstrates how to use `@faravahar/smart-storage` in a vanilla JavaScript/TypeScript environment.

## 🚀 Running the Example

1. Build the library first:

   ```bash
   cd ../..
   pnpm install
   pnpm build
   ```

2. Open `index.html` in your browser
3. Open the browser console to see the output

## 📋 What's Included

This example covers:

- ✅ Basic storage operations (setItem, getItem, removeItem)
- ✅ TTL (time-to-live) with automatic expiration
- ✅ Storage slices for organizing data
- ✅ Different storage types (local, session, in-memory)
- ✅ Storage statistics and monitoring
- ✅ Error handling

## 📖 Key Concepts Demonstrated

### Basic Operations

```javascript
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

// Store data
storage.setItem('username', 'dariush');
storage.setItem('settings', { theme: 'dark', lang: 'en' });

// Retrieve data
const username = storage.getItem('username');
const settings = storage.getItem('settings');

// Remove data
storage.removeItem('username');
```

### TTL (Auto-Expiry)

```javascript
// Cache for 5 minutes
storage.setItem('cache:products', data, 5 * 60 * 1000);

// Check remaining time
const remaining = storage.getRemainingTTL('cache:products');
console.log(`Expires in ${Math.floor(remaining / 1000)} seconds`);
```

### Storage Types

```javascript
// localStorage (default) - persists across sessions
const persistent = getStorageSlice('DATA', { storageType: 'local' });

// sessionStorage - cleared when tab closes
const session = getStorageSlice('TEMP', { storageType: 'session' });

// in-memory - cleared on page reload
const memory = getStorageSlice('TEST', { storageType: 'in-memory' });
```

### Monitoring & Stats

```javascript
import { StorageStatistics } from '@faravahar/smart-storage';

// Statistics are opt-in — build one from the vault's accessors
const statistics = new StorageStatistics(
  storage.getStorageAdapter(),
  storage.getStorageKey(),
  storage.getTransformChain(),
  storage.getMaxSizeBytes()
);

const stats = statistics.collect(() => storage.getAllData());
console.log(`Items: ${stats.itemCount}`);
console.log(`Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
console.log(`Quota: ${stats.quotaPercentage.toFixed(1)}%`);

// Cleanup expired items
const removed = storage.cleanupExpiredItems();
console.log(`Removed ${removed} expired items`);
```

## 🔗 Next Steps

- Read the [complete API documentation](../../README.md)
- Learn about [transforms](../../README.md#-transform-pipeline)
- See the [singleton behavior](../../docs/SINGLETON_PATTERN_VISUAL.md)
- Understand the [architecture](../../docs/ARCHITECTURE.md)

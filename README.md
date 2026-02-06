# @dariushstony/smart-storage

[![npm version](https://badge.fury.io/js/@dariushstony%2Fsmart-storage.svg)](https://www.npmjs.com/package/@dariushstony/smart-storage)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

A **robust, SSR-safe, and production-ready wrapper** around Web Storage (`localStorage` / `sessionStorage` / `in-memory`) with:

- 🗄️ Three storage types: `'local'`, `'session'`, `'in-memory'`
- ⏱️ TTL-based expiration
- ⚡ Debounced writes
- 🧹 Automatic cleanup
- 🔄 SSR-safe with automatic fallback
- 🛡️ Strong safety guarantees and detailed diagnostics
- 📦 Dual package: ESM and CommonJS support

Designed for **real-world frontend applications** where correctness, performance, and edge-case handling matter.

---

## 📦 Installation

```bash
npm install @dariushstony/smart-storage
# or
yarn add @dariushstony/smart-storage
# or
pnpm add @dariushstony/smart-storage
```

**Works with:**

- ✅ ESM (`import`)
- ✅ CommonJS (`require`)
- ✅ TypeScript
- ✅ Node.js 18+
- ✅ Modern browsers
- ✅ SSR frameworks (Next.js, Nuxt, etc.)

---

## ⚠️ Security Warning (Read This First)

**Web Storage is NOT secure.**

- Data is fully accessible via JavaScript
- Vulnerable to XSS
- Easily inspectable by users

❌ **Do NOT store**:

- Auth tokens
- Passwords
- Sensitive user data

✅ **Use instead**:

- `httpOnly` cookies
- Secure server-side sessions

Treat **all stored data as potentially compromised** and validate on read.

---

## ✨ Features

- ✅ Three storage types: `'local'`, `'session'`, `'in-memory'`
- ✅ Safe SSR support (no `window` access on server)
- ✅ TTL (time-to-live) expiration
- ✅ Automatic expired-item cleanup
- ✅ Debounced writes (default: 100ms)
- ✅ Read-after-write consistency
- ✅ QuotaExceeded recovery logic
- ✅ Prototype-pollution protection
- ✅ Singleton per storage slice + type
- ✅ Detailed stats & diagnostics
- ✅ Zero dependencies

---

## 📤 Exports

```typescript
// Main exports
import {
  getStorageSlice, // Create custom storage slices
  disposeStorageSlice, // Clean up temporary slices
  StorageVault, // Class for advanced usage
} from '@dariushstony/smart-storage';

// Type exports
import type {
  StorageLogger,
  StorageType, // 'local' | 'session' | 'in-memory'
  StorageVaultOptions,
  StorageStats,
  StorageTransform,
  StoredData,
  DataRecord,
} from '@dariushstony/smart-storage';
```

---

## 🗄️ Storage Types

StorageVault supports three storage backends:

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

// 'local' - localStorage (persists across browser sessions)
const persistent = getStorageSlice('USER_DATA', {
  storageType: 'local', // Default
});

// 'session' - sessionStorage (cleared when tab closes)
const temporary = getStorageSlice('WIZARD_STATE', {
  storageType: 'session',
});

// 'in-memory' - Map (cleared on page reload, great for testing)
const testing = getStorageSlice('TEST_DATA', {
  storageType: 'in-memory',
});
```

### When to use each type

| Type              | Persistence       | Use Case                                |
| ----------------- | ----------------- | --------------------------------------- |
| **`'local'`**     | Across sessions   | User preferences, cart, long-term cache |
| **`'session'`**   | Until tab closes  | Wizard flows, temporary form data       |
| **`'in-memory'`** | Until page reload | Testing, SSR fallback, temporary data   |

---

## 🚀 Quick Start

### ESM (Modern JavaScript)

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

// Create a storage slice (localStorage by default)
const storage = getStorageSlice('MY_APP');

// Store data
storage.setItem('theme', 'dark');

// Retrieve data
const theme = storage.getItem<string>('theme');
console.log(theme); // → "dark"
```

### CommonJS (Node.js)

```javascript
const { getStorageSlice } = require('@dariushstony/smart-storage');

// Create a storage slice
const storage = getStorageSlice('MY_APP');

// Works the same way!
storage.setItem('user', { name: 'dariush', id: 123 });
```

### TypeScript

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

interface User {
  name: string;
  id: number;
}

const storage = getStorageSlice('MY_APP');

// Store with TTL (auto-expiry)
storage.setItem<User>('user', { name: 'dariush', id: 123 });

// Retrieve with type safety
const user = storage.getItem<User>('user');
if (user) {
  console.log(user.name); // TypeScript knows the shape!
}
```

---

## 🧩 Storage Slices (Recommended)

All data is stored as one JSON blob per slice. Slices help reduce re-serialization costs and isolate concerns.

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

// Persistent user preferences
const userPrefs = getStorageSlice('USER_PREFERENCES', {
  storageType: 'local', // Default
});

// Temporary session cache
const tempCache = getStorageSlice('TEMP_CACHE', {
  storageType: 'session',
});

// Testing data
const testData = getStorageSlice('TEST_DATA', {
  storageType: 'in-memory',
});

userPrefs.setItem('theme', 'dark');
tempCache.setItem('data', { value: 123 }, 5 * 60 * 1000); // 5 min TTL
```

### When to use slices

- ✅ Split data by update frequency
- ✅ Isolate large or experimental data
- ✅ Avoid rewriting unrelated data on each update

### Examples

❌ **Bad** - Too granular:

```typescript
getStorageSlice('USER_NAME');
getStorageSlice('USER_EMAIL');
```

✅ **Good** - Grouped logically:

```typescript
getStorageSlice('USER_DATA');
```

---

## ⏱ TTL (Time-to-Live)

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

const storage = getStorageSlice('MY_APP');

// Expires in 1 hour
storage.setItem('token', 'abc123', 60 * 60 * 1000);

// Never expires
storage.setItem('config', { theme: 'dark' });

// Immediately deletes (TTL = 0)
storage.setItem('temp', 'data', 0);
```

### Get remaining TTL

```typescript
const remainingMs = storage.getRemainingTTL('token');
if (remainingMs) {
  console.log(`Expires in ${Math.floor(remainingMs / 1000)} seconds`);
}
```

### Update value without changing TTL

```typescript
storage.setItem('counter', 0, 60000); // Expires in 1 minute
storage.updateItem('counter', 5); // Updates value, keeps same expiry
```

### Extend TTL

```typescript
storage.extendTTL('token', 30 * 60 * 1000); // +30 minutes
```

**Note:** If the item had no expiry, `extendTTL` will add one starting from now.

---

## 🧹 Cleanup

### Automatic

- Expired items are removed on read
- Cleanup runs automatically on quota errors

### Manual

```typescript
const storage = getStorageSlice('MY_APP');
const removedCount = storage.cleanupExpiredItems();
console.log(`Removed ${removedCount} expired items`);
```

---

## ⚡ Debounced Writes (Performance)

Writes are debounced (default: 100ms) to batch rapid updates.

- **Reads always see pending writes** (read-after-write consistency)
- **Pending writes flush automatically on page unload** (no data loss)

### Force immediate persistence

```typescript
const storage = getStorageSlice('MY_APP');
storage.flush();
```

### Disable debouncing

```typescript
const criticalStorage = getStorageSlice('CRITICAL_DATA', { debounceMs: 0 });
```

### Custom debounce timing

```typescript
const analyticsStorage = getStorageSlice('ANALYTICS', { debounceMs: 500 });
```

---

## 🖥 SSR Behavior

- **Server:** Automatically uses in-memory storage (Map)
- **Client:** Uses Web Storage (localStorage/sessionStorage based on `storageType`)
- **Important:** Server data is NOT hydrated automatically

### Recommended pattern

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

// Server → pass initial data via props
// Client → re-store in useEffect or client-side code

const storage = getStorageSlice('MY_APP');

// In your client-side initialization:
storage.setItem('data', initialData);
```

### Explicit in-memory for testing

```typescript
const testStorage = getStorageSlice('TEST', {
  storageType: 'in-memory', // No real storage, perfect for tests
  debounceMs: 0, // Immediate writes for predictable tests
});
```

---

## 🧠 Serialization Rules (JSON)

Uses `JSON.stringify()` internally.

### Limitations

- ❌ `Functions`, `undefined`, `Symbol` → silently dropped
- ❌ Circular references → throws error
- ⚠️ `Date` → becomes string (must convert back manually)
- ⚠️ `Map`, `Set`, class instances → lose type information

👉 **Serialize complex types manually before storing.**

---

## 📊 Stats & Debugging

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

const storage = getStorageSlice('MY_APP');
const stats = storage.getStats();
console.log(stats);
```

### Returns

```typescript
{
  itemCount: number;
  sizeBytes: number;
  stringLength: number;
  maxSizeBytes: number;
  quotaPercentage: number;
  storageType: 'localStorage' | 'sessionStorage' | 'memory' | 'unavailable';
}
```

### Example usage

```typescript
const storage = getStorageSlice('MY_APP');
const stats = storage.getStats();
console.log(`Using ${stats.itemCount} items`);
console.log(`Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
console.log(`Quota: ${stats.quotaPercentage.toFixed(1)}%`);

if (stats.quotaPercentage > 80) {
  console.warn('Storage is over 80% full!');
  storage.cleanupExpiredItems();
}
```

---

## 🗑 Clearing Data

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

const storage = getStorageSlice('MY_APP');
storage.clear(); // Clears only this slice
```

**Note:** Other slices are unaffected.

---

## ♻️ Disposing Slices

Useful for temporary or short-lived slices. Removes the instance from the singleton cache and cleans up event listeners.

```typescript
import {
  getStorageSlice,
  disposeStorageSlice,
} from '@dariushstony/smart-storage';

const tempStorage = getStorageSlice('TEMP_SESSION', {
  storageType: 'session',
});

// ... use storage ...

// Clean up when done (must match storageType used when creating)
disposeStorageSlice('TEMP_SESSION', {
  storageType: 'session',
});
```

**Important:** The options passed to `disposeStorageSlice` must match exactly with those used in `getStorageSlice`.

---

## 🧪 Testing Utilities

### Clear all instances

```typescript
import { StorageVault } from '@dariushstony/smart-storage';

// In test teardown:
afterEach(() => {
  StorageVault.clearAllInstances();
});
```

### Use in-memory storage for tests

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';

describe('My tests', () => {
  const testVault = getStorageSlice('TEST_DATA', {
    storageType: 'in-memory', // Isolated, no real storage
    debounceMs: 0, // Immediate writes
  });

  afterEach(() => {
    testVault.clear(); // Clean up after each test
  });

  it('should store data', () => {
    testVault.setItem('key', 'value');
    expect(testVault.getItem('key')).toBe('value');
  });
});
```

Flushes, cleans up, and removes all vault instances.

---

## 🧱 Error Handling & Logging

Inject your own logger (e.g., Sentry):

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';
import type { StorageLogger } from '@dariushstony/smart-storage';

const customLogger: StorageLogger = {
  log: (message, error) => {
    console.error('[Storage]', message, error);
    // Send to Sentry or your logging service
    // Sentry.captureException(error, { extra: { message } });
  },
};

const vault = getStorageSlice('APP_DATA', {
  storageType: 'local',
  logger: customLogger,
});
```

---

## 🔧 Advanced Configuration

```typescript
const customStorage = getStorageSlice('CUSTOM', {
  storageType: 'session', // 'local' | 'session' | 'in-memory'
  debounceMs: 200, // Custom debounce delay
  maxSizeBytes: 10_000_000, // 10MB quota warning threshold
  maxItemsInMemory: 2000, // Max items for in-memory fallback
  logger: customLogger, // Custom logger integration
});
```

### Configuration Options

| Option             | Type                                  | Default      | Description                            |
| ------------------ | ------------------------------------- | ------------ | -------------------------------------- |
| `storageType`      | `'local' \| 'session' \| 'in-memory'` | `'local'`    | Storage backend to use                 |
| `storageKey`       | `string`                              | `'APP_DATA'` | Key under which to store data          |
| `debounceMs`       | `number`                              | `100`        | Write debouncing delay (0 = immediate) |
| `maxSizeBytes`     | `number`                              | `4_000_000`  | Quota warning threshold (~4MB)         |
| `maxItemsInMemory` | `number`                              | `1000`       | Max items for in-memory storage        |
| `logger`           | `StorageLogger`                       | `undefined`  | Custom error logger                    |

---

## 📚 API Reference

### Write Operations

| Method                          | Returns   | Description                            |
| ------------------------------- | --------- | -------------------------------------- |
| `setItem(key, value, ttl?)`     | `boolean` | Stores a value with optional TTL       |
| `updateItem(key, newValue)`     | `boolean` | Updates value without changing TTL     |
| `removeItem(key)`               | `boolean` | Removes an item                        |
| `clear()`                       | `boolean` | Clears all data for this slice         |
| `extendTTL(key, additionalTTL)` | `boolean` | Extends TTL or adds one if none exists |

### Read Operations

| Method                 | Returns                   | Description                              |
| ---------------------- | ------------------------- | ---------------------------------------- |
| `getItem<T>(key)`      | `T \| null`               | Retrieves a value                        |
| `hasItem(key)`         | `boolean`                 | Checks if item exists and is not expired |
| `getRemainingTTL(key)` | `number \| null`          | Returns remaining TTL in milliseconds    |
| `getAllKeys()`         | `string[]`                | Returns all valid keys                   |
| `getAll()`             | `Record<string, unknown>` | Returns all valid items                  |

### Maintenance Operations

| Method                  | Returns  | Description                          |
| ----------------------- | -------- | ------------------------------------ |
| `cleanupExpiredItems()` | `number` | Removes expired items, returns count |
| `flush()`               | `void`   | Flushes pending debounced writes     |
| `getCurrentSize()`      | `number` | Returns storage size in bytes        |
| `getStats()`            | `object` | Returns detailed storage statistics  |

---

## 🔌 Transform Pipeline

You can chain multiple transforms (compression, encryption, encoding) to process data before storage:

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';
import type { StorageTransform } from '@dariushstony/smart-storage';

// Example: Compression transform (requires lz-string package)
const compressionTransform: StorageTransform = {
  serialize: (data: string) => LZString.compress(data),
  deserialize: (data: string) => LZString.decompress(data) || '',
};

const vault = getStorageSlice('LARGE_DATA', {
  transforms: [compressionTransform],
});

// Data is automatically compressed before storage and decompressed on read
vault.setItem('bigObject', {
  /* large data */
});
```

Transforms are applied in order during writes and reversed during reads.

---

## 🔌 Setup with Custom Logger

If you want to integrate with your logging service (Sentry, LogRocket, etc.):

```typescript
import { getStorageSlice } from '@dariushstony/smart-storage';
import type { StorageLogger } from '@dariushstony/smart-storage';

const customLogger: StorageLogger = {
  log: (message, error) => {
    console.error('[Storage]', message, error);
    // Send to your logging service
    // Sentry.captureException(error, { extra: { message } });
  },
};

const vault = getStorageSlice('APP_DATA', {
  storageType: 'local',
  logger: customLogger,
});
```

---

## 💡 Common Patterns

### Feature Flags with Auto-Expiry

```typescript
const featureFlags = getStorageSlice('FEATURE_FLAGS', {
  storageType: 'local',
});

function enableFeature(name: string, durationMs = 24 * 60 * 60 * 1000) {
  featureFlags.setItem(`feature:${name}`, true, durationMs);
}

function isFeatureEnabled(name: string): boolean {
  return featureFlags.hasItem(`feature:${name}`);
}

enableFeature('new-checkout', 7 * 24 * 60 * 60 * 1000); // 7 days
```

### Rate Limiting

```typescript
const rateLimiter = getStorageSlice('RATE_LIMIT', {
  storageType: 'local',
});

function canPerformAction(action: string, limitMs = 60000): boolean {
  const key = `action:${action}`;
  if (rateLimiter.hasItem(key)) {
    return false; // Rate-limited
  }

  rateLimiter.setItem(key, true, limitMs);
  return true;
}

if (canPerformAction('send-email', 5 * 60 * 1000)) {
  console.log('Sending email...');
}
```

### Form Draft Auto-Save

```typescript
const draftStorage = getStorageSlice('FORM_DRAFTS', {
  storageType: 'local',
  debounceMs: 1000, // Save 1 second after typing stops
});

function saveDraft(formId: string, data: Record<string, unknown>) {
  draftStorage.setItem(`draft:${formId}`, data, 24 * 60 * 60 * 1000);
}

function loadDraft(formId: string) {
  return draftStorage.getItem<Record<string, unknown>>(`draft:${formId}`);
}
```

### Temporary Wizard Flow

```typescript
const wizardStorage = getStorageSlice('CHECKOUT_WIZARD', {
  storageType: 'session', // Auto-cleared when tab closes
});

function saveWizardStep(step: number, data: any) {
  wizardStorage.setItem('currentStep', step);
  wizardStorage.setItem('formData', data);
}

// Data automatically cleared when user closes tab - no cleanup needed!
```

---

## 🏁 Design Philosophy

- **Prefer correctness over cleverness**
- **Defensive by default**
- **Explicit trade-offs**
- **Optimized for real production constraints**

This is infrastructure code, not a toy utility.

---

## 📚 Additional Documentation

- **Architecture**: `docs/ARCHITECTURE.md` - System design and technical decisions
- **Storage Architecture**: `docs/STORAGE_ARCHITECTURE.md` - Deep dive into storage mechanisms
- **How to Use**: `docs/HOW_TO_USE_STORAGE.md` - Simple examples and patterns
- **Project Structure**: `docs/STRUCTURE.md` - Codebase organization

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## 👤 Author

**Dariush Hadipour**

- GitHub: [@DariushStony](https://github.com/DariushStony)
- Package: [@dariushstony/smart-storage](https://www.npmjs.com/package/@dariushstony/smart-storage)

---

## 🎓 Quick Reference

### Storage Types

```typescript
'local'; // localStorage - persists across sessions
'session'; // sessionStorage - cleared on tab close
'in-memory'; // Map - cleared on reload, great for tests
```

### Common Use Cases

| Use Case         | Storage Type             | TTL      | Debounce        |
| ---------------- | ------------------------ | -------- | --------------- |
| User preferences | `'local'`                | None     | 0ms (immediate) |
| Shopping cart    | `'local'`                | None     | 100ms           |
| API cache        | `'local'`                | 5-10 min | 200ms           |
| Feature flags    | `'local'`                | 7 days   | 100ms           |
| Wizard flow      | `'session'`              | None     | 100ms           |
| Form drafts      | `'local'` or `'session'` | 24 hours | 1000ms          |
| Testing          | `'in-memory'`            | Varies   | 0ms             |

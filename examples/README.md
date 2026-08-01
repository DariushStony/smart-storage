# Examples

This folder contains practical usage examples for `@faravahar/smart-storage`.

## 📂 Available Examples

### [vanilla-js/](./vanilla-js/)

Vanilla JavaScript/TypeScript examples showing:

- Basic storage operations
- TTL (time-to-live) usage
- Storage slices
- Error handling

See the [interactive demo](./vanilla-js/index.html) for hands-on examples.

## 🚀 Running Examples

### Vanilla JS Example

```bash
cd examples/vanilla-js
open index.html
```

Open the browser console to see the examples in action.

## 📚 More Examples

For comprehensive examples and patterns, see:

- **[docs/HOW_TO_USE_STORAGE.md](../docs/HOW_TO_USE_STORAGE.md)** - Usage guide with examples
- **[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)** - Architecture patterns and examples

## 💡 Common Use Cases

### User Preferences

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const prefs = getStorageSlice('USER_PREFS');
prefs.setItem('theme', 'dark');
prefs.setItem('language', 'en');
```

### API Cache with TTL

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const cache = getStorageSlice('API_CACHE');

// Cache for 5 minutes
cache.setItem('products', productsData, 5 * 60 * 1000);
```

### Session Storage

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

// Cleared when tab closes
const session = getStorageSlice('WIZARD', {
  storageType: 'session',
});

session.setItem('currentStep', 2);
```

### Testing with In-Memory Storage

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const testStorage = getStorageSlice('TEST', {
  storageType: 'in-memory',
  debounceMs: 0, // Immediate writes for tests
});

testStorage.setItem('key', 'value');
```

## 🔧 Advanced Examples

### Transform Chain (Compression)

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';
import type { StorageTransform } from '@faravahar/smart-storage';
import LZString from 'lz-string';

const compressionTransform: StorageTransform = {
  serialize: (data) => LZString.compress(data),
  deserialize: (data) => LZString.decompress(data) || '',
};

const vault = getStorageSlice('LARGE_DATA', {
  transforms: [compressionTransform],
});

vault.setItem('bigObject', largeData); // Automatically compressed
```

### Custom Logger Integration

Logging is opt-in: add a `LoggingHandler` to the transform chain rather than
passing a logger option.

```typescript
import { getStorageSlice, LoggingHandler } from '@faravahar/smart-storage';
import type { StorageLogger } from '@faravahar/smart-storage';

const logger: StorageLogger = {
  log: (message, error) => {
    console.error('[Storage]', message, error);
    // Send to your logging service
  },
};

const vault = getStorageSlice('APP', {
  transforms: [new LoggingHandler(logger)],
});
```

## 📖 Documentation

For complete API documentation, see:

- [Main README](../README.md)
- [API Reference](../README.md#-api-reference)
- [Architecture Guide](../docs/ARCHITECTURE.md)

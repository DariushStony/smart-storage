# Storage Utility - Architecture Overview

## 📁 File Structure

```
storage/
├── index.ts                    # Main entry point & public API
├── vault.ts                    # Core StorageVault class
├── types.ts                    # TypeScript interfaces & types
├── constants.ts                # Configuration constants
├── helpers.ts                  # Utility functions
├── transforms.ts               # Transform pipeline manager
├── storage-backend.ts          # Storage abstraction layer
├── setup.ts                    # Setup utilities (existing)
├── README.md                   # Documentation (existing)
└── docs/                       # Additional docs (existing)
```

## 🎯 Separation of Concerns

### 1. **index.ts** - Public API

- Main entry point for consumers
- Exports public functions: `getStorageSlice()`, `disposeStorageSlice()`, `defaultStorageVault`
- Exports types and constants
- Contains comprehensive JSDoc

### 2. **vault.ts** - Core Logic

- `StorageVault` class implementation
- Singleton pattern management
- All CRUD operations (setItem, getItem, updateItem, etc.)
- TTL management
- Debouncing logic
- Public API methods

**Responsibilities:**

- Data lifecycle management
- Expiry handling
- Read-after-write consistency
- Quota management

### 3. **types.ts** - Type Definitions

- All TypeScript interfaces and types
- `StorageType`, `StorageLogger`, `StorageTransform`
- `StorageVaultOptions`, `StorageStats`
- `StoredData<T>`, `DataRecord`

**Benefits:**

- Single source of truth for types
- Easy to import and reuse
- Clear type contracts

### 4. **constants.ts** - Configuration

- Default values and magic numbers
- `DEFAULT_STORAGE_KEY`, `DEFAULT_MAX_SIZE_BYTES`
- `DEFAULT_DEBOUNCE_MS`, `DANGEROUS_KEYS`

**Benefits:**

- Easy to modify defaults
- No hardcoded values in logic
- Clear configuration

### 5. **helpers.ts** - Utility Functions

- Pure utility functions
- `validateKey()`, `isExpired()`, `getByteSize()`
- `isQuotaExceededError()`, `isCircularReferenceError()`
- `isValidDataRecord()`

**Benefits:**

- Testable in isolation
- Reusable across modules
- No side effects

### 6. **transforms.ts** - Transform Pipeline

- `TransformPipeline` class
- Manages chaining of transforms
- Applies transforms in order
- Reverses transforms on read

**Responsibilities:**

- Transform orchestration
- Error handling for transforms
- Pipeline validation

### 7. **storage-backend.ts** - Storage Abstraction

- `StorageBackend` class
- Abstracts localStorage/sessionStorage/Map
- Handles storage initialization
- Manages event listeners

**Responsibilities:**

- Storage type selection
- Fallback logic (SSR, private mode)
- Low-level read/write operations
- Browser event management

### 8. **Documentation Files**

- Usage examples and patterns
- Documentation in `docs/` and `examples/` folders

## 🔄 Data Flow

### Write Flow

```
User Code
    ↓
StorageVault.setItem()
    ↓
getAllData() → validate key → create StoredData
    ↓
saveAllData() → debounce (optional)
    ↓
saveAllDataImmediate()
    ↓
JSON.stringify() → DataRecord to JSON string
    ↓
TransformPipeline.apply() → transform1 → transform2 → ...
    ↓
StorageBackend.write() → Web Storage or Map
```

### Read Flow

```
User Code
    ↓
StorageVault.getItem()
    ↓
getAllData()
    ↓
Check dirtyData (pending writes)
    ↓
StorageBackend.read() → raw string from storage
    ↓
TransformPipeline.reverse() → transformN → ... → transform1
    ↓
JSON.parse() → DataRecord
    ↓
Check expiry → return value or null
```

## 🚀 Transform Pipeline

### Architecture

```typescript
interface StorageTransform {
  serialize: (data: string) => string; // JSON → transformed
  deserialize: (data: string) => string; // transformed → JSON
}
```

### Flow

```
Write: JSON → transform₁ → transform₂ → ... → transformₙ → storage
Read:  storage → reverse transformₙ → ... → reverse transform₁ → JSON
```

### Use Cases

1. **Compression** - Reduce storage size (LZ-String, pako)
2. **Encryption** - Secure sensitive data (Web Crypto API)
3. **Encoding** - Base64, hex encoding
4. **Migration** - Version management and data migration
5. **Obfuscation** - Hide data from casual inspection

## 📊 Class Diagram

```
┌─────────────────────────┐
│   StorageVault          │
│  (main coordinator)     │
├─────────────────────────┤
│ - backend              │─────┐
│ - transformPipeline    │─┐   │
│ - storageKey           │ │   │
│ - logger               │ │   │
│ - debounceMs           │ │   │
│ - dirtyData            │ │   │
├─────────────────────────┤ │   │
│ + setItem()            │ │   │
│ + getItem()            │ │   │
│ + updateItem()         │ │   │
│ + removeItem()         │ │   │
│ + clear()              │ │   │
│ + flush()              │ │   │
│ + getStats()           │ │   │
└─────────────────────────┘ │   │
                            │   │
         ┌──────────────────┘   │
         │                      │
         ▼                      ▼
┌─────────────────┐   ┌──────────────────┐
│ TransformPipe.. │   │ StorageBackend   │
├─────────────────┤   ├──────────────────┤
│ - transforms[]  │   │ - storage        │
│ - logger        │   │ - storageType    │
├─────────────────┤   │ - unloadHandler  │
│ + apply()       │   ├──────────────────┤
│ + reverse()     │   │ + read()         │
└─────────────────┘   │ + write()        │
                      │ + remove()       │
                      │ + isAvailable()  │
                      │ + cleanup()      │
                      └──────────────────┘
```

## 🎨 Design Patterns Used

### 1. **Singleton Pattern**

- `StorageVault.getInstance()` ensures one instance per storage key + type
- Prevents data duplication and sync issues

### 2. **Strategy Pattern**

- `StorageTransform` interface allows pluggable transformation strategies
- Different transforms can be swapped without changing core logic

### 3. **Facade Pattern**

- `StorageVault` provides simple API hiding complex internal operations
- Users don't need to know about transforms, debouncing, or backends

### 4. **Adapter Pattern**

- `StorageBackend` adapts different storage types (localStorage, sessionStorage, Map)
- Uniform interface regardless of underlying storage

### 5. **Pipeline Pattern**

- `TransformPipeline` chains multiple transforms
- Composable and extensible

## ✅ Benefits of Refactoring

### Before (1141 lines, one file)

- ❌ Hard to navigate and understand
- ❌ Difficult to test individual pieces
- ❌ Tight coupling between concerns
- ❌ Hard to extend with new features

### After (8 files, ~200 lines each)

- ✅ Clear separation of concerns
- ✅ Easy to test each module
- ✅ Loose coupling via interfaces
- ✅ Easy to add new transforms or storage types
- ✅ Better code organization
- ✅ More maintainable and scalable
- ✅ Clear module boundaries

## 🔧 Extensibility Examples

### Adding a New Storage Type

1. Update `StorageType` in `types.ts`
2. Modify `StorageBackend.initialize()` in `storage-backend.ts`

### Adding a New Transform

1. Implement `StorageTransform` interface
2. Pass to `getStorageSlice({ transforms: [...] })`

### Adding a New Utility

1. Add pure function to `helpers.ts`
2. Import and use in `vault.ts`

## 📚 Import Examples

```typescript
// Main API
import { getStorageSlice, defaultStorageVault } from '@/utils/storage';

// Types
import type { StorageTransform, StorageVaultOptions } from '@/utils/storage';

// Constants (for advanced usage)
import { DEFAULT_DEBOUNCE_MS } from '@/utils/storage';

// Class (for direct instantiation - rare)
import { StorageVault } from '@/utils/storage';
```

## 🧪 Testing Strategy

Each module can be tested independently:

- **helpers.ts** - Pure functions, easy unit tests
- **transforms.ts** - Mock transforms, test pipeline
- **storage-backend.ts** - Mock storage types
- **vault.ts** - Integration tests with mocked dependencies

## 📈 Performance Characteristics

- **Read**: O(1) for in-memory cache, O(n) for expired item cleanup
- **Write**: O(1) with debouncing, O(n) for serialization
- **Transforms**: O(t) where t is number of transforms × data size
- **Memory**: O(n) where n is number of items × average item size

## 🔐 Security Considerations

1. **Transform Pipeline** - Allows encryption for sensitive data
2. **Dangerous Keys** - Prevents prototype pollution
3. **Validation** - All keys validated before use
4. **SSR Safety** - Fallback to in-memory storage
5. **Quota Handling** - Graceful degradation on quota exceeded

## 🚦 Best Practices

1. Use **slices** for different data domains
2. Use **transforms** for large or sensitive data
3. Call **flush()** before critical navigation
4. Monitor **getStats()** for quota usage
5. Handle **expired items** with cleanup
6. Use **debouncing** for high-frequency writes
7. Provide **logger** for production error tracking

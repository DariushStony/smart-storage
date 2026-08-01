# Architecture Overview

How smart-storage is put together, and why.

## 📁 File Structure

```text
src/
├── index.ts                        # Main entry point & public API
│
├── vault/                          # Core logic
│   ├── storage-vault.ts            # StorageVault class
│   ├── helpers.ts                  # Pure utility functions
│   ├── constants.ts                # Configuration constants
│   └── types.ts                    # Options, stats, record types
│
├── storage/                        # Storage abstraction
│   ├── storage.interface.ts        # IStorage contract
│   ├── storage.factory.ts          # Backend selection
│   ├── storage-type.ts             # StorageType constants
│   ├── local-storage.ts            # localStorage adapter
│   ├── session-storage.ts          # sessionStorage adapter
│   ├── in-memory-storage.ts        # Map adapter
│   └── environment.ts              # SSR detection
│
├── transform/                      # Transform chain
│   ├── transform-chain.ts          # TransformChain
│   ├── transform-handler.ts        # Abstract base handler
│   ├── inline-transform-handler.ts # Adapter for plain transforms
│   └── types.ts                    # StorageTransform
│
├── logger/                         # Pluggable logging
│   ├── storage-logger.ts           # StorageLogger interface
│   └── logging-handler.ts          # Logging as a chain handler
│
└── statistics/                     # Pluggable statistics
    └── storage-statistics.ts       # StorageStatistics
```

Every folder carries an `index.ts` barrel export.

## 🎯 Separation of Concerns

### 1. `index.ts` — Public API

- Main entry point for consumers
- Exports `getStorageSlice()` and `disposeStorageSlice()`
- Re-exports the `StorageVault` class, `StorageType`, transform and logging
  primitives, `StorageStatistics`, and all public types
- Contains comprehensive JSDoc

### 2. `vault/storage-vault.ts` — Core Logic

- `StorageVault` class implementation
- Singleton management (one instance per storage key + storage type)
- All CRUD operations (`setItem`, `getItem`, `updateItem`, …)
- TTL management and debouncing

**Responsibilities:** data lifecycle, expiry handling, read-after-write
consistency, quota management.

### 3. `vault/types.ts` — Type Definitions

- `StorageVaultOptions`, `StorageStats`
- `StoredData<T>`, `DataRecord`

Storage and transform types live next to their own modules
(`storage/storage-type.ts`, `transform/types.ts`), keeping each module's
contract beside its implementation.

### 4. `vault/constants.ts` — Configuration

- `DEFAULT_STORAGE_KEY`, `DEFAULT_MAX_SIZE_BYTES`
- `DEFAULT_MAX_ITEMS_IN_MEMORY`, `DEFAULT_DEBOUNCE_MS`, `DANGEROUS_KEYS`

### 5. `vault/helpers.ts` — Utility Functions

- `validateKey()`, `isExpired()`, `getByteSize()`
- `isQuotaExceededError()`, `isCircularReferenceError()`
- `isValidDataRecord()`

**Benefits:** testable in isolation, reusable, no side effects.

### 6. `transform/` — Transform Chain

- `TransformChain` — a Chain of Responsibility, not a flat pipeline
- `TransformHandler` — abstract base class for custom handlers
- `InlineTransformHandler` — adapts a plain `{ serialize, deserialize }` object
  into a handler

**Responsibilities:** transform orchestration, error handling, chain validation.

### 7. `storage/` — Storage Abstraction

- `IStorage` — the contract every backend implements
- `createStorage()` — factory selecting `LocalStorage`, `SessionStorage`, or
  `InMemoryStorage`
- `environment.ts` — SSR detection driving the in-memory fallback

**Responsibilities:** storage selection, fallback logic (SSR, private mode),
low-level read/write, browser event management.

### 8. `logger/` and `statistics/` — Pluggable Concerns

Neither is a constructor option, and neither is built into the vault:

- **Logging** — add a `LoggingHandler` to the transform chain
- **Statistics** — construct a `StorageStatistics` on demand

Skip them and you pay no cost.

## 🔄 Data Flow

### Write Flow

```text
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
TransformChain.apply() → handler₁ → handler₂ → ...
    ↓
IStorage.write() → Web Storage or Map
```

### Read Flow

```text
User Code
    ↓
StorageVault.getItem()
    ↓
getAllData()
    ↓
Check dirtyData (pending writes)
    ↓
IStorage.read() → raw string from storage
    ↓
TransformChain.reverse() → handlerₙ → ... → handler₁
    ↓
JSON.parse() → DataRecord
    ↓
Check expiry → return value or null
```

## 🚀 Transform Chain

### Architecture

```typescript
interface StorageTransform {
  serialize: (data: string) => string; // JSON → transformed
  deserialize: (data: string) => string; // transformed → JSON
}
```

Plain objects like the above are accepted and wrapped automatically. For
stateful or reusable transforms, extend `TransformHandler` instead.

### Flow

```text
Write: JSON → handler₁ → handler₂ → ... → handlerₙ → storage
Read:  storage → reverse handlerₙ → ... → reverse handler₁ → JSON
```

### Use Cases

1. **Compression** - Reduce storage size (LZ-String, pako)
2. **Encryption** - Secure sensitive data (Web Crypto API)
3. **Encoding** - Base64, hex encoding
4. **Migration** - Version management and data migration
5. **Obfuscation** - Hide data from casual inspection

## 📊 Class Diagram

```text
┌──────────────────────────┐
│   StorageVault           │
│  (main coordinator)      │
├──────────────────────────┤
│ - storage: IStorage      │──────────┐
│ - transformChain         │────┐     │
│ - storageKey             │    │     │
│ - maxSizeBytes           │    │     │
│ - maxItemsInMemory       │    │     │
│ - debounceMs             │    │     │
│ - dirtyData              │    │     │
├──────────────────────────┤    │     │
│ + setItem()              │    │     │
│ + getItem()              │    │     │
│ + updateItem()           │    │     │
│ + removeItem()           │    │     │
│ + clear()                │    │     │
│ + flush()                │    │     │
│ + getAllData()           │    │     │
└──────────────────────────┘    │     │
                                ▼     ▼
             ┌──────────────────┐   ┌──────────────────┐
             │ TransformChain   │   │ IStorage         │
             ├──────────────────┤   │  (interface)     │
             │ - handlers[]     │   ├──────────────────┤
             ├──────────────────┤   │ + read()         │
             │ + apply()        │   │ + write()        │
             │ + reverse()      │   │ + remove()       │
             │ + hasTransforms()│   │ + isAvailable()  │
             │ + from() [static]│   │ + getStorage()   │
             └──────────────────┘   │ + getStorageType()│
                      ▲             │ + cleanup()      │
                      │             └──────────────────┘
             ┌──────────────────┐            ▲
             │ TransformHandler │            │
             │   (abstract)     │   ┌────────┴────────┬─────────────┐
             ├──────────────────┤   │                 │             │
             │ # process()      │  LocalStorage  SessionStorage  InMemoryStorage
             └──────────────────┘
                      ▲
       ┌──────────────┴──────────────┐
       │                             │
 LoggingHandler          InlineTransformHandler
```

`StorageStatistics` sits outside the vault entirely — it is constructed from the
vault's accessors (`getStorageAdapter()`, `getStorageKey()`,
`getTransformChain()`, `getMaxSizeBytes()`) and reads through a callback.

## 🎨 Design Patterns Used

### 1. **Singleton Pattern**

- `StorageVault.getInstance()` ensures one instance per storage key + type
- Prevents data duplication and sync issues

### 2. **Chain of Responsibility**

- `TransformChain` links `TransformHandler` instances, each deciding what to do
  and delegating onward
- Logging is just another handler in the chain

### 3. **Strategy Pattern**

- `StorageTransform` allows pluggable transformation strategies
- Different transforms can be swapped without changing core logic

### 4. **Facade Pattern**

- `StorageVault` provides a simple API hiding transforms, debouncing, backends

### 5. **Adapter Pattern**

- `IStorage` implementations adapt localStorage, sessionStorage, and `Map`
- `InlineTransformHandler` adapts plain transform objects into handlers

### 6. **Factory Pattern**

- `createStorage()` selects the backend from a `StorageTypeValue`

## ✅ Benefits of the Modular Layout

- ✅ Clear separation of concerns
- ✅ Easy to test each module
- ✅ Loose coupling via interfaces (`IStorage`, `StorageTransform`)
- ✅ Easy to add new transforms or storage types
- ✅ Optional concerns (logging, statistics) cost nothing when unused
- ✅ Clear module boundaries

## 🔧 Extensibility Examples

### Adding a New Storage Type

1. Add the constant to `storage/storage-type.ts`
2. Implement `IStorage` in a new adapter under `storage/`
3. Add the case to `createStorage()` in `storage/storage.factory.ts` — the
   `never` exhaustiveness check will flag it if you forget

### Adding a New Transform

1. Extend `TransformHandler` (or write a plain `StorageTransform` object)
2. Pass it via `getStorageSlice(key, { transforms: [...] })`

### Adding a New Utility

1. Add a pure function to `vault/helpers.ts`
2. Import and use it in `vault/storage-vault.ts`

## 📚 Import Examples

```typescript
// Main API
import {
  getStorageSlice,
  disposeStorageSlice,
} from '@dariushstony/smart-storage';

// Types
import type {
  StorageTransform,
  StorageVaultOptions,
} from '@dariushstony/smart-storage';

// Class (for direct instantiation — rare)
import { StorageVault } from '@dariushstony/smart-storage';
```

## 🧪 Testing Strategy

Each module can be tested independently:

- **`vault/helpers.ts`** — pure functions, easy unit tests
- **`transform/`** — mock handlers, test chain ordering and reversal
- **`storage/`** — swap in `InMemoryStorage`, or mock `IStorage`
- **`vault/storage-vault.ts`** — integration tests with mocked dependencies

Use `storageType: 'in-memory'` with `debounceMs: 0` for deterministic tests, and
`StorageVault.clearAllInstances()` in teardown.

## 📈 Performance Characteristics

- **Read**: O(1) for in-memory cache, O(n) for expired item cleanup
- **Write**: O(1) with debouncing, O(n) for serialization
- **Transforms**: O(t) where t is number of transforms × data size
- **Memory**: O(n) where n is number of items × average item size

## 🔐 Security Considerations

1. **Transform Chain** - Allows encryption for sensitive data
2. **Dangerous Keys** - Prevents prototype pollution
3. **Validation** - All keys validated before use
4. **SSR Safety** - Fallback to in-memory storage
5. **Quota Handling** - Graceful degradation on quota exceeded

## 🚦 Best Practices

1. Use **slices** for different data domains
2. Use **transforms** for large or sensitive data
3. Call **flush()** before critical navigation
4. Monitor quota with **`StorageStatistics.collect()`**
5. Handle **expired items** with cleanup
6. Use **debouncing** for high-frequency writes
7. Add a **`LoggingHandler`** for production error tracking

# Project Structure

How the codebase is organized, and where to look for what.

## Source Layout

```text
📦 src/
│
├── 📄 index.ts                        # 🔑 Public API & entry point (136 lines)
│
├── 🏛️ vault/                          # Core business logic
│   ├── 📄 index.ts                    # Barrel export
│   ├── 🏛️ storage-vault.ts            # StorageVault class (656 lines)
│   ├── 🧰 helpers.ts                  # Validation & expiry helpers (94 lines)
│   ├── 🔢 constants.ts                # Defaults & dangerous keys (34 lines)
│   └── 📋 types.ts                    # Options, stats, records (82 lines)
│
├── 💾 storage/                        # Storage backends
│   ├── 📄 index.ts                    # Barrel export
│   ├── 📐 storage.interface.ts        # IStorage contract (57 lines)
│   ├── 🏭 storage.factory.ts          # Backend selection (26 lines)
│   ├── 🏷️ storage-type.ts             # StorageType constants (28 lines)
│   ├── 💽 local-storage.ts            # localStorage adapter (85 lines)
│   ├── 🗂️ session-storage.ts          # sessionStorage adapter (85 lines)
│   ├── 🧠 in-memory-storage.ts        # Map adapter, SSR/testing (46 lines)
│   └── 🌐 environment.ts              # SSR detection (10 lines)
│
├── 🔄 transform/                      # Transform chain
│   ├── 📄 index.ts                    # Barrel export
│   ├── ⛓️ transform-chain.ts          # Chain of Responsibility (123 lines)
│   ├── 🧩 transform-handler.ts        # Base handler class (110 lines)
│   ├── 🔌 inline-transform-handler.ts # Wraps plain transforms (33 lines)
│   └── 📋 types.ts                    # StorageTransform (77 lines)
│
├── 📣 logger/                         # Pluggable logging
│   ├── 📄 index.ts                    # Barrel export
│   ├── 📐 storage-logger.ts           # StorageLogger interface (9 lines)
│   └── 📝 logging-handler.ts          # Logging as a chain handler (57 lines)
│
└── 📊 statistics/                     # Pluggable statistics
    ├── 📄 index.ts                    # Barrel export
    └── 📈 storage-statistics.ts       # StorageStatistics (70 lines)
```

## Documentation Layout

```text
📚 docs/
├── 📖 README.md                       # Documentation index
├── 📖 ARCHITECTURE.md                 # Architecture & design patterns
├── 📖 STORAGE_ARCHITECTURE.md         # Storage internals & data flow
├── 📖 HOW_TO_USE_STORAGE.md           # Usage tutorial
├── 📖 SINGLETON_PATTERN_VISUAL.md     # Singleton pattern explained
└── 📖 STRUCTURE.md                    # This file
```

## Stats

- 5 source directories
- 24 TypeScript files
- ~1,840 lines of source
- 100% TypeScript
- Zero runtime dependencies

## Key Files

| File                           | Role                                     |
| ------------------------------ | ---------------------------------------- |
| `index.ts`                     | Public API surface                       |
| `vault/storage-vault.ts`       | Main implementation                      |
| `vault/types.ts`               | Type definitions                         |
| `storage/storage.factory.ts`   | Chooses the backend (incl. SSR fallback) |
| `transform/transform-chain.ts` | Transform chain                          |

## Main Exports

- `getStorageSlice()` — create/fetch a slice (singleton per key + type)
- `disposeStorageSlice()` — dispose a single slice
- `StorageVault` — the class, for advanced usage
- `StorageType` — `{ Local, Session, InMemory }`
- `LoggingHandler` — opt-in logging
- `TransformHandler`, `InlineTransformHandler`, `TransformChain` — transforms
- `StorageStatistics` — opt-in statistics
- Supporting types: `StorageVaultOptions`, `StorageStats`, `StorageTransform`,
  `StorageLogger`, `StorageTypeValue`, `IStorage`, `StoredData`, `DataRecord`

# 🏗️ StorageVault Architecture

A visual tour of how a slice moves data from your components down to the browser.

```text
┌─────────────────────────────────────────────────────────────────┐
│                       Your application                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Component   │  │  Component   │  │  Component   │           │
│  │      A       │  │      B       │  │      C       │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                   │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌───────────────────────────────────────────────────┐          │
│  │   getStorageSlice(sliceKey, options)              │          │
│  │                                                   │          │
│  │  One slice per data domain, for example:          │          │
│  │  • 'USER_PREFS'   ← User settings                 │          │
│  │  • 'API_CACHE'    ← API responses                 │          │
│  │  • 'WIZARD_STATE' ← Temporary state (session)     │          │
│  │  • 'FEATURE_FLAGS'← A/B tests                     │          │
│  │  • 'FORM_DRAFTS'  ← Form auto-save                │          │
│  └───────────────────┬───────────────────────────────┘          │
│                      │ returns a singleton                      │
│                      ▼                                          │
│  ┌───────────────────────────────────────────────────┐          │
│  │   StorageVault                                    │          │
│  │                                                   │          │
│  │  Core Features:                                   │          │
│  │  • TTL expiration                                 │          │
│  │  • Debounced writes                               │          │
│  │  • Automatic cleanup                              │          │
│  │  • SSR fallback                                   │          │
│  │  • Transform chain (compress/encrypt/log)         │          │
│  └───────────────────┬───────────────────────────────┘          │
│                      │ via IStorage                             │
│         ┌────────────┴────────────┐                             │
│         │                         │                             │
│         ▼                         ▼                             │
│  ┌──────────────┐         ┌───────────────┐                     │
│  │ localStorage │         │ sessionStorage│                     │
│  │  (Browser)   │         │   (Browser)   │                     │
│  └──────────────┘         └───────────────┘                     │
│         │                         │                             │
│         │ SSR? Use Memory         │                             │
│         ▼                         ▼                             │
│  ┌──────────────┐         ┌───────────────┐                     │
│  │ Map (Memory) │         │ Map (Memory)  │                     │
│  │   (Server)   │         │   (Server)    │                     │
│  └──────────────┘         └───────────────┘                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Flow

There is nothing to initialize — the first call builds and caches the instance.

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Setup Flow                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. First call to getStorageSlice('MY_APP')                      │
│     └─> No cached instance for "local-MY_APP"                   │
│                                                                 │
│  2. createStorage() picks a backend                             │
│     └─> Browser? localStorage. SSR? Map.                        │
│                                                                 │
│  3. Transform chain is assembled (if any)                       │
│     └─> TransformChain.from([...transforms])                    │
│                                                                 │
│  4. pagehide listener registered (browser only)                 │
│     └─> Flushes pending debounced writes                        │
│                                                                 │
│  5. ✅ Instance cached and returned                              │
│     └─> Later calls with the same key + type reuse it           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Example

```text
┌─────────────────────────────────────────────────────────────────┐
│                      Data Flow Example                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Component:                                                     │
│  ┌─────────────────────────────────────────────────────┐        │
│  │ const prefs = getStorageSlice('USER_PREFS');        │        │
│  │                                                     │        │
│  │ // Set theme                                        │        │
│  │ prefs.setItem('theme', 'dark');              ───────┼────┐   │
│  │                                                     │    │   │
│  │ // Get theme                                        │    │   │
│  │ const theme = prefs.getItem('theme');        ◄──────┼────┤   │
│  └─────────────────────────────────────────────────────┘    │   │
│                                                             │   │
│  StorageVault:                                              │   │
│  ┌─────────────────────────────────────────────────────┐    │   │
│  │ 1. Validate key (rejects prototype-pollution keys)  │    │   │
│  │ 2. Add to dirtyData (read-after-write)              │    │   │
│  │ 3. Start debounce timer                             │    │   │
│  │ 4. After 100ms → serialize + apply transforms       │    │   │
│  │ 5. Write through IStorage                           │    │   │
│  │ 6. pagehide listener flushes if the page goes away  │    │   │
│  └─────────────────────────────────────────────────────┘    │   │
│                               │                             │   │
│                               ▼                             │   │
│  localStorage:                                              │   │
│  ┌─────────────────────────────────────────────────────┐    │   │
│  │ Key: "USER_PREFS"                                   │    │   │
│  │ Value: {                                            │    │   │
│  │   "theme": {                                        │    │   │
│  │     "value": "dark",                                │    │   │
│  │     "expiry": null                                  │    │   │
│  │   }                                                 │    │   │
│  │ }                                              ◄────┼────┘   │
│  └─────────────────────────────────────────────────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Errors are not thrown at you — write operations return `false` and, if you added
a `LoggingHandler`, the failure is reported through your logger.

## Slice Selection Guide

```text
┌─────────────────────────────────────────────────────────────────┐
│                    Slice Selection Guide                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Critical Data (Orders, Payments)                               │
│  └─> local, debounceMs: 0 (write immediately)                   │
│                                                                 │
│  User Settings (Theme, Language)                                │
│  └─> local, debounceMs: 0, no TTL (permanent)                   │
│                                                                 │
│  API Cache (Products, Categories)                               │
│  └─> local, debounceMs: 200, TTL 5-10 min                       │
│                                                                 │
│  Temporary State (Wizard, Multi-step Forms)                     │
│  └─> session (cleared on tab close)                             │
│                                                                 │
│  A/B Tests & Experiments                                        │
│  └─> local, debounceMs: 100, TTL bounded                        │
│                                                                 │
│  High-Frequency Updates (Analytics, Events)                     │
│  └─> local, debounceMs: 500                                     │
│                                                                 │
│  Form Auto-Save                                                 │
│  └─> local, debounceMs: 1000, TTL 24h                           │
│                                                                 │
│  Tests                                                          │
│  └─> in-memory, debounceMs: 0                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Singleton Pattern

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Singleton Pattern                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ComponentA.tsx:                                                │
│  const prefs = getStorageSlice('USER_PREFS');                   │
│  prefs.setItem('theme', 'dark');                                │
│                    │                                            │
│                    │ Same instance                              │
│                    ▼                                            │
│  ComponentB.tsx:                                                │
│  const prefs = getStorageSlice('USER_PREFS');                   │
│  const theme = prefs.getItem('theme'); // 'dark' ✅              │
│                                                                 │
│  ✅ Same slice key + storage type share one instance             │
│  ✅ Changes in one place visible everywhere                      │
│  ✅ No need to pass down via props/context                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

See [SINGLETON_PATTERN_VISUAL.md](./SINGLETON_PATTERN_VISUAL.md) for the details,
including the caveat that options only apply on first creation.

## SSR vs Client Behavior

```text
┌─────────────────────────────────────────────────────────────────┐
│                   SSR vs Client Behavior                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Server-Side (SSR):                                             │
│  ┌─────────────────────────────────────────────────┐            │
│  │ typeof window === 'undefined'                   │            │
│  │                                                 │            │
│  │ StorageVault uses:                              │            │
│  │ • Map<string, string> (in-memory)               │            │
│  │ • No persistence                                │            │
│  │ • Per-process isolation                         │            │
│  │ • No pagehide listeners                         │            │
│  │ • Capped by maxItemsInMemory (default 1000)     │            │
│  └─────────────────────────────────────────────────┘            │
│                                                                 │
│  Client-Side (Browser):                                         │
│  ┌─────────────────────────────────────────────────┐            │
│  │ typeof window !== 'undefined'                   │            │
│  │                                                 │            │
│  │ StorageVault uses:                              │            │
│  │ • localStorage / sessionStorage                 │            │
│  │ • Full persistence                              │            │
│  │ • Shared across tabs (localStorage)             │            │
│  │ • Auto-flush on pagehide                        │            │
│  └─────────────────────────────────────────────────┘            │
│                                                                 │
│  Hydration Pattern:                                             │
│  ┌─────────────────────────────────────────────────┐            │
│  │ 1. Server renders with in-memory data           │            │
│  │ 2. Client loads and creates a new instance      │            │
│  │ 3. useEffect hydrates client storage            │            │
│  │                                                 │            │
│  │ useEffect(() => {                               │            │
│  │   vault.setItem('data', serverData);            │            │
│  │ }, []);                                         │            │
│  └─────────────────────────────────────────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Server-side data is **not** transferred to the client automatically. Pass it
through your framework's normal props/loader mechanism and re-store it on the
client.

## Key Takeaways

1. **No Initialization**: call `getStorageSlice()` and go
2. **Singleton Pattern**: one instance per slice key + storage type
3. **One Blob Per Slice**: all of a slice's items live under a single key
4. **SSR Safe**: automatic fallback to in-memory storage
5. **Pluggable Concerns**: logging and statistics are opt-in, never bundled in
6. **Type Safe**: full TypeScript support with generics
7. **Performance**: debounced writes with read-after-write consistency

## Where to Look in the Source

```text
src/
├── index.ts                        ← Public API
├── vault/storage-vault.ts          ← Core implementation
├── storage/storage.factory.ts      ← Backend selection (SSR fallback)
├── storage/environment.ts          ← isWindowAvailable()
├── transform/transform-chain.ts    ← Transform orchestration
├── logger/logging-handler.ts       ← Opt-in logging
└── statistics/storage-statistics.ts← Opt-in statistics
```

See [STRUCTURE.md](./STRUCTURE.md) for the full file map and
[ARCHITECTURE.md](./ARCHITECTURE.md) for design patterns.

# 🎯 Singleton Pattern - Visual Guide

`getStorageSlice()` returns a **singleton per slice**. Ask for the same slice
from anywhere in your app and you get the same instance, backed by the same
storage key.

## The Big Picture

```text
┌──────────────────────────────────────────────────────────────┐
│                       Your application                       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Component A  │  │ Component B  │  │ Component C  │        │
│  │              │  │              │  │              │        │
│  │ Theme Switch │  │ Product Page │  │ Cart         │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         │                 │                 │                │
│         │ getStorageSlice('MY_APP')         │                │
│         ▼                 ▼                 ▼                │
│  ┌────────────────────────────────────────────────────┐      │
│  │        getStorageSlice('MY_APP')                   │      │
│  └───────────────────────┬────────────────────────────┘      │
│                          │                                   │
│                          │ All resolve to the                │
│                          │ same instance                     │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐      │
│  │              🏰 StorageVault                       │      │
│  │            (ONE instance per slice)                │      │
│  │                                                    │      │
│  │  Data stored with key prefixes:                    │      │
│  │  • user:theme        = "dark"                      │      │
│  │  • cache:product-123 = {...}                       │      │
│  │  • cart:items        = [...]                       │      │
│  │  • feature:new-ui    = true                        │      │
│  │  • exp:banner-test   = true                        │      │
│  │                                                    │      │
│  └───────────────────────┬────────────────────────────┘      │
│                          │                                   │
│                          ▼                                   │
│                ┌─────────────────────┐                       │
│                │  localStorage       │                       │
│                │  Key: "MY_APP"      │                       │
│                │  (one JSON blob)    │                       │
│                └─────────────────────┘                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

All of a slice's data lives in **one** JSON blob under **one** storage key. That
keeps the storage namespace clean and makes reads and writes a single operation.

---

## What Makes an Instance Unique

The instance cache is keyed by `storageType` + `storageKey` — nothing else:

```text
                cache key = `${storageType}-${storageKey}`

getStorageSlice('MY_APP')                        → "local-MY_APP"     ┐
getStorageSlice('MY_APP', { debounceMs: 500 })   → "local-MY_APP"     ├─ SAME
getStorageSlice('MY_APP', { storageType:'local'})→ "local-MY_APP"     ┘

getStorageSlice('OTHER')                         → "local-OTHER"      ← different
getStorageSlice('MY_APP', {storageType:'session'})→ "session-MY_APP"  ← different
```

> ⚠️ **Important:** because only the type and key form the cache key, options
> like `debounceMs`, `transforms`, or `maxSizeBytes` are applied **only when the
> instance is first created**. A later call with different options returns the
> existing instance, still using its original configuration. Configure a slice
> in one place.

---

## Data Flow Example

```text
1. Component A stores theme
   ┌─────────────────────────┐
   │ storage.setItem(        │
   │   'user:theme',         │
   │   'dark'                │
   │ );                      │
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │  StorageVault instance  │
   │                         │
   │ {                       │
   │   "user:theme": {       │
   │     value: "dark",      │
   │     expiry: null        │
   │   }                     │
   │ }                       │
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │   localStorage          │
   │   Key: "MY_APP"         │
   └─────────────────────────┘

2. Component B reads theme (same instance!)
   ┌─────────────────────────┐
   │ const theme =           │
   │   storage.getItem(      │
   │     'user:theme'        │
   │   );                    │
   │ // Returns: "dark" ✅   │
   └─────────────────────────┘
```

Reads see pending debounced writes immediately (read-after-write consistency),
so step 2 returns `"dark"` even if the write has not hit storage yet.

---

## Key Naming Convention

Since a slice holds one blob, prefixes keep it organized. This is a convention,
not something the library enforces:

```text
MY_APP (one slice)
│
├─ user:*           → User data
│  ├─ user:id
│  ├─ user:name
│  ├─ user:theme
│  └─ user:preferences
│
├─ cache:*          → API cache (always with TTL!)
│  ├─ cache:product-123
│  ├─ cache:categories
│  └─ cache:search-results
│
├─ feature:*        → Feature flags (usually with TTL)
│  ├─ feature:new-checkout
│  ├─ feature:beta-ui
│  └─ feature:dark-mode
│
├─ exp:*            → Experiments (always with TTL!)
│  ├─ exp:banner-test
│  ├─ exp:checkout-variant-a
│  └─ exp:pricing-test
│
├─ draft:*          → Form drafts (always with TTL!)
│  ├─ draft:checkout-form
│  ├─ draft:review-comment
│  └─ draft:profile-edit
│
├─ cart:*           → Shopping cart
│  ├─ cart:items
│  ├─ cart:total
│  └─ cart:lastUpdated
│
└─ analytics:*      → Analytics
   ├─ analytics:page-views
   ├─ analytics:last-visit
   └─ analytics:session-id
```

---

## One Slice or Many?

Prefixes within one slice, or separate slices? Both are valid — the trade-off is
write cost versus isolation.

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

// One slice, prefixed keys — simplest mental model.
// Every write re-serializes the whole blob.
const storage = getStorageSlice('MY_APP');
storage.setItem('user:theme', 'dark');
storage.setItem('cache:products', data, 5 * 60 * 1000);

// Separate slices — isolates unrelated data, so a hot cache write
// does not re-serialize your user preferences.
const userPrefs = getStorageSlice('USER_PREFS');
const cache = getStorageSlice('API_CACHE');
userPrefs.setItem('theme', 'dark');
cache.setItem('products', data, 5 * 60 * 1000);
```

**Split into slices when** data differs in update frequency, size, or lifetime
(e.g. a `session` wizard vs. `local` preferences). **Keep one slice when** the
data is small and related.

---

## Singleton Guarantee

```text
┌──────────────────────────────────────────────────────────┐
│  File: user-component.tsx                                │
│                                                          │
│  const storage = getStorageSlice('MY_APP');              │
│  storage.setItem('user:name', 'dariush');                │
└──────────────────────────────────────────────────────────┘
                           │
                           │ Same instance
                           ▼
┌──────────────────────────────────────────────────────────┐
│  File: profile-page.tsx                                  │
│                                                          │
│  const storage = getStorageSlice('MY_APP');              │
│  const name = storage.getItem('user:name'); // 'dariush' │
└──────────────────────────────────────────────────────────┘
                           │
                           │ Same instance
                           ▼
┌──────────────────────────────────────────────────────────┐
│  File: header.tsx                                        │
│                                                          │
│  const storage = getStorageSlice('MY_APP');              │
│  const name = storage.getItem('user:name'); // 'dariush' │
└──────────────────────────────────────────────────────────┘
```

No module-level shared export is needed — the cache does the work.

---

## Releasing Instances

```typescript
import {
  getStorageSlice,
  disposeStorageSlice,
  StorageVault,
} from '@faravahar/smart-storage';

const temp = getStorageSlice('TEMP', { storageType: 'session' });

// Flushes pending writes, removes listeners, drops it from the cache.
// Pass the same storageType you created it with.
disposeStorageSlice('TEMP', { storageType: 'session' });

// Or, in test teardown, drop every instance at once:
StorageVault.clearAllInstances();
```

After disposal, the next `getStorageSlice('TEMP', …)` builds a fresh instance —
and will re-read whatever is still persisted under that key.

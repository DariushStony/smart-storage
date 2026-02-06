# 🎯 Singleton Pattern - Visual Guide

## The Big Picture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your DK Application                       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Component A  │  │ Component B  │  │ Component C  │      │
│  │              │  │              │  │              │      │
│  │ Theme Switch │  │ Product Page │  │ Cart         │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         │ import          │ import          │ import        │
│         ▼                 ▼                 ▼               │
│  ┌──────────────────────────────────────────────────┐      │
│  │   import { dkStorage } from '@dk/.../storage'    │      │
│  └──────────────────────┬───────────────────────────┘      │
│                         │                                   │
│                         │ All point to                      │
│                         │ same instance                     │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────┐      │
│  │                                                   │      │
│  │              🏰 dkStorage                        │      │
│  │            (ONE Singleton Instance)              │      │
│  │                                                   │      │
│  │  Data stored with key prefixes:                  │      │
│  │  • user:theme        = "dark"                    │      │
│  │  • cache:product-123 = {...}                     │      │
│  │  • cart:items        = [...]                     │      │
│  │  • feature:new-ui    = true                      │      │
│  │  • exp:banner-test   = true                      │      │
│  │                                                   │      │
│  └───────────────────┬───────────────────────────────┘      │
│                      │                                      │
│                      ▼                                      │
│            ┌──────────────────┐                            │
│            │  localStorage     │                            │
│            │  Key: DK_STORAGE  │                            │
│            └──────────────────┘                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Before vs After

### ❌ Before (Multiple Vaults)

```
Component A                 Component B                 Component C
    │                           │                           │
    │ import userPrefsVault     │ import cacheVault        │ import cartVault
    ▼                           ▼                           ▼
┌──────────┐              ┌──────────┐              ┌──────────┐
│ userPrefs│              │  cache   │              │   cart   │
│  Vault   │              │  Vault   │              │  Vault   │
└────┬─────┘              └────┬─────┘              └────┬─────┘
     │                         │                         │
     ▼                         ▼                         ▼
┌──────────┐              ┌──────────┐              ┌──────────┐
│localStorage│            │localStorage│            │localStorage│
│DK_USER_   │            │DK_API_    │            │DK_CART    │
│PREFS      │            │CACHE      │            │           │
└──────────┘              └──────────┘              └──────────┘

❌ Problems:
• 8 different imports to remember
• 8 different localStorage keys
• Need to know which vault for what
• More complex mental model
```

### ✅ After (Singleton)

```
Component A                 Component B                 Component C
    │                           │                           │
    │ import dkStorage          │ import dkStorage         │ import dkStorage
    ▼                           ▼                           ▼
                    ┌───────────────────────┐
                    │                       │
                    │      dkStorage        │
                    │   (ONE Instance)      │
                    │                       │
                    │  user:theme           │
                    │  cache:products       │
                    │  cart:items           │
                    │  feature:new-ui       │
                    │  exp:test-1           │
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
                        ┌──────────────┐
                        │ localStorage  │
                        │ DK_STORAGE    │
                        └──────────────┘

✅ Benefits:
• 1 import for everything
• 1 localStorage key
• Simple key prefixes
• Easy mental model
```

---

## Data Flow Example

```
1. Component A stores theme
   ┌─────────────────────────┐
   │ dkStorage.setItem(      │
   │   'user:theme',         │
   │   'dark'                │
   │ );                      │
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │   dkStorage Instance    │
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
   │   Key: "DK_STORAGE"     │
   └─────────────────────────┘

2. Component B reads theme (same instance!)
   ┌─────────────────────────┐
   │ const theme =           │
   │   dkStorage.getItem(    │
   │     'user:theme'        │
   │   );                    │
   │ // Returns: "dark" ✅   │
   └─────────────────────────┘
```

---

## Key Naming Structure

```
dkStorage
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

## Real Code Comparison

### User Theme Example

```typescript
// ❌ Before (Multiple Vaults)
import { userPrefsVault } from '@dk/shared/utils/storage';

userPrefsVault.setItem('theme', 'dark');
const theme = userPrefsVault.getItem('theme');

// ✅ After (Singleton)
import { dkStorage } from '@dk/shared/utils/storage';

dkStorage.setItem('user:theme', 'dark');
const theme = dkStorage.getItem('user:theme');
```

### Product Cache Example

```typescript
// ❌ Before (Multiple Vaults)
import { cacheVault } from '@dk/shared/utils/storage';

cacheVault.setItem('product-123', data, 5 * 60 * 1000);
const product = cacheVault.getItem('product-123');

// ✅ After (Singleton)
import { dkStorage } from '@dk/shared/utils/storage';

dkStorage.setItem('cache:product-123', data, 5 * 60 * 1000);
const product = dkStorage.getItem('cache:product-123');
```

### Mixed Usage Example

```typescript
// ❌ Before (Multiple Vaults)
import {
  userPrefsVault,
  cacheVault,
  featureFlagsVault,
  cartVault,
} from '@dk/shared/utils/storage';

userPrefsVault.setItem('theme', 'dark');
cacheVault.setItem('products', data, 5 * 60 * 1000);
featureFlagsVault.setItem('feature:new-ui', true);
cartVault.setItem('items', items);

// ✅ After (Singleton)
import { dkStorage } from '@dk/shared/utils/storage';

dkStorage.setItem('user:theme', 'dark');
dkStorage.setItem('cache:products', data, 5 * 60 * 1000);
dkStorage.setItem('feature:new-ui', true);
dkStorage.setItem('cart:items', items);
```

---

## Singleton Guarantee

```
┌─────────────────────────────────────────────────────┐
│  File: user-component.tsx                           │
│  import { dkStorage } from '@dk/shared/utils/storage'│
│  dkStorage.setItem('user:name', 'dariush');         │
└─────────────────────────────────────────────────────┘
                       │
                       │ Same Instance
                       ▼
┌─────────────────────────────────────────────────────┐
│  File: product-component.tsx                        │
│  import { dkStorage } from '@dk/shared/utils/storage'│
│  const name = dkStorage.getItem('user:name');       │
│  console.log(name); // → "dariush" ✅               │
└─────────────────────────────────────────────────────┘
                       │
                       │ Same Instance
                       ▼
┌─────────────────────────────────────────────────────┐
│  File: cart-service.ts                              │
│  import { dkStorage } from '@dk/shared/utils/storage'│
│  const name = dkStorage.getItem('user:name');       │
│  console.log(name); // → "dariush" ✅               │
└─────────────────────────────────────────────────────┘

✅ All imports = Same instance
✅ Data written in one place = Available everywhere
✅ No prop drilling needed
✅ No context provider needed
```

---

## In localStorage

```
Before (Multiple Vaults):
┌──────────────────────┐
│ localStorage         │
├──────────────────────┤
│ DK_USER_PREFS        │
│ DK_API_CACHE         │
│ DK_FEATURE_FLAGS     │
│ DK_ANALYTICS         │
│ DK_DRAFTS            │
│ DK_GROWTHBOOK        │
│ DK_CART              │
│ DK_SESSION           │
└──────────────────────┘
❌ 8 separate keys

After (Singleton):
┌──────────────────────┐
│ localStorage         │
├──────────────────────┤
│ DK_STORAGE           │
│   {                  │
│     "user:theme",    │
│     "cache:prod-123",│
│     "feature:new-ui",│
│     "cart:items",    │
│     ...              │
│   }                  │
└──────────────────────┘
✅ 1 organized key
```

---

## Summary

```
┌─────────────────────────────────────────────┐
│  ONE Import                                  │
│  import { dkStorage } from '...';           │
│                                             │
│  ONE Vault                                   │
│  dkStorage (singleton instance)             │
│                                             │
│  ONE Pattern                                 │
│  Use key prefixes to organize               │
│  (user:, cache:, feature:, etc.)            │
│                                             │
│  EVERYWHERE                                  │
│  Works in all components, hooks, services   │
└─────────────────────────────────────────────┘
```

---

## The Essence

```typescript
// This is all you need to remember:

import { dkStorage } from '@dk/shared/utils/storage';

dkStorage.setItem('prefix:key', value);
const data = dkStorage.getItem('prefix:key');

// That's it! 🎉
```

---

**Simple. Clean. Powerful.** 🚀

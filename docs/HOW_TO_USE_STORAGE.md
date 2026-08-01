# 🎯 How to Use smart-storage

## Super Simple - One Vault for Everything!

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

// That's it! Use it everywhere.
// Uses localStorage by default (persists across sessions).
// Slices are singletons per key + storage type, so calling
// getStorageSlice('MY_APP') anywhere returns this same instance.
```

---

## 🗄️ Storage Types

The vault supports three storage types:

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

// 'local' - localStorage (persists across browser sessions)
const persistentStorage = getStorageSlice('DATA', { storageType: 'local' });

// 'session' - sessionStorage (cleared when tab closes)
const sessionStorage = getStorageSlice('TEMP', { storageType: 'session' });

// 'in-memory' - Map (cleared on page reload, great for testing)
const memoryStorage = getStorageSlice('TEST', { storageType: 'in-memory' });
```

**When to use each:**

- **'local'**: User preferences, shopping cart, long-term cache (default)
- **'session'**: Temporary wizard state, form drafts, one-session data
- **'in-memory'**: Testing, SSR fallback, ultra-temporary data

---

## ✨ Basic Usage

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

// Store data
storage.setItem('theme', 'dark');
storage.setItem('user', { id: 1, name: 'dariush' });
storage.setItem('cart', [{ id: 1, quantity: 2 }]);

// Get data
const theme = storage.getItem<string>('theme');
const user = storage.getItem<User>('user');
const cart = storage.getItem<CartItem[]>('cart');

// Check if exists
if (storage.hasItem('user')) {
  console.log('User data exists');
}

// Remove data
storage.removeItem('theme');

// Clear all data
storage.clear();
```

---

## ⏰ With TTL (Auto-Expiry)

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

// Cache for 5 minutes
storage.setItem('cache:products', productsData, 5 * 60 * 1000);

// Feature flag for 7 days
storage.setItem('feature:new-checkout', true, 7 * 24 * 60 * 60 * 1000);

// Experiment for 30 minutes
storage.setItem('exp:banner-test', true, 30 * 60 * 1000);

// Check remaining time
const remaining = storage.getRemainingTTL('cache:products');
console.log(`Expires in ${Math.floor(remaining / 1000)} seconds`);
```

---

## 🏷️ Recommended Key Naming

Use prefixes to organize your data:

```typescript
// User data
storage.setItem('user:id', 123);
storage.setItem('user:name', 'dariush');
storage.setItem('user:preferences', { theme: 'dark', lang: 'fa-IR' });

// Cache (with TTL)
storage.setItem('cache:product-123', productData, 5 * 60 * 1000);
storage.setItem('cache:categories', categories, 10 * 60 * 1000);

// Feature flags (with TTL)
storage.setItem('feature:new-ui', true, 7 * 24 * 60 * 60 * 1000);
storage.setItem('feature:beta-checkout', true, 30 * 24 * 60 * 60 * 1000);

// Experiments (with TTL)
storage.setItem('exp:banner-variant-a', true, 30 * 60 * 1000);
storage.setItem('exp:checkout-test', true, 60 * 60 * 1000);

// Form drafts (with TTL)
storage.setItem('draft:checkout-form', formData, 24 * 60 * 60 * 1000);
storage.setItem('draft:review-comment', text, 24 * 60 * 60 * 1000);

// Shopping cart
storage.setItem('cart:items', items);
storage.setItem('cart:total', 150000);
storage.setItem('cart:lastUpdated', Date.now());

// Analytics
storage.setItem('analytics:page-views', 42);
storage.setItem('analytics:last-visit', Date.now());
```

---

## 🎨 Storage Type Examples

### Example: Session Wizard Flow

```typescript
// Use sessionStorage for temporary wizard state
import { getStorageSlice } from '@faravahar/smart-storage';

const wizardStorage = getStorageSlice('CHECKOUT_WIZARD', {
  storageType: 'session', // Cleared when user closes tab
});

function CheckoutWizard() {
  // Save progress
  wizardStorage.setItem('currentStep', 2);
  wizardStorage.setItem('formData', {
    name: 'dariush',
    email: 'test@example.com',
  });

  // Data is automatically cleared when tab closes
}
```

---

### Example: In-Memory Testing

```typescript
// Use in-memory storage for tests
import { getStorageSlice } from '@faravahar/smart-storage';

describe('My Component', () => {
  const testStorage = getStorageSlice('TEST_DATA', {
    storageType: 'in-memory', // Isolated per test, no pollution
    debounceMs: 0, // Immediate writes for predictable tests
  });

  afterEach(() => {
    testStorage.clear(); // Clean up after each test
  });

  it('should store data', () => {
    testStorage.setItem('key', 'value');
    expect(testStorage.getItem('key')).toBe('value');
  });
});
```

---

## 🔥 Real-World Examples

### Example 1: User Theme

```typescript
// components/theme-switcher.tsx
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

function ThemeSwitcher() {
  const toggleTheme = () => {
    const current = storage.getItem<'light' | 'dark'>('user:theme') || 'light';
    const newTheme = current === 'light' ? 'dark' : 'light';

    storage.setItem('user:theme', newTheme);
    document.body.className = newTheme;
  };

  return <button onClick={toggleTheme}>Toggle Theme</button>;
}
```

---

### Example 2: API Cache

```typescript
// services/product-service.ts
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

async function getProduct(id: number) {
  const cacheKey = `cache:product-${id}`;

  // Check cache first
  const cached = storage.getItem(cacheKey);
  if (cached) return cached;

  // Fetch from API if not cached
  const product = await fetchProductAPI(id);

  // Cache for 5 minutes
  storage.setItem(cacheKey, product, 5 * 60 * 1000);

  return product;
}
```

---

### Example 3: Feature Flag

```typescript
// pages/checkout.tsx
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

function CheckoutPage() {
  // Check if new checkout is enabled
  const useNewCheckout = storage.hasItem('feature:new-checkout');

  if (useNewCheckout) {
    return <NewCheckout />;
  }

  return <OldCheckout />;
}

// Enable feature for user (from admin panel or A/B test)
function enableNewCheckout() {
  // Enable for 7 days
  storage.setItem('feature:new-checkout', true, 7 * 24 * 60 * 60 * 1000);
}
```

---

### Example 4: Form Auto-Save

```typescript
// components/checkout-form.tsx
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');
import { useState, useEffect } from 'react';

function CheckoutForm() {
  const [formData, setFormData] = useState({ name: '', email: '' });

  // Load draft on mount
  useEffect(() => {
    const draft = storage.getItem('draft:checkout-form');
    if (draft) {
      setFormData(draft);
    }
  }, []);

  // Auto-save when form changes (debounced 100ms by vault)
  useEffect(() => {
    if (formData.name || formData.email) {
      // Save with 24 hour TTL
      storage.setItem('draft:checkout-form', formData, 24 * 60 * 60 * 1000);
    }
  }, [formData]);

  const handleSubmit = () => {
    // ... submit logic ...

    // Clear draft after successful submit
    storage.removeItem('draft:checkout-form');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        placeholder="Name"
      />
      <input
        value={formData.email}
        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        placeholder="Email"
      />
      <button type="submit">Submit</button>
    </form>
  );
}
```

---

### Example 5: Shopping Cart

```typescript
// services/cart-service.ts
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');

interface CartItem {
  id: number;
  quantity: number;
}

function addToCart(productId: number, quantity: number) {
  const items = storage.getItem<CartItem[]>('cart:items') || [];

  const existingIndex = items.findIndex((item) => item.id === productId);

  if (existingIndex > -1) {
    items[existingIndex].quantity += quantity;
  } else {
    items.push({ id: productId, quantity });
  }

  storage.setItem('cart:items', items);
  storage.setItem('cart:lastUpdated', Date.now());
}

function getCartItems(): CartItem[] {
  return storage.getItem<CartItem[]>('cart:items') || [];
}

function clearCart() {
  storage.removeItem('cart:items');
  storage.removeItem('cart:lastUpdated');
}
```

---

## 🎨 React Hook Pattern

```typescript
// hooks/useLocalStorage.ts
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');
import { useState, useEffect } from 'react';

function useLocalStorage<T>(key: string, initialValue: T, ttl?: number) {
  const [value, setValue] = useState<T>(() => {
    const stored = storage.getItem<T>(key);
    return stored !== null ? stored : initialValue;
  });

  useEffect(() => {
    storage.setItem(key, value, ttl);
  }, [key, value, ttl]);

  return [value, setValue] as const;
}

// Usage
function MyComponent() {
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('user:theme', 'light');

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current: {theme}
    </button>
  );
}
```

---

## 🛠️ Utility Functions

```typescript
import {
  storage,
  cleanupStorage,
  getStorageStats,
  flushStorage,
} from '@faravahar/smart-storage';

// Cleanup expired items
const removed = cleanupStorage();
console.log(`Removed ${removed} expired items`);

// Get storage statistics
const stats = getStorageStats();
console.log(`Using ${stats.itemCount} items`);
console.log(`Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
console.log(`Quota: ${stats.quotaPercentage.toFixed(1)}%`);

// Flush before navigation
storage.setItem('lastPage', '/checkout');
flushStorage();
window.location.href = '/confirmation';
```

---

## ⚙️ All Available Methods

```typescript
// Write operations
storage.setItem(key, value); // Store permanently
storage.setItem(key, value, ttl); // Store with expiry
storage.updateItem(key, newValue); // Update without changing TTL
storage.removeItem(key); // Remove item
storage.clear(); // Clear all data

// Read operations
storage.getItem<T>(key); // Get value (null if not found/expired)
storage.hasItem(key); // Check if exists and not expired
storage.getAllKeys(); // Get all valid keys
storage.getAll(); // Get all data as object

// TTL operations
storage.getRemainingTTL(key); // Get remaining time (ms)
storage.extendTTL(key, additionalMs); // Extend expiry time

// Maintenance
storage.cleanupExpiredItems(); // Remove expired items
storage.flush(); // Force write pending changes
storage.getCurrentSize(); // Get size in bytes
```

For detailed statistics, construct a `StorageStatistics` — stats are a
pluggable concern, not a vault method:

```typescript
import { StorageStatistics } from '@faravahar/smart-storage';

const statistics = new StorageStatistics(
  storage.getStorageAdapter(),
  storage.getStorageKey(),
  storage.getTransformChain(),
  storage.getMaxSizeBytes()
);

statistics.collect(() => storage.getAllData());
```

---

## 📊 Common TTL Values

```typescript
// Quick reference for common durations

1 * 60 * 1000; // 1 minute
5 * 60 * 1000; // 5 minutes
30 * 60 * 1000; // 30 minutes
60 * 60 * 1000; // 1 hour
24 * 60 * 60 * 1000; // 1 day
7 * 24 * 60 * 60 * 1000; // 7 days
30 * 24 * 60 * 60 * 1000; // 30 days
```

---

## ⚠️ Important Notes

✅ **No Setup Needed** - Call `getStorageSlice()` and use it; nothing to initialize  
✅ **SSR Safe** - Works on server (uses memory) and client (uses localStorage)  
✅ **Singleton** - Same instance per slice key + storage type, data is shared  
✅ **Auto-Flush** - Saves automatically on page unload  
✅ **Opt-In Error Logging** - Add a `LoggingHandler` to route errors to your service  
✅ **Type-Safe** - Full TypeScript support  
✅ **Debounced** - Writes are batched (100ms) for performance  
✅ **Read-After-Write** - Reads see pending writes immediately

---

## 🚫 What NOT to Store

❌ **Never store sensitive data:**

- Auth tokens (use httpOnly cookies)
- Passwords
- Credit card info
- API keys
- Personal identification numbers

✅ **Good to store:**

- User preferences
- UI state
- Cache data
- Feature flags
- Analytics
- Form drafts
- Shopping cart

---

## 🎯 Summary

**One line to rule them all:**

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');
```

**Use it everywhere:**

- ✅ Components
- ✅ Hooks
- ✅ Services
- ✅ Pages
- ✅ Utilities

**No setup needed** - already initialized!  
**No configuration needed** - just use it!  
**No complexity** - one vault for everything!

---

## 📚 Need More?

- **Full API Docs**: See the main README.md
- **Interactive Examples**: `examples/vanilla-js/index.html`
- **Architecture Guide**: `docs/ARCHITECTURE.md`

---

**That's all you need! Simple, clean, powerful.** 🚀

```typescript
import { getStorageSlice } from '@faravahar/smart-storage';

const storage = getStorageSlice('MY_APP');
storage.setItem('awesome', true);
```

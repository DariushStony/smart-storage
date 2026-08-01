# Contributing to @faravahar/smart-storage

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## 🚀 Getting Started

### Prerequisites

- Node.js 24 or higher (required by the current dev toolchain)
- pnpm 11.18.0

The pnpm version is pinned in the `packageManager` field of `package.json`. With
[Corepack](https://nodejs.org/api/corepack.html) enabled, the correct version is
selected automatically:

```bash
corepack enable
```

> **Note:** These are requirements for _developing_ the package. The published
> library itself has no such constraint — see the README for runtime support.

### Setup

1. **Fork the repository**

   Click the "Fork" button on GitHub to create your own copy.

2. **Clone your fork**

   ```bash
   git clone git@github.com:YOUR_USERNAME/smart-storage.git
   cd smart-storage
   ```

3. **Install dependencies**

   ```bash
   pnpm install
   ```

4. **Build the project**

   ```bash
   pnpm build
   ```

5. **Run checks**

   ```bash
   pnpm check
   ```

## 🔧 Development Workflow

### Available Scripts

```bash
# Development
pnpm build          # Build the package
pnpm clean          # Clean build output
pnpm typecheck      # Type check src and tests

# Testing
pnpm test           # Unit tests (Vitest + happy-dom)
pnpm test:watch     # Unit tests in watch mode
pnpm test:coverage  # Unit tests with a coverage report
pnpm test:e2e       # E2E tests (Playwright, real Chromium; builds first)
pnpm test:all       # Unit + E2E

# Code Quality
pnpm lint           # Lint with oxlint (type-aware)
pnpm lint:fix       # Lint and auto-fix issues
pnpm format         # Format code with Prettier
pnpm format:check   # Check code formatting
pnpm check          # Run all checks (format, lint, typecheck)

# Bundle Size
pnpm size           # Check bundle size
pnpm size:check     # Build and check bundle size
pnpm analyze        # Analyze bundle composition
```

### Making Changes

1. **Create a new branch**

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**
   - Follow the existing code style
   - Add tests if applicable
   - Update documentation as needed

3. **Run quality checks**

   ```bash
   pnpm check
   ```

4. **Commit your changes**

   We use [Conventional Commits](https://www.conventionalcommits.org/) format:

   ```bash
   git commit -m "feat: add new feature"
   git commit -m "fix: resolve bug"
   git commit -m "docs: update README"
   ```

   **Commit Types:**
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting, etc.)
   - `refactor:` - Code refactoring
   - `perf:` - Performance improvements
   - `test:` - Adding or updating tests
   - `chore:` - Maintenance tasks
   - `ci:` - CI/CD changes
   - `build:` - Build system changes

   **Breaking Changes:**

   ```bash
   git commit -m "feat!: change API signature

   BREAKING CHANGE: getStorageSlice now requires options parameter"
   ```

5. **Push your changes**

   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**
   - Go to the repository on GitHub
   - Click "New Pull Request"
   - Select your branch
   - Fill in the PR template
   - Submit for review

## 📝 Code Style

### TypeScript Guidelines

- **No `any`** - Use proper types
- **No `ts-ignore`** - Fix the type issue instead
- **Explicit return types** - For public functions
- **Use discriminated unions** - For message/state types
- **Document complex logic** - Add JSDoc comments

**Good:**

```typescript
function getItem<T>(key: string): T | null {
  // Implementation
}
```

**Bad:**

```typescript
function getItem(key: any): any {
  // Implementation
}
```

### File Naming

- Use `kebab-case` for files and folders
- Example: `storage-backend.ts`, `transform-pipeline.ts`

### Import Order

1. Type imports
2. External dependencies
3. Internal dependencies

Relative imports **must** carry an explicit `.js` extension, even though the
source files are `.ts`. Declarations are emitted by `tsc`, and extensionless
specifiers break consumers using `node16`/`nodenext` module resolution.

```typescript
import type { StorageTypeValue, StorageLogger } from './types.js';
import { DEFAULT_DEBOUNCE_MS } from './constants.js';
import { validateKey, isExpired } from './helpers.js';
```

## 🧪 Testing

New behavior needs tests, and bug fixes need a test that fails before the fix.

### Layout

```text
tests/
├── unit/           # Vitest + happy-dom -- fast, covers all logic
│   ├── helpers.test.ts
│   ├── transform.test.ts
│   ├── storage.test.ts
│   ├── storage-vault.test.ts
│   ├── statistics.test.ts
│   └── public-api.test.ts
└── e2e/            # Playwright + real Chromium
    ├── harness.html      # loads the built bundle
    ├── server.mjs        # dependency-free static server
    └── storage.e2e.ts
```

### Which layer?

Default to **unit**. Reach for **e2e** only when a simulated DOM cannot honestly
prove the behavior:

| Use unit tests for                     | Use e2e tests for                      |
| -------------------------------------- | -------------------------------------- |
| TTL arithmetic, expiry, cleanup        | Persistence across a real page reload  |
| Transform chain ordering               | `sessionStorage` clearing with the tab |
| Singleton identity, disposal           | Real `pagehide` flushing               |
| Key validation, prototype-pollution    | Genuine quota pressure                 |
| Debounce coalescing (with fake timers) | Cross-tab visibility                   |

E2E specs run against `dist/`, so they verify the **shipped artifact**;
`pnpm test:e2e` builds first via `pretest:e2e`.

### Writing a unit test

Vaults are singletons, so isolate each test with a unique slice key and clear
the cache afterwards:

```typescript
import { afterEach, describe, expect, it } from 'vitest';

import { StorageType } from '../../src/storage/storage-type.js';
import { StorageVault } from '../../src/vault/storage-vault.js';

afterEach(() => {
  StorageVault.clearAllInstances();
});

describe('StorageVault', () => {
  it('stores and retrieves data', () => {
    const vault = StorageVault.getInstance({
      storageKey: 'TEST_UNIQUE_KEY',
      storageType: StorageType.InMemory, // isolated, no real storage
      debounceMs: 0, // observe writes synchronously
    });

    vault.setItem('key', 'value');

    expect(vault.getItem('key')).toBe('value');
  });
});
```

Use `vi.useFakeTimers()` for anything involving TTL or debouncing rather than
sleeping in real time.

### Coverage

`pnpm test:coverage` prints a report. There is deliberately **no threshold
gate** — add one once the numbers have settled rather than picking a figure up
front.

## 📚 Documentation

When adding or changing features:

1. **Update README.md** if public API changes
2. **Add JSDoc comments** for new public functions
3. **Update docs/** if architectural changes

### Documentation Style

````typescript
/**
 * Stores a value with an optional TTL (time-to-live).
 *
 * @param key - The key to store the value under
 * @param value - The value to store (will be JSON serialized)
 * @param ttl - Optional time-to-live in milliseconds
 * @returns True if stored successfully, false otherwise
 *
 * @example
 * ```typescript
 * vault.setItem('token', 'abc123', 60 * 60 * 1000); // 1 hour TTL
 * ```
 */
function setItem(key: string, value: unknown, ttl?: number): boolean {
  // Implementation
}
````

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Description** - Clear description of the issue
2. **Steps to Reproduce** - Minimal steps to reproduce
3. **Expected Behavior** - What you expected to happen
4. **Actual Behavior** - What actually happened
5. **Environment** - Browser, Node.js version, etc.
6. **Code Sample** - Minimal code to reproduce

**Template:**

```markdown
**Description:**
Brief description of the bug

**Steps to Reproduce:**

1. Step one
2. Step two
3. Step three

**Expected Behavior:**
What should happen

**Actual Behavior:**
What actually happens

**Environment:**

- Browser: Chrome 120
- Node.js: v24.11.0
- Package version: 1.0.1

**Code Sample:**
\`\`\`typescript
// Minimal code to reproduce
\`\`\`
```

## 💡 Feature Requests

When requesting features:

1. **Use Case** - Explain the use case
2. **Proposed Solution** - Your proposed solution
3. **Alternatives** - Alternative solutions considered
4. **Additional Context** - Any other context

## 🔍 Code Review Process

All submissions require review. We use GitHub Pull Requests for this:

1. Maintainer reviews your code
2. Feedback is provided if changes needed
3. You make requested changes
4. Once approved, code is merged

### Review Criteria

- **Code Quality** - Follows style guide
- **Tests** - New features have tests
- **Documentation** - Public APIs documented
- **Performance** - No performance regressions
- **Bundle Size** - Bundle size not significantly increased

## 🎯 Project Structure

```text
src/
├── vault/                      # Core implementation
│   ├── storage-vault.ts        # Main StorageVault class
│   ├── helpers.ts              # Validation and expiry helpers
│   ├── constants.ts            # Defaults and dangerous-key list
│   └── types.ts                # StorageVaultOptions, StorageStats, ...
├── storage/                    # Storage backends
│   ├── storage.interface.ts    # IStorage contract
│   ├── storage.factory.ts      # Backend selection
│   ├── storage-type.ts         # StorageType constants
│   ├── local-storage.ts        # localStorage adapter
│   ├── session-storage.ts      # sessionStorage adapter
│   ├── in-memory-storage.ts    # Map adapter (SSR/testing)
│   └── environment.ts          # SSR detection
├── transform/                  # Transform chain
│   ├── transform-chain.ts      # Chain of Responsibility
│   ├── transform-handler.ts    # Base handler class
│   ├── inline-transform-handler.ts
│   └── types.ts                # StorageTransform
├── logger/                     # Pluggable logging
│   ├── storage-logger.ts       # StorageLogger interface
│   └── logging-handler.ts      # Logging as a chain handler
├── statistics/                 # Pluggable statistics
│   └── storage-statistics.ts   # StorageStatistics
└── index.ts                    # Public API
```

Each folder has an `index.ts` barrel file re-exporting its public pieces.

## 🤝 Community

- Be respectful and constructive
- Help others when you can
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md)
- Report vulnerabilities privately per the [Security Policy](./SECURITY.md)

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙏 Thank You!

Your contributions make this project better for everyone. Thank you for taking the time to contribute!

## ❓ Questions?

If you have questions:

1. Check the [README](./README.md)
2. Check the [documentation](./docs/)
3. Open a discussion on GitHub
4. Open an issue if you found a bug

Happy coding! 🚀

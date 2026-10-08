# Contributing to @dariushstony/smart-storage

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

   BREAKING CHANGE: createVault now requires a key option"
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
import type { Entry } from './entry.js';
import { Snapshot } from './snapshot.js';
import { StorageArgumentError } from '../errors.js';
```

## 🧪 Testing

New behavior needs tests, and bug fixes need a test that fails before the fix.

### Layout

```text
tests/
├── unit/           # Vitest + happy-dom -- fast, covers all logic; mirrors src/
│   ├── core/  codec/  drivers/  persistence/  reporting/  vault/
│   ├── errors.test.ts
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
| Codec ordering, envelope decoding      | `sessionStorage` clearing with the tab |
| Registry takeover, disposal            | Real `pagehide` flushing               |
| Key validation, prototype-like keys    | Genuine quota pressure                 |
| Debounce coalescing (with fake timers) | Cross-tab visibility                   |

E2E specs run against `dist/`, so they verify the **shipped artifact**;
`pnpm test:e2e` builds first via `pretest:e2e`.

### Writing a unit test

Give each test its own `MemoryDriver` (or a unique key) so vaults never share
state, and dispose what you create:

```typescript
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryDriver } from '../../../src/drivers/memory-driver.js';
import { createVault } from '../../../src/vault/create-vault.js';
import type { Vault } from '../../../src/vault/vault.js';

const created: Vault[] = [];

afterEach(() => {
  created.splice(0).forEach((vault) => vault.dispose());
});

describe('Vault', () => {
  it('stores and retrieves data', () => {
    const vault = createVault({ key: 'TEST', driver: new MemoryDriver() });
    created.push(vault);

    vault.set('key', 'value');

    expect(vault.get('key')).toBe('value');
  });
});
```

Writes are immediate by default, so assertions see them synchronously. Unit
tests run with `--no-experimental-webstorage` on Node >= 25 (set in
`vitest.config.ts`), because Node's own `localStorage` global would otherwise
shadow happy-dom's.

Use `vi.useFakeTimers()` for anything involving TTL or debouncing rather than
sleeping in real time.

### Coverage

`pnpm test:coverage` prints a report and enforces the thresholds in
`vitest.config.ts`; CI fails when coverage drops below them.

## 📚 Documentation

When adding or changing features:

1. **Update README.md** if public API changes
2. **Add JSDoc comments** for new public functions
3. **Update docs/** if architectural changes

### Documentation Style

````typescript
/**
 * Replaces the value and keeps the expiry.
 *
 * @param key - The item's key
 * @param value - The new value (round-trips through JSON)
 * @returns False when the item is missing or expired
 *
 * @example
 * ```typescript
 * vault.update('token', 'refreshed');
 * ```
 */
function update<T>(key: string, value: T): boolean {
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
├── index.ts                    # Public API (the only entry point)
├── errors.ts                   # StorageError hierarchy
├── core/                       # Pure domain, no I/O
│   ├── entry.ts                # Entry (JSON text + expiresAt), TTL helpers
│   ├── snapshot.ts             # Immutable snapshot, compaction
│   ├── envelope.ts             # On-disk format v2, reads 1.x
│   ├── validation.ts           # Argument checks
│   └── byte-size.ts            # UTF-8 length
├── codec/codec.ts              # Codec interface, composeCodecs
├── drivers/                    # Port + adapters
│   ├── storage-driver.ts       # StorageDriver port and its contract
│   ├── base-storage-driver.ts  # BaseStorageDriver (Template Method, namespace)
│   ├── driver-registry.ts      # registerDriver; built-ins registered the same way
│   ├── web-storage-driver.ts   # localStorage / sessionStorage adapter
│   ├── memory-driver.ts        # Map adapter (SSR, tests)
├── persistence/
│   ├── snapshot-store.ts       # SnapshotStore / SnapshotFormat interfaces
│   ├── snapshot-serializer.ts  # Snapshot ↔ string (envelope + codecs)
│   ├── snapshot-repository.ts  # Load/save via a driver, quota handling
│   ├── write-strategy.ts       # Immediate / debounced writes
│   └── page-lifecycle.ts       # pagehide / visibilitychange
├── reporting/reporter.ts       # Safe onError wrapper
├── testing/                    # Conformance kit (published as /testing)
└── vault/
    ├── vault.ts                # Public Vault interface and option types
    ├── options.ts              # Defaults and option validation
    ├── default-vault.ts        # The Vault facade
    ├── registry.ts             # One live vault per storage key
    └── create-vault.ts         # Composition root
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for how the layers fit
together and [docs/adr/](./docs/adr/) for why.

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

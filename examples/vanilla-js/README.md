# Vanilla JS example

A single page that drives the **built** library against real `localStorage`:
set and remove items, a 5-second TTL you can extend, `stats()`, the raw stored
string, and a write that exceeds `maxBytes` and is caught as
`StorageQuotaError`.

## Run it

From the repository root:

```bash
pnpm build
node tests/e2e/server.mjs
```

Then open <http://localhost:4173/examples/vanilla-js/index.html>.

The page imports `../../dist/index.js`. In an app, import from the package
instead:

```js
import { createVault } from '@dariushstony/smart-storage';
```

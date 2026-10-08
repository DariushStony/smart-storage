// Types for the globals the e2e harness page installs on `window`.
//
// tests/e2e/harness.html imports the built bundle and assigns it to
// window.smartStorage so Playwright's page.evaluate() callbacks can reach it.

import type * as SmartStorage from '../../src/index.js';
import type * as SmartStorageTesting from '../../src/testing/index.js';

declare global {
  interface Window {
    /** The built library, exposed by tests/e2e/harness.html. */
    smartStorage: typeof SmartStorage;
    /** The built conformance kit (dist/testing.js). */
    smartStorageTesting: typeof SmartStorageTesting;
    /** Set once the harness module has finished evaluating. */
    __smartStorageReady?: boolean;
    /** Lets a spec keep one vault alive across several evaluate() calls. */
    __vault?: SmartStorage.Vault;
    /** Lets a spec keep one async vault alive across evaluate() calls. */
    __asyncVault?: SmartStorage.AsyncVault;
  }
}

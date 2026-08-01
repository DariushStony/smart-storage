// Types for the globals the e2e harness page installs on `window`.
//
// tests/e2e/harness.html imports the built bundle and assigns it to
// window.smartStorage so Playwright's page.evaluate() callbacks can reach it.

import type * as SmartStorage from '../../src/index.js';

declare global {
  interface Window {
    /** The built library, exposed by tests/e2e/harness.html. */
    smartStorage: typeof SmartStorage;
    /** Set once the harness module has finished evaluating. */
    __smartStorageReady?: boolean;
  }
}

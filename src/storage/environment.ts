/**
 * Checks if the window is available (browser environment).
 *
 * @returns True if the window is available; false in SSR/Node environments.
 */
function isWindowAvailable(): boolean {
  return typeof window !== 'undefined';
}

export { isWindowAvailable };

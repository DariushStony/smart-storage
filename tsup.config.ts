import { defineConfig } from 'tsup';

export default defineConfig({
  // Entry points for your library
  entry: {
    index: 'src/index.ts',
  },

  // Output formats - ESM and CommonJS
  format: ['esm', 'cjs'],

  // Declarations are emitted by tsc, not tsup: tsup's dts step uses
  // rollup-plugin-dts, which crashes on the TypeScript 7 compiler API.
  // See the "build" script -- tsc --emitDeclarationOnly runs after tsup.
  dts: false,

  // Generate sourcemaps
  sourcemap: true,

  // Clean dist folder before build
  clean: true,

  // Split output for better tree-shaking (ESM only)
  splitting: false, // Disable for CJS compatibility

  // Target modern environments
  target: 'es2019',

  // Keep original file structure for better tree-shaking
  treeshake: true,

  // Minify output
  minify: true,

  // Preserve original export names
  platform: 'neutral',

  // Separate CJS and ESM outputs
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
});

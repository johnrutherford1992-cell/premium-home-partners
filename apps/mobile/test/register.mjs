// Lets `node --test` load app modules, which import siblings without an
// extension ('../lib/dates') the way Metro and TypeScript resolve them.
// Usage: node --experimental-strip-types --import ./test/register.mjs --test test/*.test.ts
import { registerHooks } from 'node:module';

const EXT = ['.ts', '.tsx', '/index.ts'];

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (!relative || /\.[cm]?[jt]sx?$/.test(specifier)) throw err;
      for (const ext of EXT) {
        try {
          return next(specifier + ext, context);
        } catch {
          // try the next extension
        }
      }
      throw err;
    }
  },
});

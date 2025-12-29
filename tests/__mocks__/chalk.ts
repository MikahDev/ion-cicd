/**
 * Simple chalk mock for tests
 * Returns the string unchanged
 */

type ChalkFn = ((str: string) => string) & {
  bold: ChalkFn;
  red: ChalkFn;
  blue: ChalkFn;
  green: ChalkFn;
  yellow: ChalkFn;
  gray: ChalkFn;
  cyan: ChalkFn;
  hex: (color: string) => ChalkFn;
};

const createChalkFn = (): ChalkFn => {
  const fn = ((str: string) => str) as ChalkFn;

  // Use Proxy to handle all property access
  return new Proxy(fn, {
    get: (_target, prop) => {
      if (prop === 'hex' || prop === 'rgb' || prop === 'hsl' || prop === 'keyword') {
        return () => createChalkFn();
      }
      return createChalkFn();
    },
    apply: (_target, _thisArg, args) => {
      return args[0] as string;
    },
  }) as ChalkFn;
};

export default createChalkFn();

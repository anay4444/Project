(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.createLruCache = factory();
  }
})(typeof globalThis === "object" ? globalThis : this, () => {
  const createLruCache = (limit) => {
    const entries = new Map();
    return {
      get(key) {
        if (!entries.has(key)) {
          return undefined;
        }
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      },
      has(key) {
        return entries.has(key);
      },
      set(key, value) {
        entries.delete(key);
        entries.set(key, value);
        while (entries.size > limit) {
          entries.delete(entries.keys().next().value);
        }
      },
      clear() {
        entries.clear();
      },
      get size() {
        return entries.size;
      }
    };
  };
  return createLruCache;
});

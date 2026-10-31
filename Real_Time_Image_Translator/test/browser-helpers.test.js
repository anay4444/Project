const test = require("node:test");
const assert = require("node:assert/strict");
const createLruCache = require("../public/cache");
const validateImageInfo = require("../public/image-validation");

test("LRU cache evicts the least recently used result", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.size, 2);
});

test("image validation rejects oversized files and dimensions", () => {
  assert.match(validateImageInfo({ size: 16 * 1024 * 1024, width: 100, height: 100 }), /15 MB/);
  assert.match(validateImageInfo({ size: 100, width: 10_001, height: 100 }), /dimensions/);
  assert.equal(validateImageInfo({ size: 100, width: 2_000, height: 2_000 }), null);
});

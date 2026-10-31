(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.validateImageInfo = factory();
  }
})(typeof globalThis === "object" ? globalThis : this, () => {
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 40_000_000;
  const MAX_IMAGE_DIMENSION = 10_000;

  return ({ size, width, height }) => {
    if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      return "Image must be between 1 byte and 15 MB.";
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
      return "Image dimensions are too large for browser OCR.";
    }
    return null;
  };
});

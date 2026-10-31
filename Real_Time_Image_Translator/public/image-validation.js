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

  const validateImageInfo = ({ size, width, height }) => {
    if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      return "Image must be between 1 byte and 15 MB.";
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
      return "Image dimensions are too large for browser OCR.";
    }
    return null;
  };

  validateImageInfo.readResponseBlobWithLimit = async (response) => {
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
      throw new Error("Remote image is larger than 15 MB.");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      if (blob.size > MAX_IMAGE_BYTES) {
        throw new Error("Remote image is larger than 15 MB.");
      }
      return blob;
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Remote image is larger than 15 MB.");
      }
      chunks.push(value);
    }
    return new Blob(chunks, { type: response.headers.get("content-type") || "image/*" });
  };

  return validateImageInfo;
});

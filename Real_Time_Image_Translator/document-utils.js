const xmlEscape = (value) => String(value).replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[char]));

const parseTxt = (text, maxLength = 100_000) => {
  if (text.length > maxLength) {
    throw new Error("Document text is too long.");
  }
  return text.split(/\r?\n/);
};

const collectXlsxTextCells = (workbook, maxCells = 5_000) => {
  const cells = [];
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    Object.keys(sheet).filter((key) => !key.startsWith("!")).forEach((address) => {
      const cell = sheet[address];
      if (cell && typeof cell.v === "string" && !cell.f && cell.v.trim()) {
        cells.push({ sheetName, address, text: cell.v });
      }
    });
  });
  if (cells.length > maxCells) {
    throw new Error("Workbook has too many text cells.");
  }
  return cells;
};

const applyXlsxTranslations = (workbook, cells, translations) => {
  if (cells.length !== translations.length) {
    throw new Error("Translation service returned incomplete results.");
  }
  cells.forEach((cell, index) => {
    workbook.Sheets[cell.sheetName][cell.address].v = translations[index];
    workbook.Sheets[cell.sheetName][cell.address].t = "s";
  });
  return workbook;
};

const extractDocxParagraphs = (xml) => {
  const decode = (value) => value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((match) =>
    [...match[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((text) => decode(text[1]))
      .join("")
  );
};

const buildDocx = async (paragraphs, JSZip) => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
};

module.exports = { parseTxt, collectXlsxTextCells, applyXlsxTranslations, extractDocxParagraphs, buildDocx };

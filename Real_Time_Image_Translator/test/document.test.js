const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const JSZip = require("jszip");
const { parseTxt, collectXlsxTextCells, applyXlsxTranslations, extractDocxParagraphs, buildDocx } = require("../document-utils");

test("preserves TXT line breaks", () => {
  assert.deepEqual(parseTxt("one\n\nthree"), ["one", "", "three"]);
});

test("translates XLSX text cells without changing formulas or numbers", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["hello", 42], ["formula", null]]);
  sheet.B2 = { t: "n", f: "1+1", v: 2 };
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const cells = collectXlsxTextCells(workbook);
  assert.deepEqual(cells.map((cell) => cell.address), ["A1", "A2"]);
  applyXlsxTranslations(workbook, cells, ["hola", "fórmula"]);
  assert.equal(workbook.Sheets.Sheet1.A1.v, "hola");
  assert.equal(workbook.Sheets.Sheet1.B1.v, 42);
  assert.equal(workbook.Sheets.Sheet1.B2.f, "1+1");
});

test("creates a readable DOCX and preserves paragraph order", async () => {
  const buffer = await buildDocx(["first", "second"], JSZip);
  const xml = await JSZip.loadAsync(buffer).then((zip) => zip.file("word/document.xml").async("text"));
  assert.deepEqual(extractDocxParagraphs(xml), ["first", "second"]);
});

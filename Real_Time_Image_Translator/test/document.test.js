const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { parseTxt, extractDocxParagraphs, buildDocx } = require("../document-utils");
const { parseXlsx, collectXlsxTextCells, applyXlsxTranslations, buildXlsx } = require("../xlsx-utils");

test("preserves TXT line breaks", () => {
  assert.deepEqual(parseTxt("one\n\nthree"), ["one", "", "three"]);
});

test("translates XLSX text cells without changing formulas or numbers", async () => {
  const workbook = {
    sheets: [{
      name: "Sheet1",
      cells: {
        A1: { value: "hello", formula: "", type: "inlineStr" },
        B1: { value: 42, formula: "", type: "n" },
        A2: { value: "formula", formula: "", type: "inlineStr" },
        B2: { value: 2, formula: "1+1", type: "n" }
      }
    }]
  };
  const parsed = await parseXlsx(await buildXlsx(workbook, JSZip), JSZip);
  const cells = collectXlsxTextCells(parsed);
  assert.deepEqual(cells.map((cell) => cell.address), ["A1", "A2"]);
  applyXlsxTranslations(parsed, cells, ["hola", "fórmula"]);
  assert.equal(parsed.sheets[0].cells.A1.value, "hola");
  assert.equal(parsed.sheets[0].cells.B1.value, 42);
  assert.equal(parsed.sheets[0].cells.B2.formula, "1+1");
});

test("rejects malformed XLSX files and excessive worksheet counts", async () => {
  await assert.rejects(() => parseXlsx(Buffer.from("not a zip"), JSZip), /malformed|end of central directory/i);
  const workbook = { sheets: Array.from({ length: 3 }, (_, index) => ({ name: `S${index}`, cells: {} })) };
  const buffer = await buildXlsx(workbook, JSZip);
  await assert.rejects(() => parseXlsx(buffer, JSZip, { maxSheets: 2 }), /worksheet count/);
});

test("preserves blank cell positions and enforces worksheet cell limits", async () => {
  const workbook = { sheets: [{ name: "Sheet1", cells: {
    A1: { value: "", formula: "", type: "inlineStr" },
    C3: { value: "text", formula: "", type: "inlineStr" }
  } }] };
  const parsed = await parseXlsx(await buildXlsx(workbook, JSZip), JSZip, { maxCells: 2 });
  assert.ok(parsed.sheets[0].cells.A1);
  assert.ok(parsed.sheets[0].cells.C3);
  const oversized = await buildXlsx({ sheets: [{ name: "Sheet1", cells: {
    A1: { value: "", formula: "", type: "inlineStr" },
    A2: { value: "", formula: "", type: "inlineStr" },
    A3: { value: "", formula: "", type: "inlineStr" }
  } }] }, JSZip);
  await assert.rejects(() => parseXlsx(oversized, JSZip, { maxCells: 2 }), /too many cells/);
});

test("creates a readable DOCX and preserves paragraph order", async () => {
  const buffer = await buildDocx(["first", "second"], JSZip);
  const xml = await JSZip.loadAsync(buffer).then((zip) => zip.file("word/document.xml").async("text"));
  assert.deepEqual(extractDocxParagraphs(xml), ["first", "second"]);
});

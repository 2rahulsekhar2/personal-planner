import ExcelJS from "exceljs";
import { cleanNote, type Cell } from "./money-sheet";

// A cell as its plain value: a formula gives its last result, formatted text gives its words.
function plain(v: unknown): Cell {
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (!v || typeof v !== "object") return null;
  const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
  if (o.richText) return o.richText.map((t) => t.text).join("");
  return plain("result" in o ? o.result : o.text);
}

/** The first sheet of an Excel file as rows of plain values, with its cell notes keyed "row,column" (both from 0). */
export async function readXlsx(file: ArrayBuffer): Promise<{ rows: Cell[][]; notes: Record<string, string> }> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file);
  const sheet = book.worksheets[0];
  if (!sheet) throw new Error("The file has no sheets.");
  const rows: Cell[][] = Array.from({ length: sheet.rowCount }, () => []);
  const notes: Record<string, string> = {};
  sheet.eachRow((row, r) => {
    row.eachCell((cell, c) => {
      (rows[r - 1] ??= [])[c - 1] = plain(cell.value);
      const note = typeof cell.note === "string" ? cell.note : cell.note?.texts?.map((t) => t.text).join("");
      if (note && cleanNote(note)) notes[`${r - 1},${c - 1}`] = cleanNote(note);
    });
  });
  return { rows, notes };
}

/** Rows as an Excel file. The first row is the heading: it stays in view, and its dates read "Jul 2023". */
export async function writeXlsx(rows: Cell[][]): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Budget", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  sheet.addRows(rows);
  sheet.getRow(1).numFmt = "mmm yyyy";
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(1).width = 40;
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

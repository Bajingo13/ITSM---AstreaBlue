const crypto = require("crypto");

const PROTECTION_OPTIONS = Object.freeze({
  selectLockedCells: true,
  selectUnlockedCells: true,
  autoFilter: true,
  sort: true,
  formatCells: false,
  formatColumns: false,
  formatRows: false,
  insertColumns: false,
  insertRows: false,
  insertHyperlinks: false,
  deleteColumns: false,
  deleteRows: false,
  objects: false,
  scenarios: false,
  pivotTables: false,
  // Worksheet protection is an edit guard, not file encryption. A moderate
  // spin count keeps large report exports responsive while Excel enforces it.
  spinCount: 1000,
});

async function protectWorksheet(worksheet) {
  if (!worksheet) throw new Error("A worksheet is required for export protection.");

  worksheet.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.protection = { ...cell.protection, locked: true, hidden: false };
    });
  });

  // The one-time password is intentionally not returned or persisted. Users
  // can filter/read the report, but cannot unprotect it through the Excel UI.
  const oneTimePassword = crypto.randomBytes(24).toString("base64url");
  await worksheet.protect(oneTimePassword, { ...PROTECTION_OPTIONS });
  return worksheet;
}

async function protectWorkbook(workbook) {
  if (!workbook?.worksheets?.length) throw new Error("A workbook with at least one worksheet is required.");
  for (const worksheet of workbook.worksheets) {
    await protectWorksheet(worksheet);
  }
  return workbook;
}

module.exports = { PROTECTION_OPTIONS, protectWorksheet, protectWorkbook };

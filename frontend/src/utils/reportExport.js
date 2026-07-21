import { API_URL } from "../config/api";
import { authHeaders } from "../services/authHeaders";

const cleanCell = (value) => String(value ?? "").replace(/\r?\n/g, " ").trim();

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportRowsAsReport({ filename, title, scope, format, columns, rows }) {
  const response = await fetch(`${API_URL}/api/v1/report-exports/tabular`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      filename,
      title,
      scope,
      format,
      columns: columns.map((column, index) => ({ key: `column_${index + 1}`, label: column.label, width: column.width })),
      rows: rows.map((row) => Object.fromEntries(columns.map((column, index) => [`column_${index + 1}`, cleanCell(column.value(row))]))),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Failed to export report.");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const extension = format === "excel" ? "xlsx" : format;
  downloadBlob(blob, match?.[1] || `${filename}.${extension}`);
}

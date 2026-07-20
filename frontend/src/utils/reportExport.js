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

export function exportRowsAsCsv({ filename, columns, rows }) {
  const escape = (value) => `"${cleanCell(value).replace(/"/g, '""')}"`;
  const content = [
    columns.map((column) => escape(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => escape(column.value(row))).join(",")),
  ].join("\r\n");
  downloadBlob(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
}

export function exportRowsAsJpeg({ filename, title, subtitle = "", columns, rows }) {
  const pageSize = 32;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const width = 1600;
  const margin = 54;
  const headerHeight = 142;
  const rowHeight = 42;

  for (let page = 0; page < pages; page += 1) {
    const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
    const height = headerHeight + 54 + Math.max(pageRows.length, 1) * rowHeight + 58;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4f8ff";
    ctx.fillRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#082a5e");
    gradient.addColorStop(1, "#168bd5");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, headerHeight);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 34px Arial";
    ctx.fillText(title, margin, 60);
    ctx.font = "18px Arial";
    ctx.fillText(subtitle || `Generated ${new Date().toLocaleString()}`, margin, 96);
    ctx.textAlign = "right";
    ctx.fillText(`Page ${page + 1} of ${pages}`, width - margin, 96);
    ctx.textAlign = "left";

    const tableWidth = width - margin * 2;
    const colWidth = tableWidth / columns.length;
    let y = headerHeight + 22;
    ctx.fillStyle = "#dbeafe";
    ctx.fillRect(margin, y, tableWidth, rowHeight);
    ctx.fillStyle = "#15335b";
    ctx.font = "700 15px Arial";
    columns.forEach((column, index) => ctx.fillText(cleanCell(column.label).slice(0, 24), margin + index * colWidth + 10, y + 27));
    y += rowHeight;

    const printableRows = pageRows.length ? pageRows : [{ empty: true }];
    printableRows.forEach((row, rowIndex) => {
      ctx.fillStyle = rowIndex % 2 ? "#f8fafc" : "#ffffff";
      ctx.fillRect(margin, y, tableWidth, rowHeight);
      ctx.strokeStyle = "#d9e5f4";
      ctx.strokeRect(margin, y, tableWidth, rowHeight);
      ctx.fillStyle = "#27364d";
      ctx.font = "14px Arial";
      if (row.empty) {
        ctx.fillText("No records matched the selected filters.", margin + 10, y + 27);
      } else {
        columns.forEach((column, index) => {
          const value = cleanCell(column.value(row));
          ctx.save();
          ctx.beginPath();
          ctx.rect(margin + index * colWidth + 8, y, colWidth - 16, rowHeight);
          ctx.clip();
          ctx.fillText(value, margin + index * colWidth + 10, y + 27);
          ctx.restore();
        });
      }
      y += rowHeight;
    });

    const suffix = pages > 1 ? `-page-${page + 1}` : "";
    canvas.toBlob((blob) => blob && downloadBlob(blob, `${filename}${suffix}.jpg`), "image/jpeg", 0.92);
  }
}


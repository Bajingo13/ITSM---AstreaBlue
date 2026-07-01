/**
 * emailTemplates.js
 * Shared email template blueprint for AstreaBlue ITSM.
 */

const primaryBlue = "#2563EB";
const accentCyan = "#38BDF8";
const deepNavy = "#0F172A";
const lightBg = "#EAF4FF";

function generateEmailHtml(title, bodyContent) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          background-color: ${lightBg};
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .wrapper {
          width: 100%;
          table-layout: fixed;
          background-color: ${lightBg};
          padding: 40px 0;
        }
        .main-card {
          margin: 0 auto;
          width: 100%;
          max-width: 600px;
          background-color: #ffffff;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .header {
          background: linear-gradient(135deg, ${primaryBlue} 0%, ${accentCyan} 100%);
          padding: 30px 40px;
          text-align: center;
        }
        .header h1 {
          color: #ffffff;
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .content {
          padding: 40px;
          color: ${deepNavy};
          line-height: 1.6;
          font-size: 16px;
        }
        .content p {
          margin-top: 0;
          margin-bottom: 20px;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, ${primaryBlue} 0%, ${accentCyan} 100%);
          color: #ffffff !important;
          text-decoration: none;
          padding: 14px 28px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 16px;
          margin: 10px 0;
          text-align: center;
        }
        .data-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .data-table th {
          text-align: left;
          padding: 10px;
          background-color: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          color: #64748b;
          font-weight: 600;
          font-size: 14px;
          width: 35%;
        }
        .data-table td {
          padding: 10px;
          border-bottom: 1px solid #e2e8f0;
          color: ${deepNavy};
          font-size: 14px;
        }
        .footer {
          background-color: #f8fafc;
          padding: 20px 40px;
          text-align: center;
          border-top: 1px solid #e2e8f0;
        }
        .footer p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.5;
        }
        .timestamp {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 10px;
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="main-card">
          <div class="header">
            <h1>AstreaBlue ITSM</h1>
          </div>
          <div class="content">
            ${bodyContent}
          </div>
          <div class="footer">
            <p>This is an automated message from AstreaBlue ITSM. Please do not reply.</p>
            <p class="timestamp">${new Date().toUTCString()}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  generateEmailHtml,
};

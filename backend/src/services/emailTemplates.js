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
          background-color: #EAF4FF;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .wrapper {
          width: 100%;
          table-layout: fixed;
          background-color: #EAF4FF;
          padding: 40px 0;
        }
        .main-card {
          margin: 0 auto;
          width: 100%;
          max-width: 600px;
          background-color: #ffffff;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
        }
        .header {
          background: linear-gradient(135deg, #2563EB 0%, #38BDF8 100%);
          padding: 36px 40px;
          text-align: center;
        }
        .header h1 {
          color: #ffffff;
          margin: 0;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .header p {
          color: rgba(255,255,255,0.85);
          margin: 6px 0 0;
          font-size: 14px;
        }
        .content {
          padding: 36px 40px 28px;
          color: #0F172A;
          line-height: 1.7;
          font-size: 15px;
        }
        .content p {
          margin-top: 0;
          margin-bottom: 18px;
        }
        .info-block {
          background: #F8FAFC;
          border-radius: 12px;
          padding: 18px 22px;
          margin-bottom: 24px;
          border: 1px solid #E2E8F0;
        }
        .info-block strong {
          color: #2563EB;
        }
        .button-wrapper {
          text-align: center;
          margin: 28px 0;
        }
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #2563EB 0%, #38BDF8 100%);
          color: #ffffff !important;
          text-decoration: none;
          padding: 14px 32px;
          border-radius: 10px;
          font-weight: 700;
          font-size: 15px;
          text-align: center;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2);
        }
        .button:hover {
          box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3);
        }
        .fallback-link {
          text-align: center;
          margin: 18px 0 0;
          font-size: 13px;
          color: #64748B;
        }
        .fallback-link a {
          color: #2563EB;
          word-break: break-all;
        }
        .footer {
          background-color: #F8FAFC;
          padding: 24px 40px;
          text-align: center;
          border-top: 1px solid #E2E8F0;
        }
        .footer p {
          margin: 0 0 4px;
          color: #64748B;
          font-size: 13px;
          line-height: 1.6;
        }
        .footer strong {
          color: #334155;
        }
        .footer .timestamp {
          font-size: 11px;
          color: #94A3B8;
          margin-top: 10px;
        }
        @media only screen and (max-width: 480px) {
          .content { padding: 24px 20px 20px; }
          .header { padding: 28px 20px; }
          .footer { padding: 20px; }
          .button { display: block; }
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="main-card">
          <div class="header">
            <h1>AstreaBlue ITSM</h1>
            <p>Enterprise IT Service Management</p>
          </div>
          <div class="content">
            ${bodyContent}
          </div>
          <div class="footer">
            <p><strong>AstreaBlue ITSM System</strong></p>
            <p>Enterprise IT Service Management Platform</p>
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

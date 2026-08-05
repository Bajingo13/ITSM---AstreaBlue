const { Pool } = require("pg");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Support both Railway-style DATABASE_URL and local individual DB_* vars
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("railway.app") || process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
    })
  : new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
    });

console.log(
  `[AstreaBlue DB] ${process.env.DATABASE_URL ? "Railway DATABASE_URL" : `host=${process.env.DB_HOST || "localhost"} port=${process.env.DB_PORT || 5432} database=${process.env.DB_NAME || ""}`}`
);

pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("Database handshake failed:", err.stack);
  } else {
    console.log("AstreaBlue DB connected successfully at:", res.rows[0].now);
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
  rawPool: pool,
};

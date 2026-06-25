const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Initialize the connection pool using our secure environment variables
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME
});

// Run a quick query on startup to verify the handshake works
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database handshake failed! Error:', err.stack);
    } else {
        console.log('🚀 AstreaBlue DB connected successfully at:', res.rows[0].now);
    }
});

// Export a unified query wrapper object to perfectly align with your REST routes
module.exports = {
    query: (text, params) => pool.query(text, params),
    rawPool: pool // Kept available in case you need direct transaction access later
};

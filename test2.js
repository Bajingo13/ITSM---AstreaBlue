require('dotenv').config();
const db = require('./backend/config/db');
async function test() {
  try {
    const laptopMonitoring = require('./backend/src/routes/laptopMonitoring');
    console.log("Required successfully");
    setTimeout(() => { process.exit() }, 2000);
  } catch(e) {
    console.error("Require failed", e);
  }
}
test();

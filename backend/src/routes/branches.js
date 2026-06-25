const express = require("express");
const db = require("../../config/db");

const router = express.Router();

async function ensureRoleBranchManagement() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS branches (
        branch_id SERIAL PRIMARY KEY,
        branch_code VARCHAR(50),
        branch_name VARCHAR(150) NOT NULL,
        region VARCHAR(100),
        province VARCHAR(100),
        city_municipality VARCHAR(150),
        branch_location VARCHAR(255),
        is_headquarters BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      ALTER TABLE branches
      ADD COLUMN IF NOT EXISTS branch_code VARCHAR(50),
      ADD COLUMN IF NOT EXISTS region VARCHAR(100),
      ADD COLUMN IF NOT EXISTS province VARCHAR(100),
      ADD COLUMN IF NOT EXISTS city_municipality VARCHAR(150),
      ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT FALSE
    `);

    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id),
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20)
    `);

    await db.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(branch_id)
    `);

    await db.query(`
      INSERT INTO system_roles (role_name)
      SELECT role_name
      FROM (VALUES
        ('SuperAdmin'),
        ('Admin'),
        ('Technician'),
        ('Employee')
      ) AS required_roles(role_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM system_roles sr
        WHERE LOWER(sr.role_name) = LOWER(required_roles.role_name)
      )
    `);

    await db.query(`
      INSERT INTO users
      (full_name, email, password_hash, role_id, company_name, status, is_active)
      SELECT
        'Super Administrator',
        'superadmin@astreablue.com',
        'superadmin123',
        sr.role_id,
        'AstreaBlue',
        'Active',
        TRUE
      FROM system_roles sr
      WHERE LOWER(sr.role_name) = 'superadmin'
        AND NOT EXISTS (
          SELECT 1
          FROM users u
          WHERE LOWER(u.email) = 'superadmin@astreablue.com'
        )
      LIMIT 1
    `);
  } catch (err) {
    console.error("Role/branch setup error:", err.message);
  }
}

ensureRoleBranchManagement();

router.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        b.branch_id,
        b.branch_code,
        COALESCE(b.branch_name, 'Unassigned Branch') AS branch_name,
        b.region,
        b.province,
        b.city_municipality,
        b.branch_location,
        b.is_headquarters,
        b.is_active,
        b.created_at,
        admin.user_id AS admin_user_id,
        admin.full_name AS admin_name,
        admin.email AS admin_email
      FROM branches b
      LEFT JOIN LATERAL (
        SELECT u.user_id, u.full_name, u.email
        FROM users u
        JOIN system_roles sr
          ON u.role_id = sr.role_id
        WHERE u.branch_id = b.branch_id
          AND LOWER(sr.role_name) = 'admin'
          AND COALESCE(u.is_active, TRUE) = TRUE
        ORDER BY u.user_id ASC
        LIMIT 1
      ) admin ON TRUE
      ORDER BY b.branch_name ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch branches error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch branches",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      branch_name,
      branch_code = null,
      region = null,
      province = null,
      city_municipality = null,
      branch_location = null,
      is_active = true,
      is_headquarters = false,
      admin_user_id = null,
    } = req.body;

    if (!branch_name) {
      return res.status(400).json({
        success: false,
        error: "Branch name is required",
      });
    }

    const result = await db.query(
      `
      INSERT INTO branches
      (branch_name, branch_code, region, province, city_municipality, branch_location, is_active, is_headquarters)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        branch_name,
        branch_code,
        region,
        province,
        city_municipality,
        branch_location,
        is_active,
        is_headquarters,
      ]
    );

    if (admin_user_id) {
      await db.query(
        `UPDATE users SET branch_id = $1 WHERE user_id = $2`,
        [result.rows[0].branch_id, admin_user_id]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create branch error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to create branch",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      branch_name,
      branch_code = null,
      region = null,
      province = null,
      city_municipality = null,
      branch_location = null,
      is_active = true,
      is_headquarters = false,
      admin_user_id = null,
    } = req.body;

    if (!branch_name) {
      return res.status(400).json({
        success: false,
        error: "Branch name is required",
      });
    }

    const result = await db.query(
      `
      UPDATE branches
      SET
        branch_name = $1,
        branch_code = $2,
        region = $3,
        province = $4,
        city_municipality = $5,
        branch_location = $6,
        is_active = $7,
        is_headquarters = $8
      WHERE branch_id = $9
      RETURNING *
      `,
      [
        branch_name,
        branch_code,
        region,
        province,
        city_municipality,
        branch_location,
        is_active,
        is_headquarters,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Branch not found",
      });
    }

    if (admin_user_id) {
      await db.query(
        `UPDATE users SET branch_id = $1 WHERE user_id = $2`,
        [id, admin_user_id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update branch error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update branch",
    });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        success: false,
        error: "is_active must be true or false",
      });
    }

    const result = await db.query(
      `
      UPDATE branches
      SET is_active = $1
      WHERE branch_id = $2
      RETURNING *
      `,
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Branch not found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update branch status error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to update branch status",
    });
  }
});

router.patch("/:id/admin", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "Admin user is required",
      });
    }

    const result = await db.query(
      `
      UPDATE users
      SET branch_id = $1
      WHERE user_id = $2
      RETURNING user_id, full_name, email, branch_id
      `,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Assign branch admin error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to assign branch admin",
    });
  }
});

module.exports = router;

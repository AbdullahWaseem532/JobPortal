import express from 'express';
import pkg from '../db.js';
const { pool } = pkg;
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM user_profiles');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { user_id, first_name, last_name, phone, location, resume_url, bio, experience_years } = req.body;
  const result = await pool.query(
    `INSERT INTO user_profiles (user_id, first_name, last_name, phone, location, resume_url, bio, experience_years)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [user_id, first_name, last_name, phone, location, resume_url, bio, experience_years]
  );
  res.json(result.rows[0]);
});

export default router;

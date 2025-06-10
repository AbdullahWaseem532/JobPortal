import express from 'express';
const router = express.Router();
import pkg from '../db.js';
const { pool } = pkg;

// GET all companies
router.get('/', async (req, res) => {
  try {
    const companiesResult = await pool.query(`
      SELECT * FROM companies
      ORDER BY company_name ASC
    `);
    
    res.json(companiesResult.rows);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// GET single company by ID with employer details
router.get('/:id', async (req, res) => {
  const companyId = req.params.id;
  
  try {
    // Get company details
    const companyResult = await pool.query(`
      SELECT * FROM companies
      WHERE company_id = $1
    `, [companyId]);
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    const company = companyResult.rows[0];
    
    // Get employer (user) details
    const userResult = await pool.query(`
      SELECT u.user_id, u.email, u.user_type, u.created_at, u.updated_at, u.is_active,
             p.first_name, p.last_name, p.phone, p.location, p.bio
      FROM users u
      LEFT JOIN user_profiles p ON u.user_id = p.user_id
      WHERE u.user_id = $1 AND u.user_type = 'employer'
    `, [company.user_id]);
    
    // Include employer details if found
    if (userResult.rows.length > 0) {
      company.employer = userResult.rows[0];
    }
    
    res.json(company);
  } catch (error) {
    console.error('Error fetching company:', error);
    res.status(500).json({ error: 'Failed to fetch company details' });
  }
});

export default router;
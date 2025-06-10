import express from 'express';
import pkg from '../db.js';
const { pool } = pkg;
const router = express.Router();

// GET all categories
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM categories
      ORDER BY category_name ASC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET category by ID
router.get('/:id', async (req, res) => {
  const categoryId = req.params.id;
  
  try {
    const result = await pool.query(`
      SELECT * FROM categories
      WHERE category_id = $1
    `, [categoryId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

export default router;
import express from 'express';
import pkg from '../db.js';
const { pool } = pkg;
const router = express.Router();

// GET all jobs with filtering options
router.get('/', async (req, res) => {
  try {
    // Build the query with optional filters
    let query = `
      SELECT j.*, c.company_name, cat.category_name as category_name
      FROM jobs j
      LEFT JOIN companies c ON j.company_id = c.company_id
      LEFT JOIN categories cat ON j.category_id = cat.category_id
      WHERE 1=1
    `;
    
    const queryParams = [];
    
    // Filter by status
    if (req.query.status) {
      query += ` AND j.status = $${queryParams.length + 1}`;
      queryParams.push(req.query.status);
    } else {
      // By default, only show active jobs
      query += ` AND j.status = 'active'`;
    }
    
    // Filter by job type
    if (req.query.job_type) {
      query += ` AND j.job_type = $${queryParams.length + 1}`;
      queryParams.push(req.query.job_type);
    }
    
    // Filter by category
    if (req.query.category_id) {
      query += ` AND j.category_id = $${queryParams.length + 1}`;
      queryParams.push(parseInt(req.query.category_id));
    }
    
    // Filter by company
    if (req.query.company_id) {
      query += ` AND j.company_id = $${queryParams.length + 1}`;
      queryParams.push(parseInt(req.query.company_id));
    }
    
    // Filter by remote option
    if (req.query.is_remote === 'true') {
      query += ` AND j.is_remote = true`;
    } else if (req.query.is_remote === 'false') {
      query += ` AND j.is_remote = false`;
    }
    
    // Filter by location (partial match)
    if (req.query.location) {
      query += ` AND j.location ILIKE $${queryParams.length + 1}`;
      queryParams.push(`%${req.query.location}%`);
    }
    
    // Filter by search term (matches title or description)
    if (req.query.search) {
      query += ` AND (j.title ILIKE $${queryParams.length + 1} OR j.description ILIKE $${queryParams.length + 1})`;
      queryParams.push(`%${req.query.search}%`);
    }
    
    // Sort by posted date (newest first) as default
    query += ` ORDER BY j.posted_date DESC`;
    
    // Execute the query
    const result = await pool.query(query, queryParams);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// GET job details by ID
router.get('/:id', async (req, res) => {
  const jobId = req.params.id;
  
  try {
    // Get job details with company and category information
    const jobResult = await pool.query(`
      SELECT j.*, c.company_name, c.industry, c.website, c.logo_url,
             cat.category_name as category_name
      FROM jobs j
      LEFT JOIN companies c ON j.company_id = c.company_id
      LEFT JOIN categories cat ON j.category_id = cat.category_id
      WHERE j.job_id = $1
    `, [jobId]);
    
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(jobResult.rows[0]);
    
  } catch (error) {
    console.error('Error fetching job details:', error);
    res.status(500).json({ error: 'Failed to fetch job details' });
  }
});

// POST a new job
router.post('/', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { 
      company_id,
      category_id,
      title,
      description,
      requirements,
      salary_min,
      salary_max,
      job_type,
      location,
      is_remote,
      status,
      deadline
    } = req.body;
    
    // Validate required fields
    if (!company_id || !title || !description || !job_type) {
      return res.status(400).json({ 
        error: 'Company ID, title, description, and job type are required' 
      });
    }
    
    // Validate job_type
    const validJobTypes = ['full-time', 'part-time', 'contract', 'internship'];
    if (!validJobTypes.includes(job_type)) {
      return res.status(400).json({
        error: 'Invalid job type. Must be full-time, part-time, contract, or internship'
      });
    }
    
    // Validate status
    const validStatuses = ['active', 'closed', 'draft'];
    const jobStatus = status || 'active'; // Default to active if not provided
    if (!validStatuses.includes(jobStatus)) {
      return res.status(400).json({
        error: 'Invalid status. Must be active, closed, or draft'
      });
    }
    
    // Check if company exists
    const companyResult = await client.query(
      'SELECT * FROM companies WHERE company_id = $1',
      [company_id]
    );
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Check if category exists if provided
    if (category_id) {
      const categoryResult = await client.query(
        'SELECT * FROM categories WHERE category_id = $1',
        [category_id]
      );
      
      if (categoryResult.rows.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }
    
    // Validate salary range if both provided
    if (salary_min && salary_max && parseFloat(salary_min) > parseFloat(salary_max)) {
      return res.status(400).json({
        error: 'Minimum salary cannot be greater than maximum salary'
      });
    }
    
    // Insert job
    const insertQuery = `
      INSERT INTO jobs (
        company_id,
        category_id,
        title,
        description,
        requirements,
        salary_min,
        salary_max,
        job_type,
        location,
        is_remote,
        status,
        deadline
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    
    const values = [
      company_id,
      category_id || null,
      title,
      description,
      requirements || null,
      salary_min || null,
      salary_max || null,
      job_type,
      location || null,
      is_remote || false,
      jobStatus,
      deadline || null
    ];
    
    const jobResult = await client.query(insertQuery, values);
    const newJob = jobResult.rows[0];
    
    // Get company and category info for the response
    if (newJob) {
      // Get company info
      const companyInfo = await client.query(
        'SELECT company_name FROM companies WHERE company_id = $1',
        [company_id]
      );
      
      if (companyInfo.rows.length > 0) {
        newJob.company_name = companyInfo.rows[0].company_name;
      }
      
      // Get category info if provided
      if (category_id) {
        const categoryInfo = await client.query(
          'SELECT name as category_name FROM categories WHERE category_id = $1',
          [category_id]
        );
        
        if (categoryInfo.rows.length > 0) {
          newJob.category_name = categoryInfo.rows[0].category_name;
        }
      }
    }
    
    await client.query('COMMIT');
    
    res.status(201).json(newJob);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating job:', error);
    
    res.status(500).json({ error: 'Failed to create job' });
  } finally {
    client.release();
  }
});

export default router;
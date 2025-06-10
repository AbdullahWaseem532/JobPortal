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
    
    // Sort options
    let sortColumn = 'j.posted_date';
    let sortOrder = 'DESC';
    
    if (req.query.sort) {
      switch (req.query.sort) {
        case 'title':
          sortColumn = 'j.title';
          sortOrder = 'ASC';
          break;
        case 'company':
          sortColumn = 'c.company_name';
          sortOrder = 'ASC';
          break;
        case 'salary':
          sortColumn = 'j.salary_max';
          sortOrder = 'DESC';
          break;
        case 'deadline':
          sortColumn = 'j.deadline';
          sortOrder = 'ASC';
          break;
        // Default is already set to posted_date DESC
      }
    }
    
    query += ` ORDER BY ${sortColumn} ${sortOrder}`;
    
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
    // Get job details with company and category
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
    
    // Validate that company exists
    const companyResult = await client.query(
      'SELECT * FROM companies WHERE company_id = $1',
      [company_id]
    );
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Validate that category exists if provided
    if (category_id) {
      const categoryResult = await client.query(
        'SELECT * FROM categories WHERE category_id = $1',
        [category_id]
      );
      
      if (categoryResult.rows.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }
    
    // Validate salary range
    if (salary_min && salary_max && parseFloat(salary_min) > parseFloat(salary_max)) {
      return res.status(400).json({
        error: 'Minimum salary cannot be greater than maximum salary'
      });
    }
    
    // Build the SQL query dynamically based on provided fields
    const fields = ['company_id', 'title', 'description', 'job_type', 'status'];
    const values = [company_id, title, description, job_type, jobStatus];
    const placeholders = ['$1', '$2', '$3', '$4', '$5'];
    let paramIndex = 6;
    
    // Add optional fields if provided
    if (category_id) {
      fields.push('category_id');
      values.push(category_id);
      placeholders.push(`$${paramIndex++}`);
    }
    
    if (requirements) {
      fields.push('requirements');
      values.push(requirements);
      placeholders.push(`$${paramIndex++}`);
    }
    
    if (salary_min !== undefined) {
      fields.push('salary_min');
      values.push(salary_min);
      placeholders.push(`$${paramIndex++}`);
    }
    
    if (salary_max !== undefined) {
      fields.push('salary_max');
      values.push(salary_max);
      placeholders.push(`$${paramIndex++}`);
    }
    
    if (location) {
      fields.push('location');
      values.push(location);
      placeholders.push(`$${paramIndex++}`);
    }
    
    if (is_remote !== undefined) {
      fields.push('is_remote');
      values.push(is_remote);
      placeholders.push(`$${paramIndex++}`);
    }
    
    if (deadline) {
      fields.push('deadline');
      values.push(deadline);
      placeholders.push(`$${paramIndex++}`);
    }
    
    // Insert job
    const insertQuery = `
      INSERT INTO jobs (${fields.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;
    
    const jobResult = await client.query(insertQuery, values);
    const newJob = jobResult.rows[0];
    
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

// PUT/UPDATE job by ID
router.put('/:id', async (req, res) => {
  const jobId = req.params.id;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if job exists
    const checkJob = await client.query(
      'SELECT * FROM jobs WHERE job_id = $1',
      [jobId]
    );
    
    if (checkJob.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const existingJob = checkJob.rows[0];
    
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
    
    // Validate job_type if provided
    if (job_type) {
      const validJobTypes = ['full-time', 'part-time', 'contract', 'internship'];
      if (!validJobTypes.includes(job_type)) {
        return res.status(400).json({
          error: 'Invalid job type. Must be full-time, part-time, contract, or internship'
        });
      }
    }
    
    // Validate status if provided
    if (status) {
      const validStatuses = ['active', 'closed', 'draft'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Invalid status. Must be active, closed, or draft'
        });
      }
    }
    
    // Validate that company exists if company_id is provided
    if (company_id) {
      const companyResult = await client.query(
        'SELECT * FROM companies WHERE company_id = $1',
        [company_id]
      );
      
      if (companyResult.rows.length === 0) {
        return res.status(404).json({ error: 'Company not found' });
      }
    }
    
    // Validate that category exists if category_id is provided
    if (category_id) {
      const categoryResult = await client.query(
        'SELECT * FROM categories WHERE category_id = $1',
        [category_id]
      );
      
      if (categoryResult.rows.length === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }
    
    // Validate salary range
    if (salary_min && salary_max && parseFloat(salary_min) > parseFloat(salary_max)) {
      return res.status(400).json({
        error: 'Minimum salary cannot be greater than maximum salary'
      });
    }
    
    // Build the SET clause for UPDATE
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    // Define fields to update if provided
    const updateFields = {
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
    };
    
    // Add each field to the SET clause if provided
    for (const [field, value] of Object.entries(updateFields)) {
      if (value !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }
    
    // Add updated_at timestamp
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    
    // If no fields to update, return the existing job
    if (updates.length === 0) {
      return res.json(existingJob);
    }
    
    // Add the job_id to the values array
    values.push(jobId);
    
    // Update job
    const updateQuery = `
      UPDATE jobs
      SET ${updates.join(', ')}
      WHERE job_id = $${paramIndex}
      RETURNING *
    `;
    
    const jobResult = await client.query(updateQuery, values);
    const updatedJob = jobResult.rows[0];
    
    await client.query('COMMIT');
    
    res.json(updatedJob);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating job:', error);
    
    res.status(500).json({ error: 'Failed to update job' });
  } finally {
    client.release();
  }
});

// DELETE job by ID
router.delete('/:id', async (req, res) => {
  const jobId = req.params.id;
  
  try {
    // Check if job exists
    const checkJob = await pool.query(
      'SELECT * FROM jobs WHERE job_id = $1',
      [jobId]
    );
    
    if (checkJob.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Delete job
    await pool.query(
      'DELETE FROM jobs WHERE job_id = $1',
      [jobId]
    );
    
    res.json({ message: 'Job deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting job:', error);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

export default router;
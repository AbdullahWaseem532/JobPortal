import express from 'express';
import pkg from '../db.js';
const { pool } = pkg;
const router = express.Router();

// GET all applications for a user (for job seekers to see their applications)
router.get('/user/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  try {
    // Check if user exists and is a job seeker
    const userResult = await pool.query(
      'SELECT user_type FROM users WHERE user_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get all applications for this user with job and company details
    const applicationsResult = await pool.query(`
      SELECT a.*, j.title as job_title, j.job_type, j.location, j.is_remote, 
             c.company_name, c.company_id
      FROM applications a
      JOIN jobs j ON a.job_id = j.job_id
      JOIN companies c ON j.company_id = c.company_id
      WHERE a.user_id = $1
      ORDER BY a.applied_date DESC
    `, [userId]);
    
    res.json(applicationsResult.rows);
    
  } catch (error) {
    console.error('Error fetching user applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// GET all applications for a job (for employers to review applications)
router.get('/job/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  
  try {
    // Check if job exists
    const jobResult = await pool.query(
      'SELECT j.*, c.company_name FROM jobs j JOIN companies c ON j.company_id = c.company_id WHERE j.job_id = $1',
      [jobId]
    );
    
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Get all applications for this job with user details
    const applicationsResult = await pool.query(`
      SELECT a.*, 
             u.email,
             p.first_name, p.last_name, p.phone, p.location, p.resume_url, p.experience_years
      FROM applications a
      JOIN users u ON a.user_id = u.user_id
      LEFT JOIN user_profiles p ON u.user_id = p.user_id
      WHERE a.job_id = $1
      ORDER BY 
        CASE 
          WHEN a.status = 'shortlisted' THEN 1
          WHEN a.status = 'reviewed' THEN 2
          WHEN a.status = 'pending' THEN 3
          WHEN a.status = 'rejected' THEN 4
          WHEN a.status = 'hired' THEN 5
          ELSE 6
        END,
        a.applied_date DESC
    `, [jobId]);
    
    // Add job details to the response
    const response = {
      job: jobResult.rows[0],
      applications: applicationsResult.rows
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Error fetching job applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// GET a specific application by ID
router.get('/:applicationId', async (req, res) => {
  const applicationId = req.params.applicationId;
  
  try {
    // Get application with job, company, and user details
    const applicationResult = await pool.query(`
      SELECT a.*, 
             j.title as job_title, j.description as job_description, j.job_type, j.location, j.is_remote, 
             c.company_name, c.company_id,
             u.email,
             p.first_name, p.last_name, p.phone, p.location as user_location, p.resume_url, p.experience_years
      FROM applications a
      JOIN jobs j ON a.job_id = j.job_id
      JOIN companies c ON j.company_id = c.company_id
      JOIN users u ON a.user_id = u.user_id
      LEFT JOIN user_profiles p ON u.user_id = p.user_id
      WHERE a.application_id = $1
    `, [applicationId]);
    
    if (applicationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    res.json(applicationResult.rows[0]);
    
  } catch (error) {
    console.error('Error fetching application details:', error);
    res.status(500).json({ error: 'Failed to fetch application details' });
  }
});

// POST a new application
router.post('/', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { 
      job_id,
      user_id,
      cover_letter
    } = req.body;
    
    // Validate required fields
    if (!job_id || !user_id) {
      return res.status(400).json({ 
        error: 'Job ID and User ID are required' 
      });
    }
    
    // Check if user exists and is a job seeker
    const userResult = await client.query(
      'SELECT user_type FROM users WHERE user_id = $1',
      [user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (userResult.rows[0].user_type !== 'job_seeker') {
      return res.status(403).json({ 
        error: 'Only job seekers can apply for jobs' 
      });
    }
    
    // Check if job exists and is active
    const jobResult = await client.query(
      'SELECT status FROM jobs WHERE job_id = $1',
      [job_id]
    );
    
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (jobResult.rows[0].status !== 'active') {
      return res.status(400).json({ 
        error: 'Cannot apply to a job that is not active' 
      });
    }
    
    // Check if user has already applied to this job
    const existingApplicationResult = await client.query(
      'SELECT * FROM applications WHERE job_id = $1 AND user_id = $2',
      [job_id, user_id]
    );
    
    if (existingApplicationResult.rows.length > 0) {
      return res.status(409).json({ 
        error: 'You have already applied to this job' 
      });
    }
    
    // Insert application
    const insertQuery = `
      INSERT INTO applications (job_id, user_id, cover_letter, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING *
    `;
    
    const applicationResult = await client.query(insertQuery, [
      job_id,
      user_id,
      cover_letter || null
    ]);
    
    const newApplication = applicationResult.rows[0];
    
    // Get job and company details for the response
    const jobDetailsResult = await client.query(`
      SELECT j.title as job_title, c.company_name
      FROM jobs j
      JOIN companies c ON j.company_id = c.company_id
      WHERE j.job_id = $1
    `, [job_id]);
    
    if (jobDetailsResult.rows.length > 0) {
      newApplication.job_title = jobDetailsResult.rows[0].job_title;
      newApplication.company_name = jobDetailsResult.rows[0].company_name;
    }
    
    await client.query('COMMIT');
    
    res.status(201).json(newApplication);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating application:', error);
    
    res.status(500).json({ error: 'Failed to submit application' });
  } finally {
    client.release();
  }
});

// PATCH update application status (for employers to update status)
router.patch('/:applicationId/status', async (req, res) => {
  const applicationId = req.params.applicationId;
  const { status } = req.body;
  
  // Validate status
  const validStatuses = ['pending', 'reviewed', 'shortlisted', 'rejected', 'hired'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Invalid status. Must be pending, reviewed, shortlisted, rejected, or hired'
    });
  }
  
  try {
    // Check if application exists
    const applicationResult = await pool.query(
      'SELECT * FROM applications WHERE application_id = $1',
      [applicationId]
    );
    
    if (applicationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    // Update application status
    const updateResult = await pool.query(`
      UPDATE applications
      SET status = $1, updated_date = CURRENT_TIMESTAMP
      WHERE application_id = $2
      RETURNING *
    `, [status, applicationId]);
    
    res.json(updateResult.rows[0]);
    
  } catch (error) {
    console.error('Error updating application status:', error);
    res.status(500).json({ error: 'Failed to update application status' });
  }
});

// DELETE application (for job seekers to withdraw their application)
router.delete('/:applicationId', async (req, res) => {
  const applicationId = req.params.applicationId;
  const userId = req.query.userId; // Should be provided by the frontend
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  try {
    // Check if application exists and belongs to the user
    const applicationResult = await pool.query(
      'SELECT * FROM applications WHERE application_id = $1 AND user_id = $2',
      [applicationId, userId]
    );
    
    if (applicationResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Application not found or does not belong to this user' 
      });
    }
    
    // Delete the application
    await pool.query(
      'DELETE FROM applications WHERE application_id = $1',
      [applicationId]
    );
    
    res.json({ message: 'Application withdrawn successfully' });
    
  } catch (error) {
    console.error('Error withdrawing application:', error);
    res.status(500).json({ error: 'Failed to withdraw application' });
  }
});

export default router;
import express from 'express';
import pkg from '../db.js';
const { pool } = pkg;
const router = express.Router();

// GET dashboard stats (counts of users, companies, jobs, applications)
router.get('/stats', async (req, res) => {
  try {
    // Get counts from all tables
    const userCountResult = await pool.query('SELECT COUNT(*) FROM users');
    const companyCountResult = await pool.query('SELECT COUNT(*) FROM companies');
    const jobCountResult = await pool.query('SELECT COUNT(*) FROM jobs');
    const applicationCountResult = await pool.query('SELECT COUNT(*) FROM applications');
    
    // Get active jobs count
    const activeJobsResult = await pool.query("SELECT COUNT(*) FROM jobs WHERE status = 'active'");
    
    const stats = {
      totalUsers: parseInt(userCountResult.rows[0].count),
      totalCompanies: parseInt(companyCountResult.rows[0].count),
      totalJobs: parseInt(jobCountResult.rows[0].count),
      totalApplications: parseInt(applicationCountResult.rows[0].count),
      activeJobs: parseInt(activeJobsResult.rows[0].count)
    };
    
    res.json(stats);
    
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// GET user type distribution
router.get('/user-types', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT user_type, COUNT(*) as count
      FROM users
      GROUP BY user_type
      ORDER BY count DESC
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching user types:', error);
    res.status(500).json({ error: 'Failed to fetch user type distribution' });
  }
});

// GET job types distribution
router.get('/job-types', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT job_type, COUNT(*) as count
      FROM jobs
      GROUP BY job_type
      ORDER BY count DESC
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching job types:', error);
    res.status(500).json({ error: 'Failed to fetch job type distribution' });
  }
});

// GET application status distribution
router.get('/application-statuses', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM applications
      GROUP BY status
      ORDER BY count DESC
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching application statuses:', error);
    res.status(500).json({ error: 'Failed to fetch application status distribution' });
  }
});

// GET jobs per company (top 10)
router.get('/jobs-per-company', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.company_name, COUNT(j.job_id) as job_count
      FROM companies c
      JOIN jobs j ON c.company_id = j.company_id
      GROUP BY c.company_id, c.company_name
      ORDER BY job_count DESC
      LIMIT 10
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching jobs per company:', error);
    res.status(500).json({ error: 'Failed to fetch jobs per company data' });
  }
});

// GET applications per month (last 6 months)
router.get('/applications-timeline', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        DATE_TRUNC('month', applied_date) as month,
        COUNT(*) as application_count
      FROM 
        applications
      WHERE 
        applied_date >= NOW() - INTERVAL '6 months'
      GROUP BY 
        DATE_TRUNC('month', applied_date)
      ORDER BY 
        month
    `);
    
    // Format dates to be more readable
    const formattedResults = result.rows.map(row => ({
      month: new Date(row.month).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }),
      application_count: parseInt(row.application_count)
    }));
    
    res.json(formattedResults);
    
  } catch (error) {
    console.error('Error fetching applications timeline:', error);
    res.status(500).json({ error: 'Failed to fetch applications timeline data' });
  }
});

// GET recent jobs (limit 5)
router.get('/recent-jobs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT j.job_id, j.title, j.job_type, j.posted_date, c.company_name
      FROM jobs j
      JOIN companies c ON j.company_id = c.company_id
      ORDER BY j.posted_date DESC
      LIMIT 5
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching recent jobs:', error);
    res.status(500).json({ error: 'Failed to fetch recent jobs' });
  }
});

// GET recent applications (limit 5)
router.get('/recent-applications', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.application_id, a.status, a.applied_date, 
             j.title as job_title, 
             c.company_name,
             u.email as user_email,
             CONCAT(p.first_name, ' ', p.last_name) as applicant_name
      FROM applications a
      JOIN jobs j ON a.job_id = j.job_id
      JOIN companies c ON j.company_id = c.company_id
      JOIN users u ON a.user_id = u.user_id
      LEFT JOIN user_profiles p ON u.user_id = p.user_id
      ORDER BY a.applied_date DESC
      LIMIT 5
    `);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching recent applications:', error);
    res.status(500).json({ error: 'Failed to fetch recent applications' });
  }
});

export default router;
import express from 'express';
import pkg from '../db.js';
const { pool } = pkg;
const router = express.Router();

// Get all users with their profiles
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        u.user_id,
        u.email,
        u.user_type,
        u.created_at,
        u.updated_at,
        u.is_active,
        p.profile_id,
        p.first_name,
        p.last_name,
        p.phone,
        p.location,
        p.resume_url,
        p.bio,
        p.experience_years
      FROM users u
      LEFT JOIN user_profiles p ON u.user_id = p.user_id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create a new user (with optional profile data)
router.post('/', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { 
      email, 
      password_hash, 
      user_type,
      first_name,
      last_name,
      phone,
      location,
      bio,
      experience_years,
      company  // This is the company object from the frontend
    } = req.body;

    // Validate required fields
    if (!email || !password_hash || !user_type) {
      return res.status(400).json({ 
        error: 'Email, password, and user type are required' 
      });
    }

    // Validate user_type
    const validUserTypes = ['job_seeker', 'employer', 'admin'];
    if (!validUserTypes.includes(user_type)) {
      return res.status(400).json({ 
        error: 'Invalid user type. Must be job_seeker, employer, or admin' 
      });
    }

    // Validate company data for employer accounts
    if (user_type === 'employer' && (!company || !company.company_name)) {
      return res.status(400).json({
        error: 'Company name is required for employer accounts'
      });
    }

    // Insert user
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, user_type) VALUES ($1, $2, $3) RETURNING *',
      [email, password_hash, user_type]
    );

    const newUser = userResult.rows[0];

    // If profile data is provided, create profile
    let profileResult = null;
    if (first_name && last_name) {
      profileResult = await client.query(
        `INSERT INTO user_profiles 
         (user_id, first_name, last_name, phone, location, bio, experience_years) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          newUser.user_id,
          first_name,
          last_name,
          phone || null,
          location || null,
          bio || null,
          experience_years || 0
        ]
      );
    }

    // If user is an employer and company data is provided, create company record
    let companyResult = null;
    if (user_type === 'employer' && company) {
      companyResult = await client.query(
        `INSERT INTO companies 
         (user_id, company_name, industry, company_size, website, description, location) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          newUser.user_id,
          company.company_name,
          company.industry || null,
          company.company_size || null,
          company.website || null,
          company.description || null,
          company.location || null
        ]
      );
    }

    await client.query('COMMIT');

    // Return user with profile and company data if created
    const response = {
      ...newUser,
      profile: profileResult ? profileResult.rows[0] : null,
      company: companyResult ? companyResult.rows[0] : null
    };

    res.status(201).json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating user:', error);
    
    if (error.code === '23505') { // Unique constraint violation
      res.status(409).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  } finally {
    client.release();
  }
});

// Get user by ID with profile
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`
      SELECT 
        u.user_id,
        u.email,
        u.user_type,
        u.created_at,
        u.updated_at,
        u.is_active,
        p.profile_id,
        p.first_name,
        p.last_name,
        p.phone,
        p.location,
        p.resume_url,
        p.bio,
        p.experience_years
      FROM users u
      LEFT JOIN user_profiles p ON u.user_id = p.user_id
      WHERE u.user_id = $1
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update user
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { 
      email, 
      user_type,
      is_active,
      first_name,
      last_name,
      phone,
      location,
      bio,
      experience_years,
      resume_url
    } = req.body;

    // Validate required fields
    if (!email) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email is required' });
    }

    // Update users table
    const userUpdateFields = [];
    const userValues = [];
    let userParamCount = 1;

    if (email !== undefined) {
      userUpdateFields.push(`email = $${userParamCount++}`);
      userValues.push(email);
    }
    if (user_type !== undefined) {
      userUpdateFields.push(`user_type = $${userParamCount++}`);
      userValues.push(user_type);
    }
    if (is_active !== undefined) {
      userUpdateFields.push(`is_active = $${userParamCount++}`);
      userValues.push(is_active);
    }

    // Only update users table if there are fields to update
    if (userUpdateFields.length > 0) {
      userUpdateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      userValues.push(id);
      
      const userUpdateQuery = `UPDATE users SET ${userUpdateFields.join(', ')} WHERE user_id = $${userParamCount}`;
      await client.query(userUpdateQuery, userValues);
    }

    // Handle profile updates
    const hasProfileData = first_name !== undefined || last_name !== undefined || 
                          phone !== undefined || location !== undefined || 
                          bio !== undefined || experience_years !== undefined || 
                          resume_url !== undefined;

    if (hasProfileData) {
      // Check if profile exists
      const profileCheck = await client.query(
        'SELECT profile_id FROM user_profiles WHERE user_id = $1',
        [id]
      );

      if (profileCheck.rows.length > 0) {
        // Update existing profile
        const profileUpdateFields = [];
        const profileValues = [];
        let profileParamCount = 1;

        if (first_name !== undefined) {
          profileUpdateFields.push(`first_name = $${profileParamCount++}`);
          profileValues.push(first_name);
        }
        if (last_name !== undefined) {
          profileUpdateFields.push(`last_name = $${profileParamCount++}`);
          profileValues.push(last_name);
        }
        if (phone !== undefined) {
          profileUpdateFields.push(`phone = $${profileParamCount++}`);
          profileValues.push(phone);
        }
        if (location !== undefined) {
          profileUpdateFields.push(`location = $${profileParamCount++}`);
          profileValues.push(location);
        }
        if (bio !== undefined) {
          profileUpdateFields.push(`bio = $${profileParamCount++}`);
          profileValues.push(bio);
        }
        if (experience_years !== undefined) {
          profileUpdateFields.push(`experience_years = $${profileParamCount++}`);
          profileValues.push(experience_years);
        }
        if (resume_url !== undefined) {
          profileUpdateFields.push(`resume_url = $${profileParamCount++}`);
          profileValues.push(resume_url);
        }

        // Only update if there are fields to update
        if (profileUpdateFields.length > 0) {
          profileValues.push(id);
          const profileUpdateQuery = `UPDATE user_profiles SET ${profileUpdateFields.join(', ')} WHERE user_id = $${profileParamCount}`;
          await client.query(profileUpdateQuery, profileValues);
        }
      } else {
        // Create new profile - require at least first_name and last_name
        if (first_name && last_name) {
          const insertQuery = `
            INSERT INTO user_profiles 
            (user_id, first_name, last_name, phone, location, bio, experience_years, resume_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;
          const insertValues = [
            id, 
            first_name, 
            last_name, 
            phone || null, 
            location || null, 
            bio || null, 
            experience_years || 0,
            resume_url || null
          ];
          await client.query(insertQuery, insertValues);
        } else if (first_name !== undefined || last_name !== undefined) {
          // If only one name is provided, that's an error
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            error: 'Both first_name and last_name are required to create a user profile' 
          });
        }
        // If neither first_name nor last_name is provided, just skip profile creation
      }
    }

    await client.query('COMMIT');

    // Fetch and return updated user with profile data
    const fetchQuery = `
      SELECT 
        u.user_id,
        u.email,
        u.user_type,
        u.created_at,
        u.updated_at,
        u.is_active,
        p.profile_id,
        p.first_name,
        p.last_name,
        p.phone,
        p.location,
        p.resume_url,
        p.bio,
        p.experience_years
      FROM users u
      LEFT JOIN user_profiles p ON u.user_id = p.user_id
      WHERE u.user_id = $1
    `;
    
    const result = await client.query(fetchQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user:', error);
    
    if (error.code === '23505') {
      // Unique constraint violation (likely email)
      res.status(409).json({ error: 'Email already exists' });
    } else if (error.code === '23502') {
      // NOT NULL constraint violation
      res.status(400).json({ error: 'Required field is missing' });
    } else if (error.code === '23514') {
      // Check constraint violation (likely user_type)
      res.status(400).json({ error: 'Invalid user type. Must be job_seeker, employer, or admin' });
    } else if (error.code === '22P02') {
      // Invalid input syntax (e.g., invalid user_id)
      res.status(400).json({ error: 'Invalid input data' });
    } else {
      res.status(500).json({ error: 'Failed to update user' });
    }
  } finally {
    client.release();
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM users WHERE user_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
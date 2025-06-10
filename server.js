import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from './db.js';
const { pool } = pkg;
import userRoutes from './routes/users.js';
import profileRoutes from './routes/profiles.js';
import companyRoutes from './routes/companies.js';
import categoryRoutes from './routes/categories.js';
import jobRoutes from './routes/jobs.js';
// import applicationRoutes from './routes/applications.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use('/api/users', userRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/jobs', jobRoutes);
// app.use('/api/applications', applicationRoutes);

app.listen(PORT, () => {
  console.log(`Server running at ${PORT}`);
});

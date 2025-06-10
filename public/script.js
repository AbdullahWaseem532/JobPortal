document.getElementById('jobForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const job = {
    title: document.getElementById('title').value,
    company_id: document.getElementById('company_id').value,
    category_id: document.getElementById('category_id').value
  };

  await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job)
  });

  fetchJobs();
});

async function fetchJobs() {
  const res = await fetch('/api/jobs');
  const jobs = await res.json();
  const list = document.getElementById('jobList');
  list.innerHTML = '';
  jobs.forEach(j => {
    const li = document.createElement('li');
    li.innerText = `${j.title} - ${j.job_type} - ${j.status}`;
    list.appendChild(li);
  });
}

fetchJobs();

// analytics/analytics.js

let allJobs = [];
let filteredJobs = [];
let charts = {};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('master-data.json');
        allJobs = await response.json();
        filteredJobs = [...allJobs];
        
        setupFilters();
        renderDashboard(filteredJobs);
    } catch (err) {
        console.error('Failed to load data:', err);
        document.body.innerHTML = `<div class="container" style="padding-top: 5rem; text-align: center;">
            <h2>Data Not Found</h2>
            <p>Please run the <code>consolidate.js</code> script first to generate <code>master-data.json</code>.</p>
        </div>`;
    }
});

function setupFilters() {
    const inputs = ['filter-day', 'filter-hour', 'search-jobs'];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', applyFilters);
    });

    document.getElementById('btn-reset-filters').addEventListener('click', () => {
        document.getElementById('filter-day').value = 'all';
        document.getElementById('filter-hour').value = 'all';
        document.getElementById('search-jobs').value = '';
        applyFilters();
    });
}

function applyFilters() {
    const day = document.getElementById('filter-day').value;
    const hourRange = document.getElementById('filter-hour').value;
    const search = document.getElementById('search-jobs').value.toLowerCase();

    filteredJobs = allJobs.filter(job => {
        const date = new Date(job.postedAt);
        const jobDay = date.getDay().toString();
        const jobHour = date.getHours();

        // Day Filter
        if (day !== 'all' && jobDay !== day) return false;

        // Hour Filter
        if (hourRange !== 'all') {
            if (hourRange === 'morning' && (jobHour < 6 || jobHour >= 12)) return false;
            if (hourRange === 'afternoon' && (jobHour < 12 || jobHour >= 18)) return false;
            if (hourRange === 'evening' && (jobHour < 18 || jobHour >= 24)) return false;
            if (hourRange === 'night' && (jobHour < 0 || jobHour >= 6)) return false;
        }

        // Search Filter
        if (search) {
            const inTitle = job.title.toLowerCase().includes(search);
            const inSkills = job.skills.some(s => s.toLowerCase().includes(search));
            const inDesc = job.description.toLowerCase().includes(search);
            if (!inTitle && !inSkills && !inDesc) return false;
        }

        return true;
    });

    renderDashboard(filteredJobs);
}

function renderDashboard(jobs) {
    // Destroy existing charts to redraw
    Object.values(charts).forEach(c => c.destroy());

    // 1. Basic Stats
    const totalJobs = jobs.length;
    const avgProposals = totalJobs > 0 ? (jobs.reduce((s, j) => s + (j.proposalsNormalized || 0), 0) / totalJobs).toFixed(1) : 0;
    const totalBudget = jobs.reduce((s, j) => s + (j.fixedBudget || (j.hourlyRateMax ? j.hourlyRateMax * 40 : 0)), 0);

    document.getElementById('kpi-total-jobs').textContent = totalJobs.toLocaleString();
    document.getElementById('kpi-avg-proposals').textContent = avgProposals;
    document.getElementById('kpi-total-budget').textContent = `$${(totalBudget / 1000).toFixed(1)}k+`;
    document.getElementById('job-count-display').textContent = `Showing ${totalJobs} jobs`;

    if (totalJobs === 0) {
        document.getElementById('job-feed').innerHTML = '<div class="loading-placeholder">No jobs match your filters.</div>';
        return;
    }

    // 2. Data Processing
    const postsByDay = {}; 
    const postsByHour = new Array(24).fill(0);
    const proposalsByHour = new Array(24).fill(0);
    const proposalCountByHour = new Array(24).fill(0);
    const typeDistribution = { fixed: 0, hourly: 0, unknown: 0 };
    const skillCounts = {};
    const budgetTiers = { "Under $100": 0, "$100-$500": 0, "$500-$1k": 0, "$1k-$5k": 0, "$5k+": 0 };

    jobs.forEach(job => {
        const date = new Date(job.postedAt);
        if (isNaN(date)) return;

        const dateKey = job.postedAt.split('T')[0];
        postsByDay[dateKey] = (postsByDay[dateKey] || 0) + 1;

        const hour = date.getHours();
        postsByHour[hour]++;
        proposalsByHour[hour] += (job.proposalsNormalized || 0);
        proposalCountByHour[hour]++;

        typeDistribution[job.jobType || 'unknown']++;

        job.skills.forEach(s => {
            skillCounts[s] = (skillCounts[s] || 0) + 1;
        });

        if (job.fixedBudget) {
            const b = job.fixedBudget;
            if (b < 100) budgetTiers["Under $100"]++;
            else if (b < 500) budgetTiers["$100-$500"]++;
            else if (b < 1000) budgetTiers["$500-$1k"]++;
            else if (b < 5000) budgetTiers["$1k-$5k"]++;
            else budgetTiers["$5k+"]++;
        }
    });

    // 3. Render Charts
    renderTimeChart(postsByDay);
    renderTypeChart(typeDistribution);
    renderBudgetChart(budgetTiers);
    renderSkillsChart(skillCounts);
    renderHeatMap(jobs);
    renderOptimization(jobs, postsByHour, proposalsByHour, proposalCountByHour);
    renderJobFeed(jobs);
}

function renderTimeChart(postsByDay) {
    const ctx = document.getElementById('timeChart').getContext('2d');
    const sortedDates = Object.keys(postsByDay).sort();
    
    charts.time = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedDates.map(d => d.split('-').slice(1).join('/')),
            datasets: [{
                label: 'Jobs Posted',
                data: sortedDates.map(d => postsByDay[d]),
                borderColor: '#14a800',
                backgroundColor: 'rgba(20, 168, 0, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 3
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });
}

function renderBudgetChart(tiers) {
    const ctx = document.getElementById('budgetChart').getContext('2d');
    charts.budget = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(tiers),
            datasets: [{
                data: Object.values(tiers),
                backgroundColor: '#58a6ff',
                borderRadius: 4
            }]
        },
        options: { 
            indexAxis: 'y',
            responsive: true, 
            plugins: { legend: { display: false } } 
        }
    });
}

function renderSkillsChart(counts) {
    const ctx = document.getElementById('skillsChart').getContext('2d');
    const topSkills = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    charts.skills = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topSkills.map(s => s[0]),
            datasets: [{
                data: topSkills.map(s => s[1]),
                backgroundColor: 'rgba(20, 168, 0, 0.6)',
                borderRadius: 4
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });
}

function renderTypeChart(dist) {
    const ctx = document.getElementById('typeChart').getContext('2d');
    charts.type = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Fixed', 'Hourly'],
            datasets: [{
                data: [dist.fixed, dist.hourly],
                backgroundColor: ['#14a800', '#58a6ff'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, cutout: '70%' }
    });
}

function renderHeatMap(jobs) {
    const container = document.getElementById('heatMap');
    container.innerHTML = '';
    const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ count: 0, props: 0 })));

    jobs.forEach(job => {
        const d = new Date(job.postedAt);
        if (isNaN(d)) return;
        const day = d.getDay();
        const hour = d.getHours();
        grid[day][hour].count++;
        grid[day][hour].props += (job.proposalsNormalized || 0);
    });

    for (let d = 0; d < 7; d++) {
        const row = document.createElement('div');
        row.className = 'heat-hour-row';
        const label = document.createElement('div');
        label.className = 'day-label';
        label.textContent = dayNamesShort[d];
        row.appendChild(label);

        for (let h = 0; h < 24; h++) {
            const cell = document.createElement('div');
            cell.className = 'heat-cell';
            const avg = grid[d][h].count > 0 ? (grid[d][h].props / grid[d][h].count) : 0;
            const intensity = Math.min(1, (avg - 5) / 40);
            if (grid[d][h].count > 0) {
                cell.style.background = `rgba(20, 168, 0, ${0.1 + intensity * 0.9})`;
            }
            cell.setAttribute('data-tooltip', `${h}:00 - ${grid[d][h].count} jobs, Avg Approx ${avg.toFixed(0)} proposals`);
            row.appendChild(cell);
        }
        container.appendChild(row);
    }
}

function renderOptimization(jobs, postsByHour, proposalsByHour, proposalCountByHour) {
    let bestHour = 0;
    let minCompetition = Infinity;

    for(let h=0; h<24; h++) {
        if (postsByHour[h] > 5) { // Needs a minimum sample
            const avg = proposalsByHour[h] / proposalCountByHour[h];
            if (avg < minCompetition) {
                minCompetition = avg;
                bestHour = h;
            }
        }
    }

    if (minCompetition === Infinity) {
        document.getElementById('suggestionText').textContent = "Not enough data to calculate golden window yet.";
        return;
    }

    const ampm = bestHour >= 12 ? 'PM' : 'AM';
    const displayHour = bestHour % 12 || 12;
    document.getElementById('suggestionText').innerHTML = `Jobs posted around <strong>${displayHour}:00 ${ampm}</strong> have the lowest average competition (<strong>${minCompetition.toFixed(1)}</strong> proposals). This is your best time to apply!`;
}

function renderJobFeed(jobs) {
    const feed = document.getElementById('job-feed');
    feed.innerHTML = '';

    // Sort by recency
    const sorted = [...jobs].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

    sorted.forEach(job => {
        const card = document.createElement('div');
        card.className = 'job-card';
        
        const propsClass = job.proposalsNormalized <= 5 ? 'badge-low' : (job.proposalsNormalized <= 15 ? 'badge-mid' : 'badge-high');
        const budgetText = job.fixedBudget ? `$${job.fixedBudget}` : (job.hourlyRateMax ? `$${job.hourlyRateMin}-$${job.hourlyRateMax}/hr` : 'Budget N/A');

        card.innerHTML = `
            <div class="job-main-info">
                <div class="job-header">
                    <a href="${job.url}" target="_blank" class="job-title-link">${job.title}</a>
                </div>
                <div class="job-meta-row">
                    <div class="meta-item">🕒 ${new Date(job.postedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
                    <div class="meta-item">📍 ${job.client.location || 'Unknown'}</div>
                    <div class="meta-item">👤 ${job.client.paymentVerified ? '✅ Verified' : '❌ Unverified'}</div>
                    <div class="meta-item">📊 ${job.proposals} proposals</div>
                </div>
                <div class="job-description-preview">${job.description}</div>
                <div class="skill-tags">
                    ${job.skills.slice(0, 8).map(s => `<span class="skill-tag">${s}</span>`).join('')}
                    ${job.skills.length > 8 ? `<span class="skill-tag">+${job.skills.length - 8}</span>` : ''}
                </div>
            </div>
            <div class="job-stats-sidebar">
                <div class="budget-pill">${budgetText}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted)">${job.experienceLevel}</div>
                <a href="${job.url}" target="_blank" class="job-action-btn">Apply Now</a>
            </div>
        `;
        feed.appendChild(card);
    });
}

// content/scraper.js

function scrapeAllJobs() {
  const jobTiles = document.querySelectorAll('[data-test="JobTile"]');
  const jobs = [];
  const scrapedAt = new Date().toISOString();
  
  jobTiles.forEach((tile, index) => {
    try {
      const job = extractJobFromTile(tile, index + 1, scrapedAt);
      if (job && job.title) {
        jobs.push(job);
      }
    } catch (err) {
      console.warn('[UKF] Failed to parse job tile at position', index + 1, err);
    }
  });
  
  return jobs;
}

function extractJobFromTile(tile, position, scrapedAt) {
  // --- JOB ID & POSITION ---
  const jobId = tile.getAttribute('data-ev-job-uid') || '';
  const pageNumber = tile.getAttribute('data-ev-page_number') || '1';
  
  // --- TITLE ---
  const titleLink = tile.querySelector('[data-test="job-tile-title-link UpLink"]') 
                 || tile.querySelector('h2.job-tile-title a');
  const title = titleLink ? titleLink.textContent.trim().replace(/\s+/g, ' ') : '';
  
  // Build clean URL
  let url = '';
  if (titleLink) {
    const href = titleLink.getAttribute('href') || '';
    url = href.startsWith('http') ? href : `https://www.upwork.com${href}`;
  }
  
  // --- POSTED DATE ---
  const dateEl = tile.querySelector('[data-test="job-pubilshed-date"]');
  const postedRelative = dateEl ? dateEl.textContent.trim().replace(/\s+/g, ' ') : '';
  
  let postedAt = scrapedAt;
  if (postedRelative) {
    const lower = postedRelative.toLowerCase();
    if (lower.includes('just now')) {
        postedAt = scrapedAt;
    } else if (lower.includes('yesterday')) {
        const pastDate = new Date(scrapedAt);
        pastDate.setDate(pastDate.getDate() - 1);
        postedAt = pastDate.toISOString();
    } else {
        const match = postedRelative.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i);
        if (match) {
            const amount = parseInt(match[1]);
            const unit = match[2].toLowerCase();
            const pastDate = new Date(scrapedAt);
            if (unit.startsWith('minute')) pastDate.setMinutes(pastDate.getMinutes() - amount);
            else if (unit.startsWith('hour')) pastDate.setHours(pastDate.getHours() - amount);
            else if (unit.startsWith('day')) pastDate.setDate(pastDate.getDate() - amount);
            else if (unit.startsWith('week')) pastDate.setDate(pastDate.getDate() - (amount * 7));
            else if (unit.startsWith('month')) pastDate.setMonth(pastDate.getMonth() - amount);
            postedAt = pastDate.toISOString();
        }
    }
  }
  
  // --- DESCRIPTION ---
  const descEl = tile.querySelector('[data-test="UpCLineClamp JobDescription"] p')
              || tile.querySelector('p.mb-0.text-body-sm.rr-mask');
  const description = descEl ? descEl.textContent.trim().replace(/\s+/g, ' ') : '';
  
  // --- SKILLS ---
  const skillEls = tile.querySelectorAll('[data-test="TokenClamp JobAttrs"] [data-test="token"]');
  const skills = Array.from(skillEls)
    .map(el => el.textContent.trim())
    .filter(s => s && s !== '+' && !/^\+\d+$/.test(s)); // exclude "+9" overflow indicators
  
  // --- JOB TYPE & BUDGET ---
  const jobTypeEl = tile.querySelector('[data-test="job-type-label"] strong');
  const budgetRaw = jobTypeEl ? jobTypeEl.textContent.trim() : '';
  
  let jobType = 'unknown';
  let hourlyRateMin = null;
  let hourlyRateMax = null;
  let fixedBudget = null;
  
  if (budgetRaw.toLowerCase().includes('fixed')) {
    jobType = 'fixed';
    const budgetEl = tile.querySelector('[data-test="is-fixed-price"] strong:last-child');
    if (budgetEl) {
      const match = budgetEl.textContent.match(/\$(\d+\.?\d*)/);
      fixedBudget = match ? parseFloat(match[1]) : null;
    }
  } else if (budgetRaw.toLowerCase().includes('hourly')) {
    jobType = 'hourly';
    const match = budgetRaw.match(/\$(\d+\.?\d*)\s*-\s*\$(\d+\.?\d*)/);
    if (match) {
      hourlyRateMin = parseFloat(match[1]);
      hourlyRateMax = parseFloat(match[2]);
    }
  }
  
  // --- EXPERIENCE LEVEL ---
  const expEl = tile.querySelector('[data-test="experience-level"] strong');
  const experienceLevel = expEl ? expEl.textContent.trim() : '';
  
  // --- DURATION ---
  const durationEl = tile.querySelector('[data-test="duration-label"] strong:last-child');
  const durationRaw = durationEl ? durationEl.textContent.trim() : '';
  let duration = '';
  let hoursPerWeek = '';
  if (durationRaw.includes(',')) {
    const parts = durationRaw.split(',');
    duration = parts[0].trim();
    hoursPerWeek = parts[1].trim();
  } else {
    duration = durationRaw;
  }
  
  // --- CLIENT INFO ---
  const verifiedEl = tile.querySelector('[data-test="payment-verified"] .air3-badge-tagline-sm');
  const paymentVerified = verifiedEl ? verifiedEl.classList.contains('is-verified') : false;
  
  const spentEl = tile.querySelector('[data-test="total-spent"] strong.rr-mask');
  const totalSpentRaw = spentEl ? spentEl.textContent.trim() : '$0';
  const totalSpentNormalized = parseSpentAmount(totalSpentRaw);
  
  const locationEl = tile.querySelector('[data-test="location"] span.rr-mask');
  const location = locationEl ? locationEl.textContent.replace('Location', '').trim() : '';
  
  // Client rating (from tooltip - may not always be present)
  let clientRating = null;
  let feedbackCount = null;
  const tooltipEl = tile.querySelector('.air3-popper.air3-tooltip .air3-popper-content div');
  if (tooltipEl) {
    const ratingText = tooltipEl.textContent;
    const ratingMatch = ratingText.match(/(\d+\.\d+)\s+Stars/);
    const feedbackMatch = ratingText.match(/based on (\d+) feedbacks/);
    if (ratingMatch) clientRating = parseFloat(ratingMatch[1]);
    if (feedbackMatch) feedbackCount = parseInt(feedbackMatch[1]);
  }
  
  // --- PROPOSALS ---
  const proposalsEl = tile.querySelector('[data-test="proposals-tier"] strong');
  const proposals = proposalsEl ? proposalsEl.textContent.trim() : '';
  const proposalsNormalized = parseProposals(proposals);
  
  return {
    jobId,
    positionOnPage: position,
    pageNumber,
    scrapedAt,
    title,
    url,
    postedRelative,
    postedAt,
    description,
    skills,
    jobType,
    hourlyRateMin,
    hourlyRateMax,
    fixedBudget,
    budgetRaw,
    experienceLevel,
    duration,
    hoursPerWeek,
    client: {
      paymentVerified,
      totalSpent: totalSpentRaw,
      totalSpentNormalized,
      location,
      rating: clientRating,
      feedbackCount
    },
    proposals,
    proposalsNormalized
  };
}

function parseSpentAmount(raw) {
  if (!raw || raw === '$0') return 0;
  const match = raw.match(/\$(\d+(?:\.\d+)?)(K\+)?/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const isK = match[2] ? true : false;
  return isK ? num * 1000 : num;
}

function parseProposals(raw) {
  if (!raw) return 0;
  const match = raw.match(/(\d+)\s+to\s+(\d+)/);
  if (match) return parseInt(match[2]);
  const ltMatch = raw.match(/Less than\s+(\d+)/i);
  if (ltMatch) return parseInt(ltMatch[1]);
  const rangeMatch = raw.match(/(\d+)\s*\+/);
  if (rangeMatch) return parseInt(rangeMatch[1]);
  return 0;
}

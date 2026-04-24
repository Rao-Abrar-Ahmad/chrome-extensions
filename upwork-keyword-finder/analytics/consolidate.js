const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(__dirname, 'master-data.json');

function consolidate() {
    console.log('--- Starting Data Consolidation ---');
    if (!fs.existsSync(DATA_DIR)) {
        console.error(`Data directory not found: ${DATA_DIR}`);
        console.log('Please create a "data" folder in the root and put your exported JSON files there.');
        return;
    }

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.warn('No JSON files found in data directory.');
        return;
    }

    console.log(`Found ${files.length} export files.`);

    const uniqueJobs = new Map();
    let totalScanned = 0;
    let verifiedCount = 0;

    files.forEach(file => {
        const filePath = path.join(DATA_DIR, file);
        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const sessions = Array.isArray(content) ? content : [content];

            sessions.forEach(session => {
                if (session.jobs && Array.isArray(session.jobs)) {
                    session.jobs.forEach(job => {
                        totalScanned++;
                        if (!uniqueJobs.has(job.jobId)) {
                            uniqueJobs.set(job.jobId, job);
                        } else {
                            const existing = uniqueJobs.get(job.jobId);
                            if (new Date(job.scrapedAt) > new Date(existing.scrapedAt)) {
                                uniqueJobs.set(job.jobId, job);
                            }
                        }
                    });
                }
            });
        } catch (err) {
            console.error(`Error processing ${file}:`, err.message);
        }
    });

    const masterList = Array.from(uniqueJobs.values());
    masterList.forEach(j => { if (j.client?.paymentVerified) verifiedCount++; });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(masterList, null, 2));

    console.log(`--- Consolidation Complete ---`);
    console.log(`Total Jobs Scanned: ${totalScanned}`);
    console.log(`Unique Jobs Saved:  ${masterList.length}`);
    console.log(`Verified Clients:   ${((verifiedCount / masterList.length) * 100).toFixed(1)}%`);
    console.log(`Saved to: ${OUTPUT_FILE}`);
}

consolidate();

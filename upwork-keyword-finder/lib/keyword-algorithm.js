// lib/keyword-algorithm.js

import { STOP_WORDS, tokenize } from './text-cleaner.js';

export function computeTFIDF(jobs) {

  const docs = jobs.map(job => {
    // Title weighted 3x by repeating
    const titleText = (job.title + ' ').repeat(3);
    const text = `${titleText} ${job.description} ${job.skills.join(' ')}`;
    return tokenize(text);
  });
  
  // Count all terms
  const termCounts = {};
  docs.forEach(doc => {
    const unique = new Set(doc);
    unique.forEach(term => {
      termCounts[term] = (termCounts[term] || 0) + 1;
    });
  });
  
  // IDF score
  const totalDocs = docs.length;
  const idf = {};
  Object.keys(termCounts).forEach(term => {
    idf[term] = Math.log(totalDocs / termCounts[term]);
  });
  
  // TF-IDF per term
  const allTermFreqs = {};
  docs.flat().forEach(term => {
    allTermFreqs[term] = (allTermFreqs[term] || 0) + 1;
  });
  
  const scores = Object.entries(allTermFreqs)
    .filter(([term]) => term.length > 2 && !STOP_WORDS.has(term))
    .map(([keyword, freq]) => ({
      keyword,
      count: termCounts[keyword] || 0,
      frequency: freq,
      score: freq * (1 + (idf[keyword] || 0)),
      importance: freq > 5 ? 'high' : freq > 2 ? 'medium' : 'low'
    }))
    .sort((a, b) => b.score - a.score);
  
  // Bigrams
  const bigrams = computeBigrams(docs, STOP_WORDS);
  
  // Extract from skills tags specifically
  const skillFreqs = {};
  jobs.forEach(job => {
    job.skills.forEach(skill => {
      const normalized = skill.toLowerCase();
      skillFreqs[normalized] = (skillFreqs[normalized] || 0) + 1;
    });
  });
  
  const skillKeywords = Object.entries(skillFreqs)
    .filter(([_, count]) => count >= 1)
    .map(([keyword, count]) => ({
      keyword: keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), // title case
      count,
      importance: count > 3 ? 'high' : 'medium'
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  
  return {
    skillKeywords,
    titleKeywords: [...bigrams, ...scores.slice(0, 30)].slice(0, 20),
    actionPhrases: scores.filter(s => s.importance === 'medium').slice(0, 15)
  };
}

function computeBigrams(docs, STOP_WORDS) {
  const bigramCounts = {};
  docs.forEach(doc => {
    for (let i = 0; i < doc.length - 1; i++) {
      if (STOP_WORDS.has(doc[i]) || STOP_WORDS.has(doc[i+1])) continue;
      const bigram = `${doc[i]} ${doc[i+1]}`;
      bigramCounts[bigram] = (bigramCounts[bigram] || 0) + 1;
    }
  });
  return Object.entries(bigramCounts)
    .filter(([_, count]) => count >= 2)
    .map(([keyword, count]) => ({ keyword, count, importance: 'high' }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

// Ensure function is exposed globally for content scripts
if (typeof globalThis !== 'undefined') {
    globalThis.computeTFIDF = computeTFIDF;
}

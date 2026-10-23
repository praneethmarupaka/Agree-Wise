// services/score.js - Risk scoring, grading rules and summary generation
const WEIGHTS = {
  HIGH: 3.0,
  MEDIUM: 1.5,
  LOW: 0.5,
};

function calculateScore(flags = []) {
  const sum = flags.reduce((acc, flag) => {
    const w = WEIGHTS[flag.severity] || 0;
    return acc + w;
  }, 0);
  return Math.round(Math.min(10.0, sum) * 10) / 10;
}

function calculateRawGrade(score) {
  if (score < 2.0) return 'A';
  if (score < 4.0) return 'B';
  if (score < 7.0) return 'C';
  if (score < 8.5) return 'D';
  return 'F';
}

function buildDetailSummary(flags, grade) {
  if (!flags || !flags.length) {
    return 'Low risk agreement with no significant risky clauses detected.';
  }
  const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const sorted = [...flags].sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));
  const topTitles = sorted.slice(0, 3).map(f => f.title).filter(Boolean);
  const concerns = topTitles.length ? `concerns regarding ${topTitles.join(', ')}` : 'identified potential risks';
  const prefix = grade === 'F' ? 'High risk' : (grade === 'D' ? 'Significant risk' : (grade === 'C' ? 'Medium risk' : 'Low risk'));
  return `${prefix} agreement with ${concerns}.`;
}

function evaluateGradeAndSummary(flags = [], documents = []) {
  const analyzedDocs = documents.filter(d => d.analyzed);
  const failedDocs = documents.filter(d => !d.analyzed);

  if (!analyzedDocs.length) {
    return {
      grade: '?',
      riskScore: null,
      summary: "Couldn't read the policy text, so no grade was given.",
      flags: [],
    };
  }

  const score = calculateScore(flags);
  const rawGrade = calculateRawGrade(score);

  if (failedDocs.length > 0) {
    if (rawGrade === 'A' || rawGrade === 'B') {
      return {
        grade: '?',
        riskScore: score,
        summary: 'Only part of the policy could be read.',
      };
    }
    const failedTypes = failedDocs.map(d => d.type || 'document').join(' & ');
    return {
      grade: rawGrade,
      riskScore: score,
      summary: `${buildDetailSummary(flags, rawGrade)} (${failedTypes} could not be read).`,
    };
  }

  return {
    grade: rawGrade,
    riskScore: score,
    summary: buildDetailSummary(flags, rawGrade),
  };
}

module.exports = {
  WEIGHTS,
  calculateScore,
  calculateRawGrade,
  evaluateGradeAndSummary,
};

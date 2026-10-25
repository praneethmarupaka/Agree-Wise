// services/score.js - Risk scoring, grading intervals and summary generation
const SCORING_VERSION = 1;

const WEIGHTS = {
  HIGH: 2.0,
  MEDIUM: 1.0,
  LOW: 0.25,
};

function calculateScore(flags = []) {
  const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const best = {};
  for (const flag of flags) {
    const cat = flag.category || 'OTHER';
    const rank = severityRank[flag.severity] || 0;
    if (!best[cat] || rank > (severityRank[best[cat].severity] || 0)) {
      best[cat] = flag;
    }
  }
  const sum = Object.values(best).reduce((acc, flag) => acc + (WEIGHTS[flag.severity] || 0), 0);
  return Math.round(Math.min(10.0, sum) * 10) / 10;
}

function calculateRawGrade(rawScore) {
  const score = Math.round(Number(rawScore || 0) * 10) / 10;
  if (score <= 1.5) return 'A';
  if (score <= 3.5) return 'B';
  if (score <= 6.0) return 'C';
  if (score <= 8.0) return 'D';
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
  const hasAnyReadable = documents.some(d => d.analyzed && (d.coverage == null || d.coverage > 0));
  const partialOrFailed = documents.filter(d => !d.analyzed || (typeof d.coverage === 'number' && d.coverage < 0.7));

  if (!hasAnyReadable) {
    return {
      grade: '?',
      riskScore: null,
      summary: "Couldn't read the policy text, so no grade was given.",
      flags: [],
    };
  }

  const score = calculateScore(flags);
  const rawGrade = calculateRawGrade(score);

  // If any document is unanalyzed or coverage < 0.7, never allow A or B
  if (partialOrFailed.length > 0) {
    if (rawGrade === 'A' || rawGrade === 'B') {
      return {
        grade: '?',
        riskScore: score,
        summary: 'Only part of the policy could be read.',
      };
    }
    const failedTypes = partialOrFailed.map(d => d.type || 'document').join(' & ');
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
  SCORING_VERSION,
  WEIGHTS,
  calculateScore,
  calculateRawGrade,
  evaluateGradeAndSummary,
};

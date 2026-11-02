const express = require('express');
const router = express.Router();
const { getDataset, applyFilters, normEmail } = require('../services/sheets');

router.get('/', async (req, res, next) => {
  try {
    const { member, dateFrom, dateTo } = req.query;
    const { signups, applications, availability } = await getDataset();

    // Applications now carry a memberName (joined by email in getDataset),
    // so the same filter applies correctly to both sets.
    const filteredSignups = applyFilters(signups, { member, dateFrom, dateTo });
    const filteredApps = applyFilters(applications, { member, dateFrom, dateTo });

    const totalSignups = filteredSignups.length;
    const newAccounts = filteredSignups.filter(s => s.isNewAccount).length;
    const existingAccounts = totalSignups - newAccounts;

    const totalApplications = filteredApps.length;
    const totalApplicants = new Set(filteredApps.map(a => a.personId).filter(Boolean)).size;

    const conversionRate = totalSignups > 0
      ? Number(((totalApplicants / totalSignups) * 100).toFixed(1))
      : 0;

    // email -> set of personIds, restricted to the filtered applications
    const appMap = new Map();
    filteredApps.forEach(a => {
      const email = normEmail(a.email);
      if (!email || !a.personId) return;
      if (!appMap.has(email)) appMap.set(email, new Set());
      appMap.get(email).add(a.personId);
    });

    const byProduct = {};
    filteredSignups.forEach(s => {
      const p = s.product || 'Unknown';
      byProduct[p] = (byProduct[p] || 0) + 1;
    });

    const byDate = {};
    filteredSignups.forEach(s => {
      if (!s.dateKey) return;
      byDate[s.dateKey] = (byDate[s.dateKey] || 0) + 1;
    });
    const timeSeriesData = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const memberPerf = {};
    filteredSignups.forEach(s => {
      const m = s.memberName || 'Unknown';
      if (!memberPerf[m]) memberPerf[m] = { signups: 0, applicants: new Set() };
      memberPerf[m].signups++;

      const pids = appMap.get(normEmail(s.email));
      if (pids) pids.forEach(pid => memberPerf[m].applicants.add(pid));
    });

    const memberPerformance = Object.entries(memberPerf)
      .map(([name, data]) => ({ name, signups: data.signups, applicants: data.applicants.size }))
      .sort((a, b) => b.signups - a.signups);

    const byUniversity = {};
    filteredSignups.forEach(s => {
      const u = s.university || 'Unknown';
      byUniversity[u] = (byUniversity[u] || 0) + 1;
    });
    const topUniversities = Object.entries(byUniversity)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const byReferral = {};
    filteredSignups.forEach(s => {
      const r = s.referral || 'Unknown';
      byReferral[r] = (byReferral[r] || 0) + 1;
    });
    const referralBreakdown = Object.entries(byReferral)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    const uniqueMembers = [...new Set(filteredSignups.map(s => s.memberName).filter(Boolean))];

    res.json({
      availability,
      kpis: {
        totalSignups,
        newAccounts,
        existingAccounts,
        totalApplications,
        totalApplicants,
        conversionRate,
        activeDays: timeSeriesData.length,
        totalUniversities: Object.keys(byUniversity).length,
      },
      byProduct,
      timeSeriesData,
      memberPerformance,
      topUniversities,
      referralBreakdown,
      uniqueMembers: uniqueMembers.sort(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

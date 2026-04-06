const express = require('express');
const router = express.Router();
const { getSignups, getApplications, applyFilters } = require('../services/sheets');

router.get('/', async (req, res) => {
  try {
    const { member, dateFrom, dateTo } = req.query;

    const [signups, applications] = await Promise.all([getSignups(), getApplications()]);

    const filteredSignups = applyFilters(signups, { member, dateFrom, dateTo });
    const filteredApps = applyFilters(applications, { member, dateFrom, dateTo });

    // Total signups & new accounts
    const totalSignups = filteredSignups.length;
    const newAccounts = filteredSignups.filter(s => s.isNewAccount).length;
    const existingAccounts = totalSignups - newAccounts;

    // Total applications & unique applicants (people)
    const totalApplications = filteredApps.length;
    const totalApplicants = [...new Set(filteredApps.map(a => a.personId).filter(Boolean))].length;

    // Conversion rate (Signups -> Applicants)
    const conversionRate = totalSignups > 0 ? ((totalApplicants / totalSignups) * 100).toFixed(1) : 0;

    // Helper: Map emails to applicants from signups sheet
    const appMap = {};
    applications.forEach(a => {
      if (a.email && a.personId) {
        const email = a.email.toLowerCase().trim();
        if (!appMap[email]) appMap[email] = new Set();
        appMap[email].add(a.personId);
      }
    });

    // Signups by product
    const byProduct = {};
    filteredSignups.forEach(s => {
      const p = s.product || 'Unknown';
      byProduct[p] = (byProduct[p] || 0) + 1;
    });

    // Activity over time (by signups)
    const byDate = {};
    filteredSignups.forEach(s => {
      if (s.date) {
        const key = s.date.toISOString().split('T')[0];
        byDate[key] = (byDate[key] || 0) + 1;
      }
    });
    const timeSeriesData = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // Member performance (Signups vs Applicants)
    const memberPerf = {};
    filteredSignups.forEach(s => {
      const m = s.memberName || 'Unknown';
      if (!memberPerf[m]) memberPerf[m] = { signups: 0, applicants: new Set() };
      memberPerf[m].signups++;
      
      const email = s.email?.toLowerCase().trim();
      const pids = appMap[email];
      if (pids) {
        pids.forEach(pid => memberPerf[m].applicants.add(pid));
      }
    });
    
    const memberPerformance = Object.entries(memberPerf)
      .map(([name, data]) => ({ 
        name, 
        signups: data.signups, 
        applicants: data.applicants.size 
      }))
      .sort((a, b) => b.signups - a.signups);

    // Top universities
    const byUniversity = {};
    filteredSignups.forEach(s => {
      const u = s.university || 'Unknown';
      byUniversity[u] = (byUniversity[u] || 0) + 1;
    });
    const topUniversities = Object.entries(byUniversity)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Referral breakdown
    const byReferral = {};
    filteredSignups.forEach(s => {
      const r = s.referral || 'Unknown';
      byReferral[r] = (byReferral[r] || 0) + 1;
    });
    const referralBreakdown = Object.entries(byReferral)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // Unique members
    const uniqueMembers = [...new Set(filteredSignups.map(s => s.memberName).filter(Boolean))];

    res.json({
      kpis: {
        totalSignups,
        newAccounts,
        existingAccounts,
        totalApplications,
        totalApplicants, // This is the 'Applicants' KPI
        conversionRate: parseFloat(conversionRate),
        activeDays: timeSeriesData.length,
      },
      byProduct,
      timeSeriesData,
      memberPerformance,
      topUniversities,
      referralBreakdown,
      uniqueMembers: uniqueMembers.sort(),
    });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

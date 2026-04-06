const express = require('express');
const router = express.Router();
const { getSignups, getApplications, applyFilters } = require('../services/sheets');

router.get('/', async (req, res) => {
  try {
    const { member, dateFrom, dateTo } = req.query;

    const [signups, applications] = await Promise.all([getSignups(), getApplications()]);

    const filteredSignups = applyFilters(signups, { member, dateFrom, dateTo });
    const filteredApps = applyFilters(applications, { member, dateFrom, dateTo });

    // Helper: Map emails to universities from signups sheet
    const emailToUni = {};
    signups.forEach(s => {
      if (s.email) emailToUni[s.email.toLowerCase().trim()] = s.university;
    });

    // University stats from signups sheet
    const uniMap = {};
    filteredSignups.forEach(s => {
      const uni = s.university || 'Unknown';
      const uniFull = s.universityFull || uni;
      if (!uniMap[uni]) {
        uniMap[uni] = {
          name: uni,
          fullName: uniFull,
          signups: 0,
          newAccounts: 0,
          applicants: new Set(),
          products: {},
          members: new Set(),
          fields: {},
          referrals: {},
        };
      }
      uniMap[uni].signups++;
      if (s.isNewAccount) uniMap[uni].newAccounts++;
      const p = s.product || 'Unknown';
      uniMap[uni].products[p] = (uniMap[uni].products[p] || 0) + 1;
      if (s.memberName) uniMap[uni].members.add(s.memberName);
      const f = s.fieldOfStudy || 'Unknown';
      uniMap[uni].fields[f] = (uniMap[uni].fields[f] || 0) + 1;
      const r = s.referral || 'Unknown';
      uniMap[uni].referrals[r] = (uniMap[uni].referrals[r] || 0) + 1;
    });

    // Add Applicants per university (matched via email from signups)
    filteredApps.forEach(a => {
      const uni = emailToUni[a.email?.toLowerCase().trim()] || 'Unknown';
      if (uniMap[uni] && a.personId) {
        uniMap[uni].applicants.add(a.personId);
      }
    });

    const universities = Object.values(uniMap)
      .map(u => ({
        ...u,
        applicants: u.applicants.size,
        members: [...u.members],
        memberCount: u.members.size,
        conversionRate: u.signups > 0 ? ((u.applicants.size / u.signups) * 100).toFixed(1) : 0,
        topProduct: Object.entries(u.products).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
        topField: Object.entries(u.fields).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
        topReferral: Object.entries(u.referrals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
      }))
      .sort((a, b) => b.signups - a.signups);

    // Universities visited over time
    const uniTimeMap = {};
    filteredSignups.forEach(s => {
      if (!s.date) return;
      const date = s.date.toISOString().split('T')[0];
      const uni = s.university || 'Unknown';
      if (!uniTimeMap[date]) uniTimeMap[date] = {};
      uniTimeMap[date][uni] = (uniTimeMap[date][uni] || 0) + 1;
    });
    const uniTimeSeries = Object.entries(uniTimeMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, unis]) => ({
        date,
        total: Object.values(unis).reduce((s, v) => s + v, 0),
        universities: unis,
      }));

    // Top universities summary
    const topUniversities = universities.slice(0, 15);

    // Field of study breakdown across all signups
    const fieldMap = {};
    filteredSignups.forEach(s => {
      const f = s.fieldOfStudy || 'Unknown';
      fieldMap[f] = (fieldMap[f] || 0) + 1;
    });
    const fieldBreakdown = Object.entries(fieldMap)
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      universities,
      topUniversities,
      uniTimeSeries,
      fieldBreakdown,
      totalUniversities: universities.length,
    });
  } catch (err) {
    console.error('Universities error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

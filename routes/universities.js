const express = require('express');
const router = express.Router();
const { getDataset, applyFilters, normEmail } = require('../services/sheets');

const topKey = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

router.get('/', async (req, res, next) => {
  try {
    const { member, dateFrom, dateTo } = req.query;
    const { signups, applications, availability } = await getDataset();

    const filteredSignups = applyFilters(signups, { member, dateFrom, dateTo });
    const filteredApps = applyFilters(applications, { member, dateFrom, dateTo });

    const appMap = new Map();
    filteredApps.forEach(a => {
      const email = normEmail(a.email);
      if (!email || !a.personId) return;
      if (!appMap.has(email)) appMap.set(email, new Set());
      appMap.get(email).add(a.personId);
    });

    const uniMap = {};
    filteredSignups.forEach(s => {
      const uni = s.university || 'Unknown';
      if (!uniMap[uni]) {
        uniMap[uni] = {
          name: uni,
          fullName: s.universityFull || uni,
          signups: 0,
          newAccounts: 0,
          applicants: new Set(),
          products: {},
          members: new Set(),
          fields: {},
          referrals: {},
          byDate: {},
        };
      }
      const u = uniMap[uni];
      u.signups++;
      if (s.isNewAccount) u.newAccounts++;
      u.products[s.product || 'Unknown'] = (u.products[s.product || 'Unknown'] || 0) + 1;
      if (s.memberName) u.members.add(s.memberName);
      u.fields[s.fieldOfStudy || 'Unknown'] = (u.fields[s.fieldOfStudy || 'Unknown'] || 0) + 1;
      u.referrals[s.referral || 'Unknown'] = (u.referrals[s.referral || 'Unknown'] || 0) + 1;
      if (s.dateKey) u.byDate[s.dateKey] = (u.byDate[s.dateKey] || 0) + 1;

      // Applicants attributed through the signup that produced them
      const pids = appMap.get(normEmail(s.email));
      if (pids) pids.forEach(pid => u.applicants.add(pid));
    });

    const universities = Object.values(uniMap)
      .map(u => ({
        name: u.name,
        fullName: u.fullName,
        signups: u.signups,
        newAccounts: u.newAccounts,
        applicants: u.applicants.size,
        members: [...u.members].sort(),
        memberCount: u.members.size,
        conversionRate: u.signups > 0
          ? Number(((u.applicants.size / u.signups) * 100).toFixed(1))
          : 0,
        topProduct: topKey(u.products),
        topField: topKey(u.fields),
        topReferral: topKey(u.referrals),
      }))
      .sort((a, b) => b.signups - a.signups);

    const uniTimeMap = {};
    filteredSignups.forEach(s => {
      if (!s.dateKey) return;
      const uni = s.university || 'Unknown';
      if (!uniTimeMap[s.dateKey]) uniTimeMap[s.dateKey] = {};
      uniTimeMap[s.dateKey][uni] = (uniTimeMap[s.dateKey][uni] || 0) + 1;
    });
    const uniTimeSeries = Object.entries(uniTimeMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, unis]) => ({
        date,
        total: Object.values(unis).reduce((sum, v) => sum + v, 0),
        universities: unis,
      }));

    const fieldMap = {};
    filteredSignups.forEach(s => {
      const f = s.fieldOfStudy || 'Unknown';
      fieldMap[f] = (fieldMap[f] || 0) + 1;
    });
    const fieldBreakdown = Object.entries(fieldMap)
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      availability,
      universities,
      topUniversities: universities.slice(0, 15),
      uniTimeSeries,
      fieldBreakdown,
      totalUniversities: universities.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

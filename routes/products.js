const express = require('express');
const router = express.Router();
const { getDataset, applyFilters, normEmail } = require('../services/sheets');

// Canonical products, listed first. Anything else found in the sheet is
// appended, so a renamed or added product still shows up instead of vanishing.
const CANONICAL = ['Volunteering Internship', 'Professional Internship', 'Teaching Internship'];

const shortName = name => name.replace(/\s*Internship$/i, '').trim() || name;
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

    const found = [...new Set(filteredSignups.map(s => s.product).filter(Boolean))];
    const productNames = [
      ...CANONICAL,
      ...found.filter(p => !CANONICAL.includes(p)),
    ];

    const productMap = {};
    productNames.forEach(name => {
      productMap[name] = {
        name,
        shortName: shortName(name),
        signups: 0,
        newAccounts: 0,
        applicants: new Set(),
        universities: {},
        members: new Set(),
        fields: {},
        referrals: {},
        yearOfStudy: {},
        byDate: {},
      };
    });

    filteredSignups.forEach(s => {
      const pm = productMap[s.product];
      if (!pm) return;

      pm.signups++;
      if (s.isNewAccount) pm.newAccounts++;
      pm.universities[s.university || 'Unknown'] = (pm.universities[s.university || 'Unknown'] || 0) + 1;
      if (s.memberName) pm.members.add(s.memberName);
      pm.fields[s.fieldOfStudy || 'Unknown'] = (pm.fields[s.fieldOfStudy || 'Unknown'] || 0) + 1;
      pm.referrals[s.referral || 'Unknown'] = (pm.referrals[s.referral || 'Unknown'] || 0) + 1;
      pm.yearOfStudy[s.yearOfStudy || 'Unknown'] = (pm.yearOfStudy[s.yearOfStudy || 'Unknown'] || 0) + 1;
      if (s.dateKey) pm.byDate[s.dateKey] = (pm.byDate[s.dateKey] || 0) + 1;

      const pids = appMap.get(normEmail(s.email));
      if (pids) pids.forEach(pid => pm.applicants.add(pid));
    });

    const products = productNames.map(name => {
      const pm = productMap[name];
      return {
        name: pm.name,
        shortName: pm.shortName,
        signups: pm.signups,
        applicants: pm.applicants.size,
        newAccounts: pm.newAccounts,
        memberCount: pm.members.size,
        memberList: [...pm.members].sort(),
        conversionRate: pm.signups > 0
          ? Number(((pm.applicants.size / pm.signups) * 100).toFixed(1))
          : 0,
        topUniversity: topKey(pm.universities),
        topField: topKey(pm.fields),
        topReferral: topKey(pm.referrals),
        universities: Object.entries(pm.universities)
          .map(([n, count]) => ({ name: n, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        fields: Object.entries(pm.fields)
          .map(([field, count]) => ({ field, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
        referrals: Object.entries(pm.referrals)
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count),
        yearOfStudy: Object.entries(pm.yearOfStudy)
          .map(([year, count]) => ({ year, count }))
          .sort((a, b) => b.count - a.count),
        timeSeries: Object.entries(pm.byDate)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count })),
      };
    });

    const totalAll = filteredSignups.length;
    const productShare = products.map(p => ({
      name: p.shortName,
      count: p.signups,
      percentage: totalAll > 0 ? Number(((p.signups / totalAll) * 100).toFixed(1)) : 0,
    }));

    const allDates = new Set();
    products.forEach(p => p.timeSeries.forEach(d => allDates.add(d.date)));
    const combinedTimeSeries = [...allDates].sort().map(date => {
      const entry = { date };
      products.forEach(p => {
        entry[p.shortName] = p.timeSeries.find(d => d.date === date)?.count || 0;
      });
      return entry;
    });

    res.json({
      availability,
      products,
      productShare,
      combinedTimeSeries,
      totalSignups: totalAll,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

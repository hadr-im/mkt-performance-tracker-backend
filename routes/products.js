const express = require('express');
const router = express.Router();
const { getSignups, getApplications, applyFilters } = require('../services/sheets');

const PRODUCTS = ['Volunteering Internship', 'Professional Internship', 'Teaching Internship'];

router.get('/', async (req, res) => {
  try {
    const { member, dateFrom, dateTo } = req.query;

    const [signups, applications] = await Promise.all([getSignups(), getApplications()]);
    const filteredSignups = applyFilters(signups, { member, dateFrom, dateTo });
    const filteredApps = applyFilters(applications, { member, dateFrom, dateTo });

    // Helper: Map emails to products from signups sheet
    const emailToProduct = {};
    signups.forEach(s => {
      if (s.email) emailToProduct[s.email.toLowerCase().trim()] = s.product;
    });

    // Per-product breakdown
    const productMap = {};
    PRODUCTS.forEach(p => {
      productMap[p] = {
        name: p,
        shortName: p.replace(' Internship', ''),
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
      const p = s.product;
      if (!productMap[p]) return;
      const pm = productMap[p];
      pm.signups++;
      if (s.isNewAccount) pm.newAccounts++;
      const uni = s.university || 'Unknown';
      pm.universities[uni] = (pm.universities[uni] || 0) + 1;
      if (s.memberName) pm.members.add(s.memberName);
      const f = s.fieldOfStudy || 'Unknown';
      pm.fields[f] = (pm.fields[f] || 0) + 1;
      const r = s.referral || 'Unknown';
      pm.referrals[r] = (pm.referrals[r] || 0) + 1;
      const y = s.yearOfStudy || 'Unknown';
      pm.yearOfStudy[y] = (pm.yearOfStudy[y] || 0) + 1;
      if (s.date) {
        const date = s.date.toISOString().split('T')[0];
        pm.byDate[date] = (pm.byDate[date] || 0) + 1;
      }
    });

    // Add Applicants per product
    filteredApps.forEach(a => {
      const p = emailToProduct[a.email?.toLowerCase().trim()];
      if (productMap[p] && a.personId) {
        productMap[p].applicants.add(a.personId);
      }
    });

    const products = PRODUCTS.map(p => {
      const pm = productMap[p];
      return {
        name: pm.name,
        shortName: pm.shortName,
        signups: pm.signups,
        applicants: pm.applicants.size,
        newAccounts: pm.newAccounts,
        memberCount: pm.members.size,
        memberList: [...pm.members],
        topUniversity: Object.entries(pm.universities).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
        topField: Object.entries(pm.fields).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
        topReferral: Object.entries(pm.referrals).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
        universities: Object.entries(pm.universities)
          .map(([name, count]) => ({ name, count }))
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

    // Comparison: product share (driven by signups)
    const totalAll = filteredSignups.length;
    const productShare = products.map(p => ({
      name: p.shortName,
      count: p.signups,
      percentage: totalAll > 0 ? ((p.signups / totalAll) * 100).toFixed(1) : 0,
    }));

    // Combined time series for all products
    const allDates = new Set();
    products.forEach(p => p.timeSeries.forEach(d => allDates.add(d.date)));
    const combinedTimeSeries = [...allDates].sort().map(date => {
      const entry = { date };
      products.forEach(p => {
        const found = p.timeSeries.find(d => d.date === date);
        entry[p.shortName] = found ? found.count : 0;
      });
      return entry;
    });

    res.json({
      products,
      productShare,
      combinedTimeSeries,
      totalSignups: totalAll,
    });
  } catch (err) {
    console.error('Products error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

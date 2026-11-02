const express = require('express');
const router = express.Router();
const { getDataset, applyFilters, normEmail } = require('../services/sheets');

router.get('/', async (req, res, next) => {
  try {
    const { member, dateFrom, dateTo } = req.query;
    const { signups, applications, membersInfo, directory, availability } = await getDataset();

    const filteredSignups = applyFilters(signups, { member, dateFrom, dateTo });
    const filteredApps = applyFilters(applications, { member, dateFrom, dateTo });

    const appMap = new Map();
    filteredApps.forEach(a => {
      const email = normEmail(a.email);
      if (!email || !a.personId) return;
      if (!appMap.has(email)) appMap.set(email, new Set());
      appMap.get(email).add(a.personId);
    });

    const memberMap = {};
    filteredSignups.forEach(s => {
      const name = s.memberName || 'Unknown';
      if (!memberMap[name]) {
        memberMap[name] = {
          name,
          department: membersInfo[name.toLowerCase().trim()] || 'Unknown',
          signups: 0,
          newAccounts: 0,
          applicants: new Set(),
          universities: new Set(),
          products: {},
          referrals: {},
          dates: new Set(),
        };
      }
      const m = memberMap[name];
      m.signups++;
      if (s.isNewAccount) m.newAccounts++;
      if (s.university) m.universities.add(s.university);
      m.products[s.product || 'Unknown'] = (m.products[s.product || 'Unknown'] || 0) + 1;
      m.referrals[s.referral || 'Unknown'] = (m.referrals[s.referral || 'Unknown'] || 0) + 1;
      if (s.dateKey) m.dates.add(s.dateKey);

      const pids = appMap.get(normEmail(s.email));
      if (pids) pids.forEach(pid => m.applicants.add(pid));
    });

    const members = Object.values(memberMap)
      .map(m => ({
        name: m.name,
        department: m.department,
        signups: m.signups,
        newAccounts: m.newAccounts,
        applicants: m.applicants.size,
        universitiesVisited: m.universities.size,
        universityList: [...m.universities].sort(),
        activeDays: m.dates.size,
        topProduct: Object.entries(m.products).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
        conversionRate: m.signups > 0
          ? Number(((m.applicants.size / m.signups) * 100).toFixed(1))
          : 0,
      }))
      .sort((a, b) => b.signups - a.signups);

    // The filter bar is populated from the departments roster only, so it
    // lists exactly the people the organisation tracks — not every name that
    // happens to appear in the signups sheet. It ignores the active filter so
    // that picking someone does not remove everyone else from the list.
    const signupCounts = new Map();
    signups.forEach(s => {
      const key = String(s.memberName || '').toLowerCase().trim();
      if (key) signupCounts.set(key, (signupCounts.get(key) || 0) + 1);
    });

    const roster = directory
      .map(({ name, department }) => ({
        name,
        department,
        signups: signupCounts.get(name.toLowerCase()) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const departments = [...new Set(directory.map(d => d.department))].sort();

    res.json({
      availability,
      members,
      leaderboard: members.slice(0, 10),
      allMembers: roster.map(r => r.name),
      roster,
      departments,
      totalMembers: members.length,
      rosterSize: roster.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

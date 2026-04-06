const express = require('express');
const router = express.Router();
const { getSignups, getApplications, getMembersInfo, applyFilters } = require('../services/sheets');

router.get('/', async (req, res) => {
  try {
    const { member: memberFilter, dateFrom, dateTo } = req.query;

    const [signups, applications, membersInfo] = await Promise.all([
      getSignups(),
      getApplications(),
      getMembersInfo()
    ]);

    const filteredSignups = applyFilters(signups, { member: memberFilter, dateFrom, dateTo });
    
    // Create email-to-applicants map for linking
    const appMap = {};
    applications.forEach(a => {
      if (a.email && a.personId) {
        const email = a.email.toLowerCase().trim();
        if (!appMap[email]) appMap[email] = new Set();
        appMap[email].add(a.personId);
      }
    });

    const memberMap = {};

    filteredSignups.forEach(s => {
      const m = s.memberName || 'Unknown';
      if (!memberMap[m]) {
        memberMap[m] = {
          name: m,
          department: membersInfo[m.toLowerCase().trim()] || 'Unknown',
          signups: 0,
          newAccounts: 0,
          applicants: new Set(), // unique people (Applicants)
          universities: new Set(),
          products: {},
          referrals: {},
          dates: new Set(),
        };
      }
      memberMap[m].signups++;
      if (s.isNewAccount) memberMap[m].newAccounts++;
      if (s.university) memberMap[m].universities.add(s.university);
      
      const p = s.product || 'Unknown';
      memberMap[m].products[p] = (memberMap[m].products[p] || 0) + 1;
      
      const r = s.referral || 'Unknown';
      memberMap[m].referrals[r] = (memberMap[m].referrals[r] || 0) + 1;
      
      if (s.date) memberMap[m].dates.add(s.date.toISOString().split('T')[0]);
      
      // Link with Applicants by email
      const email = s.email?.toLowerCase().trim();
      if (email && appMap[email]) {
        appMap[email].forEach(pid => memberMap[m].applicants.add(pid));
      }
    });

    const members = Object.values(memberMap).map(m => ({
      name: m.name,
      department: m.department,
      signups: m.signups,
      newAccounts: m.newAccounts,
      applicants: m.applicants.size,
      universitiesVisited: m.universities.size,
      universityList: [...m.universities],
      activeDays: m.dates.size,
      topProduct: Object.entries(m.products).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
      conversionRate: m.signups > 0 ? ((m.applicants.size / m.signups) * 100).toFixed(1) : 0,
    })).sort((a, b) => b.signups - a.signups);

    const allMembers = members.map(m => m.name).filter(n => n !== 'Unknown').sort();
    const leaderboard = members.slice(0, 10);

    res.json({
      members,
      leaderboard,
      allMembers,
      totalMembers: members.length,
    });
  } catch (err) {
    console.error('Members error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

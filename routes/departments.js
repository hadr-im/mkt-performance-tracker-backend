const express = require('express');
const router = express.Router();
const { getDataset, applyFilters, nextDateKey, normEmail } = require('../services/sheets');

const UNKNOWN = 'Unknown';

router.get('/', async (req, res, next) => {
  try {
    const { member, dateFrom, dateTo } = req.query;
    const { signups, applications, membersInfo, directory, availability } = await getDataset();

    const deptOf = name => membersInfo[String(name || '').trim().toLowerCase()] || UNKNOWN;

    const filteredSignups = applyFilters(signups, { member, dateFrom, dateTo });
    const filteredApps = applyFilters(applications, { member, dateFrom, dateTo });

    // email -> set of personIds, from the filtered applications only
    const appMap = new Map();
    filteredApps.forEach(a => {
      const email = normEmail(a.email);
      if (!email || !a.personId) return;
      if (!appMap.has(email)) appMap.set(email, new Set());
      appMap.get(email).add(a.personId);
    });

    const deptMap = {};
    const ensureDept = dept => {
      if (!deptMap[dept]) {
        deptMap[dept] = {
          signups: 0,
          applicants: new Set(),
          members: new Set(),
          universities: new Set(),
          timeSeries: {},
        };
      }
      return deptMap[dept];
    };

    filteredSignups.forEach(s => {
      const memberName = s.memberName || UNKNOWN;
      const d = ensureDept(deptOf(memberName));

      d.signups++;
      if (memberName !== UNKNOWN) d.members.add(memberName);
      if (s.university) d.universities.add(s.university);
      if (s.dateKey) d.timeSeries[s.dateKey] = (d.timeSeries[s.dateKey] || 0) + 1;

      // Attribute applicants through the signup that produced them, so a
      // department only ever counts people its own members signed up.
      const pids = appMap.get(normEmail(s.email));
      if (pids) pids.forEach(pid => d.applicants.add(pid));
    });

    const departments = Object.entries(deptMap)
      .map(([department, data]) => ({
        department,
        signups: data.signups,
        applicants: data.applicants.size,
        members: data.members.size,
        memberList: [...data.members].sort(),
        universitiesVisited: data.universities.size,
        conversionRate: data.signups > 0
          ? Number(((data.applicants.size / data.signups) * 100).toFixed(1))
          : 0,
      }))
      .sort((a, b) => b.signups - a.signups);

    /* Per-member breakdown.
     *
     * The roster is the Departments tab, not the signups sheet: every person
     * the organisation tracks appears, including those with no activity in
     * the selected range (shown as zero). Names that appear only in the leads
     * sheet are deliberately excluded — they have no department, and they are
     * already surfaced as the "Unknown" total. */
    const stats = new Map();
    const ensure = name => {
      const key = name.toLowerCase();
      if (!stats.has(key)) stats.set(key, { signups: 0, applicants: new Set(), days: new Set() });
      return stats.get(key);
    };

    filteredSignups.forEach(s => {
      const name = String(s.memberName || '').trim();
      if (!name) return;
      const e = ensure(name);
      e.signups++;
      if (s.dateKey) e.days.add(s.dateKey);
      const pids = appMap.get(normEmail(s.email));
      if (pids) pids.forEach(pid => e.applicants.add(pid));
    });

    const memberBreakdown = directory
      .map(({ name, department }) => {
        const e = stats.get(name.toLowerCase()) || { signups: 0, applicants: new Set(), days: new Set() };
        return {
          name,
          department,
          signups: e.signups,
          applicants: e.applicants.size,
          activeDays: e.days.size,
          conversionRate: e.signups > 0
            ? Number(((e.applicants.size / e.signups) * 100).toFixed(1))
            : 0,
        };
      })
      // Most active first, then alphabetical so the zero rows stay readable.
      .sort((a, b) => b.signups - a.signups || a.name.localeCompare(b.name));

    // Continuous, zero-filled daily series so department lines stay unbroken
    const allDepts = Object.keys(deptMap).filter(d => d !== UNKNOWN).sort();

    const presentKeys = filteredSignups.map(s => s.dateKey).filter(Boolean).sort();
    const start = dateFrom || presentKeys[0];
    const end = dateTo || presentKeys[presentKeys.length - 1];

    const deptTimeSeries = [];
    if (start && end && start <= end) {
      let cursor = start;
      // 1095 days ~= 3 seasons; guards against a malformed range
      for (let guard = 0; cursor <= end && guard < 1095; guard++) {
        const entry = { date: cursor };
        allDepts.forEach(d => { entry[d] = deptMap[d].timeSeries[cursor] || 0; });
        deptTimeSeries.push(entry);
        cursor = nextDateKey(cursor);
      }
    }

    // Every department on the roster, so the table's filter lists them all
    // even when one has no signups in the selected range.
    const rosterDepts = [...new Set(directory.map(d => d.department))].sort();

    res.json({
      availability,
      departments,
      memberBreakdown,
      deptTimeSeries,
      allDepts,
      rosterDepts,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

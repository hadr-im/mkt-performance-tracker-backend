const { google } = require('googleapis');
const NodeCache = require('node-cache');

/**
 * Cache TTL in seconds. The frontend no longer keeps its own permanent cache,
 * so this is the single source of truth for data freshness.
 */
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS || 60);
const cache = new NodeCache({ stdTTL: CACHE_TTL });

/**
 * Spreadsheet is configurable so a new season / new sheet needs no code change.
 * Default is the 2026 "Eps Leads Mirror" sheet.
 */
const SHEET_ID = process.env.SHEETS_ID || '1V-C21GpCyxt2e0_WSyKoBXs20vancobz6y6FhdN0rNU';

// Preferred tab names, in priority order. First one that exists wins.
const SIGNUP_TABS = [process.env.SHEET_TAB_SIGNUPS, 'Eps Leads Mirror', 'Signups'].filter(Boolean);
const APPLICATION_TABS = [process.env.SHEET_TAB_APPLICATIONS, 'Expa Application', 'Applications'].filter(Boolean);
const MEMBER_TABS = [process.env.SHEET_TAB_MEMBERS, 'Departments', 'Members Info', 'Members'].filter(Boolean);

function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    // Fix for literal \n in environment variables
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  throw new Error('No Google credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS env var.');
}

function sheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

/** Wrap a tab name for use in an A1 range (tab names may contain spaces/quotes). */
function quoteTab(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/** List the spreadsheet's tab titles (cached). */
async function listTabs() {
  const cached = cache.get('__tabs__');
  if (cached) return cached;

  const res = await sheetsClient().spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets.properties.title',
  });
  const titles = (res.data.sheets || []).map(s => s.properties.title);
  cache.set('__tabs__', titles);
  return titles;
}

/** Resolve the first candidate tab name that actually exists, else null. */
async function resolveTab(candidates) {
  const titles = await listTabs();
  const lower = titles.map(t => t.toLowerCase().trim());
  for (const want of candidates) {
    const idx = lower.indexOf(want.toLowerCase().trim());
    if (idx !== -1) return titles[idx];
  }
  return null;
}

/** Fetch raw rows (including the header row) for a tab. */
async function fetchTab(tabTitle, columns = 'A:Z') {
  const range = `${quoteTab(tabTitle)}!${columns}`;
  const cacheKey = `rows:${range}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  const data = res.data.values || [];
  cache.set(cacheKey, data);
  return data;
}

/* ------------------------------------------------------------------ *
 * Header-driven column mapping
 *
 * Column positions have already shifted once between seasons (member
 * name moved from L to N, consent columns were dropped). Matching on
 * header text instead of index means a reordered sheet keeps working.
 * ------------------------------------------------------------------ */

/** Normalise a header cell: drop emoji, [FN]-style tags, punctuation, case. */
function normaliseHeader(raw) {
  return String(raw || '')
    .replace(/\[[^\]]*\]/g, ' ')                 // [FN], [E], ...
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')           // emoji & punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Build { field: columnIndex } from a header row.
 * `spec` maps a field name to a predicate over the normalised header.
 * Fields listed in `multi` collect every matching index.
 */
function mapColumns(headerRow, spec, multi = []) {
  const headers = (headerRow || []).map(normaliseHeader);
  const map = {};
  multi.forEach(f => { map[f] = []; });

  headers.forEach((h, i) => {
    if (!h) return;
    for (const [field, test] of Object.entries(spec)) {
      if (!test(h)) continue;
      if (multi.includes(field)) {
        map[field].push(i);
      } else if (map[field] === undefined) {
        map[field] = i;
      }
    }
  });
  return map;
}

/** Read a single cell by mapped index. */
function cell(row, idx) {
  if (idx === undefined || idx === null || idx < 0) return '';
  return String(row[idx] ?? '').trim();
}

/** Read the first non-empty cell across several mapped indices. */
function firstCell(row, indices) {
  for (const i of indices || []) {
    const v = cell(row, i);
    if (v) return v;
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/**
 * Parse the sheet's date formats into a Date plus a local YYYY-MM-DD key.
 * Supported:
 *   2026-01-26 9:20:21   (current sheet)
 *   26/01/2026           (previous sheet)
 *   ISO 8601
 *
 * The day key is derived from local calendar fields, never toISOString(),
 * so a 00:30 local submission is not bucketed into the previous day.
 */
function parseDate(dateStr) {
  if (!dateStr) return { date: null, dateKey: '' };
  const str = String(dateStr).trim();

  // YYYY-MM-DD[ HH:MM[:SS]]
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return build(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  // DD/MM/YYYY[ HH:MM[:SS]]
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return build(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return build(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  }
  return { date: null, dateKey: '' };

  function build(y, mo, da, h, mi, s) {
    const date = new Date(y, mo - 1, da, h, mi, s);
    if (isNaN(date.getTime())) return { date: null, dateKey: '' };
    const pad = n => String(n).padStart(2, '0');
    return { date, dateKey: `${y}-${pad(mo)}-${pad(da)}` };
  }
}

/** Add one day to a YYYY-MM-DD key. */
function nextDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Excluded members
 *
 * People who appear as a member name in the leads sheet but should not
 * count towards any figure. Their signups are dropped at load time, so
 * every page, chart, total and the filter list are consistent by
 * construction rather than each route having to remember to filter.
 *
 * Override with EXCLUDED_MEMBERS (comma-separated) to change the list
 * without touching code.
 * ------------------------------------------------------------------ */
const DEFAULT_EXCLUDED_MEMBERS = [
  'Ahmed Houssem',
  'arij abdaoui',
  'Chaima Dhouibi',
  'Esra Kahloul',
  'eya hamzaoui',
  'Farah Garnaoui',
  'Heithem Hnia',
  'Hiba Allah Aleya',
  'kenza hasseni',
  'Lina Fakhfakh',
  'maram jaloul',
  'Med Amine Othmen',
  'Mehdi Jdidi',
  'Oussema Rachdi',
  'Ranya Rebhi',
  'Rayen Zalila',
  'Youssef Ben Abdeltif',
  'Zeineb Mahjoub',
  'Ryma Khlifi',       // no longer in the LC
  'mariem attia',      // no longer in the LC
];

/** Case-, spacing- and punctuation-insensitive key for name matching. */
function nameKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^a-z0-9]/g, '');
}

const EXCLUDED_MEMBERS = new Set(
  (process.env.EXCLUDED_MEMBERS
    ? process.env.EXCLUDED_MEMBERS.split(',')
    : DEFAULT_EXCLUDED_MEMBERS
  )
    .map(n => nameKey(n))
    .filter(Boolean)
);

function isExcludedMember(name) {
  return EXCLUDED_MEMBERS.has(nameKey(name));
}

/* ------------------------------------------------------------------ *
 * Member name aliases
 *
 * Members type their own name into the signup form, so the same person
 * shows up under several spellings. Each key below is a spelling seen in
 * the leads sheet; each value is the canonical name as written on the
 * Departments tab. Without this they fall into "Unknown" and their
 * department loses the signups.
 *
 * Matching ignores case, accents, spacing and punctuation, so only
 * genuinely different spellings need an entry here.
 * ------------------------------------------------------------------ */
const MEMBER_ALIASES = {
  'Ryhem Zaghouen': 'rihem zaghouen',
  'Tasnim Hasni': 'Tassnim Hasni',
  'Mohamed Salah Touati': 'Med Salah Touati',
  'Ismail': 'Ismail Ben Chattia',
  'Yassine Chatti': 'Med Yassine Chatti',
  'Mohamed saied': 'Mohamed Said',
  'Marwen el gueder': 'Marwen Lgueder',
  'Tayssir abdellaoui': 'tayssir abdelleoui',
  'Zeynab kouki': 'zeyneb kouki',
  'Zaineb kouki': 'zeyneb kouki',
  'Aya fataki': 'aya fatteki',
  'Aya Fateki': 'aya fatteki',   // distinct from "fataki" above — a vs e
  'Ilef Fejju': 'ilef fejji',
  'Maysaa gana': 'Mayssa Gana',
  'Rihem ben slimene': 'rihem ben slimen',
  'Mokhtar BarKetallah': 'Mokthar Barketallah',
};

const ALIAS_BY_KEY = new Map(
  Object.entries(MEMBER_ALIASES).map(([variant, canonical]) => [nameKey(variant), canonical])
);

/** Resolve a member name written in the leads sheet to its roster spelling. */
function canonicalMember(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  return ALIAS_BY_KEY.get(nameKey(raw)) || raw;
}

function parseUniversity(raw) {
  // "ISGS: Institut Supérieur de Gestion de Sousse" -> "ISGS"
  if (!raw) return 'Unknown';
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) return raw.substring(0, colonIdx).trim();
  return raw.split(' ')[0] || raw;
}

/* ------------------------------------------------------------------ *
 * Loaders
 * ------------------------------------------------------------------ */

const SIGNUP_SPEC = {
  expaId: h => h.includes('expa id'),
  submissionId: h => h.includes('submission id'),
  respondentId: h => h.includes('respondent id'),
  submittedAt: h => h.includes('submitted at') || h === 'timestamp',
  firstName: h => h.includes('first name'),
  lastName: h => h.includes('last name'),
  email: h => h.includes('email') && !h.includes('consent'),
  phone: h => h.includes('phone'),
  university: h => h.includes('university'),
  product: h => h.includes('type of') || h.includes('internship type'),
  referral: h => h.includes('referral'),
  memberName: h => h.includes('member name'),
  fieldOfStudy: h => h.includes('field of study'),
  yearOfStudy: h => h.includes('year of study'),
  // the live sheet misspells this as "Account Satus"
  accountStatus: h => /account\s*(status|satus|state)/.test(h),
};

/**
 * Signups (leads). The sheet carries three columns titled "Member Name";
 * only one is populated per row, so we take the first non-empty.
 */
async function getSignups() {
  const tab = await resolveTab(SIGNUP_TABS);
  if (!tab) {
    throw new Error(
      `No signups tab found in spreadsheet ${SHEET_ID}. Looked for: ${SIGNUP_TABS.join(', ')}. ` +
      `Available tabs: ${(await listTabs()).join(', ') || '(none)'}`
    );
  }

  const rows = await fetchTab(tab);
  if (!rows.length) return [];

  const col = mapColumns(rows[0], SIGNUP_SPEC, ['memberName']);

  return rows.slice(1)
    .filter(row => cell(row, col.submittedAt))
    // A signup with no member name cannot be attributed to anyone, so it is
    // dropped rather than left to sit in an "Unknown" bucket.
    .filter(row => firstCell(row, col.memberName))
    // Resolve the spelling first, so an excluded person is caught however
    // their name was typed.
    .filter(row => !isExcludedMember(canonicalMember(firstCell(row, col.memberName))))
    .map(row => {
      const universityFull = cell(row, col.university);
      const status = cell(row, col.accountStatus);
      const { date, dateKey } = parseDate(cell(row, col.submittedAt));

      return {
        expaId: cell(row, col.expaId),
        submissionId: cell(row, col.submissionId),
        respondentId: cell(row, col.respondentId),
        submittedAt: cell(row, col.submittedAt),
        firstName: cell(row, col.firstName),
        lastName: cell(row, col.lastName),
        email: cell(row, col.email),
        phone: cell(row, col.phone),
        university: parseUniversity(universityFull),
        universityFull,
        product: cell(row, col.product),
        referral: cell(row, col.referral),
        memberName: canonicalMember(firstCell(row, col.memberName)),
        fieldOfStudy: cell(row, col.fieldOfStudy),
        yearOfStudy: cell(row, col.yearOfStudy),
        accountStatus: status,
        isNewAccount: status.toLowerCase().includes('created successfully'),
        date,
        dateKey,
      };
    });
}

const APPLICATION_SPEC = {
  applicationId: h => h.includes('application id'),
  personId: h => h.includes('person id'),
  fullName: h => h.includes('full name') || h === 'name',
  email: h => h.includes('email'),
  phone: h => h.includes('phone'),
  createdAt: h => h.includes('created at') || h.includes('submitted at'),
  product: h => h.includes('product') || h.includes('type of'),
};

/**
 * EXPA applications. Optional: the 2026 sheet does not carry this tab,
 * in which case applicant/conversion metrics are reported as unavailable
 * rather than silently shown as zero.
 */
async function getApplications() {
  const tab = await resolveTab(APPLICATION_TABS);
  if (!tab) return [];

  const rows = await fetchTab(tab);
  if (!rows.length) return [];

  const col = mapColumns(rows[0], APPLICATION_SPEC);

  return rows.slice(1)
    .filter(row => cell(row, col.applicationId) || cell(row, col.personId))
    .map(row => {
      const { date, dateKey } = parseDate(cell(row, col.createdAt));
      return {
        applicationId: cell(row, col.applicationId),
        personId: cell(row, col.personId),
        fullName: cell(row, col.fullName),
        email: cell(row, col.email),
        phone: cell(row, col.phone),
        createdAt: cell(row, col.createdAt),
        product: cell(row, col.product),
        date,
        dateKey,
      };
    });
}

/**
 * The member roster: every person listed on the departments tab, in sheet
 * order, with their original casing preserved.
 *
 * Columns: A = Name, B = Department. The live sheet has no header row, so one
 * is only skipped when the first cell actually looks like a header.
 */
async function getMemberDirectory() {
  const tab = await resolveTab(MEMBER_TABS);
  if (!tab) return [];

  const rows = await fetchTab(tab, 'A:B');
  const seen = new Set();
  const directory = [];

  rows.forEach((row, index) => {
    const name = String(row[0] || '').trim();
    const department = String(row[1] || '').trim();
    if (!name || !department) return;

    // Only treat row 0 as a header if it reads like one.
    if (index === 0 && /^(member\s*)?name$/i.test(name)) return;
    if (isExcludedMember(name)) return;

    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    directory.push({ name, department });
  });

  return directory;
}

/** Member -> department lookup, keyed by lowercased name. */
async function getMembersInfo() {
  const directory = await getMemberDirectory();
  const mapping = {};
  directory.forEach(({ name, department }) => {
    mapping[name.toLowerCase()] = department;
  });
  return mapping;
}

/**
 * Which optional datasets this spreadsheet actually provides.
 * Routes pass this through so the UI can hide metrics it cannot compute
 * instead of rendering a misleading zero.
 */
async function getAvailability() {
  const [appTab, memberTab] = await Promise.all([
    resolveTab(APPLICATION_TABS),
    resolveTab(MEMBER_TABS),
  ]);
  return {
    applications: Boolean(appTab),
    departments: Boolean(memberTab),
  };
}

/**
 * Load everything once and resolve cross-tab links.
 *
 * Applications carry no member or university of their own; they are joined
 * back to signups by email. Doing it here (rather than per-route) means
 * applications respond to the member filter exactly like signups do.
 */
async function getDataset() {
  const [signups, rawApplications, directory, availability] = await Promise.all([
    getSignups(),
    getApplications(),
    getMemberDirectory(),
    getAvailability(),
  ]);

  const membersInfo = {};
  directory.forEach(({ name, department }) => {
    membersInfo[name.toLowerCase()] = department;
  });

  const byEmail = new Map();
  signups.forEach(s => {
    const key = normEmail(s.email);
    if (key && !byEmail.has(key)) byEmail.set(key, s);
  });

  const applications = rawApplications.map(a => {
    const signup = byEmail.get(normEmail(a.email));
    return {
      ...a,
      memberName: signup ? signup.memberName : '',
      university: signup ? signup.university : 'Unknown',
      signupProduct: signup ? signup.product : '',
    };
  });

  return { signups, applications, membersInfo, directory, availability };
}

/**
 * Filter records by member and/or date range.
 *
 * Both guards are strict: a record that cannot satisfy a filter is dropped
 * rather than passed through. Previously a missing field short-circuited the
 * check, so applications (which had no memberName) ignored the member filter
 * entirely and inflated every applicant and conversion figure.
 *
 * Dates compare as YYYY-MM-DD strings, which keeps the range inclusive on
 * both ends without any timezone arithmetic.
 */
function applyFilters(records, { member, dateFrom, dateTo } = {}) {
  const needle = member ? String(member).trim().toLowerCase() : '';

  return records.filter(r => {
    if (needle && !String(r.memberName || '').toLowerCase().includes(needle)) {
      return false;
    }
    if (dateFrom || dateTo) {
      if (!r.dateKey) return false;
      if (dateFrom && r.dateKey < dateFrom) return false;
      if (dateTo && r.dateKey > dateTo) return false;
    }
    return true;
  });
}

module.exports = {
  getSignups,
  getApplications,
  getMembersInfo,
  getMemberDirectory,
  getAvailability,
  getDataset,
  applyFilters,
  parseUniversity,
  isExcludedMember,
  canonicalMember,
  parseDate,
  nextDateKey,
  normEmail,
  listTabs,
  SHEET_ID,
};

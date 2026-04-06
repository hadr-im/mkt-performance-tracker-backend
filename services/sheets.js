const { google } = require('googleapis');
const NodeCache = require('node-cache');

// Cache for 60 seconds (real-time feel with rate limit protection)
const cache = new NodeCache({ stdTTL: 60 });

const SIGNUPS_SHEET_ID = '1TLgtxeqNfbS8dwL4tzUdgQzDpd_DAx_KkDQhWO0SOWc';

function getAuth() {
  // Support both service account JSON file and environment variable
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

async function fetchSheetData(spreadsheetId, range) {
  const cacheKey = `${spreadsheetId}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const data = response.data.values || [];
  cache.set(cacheKey, data);
  return data;
}

/**
 * Fetch and parse signups data
 * Columns: EXPA ID, Submission ID, Respondent ID, Submitted at, First Name, Last Name,
 *          Email, Phone, University Name, Type of internship, Referral, Member Name,
 *          Field of Study, Year of Study, Email consent, Phone consent, Account Status
 */
async function getSignups() {
  const rows = await fetchSheetData(SIGNUPS_SHEET_ID, 'Signups!A2:Q');
  return rows
    .filter(row => row[3]) // must have date
    .map(row => ({
      expaId: row[0] || '',
      submissionId: row[1] || '',
      respondentId: row[2] || '',
      submittedAt: row[3] || '',
      firstName: row[4] || '',
      lastName: row[5] || '',
      email: row[6] || '',
      phone: row[7] || '',
      university: parseUniversity(row[8] || ''),
      universityFull: row[8] || '',
      product: row[9] || '',
      referral: row[10] || '',
      memberName: row[11] || '',
      fieldOfStudy: row[12] || '',
      yearOfStudy: row[13] || '',
      emailConsent: row[14] || '',
      phoneConsent: row[15] || '',
      accountStatus: row[16] || '',
      isNewAccount: (row[16] || '').includes('created successfully'),
      date: parseDate(row[3]),
    }));
}

/**
 * Fetch and parse applications data from EXPA
 * Columns: Application ID, Person ID, Full Name, Email, Phone, Created At, Product
 */
async function getApplications() {
  const rows = await fetchSheetData(SIGNUPS_SHEET_ID, "'Expa Application'!A2:G");
  return rows
    .filter(row => row[0]) // must have ID
    .map(row => ({
      applicationId: row[0] || '',
      personId: row[1] || '',
      fullName: row[2] || '',
      email: row[3] || '',
      phone: row[4] || '',
      createdAt: row[5] || '',
      product: row[6] || '',
      date: parseDate(row[5]),
    }));
}

/**
 * Fetch and parse member-to-department mapping
 * Columns: A: Name, B: Department
 */
async function getMembersInfo() {
  const rows = await fetchSheetData(SIGNUPS_SHEET_ID, "'Members Info'!A1:B200");
  const mapping = {};
  rows.forEach((row, index) => {
    // Skip header row if it exists
    if (index === 0 && row[0] && row[0].toLowerCase().includes('name')) return;
    
    if (row[0] && row[1]) {
      mapping[row[0].trim().toLowerCase()] = row[1].trim();
    }
  });
  return mapping;
}

function parseUniversity(raw) {
  // Extract short name from "ISGS: Institut Supérieur de Gestion de Sousse" -> "ISGS"
  if (!raw) return 'Unknown';
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) return raw.substring(0, colonIdx).trim();
  // Already short
  return raw.split(' ')[0] || raw;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Try DD/MM/YYYY format
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const m1 = dateStr.match(ddmmyyyy);
  if (m1) {
    return new Date(`${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`);
  }
  // Try ISO format
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function applyFilters(records, { member, dateFrom, dateTo }) {
  return records.filter(r => {
    if (member && r.memberName && !r.memberName.toLowerCase().includes(member.toLowerCase())) {
      return false;
    }
    if (dateFrom && r.date && r.date < new Date(dateFrom)) return false;
    if (dateTo && r.date && r.date > new Date(dateTo + 'T23:59:59')) return false;
    return true;
  });
}

module.exports = { getSignups, getApplications, getMembersInfo, applyFilters, parseUniversity };

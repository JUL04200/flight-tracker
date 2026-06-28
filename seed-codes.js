const { db, save } = require('./db');

const SEED_CODES = [
  { code: 'FT-QSQL-QKFA', plan: 'standard', durationMonths: 1 },
  { code: 'FT-XM74-6KAF', plan: 'standard', durationMonths: 1 },
  { code: 'FT-K9NC-XFV5', plan: 'standard', durationMonths: 3 },
  { code: 'FT-W84T-RFKN', plan: 'standard', durationMonths: 3 },
  { code: 'FT-QMAZ-LJCT', plan: 'standard', durationMonths: 6 },
  { code: 'FT-9VVE-6QCG', plan: 'standard', durationMonths: 6 },
  { code: 'FT-XZTA-V5NR', plan: 'standard', durationMonths: 12 },
  { code: 'FT-57VS-4J3P', plan: 'standard', durationMonths: 12 },
  { code: 'FT-Q5SU-GN52', plan: 'premium', durationMonths: 1 },
  { code: 'FT-7B3K-EMMU', plan: 'premium', durationMonths: 1 },
  { code: 'FT-DL25-MZ7J', plan: 'premium', durationMonths: 3 },
  { code: 'FT-UWHD-5686', plan: 'premium', durationMonths: 3 },
  { code: 'FT-CVMD-G4JJ', plan: 'premium', durationMonths: 6 },
  { code: 'FT-27E5-TPQQ', plan: 'premium', durationMonths: 6 },
  { code: 'FT-H6YY-QT4V', plan: 'premium', durationMonths: 12 },
  { code: 'FT-YD5D-9XJF', plan: 'premium', durationMonths: 12 },
];

// Insère les codes de démarrage une seule fois (idempotent au redéploiement)
function seedCodes() {
  let inserted = 0;
  for (const c of SEED_CODES) {
    if (db.codes[c.code]) continue;
    db.codes[c.code] = {
      code: c.code, plan: c.plan, durationMonths: c.durationMonths,
      createdAt: new Date().toISOString(), expiresAt: null,
      status: 'unused', usedBy: null, usedAt: null
    };
    inserted++;
  }
  if (inserted > 0) {
    save();
    console.log(`[SEED] ${inserted} code(s) initial(aux) insérés.`);
  }
}

module.exports = { seedCodes };

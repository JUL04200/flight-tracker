const { db, save } = require('./db');
const { TRIAL_DAYS } = require('./config');

function getUser(chatId) {
  chatId = String(chatId);
  if (!db.users[chatId]) {
    db.users[chatId] = {
      id: chatId, plan: null, planExpiresAt: null,
      trialUsed: false, remindedExpiry: false, expiredNotified: false,
      createdAt: new Date().toISOString()
    };
    save();
  }
  return db.users[chatId];
}

function isActive(user) {
  return !!user.plan && !!user.planExpiresAt && new Date(user.planExpiresAt) > new Date();
}

// Le plan trial donne les mêmes droits que premium pendant sa durée
function effectivePlan(chatId) {
  const user = getUser(chatId);
  if (!isActive(user)) return null;
  return user.plan === 'trial' ? 'premium' : user.plan;
}

function startTrial(chatId) {
  const user = getUser(chatId);
  if (user.trialUsed) return null;
  const end = new Date(Date.now() + TRIAL_DAYS * 86400000);
  user.plan = 'trial';
  user.planExpiresAt = end.toISOString();
  user.trialUsed = true;
  user.remindedExpiry = false;
  user.expiredNotified = false;
  save();
  return end;
}

function addDurationMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function applyCode(chatId, codeStr) {
  const code = db.codes[codeStr];
  if (!code) return { ok: false, reason: 'invalid' };
  if (code.status === 'used') return { ok: false, reason: 'used' };
  if (code.status === 'expired' || (code.expiresAt && new Date(code.expiresAt) < new Date())) {
    code.status = 'expired';
    save();
    return { ok: false, reason: 'expired' };
  }

  const user = getUser(chatId);
  const now = new Date();
  const start = isActive(user) ? new Date(user.planExpiresAt) : now;
  const end = addDurationMonths(start, code.durationMonths);

  user.plan = code.plan;
  user.planExpiresAt = end.toISOString();
  user.remindedExpiry = false;
  user.expiredNotified = false;

  code.status = 'used';
  code.usedBy = chatId;
  code.usedAt = now.toISOString();

  save();
  return { ok: true, plan: code.plan, expiresAt: end };
}

module.exports = { getUser, isActive, effectivePlan, startTrial, applyCode, addDurationMonths };

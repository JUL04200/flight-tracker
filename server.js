const express = require('express');
const cron = require('node-cron');
const { load } = require('./db');
const watchers = require('./watchers');
const bot = require('./bot');

const app = express();

load();
watchers.restoreWatchers();
bot.start();

// Rappel quotidien à heure fixe (12h30, heure de Paris) pour les watchers toujours sans résultat
cron.schedule('30 12 * * *', () => watchers.dailyStillNothingSweep(), { timezone: 'Europe/Paris' });

// Vérifie toutes les heures si un essai expire dans moins de 24h
cron.schedule('0 * * * *', () => bot.expiryReminderSweep());

app.get('/', (req, res) => res.send('Flight Tracker running.'));

const PORT = process.env.PORT || 3838;
app.listen(PORT, () => console.log(`Flight Tracker running on http://localhost:${PORT}`));

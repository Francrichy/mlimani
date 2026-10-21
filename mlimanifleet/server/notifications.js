/**
 * SMS / WhatsApp invoice & subscription reminders
 * Supports: Africa's Talking (SMS), Twilio, WhatsApp Cloud API
 * DEMO mode logs messages instead of sending.
 */
const https = require('https');
const { read, write, uid, now } = require('./db');

const DEMO = process.env.NOTIFY_DEMO !== 'false';

function httpsForm(method, hostname, path, headers, formBody) {
  return new Promise((resolve, reject) => {
    const data = formBody;
    const req = https.request({
      hostname, path, method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsJson(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function sendSms({ to, message }) {
  const phone = String(to).replace(/\s+/g, '').replace(/^0/, '255');
  if (DEMO) {
    console.log(`[SMS DEMO] → ${phone}: ${message}`);
    return { success: true, channel: 'sms', demo: true };
  }

  // Prefer Africa's Talking (popular in East Africa)
  if (process.env.AT_API_KEY && process.env.AT_USERNAME) {
    const form = new URLSearchParams({
      username: process.env.AT_USERNAME,
      to: phone,
      message,
      from: process.env.AT_SENDER_ID || 'Mlimani'
    }).toString();
    const res = await httpsForm('POST', 'api.africastalking.com', '/version1/messaging', {
      apiKey: process.env.AT_API_KEY,
      Accept: 'application/json'
    }, form);
    return { success: res.status < 300, channel: 'sms', provider: 'africastalking', raw: res.body };
  }

  // Twilio fallback
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const form = new URLSearchParams({
      To: `+${phone}`,
      From: process.env.TWILIO_FROM || '',
      Body: message
    }).toString();
    const res = await httpsForm('POST', 'api.twilio.com', `/2010-04-01/Accounts/${sid}/Messages.json`, {
      Authorization: `Basic ${auth}`
    }, form);
    return { success: res.status < 300, channel: 'sms', provider: 'twilio', raw: res.body };
  }

  throw new Error('No SMS provider configured (AT_API_KEY or TWILIO_*)');
}

async function sendWhatsApp({ to, message }) {
  const phone = String(to).replace(/\s+/g, '').replace(/^0/, '255');
  if (DEMO) {
    console.log(`[WA DEMO] → ${phone}: ${message}`);
    return { success: true, channel: 'whatsapp', demo: true };
  }

  // Meta WhatsApp Cloud API
  const token = process.env.WA_ACCESS_TOKEN;
  const phoneId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WA_ACCESS_TOKEN and WA_PHONE_NUMBER_ID required');

  const res = await httpsJson('POST', 'graph.facebook.com', `/v18.0/${phoneId}/messages`, {
    Authorization: `Bearer ${token}`
  }, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'text',
    text: { body: message }
  });
  return { success: res.status < 300, channel: 'whatsapp', raw: res.body };
}

function invoiceMessage(company, amount, dueDate) {
  return `MlimaniFleet: Habari ${company.name}. Malipo ya usajili TZS ${Number(amount).toLocaleString()} yanastahili ifikapo ${dueDate}. Lipa kupitia dashboard yako au piga +255... Asante.`;
}

function reminderMessage(company, daysLeft, amount) {
  return `MlimaniFleet: Usajili wa ${company.name} unaisha baada ya siku ${daysLeft}. Kiasi: TZS ${Number(amount).toLocaleString()}/mwezi. Lipa sasa kuepuka kukatizwa kwa huduma.`;
}

/** Run daily: find companies due within N days and notify */
async function runSubscriptionReminders({ daysAhead = 3, channel = 'sms' } = {}) {
  const companies = read('companies');
  const vehicles = read('vehicles');
  const { priceForCount } = require('./pricing');
  const logs = read('notification_logs') || [];
  const results = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const c of companies) {
    if (!c.next_billing_date || !c.phone) continue;
    if (c.subscription_status === 'cancelled') continue;

    const due = new Date(c.next_billing_date);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due - today) / 86400000);
    if (diffDays < 0 || diffDays > daysAhead) continue;

    const count = Math.max(vehicles.filter(v => v.company_id === c.id).length, 1);
    const { amount } = priceForCount(count);
    const msg = diffDays === 0
      ? invoiceMessage(c, amount, c.next_billing_date)
      : reminderMessage(c, diffDays, amount);

    try {
      const send = channel === 'whatsapp' ? sendWhatsApp : sendSms;
      const r = await send({ to: c.phone, message: msg });
      const entry = {
        id: uid(),
        company_id: c.id,
        channel,
        message: msg,
        status: r.success ? 'sent' : 'failed',
        created_at: now()
      };
      logs.push(entry);
      results.push(entry);
    } catch (e) {
      results.push({ company_id: c.id, error: e.message });
    }
  }

  write('notification_logs', logs.slice(-500));
  return results;
}

module.exports = {
  sendSms,
  sendWhatsApp,
  runSubscriptionReminders,
  invoiceMessage,
  reminderMessage,
  DEMO
};

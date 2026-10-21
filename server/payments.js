/**
 * MlimaniFleet — Selcom & PawaPay payment adapters (full HTTP)
 * Set PAYMENT_DEMO=false and provide credentials for live mode.
 */
const crypto = require('crypto');
const https = require('https');
const { uid } = require('./db');

const DEMO = process.env.PAYMENT_DEMO !== 'false';

function httpsJson(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname,
      path,
      method,
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

/** Selcom signed headers (common pattern for apigw.selcommobile.com) */
function selcomHeaders(apiKey, apiSecret, payload) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed = crypto
    .createHmac('sha256', apiSecret)
    .update(JSON.stringify(payload) + timestamp)
    .digest('base64');
  return {
    Authorization: `SELCOM ${apiKey}:${signed}`,
    'Digest-Method': 'HS256',
    Digest: timestamp,
    Timestamp: timestamp
  };
}

async function selcomCreateOrder({ amount, phone, name, email, orderId, webhookUrl }) {
  const normalizedPhone = String(phone).replace(/\s+/g, '').replace(/^0/, '255');

  if (DEMO) {
    return {
      success: true,
      gateway: 'selcom',
      reference: `SEL-DEMO-${orderId}`,
      payment_token: `demo-${uid().slice(0, 8)}`,
      message: `DEMO: USSD push simulated to ${normalizedPhone}`,
      status: 'PENDING'
    };
  }

  const vendor = process.env.SELCOM_VENDOR_ID;
  const apiKey = process.env.SELCOM_API_KEY;
  const apiSecret = process.env.SELCOM_API_SECRET;
  if (!vendor || !apiKey || !apiSecret) {
    throw new Error('Selcom credentials missing (SELCOM_VENDOR_ID, SELCOM_API_KEY, SELCOM_API_SECRET)');
  }

  const baseUrl = process.env.APP_URL || 'http://localhost:3847';
  const payload = {
    vendor,
    order_id: orderId,
    buyer_email: email || 'billing@mlimanifleet.tz',
    buyer_name: name || 'Fleet Owner',
    buyer_phone: normalizedPhone,
    amount: Math.round(Number(amount)),
    currency: 'TZS',
    no_of_items: 1,
    webhook: webhookUrl || `${baseUrl}/api/webhooks/selcom`,
    redirect_url: `${baseUrl}/?paid=1`,
    cancel_url: `${baseUrl}/?paid=0`
  };

  const headers = selcomHeaders(apiKey, apiSecret, payload);
  const res = await httpsJson(
    'POST',
    'apigw.selcommobile.com',
    '/v1/checkout/create-order',
    headers,
    payload
  );

  const ok = res.status >= 200 && res.status < 300;
  return {
    success: ok,
    gateway: 'selcom',
    reference: res.body?.order_id || res.body?.transid || orderId,
    payment_gateway_url: res.body?.payment_gateway_url || res.body?.payment_token,
    status: ok ? 'PENDING' : 'FAILED',
    message: ok ? 'USSD / checkout initiated' : (res.body?.message || res.raw || 'Selcom error'),
    raw: res.body
  };
}

async function selcomQueryOrder(orderId) {
  if (DEMO) return { success: true, status: 'COMPLETED', gateway: 'selcom' };
  const vendor = process.env.SELCOM_VENDOR_ID;
  const apiKey = process.env.SELCOM_API_KEY;
  const apiSecret = process.env.SELCOM_API_SECRET;
  const payload = { order_id: orderId, vendor };
  const headers = selcomHeaders(apiKey, apiSecret, payload);
  const res = await httpsJson('POST', 'apigw.selcommobile.com', '/v1/checkout/order-status', headers, payload);
  return { success: res.status < 300, status: res.body?.payment_status || res.body?.result, raw: res.body };
}

async function pawapayDeposit({ amount, phone, provider, depositId, message }) {
  const normalizedPhone = String(phone).replace(/\s+/g, '').replace(/^0/, '255');

  if (DEMO) {
    return {
      success: true,
      gateway: 'pawapay',
      depositId,
      status: 'ACCEPTED',
      message: `DEMO: Deposit accepted via ${provider || 'VODACOM_TZA'}`,
      provider: provider || 'VODACOM_TZA'
    };
  }

  const token = process.env.PAWAPAY_API_TOKEN;
  if (!token) throw new Error('PAWAPAY_API_TOKEN not configured');

  const host = process.env.PAWAPAY_ENV === 'live' ? 'api.pawapay.io' : 'api.sandbox.pawapay.io';
  const body = {
    depositId: depositId || uid(),
    amount: String(Math.round(Number(amount))),
    currency: 'TZS',
    country: 'TZA',
    correspondent: provider || 'VODACOM_TZA',
    payer: {
      type: 'MSISDN',
      address: { value: normalizedPhone }
    },
    customerTimestamp: new Date().toISOString(),
    statementDescription: (message || 'MlimaniFleet').slice(0, 22)
  };

  const res = await httpsJson('POST', host, '/deposits', {
    Authorization: `Bearer ${token}`
  }, body);

  const ok = res.status >= 200 && res.status < 300;
  return {
    success: ok,
    gateway: 'pawapay',
    depositId: body.depositId,
    status: res.body?.status || (ok ? 'ACCEPTED' : 'FAILED'),
    message: ok ? 'Deposit request sent' : (res.body?.failureReason || res.raw || 'PawaPay error'),
    provider: provider || 'VODACOM_TZA',
    raw: res.body
  };
}

async function pawapayDepositStatus(depositId) {
  if (DEMO) return { success: true, status: 'COMPLETED' };
  const token = process.env.PAWAPAY_API_TOKEN;
  const host = process.env.PAWAPAY_ENV === 'live' ? 'api.pawapay.io' : 'api.sandbox.pawapay.io';
  const res = await httpsJson('GET', host, `/deposits/${depositId}`, {
    Authorization: `Bearer ${token}`
  });
  return { success: res.status < 300, status: res.body?.status, raw: res.body };
}

const TZA_PROVIDERS = [
  { id: 'VODACOM_TZA', name: 'M-Pesa (Vodacom)', network: 'Vodacom' },
  { id: 'TIGO_TZA', name: 'Tigo Pesa', network: 'Tigo' },
  { id: 'AIRTEL_TZA', name: 'Airtel Money', network: 'Airtel' },
  { id: 'HALOTEL_TZA', name: 'HaloPesa', network: 'Halotel' }
];

module.exports = {
  DEMO,
  selcomCreateOrder,
  selcomQueryOrder,
  pawapayDeposit,
  pawapayDepositStatus,
  TZA_PROVIDERS
};

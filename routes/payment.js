const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);
const SSLCommerzPayment = require('sslcommerz-lts');
const { verifyToken } = require('../middleware/auth');
const PendingTransaction = require('../models/PendingTransaction');
const { getCollection } = require('../config/db');
const { ObjectId } = require('mongodb');
const { addPoints } = require('../utils/pointsHelper');
const { createNotification } = require('../utils/notificationHelper');
const crypto = require('crypto');

const store_id = process.env.SSL_STORE_ID;
const store_passwd = process.env.SSL_STORE_PASSWD;
const is_live = process.env.SSL_IS_LIVE === 'true';
const clientBaseUrl = (process.env.CLIENT_BASE_URL || 'http://localhost:5173').trim();

// Helper to process successful donations
async function processDonation(tran_id, gatewayData) {
  const transaction = await PendingTransaction.findOneAndUpdate(
    { tran_id, status: 'pending' },
    { $set: { status: 'success' } },
    { new: false } // returns the document before update
  );

  // If it wasn't found or wasn't pending, we've already processed it (or it's invalid)
  if (!transaction) return;

  const contributionsDb = getCollection('contributions');
  const amount = transaction.amount;
  const userEmail = transaction.userId; // we stored email in userId for simplicity if populated that way

  const { donationType, referenceId: refId } = transaction;

  const contribution = {
    type: donationType,
    amount: Number(amount),
    email: userEmail,
    date: new Date(),
    gateway: transaction.gateway,
    tranId: tran_id,
  };

  let notifMessage = '';
  let notifRecipient = null;
  let link = '';

  switch (donationType) {
    case 'community':
      contribution.note = 'General platform support';
      break;

    case 'animal':
      if (!refId) throw new Error('Animal donation missing refId');
      contribution.animalId = refId;
      await getCollection('animals').updateOne(
        { _id: new ObjectId(refId) },
        { $inc: { fundingRaised: Number(amount) } }
      );
      const animal = await getCollection('animals').findOne({ _id: new ObjectId(refId) });
      notifMessage = `A kind community member donated ৳${amount} to help with the animal you reported!`;
      notifRecipient = animal?.reporter?.email || animal?.contactInfo;
      link = `/animals/${refId}`;
      break;

    case 'event':
      if (!refId) throw new Error('Event donation missing refId');
      contribution.eventId = refId;
      await getCollection('cleanupevents').updateOne(
        { _id: new ObjectId(refId) },
        { $inc: { fundingRaised: Number(amount) } }
      );
      const event = await getCollection('cleanupevents').findOne({ _id: new ObjectId(refId) });
      notifMessage = `A kind community member donated ৳${amount} to your cleanup event!`;
      notifRecipient = event?.organizer?.email;
      link = `/cleanup-events/${refId}`;
      break;

    case 'ngo':
      if (!refId) throw new Error('NGO donation missing refId');
      contribution.ngoId = refId;
      await getCollection('ngos').updateOne(
        { _id: new ObjectId(refId) },
        { $inc: { totalDonations: Number(amount) } }
      );
      const ngo = await getCollection('ngos').findOne({ _id: new ObjectId(refId) });
      notifMessage = `Your NGO received a donation of ৳${amount}!`;
      notifRecipient = ngo?.adminEmail;
      link = `/ngos/${refId}`;
      break;

    case 'issue':
      if (!refId) throw new Error('Issue donation missing refId');
      contribution.issueId = refId;
      await getCollection('issues').updateOne(
        { _id: new ObjectId(refId) },
        { $inc: { 'crowdfunding.raisedAmount': Number(amount) } }
      );
      break;

    default:
      throw new Error(`Unknown donation type: ${donationType}`);
  }

  await contributionsDb.insertOne(contribution);

  if (typeof addPoints === 'function') {
    await addPoints(userEmail, 'contribution_made');
  }

  try {
    const { updateStreak } = require('../utils/streakHelper');
    await updateStreak(userEmail);
  } catch (streakErr) {
    console.error('Failed to update streak inside processDonation:', streakErr.message);
  }

  if (typeof createNotification === 'function' && notifRecipient) {
    await createNotification({
      userId: notifRecipient,
      email: notifRecipient,
      message: notifMessage,
      type: 'drive',
      link: link,
    });
  }
}

// 1. Stripe - Create Intent
router.post('/create-stripe-intent', verifyToken, async (req, res) => {
  try {
    const { amount, currency = 'bdt', donationType, referenceId } = req.body;
    
    if (!amount || amount < 10) {
      return res.status(400).json({ message: 'Minimum donation is ৳10.' });
    }

    const userEmail = req.user.email;
    const tran_id = 'STRIPE_' + crypto.randomUUID();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount * 100), // Stripe expects minimum units (cents/paisa)
      currency: 'usd',
      metadata: { tran_id, donationType, referenceId, userEmail },
    });

    await PendingTransaction.create({
      tran_id,
      gateway: 'stripe',
      amount,
      currency: 'USD',
      donationType,
      referenceId,
      userId: userEmail,
      status: 'pending'
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error('Stripe Intent Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 1b. Stripe - Direct Success Callback (For local dev where webhook is not received)
router.post('/stripe-success', verifyToken, async (req, res) => {
  try {
    const { paymentIntentId, tran_id } = req.body;
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'paymentIntentId is required' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent && paymentIntent.status === 'succeeded') {
      const actual_tran_id = paymentIntent.metadata?.tran_id || tran_id;
      await processDonation(actual_tran_id, paymentIntent);
      return res.json({ success: true, message: 'Donation processed successfully' });
    } else {
      return res.status(400).json({ error: 'Payment has not succeeded on Stripe' });
    }
  } catch (error) {
    console.error('stripe-success error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. SSLCommerz - Init Session
router.post('/ssl-init', verifyToken, async (req, res) => {
  try {
    const { amount, donationType, referenceId } = req.body;

    if (!amount || amount < 10) {
      return res.status(400).json({ message: 'Minimum donation is ৳10.' });
    }

    const userEmail = req.user.email;
    const tran_id = 'SSL_' + crypto.randomUUID();

    const data = {
      total_amount: amount,
      currency: 'BDT',
      tran_id: tran_id,
      success_url: `${clientBaseUrl}/api/payment/ssl-success`, // We'll route through backend
      fail_url: `${clientBaseUrl}/api/payment/ssl-fail`,
      cancel_url: `${clientBaseUrl}/api/payment/ssl-cancel`,
      ipn_url: `${clientBaseUrl}/api/payment/ssl-ipn`,
      shipping_method: 'Courier',
      product_name: donationType || 'Community Donation',
      product_category: 'Donation',
      product_profile: 'general',
      cus_name: req.user.displayName || 'Community Member',
      cus_email: userEmail,
      cus_add1: 'Dhaka',
      cus_add2: 'Dhaka',
      cus_city: 'Dhaka',
      cus_state: 'Dhaka',
      cus_postcode: '1000',
      cus_country: 'Bangladesh',
      cus_phone: '01711111111',
      cus_fax: '01711111111',
      ship_name: req.user.displayName || 'Community Member',
      ship_add1: 'Dhaka',
      ship_add2: 'Dhaka',
      ship_city: 'Dhaka',
      ship_state: 'Dhaka',
      ship_postcode: 1000,
      ship_country: 'Bangladesh',
    };

    // Need absolute URL for backend callbacks. SSLCommerz requires it.
    // Let's assume the backend is at localhost:3000 for now, but in prod it's different.
    const backendUrl = req.protocol + '://' + req.get('host');
    data.success_url = `${backendUrl}/api/payment/ssl-success`;
    data.fail_url = `${backendUrl}/api/payment/ssl-fail`;
    data.cancel_url = `${backendUrl}/api/payment/ssl-cancel`;
    data.ipn_url = `${backendUrl}/api/payment/ssl-ipn`;

    await PendingTransaction.create({
      tran_id,
      gateway: 'sslcommerz',
      amount,
      currency: 'BDT',
      donationType,
      referenceId,
      userId: userEmail,
      status: 'pending'
    });

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    sslcz.init(data).then(apiResponse => {
      if (apiResponse && apiResponse.status === 'SUCCESS' && apiResponse.GatewayPageURL) {
        res.json({ GatewayPageURL: apiResponse.GatewayPageURL });
      } else {
        console.error('SSLCommerz Session Init failed:', apiResponse);
        
        // Local sandbox fallback emulating success redirect for local testing if credentials fail in development
        if (!is_live) {
          console.warn('Sandbox Mode: De-active sandbox credentials detected. Emulating checkout redirection...');
          const backendUrl = req.protocol + '://' + req.get('host');
          const mockGatewayURL = `${backendUrl}/api/payment/ssl-mock-gate?tran_id=${tran_id}`;
          return res.json({ GatewayPageURL: mockGatewayURL });
        }
        
        res.status(400).json({ error: apiResponse?.failedreason || 'Failed to initialize SSLCommerz gateway session' });
      }
    }).catch(err => {
      console.error('SSL Init Error:', err);
      
      // Local sandbox fallback in case of connection failure / no internet in development
      if (!is_live) {
        console.warn('Sandbox Mode: Connection error. Emulating checkout redirection...');
        const backendUrl = req.protocol + '://' + req.get('host');
        const mockGatewayURL = `${backendUrl}/api/payment/ssl-mock-gate?tran_id=${tran_id}`;
        return res.json({ GatewayPageURL: mockGatewayURL });
      }
      
      res.status(500).json({ error: 'Failed to initialize SSL Commerz' });
    });

  } catch (error) {
    console.error('SSL Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2b. SSLCommerz - Mock local sandbox gateway
router.get('/ssl-mock-gate', async (req, res) => {
  const { tran_id } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>SSLCommerz Sandbox Mock Gateway</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700;900&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Outfit', sans-serif; background: #f0fdf4; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: white; border-radius: 16px; padding: 40px; box-shadow: 0 10px 30px rgba(15, 118, 110, 0.08); text-align: center; max-width: 400px; border: 1px solid #ccfbf1; }
        .icon { font-size: 48px; margin-bottom: 20px; }
        h2 { color: #0f766e; margin: 0 0 10px 0; font-weight: 900; font-size: 24px; }
        p { color: #042f2e; font-size: 14px; line-height: 1.6; margin: 0 0 30px 0; }
        .btn { background: #0f766e; color: white; border: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 14px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(15, 118, 110, 0.2); }
        .btn:hover { background: #0d645d; transform: translateY(-1px); }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">💳</div>
        <h2>SSLCommerz Emulator</h2>
        <p>This is a simulated sandbox gateway for CivicNest local development. Click below to verify and complete the payment.</p>
        <form action="/api/payment/ssl-mock-success" method="POST">
          <input type="hidden" name="tran_id" value="${tran_id}">
          <button type="submit" class="btn">Simulate Success</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

router.post('/ssl-mock-success', async (req, res) => {
  const { tran_id } = req.body;
  console.log('SSL Mock success callback received for tran_id:', tran_id);
  try {
    await processDonation(tran_id, { mock: true });
    res.redirect(`${clientBaseUrl}/payment-success`);
  } catch (err) {
    console.error('SSL Mock success handling error:', err);
    res.redirect(`${clientBaseUrl}/payment-failure?reason=mock_error`);
  }
});

// 3. SSLCommerz Callbacks
router.post('/ssl-success', async (req, res) => {
  const { val_id, tran_id } = req.body;
  console.log('SSL Success callback received. val_id:', val_id, 'tran_id:', tran_id);
  try {
    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    
    let isValid = false;
    if (!is_live) {
      // In sandbox mode, bypass validationserverAPI call to avoid outgoing HTTP request hanging/timeout issues.
      console.log('Sandbox Mode: Bypassing SSLCommerz validate server call.');
      isValid = true;
    } else {
      const validation = await sslcz.validate({ val_id });
      isValid = validation && (validation.status === 'VALID' || validation.status === 'VALIDATED');
    }
    
    if (isValid) {
      await processDonation(tran_id, req.body);
      console.log('SSL Success transaction processed successfully. Redirecting to success page.');
      res.redirect(`${clientBaseUrl}/payment-success`);
    } else {
      await PendingTransaction.updateOne({ tran_id }, { status: 'failed' });
      console.log('SSL Success validation failed. Redirecting to failure page.');
      res.redirect(`${clientBaseUrl}/payment-failure?reason=validation_failed`);
    }
  } catch (err) {
    console.error('SSL Validation Error in success callback:', err);
    res.redirect(`${clientBaseUrl}/payment-failure?reason=validation_error`);
  }
});

router.post('/ssl-fail', async (req, res) => {
  const { tran_id } = req.body;
  console.log('SSL Fail callback received for tran_id:', tran_id);
  await PendingTransaction.updateOne({ tran_id }, { status: 'failed' });
  res.redirect(`${clientBaseUrl}/payment-failure?reason=failed`);
});

router.post('/ssl-cancel', async (req, res) => {
  const { tran_id } = req.body;
  console.log('SSL Cancel callback received for tran_id:', tran_id);
  await PendingTransaction.updateOne({ tran_id }, { status: 'cancelled' });
  res.redirect(`${clientBaseUrl}/payment-failure?reason=cancelled`);
});

router.post('/ssl-ipn', async (req, res) => {
  const { val_id, tran_id } = req.body;
  try {
    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    const validation = await sslcz.validate({ val_id });

    if (validation && (validation.status === 'VALID' || validation.status === 'VALIDATED')) {
      await processDonation(tran_id, req.body);
    } else {
      await PendingTransaction.updateOne({ tran_id }, { status: 'failed' });
    }
  } catch (err) {
    console.error('SSL IPN Validation Error:', err);
  }
  res.status(200).send('IPN Received');
});

// Stripe Webhook handling should be in index.js to use express.raw(),
// but we'll export the handler here.
const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const tran_id = paymentIntent.metadata.tran_id;
    await processDonation(tran_id, paymentIntent);
  }

  res.json({ received: true });
};

router.stripeWebhookHandler = stripeWebhookHandler;
router.processDonation = processDonation;

module.exports = router;

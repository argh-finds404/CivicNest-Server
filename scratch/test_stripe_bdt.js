const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

async function run() {
  try {
    const intent = await stripe.paymentIntents.create({
      amount: 10000,
      currency: 'bdt',
      payment_method_types: ['card'],
    });
    console.log("Stripe BDT Success:", intent.id);
  } catch (err) {
    console.error("Stripe BDT Error:", err.message);
  }
}
run();

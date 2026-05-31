const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-05-27.dahlia'
});

async function run() {
  const sub = await stripe.subscriptions.retrieve('sub_1Td48sP6MSCbZuBr7nF3IHD1');
  console.log(JSON.stringify(sub, null, 2));
}

run().catch(console.error);

import Stripe from 'stripe';
import * as dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

async function getPrices() {
  const proPrices = await stripe.prices.list({ product: 'prod_UcFGECCwm0ZuRj' });
  const premiumPrices = await stripe.prices.list({ product: 'prod_UcFHhTrFMR7rTV' });

  console.log('--- Pro Price ID ---');
  console.log(proPrices.data[0]?.id || 'Not found');
  console.log('--- Premium Price ID ---');
  console.log(premiumPrices.data[0]?.id || 'Not found');
}

getPrices().catch(console.error);

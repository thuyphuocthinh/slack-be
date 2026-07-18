import { AppDataSource } from './data-source';

async function seed() {
  await AppDataSource.initialize();
  const query = `
    INSERT INTO pricing_plans (id, name, stripe_product_id, stripe_price_id, price, currency, interval, features, is_active)
    VALUES
      (
        gen_random_uuid(), 'Free', 'prod_free_placeholder', 'price_free_placeholder',
        0, 'usd', 'month',
        '{"messageHistoryDays":90,"maxStorageGb":5,"videoCall":false,"groupVideoCall":false,"prioritySupport":false}',
        true
      ),
      (
        gen_random_uuid(), 'Pro', 'prod_UcFGECCwm0ZuRj', 'price_1Td0mQP6MSCbZuBrzZzDw5gR',
        9.99, 'usd', 'month',
        '{"messageHistoryDays":null,"maxStorageGb":50,"videoCall":true,"groupVideoCall":false,"prioritySupport":false}',
        true
      ),
      (
        gen_random_uuid(), 'Premium', 'prod_UcFHhTrFMR7rTV', 'price_1Td0msP6MSCbZuBrleEuhMgB',
        19.99, 'usd', 'month',
        '{"messageHistoryDays":null,"maxStorageGb":null,"videoCall":true,"groupVideoCall":true,"prioritySupport":true}',
        true
      );
  `;
  await AppDataSource.query(query);
  console.log('Seeded successfully!');
  await AppDataSource.destroy();
}

seed().catch(console.error);

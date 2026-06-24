const SSLCommerzPayment = require('sslcommerz-lts');

const store_id = 'testbox';
const store_passwd = 'qwerty';
const is_live = false;

const data = {
  total_amount: 100,
  currency: 'BDT',
  tran_id: 'TEST_SSL_' + Date.now(),
  success_url: 'http://localhost:3000/api/payment/ssl-success',
  fail_url: 'http://localhost:3000/api/payment/ssl-fail',
  cancel_url: 'http://localhost:3000/api/payment/ssl-cancel',
  ipn_url: 'http://localhost:3000/api/payment/ssl-ipn',
  shipping_method: 'Courier',
  product_name: 'ngo',
  product_category: 'Donation',
  product_profile: 'general',
  cus_name: 'Community Member',
  cus_email: 'test_donator@test.com',
  cus_add1: 'Dhaka',
  cus_add2: 'Dhaka',
  cus_city: 'Dhaka',
  cus_state: 'Dhaka',
  cus_postcode: '1000',
  cus_country: 'Bangladesh',
  cus_phone: '01711111111',
  cus_fax: '01711111111',
  ship_name: 'Community Member',
  ship_add1: 'Dhaka',
  ship_add2: 'Dhaka',
  ship_city: 'Dhaka',
  ship_state: 'Dhaka',
  ship_postcode: 1000,
  ship_country: 'Bangladesh',
};

console.log('Initializing SSLCommerz session...');
const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
sslcz.init(data).then(apiResponse => {
  console.log('RESPONSE:', JSON.stringify(apiResponse, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});

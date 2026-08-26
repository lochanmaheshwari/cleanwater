import adminHandler from './_handlers/admin.js';
import checkExistingHandler from './_handlers/check-existing.js';
import checkStatusHandler from './_handlers/check-status.js';
import createBidHandler from './_handlers/create-bid.js';
import createFeeOrderHandler from './_handlers/create-fee-order.js';
import clickHandler from './_handlers/click.js';
import donationDoneHandler from './_handlers/donation-done.js';
import logoUploadHandler from './_handlers/logo-upload.js';
import paymentDoneHandler from './_handlers/payment-done.js';
import paypalConfigHandler from './_handlers/paypal-config.js';
import paypalDoneHandler from './_handlers/paypal-done.js';
import toDonationHandler from './_handlers/to-donation.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

const routes = {
  'admin': adminHandler,
  'check-existing': checkExistingHandler,
  'check-status': checkStatusHandler,
  'click': clickHandler,
  'create-bid': createBidHandler,
  'create-fee-order': createFeeOrderHandler,
  'donation-done': donationDoneHandler,
  'everyorg-webhook': donationDoneHandler,
  'logo-upload': logoUploadHandler,
  'payment-done': paymentDoneHandler,
  'paypal-config': paypalConfigHandler,
  'paypal-done': paypalDoneHandler,
  'to-donation': toDonationHandler
};

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    req.query = req.query || {};
    for (const [k, v] of url.searchParams.entries()) {
      if (req.query[k] === undefined) req.query[k] = v;
    }

    let route = (req.query.route || url.searchParams.get('route') || '').toString();

    if (!route) {
      const parts = url.pathname.replace(/^\/api\/?/, '').split('/');
      route = parts[0] || '';
    }

    // Clean route name (strip trailing slash or .js)
    route = route.replace(/\.js$/, '').replace(/^\/+|\/+$/g, '');

    const targetHandler = routes[route];
    if (targetHandler) {
      return await targetHandler(req, res);
    }

    return res.status(404).json({ error: `API route '/api/${route}' not found` });
  } catch (err) {
    console.error('API router error', err);
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  const clientId = process.env.PAYPAL_CLIENT_ID || 'sb';
  const isLive = (process.env.PAYPAL_BASE || '').includes('api-m.paypal.com');
  return res.status(200).json({
    clientId,
    isLive,
    configured: Boolean(process.env.PAYPAL_CLIENT_ID)
  });
}

export default async function handler(req, res) {
  const clientId = process.env.PAYPAL_CLIENT_ID || 'sb';
  const isLive = Boolean(process.env.PAYPAL_BASE?.includes('api-m.paypal.com') || (process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_CLIENT_ID.startsWith('sb')));
  return res.status(200).json({
    clientId,
    isLive,
    configured: Boolean(process.env.PAYPAL_CLIENT_ID)
  });
}

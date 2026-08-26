export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const enabled = Boolean(process.env.UROPAY_API_KEY && process.env.UROPAY_VPA);
  return res.status(200).json({
    enabled,
    vpa: enabled ? process.env.UROPAY_VPA : null,
    site: process.env.SITE || 'https://savewater.tech',
    currency: 'INR',
    // hint for frontend to show UPI for IN users
    showForIndia: true,
  });
}

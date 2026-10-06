// Shared helper, not an endpoint. Lives under an underscored folder so Vercel does not
// count it as a serverless function (the Hobby plan caps a deployment at 12).
import { clerkClient } from '@clerk/backend';

export async function verifyClerkToken(req, res) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized - Missing token' });
    return null;
  }

  const token = authHeader.substring(7);

  try {
    const verified = await clerkClient.verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return verified;
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ error: 'Unauthorized - Invalid token' });
    return null;
  }
}

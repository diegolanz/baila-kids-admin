// pages/api/admin/waitlist.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { Session } from '@prisma/client';


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { session } = req.query;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const items = await prisma.waitingList.findMany({
      where: { session: session as Session },
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json(items);
  } catch (e) {
    console.error('GET /api/admin/waitlist error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

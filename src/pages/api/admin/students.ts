import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

  if (req.method === 'GET') {
    try {
      const students = await prisma.student.findMany();
      res.status(200).json(students);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch students' });
    }
  } else if (req.method === 'PUT') {
    try {
      const { id, paymentStatus } = req.body;

      if (!id || !paymentStatus) {
        return res.status(400).json({ error: 'Missing id or paymentStatus' });
      }

      const updated = await prisma.student.update({
        where: { id },
        data: { paymentStatus },
      });

      res.status(200).json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error updating payment status' });
    }
  }
  else {
    res.setHeader('Allow', ['GET', 'PUT']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}

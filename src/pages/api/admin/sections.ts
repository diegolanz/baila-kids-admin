// src/pages/api/admin/sections.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { Session } from '@prisma/client';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { session } = req.query;

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (typeof session !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid session',
    });
  }

  try {
    const sections = await prisma.classSection.findMany({
      where: {
        session: session as Session,
        isActive: true,
      },

      include: {
        enrollments: {
          where: {
            status: 'ACTIVE',
          },
          select: {
            id: true,
          },
        },
      },

      orderBy: [
        { city: 'asc' },
        { school: 'asc' },
        { day: 'asc' },
        { label: 'asc' },
      ],
    });

    const data = sections.map((section) => {
      const enrolled = section.enrollments.length;
      const capacity = section.capacity;

      return {
        id: section.id,

        city: section.city,
        school: section.school,

        day: section.day,
        label: section.label,

        startDate: section.startDate
          ? section.startDate.toISOString()
          : null,

        endDate: section.endDate
          ? section.endDate.toISOString()
          : null,

        startTime: section.startTime,
        endTime: section.endTime,

        priceCents: section.priceCents,
        bundlePriceCents: section.bundlePriceCents,

        eligibleClasses: section.eligibleClasses,

        enrolled,
        capacity,

        seatsRemaining: Math.max(
          0,
          capacity - enrolled
        ),

        isFull: enrolled >= capacity,
      };
    });

    return res.status(200).json(data);
  } catch (err: unknown) {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Unknown error';

    console.error(
      'GET /api/admin/sections error:',
      err
    );

    return res.status(500).json({
      error: 'Failed to load sections',
      detail,
    });
  }
}
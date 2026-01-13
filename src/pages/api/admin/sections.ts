import type { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import { Session } from '@prisma/client';

const prisma = new PrismaClient();

// Optional: per-section capacity if you don't have a capacity column
const CAPS: Record<string, number | undefined> = {
  // 'KATY|Tuesday|A': 12,
  // 'KATY|Tuesday|B': 12,
  // 'KATY|Wednesday|A': 12,
  // 'SUGARLAND|Monday|A': 12,
};

type LocationKey = 'KATY' | 'SUGARLAND';
type DayKey = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
type SessionKey = 'A' | 'B';

type SectionRow = {
  id: string;
  location: LocationKey;
  day: DayKey;
  label: SessionKey;
  startDate: string | null;
  capacity: number | null; // ok if your table doesn't have it; will be null
};

type CountRow = { sectionId: string; count: bigint };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { session } = req.query;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1) Fetch sections directly from the table
    const sections = await prisma.$queryRaw<SectionRow[]>`
      SELECT id, location, day, label, "startDate",
            CASE WHEN to_regclass('\"ClassSection\"') IS NULL THEN NULL
                  ELSE NULL
            END AS capacity
      FROM "ClassSection"
        WHERE session = CAST(${session} AS "public"."Session")
      ORDER BY location ASC, day ASC, label ASC
    `;


    // 2) Active enrollments per section
    const counts = await prisma.$queryRaw<CountRow[]>`
      SELECT
        e."sectionId",
        COUNT(*)::bigint AS count
      FROM "Enrollment" e
      JOIN "ClassSection" cs
        ON e."sectionId" = cs.id
      WHERE e.status = 'ACTIVE'
        AND cs.session = CAST(${session} AS "public"."Session")
      GROUP BY e."sectionId"
    `;



    const countMap = new Map<string, number>(
      counts.map((r: CountRow) => [r.sectionId, Number(r.count)])
    );

    // 3) Build response with isFull
    const data = sections.map((s: SectionRow) => {
      const key = `${s.location}|${s.day}|${s.label}`;
      const enrolled = countMap.get(s.id) ?? 0;
      const explicitCap = CAPS[key];
      const capacity = (s.capacity ?? explicitCap) ?? null;
      const isFull = typeof capacity === 'number' ? enrolled >= capacity : false;

      return {
        id: s.id,
        location: s.location,
        day: s.day,
        label: s.label,
        startDate: s.startDate,
        enrolled,
        capacity,
        isFull,
      };
    });

    res.status(200).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load sections' });
  } 
}

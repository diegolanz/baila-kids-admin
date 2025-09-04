import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { studentId, day, label } = req.body as {
    studentId?: string;
    day?: string;   // e.g., "Monday" | "Tuesday" | ...
    label?: string; // "A" | "B"
  };

  if (!studentId || !day || !label) {
    return res.status(400).json({ error: 'Missing studentId, day, or label' });
  }

  try {
    // 1) Get the student (for location)
    const s = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, location: true },
    });
    if (!s) return res.status(404).json({ error: 'Student not found' });

    // 2) Find the target section id for (location, day, label)
    //    NOTE: day is text in your DB; label is text; location is enum.
    // ✅ Find target ClassSection by (location, day, label)
const rows = await prisma.$queryRaw<{ id: string }[]>`
  SELECT id
  FROM "ClassSection"
  WHERE location   = ${s.location}::"SchoolLocation"
    AND day::text  = ${day}
    AND label::text= ${label}
  LIMIT 1
`;
const targetId = rows[0]?.id;
if (!targetId) {
  return res.status(404).json({ error: 'Target section not found for given location/day/label' });
}


    // 3) Update the student's enrollment to point at the target section
    //    Mirrors: UPDATE "Enrollment" SET "sectionId" = <target> WHERE "studentId" = <id>;
    // ✅ Update Enrollment to point at the target section (what you ran by hand)
const updated = await prisma.$executeRaw`
  UPDATE "Enrollment"
  SET "sectionId" = ${targetId}
  WHERE "studentId" = ${studentId}
`;



// If no row was updated, create it
if (Number(updated) === 0) {
  await prisma.$executeRaw`
    INSERT INTO "Enrollment" ("id", "studentId", "sectionId", "status")
    VALUES (gen_random_uuid(), ${studentId}, ${targetId}, 'ACTIVE')
  `;
}







return res.status(200).json({ ok: true, sectionId: targetId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update enrollment' });
  }
}

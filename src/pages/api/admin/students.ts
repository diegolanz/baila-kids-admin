// src/pages/api/admin/students.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { Session } from '@prisma/client';

// ----------------- Local types -----------------

type CityKey = 'HOUSTON' | 'DALLAS';

type SchoolKey =
  | 'KATY'
  | 'SUGARLAND'
  | 'ALLEN'
  | 'FRISCO'
  | 'CASTLE_HILLS'
  | 'NORTH_DALLAS'
  | 'PRESTON_TRAIL';

type SessionKey = 'A' | 'B';

type DayKey =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday';

type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

type Frequency = 'ONCE_A_WEEK' | 'TWICE_A_WEEK';

interface StudentRow {
  id: string;
  studentName: string;
  age: number | null;
  parentName: string;
  phone: string;
  email: string;
  city: CityKey;
  school: SchoolKey;
  classroom: string | null;
  frequency: Frequency;
  selectedDays: string[];
  startDate: Date;
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  liabilityAccepted: boolean;
  waiverName: string | null;
  waiverAddress: string | null;
}

type AdminStudentDTO = {
  id: string;
  studentName: string;
  age: number | null;
  parentName: string;
  phone: string;
  email: string;

  city: CityKey;
  school: SchoolKey;
  classroom: string | null;

  frequency: Frequency;
  selectedDays: string[];

  startDate: string;
  sessionLabel?: SessionKey | null;
  startDatesByDay?: Partial<Record<DayKey, string>>;

  paymentStatus: PaymentStatus;
  paymentMethod?: string | null;

  liabilityAccepted?: boolean;
  waiverName?: string | null;
  waiverAddress?: string | null;
};

type JoinedRow = {
  studentid: string | null;
  day: string | null;
  label: string | null;
  startdate: Date | null;
};

type Agg = {
  days: Set<string>;
  starts: number[];
  labels: Record<SessionKey, number>;
  byDay: Map<string, string>;
};

type UpdatePayload = {
  paymentStatus?: PaymentStatus;
  paymentMethod?: string | null;
};

// ----------------- Helpers -----------------

const DAY_ORDER: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

function isDayKey(x: string): x is DayKey {
  return (
    x === 'Monday' ||
    x === 'Tuesday' ||
    x === 'Wednesday' ||
    x === 'Thursday' ||
    x === 'Friday'
  );
}

// ----------------- Handler -----------------

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { session } = req.query;

 

  try {
    // =====================================================
    // GET
    // =====================================================

    if (req.method === 'GET') {

      if (typeof session !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid session',
        });
      }
      // 1) Load students for the selected session
      const students = (await prisma.student.findMany({
        where: {
          session: session as Session,
        },
        orderBy: {
          studentName: 'asc',
        },
      })) as unknown as StudentRow[];

      // 2) Load ACTIVE enrollment information
      const joined = await prisma.$queryRaw<JoinedRow[]>`
        SELECT
          "Enrollment"."studentId"   AS studentid,
          "ClassSection"."day"::text AS day,
          "ClassSection"."label"     AS label,
          "ClassSection"."startDate" AS startdate
        FROM "Enrollment"
        JOIN "ClassSection"
          ON "Enrollment"."sectionId" = "ClassSection"."id"
        WHERE "ClassSection"."session" = CAST(${session} AS "public"."Session")
          AND "Enrollment"."status" = 'ACTIVE'::"public"."EnrollmentStatus"
      `;

      // 3) Aggregate enrollment information by student
      const byStudent = new Map<string, Agg>();

      for (const row of joined) {
        if (!row.studentid) continue;

        const entry: Agg = byStudent.get(row.studentid) ?? {
          days: new Set<string>(),
          starts: [],
          labels: {
            A: 0,
            B: 0,
          },
          byDay: new Map<string, string>(),
        };

        if (row.day) {
          entry.days.add(row.day.trim());
        }

        if (row.label === 'A' || row.label === 'B') {
          entry.labels[row.label] += 1;
        }

        if (
          row.startdate instanceof Date &&
          !Number.isNaN(row.startdate.getTime())
        ) {
          const timestamp = row.startdate.getTime();
          entry.starts.push(timestamp);

          if (row.day) {
            const day = row.day.trim();
            const iso = row.startdate.toISOString();
            const existing = entry.byDay.get(day);

            if (!existing || timestamp < new Date(existing).getTime()) {
              entry.byDay.set(day, iso);
            }
          }
        }

        byStudent.set(row.studentid, entry);
      }

      // 4) Build response used by the admin page
      const data: AdminStudentDTO[] = students.map((student) => {
        const agg = byStudent.get(student.id);

        // Prefer actual enrollment days.
        // Fall back to Student.selectedDays for older records.
        const fromEnrollments = agg
          ? Array.from(agg.days)
          : undefined;

        const selectedDays = (
          fromEnrollments ?? student.selectedDays ?? []
        )
          .slice()
          .sort(
            (a, b) =>
              (DAY_ORDER[a] ?? 99) -
              (DAY_ORDER[b] ?? 99)
          );

        // Determine A/B group from actual enrolled sections.
        let sessionLabel: SessionKey | null = null;

        if (agg) {
          if (agg.labels.A > 0 || agg.labels.B > 0) {
            sessionLabel =
              agg.labels.A >= agg.labels.B ? 'A' : 'B';
          }
        }

        // Earliest enrolled section start date.
        // Fall back to Student.startDate.
        const earliestTs =
          agg && agg.starts.length > 0
            ? Math.min(...agg.starts)
            : student.startDate.getTime();

        // Start date for each enrolled day.
        const startDatesByDay: Partial<
          Record<DayKey, string>
        > = {};

        if (agg) {
          for (const [day, iso] of agg.byDay.entries()) {
            if (isDayKey(day)) {
              startDatesByDay[day] = iso;
            }
          }
        }

        const frequency: Frequency =
          selectedDays.length >= 2
            ? 'TWICE_A_WEEK'
            : 'ONCE_A_WEEK';

        return {
          id: student.id,
          studentName: student.studentName,
          age: student.age,

          parentName: student.parentName,
          phone: student.phone,
          email: student.email,

          city: student.city,
          school: student.school,
          classroom: student.classroom,

          frequency,
          selectedDays,

          startDate: new Date(earliestTs).toISOString(),
          sessionLabel,
          startDatesByDay,

          paymentStatus: student.paymentStatus,
          paymentMethod: student.paymentMethod,

          liabilityAccepted: student.liabilityAccepted,
          waiverName: student.waiverName,
          waiverAddress: student.waiverAddress,
        };
      });

      return res.status(200).json(data);
    }

    // =====================================================
    // PUT
    // =====================================================

    if (req.method === 'PUT') {
      const body = req.body as Partial<UpdatePayload> & {
        id?: string;
      };

      const { id } = body;

      if (!id) {
        return res.status(400).json({
          error: 'Missing id',
        });
      }

      const patch: UpdatePayload = {};

      if (typeof body.paymentStatus === 'string') {
        patch.paymentStatus = body.paymentStatus;
      }

      if (typeof body.paymentMethod !== 'undefined') {
        patch.paymentMethod = body.paymentMethod;
      }

      await prisma.student.update({
        where: {
          id,
        },
        data: patch,
      });

      return res.status(200).json({
        ok: true,
      });
    }

    // =====================================================
    // Unsupported method
    // =====================================================

    res.setHeader('Allow', ['GET', 'PUT']);

    return res.status(405).json({
      error: 'Method not allowed',
    });
  } catch (err: unknown) {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Unknown error';

    console.error('GET/PUT /api/admin/students error:', err);

    return res.status(500).json({
      error: 'Server error',
      detail,
    });
  }
}
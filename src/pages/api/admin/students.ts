// src/pages/api/admin/students.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';

// ----------------- Local types -----------------
type LocationKey = 'KATY' | 'SUGARLAND';
type SessionKey = 'A' | 'B';
type DayKey = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';
type Frequency = 'ONCE_A_WEEK' | 'TWICE_A_WEEK';




interface StudentRow {
  id: string;
  studentName: string;
  age: number;
  parentName: string;
  phone: string;
  email: string;
  location: LocationKey;
  frequency: Frequency;
  selectedDays: string[];    // Prisma schema says String[]
  startDate: Date;           // Prisma returns Date
  paymentStatus: PaymentStatus;
  paymentMethod: string | null;
  liabilityAccepted: boolean;
  waiverName: string | null;
  waiverAddress: string | null;
}

type AdminStudentDTO = {
  id: string;
  studentName: string;
  age: number;
  parentName: string;
  phone: string;
  email: string;
  location: LocationKey;
  frequency: Frequency;
  selectedDays: string[];
  startDate: string; // ISO
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
  label: 'A' | 'B' | null;
  startdate: Date | null;
};

type Agg = {
  days: Set<string>;
  starts: number[];                        // epoch ms
  labels: Record<SessionKey, number>;      // counts for A/B
  byDay: Map<string, string>;              // day -> earliest ISO
};

type UpdatePayload = {
  paymentStatus?: PaymentStatus;
  paymentMethod?: string | null;
};

// For consistent day sorting
const DAY_ORDER: Record<string, number> = {
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
};

function isDayKey(x: string): x is DayKey {
  return x === 'Monday' || x === 'Tuesday' || x === 'Wednesday' || x === 'Thursday';
}

// ----------------- Handler -----------------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      // 1) Base students
      const students = await prisma.student.findMany({
        where: {
          session: 'SPRING_2026',
        },
        orderBy: { studentName: 'asc' },
      }) as unknown as StudentRow[];


      // 2) Enrollment -> ClassSection (real column names: sectionId, studentId)
      const joined = await prisma.$queryRaw<JoinedRow[]>`
        SELECT
          "Enrollment"."studentId"   AS studentid,
          "ClassSection"."day"       AS day,
          "ClassSection"."label"     AS label,
          "ClassSection"."startDate" AS startdate
        FROM "Enrollment"
        JOIN "ClassSection"
          ON "Enrollment"."sectionId" = "ClassSection"."id"
        WHERE "ClassSection"."session" = 'SPRING_2026'
      `;



      // 3) Aggregate by student
      const byStudent = new Map<string, Agg>();

      for (const r of joined) {
        if (!r.studentid) continue;

        const entry: Agg = byStudent.get(r.studentid) ?? {
          days: new Set<string>(),
          starts: [],
          labels: { A: 0, B: 0 },
          byDay: new Map<string, string>(),
        };

        if (r.day) entry.days.add(r.day.trim());

        if (r.label === 'A' || r.label === 'B') {
          const label = r.label as SessionKey;
          entry.labels[label] += 1;
        }




        if (r.startdate instanceof Date && !Number.isNaN(r.startdate.getTime())) {
          const t = r.startdate.getTime();
          entry.starts.push(t);

          if (r.day) {
            const iso = r.startdate.toISOString();
            const existing = entry.byDay.get(r.day);
            if (!existing || new Date(iso) < new Date(existing)) {
              entry.byDay.set(r.day, iso);
            }
          }
        }

        byStudent.set(r.studentid, entry);
      }

      // 4) Compose DTOs
      const data: AdminStudentDTO[] = students.map((s) => {
        const agg = byStudent.get(s.id);

        // Selected days: prefer enrollments; fallback to Student.selectedDays
        // Selected days: prefer enrollments; fallback to Student.selectedDays
const fromEnrollments = agg ? Array.from(agg.days) : undefined;
const selectedDays = (fromEnrollments ?? s.selectedDays ?? []).slice().sort(
  (a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99)
);


        // Session label (most frequent across sections)
        let sessionLabel: SessionKey | null = null;
        if (agg) {
          sessionLabel = agg.labels.A >= agg.labels.B ? (agg.labels.A ? 'A' : null) : 'B';
        }

        // Earliest start across enrolled sections; fallback to student's startDate
        const earliestTs = (agg && agg.starts.length > 0)
          ? Math.min(...agg.starts)
          : s.startDate.getTime();

        // Per-day starts
        const startDatesByDay: Partial<Record<DayKey, string>> = {};
        if (agg) {
          for (const [d, iso] of agg.byDay.entries()) {
            if (isDayKey(d)) startDatesByDay[d] = iso;
          }
        }

        const frequency: Frequency =
          selectedDays.length >= 2 ? 'TWICE_A_WEEK' : 'ONCE_A_WEEK';

        return {
          id: s.id,
          studentName: s.studentName,
          age: s.age,
          parentName: s.parentName,
          phone: s.phone,
          email: s.email,
          location: s.location,
          frequency,
          selectedDays,
          startDate: new Date(earliestTs).toISOString(),
          sessionLabel,
          startDatesByDay,
          paymentStatus: s.paymentStatus,
          paymentMethod: s.paymentMethod,
          liabilityAccepted: s.liabilityAccepted,
          waiverName: s.waiverName,
          waiverAddress: s.waiverAddress,
        };
      });

      return res.status(200).json(data);
    }

    if (req.method === 'PUT') {
      // Typed body without `any`
      const body = req.body as Partial<UpdatePayload> & { id?: string };
      const { id } = body;
      if (!id) {
        return res.status(400).json({ error: 'Missing id' });
      }

      const patch: Record<string, unknown> = {};
      if (typeof body.paymentStatus === 'string') patch.paymentStatus = body.paymentStatus;
      if (typeof body.paymentMethod !== 'undefined') patch.paymentMethod = body.paymentMethod;

      await prisma.student.update({ where: { id }, data: patch });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    const detail =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
    console.error(err);
    return res.status(500).json({ error: 'Server error', detail });
  }
}

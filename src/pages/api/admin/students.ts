// src/pages/api/admin/students.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';

type LocationKey = 'KATY' | 'SUGARLAND';
type SessionKey = 'A' | 'B';
type DayKey = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday';

type AdminStudentDTO = {
  id: string;
  studentName: string;
  age: number;
  parentName: string;
  phone: string;
  email: string;
  location: LocationKey;
  frequency: 'ONCE_A_WEEK' | 'TWICE_A_WEEK';
  selectedDays: string[];                 // derived from enrollments if present; falls back to Student.selectedDays
  startDate: string;                      // earliest start (ISO)
  sessionLabel?: SessionKey | null;       // A/B derived from ClassSection.label
  startDatesByDay?: Partial<Record<DayKey, string>>; // per-day start ISOs from the actual sections
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED';
  paymentMethod?: string | null;
  liabilityAccepted?: boolean;
  waiverName?: string | null;
  waiverAddress?: string | null;
};

// Day sort order for display / stable behavior
const DAY_ORDER: Record<string, number> = {
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
};

// Rows returned from the raw join
type JoinedRow = {
  studentid: string;
  day: string | null;
  label: SessionKey | null;
  startdate: Date | null;
};

// Aggregation bucket (strongly typed to avoid any/never issues)
type Agg = {
  days: Set<string>;
  starts: number[];                            // epoch ms
  labels: Record<SessionKey, number>;          // count labels A/B
  byDay: Map<string, string>;                  // day -> earliest ISO
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      // 1) Base students (no schema changes)
      const students = await prisma.student.findMany({
        orderBy: { studentName: 'asc' },
      });

      // 2) Enrollment → ClassSection join using your actual column names
      const joined = await prisma.$queryRaw<JoinedRow[]>`
        SELECT
          "Enrollment"."studentId"    AS studentid,
          "ClassSection"."day"        AS day,
          "ClassSection"."label"      AS label,
          "ClassSection"."startDate"  AS startdate
        FROM "Enrollment"
        JOIN "ClassSection"
          ON "Enrollment"."sectionId" = "ClassSection"."id"
      `;

      // 3) Build index studentId -> Agg
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

        if (r.label) {
          // count A/B occurrences
          entry.labels[r.label] = (entry.labels[r.label] ?? 0) + 1;
        }

        if (r.startdate instanceof Date && !isNaN(r.startdate.getTime())) {
          entry.starts.push(r.startdate.getTime());

          if (r.day) {
            const iso = r.startdate.toISOString();
            const existing = entry.byDay.get(r.day);
            if (!existing || new Date(iso) < new Date(existing)) {
              entry.byDay.set(r.day, iso); // keep earliest per-day
            }
          }
        }

        byStudent.set(r.studentid, entry);
      }

      // 4) Compose DTO for the Admin UI
      const data: AdminStudentDTO[] = students.map((s) => {
        const agg = byStudent.get(s.id);

        // selected days (prefer enrollments; fall back to Student.selectedDays)
        let selectedDays: string[] = agg
          ? Array.from(agg.days)
          : Array.isArray((s as any).selectedDays)
          ? (s as any).selectedDays
          : [];

        selectedDays = selectedDays.sort(
          (a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99)
        );

        // session label from the most frequent label among the student's sections
        let sessionLabel: SessionKey | null = null;
        if (agg) {
          sessionLabel = agg.labels.A >= agg.labels.B ? (agg.labels.A ? 'A' : null) : 'B';
        }

        // earliest start across enrolled sections; fallback to Student.startDate
        const earliestTs = agg?.starts?.length
          ? Math.min(...agg.starts)
          : new Date(s.startDate).getTime();

        // per-day start dates map (from enrollments)
        const startDatesByDay: AdminStudentDTO['startDatesByDay'] = {};
        if (agg) {
          for (const [d, iso] of agg.byDay.entries()) {
            // Narrow day keys we care about; keep others untouched if any
            if (['Monday', 'Tuesday', 'Wednesday', 'Thursday'].includes(d)) {
              (startDatesByDay as any)[d] = iso;
            }
          }
        }

        const frequency: AdminStudentDTO['frequency'] =
          selectedDays.length >= 2 ? 'TWICE_A_WEEK' : 'ONCE_A_WEEK';

        return {
          id: s.id,
          studentName: s.studentName,
          age: s.age,
          parentName: s.parentName,
          phone: s.phone,
          email: s.email,
          location: s.location as LocationKey,
          frequency,
          selectedDays,
          startDate: new Date(earliestTs).toISOString(), // keep ISO; UI renders via local-date helper
          sessionLabel,
          startDatesByDay,
          paymentStatus: s.paymentStatus as AdminStudentDTO['paymentStatus'],
          paymentMethod: s.paymentMethod ?? null,
          liabilityAccepted: !!s.liabilityAccepted,
          waiverName: s.waiverName ?? null,
          waiverAddress: s.waiverAddress ?? null,
        };
      });

      return res.status(200).json(data);
    }

    if (req.method === 'PUT') {
      // Partial update (status / method). Extend here if you want to allow notes etc.
      const { id, paymentStatus, paymentMethod } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const patch: Record<string, any> = {};
      if (paymentStatus) patch.paymentStatus = paymentStatus;
      if (paymentMethod !== undefined) patch.paymentMethod = paymentMethod;

      await prisma.student.update({ where: { id }, data: patch });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: 'Server error', detail: String(err?.message ?? err) });
  }
}

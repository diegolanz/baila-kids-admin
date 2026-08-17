import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type CityKey = 'HOUSTON' | 'DALLAS';

type SchoolKey =
  | 'KATY'
  | 'SUGARLAND'
  | 'ALLEN'
  | 'FRISCO'
  | 'CASTLE_HILLS'
  | 'NORTH_DALLAS'
  | 'PRESTON_TRAIL';

type DayKey = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
type SessionKey = 'A' | 'B';
type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';
type Frequency = 'ONCE_A_WEEK' | 'TWICE_A_WEEK';

type Student = {
  id: string;
  studentName: string;
  age: number | null;
  classroom?: string | null;
  parentName: string;
  phone: string;
  email: string;
  city: CityKey;
  school: SchoolKey;
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

type SectionMeta = {
  id: string;
  city: CityKey;
  school: SchoolKey;
  day: DayKey;
  label: SessionKey;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  capacity: number;
  enrolled: number;
  isFull: boolean;
  priceCents: number;
  bundlePriceCents?: number | null;
  eligibleClasses?: string[];
};

type WaitlistEntry = {
  id: string;
  studentName: string;
  age: number | null;
  classroom?: string | null;
  parentName: string;
  phone: string;
  email: string;
  city: CityKey;
  school: SchoolKey;
  requestedDay: DayKey;
  notes?: string | null;
  createdAt: string;
};

type SessionValue =
  | 'FALL_2026'
  | 'SPRING_2026'
  | 'FALL_2025'
  | 'SPRING_2025'
  | 'FALL_2024';

const SCHOOL_LABELS: Record<SchoolKey, string> = {
  SUGARLAND: 'Sugar Land',
  KATY: 'Katy',
  ALLEN: 'Allen',
  FRISCO: 'Frisco',
  CASTLE_HILLS: 'Castle Hills',
  NORTH_DALLAS: 'North Dallas',
  PRESTON_TRAIL: 'Preston Trail',
};

const CITY_LABELS: Record<CityKey, string> = {
  HOUSTON: 'Houston',
  DALLAS: 'Dallas',
};

const SCHOOL_ORDER: SchoolKey[] = [
  'SUGARLAND',
  'KATY',
  'ALLEN',
  'FRISCO',
  'CASTLE_HILLS',
  'NORTH_DALLAS',
  'PRESTON_TRAIL',
];

const DAY_ORDER: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
};

const SESSION_LABELS: Record<SessionValue, string> = {
  FALL_2026: 'Fall 2026',
  SPRING_2026: 'Spring 2026',
  FALL_2025: 'Fall 2025',
  SPRING_2025: 'Spring 2025',
  FALL_2024: 'Fall 2024',
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);

const unique = <T,>(values: T[]) => Array.from(new Set(values));

function parseLocalISO(value: string) {
  const dateOnly = value.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function formatDatePretty(iso?: string | null) {
  if (!iso) return '—';
  const date = parseLocalISO(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function chooseStartDateIso(student: Student) {
  const fromDays =
    student.startDatesByDay && student.selectedDays.length
      ? student.selectedDays
          .map(day => student.startDatesByDay?.[day as DayKey])
          .filter(Boolean) as string[]
      : [];

  if (fromDays.length) return [...fromDays].sort()[0];
  return student.startDate;
}

function studentGroup(student: Student) {
  return student.sessionLabel ? `Group ${student.sessionLabel}` : 'Group —';
}

function studentDays(student: Student) {
  return student.selectedDays?.length ? student.selectedDays.join(' & ') : '—';
}

function matchingSections(student: Student, sections: SectionMeta[]) {
  return sections.filter(
    section =>
      section.city === student.city &&
      section.school === student.school &&
      student.selectedDays.includes(section.day) &&
      (!student.sessionLabel || section.label === student.sessionLabel),
  );
}

function tuitionCentsFor(student: Student, sections: SectionMeta[]) {
  const matches = matchingSections(student, sections);

  if (student.frequency === 'TWICE_A_WEEK') {
    const bundle = matches.find(section => section.bundlePriceCents != null)
      ?.bundlePriceCents;
    if (bundle != null) return bundle;
  }

  if (matches.length) {
    const byDay = new Map<string, SectionMeta>();
    for (const section of matches) {
      if (!byDay.has(section.day)) byDay.set(section.day, section);
    }
    return Array.from(byDay.values()).reduce(
      (total, section) => total + section.priceCents,
      0,
    );
  }

  return 0;
}

function owedCentsFor(student: Student, sections: SectionMeta[]) {
  return student.paymentStatus === 'PAID'
    ? 0
    : tuitionCentsFor(student, sections);
}

function launchBcc(emails: string[]) {
  const deduped = unique(emails.map(email => email.trim()).filter(Boolean));
  if (!deduped.length) return;
  window.location.href = `mailto:?bcc=${encodeURIComponent(deduped.join(','))}`;
}

function exportRosterPDF(title: string, students: Student[]) {
  if (!students.length) return;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(`Baila Kids – ${title}`, 40, 46);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${students.length} students`, 40, 64);

  autoTable(doc, {
    startY: 86,
    head: [['Student', 'Class', 'Group', 'Days', 'Parent']],
    body: [...students]
      .sort((a, b) => a.studentName.localeCompare(b.studentName))
      .map(student => [
        student.studentName,
        student.classroom ?? '—',
        student.sessionLabel ?? '—',
        studentDays(student),
        student.parentName,
      ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { halign: 'left' },
    theme: 'grid',
  });

  doc.save(
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-roster.pdf`,
  );
}

type StudentCardProps = {
  student: Student;
  sections: SectionMeta[];
  onStatusUpdate: (id: string, status: PaymentStatus) => Promise<void>;
  forceOpen?: boolean;
};

function StudentCard({
  student,
  sections,
  onStatusUpdate,
  forceOpen = false,
}: StudentCardProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PaymentStatus>(student.paymentStatus);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(student.paymentStatus);
  }, [student.paymentStatus]);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const tuition = tuitionCentsFor(student, sections);
  const owed = owedCentsFor(student, sections);

  const saveStatus = async () => {
    setSaving(true);
    try {
      await onStatusUpdate(student.id, status);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      id={`student-${student.id}`}
      className={`student-row ${open ? 'student-row--open' : ''}`}
    >
      <button
        type="button"
        className="student-row__summary"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
      >
        <div className="student-row__main">
          <div className="student-row__name">{student.studentName}</div>
          <div className="student-row__meta">
            <span>{student.classroom || 'Class not selected'}</span>
            <span>•</span>
            <span>{studentGroup(student)}</span>
            <span>•</span>
            <span>{studentDays(student)}</span>
          </div>
        </div>

        <div className="student-row__right">
          <div className={owed > 0 ? 'owed owed--due' : 'owed owed--paid'}>
            {owed > 0 ? `Payment due: ${money(owed)}` : 'Paid in full'}
          </div>
          <span className="chevron">{open ? '−' : '+'}</span>
        </div>
      </button>

      {open && (
        <div className="student-detail">
          <div className="detail-grid">
            <div>
              <span className="detail-label">Parent or guardian</span>
              <strong>{student.parentName}</strong>
            </div>
            <div>
              <span className="detail-label">Phone</span>
              <a href={`tel:${student.phone}`}>{student.phone}</a>
            </div>
            <div>
              <span className="detail-label">Email</span>
              <a href={`mailto:${student.email}`}>{student.email}</a>
            </div>
            <div>
              <span className="detail-label">Class</span>
              <strong>{student.classroom || '—'}</strong>
            </div>
            <div>
              <span className="detail-label">Schedule</span>
              <strong>
                {studentDays(student)} · {studentGroup(student)}
              </strong>
            </div>
            <div>
              <span className="detail-label">First class date</span>
              <strong>{formatDatePretty(chooseStartDateIso(student))}</strong>
            </div>
            <div>
              <span className="detail-label">Total tuition</span>
              <strong>{tuition ? money(tuition) : '—'}</strong>
            </div>
            <div>
              <span className="detail-label">How they will pay</span>
              <strong>{student.paymentMethod || '—'}</strong>
            </div>
            {student.age != null && (
              <div>
                <span className="detail-label">Age (older registration)</span>
                <strong>{student.age}</strong>
              </div>
            )}
          </div>

          <div className="payment-editor">
            <label htmlFor={`payment-${student.id}`}>Payment status</label>
            <select
              id={`payment-${student.id}`}
              value={status}
              onChange={event => setStatus(event.target.value as PaymentStatus)}
            >
              <option value="PENDING">Needs payment</option>
              <option value="PAID">Paid</option>
              <option value="FAILED">Payment issue</option>
            </select>
            <button
              type="button"
              className="primary-btn primary-btn--small"
              disabled={saving || status === student.paymentStatus}
              onClick={saveStatus}
            >
              {saving ? 'Saving…' : 'Save payment'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

type LocationPanelProps = {
  school: SchoolKey;
  students: Student[];
  sections: SectionMeta[];
  onStatusUpdate: (id: string, status: PaymentStatus) => Promise<void>;
  selectedStudentId?: string | null;
};

function LocationPanel({
  school,
  students,
  sections,
  onStatusUpdate,
  selectedStudentId = null,
}: LocationPanelProps) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (selectedStudentId && students.some(student => student.id === selectedStudentId)) {
      setOpen(true);
      setFilter('');
    }
  }, [selectedStudentId, students]);

  const locationSections = sections.filter(section => section.school === school);

  const sortedStudents = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return [...students]
      .filter(student => {
        if (!term) return true;
        return (
          student.studentName.toLowerCase().includes(term) ||
          student.parentName.toLowerCase().includes(term) ||
          student.email.toLowerCase().includes(term) ||
          (student.classroom ?? '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [students, filter]);

  const registrationCount = students.reduce(
    (total, student) => total + Math.max(student.selectedDays.length, 1),
    0,
  );
  const collected = students.reduce(
    (total, student) =>
      total +
      (student.paymentStatus === 'PAID'
        ? tuitionCentsFor(student, sections)
        : 0),
    0,
  );
  const outstanding = students.reduce(
    (total, student) => total + owedCentsFor(student, sections),
    0,
  );

  const groups = unique(
    locationSections
      .map(section => section.label)
      .filter((label): label is SessionKey => label === 'A' || label === 'B'),
  );

  return (
    <section className="location-panel">
      <div className="location-panel__top">
        <button
          type="button"
          className="location-title-btn"
          onClick={() => setOpen(value => !value)}
        >
          <div>
            <div className="location-kicker">
              {students[0] ? CITY_LABELS[students[0].city] : ''}
            </div>
            <h2>{SCHOOL_LABELS[school]}</h2>
          </div>
          <span className="location-toggle">{open ? '−' : '+'}</span>
        </button>

        <div className="location-numbers">
          <div>
            <span>Kids registered</span>
            <strong>{students.length}</strong>
          </div>
          <div>
            <span>Class registrations</span>
            <strong>{registrationCount}</strong>
          </div>
          <div className="location-money">
            <span>Payments received</span>
            <strong>{money(collected)}</strong>
          </div>
          <div className={outstanding ? 'location-money location-money--due' : 'location-money'}>
            <span>Payments due</span>
            <strong>{money(outstanding)}</strong>
          </div>
        </div>
      </div>

      {open && (
        <div className="location-panel__body">
          <div className="location-toolbar">
            <input
              type="search"
              placeholder={`Search kids at ${SCHOOL_LABELS[school]}…`}
              value={filter}
              onChange={event => setFilter(event.target.value)}
            />
            <div className="toolbar-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => launchBcc(students.map(student => student.email))}
                disabled={!students.length}
              >
                Email all
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() =>
                  exportRosterPDF(SCHOOL_LABELS[school], students)
                }
                disabled={!students.length}
              >
                PDF roster
              </button>
            </div>
          </div>

          {groups.length > 0 && (
            <div className="section-capacity-strip">
              {locationSections
                .slice()
                .sort(
                  (a, b) =>
                    DAY_ORDER[a.day] - DAY_ORDER[b.day] ||
                    a.label.localeCompare(b.label),
                )
                .map(section => (
                  <div className="capacity-chip" key={section.id}>
                    <span>
                      {section.day} · {section.label}
                    </span>
                    <strong>
                      {section.enrolled} of {section.capacity} kids
                    </strong>
                  </div>
                ))}
            </div>
          )}

          <div className="student-list">
            {sortedStudents.map(student => (
              <StudentCard
                key={student.id}
                student={student}
                sections={sections}
                onStatusUpdate={onStatusUpdate}
                forceOpen={student.id === selectedStudentId}
              />
            ))}

            {!sortedStudents.length && (
              <div className="empty-state">
                {students.length
                  ? 'No kids match this search.'
                  : 'No kids are registered at this school yet.'}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function WaitlistPanel({ entries }: { entries: WaitlistEntry[] }) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<SchoolKey, WaitlistEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.school) ?? [];
      list.push(entry);
      map.set(entry.school, list);
    }
    return map;
  }, [entries]);

  return (
    <section className="simple-panel">
      <button
        type="button"
        className="simple-panel__header"
        onClick={() => setOpen(value => !value)}
      >
        <span>
          Waiting list <b>{entries.length}</b>
        </span>
        <span>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="simple-panel__body">
          {!entries.length && <div className="empty-state">No one is on the waiting list.</div>}

          {SCHOOL_ORDER.map(school => {
            const schoolEntries = grouped.get(school) ?? [];
            if (!schoolEntries.length) return null;

            return (
              <div className="waitlist-group" key={school}>
                <div className="waitlist-group__title">
                  {SCHOOL_LABELS[school]} <span>{schoolEntries.length}</span>
                </div>
                {schoolEntries.map(entry => (
                  <div className="waitlist-entry" key={entry.id}>
                    <div>
                      <strong>{entry.studentName}</strong>
                      <span>
                        {entry.classroom ? `${entry.classroom} · ` : ''}
                        {entry.requestedDay}
                      </span>
                    </div>
                    <a href={`mailto:${entry.email}`}>Email</a>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState<SessionValue>('FALL_2026');
  const [students, setStudents] = useState<Student[]>([]);
  const [sections, setSections] = useState<SectionMeta[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSearchFocused, setGlobalSearchFocused] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const goToStudent = (student: Student) => {
    setSelectedStudentId(student.id);
    setGlobalSearch('');
    setGlobalSearchFocused(false);

    window.setTimeout(() => {
      document.getElementById(`student-${student.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 100);
  };

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const [studentsResponse, sectionsResponse, waitlistResponse] =
        await Promise.all([
          axios.get<Student[]>(`/api/admin/students?session=${session}`),
          axios.get<SectionMeta[]>(`/api/admin/sections?session=${session}`),
          axios.get<WaitlistEntry[]>(`/api/admin/waitlist?session=${session}`),
        ]);

      setStudents(studentsResponse.data ?? []);
      setSections(sectionsResponse.data ?? []);
      setWaitlist(waitlistResponse.data ?? []);
    } catch (err) {
      console.error(err);
      setError('Could not load the registrations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [session]);

  const handleStatusUpdate = async (
    id: string,
    paymentStatus: PaymentStatus,
  ) => {
    await axios.put('/api/admin/students', { id, paymentStatus });
    setStudents(current =>
      current.map(student =>
        student.id === id ? { ...student, paymentStatus } : student,
      ),
    );
  };

  const searchResults = useMemo(() => {
    const term = globalSearch.trim().toLowerCase();
    if (!term) return [];

    return students
      .filter(student =>
        [student.studentName, student.parentName].some(value =>
          value.toLowerCase().includes(term),
        ),
      )
      .sort((a, b) => {
        const aStudentStarts = a.studentName.toLowerCase().startsWith(term);
        const bStudentStarts = b.studentName.toLowerCase().startsWith(term);
        if (aStudentStarts !== bStudentStarts) return aStudentStarts ? -1 : 1;

        const aParentStarts = a.parentName.toLowerCase().startsWith(term);
        const bParentStarts = b.parentName.toLowerCase().startsWith(term);
        if (aParentStarts !== bParentStarts) return aParentStarts ? -1 : 1;

        return a.studentName.localeCompare(b.studentName);
      })
      .slice(0, 10);
  }, [students, globalSearch]);

  const visibleSchools = useMemo(
    () =>
      SCHOOL_ORDER.filter(
        school =>
          sections.some(section => section.school === school) ||
          students.some(student => student.school === school),
      ),
    [sections, students],
  );

  const stats = useMemo(() => {
    const totalStudents = students.length;
    const totalRegistrations = students.reduce(
      (total, student) => total + Math.max(student.selectedDays.length, 1),
      0,
    );

    let collected = 0;
    let outstanding = 0;

    for (const student of students) {
      const tuition = tuitionCentsFor(student, sections);
      if (student.paymentStatus === 'PAID') collected += tuition;
      else outstanding += tuition;
    }

    return {
      totalStudents,
      totalRegistrations,
      collected,
      outstanding,
    };
  }, [students, sections]);

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <header className="admin-hero">
          <div>
            <span className="eyebrow">Baila Kids</span>
            <h1>Admin Dashboard</h1>
          </div>

          <div className="session-control">
            <label htmlFor="session">School term</label>
            <select
              id="session"
              value={session}
              onChange={event =>
                setSession(event.target.value as SessionValue)
              }
            >
              <option value="FALL_2026">Fall 2026</option>
              <option value="SPRING_2026">Spring 2026</option>
              <option value="FALL_2025">Fall 2025</option>
            </select>
          </div>
        </header>

        <section className="stats-grid" aria-label="Session totals">
          <div className="stat-card">
            <span>Kids registered</span>
            <strong>{stats.totalStudents}</strong>
            <small>{SESSION_LABELS[session]}</small>
          </div>
          <div className="stat-card">
            <span>Class registrations</span>
            <strong>{stats.totalRegistrations}</strong>
            <small>Across all locations</small>
          </div>
          <div className="stat-card stat-card--money">
            <span>Payments received</span>
            <strong>{money(stats.collected)}</strong>
            <small>Paid registrations</small>
          </div>
          <div className="stat-card stat-card--due">
            <span>Payments due</span>
            <strong>{money(stats.outstanding)}</strong>
            <small>Pending + failed</small>
          </div>
          <div className="stat-card">
            <span>Waiting list</span>
            <strong>{waitlist.length}</strong>
            <small>Waiting for a spot</small>
          </div>
        </section>

        <section className="admin-controls">
          <div className="search-area">
            <div className="search-box">
              <span aria-hidden="true">⌕</span>

              <input
                type="search"
                placeholder="Search by child or parent name…"
                value={globalSearch}
                onChange={event => setGlobalSearch(event.target.value)}
                onFocus={() => setGlobalSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setGlobalSearchFocused(false), 150);
                }}
                autoComplete="off"
              />

              {globalSearch && (
                <button
                  type="button"
                  onClick={() => setGlobalSearch('')}
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>

            {globalSearchFocused && globalSearch.trim() && (
              <div className="search-results" role="listbox">
                {searchResults.length ? (
                  searchResults.map(student => (
                    <button
                      key={student.id}
                      type="button"
                      className="search-result"
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => goToStudent(student)}
                    >
                      <span className="search-result__name">
                        {student.studentName}
                      </span>

                      <span className="search-result__details">
                        {SCHOOL_LABELS[student.school]}
                        {student.classroom
                          ? ` · ${student.classroom}`
                          : ''}
                        {` · Parent: ${student.parentName}`}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="search-results__empty">
                    No kids found.
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="secondary-btn refresh-btn"
            onClick={() => void loadData()}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh page'}
          </button>
        </section>

        {error && <div className="error-banner">{error}</div>}

        {loading && !students.length ? (
          <div className="loading-card">Loading registrations…</div>
        ) : (
          <div className="locations-stack">
            {visibleSchools.map(school => (
              <LocationPanel
                key={school}
                school={school}
                students={students.filter(
                  student => student.school === school,
                )}
                sections={sections}
                onStatusUpdate={handleStatusUpdate}
                selectedStudentId={selectedStudentId}
              />
            ))}

            {!visibleSchools.length && (
              <div className="loading-card">No kids found.</div>
            )}
          </div>
        )}

        <WaitlistPanel entries={waitlist} />
      </div>
    </main>
  );
}
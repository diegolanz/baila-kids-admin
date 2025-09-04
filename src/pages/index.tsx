import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// import { FaEnvelope } from 'react-icons/fa';

interface Student {
  id: string;
  studentName: string;
  age: number;
  parentName: string;
  phone: string;
  email: string;
  location: 'KATY' | 'SUGARLAND';
  frequency: 'ONCE_A_WEEK' | 'TWICE_A_WEEK';
  selectedDays: string[];
  startDate: string;

  // NEW FIELDS from API
  sessionLabel?: 'A' | 'B' | null;
  startDatesByDay?: Partial<Record<'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday', string>>;

  paymentStatus: 'PENDING' | 'PAID' | 'FAILED';
  paymentMethod?: string | null;
  liabilityAccepted?: boolean;
  waiverName?: string | null;
  waiverAddress?: string | null;
}



function formatDatePretty(iso: string) {
  if (!iso) return '';
  // Use only the date part and parse as *local* calendar date
  const [dateOnly] = iso.split('T');
  const d = dateOnly ? parseLocalISO(dateOnly) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}





function chooseStartDateIso(s: Student): string {
  // prefer per-day start dates from the correct session
  const fromDays = (s.startDatesByDay && s.selectedDays?.length)
    ? s.selectedDays.map(d => s.startDatesByDay?.[d as DayKey]).filter(Boolean) as string[]
    : [];

  if (fromDays.length) {
    // ISO strings sort chronologically
    return [...fromDays].sort()[0];
  }

  return s.startDate;
}



interface WaitlistEntry {
  id: string;
  studentName: string;
  age: number;
  parentName: string;
  phone: string;
  email: string;
  location: 'KATY' | 'SUGARLAND';
  requestedDay: DayKey;
  notes?: string | null;
  createdAt: string;
}


type LocationKey = 'KATY' | 'SUGARLAND';
type SessionKey = 'A' | 'B';
type DayKey = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday';

// Section metadata used by the admin day/section editor
type SectionMeta = {
  id: string;
  location: LocationKey;
  day: DayKey;
  label: SessionKey;     // 'A' | 'B'
  isFull: boolean;       // true ⇒ SOLD OUT (disabled)
  startDate?: string;    // optional, if you expose it
};


// Only 'both' is required; per-day keys are optional
type PriceRow = { both: number } & Partial<Record<DayKey, number>>;
type PriceTable = Record<LocationKey, Record<SessionKey, PriceRow>>;


const prices: PriceTable = {
  KATY: {
    A: { Tuesday: 245, Wednesday: 245, both: 450 },
    B: { Tuesday: 245, Wednesday: 245, both: 450 },
  },
  SUGARLAND: {
    A: { Monday: 230, Thursday: 245, both: 450 },
    B: { Monday: 195, Thursday: 195, both: 380 }, // adjust if your B prices differ
  },
};



const calculateOwed = (s: Student) => {
  if (s.paymentStatus === 'PAID') return 0;
  const session: SessionKey = (s.sessionLabel ?? 'A') as SessionKey;
  const loc = s.location as LocationKey;

  if (s.frequency === 'ONCE_A_WEEK') {
    const day = (s.selectedDays?.[0] ?? 'Monday') as DayKey;
    return prices[loc][session][day] ?? 0;
  }
  return prices[loc][session].both;
};

const tuitionFor = (s: Student) => {
  const session: SessionKey = (s.sessionLabel ?? 'A') as SessionKey;
  const loc = s.location as LocationKey;

  if (s.frequency === 'ONCE_A_WEEK') {
    const day = (s.selectedDays?.[0] ?? 'Monday') as DayKey;
    return prices[loc][session][day] ?? 0;
  }
  return prices[loc][session].both;
};


import * as XLSX from 'xlsx';

type RosterStudent = {
  studentName: string;
  age: number | null;
  selectedDays?: string[] | null;
  startDate?: string | null; // e.g. "2025-08-26" or "2025-08-26T00:00:00.000Z"
};

// Map day name → JS getDay() index
const DOW: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

// Parse "YYYY-MM-DD" (or ISO with time) as a **local** date (no UTC shift)
// Parse a YYYY-MM-DD string as a *local* date (no UTC shift)
function parseLocalISO(dateOnly: string) {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}


// Return the same date or the next one that matches target weekday
const nextOrSameWeekday = (date: Date, targetDow: number) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (targetDow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
};

export function exportAttendanceXlsx(title: string, students: RosterStudent[]) {
  if (!students?.length) return;

  // Sort roster by age asc (unknown ages last)
  const rows = [...students].sort(
    (a, b) => (a.age ?? Number.POSITIVE_INFINITY) - (b.age ?? Number.POSITIVE_INFINITY)
  );

  // Determine target weekday from the table title (e.g., "Tuesday")
  const titleWord = title.trim().split(/\s+/)[0]; // "Tuesday" from "Tuesday"
  let targetDow = DOW[titleWord];

  // Fallback if title isn't a weekday: use first student's first selected day
  if (targetDow === undefined) {
    const firstDay = rows.find(s => (s.selectedDays?.length ?? 0) > 0)?.selectedDays![0] ?? 'Monday';
    targetDow = DOW[firstDay] ?? 1;
  }

  // Find earliest class date aligned to that weekday (per students' startDate)
  const candidateStarts = rows
    .map(s => s.startDate)
    .filter(Boolean)
    .map(iso => nextOrSameWeekday(parseLocalISO(String(iso)), targetDow))
    .sort((a, b) => a.getTime() - b.getTime());

  const first = candidateStarts[0] ?? nextOrSameWeekday(new Date(), targetDow);

  // Build 14 weekly dates on that weekday
  const WEEKS = 14;
  const sessionDates: Date[] = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i * 7);
    return d;
  });

  // Header labels like "Tue 8/26"
  const header = [
    'Student',
    ...sessionDates.map(d =>
      d.toLocaleDateString('en-US', {month: 'numeric', day: 'numeric' })
    ),
  ];

  // AoA: first column "Name (Age)", blank cells for checkmarks
  const aoa: (string | number)[][] = [
    header,
    ...rows.map(r => [r.age != null ? `${r.studentName} (${r.age})` : r.studentName, ...Array(WEEKS).fill('')]),
  ];
 
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, ...Array(WEEKS).fill({ wch: 10 })]; // widths
  ws['!freeze'] = { xSplit: 1, ySplit: 1 }; // freeze header + roster col

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (title || 'Roster').slice(0, 31));
  XLSX.writeFile(wb, `${title.toLowerCase().replace(/\s+/g, '-')}-attendance.xlsx`);
}



// function fmtDate(iso: string) {
//   const d = new Date(iso);
//   if (Number.isNaN(d.getTime())) return iso;
//   return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
// }

/**
 * Creates a single-page-or-multipage roster PDF for one day.
 * Expects the `students` param to already be filtered to that day (or we’ll show all given).
 */
function exportRosterPDF(title: string, students: Student[]) {
  const list = [...students].sort((a, b) => (a.age ?? 0) - (b.age ?? 0));
  if (list.length === 0) {
    alert(`No students found for ${title}.`);
    return;
  }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`Baila Kids – ${title} Roster`, 40, 48);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, 40, 64);
  doc.text(`Students: ${list.length}`, 40, 78);

  // Table: Name, Age, Days
  const head = [['Name', 'Age', 'Days']];
  const body = list.map((s) => [
    s.studentName ?? '',
    String(s.age ?? ''),
    (s.selectedDays ?? []).length ? (s.selectedDays ?? []).join(', ') : '—',
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 100,
    styles: { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
    headStyles: { halign: 'left' },
    bodyStyles: { halign: 'left' },
    columnStyles: {
      0: { cellWidth: 260 },              // Name
      1: { cellWidth: 40, halign: 'right' }, // Age
      2: { cellWidth: 210 },              // Days
    },
    theme: 'grid',
  });

  const now = new Date();
  const fname = `baila-${title.toLowerCase().replace(/\s+/g, '-')}-roster-${now
    .toISOString()
    .slice(0, 10)}.pdf`;
  doc.save(fname);
}









const StudentsTable: React.FC<{
  title: string;
  students: Student[];
  onStatusUpdate: (id: string, newStatus: Student['paymentStatus']) => Promise<void>;
  sections?: SectionMeta[];
  onMoveSection?: (id: string, day: DayKey, label: SessionKey) => Promise<void>;
}>
= ({ title, students, onStatusUpdate, sections = [], onMoveSection }) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [tableOpen, setTableOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<Record<string, Student['paymentStatus']>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const perPage = 5;
  const totalPages = Math.ceil(students.length / perPage);
  const paginated = students.slice(page * perPage, page * perPage + perPage);

  // helper to collapse student rows on open
  useEffect(() => {
    if (!tableOpen) return;
    setExpandedRows(new Set());
  }, [tableOpen]);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Temp selections while editing a student's day/section
  const [pendingMove, setPendingMove] = useState<Record<string, { day: DayKey; label: SessionKey }>>({});
  const [movingId, setMovingId] = useState<string | null>(null);

  // Allowed days by location, and available sections for (location, day)
  const dayOptionsFor = (loc: LocationKey): DayKey[] =>
    loc === 'KATY' ? ['Tuesday', 'Wednesday'] : ['Monday', 'Thursday'];

  const sectionsFor = (loc: LocationKey, day: DayKey) =>
    (sections || []).filter(s => s.location === loc && s.day === day);

  // --- Grouping logic for Section A/B (only if multiple sections present) ---
  const enableGrouping = React.useMemo(() => {
    const labels = new Set(students.map(s => s.sessionLabel ?? 'Unassigned'));
    return labels.size > 1; // group only if multiple labels exist in this table
  }, [students]);

  type SectionBucket = { label: string; items: Student[] };

  const groupedBySection: SectionBucket[] = React.useMemo(() => {
    const buckets: Record<string, Student[]> = {};
    for (const s of students) {
      const label = s.sessionLabel ?? 'Unassigned';
      if (!buckets[label]) buckets[label] = [];
      buckets[label].push(s);
    }
    Object.keys(buckets).forEach(k => {
      buckets[k] = buckets[k].sort((a, b) => a.studentName.localeCompare(b.studentName));
    });
    return Object.keys(buckets).map(k => ({ label: k, items: buckets[k] }));
  }, [students]);

  // --- Collapsible group headers ---
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string) =>
    setCollapsedGroups(prev => ({ ...prev, [label]: !prev[label] }));

  // collapse groups on open & whenever grouping changes
  useEffect(() => {
    if (!tableOpen || !enableGrouping) return;
    const next: Record<string, boolean> = {};
    for (const g of groupedBySection) next[g.label] = true; // true = collapsed
    setCollapsedGroups(next);
  }, [tableOpen, enableGrouping, groupedBySection]);

  // --- Header chips: counts per section (A/B/Unassigned) ---
  const countA = students.filter(s => s.sessionLabel === 'A').length;
  const countB = students.filter(s => s.sessionLabel === 'B').length;
  const countU = students.filter(s => !s.sessionLabel).length;

  // --- Mail helpers ---
  const launchBcc = (emails: string[]) => {
    // Safer encoding for large lists / special chars
    const bccValue = encodeURIComponent(emails.join(','));
    window.location.href = `mailto:?bcc=${bccValue}`;
  };

  const allEmails = React.useMemo(() => students.map(s => s.email).filter(Boolean), [students]);

  return (
    <section className="admin-section fade-in">
      <div className="admin-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <span className="badge">{students.length}</span>
          </div>

          {/* Group chips appear in the header when grouping is relevant */}
          {enableGrouping && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="chip">
                Group A <span className="badge">{countA}</span>
              </span>
              <span className="chip">
                Group B <span className="badge">{countB}</span>
              </span>
              {countU > 0 && (
                <span className="chip">
                  Unassigned <span className="badge">{countU}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {students.length > 0 && (
            <>
              {/* UPDATED: day-level Email all uses BCC + encoding */}
              <button
                className="toggle-btn"
                onClick={() => launchBcc(allEmails)}
                title="Email all (BCC)"
              >
                Email all
              </button>

              <button
                className="toggle-btn"
                onClick={() => exportRosterPDF(title, students)}
                title="Download printable roster PDF"
              >
                PDF
              </button>
            </>
          )}

          <button className="toggle-btn" onClick={() => setTableOpen(prev => !prev)}>
            {tableOpen ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {tableOpen && (
        <>
          {/* Desktop */}
          <div className="table-scroll desktop-only" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <table className="admin-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Payment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {/* Flat list when only one section is present (use pagination) */}
                {!enableGrouping && paginated.map(s => {
                  const expanded = expandedRows.has(s.id);
                  return (
                    <React.Fragment key={s.id}>
                      <tr onClick={() => toggleRow(s.id)} className="clickable-row">
                        <td>{s.studentName}</td>
                        <td>
                          <span className={`pill pill--${s.paymentStatus.toLowerCase()}`}>{s.paymentStatus}</span>
                        </td>
                        <td className="arrow">{expanded ? 'v' : '>'}</td>
                      </tr>
                      {expanded && (
                        <tr className="expanded-row">
                          <td colSpan={3}>
                            <div className="expanded-content">
                              <p><strong>Age:</strong> {s.age}</p>
                              <p><strong>Parent/Guardian:</strong> {s.parentName}</p>
                              <p><strong>Phone:</strong> {s.phone}</p>
                              <p>
                                <strong>Email:</strong> {s.email}
                                {/* individual email (single recipient) */}
                                <button
                                  className="toggle-btn"
                                  style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.location.href = `mailto:${s.email}`;
                                  }}
                                  title="Email this student"
                                >
                                  Email
                                </button>
                              </p>
                              <p><strong>Location:</strong> {s.location}</p>
                              <p><strong>Frequency:</strong> {s.frequency === 'ONCE_A_WEEK' ? 'Once' : 'Twice'}</p>
                              <p><strong>Day(s):</strong> {s.selectedDays.join(', ')}</p>
                              <p><strong>Session:</strong> {s.sessionLabel ?? '—'}</p>
                              <p><strong>Start Date:</strong> {formatDatePretty(chooseStartDateIso(s))}</p>
                              <p style={{ color: calculateOwed(s) === 0 ? 'green' : 'red' }}>
                                <strong>Owes:</strong> ${calculateOwed(s)}
                              </p>

                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <label htmlFor={`status-${s.id}`}>Payment Status:</label>
                                <select
                                  id={`status-${s.id}`}
                                  value={pendingStatus[s.id] ?? s.paymentStatus}
                                  onChange={(e) => setPendingStatus(prev => ({ ...prev, [s.id]: e.target.value as Student['paymentStatus'] }))}
                                >
                                  <option value="PENDING">PENDING</option>
                                  <option value="PAID">PAID</option>
                                  <option value="FAILED">FAILED</option>
                                </select>

                                <button
                                  onClick={async (ev) => {
                                    ev.stopPropagation();
                                    const newStatus = pendingStatus[s.id] ?? s.paymentStatus;
                                    setSavingId(s.id);
                                    try {
                                      await onStatusUpdate(s.id, newStatus);
                                      setPendingStatus(prev => {
                                        const next = { ...prev };
                                        delete next[s.id];
                                        return next;
                                      });
                                    } finally {
                                      setSavingId(null);
                                    }
                                  }}
                                  disabled={savingId === s.id}
                                >
                                  {savingId === s.id ? 'Saving…' : 'Save'}
                                </button>

                                <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0.75rem 0' }} />

                                {/* Section editor */}
                                <div className="section-editor">
                                  {/* Day selector */}
                                  <div className="section-field">
                                    <label className="section-label">Day</label>
                                    <select
                                      className="section-select"
                                      value={(pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey)}
                                      onChange={(e) => {
                                        const day = e.target.value as DayKey;
                                        const label = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                                        setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                                      }}
                                    >
                                      {dayOptionsFor(s.location as LocationKey).map(d => (
                                        <option key={d} value={d}>{d}</option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Section selector */}
                                  <div className="section-field">
                                    <label className="section-label">Section</label>
                                    {(() => {
                                      const chosenDay = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                                      const opts = sectionsFor(s.location as LocationKey, chosenDay);
                                      const currentLabel = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                                      return (
                                        <select
                                          className="section-select"
                                          value={currentLabel}
                                          onChange={(e) => {
                                            const label = e.target.value as SessionKey;
                                            const day = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                                            setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                                          }}
                                        >
                                          {(['A','B'] as SessionKey[]).map(label => {
                                            const meta = opts.find(o => o.label === label);
                                            const soldOut = !!meta?.isFull;
                                            return (
                                              <option key={label} value={label} disabled={soldOut}>
                                                {label}{soldOut ? ' — SOLD OUT' : ''}
                                              </option>
                                            );
                                          })}
                                        </select>
                                      );
                                    })()}
                                  </div>

                                  {/* Save */}
                                  <div className="section-actions">
                                    <button
                                      className="toggle-btn"
                                      disabled={!onMoveSection || movingId === s.id}
                                      onClick={async (ev) => {
                                        ev.stopPropagation();
                                        if (!onMoveSection) return;
                                        const choice = pendingMove[s.id] || {
                                          day: (s.selectedDays?.[0] as DayKey),
                                          label: ((s.sessionLabel ?? 'A') as SessionKey),
                                        };
                                        setMovingId(s.id);
                                        try {
                                          await onMoveSection(s.id, choice.day, choice.label);
                                          setPendingMove(prev => {
                                            const next = { ...prev };
                                            delete next[s.id];
                                            return next;
                                          });
                                        } finally {
                                          setMovingId(null);
                                        }
                                      }}
                                      title="Move student to the selected day/section"
                                    >
                                      {movingId === s.id ? 'Moving…' : 'Save Change'}
                                    </button>
                                  </div>
                                </div>
                                {/* /Section editor */}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Grouped list when multiple sections present (ignore pagination to keep groups intact) */}
                {enableGrouping && groupedBySection.map(group => {
                  const isCollapsed = !!collapsedGroups[group.label];
                  const groupEmails = group.items.map(g => g.email).filter(Boolean);
                  return (
                    <React.Fragment key={group.label}>
                      <tr
                        className="group-header clickable-row"
                        onClick={() => toggleGroup(group.label)}
                        style={{ background: '#f8fafc', cursor: 'pointer' }}
                      >
                        <td colSpan={3} style={{ fontWeight: 700 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>
                              <span style={{ marginRight: 8 }}>{isCollapsed ? '>' : 'v'}</span>
                              Section {group.label}
                              <span className="badge" style={{ marginLeft: 8 }}>{group.items.length}</span>
                            </span>
                            {/* NEW: Email this group (BCC) */}
                            <button
                              className="toggle-btn"
                              onClick={(e) => {
                                e.stopPropagation(); // don't toggle collapse
                                launchBcc(groupEmails);
                              }}
                              disabled={groupEmails.length === 0}
                              title={`Email Group ${group.label} (BCC)`}
                            >
                              Email group
                            </button>
                          </div>
                        </td>
                      </tr>

                      {!isCollapsed && group.items.map(s => {
                        const expanded = expandedRows.has(s.id);
                        return (
                          <React.Fragment key={s.id}>
                            <tr onClick={() => toggleRow(s.id)} className="clickable-row">
                              <td>{s.studentName}</td>
                              <td>
                                <span className={`pill pill--${s.paymentStatus.toLowerCase()}`}>{s.paymentStatus}</span>
                              </td>
                              <td className="arrow">{expanded ? 'v' : '>'}</td>
                            </tr>
                            {expanded && (
                              <tr className="expanded-row">
                                <td colSpan={3}>
                                  <div className="expanded-content">
                                    <p><strong>Age:</strong> {s.age}</p>
                                    <p><strong>Parent/Guardian:</strong> {s.parentName}</p>
                                    <p><strong>Phone:</strong> {s.phone}</p>
                                    <p>
                                      <strong>Email:</strong> {s.email}
                                      {/* single-recipient email */}
                                      <button
                                        className="toggle-btn"
                                        style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.location.href = `mailto:${s.email}`;
                                        }}
                                        title="Email this student"
                                      >
                                        Email
                                      </button>
                                    </p>
                                    <p><strong>Location:</strong> {s.location}</p>
                                    <p><strong>Frequency:</strong> {s.frequency === 'ONCE_A_WEEK' ? 'Once' : 'Twice'}</p>
                                    <p><strong>Day(s):</strong> {s.selectedDays.join(', ')}</p>
                                    <p><strong>Session:</strong> {s.sessionLabel ?? '—'}</p>
                                    <p><strong>Start Date:</strong> {formatDatePretty(chooseStartDateIso(s))}</p>
                                    <p style={{ color: calculateOwed(s) === 0 ? 'green' : 'red' }}>
                                      <strong>Owes:</strong> ${calculateOwed(s)}
                                    </p>

                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                      <label htmlFor={`status-${s.id}`}>Payment Status:</label>
                                      <select
                                        id={`status-${s.id}`}
                                        value={pendingStatus[s.id] ?? s.paymentStatus}
                                        onChange={(e) => setPendingStatus(prev => ({ ...prev, [s.id]: e.target.value as Student['paymentStatus'] }))}
                                      >
                                        <option value="PENDING">PENDING</option>
                                        <option value="PAID">PAID</option>
                                        <option value="FAILED">FAILED</option>
                                      </select>

                                      <button
                                        onClick={async (ev) => {
                                          ev.stopPropagation();
                                          const newStatus = pendingStatus[s.id] ?? s.paymentStatus;
                                          setSavingId(s.id);
                                          try {
                                            await onStatusUpdate(s.id, newStatus);
                                            setPendingStatus(prev => {
                                              const next = { ...prev };
                                              delete next[s.id];
                                              return next;
                                            });
                                          } finally {
                                            setSavingId(null);
                                          }
                                        }}
                                        disabled={savingId === s.id}
                                      >
                                        {savingId === s.id ? 'Saving…' : 'Save'}
                                      </button>

                                      <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0.75rem 0' }} />

                                      {/* Section editor */}
                                      <div className="section-editor">
                                        {/* Day selector */}
                                        <div className="section-field">
                                          <label className="section-label">Day</label>
                                          <select
                                            className="section-select"
                                            value={(pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey)}
                                            onChange={(e) => {
                                              const day = e.target.value as DayKey;
                                              const label = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                                              setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                                            }}
                                          >
                                            {dayOptionsFor(s.location as LocationKey).map(d => (
                                              <option key={d} value={d}>{d}</option>
                                            ))}
                                          </select>
                                        </div>

                                        {/* Section selector */}
                                        <div className="section-field">
                                          <label className="section-label">Section</label>
                                          {(() => {
                                            const chosenDay = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                                            const opts = sectionsFor(s.location as LocationKey, chosenDay);
                                            const currentLabel = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                                            return (
                                              <select
                                                className="section-select"
                                                value={currentLabel}
                                                onChange={(e) => {
                                                  const label = e.target.value as SessionKey;
                                                  const day = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                                                  setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                                                }}
                                              >
                                                {(['A','B'] as SessionKey[]).map(label => {
                                                  const meta = opts.find(o => o.label === label);
                                                  const soldOut = !!meta?.isFull;
                                                  return (
                                                    <option key={label} value={label} disabled={soldOut}>
                                                      {label}{soldOut ? ' — SOLD OUT' : ''}
                                                    </option>
                                                  );
                                                })}
                                              </select>
                                            );
                                          })()}
                                        </div>

                                        {/* Save */}
                                        <div className="section-actions">
                                          <button
                                            className="toggle-btn"
                                            disabled={!onMoveSection || movingId === s.id}
                                            onClick={async (ev) => {
                                              ev.stopPropagation();
                                              if (!onMoveSection) return;
                                              const choice = pendingMove[s.id] || {
                                                day: (s.selectedDays?.[0] as DayKey),
                                                label: ((s.sessionLabel ?? 'A') as SessionKey),
                                              };
                                              setMovingId(s.id);
                                              try {
                                                await onMoveSection(s.id, choice.day, choice.label);
                                                setPendingMove(prev => {
                                                  const next = { ...prev };
                                                  delete next[s.id];
                                                  return next;
                                                });
                                              } finally {
                                                setMovingId(null);
                                              }
                                            }}
                                            title="Move student to the selected day/section"
                                          >
                                            {movingId === s.id ? 'Moving…' : 'Save Change'}
                                          </button>
                                        </div>
                                      </div>
                                      {/* /Section editor */}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="mobile-only" style={{ maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
            {/* Flat list on mobile when only one section present */}
            {!enableGrouping && paginated.map(s => {
              const expanded = expandedRows.has(s.id);
              return (
                <div key={s.id} className={`mobile-card ${expanded ? 'expanded' : ''}`}>
                  <div
                    className="mobile-card-header"
                    onClick={() => toggleRow(s.id)}
                    role="button"
                    aria-expanded={expanded}
                  >
                    <span className="student-name">{s.studentName}</span>
                    <span className={`pill pill--${s.paymentStatus.toLowerCase()}`}>{s.paymentStatus}</span>
                    <span className="arrow">{expanded ? 'v' : '>'}</span>
                  </div>
                  {expanded && (
                    <div className="mobile-card-body" onClick={(e) => e.stopPropagation()}>
                      <p><strong>Age:</strong> {s.age}</p>
                      <p><strong>Parent/Guardian:</strong> {s.parentName}</p>
                      <p><strong>Phone:</strong> {s.phone}</p>
                      <p>
                        <strong>Email:</strong> {s.email}
                        {/* single-recipient email */}
                        <button
                          className="toggle-btn"
                          style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            window.location.href = `mailto:${s.email}`;
                          }}
                          title="Email this student"
                        >
                          Email
                        </button>
                      </p>
                      <p><strong>Location:</strong> {s.location}</p>
                      <p><strong>Frequency:</strong> {s.frequency === 'ONCE_A_WEEK' ? 'Once' : 'Twice'}</p>
                      <p><strong>Day(s):</strong> {s.selectedDays.join(', ')}</p>
                      <p><strong>Session:</strong> {s.sessionLabel ?? '—'}</p>
                      <p><strong>Start Date:</strong> {formatDatePretty(chooseStartDateIso(s))}</p>
                      <p style={{ color: calculateOwed(s) === 0 ? 'green' : 'red' }}>
                        <strong>Owes:</strong> ${calculateOwed(s)}
                      </p>

                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <select
                          value={pendingStatus[s.id] ?? s.paymentStatus}
                          onChange={(e) => {
                            e.stopPropagation();
                            setPendingStatus(prev => ({ ...prev, [s.id]: e.target.value as Student['paymentStatus'] }));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          aria-label={`Payment status for ${s.studentName}`}
                          style={{
                            flex: 1,
                            padding: '0.6rem',
                            borderRadius: 6,
                            border: '1px solid #ccc',
                            background: '#fff',
                            fontSize: '0.9rem',
                            appearance: 'none' as const
                          }}
                        >
                          <option value="PENDING">PENDING</option>
                          <option value="PAID">PAID</option>
                          <option value="FAILED">FAILED</option>
                        </select>

                        <button
                          className="toggle-btn"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const newStatus = pendingStatus[s.id] ?? s.paymentStatus;
                            setSavingId(s.id);
                            try {
                              await onStatusUpdate(s.id, newStatus);
                              setPendingStatus(p => {
                                const next = { ...p };
                                delete next[s.id];
                                return next;
                              });
                            } finally {
                              setSavingId(null);
                            }
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          disabled={savingId === s.id}
                        >
                          {savingId === s.id ? '...' : 'Save'}
                        </button>

                        <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0.75rem 0' }} />

                        {/* Section editor */}
                        <div className="section-editor">
                          {/* Day selector */}
                          <div className="section-field">
                            <label className="section-label">Day</label>
                            <select
                              className="section-select"
                              value={(pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey)}
                              onChange={(e) => {
                                const day = e.target.value as DayKey;
                                const label = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                                setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                              }}
                            >
                              {dayOptionsFor(s.location as LocationKey).map(d => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                            </select>
                          </div>

                          {/* Section selector */}
                          <div className="section-field">
                            <label className="section-label">Section</label>
                            {(() => {
                              const chosenDay = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                              const opts = sectionsFor(s.location as LocationKey, chosenDay);
                              const currentLabel = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                              return (
                                <select
                                  className="section-select"
                                  value={currentLabel}
                                  onChange={(e) => {
                                    const label = e.target.value as SessionKey;
                                    const day = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                                    setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                                  }}
                                >
                                  {(['A','B'] as SessionKey[]).map(label => {
                                    const meta = opts.find(o => o.label === label);
                                    const soldOut = !!meta?.isFull;
                                    return (
                                      <option key={label} value={label} disabled={soldOut}>
                                        {label}{soldOut ? ' — SOLD OUT' : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              );
                            })()}
                          </div>

                          {/* Save */}
                          <div className="section-actions">
                            <button
                              className="toggle-btn"
                              disabled={!onMoveSection || movingId === s.id}
                              onClick={async (ev) => {
                                ev.stopPropagation();
                                if (!onMoveSection) return;
                                const choice = pendingMove[s.id] || {
                                  day: (s.selectedDays?.[0] as DayKey),
                                  label: ((s.sessionLabel ?? 'A') as SessionKey),
                                };
                                setMovingId(s.id);
                                try {
                                  await onMoveSection(s.id, choice.day, choice.label);
                                  setPendingMove(prev => {
                                    const next = { ...prev };
                                    delete next[s.id];
                                    return next;
                                  });
                                } finally {
                                  setMovingId(null);
                                }
                              }}
                              title="Move student to the selected day/section"
                            >
                              {movingId === s.id ? 'Moving…' : 'Save Change'}
                            </button>
                          </div>
                        </div>
                        {/* /Section editor */}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Grouped mobile list when multiple sections present (with collapsible headers + email group) */}
            {enableGrouping && groupedBySection.map(group => {
              const isCollapsed = !!collapsedGroups[group.label];
              const groupEmails = group.items.map(g => g.email).filter(Boolean);
              return (
                <div key={group.label} style={{ marginBottom: '0.5rem' }}>
                  <div
                    className="mobile-card"
                    style={{ background: '#f8fafc', padding: '0.5rem 0.75rem', fontWeight: 700 }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <div
                        onClick={() => toggleGroup(group.label)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ marginRight: 8 }}>{isCollapsed ? '>' : 'v'}</span>
                        Section {group.label}
                        <span className="badge" style={{ marginLeft: 8 }}>{group.items.length}</span>
                      </div>

                      {/* NEW: Email this group (BCC) */}
                      <button
                        className="toggle-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          launchBcc(groupEmails);
                        }}
                        disabled={groupEmails.length === 0}
                        title={`Email Group ${group.label} (BCC)`}
                      >
                        Email group
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && group.items.map(s => {
                    const expanded = expandedRows.has(s.id);
                    return (
                      <div key={s.id} className={`mobile-card ${expanded ? 'expanded' : ''}`}>
                        <div
                          className="mobile-card-header"
                          onClick={() => toggleRow(s.id)}
                          role="button"
                          aria-expanded={expanded}
                        >
                          <span className="student-name">{s.studentName}</span>
                          <span className={`pill pill--${s.paymentStatus.toLowerCase()}`}>{s.paymentStatus}</span>
                          <span className="arrow">{expanded ? 'v' : '>'}</span>
                        </div>
                        {expanded && (
                          <div className="mobile-card-body" onClick={(e) => e.stopPropagation()}>
                            <p><strong>Age:</strong> {s.age}</p>
                            <p><strong>Parent/Guardian:</strong> {s.parentName}</p>
                            <p><strong>Phone:</strong> {s.phone}</p>
                            <p>
                              <strong>Email:</strong> {s.email}
                              {/* single-recipient email */}
                              <button
                                className="toggle-btn"
                                style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.location.href = `mailto:${s.email}`;
                                }}
                                title="Email this student"
                              >
                                Email
                              </button>
                            </p>
                            <p><strong>Location:</strong> {s.location}</p>
                            <p><strong>Frequency:</strong> {s.frequency === 'ONCE_A_WEEK' ? 'Once' : 'Twice'}</p>
                            <p><strong>Day(s):</strong> {s.selectedDays.join(', ')}</p>
                            <p><strong>Session:</strong> {s.sessionLabel ?? '—'}</p>
                            <p><strong>Start Date:</strong> {formatDatePretty(chooseStartDateIso(s))}</p>
                            <p style={{ color: calculateOwed(s) === 0 ? 'green' : 'red' }}>
                              <strong>Owes:</strong> ${calculateOwed(s)}
                            </p>

                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <select
                                value={pendingStatus[s.id] ?? s.paymentStatus}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setPendingStatus(prev => ({ ...prev, [s.id]: e.target.value as Student['paymentStatus'] }));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                aria-label={`Payment status for ${s.studentName}`}
                                style={{
                                  flex: 1,
                                  padding: '0.6rem',
                                  borderRadius: 6,
                                  border: '1px solid #ccc',
                                  background: '#fff',
                                  fontSize: '0.9rem',
                                  appearance: 'none' as const
                                }}
                              >
                                <option value="PENDING">PENDING</option>
                                <option value="PAID">PAID</option>
                                <option value="FAILED">FAILED</option>
                              </select>

                              <button
                                className="toggle-btn"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const newStatus = pendingStatus[s.id] ?? s.paymentStatus;
                                  setSavingId(s.id);
                                  try {
                                    await onStatusUpdate(s.id, newStatus);
                                    setPendingStatus(p => {
                                      const next = { ...p };
                                      delete next[s.id];
                                      return next;
                                    });
                                  } finally {
                                    setSavingId(null);
                                  }
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                disabled={savingId === s.id}
                              >
                                {savingId === s.id ? '...' : 'Save'}
                              </button>

                              <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0.75rem 0' }} />

                              {/* Section editor */}
                              <div className="section-editor">
                                {/* Day selector */}
                                <div className="section-field">
                                  <label className="section-label">Day</label>
                                  <select
                                    className="section-select"
                                    value={(pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey)}
                                    onChange={(e) => {
                                      const day = e.target.value as DayKey;
                                      const label = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                                      setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                                    }}
                                  >
                                    {dayOptionsFor(s.location as LocationKey).map(d => (
                                      <option key={d} value={d}>{d}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Section selector */}
                                <div className="section-field">
                                  <label className="section-label">Section</label>
                                  {(() => {
                                    const chosenDay = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                                    const opts = sectionsFor(s.location as LocationKey, chosenDay);
                                    const currentLabel = (pendingMove[s.id]?.label) || ((s.sessionLabel ?? 'A') as SessionKey);
                                    return (
                                      <select
                                        className="section-select"
                                        value={currentLabel}
                                        onChange={(e) => {
                                          const label = e.target.value as SessionKey;
                                          const day = (pendingMove[s.id]?.day) || (s.selectedDays?.[0] as DayKey);
                                          setPendingMove(prev => ({ ...prev, [s.id]: { day, label } }));
                                        }}
                                      >
                                        {(['A','B'] as SessionKey[]).map(label => {
                                          const meta = opts.find(o => o.label === label);
                                          const soldOut = !!meta?.isFull;
                                          return (
                                            <option key={label} value={label} disabled={soldOut}>
                                              {label}{soldOut ? ' — SOLD OUT' : ''}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    );
                                  })()}
                                </div>

                                {/* Save */}
                                <div className="section-actions">
                                  <button
                                    className="toggle-btn"
                                    disabled={!onMoveSection || movingId === s.id}
                                    onClick={async (ev) => {
                                      ev.stopPropagation();
                                      if (!onMoveSection) return;
                                      const choice = pendingMove[s.id] || {
                                        day: (s.selectedDays?.[0] as DayKey),
                                        label: ((s.sessionLabel ?? 'A') as SessionKey),
                                      };
                                      setMovingId(s.id);
                                      try {
                                        await onMoveSection(s.id, choice.day, choice.label);
                                        setPendingMove(prev => {
                                          const next = { ...prev };
                                          delete next[s.id];
                                          return next;
                                        });
                                      } finally {
                                        setMovingId(null);
                                      }
                                    }}
                                    title="Move student to the selected day/section"
                                  >
                                    {movingId === s.id ? 'Moving…' : 'Save Change'}
                                  </button>
                                </div>
                              </div>
                              {/* /Section editor */}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Pagination (only makes sense when not grouped) */}
          {!enableGrouping && totalPages > 1 && (
            <div className="pagination-controls">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span>Page {page + 1} of {totalPages}</span>
              <button disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
};




const PaymentTable: React.FC<{ students: Student[]; onStatusUpdate: (id: string, newStatus: Student['paymentStatus']) => Promise<void> }> = ({ students, onStatusUpdate }) => {
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusUpdates, setStatusUpdates] = useState<Record<string, Student['paymentStatus']>>({});
  const [showUnpaidFirst, setShowUnpaidFirst] = useState(false);


  const filtered = useMemo(() => {
    const term = search.toLowerCase();
      let result = students.filter(s =>
        s.studentName.toLowerCase().includes(term) ||
        s.parentName.toLowerCase().includes(term)
      );

      if (showUnpaidFirst) {
        result = [...result].sort((a, b) => {
          const aOwes = calculateOwed(a) > 0 ? 0 : 1;
          const bOwes = calculateOwed(b) > 0 ? 0 : 1;
          return aOwes-bOwes; // unpaid first
        });
      }

      return result;
  }, [students, search, showUnpaidFirst]);


  const handleChange = (id: string, value: Student['paymentStatus']) => {
    setStatusUpdates(prev => ({ ...prev, [id]: value }));
  };

  const handleSave = async (id: string) => {
    if (!statusUpdates[id]) return;
    setSavingId(id);
    await onStatusUpdate(id, statusUpdates[id]);
    setSavingId(null);
  };

  return (
    <section className="admin-section fade-in" style={{ marginTop: '2rem' }}>
      <div className="admin-section__header" style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontWeight: 'bold', marginBottom: '1rem', alignSelf: 'center'}}>Payment Management</h2>
        <input
          type="text"
          placeholder="Search by student or parent..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #000000ff', minWidth: '50%' }}
        />
        <button
          className="toggle-btn"
          style={{ marginLeft: '0.5rem', whiteSpace: 'nowrap', maxWidth: '40%', fontSize: '0.7rem', padding: '0.5rem' }}
          onClick={() => setShowUnpaidFirst(prev => !prev)}
        >
          {showUnpaidFirst ? 'Show Default Order' : 'Show Unpaid First'}
        </button>

      </div>

      {/* Desktop */}
      <div className="table-scroll desktop-only">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Parent</th>
              <th>Owes</th>
              <th>Current Status</th>
              <th>Update</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id}>
                <td>{s.studentName}</td>
                <td>{s.parentName}</td>
                <td>${calculateOwed(s)}</td>
                <td>
                  <span className={`pill pill--${s.paymentStatus.toLowerCase()}`}>{s.paymentStatus}</span>
                </td>
                <td>
                  <select
                    value={statusUpdates[s.id] || s.paymentStatus}
                    onChange={(e) => handleChange(s.id, e.target.value as Student['paymentStatus'])}
                    style={{
                      padding: '0.4rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid #ccc',
                      backgroundColor: '#fff',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none'
                    }}
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="PAID">PAID</option>
                    <option value="FAILED">FAILED</option>
                  </select>
                </td>
                <td>
                  <button className="toggle-btn" disabled={savingId === s.id} onClick={() => handleSave(s.id)}>
                    {savingId === s.id ? 'Saving...' : 'Save'}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center' }}>No students match your search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="mobile-only" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {filtered.map(s => (
          <div key={s.id} className="mobile-card expanded" style={{ marginBottom: '1rem', padding: '1rem' }}>
            <p><strong>Student:</strong> {s.studentName}</p>
            <p><strong>Parent:</strong> {s.parentName}</p>
            <p style={{ color: calculateOwed(s) === 0 ? 'green' : 'red' }}>
              <strong>Owes:</strong> ${calculateOwed(s)}
            </p>
            <p><strong>Current Status:</strong> <span className={`pill pill--${s.paymentStatus.toLowerCase()}`}>{s.paymentStatus}</span></p>
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <select
                value={statusUpdates[s.id] || s.paymentStatus}
                onChange={(e) => handleChange(s.id, e.target.value as Student['paymentStatus'])}
                style={{
                  flex: 1,
                  padding: '1rem',
                  borderRadius: '6px',
                  border: '1px solid #ccc',
                  backgroundColor: '#fff',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none'
                }}
              >
                <option value="PENDING">PENDING</option>
                <option value="PAID">PAID</option>
                <option value="FAILED">FAILED</option>
              </select>

              <button className="toggle-btn" disabled={savingId === s.id} onClick={() => handleSave(s.id)} style={{ flexShrink: 0 }}>
                {savingId === s.id ? '...' : 'Save'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const WaitlistTable: React.FC<{ entries: WaitlistEntry[]; title?: string }> = ({ entries, title = 'Waitlist' }) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const perPage = 5;
  const totalPages = Math.ceil(entries.length / perPage);
  const paginated = entries.slice(page * perPage, page * perPage + perPage);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const emailAll = () => {
    if (entries.length === 0) return;
    const uniqueEmails = Array.from(new Set(entries.map(e => e.email.trim()).filter(Boolean)));
    const bcc = encodeURIComponent(uniqueEmails.join(','));
    const subject = encodeURIComponent('Baila Kids – Waitlist Update');
    window.location.href = `mailto:?bcc=${bcc}&subject=${subject}`;
  };

  const pretty = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
           ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <section className="admin-section fade-in" style={{ marginTop: '2rem' }}>
      <div className="admin-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="badge">{entries.length}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {entries.length > 0 && (
            <button className="toggle-btn" onClick={emailAll}>Email all</button>
          )}
          {totalPages > 1 && (
            <div className="pagination-controls" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span>Page {page + 1} / {totalPages}</span>
              <button disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      </div>

      {/* Desktop */}
      <div className="table-scroll desktop-only" style={{ maxHeight: '300px', overflowY: 'auto' }}>
        <table className="admin-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Student</th>
              <th>Requested Day</th>
              <th>Location</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(e => {
              const expanded = expandedRows.has(e.id);
              return (
                <React.Fragment key={e.id}>
                  <tr onClick={() => toggleRow(e.id)} className="clickable-row">
                    <td>{e.studentName}</td>
                    <td>{e.requestedDay}</td>
                    <td>{e.location}</td>
                    <td>{pretty(e.createdAt)}</td>
                    <td className="arrow">{expanded ? 'v' : '>'}</td>
                  </tr>
                  {expanded && (
                    <tr className="expanded-row">
                      <td colSpan={5}>
                        <div className="expanded-content">
                          <p><strong>Age:</strong> {e.age}</p>
                          <p><strong>Parent/Guardian:</strong> {e.parentName}</p>
                          <p><strong>Phone:</strong> {e.phone}</p>
                          <p>
                            <strong>Email:</strong> {e.email}
                            <button
                              className="toggle-btn"
                              style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                const subj = encodeURIComponent('Baila Kids – Waitlist');
                                window.location.href = `mailto:${e.email}?subject=${subj}`;
                              }}
                            >
                              Email
                            </button>
                          </p>
                          {e.notes && <p><strong>Notes:</strong> {e.notes}</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {paginated.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center' }}>No one on the waitlist.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="mobile-only" style={{ maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
        {paginated.map(e => {
          const expanded = expandedRows.has(e.id);
          return (
            <div key={e.id} className={`mobile-card ${expanded ? 'expanded' : ''}`} onClick={() => toggleRow(e.id)}>
              <div className="mobile-card-header">
                <span className="student-name">{e.studentName}</span>
                <span className="arrow">{expanded ? 'v' : '>'}</span>
              </div>
              <div className="mobile-card-sub">
                {e.requestedDay} • {e.location} • {pretty(e.createdAt)}
              </div>
              {expanded && (
                <div className="mobile-card-body">
                  <p><strong>Age:</strong> {e.age}</p>
                  <p><strong>Parent/Guardian:</strong> {e.parentName}</p>
                  <p><strong>Phone:</strong> {e.phone}</p>
                  <p>
                    <strong>Email:</strong> {e.email}
                    <button
                      className="toggle-btn"
                      style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        const subj = encodeURIComponent('Baila Kids – Waitlist');
                        window.location.href = `mailto:${e.email}?subject=${subj}`;
                      }}
                    >
                      Email
                    </button>
                  </p>
                  {e.notes && <p><strong>Notes:</strong> {e.notes}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};


const AdminPage: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');
  const [foundStudents, setFoundStudents] = useState<Student[]>([]);
  const [expandedStudentIds, setExpandedStudentIds] = useState<Set<string>>(new Set());
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitlistLoading, setWaitlistLoading] = useState(true);
  const [waitlistErr, setWaitlistErr] = useState('');


  const totalRegistrations = React.useMemo(() => {
  return students.reduce((sum, s) => {
    const daysCount = Array.isArray(s.selectedDays) ? s.selectedDays.length : 0;
    return sum + daysCount;
  }, 0);
}, [students]);



  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get<Student[]>('/api/admin/students');
        const sorted = [...res.data].sort((a, b) => a.studentName.localeCompare(b.studentName));
        setStudents(sorted);
      } catch (e) {
        setErr('Failed to load students.');
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
  (async () => {
    try {
      const res = await axios.get<WaitlistEntry[]>('/api/admin/waitlist');
      setWaitlist(res.data);
    } catch (e) {
      console.error(e);
      setWaitlistErr('Failed to load waitlist.');
    } finally {
      setWaitlistLoading(false);
    }
  })();
}, []);



  const dayOnly = (day: string) =>
    students.filter(s => Array.isArray(s.selectedDays) && s.selectedDays.includes(day));

  const handleStatusUpdate = async (id: string, newStatus: Student['paymentStatus']) => {
    try {
      await axios.put(`/api/admin/students`, { id, paymentStatus: newStatus });
      setStudents(prev => prev.map(s => s.id === id ? { ...s, paymentStatus: newStatus } : s));
    } catch (err) {
      console.error('Error updating payment status', err);
    }
  };

  const earnings = React.useMemo(() => {
    let paidCount = 0;
    let unpaidCount = 0;   // PENDING
    let failedCount = 0;   // FAILED

    let earned = 0;        // sum of tuition for PAID
    let outstanding = 0;   // sum of tuition for NOT PAID

    for (const s of students) {
      const amt = tuitionFor(s);
      if (s.paymentStatus === 'PAID') {
        paidCount += 1;
        earned += amt;
      } else if (s.paymentStatus === 'PENDING') {
        unpaidCount += 1;
        outstanding += amt;
      } else if (s.paymentStatus === 'FAILED') {
        failedCount += 1;
        outstanding += amt;
      }
    }

    const totalCount = paidCount + unpaidCount + failedCount;
    const paidPct = totalCount ? (paidCount / totalCount) * 100 : 0;
    const unpaidPct = 100 - paidPct; // treat FAILED as unpaid for the pie

    return {
      paidCount, unpaidCount, failedCount,
      earned, outstanding,
      paidPct, unpaidPct, totalCount
    };
  }, [students]);


const [sections, setSections] = useState<SectionMeta[]>([]);
const [sectionsErr, setSectionsErr] = useState('');

useEffect(() => {
  (async () => {
    try {
      const res = await axios.get<SectionMeta[]>('/api/admin/sections');
      setSections(res.data || []);
    } catch (e) {
      console.error('Failed to load sections', e);
    }
  })();
}, []);

// Move a student to a chosen day/section; backend should update Enrollment + sync Student.selectedDays/sessionLabel/start date
const handleMoveSection = async (studentId: string, day: DayKey, label: SessionKey) => {
  await axios.put('/api/admin/enrollment', { studentId, day, label });

  // optimistic UI
  setStudents(prev => prev.map(s => {
  if (s.id !== studentId) return s;

  const nextDays =
    s.frequency === 'ONCE_A_WEEK'
      ? [day]
      : [day, ...(s.selectedDays || []).filter(d => d !== day)].slice(0, 2);

  // find the section meta for this location/day/label
  const sectionMeta = sections.find(
    sec => sec.location === s.location && sec.day === day && sec.label === label
  );

  return {
    ...s,
    selectedDays: nextDays,
    sessionLabel: label,
    startDate: sectionMeta?.startDate ?? s.startDate,  // <-- update to reflect new section
    // optional: if using per-day dates
    startDatesByDay: {
      ...(s.startDatesByDay || {}),
      [day]: sectionMeta?.startDate ?? s.startDate,
    },
  };
}));

};





  return (
    <div className="admin-container">
      <header className="admin-header">
        <h1>Baila Kids Admin Dashboard</h1>
        <p className="sub" style={{color: 'black'}}>Welcome Cristina! hola mami :)</p>
      </header>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', maxWidth: '50%', borderRadius: '5px' }}>
        <input
          type="text"
          placeholder="Search any student..."
          value={globalSearch}
          onChange={(e) => {
            const term = e.target.value;
            setGlobalSearch(term);

            if (term.trim().length === 0) {
              setFoundStudents([]);
              return;
            }

            const matches = students.filter(s =>
              s.studentName.toLowerCase().includes(term.toLowerCase()) ||
              s.parentName.toLowerCase().includes(term.toLowerCase()) ||
              s.email.toLowerCase().includes(term.toLowerCase())
            );
            setFoundStudents(matches);
          }}

          style={{
            padding: '0.5rem',
            borderRadius: '6px',
            border: '1px solid #ccc',
            flex: 1
          }}
        />
        {globalSearch && (
          <button
            className="toggle-btn"
            style={{ whiteSpace: 'nowrap' }}
            onClick={() => {
              setGlobalSearch('');
              setFoundStudents([]);
            }}
          >
            Clear
          </button>
        )}

        <div
  className="total-registrations-card"
  style={{
    margin: '0.5rem 0 1rem',
    padding: '0.75rem 1rem',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.75rem',
    width: 'fit-content',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
  }}
>
  <span style={{ fontSize: '0.9rem', color: '#6b7280' }}>Total registrations</span>
  <span style={{ fontSize: '1.75rem', fontWeight: 800, lineHeight: 1 }}>{totalRegistrations}</span>
</div>


      </div>
      {foundStudents.length > 0 && (
        <div
          style={{
            maxHeight: '250px',
            overflowY: 'auto',
            border: '1px solid #ccc',
            borderRadius: '8px',
            padding: '0.5rem',
            background: '#fff',
            marginBottom: '1rem' ,
            maxWidth: '70%'
          }}
        >
          {foundStudents.map(s => {
            const expanded = expandedStudentIds.has(s.id);
            return (
              <div
                key={s.id}
                style={{
                  borderBottom: '1px solid #eee',
                  padding: '0.5rem 0',
                  cursor: 'pointer' ,
                }}
                onClick={() => {
                  setExpandedStudentIds(prev => {
                    const newSet = new Set(prev);
                    newSet.has(s.id) ? newSet.delete(s.id) : newSet.add(s.id);
                    return newSet;
                  });
                }}
              >
                {/* Collapsed header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span><strong>{s.studentName}</strong> — {s.parentName}</span>
                  <span style={{ fontSize: '1.2rem' }}>{expanded ? '^' : 'v'}</span>
                </div>

                {/* Expanded details */}
                {expanded && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    <p><strong>Age:</strong> {s.age}</p>
                    <p><strong>Phone:</strong> {s.phone}</p>
                    <p>
                      <strong>Email:</strong> {s.email}
                      <button
                        className="toggle-btn"
                        style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.location.href = `mailto:${s.email}`;
                        }}
                      >
                        Email
                      </button>
                    </p>
                    <p><strong>Location:</strong> {s.location}</p>
                    <p><strong>Frequency:</strong> {s.frequency === 'ONCE_A_WEEK' ? 'Once' : 'Twice'}</p>
                    <p><strong>Day(s):</strong> {s.selectedDays.join(', ')}</p>
<p><strong>Session:</strong> {s.sessionLabel ?? '—'}</p>
<p><strong>Start Date:</strong> {formatDatePretty(chooseStartDateIso(s))}</p>
                    <p style={{ color: calculateOwed(s) === 0 ? 'green' : 'red' }}>
                      <strong>Owes:</strong> ${calculateOwed(s)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}




      {loading && <div className="loader">Loading…</div>}
      {err && !loading && <div className="error">{err}</div>}

      {!loading && !err && (
        <>
          <div className="grid">
<StudentsTable
  title="All Students"
  students={students}
  onStatusUpdate={handleStatusUpdate}
  sections={sections}
  onMoveSection={handleMoveSection}
/>
          </div>
          <div className="grid grid--two">
  <StudentsTable
    title="Monday"
    students={dayOnly('Monday')}
    onStatusUpdate={handleStatusUpdate}
    sections={sections}
    onMoveSection={handleMoveSection}
  />
  <StudentsTable
    title="Tuesday"
    students={dayOnly('Tuesday')}
    onStatusUpdate={handleStatusUpdate}
    sections={sections}
    onMoveSection={handleMoveSection}
  />
</div>

<div className="grid grid--two">
  <StudentsTable
    title="Wednesday"
    students={dayOnly('Wednesday')}
    onStatusUpdate={handleStatusUpdate}
    sections={sections}
    onMoveSection={handleMoveSection}
  />
  <StudentsTable
    title="Thursday"
    students={dayOnly('Thursday')}
    onStatusUpdate={handleStatusUpdate}
    sections={sections}
    onMoveSection={handleMoveSection}
  />
</div>

          {/* <PaymentTable students={students} onStatusUpdate={handleStatusUpdate} /> */}
          {/* Earnings Section */}
            {/* Earnings Section */}
          <section className="admin-section fade-in earnings-section" style={{ marginTop: '2rem' }}>
            <div className="earnings-header">
              <h2 style={{ margin: 0, fontWeight: 'bold' }}>Earnings</h2>
            </div>

            <div className="earnings-grid">
              {/* Pie: Paid vs Unpaid */}
              <div className="earnings-pie-wrap">
                <div
                  className="earnings-pie"
                  aria-label="Paid vs Unpaid pie"
                  title={`Paid ${earnings.paidPct.toFixed(0)}% / Unpaid ${earnings.unpaidPct.toFixed(0)}%`}
                  style={{ background: `conic-gradient(#2ecc71 0 ${earnings.paidPct}%, #ff6b6b ${earnings.paidPct}% 100%)` }}
                />
                <div className="earnings-legend">
                  <span><span className="legend-swatch" style={{ background: '#ff6b6b' }} /> Unpaid</span>
                  <span><span className="legend-swatch" style={{ background: '#2ecc71' }} /> Paid</span>
                </div>
              </div>

              {/* Numbers */}
              <div className="earnings-panel">
                <div className="earnings-counts">
                  <div className="stat stat--paid">
                    <div className="stat-label">Paid</div>
                    <div className="stat-value">{earnings.paidCount}</div>
                  </div>
                  <div className="stat stat--unpaid">
                    <div className="stat-label">Unpaid</div>
                    <div className="stat-value">{earnings.unpaidCount}</div>
                  </div>
                </div>

                <div className="earnings-money-grid">
                  <div className="money-card">
                    <div className="money-label">Earnings</div>
                    <div className="money-value">${earnings.earned.toLocaleString()}</div>
                    <div className="money-sub">Sum of PAID registrations</div>
                  </div>
                  <div className="money-card">
                    <div className="money-label">Outstanding</div>
                    <div className="money-value">${earnings.outstanding.toLocaleString()}</div>
                    <div className="money-sub">Pending + Failed</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {waitlistLoading && <div className="loader">Loading waitlist…</div>}
          {waitlistErr && !waitlistLoading && <div className="error">{waitlistErr}</div>}
          {!waitlistLoading && !waitlistErr && <WaitlistTable entries={waitlist} />}



        </>
      )}
    </div>
  );
};

export default AdminPage;

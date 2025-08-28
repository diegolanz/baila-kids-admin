import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
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
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED';
  paymentMethod?: string | null;
  liabilityAccepted?: boolean;
  waiverName?: string | null;
  waiverAddress?: string | null;
}

function formatDatePretty(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

type DayKey = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday';

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


const prices = {
  KATY: { Monday: 0, Tuesday: 245, Wednesday: 245, Thursday: 0, both: 450 },
  SUGARLAND: { Monday: 230, Tuesday: 0, Wednesday: 0, Thursday: 245, both: 450 },
} as const;

const calculateOwed = (s: Student) => {
  if (s.paymentStatus === 'PAID') return 0;
  if (s.frequency === 'ONCE_A_WEEK') {
    const day = s.selectedDays[0] as keyof typeof prices['KATY'];
    return prices[s.location][day] || 0;
  }
  return prices[s.location].both;
};

const tuitionFor = (s: Student) => {
  if (s.frequency === 'ONCE_A_WEEK') {
    const day = (s.selectedDays?.[0] ?? '') as keyof typeof prices['KATY'];
    return prices[s.location][day] ?? 0;
  }
  return prices[s.location].both;
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
const parseLocalISO = (iso: string) => {
  const [datePart] = iso.split('T'); // keep just "YYYY-MM-DD"
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1); // local midnight
};

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








const StudentsTable: React.FC<{ title: string; students: Student[]; onStatusUpdate: (id: string, newStatus: Student['paymentStatus']) => Promise<void> }>
  = ({ title, students, onStatusUpdate }) => {  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [tableOpen, setTableOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<Record<string, Student['paymentStatus']>>({});
  const [savingId, setSavingId] = useState<string | null>(null);


  const perPage = 5;
  const totalPages = Math.ceil(students.length / perPage);
  const paginated = students.slice(page * perPage, page * perPage + perPage);

  async function handleStatusUpdate(id: string, newStatus: 'PENDING'|'PAID'|'FAILED') {
  const res = await fetch('/api/admin/students', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, paymentStatus: newStatus }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error || 'Failed to update payment status');
  }

  // Optional: if you have a top-level students state, keep UI in sync optimistically
  // if (typeof setStudents === 'function') {
  //   setStudents(prev => prev.map(st => st.id === id ? { ...st, paymentStatus: newStatus } : st));
  // }
}

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      newSet.has(id) ? newSet.delete(id) : newSet.add(id);
      return newSet;
    });
  };

  

  return (
    <section className="admin-section fade-in">
      <div className="admin-section__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="badge">{students.length}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {students.length > 0 && (
            <>
              <button
                className="toggle-btn"
                onClick={() => {
                  const emails = students.map(s => s.email).join(',');
                  window.location.href = `mailto:?bcc=${emails}`;
                }}
              >
                Email all
              </button>

              <button
                className="toggle-btn"
                onClick={() => exportAttendanceXlsx(title, students)}
                title="Download Excel roster with 14 weeks of dates"
              >
                Excel
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
                {paginated.map(s => {
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
                              <p><strong>Start Date:</strong> {formatDatePretty(s.startDate)}</p>
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
                                        const { [s.id]: _, ...rest } = prev; 
                                        return rest;
                                      });
                                    } finally {
                                      setSavingId(null);
                                    }
                                  }}
                                  disabled={savingId === s.id}
                                >
                                  {savingId === s.id ? 'Saving…' : 'Save'}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="mobile-only" style={{ maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
            {paginated.map(s => {
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
                      <p><strong>Start Date:</strong> {formatDatePretty(s.startDate)}</p>
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
      setPendingStatus(p => { const { [s.id]:_, ...rest } = p; return rest; });
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
                      </div>

                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
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
                  <span style={{ fontSize: '1.2rem' }}>{expanded ? '▲' : '▼'}</span>
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
                    <p><strong>Start Date:</strong> {formatDatePretty(s.startDate)}</p>
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
            <StudentsTable title="All Students" students={students} onStatusUpdate={handleStatusUpdate} />
          </div>
          <div className="grid grid--two">
            <StudentsTable title="Monday" students={dayOnly('Monday')} onStatusUpdate={handleStatusUpdate} />
            <StudentsTable title="Tuesday" students={dayOnly('Tuesday')} onStatusUpdate={handleStatusUpdate} />
          </div>
          <div className="grid grid--two">
            <StudentsTable title="Wednesday" students={dayOnly('Wednesday')} onStatusUpdate={handleStatusUpdate} />
            <StudentsTable title="Thursday" students={dayOnly('Thursday')} onStatusUpdate={handleStatusUpdate} />
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

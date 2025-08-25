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

// ---- PDF helper ----
import jsPDF from 'jspdf';

type Row = {
  studentName?: string | null;
  age?: number | null;
  selectedDays?: string[] | null;
};

export function exportDayPdf(title: string, students: Row[]) {
  // sort by age ASC (null/undefined ages pushed to end)
  const rows = [...students].sort((a, b) => {
    const ax = a.age ?? Number.POSITIVE_INFINITY;
    const bx = b.age ?? Number.POSITIVE_INFINITY;
    return ax - bx;
  });

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const left = 54; // ~0.75" margin
  const colAge = left + 260;
  const colDays = left + 320;
  const usableWidth = 504; // right margin ~ 0.75"
  let y = 72;

  const lineHeight = 18;
  const maxWidthName = 240;
  const maxWidthDays = usableWidth - (colDays - left);

  const toLines = (x: string | string[]) => (Array.isArray(x) ? x : [x]);

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`${title} Students`, left, y);
  y += 24;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  y += 18;

  // Column headers
  const drawHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Name', left, y);
    doc.text('Age', colAge, y);
    doc.text('Days', colDays, y);
    y += 12;
    doc.setLineWidth(0.5);
    doc.line(left, y, left + usableWidth, y);
    y += 15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
  };

  drawHeader();

  // Body
  rows.forEach((s) => {
    // page break
    if (y > 730) {
      doc.addPage();
      y = 72;
      drawHeader();
    }

    const nameLines = toLines(
      doc.splitTextToSize(s.studentName ?? '', maxWidthName)
    ) as string[];

    const daysText = (s.selectedDays ?? []).join(', ');
    const daysLines = toLines(
      doc.splitTextToSize(daysText, maxWidthDays)
    ) as string[];

    const rowHeight = Math.max(nameLines.length, daysLines.length) * lineHeight;

    // draw name
    nameLines.forEach((ln: string, i: number) => {
      doc.text(ln, left, y + i * lineHeight);
    });

    // draw age (single line)
    doc.text(
      s.age === null || s.age === undefined ? '' : String(s.age),
      colAge,
      y
    );

    // draw days
    daysLines.forEach((ln: string, i: number) => {
      doc.text(ln, colDays, y + i * lineHeight);
    });

    // row separator
    y += rowHeight;
    doc.setDrawColor(220);
    // doc.line(left, y + 4, left + usableWidth, y + 4);
    y += 8;
  });

  const fileSafe = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
  doc.save(`${fileSafe}-students.pdf`);
}






const StudentsTable: React.FC<{ title: string; students: Student[] }> = ({ title, students }) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [tableOpen, setTableOpen] = useState(false);

  const perPage = 5;
  const totalPages = Math.ceil(students.length / perPage);
  const paginated = students.slice(page * perPage, page * perPage + perPage);

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
              <button className="toggle-btn" onClick={() => {
                const emails = students.map(s => s.email).join(',');
                window.location.href = `mailto:?bcc=${emails}`;
              }}>
                Email all
              </button>
              <button
                className="toggle-btn"
                onClick={() => exportDayPdf(title, students)}
                title="Download a simple PDF with names, ages, and all days"
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
                <div key={s.id} className={`mobile-card ${expanded ? 'expanded' : ''}`} onClick={() => toggleRow(s.id)}>
                  <div className="mobile-card-header">
                    <span className="student-name">{s.studentName}</span>
                    <span className={`pill pill--${s.paymentStatus.toLowerCase()}`}>{s.paymentStatus}</span>
                    <span className="arrow">{expanded ? 'v' : '>'}</span>
                  </div>
                  {expanded && (
                    <div className="mobile-card-body">
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
            <StudentsTable title="All Students" students={students} />
          </div>
          <div className="grid grid--two">
            <StudentsTable title="Monday" students={dayOnly('Monday')} />
            <StudentsTable title="Tuesday" students={dayOnly('Tuesday')} />
          </div>
          <div className="grid grid--two">
            <StudentsTable title="Wednesday" students={dayOnly('Wednesday')} />
            <StudentsTable title="Thursday" students={dayOnly('Thursday')} />
          </div>
          <PaymentTable students={students} onStatusUpdate={handleStatusUpdate} />
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

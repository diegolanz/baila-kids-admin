import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { FaEnvelope } from 'react-icons/fa';

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
            <button className="toggle-btn" onClick={() => {
              const emails = students.map(s => s.email).join(',');
              window.location.href = `mailto:${emails}`;
            }}>
              Email all
            </button>
          )}
          <button className="toggle-btn" onClick={() => setTableOpen(prev => !prev)}>
            {tableOpen ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {tableOpen && (
        <>
          {/* Desktop */}
          <div className="table-scroll desktop-only">
            <table className="admin-table">
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
          <div className="mobile-only">
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

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return students.filter(s =>
      s.studentName.toLowerCase().includes(term) ||
      s.parentName.toLowerCase().includes(term)
    );
  }, [students, search]);

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
          style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #000000ff', minWidth: '100%' }}
        />
      </div>

      {/* Desktop */}
      <div className="table-scroll desktop-only">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Parent</th>
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
      <div className="mobile-only">
        {filtered.map(s => (
          <div key={s.id} className="mobile-card expanded" style={{ marginBottom: '1rem', padding: '1rem' }}>
            <p><strong>Student:</strong> {s.studentName}</p>
            <p><strong>Parent:</strong> {s.parentName}</p>
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

const AdminPage: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

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

  const dayOnly = (day: string) =>
    students.filter(s => Array.isArray(s.selectedDays) && s.selectedDays.length === 1 && s.selectedDays[0] === day);

  const handleStatusUpdate = async (id: string, newStatus: Student['paymentStatus']) => {
    try {
      await axios.put(`/api/admin/students`, { id, paymentStatus: newStatus });
      setStudents(prev => prev.map(s => s.id === id ? { ...s, paymentStatus: newStatus } : s));
    } catch (err) {
      console.error('Error updating payment status', err);
    }
  };

  return (
    <div className="admin-container">
      <header className="admin-header">
        <h1>Baila Kids Admin Dashboard</h1>
        <p className="sub">Welcome Cristina! hola mami :)</p>
      </header>

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
        </>
      )}
    </div>
  );
};

export default AdminPage;

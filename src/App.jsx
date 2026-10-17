import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';

const rp = n => 'Rp' + Number(n).toLocaleString('id-ID');
const TABS = ['Ringkasan', 'Pembayaran', 'Pengeluaran', 'Laporan'];

function Login({ onError, onDone }) {
  const submit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) onError('Gagal masuk: ' + error.message);
    else { onError(''); onDone(); }
  };
  return (
    <form className="row" onSubmit={submit}>
      <input name="email" type="email" placeholder="Email bendahara" required />
      <input name="password" type="password" placeholder="Kata sandi" required />
      <button>Masuk</button>
    </form>
  );
}

export default function App() {
  const [tab, setTab] = useState(TABS[0]);
  const [role, setRole] = useState('viewer');
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [err, setErr] = useState('');
  const [d, setD] = useState({ members: [], periods: [], payments: [], expenses: [] });
  const isT = role === 'treasurer';

  const load = useCallback(async () => {
    const [m, p, pay, e] = await Promise.all([
      supabase.from('members').select('*').eq('active', true).order('name'),
      supabase.from('periods').select('*').order('due_date'),
      supabase.from('payments').select('*'),
      supabase.from('expenses').select('*').order('spent_on', { ascending: false }),
    ]);
    const bad = [m, p, pay, e].find(r => r.error);
    if (bad) return setErr('Gagal memuat data: ' + bad.error.message);
    setD({ members: m.data, periods: p.data, payments: pay.data, expenses: e.data });
  }, []);

  useEffect(() => {
    const apply = async s => {
      setUser(s?.user ?? null);
      if (!s) return setRole('viewer');
      const { data } = await supabase.from('profiles').select('role').eq('id', s.user.id).single();
      setRole(data?.role ?? 'viewer');
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setTimeout(() => apply(s), 0));
    load();
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const run = async q => {
    const { error } = await q;
    if (error) setErr(error.message); else { setErr(''); load(); }
  };

  const totalIn = d.payments.reduce((a, x) => a + x.amount_paid, 0);
  const totalOut = d.expenses.reduce((a, x) => a + x.amount, 0);
  const due = d.periods.reduce((a, x) => a + x.amount, 0);
  const paidBy = id => d.payments.filter(x => x.member_id === id).reduce((a, x) => a + x.amount_paid, 0);
  const status = id => { const p = paidBy(id); return due > 0 && p >= due ? 'Lunas' : p > 0 ? 'Kurang' : 'Belum'; };
  const hasPaid = (m, p) => d.payments.find(x => x.member_id === m && x.period_id === p);
  const lunas = d.members.filter(m => status(m.id) === 'Lunas').length;

  const togglePay = (m, p) => {
    const ex = hasPaid(m.id, p.id);
    return run(ex
      ? supabase.from('payments').delete().eq('id', ex.id)
      : supabase.from('payments').insert({ member_id: m.id, period_id: p.id, amount_paid: p.amount }));
  };

  const addExpense = async e => {
    e.preventDefault();
    const form = e.target, f = new FormData(form), file = f.get('nota');
    let path = null;
    if (file && file.size) {
      path = Date.now() + '-' + file.name.replace(/[^\w.-]/g, '_');
      const up = await supabase.storage.from('receipts').upload(path, file);
      if (up.error) return setErr('Gagal mengunggah nota: ' + up.error.message);
    }
    await run(supabase.from('expenses').insert({ spent_on: f.get('tgl'), description: f.get('ket'), amount: Number(f.get('jml')), receipt_path: path }));
    form.reset();
  };

  const openNota = async path => {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 60);
    if (error) setErr('Gagal membuka nota: ' + error.message); else window.open(data.signedUrl, '_blank', 'noopener');
  };

  const exportCsv = () => {
    const rows = [
      ['Nama', ...d.periods.map(p => p.label), 'Total dibayar', 'Status'],
      ...d.members.map(m => [m.name, ...d.periods.map(p => (hasPaid(m.id, p.id) ? 'Lunas' : '-')), paidBy(m.id), status(m.id)]),
      [], ['Pengeluaran'], ['Tanggal', 'Keterangan', 'Jumlah'],
      ...d.expenses.map(x => [x.spent_on, x.description, x.amount]),
      [], ['Saldo kas', totalIn - totalOut],
    ];
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = 'laporan-kas.csv';
    a.click();
  };

  return (
    <main>
      <header>
        <h1>Kas kelas</h1>
        {user
          ? <button onClick={() => supabase.auth.signOut()}>Keluar ({isT ? 'bendahara' : 'pengunjung'})</button>
          : <button onClick={() => setShowLogin(!showLogin)}>Masuk sebagai bendahara</button>}
      </header>
      {showLogin && !user && <Login onError={setErr} onDone={() => setShowLogin(false)} />}
      {err && <p className="err" role="alert">{err}</p>}
      <nav aria-label="Bagian">
        {TABS.map(t => <button key={t} aria-current={t === tab ? 'page' : undefined} onClick={() => setTab(t)}>{t}</button>)}
      </nav>

      {tab === 'Ringkasan' && <>
        <p className="muted">Saldo kas saat ini</p>
        <div className="balance">{rp(totalIn - totalOut)}</div>
        <div className="stats">
          <div>Pemasukan<b>{rp(totalIn)}</b></div>
          <div>Pengeluaran<b>{rp(totalOut)}</b></div>
          <div>Sudah lunas<b>{lunas} dari {d.members.length} orang</b></div>
        </div>
        <h2>Belum lunas</h2>
        {d.members.filter(m => status(m.id) !== 'Lunas').length === 0
          ? <p className="muted">Semua anggota sudah lunas, atau belum ada periode iuran.</p>
          : <div className="scroll"><table><tbody>
              {d.members.filter(m => status(m.id) !== 'Lunas').map(m => (
                <tr key={m.id}><td>{m.name}</td><td className={status(m.id)}>{status(m.id)}</td><td className="n">kurang {rp(due - paidBy(m.id))}</td></tr>
              ))}
            </tbody></table></div>}
      </>}

      {tab === 'Pembayaran' && <>
        {isT && <>
          <form className="row" onSubmit={e => { e.preventDefault(); const f = e.target; run(supabase.from('members').insert({ name: f.nama.value })); f.reset(); }}>
            <input name="nama" placeholder="Nama anggota baru" required /><button>Tambah anggota</button>
          </form>
          <form className="row" onSubmit={e => { e.preventDefault(); const f = e.target; run(supabase.from('periods').insert({ label: f.label.value, amount: Number(f.jml.value), due_date: f.tgl.value })); f.reset(); }}>
            <input name="label" placeholder="Periode, mis. Minggu 1 Okt" required />
            <input name="jml" type="number" min="1" placeholder="Iuran per orang" required />
            <input name="tgl" type="date" required /><button>Tambah periode</button>
          </form>
        </>}
        {d.periods.length === 0 ? <p className="muted">Belum ada periode iuran. {isT ? 'Tambahkan periode di atas.' : ''}</p> :
          <div className="scroll"><table>
            <thead><tr><th>Nama</th>{d.periods.map(p => <th key={p.id}>{p.label}<br /><small className="muted">{rp(p.amount)}</small></th>)}<th>Status</th></tr></thead>
            <tbody>{d.members.map(m => (
              <tr key={m.id}><td>{m.name}</td>
                {d.periods.map(p => {
                  const ok = !!hasPaid(m.id, p.id);
                  return <td key={p.id}>{isT
                    ? <button className="cell" aria-label={`${ok ? 'Batalkan' : 'Catat'} pembayaran ${m.name}, ${p.label}`} onClick={() => togglePay(m, p)}>{ok ? '✓' : '–'}</button>
                    : (ok ? <span className="Lunas">✓</span> : <span className="muted">–</span>)}</td>;
                })}
                <td className={status(m.id)}>{status(m.id)}</td></tr>
            ))}</tbody>
          </table></div>}
      </>}

      {tab === 'Pengeluaran' && <>
        {isT && <form className="row" onSubmit={addExpense}>
          <input name="tgl" type="date" required />
          <input name="ket" placeholder="Keterangan" required />
          <input name="jml" type="number" min="1" placeholder="Jumlah" required />
          <input name="nota" type="file" accept="image/*,application/pdf" aria-label="Foto nota" />
          <button>Simpan pengeluaran</button>
        </form>}
        {d.expenses.length === 0 ? <p className="muted">Belum ada pengeluaran.</p> :
          <div className="scroll"><table>
            <thead><tr><th>Tanggal</th><th>Keterangan</th><th className="n">Jumlah</th><th>Nota</th></tr></thead>
            <tbody>{d.expenses.map(x => (
              <tr key={x.id}><td>{x.spent_on}</td><td>{x.description}</td><td className="n">{rp(x.amount)}</td>
                <td>{x.receipt_path ? <button className="cell" onClick={() => openNota(x.receipt_path)}>Lihat</button> : <span className="muted">tidak ada</span>}</td></tr>
            ))}</tbody>
          </table></div>}
      </>}

      {tab === 'Laporan' && <>
        <p>Unduh rekap pembayaran per anggota, daftar pengeluaran, dan saldo kas dalam satu file CSV yang bisa dibuka di Excel atau Google Sheets.</p>
        <button onClick={exportCsv}>Unduh laporan CSV</button>
      </>}
    </main>
  );
}

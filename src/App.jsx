import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { configured } from './lib/supabase.js';
import { ToastProvider } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login, { Pending, NotConfigured } from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Patients from './pages/Patients.jsx';
import PatientProfile from './pages/PatientProfile.jsx';
import Visit from './pages/Visit.jsx';
import Appointments from './pages/Appointments.jsx';
import { Billing, Invoice } from './pages/Billing.jsx';
import Settings, { SyncIssues } from './pages/Settings.jsx';

// Heavier screens load on demand (still cached for offline use).
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Docs = {
  Rx: lazy(() => import('./print/Documents.jsx').then((m) => ({ default: m.PrescriptionDoc }))),
  Letter: lazy(() => import('./print/Documents.jsx').then((m) => ({ default: m.LetterDoc }))),
  Invoice: lazy(() => import('./print/Documents.jsx').then((m) => ({ default: m.InvoiceDoc }))),
  Receipt: lazy(() => import('./print/Documents.jsx').then((m) => ({ default: m.ReceiptDoc }))),
};

const Loading = () => <div className="center-page muted">Loading…</div>;

// Route guard: the database (RLS) is the real protection; this keeps the
// screens tidy and stops reception users landing on doctor pages.
function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/" replace />;
}

export function Gate() {
  const { loading, user, profile } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  if (!profile?.active) return <Pending />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Documents open full-page (no sidebar) so they print cleanly. */}
        <Route path="/print/rx/:id" element={<AdminOnly><Docs.Rx /></AdminOnly>} />
        <Route path="/print/letter/:id" element={<AdminOnly><Docs.Letter /></AdminOnly>} />
        <Route path="/print/invoice/:id" element={<Docs.Invoice />} />
        <Route path="/print/receipt/:id" element={<Docs.Receipt />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="patients" element={<Patients />} />
          <Route path="patients/:id" element={<PatientProfile />} />
          <Route path="billing" element={<Billing />} />
          <Route path="invoices/:id" element={<Invoice />} />
          <Route path="sync" element={<SyncIssues />} />
          <Route path="visits/:id" element={<AdminOnly><Visit /></AdminOnly>} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="reports" element={<AdminOnly><Reports /></AdminOnly>} />
          <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  if (!configured) return <NotConfigured />;
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <AuthProvider><Gate /></AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

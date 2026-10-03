import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.js';
import { subscribe } from './sync.js';

export const useSettings = () => useLiveQuery(() => db().clinic_settings.get(1), [], undefined);
export const useDoctors = () => useLiveQuery(() => db().doctors.toArray(), [], [])
  .filter((d) => d.active !== false).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
export const useAllDoctors = () => useLiveQuery(() => db().doctors.toArray(), [], []);
export const useServices = () => useLiveQuery(() => db().clinic_services.toArray(), [], [])
  .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
export const usePatient = (id) => useLiveQuery(() => (id ? db().patients.get(id) : undefined), [id]);

export function useSync() {
  const [s, setS] = useState({ status: 'online', pending: 0, errors: 0 });
  useEffect(() => subscribe(setS), []);
  return s;
}

export function useDoctorMap() {
  const all = useAllDoctors();
  return Object.fromEntries(all.map((d) => [d.id, d]));
}

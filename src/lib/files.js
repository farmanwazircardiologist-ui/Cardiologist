// Patient reports (outside ECG, Echo, labs, discharge papers…).
// The file goes to the private Storage bucket "patient-files"; only a small
// description row (patient_files) is synced for offline lists. Uploading and
// opening a file need internet.
import { supabase } from './supabase.js';
import { insertRow, uuid } from './repo.js';
import { todayISO } from './format.js';

export const BUCKET = 'patient-files';
export const MAX_BYTES = 15 * 1024 * 1024;

export const FILE_CATEGORIES = [
  ['ecg', 'ECG'], ['echo', 'Echo'], ['angiography', 'Angiography'], ['ett', 'ETT'], ['holter', 'Holter / ABPM'],
  ['lab', 'Lab report'], ['xray', 'X-ray'], ['discharge', 'Discharge summary'], ['prescription', 'Old prescription'], ['other', 'Other'],
];
export const categoryLabel = (k) => (FILE_CATEGORIES.find((x) => x[0] === k) || [k, k])[1];

// Phone photos are 3–8 MB; shrink to ~1800 px JPEG so they stay readable
// but upload quickly and keep storage small.
export async function compressImage(file, maxSide = 1800, quality = 0.82) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPatientFile({ file, patientId, visitId = null, category = 'other', title = '', fileDate = todayISO() }) {
  if (!file) throw new Error('Choose a photo or PDF first.');
  if (navigator.onLine === false) throw new Error('Uploading needs internet. Connect and try again.');
  const isImage = /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type);
  const isPdf = file.type === 'application/pdf';
  if (!isImage && !isPdf) throw new Error('Only photos (JPG, PNG) and PDF files can be uploaded.');
  let body = file;
  let mime = file.type;
  if (isImage) {
    try { body = await compressImage(file); mime = body.type || 'image/jpeg'; }
    catch { if (/heic|heif/.test(file.type)) throw new Error('This photo format is not supported. Set the phone camera to JPG ("Most compatible") and take the photo again.'); }
  }
  if (body.size > MAX_BYTES) throw new Error('File is larger than 15 MB. Take a photo instead of a scan, or split the PDF.');
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const id = uuid();
  const path = `${patientId}/${id}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: mime, upsert: false });
  if (error) {
    if (/bucket/i.test(error.message)) throw new Error('Report storage is not set up. Run final_supabase.sql again in Supabase.');
    throw new Error('Upload failed: ' + error.message);
  }
  return insertRow('patient_files', {
    id, patient_id: patientId, visit_id: visitId, category, title: title.trim() || null,
    file_date: fileDate || todayISO(), storage_path: path, mime_type: mime, size_bytes: body.size,
  });
}

// Short-lived private link to view a report.
export async function fileUrl(row, seconds = 600) {
  if (navigator.onLine === false) throw new Error('Opening a report needs internet.');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, seconds);
  if (error) throw new Error('Could not open the file: ' + error.message);
  return data.signedUrl;
}

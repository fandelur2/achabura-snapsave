'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mime = require('mime-types');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim()).filter(Boolean);
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_LOCATION = process.env.FFMPEG_LOCATION || '';
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 1800);
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 524288000); // 500 MB
const FILE_TTL_MS = Number(process.env.FILE_TTL_MINUTES || 60) * 60 * 1000;
const STORE_DIR = path.resolve(process.env.STORE_DIR || path.join(__dirname, 'media-cache'));
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS || 180000);

fs.mkdirSync(STORE_DIR, { recursive: true });
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin tidak diizinkan oleh konfigurasi CORS.'));
  },
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Content-Type', 'Content-Disposition'],
  maxAge: 86400,
}));
app.use(express.json({ limit: '16kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));

const jobs = new Map();
const supportedHosts = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'instagram.com', 'facebook.com', 'fb.watch',
  'tiktok.com', 'vm.tiktok.com', 'twitter.com', 'x.com', 'vimeo.com', 'reddit.com', 'redd.it',
  'pinterest.com', 'pin.it', 'dailymotion.com', 'twitch.tv', 'streamable.com', 'snapchat.com',
  'soundcloud.com', 'bilibili.com', 'likee.video', 'threads.net'
];

function validateSourceUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('URL tidak valid.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Hanya URL HTTP/HTTPS yang diizinkan.');
  if (u.username || u.password) throw new Error('URL yang berisi kredensial tidak diizinkan.');
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = supportedHosts.some(d => host === d || host.endsWith(`.${d}`));
  if (!allowed) throw new Error('Domain belum didukung oleh konfigurasi backend ini.');
  return u.toString();
}

function runYtDlp(args, timeoutMs = JOB_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const finalArgs = [...args];
    if (FFMPEG_LOCATION) finalArgs.unshift('--ffmpeg-location', FFMPEG_LOCATION);
    const child = spawn(YTDLP_PATH, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Proses ekstraksi melewati batas waktu.')); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 5_000_000) { child.kill('SIGKILL'); } });
    child.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000); });
    child.on('error', err => { clearTimeout(timer); reject(new Error(`Tidak bisa menjalankan yt-dlp: ${err.message}. Pastikan yt-dlp terpasang.`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(safeYtDlpError(stderr)));
      resolve({ stdout, stderr });
    });
  });
}

function safeYtDlpError(stderr) {
  const lines = stderr.split(/\r?\n/).filter(Boolean);
  const last = lines.slice(-3).join(' ');
  if (/private|login|sign in|members-only|authentication/i.test(last)) return 'Konten privat atau memerlukan login. Backend ini tidak melewati pembatasan akses.';
  if (/copyright|unavailable|not available|unsupported url/i.test(last)) return 'Media tidak tersedia atau URL tidak didukung oleh yt-dlp.';
  return (last || 'Ekstraksi gagal. Periksa URL dan versi yt-dlp.').slice(0, 500);
}

function safeFilename(name, ext) {
  const base = String(name || 'video').normalize('NFKD').replace(/[^\w\-. ]+/g, '').trim().replace(/[ .]+/g, '_').slice(0, 100) || 'video';
  return `${base}${ext}`;
}

function isAllowedMediaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.avi'].includes(ext);
}

function mediaMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const known = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.avi': 'video/x-msvideo' };
  return known[ext] || mime.lookup(filePath) || 'application/octet-stream';
}

async function cleanupExpired() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > FILE_TTL_MS) {
      jobs.delete(id);
      await fsp.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
setInterval(() => cleanupExpired().catch(() => {}), 5 * 60 * 1000).unref();

app.get('/health', (_req, res) => res.json({ ok: true, service: 'snapsave-backend' }));

app.get('/api/extract', async (req, res) => {
  let sourceUrl;
  try { sourceUrl = validateSourceUrl(String(req.query.url || '')); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = crypto.randomUUID();
  const jobDir = path.join(STORE_DIR, id);
  await fsp.mkdir(jobDir, { recursive: true });
  try {
    const infoResult = await runYtDlp(['--no-warnings', '--no-playlist', '--dump-single-json', '--skip-download', '--', sourceUrl]);
    let info;
    try { info = JSON.parse(infoResult.stdout); } catch { throw new Error('Metadata media tidak dapat dibaca.'); }
    if (info.is_live) throw new Error('Live stream tidak didukung oleh endpoint ini.');
    if (Number(info.duration || 0) > MAX_DURATION_SECONDS) throw new Error(`Durasi melebihi batas ${Math.floor(MAX_DURATION_SECONDS / 60)} menit.`);

    // Download to server cache, then serve a local URL. This avoids relying on CDN CORS,
    // expiring signed URLs, or remote Content-Type headers in the browser.
    const outputTemplate = path.join(jobDir, 'media.%(ext)s');
    const downloadArgs = ['--no-warnings', '--no-playlist', '--no-part', '--max-filesize', String(MAX_FILE_BYTES), '-f', 'best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]', '-o', outputTemplate, '--', sourceUrl];
    await runYtDlp(downloadArgs, JOB_TIMEOUT_MS);
    const files = (await fsp.readdir(jobDir)).filter(f => !f.endsWith('.part'));
    if (!files.length) throw new Error('File media tidak berhasil diunduh.');
    let filePath = path.join(jobDir, files[0]);
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size === 0) throw new Error('File hasil ekstraksi kosong.');
    if (stat.size > MAX_FILE_BYTES) throw new Error('Ukuran media melewati batas server.');
    if (!isAllowedMediaFile(filePath)) throw new Error(`Format ${path.extname(filePath)} belum didukung untuk preview. Coba media dengan format MP4 atau WebM.`);

    const ext = path.extname(filePath).toLowerCase();
    const filename = safeFilename(info.title || info.id || 'video', ext);
    const storedName = `media${ext}`;
    if (path.basename(filePath) !== storedName) {
      const newPath = path.join(jobDir, storedName);
      await fsp.rename(filePath, newPath);
      filePath = newPath;
    }
    jobs.set(id, { dir: jobDir, filePath, filename, title: info.title || 'Video', createdAt: Date.now(), mime: mediaMime(filePath), size: stat.size });

    const mediaUrl = `${PUBLIC_BASE_URL}/api/media/${id}`;
    return res.json({
      platform: info.extractor_key || info.extractor || 'Media',
      title: info.title || 'Video',
      duration: info.duration || null,
      thumbnail: info.thumbnail || null,
      media: [{ url: mediaUrl, downloadUrl: `${mediaUrl}?download=1`, type: 'video', quality: 'Best available', mime: mediaMime(filePath), filename, size: stat.size }],
      expiresInMinutes: Math.floor(FILE_TTL_MS / 60000)
    });
  } catch (e) {
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    return res.status(422).json({ error: e.message || 'Ekstraksi gagal.' });
  }
});

app.get('/api/media/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Media tidak ditemukan atau sudah kedaluwarsa. Ekstrak ulang URL sumber.' });
  try {
    const stat = await fsp.stat(job.filePath);
    const download = req.query.download === '1';
    res.setHeader('Content-Type', job.mime);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(job.filename)}`);
    // Express/send supports byte ranges so HTML video controls can seek correctly.
    return res.sendFile(job.filePath, { acceptRanges: true, cacheControl: false }, err => {
      if (err && !res.headersSent) res.status(err.statusCode || 500).end();
    });
  } catch {
    return res.status(500).json({ error: 'Gagal membaca file media.' });
  }
});

app.use((err, _req, res, _next) => {
  if (err && /CORS/i.test(err.message || '')) return res.status(403).json({ error: err.message });
  return res.status(500).json({ error: 'Terjadi kesalahan server.' });
});

app.listen(PORT, () => console.log(`SnapSave backend berjalan di ${PUBLIC_BASE_URL}`));

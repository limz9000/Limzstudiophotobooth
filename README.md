# 🚀 Limz Studio Photobooth - Vercel & GitHub Wrapper

Pembungkus (wrapper) modern untuk aplikasi **Limz Studio Photobooth (Google Apps Script)** agar:
1. **100% Menghilangkan Notice Keamanan Google Apps Script** di bagian atas layar:
   > *"Aplikasi ini dibuat oleh pengguna Google Apps Script | Laporkan penyalahgunaan | Pelajari lebih lanjut | ✕"*
2. **Memberikan URL Cantik & Profesional** (contoh: `namaproject.vercel.app/tes3` atau domain kustom Anda `gallery.limzstudio.com/tes3`).
3. **Mendukung Live Monitor & Galeri** tanpa lag dan tanpa glitch tampilan.

---

## 📁 Struktur File Wrapper
```text
vercel-wrapper/
├── index.html        # Wrapper cerdas dengan preloader halus & auto routing URL
├── vercel.json       # Konfigurasi rewrite SPA agar semua slug URL berjalan mulus
├── package.json      # Metadata project
├── .gitignore        # File ignore standar
└── README.md         # Panduan cara pakai & deploy
```

---

## ⚡ Langkah Cepat Deploy ke GitHub & Vercel (Hanya 2 Menit)

### Langkah 1: Siapkan URL Web App Google Apps Script Anda
1. Buka project Google Apps Script Anda di browser.
2. Klik tombol **Deploy** (kanan atas) ➔ **Manage deployments** ➔ salin URL Web App yang berakhiran `/exec`.
   Contoh:
   `https://script.google.com/macros/s/AKfycbxxxxxxxxx/exec`

### Langkah 2: Masukkan URL ke `index.html` (Opsional tapi Sangat Direkomendasikan)
Buka file `vercel-wrapper/index.html` baris **205**, masukkan URL Web App Anda:
```javascript
var DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbxxxxxxxxx/exec";
```
*(Jika dikosongkan, web akan otomatis memunculkan pop-up formulir sekali di awal untuk mengisinya).*

---

### Langkah 3: Push ke GitHub
Anda bisa mengunggah isi folder `vercel-wrapper/` ke repositori baru di GitHub:
```bash
cd vercel-wrapper
git init
git add .
git commit -m "feat: initial vercel wrapper deployment"
git branch -M main
git remote add origin https://github.com/USERNAME_ANDA/NAMA_REPO_ANDA.git
git push -u origin main
```
*Atau cukup upload file `index.html`, `vercel.json`, `package.json` langsung via menu **Upload files** di GitHub.*

---

### Langkah 4: Hubungkan ke Vercel
1. Buka [https://vercel.com](https://vercel.com) dan login dengan akun GitHub Anda.
2. Klik tombol **"Add New..."** ➔ **"Project"**.
3. Pilih repositori GitHub yang baru saja Anda buat, lalu klik **"Import"**.
4. Di bagian konfigurasi:
   - **Framework Preset**: Pilih **Other**
   - **Root Directory**: `./` (atau pilih folder `vercel-wrapper` jika Anda deploy satu repo penuh)
   - **Build & Output Settings**: Biarkan default (kosong).
5. Klik **Deploy**! 🚀

---

## 🌐 Cara Menggunakan URL Setelah Berhasil Deploy

Setelah Vercel memberikan domain (misal: `https://limz-booth.vercel.app`):

| Halaman | Format URL di Vercel |
| :--- | :--- |
| **Halaman Utama / Admin** | `https://limz-booth.vercel.app/` |
| **Galeri Publik Event** | `https://limz-booth.vercel.app/tes3` *(ganti `tes3` dengan slug event)* |
| **Live Monitor / Slideshow** | `https://limz-booth.vercel.app/tes3/monitor` |
| **Detail Foto Langsung** | `https://limz-booth.vercel.app/tes3/p/FOTO_ID` |

Semua halaman akan terbuka dalam layar penuh (100dvh) **tanpa ada banner notice Google Apps Script sama sekali**, responsif di semua HP, tablet, dan PC monitor!

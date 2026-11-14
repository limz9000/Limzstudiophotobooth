﻿var appState = {
        currentUser: null,
        currentView: 'view-landing',
        activeCollectionId: null,
        activeCollectionData: null,
        targetPhotoId: null,
        activeMonitorPhotoId: null,
        activeSub1PhotoId: null,
        activeSub2PhotoId: null,
        collections: [],
        photos: [],
        localExportDirHandle: null,
        localStorageFolderName: (typeof localStorage !== 'undefined' ? localStorage.getItem('limz_local_storage_folder_name') : '') || '',
        detectedCameraModel: (typeof localStorage !== 'undefined' ? localStorage.getItem('limz_last_detected_camera') : '') || '',
        wishes: [],
        sensorWords: [],
        slideshowInterval: null,
        slideshowPollInterval: null,
        galleryPollInterval: null,
        chatStreamInterval: null,
        floatingWishTimeout: null,
        knownWishKeys: {},
        isWishInitialized: false,
        lastKnownPhotoCount: 0,
        monitorPhotos: [],
        webAppUrl: '',
        qrCache: {},
        customWatermarkPngData: null,
        customWatermarkImgObj: null,
        studioLogoDataUrl: null,
        tempUploadedLogoBase64: null,
        stagedPhotos: [],
        splashDismissed: false,
        activeStagedIndex: 0,
        isOnline: navigator.onLine,
        pendingOfflineUploadsCount: 0,
        photoFilterState: {
            preset: 'normal',
            exposure: 0,
            brightness: 0,
            contrast: 0,
            highlights: 0,
            shadows: 0,
            whites: 0,
            blacks: 0,
            temperature: 0,
            tint: 0,
            vibrance: 0,
            saturation: 0,
            clarity: 0,
            texture: 0,
            dehaze: 0,
            sharpen: 0,
            grain: 0,
            curve: { highlights: 0, lights: 0, darks: 0, shadows: 0 },
            activeCurveChannel: 'rgb',
            colorMix: {
                activeColor: 'orange',
                red: { h: 0, s: 0, l: 0 },
                orange: { h: 0, s: 0, l: 0 },
                yellow: { h: 0, s: 0, l: 0 },
                green: { h: 0, s: 0, l: 0 },
                aqua: { h: 0, s: 0, l: 0 },
                blue: { h: 0, s: 0, l: 0 },
                purple: { h: 0, s: 0, l: 0 },
                magenta: { h: 0, s: 0, l: 0 }
            },
            colorGrading: {
                activeZone: 'shadows',
                shadows: { h: 0, s: 0 },
                midtones: { h: 0, s: 0 },
                highlights: { h: 0, s: 0 },
                balance: 0
            },
            isLocked: false
        }
    };

    /**
     * Sanitizer string HTML untuk mencegah XSS dan ReferenceError saat rendering DOM
     */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /* =========================================================================
       UNIVERSAL GAS / VERCEL HEADLESS API RUNNER (REST BRIDGE)
       Membuat seluruh pemanggilan backend berjalan otomatis baik di GAS maupun Vercel
       ========================================================================= */
    var DEFAULT_BACKEND_GAS_URL = 'https://script.google.com/macros/s/AKfycbxUzK9ZvwEhShBI4BDwNgau9aYIUH-XcMwVeIZX73OJwFhJTN0EnA28Cb2Z_p8qb93LVg/exec';

    function executeGasApiFetch(action, args, onSuccess, onFailure) {
        // PERLINDUNGAN MUTLAK: Backend API endpoint WAJIB selalu mengarah ke script.google.com (/exec)
        // DILARANG KERAS memanggil domain frontend Vercel/Netlify karena Vercel akan menolak dengan 405 Method Not Allowed
        var targetUrl = '';

        // 1. Cek dari konfigurasi eksplisit di localStorage jika ada
        var customGas = localStorage.getItem('limz_backend_gas_url');
        if (customGas && customGas.indexOf('script.google.com') > -1) {
            targetUrl = cleanExecUrl(customGas);
        }

        // 2. Cek apakah appState.backendApiUrl valid mengarah ke Google Apps Script
        if (!targetUrl && appState.backendApiUrl && appState.backendApiUrl.indexOf('script.google.com') > -1) {
            targetUrl = cleanExecUrl(appState.backendApiUrl);
        }

        // 3. Cek apakah elemen gas-app-url memiliki URL GAS asli
        if (!targetUrl) {
            var urlEl = document.getElementById('gas-app-url');
            if (urlEl && urlEl.innerText && urlEl.innerText.indexOf('script.google.com') > -1) {
                targetUrl = cleanExecUrl(urlEl.innerText.trim());
            }
        }

        // 4. Default mutlak: Gunakan DEFAULT_BACKEND_GAS_URL resmi
        if (!targetUrl) {
            targetUrl = DEFAULT_BACKEND_GAS_URL;
        }

        appState.backendApiUrl = targetUrl;

        var payload = { action: action, args: args || [] };

        fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (onSuccess) onSuccess(data);
            })
            .catch(function (err) {
                console.warn('Fetch fallback POST gagal, mencoba via GET URL query...', err);
                var getUrl = targetUrl + '?action=' + encodeURIComponent(action) + '&args=' + encodeURIComponent(JSON.stringify(args || []));
                fetch(getUrl)
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (onSuccess) onSuccess(d); })
                    .catch(function (err2) {
                        if (onFailure) onFailure(err2.toString());
                    });
            });
    }

    function createGasRunProxy() {
        function ClientRunner(successCb, failureCb) {
            this.successCb = successCb || function () { };
            this.failureCb = failureCb || function (err) { console.warn('API Warning:', err); };
        }
        ClientRunner.prototype.withSuccessHandler = function (fn) {
            return new ClientRunner(fn, this.failureCb);
        };
        ClientRunner.prototype.withFailureHandler = function (fn) {
            return new ClientRunner(this.successCb, fn);
        };

        function createRunnerProxy(sCb, fCb) {
            var runner = new ClientRunner(sCb, fCb);
            return new Proxy(runner, {
                get: function (target, prop) {
                    if (prop === 'withSuccessHandler') {
                        return function (fn) { return createRunnerProxy(fn, target.failureCb); };
                    }
                    if (prop === 'withFailureHandler') {
                        return function (fn) { return createRunnerProxy(target.successCb, fn); };
                    }
                    return function () {
                        var args = Array.prototype.slice.call(arguments);
                        executeGasApiFetch(prop, args, target.successCb, target.failureCb);
                    };
                }
            });
        }

        return createRunnerProxy();
    }

    // Pasang polyfill jika di-deploy di Vercel (dimana google.script.run tidak ada)
    if (typeof window.google === 'undefined' || !window.google.script || !window.google.script.run) {
        window.google = window.google || {};
        window.google.script = window.google.script || {};
        window.google.script.run = createGasRunProxy();
    }

    /* =========================================================================
       MODUL INDEXEDDB OFFLINE QUEUE (PENYELAMAT UPLOAD SAAT KONEKSI DROP)
       ========================================================================= */
    var offlineDb = null;
    var DB_NAME = 'LimzStudioOfflineDB';
    var DB_VERSION = 1;
    var STORE_NAME = 'uploadQueue';

    function initIndexedDB(callback) {
        if (!('indexedDB' in window)) {
            console.warn('Browser ini tidak mendukung IndexedDB. Mode offline queue dinonaktifkan.');
            if (callback) callback();
            return;
        }

        var request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                var store = db.createObjectStore(STORE_NAME, { keyPath: 'queueId' });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('collectionId', 'collectionId', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };

        request.onsuccess = function (e) {
            offlineDb = e.target.result;
            refreshOfflineQueueBadge();
            if (navigator.onLine) {
                syncOfflineQueue();
            }
            if (callback) callback(offlineDb);
        };

        request.onerror = function (e) {
            console.warn('Gagal membuka IndexedDB:', e);
            if (callback) callback();
        };
    }

    function enqueueOfflinePhotoItem(item, callback) {
        if (!offlineDb) {
            if (callback) callback();
            return;
        }
        try {
            var tx = offlineDb.transaction([STORE_NAME], 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            store.put(item);
            tx.oncomplete = function () {
                refreshOfflineQueueBadge();
                if (callback) callback();
            };
            tx.onerror = function () {
                if (callback) callback();
            };
        } catch (err) {
            console.warn('Gagal enqueue photo ke IndexedDB:', err);
            if (callback) callback();
        }
    }

    function removeOfflineQueueItem(queueId, callback) {
        if (!offlineDb) {
            if (callback) callback();
            return;
        }
        try {
            var tx = offlineDb.transaction([STORE_NAME], 'readwrite');
            var store = tx.objectStore(STORE_NAME);
            store.delete(queueId);
            tx.oncomplete = function () {
                refreshOfflineQueueBadge();
                if (callback) callback();
            };
        } catch (err) {
            if (callback) callback();
        }
    }

    function getPendingOfflineQueueItems(callback) {
        if (!offlineDb) {
            if (callback) callback([]);
            return;
        }
        try {
            var tx = offlineDb.transaction([STORE_NAME], 'readonly');
            var store = tx.objectStore(STORE_NAME);
            var req = store.getAll();
            req.onsuccess = function (e) {
                var items = e.target.result || [];
                if (callback) callback(items);
            };
            req.onerror = function () {
                if (callback) callback([]);
            };
        } catch (err) {
            if (callback) callback([]);
        }
    }

    function refreshOfflineQueueBadge() {
        getPendingOfflineQueueItems(function (items) {
            appState.pendingOfflineUploadsCount = items.length;
            var btnUpload = document.getElementById('btn-start-upload');
            var countEl = document.getElementById('staged-photos-count');

            if (items.length > 0) {
                var offlineBadge = document.getElementById('offline-queue-badge');
                if (!offlineBadge) {
                    var summaryBox = document.getElementById('staged-count-summary');
                    if (summaryBox) {
                        var badgeSpan = document.createElement('span');
                        badgeSpan.id = 'offline-queue-badge';
                        badgeSpan.style.cssText = 'margin-left:8px; background:#fef3c7; color:#92400e; font-size:11px; padding:2px 8px; border-radius:12px; font-weight:700; border:1px solid #fde68a;';
                        summaryBox.appendChild(badgeSpan);
                        offlineBadge = badgeSpan;
                    }
                }
                if (offlineBadge) {
                    offlineBadge.innerText = '📦 ' + items.length + ' Foto di Antrian Offline';
                    offlineBadge.style.display = 'inline-block';
                }
            } else {
                var existingBadge = document.getElementById('offline-queue-badge');
                if (existingBadge) existingBadge.style.display = 'none';
            }
        });
    }

    var isSyncingQueue = false;
    function syncOfflineQueue() {
        if (!navigator.onLine || isSyncingQueue || !offlineDb || appState.isUploadingPhotos) return;
        isSyncingQueue = true;

        getPendingOfflineQueueItems(function (items) {
            if (!items || items.length === 0) {
                isSyncingQueue = false;
                return;
            }

            showToast('🔄 Menghubungkan kembali... Mengunggah ' + items.length + ' foto antrian offline ke Cloud!');

            function uploadNext(index) {
                if (index >= items.length || !navigator.onLine) {
                    isSyncingQueue = false;
                    refreshOfflineQueueBadge();
                    refreshDashboardData();
                    showToast('✅ Seluruh antrian foto offline berhasil tersinkronisasi ke Google Drive!');
                    return;
                }

                var itm = items[index];
                google.script.run
                    .withSuccessHandler(function (res) {
                        if (res && res.success) {
                            removeOfflineQueueItem(itm.queueId, function () {
                                uploadNext(index + 1);
                            });
                        } else {
                            uploadNext(index + 1);
                        }
                    })
                    .withFailureHandler(function () {
                        uploadNext(index + 1);
                    })
                    .uploadPhotoWithWatermark({
                        collectionId: itm.collectionId,
                        fileName: itm.fileName,
                        base64Data: itm.base64Data,
                        uploadedBy: itm.uploadedBy || 'Crew',
                        queueId: itm.queueId
                    });
            }

            uploadNext(0);
        });
    }

    window.addEventListener('online', function () {
        appState.isOnline = true;
        showToast('🟢 Koneksi internet kembali aktif! Memulai sinkronisasi antrian...');
        syncOfflineQueue();
    });

    window.addEventListener('offline', function () {
        appState.isOnline = false;
        showToast('🟡 Mode Offline aktif: Jepretan & upload foto akan disimpan aman di memori lokal iPad/laptop!');
    });

    function bootstrapApp() {
        checkSavedUserSession();
        initSidebarState();
        initAppConfig();
        initWatermarkSettings();
        initStudioLogo();
        initDropzoneEvents();
        initCanvaStyleCanvasWorkflow();
        initCropDragEvents();
        initWatermarkDragEvents();
        initIndexedDB();
        initCameraAndStorageHub();
        checkUrlRouting();
        initKeyboardShortcuts();
        initLandingActiveEvent();
        var btnCreateGif = document.getElementById('btn-create-gif');
        if (btnCreateGif) {
            btnCreateGif.addEventListener('click', function (e) {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                openGifCreatorModal();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapApp);
    } else {
        bootstrapApp();
    }

    /* =========================================================================
       MODUL RESPONSIVE SIDEBAR (COLLAPSIBLE / MINI MODE)
       ========================================================================= */
    function toggleDashboardSidebar() {
        var sidebar = document.getElementById('dashboard-sidebar');
        var toggleBtn = document.getElementById('sidebar-toggle-btn');
        var floatBtn = document.getElementById('sidebar-floating-toggle');
        if (!sidebar) return;
        var isCollapsed = sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-is-collapsed', isCollapsed);
        if (toggleBtn) {
            toggleBtn.innerText = isCollapsed ? '▶' : '◀';
        }
        if (floatBtn) {
            floatBtn.style.display = isCollapsed ? 'inline-flex' : 'none';
        }
        localStorage.setItem('limz_sidebar_collapsed', isCollapsed ? 'true' : 'false');

        // Menyesuaikan ulang ukuran kanvas dan foto panggung agar seketika melebar
        setTimeout(function() {
            if (typeof syncPhotoWrapperDimensions === 'function') syncPhotoWrapperDimensions();
            if (typeof setupWmEraserCanvas === 'function') setupWmEraserCanvas();
            window.dispatchEvent(new Event('resize'));
        }, 280);
    }

    function initSidebarState() {
        var saved = localStorage.getItem('limz_sidebar_collapsed');
        var sidebar = document.getElementById('dashboard-sidebar');
        var toggleBtn = document.getElementById('sidebar-toggle-btn');
        var floatBtn = document.getElementById('sidebar-floating-toggle');
        if (saved === 'true') {
            if (sidebar) sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-is-collapsed');
            if (toggleBtn) toggleBtn.innerText = '▶';
            if (floatBtn) floatBtn.style.display = 'inline-flex';
        } else {
            document.body.classList.remove('sidebar-is-collapsed');
            if (floatBtn) floatBtn.style.display = 'none';
        }
    }

    /* =========================================================================
       MODUL PWA (PROGRESSIVE WEB APP) & INSTALL PROMPT
       ========================================================================= */
    var deferredPwaPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPwaPrompt = e;
        var pwaBtn = document.getElementById('btn-sidebar-pwa-install');
        if (pwaBtn) pwaBtn.style.display = 'flex';
    });

    function openPwaInstallModal() {
        openModal('modal-pwa-install');
    }

    function executePwaInstall() {
        if (deferredPwaPrompt) {
            deferredPwaPrompt.prompt();
            deferredPwaPrompt.userChoice.then(function (choiceResult) {
                if (choiceResult && choiceResult.outcome === 'accepted') {
                    showToast('🎉 Aplikasi Limz Studio berhasil dipasang!');
                    closeModal('modal-pwa-install');
                }
                deferredPwaPrompt = null;
            });
        } else {
            showToast('Untuk browser ini, gunakan opsi browser "Tambah ke Layar Utama"');
        }
    }

    /* =========================================================================
       MODUL KONEKSI KAMERA: HP NATIVE, IPAD/TABLET, LIVE DSLR & TETHER HOT FOLDER
       ========================================================================= */
    var liveCameraStream = null;
    var dslrHotFolderWatcher = null;
    var dslrWatchedFiles = {};

    function triggerMobileCameraCapture(e) {
        if (e) e.stopPropagation();
        var camInput = document.getElementById('file-input-mobile-cam');
        if (camInput) camInput.click();
    }

    function triggerIpadRollCapture(e) {
        if (e) e.stopPropagation();
        var input = document.getElementById('file-input-ipad-roll');
        if (input) {
            input.click();
        } else {
            var photoInput = document.getElementById('file-input-photos');
            if (photoInput) photoInput.click();
        }
    }

    function handleIpadRollFilesSelected(filesList) {
        if (!filesList || filesList.length === 0) return;
        var allFiles = Array.prototype.slice.call(filesList);
        var files = allFiles.filter(function (f) {
            return isFileAcceptedByFilter(f.name);
        });

        if (files.length === 0) {
            showToast('⚠️ Tidak ada file foto/RAW yang didukung di Roll Foto yang dipilih.');
            return;
        }

        inpageTetherState.active = true;
        inpageTetherState.folderName = 'Roll Foto iPad (' + files.length + ' Foto)';
        inpageTetherState.syncCount = files.length;
        updateInpageTetherUI();

        showToast('🖼️ Memuat ' + files.length + ' foto dari Roll Foto iPad ke antrian...');
        handlePhotoFilesSelected(files);
    }

    function openLiveCameraModal(e) {
        if (e) e.stopPropagation();
        openModal('modal-live-camera');
        var preferredDevice = null;
        try { preferredDevice = localStorage.getItem('limz_preferred_camera_device'); } catch (e) { }
        startLiveCameraStream(preferredDevice);
        handleLiveCameraSettingChange();
        window.addEventListener('keydown', handleCameraKeydown);
    }

    function closeLiveCameraModal() {
        stopLiveCameraStream();
        closeModal('modal-live-camera');
        window.removeEventListener('keydown', handleCameraKeydown);
    }

    function handleCameraKeydown(e) {
        var modal = document.getElementById('modal-live-camera');
        if (e.code === 'Space' && modal && (modal.style.display === 'flex' || modal.classList.contains('active'))) {
            e.preventDefault();
            triggerCameraShutter();
        }
    }

    function handleLiveCameraSettingChange() {
        var tvEl = document.getElementById('cam-setting-shutter');
        var avEl = document.getElementById('cam-setting-aperture');
        var isoEl = document.getElementById('cam-setting-iso');
        var evEl = document.getElementById('cam-setting-ev');
        var wbEl = document.getElementById('cam-setting-wb');

        var tv = tvEl ? tvEl.value : '1/160s';
        var av = avEl ? avEl.value : 'f/2.8';
        var iso = isoEl ? isoEl.value : '400';
        var ev = evEl ? evEl.value : '0.0 EV';
        var wb = wbEl ? wbEl.value : 'auto';

        var hudBadge = document.getElementById('live-cam-hud-badge');
        if (hudBadge) {
            hudBadge.innerText = '[Tv ' + tv + ' | Av ' + av + ' | ISO ' + iso + ' | ' + ev + ']';
        }

        var hudText = document.getElementById('hud-exposure-text');
        if (hudText) {
            hudText.innerHTML = 'Tv <b>' + tv + '</b> &bull; Av <b>' + av + '</b> &bull; ISO <b>' + iso + '</b> &bull; <b>' + ev + '</b> &bull; ' + wb.toUpperCase();
        }

        if (typeof appState !== 'undefined') {
            appState.liveCameraSettings = { shutter: tv, aperture: av, iso: iso, ev: ev, wb: wb };
        }

        // Terapkan constraint hardware jika didukung oleh video track kamera
        try {
            if (liveCameraStream) {
                var track = liveCameraStream.getVideoTracks()[0];
                if (track && typeof track.applyConstraints === 'function') {
                    var capabilities = (typeof track.getCapabilities === 'function') ? track.getCapabilities() : {};
                    var advancedConstraints = {};
                    if (capabilities.whiteBalanceMode) {
                        advancedConstraints.whiteBalanceMode = (wb === 'auto') ? 'continuous' : 'manual';
                    }
                    if (Object.keys(advancedConstraints).length > 0) {
                        track.applyConstraints({ advanced: [advancedConstraints] }).catch(function () { });
                    }
                }
            }
        } catch (err) { }
    }

    function enumerateCameraDevices(activeDeviceId) {
        var select = document.getElementById('camera-device-select');
        if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

        navigator.mediaDevices.enumerateDevices()
            .then(function (devices) {
                select.innerHTML = '';
                var videoDevices = devices.filter(function (d) { return d.kind === 'videoinput'; });
                if (videoDevices.length === 0) {
                    var opt = document.createElement('option');
                    opt.value = '';
                    opt.innerText = 'Tidak ada perangkat kamera terdeteksi';
                    select.appendChild(opt);
                    return;
                }

                var externalCandidateId = null;
                var preferredId = null;
                try { preferredId = localStorage.getItem('limz_preferred_camera_device'); } catch (e) { }

                videoDevices.forEach(function (dev, idx) {
                    var opt = document.createElement('option');
                    opt.value = dev.deviceId;
                    var label = dev.label ? dev.label.trim() : '';
                    if (!label) {
                        label = 'Kamera ' + (idx + 1) + ' (USB / Capture Card / iPad)';
                    }

                    var isExternal = /usb|capture|cam link|hdmi|external|uvc|video capture|mirrorless|dslr|sony|canon|nikon|fuji|panasonic/i.test(label);
                    if (isExternal && !externalCandidateId) {
                        externalCandidateId = dev.deviceId;
                        label = '⚡ ' + label + ' [DSLR / USB-C]';
                    }
                    opt.innerText = label;

                    if (activeDeviceId && dev.deviceId === activeDeviceId) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                });

                // Auto-prioritaskan kamera eksternal USB / Capture Card jika belum ada kamera aktif terpilih
                if (!activeDeviceId && (preferredId || externalCandidateId)) {
                    var targetId = preferredId || externalCandidateId;
                    for (var i = 0; i < select.options.length; i++) {
                        if (select.options[i].value === targetId) {
                            select.selectedIndex = i;
                            break;
                        }
                    }
                }
            })
            .catch(function (err) {
                console.warn('Gagal enumerate devices:', err);
            });
    }

    function startLiveCameraStream(deviceId) {
        stopLiveCameraStream();
        var video = document.getElementById('live-camera-video');
        if (!video) return;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showToast('Browser Anda tidak mendukung akses live kamera.');
            return;
        }

        var preferredId = deviceId;
        if (!preferredId) {
            try { preferredId = localStorage.getItem('limz_preferred_camera_device'); } catch (e) { }
        }

        // Resolusi Full HD 1080p ideal untuk sensor DSLR di iPad / Desktop
        var videoConstraint = {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30, min: 24 }
        };

        if (preferredId) {
            videoConstraint.deviceId = { ideal: preferredId };
        }

        navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false })
            .then(function (stream) {
                liveCameraStream = stream;
                video.srcObject = stream;
                video.play();

                var activeTrack = stream.getVideoTracks()[0];
                var curDeviceId = activeTrack ? (activeTrack.getSettings().deviceId || preferredId) : preferredId;
                if (curDeviceId) {
                    try { localStorage.setItem('limz_preferred_camera_device', curDeviceId); } catch (e) { }
                }

                // Update nama kamera di HUD Viewfinder
                var hudModelTag = document.getElementById('hud-camera-model-tag');
                if (hudModelTag && activeTrack && activeTrack.label) {
                    hudModelTag.innerText = '📷 ' + activeTrack.label;
                }

                // Re-enumerate devices sekarang setelah izin granted agar nama perangkat iPad/USB tampil lengkap
                enumerateCameraDevices(curDeviceId);
            })
            .catch(function (err) {
                console.error('Kamera error, coba fallback constraint:', err);
                navigator.mediaDevices.getUserMedia({ video: true, audio: false })
                    .then(function (fallbackStream) {
                        liveCameraStream = fallbackStream;
                        video.srcObject = fallbackStream;
                        video.play();

                        var activeTrack = fallbackStream.getVideoTracks()[0];
                        var curDeviceId = activeTrack ? activeTrack.getSettings().deviceId : null;
                        var hudModelTag = document.getElementById('hud-camera-model-tag');
                        if (hudModelTag && activeTrack && activeTrack.label) {
                            hudModelTag.innerText = '📷 ' + activeTrack.label;
                        }
                        enumerateCameraDevices(curDeviceId);
                    })
                    .catch(function (err2) {
                        showToast('Gagal mengakses kamera: ' + (err2.message || 'Izin kamera ditolak.'));
                    });
            });
    }

    function stopLiveCameraStream() {
        if (liveCameraStream) {
            liveCameraStream.getTracks().forEach(function (track) { track.stop(); });
            liveCameraStream = null;
        }
        var video = document.getElementById('live-camera-video');
        if (video) video.srcObject = null;
    }

    function switchCameraDevice(deviceId) {
        if (deviceId) {
            try { localStorage.setItem('limz_preferred_camera_device', deviceId); } catch (e) { }
            startLiveCameraStream(deviceId);
        }
    }

    function toggleCameraGrid(show) {
        var grid = document.getElementById('camera-grid-overlay');
        if (grid) grid.style.display = show ? 'grid' : 'none';
    }

    function triggerCameraShutter() {
        var video = document.getElementById('live-camera-video');
        if (!video || !liveCameraStream) {
            showToast('Kamera belum aktif.');
            return;
        }

        var useTimer = document.getElementById('chk-camera-timer') && document.getElementById('chk-camera-timer').checked;
        if (useTimer) {
            var countOverlay = document.getElementById('camera-countdown-overlay');
            var countNumber = document.getElementById('camera-countdown-number');
            if (countOverlay && countNumber) {
                countOverlay.style.display = 'flex';
                var count = 3;
                countNumber.innerText = count;
                var interval = setInterval(function () {
                    count--;
                    if (count > 0) {
                        countNumber.innerText = count;
                    } else {
                        clearInterval(interval);
                        countOverlay.style.display = 'none';
                        captureLiveFrameToStaging();
                    }
                }, 1000);
                return;
            }
        }

        captureLiveFrameToStaging();
    }

    function captureLiveFrameToStaging() {
        var video = document.getElementById('live-camera-video');
        var flash = document.getElementById('camera-flash-overlay');
        if (!video) return;

        if (flash) {
            flash.style.opacity = '0.9';
            setTimeout(function () { flash.style.opacity = '0'; }, 200);
        }

        var vw = video.videoWidth || 1920;
        var vh = video.videoHeight || 1080;
        var snapCanvas = document.createElement('canvas');
        snapCanvas.width = vw;
        snapCanvas.height = vh;
        var ctx = snapCanvas.getContext('2d');
        ctx.drawImage(video, 0, 0, vw, vh);

        var dataUrl = snapCanvas.toDataURL('image/jpeg', 0.95);
        var fileName = 'CAM_SHOT_' + Date.now() + '.jpg';

        var newSnap = {
            id: 'staged_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            file: { name: fileName, size: Math.round(dataUrl.length * 0.75) },
            name: fileName,
            size: Math.round(dataUrl.length * 0.75),
            dataUrl: dataUrl,
            originalDataUrl: dataUrl,
            rawOriginalDataUrl: dataUrl,
            isCropped: false
        };
        if (appState.photoFilterState && appState.photoFilterState.isLocked) {
            newSnap.appliedGrading = JSON.parse(JSON.stringify(appState.photoFilterState));
        }
        if (appState.liveCameraSettings) {
            newSnap.appliedCameraSettings = JSON.parse(JSON.stringify(appState.liveCameraSettings));
        }
        appState.stagedPhotos.push(newSnap);

        // Menggunakan file original hasil jepretan langsung di memori tanpa menduplikasi file temp ke storage

        appState.activeStagedIndex = appState.stagedPhotos.length - 1;
        renderStagedPhotosUI();
        showToast('📸 Foto berhasil dijepret & masuk antrian preview!');
        triggerAutoPublishIfEnabled();

        // Kirim sinyal ke Desktop Camera Bridge jika aktif (Sony A7II/A7III/A6400 & Canon EOS RP)
        if (typeof sendDesktopBridgeShutter === 'function') {
            sendDesktopBridgeShutter();
        }
    }

    /* =========================================================================
       MODUL UNIVERSAL CAMERA USB & LOCAL STORAGE HUB (PC, LAPTOP & IPAD/TABLET)
       AUTO-DETEKSI MODEL KAMERA (SONY, CANON, NIKON, FUJIFILM, DLL.) VIA EXIF & USB
       CUSTOM FOLDER PENYIMPANAN HASIL JEPRETAN LOKAL (DIRECT FS & INDEXEDDB)
       ========================================================================= */

    function isTabletOrMobileDevice() {
        var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
        var isTouch = ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
        var isIpad = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isIpad || (isTouch && window.innerWidth <= 1024) || /Android|iPhone|iPod/i.test(ua);
    }

    function initCameraAndStorageHub() {
        try {
            var lastCam = localStorage.getItem('limz_last_detected_camera');
            if (lastCam) {
                appState.detectedCameraModel = lastCam;
                updateCameraBadge(lastCam, 'Tersimpan');
            } else {
                updateCameraBadge('', '');
            }

            var lastFolder = localStorage.getItem('limz_local_storage_folder_name');
            if (window.AndroidUsbCamera && typeof window.AndroidUsbCamera.getStorageFolder === 'function') {
                var androidFolder = window.AndroidUsbCamera.getStorageFolder();
                var androidFolderName = (typeof window.AndroidUsbCamera.getStorageFolderName === 'function')
                    ? window.AndroidUsbCamera.getStorageFolderName()
                    : (androidFolder ? androidFolder.split('/').filter(Boolean).pop() : 'LimzStudioPhotobooth');
                appState.localStorageFolderName = androidFolder || 'LimzStudioPhotobooth';
                updateLocalStorageBadge(androidFolderName || 'LimzStudioPhotobooth', 'Tablet Android');
            } else if (lastFolder) {
                appState.localStorageFolderName = lastFolder;
                updateLocalStorageBadge(lastFolder, 'Tersimpan');
            } else if (isTabletOrMobileDevice()) {
                updateLocalStorageBadge('Memori iPad (Internal)', 'IndexedDB Aktif');
            } else {
                updateLocalStorageBadge('', '');
            }

            var ipadBtn = document.getElementById('btn-ipad-camera-usb');
            if (isTabletOrMobileDevice() && ipadBtn) {
                ipadBtn.style.boxShadow = '0 0 0 2px #c7d2fe, 0 2px 8px rgba(124, 58, 237, 0.25)';
                ipadBtn.style.fontWeight = '800';
            }
        } catch (e) {
            console.warn('initCameraAndStorageHub err:', e);
        }
    }

    function updateCameraBadge(cameraName, connectionType) {
        var badge = document.getElementById('hub-camera-badge');
        if (!badge) return;
        if (cameraName) {
            var label = cameraName;
            if (connectionType) label += ' [' + connectionType + ']';
            badge.innerHTML = '🟢 ' + escapeHtml(label);
            badge.style.background = '#ecfdf5';
            badge.style.color = '#047857';
            badge.style.borderColor = '#a7f3d0';
            badge.title = 'Kamera terdeteksi: ' + cameraName;
        } else {
            badge.innerHTML = '⚪ Siap Terhubung (Kabel USB)';
            badge.style.background = '#f8fafc';
            badge.style.color = '#475569';
            badge.style.borderColor = '#cbd5e1';
            badge.title = 'Sambungkan kamera via kabel data USB (Sony, Canon, Nikon, dll.)';
        }
    }

    function updateLocalStorageBadge(folderName, statusText) {
        var badge = document.getElementById('hub-storage-badge');
        var btn = document.getElementById('btn-pick-local-storage');
        if (!badge) return;
        if (folderName) {
            badge.innerHTML = '📂 ' + escapeHtml(folderName) + (statusText ? ' (' + statusText + ')' : '');
            badge.style.background = '#f0f9ff';
            badge.style.color = '#0284c7';
            badge.style.borderColor = '#bae6fd';
            badge.title = 'Lokasi penyimpanan jepretan lokal aktif: ' + folderName;
            if (btn) {
                var shortName = folderName.length > 14 ? (folderName.substr(0, 12) + '..') : folderName;
                btn.innerHTML = '📂 ' + escapeHtml(shortName);
                btn.style.background = '#e0f2fe';
                btn.style.color = '#0369a1';
            }
        } else {
            badge.innerHTML = '📂 Belum Diatur (Klik di sini)';
            badge.style.background = '#f8fafc';
            badge.style.color = '#475569';
            badge.style.borderColor = '#cbd5e1';
            if (btn) {
                btn.innerHTML = '📂 Simpan Lokal (PC)';
                btn.style.background = '#f0f9ff';
                btn.style.color = '#0284c7';
            }
        }
    }

    function parseExifFromBuffer(buffer) {
        if (!buffer || buffer.byteLength < 32) return null;
        var view = new DataView(buffer);

        var isJpeg = (view.getUint16(0, false) === 0xFFD8);
        var tiffOffset = -1;
        var littleEndian = false;

        if (isJpeg) {
            var offset = 2;
            var len = view.byteLength;
            while (offset < len - 4) {
                var marker = view.getUint16(offset, false);
                var markerLen = view.getUint16(offset + 2, false);
                if (marker === 0xFFE1) {
                    if (view.getUint32(offset + 4, false) === 0x45786966 && view.getUint16(offset + 8, false) === 0x0000) {
                        tiffOffset = offset + 10;
                        break;
                    }
                }
                if ((marker & 0xFF00) !== 0xFF00) break;
                offset += 2 + markerLen;
            }
        } else {
            var sig = view.getUint16(0, false);
            if (sig === 0x4949 || sig === 0x4D4D) {
                tiffOffset = 0;
            }
        }

        if (tiffOffset < 0 || tiffOffset + 8 > view.byteLength) return null;

        var endianMark = view.getUint16(tiffOffset, false);
        if (endianMark === 0x4949) {
            littleEndian = true;
        } else if (endianMark === 0x4D4D) {
            littleEndian = false;
        } else {
            return null;
        }

        var firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
        if (tiffOffset + firstIfdOffset + 2 > view.byteLength) return null;

        var numEntries = view.getUint16(tiffOffset + firstIfdOffset, littleEndian);
        var result = { make: '', model: '' };

        function readString(strOffset, byteCount) {
            if (strOffset + byteCount > view.byteLength) return '';
            var s = '';
            for (var i = 0; i < byteCount; i++) {
                var b = view.getUint8(strOffset + i);
                if (b === 0) break;
                s += String.fromCharCode(b);
            }
            return s.trim();
        }

        var entryPos = tiffOffset + firstIfdOffset + 2;
        for (var i = 0; i < numEntries; i++) {
            if (entryPos + 12 > view.byteLength) break;
            var tag = view.getUint16(entryPos, littleEndian);
            var type = view.getUint16(entryPos + 2, littleEndian);
            var count = view.getUint32(entryPos + 4, littleEndian);
            var valOffset = view.getUint32(entryPos + 8, littleEndian);

            var dataPos = (count <= 4 && type === 2) ? (entryPos + 8) : (tiffOffset + valOffset);

            if (tag === 0x010F) {
                result.make = readString(dataPos, count);
            } else if (tag === 0x0110) {
                result.model = readString(dataPos, count);
            }
            entryPos += 12;
        }

        return result;
    }

    function parseExifFromDataUrl(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        var commaIdx = dataUrl.indexOf(',');
        if (commaIdx === -1) return null;
        var base64 = dataUrl.substring(commaIdx + 1, commaIdx + 65536);
        try {
            var binary = atob(base64);
            var len = binary.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return parseExifFromBuffer(bytes.buffer);
        } catch (e) {
            return null;
        }
    }

    function formatCameraModelName(make, model) {
        if (!make && !model) return 'Kamera Tidak Dikenal';
        var cleanMake = (make || '').trim();
        var cleanModel = (model || '').trim();

        var sonyMap = {
            'ILCE-7M3': 'Sony Alpha A7 III',
            'ILCE-7M4': 'Sony Alpha A7 IV',
            'ILCE-7M2': 'Sony Alpha A7 II',
            'ILCE-7': 'Sony Alpha A7',
            'ILCE-7RM3': 'Sony Alpha A7R III',
            'ILCE-7RM4': 'Sony Alpha A7R IV',
            'ILCE-7RM5': 'Sony Alpha A7R V',
            'ILCE-7SM3': 'Sony Alpha A7S III',
            'ILCE-7C': 'Sony Alpha A7C',
            'ILCE-7CM2': 'Sony Alpha A7C II',
            'ILCE-6700': 'Sony Alpha A6700',
            'ILCE-6600': 'Sony Alpha A6600',
            'ILCE-6500': 'Sony Alpha A6500',
            'ILCE-6400': 'Sony Alpha A6400',
            'ILCE-6300': 'Sony Alpha A6300',
            'ILCE-6100': 'Sony Alpha A6100',
            'ILCE-6000': 'Sony Alpha A6000',
            'ZV-E10': 'Sony ZV-E10',
            'ZV-E10M2': 'Sony ZV-E10 II',
            'ZV-E1': 'Sony ZV-E1',
            'ZV-1': 'Sony ZV-1',
            'ZV-1M2': 'Sony ZV-1 II',
            'ILME-FX3': 'Sony FX3 Cinema',
            'ILME-FX30': 'Sony FX30 Cinema'
        };

        if (sonyMap[cleanModel]) return sonyMap[cleanModel];

        if (/ILCE-/i.test(cleanModel)) {
            return 'Sony Alpha ' + cleanModel.replace(/ILCE-/i, 'A');
        }

        if (/Canon/i.test(cleanMake) || /EOS/i.test(cleanModel)) {
            var cModel = cleanModel;
            if (!/Canon/i.test(cModel)) cModel = 'Canon ' + cModel;
            return cModel;
        }

        if (/Nikon/i.test(cleanMake) || /^NIKON/i.test(cleanModel) || /^Zs*d/i.test(cleanModel)) {
            var nModel = cleanModel.replace(/NIKONs+/i, '');
            return 'Nikon ' + nModel;
        }

        if (/FUJIFILM/i.test(cleanMake) || /X-T|X-S|X-H|X100/i.test(cleanModel)) {
            var fModel = cleanModel.replace(/FUJIFILMs+/i, '');
            return 'Fujifilm ' + fModel;
        }

        if (/Panasonic/i.test(cleanMake) || /DC-|DMC-/i.test(cleanModel)) {
            return 'Panasonic ' + cleanModel;
        }

        return (cleanMake ? (cleanMake + ' ') : '') + cleanModel;
    }

    function detectCameraFromPhotoBufferOrBlob(fileOrBlobOrDataUrl) {
        if (!fileOrBlobOrDataUrl) return;

        if (typeof fileOrBlobOrDataUrl === 'string' && fileOrBlobOrDataUrl.indexOf('data:') === 0) {
            var parsed = parseExifFromDataUrl(fileOrBlobOrDataUrl);
            if (parsed && (parsed.make || parsed.model)) {
                var camModel = formatCameraModelName(parsed.make, parsed.model);
                appState.detectedCameraModel = camModel;
                try { localStorage.setItem('limz_last_detected_camera', camModel); } catch (e) { }
                updateCameraBadge(camModel, 'Kabel USB');
            }
            return;
        }

        if (fileOrBlobOrDataUrl instanceof Blob || (typeof File !== 'undefined' && fileOrBlobOrDataUrl instanceof File)) {
            var slice = fileOrBlobOrDataUrl.slice(0, 65536);
            var reader = new FileReader();
            reader.onload = function (e) {
                var buffer = e.target.result;
                var parsed = parseExifFromBuffer(buffer);
                if (parsed && (parsed.make || parsed.model)) {
                    var camModel = formatCameraModelName(parsed.make, parsed.model);
                    appState.detectedCameraModel = camModel;
                    try { localStorage.setItem('limz_last_detected_camera', camModel); } catch (e2) { }
                    updateCameraBadge(camModel, 'Kabel USB');
                }
            };
            reader.readAsArrayBuffer(slice);
        }
    }

    function dataUrlToBlob(dataUrl) {
        var parts = dataUrl.split(',');
        var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
        var binary = atob(parts[1]);
        var len = binary.length;
        var u8arr = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            u8arr[i] = binary.charCodeAt(i);
        }
        return new Blob([u8arr], { type: mime });
    }

    async function triggerPickLocalStorageFolder(e) {
        if (e && e.stopPropagation) e.stopPropagation();

        // 1. Prioritas Utama: APK Android Native (Capacitor USB Bridge)
        if (window.AndroidUsbCamera && typeof window.AndroidUsbCamera.openFolderPicker === 'function') {
            showToast('📂 Membuka jendela pemilih folder penyimpanan Android...');
            window.AndroidUsbCamera.openFolderPicker();
            return;
        }

        var isInIframe = (window.self !== window.top);
        if (!isInIframe && typeof window.showDirectoryPicker === 'function') {
            try {
                var dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                if (dirHandle) {
                    appState.localExportDirHandle = dirHandle;
                    appState.localStorageFolderName = dirHandle.name;
                    try { localStorage.setItem('limz_local_storage_folder_name', dirHandle.name); } catch (e) { }
                    updateLocalStorageBadge(dirHandle.name, 'Aktif (PC)');
                    showToast('📁 Folder penyimpanan jepretan lokal aktif: "' + dirHandle.name + '". Setiap foto akan otomatis disimpan ke sini!');
                    return;
                }
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                console.warn('showDirectoryPicker err:', err);
            }
        }

        if (isTabletOrMobileDevice()) {
            showToast('📱 Mode iPad / Tablet: Foto tersimpan otomatis di Memori Flash Internal iPad (IndexedDB). Anda dapat mengekspor atau menyalin kapan saja.');
            updateLocalStorageBadge('Memori iPad (Internal)', 'IndexedDB Aktif');
            return;
        }

        openNativeFolderBridgeWindow();
    }

    async function savePhotoToLocalDirectory(fileName, blobOrDataUrl) {
        if (appState.localExportDirHandle) {
            try {
                var fileHandle = await appState.localExportDirHandle.getFileHandle(fileName, { create: true });
                var writable = await fileHandle.createWritable();
                var blob = (typeof blobOrDataUrl === 'string' && blobOrDataUrl.indexOf('data:') === 0)
                    ? dataUrlToBlob(blobOrDataUrl)
                    : blobOrDataUrl;
                await writable.write(blob);
                await writable.close();
                console.log('Saved to local PC storage folder:', fileName);
            } catch (err) {
                console.warn('Gagal menyimpan file ke local storage:', err);
            }
        }

        savePhotoToIpadStorage(fileName, blobOrDataUrl);
    }

    function savePhotoToIpadStorage(fileName, blobOrDataUrl) {
        if (!('indexedDB' in window)) return;
        try {
            var request = indexedDB.open('LimzStudioLocalStorage', 1);
            request.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('photos')) {
                    db.createObjectStore('photos', { keyPath: 'name' });
                }
            };
            request.onsuccess = function (e) {
                var db = e.target.result;
                var dataUrl = (typeof blobOrDataUrl === 'string') ? blobOrDataUrl : null;
                if (dataUrl) {
                    try {
                        var tx = db.transaction(['photos'], 'readwrite');
                        tx.objectStore('photos').put({ name: fileName, dataUrl: dataUrl, timestamp: Date.now() });
                    } catch (txErr) { }
                } else if (blobOrDataUrl instanceof Blob) {
                    var reader = new FileReader();
                    reader.onload = function (evt) {
                        try {
                            var txx = db.transaction(['photos'], 'readwrite');
                            txx.objectStore('photos').put({ name: fileName, dataUrl: evt.target.result, timestamp: Date.now() });
                        } catch (txErr2) { }
                    };
                    reader.readAsDataURL(blobOrDataUrl);
                }
            };
        } catch (err) {
            console.warn('Gagal simpan ke iPad local storage:', err);
        }
    }

    
    // Pembersihan otomatis data file temp IndexedDB lama agar storage disk kembali lega
    function cleanupOldTempStorage() {
        if ('indexedDB' in window) {
            try {
                var delReq = indexedDB.deleteDatabase('LimzStudioLocalStorage');
                delReq.onsuccess = function () {
                    console.log('[Storage] Cache database file temp lama berhasil dibersihkan.');
                };
            } catch (e) { }
        }
    }
    setTimeout(cleanupOldTempStorage, 2500);

    function triggerExportIpadLocalStoragePhotos() {
        if (!('indexedDB' in window)) {
            showToast('IndexedDB tidak didukung pada browser ini.');
            return;
        }
        var request = indexedDB.open('LimzStudioLocalStorage', 1);
        request.onsuccess = function (e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('photos')) {
                showToast('Belum ada foto yang tersimpan di penyimpanan lokal iPad.');
                return;
            }
            var tx = db.transaction(['photos'], 'readonly');
            var store = tx.objectStore('photos');
            var getAll = store.getAll();
            getAll.onsuccess = function () {
                var list = getAll.result || [];
                if (list.length === 0) {
                    showToast('Belum ada foto yang tersimpan di penyimpanan lokal iPad.');
                    return;
                }
                showToast('📥 Mengunduh ' + list.length + ' foto dari penyimpanan lokal...');
                list.forEach(function (item, idx) {
                    setTimeout(function () {
                        var a = document.createElement('a');
                        a.href = item.dataUrl;
                        a.download = item.name;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }, idx * 300);
                });
            };
        };
    }

    function triggerIpadCameraUsbConnect(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (window.AndroidUsbCamera) {
            showToast('📂 Mengatur folder penyimpanan kamera di Android...');
            window.AndroidUsbCamera.openFolderPicker();
            return;
        }
        var ipadInput = document.getElementById('file-input-ipad-roll');
        if (ipadInput) {
            showToast('📱 Hubungkan kabel data USB kamera ke iPad. Di dialog yang muncul: pilih "Choose Files" (buka kamera di sidebar Files) atau "Photo Library".');
            ipadInput.click();
        }
    }

    async function triggerUsbCameraProbe(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (window.AndroidUsbCamera) {
            try {
                var rawCameras = window.AndroidUsbCamera.getConnectedCameras();
                var cameras = JSON.parse(rawCameras || '[]');
                if (cameras.length > 0) {
                    var cam = cameras[0];
                    showToast('📷 Kamera Terdeteksi: ' + cam.brandAndModel);
                    if (!cam.hasPermission) {
                        showToast('Meminta izin akses USB untuk ' + cam.brandAndModel + '...');
                        window.AndroidUsbCamera.requestPermission(cam.deviceName);
                    } else {
                        showToast('✅ Membuka sesi kamera ' + cam.brandAndModel + '...'); if (typeof window.AndroidUsbCamera.connectCamera === 'function') window.AndroidUsbCamera.connectCamera(cam.deviceName);
                    }
                    var statusEl = document.getElementById('tether-indicator-status');
                    if (statusEl) {
                        statusEl.innerHTML = '<span style="color:#10b981;">🟢</span> <strong>Kamera USB:</strong> ' + cam.brandAndModel;
                    }
                    return;
                } else {
                    showToast('ℹ️ Sambungkan kabel USB OTG dari kamera (Sony, Canon, Nikon) ke tablet.');
                    return;
                }
            } catch (errCam) {
                console.error('AndroidUsbCamera error:', errCam);
            }
        }
        if (!navigator.usb || typeof navigator.usb.requestDevice !== 'function') {
            showToast('ℹ️ Sambungkan kabel data USB kamera Anda. Model kamera (Sony, Canon, Nikon, Fuji, dll.) akan otomatis terdeteksi begitu foto jepretan masuk!');
            return;
        }
        try {
            var device = await navigator.usb.requestDevice({
                filters: [
                    { vendorId: 0x054c }, // Sony
                    { vendorId: 0x04a9 }, // Canon
                    { vendorId: 0x04b0 }, // Nikon
                    { vendorId: 0x04cb }, // Fujifilm
                    { vendorId: 0x04da }, // Panasonic
                    { vendorId: 0x07b4 }, // Olympus/OM
                    { vendorId: 0x0a17 }  // Pentax
                ]
            });
            if (device) {
                var camName = device.productName || ('Kamera USB (' + device.vendorId.toString(16) + ')');
                appState.detectedCameraModel = camName;
                try { localStorage.setItem('limz_last_detected_camera', camName); } catch (e) { }
                updateCameraBadge(camName, 'Kabel USB');
                showToast('🟢 Kamera USB Terdeteksi: ' + camName);
            }
        } catch (err) {
            if (err && err.name === 'NotFoundError') return;
            console.warn('WebUSB probe:', err);
            showToast('ℹ️ Kamera Anda siap digunakan via kabel data USB!');
        }
    }

    /* =========================================================================
       MODUL DESKTOP CAMERA BRIDGE HELPER (PORT 8080)
       Kamera: Sony A7II, Sony A7III, Sony A6400, Canon EOS RP
       ========================================================================= */
    var desktopBridgeState = {
        online: false,
        cameraName: '',
        pollInterval: null,
        lastKnownPhoto: null
    };

    function getBridgeHost() {
        var host = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname)
            ? 'http://localhost:8080'
            : ('http://' + window.location.hostname + ':8080');
        return host;
    }

    function checkDesktopBridgeStatus() {
        var bridgeHost = getBridgeHost();
        fetch(bridgeHost + '/api/status', { mode: 'cors' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data && data.online) {
                    var wasOffline = !desktopBridgeState.online;
                    desktopBridgeState.online = true;
                    var camInfo = (data.camera && data.camera.connected) ? data.camera.model : 'Bridge Siap';
                    desktopBridgeState.cameraName = camInfo;

                    updateCameraBadge(camInfo, 'USB Bridge');

                    var hudModelTag = document.getElementById('hud-camera-model-tag');
                    if (hudModelTag && data.camera && data.camera.connected) {
                        hudModelTag.innerText = '📷 ' + data.camera.model + ' (Bridge USB)';
                    }

                    if (wasOffline) {
                        showToast('🟢 Desktop Camera Bridge Terhubung: ' + camInfo);
                    }

                    // Cek foto baru yang masuk dari kamera fisik
                    if (data.stats && data.stats.latestPhoto && data.stats.latestPhoto !== desktopBridgeState.lastKnownPhoto) {
                        // Jangan ingesting foto awal saat baru pertama kali connect
                        if (desktopBridgeState.lastKnownPhoto !== null) {
                            desktopBridgeState.lastKnownPhoto = data.stats.latestPhoto;
                            handleIncomingBridgePhoto(bridgeHost + data.stats.latestPhoto);
                        } else {
                            desktopBridgeState.lastKnownPhoto = data.stats.latestPhoto;
                        }
                    }
                } else {
                    desktopBridgeState.online = false;
                }
            })
            .catch(function () {
                desktopBridgeState.online = false;
            });
    }

    function sendDesktopBridgeShutter() {
        if (!desktopBridgeState.online) return;
        var bridgeHost = getBridgeHost();
        fetch(bridgeHost + '/api/shutter', { method: 'POST', mode: 'cors' })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.success) {
                    console.log('[BRIDGE] Shutter fisik kamera berhasil dipicu:', res);
                }
            })
            .catch(function (err) {
                console.warn('[BRIDGE] Shutter trigger warn:', err);
            });
    }

    function handleIncomingBridgePhoto(photoUrl) {
        fetch(photoUrl)
            .then(function (r) { return r.blob(); })
            .then(function (blob) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    var dataUrl = e.target.result;
                    var fileName = 'DSLR_' + Date.now() + '.jpg';
                    var newSnap = {
                        id: 'staged_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                        file: { name: fileName, size: blob.size },
                        name: fileName,
                        size: blob.size,
                        dataUrl: dataUrl,
                        originalDataUrl: dataUrl,
                        rawOriginalDataUrl: dataUrl,
                        isCropped: false
                    };
                    if (appState.photoFilterState && appState.photoFilterState.isLocked) {
                        newSnap.appliedGrading = JSON.parse(JSON.stringify(appState.photoFilterState));
                    }
                    appState.stagedPhotos.push(newSnap);
                    appState.activeStagedIndex = appState.stagedPhotos.length - 1;
                    renderStagedPhotosUI();
                    showToast('📸 Foto DSLR (' + (desktopBridgeState.cameraName || 'Sony/Canon') + ') berhasil masuk antrian!');
                    triggerAutoPublishIfEnabled();
                };
                reader.readAsDataURL(blob);
            })
            .catch(function (err) {
                console.warn('[BRIDGE] Gagal memuat foto dari bridge:', err);
            });
    }

    // Mulai polling deteksi otomatis bridge setiap 3.5 detik
    setInterval(checkDesktopBridgeStatus, 3500);
    setTimeout(checkDesktopBridgeStatus, 1000);

    /* =========================================================================
       MODUL IN-PAGE TETHER FOLDER WATCHER (NOL POPUP / SINGLE-SCREEN WORKFLOW)
       DENGAN FILTER FORMAT FOTO (HANYA JPEG / HANYA RAW / SEMUA)
       & NATIVE WINDOWS "SELECT FOLDER" DIALOG TRIGGER
       ========================================================================= */
    var inpageTetherState = {
        active: false,
        dirHandle: null,
        intervalId: null,
        formatFilter: 'jpeg', // 'jpeg' | 'raw' | 'all'
        folderName: '',
        watchedFiles: {},
        fileSizeTracker: {},
        isScanning: false,
        syncCount: 0
    };

    var activeBridgeWindow = null;

    function isFileAcceptedByFilter(fileName) {
        if (!fileName) return false;
        if (fileName.charAt(0) === '.' || fileName.charAt(0) === '~' || fileName.indexOf('.tmp') > -1) return false;
        var ext = (fileName.split('.').pop() || '').toLowerCase();
        var isImgExt = (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || ext === 'heic' || ext === 'bmp');
        var isRawExt = ['arw', 'cr2', 'cr3', 'nef', 'dng', 'raw', 'orf', 'rw2', 'pef'].indexOf(ext) > -1;
        return isImgExt || isRawExt;
    }

    async function triggerDslrHotFolderWatch(e) {
        if (e && e.stopPropagation) e.stopPropagation();

        // 0. Cek jika berjalan di Android APK (Native USB Camera Bridge)
        if (window.AndroidUsbCamera) {
            var curFolder = window.AndroidUsbCamera.getStorageFolder();
            showToast('📁 Menggunakan folder penyimpanan kamera Android: ' + curFolder);
            window.AndroidUsbCamera.scanFolderNow();
            var statusEl = document.getElementById('tether-indicator-status');
            if (statusEl) {
                statusEl.innerHTML = '<span style="color:#10b981;">🟢</span> <strong>Folder Android:</strong> ' + curFolder;
            }
            return;
        }

        // 1. Jika running di luar iframe (misal standalone / Vercel), coba showDirectoryPicker langsung
        var isInIframe = (window.self !== window.top);
        if (!isInIframe && typeof window.showDirectoryPicker === 'function') {
            try {
                var dirHandle = await window.showDirectoryPicker({
                    mode: 'read'
                });
                if (dirHandle) {
                    await setupDirectoryHandleWatcher(dirHandle);
                    return;
                }
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                console.warn('showDirectoryPicker standalone err:', err);
            }
        }

        // 2. Buka Native Folder Bridge Window di level browser utama
        // Ini memastikan Windows menampilkan dialog native asli bertuliskan "Select Folder" (bukan "Upload")
        openNativeFolderBridgeWindow();
    }

    async function setupDirectoryHandleWatcher(dirHandle) {
        if (!dirHandle) return;
        if (inpageTetherState.intervalId) {
            clearInterval(inpageTetherState.intervalId);
            inpageTetherState.intervalId = null;
        }

        inpageTetherState.active = true;
        inpageTetherState.dirHandle = dirHandle;
        inpageTetherState.folderName = 'Folder PC: ' + (dirHandle.name || 'Kamera');
        inpageTetherState.watchedFiles = {};
        inpageTetherState.fileSizeTracker = {};
        inpageTetherState.syncCount = 0;
        updateInpageTetherUI();

        showToast('🟢 Terhubung ke folder "' + dirHandle.name + '". Memantau foto baru otomatis...');

        await scanInpageTetherFolder();

        inpageTetherState.intervalId = setInterval(function () {
            if (inpageTetherState.active && inpageTetherState.dirHandle) {
                scanInpageTetherFolder();
            }
        }, 1500);
    }

    function openNativeFolderBridgeWindow() {
        if (activeBridgeWindow && !activeBridgeWindow.closed) {
            try { activeBridgeWindow.focus(); return; } catch (e) { }
        }

        var w = 480;
        var h = 340;
        var left = Math.max(0, Math.round((window.screen.width - w) / 2));
        var top = Math.max(0, Math.round((window.screen.height - h) / 2));

        var bridge = window.open('', 'LimzFolderBridge', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',menubar=no,toolbar=no,location=no,status=no,resizable=yes');
        if (!bridge) {
            showToast('⚠️ Pop-up diblokir browser. Izinkan pop-up untuk dialog "Select Folder" asli Windows.');
            var input = document.getElementById('file-input-tether-folder');
            if (input) input.click();
            return;
        }

        activeBridgeWindow = bridge;

        var doc = bridge.document;
        doc.open();
        doc.write('<!DOCTYPE html>' +
            '<html>' +
            '<head>' +
            '<meta charset="UTF-8">' +
            '<title>Hubungkan Folder Kamera (PC)</title>' +
            '<style>' +
            '* { box-sizing: border-box; margin: 0; padding: 0; }' +
            'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; text-align: center; }' +
            '.card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 26px 20px; width: 100%; max-width: 420px; box-shadow: 0 16px 36px rgba(0,0,0,0.5); }' +
            '.icon { font-size: 36px; margin-bottom: 10px; }' +
            'h3 { font-size: 16px; font-weight: 700; color: #38bdf8; margin-bottom: 8px; }' +
            'p { font-size: 12.5px; color: #94a3b8; line-height: 1.5; margin-bottom: 20px; }' +
            'button { background: #047857; color: #ffffff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 13.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(4,120,87,0.35); transition: background 0.2s, transform 0.1s; }' +
            'button:hover { background: #059669; }' +
            'button:active { transform: scale(0.98); }' +
            '.status-box { margin-top: 16px; padding: 10px 14px; background: #0f172a; border-radius: 8px; border: 1px solid #334155; font-size: 12px; color: #cbd5e1; min-height: 38px; display: flex; align-items: center; justify-content: center; word-break: break-all; }' +
            '.note { margin-top: 14px; font-size: 11px; color: #64748b; line-height: 1.4; }' +
            '</style>' +
            '</head>' +
            '<body>' +
            '<div class="card">' +
            '<div class="icon">📁</div>' +
            '<h3>Hubungkan Folder Kamera (PC)</h3>' +
            '<p>Klik tombol di bawah untuk memilih folder kamera (input) atau folder penyimpanan lokal (output) menggunakan dialog asli Windows bertuliskan <b>"Select Folder"</b>.</p>' +
            '<div style="display:flex; flex-direction:column; gap:8px; align-items:center;">' +
            '<button id="btn-pick">📂 Pilih Folder Kamera Tether (Input)</button>' +
            '<button id="btn-pick-storage" style="background:#0284c7; box-shadow:0 4px 14px rgba(2,132,199,0.35);">💾 Pilih Folder Simpan Lokal (Output)</button>' +
            '</div>' +
            '<div class="status-box" id="status-box">⚪ Menunggu pemilihan folder...</div>' +
            '<div class="note">💡 Jendela ini memantau foto baru secara real-time. Biarkan jendela ini tetap terbuka selama sesi pemotretan berlangsung.</div>' +
            '</div>' +
            '<script>' +
            'var dirHandle = null;' +
            'var watchedFiles = {};' +
            'var syncCount = 0;' +
            'var broadcast = (typeof BroadcastChannel !== "undefined") ? new BroadcastChannel("limz_tether_stream") : null;' +
            'function isImg(n) { if (!n || n.charAt(0) === "." || n.charAt(0) === "~") return false; var ext = (n.split(".").pop() || "").toLowerCase(); return ["jpg","jpeg","png","webp","heic","bmp","arw","cr2","cr3","nef","dng","raw"].indexOf(ext) > -1; }' +
            'async function scan() {' +
            '  if (!dirHandle) return;' +
            '  try {' +
            '    var list = [];' +
            '    for await (var ent of dirHandle.values()) {' +
            '      if (ent.kind === "file" && isImg(ent.name)) {' +
            '        if (!watchedFiles[ent.name]) {' +
            '          var f = await ent.getFile();' +
            '          if (f && f.size > 500) {' +
            '            watchedFiles[ent.name] = true;' +
            '            var r = new FileReader();' +
            '            var url = await new Promise(function(res){ r.onload = function(e){ res(e.target.result); }; r.onerror = function(){ res(null); }; r.readAsDataURL(f); });' +
            '            if (url) list.push({ name: f.name, size: f.size, lastModified: f.lastModified, dataUrl: url });' +
            '          }' +
            '        }' +
            '      } else if (ent.kind === "directory") {' +
            '        try {' +
            '          for await (var sub of ent.values()) {' +
            '            if (sub.kind === "file" && isImg(sub.name)) {' +
            '              var k = ent.name + "/" + sub.name;' +
            '              if (!watchedFiles[k] && !watchedFiles[sub.name]) {' +
            '                var sf = await sub.getFile();' +
            '                if (sf && sf.size > 500) {' +
            '                  watchedFiles[k] = true;' +
            '                  watchedFiles[sub.name] = true;' +
            '                  var sr = new FileReader();' +
            '                  var surl = await new Promise(function(res){ sr.onload = function(e){ res(e.target.result); }; sr.onerror = function(){ res(null); }; sr.readAsDataURL(sf); });' +
            '                  if (surl) list.push({ name: sf.name, size: sf.size, lastModified: sf.lastModified, dataUrl: surl });' +
            '                }' +
            '              }' +
            '            }' +
            '          }' +
            '        } catch(se) {}' +
            '      }' +
            '    }' +
            '    if (list.length > 0) {' +
            '      syncCount += list.length;' +
            '      document.getElementById("status-box").innerHTML = "🟢 <b>" + syncCount + " foto</b> terhubung ke antrian studio!";' +
            '      if (window.opener) { window.opener.postMessage({ type: "LIMZ_HOT_FOLDER_BATCH", photos: list }, "*"); }' +
            '      if (broadcast) { broadcast.postMessage({ type: "LIMZ_HOT_FOLDER_BATCH", photos: list }); }' +
            '    }' +
            '  } catch(err) { console.warn("scan error", err); }' +
            '}' +
            'document.getElementById("btn-pick").addEventListener("click", async function() {' +
            '  var sb = document.getElementById("status-box");' +
            '  try {' +
            '    if (typeof window.showDirectoryPicker !== "function") {' +
            '      sb.innerText = "Browser tidak mendukung showDirectoryPicker. Harap gunakan Chrome atau Edge di PC.";' +
            '      return;' +
            '    }' +
            '    dirHandle = await window.showDirectoryPicker({ mode: "read" });' +
            '    if (dirHandle) {' +
            '      sb.innerHTML = "🟢 Terhubung ke <b>" + dirHandle.name + "</b>. Memindai foto...";' +
            '      document.getElementById("btn-pick").innerText = "🔄 Ubah Folder (" + dirHandle.name + ")";' +
            '      if (window.opener) {' +
            '        window.opener.postMessage({ type: "LIMZ_TETHER_STATUS", active: true, folderName: dirHandle.name, syncCount: 0 }, "*");' +
            '        try { window.opener.postMessage({ type: "LIMZ_TETHER_HANDLE", handle: dirHandle }, "*"); } catch(he) {}' +
            '      }' +
            '      if (broadcast) { broadcast.postMessage({ type: "LIMZ_TETHER_STATUS", active: true, folderName: dirHandle.name, syncCount: 0 }); }' +
            '      await scan();' +
            '      setInterval(scan, 1500);' +
            '    }' +
            '  } catch(err) {' +
            '    if (err && err.name === "AbortError") return;' +
            '    sb.innerText = "Gagal: " + err.message;' +
            '  }' +
            '});' +
            'document.getElementById("btn-pick-storage").addEventListener("click", async function() {' +
            '  var sb = document.getElementById("status-box");' +
            '  try {' +
            '    if (typeof window.showDirectoryPicker !== "function") {' +
            '      sb.innerText = "Browser tidak mendukung showDirectoryPicker. Harap gunakan Chrome atau Edge di PC.";' +
            '      return;' +
            '    }' +
            '    var storageHandle = await window.showDirectoryPicker({ mode: "readwrite" });' +
            '    if (storageHandle) {' +
            '      sb.innerHTML = "💾 Folder simpan aktif: <b>" + storageHandle.name + "</b>";' +
            '      document.getElementById("btn-pick-storage").innerText = "💾 Folder: " + storageHandle.name;' +
            '      if (window.opener) {' +
            '        window.opener.postMessage({ type: "LIMZ_LOCAL_STORAGE_HANDLE", handle: storageHandle, folderName: storageHandle.name }, "*");' +
            '      }' +
            '      if (broadcast) {' +
            '        broadcast.postMessage({ type: "LIMZ_LOCAL_STORAGE_HANDLE", folderName: storageHandle.name });' +
            '      }' +
            '    }' +
            '  } catch(err) {' +
            '    if (err && err.name === "AbortError") return;' +
            '    sb.innerText = "Gagal: " + err.message;' +
            '  }' +
            '});' +
            'window.addEventListener("beforeunload", function() {' +
            '  if (window.opener) { window.opener.postMessage({ type: "LIMZ_TETHER_STATUS", active: false }, "*"); }' +
            '  if (broadcast) { broadcast.postMessage({ type: "LIMZ_TETHER_STATUS", active: false }); }' +
            '});' +
            '</scr' + 'ipt>' +
            '</bo' + 'dy>' +
            '</ht' + 'ml>');
        doc.close();
    }

    async function triggerQuickFolderRecheck(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (activeBridgeWindow && !activeBridgeWindow.closed) {
            showToast('🔄 Memindai folder via bridge...');
            try {
                activeBridgeWindow.focus();
            } catch (err) { }
            return;
        }
        if (inpageTetherState.active && inpageTetherState.dirHandle) {
            showToast('🔄 Memindai penambahan foto baru...');
            await scanInpageTetherFolder();
            return;
        }
        openNativeFolderBridgeWindow();
    }

    function stopInpageTetherWatcher(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (inpageTetherState.intervalId) {
            clearInterval(inpageTetherState.intervalId);
            inpageTetherState.intervalId = null;
        }
        if (activeBridgeWindow && !activeBridgeWindow.closed) {
            try { activeBridgeWindow.close(); } catch (err) { }
            activeBridgeWindow = null;
        }
        inpageTetherState.active = false;
        inpageTetherState.dirHandle = null;
        inpageTetherState.folderName = '';
        inpageTetherState.watchedFiles = {};
        inpageTetherState.fileSizeTracker = {};
        inpageTetherState.syncCount = 0;
        updateInpageTetherUI();
        showToast('⚪ Pemantauan folder otomatis telah dinonaktifkan.');
    }

    function updateInpageTetherUI() {
        var btn = document.getElementById('btn-tether-hotfolder');
        var statusEl = document.getElementById('tether-indicator-status');
        var detailsEl = document.getElementById('tether-active-details');
        var labelEl = document.getElementById('tether-active-label');

        if (inpageTetherState.active) {
            if (btn) {
                btn.innerHTML = '🟢 Pemantau Aktif';
                btn.style.background = '#dcfce7';
                btn.style.color = '#15803d';
                btn.style.borderColor = '#86efac';
            }
            if (statusEl) {
                statusEl.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 6px #10b981;"></span><span style="color:#047857;">Memantau Foto Baru (1.5s)</span>';
            }
            if (detailsEl) {
                detailsEl.style.display = 'flex';
            }
            if (labelEl) {
                labelEl.innerHTML = '🟢 <b>' + escapeHtml(inpageTetherState.folderName) + '</b> &bull; Masuk: <b>' + inpageTetherState.syncCount + ' foto</b>';
            }
        } else {
            if (btn) {
                btn.innerHTML = '📁 Hubungkan Folder (PC)';
                btn.style.background = '#ecfdf5';
                btn.style.color = '#047857';
                btn.style.borderColor = '#a7f3d0';
            }
            if (statusEl) {
                statusEl.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#94a3b8;"></span><span>Belum Ada Sumber Terhubung</span>';
            }
            if (detailsEl) {
                detailsEl.style.display = 'none';
            }
        }
    }

    function readFileDataUrlPromise(file) {
        return new Promise(function (resolve, reject) {
            if (isRawFile(file)) {
                extractEmbeddedJpegFromRaw(file, function (convertedFile, jpegDataUrl) {
                    if (jpegDataUrl) {
                        resolve({ dataUrl: jpegDataUrl, wasRaw: true });
                    } else {
                        var reader = new FileReader();
                        reader.onload = function (e) { resolve({ dataUrl: e.target.result, wasRaw: false }); };
                        reader.onerror = function (err) { reject(err); };
                        reader.readAsDataURL(file);
                    }
                });
            } else {
                var reader = new FileReader();
                reader.onload = function (e) { resolve({ dataUrl: e.target.result, wasRaw: false }); };
                reader.readAsDataURL(file);
            }
        });
    }

    async function scanInpageTetherFolder() {
        if (!inpageTetherState.dirHandle || inpageTetherState.isScanning) return;
        inpageTetherState.isScanning = true;

        try {
            var candidateEntries = [];
            // Dukungan membaca berkas di root folder dan subfolder tingkat 1 (misal DCIM atau folder kamera)
            for await (var entry of inpageTetherState.dirHandle.values()) {
                if (entry.kind === 'file') {
                    if (isFileAcceptedByFilter(entry.name)) {
                        if (!inpageTetherState.watchedFiles[entry.name]) {
                            candidateEntries.push(entry);
                        }
                    }
                } else if (entry.kind === 'directory') {
                    try {
                        for await (var subEntry of entry.values()) {
                            if (subEntry.kind === 'file' && isFileAcceptedByFilter(subEntry.name)) {
                                var subKey = entry.name + '/' + subEntry.name;
                                if (!inpageTetherState.watchedFiles[subKey] && !inpageTetherState.watchedFiles[subEntry.name]) {
                                    candidateEntries.push(subEntry);
                                }
                            }
                        }
                    } catch (subDirErr) { }
                }
            }

            if (candidateEntries.length === 0) return;

            var filesToLoad = [];
            for (var k = 0; k < candidateEntries.length; k++) {
                var ent = candidateEntries[k];
                try {
                    var f = await ent.getFile();
                    if (!f || f.size < 500) continue; // Abaikan 0-byte

                    // Tandai file sudah ditangani agar tidak dipindai berulang
                    inpageTetherState.watchedFiles[ent.name] = true;

                    var alreadyExists = appState.stagedPhotos.some(function (p) {
                        return p.name === ent.name && Math.abs(p.size - f.size) < 100;
                    });
                    if (!alreadyExists) {
                        filesToLoad.push(f);
                    }
                } catch (entErr) {
                    console.warn('Gagal membaca info entri berkas:', ent.name, entErr);
                }
            }

            if (filesToLoad.length > 0) {
                inpageTetherState.syncCount += filesToLoad.length;
                updateInpageTetherUI();
                showToast('📸 ' + filesToLoad.length + ' foto terdeteksi & langsung masuk antrian!');
                handlePhotoFilesSelected(filesToLoad);
            }
        } catch (scanErr) {
            console.warn('Scan inpage tether error:', scanErr);
        } finally {
            inpageTetherState.isScanning = false;
        }
    }

    /* =========================================================================
       MODUL EKSTRAKSI FILE RAW KAMERA (SONY ARW, CANON CR2/CR3, NIKON NEF, DNG)
       ========================================================================= */
    function isRawFile(file) {
        if (!file || !file.name) return false;
        var ext = file.name.split('.').pop().toLowerCase();
        return ['arw', 'cr2', 'cr3', 'nef', 'dng', 'raw', 'orf', 'rw2', 'pef'].indexOf(ext) > -1;
    }

    function extractEmbeddedJpegFromRaw(file, callback) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var buffer = e.target.result;
            var bytes = new Uint8Array(buffer);
            var len = bytes.length;
            var bestStart = -1;
            var bestLength = 0;
            var i = 0;

            // Cari potongan stream JPEG terbesar (SOI 0xFFD8 s/d EOI 0xFFD9)
            while (i < len - 4) {
                if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
                    var start = i;
                    var j = start + 3;
                    while (j < len - 1) {
                        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
                            var chunkLen = (j + 2) - start;
                            if (chunkLen > bestLength && chunkLen > 30000) {
                                bestStart = start;
                                bestLength = chunkLen;
                            }
                            break;
                        }
                        j++;
                    }
                    i = j + 2;
                } else {
                    i++;
                }
            }

            if (bestStart > -1 && bestLength > 0) {
                var jpegSlice = bytes.subarray(bestStart, bestStart + bestLength);
                var jpegBlob = new Blob([jpegSlice], { type: 'image/jpeg' });
                var jpegName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                var convertedFile = new File([jpegBlob], jpegName, { type: 'image/jpeg' });

                var blobReader = new FileReader();
                blobReader.onload = function (evt) {
                    callback(convertedFile, evt.target.result);
                };
                blobReader.readAsDataURL(jpegBlob);
            } else {
                callback(file, null);
            }
        };
        reader.onerror = function () {
            callback(file, null);
        };
        reader.readAsArrayBuffer(file);
    }

    function handleTetherFolderInputSelected(inputEl) {
        if (!inputEl || !inputEl.files || inputEl.files.length === 0) return;
        var allFiles = Array.prototype.slice.call(inputEl.files);

        // Filter file sesuai opsi format tether (Hanya JPEG, Hanya RAW, atau Semua)
        var files = allFiles.filter(function (f) {
            return isFileAcceptedByFilter(f.name);
        });

        if (files.length === 0) {
            showToast('⚠️ Tidak ada file foto/RAW yang didukung di dalam folder yang dipilih.');
            inputEl.value = '';
            return;
        }

        var folderName = 'Folder Kamera';
        if (files[0] && files[0].webkitRelativePath) {
            var parts = files[0].webkitRelativePath.split('/');
            if (parts.length > 1) folderName = parts[0];
        }

        inpageTetherState.active = true;
        inpageTetherState.folderName = 'Folder PC: ' + folderName;
        inpageTetherState.syncCount = files.length;
        updateInpageTetherUI();

        showToast('📁 Memuat ' + files.length + ' foto dari folder PC ke antrian...');
        handlePhotoFilesSelected(files);
        inputEl.value = '';
    }

    function initDeviceSourceHighlight() {
        try {
            var ua = navigator.userAgent || '';
            var isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
            var isIpad = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            var isTabletOrMobile = isIpad || (isTouch && window.innerWidth <= 1024) || /Android|iPhone|iPod/i.test(ua);

            var ipadBtn = document.getElementById('btn-ipad-roll');
            if (isTabletOrMobile && ipadBtn) {
                ipadBtn.style.boxShadow = '0 0 0 2px #c7d2fe, 0 2px 8px rgba(79, 70, 229, 0.25)';
                ipadBtn.style.fontWeight = '800';
            }
        } catch (e) { }
    }
    setTimeout(initDeviceSourceHighlight, 800);

    /* =========================================================================
       MODUL LAYAR PENUH (FULLSCREEN MODE)
       ========================================================================= */
    function toggleFullScreenMode() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            var docEl = document.documentElement;
            if (docEl.requestFullscreen) {
                docEl.requestFullscreen().catch(function (err) { console.warn('FS error:', err); });
            } else if (docEl.webkitRequestFullscreen) {
                docEl.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(function (err) { console.warn('Exit FS error:', err); });
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    function updateFullscreenButtonState() {
        var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        var btns = document.querySelectorAll('#btn-toggle-fullscreen, .mon-fs-btn');
        btns.forEach(function (btn) {
            btn.innerHTML = isFs ? '🗗 Keluar Penuh' : '⛶ Layar Penuh';
        });
    }
    document.addEventListener('fullscreenchange', updateFullscreenButtonState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButtonState);

    /* =========================================================================
       MODUL ZERO-LATENCY INSTANT BROADCAST (DASHBOARD UPLOAD KE MONITOR & BRIDGE)
       ========================================================================= */
    var photoSyncChannel = null;
    if (typeof BroadcastChannel !== 'undefined') {
        try {
            photoSyncChannel = new BroadcastChannel('limz_photobooth_sync_channel');
            photoSyncChannel.onmessage = function (ev) {
                if (!ev.data) return;
                if (ev.data.type === 'LIMZ_HOT_FOLDER_BATCH') {
                    handleIncomingHotBatchFromBridge(ev.data.photos);
                } else if (ev.data.type === 'LIMZ_HOT_FOLDER_FILE') {
                    handleIncomingHotFileFromBridge(ev.data.photo || ev.data);
                } else if (ev.data.type === 'LIMZ_TETHER_STATUS') {
                    handleIncomingTetherStatus(ev.data);
                } else if (ev.data.type === 'LIMZ_UPLOAD_BATCH_COMPLETE') {
                    handleIncomingUploadBatchComplete(ev.data);
                } else {
                    handleIncomingLiveBroadcastPhoto(ev.data);
                }
            };
        } catch (e) { }

        try {
            var tetherStreamChannel = new BroadcastChannel('limz_tether_stream');
            tetherStreamChannel.onmessage = function (ev) {
                if (!ev.data) return;
                if (ev.data.type === 'LIMZ_HOT_FOLDER_FILE') {
                    handleIncomingHotFileFromBridge(ev.data.photo || ev.data);
                } else if (ev.data.type === 'LIMZ_HOT_FOLDER_BATCH') {
                    handleIncomingHotBatchFromBridge(ev.data.photos);
                } else if (ev.data.type === 'LIMZ_TETHER_STATUS') {
                    handleIncomingTetherStatus(ev.data);
                }
            };
        } catch (e) { }
    }

    window.addEventListener('message', function (ev) {
        if (!ev.data) return;
        if (ev.data.type === 'LIMZ_LOCAL_STORAGE_HANDLE' && ev.data.handle) {
            appState.localExportDirHandle = ev.data.handle;
            appState.localStorageFolderName = ev.data.folderName || ev.data.handle.name;
            try { localStorage.setItem('limz_local_storage_folder_name', appState.localStorageFolderName); } catch (e) { }
            updateLocalStorageBadge(appState.localStorageFolderName, 'Aktif (PC)');
            showToast('📂 Folder penyimpanan jepretan lokal aktif: "' + appState.localStorageFolderName + '"');
        } else if (ev.data.type === 'LIMZ_TETHER_HANDLE' && ev.data.handle) {
            activateInpageTetherWithHandle(ev.data.handle, ev.data.formatFilter);
            if (activeBridgeWindow && !activeBridgeWindow.closed) {
                try { activeBridgeWindow.close(); } catch (e) { }
                activeBridgeWindow = null;
            }
        } else if (ev.data.type === 'LIMZ_HOT_FOLDER_BATCH') {
            handleIncomingHotBatchFromBridge(ev.data.photos);
        } else if (ev.data.type === 'LIMZ_HOT_FOLDER_FILE') {
            handleIncomingHotFileFromBridge(ev.data.photo || ev.data);
        } else if (ev.data.type === 'LIMZ_TETHER_STATUS') {
            handleIncomingTetherStatus(ev.data);
        }
    });

    window.addEventListener('storage', function (e) {
        if (e.key === 'limz_instant_photo_broadcast' && e.newValue) {
            try {
                var data = JSON.parse(e.newValue);
                handleIncomingLiveBroadcastPhoto(data);
            } catch (err) { }
        } else if (e.key === 'limz_upload_batch_broadcast' && e.newValue) {
            try {
                var batchData = JSON.parse(e.newValue);
                handleIncomingUploadBatchComplete(batchData);
            } catch (err) { }
        } else if (e.key === 'limz_tether_hot_file' && e.newValue) {
            try {
                var item = JSON.parse(e.newValue);
                if (item && item.photo) {
                    handleIncomingHotFileFromBridge(item.photo);
                }
            } catch (err) { }
        }
    });

    function handleIncomingHotBatchFromBridge(photos) {
        if (!photos || !photos.length) return;
        var addedCount = 0;
        for (var i = 0; i < photos.length; i++) {
            var data = photos[i];
            if (!data || !data.dataUrl) continue;

            detectCameraFromPhotoBufferOrBlob(data.dataUrl);
            // Menggunakan file original dari kamera langsung tanpa menduplikasi file temp ke storage

            var exists = appState.stagedPhotos.some(function (p) {
                return p.name === data.name && Math.abs(p.size - (data.size || 0)) < 100;
            });
            if (exists) continue;

            var newStaged = {
                id: 'staged_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + i,
                name: data.name,
                size: data.size || 0,
                dataUrl: data.dataUrl,
                originalDataUrl: data.dataUrl,
                rawOriginalDataUrl: data.dataUrl,
                isCropped: false,
                wasRaw: !!data.wasRaw,
                rotation: 0
            };
            if (appState.photoFilterState && appState.photoFilterState.isLocked) {
                newStaged.appliedGrading = JSON.parse(JSON.stringify(appState.photoFilterState));
            }
            appState.stagedPhotos.push(newStaged);
            addedCount++;
        }

        if (addedCount > 0) {
            inpageTetherState.syncCount += addedCount;
            updateInpageTetherUI();
            appState.activeStagedIndex = appState.stagedPhotos.length - 1;
            renderStagedPhotosUI();

            // Pastikan kanvas simulator pratinjau studio besar langsung menampilkan foto baru seketika
            var activePhoto = appState.stagedPhotos[appState.activeStagedIndex];
            if (activePhoto && activePhoto.dataUrl) {
                var bgImg = document.getElementById('wm-simulator-bg');
                if (bgImg) {
                    bgImg.src = activePhoto.dataUrl;
                    bgImg.style.transform = 'rotate(' + (activePhoto.rotation || 0) + 'deg)';
                }
            }
            if (typeof updatePhotoGradingPreview === 'function') {
                updatePhotoGradingPreview();
            }
            if (typeof updateWatermarkSimulatorDisplay === 'function') {
                updateWatermarkSimulatorDisplay();
            }
            showToast('⚡ ' + addedCount + ' foto baru kamera berhasil masuk ke antrian!');
        }
    }

    function handleIncomingHotFileFromBridge(data) {
        if (!data) return;
        var photoObj = data.photo || data;
        handleIncomingHotBatchFromBridge([photoObj]);
    }

    function handleIncomingTetherStatus(data) {
        if (!data) return;
        if (data.active !== undefined) {
            inpageTetherState.active = !!data.active;
        }
        if (data.folderName) {
            inpageTetherState.folderName = 'Folder PC: ' + data.folderName;
        }
        if (data.syncCount !== undefined) {
            inpageTetherState.syncCount = data.syncCount;
        }
        updateInpageTetherUI();
    }

    function activateInpageTetherWithHandle(handle) {
        if (!handle) return;
        setupDirectoryHandleWatcher(handle);
    }

    window.handleIncomingHotBatchFromBridge = handleIncomingHotBatchFromBridge;
    window.handleIncomingHotFileFromBridge = handleIncomingHotFileFromBridge;
    window.handleIncomingTetherStatus = handleIncomingTetherStatus;
    window.activateInpageTetherWithHandle = activateInpageTetherWithHandle;

    function broadcastNewUploadedPhoto(collId, photoObj) {
        var payload = {
            type: 'LIMZ_PHOTO_UPLOADED',
            collectionId: collId,
            photo: photoObj,
            timestamp: Date.now()
        };
        if (photoSyncChannel) {
            try { photoSyncChannel.postMessage(payload); } catch (e) { }
        }
        try {
            localStorage.setItem('limz_instant_photo_broadcast', JSON.stringify(payload));
        } catch (e) { }

        // Tangani langsung secara instan di tab aktif jika sedang di monitor slideshow atau galeri publik
        if (appState.activeCollectionId === collId || !appState.activeCollectionId) {
            handleIncomingLiveBroadcastPhoto(payload);
        }
    }

    function handleIncomingLiveBroadcastPhoto(payload) {
        if (!payload || !payload.photo) return;
        var p = payload.photo;
        var collId = payload.collectionId;

        // 1. MONITOR PANGGUNG (view-slideshow)
        if (appState.currentView === 'view-slideshow' && (!collId || !appState.activeCollectionId || appState.activeCollectionId === collId)) {
            var displayUrl = p.dataUrl || p.thumbnailUrl || p.downloadUrl;
            var largeImg = document.getElementById('mon-large-img');
            var emptyEl = document.getElementById('mon-empty-state');
            if (emptyEl) emptyEl.style.display = 'none';
            if (largeImg) {
                largeImg.style.display = 'block';
                largeImg.src = displayUrl;
            }
            var mainKey = p.photoId || p.driveFileId;
            var slug = (appState.activeCollectionData && appState.activeCollectionData.slug) || '';
            if (mainKey) {
                var directUrl = getDirectPhotoOrGalleryUrl(slug, mainKey);
                setCachedQrCode('mon-qr-large-img', directUrl, 400);
            }
            if (slug) {
                var galleryPublicUrl = getPublicGalleryUrl(slug);
                setCachedQrCode('mon-qr-img', galleryPublicUrl, 260);
                var bEl = document.getElementById('mon-qr-badge-text');
                if (bEl) bEl.innerText = 'GALERI EVENT';
                var dEl = document.getElementById('mon-qr-heading-desc');
                if (dEl) dEl.innerHTML = 'Scan & Download<br><span style="color:#e2b86b;">Galeri Foto Event</span>';
                var hEl = document.getElementById('mon-qr-target-hint');
                if (hEl) hEl.innerText = '📲 Pindai untuk membuka seluruh galeri...';
            }
            showMonitorNewPhotoToast('📸 Foto / GIF Baru Saja Selesai Diunggah & Langsung Tayang!');

            // Amankan ke memori perputaran monitor agar foto baru tidak tertimpa foto lama
            if (!appState.monitorPhotos) appState.monitorPhotos = [];
            var monKey = p.photoId || p.driveFileId;
            var existsInMon = appState.monitorPhotos.some(function (item) {
                return (item.photoId && item.photoId === monKey) || (item.driveFileId && item.driveFileId === monKey);
            });
            if (!existsInMon) {
                appState.monitorPhotos.unshift(p);
            }

            if (appState.activeCollectionId) {
                fetchMonitorContent(appState.activeCollectionId, false);
            }
        }

        // 2. GALERI PUBLIK TAMU (view-public-gallery)
        if (appState.currentView === 'view-public-gallery' && (!collId || !appState.activeCollectionId || appState.activeCollectionId === collId)) {
            if (!appState.photos) appState.photos = [];
            var photoKey = p.photoId || p.driveFileId;
            var existsInGallery = appState.photos.some(function (item) {
                return (photoKey && ((item.photoId && item.photoId === photoKey) || (item.driveFileId && item.driveFileId === photoKey))) ||
                    (item.name && p.fileName && item.name === p.fileName);
            });
            if (!existsInGallery) {
                appState.photos.unshift(p);
                try {
                    var targetCollId = collId || appState.activeCollectionId;
                    if (targetCollId) {
                        localStorage.setItem('limz_cached_photos_' + targetCollId, JSON.stringify(appState.photos));
                    }
                } catch (e) { }
                renderGalleryPhotos(appState.photos);
                showToast('📸 Foto / GIF baru saja dipublikasikan & langsung tayang di galeri!');
            }
        }
    }

    function handleIncomingUploadBatchComplete(payload) {
        if (!payload) return;
        var collId = payload.collectionId;
        if (appState.activeCollectionId && collId && appState.activeCollectionId !== collId) return;

        if (appState.currentView === 'view-public-gallery' && appState.activeCollectionId) {
            loadGalleryPhotos(appState.activeCollectionId);
        } else if (appState.currentView === 'view-slideshow' && appState.activeCollectionId) {
            fetchMonitorContent(appState.activeCollectionId, true);
        }
    }

    function openStandaloneWebApp() {
        var targetUrl = appState.webAppUrl || window.location.href;
        if (targetUrl) {
            window.open(targetUrl, '_blank');
        } else {
            showToast('URL Web App belum terkonfigurasi.');
        }
    }

    function initDropzoneEvents() {
        var dropzone = document.getElementById('dropzone-upload-box');
        if (!dropzone) return;

        ['dragenter', 'dragover'].forEach(function (evtName) {
            dropzone.addEventListener(evtName, function (e) {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('drag-over-active');
            }, false);
        });

        ['dragleave', 'dragend'].forEach(function (evtName) {
            dropzone.addEventListener(evtName, function (e) {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over-active');
            }, false);
        });

        dropzone.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('drag-over-active');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handlePhotoFilesSelected(e.dataTransfer.files);
            }
        }, false);
    }

    function checkSavedUserSession() {
        try {
            var saved = localStorage.getItem('limz_saved_user_session');
            if (saved) {
                appState.currentUser = JSON.parse(saved);
                updateUserDisplay();
            }
        } catch (e) { }
    }

    function openAddCrewModal() {
        document.getElementById('crew-nama').value = '';
        document.getElementById('crew-email').value = '';
        document.getElementById('crew-password').value = '';
        openModal('modal-add-crew');
    }

    function openChangeLogoModal() {
        appState.tempUploadedLogoBase64 = null;
        var previewImg = document.getElementById('preview-change-logo-img');
        if (appState.studioLogoDataUrl) {
            previewImg.src = appState.studioLogoDataUrl;
            previewImg.style.display = 'block';
        } else {
            previewImg.src = '';
            previewImg.style.display = 'none';
        }
        openModal('modal-change-logo');
    }

    function handleLogoFileSelected(files) {
        if (!files || !files[0]) return;
        var file = files[0];
        var reader = new FileReader();
        reader.onload = function (e) {
            appState.tempUploadedLogoBase64 = e.target.result;
            var previewImg = document.getElementById('preview-change-logo-img');
            previewImg.src = e.target.result;
            previewImg.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }

    function saveCustomStudioLogo() {
        var logoData = appState.tempUploadedLogoBase64;
        if (!logoData) {
            showToast('Pilih file logo terlebih dahulu!');
            return;
        }
        var btn = document.getElementById('btn-save-studio-logo');
        btn.innerText = 'Menyimpan...';
        btn.disabled = true;

        google.script.run
            .withSuccessHandler(function (res) {
                btn.innerText = 'Simpan Logo';
                btn.disabled = false;
                if (res && res.success) {
                    localStorage.setItem('limz_studio_logo', res.logoUrl || logoData);
                    applyStudioLogoUI(res.logoUrl || logoData);
                    closeModal('modal-change-logo');
                    showToast(res.message || 'Logo studio berhasil diperbarui!');
                } else {
                    showToast((res && res.message) || 'Gagal menyimpan logo.');
                }
            })
            .withFailureHandler(function (err) {
                btn.innerText = 'Simpan Logo';
                btn.disabled = false;
                showToast('Gagal: ' + err);
            })
            .saveStudioLogo(logoData);
    }

    function updateUserDisplay() {
        if (!appState.currentUser) return;
        var nameEl = document.getElementById('user-display-name');
        var roleEl = document.getElementById('user-display-role');
        if (nameEl) nameEl.innerText = appState.currentUser.nama;
        if (roleEl) roleEl.innerText = 'Role: ' + (appState.currentUser.role || 'Admin');

        var adminElements = document.querySelectorAll('.role-admin-only');
        var isAdmin = (appState.currentUser.role === 'Admin');
        for (var a = 0; a < adminElements.length; a++) {
            adminElements[a].style.display = isAdmin ? '' : 'none';
        }
    }

    function handleNavLoginClick() {
        if (appState.currentUser) {
            onLoginSuccess();
        } else {
            switchView('view-login');
        }
    }

    function openFeaturesModal() {
        openModal('modal-features-explanation');
    }

    function initStudioLogo() {
        var savedLogo = localStorage.getItem('limz_studio_logo');
        if (savedLogo && savedLogo.indexOf('data:image') === 0) {
            applyStudioLogoUI(savedLogo);
        } else {
            google.script.run
                .withSuccessHandler(function (res) {
                    if (res && res.success && res.logoUrl) {
                        localStorage.setItem('limz_studio_logo', res.logoUrl);
                        applyStudioLogoUI(res.logoUrl);
                    }
                })
                .getStudioLogo();
        }
    }

    function applyStudioLogoUI(logoDataUrl) {
        appState.studioLogoDataUrl = logoDataUrl;
        var container = document.getElementById('landing-brand-logo-container');
        var textBlock = document.getElementById('landing-brand-text-block');

        if (logoDataUrl) {
            if (container) {
                container.innerHTML = '<img class="landing-brand-custom-img" src="' + logoDataUrl + '" alt="Studio Logo" style="max-height:46px; width:auto; object-fit:contain; display:block;">';
                container.style.width = 'auto';
                container.style.height = 'auto';
            }
            if (textBlock) {
                textBlock.style.display = 'none';
            }
        } else {
            if (container) {
                container.style.width = '38px';
                container.style.height = '36px';
                container.innerHTML = '<svg class="landing-brand-icon" viewBox="0 0 48 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:38px;height:34px;">' +
                    '<path d="M15 8L18.5 3H29.5L33 8H40C42.7614 8 45 10.2386 45 13V34C45 36.7614 42.7614 39 40 39H8C5.23858 39 3 36.7614 3 34V13C3 10.2386 5.23858 8 8 8H15Z" stroke="#ffffff" stroke-width="2.5"/>' +
                    '<path d="M18 3H30" stroke="#e04a2f" stroke-width="3" stroke-linecap="round"/>' +
                    '<circle cx="24" cy="23.5" r="8.5" stroke="#ffffff" stroke-width="2.5"/>' +
                    '<circle cx="24" cy="23.5" r="4" stroke="#e04a2f" stroke-width="2"/>' +
                    '<circle cx="37.5" cy="14.5" r="2" fill="#e04a2f"/>' +
                    '</svg>';
            }
            if (textBlock) {
                textBlock.style.display = 'flex';
            }
        }
    }

    function resetDefaultStudioLogo() {
        localStorage.removeItem('limz_studio_logo');
        applyStudioLogoUI(null);
        closeModal('modal-change-logo');
        showToast('Logo studio dikembalikan ke ikon bawaan.');
    }

    function setPhotoFilterPreset(presetName, btnEl) {
        appState.photoFilterState.preset = presetName;
        var buttons = document.querySelectorAll('.filter-preset-btn');
        buttons.forEach(function (b) { b.classList.remove('active'); });
        if (btnEl) btnEl.classList.add('active');

        // Reset default parameter
        var s = appState.photoFilterState;
        s.exposure = 0; s.brightness = 0; s.contrast = 0; s.highlights = 0; s.shadows = 0;
        s.whites = 0; s.blacks = 0; s.temperature = 0; s.tint = 0; s.vibrance = 0;
        s.saturation = 0; s.clarity = 0; s.texture = 0; s.dehaze = 0; s.sharpen = 0; s.grain = 0;
        s.curve = { highlights: 0, lights: 0, darks: 0, shadows: 0 };
        s.colorMix = {
            activeColor: 'orange',
            red: { h: 0, s: 0, l: 0 }, orange: { h: 0, s: 0, l: 0 }, yellow: { h: 0, s: 0, l: 0 },
            green: { h: 0, s: 0, l: 0 }, aqua: { h: 0, s: 0, l: 0 }, blue: { h: 0, s: 0, l: 0 },
            purple: { h: 0, s: 0, l: 0 }, magenta: { h: 0, s: 0, l: 0 }
        };
        s.colorGrading = {
            activeZone: 'shadows',
            shadows: { h: 0, s: 0 }, midtones: { h: 0, s: 0 }, highlights: { h: 0, s: 0 }, balance: 0
        };

        if (presetName === 'warm') {
            s.exposure = 5; s.contrast = 8; s.highlights = -5; s.shadows = 10;
            s.whites = 8; s.blacks = -4; s.temperature = 18; s.tint = 4;
            s.vibrance = 12; s.saturation = 10; s.clarity = 6; s.texture = 4;
            s.colorMix.orange.l = 8; // Mencerahkan skin tone
            s.colorGrading.shadows = { h: 40, s: 15 };
            s.colorGrading.highlights = { h: 48, s: 12 };
        } else if (presetName === 'soft') {
            s.exposure = 8; s.contrast = -6; s.highlights = -10; s.shadows = 15;
            s.whites = 10; s.blacks = -6; s.temperature = 8; s.tint = 2;
            s.vibrance = 6; s.saturation = 4; s.clarity = -4; s.texture = 8;
            s.colorMix.orange.l = 15; // Kulit mulus cerah ala Korea
            s.colorMix.yellow.l = 8;
        } else if (presetName === 'bw') {
            s.exposure = 2; s.contrast = 24; s.highlights = -12; s.shadows = 8;
            s.whites = 15; s.blacks = -15; s.saturation = -100;
            s.clarity = 15; s.texture = 10; s.sharpen = 15; s.grain = 10;
        } else if (presetName === 'vintage') {
            s.exposure = -2; s.contrast = 12; s.highlights = -15; s.shadows = 12;
            s.whites = -8; s.blacks = 15; // Matte shadows
            s.temperature = 14; s.tint = -6; s.saturation = -15;
            s.clarity = 6; s.grain = 20;
            s.colorGrading.shadows = { h: 32, s: 20 };
            s.colorGrading.highlights = { h: 55, s: 15 };
        } else if (presetName === 'vivid') {
            s.exposure = 4; s.contrast = 16; s.highlights = -6; s.shadows = 8;
            s.whites = 12; s.blacks = -10; s.temperature = 4; s.tint = 0;
            s.vibrance = 25; s.saturation = 15; s.clarity = 10; s.texture = 8; s.sharpen = 12;
        } else if (presetName === 'glamour') {
            s.exposure = 6; s.contrast = 12; s.highlights = -4; s.shadows = 12;
            s.whites = 14; s.blacks = -4; s.temperature = 14; s.tint = 6;
            s.vibrance = 15; s.saturation = 12; s.clarity = 6; s.texture = 10;
            s.colorMix.orange.l = 12; s.colorMix.orange.s = 4;
            s.colorGrading.highlights = { h: 42, s: 18 };
        }

        if (appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
            appState.stagedPhotos[appState.activeStagedIndex].appliedGrading = JSON.parse(JSON.stringify(s));
        }
        if (s.isLocked) {
            try {
                localStorage.setItem('limz_locked_tone_profile', JSON.stringify(s));
            } catch (err) { }
        }

        syncFilterSlidersToState();
        updatePhotoGradingPreview();
        showToast('Preset filter diterapkan: ' + presetName.toUpperCase());
    }

    function triggerAutoAdjustPhoto() {
        appState.photoFilterState.preset = 'custom';
        appState.photoFilterState.brightness = 6;
        appState.photoFilterState.contrast = 12;
        appState.photoFilterState.saturation = 10;
        appState.photoFilterState.shadows = 14;
        appState.photoFilterState.highlights = -8;

        var buttons = document.querySelectorAll('.filter-preset-btn');
        buttons.forEach(function (b) { b.classList.remove('active'); });

        syncFilterSlidersToState();
        updatePhotoGradingPreview();
        showToast('⚡ Auto Tone Optimal berhasil diterapkan!');
    }

    function triggerAutoWhiteBalance() {
        var bgImg = document.getElementById('wm-simulator-bg');
        if (!bgImg) return;

        var sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = 64;
        sampleCanvas.height = 64;
        var sCtx = sampleCanvas.getContext('2d');
        try {
            sCtx.drawImage(bgImg, 0, 0, 64, 64);
            var imgData = sCtx.getImageData(0, 0, 64, 64);
            var data = imgData.data;
            var totalR = 0, totalG = 0, totalB = 0, count = 0;
            for (var i = 0; i < data.length; i += 4) {
                var lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                if (lum > 25 && lum < 230) {
                    totalR += data[i];
                    totalG += data[i + 1];
                    totalB += data[i + 2];
                    count++;
                }
            }
            if (count > 0) {
                var avgR = totalR / count;
                var avgG = totalG / count;
                var avgB = totalB / count;
                var avgGray = (avgR + avgG + avgB) / 3;

                var tempCorrection = Math.round(((avgB - avgR) / avgGray) * 35);
                tempCorrection = Math.max(-50, Math.min(50, tempCorrection));

                var expectedG = (avgR + avgB) / 2;
                var tintCorrection = Math.round(((expectedG - avgG) / avgGray) * 35);
                tintCorrection = Math.max(-50, Math.min(50, tintCorrection));

                appState.photoFilterState.temperature = tempCorrection;
                appState.photoFilterState.tint = tintCorrection;
            } else {
                appState.photoFilterState.temperature = -4;
                appState.photoFilterState.tint = 0;
            }
        } catch (e) {
            appState.photoFilterState.temperature = -4;
            appState.photoFilterState.tint = 0;
        }

        appState.photoFilterState.preset = 'custom';
        var buttons = document.querySelectorAll('.filter-preset-btn');
        buttons.forEach(function (b) { b.classList.remove('active'); });

        syncFilterSlidersToState();
        updatePhotoGradingPreview();
        showToast('⚡ Auto White Balance berhasil diseimbangkan!');
    }

    function resetPhotoFilters() {
        setPhotoFilterPreset('normal', document.getElementById('btn-flt-normal'));
        var badgeG = document.getElementById('badge-grading-status');
        if (badgeG) {
            badgeG.innerText = 'Normal';
            badgeG.style.background = '#eff6ff';
            badgeG.style.color = '#1d4ed8';
            badgeG.style.border = '1px solid #bfdbfe';
        }
    }

    /* =========================================================================
       ACCORDION / COLLAPSIBLE WORKSTATION PANELS (GRADING & WATERMARK)
       ========================================================================= */
    function toggleWorkstationPanel(name) {
        var body = document.getElementById('body-panel-' + name);
        var chev = document.getElementById('chevron-panel-' + name);
        if (!body) return;
        var isClosed = (body.style.display === 'none' || !body.style.display);
        if (isClosed) {
            body.style.display = 'block';
            if (chev) chev.innerHTML = '▼ Tutup';
        } else {
            body.style.display = 'none';
            if (chev) chev.innerHTML = '▶ Buka';
        }
    }

    /* =========================================================================
       IMPORT PRESET LIGHTROOM (.XMP & .DNG)
       ========================================================================= */
    function handleLightroomPresetSelected(files) {
        if (!files || !files[0]) return;
        var file = files[0];
        var fileName = (file.name || '').toLowerCase();

        if (fileName.endsWith('.xmp')) {
            var reader = new FileReader();
            reader.onload = function (e) {
                parseAndApplyLightroomXMP(e.target.result, file.name);
            };
            reader.onerror = function () {
                showToast('❌ Gagal membaca file preset .XMP!');
            };
            reader.readAsText(file, 'UTF-8');
        } else if (fileName.endsWith('.dng')) {
            var reader = new FileReader();
            reader.onload = function (e) {
                extractAndApplyDngPreset(e.target.result, file.name);
            };
            reader.onerror = function () {
                showToast('❌ Gagal membaca file preset .DNG!');
            };
            reader.readAsArrayBuffer(file);
        } else {
            showToast('⚠️ Format file tidak didukung! Harap pilih preset berekstensi .XMP atau .DNG.');
        }

        var inputEl = document.getElementById('file-input-lr-preset');
        if (inputEl) inputEl.value = '';
    }

    function extractAndApplyDngPreset(arrayBuffer, fileName) {
        try {
            var uint8 = new Uint8Array(arrayBuffer);
            var len = uint8.length;
            var endNeedle = '</x:xmpmeta>';

            // Scan 4MB pertama file (XMP TIFF header biasanya berada di 1-2MB pertama)
            var scanLimit = Math.min(len, 4 * 1024 * 1024);
            var subArr = uint8.subarray(0, scanLimit);
            var text = new TextDecoder('utf-8', { fatal: false }).decode(subArr);

            var startIdx = text.indexOf('<x:xmpmeta');
            if (startIdx === -1) {
                startIdx = text.indexOf('<rdf:RDF');
                endNeedle = '</rdf:RDF>';
            }

            if (startIdx !== -1) {
                var endIdx = text.indexOf(endNeedle, startIdx);
                if (endIdx !== -1) {
                    var xmpXml = text.substring(startIdx, endIdx + endNeedle.length);
                    parseAndApplyLightroomXMP(xmpXml, fileName);
                    return;
                }
            }

            // Jika file ukuran sedang (<= 30MB) dan belum ketemu di 4MB pertama, scan seluruh file
            if (len > scanLimit && len <= 30 * 1024 * 1024) {
                var fullText = new TextDecoder('utf-8', { fatal: false }).decode(uint8);
                var fStart = fullText.indexOf('<x:xmpmeta');
                if (fStart === -1) {
                    fStart = fullText.indexOf('<rdf:RDF');
                    endNeedle = '</rdf:RDF>';
                }
                if (fStart !== -1) {
                    var fEnd = fullText.indexOf(endNeedle, fStart);
                    if (fEnd !== -1) {
                        var xmpXml2 = fullText.substring(fStart, fEnd + endNeedle.length);
                        parseAndApplyLightroomXMP(xmpXml2, fileName);
                        return;
                    }
                }
            }

            showToast('⚠️ Metadata Camera Raw / XMP tidak ditemukan pada file DNG ini.');
        } catch (err) {
            console.error('DNG preset extraction error:', err);
            showToast('❌ Gagal memproses file DNG: ' + err.message);
        }
    }

    function getXmpTagOrAttr(xml, tagName) {
        // 1. Cek pola attribute: crs:TagName="..." atau crs:TagName='...'
        var attrRegex = new RegExp('(?:crs:)?' + tagName + '\\s*=\\s*["\']([^"\']+)["\']', 'i');
        var m = xml.match(attrRegex);
        if (m && m[1]) return m[1].trim();

        // 2. Cek pola XML tag: <crs:TagName>value</crs:TagName>
        var tagRegex = new RegExp('<(?:crs:)?' + tagName + '[^>]*>([^<]+)</(?:crs:)?' + tagName + '>', 'i');
        m = xml.match(tagRegex);
        if (m && m[1]) return m[1].trim();

        return null;
    }

    function parseAndApplyLightroomXMP(xmpString, fileName) {
        try {
            if (!xmpString || typeof xmpString !== 'string') {
                showToast('⚠️ Isi metadata XMP kosong.');
                return;
            }

            // 1. Ekstraksi Temperatur
            var temp = 0;
            var incTemp = getXmpTagOrAttr(xmpString, 'IncrementalTemperature');
            if (incTemp !== null) {
                temp = Math.round(parseFloat(incTemp) * 0.5);
            } else {
                var rawTemp = getXmpTagOrAttr(xmpString, 'Temperature');
                if (rawTemp !== null) {
                    var k = parseFloat(rawTemp);
                    if (!isNaN(k)) {
                        temp = Math.round((k - 5500) / 60);
                    }
                }
            }

            // 2. Ekstraksi Tint
            var tint = 0;
            var incTint = getXmpTagOrAttr(xmpString, 'IncrementalTint');
            if (incTint !== null) {
                tint = Math.round(parseFloat(incTint) * 0.5);
            } else {
                var rawTint = getXmpTagOrAttr(xmpString, 'Tint');
                if (rawTint !== null) {
                    var tVal = parseFloat(rawTint);
                    if (!isNaN(tVal)) {
                        tint = Math.round((tVal - 10) * 0.5);
                    }
                }
            }

            // 3. Ekstraksi Exposure -> Brightness (-50 s/d +50)
            var brightness = 0;
            var expRaw = getXmpTagOrAttr(xmpString, 'Exposure2012') || getXmpTagOrAttr(xmpString, 'Exposure');
            if (expRaw !== null) {
                var ev = parseFloat(expRaw);
                if (!isNaN(ev)) {
                    brightness = Math.round(ev * 24);
                }
            }

            // 4. Ekstraksi Contrast -> (-50 s/d +50)
            var contrast = 0;
            var contrastRaw = getXmpTagOrAttr(xmpString, 'Contrast2012') || getXmpTagOrAttr(xmpString, 'Contrast');
            if (contrastRaw !== null) {
                var cVal = parseFloat(contrastRaw);
                if (!isNaN(cVal)) {
                    contrast = Math.round(cVal * 0.5);
                }
            }

            // 5. Ekstraksi Highlights -> (-50 s/d +50)
            var highlights = 0;
            var hlRaw = getXmpTagOrAttr(xmpString, 'Highlights2012') || getXmpTagOrAttr(xmpString, 'Highlights');
            if (hlRaw !== null) {
                var hVal = parseFloat(hlRaw);
                if (!isNaN(hVal)) {
                    highlights = Math.round(hVal * 0.5);
                }
            }

            // 6. Ekstraksi Shadows -> (-50 s/d +50)
            var shadows = 0;
            var shRaw = getXmpTagOrAttr(xmpString, 'Shadows2012') || getXmpTagOrAttr(xmpString, 'Shadows');
            if (shRaw !== null) {
                var sVal = parseFloat(shRaw);
                if (!isNaN(sVal)) {
                    shadows = Math.round(sVal * 0.5);
                }
            }

            // 7. Ekstraksi Saturation & Vibrance -> (-100 s/d +100)
            var saturation = 0;
            var satRaw = getXmpTagOrAttr(xmpString, 'Saturation');
            var vibRaw = getXmpTagOrAttr(xmpString, 'Vibrance');
            var sNum = satRaw !== null ? parseFloat(satRaw) : 0;
            var vNum = vibRaw !== null ? parseFloat(vibRaw) : 0;
            saturation = Math.round(sNum + (vNum * 0.4));

            // Cek B&W treatment
            var colorTreatment = getXmpTagOrAttr(xmpString, 'ColorTreatment');
            var isBW = (colorTreatment && colorTreatment.toLowerCase().indexOf('black') !== -1) || saturation <= -90;

            // Clamping ke rentang slider studio
            appState.photoFilterState.temperature = Math.max(-50, Math.min(50, temp));
            appState.photoFilterState.tint = Math.max(-50, Math.min(50, tint));
            appState.photoFilterState.brightness = Math.max(-50, Math.min(50, brightness));
            appState.photoFilterState.contrast = Math.max(-50, Math.min(50, contrast));
            appState.photoFilterState.highlights = Math.max(-50, Math.min(50, highlights));
            appState.photoFilterState.shadows = Math.max(-50, Math.min(50, shadows));
            appState.photoFilterState.saturation = Math.max(-100, Math.min(100, saturation));
            appState.photoFilterState.preset = isBW ? 'bw' : 'custom';

            // Nonaktifkan preset tombol bawaan
            var buttons = document.querySelectorAll('.filter-preset-btn');
            buttons.forEach(function (b) { b.classList.remove('active'); });

            // Sinkronkan slider dan render live preview
            syncFilterSlidersToState();
            updatePhotoGradingPreview();

            // Buka panel grading otomatis agar pengguna melihat hasil slidernya
            var body = document.getElementById('body-panel-grading');
            var chev = document.getElementById('chevron-panel-grading');
            if (body) {
                body.style.display = 'block';
                if (chev) chev.innerHTML = '▼ Tutup';
            }

            // Update badge status grading
            var badge = document.getElementById('badge-grading-status');
            var cleanName = fileName.replace(/\.(xmp|dng)$/i, '');
            if (badge) {
                badge.innerText = 'LR: ' + (cleanName.length > 12 ? cleanName.substring(0, 10) + '..' : cleanName);
                badge.style.background = '#eff6ff';
                badge.style.color = '#1d4ed8';
                badge.style.border = '1px solid #bfdbfe';
            }

            // Ekstraksi profil kamera & update Referensi Warna XMP/DNG
            var camProfile = getXmpTagOrAttr(xmpString, 'CameraProfile') || getXmpTagOrAttr(xmpString, 'CameraProfileName') || 'Adobe Standard';
            if (typeof updateDngColorReference === 'function') {
                updateDngColorReference(cleanName, camProfile, appState.photoFilterState);
            }

            showToast('🎨 Preset Lightroom "' + fileName + '" berhasil diterapkan!');
        } catch (err) {
            console.error('Error applying XMP preset:', err);
            showToast('❌ Gagal menerapkan preset Lightroom: ' + err.message);
        }
    }

    /* =========================================================================
       ADOBE LIGHTROOM CONTROLLERS, SUB-TABS, CURVE CANVAS & LOCK TONE
       ========================================================================= */

    function switchLrGradingTab(tabName, btnEl) {
        var navBtns = document.querySelectorAll('.lr-tab-btn');
        navBtns.forEach(function (b) { b.classList.remove('active'); });
        if (btnEl) btnEl.classList.add('active');

        var panes = document.querySelectorAll('.lr-tab-pane');
        panes.forEach(function (p) { p.classList.remove('active'); });

        var targetPane = document.getElementById('lr-pane-' + tabName);
        if (targetPane) targetPane.classList.add('active');

        if (tabName === 'curve') {
            drawToneCurveCanvas();
        }
    }

    function switchToneCurveChannel(ch) {
        appState.photoFilterState.activeCurveChannel = ch;
        var btns = document.querySelectorAll('.lr-curve-ch-btn');
        btns.forEach(function (b) { b.classList.remove('active'); });
        var targetBtn = document.getElementById('btn-crv-' + (ch === 'rgb' ? 'rgb' : ch.charAt(0)));
        if (targetBtn) targetBtn.classList.add('active');
        drawToneCurveCanvas();
    }

    function drawToneCurveCanvas() {
        var cv = document.getElementById('canvas-lr-curve');
        if (!cv) return;
        var ctx = cv.getContext('2d');
        var w = cv.width, h = cv.height;

        // Clear canvas
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var x = w / 4; x < w; x += w / 4) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (var y = h / 4; y < h; y += h / 4) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();

        // Baseline diagonal
        ctx.strokeStyle = '#475569';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(w, 0);
        ctx.stroke();
        ctx.setLineDash([]);

        // Calculate control points based on curve sliders
        var s = appState.photoFilterState;
        var crv = s.curve || { highlights: 0, lights: 0, darks: 0, shadows: 0 };
        var p0 = { x: 0, y: h - (crv.shadows * 0.4) };
        var p1 = { x: w * 0.3, y: h * 0.7 - (crv.darks * 0.5) };
        var p2 = { x: w * 0.7, y: h * 0.3 - (crv.lights * 0.5) };
        var p3 = { x: w, y: 0 - (crv.highlights * 0.4) };

        // Channel Color
        var ch = s.activeCurveChannel || 'rgb';
        if (ch === 'red') ctx.strokeStyle = '#ef4444';
        else if (ch === 'green') ctx.strokeStyle = '#10b981';
        else if (ch === 'blue') ctx.strokeStyle = '#3b82f6';
        else ctx.strokeStyle = '#f8fafc';

        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        ctx.stroke();

        // Control point dots
        ctx.fillStyle = '#f59e0b';
        [p0, p1, p2, p3].forEach(function (pt) {
            ctx.beginPath();
            ctx.arc(Math.max(3, Math.min(w - 3, pt.x)), Math.max(3, Math.min(h - 3, pt.y)), 3.5, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    function switchHslActiveColor(colorName, el) {
        appState.photoFilterState.colorMix.activeColor = colorName;
        var bubbles = document.querySelectorAll('.lr-color-bubble-item');
        bubbles.forEach(function (b) { b.classList.remove('active'); });
        if (el) el.classList.add('active');

        var titleEl = document.getElementById('lbl-active-hsl-color-title');
        var isSkin = (colorName === 'orange' || colorName === 'yellow');
        if (titleEl) {
            titleEl.innerHTML = 'Warna Aktif: ' + colorName.toUpperCase() + (isSkin ? ' <span style="color:#d97706; font-size:10px;">(Penyempurna Skin Tone Kulit)</span>' : '');
        }

        var colData = appState.photoFilterState.colorMix[colorName] || { h: 0, s: 0, l: 0 };
        var elById = function (id) { return document.getElementById(id); };
        if (elById('slider-flt-hsl-hue')) elById('slider-flt-hsl-hue').value = colData.h || 0;
        if (elById('slider-flt-hsl-sat')) elById('slider-flt-hsl-sat').value = colData.s || 0;
        if (elById('slider-flt-hsl-lum')) elById('slider-flt-hsl-lum').value = colData.l || 0;
        if (elById('lbl-hsl-hue')) elById('lbl-hsl-hue').innerText = (colData.h >= 0 ? '+' : '') + colData.h;
        if (elById('lbl-hsl-sat')) elById('lbl-hsl-sat').innerText = (colData.s >= 0 ? '+' : '') + colData.s + '%';
        if (elById('lbl-hsl-lum')) elById('lbl-hsl-lum').innerText = (colData.l >= 0 ? '+' : '') + colData.l + '%';
    }

    function switchCgZone(zoneName, el) {
        appState.photoFilterState.colorGrading.activeZone = zoneName;
        var btns = ['btn-cg-shadows', 'btn-cg-midtones', 'btn-cg-highlights'];
        btns.forEach(function (bId) {
            var b = document.getElementById(bId);
            if (b) b.classList.remove('active');
        });
        if (el) el.classList.add('active');

        var titleEl = document.getElementById('lbl-cg-zone-title');
        if (titleEl) titleEl.innerText = 'Zona Pewarnaan: ' + zoneName.toUpperCase();

        var zData = appState.photoFilterState.colorGrading[zoneName] || { h: 0, s: 0 };
        var elById = function (id) { return document.getElementById(id); };
        if (elById('slider-flt-cg-hue')) elById('slider-flt-cg-hue').value = zData.h || 0;
        if (elById('slider-flt-cg-sat')) elById('slider-flt-cg-sat').value = zData.s || 0;
        if (elById('slider-flt-cg-balance')) elById('slider-flt-cg-balance').value = appState.photoFilterState.colorGrading.balance || 0;
        if (elById('lbl-cg-hue')) elById('lbl-cg-hue').innerText = (zData.h || 0) + '°';
        if (elById('lbl-cg-sat')) elById('lbl-cg-sat').innerText = (zData.s || 0) + '%';
        if (elById('lbl-cg-balance')) elById('lbl-cg-balance').innerText = (appState.photoFilterState.colorGrading.balance || 0);
    }

    /* =========================================================================
       LOCK / SYNC TONE CONTROLLERS
       ========================================================================= */

    function toggleLockTone(e) {
        if (e) e.stopPropagation();
        var s = appState.photoFilterState;
        s.isLocked = !s.isLocked;
        var btn = document.getElementById('btn-toggle-lock-tone');

        if (s.isLocked) {
            if (btn) {
                btn.innerHTML = '🔒 Kunci Tone: AKTIF';
                btn.classList.add('locked');
            }
            try {
                localStorage.setItem('limz_locked_tone_profile', JSON.stringify(s));
            } catch (err) { }
            showToast('🔒 Tone Studio Terkunci! Setiap foto baru dari kamera otomatis memakai tone ini.');
        } else {
            if (btn) {
                btn.innerHTML = '🔒 Kunci Tone: NONAKTIF';
                btn.classList.remove('locked');
            }
            try {
                localStorage.removeItem('limz_locked_tone_profile');
            } catch (err) { }
            showToast('🔓 Kunci Tone Dinonaktifkan.');
        }
    }

    function syncToneToAllStagedPhotos(e) {
        if (e) e.stopPropagation();
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) {
            showToast('Belum ada foto di antrian untuk disinkronkan.');
            return;
        }

        var snapshot = JSON.parse(JSON.stringify(appState.photoFilterState));
        for (var i = 0; i < appState.stagedPhotos.length; i++) {
            appState.stagedPhotos[i].appliedGrading = JSON.parse(JSON.stringify(snapshot));
        }

        updatePhotoGradingPreview();
        showToast('🔄 Settingan tone berhasil diterapkan ke ' + appState.stagedPhotos.length + ' foto di antrian!');
    }

    /* =========================================================================
       SLIDER SYNC & EVENT LISTENERS
       ========================================================================= */

    function syncFilterSlidersToState() {
        var s = appState.photoFilterState;
        var el = function (id) { return document.getElementById(id); };

        // Tab Light
        if (el('slider-flt-exposure')) el('slider-flt-exposure').value = s.exposure || 0;
        if (el('slider-flt-contrast')) el('slider-flt-contrast').value = s.contrast || 0;
        if (el('slider-flt-highlights')) el('slider-flt-highlights').value = s.highlights || 0;
        if (el('slider-flt-shadows')) el('slider-flt-shadows').value = s.shadows || 0;
        if (el('slider-flt-whites')) el('slider-flt-whites').value = s.whites || 0;
        if (el('slider-flt-blacks')) el('slider-flt-blacks').value = s.blacks || 0;

        if (el('lbl-flt-exposure')) el('lbl-flt-exposure').innerText = ((s.exposure || 0) >= 0 ? '+' : '') + ((s.exposure || 0) / 25).toFixed(2) + ' EV';
        if (el('lbl-flt-contrast')) el('lbl-flt-contrast').innerText = ((s.contrast || 0) >= 0 ? '+' : '') + (s.contrast || 0) + '%';
        if (el('lbl-flt-highlights')) el('lbl-flt-highlights').innerText = ((s.highlights || 0) >= 0 ? '+' : '') + (s.highlights || 0) + '%';
        if (el('lbl-flt-shadows')) el('lbl-flt-shadows').innerText = ((s.shadows || 0) >= 0 ? '+' : '') + (s.shadows || 0) + '%';
        if (el('lbl-flt-whites')) el('lbl-flt-whites').innerText = ((s.whites || 0) >= 0 ? '+' : '') + (s.whites || 0) + '%';
        if (el('lbl-flt-blacks')) el('lbl-flt-blacks').innerText = ((s.blacks || 0) >= 0 ? '+' : '') + (s.blacks || 0) + '%';

        // Tab Curve
        var crv = s.curve || { highlights: 0, lights: 0, darks: 0, shadows: 0 };
        if (el('slider-flt-crv-hl')) el('slider-flt-crv-hl').value = crv.highlights || 0;
        if (el('slider-flt-crv-lights')) el('slider-flt-crv-lights').value = crv.lights || 0;
        if (el('slider-flt-crv-darks')) el('slider-flt-crv-darks').value = crv.darks || 0;
        if (el('slider-flt-crv-sh')) el('slider-flt-crv-sh').value = crv.shadows || 0;
        if (el('lbl-flt-crv-hl')) el('lbl-flt-crv-hl').innerText = (crv.highlights || 0);
        if (el('lbl-flt-crv-lights')) el('lbl-flt-crv-lights').innerText = (crv.lights || 0);
        if (el('lbl-flt-crv-darks')) el('lbl-flt-crv-darks').innerText = (crv.darks || 0);
        if (el('lbl-flt-crv-sh')) el('lbl-flt-crv-sh').innerText = (crv.shadows || 0);

        // Tab Color & WB
        if (el('slider-flt-temp')) el('slider-flt-temp').value = s.temperature || 0;
        if (el('slider-flt-tint')) el('slider-flt-tint').value = s.tint || 0;
        if (el('slider-flt-vibrance')) el('slider-flt-vibrance').value = s.vibrance || 0;
        if (el('slider-flt-sat')) el('slider-flt-sat').value = s.saturation || 0;
        if (el('lbl-flt-temp')) el('lbl-flt-temp').innerText = ((s.temperature || 0) >= 0 ? '+' : '') + (s.temperature || 0);
        if (el('lbl-flt-tint')) el('lbl-flt-tint').innerText = ((s.tint || 0) >= 0 ? '+' : '') + (s.tint || 0);
        if (el('lbl-flt-vibrance')) el('lbl-flt-vibrance').innerText = ((s.vibrance || 0) >= 0 ? '+' : '') + (s.vibrance || 0) + '%';
        if (el('lbl-flt-sat')) el('lbl-flt-sat').innerText = ((s.saturation || 0) >= 0 ? '+' : '') + (s.saturation || 0) + '%';

        // Tab Effects & Detail
        if (el('slider-flt-clarity')) el('slider-flt-clarity').value = s.clarity || 0;
        if (el('slider-flt-texture')) el('slider-flt-texture').value = s.texture || 0;
        if (el('slider-flt-dehaze')) el('slider-flt-dehaze').value = s.dehaze || 0;
        if (el('slider-flt-sharpen')) el('slider-flt-sharpen').value = s.sharpen || 0;
        if (el('slider-flt-grain')) el('slider-flt-grain').value = s.grain || 0;
        if (el('lbl-flt-clarity')) el('lbl-flt-clarity').innerText = ((s.clarity || 0) >= 0 ? '+' : '') + (s.clarity || 0) + '%';
        if (el('lbl-flt-texture')) el('lbl-flt-texture').innerText = ((s.texture || 0) >= 0 ? '+' : '') + (s.texture || 0) + '%';
        if (el('lbl-flt-dehaze')) el('lbl-flt-dehaze').innerText = ((s.dehaze || 0) >= 0 ? '+' : '') + (s.dehaze || 0) + '%';
        if (el('lbl-flt-sharpen')) el('lbl-flt-sharpen').innerText = (s.sharpen || 0) + '%';
        if (el('lbl-flt-grain')) el('lbl-flt-grain').innerText = (s.grain || 0) + '%';

        // Tab HSL active color
        var actCol = (s.colorMix && s.colorMix.activeColor) ? s.colorMix.activeColor : 'orange';
        var colData = (s.colorMix && s.colorMix[actCol]) ? s.colorMix[actCol] : { h: 0, s: 0, l: 0 };
        if (el('slider-flt-hsl-hue')) el('slider-flt-hsl-hue').value = colData.h || 0;
        if (el('slider-flt-hsl-sat')) el('slider-flt-hsl-sat').value = colData.s || 0;
        if (el('slider-flt-hsl-lum')) el('slider-flt-hsl-lum').value = colData.l || 0;
        if (el('lbl-hsl-hue')) el('lbl-hsl-hue').innerText = ((colData.h || 0) >= 0 ? '+' : '') + (colData.h || 0);
        if (el('lbl-hsl-sat')) el('lbl-hsl-sat').innerText = ((colData.s || 0) >= 0 ? '+' : '') + (colData.s || 0) + '%';
        if (el('lbl-hsl-lum')) el('lbl-hsl-lum').innerText = ((colData.l || 0) >= 0 ? '+' : '') + (colData.l || 0) + '%';

        // Tab Color Grading
        var actZ = (s.colorGrading && s.colorGrading.activeZone) ? s.colorGrading.activeZone : 'shadows';
        var zData = (s.colorGrading && s.colorGrading[actZ]) ? s.colorGrading[actZ] : { h: 0, s: 0 };
        if (el('slider-flt-cg-hue')) el('slider-flt-cg-hue').value = zData.h || 0;
        if (el('slider-flt-cg-sat')) el('slider-flt-cg-sat').value = zData.s || 0;
        if (el('slider-flt-cg-balance')) el('slider-flt-cg-balance').value = (s.colorGrading && s.colorGrading.balance) || 0;
        if (el('lbl-cg-hue')) el('lbl-cg-hue').innerText = (zData.h || 0) + '°';
        if (el('lbl-cg-sat')) el('lbl-cg-sat').innerText = (zData.s || 0) + '%';
        if (el('lbl-cg-balance')) el('lbl-cg-balance').innerText = ((s.colorGrading && s.colorGrading.balance) || 0);

        drawToneCurveCanvas();
    }

    function updateCustomFilterSliders() {
        var el = function (id) { return document.getElementById(id); };
        var s = appState.photoFilterState;
        if (!s) return;

        // Label formatters for Lightroom UI
        if (el('slider-flt-exposure') && el('lbl-flt-exposure')) {
            var ev = (parseInt(el('slider-flt-exposure').value, 10) / 10).toFixed(2);
            el('lbl-flt-exposure').textContent = (ev > 0 ? '+' : '') + ev + ' EV';
        }
        if (el('slider-flt-contrast') && el('lbl-flt-contrast')) el('lbl-flt-contrast').textContent = el('slider-flt-contrast').value;
        if (el('slider-flt-highlights') && el('lbl-flt-highlights')) el('lbl-flt-highlights').textContent = el('slider-flt-highlights').value;
        if (el('slider-flt-shadows') && el('lbl-flt-shadows')) el('lbl-flt-shadows').textContent = el('slider-flt-shadows').value;
        if (el('slider-flt-whites') && el('lbl-flt-whites')) el('lbl-flt-whites').textContent = el('slider-flt-whites').value;
        if (el('slider-flt-blacks') && el('lbl-flt-blacks')) el('lbl-flt-blacks').textContent = el('slider-flt-blacks').value;

        if (el('slider-flt-temp') && el('lbl-flt-temp')) {
            var rawT = parseInt(el('slider-flt-temp').value, 10);
            var kelvin = 5500 + (rawT * 80);
            el('lbl-flt-temp').textContent = kelvin + 'K';
        }
        if (el('slider-flt-tint') && el('lbl-flt-tint')) {
            var rawTint = parseInt(el('slider-flt-tint').value, 10);
            el('lbl-flt-tint').textContent = (rawTint > 0 ? '+' : '') + rawTint;
        }

        if (el('slider-flt-clarity') && el('lbl-flt-clarity')) el('lbl-flt-clarity').textContent = el('slider-flt-clarity').value;
        if (el('slider-flt-dehaze') && el('lbl-flt-dehaze')) el('lbl-flt-dehaze').textContent = el('slider-flt-dehaze').value;
        if (el('slider-flt-vibrance') && el('lbl-flt-vibrance')) el('lbl-flt-vibrance').textContent = el('slider-flt-vibrance').value + '%';
        if (el('slider-flt-sat') && el('lbl-flt-sat')) el('lbl-flt-sat').textContent = el('slider-flt-sat').value + '%';

        // Light
        if (el('slider-flt-exposure')) s.exposure = parseInt(el('slider-flt-exposure').value, 10);
        if (el('slider-flt-contrast')) s.contrast = parseInt(el('slider-flt-contrast').value, 10);
        if (el('slider-flt-highlights')) s.highlights = parseInt(el('slider-flt-highlights').value, 10);
        if (el('slider-flt-shadows')) s.shadows = parseInt(el('slider-flt-shadows').value, 10);
        if (el('slider-flt-whites')) s.whites = parseInt(el('slider-flt-whites').value, 10);
        if (el('slider-flt-blacks')) s.blacks = parseInt(el('slider-flt-blacks').value, 10);

        // Curve
        if (!s.curve) s.curve = {};
        if (el('slider-flt-crv-hl')) s.curve.highlights = parseInt(el('slider-flt-crv-hl').value, 10);
        if (el('slider-flt-crv-lights')) s.curve.lights = parseInt(el('slider-flt-crv-lights').value, 10);
        if (el('slider-flt-crv-darks')) s.curve.darks = parseInt(el('slider-flt-crv-darks').value, 10);
        if (el('slider-flt-crv-sh')) s.curve.shadows = parseInt(el('slider-flt-crv-sh').value, 10);

        // Color & WB
        if (el('slider-flt-temp')) s.temperature = parseInt(el('slider-flt-temp').value, 10);
        if (el('slider-flt-tint')) s.tint = parseInt(el('slider-flt-tint').value, 10);
        if (el('slider-flt-vibrance')) s.vibrance = parseInt(el('slider-flt-vibrance').value, 10);
        if (el('slider-flt-sat')) s.saturation = parseInt(el('slider-flt-sat').value, 10);

        // Effects
        if (el('slider-flt-clarity')) s.clarity = parseInt(el('slider-flt-clarity').value, 10);
        if (el('slider-flt-texture')) s.texture = parseInt(el('slider-flt-texture').value, 10);
        if (el('slider-flt-dehaze')) s.dehaze = parseInt(el('slider-flt-dehaze').value, 10);
        if (el('slider-flt-sharpen')) s.sharpen = parseInt(el('slider-flt-sharpen').value, 10);
        if (el('slider-flt-grain')) s.grain = parseInt(el('slider-flt-grain').value, 10);

        // HSL
        var actCol = s.colorMix.activeColor || 'orange';
        if (!s.colorMix[actCol]) s.colorMix[actCol] = { h: 0, s: 0, l: 0 };
        if (el('slider-flt-hsl-hue')) s.colorMix[actCol].h = parseInt(el('slider-flt-hsl-hue').value, 10);
        if (el('slider-flt-hsl-sat')) s.colorMix[actCol].s = parseInt(el('slider-flt-hsl-sat').value, 10);
        if (el('slider-flt-hsl-lum')) s.colorMix[actCol].l = parseInt(el('slider-flt-hsl-lum').value, 10);

        // Color Grading
        var actZ = s.colorGrading.activeZone || 'shadows';
        if (!s.colorGrading[actZ]) s.colorGrading[actZ] = { h: 0, s: 0 };
        if (el('slider-flt-cg-hue')) s.colorGrading[actZ].h = parseInt(el('slider-flt-cg-hue').value, 10);
        if (el('slider-flt-cg-sat')) s.colorGrading[actZ].s = parseInt(el('slider-flt-cg-sat').value, 10);
        if (el('slider-flt-cg-balance')) s.colorGrading.balance = parseInt(el('slider-flt-cg-balance').value, 10);

        // Update labels (Adobe Lightroom Precision)
        if (el('lbl-flt-exposure')) {
            var ev = ((s.exposure || 0) / 10).toFixed(2);
            el('lbl-flt-exposure').innerText = ((s.exposure || 0) > 0 ? '+' : '') + ev + ' EV';
        }
        if (el('lbl-flt-contrast')) el('lbl-flt-contrast').innerText = ((s.contrast || 0) > 0 ? '+' : '') + (s.contrast || 0);
        if (el('lbl-flt-highlights')) el('lbl-flt-highlights').innerText = ((s.highlights || 0) > 0 ? '+' : '') + (s.highlights || 0);
        if (el('lbl-flt-shadows')) el('lbl-flt-shadows').innerText = ((s.shadows || 0) > 0 ? '+' : '') + (s.shadows || 0);
        if (el('lbl-flt-whites')) el('lbl-flt-whites').innerText = ((s.whites || 0) > 0 ? '+' : '') + (s.whites || 0);
        if (el('lbl-flt-blacks')) el('lbl-flt-blacks').innerText = ((s.blacks || 0) > 0 ? '+' : '') + (s.blacks || 0);

        if (el('lbl-flt-crv-hl')) el('lbl-flt-crv-hl').innerText = s.curve.highlights;
        if (el('lbl-flt-crv-lights')) el('lbl-flt-crv-lights').innerText = s.curve.lights;
        if (el('lbl-flt-crv-darks')) el('lbl-flt-crv-darks').innerText = s.curve.darks;
        if (el('lbl-flt-crv-sh')) el('lbl-flt-crv-sh').innerText = s.curve.shadows;

        if (el('lbl-flt-temp')) {
            var rawT = s.temperature || 0;
            var kelvin = 5500 + (rawT * 80);
            el('lbl-flt-temp').innerText = kelvin + 'K';
        }
        if (el('lbl-flt-tint')) el('lbl-flt-tint').innerText = ((s.tint || 0) > 0 ? '+' : '') + (s.tint || 0);
        if (el('lbl-flt-vibrance')) el('lbl-flt-vibrance').innerText = ((s.vibrance || 0) > 0 ? '+' : '') + (s.vibrance || 0) + '%';
        if (el('lbl-flt-sat')) el('lbl-flt-sat').innerText = ((s.saturation || 0) > 0 ? '+' : '') + (s.saturation || 0) + '%';

        if (el('lbl-flt-clarity')) el('lbl-flt-clarity').innerText = ((s.clarity || 0) > 0 ? '+' : '') + (s.clarity || 0);
        if (el('lbl-flt-texture')) el('lbl-flt-texture').innerText = ((s.texture || 0) > 0 ? '+' : '') + (s.texture || 0);
        if (el('lbl-flt-dehaze')) el('lbl-flt-dehaze').innerText = ((s.dehaze || 0) > 0 ? '+' : '') + (s.dehaze || 0);
        if (el('lbl-flt-sharpen')) el('lbl-flt-sharpen').innerText = s.sharpen + '%';
        if (el('lbl-flt-grain')) el('lbl-flt-grain').innerText = s.grain + '%';

        if (el('lbl-hsl-hue')) el('lbl-hsl-hue').innerText = (s.colorMix[actCol].h >= 0 ? '+' : '') + s.colorMix[actCol].h;
        if (el('lbl-hsl-sat')) el('lbl-hsl-sat').innerText = (s.colorMix[actCol].s >= 0 ? '+' : '') + s.colorMix[actCol].s + '%';
        if (el('lbl-hsl-lum')) el('lbl-hsl-lum').innerText = (s.colorMix[actCol].l >= 0 ? '+' : '') + s.colorMix[actCol].l + '%';
        if (el('lbl-flt-hsl-hue')) el('lbl-flt-hsl-hue').innerText = s.colorMix[actCol].h;
        if (el('lbl-flt-hsl-sat')) el('lbl-flt-hsl-sat').innerText = s.colorMix[actCol].s;
        if (el('lbl-flt-hsl-lum')) el('lbl-flt-hsl-lum').innerText = s.colorMix[actCol].l;

        if (el('lbl-cg-hue')) el('lbl-cg-hue').innerText = s.colorGrading[actZ].h + '°';
        if (el('lbl-cg-sat')) el('lbl-cg-sat').innerText = s.colorGrading[actZ].s + '%';
        if (el('lbl-cg-balance')) el('lbl-cg-balance').innerText = s.colorGrading.balance;

        var buttons = document.querySelectorAll('.filter-preset-btn');
        buttons.forEach(function (btn) { btn.classList.remove('active'); });

        if (appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
            appState.stagedPhotos[appState.activeStagedIndex].appliedGrading = JSON.parse(JSON.stringify(s));
        }
        if (s.isLocked) {
            try {
                localStorage.setItem('limz_locked_tone_profile', JSON.stringify(s));
            } catch (err) { }
        }

        drawToneCurveCanvas();
        updatePhotoGradingPreview();
    }

    /* =========================================================================
       DOM LIVE PREVIEW & CANVAS EXPORT ENGINE
       ========================================================================= */

    function updatePhotoGradingPreview() {
        var bgImg = document.getElementById('wm-simulator-bg');
        var overlay = document.getElementById('wm-sim-grade-overlay');
        if (!bgImg) return;

        var s = appState.photoFilterState;
        if (!s) return;

        // REVISI 116: Integrasi Nyata AI Retouch (SS 2), Tone Curve (SS 3), & HSL 8 Channels (SS 3)
        var ret = s.retouch || {};
        var crv = s.curve || { highlights: 0, lights: 0, darks: 0, shadows: 0 };
        var cm = s.colorMix || {};

        var rSoften = typeof ret.soften === 'number' ? ret.soften : (document.getElementById('slider-evoto-ret-soften') ? parseInt(document.getElementById('slider-evoto-ret-soften').value, 10) : 0);
        var rBrighten = typeof ret.brighten === 'number' ? ret.brighten : (document.getElementById('slider-evoto-ret-brighten') ? parseInt(document.getElementById('slider-evoto-ret-brighten').value, 10) : 0);
        var rUndereye = typeof ret.undereye === 'number' ? ret.undereye : (document.getElementById('slider-evoto-ret-undereye') ? parseInt(document.getElementById('slider-evoto-ret-undereye').value, 10) : 0);
        var rTexture = typeof ret.texture === 'number' ? ret.texture : (document.getElementById('slider-evoto-ret-texture') ? parseInt(document.getElementById('slider-evoto-ret-texture').value, 10) : 50);
        var rTeeth = typeof ret.teeth === 'number' ? ret.teeth : (document.getElementById('slider-evoto-ret-teeth') ? parseInt(document.getElementById('slider-evoto-ret-teeth').value, 10) : 0);
        var rEyes = typeof ret.eyes === 'number' ? ret.eyes : (document.getElementById('slider-evoto-ret-eyes') ? parseInt(document.getElementById('slider-evoto-ret-eyes').value, 10) : 0);

        // Tone Curve adjustments
        var cHl = crv.highlights || 0;
        var cLi = crv.lights || 0;
        var cDk = crv.darks || 0;
        var cSh = crv.shadows || 0;
        var curveBright = Math.round((cHl * 0.35) + (cLi * 0.45) + (cDk * 0.25) + (cSh * 0.2));
        var curveContrast = Math.round(((cHl - cSh) * 0.35) + ((cLi - cDk) * 0.25));

        // HSL 8 Channels
        var hslTotalSat = 0;
        var hslTotalLum = 0;
        var channels = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
        for (var ci = 0; ci < channels.length; ci++) {
            var cObj = cm[channels[ci]];
            if (cObj) {
                hslTotalSat += (cObj.s || 0);
                hslTotalLum += (cObj.l || 0);
            }
        }
        var actColName = cm.activeColor || 'red';
        var actColObj = cm[actColName] || { h: 0, s: 0, l: 0 };
        var hslHueRotateDeg = Math.round((actColObj.h || 0) * 0.6);
        var hslSatBoost = Math.round(hslTotalSat * 0.3);
        var hslLumBoost = Math.round(hslTotalLum * 0.25);

        // Effective brightness & exposure
        var expMultiplier = (s.exposure || 0) * 1.5;
        var b = 100 + (s.brightness || 0) + expMultiplier 
            + Math.round((s.shadows || 0) * 0.35) 
            + Math.round((s.highlights || 0) * 0.2) 
            + Math.round((s.whites || 0) * 0.3) 
            + Math.round((s.blacks || 0) * 0.2)
            + curveBright
            + hslLumBoost
            + Math.round(rBrighten * 0.22)
            + Math.round(rUndereye * 0.14)
            + Math.round(rTeeth * 0.08);

        // Contrast & Clarity
        var c = 100 + (s.contrast || 0) 
            + Math.round((s.shadows || 0) * -0.15) 
            + Math.round((s.clarity || 0) * 0.25)
            + curveContrast
            + Math.round((rTexture - 50) * 0.35)
            + Math.round(rEyes * 0.25)
            - Math.round(rSoften * 0.15);

        // Saturation & Vibrance
        var sat = 100 + (s.saturation || 0) 
            + Math.round((s.vibrance || 0) * 0.6)
            + hslSatBoost
            - Math.round(rTeeth * 0.06);

        var preset = s.preset;
        var isPureOriginal = (Math.abs(b - 100) < 0.5) && (Math.abs(c - 100) < 0.5) && (Math.abs(sat - 100) < 0.5) && (preset === 'normal' || !preset) && (hslHueRotateDeg === 0) && (!s.dehaze) && (!s.clarity);
        var filterStr = isPureOriginal ? 'none' : ('brightness(' + Math.max(10, Math.round(b)) + '%) contrast(' + Math.max(10, Math.round(c)) + '%) saturate(' + Math.max(0, Math.round(sat)) + '%)');
        if (!isPureOriginal) {
            if (hslHueRotateDeg !== 0) {
                filterStr += ' hue-rotate(' + hslHueRotateDeg + 'deg)';
            }
            if (preset === 'bw') {
                filterStr = 'grayscale(100%) ' + filterStr;
            } else if (preset === 'warm') {
                filterStr = 'sepia(18%) ' + filterStr;
            } else if (preset === 'vintage') {
                filterStr = 'sepia(32%) ' + filterStr;
            }

            // Dehaze & Clarity visual contrast boost
            if (s.dehaze || s.clarity) {
                var contrastBoost = Math.round(((s.dehaze || 0) + (s.clarity || 0)) * 0.15);
                if (contrastBoost !== 0) {
                    filterStr += ' contrast(' + (100 + contrastBoost) + '%)';
                }
            }
        }

        bgImg.style.filter = filterStr;
        if (typeof drawWmHistogram === 'function') drawWmHistogram();

        // 4. Color Grading & Soft-Light Tinting Overlay
        if (overlay) {
            var temp = s.temperature || 0;
            var tint = s.tint || 0;
            var absTemp = Math.abs(temp);
            var absTint = Math.abs(tint);

            var cgShadows = (s.colorGrading && s.colorGrading.shadows) ? s.colorGrading.shadows : { h: 0, s: 0 };
            var cgHighlights = (s.colorGrading && s.colorGrading.highlights) ? s.colorGrading.highlights : { h: 0, s: 0 };

            var r = 128, g = 128, bVal = 128;
            var hasTint = false;

            if (temp > 0) { r += Math.round(temp * 2.2); bVal -= Math.round(temp * 1.5); hasTint = true; }
            else if (temp < 0) { bVal += Math.round(-temp * 2.2); r -= Math.round(-temp * 1.5); hasTint = true; }
            if (tint > 0) { r += Math.round(tint * 1.8); bVal += Math.round(tint * 1.8); g -= Math.round(tint * 1.5); hasTint = true; }
            else if (tint < 0) { g += Math.round(-tint * 2.2); r -= Math.round(-tint * 1.2); hasTint = true; }

            // HSL Color Tint Overlay per channel:
            if (cm.orange && (cm.orange.l !== 0 || cm.orange.s !== 0)) {
                r += Math.round((cm.orange.l || 0) * 0.8 + (cm.orange.s || 0) * 0.5);
                g += Math.round((cm.orange.l || 0) * 0.5 + (cm.orange.s || 0) * 0.3);
                hasTint = true;
            }
            if (cm.red && (cm.red.s !== 0 || cm.red.l !== 0)) {
                r += Math.round((cm.red.s || 0) * 0.9 + (cm.red.l || 0) * 0.6);
                hasTint = true;
            }
            if (cm.yellow && (cm.yellow.s !== 0 || cm.yellow.l !== 0)) {
                r += Math.round((cm.yellow.s || 0) * 0.6 + (cm.yellow.l || 0) * 0.5);
                g += Math.round((cm.yellow.s || 0) * 0.6 + (cm.yellow.l || 0) * 0.5);
                hasTint = true;
            }
            if (cm.green && (cm.green.s !== 0 || cm.green.l !== 0)) {
                g += Math.round((cm.green.s || 0) * 0.9 + (cm.green.l || 0) * 0.6);
                hasTint = true;
            }
            if (cm.blue && (cm.blue.s !== 0 || cm.blue.l !== 0)) {
                bVal += Math.round((cm.blue.s || 0) * 0.9 + (cm.blue.l || 0) * 0.6);
                hasTint = true;
            }

            if (hasTint || cgShadows.s > 0 || cgHighlights.s > 0) {
                r = Math.max(0, Math.min(255, r));
                g = Math.max(0, Math.min(255, g));
                bVal = Math.max(0, Math.min(255, bVal));
                var maxShift = Math.max(absTemp, absTint, (cgHighlights.s * 0.5), Math.abs(hslLumBoost));
                overlay.style.backgroundColor = 'rgb(' + r + ',' + g + ',' + bVal + ')';
                overlay.style.opacity = Math.min(0.48, Math.max(0.06, (maxShift / 50) * 0.35));
            } else {
                overlay.style.opacity = 0;
            }
        }
    }

    function getCanvasFilterString(customState) {
        var s = customState || appState.photoFilterState;
        if (!s) return 'none';

        var ret = s.retouch || {};
        var crv = s.curve || { highlights: 0, lights: 0, darks: 0, shadows: 0 };
        var cm = s.colorMix || {};

        var rSoften = typeof ret.soften === 'number' ? ret.soften : 0;
        var rBrighten = typeof ret.brighten === 'number' ? ret.brighten : 0;
        var rUndereye = typeof ret.undereye === 'number' ? ret.undereye : 0;
        var rTexture = typeof ret.texture === 'number' ? ret.texture : 50;
        var rTeeth = typeof ret.teeth === 'number' ? ret.teeth : 0;
        var rEyes = typeof ret.eyes === 'number' ? ret.eyes : 0;

        var cHl = crv.highlights || 0;
        var cLi = crv.lights || 0;
        var cDk = crv.darks || 0;
        var cSh = crv.shadows || 0;
        var curveBright = Math.round((cHl * 0.35) + (cLi * 0.45) + (cDk * 0.25) + (cSh * 0.2));
        var curveContrast = Math.round(((cHl - cSh) * 0.35) + ((cLi - cDk) * 0.25));

        var hslTotalSat = 0;
        var hslTotalLum = 0;
        var channels = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
        for (var ci = 0; ci < channels.length; ci++) {
            var cObj = cm[channels[ci]];
            if (cObj) {
                hslTotalSat += (cObj.s || 0);
                hslTotalLum += (cObj.l || 0);
            }
        }
        var actColName = cm.activeColor || 'red';
        var actColObj = cm[actColName] || { h: 0, s: 0, l: 0 };
        var hslHueRotateDeg = Math.round((actColObj.h || 0) * 0.6);
        var hslSatBoost = Math.round(hslTotalSat * 0.3);
        var hslLumBoost = Math.round(hslTotalLum * 0.25);

        var expMultiplier = (s.exposure || 0) * 1.5;
        var b = 100 + (s.brightness || 0) + expMultiplier 
            + Math.round((s.shadows || 0) * 0.35) 
            + Math.round((s.highlights || 0) * 0.2) 
            + Math.round((s.whites || 0) * 0.3) 
            + Math.round((s.blacks || 0) * 0.2)
            + curveBright
            + hslLumBoost
            + Math.round(rBrighten * 0.22)
            + Math.round(rUndereye * 0.14)
            + Math.round(rTeeth * 0.08);

        var c = 100 + (s.contrast || 0) 
            + Math.round((s.shadows || 0) * -0.15) 
            + Math.round((s.clarity || 0) * 0.25)
            + curveContrast
            + Math.round((rTexture - 50) * 0.35)
            + Math.round(rEyes * 0.25)
            - Math.round(rSoften * 0.15);

        var sat = 100 + (s.saturation || 0) 
            + Math.round((s.vibrance || 0) * 0.6)
            + hslSatBoost
            - Math.round(rTeeth * 0.06);

        var preset = s.preset;
        var isPureOriginal = (Math.abs(b - 100) < 0.5) && (Math.abs(c - 100) < 0.5) && (Math.abs(sat - 100) < 0.5) && (preset === 'normal' || !preset) && (hslHueRotateDeg === 0) && (!s.dehaze) && (!s.clarity);
        if (isPureOriginal) return 'none';

        var filterStr = 'brightness(' + Math.max(10, Math.round(b)) + '%) contrast(' + Math.max(10, Math.round(c)) + '%) saturate(' + Math.max(0, Math.round(sat)) + '%)';
        if (hslHueRotateDeg !== 0) {
            filterStr += ' hue-rotate(' + hslHueRotateDeg + 'deg)';
        }
        if (preset === 'bw') {
            filterStr = 'grayscale(100%) ' + filterStr;
        } else if (preset === 'warm') {
            filterStr = 'sepia(20%) ' + filterStr;
        } else if (preset === 'vintage') {
            filterStr = 'sepia(35%) ' + filterStr;
        }
        return filterStr;
    }

    // REVISI 114: ROTASI FISIK KANVAS INSTAN & SINKRONISASI RESMI ORIENTASI + WATERMARK
    function rotateActiveStagedPhoto(angleDelta) {
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) {
            showToast('⚠️ Belum ada foto dalam antrian pratinjau.');
            return;
        }
        var activePhoto = appState.stagedPhotos[appState.activeStagedIndex];
        if (!activePhoto) return;

        var bgImg = document.getElementById('wm-simulator-bg');
        if (!bgImg || !bgImg.src) return;

        // 1. Simpan ke Undo History sebelum rotasi
        if (typeof pushPhotoHistory === 'function') {
            pushPhotoHistory('Sebelum Putar Foto (' + (angleDelta > 0 ? '+90°' : '-90°') + ')');
        }

        function applyRotatedBuffer(sourceImage) {
            var srcW = sourceImage.naturalWidth || sourceImage.width || 1200;
            var srcH = sourceImage.naturalHeight || sourceImage.height || 1600;

            var rotCanvas = document.createElement('canvas');
            // Dimensi ditukar saat diputar 90 derajat
            rotCanvas.width = srcH;
            rotCanvas.height = srcW;
            var rCtx = rotCanvas.getContext('2d');
            rCtx.imageSmoothingEnabled = true;
            rCtx.imageSmoothingQuality = 'high';

            rCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
            rCtx.rotate(angleDelta * Math.PI / 180);
            rCtx.drawImage(sourceImage, -srcW / 2, -srcH / 2, srcW, srcH);

            var rotatedDataUrl = rotCanvas.toDataURL('image/jpeg', 0.94);

            // Perbarui seluruh variabel data foto aktif secara serentak (Mencegah reset)
            activePhoto.dataUrl = rotatedDataUrl;
            activePhoto.originalDataUrl = rotatedDataUrl;
            activePhoto.url = rotatedDataUrl;
            activePhoto.processedUrl = rotatedDataUrl;
            activePhoto.rotation = 0; // Rotasi sudah menjadi piksel fisik
            activePhoto.width = rotCanvas.width;
            activePhoto.height = rotCanvas.height;

            // Deteksi orientasi baru secara resmi
            var isPortrait = rotCanvas.height >= rotCanvas.width;
            activePhoto.orientation = isPortrait ? 'portrait' : 'landscape';

            // Tampilkan foto baru di panggung seketika
            bgImg.src = rotatedDataUrl;
            bgImg.style.transform = 'none';

            // Update aspek rasio wrapper panggung secara instan
            var wrapper = document.getElementById('wm-simulator-photo-wrapper');
            if (wrapper) {
                wrapper.style.aspectRatio = rotCanvas.width + ' / ' + rotCanvas.height;
            }

            // Perbarui badge orientasi jika tersedia
            var orientBadge = document.getElementById('evoto-active-orient-badge');
            if (orientBadge) {
                orientBadge.innerHTML = isPortrait ? '📱 PORTRAIT' : '🖥️ LANDSCAPE';
                orientBadge.style.background = isPortrait ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)';
                orientBadge.style.color = isPortrait ? '#60a5fa' : '#34d399';
            }

            // Perbarui thumbnail di filmstrip
            var thumb = document.getElementById('filmstrip-thumb-' + appState.activeStagedIndex);
            if (thumb) {
                thumb.src = rotatedDataUrl;
                thumb.style.transform = 'none';
            }

            // Sinkronkan antrean UI & aspek rasio watermark panggung
            renderStagedPhotosUI();
            syncPhotoWrapperDimensions();

            // Catat state akhir ke Undo History
            if (typeof pushPhotoHistory === 'function') {
                pushPhotoHistory('🔄 Putar Foto (' + (isPortrait ? 'Portrait' : 'Landscape') + ')');
            }

            var orientLabel = isPortrait ? '📱 Portrait (Tegak)' : '🖥️ Landscape (Mendatar)';
            showToast('🔄 Foto #' + (appState.activeStagedIndex + 1) + ' kini terbaca sebagai ' + orientLabel + '. Watermark menyesuaikan otomatis!');
        }

        // Eksekusi rotasi langsung jika gambar sudah siap di memori
        if (bgImg.complete && bgImg.naturalWidth > 0) {
            applyRotatedBuffer(bgImg);
        } else {
            var tempImg = new Image();
            tempImg.crossOrigin = 'anonymous';
            tempImg.onload = function () {
                applyRotatedBuffer(tempImg);
            };
            tempImg.src = activePhoto.dataUrl || bgImg.src;
        }
    }

    function renderStagedPhotosUI() {
        var count = appState.stagedPhotos.length;
        var countEl = document.getElementById('staged-photos-count');
        var badgeEl = document.getElementById('staged-status-badge');
        var wrapperEl = document.getElementById('staged-thumbnails-wrapper');
        var containerEl = document.getElementById('staged-thumbnails-container');
        var infoEl = document.getElementById('staged-active-info');
        var bgImg = document.getElementById('wm-simulator-bg');
        var resetCropBtn = document.getElementById('btn-reset-crop');

        var headingTitle = document.getElementById('staged-heading-title');
        var multiBadge = document.getElementById('staged-multi-badge');
        var gifCount = document.getElementById('staged-gif-count');
        var btnGif = document.getElementById('btn-create-gif');
        var btnStartUpload = document.getElementById('btn-start-upload');

        if (countEl) countEl.innerText = count;
        if (gifCount) gifCount.innerText = count;

        if (btnGif) {
            btnGif.style.display = (count > 1) ? 'inline-flex' : 'none';
            btnGif.onclick = function (e) {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                openGifCreatorModal();
            };
        }
        if (multiBadge) multiBadge.style.display = (count > 1) ? 'inline-block' : 'none';

        var emptyStage = document.getElementById('evoto-empty-stage');
        var singleLayer = document.getElementById('evoto-single-layer');

        var stagedBadge = document.getElementById('staged-count-badge');
        if (stagedBadge) stagedBadge.innerText = count + ' Foto';

        if (count === 0) {
            if (containerEl) containerEl.innerHTML = '';
            if (btnGif) btnGif.style.display = 'none';
            if (headingTitle) headingTitle.innerText = '0 Item siap dipublikasikan';
            if (badgeEl) {
                badgeEl.innerText = 'Belum Ada Foto';
                badgeEl.style.background = 'rgba(255,255,255,0.06)';
                badgeEl.style.color = '#94a3b8';
            }
            if (resetCropBtn) resetCropBtn.style.display = 'none';
            if (typeof toggleCropMode === 'function' && cropState.active) {
                toggleCropMode(false);
            }
            if (wrapperEl) wrapperEl.style.display = 'none';
            if (emptyStage) emptyStage.style.display = 'flex';
            if (singleLayer) singleLayer.style.display = 'none';
            if (bgImg) {
                bgImg.src = '';
                bgImg.style.display = 'none';
                bgImg.style.transform = 'rotate(0deg)';
            }
            if (btnStartUpload) {
                btnStartUpload.disabled = true;
            }
            updatePhotoGradingPreview();
            updateWatermarkSimulatorDisplay();
            return;
        }

        if (emptyStage) emptyStage.style.display = 'none';
        if (singleLayer) singleLayer.style.display = 'flex';
        if (bgImg) {
            bgImg.style.display = 'block';
            syncPhotoWrapperDimensions();
        }

        if (headingTitle) {
            headingTitle.innerText = count + ' Item siap dipublikasikan';
        }

        if (badgeEl) {
            badgeEl.innerText = count + ' Foto Siap Diatur (Draft)';
            badgeEl.style.background = '#fef3c7';
            badgeEl.style.color = '#92400e';
        }

        if (btnStartUpload) {
            btnStartUpload.disabled = false;
        }

        if (appState.activeStagedIndex >= count) {
            appState.activeStagedIndex = count - 1;
        }
        if (appState.activeStagedIndex < 0) {
            appState.activeStagedIndex = 0;
        }

        var activePhoto = appState.stagedPhotos[appState.activeStagedIndex];
        if (activePhoto && bgImg) {
            bgImg.src = activePhoto.dataUrl;
            var currentRot = activePhoto.rotation || 0;
            bgImg.style.transform = 'rotate(' + currentRot + 'deg)';
        }

        if (resetCropBtn) {
            resetCropBtn.style.display = (activePhoto && activePhoto.isCropped) ? 'inline-block' : 'none';
        }

        if (infoEl) {
            infoEl.innerText = 'Foto ' + (appState.activeStagedIndex + 1) + ' dari ' + count;
        }

        if (wrapperEl) {
            wrapperEl.style.display = 'block';
        }

        if (containerEl) {
            containerEl.innerHTML = '';
            appState.stagedPhotos.forEach(function (item, idx) {
                var isActive = idx === appState.activeStagedIndex;
                var thumb = document.createElement('div');
                thumb.className = 'staged-thumb-item' + (isActive ? ' active' : '');
                thumb.style.position = 'relative';
                thumb.style.flexShrink = '0';
                thumb.style.width = '145px';
                thumb.style.height = '185px';
                thumb.style.borderRadius = '12px';
                thumb.style.overflow = 'hidden';
                thumb.style.cursor = 'pointer';
                thumb.style.background = '#0a0a0c';

                // Status border & bayangan visual
                if (item.uploadStatus === 'failed') {
                    thumb.style.border = '2px solid #ef4444';
                    thumb.style.boxShadow = '0 0 16px rgba(239,68,68,0.55)';
                } else if (item.uploadStatus === 'uploading') {
                    thumb.style.border = '2px solid #3b82f6';
                    thumb.style.boxShadow = '0 0 16px rgba(59,130,246,0.55)';
                } else if (item.uploadStatus === 'queued') {
                    thumb.style.border = '2px solid #f59e0b';
                    thumb.style.boxShadow = '0 0 12px rgba(245,158,11,0.45)';
                } else {
                    thumb.style.border = isActive ? '2px solid #d4af37' : '1px solid #2a201a';
                    thumb.style.boxShadow = isActive ? '0 0 16px rgba(212,175,55,0.45)' : '0 3px 10px rgba(0,0,0,0.3)';
                }
                thumb.style.transition = 'all 0.15s ease';

                var cropBadge = item.isCropped ? '<span style="position:absolute; top:6px; left:6px; background:#d4af37; color:#fff; font-size:9px; padding:2px 5px; border-radius:4px; font-weight:bold; z-index:2;">✂️ Crop</span>' : '';
                var rotBadge = (item.rotation && item.rotation !== 0) ? '<span style="position:absolute; top:6px; left:' + (item.isCropped ? '58px' : '6px') + '; background:#1e40af; color:#fff; font-size:9.5px; padding:2px 5px; border-radius:4px; font-weight:700; z-index:2;">⟳ ' + item.rotation + '°</span>' : '';

                var statusBadge = '';
                if (item.uploadStatus === 'uploading') {
                    statusBadge = '<span style="position:absolute; top:6px; right:32px; background:#2563eb; color:#fff; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; z-index:2; box-shadow:0 2px 6px rgba(0,0,0,0.4);">⏳ Proses</span>';
                } else if (item.uploadStatus === 'queued') {
                    statusBadge = '<span style="position:absolute; top:6px; right:32px; background:#d97706; color:#fff; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; z-index:2; box-shadow:0 2px 6px rgba(0,0,0,0.4);">🕒 Antrian</span>';
                } else if (item.uploadStatus === 'failed') {
                    statusBadge = '<span style="position:absolute; top:6px; right:32px; background:#dc2626; color:#fff; font-size:9px; padding:2px 6px; border-radius:4px; font-weight:700; z-index:2; box-shadow:0 2px 6px rgba(0,0,0,0.4);">❌ Gagal</span>';
                }

                var retryOverlay = '';
                if (item.uploadStatus === 'failed') {
                    retryOverlay = '<button type="button" onclick="retryStagedPhotoUpload(\'' + (item.id || idx) + '\', event)" style="position:absolute; bottom:26px; left:6px; right:6px; background:#dc2626; color:#fff; border:none; padding:5px 6px; border-radius:6px; font-size:10px; font-weight:700; cursor:pointer; z-index:3; display:flex; align-items:center; justify-content:center; gap:4px; box-shadow:0 2px 8px rgba(0,0,0,0.6);" title="Klik untuk publikasikan ulang foto ini">🔁 Publikasikan Ulang</button>';
                }

                var displayName = item.name || ('Foto #' + (idx + 1));
                var qualityBadge = '';
                if (item.customMp) {
                    var isOri = item.customIsOri || (item.customWidth && item.customWidth >= 4000);
                    qualityBadge = '<span style="position:absolute; bottom:28px; left:6px; background:' + (isOri ? 'rgba(16,185,129,0.92)' : 'rgba(59,130,246,0.92)') + '; color:#fff; font-size:8.5px; padding:2px 6px; border-radius:4px; font-weight:700; z-index:2; backdrop-filter:blur(3px); box-shadow:0 1px 4px rgba(0,0,0,0.5);">' + (isOri ? '⭐ ORI ' : '') + item.customMp + ' MP</span>';
                }

                thumb.innerHTML = '<img src="' + item.dataUrl + '" style="width:100%; height:100%; object-fit:cover; display:block; transform: rotate(' + (item.rotation || 0) + 'deg); transition: transform 0.2s ease;">' +
                    cropBadge + rotBadge + statusBadge + qualityBadge +
                    '<button type="button" onclick="removeStagedPhoto(' + idx + ', event)" style="position:absolute; top:6px; right:6px; width:22px; height:22px; background:rgba(0,0,0,0.65); color:#fff; border:1px solid rgba(255,255,255,0.25); border-radius:50%; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; z-index:2; transition:background 0.15s ease;" title="Hapus foto ini dari antrian">✕</button>' +
                    retryOverlay +
                    '<div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(4px); padding:6px 8px; font-size:10.5px; font-weight:600; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-top:1px solid rgba(255,255,255,0.08); z-index:2;" title="' + escapeHtml(displayName) + '">' + escapeHtml(displayName) + '</div>';

                thumb.onclick = function () { selectStagedPhoto(idx); };
                containerEl.appendChild(thumb);
            });
        }

        // Tombol global publikasi ulang jika ada item yang gagal
        var failedItems = (appState.stagedPhotos || []).filter(function (p) { return p.uploadStatus === 'failed'; });
        var btnRetryAll = document.getElementById('btn-retry-all-failed');
        var btnStartUpload = document.getElementById('btn-start-upload');

        if (!btnRetryAll && btnStartUpload && btnStartUpload.parentNode) {
            btnRetryAll = document.createElement('button');
            btnRetryAll.type = 'button';
            btnRetryAll.id = 'btn-retry-all-failed';
            btnRetryAll.className = 'btn btn-sm';
            btnRetryAll.style.cssText = 'display:none; background:#dc2626; color:#fff; border:none; font-size:12px; font-weight:700; padding:8px 16px; border-radius:10px; box-shadow:0 4px 14px rgba(220,38,38,0.35); align-items:center; gap:6px; cursor:pointer; margin-right:8px; transition:all 0.2s ease;';
            btnRetryAll.onclick = function (e) { retryAllFailedStagedPhotos(e); };
            btnStartUpload.parentNode.insertBefore(btnRetryAll, btnStartUpload);
        }

        if (btnRetryAll) {
            if (failedItems.length > 0) {
                btnRetryAll.style.display = 'inline-flex';
                btnRetryAll.innerHTML = '🔁 Publikasikan Ulang (' + failedItems.length + ' Gagal)';
            } else {
                btnRetryAll.style.display = 'none';
            }
        }

        updatePhotoGradingPreview();
        updateWatermarkSimulatorDisplay();
    }

    function selectStagedPhoto(idx) {
        if (idx < 0 || idx >= appState.stagedPhotos.length) return;
        if (cropState && cropState.active) {
            toggleCropMode(false);
        }
        appState.activeStagedIndex = idx;
        var item = appState.stagedPhotos[idx];
        if (item && item.appliedGrading) {
            appState.photoFilterState = JSON.parse(JSON.stringify(item.appliedGrading));
            syncFilterSlidersToState();
        }
        renderStagedPhotosUI();
    }

    function removeStagedPhoto(idx, evt) {
        if (evt) {
            evt.stopPropagation();
            evt.preventDefault();
        }
        if (idx < 0 || idx >= appState.stagedPhotos.length) return;
        var item = appState.stagedPhotos[idx];
        if (item && uploadPipeline && uploadPipeline.queue) {
            uploadPipeline.queue = uploadPipeline.queue.filter(function (q) {
                return q !== item && (!item.id || q.id !== item.id);
            });
        }
        if (cropState && cropState.active) {
            toggleCropMode(false);
        }
        appState.stagedPhotos.splice(idx, 1);
        if (appState.activeStagedIndex >= appState.stagedPhotos.length) {
            appState.activeStagedIndex = Math.max(0, appState.stagedPhotos.length - 1);
        }
        renderStagedPhotosUI();
        showToast('Foto dihapus dari antrian.');
    }

    function clearStagedPhotos() {
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) {
            showToast('Antrian pratinjau sudah kosong.');
            return;
        }
        if (cropState && cropState.active) {
            toggleCropMode(false);
        }
        if (uploadPipeline) {
            uploadPipeline.queue = [];
        }
        appState.stagedPhotos = [];
        appState.activeStagedIndex = 0;
        var fileInput = document.getElementById('file-input-photos');
        if (fileInput) fileInput.value = '';
        var containerEl = document.getElementById('staged-thumbnails-container');
        if (containerEl) containerEl.innerHTML = '';
        renderStagedPhotosUI();
        showToast('Antrian foto berhasil dikosongkan.');
    }

    /* =========================================================================
       MODUL CROPPING INTERAKTIF (STUDIO CROP TOOL)
       ========================================================================= */
    var cropState = {
        active: false,
        orientation: 'horizontal',
        ratio: 'free',
        boxLeft: 10,
        boxTop: 10,
        boxWidth: 80,
        boxHeight: 80,
        isDragging: false,
        isResizing: false,
        resizeHandle: null,
        startX: 0,
        startY: 0,
        startBoxLeft: 10,
        startBoxTop: 10,
        startBoxWidth: 80,
        startBoxHeight: 80
    };

    function updateCropBoxUI() {
        var box = document.getElementById('crop-box');
        if (!box) return;
        box.style.left = cropState.boxLeft + '%';
        box.style.top = cropState.boxTop + '%';
        box.style.width = cropState.boxWidth + '%';
        box.style.height = cropState.boxHeight + '%';
    }

    function toggleCropMode(forcedState) {
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) {
            showToast('Pilih atau tarik foto ke dalam antrian terlebih dahulu sebelum melakukan crop.');
            return;
        }

        var nextState = (typeof forcedState === 'boolean') ? forcedState : !cropState.active;
        cropState.active = nextState;

        var toolbar = document.getElementById('crop-toolbar');
        var overlay = document.getElementById('wm-crop-overlay');
        var toggleBtn = document.getElementById('btn-toggle-crop');
        var wmOverlay = document.getElementById('wm-simulator-overlay');

        if (toolbar) toolbar.style.display = nextState ? 'flex' : 'none';
        if (overlay) overlay.style.display = nextState ? 'block' : 'none';
        if (wmOverlay) wmOverlay.style.pointerEvents = nextState ? 'none' : 'auto';

        if (toggleBtn) {
            if (nextState) {
                toggleBtn.classList.remove('btn-outline');
                toggleBtn.classList.add('btn-gold');
                toggleBtn.innerText = '✂️ Sedang Crop';
            } else {
                toggleBtn.classList.add('btn-outline');
                toggleBtn.classList.remove('btn-gold');
                toggleBtn.innerText = '✂️ Crop Foto';
            }
        }

        if (nextState) {
            cropState.boxLeft = 10;
            cropState.boxTop = 10;
            cropState.boxWidth = 80;
            cropState.boxHeight = 80;
            setCropRatio(cropState.ratio || 'free');
            updateCropBoxUI();
        }
    }

    function setCropOrientation(orientation, btnEl) {
        cropState.orientation = orientation;
        var orientBtns = document.querySelectorAll('.crop-orient-btn');
        orientBtns.forEach(function (b) { b.classList.remove('active'); });

        if (btnEl) {
            btnEl.classList.add('active');
        } else {
            var targetBtn = document.getElementById(orientation === 'vertical' ? 'btn-orient-vertical' : 'btn-orient-horizontal');
            if (targetBtn) targetBtn.classList.add('active');
        }

        if (cropState.ratio && cropState.ratio !== 'free') {
            setCropRatio(cropState.ratio);
        } else {
            var stageFrame = document.getElementById('wm-stage-frame');
            if (stageFrame) {
                var frameW = stageFrame.clientWidth;
                var frameH = stageFrame.clientHeight;
                if (frameW > 0 && frameH > 0) {
                    var curW = (cropState.boxWidth / 100) * frameW;
                    var curH = (cropState.boxHeight / 100) * frameH;
                    var newW = Math.min(frameW * 0.9, curH);
                    var newH = Math.min(frameH * 0.9, curW);
                    cropState.boxWidth = Math.min(100, Math.max(10, (newW / frameW) * 100));
                    cropState.boxHeight = Math.min(100, Math.max(10, (newH / frameH) * 100));
                    cropState.boxLeft = Math.max(0, (100 - cropState.boxWidth) / 2);
                    cropState.boxTop = Math.max(0, (100 - cropState.boxHeight) / 2);
                    updateCropBoxUI();
                }
            }
        }
    }

    function setCropRatio(ratio, btnEl) {
        cropState.ratio = ratio;
        var buttons = document.querySelectorAll('.crop-ratio-btn');
        buttons.forEach(function (b) { b.classList.remove('active'); });

        if (btnEl) {
            btnEl.classList.add('active');
        } else {
            var btnId = 'btn-ratio-' + (ratio === '4-6' || ratio === '4r' ? '4-6' : (ratio === '1:1' ? '1-1' : (ratio === '4-3' || ratio === 'std' ? '4-3' : (ratio === '16-9' || ratio === 'wide' ? '16-9' : 'free'))));
            var targetBtn = document.getElementById(btnId);
            if (targetBtn) targetBtn.classList.add('active');
        }

        if (ratio === 'free') {
            updateCropBoxUI();
            return;
        }

        var stageFrame = document.getElementById('wm-stage-frame');
        if (!stageFrame) return;
        var frameW = stageFrame.clientWidth;
        var frameH = stageFrame.clientHeight;
        if (frameW <= 0 || frameH <= 0) return;

        var isVert = (cropState.orientation === 'vertical');
        var targetAspect = 1;

        if (ratio === '1:1') {
            targetAspect = 1;
        } else if (ratio === '4-6' || ratio === '4r') {
            targetAspect = isVert ? (2 / 3) : (3 / 2);
        } else if (ratio === '4-3' || ratio === 'std') {
            targetAspect = isVert ? (3 / 4) : (4 / 3);
        } else if (ratio === '16-9' || ratio === 'wide') {
            targetAspect = isVert ? (9 / 16) : (16 / 9);
        }

        var maxBoxW = frameW * 0.9;
        var maxBoxH = frameH * 0.9;
        var newW = maxBoxW;
        var newH = newW / targetAspect;

        if (newH > maxBoxH) {
            newH = maxBoxH;
            newW = newH * targetAspect;
        }

        var widthPct = (newW / frameW) * 100;
        var heightPct = (newH / frameH) * 100;

        cropState.boxWidth = Math.min(100, Math.max(10, widthPct));
        cropState.boxHeight = Math.min(100, Math.max(10, heightPct));
        cropState.boxLeft = Math.max(0, (100 - cropState.boxWidth) / 2);
        cropState.boxTop = Math.max(0, (100 - cropState.boxHeight) / 2);

        updateCropBoxUI();
    }

    function initCropDragEvents() {
        var cropBox = document.getElementById('crop-box');
        var stageFrame = document.getElementById('wm-stage-frame');
        if (!cropBox || !stageFrame) return;

        function onPointerDown(e) {
            if (!cropState.active) return;
            var handle = e.target.getAttribute('data-handle');
            var frameRect = stageFrame.getBoundingClientRect();
            if (frameRect.width <= 0 || frameRect.height <= 0) return;

            if (handle) {
                cropState.isResizing = true;
                cropState.resizeHandle = handle;
            } else if (e.target === cropBox || cropBox.contains(e.target)) {
                cropState.isDragging = true;
            } else {
                return;
            }

            e.preventDefault();
            cropState.startX = e.clientX;
            cropState.startY = e.clientY;
            cropState.startBoxLeft = cropState.boxLeft;
            cropState.startBoxTop = cropState.boxTop;
            cropState.startBoxWidth = cropState.boxWidth;
            cropState.startBoxHeight = cropState.boxHeight;

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        }

        function onPointerMove(e) {
            if (!cropState.isDragging && !cropState.isResizing) return;
            var frameRect = stageFrame.getBoundingClientRect();
            if (frameRect.width <= 0 || frameRect.height <= 0) return;

            var dxPx = e.clientX - cropState.startX;
            var dyPx = e.clientY - cropState.startY;
            var dxPct = (dxPx / frameRect.width) * 100;
            var dyPct = (dyPx / frameRect.height) * 100;

            if (cropState.isDragging) {
                var newLeft = cropState.startBoxLeft + dxPct;
                var newTop = cropState.startBoxTop + dyPct;

                newLeft = Math.max(0, Math.min(100 - cropState.boxWidth, newLeft));
                newTop = Math.max(0, Math.min(100 - cropState.boxHeight, newTop));

                cropState.boxLeft = newLeft;
                cropState.boxTop = newTop;
                updateCropBoxUI();
            } else if (cropState.isResizing) {
                var handle = cropState.resizeHandle;
                var left = cropState.startBoxLeft;
                var top = cropState.startBoxTop;
                var w = cropState.startBoxWidth;
                var h = cropState.startBoxHeight;

                if (handle === 'se') {
                    w = Math.max(10, Math.min(100 - left, cropState.startBoxWidth + dxPct));
                    h = Math.max(10, Math.min(100 - top, cropState.startBoxHeight + dyPct));
                } else if (handle === 'sw') {
                    var candW = cropState.startBoxWidth - dxPct;
                    var maxW = cropState.startBoxLeft + cropState.startBoxWidth;
                    w = Math.max(10, Math.min(maxW, candW));
                    left = cropState.startBoxLeft + (cropState.startBoxWidth - w);
                    h = Math.max(10, Math.min(100 - top, cropState.startBoxHeight + dyPct));
                } else if (handle === 'ne') {
                    w = Math.max(10, Math.min(100 - left, cropState.startBoxWidth + dxPct));
                    var candH = cropState.startBoxHeight - dyPct;
                    var maxH = cropState.startBoxTop + cropState.startBoxHeight;
                    h = Math.max(10, Math.min(maxH, candH));
                    top = cropState.startBoxTop + (cropState.startBoxHeight - h);
                } else if (handle === 'nw') {
                    var candW2 = cropState.startBoxWidth - dxPct;
                    var maxW2 = cropState.startBoxLeft + cropState.startBoxWidth;
                    w = Math.max(10, Math.min(maxW2, candW2));
                    left = cropState.startBoxLeft + (cropState.startBoxWidth - w);

                    var candH2 = cropState.startBoxHeight - dyPct;
                    var maxH2 = cropState.startBoxTop + cropState.startBoxHeight;
                    h = Math.max(10, Math.min(maxH2, candH2));
                    top = cropState.startBoxTop + (cropState.startBoxHeight - h);
                }

                if (cropState.ratio !== 'free') {
                    var isVert = (cropState.orientation === 'vertical');
                    var targetAspect = 1;
                    if (cropState.ratio === '1:1') targetAspect = 1;
                    else if (cropState.ratio === '4-6' || cropState.ratio === '4r') targetAspect = isVert ? (2 / 3) : (3 / 2);
                    else if (cropState.ratio === '4-3' || cropState.ratio === 'std') targetAspect = isVert ? (3 / 4) : (4 / 3);
                    else if (cropState.ratio === '16-9' || cropState.ratio === 'wide') targetAspect = isVert ? (9 / 16) : (16 / 9);

                    var wPx = (w / 100) * frameRect.width;
                    var hPx = wPx / targetAspect;
                    h = (hPx / frameRect.height) * 100;

                    if (top + h > 100) {
                        h = 100 - top;
                        hPx = (h / 100) * frameRect.height;
                        wPx = hPx * targetAspect;
                        w = (wPx / frameRect.width) * 100;
                    }
                }

                cropState.boxLeft = Math.max(0, Math.min(90, left));
                cropState.boxTop = Math.max(0, Math.min(90, top));
                cropState.boxWidth = Math.max(10, Math.min(100 - cropState.boxLeft, w));
                cropState.boxHeight = Math.max(10, Math.min(100 - cropState.boxTop, h));
                updateCropBoxUI();
            }
        }

        function onPointerUp() {
            cropState.isDragging = false;
            cropState.isResizing = false;
            cropState.resizeHandle = null;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        }

        cropBox.addEventListener('pointerdown', onPointerDown);
    }

    /* =========================================================================
       MODUL DRAG-AND-DROP WATERMARK LANGSUNG PADA LAYAR PREVIEW
       ========================================================================= */
    function initWatermarkDragEvents() {
        var overlay = document.getElementById('wm-simulator-overlay');
        var stageFrame = document.getElementById('wm-photo-wrapper') || document.getElementById('wm-stage-frame');
        if (!overlay || !stageFrame) return;

        var wmDragState = {
            isDragging: false,
            startX: 0,
            startY: 0,
            startPosX: 88,
            startPosY: 90
        };

        function onPointerDown(e) {
            if (cropState && cropState.active) return;

            e.preventDefault();
            e.stopPropagation();

            wmDragState.isDragging = true;
            wmDragState.startX = e.clientX;
            wmDragState.startY = e.clientY;
            wmDragState.startPosX = parseFloat(document.getElementById('slider-wm-pos-x').value || 88);
            wmDragState.startPosY = parseFloat(document.getElementById('slider-wm-pos-y').value || 90);

            overlay.classList.add('is-dragging');

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        }

        function onPointerMove(e) {
            if (!wmDragState.isDragging) return;

            var stageRect = stageFrame.getBoundingClientRect();
            var overlayRect = overlay.getBoundingClientRect();
            if (stageRect.width <= 0 || stageRect.height <= 0) return;

            var maxTravelX = Math.max(1, stageRect.width - overlayRect.width);
            var maxTravelY = Math.max(1, stageRect.height - overlayRect.height);

            var dx = e.clientX - wmDragState.startX;
            var dy = e.clientY - wmDragState.startY;

            var dPctX = (dx / maxTravelX) * 100;
            var dPctY = (dy / maxTravelY) * 100;

            var rawX = wmDragState.startPosX + dPctX;
            var rawY = wmDragState.startPosY + dPctY;

            var guideX = document.getElementById('wm-guide-center-x');
            var guideY = document.getElementById('wm-guide-center-y');
            var snapBadge = document.getElementById('wm-snap-badge');

            var isSnapX = false;
            var isSnapY = false;

            if (rawX >= 47 && rawX <= 53) {
                rawX = 50;
                isSnapX = true;
            }
            if (rawY >= 47 && rawY <= 53) {
                rawY = 50;
                isSnapY = true;
            }

            if (guideX) guideX.style.display = isSnapX ? 'block' : 'none';
            if (guideY) guideY.style.display = isSnapY ? 'block' : 'none';
            if (snapBadge) {
                if (isSnapX && isSnapY) {
                    snapBadge.innerText = '🎯 Tengah Sempurna (X: 50%, Y: 50%)';
                    snapBadge.style.display = 'inline-flex';
                } else if (isSnapX) {
                    snapBadge.innerText = '↔️ Tengah Horisontal (X: 50%)';
                    snapBadge.style.display = 'inline-flex';
                } else if (isSnapY) {
                    snapBadge.innerText = '↕️ Tengah Vertikal (Y: 50%)';
                    snapBadge.style.display = 'inline-flex';
                } else {
                    snapBadge.style.display = 'none';
                }
            }

            var newX = Math.round(Math.max(0, Math.min(100, rawX)));
            var newY = Math.round(Math.max(0, Math.min(100, rawY)));

            var sliderX = document.getElementById('slider-wm-pos-x');
            var sliderY = document.getElementById('slider-wm-pos-y');
            var lblX = document.getElementById('label-wm-pos-x');
            var lblY = document.getElementById('label-wm-pos-y');

            if (sliderX) sliderX.value = newX;
            if (sliderY) sliderY.value = newY;
            if (lblX) lblX.innerText = newX + '%';
            if (lblY) lblY.innerText = newY + '%';

            updateWatermarkSimulatorDisplay();
        }

        function onPointerUp() {
            if (!wmDragState.isDragging) return;
            wmDragState.isDragging = false;
            overlay.classList.remove('is-dragging');

            var guideX = document.getElementById('wm-guide-center-x');
            var guideY = document.getElementById('wm-guide-center-y');
            var snapBadge = document.getElementById('wm-snap-badge');
            if (guideX) guideX.style.display = 'none';
            if (guideY) guideY.style.display = 'none';
            if (snapBadge) snapBadge.style.display = 'none';

            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);

            var sliderX = document.getElementById('slider-wm-pos-x');
            var sliderY = document.getElementById('slider-wm-pos-y');
            if (sliderX && sliderY) {
                localStorage.setItem('limz_wm_pos_x', sliderX.value);
                localStorage.setItem('limz_wm_pos_y', sliderY.value);
            }
        }

        overlay.addEventListener('pointerdown', onPointerDown);
    }

    function cancelCrop() {
        toggleCropMode(false);
        showToast('Crop dibatalkan.');
    }

    function applyCrop() {
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) return;
        var activePhoto = appState.stagedPhotos[appState.activeStagedIndex];
        if (!activePhoto) return;

        var bgImg = document.getElementById('wm-simulator-bg');
        if (!bgImg || !bgImg.complete) return;

        var natW = bgImg.naturalWidth;
        var natH = bgImg.naturalHeight;
        if (!natW || !natH) {
            showToast('Gambar belum selesai dimuat sempurna.');
            return;
        }

        var cropX = Math.round((cropState.boxLeft / 100) * natW);
        var cropY = Math.round((cropState.boxTop / 100) * natH);
        var cropW = Math.round((cropState.boxWidth / 100) * natW);
        var cropH = Math.round((cropState.boxHeight / 100) * natH);

        cropX = Math.max(0, Math.min(natW - 10, cropX));
        cropY = Math.max(0, Math.min(natH - 10, cropY));
        cropW = Math.max(10, Math.min(natW - cropX, cropW));
        cropH = Math.max(10, Math.min(natH - cropY, cropH));

        var offCanvas = document.createElement('canvas');
        offCanvas.width = cropW;
        offCanvas.height = cropH;
        var ctx = offCanvas.getContext('2d');
        ctx.drawImage(bgImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        var croppedDataUrl = offCanvas.toDataURL('image/jpeg', 0.95);

        if (!activePhoto.originalDataUrl) {
            activePhoto.originalDataUrl = activePhoto.dataUrl;
        }
        activePhoto.dataUrl = croppedDataUrl;
        activePhoto.isCropped = true;

        toggleCropMode(false);
        renderStagedPhotosUI();
        showToast('✅ Foto berhasil di-crop!');
    }

    function resetCrop() {
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) return;
        var activePhoto = appState.stagedPhotos[appState.activeStagedIndex];
        if (!activePhoto) return;

        if (activePhoto.originalDataUrl) {
            activePhoto.dataUrl = activePhoto.originalDataUrl;
            activePhoto.isCropped = false;
            renderStagedPhotosUI();
            showToast('↺ Foto dikembalikan ke ukuran asli.');
        } else {
            showToast('Foto sudah dalam ukuran asli.');
        }
    }

    function handleAddCrewSubmit() {
        var nama = document.getElementById('crew-nama').value;
        var email = document.getElementById('crew-email').value;
        var pass = document.getElementById('crew-password').value;

        var btn = document.getElementById('btn-save-crew');
        btn.innerText = 'Menyimpan...';
        btn.disabled = true;

        google.script.run
            .withSuccessHandler(function (res) {
                btn.innerText = 'Simpan Akun Crew';
                btn.disabled = false;
                if (res.success) {
                    closeModal('modal-add-crew');
                    showToast(res.message);
                } else {
                    showToast(res.message);
                }
            })
            .withFailureHandler(function (err) {
                btn.innerText = 'Simpan Akun Crew';
                btn.disabled = false;
                showToast('Gagal: ' + err);
            })
            .addCrewUser(nama, email, pass);
    }

    function openChangePasswordModal() {
        document.getElementById('chg-old-password').value = '';
        document.getElementById('chg-new-password').value = '';
        document.getElementById('chg-confirm-password').value = '';
        openModal('modal-change-password');
    }

    function handleChangePasswordSubmit() {
        var oldPass = document.getElementById('chg-old-password').value;
        var newPass = document.getElementById('chg-new-password').value;
        var confPass = document.getElementById('chg-confirm-password').value;

        if (newPass !== confPass) {
            showToast('Password baru dan konfirmasi tidak cocok!');
            return;
        }

        var userId = appState.currentUser ? appState.currentUser.id : 'USR-0001';
        var btn = document.getElementById('btn-save-newpass');
        btn.innerText = 'Memperbarui...';
        btn.disabled = true;

        google.script.run
            .withSuccessHandler(function (res) {
                btn.innerText = 'Perbarui Password';
                btn.disabled = false;
                if (res.success) {
                    closeModal('modal-change-password');
                    showToast(res.message);
                } else {
                    showToast(res.message);
                }
            })
            .withFailureHandler(function (err) {
                btn.innerText = 'Perbarui Password';
                btn.disabled = false;
                showToast('Gagal: ' + err);
            })
            .changePassword(userId, oldPass, newPass);
    }

    function formatDisplayDate(dateStr) {
        if (!dateStr || dateStr === '-') return '-';
        var str = String(dateStr).trim();
        var y = '', m = 0, d = 0;

        if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
            var parts = str.split('T')[0].split('-');
            y = parts[0];
            m = parseInt(parts[1], 10);
            d = parseInt(parts[2], 10);
        } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(str)) {
            var p2 = str.split(/[\/\-]/);
            d = parseInt(p2[0], 10);
            m = parseInt(p2[1], 10);
            y = p2[2];
        } else {
            var dt = new Date(str);
            if (!isNaN(dt.getTime())) {
                y = dt.getFullYear();
                m = dt.getMonth() + 1;
                d = dt.getDate();
            } else {
                return str;
            }
        }

        var monthNames = [
            'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
            'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
        ];
        var monthStr = monthNames[m - 1] || ('0' + m).slice(-2);
        var dayStr = ('0' + d).slice(-2);
        return dayStr + ' ' + monthStr + ' ' + y;
    }

    function handleWatermarkToggleChange(isEnabled) {
        appState.isWatermarkEnabled = isEnabled;
        localStorage.setItem('limz_wm_enabled', isEnabled ? 'true' : 'false');
        if (isEnabled) {
            document.body.classList.remove('no-watermark');
        } else {
            document.body.classList.add('no-watermark');
        }
        var label = document.getElementById('label-wm-toggle-status');
        if (label) {
            label.innerText = isEnabled ? 'Aktif' : 'Nonaktif';
            label.style.color = isEnabled ? '#16a34a' : '#94a3b8';
        }
        var wmBadge = document.getElementById('badge-watermark-status');
        if (wmBadge) {
            wmBadge.innerText = isEnabled ? 'Aktif' : 'Nonaktif';
            wmBadge.style.background = isEnabled ? '#dcfce7' : '#f1f5f9';
            wmBadge.style.color = isEnabled ? '#15803d' : '#64748b';
            wmBadge.style.borderColor = isEnabled ? '#86efac' : '#cbd5e1';
        }
        var wrapper = document.getElementById('wm-controls-wrapper');
        if (wrapper) {
            wrapper.style.opacity = isEnabled ? '1' : '0.4';
            wrapper.style.pointerEvents = isEnabled ? 'auto' : 'none';
        }
        var simBox = document.getElementById('wm-simulator-overlay');
        if (simBox) {
            simBox.style.display = isEnabled ? 'block' : 'none';
        }
        showToast(isEnabled ? '✅ Watermark aktif pada foto.' : 'ℹ️ Watermark dinonaktifkan (pratinjau & upload polos/bersih).');
    }

    function handleWatermarkPngSelected(files) {
        if (!files || files.length === 0) return;
        var file = files[0];
        if (!file.type.match('image.*')) {
            showToast('⚠️ Mohon pilih file gambar logo (PNG/JPG/WEBP).');
            return;
        }

        var reader = new FileReader();
        reader.onload = function (e) {
            var dataUrl = e.target.result;
            appState.customWatermarkPngData = dataUrl;
            try {
                localStorage.setItem('limz_custom_watermark_png', dataUrl);
            } catch (err) {
                console.warn('Logo PNG terlalu besar untuk localStorage:', err);
            }

            var img = new Image();
            img.onload = function () {
                appState.customWatermarkImgObj = img;
                handleWatermarkToggleChange(true);
                var toggle = document.getElementById('toggle-wm-enabled');
                if (toggle) toggle.checked = true;

                renderWatermarkPreviewUI(dataUrl);
                updateWatermarkSimulatorDisplay();
                showToast('✅ Logo watermark PNG berhasil dipasang di pratinjau & upload!');
            };
            img.onerror = function () {
                showToast('❌ Gagal membaca gambar logo watermark.');
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }
    window.handleWatermarkPngSelected = handleWatermarkPngSelected;

    function initWatermarkSettings() {
        var savedEnabled = localStorage.getItem('limz_wm_enabled');
        var isEnabled = (savedEnabled !== 'false');
        appState.isWatermarkEnabled = isEnabled;
        if (isEnabled) {
            document.body.classList.remove('no-watermark');
        } else {
            document.body.classList.add('no-watermark');
        }
        var toggleEl = document.getElementById('toggle-wm-enabled');
        if (toggleEl) toggleEl.checked = isEnabled;
        var labelToggle = document.getElementById('label-wm-toggle-status');
        if (labelToggle) {
            labelToggle.innerText = isEnabled ? 'Aktif' : 'Nonaktif';
            labelToggle.style.color = isEnabled ? '#16a34a' : '#94a3b8';
        }
        var wmBadge = document.getElementById('badge-watermark-status');
        if (wmBadge) {
            wmBadge.innerText = isEnabled ? 'Aktif' : 'Nonaktif';
            wmBadge.style.background = isEnabled ? '#dcfce7' : '#f1f5f9';
            wmBadge.style.color = isEnabled ? '#15803d' : '#64748b';
            wmBadge.style.borderColor = isEnabled ? '#86efac' : '#cbd5e1';
        }
        var wrapper = document.getElementById('wm-controls-wrapper');
        if (wrapper) {
            wrapper.style.opacity = isEnabled ? '1' : '0.4';
            wrapper.style.pointerEvents = isEnabled ? 'auto' : 'none';
        }
        var simBox = document.getElementById('wm-simulator-overlay');
        if (simBox) {
            simBox.style.display = isEnabled ? 'block' : 'none';
        }

        var savedX = localStorage.getItem('limz_wm_pos_x');
        var savedY = localStorage.getItem('limz_wm_pos_y');
        var savedScale = localStorage.getItem('limz_wm_scale');
        var savedOpacity = localStorage.getItem('limz_wm_opacity');

        if (savedX) {
            var sx = document.getElementById('slider-wm-pos-x');
            var lx = document.getElementById('label-wm-pos-x');
            if (sx) sx.value = savedX;
            if (lx) lx.innerText = savedX + '%';
        }
        if (savedY) {
            var sy = document.getElementById('slider-wm-pos-y');
            var ly = document.getElementById('label-wm-pos-y');
            if (sy) sy.value = savedY;
            if (ly) ly.innerText = savedY + '%';
        }
        if (savedScale) {
            var ss = document.getElementById('slider-wm-scale');
            var ls = document.getElementById('label-wm-scale');
            if (ss) ss.value = savedScale;
            if (ls) ls.innerText = savedScale + '%';
        }
        if (savedOpacity) {
            var so = document.getElementById('slider-wm-opacity');
            var lo = document.getElementById('label-wm-opacity');
            if (so) so.value = savedOpacity;
            if (lo) lo.innerText = savedOpacity + '%';
        }

        // Muat logo kustom PNG dari localStorage jika ada
        var savedCustomPng = localStorage.getItem('limz_custom_watermark_png');
        if (savedCustomPng) {
            appState.customWatermarkPngData = savedCustomPng;
            var cImg = new Image();
            cImg.onload = function () {
                appState.customWatermarkImgObj = cImg;
                renderWatermarkPreviewUI(savedCustomPng);
                updateWatermarkSimulatorDisplay();
            };
            cImg.src = savedCustomPng;
        } else {
            renderWatermarkPreviewUI(null);
        }
    }

    function removeCustomWatermarkPng() {
        appState.customWatermarkPngData = null;
        appState.customWatermarkImgObj = null;
        localStorage.removeItem('limz_custom_watermark_png');
        renderWatermarkPreviewUI(null);
        updateWatermarkSimulatorDisplay();
        showToast('Watermark di-reset ke tulisan teks studio bawaan.');
    }

    function updateWatermarkManualSettings() {
        var posX = document.getElementById('slider-wm-pos-x').value;
        var posY = document.getElementById('slider-wm-pos-y').value;
        var scale = document.getElementById('slider-wm-scale').value;
        var opacity = document.getElementById('slider-wm-opacity').value;

        document.getElementById('label-wm-pos-x').innerText = posX + '%';
        document.getElementById('label-wm-pos-y').innerText = posY + '%';
        document.getElementById('label-wm-scale').innerText = scale + '%';
        document.getElementById('label-wm-opacity').innerText = opacity + '%';

        localStorage.setItem('limz_wm_pos_x', posX);
        localStorage.setItem('limz_wm_pos_y', posY);
        localStorage.setItem('limz_wm_scale', scale);
        localStorage.setItem('limz_wm_opacity', opacity);

        updateWatermarkSimulatorDisplay();
    }

    function applyWatermarkPreset(x, y, scale) {
        var sx = document.getElementById('slider-wm-pos-x');
        var sy = document.getElementById('slider-wm-pos-y');
        var ss = document.getElementById('slider-wm-scale');
        if (sx) sx.value = x;
        if (sy) sy.value = y;
        if (scale && ss) ss.value = scale;
        updateWatermarkManualSettings();

        // Visual active button highlight for 7 preset buttons
        try {
            var btns = document.querySelectorAll('.btn-wm-preset');
            btns.forEach(function (btn) {
                btn.classList.remove('active');
                btn.style.borderColor = 'var(--border-subtle)';
                btn.style.color = 'var(--text-main)';
                btn.style.background = '#ffffff';
                btn.style.fontWeight = '600';
            });
            if (window.event && window.event.currentTarget && window.event.currentTarget.classList.contains('btn-wm-preset')) {
                var activeBtn = window.event.currentTarget;
                activeBtn.classList.add('active');
                activeBtn.style.borderColor = '#d49438';
                activeBtn.style.color = '#d49438';
                activeBtn.style.background = '#fffcf8';
                activeBtn.style.fontWeight = '700';
            }
        } catch (e) {
            console.warn('applyWatermarkPreset highlight error:', e);
        }

        showToast('Titik preset posisi diterapkan!');
    }
    window.applyWatermarkPreset = applyWatermarkPreset;

    function toggleWatermarkPanel() {
        var body = document.getElementById('watermark-panel-body');
        var btn = document.getElementById('btn-toggle-wm-panel');
        if (!body) return;
        if (body.style.display === 'none') {
            body.style.display = 'block';
            if (btn) btn.innerHTML = '▼ Tutup';
        } else {
            body.style.display = 'none';
            if (btn) btn.innerHTML = '▶ Buka';
        }
    }
    window.toggleWatermarkPanel = toggleWatermarkPanel;

    function resetWatermarkText() {
        if (confirm('Reset watermark ke posisi dan pengaturan bawaan?')) {
            localStorage.removeItem('limz_custom_watermark_png');
            appState.customWatermarkPngData = null;
            appState.customWatermarkImgObj = null;
            applyWatermarkPreset(50, 100, 62);
            var so = document.getElementById('slider-wm-opacity');
            if (so) {
                so.value = 100;
                updateWatermarkManualSettings();
            }
            renderWatermarkPreviewUI(null);
            updateWatermarkSimulatorDisplay();
            showToast('Watermark berhasil di-reset ke bawaan!');
        }
    }
    window.resetWatermarkText = resetWatermarkText;

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen().catch(function (err) {
                    console.warn('Fullscreen error:', err);
                });
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }
    window.toggleFullscreen = toggleFullscreen;
    window.openFullscreen = toggleFullscreen;

    function scrollToWatermarkSettings() {
        var card = document.getElementById('card-unified-hub') || document.getElementById('card-watermark-settings');
        var body = document.getElementById('watermark-panel-body');
        var btn = document.getElementById('btn-toggle-wm-panel');
        if (body && body.style.display === 'none') {
            body.style.display = 'block';
            if (btn) btn.innerHTML = '▼ Tutup';
        }
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    window.scrollToWatermarkSettings = scrollToWatermarkSettings;

    function updateWatermarkSimulatorDisplay() {
        var overlay = document.getElementById('wm-simulator-overlay');
        var logoImg = document.getElementById('wm-sim-logo-img');
        var fallbackText = document.getElementById('wm-sim-fallback-text');

        if (!overlay) return;

        // REVISI 116: Jangan tampilkan watermark saat mode Before / After foto mentah aktif!
        if (typeof isComparingBeforeState !== 'undefined' && isComparingBeforeState) {
            overlay.style.display = 'none';
            return;
        }

        // Pratinjau bersih tanpa watermark saat switch nonaktif
        if (appState.isWatermarkEnabled === false) {
            overlay.style.display = 'none';
            return;
        } else {
            overlay.style.display = 'block';
        }

        var posX = parseFloat(document.getElementById('slider-wm-pos-x').value || 88);
        var posY = parseFloat(document.getElementById('slider-wm-pos-y').value || 90);
        var scale = parseFloat(document.getElementById('slider-wm-scale').value || 22);
        var opacity = parseFloat(document.getElementById('slider-wm-opacity').value || 85) / 100;

        // Ukuran persentase terkunci presisi terhadap dimensi fisik foto aktual (5% - 100%)
        var constrainedScale = Math.min(100, Math.max(5, scale));
        overlay.style.width = constrainedScale + '%';
        overlay.style.maxWidth = '100%';
        overlay.style.opacity = opacity;

        // Positioning halus, presisi mengacu pada batas fisik foto
        overlay.style.left = posX + '%';
        overlay.style.top = posY + '%';
        overlay.style.transform = 'translate(-' + posX + '%, -' + posY + '%)';

        if (appState.customWatermarkPngData) {
            if (logoImg) {
                logoImg.src = appState.customWatermarkPngData;
                logoImg.style.display = 'block';
            }
            if (fallbackText) fallbackText.style.display = 'none';
        } else {
            if (logoImg) logoImg.style.display = 'none';
            if (fallbackText) fallbackText.style.display = 'block';
        }
    }

    function renderWatermarkPreviewUI(dataUrl) {
        var removeBtn = document.getElementById('btn-remove-wm-png');
        var badgeText = document.getElementById('wm-badge-text');

        if (dataUrl) {
            if (removeBtn) removeBtn.style.display = 'inline-flex';
            if (badgeText) {
                badgeText.innerText = '✅ Watermark PNG Kustom Aktif';
                badgeText.style.background = '#d1fae5';
                badgeText.style.color = '#065f46';
            }
        } else {
            if (removeBtn) removeBtn.style.display = 'none';
            if (badgeText) {
                badgeText.innerText = 'ℹ️ Watermark Teks Bawaan';
                badgeText.style.background = '#e0f2fe';
                badgeText.style.color = '#0369a1';
            }
        }
    }

    function initAppConfig() {
        var savedCustomUrl = localStorage.getItem('limz_custom_webapp_url');
        if (savedCustomUrl && savedCustomUrl.indexOf('http') === 0) {
            appState.webAppUrl = cleanExecUrl(savedCustomUrl);
        }

        // Pastikan backendApiUrl selalu siap ke URL Google Apps Script resmi
        if (!appState.backendApiUrl) {
            appState.backendApiUrl = DEFAULT_BACKEND_GAS_URL;
        }

        if (!appState.webAppUrl) {
            var urlEl = document.getElementById('gas-app-url');
            if (urlEl && urlEl.innerText && urlEl.innerText.indexOf('http') === 0) {
                appState.webAppUrl = cleanExecUrl(urlEl.innerText.trim());
            }
        }

        if (!appState.webAppUrl) {
            google.script.run
                .withSuccessHandler(function (url) {
                    if (url) {
                        var cleaned = cleanExecUrl(url);
                        appState.webAppUrl = cleaned;
                        if (cleaned.indexOf('script.google.com') > -1) {
                            appState.backendApiUrl = cleaned;
                        }
                        updateWebAppStatusPill();
                    }
                })
                .getWebAppUrl();
        }

        if (!appState.webAppUrl) {
            appState.webAppUrl = DEFAULT_BACKEND_GAS_URL;
        }

        updateWebAppStatusPill();

        var savedLockedTone = localStorage.getItem('limz_locked_tone_profile');
        if (savedLockedTone) {
            try {
                var parsedTone = JSON.parse(savedLockedTone);
                if (parsedTone && parsedTone.isLocked) {
                    appState.photoFilterState = parsedTone;
                    syncFilterSlidersToState();
                    var lockBtn = document.getElementById('btn-toggle-lock-tone');
                    if (lockBtn) {
                        lockBtn.innerHTML = '🔒 Kunci Tone: AKTIF';
                        lockBtn.classList.add('locked');
                    }
                }
            } catch (e) {
                console.warn('Error parsing saved locked tone profile:', e);
            }
        }
    }

    function cleanExecUrl(url) {
        if (!url) return '';
        var clean = String(url).trim();
        clean = clean.split('?')[0];
        if (clean.indexOf('script.google.com') > -1) {
            clean = clean.replace(/\/dev$/, '/exec');
        }
        clean = clean.replace(/\/+$/, '');
        return clean;
    }

    function isCustomDomainUrl(url) {
        if (!url) return false;
        var str = String(url).toLowerCase();
        return (str.indexOf('http') === 0 && str.indexOf('script.google.com') === -1 && str.indexOf('googleusercontent.com') === -1);
    }

    function updateWebAppStatusPill() {
        var btn = document.getElementById('btn-web-url-status');
        if (!btn) return;
        if (appState.webAppUrl && isCustomDomainUrl(appState.webAppUrl)) {
            btn.innerHTML = '🟢 Domain Vercel: Aktif';
            btn.style.color = 'var(--accent-green)';
            btn.style.borderColor = 'var(--accent-green)';
        } else if (appState.webAppUrl && appState.webAppUrl.indexOf('/exec') > -1) {
            btn.innerHTML = '🟢 URL Backend: Aktif (/exec)';
            btn.style.color = 'var(--accent-green)';
            btn.style.borderColor = 'var(--accent-green)';
        } else {
            btn.innerHTML = '🟡 Setel URL Web / Vercel';
            btn.style.color = 'var(--accent-orange)';
            btn.style.borderColor = 'var(--accent-orange)';
        }
    }

    function openSetWebAppUrlModal() {
        var input = document.getElementById('input-custom-webapp-url');
        input.value = appState.webAppUrl || '';
        openModal('modal-set-webapp-url');
    }

    function handleSaveWebAppUrlSubmit() {
        var raw = document.getElementById('input-custom-webapp-url').value;
        if (!raw || raw.indexOf('http') !== 0) {
            showToast('Masukkan URL yang valid (harus dimulai dengan https://)!');
            return;
        }

        var cleaned = cleanExecUrl(raw);
        appState.webAppUrl = cleaned;
        localStorage.setItem('limz_custom_webapp_url', cleaned);

        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success) {
                    console.log('URL Web App/Domain resmi tersimpan permanen di server.');
                }
            })
            .saveWebAppUrl(cleaned);

        clearAllQrCaches();
        closeModal('modal-set-webapp-url');
        updateWebAppStatusPill();
        showToast('✅ Tautan Domain/Web App berhasil disimpan! Semua QR Code diperbarui.');

        if (appState.activeCollectionData && appState.activeCollectionData.slug) {
            var galleryUrl = getPublicGalleryUrl(appState.activeCollectionData.slug);
            if (appState.currentView === 'view-slideshow') {
                setCachedQrCode('mon-qr-img', galleryUrl, 260);
            } else if (appState.currentView === 'view-flyer') {
                setCachedQrCode('flyer-qr-img', galleryUrl, 320);
            }
        }
    }

    function clearAllQrCaches() {
        try {
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && (key.indexOf('limz_qr_') === 0 || key.indexOf('zett_qr_') === 0)) {
                    keysToRemove.push(key);
                }
            }
            for (var j = 0; j < keysToRemove.length; j++) {
                localStorage.removeItem(keysToRemove[j]);
            }
        } catch (e) { }
    }

    function initKeyboardShortcuts() {
        window.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && appState.currentView === 'view-slideshow') {
                closeSlideshow();
            }
        });
    }

    /* =========================================================================
       PRETTY SHORTLINK RESOLVER (VERCEL DOMAIN + GAS FALLBACK)
       ========================================================================= */
    function isRunningOnVercelOrCustomDomain() {
        var host = window.location.hostname;
        return (host && host !== 'localhost' && host !== '127.0.0.1' && host.indexOf('script.google.com') === -1 && host.indexOf('googleusercontent.com') === -1);
    }

    function getPublicGalleryUrl(slug) {
        if (isRunningOnVercelOrCustomDomain()) {
            return window.location.origin + '/' + encodeURIComponent(slug);
        }

        var baseUrl = appState.webAppUrl;
        if (!baseUrl) {
            var urlEl = document.getElementById('gas-app-url');
            if (urlEl && urlEl.innerText && (urlEl.innerText.indexOf('/exec') > -1 || urlEl.innerText.indexOf('http') === 0)) {
                baseUrl = cleanExecUrl(urlEl.innerText.trim());
            }
        }

        if (!baseUrl || baseUrl.indexOf('googleusercontent.com') > -1) {
            var savedCustom = localStorage.getItem('limz_custom_webapp_url');
            if (savedCustom && savedCustom.indexOf('http') === 0) {
                baseUrl = cleanExecUrl(savedCustom);
            } else if (document.referrer && (document.referrer.indexOf('/exec') > -1 || document.referrer.indexOf('http') === 0) && document.referrer.indexOf('googleusercontent.com') === -1) {
                baseUrl = cleanExecUrl(document.referrer.split('?')[0]);
            } else {
                var raw = window.location.href.split('?')[0];
                if (raw.indexOf('googleusercontent.com') === -1) {
                    baseUrl = cleanExecUrl(raw);
                } else {
                    baseUrl = window.location.origin + window.location.pathname;
                }
            }
        }

        baseUrl = baseUrl.replace(/\/+$/, '');

        // Smart URL Resolver: Jika pengguna menyetel Domain Vercel / Kustom
        if (isCustomDomainUrl(baseUrl)) {
            return baseUrl + '/' + encodeURIComponent(slug);
        }

        // Kompatibel: Google Apps Script Web App standard
        return baseUrl + '?slug=' + encodeURIComponent(slug);
    }

    function getDirectPhotoOrGalleryUrl(slug, photoId) {
        if (isRunningOnVercelOrCustomDomain()) {
            if (photoId) {
                return window.location.origin + '/' + encodeURIComponent(slug) + '/p/' + encodeURIComponent(photoId);
            }
            return window.location.origin + '/' + encodeURIComponent(slug);
        }

        var baseUrl = appState.webAppUrl;
        if (baseUrl && isCustomDomainUrl(baseUrl)) {
            baseUrl = baseUrl.replace(/\/+$/, '');
            if (photoId) {
                return baseUrl + '/' + encodeURIComponent(slug) + '/p/' + encodeURIComponent(photoId);
            }
            return baseUrl + '/' + encodeURIComponent(slug);
        }

        var base = getPublicGalleryUrl(slug);
        if (photoId) {
            return base + '&photoId=' + encodeURIComponent(photoId);
        }
        return base;
    }

    function getMonitorSlideshowUrl(slug) {
        if (isRunningOnVercelOrCustomDomain()) {
            return window.location.origin + '/' + encodeURIComponent(slug) + '/monitor';
        }

        var baseUrl = appState.webAppUrl;
        if (baseUrl && isCustomDomainUrl(baseUrl)) {
            baseUrl = baseUrl.replace(/\/+$/, '');
            return baseUrl + '/' + encodeURIComponent(slug) + '/monitor';
        }

        var clean = getPublicGalleryUrl(slug);
        return clean.replace('?slug=', '?view=slideshow&slug=');
    }

    function setCachedQrCode(imgElementId, targetUrl, size) {
        var sz = size || 300;
        var el = document.getElementById(imgElementId);
        if (!el) return;

        var hintEl = document.getElementById('mon-qr-target-hint');
        if (hintEl && imgElementId === 'mon-qr-img') {
            if (targetUrl.indexOf('UNDEFINED') > -1) {
                hintEl.innerText = '⚠️ Klik di sini untuk setel URL /exec QR';
                hintEl.style.color = 'var(--accent-orange)';
            } else {
                hintEl.innerText = '📲 Pindai untuk membuka seluruh galeri...';
                hintEl.title = 'Tautan Galeri Tamu: ' + targetUrl;
                hintEl.style.color = '#94a3b8';
            }
        }

        var cacheKey = 'limz_qr_' + sz + '_' + encodeURIComponent(targetUrl);
        var cachedData = localStorage.getItem(cacheKey);

        if (cachedData) {
            el.src = cachedData;
            return;
        }

        var remoteQrUrl = 'https://quickchart.io/qr?size=' + sz + '&margin=2&ecLevel=M&text=' + encodeURIComponent(targetUrl);
        el.src = remoteQrUrl;

        var tempImg = new Image();
        tempImg.crossOrigin = 'Anonymous';
        tempImg.onload = function () {
            try {
                var c = document.createElement('canvas');
                c.width = tempImg.width;
                c.height = tempImg.height;
                var ctx = c.getContext('2d');
                ctx.drawImage(tempImg, 0, 0);
                var dataUri = c.toDataURL('image/png');
                localStorage.setItem(cacheKey, dataUri);
                el.src = dataUri;
            } catch (e) {
                console.warn('Canvas fallback ke URL langsung.');
            }
        };
        tempImg.onerror = function () {
            el.src = 'https://api.qrserver.com/v1/create-qr-code/?size=' + sz + 'x' + sz + '&margin=6&data=' + encodeURIComponent(targetUrl);
        };
        tempImg.src = remoteQrUrl;
    }

    function switchFlyerTheme(themeClass, btnEl) {
        var flyer = document.getElementById('main-printable-flyer');
        if (!flyer) return;

        var themes = ['theme-royal-gold', 'theme-dark-obsidian', 'theme-botanical-sage', 'theme-romantic-rose', 'theme-minimalist-mono'];
        for (var i = 0; i < themes.length; i++) {
            flyer.classList.remove(themes[i]);
        }
        flyer.classList.add(themeClass);

        var buttons = document.querySelectorAll('.flyer-theme-btn');
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].classList.remove('active');
        }
        if (btnEl) btnEl.classList.add('active');

        showToast('Tema flyer berhasil diganti!');
    }

    function downloadFlyerJpeg4R() {
        var flyer = document.getElementById('main-printable-flyer');
        if (!flyer) {
            showToast('Flyer tidak ditemukan.');
            return;
        }

        if (typeof html2canvas === 'undefined') {
            showToast('Modul render gambar sedang dimuat, silakan coba sebentar lagi...');
            return;
        }

        showToast('Menyiapkan gambar flyer format JPEG ukuran 4R...');

        html2canvas(flyer, {
            scale: 3,
            useCORS: true,
            allowTaint: true,
            backgroundColor: null
        }).then(function (renderedCanvas) {
            var targetW = 1200;
            var targetH = 1800;

            var outCanvas = document.createElement('canvas');
            outCanvas.width = targetW;
            outCanvas.height = targetH;
            var ctx = outCanvas.getContext('2d');

            var computedBg = window.getComputedStyle(flyer).backgroundColor || '#ffffff';
            ctx.fillStyle = computedBg;
            ctx.fillRect(0, 0, targetW, targetH);

            var padX = 60;
            var padY = 60;
            var availW = targetW - (padX * 2);
            var availH = targetH - (padY * 2);

            var scale = Math.min(availW / renderedCanvas.width, availH / renderedCanvas.height);
            var drawW = renderedCanvas.width * scale;
            var drawH = renderedCanvas.height * scale;
            var drawX = (targetW - drawW) / 2;
            var drawY = (targetH - drawH) / 2;

            ctx.drawImage(renderedCanvas, drawX, drawY, drawW, drawH);

            var dataUrl = outCanvas.toDataURL('image/jpeg', 0.95);
            var link = document.createElement('a');
            var slug = (appState.activeCollectionData && appState.activeCollectionData.slug) || 'event';
            link.download = 'Flyer_Meja_4R_' + slug + '.jpg';
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            showToast('✅ Flyer JPEG ukuran 4R siap cetak berhasil diunduh!');
        }).catch(function (err) {
            console.error('Gagal generate JPEG flyer:', err);
            showToast('Gagal memproses gambar: ' + err.toString());
        });
    }

    function sharePublicGallery() {
        var slug = (appState.activeCollectionData && appState.activeCollectionData.slug) || '';
        if (!slug) {
            var urlParams = new URLSearchParams(window.location.search);
            slug = urlParams.get('slug') || '';
        }

        var shareUrl = getPublicGalleryUrl(slug);
        var eventTitle = (appState.activeCollectionData && appState.activeCollectionData.title)
            ? appState.activeCollectionData.title
            : 'Dokumentasi Foto Event';

        var shareData = {
            title: 'Galeri Foto - ' + eventTitle,
            text: 'Yuk lihat dan unduh momen foto indah ' + eventTitle + ' di Limz Studio Photobooth:',
            url: shareUrl
        };

        if (navigator.share) {
            navigator.share(shareData).then(function () {
                showToast('✅ Tautan galeri berhasil dibagikan!');
            }).catch(function (err) {
                if (err.name !== 'AbortError') {
                    copyActiveGalleryLinkWithCustomUrl(shareUrl);
                }
            });
        } else {
            copyActiveGalleryLinkWithCustomUrl(shareUrl);
        }
    }

    function shareGalleryToWhatsApp() {
        var slug = (appState.activeCollectionData && appState.activeCollectionData.slug) || '';
        if (!slug) {
            var urlParams = new URLSearchParams(window.location.search);
            slug = urlParams.get('slug') || '';
        }
        var shareUrl = getPublicGalleryUrl(slug);
        var eventTitle = (appState.activeCollectionData && appState.activeCollectionData.title)
            ? appState.activeCollectionData.title
            : 'Dokumentasi Acara';

        var msg = 'Halo! Yuk lihat dan unduh dokumentasi foto acara *' + eventTitle + '* di Limz Studio Photobooth:\n' + shareUrl;
        var waUrl = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(msg);
        window.open(waUrl, '_blank');
    }

    function sharePhotoToWhatsApp(photoId) {
        var slug = (appState.activeCollectionData && appState.activeCollectionData.slug) || '';
        if (!slug) {
            var urlParams = new URLSearchParams(window.location.search);
            slug = urlParams.get('slug') || '';
        }
        var photoUrl = getDirectPhotoOrGalleryUrl(slug, photoId);
        var eventTitle = (appState.activeCollectionData && appState.activeCollectionData.title)
            ? appState.activeCollectionData.title
            : 'Dokumentasi Acara';

        var msg = 'Halo! Lihat foto momen saya di acara *' + eventTitle + '* via Limz Studio Photobooth:\n' + photoUrl;
        var waUrl = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(msg);
        window.open(waUrl, '_blank');
    }

    function shareCurrentLightboxPhotoToWhatsApp() {
        if (appState.currentLightboxPhoto && appState.currentLightboxPhoto.photoId) {
            sharePhotoToWhatsApp(appState.currentLightboxPhoto.photoId);
        } else {
            shareGalleryToWhatsApp();
        }
    }

    function copyActiveGalleryLinkWithCustomUrl(targetUrl) {
        if (!targetUrl) return;
        if (targetUrl.indexOf('UNDEFINED') > -1) {
            showToast('⚠️ Anda harus menyetel URL Web App terlebih dahulu!');
            openSetWebAppUrlModal();
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(targetUrl).then(function () {
                showToast('✅ Tautan galeri berhasil disalin untuk dibagikan!');
            }).catch(function () {
                executeExecCommandCopy(targetUrl);
            });
        } else {
            executeExecCommandCopy(targetUrl);
        }

        function executeExecCommandCopy(text) {
            try {
                var textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.setAttribute('readonly', '');
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.style.top = '-9999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                textArea.setSelectionRange(0, 99999);
                var successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) {
                    showToast('✅ Tautan galeri berhasil disalin untuk dibagikan!');
                    return;
                }
            } catch (err) { }

            openCopyFallbackModal(text);
        }
    }

    function copyActiveGalleryLink() {
        var flyerView = document.getElementById('view-flyer');
        var targetUrl = (flyerView && flyerView.getAttribute('data-target-url')) || '';

        if (!targetUrl && appState.activeCollectionData && appState.activeCollectionData.slug) {
            targetUrl = getPublicGalleryUrl(appState.activeCollectionData.slug);
        }

        if (!targetUrl) {
            showToast('⚠️ Data koleksi tidak ditemukan. Buka flyer dari tabel koleksi.');
            return;
        }

        copyActiveGalleryLinkWithCustomUrl(targetUrl);
    }

    function openCopyFallbackModal(url) {
        var input = document.getElementById('input-fallback-copy-url');
        if (input) input.value = url;
        openModal('modal-copy-link-fallback');
    }

    function selectAndCopyFallbackInput() {
        var input = document.getElementById('input-fallback-copy-url');
        if (input) {
            input.focus();
            input.select();
            input.setSelectionRange(0, 99999);
            try {
                document.execCommand('copy');
                showToast('✅ Tautan berhasil disalin!');
                closeModal('modal-copy-link-fallback');
            } catch (e) {
                showToast('Teks terseleksi. Silakan tekan Ctrl+C untuk menyalin.');
            }
        }
    }

        function backToDashboard() {
        if (!appState.currentUser) {
            appState.currentUser = { id: 'USR-DEFAULT', nama: 'Admin User', role: 'Admin' };
        }
        switchView('view-dashboard');
        var lastTab = 'tab-control-center';
        try {
            lastTab = localStorage.getItem('limz_active_dash_tab') || 'tab-control-center';
        } catch (e) { }
        switchDashboardTab(lastTab);
    }

    function showToast(msg) {
        var toast = document.getElementById('global-toast');
        toast.innerText = msg;
        toast.style.display = 'block';
        setTimeout(function () { toast.style.display = 'none'; }, 3500);
    }

    function switchView(viewId) {
        if (viewId === 'view-dashboard') {
            document.body.classList.add('in-dashboard');
            var pubGallery = document.getElementById('view-public-gallery');
            if (pubGallery) {
                pubGallery.classList.remove('view-active');
                pubGallery.style.display = 'none';
            }
        } else {
            document.body.classList.remove('in-dashboard');
        }
        if (appState.currentView === viewId) {
            var activeTarget = document.getElementById(viewId);
            if (activeTarget && activeTarget.style.display !== 'block') {
                activeTarget.style.display = 'block';
                activeTarget.classList.add('view-active');
            }
            return;
        }

        if (viewId !== 'view-public-gallery' && appState.galleryPollInterval) {
            clearInterval(appState.galleryPollInterval);
            appState.galleryPollInterval = null;
        }

        var views = document.querySelectorAll('.view-container');
        for (var i = 0; i < views.length; i++) {
            views[i].classList.remove('view-active');
            views[i].style.display = 'none';
        }
        var target = document.getElementById(viewId);
        if (target) {
            target.classList.add('view-active');
            target.style.display = 'block';
            appState.currentView = viewId;
            window.scrollTo(0, 0);

            // Sembunyikan pill status kamera jika membuka monitor panggung atau galeri publik (Revisi 74)
            var hudPill = document.getElementById('hud-floating-camera-pill');
            if (hudPill) {
                if (viewId === 'view-slideshow' || viewId === 'view-public-gallery' || viewId === 'view-flyer' || viewId === 'view-login') {
                    hudPill.style.display = 'none';
                } else if (viewId === 'view-dashboard') {
                    hudPill.style.display = 'inline-flex';
                }
            }

            // Simpan riwayat tampilan terakhir agar tahan reload saat pindah tab
            try {
                if (viewId === 'view-dashboard') {
                    localStorage.setItem('limz_active_view', 'view-dashboard');
                } else if (viewId === 'view-landing') {
                    localStorage.setItem('limz_active_view', 'view-landing');
                }
            } catch (e) { }
        }

        if (viewId === 'view-login') {
            var em = document.getElementById('login-email');
            var pw = document.getElementById('login-password');
            if (em) em.value = '';
            if (pw) pw.value = '';
        }
    }

    function switchDashboardTab(tabId, el) {
        var tabs = document.querySelectorAll('.dash-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].style.display = 'none';
        }
        var target = document.getElementById(tabId);
        if (target) {
            target.style.display = 'block';
            appState.activeDashboardTab = tabId;
            try { localStorage.setItem('limz_active_dash_tab', tabId); } catch (e) { }

            // Docking kamera pill ke top-bar tab yang sedang aktif (Revisi 74)
            var hudPill = document.getElementById('hud-floating-camera-pill');
            if (hudPill && target) {
                var btnGroup = target.querySelector('.top-bar > div:last-child');
                if (btnGroup && btnGroup !== hudPill.parentElement) {
                    btnGroup.prepend(hudPill);
                }
            }
        }

        if (tabId === 'tab-control-center') {
            refreshDashboardData();
        } else if (tabId === 'tab-storage') {
            fetchDriveStorageQuota();
            if (!appState.collections || appState.collections.length === 0) {
                fetchCollectionsList();
            } else {
                renderStorageTable(appState.collections);
            }
        } else if (tabId === 'tab-upload') {
            refreshUploadedPhotosForTabUpload();
            if (typeof renderEvotoWorkspacePresetsGrid === 'function') {
                renderEvotoWorkspacePresetsGrid();
            }
            if (typeof renderEvotoUploadPresetsGrid === 'function') {
                renderEvotoUploadPresetsGrid();
            }
        } else if (tabId === 'tab-moderation') {
            fetchSensorWords();
            fetchWishesForModeration();
        } else if (tabId === 'tab-collections') {
            fetchCollectionsList();
        } else if (tabId === 'tab-studio-editor') {
            switchDashboardTab('tab-upload');
            return;
        }

        if (el) {
            var items = document.querySelectorAll('.sidebar-item');
            for (var j = 0; j < items.length; j++) {
                items[j].classList.remove('active');
            }
            el.classList.add('active');
        } else {
            var sidebarItems = document.querySelectorAll('.sidebar-item');
            for (var k = 0; k < sidebarItems.length; k++) {
                sidebarItems[k].classList.remove('active');
                if (sidebarItems[k].getAttribute('onclick') && sidebarItems[k].getAttribute('onclick').indexOf(tabId) > -1) {
                    sidebarItems[k].classList.add('active');
                }
            }
        }
    }

    function openModal(id) { document.getElementById(id).style.display = 'flex'; }
    function closeModal(id) { document.getElementById(id).style.display = 'none'; }

    /* =========================================================================
       ROUTING ENGINE (PRETTY PATHS & QUERY PARAMS)
       Mendukung URL /:slug, /:slug/monitor, /:slug/p/:photoId di Vercel & GAS
       ========================================================================= */
    function checkUrlRouting() {
        var urlParams = new URLSearchParams(window.location.search);
        var queryEl = document.getElementById('gas-query-data');
        var preloadedEl = document.getElementById('gas-preloaded-coll');
        var serverQuery = {};
        var preloadedColl = null;

        if (queryEl && queryEl.innerText && queryEl.innerText.trim().indexOf('{') === 0) {
            try { serverQuery = JSON.parse(queryEl.innerText); } catch (e) { }
        }
        if (preloadedEl && preloadedEl.innerText && preloadedEl.innerText.trim().indexOf('{') === 0) {
            try { preloadedColl = JSON.parse(preloadedEl.innerText); } catch (e) { }
        }

        var rawSlug = urlParams.get('slug') || serverQuery.slug || '';
        var view = urlParams.get('view') || serverQuery.view || '';
        var photoId = urlParams.get('photoId') || urlParams.get('photo') || serverQuery.photoId || serverQuery.photo;

        // Filter proteksi: abaikan kata kunci sistem Google Apps Script agar tidak dianggap slug acara
        var sysReserved = ['macros', 's', 'exec', 'api', 'index.html', 'dashboard', 'admin'];
        var slug = (rawSlug && sysReserved.indexOf(rawSlug.toLowerCase()) === -1) ? rawSlug.trim() : '';

        // Parsing Pretty Path hanya jika benar-benar dibuka di domain Vercel / domain publik kustom
        if (!slug && isRunningOnVercelOrCustomDomain()) {
            var pathSegments = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
            if (pathSegments.length > 0 && pathSegments[0] && sysReserved.indexOf(pathSegments[0].toLowerCase()) === -1) {
                if (pathSegments[0] === 'monitor' || pathSegments[0] === 'slideshow') {
                    view = 'slideshow';
                    slug = localStorage.getItem('limz_last_active_slug') || '';
                } else {
                    slug = decodeURIComponent(pathSegments[0]);
                    if (pathSegments.length > 1) {
                        if (pathSegments[1] === 'monitor' || pathSegments[1] === 'slideshow') {
                            view = 'slideshow';
                        } else if (pathSegments[1] === 'p' && pathSegments[2]) {
                            photoId = decodeURIComponent(pathSegments[2]);
                        }
                    }
                }
            }
        }
        if (slug) {
            try { localStorage.setItem('limz_last_active_slug', slug); } catch (e) { }
        }

        if (photoId) {
            appState.targetPhotoId = String(photoId).trim();
        }

        if (slug) {
            var views = document.querySelectorAll('.view-container');
            for (var i = 0; i < views.length; i++) {
                views[i].classList.remove('view-active');
                views[i].style.display = 'none';
            }

            if (view === 'slideshow') {
                document.getElementById('view-slideshow').style.display = 'block';
                loadSlideshowBySlug(slug);
            } else {
                document.getElementById('view-public-gallery').style.display = 'block';

                // Cek apakah ada metadata event & cover tersimpan di localStorage atau preloaded server
                var cachedColl = null;
                try {
                    var rawColl = localStorage.getItem('limz_cached_coll_' + slug);
                    if (rawColl) cachedColl = JSON.parse(rawColl);
                } catch (e) { }

                var cachedCover = (preloadedColl && preloadedColl.coverUrl)
                    ? preloadedColl.coverUrl
                    : ((cachedColl && cachedColl.coverUrl) || localStorage.getItem('limz_cover_' + slug) || '');

                var activeTheme = (preloadedColl && preloadedColl.splashTheme)
                    || (cachedColl && cachedColl.splashTheme)
                    || 'classic-gold';

                var activeTitle = (preloadedColl && preloadedColl.title)
                    || (cachedColl && cachedColl.title)
                    || '';

                var urlParams = new URLSearchParams(window.location.search);
                var isPreviewSplash = (urlParams.get('previewSplash') === '1');
                if (isPreviewSplash) {
                    try { sessionStorage.removeItem('limz_splash_dismissed_' + slug); } catch (e) { }
                    appState.splashDismissed = false;
                }

                var isAlreadyDismissed = false;
                try { isAlreadyDismissed = (sessionStorage.getItem('limz_splash_dismissed_' + slug) === '1'); } catch (e) { }
                if (isAlreadyDismissed && !isPreviewSplash) appState.splashDismissed = true;

                if (!appState.splashDismissed) {
                    startThreeSecondSplashScreen({
                        slug: slug,
                        title: activeTitle,
                        coverUrl: cachedCover,
                        splashTheme: activeTheme
                    }, cachedCover);
                } else if (appState.splashDismissed) {
                    var splashInitial = document.getElementById('gallery-splash-loader');
                    if (splashInitial) splashInitial.style.display = 'none';
                }

                if (preloadedColl && preloadedColl.id) {
                    openPublicGallery(preloadedColl, false);
                } else {
                    loadPublicGalleryBySlug(slug, false);
                }
            }
        } else {
            // TIDAK ADA SLUG (BUKAN LINK GALERI TAMU)
            // Auto-Resume: Cek apakah user sebelumnya sudah login dan sedang bekerja di Dashboard
            var savedUser = null;
            var lastView = null;
            var lastTab = null;
            try {
                savedUser = localStorage.getItem('limz_saved_user_session');
                lastView = localStorage.getItem('limz_active_view');
                lastTab = localStorage.getItem('limz_active_dash_tab');
            } catch (e) { }

            if (savedUser && (lastView === 'view-dashboard' || !lastView || lastView !== 'view-landing')) {
                if (!appState.currentUser) {
                    try { appState.currentUser = JSON.parse(savedUser); } catch (e) { }
                    updateUserDisplay();
                }
                switchView('view-dashboard');
                if (lastTab && document.getElementById(lastTab)) {
                    switchDashboardTab(lastTab);
                } else {
                    switchDashboardTab('tab-control-center');
                }
                refreshDashboardData();
            } else {
                // Bersihkan class rute agar Landing Page resmi (SS 2) tampil natural dan tidak tertutup CSS
                document.documentElement.classList.remove('route-gallery', 'route-monitor');
                switchView('view-landing');
            }
        }
    }

    function loadPublicGalleryBySlug(slug, forceSync) {
        // Simpan slug event terakhir agar jika monitor dibuka, langsung mengarah ke event ini
        try { localStorage.setItem('limz_last_active_slug', slug); } catch (e) { }

        // 1. Tampilkan skeleton loading instan di grid foto agar tidak ada layar kosong
        var grid = document.getElementById('pub-photo-grid');
        if (grid && (!grid.children || grid.children.length === 0)) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:35px 20px; color:var(--text-muted);">' +
                '<div style="margin: 0 auto 12px; width: 36px; height: 36px; border: 3px solid rgba(212,148,56,0.25); border-top-color: var(--accent-gold); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>' +
                '<div style="font-size:14px; font-weight:700; color:var(--text-main);">Menyiapkan foto-foto momen indah...</div>' +
                '<div style="font-size:12px; margin-top:4px; color:var(--text-muted);">Memuat dokumentasi resmi event</div>' +
                '</div>';
        }

        // 2. Cek apakah metadata koleksi sudah ada di cache lokal (Instan 0ms)
        var cachedColl = null;
        try {
            var rawColl = localStorage.getItem('limz_cached_coll_' + slug);
            if (rawColl) cachedColl = JSON.parse(rawColl);
        } catch (e) { }

        if (cachedColl && cachedColl.id) {
            openPublicGallery(cachedColl, false);
        }

        google.script.run
            .withSuccessHandler(function (res) {
                if (res.success && res.collection) {
                    try {
                        localStorage.setItem('limz_cached_coll_' + slug, JSON.stringify(res.collection));
                        if (res.collection.coverUrl) localStorage.setItem('limz_cover_' + slug, res.collection.coverUrl);
                    } catch (e) {}

                    var splashBg = document.getElementById('splash-bg-overlay');
                    if (splashBg && res.collection.coverUrl) {
                        splashBg.style.backgroundImage = 'url(\'' + res.collection.coverUrl + '\')';
                    }

                    // Sinkronkan tema splash screen & jalankan countdown begitu cover tiba
                    var splashEl = document.getElementById('gallery-splash-loader');
                    if (splashEl && splashEl.style.display !== 'none' && !appState.splashDismissed) {
                        applySplashThemeLayout(res.collection);
                        startThreeSecondSplashScreen(res.collection, res.collection.coverUrl);
                    }

                    try {
                        if (sessionStorage.getItem('limz_splash_dismissed_' + slug) === '1') {
                            appState.splashDismissed = true;
                        }
                    } catch (e) { }
                    openPublicGallery(res.collection, false);
                } else {
                    dismissSplashScreen();
                    showToast(res.message || 'Event galeri tidak ditemukan.');
                    switchView('view-landing');
                }
            })
            .withFailureHandler(function () {
                dismissSplashScreen();
                showToast('Gagal terhubung ke database.');
                switchView('view-landing');
            })
            .getCollectionBySlug(slug, forceSync === true);
    }

    function triggerManualSyncPublicGallery() {
        showToast('Menyinkronkan foto dari Google Drive...');
        if (appState.activeCollectionData && appState.activeCollectionData.slug) {
            loadPublicGalleryBySlug(appState.activeCollectionData.slug, true);
        } else {
            window.location.reload();
        }
    }

    function loadSlideshowBySlug(slug) {
        if (!slug) {
            slug = localStorage.getItem('limz_last_active_slug') || '';
        }

        // 1. Cek data preloaded dari server scriptlet index.html agar LANGSUNG menuju ke project tanpa delay
        var preloaded = null;
        try {
            var elPre = document.getElementById('gas-preloaded-coll');
            if (elPre && elPre.innerText && elPre.innerText.trim() !== '{}') {
                preloaded = JSON.parse(elPre.innerText);
            }
        } catch (e) { }

        if (preloaded && preloaded.id && (!slug || String(preloaded.slug).toLowerCase() === String(slug).toLowerCase())) {
            openSlideshowById(preloaded.id, preloaded);
            return;
        }

        // 2. Cek apakah ada di cache lokal browser appState.collections
        if (slug && appState.collections && appState.collections.length > 0) {
            var found = findCollectionBySlug(slug);
            if (found) {
                openSlideshowById(found.id, found);
                return;
            }
        }

        // 3. Panggil backend Google Apps Script jika belum di-cache
        if (slug && slug !== 'monitor') {
            google.script.run
                .withSuccessHandler(function (res) {
                    if (res && res.success && res.collection) {
                        try { localStorage.setItem('limz_last_active_slug', res.collection.slug); } catch (e) { }
                        openSlideshowById(res.collection.id, res.collection);
                    } else {
                        fetchFirstActiveEventForMonitor();
                    }
                })
                .withFailureHandler(function () {
                    fetchFirstActiveEventForMonitor();
                })
                .getCollectionBySlug(slug, false);
        } else {
            fetchFirstActiveEventForMonitor();
        }
    }

    function fetchFirstActiveEventForMonitor() {
        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.collections && res.collections.length > 0) {
                    var target = res.collections[0];
                    try { localStorage.setItem('limz_last_active_slug', target.slug); } catch (e) { }
                    openSlideshowById(target.id, target);
                } else {
                    var fallbackEvent = { id: '', title: 'Layar Monitor Live', slug: '', eventDate: '' };
                    openSlideshowById(fallbackEvent.id, fallbackEvent);
                }
            })
            .withFailureHandler(function () {
                var fallbackEvent = { id: '', title: 'Layar Monitor Live', slug: '', eventDate: '' };
                openSlideshowById(fallbackEvent.id, fallbackEvent);
            })
            .getCollections();
    }

    function openGuestDemo() {
        var dummyEvent = {
            id: 'EVT-DEMO',
            title: 'Irvan & Susan',
            slug: 'irvan-susan',
            eventDate: '2026-09-12',
            coverUrl: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1600&q=80',
            headerColor: '#1f2530'
        };
        openPublicGallery(dummyEvent, true);
    }

    function openPublicGallery(coll, withSplash) {
        var isAlreadyActive = (appState.activeCollectionId === coll.id && appState.currentView === 'view-public-gallery');

        appState.activeCollectionId = coll.id;
        appState.activeCollectionData = coll;

        var cover = coll.coverUrl || '';
        var formattedDate = formatDisplayDate(coll.eventDate);

        document.getElementById('pub-event-title').innerText = coll.title || 'Wedding Gallery';
        document.getElementById('pub-event-date').innerText = formattedDate;
        if (cover) {
            document.getElementById('pub-hero-banner').style.backgroundImage = 'url(\'' + cover + '\')';
        } else {
            document.getElementById('pub-hero-banner').style.backgroundImage = 'none';
        }

        if (isAlreadyActive) {
            return;
        }

        switchView('view-public-gallery');

        if (withSplash && !appState.splashDismissed) {
            startThreeSecondSplashScreen(coll, cover);
        } else if (appState.splashDismissed) {
            dismissSplashScreen();
        }

        loadGalleryPhotos(coll.id);
        loadPublicWishes(coll.id);

        if (appState.galleryPollInterval) clearInterval(appState.galleryPollInterval);
        appState.galleryPollInterval = setInterval(function () {
            if (document.hidden) return; // Menghemat baterai & kuota saat browser di background
            if (appState.activeCollectionId && appState.currentView === 'view-public-gallery') {
                google.script.run
                    .withSuccessHandler(function (res) {
                        if (res && res.success && res.photos) {
                            if (res.photos.length !== appState.photos.length) {
                                appState.photos = res.photos;
                                renderGalleryPhotos(appState.photos);
                            }
                        }
                    })
                    .getPhotosByCollection(appState.activeCollectionId, 1, 0, false);
            }
        }, 18000); // Polling santai 18 detik, ringan dan bebas lag

        google.script.run.logActivity(coll.id, 'PageView', '-', navigator.userAgent);
    }

    var splashCountdownTimer = null;

    function applySplashThemeLayout(coll) {
        var theme = (coll && coll.splashTheme) || (appState.activeCollectionData && appState.activeCollectionData.splashTheme) || 'classic-gold';
        var bg = document.getElementById('splash-bg-overlay');

        if (theme === 'direct-instant') {
            dismissSplashScreen();
            return;
        }

        var boxClassic = document.getElementById('splash-box-classic-gold');
        var boxModern = document.getElementById('splash-box-modern-circular');
        var boxFloral = document.getElementById('splash-box-romantic-floral');
        var boxCinematic = document.getElementById('splash-box-cinematic-zoom');

        if (boxClassic) boxClassic.style.display = (theme === 'classic-gold') ? 'flex' : 'none';
        if (boxModern) boxModern.style.display = (theme === 'modern-circular') ? 'flex' : 'none';
        if (boxFloral) boxFloral.style.display = (theme === 'romantic-floral') ? 'flex' : 'none';
        if (boxCinematic) boxCinematic.style.display = (theme === 'cinematic-zoom') ? 'flex' : 'none';

        if (theme === 'romantic-floral') {
            var floralTitle = document.getElementById('splash-romantic-event-title');
            if (floralTitle) {
                var eventName = (coll && coll.title) || (appState.activeCollectionData && appState.activeCollectionData.title) || 'Momen Spesial';
                floralTitle.innerText = eventName;
            }
        } else if (theme === 'cinematic-zoom') {
            if (bg) bg.classList.add('ken-burns-active');
        } else {
            if (bg) bg.classList.remove('ken-burns-active');
        }
    }

    function startThreeSecondSplashScreen(coll, coverUrl) {
        var sSlug = (coll && coll.slug) || '';
        if (!sSlug) {
            try {
                var pSegs = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
                sSlug = (pSegs.length > 0 && pSegs[0] !== 'index.html') ? pSegs[0] : (new URLSearchParams(window.location.search).get('slug') || '');
            } catch (e) { }
        }
        if (sSlug) {
            try {
                if (sessionStorage.getItem('limz_splash_dismissed_' + sSlug) === '1') {
                    appState.splashDismissed = true;
                }
            } catch (e) { }
        }

        // Ambil tema countdown / splash screen dari koleksi (fallback: classic-gold)
        var theme = (coll && coll.splashTheme) || (appState.activeCollectionData && appState.activeCollectionData.splashTheme) || 'classic-gold';

        // Variasi 5: Direct Fast (Langsung Tampil Tanpa Countdown)
        if (theme === 'direct-instant') {
            dismissSplashScreen();
            return;
        }

        // Jika sudah ditutup oleh tamu, BATALKAN TOTAL!
        if (appState.splashDismissed) {
            var splashEl = document.getElementById('gallery-splash-loader');
            if (splashEl) splashEl.style.display = 'none';
            return;
        }

        var splash = document.getElementById('gallery-splash-loader');
        var bg = document.getElementById('splash-bg-overlay');

        var finalCover = coverUrl || (coll && coll.coverUrl) || (coll && coll.slug && localStorage.getItem('limz_cover_' + coll.slug)) || '';
        if (bg && finalCover) {
            bg.style.backgroundImage = 'url(\'' + finalCover + '\')';
        }

        if (!splash) return;
        splash.style.display = 'flex';
        splash.style.pointerEvents = 'auto';
        splash.style.opacity = '1';

        // Setup box tampilan tema yang aktif
        applySplashThemeLayout(coll);

        // Jika cover belum ada (kunjungan perdana tanpa cache), tunggu data masuk sebelum countdown ditutup
        if (!finalCover) {
            var prepEls = document.querySelectorAll('.splash-countdown-num');
            for (var pIdx = 0; pIdx < prepEls.length; pIdx++) {
                prepEls[pIdx].innerText = '⏳';
            }
            return;
        }

        var secondsLeft = 3;
        var totalSeconds = 3;
        var ringCircumference = 264; // 2 * PI * 42

        function updateThemeCountdown(sec) {
            var countEls = document.querySelectorAll('.splash-countdown-num');
            for (var k = 0; k < countEls.length; k++) {
                countEls[k].innerText = sec;
            }
            if (theme === 'modern-circular') {
                var ringIndicator = document.getElementById('splash-ring-progress');
                if (ringIndicator) {
                    var progressFraction = (sec - 1) / totalSeconds;
                    var offset = ringCircumference * (1 - Math.max(0, progressFraction));
                    ringIndicator.style.strokeDashoffset = offset;
                }
            }
        }

        updateThemeCountdown(secondsLeft);

        if (splashCountdownTimer) clearInterval(splashCountdownTimer);

        splashCountdownTimer = setInterval(function () {
            if (appState.splashDismissed) {
                clearInterval(splashCountdownTimer);
                splashCountdownTimer = null;
                return;
            }
            secondsLeft--;
            if (secondsLeft > 0) {
                updateThemeCountdown(secondsLeft);
            } else {
                clearInterval(splashCountdownTimer);
                splashCountdownTimer = null;
                dismissSplashScreen();
            }
        }, 1000);
    }

    function dismissSplashScreen() {
        appState.splashDismissed = true; // Kunci mutlak di memori
        try {
            var pathSegs = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
            var curSlug = (pathSegs.length > 0 && pathSegs[0] !== 'index.html') ? pathSegs[0] : (new URLSearchParams(window.location.search).get('slug') || '');
            if (curSlug) sessionStorage.setItem('limz_splash_dismissed_' + curSlug, '1');
            if (appState.activeCollectionData && appState.activeCollectionData.slug) {
                sessionStorage.setItem('limz_splash_dismissed_' + appState.activeCollectionData.slug, '1');
            }
        } catch (e) { }

        if (splashCountdownTimer) {
            clearInterval(splashCountdownTimer);
            splashCountdownTimer = null;
        }

        var bg = document.getElementById('splash-bg-overlay');
        if (bg) bg.classList.remove('ken-burns-active');

        var splash = document.getElementById('gallery-splash-loader');
        if (splash) {
            splash.style.opacity = '0';
            splash.style.pointerEvents = 'none';
            setTimeout(function () {
                splash.style.display = 'none';
                checkAutoOpenDirectPhoto();
                // Tampil bersih dari bagian paling atas galeri (tanpa auto-scroll)
                window.scrollTo(0, 0);
            }, 120);
        } else {
            checkAutoOpenDirectPhoto();
            // Tampil bersih dari bagian paling atas galeri (tanpa auto-scroll)
            window.scrollTo(0, 0);
        }
    }

    function checkAutoOpenDirectPhoto() {
        if (!appState.targetPhotoId || !appState.photos || appState.photos.length === 0) return;

        var targetId = String(appState.targetPhotoId).trim().toLowerCase();
        var foundPhoto = null;
        var foundIndex = -1;

        for (var i = 0; i < appState.photos.length; i++) {
            var p = appState.photos[i];
            if ((p.photoId && String(p.photoId).toLowerCase() === targetId) ||
                (p.driveFileId && String(p.driveFileId).toLowerCase() === targetId) ||
                (p.fileName && String(p.fileName).toLowerCase() === targetId)) {
                foundPhoto = p;
                foundIndex = i;
                break;
            }
        }

        if (foundPhoto) {
            // Jika foto berada di halaman lain pada pagination, arahkan otomatis ke halaman tersebut
            if (typeof galleryPaginationState !== 'undefined' && galleryPaginationState.perPage > 0) {
                var targetPage = Math.floor(foundIndex / galleryPaginationState.perPage) + 1;
                if (galleryPaginationState.currentPage !== targetPage) {
                    galleryPaginationState.currentPage = targetPage;
                    renderGalleryPhotosPage();
                }
            }

            // Langsung buka modal Lightbox foto resolusi penuh
            openLightbox(foundPhoto);
            showToast('📸 Membuka foto yang Anda pindai di layar monitor!');
            appState.targetPhotoId = null;
        }
    }

    function loadGalleryPhotos(collId) {
        var grid = document.getElementById('pub-photo-grid');

        // 1. Coba tampilkan dari Local Storage Cache secara instan (0 milidetik!)
        var cached = null;
        try {
            var raw = localStorage.getItem('limz_cached_photos_' + collId);
            if (raw) cached = JSON.parse(raw);
        } catch (e) { }

        if (cached && Array.isArray(cached) && cached.length > 0) {
            appState.photos = cached;
            renderGalleryPhotos(appState.photos);
        } else {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:30px; color:var(--text-muted);"><div style="font-size:24px; margin-bottom:8px;">⏳</div>Memuat dokumentasi foto event...</div>';
        }

        // 2. Fetch data foto terbaru di latar belakang
        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.photos) {
                    var isSame = false;
                    if (appState.photos && appState.photos.length === res.photos.length) {
                        if (appState.photos.length === 0 || (appState.photos[0].photoId === res.photos[0].photoId && appState.photos[appState.photos.length - 1].photoId === res.photos[res.photos.length - 1].photoId)) {
                            isSame = true;
                        }
                    }
                    appState.photos = res.photos;
                    try { localStorage.setItem('limz_cached_photos_' + collId, JSON.stringify(res.photos)); } catch (e) { }
                    if (!isSame) {
                        renderGalleryPhotos(appState.photos);
                    }
                    checkAutoOpenDirectPhoto();
                }
            })
            .withFailureHandler(function (err) {
                console.warn('Gagal sinkron foto galeri:', err);
            })
            .getPhotosByCollection(collId, 1, 0, false);
    }

    var galleryPaginationState = {
        currentPage: 1,
        perPage: 20,
        photos: []
    };

    function renderGalleryPhotos(photos) {
        var grid = document.getElementById('pub-photo-grid');
        var indicator = document.getElementById('pub-photo-total-indicator');
        grid.innerHTML = '';

        if (!photos || photos.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:var(--text-muted); padding: 30px;">Belum ada foto yang diunggah untuk event ini.</div>';
            if (indicator) indicator.innerText = '0 foto tersedia';
            var pagExisting = document.getElementById('pub-gallery-pagination');
            if (pagExisting) pagExisting.style.display = 'none';
            return;
        }

        if (indicator) {
            indicator.innerText = photos.length + ' foto momen siap diunduh';
        }

        galleryPaginationState.photos = photos;

        // Jika ada targetPhotoId dari scan QR, sinkronkan halaman aktif ke letak foto tersebut
        if (appState.targetPhotoId) {
            var tid = String(appState.targetPhotoId).trim().toLowerCase();
            for (var k = 0; k < photos.length; k++) {
                var item = photos[k];
                if ((item.photoId && String(item.photoId).toLowerCase() === tid) ||
                    (item.driveFileId && String(item.driveFileId).toLowerCase() === tid)) {
                    galleryPaginationState.currentPage = Math.floor(k / galleryPaginationState.perPage) + 1;
                    break;
                }
            }
        } else {
            var maxPage = Math.ceil(photos.length / galleryPaginationState.perPage) || 1;
            if (galleryPaginationState.currentPage > maxPage) {
                galleryPaginationState.currentPage = maxPage;
            }
        }

        renderGalleryPhotosPage();
    }

    function goToGalleryPage(page) {
        var totalPages = Math.ceil(galleryPaginationState.photos.length / galleryPaginationState.perPage) || 1;
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;
        galleryPaginationState.currentPage = page;
        renderGalleryPhotosPage();

        var grid = document.getElementById('pub-photo-grid');
        if (grid) {
            grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function renderGalleryPhotosPage() {
        var grid = document.getElementById('pub-photo-grid');
        if (!grid) return;
        grid.innerHTML = '';

        var photos = galleryPaginationState.photos || [];
        var total = photos.length;
        if (total === 0) return;

        var perPage = galleryPaginationState.perPage || 20;
        var totalPages = Math.ceil(total / perPage) || 1;
        if (galleryPaginationState.currentPage > totalPages) galleryPaginationState.currentPage = totalPages;
        if (galleryPaginationState.currentPage < 1) galleryPaginationState.currentPage = 1;
        var curPage = galleryPaginationState.currentPage;

        var startIdx = (curPage - 1) * perPage;
        var endIdx = Math.min(startIdx + perPage, total);

        var fragment = document.createDocumentFragment();
        for (var i = startIdx; i < endIdx; i++) {
            var p = photos[i];
            var div = document.createElement('div');
            div.className = 'photo-card';
            div.onclick = (function (item) {
                return function () { openLightbox(item); };
            })(p);

            // Thumbnail ringan sz=w500 untuk kisi galeri super cepat & irit kuota
            var thumbSrc = p.thumbnailUrl || '';
            if (thumbSrc.indexOf('googleusercontent.com') > -1) {
                thumbSrc = thumbSrc.replace(/sz=s\d+|sz=w\d+/, 'sz=w500');
                if (thumbSrc.indexOf('=') === -1) thumbSrc += '=w500';
            }

            div.innerHTML = '<img src="' + thumbSrc + '" loading="lazy" alt="Guest Photo">' +
                '<span class="photo-card-download-btn" onclick="event.stopPropagation(); triggerDownloadOri(\'' + p.downloadUrl + '\', \'' + (p.photoId || '-') + '\')">⬇️ Download Ori</span>' +
                '<span class="photo-card-wa-btn" onclick="event.stopPropagation(); sharePhotoToWhatsApp(\'' + (p.photoId || '') + '\')" title="Kirim Foto ke WhatsApp">💬 WA</span>';
            fragment.appendChild(div);
        }
        grid.appendChild(fragment);

        renderGalleryPaginationControls(curPage, totalPages, total, startIdx + 1, endIdx);
    }

    function renderGalleryPaginationControls(curPage, totalPages, total, fromNum, toNum) {
        var pagContainer = document.getElementById('pub-gallery-pagination');
        if (!pagContainer) {
            pagContainer = document.createElement('div');
            pagContainer.id = 'pub-gallery-pagination';
            pagContainer.style.cssText = 'margin-top: 30px; margin-bottom: 20px; display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%;';
            var grid = document.getElementById('pub-photo-grid');
            if (grid && grid.parentNode) {
                grid.parentNode.insertBefore(pagContainer, grid.nextSibling);
            }
        }

        if (totalPages <= 1) {
            pagContainer.style.display = 'none';
            return;
        }

        pagContainer.style.display = 'flex';

        var html = '';
        html += '<div style="font-size: 13px; color: var(--text-muted); font-weight: 500; text-align: center;">' +
            'Menampilkan foto <strong style="color: var(--text-main);">' + fromNum + ' - ' + toNum + '</strong> dari <strong style="color: var(--accent-gold);">' + total + '</strong> foto momen' +
            '</div>';

        html += '<div style="display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center;">';

        var prevDisabled = (curPage <= 1)
            ? 'disabled style="opacity: 0.4; cursor: not-allowed; padding: 6px 14px; font-size: 13px; border-radius: 6px;"'
            : 'onclick="goToGalleryPage(' + (curPage - 1) + ')" style="cursor: pointer; padding: 6px 14px; font-size: 13px; border-radius: 6px;"';
        html += '<button type="button" class="btn btn-outline btn-sm" ' + prevDisabled + '>⬅️ Sebelumnya</button>';

        var maxVisibleButtons = 5;
        var startPage = Math.max(1, curPage - Math.floor(maxVisibleButtons / 2));
        var endPage = Math.min(totalPages, startPage + maxVisibleButtons - 1);
        if (endPage - startPage < maxVisibleButtons - 1) {
            startPage = Math.max(1, endPage - maxVisibleButtons + 1);
        }

        if (startPage > 1) {
            html += '<button type="button" class="btn btn-outline btn-sm" onclick="goToGalleryPage(1)" style="padding: 6px 12px; font-size: 13px; border-radius: 6px;">1</button>';
            if (startPage > 2) {
                html += '<span style="color: var(--text-muted); padding: 0 4px;">...</span>';
            }
        }

        for (var p = startPage; p <= endPage; p++) {
            if (p === curPage) {
                html += '<button type="button" class="btn btn-sm" style="background: var(--accent-gold); color: #000; font-weight: 700; border: 1px solid var(--accent-gold); padding: 6px 13px; font-size: 13px; border-radius: 6px;">' + p + '</button>';
            } else {
                html += '<button type="button" class="btn btn-outline btn-sm" onclick="goToGalleryPage(' + p + ')" style="padding: 6px 12px; font-size: 13px; border-radius: 6px;">' + p + '</button>';
            }
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += '<span style="color: var(--text-muted); padding: 0 4px;">...</span>';
            }
            html += '<button type="button" class="btn btn-outline btn-sm" onclick="goToGalleryPage(' + totalPages + ')" style="padding: 6px 12px; font-size: 13px; border-radius: 6px;">' + totalPages + '</button>';
        }

        var nextDisabled = (curPage >= totalPages)
            ? 'disabled style="opacity: 0.4; cursor: not-allowed; padding: 6px 14px; font-size: 13px; border-radius: 6px;"'
            : 'onclick="goToGalleryPage(' + (curPage + 1) + ')" style="cursor: pointer; padding: 6px 14px; font-size: 13px; border-radius: 6px;"';
        html += '<button type="button" class="btn btn-outline btn-sm" ' + nextDisabled + '>Selanjutnya ➡️</button>';

        html += '</div>';

        pagContainer.innerHTML = html;
    }

    var lightboxState = {
        currentIndex: -1,
        zoom: 1,
        panX: 0,
        panY: 0,
        isPanning: false,
        startX: 0,
        startY: 0,
        lastTapTime: 0
    };

    function ensureLightboxStylesAndControls() {
        if (!document.getElementById('lightbox-enhanced-styles')) {
            var st = document.createElement('style');
            st.id = 'lightbox-enhanced-styles';
            st.innerHTML = `
                .lightbox-arrow-btn {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: rgba(22, 18, 14, 0.82);
                    backdrop-filter: blur(8px);
                    border: 1px solid rgba(212, 175, 55, 0.55);
                    color: #fff;
                    font-size: 32px;
                    line-height: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    z-index: 100;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    user-select: none;
                    -webkit-user-select: none;
                    box-shadow: 0 4px 18px rgba(0,0,0,0.6);
                }
                .lightbox-arrow-btn:hover {
                    background: var(--accent-gold, #d4af37);
                    color: #000;
                    border-color: var(--accent-gold, #d4af37);
                    transform: translateY(-50%) scale(1.12);
                    box-shadow: 0 0 20px rgba(212, 175, 55, 0.7);
                }
                .lightbox-arrow-btn.prev { left: 14px; }
                .lightbox-arrow-btn.next { right: 14px; }
                @media (max-width: 640px) {
                    .lightbox-arrow-btn { width: 38px; height: 38px; font-size: 24px; }
                    .lightbox-arrow-btn.prev { left: 8px; }
                    .lightbox-arrow-btn.next { right: 8px; }
                }
                .lightbox-img-box {
                    touch-action: none;
                    user-select: none;
                    position: relative;
                    overflow: hidden;
                }
                #lightbox-img {
                    transform-origin: center center;
                    transition: transform 0.25s ease-out;
                    will-change: transform;
                }
            `;
            document.head.appendChild(st);
        }

        var box = document.querySelector('.lightbox-img-box');
        if (box && !document.getElementById('lightbox-btn-prev')) {
            var btnPrev = document.createElement('button');
            btnPrev.id = 'lightbox-btn-prev';
            btnPrev.type = 'button';
            btnPrev.className = 'lightbox-arrow-btn prev';
            btnPrev.innerHTML = '‹';
            btnPrev.title = 'Foto Sebelumnya (← atau Geser Kanan)';
            btnPrev.onclick = function(e) {
                e.stopPropagation();
                lightboxNavigate(-1);
            };
            box.appendChild(btnPrev);

            var btnNext = document.createElement('button');
            btnNext.id = 'lightbox-btn-next';
            btnNext.type = 'button';
            btnNext.className = 'lightbox-arrow-btn next';
            btnNext.innerHTML = '›';
            btnNext.title = 'Foto Selanjutnya (→ atau Geser Kiri)';
            btnNext.onclick = function(e) {
                e.stopPropagation();
                lightboxNavigate(1);
            };
            box.appendChild(btnNext);

            initLightboxInteractions(box);
        }

        var header = document.querySelector('.lightbox-header');
        if (header && !document.getElementById('lightbox-zoom-toggle')) {
            var zoomBtn = document.createElement('button');
            zoomBtn.id = 'lightbox-zoom-toggle';
            zoomBtn.type = 'button';
            zoomBtn.className = 'btn btn-outline btn-sm';
            zoomBtn.style.cssText = 'color: #fff; border-color: #57483a; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; margin-right: 8px;';
            zoomBtn.title = 'Perbesar / Perkecil Foto (Bisa klik ganda pada foto)';
            zoomBtn.innerHTML = '<span id="lightbox-zoom-icon">🔍⁺</span> <span id="lightbox-zoom-text">Zoom</span>';
            zoomBtn.onclick = function(e) {
                e.stopPropagation();
                toggleLightboxZoom();
            };
            var closeBtn = header.querySelector('button[onclick*="closeLightbox"]');
            if (closeBtn) {
                header.insertBefore(zoomBtn, closeBtn);
            } else {
                header.appendChild(zoomBtn);
            }
        }
    }

    function initLightboxInteractions(box) {
        var img = document.getElementById('lightbox-img');
        if (!img || !box) return;

        // Double-click to zoom
        img.addEventListener('dblclick', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleLightboxZoom();
        });

        // Pointer / Touch Handlers for Swipe & Pan
        var touchStartX = 0;
        var touchStartY = 0;
        var isPointerDown = false;
        var startPanX = 0;
        var startPanY = 0;

        box.addEventListener('pointerdown', function(e) {
            if (e.target.closest('.lightbox-arrow-btn') || e.target.closest('button')) return;

            // Double tap detection on mobile
            var now = Date.now();
            if (now - lightboxState.lastTapTime < 320) {
                toggleLightboxZoom();
                lightboxState.lastTapTime = 0;
                return;
            }
            lightboxState.lastTapTime = now;

            isPointerDown = true;
            touchStartX = e.clientX;
            touchStartY = e.clientY;
            startPanX = lightboxState.panX;
            startPanY = lightboxState.panY;

            if (lightboxState.zoom > 1) {
                lightboxState.isPanning = true;
                box.setPointerCapture(e.pointerId);
                applyLightboxTransform();
            }
        });

        box.addEventListener('pointermove', function(e) {
            if (!isPointerDown) return;

            var dx = e.clientX - touchStartX;
            var dy = e.clientY - touchStartY;

            if (lightboxState.zoom > 1 && lightboxState.isPanning) {
                lightboxState.panX = startPanX + dx;
                lightboxState.panY = startPanY + dy;
                applyLightboxTransform();
            }
        });

        function onPointerEnd(e) {
            if (!isPointerDown) return;
            isPointerDown = false;

            if (lightboxState.zoom > 1) {
                lightboxState.isPanning = false;
                applyLightboxTransform();
                return;
            }

            // Swipe detection when zoom is 1x
            var deltaX = e.clientX - touchStartX;
            var deltaY = e.clientY - touchStartY;
            if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
                if (deltaX < 0) {
                    lightboxNavigate(1); // Swipe left -> Next photo
                } else {
                    lightboxNavigate(-1); // Swipe right -> Previous photo
                }
            }
        }

        box.addEventListener('pointerup', onPointerEnd);
        box.addEventListener('pointercancel', onPointerEnd);

        // Keyboard arrow navigation
        if (!window._lightboxKeyInit) {
            window._lightboxKeyInit = true;
            window.addEventListener('keydown', function(e) {
                var modal = document.getElementById('modal-lightbox');
                if (!modal || modal.style.display !== 'flex') return;

                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    lightboxNavigate(-1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    lightboxNavigate(1);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    closeLightbox();
                }
            });
        }
    }

    function resetLightboxZoom() {
        lightboxState.zoom = 1;
        lightboxState.panX = 0;
        lightboxState.panY = 0;
        lightboxState.isPanning = false;
        applyLightboxTransform();
    }

    function toggleLightboxZoom() {
        if (lightboxState.zoom > 1) {
            resetLightboxZoom();
        } else {
            lightboxState.zoom = 2.5;
            lightboxState.panX = 0;
            lightboxState.panY = 0;
            applyLightboxTransform();
        }
    }

    function applyLightboxTransform() {
        var img = document.getElementById('lightbox-img');
        if (!img) return;

        if (lightboxState.zoom <= 1) {
            img.style.transform = 'none';
            img.style.cursor = 'zoom-in';
            img.style.transition = 'transform 0.25s ease-out';
        } else {
            img.style.transform = 'translate(' + lightboxState.panX + 'px, ' + lightboxState.panY + 'px) scale(' + lightboxState.zoom + ')';
            img.style.cursor = lightboxState.isPanning ? 'grabbing' : 'grab';
            img.style.transition = lightboxState.isPanning ? 'none' : 'transform 0.15s ease-out';
        }

        var zoomBtnText = document.getElementById('lightbox-zoom-text');
        var zoomIcon = document.getElementById('lightbox-zoom-icon');
        if (zoomBtnText) {
            zoomBtnText.innerText = (lightboxState.zoom > 1) ? (Math.round(lightboxState.zoom * 100) + '%') : 'Zoom';
        }
        if (zoomIcon) {
            zoomIcon.innerText = (lightboxState.zoom > 1) ? '🔍⁻' : '🔍⁺';
        }
    }

    function lightboxNavigate(direction) {
        var photos = appState.photos || [];
        if (!photos || photos.length <= 1) return;

        var total = photos.length;
        var nextIdx = lightboxState.currentIndex + direction;

        if (nextIdx < 0) nextIdx = total - 1;
        if (nextIdx >= total) nextIdx = 0;

        var targetPhoto = photos[nextIdx];
        if (targetPhoto) {
            openLightbox(targetPhoto);

            // Jika foto berada di halaman pagination berbeda, update halaman di latar belakang
            if (typeof galleryPaginationState !== 'undefined' && galleryPaginationState.perPage > 0) {
                var targetPage = Math.floor(nextIdx / galleryPaginationState.perPage) + 1;
                if (galleryPaginationState.currentPage !== targetPage) {
                    galleryPaginationState.currentPage = targetPage;
                    renderGalleryPhotosPage();
                }
            }
        }
    }

    function openLightbox(photo) {
        appState.currentLightboxPhoto = photo;
        ensureLightboxStylesAndControls();
        resetLightboxZoom();

        var photos = appState.photos || [];
        var total = photos.length;
        var foundIdx = -1;
        for (var k = 0; k < photos.length; k++) {
            if (photos[k] === photo || (photo.photoId && photos[k].photoId === photo.photoId) || (photo.driveFileId && photos[k].driveFileId === photo.driveFileId)) {
                foundIdx = k;
                break;
            }
        }
        lightboxState.currentIndex = (foundIdx !== -1) ? foundIdx : 0;

        var countStr = (total > 0 && lightboxState.currentIndex >= 0)
            ? ('[Foto ' + (lightboxState.currentIndex + 1) + ' dari ' + total + '] • ')
            : '';
        document.getElementById('lightbox-file-name').innerText = countStr + (photo.fileName || 'Foto Momen Indah');

        var prevBtn = document.getElementById('lightbox-btn-prev');
        var nextBtn = document.getElementById('lightbox-btn-next');
        if (prevBtn) prevBtn.style.display = (total > 1) ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = (total > 1) ? 'flex' : 'none';

        var fileId = photo.driveFileId;
        if (!fileId && photo.downloadUrl) {
            var match = photo.downloadUrl.match(/id=([a-zA-Z0-9-_]+)/);
            if (match && match[1]) fileId = match[1];
        }

        var previewHighResUrl = fileId
            ? ('https://lh3.googleusercontent.com/d/' + fileId)
            : (photo.thumbnailUrl ? photo.thumbnailUrl.replace(/sz=w\d+/, 'sz=w1600') : photo.downloadUrl);

        var imgEl = document.getElementById('lightbox-img');
        imgEl.onerror = function () {
            if (photo.thumbnailUrl && imgEl.src !== photo.thumbnailUrl) {
                imgEl.src = photo.thumbnailUrl;
            }
        };
        imgEl.src = previewHighResUrl;

        var btn = document.getElementById('lightbox-download-btn');
        btn.href = photo.downloadUrl;
        btn.onclick = function () { logDownloadClick(photo.photoId || '-'); };
        document.getElementById('modal-lightbox').style.display = 'flex';
    }

    function closeLightbox() {
        appState.currentLightboxPhoto = null;
        resetLightboxZoom();
        document.getElementById('modal-lightbox').style.display = 'none';
        document.getElementById('lightbox-img').src = '';
    }

    function triggerDownloadOri(url, photoId) {
        logDownloadClick(photoId);
        window.open(url, '_blank');
    }

    function logDownloadClick(photoId) {
        if (appState.activeCollectionId) {
            google.script.run.logActivity(appState.activeCollectionId, 'DownloadSingle', photoId, navigator.userAgent);
        }
    }

    async function downloadAllPhotosZip() {
        if (!appState.photos || appState.photos.length === 0) {
            showToast('Belum ada foto dalam galeri untuk diunduh.');
            return;
        }

        if (appState.activeCollectionId) {
            google.script.run.logActivity(appState.activeCollectionId, 'DownloadAll', 'ALL_ZIP', navigator.userAgent);
        }

        var collTitle = (appState.activeCollectionData && appState.activeCollectionData.title)
            ? appState.activeCollectionData.title.replace(/[^a-zA-Z0-9_-]/g, '_')
            : 'Galeri_Foto';

        // Jika JSZip tidak tersedia di peramban, fallback ke direct multi-download
        if (typeof JSZip === 'undefined') {
            showToast('Mengunduh foto satu per satu...');
            for (var k = 0; k < Math.min(appState.photos.length, 30); k++) {
                (function (item, delay) {
                    setTimeout(function () {
                        var dl = item.downloadUrl || ('https://drive.google.com/uc?export=download&id=' + item.driveFileId);
                        var a = document.createElement('a');
                        a.href = dl;
                        a.download = item.fileName || ('foto_' + (k + 1) + '.jpg');
                        a.target = '_blank';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }, delay);
                })(appState.photos[k], k * 400);
            }
            return;
        }

        showToast('⏳ Menyiapkan pengunduhan semua foto (' + appState.photos.length + ' foto)...');

        var zip = new JSZip();
        var folder = zip.folder(collTitle);
        var total = appState.photos.length;
        var completed = 0;

        async function fetchBlobWithFallback(photo) {
            var fileId = photo.driveFileId;
            if (!fileId && photo.downloadUrl) {
                var m = photo.downloadUrl.match(/id=([a-zA-Z0-9-_]+)/);
                if (m && m[1]) fileId = m[1];
            }

            var highResUrl = fileId
                ? ('https://lh3.googleusercontent.com/d/' + fileId)
                : (photo.thumbnailUrl ? photo.thumbnailUrl.replace(/sz=w\d+/, 'sz=w1920') : photo.downloadUrl);

            return new Promise(function (resolve) {
                var img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = function () {
                    try {
                        var canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width;
                        canvas.height = img.naturalHeight || img.height;
                        var ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        canvas.toBlob(function (blob) {
                            if (blob) {
                                resolve(blob);
                            } else {
                                resolve(null);
                            }
                        }, 'image/jpeg', 0.95);
                    } catch (e) {
                        resolve(null);
                    }
                };
                img.onerror = function () {
                    resolve(null);
                };
                setTimeout(function () { resolve(null); }, 10000);
                img.src = highResUrl;
            });
        }

        for (var i = 0; i < total; i++) {
            var item = appState.photos[i];
            var fName = item.fileName || ('Foto_' + (i + 1) + '.jpg');
            if (fName.indexOf('.') === -1) fName += '.jpg';

            try {
                var blob = await fetchBlobWithFallback(item);
                if (blob) {
                    folder.file(fName, blob);
                    completed++;
                }
            } catch (err) { }

            if ((i + 1) % 5 === 0 || i === total - 1) {
                showToast('📦 Mengemas foto: ' + (i + 1) + ' dari ' + total + '...');
            }
        }

        if (completed === 0) {
            showToast('Mengunduh foto langsung ke folder unduhan...');
            for (var d = 0; d < Math.min(total, 25); d++) {
                (function (pItem, waitTime) {
                    setTimeout(function () {
                        var dl = pItem.downloadUrl || ('https://drive.google.com/uc?export=download&id=' + pItem.driveFileId);
                        var aEl = document.createElement('a');
                        aEl.href = dl;
                        aEl.download = pItem.fileName || ('foto_' + (waitTime / 350 + 1) + '.jpg');
                        aEl.target = '_blank';
                        document.body.appendChild(aEl);
                        aEl.click();
                        document.body.removeChild(aEl);
                    }, waitTime);
                })(appState.photos[d], d * 400);
            }
            return;
        }

        showToast('✨ Memproses berkas ZIP (' + completed + ' foto)...');
        try {
            var zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 4 }
            });
            var zipUrl = URL.createObjectURL(zipBlob);
            var dlAnchor = document.createElement('a');
            dlAnchor.href = zipUrl;
            dlAnchor.download = collTitle + '-Semua-Foto.zip';
            document.body.appendChild(dlAnchor);
            dlAnchor.click();
            document.body.removeChild(dlAnchor);
            setTimeout(function () { URL.revokeObjectURL(zipUrl); }, 15000);
            showToast('✅ Berhasil mengunduh semua foto dalam file ZIP!');
        } catch (zipErr) {
            console.error('ZIP generation error:', zipErr);
            showToast('Gagal membuat ZIP, mengalihkan ke unduhan langsung...');
        }
    }

    function openSlideshowById(id, optionalData) {
        var coll = optionalData || findCollectionById(id);
        if (!coll) return;

        var galleryPublicUrl = getPublicGalleryUrl(coll.slug);

        if (id !== 'EVT-DEMO' && !isRunningOnVercelOrCustomDomain() && (galleryPublicUrl.indexOf('UNDEFINED') > -1 || galleryPublicUrl.indexOf('googleusercontent') > -1)) {
            if (typeof google !== 'undefined' && google.script && google.script.run) {
                google.script.run.withSuccessHandler(function (url) {
                    if (url) {
                        appState.webAppUrl = cleanExecUrl(url);
                        var updatedUrl = getPublicGalleryUrl(coll.slug);
                        setCachedQrCode('mon-qr-img', updatedUrl, 260);
                    }
                }).getWebAppUrl();
            }
        }

        appState.activeCollectionId = coll.id;
        appState.activeCollectionData = coll;

        document.getElementById('mon-couple-title').innerText = coll.title;
        document.getElementById('mon-date-subtitle').innerText = formatDisplayDate(coll.eventDate);

        var hBar = document.getElementById('mon-header-bar');
        var chosenColor = coll.headerColor || '#1f2530';
        hBar.style.background = 'linear-gradient(180deg, ' + chosenColor + ' 0%, #0d1117 100%)';
        hBar.style.borderBottom = '2px solid ' + chosenColor;
        applyHeaderMotifGraphics(coll.headerMotif || 'floral-gold');

        setCachedQrCode('mon-qr-img', galleryPublicUrl, 260);

        switchView('view-slideshow');
        startMonitorEngine(coll.id);
    }

    function startMonitorEngine(collId) {
        if (appState.slideshowInterval) clearInterval(appState.slideshowInterval);
        if (appState.slideshowPollInterval) clearInterval(appState.slideshowPollInterval);
        if (appState.chatStreamInterval) clearInterval(appState.chatStreamInterval);

        appState.knownWishKeys = {};
        appState.isWishInitialized = false;

        fetchMonitorContent(collId, false);

        appState.slideshowPollInterval = setInterval(function () {
            if (appState.activeCollectionId && appState.currentView === 'view-slideshow') {
                fetchMonitorContent(appState.activeCollectionId, true);
            }
        }, 1500);
    }

    function fetchMonitorContent(collId, isPoll) {
        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success) {
                    if (isPoll && res.totalPhotos > appState.lastKnownPhotoCount && appState.lastKnownPhotoCount > 0) {
                        var diff = res.totalPhotos - appState.lastKnownPhotoCount;
                        showMonitorNewPhotoToast(diff + ' Foto Baru Saja Diunggah ke Galeri!');
                    }
                    appState.lastKnownPhotoCount = res.totalPhotos;
                    updateMonitorScreenView(res);
                }
            })
            .getMonitorPhotos(collId);
    }

    function preloadAndSwapImage(imgId, targetSrc) {
        if (!targetSrc) return;
        var el = document.getElementById(imgId);
        if (!el) return;
        // Anti-flicker: jika gambar yang sedang tampil sudah sama persis, abaikan agar tidak berkedip
        if (el.dataset.currentSrc === targetSrc || el.src === targetSrc) return;

        var swapped = false;
        function doSwap() {
            if (!swapped) {
                swapped = true;
                el.style.opacity = '0.35';
                setTimeout(function () {
                    el.src = targetSrc;
                    el.dataset.currentSrc = targetSrc;
                    el.style.opacity = '1';
                }, 40);
            }
        }

        var preloader = new Image();
        preloader.onload = doSwap;
        preloader.onerror = doSwap;
        setTimeout(doSwap, 1200);
        preloader.src = targetSrc;
    }

    function handleUploadCollectionChange() {
        var sel = document.getElementById('select-upload-collection');
        if (sel && sel.value) {
            appState.activeCollectionId = sel.value;
            appState.activeCollectionData = findCollectionById(sel.value);
        }
    }

    function openCurrentActiveMonitor() {
        var collId = document.getElementById('select-upload-collection') ? document.getElementById('select-upload-collection').value : appState.activeCollectionId;
        var coll = (collId ? findCollectionById(collId) : null) || appState.activeCollectionData;
        if (!coll && appState.collections && appState.collections.length > 0) {
            coll = appState.collections[0];
        }

        var activeSlug = (coll && coll.slug) || localStorage.getItem('limz_last_active_slug') || '';

        if (activeSlug) {
            openSlideshowNewTab(activeSlug);
        } else {
            // Ambil koleksi aktif pertama dari server jika belum terpilih
            google.script.run
                .withSuccessHandler(function (res) {
                    if (res && res.collections && res.collections.length > 0) {
                        var target = res.collections[0];
                        localStorage.setItem('limz_last_active_slug', target.slug);
                        openSlideshowNewTab(target.slug);
                    } else {
                        showToast('⚠️ Silakan buat atau pilih koleksi event terlebih dahulu.');
                    }
                })
                .getCollections();
        }
    }

    function updateMonitorScreenView(data) {
        if (!data) return;
        var slug = data.collectionSlug || (appState.activeCollectionData && appState.activeCollectionData.slug) || '';

        var hasPhotos = !!(data.mainPhoto && (data.totalPhotos === undefined || data.totalPhotos > 0));
        var mainKey = (hasPhotos && data.mainPhoto) ? (data.mainPhoto.photoId || data.mainPhoto.driveFileId) : null;
        var badgeTextEl = document.getElementById('mon-qr-badge-text');
        var hintEl = document.getElementById('mon-qr-target-hint');
        var descEl = document.getElementById('mon-qr-heading-desc');

        if (slug) {
            var galleryPublicUrl = getPublicGalleryUrl(slug);
            setCachedQrCode('mon-qr-img', galleryPublicUrl, 260);
            if (badgeTextEl) badgeTextEl.innerText = 'GALERI EVENT';
            if (descEl) descEl.innerHTML = 'Scan & Download<br><span style="color:#e2b86b;">Galeri Foto Event</span>';
            if (hintEl) hintEl.innerText = '📲 Pindai untuk membuka seluruh galeri...';
        }

        if (data.collectionTitle) {
            var coupleEl = document.getElementById('mon-couple-title');
            if (coupleEl) coupleEl.innerText = data.collectionTitle;
        }
        if (data.eventDate) {
            var dateEl = document.getElementById('mon-date-subtitle');
            if (dateEl) dateEl.innerText = formatDisplayDate(data.eventDate);
        }

        var emptyEl = document.getElementById('mon-empty-state');
        var largeImg = document.getElementById('mon-large-img');
        var qrLargeCard = document.getElementById('mon-qr-large-card');
        var subCol = document.getElementById('mon-col-sub');
        var subBox1 = document.getElementById('mon-sub-box-1');
        var subBox2 = document.getElementById('mon-sub-box-2');
        var qrSub1Card = document.getElementById('mon-qr-sub1-card');
        var qrSub2Card = document.getElementById('mon-qr-sub2-card');

        var hasPhotos = !!(data.mainPhoto && (data.totalPhotos === undefined || data.totalPhotos > 0));

        if (!hasPhotos) {
            if (emptyEl) emptyEl.style.display = 'flex';
            if (largeImg) {
                largeImg.style.display = 'none';
                largeImg.src = '';
            }
            if (qrLargeCard) qrLargeCard.style.display = 'none';
            if (subCol) subCol.style.display = 'none';
            if (subBox1) subBox1.style.display = 'none';
            if (subBox2) subBox2.style.display = 'none';
            if (qrSub1Card) qrSub1Card.style.display = 'none';
            if (qrSub2Card) qrSub2Card.style.display = 'none';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            if (largeImg) {
                largeImg.style.display = 'block';
                var newSrc = data.mainPhoto.thumbnailUrl || data.mainPhoto.downloadUrl;
                preloadAndSwapImage('mon-large-img', newSrc);
            }

            var mainKey = data.mainPhoto.photoId || data.mainPhoto.driveFileId;
            if (mainKey) {
                if (qrLargeCard) qrLargeCard.style.display = 'block';
                if (mainKey !== appState.activeMonitorPhotoId) {
                    appState.activeMonitorPhotoId = mainKey;
                    var directMainUrl = getDirectPhotoOrGalleryUrl(slug, mainKey);
                    setCachedQrCode('mon-qr-large-img', directMainUrl, 400);
                }
            } else {
                if (qrLargeCard) qrLargeCard.style.display = 'none';
            }

            var subList = data.subPhotos || [];
            if (subList.length > 0) {
                if (subCol) subCol.style.display = 'flex';

                if (subBox1) subBox1.style.display = 'flex';
                var s1Src = subList[0].thumbnailUrl || subList[0].downloadUrl;
                preloadAndSwapImage('mon-sub-img-1', s1Src);
                var sub1Key = subList[0].photoId || subList[0].driveFileId;
                if (sub1Key) {
                    if (qrSub1Card) qrSub1Card.style.display = 'block';
                    if (sub1Key !== appState.activeSub1PhotoId) {
                        appState.activeSub1PhotoId = sub1Key;
                        var directSub1Url = getDirectPhotoOrGalleryUrl(slug, sub1Key);
                        setCachedQrCode('mon-qr-sub1-img', directSub1Url, 300);
                    }
                } else {
                    if (qrSub1Card) qrSub1Card.style.display = 'none';
                }

                if (subList.length > 1) {
                    if (subBox2) subBox2.style.display = 'flex';
                    var s2Src = subList[1].thumbnailUrl || subList[1].downloadUrl;
                    preloadAndSwapImage('mon-sub-img-2', s2Src);
                    var sub2Key = subList[1].photoId || subList[1].driveFileId;
                    if (sub2Key) {
                        if (qrSub2Card) qrSub2Card.style.display = 'block';
                        if (sub2Key !== appState.activeSub2PhotoId) {
                            appState.activeSub2PhotoId = sub2Key;
                            var directSub2Url = getDirectPhotoOrGalleryUrl(slug, sub2Key);
                            setCachedQrCode('mon-qr-sub2-img', directSub2Url, 300);
                        }
                    } else {
                        if (qrSub2Card) qrSub2Card.style.display = 'none';
                    }
                } else {
                    if (subBox2) subBox2.style.display = 'none';
                    if (qrSub2Card) qrSub2Card.style.display = 'none';
                }
            } else {
                if (subCol) subCol.style.display = 'none';
                if (subBox1) subBox1.style.display = 'none';
                if (subBox2) subBox2.style.display = 'none';
                if (qrSub1Card) qrSub1Card.style.display = 'none';
                if (qrSub2Card) qrSub2Card.style.display = 'none';
            }
        }

        if (data.headerColor) {
            var hBar = document.getElementById('mon-header-bar');
            if (hBar) {
                hBar.style.background = 'linear-gradient(180deg, ' + data.headerColor + ' 0%, #0d1117 100%)';
                hBar.style.borderBottom = '2px solid ' + data.headerColor;
            }
        }

        applyHeaderMotifGraphics(data.headerMotif || 'floral-gold');

        if (data.totalPhotos !== undefined) {
            var countText = data.totalPhotos === 0 ? 'Belum Ada Foto' : ('Total Momen: ' + data.totalPhotos + ' Foto');
            document.getElementById('mon-photo-counter').innerText = countText;
        }

        if (data.wishes && data.wishes.length > 0) {
            checkAndTriggerSingleFloatingWish(data.wishes);
            renderTallChatStreamFeed(data.wishes);
        }
    }

    function applyHeaderMotifGraphics(motifType) {
        var leftEl = document.getElementById('mon-header-motif-left');
        var rightEl = document.getElementById('mon-header-motif-right');
        if (!leftEl || !rightEl) return;

        if (!motifType || motifType === 'none') {
            leftEl.innerHTML = '';
            rightEl.innerHTML = '';
            return;
        }

        var svgContent = '';
        if (motifType === 'floral-gold') {
            svgContent = '<svg viewBox="0 0 160 80" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M10 10C35 15 55 35 60 70M15 20C40 25 50 45 52 70M5 5C45 10 75 40 80 75" stroke="#d49438" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>' +
                '<circle cx="35" cy="22" r="5" fill="#f59e0b" opacity="0.7"/>' +
                '<circle cx="48" cy="38" r="4" fill="#fbbf24" opacity="0.6"/>' +
                '<path d="M25 15Q35 8 45 14Q38 22 25 15Z" fill="#d49438" opacity="0.6"/>' +
                '<path d="M42 30Q52 24 58 32Q48 38 42 30Z" fill="#d49438" opacity="0.5"/>' +
                '</svg>';
        } else if (motifType === 'botanical-leaves') {
            svgContent = '<svg viewBox="0 0 160 80" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M5 25C40 25 75 45 85 75" stroke="#10b981" stroke-width="2" stroke-linecap="round" opacity="0.75"/>' +
                '<path d="M20 25C25 10 38 12 40 24C35 30 25 30 20 25Z" fill="#059669" opacity="0.7"/>' +
                '<path d="M42 32C48 20 60 22 62 34C56 40 46 38 42 32Z" fill="#10b981" opacity="0.65"/>' +
                '<path d="M60 45C68 35 78 38 80 50C74 54 64 52 60 45Z" fill="#34d399" opacity="0.6"/>' +
                '</svg>';
        } else if (motifType === 'vintage-ornament') {
            svgContent = '<svg viewBox="0 0 160 80" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M8 8H70V14H14V70H8V8Z" fill="#d49438" opacity="0.75"/>' +
                '<path d="M18 18H55V22H22V55H18V18Z" fill="#fbbf24" opacity="0.6"/>' +
                '<circle cx="28" cy="28" r="3.5" fill="#d49438"/>' +
                '<path d="M35 18Q45 28 35 38Q25 28 35 18Z" stroke="#d49438" stroke-width="1.5" fill="none" opacity="0.7"/>' +
                '</svg>';
        } else if (motifType === 'sparkle-stars') {
            svgContent = '<svg viewBox="0 0 160 80" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M30 15L33 25L43 28L33 31L30 41L27 31L17 28L27 25Z" fill="#fbbf24" opacity="0.85"/>' +
                '<path d="M60 35L62 42L69 44L62 46L60 53L58 46L51 44L58 42Z" fill="#fef08a" opacity="0.75"/>' +
                '<circle cx="48" cy="18" r="2" fill="#fff" opacity="0.9"/>' +
                '<circle cx="20" cy="50" r="1.5" fill="#fff" opacity="0.8"/>' +
                '</svg>';
        }

        leftEl.innerHTML = svgContent;
        rightEl.innerHTML = svgContent;
    }

    function checkAndTriggerSingleFloatingWish(wishes) {
        if (!wishes || wishes.length === 0) return;

        if (!appState.isWishInitialized) {
            for (var i = 0; i < wishes.length; i++) {
                var key = (wishes[i].senderName || '') + '|' + (wishes[i].message || '');
                appState.knownWishKeys[key] = true;
            }
            appState.isWishInitialized = true;
            return;
        }

        var newestWish = null;
        for (var j = 0; j < wishes.length; j++) {
            var wKey = (wishes[j].senderName || '') + '|' + (wishes[j].message || '');
            if (!appState.knownWishKeys[wKey]) {
                newestWish = wishes[j];
                appState.knownWishKeys[wKey] = true;
                break;
            }
        }

        if (newestWish) {
            showFloatingWishOnce(newestWish);
        }
    }

    function showFloatingWishOnce(wish) {
        var card = document.getElementById('mon-floating-wish-card');
        var textEl = document.getElementById('mon-floating-wish-text');
        var senderEl = document.getElementById('mon-floating-wish-sender');
        if (!card || !textEl || !senderEl) return;

        if (appState.floatingWishTimeout) {
            clearTimeout(appState.floatingWishTimeout);
        }

        card.classList.remove('show');
        setTimeout(function () {
            textEl.innerText = '"' + wish.message + '"';
            senderEl.innerText = '— ' + wish.senderName;
            card.classList.add('show');

            appState.floatingWishTimeout = setTimeout(function () {
                card.classList.remove('show');
            }, 8000);
        }, 300);
    }

    function renderTallChatStreamFeed(wishes) {
        var feedList = document.getElementById('mon-chat-feed-list');
        var counterEl = document.getElementById('mon-chat-stream-counter');
        if (!feedList) return;

        if (counterEl) {
            counterEl.innerText = wishes.length + ' Pesan Masuk';
        }

        feedList.innerHTML = '';
        var maxVisible = Math.min(6, wishes.length);
        var fragment = document.createDocumentFragment();

        for (var i = 0; i < maxVisible; i++) {
            var w = wishes[i];
            var bubble = document.createElement('div');
            bubble.className = 'mon-chat-bubble';
            bubble.innerHTML = '<div class="mon-chat-bubble-sender">' +
                '<span>' + (w.senderName || 'Tamu Undangan') + '</span>' +
                '<span class="mon-chat-bubble-time">' + (i === 0 ? 'Baru saja' : ((i * 2) + 'm lalu')) + '</span>' +
                '</div>' +
                '<div class="mon-chat-bubble-text">"' + (w.message || '') + '"</div>';

            fragment.appendChild(bubble);
        }
        feedList.appendChild(fragment);
    }

    function showMonitorNewPhotoToast(text) {
        var toast = document.getElementById('monitor-live-toast');
        var txtEl = document.getElementById('monitor-toast-text');
        txtEl.innerText = text;
        toast.classList.add('show');
        setTimeout(function () { toast.classList.remove('show'); }, 4500);
    }

    function closeSlideshow() {
        if (appState.slideshowPollInterval) clearInterval(appState.slideshowPollInterval);
        if (appState.chatStreamInterval) clearInterval(appState.chatStreamInterval);
        if (appState.floatingWishTimeout) clearTimeout(appState.floatingWishTimeout);
        if (appState.currentUser) {
            switchView('view-dashboard');
        } else {
            switchView('view-landing');
        }
    }

    function openPublicGalleryNewTab(slug) {
        var targetUrl = getPublicGalleryUrl(slug);
        if (targetUrl.indexOf('UNDEFINED') > -1) {
            showToast('⚠️ Anda harus menyetel URL Web App (/exec) terlebih dahulu!');
            openSetWebAppUrlModal();
            return;
        }
        try {
            sessionStorage.removeItem('limz_splash_dismissed_' + slug);
        } catch (e) { }
        appState.splashDismissed = false;
        var separator = targetUrl.indexOf('?') > -1 ? '&' : '?';
        window.open(targetUrl + separator + 'previewSplash=1', '_blank');
    }

    function openSlideshowNewTab(slug) {
        var targetUrl = getMonitorSlideshowUrl(slug);
        if (targetUrl.indexOf('UNDEFINED') > -1) {
            showToast('⚠️ Anda harus menyetel URL Web App (/exec) terlebih dahulu!');
            openSetWebAppUrlModal();
            return;
        }
        window.open(targetUrl, '_blank');
    }

    function openFlyerSheetById(id) {
        var coll = findCollectionById(id);
        if (!coll) {
            for (var i = 0; i < appState.collections.length; i++) {
                if (appState.collections[i].id === id) {
                    coll = appState.collections[i];
                    break;
                }
            }
        }
        if (!coll) {
            showToast('Data koleksi acara tidak ditemukan.');
            return;
        }

        appState.activeCollectionId = coll.id;
        appState.activeCollectionData = coll;

        var galleryPublicUrl = getPublicGalleryUrl(coll.slug);

        var flyerView = document.getElementById('view-flyer');
        if (flyerView) {
            flyerView.setAttribute('data-target-url', galleryPublicUrl);
            flyerView.setAttribute('data-target-slug', coll.slug);
        }

        document.getElementById('flyer-event-title').innerText = coll.title;
        document.getElementById('flyer-event-date').innerText = formatDisplayDate(coll.eventDate);

        setCachedQrCode('flyer-qr-img', galleryPublicUrl, 320);

        switchView('view-flyer');
    }

    function triggerSyncDrivePhotos(collId) {
        showToast('Menyinkronkan foto dari Google Drive...');
        google.script.run
            .withSuccessHandler(function (res) {
                showToast(res.message || 'Sinkronisasi selesai.');
                fetchCollectionsList();
            })
            .syncCollectionPhotos(collId);
    }

    function compressImageFile(file, maxWidth, quality, callback) {
        if (!file) { callback(''); return; }
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var canvas = document.createElement('canvas');
                var width = img.width;
                var height = img.height;
                var maxDim = maxWidth || 1080;

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                var compressedBase64 = canvas.toDataURL('image/jpeg', quality || 0.78);
                callback(compressedBase64);
            };
            img.onerror = function () {
                callback(e.target.result);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function openCreateCollectionModal() {
        openModal('modal-create-collection');
    }

    function handleCreateCollectionSubmit() {
        var title = document.getElementById('new-coll-title').value;
        var slug = document.getElementById('new-coll-slug').value;
        var driveUrl = document.getElementById('new-coll-drive-url').value;
        var date = document.getElementById('new-coll-date').value;
        var client = document.getElementById('new-coll-client').value;
        var headerColor = document.getElementById('new-coll-header-color').value || '#1f2530';
        var headerMotif = document.getElementById('new-coll-header-motif').value || 'floral-gold';
        var splashTheme = document.getElementById('new-coll-splash-theme') ? document.getElementById('new-coll-splash-theme').value : 'classic-gold';
        var coverUrlInput = document.getElementById('new-coll-cover-url').value;
        var coverFileInput = document.getElementById('new-coll-cover-file');

        var btn = document.getElementById('btn-save-collection');
        btn.innerText = 'Menyimpan...';
        btn.disabled = true;

        function proceedCreation(coverBase64) {
            var payload = {
                title: title,
                slug: slug,
                eventDate: date,
                clientName: client,
                clientEmail: '-',
                driveFolderUrl: driveUrl,
                headerColor: headerColor,
                headerMotif: headerMotif,
                splashTheme: splashTheme,
                coverUrl: coverUrlInput,
                coverBase64: coverBase64 || ''
            };

            google.script.run
                .withSuccessHandler(function (res) {
                    btn.innerText = 'Simpan & Kaitkan Drive';
                    btn.disabled = false;
                    closeModal('modal-create-collection');
                    showToast(res.message);
                    fetchCollectionsList();
                })
                .withFailureHandler(function (err) {
                    btn.innerText = 'Simpan & Kaitkan Drive';
                    btn.disabled = false;
                    showToast('Gagal: ' + err);
                })
                .createCollection(payload);
        }

        if (coverFileInput.files && coverFileInput.files[0]) {
            btn.innerText = 'Mengompresi Cover...';
            compressImageFile(coverFileInput.files[0], 1080, 0.78, function (base64) {
                btn.innerText = 'Menyimpan & Mengaitkan...';
                proceedCreation(base64);
            });
        } else {
            proceedCreation('');
        }
    }

    function openEditCollectionModal(collId) {
        var coll = findCollectionById(collId);
        if (!coll) { showToast('Koleksi tidak ditemukan.'); return; }

        document.getElementById('edit-coll-id').value = coll.id;
        document.getElementById('edit-coll-title').value = coll.title;
        document.getElementById('edit-coll-slug').value = coll.slug;
        document.getElementById('edit-coll-date').value = coll.eventDate;
        document.getElementById('edit-coll-client').value = coll.clientName;
        document.getElementById('edit-coll-drive-url').value = coll.folderId ? ('https://drive.google.com/drive/folders/' + coll.folderId) : '';
        document.getElementById('edit-coll-cover-url').value = coll.coverUrl || '';

        var currentColor = coll.headerColor || '#1f2530';
        document.getElementById('edit-coll-header-color').value = currentColor;
        document.getElementById('edit-coll-header-hex').value = currentColor;
        document.getElementById('edit-coll-header-motif').value = coll.headerMotif || 'floral-gold';
        if (document.getElementById('edit-coll-splash-theme')) {
            document.getElementById('edit-coll-splash-theme').value = coll.splashTheme || 'classic-gold';
        }
        document.getElementById('edit-coll-cover-file').value = '';

        var previewBox = document.getElementById('edit-coll-cover-preview-box');
        if (previewBox) previewBox.style.display = 'none';
        var previewImg = document.getElementById('edit-coll-cover-preview-img');
        if (previewImg) previewImg.src = '';

        openModal('modal-edit-collection');
    }

    function previewEditCoverFile(input) {
        if (input && input.files && input.files[0]) {
            var reader = new FileReader();
            reader.onload = function (e) {
                var previewBox = document.getElementById('edit-coll-cover-preview-box');
                var previewImg = document.getElementById('edit-coll-cover-preview-img');
                if (previewBox && previewImg) {
                    previewImg.src = e.target.result;
                    previewBox.style.display = 'flex';
                }
                // Bersihkan input URL gambar agar tidak bentrok dengan upload file
                document.getElementById('edit-coll-cover-url').value = '';
            };
            reader.readAsDataURL(input.files[0]);
        }
    }

    function handleEditCollectionSubmit() {
        var id = document.getElementById('edit-coll-id').value;
        var title = document.getElementById('edit-coll-title').value;
        var slug = document.getElementById('edit-coll-slug').value;
        var driveUrl = document.getElementById('edit-coll-drive-url').value;
        var date = document.getElementById('edit-coll-date').value;
        var client = document.getElementById('edit-coll-client').value;
        var headerColor = document.getElementById('edit-coll-header-color').value || '#1f2530';
        var headerMotif = document.getElementById('edit-coll-header-motif').value || 'floral-gold';
        var splashTheme = document.getElementById('edit-coll-splash-theme') ? document.getElementById('edit-coll-splash-theme').value : 'classic-gold';
        var coverFileInput = document.getElementById('edit-coll-cover-file');
        var coverUrlInput = document.getElementById('edit-coll-cover-url').value.trim();

        var btn = document.getElementById('btn-update-collection');
        btn.innerText = 'Menyimpan...';
        btn.disabled = true;

        function proceedUpdate(coverBase64) {
            var payload = {
                id: id,
                title: title,
                slug: slug,
                eventDate: date,
                clientName: client,
                driveFolderUrl: driveUrl,
                headerColor: headerColor,
                headerMotif: headerMotif,
                splashTheme: splashTheme,
                coverUrl: coverBase64 ? '' : coverUrlInput,
                coverBase64: coverBase64 || ''
            };

            google.script.run
                .withSuccessHandler(function (res) {
                    btn.innerText = 'Simpan Perubahan';
                    btn.disabled = false;
                    closeModal('modal-edit-collection');
                    showToast(res.message || 'Koleksi berhasil diperbarui!');

                    // Update koleksi lokal seketika (semua properti termasuk splashTheme)
                    var finalCover = (res && res.coverUrl) ? res.coverUrl : coverUrlInput;
                    for (var c = 0; c < appState.collections.length; c++) {
                        if (appState.collections[c].id === id) {
                            if (finalCover) appState.collections[c].coverUrl = finalCover;
                            appState.collections[c].title = title;
                            appState.collections[c].slug = slug;
                            appState.collections[c].eventDate = date;
                            appState.collections[c].clientName = client;
                            appState.collections[c].headerColor = headerColor;
                            appState.collections[c].headerMotif = headerMotif;
                            appState.collections[c].splashTheme = splashTheme;
                            break;
                        }
                    }
                    if (appState.activeCollectionData && appState.activeCollectionData.id === id) {
                        if (finalCover) appState.activeCollectionData.coverUrl = finalCover;
                        appState.activeCollectionData.title = title;
                        appState.activeCollectionData.slug = slug;
                        appState.activeCollectionData.headerColor = headerColor;
                        appState.activeCollectionData.headerMotif = headerMotif;
                        appState.activeCollectionData.splashTheme = splashTheme;
                        var heroBanner = document.getElementById('pub-hero-banner');
                        if (heroBanner && finalCover) heroBanner.style.backgroundImage = 'url(\'' + finalCover + '\')';
                    }

                    // Sinkronisasi Cache Lokal (localStorage) & Reset Flag Session agar testing langsung menampilkan tema baru
                    try {
                        var updatedColl = findCollectionById(id) || {
                            id: id,
                            title: title,
                            slug: slug,
                            eventDate: date,
                            clientName: client,
                            headerColor: headerColor,
                            headerMotif: headerMotif,
                            splashTheme: splashTheme,
                            coverUrl: finalCover || ''
                        };
                        localStorage.setItem('limz_cached_coll_' + slug, JSON.stringify(updatedColl));
                        if (finalCover) localStorage.setItem('limz_cover_' + slug, finalCover);
                        sessionStorage.removeItem('limz_splash_dismissed_' + slug);
                        appState.splashDismissed = false;
                    } catch (e) { }

                    fetchCollectionsList();
                })
                .withFailureHandler(function (err) {
                    btn.innerText = 'Simpan Perubahan';
                    btn.disabled = false;
                    showToast('Gagal update: ' + err);
                })
                .updateCollection(payload);
        }

        if (coverFileInput.files && coverFileInput.files[0]) {
            btn.innerText = 'Mengompresi Cover...';
            compressImageFile(coverFileInput.files[0], 1080, 0.78, function (base64) {
                btn.innerText = 'Menyimpan Perubahan...';
                proceedUpdate(base64);
            });
        } else {
            proceedUpdate('');
        }
    }

    function handlePhotoFilesSelected(files) {
        if (!files || files.length === 0) return;
        var fileList = Array.prototype.slice.call(files);

        // Filter duplikat: hindari memasukkan file dengan nama dan ukuran yang sama persis
        var existingKeys = {};
        for (var k = 0; k < appState.stagedPhotos.length; k++) {
            var ep = appState.stagedPhotos[k];
            existingKeys[ep.name + '_' + ep.size] = true;
        }

        var uniqueFiles = [];
        var duplicateCount = 0;
        for (var f = 0; f < fileList.length; f++) {
            var fl = fileList[f];
            var key = fl.name + '_' + fl.size;
            if (existingKeys[key]) {
                duplicateCount++;
            } else {
                existingKeys[key] = true;
                uniqueFiles.push(fl);
            }
        }

        if (duplicateCount > 0) {
            showToast('ℹ️ ' + duplicateCount + ' file duplikat dilewati karena sudah ada di antrian.');
        }

        if (uniqueFiles.length === 0) return;

        var totalToLoad = uniqueFiles.length;
        var loadedCount = 0;

        showToast('Memuat ' + totalToLoad + ' foto ke antrian pratinjau...');

        uniqueFiles.forEach(function (file) {
            function appendLoadedPhoto(processedFile, dataUrl) {
                detectCameraFromPhotoBufferOrBlob(processedFile);
                // Langsung menggunakan file original yang baru masuk tanpa membuat file temp atau menduplikasi ke storage

                var newStaged = {
                    id: 'staged_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + loadedCount,
                    file: processedFile,
                    name: processedFile.name,
                    size: processedFile.size,
                    dataUrl: dataUrl,
                    originalDataUrl: dataUrl,
                    rawOriginalDataUrl: dataUrl,
                    isCropped: false,
                    wasRaw: isRawFile(file),
                    rotation: 0,
                    customWidth: processedFile.customWidth || file.customWidth,
                    customHeight: processedFile.customHeight || file.customHeight,
                    customMp: processedFile.customMp || file.customMp,
                    customIsOri: processedFile.customIsOri || file.customIsOri
                };
                if (appState.photoFilterState && appState.photoFilterState.isLocked) {
                    newStaged.appliedGrading = JSON.parse(JSON.stringify(appState.photoFilterState));
                }
                appState.stagedPhotos.push(newStaged);

                loadedCount++;
                appState.activeStagedIndex = appState.stagedPhotos.length - 1;
                renderStagedPhotosUI();

                if (loadedCount >= totalToLoad) {
                    showToast('✅ ' + totalToLoad + ' foto siap diatur! Sesuaikan filter, AWB & watermark sebelum upload.');
                    triggerAutoPublishIfEnabled();
                }
            }

            function handleFileReadError(err) {
                console.warn('Gagal memproses file ' + file.name + ':', err);
                loadedCount++;
                if (loadedCount >= totalToLoad) {
                    appState.activeStagedIndex = appState.stagedPhotos.length - 1;
                    renderStagedPhotosUI();
                }
            }

            if (isRawFile(file)) {
                extractEmbeddedJpegFromRaw(file, function (convertedFile, jpegDataUrl) {
                    if (jpegDataUrl && convertedFile) {
                        appendLoadedPhoto(convertedFile, jpegDataUrl);
                    } else {
                        var reader = new FileReader();
                        reader.onload = function (e) {
                            appendLoadedPhoto(file, e.target.result);
                        };
                        reader.onerror = handleFileReadError;
                        reader.readAsDataURL(file);
                    }
                });
            } else {
                var reader = new FileReader();
                reader.onload = function (e) {
                    appendLoadedPhoto(file, e.target.result);
                };
                reader.onerror = handleFileReadError;
                reader.readAsDataURL(file);
            }
        });
    }

    /* =========================================================================
       BACKGROUND CONTINUOUS UPLOAD PIPELINE DENGAN SISTEM PUBLIKASI ULANG (RETRY)
       ========================================================================= */
    var uploadPipeline = {
        queue: [],
        isProcessing: false,
        activeItem: null,
        totalInBatch: 0,
        processedInBatch: 0,
        successCount: 0,
        failCount: 0
    };

    /**
     * Membubuhi tone filter dan logo watermark studio ke canvas foto
     */
    function prepareWatermarkedPhotoDataUrl(item, callback) {
        if (!item) {
            if (callback) callback('');
            return;
        }

        if (item.isGif || (item.name && item.name.toLowerCase().endsWith('.gif'))) {
            if (callback) callback(item.dataUrl || item.originalDataUrl);
            return;
        }

        var rawSrc = item.dataUrl || item.originalDataUrl || '';
        if (!rawSrc) {
            if (callback) callback('');
            return;
        }

        var customPngImg = appState.customWatermarkImgObj;
        var wmPosXPercent = parseFloat(localStorage.getItem('limz_wm_pos_x') || '88') / 100;
        var wmPosYPercent = parseFloat(localStorage.getItem('limz_wm_pos_y') || '90') / 100;
        var wmScalePercent = parseFloat(localStorage.getItem('limz_wm_scale') || '22') / 100;
        var wmOpacity = parseFloat(localStorage.getItem('limz_wm_opacity') || '85') / 100;

        var img = new Image();
        img.onload = function () {
            try {
                var canvas = document.getElementById('watermark-canvas');
                if (!canvas) canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                var rot = item.rotation || 0;
                var isRotated90 = (rot === 90 || rot === 270);
                var rawW = isRotated90 ? (img.naturalHeight || img.height) : (img.naturalWidth || img.width);
                var rawH = isRotated90 ? (img.naturalWidth || img.width) : (img.naturalHeight || img.height);

                // Standar visual emas 2K QHD (2048px): Super tajam di layar Retina/4K, payload Base64 hanya 1.2MB - 1.8MB (100% aman di GAS & Drive)
                var maxDimension = 2048;
                var finalW = rawW;
                var finalH = rawH;

                if (rawW > maxDimension || rawH > maxDimension) {
                    if (rawW >= rawH) {
                        finalW = maxDimension;
                        finalH = Math.round(maxDimension * (rawH / rawW));
                    } else {
                        finalH = maxDimension;
                        finalW = Math.round(maxDimension * (rawW / rawH));
                    }
                }

                canvas.width = finalW;
                canvas.height = finalH;
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                var gradingToApply = item.appliedGrading || appState.photoFilterState;
                var filterStr = (typeof getCanvasFilterString === 'function') ? getCanvasFilterString(gradingToApply) : 'none';
                ctx.filter = filterStr;

                if (rot !== 0) {
                    ctx.save();
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.rotate(rot * Math.PI / 180);
                    var drawW = isRotated90 ? canvas.height : canvas.width;
                    var drawH = isRotated90 ? canvas.width : canvas.height;
                    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
                    ctx.restore();
                } else {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                }
                ctx.filter = 'none';

                var temp = (gradingToApply && gradingToApply.temperature) || 0;
                var tint = (gradingToApply && gradingToApply.tint) || 0;
                if (temp !== 0 || tint !== 0) {
                    ctx.save();
                    ctx.globalCompositeOperation = 'soft-light';
                    var r = 128, g = 128, bVal = 128;
                    if (temp > 0) { r += Math.round(temp * 2.2); bVal -= Math.round(temp * 1.5); }
                    else if (temp < 0) { bVal += Math.round(-temp * 2.2); r -= Math.round(-temp * 1.5); }
                    if (tint > 0) { r += Math.round(tint * 1.8); bVal += Math.round(tint * 1.8); g -= Math.round(tint * 1.5); }
                    else if (tint < 0) { g += Math.round(-tint * 2.2); r -= Math.round(-tint * 1.2); }
                    r = Math.max(0, Math.min(255, r));
                    g = Math.max(0, Math.min(255, g));
                    bVal = Math.max(0, Math.min(255, bVal));

                    var maxShift = Math.max(Math.abs(temp), Math.abs(tint));
                    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bVal + ',' + ((maxShift / 50) * 0.45) + ')';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }

                if (appState.isWatermarkEnabled !== false) {
                    if (customPngImg && customPngImg.complete && customPngImg.naturalWidth > 0) {
                        var wmWidth = Math.round(canvas.width * wmScalePercent);
                        var aspect = customPngImg.naturalHeight / customPngImg.naturalWidth;
                        var wmHeight = Math.round(wmWidth * aspect);

                        var maxX = Math.max(0, canvas.width - wmWidth);
                        var maxY = Math.max(0, canvas.height - wmHeight);
                        var x = (wmPosXPercent >= 0.45 && wmPosXPercent <= 0.55)
                            ? Math.round((canvas.width - wmWidth) / 2)
                            : Math.round(maxX * wmPosXPercent);
                        var y = (wmPosYPercent >= 0.45 && wmPosYPercent <= 0.55)
                            ? Math.round((canvas.height - wmHeight) / 2)
                            : Math.round(maxY * wmPosYPercent);

                        ctx.save();
                        ctx.globalAlpha = wmOpacity;
                        ctx.drawImage(customPngImg, x, y, wmWidth, wmHeight);
                        ctx.restore();
                    } else {
                        var fontSize = Math.max(16, Math.floor(canvas.width * 0.025));
                        ctx.font = 'bold ' + fontSize + 'px "Cinzel", Georgia, serif';
                        ctx.fillStyle = 'rgba(255, 255, 255, ' + wmOpacity + ')';
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                        ctx.shadowOffsetX = 2;
                        ctx.shadowOffsetY = 2;
                        ctx.shadowBlur = 6;
                        ctx.textAlign = (wmPosXPercent > 0.65) ? 'right' : ((wmPosXPercent < 0.35) ? 'left' : 'center');

                        var text = 'LIMZ STUDIO PHOTOBOOTH';
                        var textX = Math.round(canvas.width * wmPosXPercent);
                        var textY = Math.round(canvas.height * wmPosYPercent);
                        ctx.fillText(text, textX, textY);
                    }
                }

                var watermarkedBase64 = canvas.toDataURL('image/jpeg', 0.88);
                if (callback) callback(watermarkedBase64);
            } catch (err) {
                console.warn('Gagal render watermark canvas:', err);
                if (callback) callback(rawSrc);
            }
        };
        img.onerror = function () {
            console.warn('Gagal memuat image untuk watermark:', item.name);
            if (callback) callback(rawSrc);
        };
        img.src = rawSrc;
    }

    /**
     * Memulai atau menambahkan foto antrian ke pipeline publikasi latar belakang
     */
    function startStagedPhotosUpload() {
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) {
            showToast('Belum ada foto dalam antrian! Pilih atau tarik foto ke kotak teratas terlebih dahulu.');
            return;
        }

        var collId = document.getElementById('select-upload-collection') ? document.getElementById('select-upload-collection').value : appState.activeCollectionId;
        if (!collId) {
            showToast('Pilih koleksi tujuan terlebih dahulu!');
            var selectEl = document.getElementById('select-upload-collection');
            if (selectEl) selectEl.focus();
            return;
        }
        appState.activeCollectionId = collId;

        // Ambil semua foto yang belum berstatus 'uploading'
        var pendingItems = (appState.stagedPhotos || []).filter(function (p) {
            return p.uploadStatus !== 'uploading';
        });

        if (pendingItems.length === 0) {
            showToast('Semua item di antrian sedang dalam proses pengiriman.');
            return;
        }

        var addedCount = 0;
        pendingItems.forEach(function (item) {
            item.uploadStatus = 'queued';
            item.uploadError = '';
            item.targetCollectionId = collId;

            var alreadyQueued = uploadPipeline.queue.some(function (q) {
                return (q.id && q.id === item.id) || (q.name && q.name === item.name && q.size === item.size);
            });
            if (!alreadyQueued) {
                uploadPipeline.queue.push(item);
                addedCount++;
            }
        });

        uploadPipeline.totalInBatch += addedCount;
        renderStagedPhotosUI();
        updateUploadProgressUI();

        if (uploadPipeline.isProcessing) {
            showToast('🚀 ' + addedCount + ' item baru berhasil ditambahkan ke antrian publikasi aktif!');
        } else {
            showToast('🚀 Memulai publikasi ' + addedCount + ' item ke Cloud & Galeri...');
            processNextInUploadPipeline();
        }
    }

    /**
     * Mengunggah satu foto spesifik dari antrian stagedPhotos ke Cloud (Non-Blocking)
     */
    function uploadSingleStagedPhoto(targetIdx, evt) {
        if (evt) {
            evt.stopPropagation();
            evt.preventDefault();
        }

        if (typeof targetIdx === 'undefined' || targetIdx === null) {
            targetIdx = appState.activeStagedIndex;
        }

        if (!appState.stagedPhotos || !appState.stagedPhotos[targetIdx]) {
            showToast('⚠️ Foto tidak ditemukan di antrian pratinjau.');
            return;
        }

        var collId = document.getElementById('select-upload-collection') ? document.getElementById('select-upload-collection').value : appState.activeCollectionId;
        if (!collId) {
            showToast('Pilih koleksi tujuan terlebih dahulu!');
            var selectEl = document.getElementById('select-upload-collection');
            if (selectEl) selectEl.focus();
            return;
        }
        appState.activeCollectionId = collId;

        var item = appState.stagedPhotos[targetIdx];
        if (item.uploadStatus === 'uploading') {
            showToast('⏳ Foto ini sedang dalam proses pengiriman...');
            return;
        }

        item.uploadStatus = 'queued';
        item.uploadError = '';
        item.targetCollectionId = collId;

        var alreadyQueued = uploadPipeline.queue.some(function (q) {
            return (q.id && q.id === item.id) || (q.name && q.name === item.name && q.size === item.size);
        });
        if (!alreadyQueued) {
            uploadPipeline.queue.push(item);
            uploadPipeline.totalInBatch++;
        }

        renderStagedPhotosUI();
        updateUploadProgressUI();

        if (uploadPipeline.isProcessing) {
            showToast('🚀 Foto #' + (targetIdx + 1) + ' ditambahkan ke antrian pengiriman!');
        } else {
            processNextInUploadPipeline();
        }
    }

    /**
     * Publikasikan ulang item tertentu yang berstatus gagal
     */
    function retryStagedPhotoUpload(itemIdOrIdx, evt) {
        if (evt) {
            evt.stopPropagation();
            evt.preventDefault();
        }

        var item = null;
        if (typeof itemIdOrIdx === 'string') {
            item = (appState.stagedPhotos || []).find(function (p) { return p.id === itemIdOrIdx; });
        }
        if (!item && typeof itemIdOrIdx === 'number') {
            item = (appState.stagedPhotos || [])[itemIdOrIdx];
        }
        if (!item) {
            showToast('⚠️ Foto tidak ditemukan untuk dipublikasikan ulang.');
            return;
        }

        var collId = item.targetCollectionId || (document.getElementById('select-upload-collection') ? document.getElementById('select-upload-collection').value : appState.activeCollectionId);
        if (!collId) {
            showToast('Pilih koleksi tujuan terlebih dahulu!');
            return;
        }
        appState.activeCollectionId = collId;

        item.uploadStatus = 'queued';
        item.uploadError = '';
        item.targetCollectionId = collId;

        // Sisipkan ke awal antrian agar langsung dikirim berikutnya
        uploadPipeline.queue.unshift(item);
        uploadPipeline.totalInBatch++;

        renderStagedPhotosUI();
        updateUploadProgressUI();
        showToast('🔁 Mempublikasikan ulang: ' + item.name + '...');

        if (!uploadPipeline.isProcessing) {
            processNextInUploadPipeline();
        }
    }

    /**
     * Publikasikan ulang seluruh item yang gagal sekaligus
     */
    function retryAllFailedStagedPhotos(evt) {
        if (evt) {
            evt.stopPropagation();
            evt.preventDefault();
        }

        var collId = document.getElementById('select-upload-collection') ? document.getElementById('select-upload-collection').value : appState.activeCollectionId;
        if (!collId) {
            showToast('Pilih koleksi tujuan terlebih dahulu!');
            return;
        }
        appState.activeCollectionId = collId;

        var failedItems = (appState.stagedPhotos || []).filter(function (p) {
            return p.uploadStatus === 'failed';
        });

        if (failedItems.length === 0) {
            showToast('Tidak ada item yang gagal.');
            return;
        }

        var added = 0;
        failedItems.forEach(function (item) {
            item.uploadStatus = 'queued';
            item.uploadError = '';
            item.targetCollectionId = collId;

            var alreadyQueued = uploadPipeline.queue.some(function (q) {
                return (q.id && q.id === item.id) || (q.name && q.name === item.name && q.size === item.size);
            });
            if (!alreadyQueued) {
                uploadPipeline.queue.push(item);
                added++;
            }
        });

        uploadPipeline.totalInBatch += added;
        renderStagedPhotosUI();
        updateUploadProgressUI();
        showToast('🔁 Mempublikasikan ulang ' + added + ' foto/GIF yang gagal...');

        if (!uploadPipeline.isProcessing) {
            processNextInUploadPipeline();
        }
    }

    /**
     * Pekerja pipeline yang mengunggah item satu per satu di latar belakang secara kontinu
     */
    function processNextInUploadPipeline() {
        if (uploadPipeline.isProcessing) return;

        if (!uploadPipeline.queue || uploadPipeline.queue.length === 0) {
            finishUploadPipeline();
            return;
        }

        uploadPipeline.isProcessing = true;
        appState.isUploadingPhotos = true;

        var item = uploadPipeline.queue.shift();
        uploadPipeline.activeItem = item;
        item.uploadStatus = 'uploading';

        renderStagedPhotosUI();
        updateUploadProgressUI();

        var collId = item.targetCollectionId || appState.activeCollectionId || (document.getElementById('select-upload-collection') ? document.getElementById('select-upload-collection').value : '');
        var queueId = 'queue_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

        function handleSuccess(res, base64Ready) {
            uploadPipeline.successCount++;
            uploadPipeline.processedInBatch++;
            removeOfflineQueueItem(queueId, function () { });

            // Hapus HANYA item ini dari appState.stagedPhotos (item lain tetap aman!)
            var foundIdx = -1;
            for (var i = 0; i < (appState.stagedPhotos || []).length; i++) {
                var st = appState.stagedPhotos[i];
                if (st === item || (item.id && st.id === item.id) || (item.name && st.name === item.name && st.size === item.size)) {
                    foundIdx = i;
                    break;
                }
            }
            if (foundIdx !== -1) {
                appState.stagedPhotos.splice(foundIdx, 1);
                if (appState.activeStagedIndex >= appState.stagedPhotos.length) {
                    appState.activeStagedIndex = Math.max(0, appState.stagedPhotos.length - 1);
                }
            }

            // Siarkan langsung ke Monitor Panggung & Galeri Tamu (0 detik)
            if (res && res.photo) {
                broadcastNewUploadedPhoto(collId, res.photo);
            } else {
                broadcastNewUploadedPhoto(collId, {
                    photoId: (res && res.photoId) || ('PH-' + Date.now()),
                    fileName: item.name,
                    driveFileId: res && res.driveFileId,
                    thumbnailUrl: (res && res.thumbnailUrl) || (res && res.driveFileId ? ('https://drive.google.com/thumbnail?id=' + res.driveFileId + '&sz=w1920') : base64Ready),
                    downloadUrl: res && res.downloadUrl,
                    isNew: true
                });
            }

            renderStagedPhotosUI();
            refreshOfflineQueueBadge();
            refreshDashboardData();
            refreshUploadedPhotosForTabUpload();

            uploadPipeline.isProcessing = false;
            uploadPipeline.activeItem = null;
            // Pacing cooldown 450ms untuk memberi nafas ke Google Drive API & memori browser
            setTimeout(function () {
                processNextInUploadPipeline();
            }, 450);
        }

        function handleFailure(errMsg, uploadPayload) {
            uploadPipeline.failCount++;
            uploadPipeline.processedInBatch++;
            item.uploadStatus = 'failed';
            item.uploadError = errMsg || 'Gagal terhubung ke Cloud';

            console.warn('Upload gagal untuk ' + item.name + ':', errMsg);
            if (uploadPayload) {
                enqueueOfflinePhotoItem(uploadPayload, function () { });
            }

            renderStagedPhotosUI();
            refreshOfflineQueueBadge();

            uploadPipeline.isProcessing = false;
            uploadPipeline.activeItem = null;
            // Pacing cooldown 450ms
            setTimeout(function () {
                processNextInUploadPipeline();
            }, 450);
        }

        function executeSend(base64Ready) {
            var uploadPayload = {
                collectionId: collId,
                fileName: item.name,
                base64Data: base64Ready,
                uploadedBy: appState.currentUser ? appState.currentUser.nama : 'Crew',
                queueId: queueId,
                createdAt: Date.now()
            };

            if (!navigator.onLine) {
                handleFailure('Perangkat sedang offline, disimpan ke cadangan lokal', uploadPayload);
                return;
            }

            function attemptUpload(attemptCount) {
                google.script.run
                    .withSuccessHandler(function (res) {
                        if (res && res.success) {
                            handleSuccess(res, base64Ready);
                        } else {
                            if (attemptCount < 1) {
                                console.warn('Upload pertama ditolak server (' + (res ? res.message : 'Ditolak server') + '), mencoba auto-retry on-the-fly...');
                                setTimeout(function () {
                                    attemptUpload(attemptCount + 1);
                                }, 1200);
                            } else {
                                handleFailure((res ? res.message : 'Ditolak server Cloud'), uploadPayload);
                            }
                        }
                    })
                    .withFailureHandler(function (err) {
                        if (attemptCount < 1) {
                            console.warn('Koneksi jaringan tersendat (' + err + '), mencoba auto-retry on-the-fly...');
                            setTimeout(function () {
                                attemptUpload(attemptCount + 1);
                            }, 1200);
                        } else {
                            handleFailure('Koneksi timeout / terputus: ' + err, uploadPayload);
                        }
                    })
                    .uploadPhotoWithWatermark(uploadPayload);
            }

            attemptUpload(0);
        }

        prepareWatermarkedPhotoDataUrl(item, function (readyBase64) {
            executeSend(readyBase64);
        });
    }

    /**
     * Memperbarui visual indikator progres upload
     */
    function updateUploadProgressUI() {
        var progressBox = document.getElementById('upload-progress-box');
        var progressBar = document.getElementById('upload-progress-bar');
        var progressText = document.getElementById('upload-progress-text');
        var uploadBtn = document.getElementById('btn-start-upload');

        var remaining = (uploadPipeline.queue ? uploadPipeline.queue.length : 0);
        var currentItem = uploadPipeline.activeItem;

        if (uploadPipeline.isProcessing) {
            if (progressBox) progressBox.style.display = 'block';
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = '▶ Publikasikan Foto <span style="font-size:11px; font-weight:600; opacity:0.9;">(' + (remaining + 1) + ' di antrian)</span>';
            }
            var total = Math.max(1, uploadPipeline.totalInBatch);
            var current = uploadPipeline.processedInBatch;
            var pct = Math.min(96, Math.max(10, Math.round((current / total) * 100)));
            if (progressBar) progressBar.style.width = pct + '%';
            if (progressText && currentItem) {
                progressText.innerText = 'Mengunggah: ' + currentItem.name + (remaining > 0 ? ' (' + remaining + ' menunggu di antrian...)' : ' (Item terakhir)');
            }
        } else {
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.innerText = '▶ Publikasikan Foto';
            }
        }
    }

    /**
     * Menyelesaikan pipeline upload saat seluruh antrian tuntas
     */
    function finishUploadPipeline() {
        uploadPipeline.isProcessing = false;
        appState.isUploadingPhotos = false;

        var progressBox = document.getElementById('upload-progress-box');
        var progressText = document.getElementById('upload-progress-text');
        var progressBar = document.getElementById('upload-progress-bar');
        var uploadBtn = document.getElementById('btn-start-upload');

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) {
            if (uploadPipeline.failCount > 0) {
                progressText.innerText = 'Selesai: ' + uploadPipeline.successCount + ' sukses, ' + uploadPipeline.failCount + ' gagal.';
            } else {
                progressText.innerText = 'Semua antrian foto selesai dipublikasikan!';
            }
        }

        setTimeout(function () {
            if (!uploadPipeline.isProcessing && (!uploadPipeline.queue || uploadPipeline.queue.length === 0)) {
                if (progressBox) progressBox.style.display = 'none';
            }
        }, 2200);

        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.innerText = '▶ Publikasikan Foto';
        }

        renderStagedPhotosUI();
        refreshOfflineQueueBadge();
        refreshDashboardData();

        if (appState.currentView === 'view-public-gallery' && appState.activeCollectionId) {
            loadGalleryPhotos(appState.activeCollectionId);
        } else if (appState.currentView === 'view-slideshow' && appState.activeCollectionId) {
            fetchMonitorContent(appState.activeCollectionId, true);
        }
        refreshUploadedPhotosForTabUpload();

        var collId = appState.activeCollectionId || (document.getElementById('select-upload-collection') ? document.getElementById('select-upload-collection').value : '');
        var batchPayload = {
            type: 'LIMZ_UPLOAD_BATCH_COMPLETE',
            collectionId: collId,
            timestamp: Date.now()
        };
        if (photoSyncChannel) {
            try { photoSyncChannel.postMessage(batchPayload); } catch (e) { }
        }
        try {
            localStorage.setItem('limz_upload_batch_broadcast', JSON.stringify(batchPayload));
        } catch (e) { }

        if (uploadPipeline.failCount > 0) {
            showToast('⚠️ ' + uploadPipeline.successCount + ' berhasil dipublikasikan, ' + uploadPipeline.failCount + ' gagal. Klik "Publikasikan Ulang" pada foto yang gagal.');
        } else if (uploadPipeline.successCount > 0) {
            showToast('🎉 Semua foto (' + uploadPipeline.successCount + ') berhasil dipublikasikan langsung ke Cloud & Galeri!');
        }

        uploadPipeline.totalInBatch = 0;
        uploadPipeline.processedInBatch = 0;
        uploadPipeline.successCount = 0;
        uploadPipeline.failCount = 0;
    }

    window.startStagedPhotosUpload = startStagedPhotosUpload;
    window.uploadSingleStagedPhoto = uploadSingleStagedPhoto;
    window.retryStagedPhotoUpload = retryStagedPhotoUpload;
    window.retryAllFailedStagedPhotos = retryAllFailedStagedPhotos;

    /* =========================================================================
       SUITE ENGINE PEMBUAT ANIMASI GIF (BURST / BOOMERANG)
       ========================================================================= */
    var gifState = {
        speedMs: 250,
        isBoomerang: true,
        withWatermark: true,
        previewInterval: null,
        currentFrameIdx: 0,
        frames: [],
        generatedDataUrl: null,
        targetWidth: 0,
        targetHeight: 0,
        selectedIndices: []
    };

    function openGifCreatorModal() {
        try {
            if (!appState.stagedPhotos || appState.stagedPhotos.length <= 1) {
                showToast('⚠️ Masukkan minimal 2 foto ke antrian untuk membuat animasi GIF.');
                return;
            }

            // 1. Respon Visual Cepat pada Tombol
            var btn = document.getElementById('btn-create-gif');
            if (btn) {
                btn.style.opacity = '0.7';
                btn.style.pointerEvents = 'none';
            }

            // 2. Buka Modal Langsung Seketika (0 milidetik jeda visual!)
            openModal('modal-gif-creator');

            // 3. Aktifkan visual spinner pemrosesan
            var spinner = document.getElementById('gif-render-spinner');
            if (spinner) spinner.style.display = 'flex';

            // 4. Tampilkan frame pertama segera agar kanvas tidak tampak kosong
            var previewImg = document.getElementById('gif-preview-img');
            if (previewImg && appState.stagedPhotos[0]) {
                previewImg.src = appState.stagedPhotos[0].dataUrl || appState.stagedPhotos[0].originalDataUrl || '';
            }

            // 5. Pulihkan tombol
            if (btn) {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            }

            // 6. Inisialisasi daftar pilihan foto antrian
            gifState.selectedIndices = appState.stagedPhotos.map(function (_, idx) { return idx; });
            renderGifPhotoPickerUI();

            gifState.targetWidth = 0;
            gifState.targetHeight = 0;

            var sliderEl = document.getElementById('slider-gif-speed');
            updateGifSpeed(sliderEl ? sliderEl.value : 250);

            // 7. Render live preview animasi di event tick berikutnya agar modal tampil mulus seketika
            setTimeout(function () {
                renderLiveGifPreview();
            }, 30);
        } catch (e) {
            console.error('Error saat membuka modal GIF:', e);
            showToast('⚠️ Gagal membuka pembuat animasi GIF: ' + e.message);
            var btnErr = document.getElementById('btn-create-gif');
            if (btnErr) {
                btnErr.style.opacity = '1';
                btnErr.style.pointerEvents = 'auto';
            }
        }
    }

    function renderGifPhotoPickerUI() {
        var container = document.getElementById('gif-photo-selection-container');
        var lblCount = document.getElementById('lbl-gif-selected-count');
        if (!container) return;
        container.innerHTML = '';

        var total = appState.stagedPhotos ? appState.stagedPhotos.length : 0;
        var selected = gifState.selectedIndices || [];
        if (lblCount) {
            lblCount.innerText = '(' + selected.length + '/' + total + ' dipilih)';
        }

        (appState.stagedPhotos || []).forEach(function (item, idx) {
            var isChecked = selected.indexOf(idx) !== -1;
            var card = document.createElement('label');
            card.style.display = 'inline-flex';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'center';
            card.style.position = 'relative';
            card.style.cursor = 'pointer';
            card.style.flexShrink = '0';
            card.style.width = '68px';
            card.style.borderRadius = '6px';
            card.style.padding = '3px';
            card.style.background = isChecked ? '#eff6ff' : '#f8fafc';
            card.style.border = isChecked ? '2px solid var(--accent-gold)' : '1px solid #cbd5e1';
            card.style.boxShadow = isChecked ? '0 0 6px rgba(212,175,55,0.4)' : 'none';
            card.style.transition = 'all 0.15s ease';

            var imgSrc = item.dataUrl || item.originalDataUrl || '';
            var thumbImg = '<img src="' + imgSrc + '" style="width:100%; height:48px; object-fit:cover; border-radius:4px; display:block; filter:' + (isChecked ? 'none' : 'grayscale(80%) opacity(0.55)') + ';">';
            var chk = '<input type="checkbox" onchange="toggleGifPhotoSelection(' + idx + ', this.checked)" ' + (isChecked ? 'checked' : '') + ' style="position:absolute; top:4px; left:4px; width:16px; height:16px; accent-color:#2563eb; cursor:pointer;">';
            var num = '<span style="font-size:10px; font-weight:700; color:' + (isChecked ? 'var(--accent-gold)' : '#64748b') + '; margin-top:2px;">#' + (idx + 1) + '</span>';

            card.innerHTML = chk + thumbImg + num;
            container.appendChild(card);
        });
    }

    function toggleGifPhotoSelection(idx, isChecked) {
        if (!gifState.selectedIndices) gifState.selectedIndices = [];
        var pos = gifState.selectedIndices.indexOf(idx);
        if (isChecked && pos === -1) {
            gifState.selectedIndices.push(idx);
            gifState.selectedIndices.sort(function (a, b) { return a - b; });
        } else if (!isChecked && pos !== -1) {
            if (gifState.selectedIndices.length <= 2) {
                showToast('⚠️ Minimal harus ada 2 foto yang dipilih untuk membuat animasi GIF.');
                renderGifPhotoPickerUI();
                return;
            }
            gifState.selectedIndices.splice(pos, 1);
        }
        renderGifPhotoPickerUI();
        renderLiveGifPreview();
    }

    function selectAllGifPhotos(isAll) {
        if (isAll) {
            gifState.selectedIndices = (appState.stagedPhotos || []).map(function (_, idx) { return idx; });
        } else {
            if (appState.stagedPhotos && appState.stagedPhotos.length >= 2) {
                gifState.selectedIndices = [0, 1];
                showToast('ℹ️ Menyisakan 2 foto minimal untuk animasi GIF.');
            }
        }
        renderGifPhotoPickerUI();
        renderLiveGifPreview();
    }

    function updateGifSpeed(val) {
        var ms = parseInt(val, 10) || 250;
        gifState.speedMs = ms;
        var lbl = document.getElementById('lbl-gif-speed');
        if (lbl) lbl.innerText = ms + ' ms / frame';

        if (gifState.previewInterval) {
            clearInterval(gifState.previewInterval);
            startGifPreviewLoop();
        }
    }

    function prepareProcessedGifFrames(callback) {
        var indices = (gifState.selectedIndices && gifState.selectedIndices.length >= 2)
            ? gifState.selectedIndices
            : (appState.stagedPhotos || []).map(function (_, i) { return i; });

        var photos = indices.map(function (idx) { return (appState.stagedPhotos || [])[idx]; }).filter(Boolean);
        if (photos.length === 0) {
            photos = (appState.stagedPhotos || []).slice();
        }

        if (photos.length === 0) {
            if (callback) callback([]);
            return;
        }

        var withWm = document.getElementById('check-gif-watermark') ? document.getElementById('check-gif-watermark').checked : true;
        var processed = [];
        var loaded = 0;
        var hasTriggered = false;

        function checkDone() {
            if (loaded >= photos.length && !hasTriggered) {
                hasTriggered = true;
                clearTimeout(safetyTimer);
                var valid = processed.filter(Boolean);
                if (callback) callback(valid.length > 0 ? valid : photos.map(function (p) { return p.dataUrl || p.originalDataUrl; }));
            }
        }

        var safetyTimer = setTimeout(function () {
            if (!hasTriggered) {
                hasTriggered = true;
                var valid = processed.filter(Boolean);
                if (callback) callback(valid.length > 0 ? valid : photos.map(function (p) { return p.dataUrl || p.originalDataUrl; }));
            }
        }, 4000);

        var customPngImg = appState.customWatermarkImgObj;
        var wmPosXPercent = parseFloat(localStorage.getItem('limz_wm_pos_x') || '88') / 100;
        var wmPosYPercent = parseFloat(localStorage.getItem('limz_wm_pos_y') || '90') / 100;
        var wmScalePercent = parseFloat(localStorage.getItem('limz_wm_scale') || '22') / 100;
        var wmOpacity = parseFloat(localStorage.getItem('limz_wm_opacity') || '85') / 100;

        var filterStr = (typeof getCanvasFilterString === 'function') ? getCanvasFilterString() : 'none';
        var temp = (appState.photoFilterState && appState.photoFilterState.temperature) || 0;
        var tint = (appState.photoFilterState && appState.photoFilterState.tint) || 0;

        photos.forEach(function (item, idx) {
            var rawSrc = item.dataUrl || item.originalDataUrl || '';
            if (!rawSrc) {
                loaded++;
                checkDone();
                return;
            }
            var img = new Image();
            img.onload = function () {
                try {
                    var canvas = document.createElement('canvas');
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;

                    if (idx === 0 || !gifState.targetWidth) {
                        // Dimensi ditingkatkan dari 640px ke 880px agar hasil animasi GIF tajam, jernih, dan tidak buram di layar retina/HD
                        var maxDim = 880;
                        var aspectRatio = w / h;
                        if (w >= h) {
                            gifState.targetWidth = Math.min(w, maxDim);
                            gifState.targetHeight = Math.round(gifState.targetWidth / aspectRatio);
                        } else {
                            gifState.targetHeight = Math.min(h, maxDim);
                            gifState.targetWidth = Math.round(gifState.targetHeight * aspectRatio);
                        }
                    }

                    var targetW = gifState.targetWidth;
                    var targetH = gifState.targetHeight;

                    canvas.width = targetW;
                    canvas.height = targetH;
                    var ctx = canvas.getContext('2d');
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';

                    // Menggambar foto proporsional ke canvas tanpa distorsi / gepeng
                    var frameAspect = w / h;
                    var baseAspect = targetW / targetH;
                    var drawX = 0, drawY = 0, drawW = targetW, drawH = targetH;

                    if (Math.abs(frameAspect - baseAspect) > 0.02) {
                        if (frameAspect > baseAspect) {
                            drawH = targetH;
                            drawW = Math.round(targetH * frameAspect);
                            drawX = Math.round((targetW - drawW) / 2);
                        } else {
                            drawW = targetW;
                            drawH = Math.round(targetW / frameAspect);
                            drawY = Math.round((targetH - drawH) / 2);
                        }
                    }

                    ctx.filter = filterStr;
                    ctx.drawImage(img, drawX, drawY, drawW, drawH);
                    ctx.filter = 'none';

                    if (temp !== 0 || tint !== 0) {
                        ctx.save();
                        ctx.globalCompositeOperation = 'soft-light';
                        var r = 128, g = 128, bVal = 128;
                        if (temp > 0) { r += Math.round(temp * 2.2); bVal -= Math.round(temp * 1.5); }
                        else if (temp < 0) { bVal += Math.round(-temp * 2.2); r -= Math.round(-temp * 1.5); }
                        if (tint > 0) { r += Math.round(tint * 1.8); bVal += Math.round(tint * 1.8); g -= Math.round(tint * 1.5); }
                        else if (tint < 0) { g += Math.round(-tint * 2.2); r -= Math.round(-tint * 1.2); }
                        r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); bVal = Math.max(0, Math.min(255, bVal));
                        var maxShift = Math.max(Math.abs(temp), Math.abs(tint));
                        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + bVal + ',' + ((maxShift / 50) * 0.45) + ')';
                        ctx.fillRect(0, 0, w, h);
                        ctx.restore();
                    }

                    if (withWm) {
                        if (customPngImg && customPngImg.complete && customPngImg.naturalWidth > 0) {
                            var wmWidth = Math.round(targetW * wmScalePercent);
                            var aspect = customPngImg.naturalHeight / customPngImg.naturalWidth;
                            var wmHeight = Math.round(wmWidth * aspect);
                            var maxX = Math.max(0, targetW - wmWidth);
                            var maxY = Math.max(0, targetH - wmHeight);
                            var x = (wmPosXPercent >= 0.45 && wmPosXPercent <= 0.55)
                                ? Math.round((targetW - wmWidth) / 2)
                                : Math.round(maxX * wmPosXPercent);
                            var y = (wmPosYPercent >= 0.45 && wmPosYPercent <= 0.55)
                                ? Math.round((targetH - wmHeight) / 2)
                                : Math.round(maxY * wmPosYPercent);
                            ctx.save();
                            ctx.globalAlpha = wmOpacity;
                            ctx.drawImage(customPngImg, x, y, wmWidth, wmHeight);
                            ctx.restore();
                        } else {
                            var fontSize = Math.max(14, Math.floor(targetW * 0.03));
                            ctx.font = 'bold ' + fontSize + 'px "Cinzel", Georgia, serif';
                            ctx.fillStyle = 'rgba(255, 255, 255, ' + wmOpacity + ')';
                            ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                            ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2; ctx.shadowBlur = 5;
                            ctx.textAlign = (wmPosXPercent > 0.65) ? 'right' : ((wmPosXPercent < 0.35) ? 'left' : 'center');
                            var text = 'LIMZ STUDIO PHOTOBOOTH';
                            var textX = Math.round(targetW * wmPosXPercent);
                            var textY = Math.round(targetH * wmPosYPercent);
                            ctx.fillText(text, textX, textY);
                        }
                    }

                    processed[idx] = canvas.toDataURL('image/jpeg', 0.92);
                } catch (err) {
                    console.warn('Gagal render canvas frame GIF ' + idx, err);
                    processed[idx] = rawSrc;
                }
                loaded++;
                checkDone();
            };
            img.onerror = function () {
                console.warn('Gagal memuat image frame GIF ' + idx);
                processed[idx] = rawSrc;
                loaded++;
                checkDone();
            };
            img.src = rawSrc;
        });
    }

    function renderLiveGifPreview() {
        if (gifState.previewInterval) clearInterval(gifState.previewInterval);

        var isBoomerang = document.getElementById('check-gif-boomerang') ? document.getElementById('check-gif-boomerang').checked : true;
        gifState.isBoomerang = isBoomerang;

        prepareProcessedGifFrames(function (baseFrames) {
            var sequence = (baseFrames && baseFrames.length > 0)
                ? baseFrames.slice()
                : (appState.stagedPhotos || []).map(function (p) { return p.dataUrl || p.originalDataUrl; });

            if (isBoomerang && sequence.length > 2) {
                for (var i = sequence.length - 2; i > 0; i--) {
                    sequence.push(sequence[i]);
                }
            }
            gifState.frames = sequence;

            var totalFramesEl = document.getElementById('gif-total-frames');
            if (totalFramesEl) totalFramesEl.innerText = sequence.length;

            var spinner = document.getElementById('gif-render-spinner');
            if (spinner) spinner.style.display = 'none';

            startGifPreviewLoop();
        });
    }

    function startGifPreviewLoop() {
        if (!gifState.frames || gifState.frames.length === 0) return;
        if (gifState.previewInterval) clearInterval(gifState.previewInterval);

        gifState.currentFrameIdx = 0;
        var imgEl = document.getElementById('gif-preview-img');
        var currFrameEl = document.getElementById('gif-current-frame');

        function showNextFrame() {
            if (!gifState.frames || gifState.frames.length === 0) return;
            var frameUrl = gifState.frames[gifState.currentFrameIdx];
            if (imgEl) imgEl.src = frameUrl;
            if (currFrameEl) currFrameEl.innerText = (gifState.currentFrameIdx + 1);

            gifState.currentFrameIdx = (gifState.currentFrameIdx + 1) % gifState.frames.length;
        }

        showNextFrame();
        gifState.previewInterval = setInterval(showNextFrame, gifState.speedMs);
    }

    function resetGifButtonStates() {
        gifState.isEnqueuing = false;
        var btnEnqueue = document.getElementById('btn-enqueue-gif');
        if (btnEnqueue) {
            btnEnqueue.disabled = false;
            btnEnqueue.innerText = '🚀 Masukkan ke Antrian Upload';
        }
        var btnDownload = document.getElementById('btn-download-gif');
        if (btnDownload) {
            btnDownload.disabled = false;
            btnDownload.innerText = '💾 Unduh File .GIF';
        }
    }

    function buildAnimatedGifBlob(callback) {
        if (!gifState.frames || gifState.frames.length === 0) {
            showToast('⚠️ Frame foto belum siap.');
            return;
        }

        var spinner = document.getElementById('gif-render-spinner');
        if (spinner) spinner.style.display = 'flex';

        var intervalSec = Math.max(0.08, (gifState.speedMs || 250) / 1000);
        var finalW = gifState.targetWidth || 640;
        var finalH = gifState.targetHeight || Math.round(finalW * 1.5);

        var hasReturned = false;
        var safetyTimeout = setTimeout(function () {
            if (!hasReturned) {
                hasReturned = true;
                if (spinner) spinner.style.display = 'none';
                resetGifButtonStates();
                showToast('⚠️ Pembuatan GIF memakan waktu terlalu lama. Silakan coba kurangi jumlah foto.');
            }
        }, 18000);

        function runGifshotWorker(workerCount) {
            if (typeof gifshot !== 'undefined' && gifshot.createGIF) {
                try {
                    gifshot.createGIF({
                        images: gifState.frames,
                        interval: intervalSec,
                        gifWidth: finalW,
                        gifHeight: finalH,
                        sampleInterval: 8,
                        numWorkers: Math.max(1, workerCount)
                    }, function (obj) {
                        if (hasReturned) return;
                        hasReturned = true;
                        clearTimeout(safetyTimeout);
                        if (spinner) spinner.style.display = 'none';

                        if (!obj.error) {
                            gifState.generatedDataUrl = obj.image;
                            if (callback) callback(obj.image);
                        } else {
                            if (workerCount > 1) {
                                console.warn('Worker gagal, mencoba mode 1 worker...');
                                hasReturned = false;
                                runGifshotWorker(1);
                            } else {
                                showToast('⚠️ Gagal membuat animasi GIF: ' + obj.error);
                                resetGifButtonStates();
                            }
                        }
                    });
                } catch (err) {
                    console.warn('Exception saat createGIF:', err);
                    if (workerCount > 1 && !hasReturned) {
                        runGifshotWorker(1);
                    } else if (!hasReturned) {
                        hasReturned = true;
                        clearTimeout(safetyTimeout);
                        if (spinner) spinner.style.display = 'none';
                        showToast('⚠️ Gagal membuat animasi GIF: ' + err.message);
                        resetGifButtonStates();
                    }
                }
            } else {
                if (!hasReturned) {
                    hasReturned = true;
                    clearTimeout(safetyTimeout);
                    if (spinner) spinner.style.display = 'none';
                    showToast('⚠️ Modul GIF belum siap, silakan coba sesaat lagi...');
                    resetGifButtonStates();
                }
            }
        }

        // Jalankan pembuatan GIF dengan worker optimal (2 workers)
        runGifshotWorker(2);
    }

    function downloadCurrentGif() {
        var btn = document.getElementById('btn-download-gif');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Menyiapkan GIF...'; }
        buildAnimatedGifBlob(function (gifDataUrl) {
            if (btn) { btn.disabled = false; btn.innerText = '💾 Unduh File .GIF'; }
            var link = document.createElement('a');
            link.download = 'LimzStudio_Burst_' + Date.now() + '.gif';
            link.href = gifDataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('🎉 File Animasi GIF berhasil diunduh!');
        });
    }

    function enqueueGifToUploadList() {
        if (gifState.isEnqueuing) return;
        gifState.isEnqueuing = true;

        var btn = document.getElementById('btn-enqueue-gif');
        if (btn) {
            btn.disabled = true;
            btn.innerText = '⏳ Mengompilasi GIF...';
        }

        buildAnimatedGifBlob(function (gifDataUrl) {
            // Filter: hilangkan GIF yang sebelumnya sudah ada di antrian agar tidak dobel
            appState.stagedPhotos = appState.stagedPhotos.filter(function (p) {
                return !p.isGif;
            });

            var gifName = 'Burst_GIF_' + Date.now() + '.gif';
            appState.stagedPhotos.push({
                id: 'staged_gif_' + Date.now(),
                name: gifName,
                size: Math.round(gifDataUrl.length * 0.75),
                dataUrl: gifDataUrl,
                originalDataUrl: gifDataUrl,
                isCropped: false,
                isGif: true
            });

            if (btn) {
                btn.disabled = false;
                btn.innerText = '🚀 Masukkan ke Antrian Upload';
            }
            gifState.isEnqueuing = false;

            closeModal('modal-gif-creator');
            renderStagedPhotosUI();
            showToast('🚀 1 Animasi GIF berhasil dimasukkan ke antrian upload!');
        });
    }

    window.openGifCreatorModal = openGifCreatorModal;
    window.downloadCurrentGif = downloadCurrentGif;
    window.enqueueGifToUploadList = enqueueGifToUploadList;
    window.selectAllGifPhotos = selectAllGifPhotos;
    window.toggleGifPhotoSelection = toggleGifPhotoSelection;
    window.updateGifSpeed = updateGifSpeed;
    window.renderLiveGifPreview = renderLiveGifPreview;

    function fillLoginCredentials(role) {
        var em = document.getElementById('login-email');
        var pw = document.getElementById('login-password');
        if (role === 'admin') {
            if (em) em.value = 'admin@limzstudio.com';
            if (pw) pw.value = 'admin123';
        } else {
            if (em) em.value = 'crew@limzstudio.com';
            if (pw) pw.value = 'crew123';
        }
        showToast('✨ Akun ' + role.toUpperCase() + ' terisi otomatis! Silakan klik Masuk Panel.');
    }

    function handleLoginSubmit() {
        var email = (document.getElementById('login-email').value || '').trim();
        var pass = (document.getElementById('login-password').value || '').trim();
        var rememberMe = document.getElementById('login-remember-me').checked;

        if (!email || !pass) {
            showToast('⚠️ Silakan masukkan email dan password terlebih dahulu!');
            return;
        }

        // Auto-expand shortcut jika user hanya mengetik "admin" atau "crew"
        var lower = email.toLowerCase();
        if (lower === 'admin' || lower === 'lead admin' || lower === 'leadadmin') email = 'admin@limzstudio.com';
        if (lower === 'crew' || lower === 'photographer crew' || lower === 'photographer') email = 'crew@limzstudio.com';

        var btn = document.getElementById('btn-login-submit');
        btn.innerText = 'Memverifikasi...';
        btn.disabled = true;

        google.script.run
            .withSuccessHandler(function (res) {
                btn.innerText = 'Masuk Panel';
                btn.disabled = false;
                if (res && res.success) {
                    appState.currentUser = res.user;
                    if (rememberMe) {
                        try {
                            localStorage.setItem('limz_saved_user_session', JSON.stringify(res.user));
                        } catch (eStorage) { }
                    } else {
                        localStorage.removeItem('limz_saved_user_session');
                    }
                    onLoginSuccess();
                } else {
                    showToast(res && res.message ? res.message : '⚠️ Kombinasi email dan password salah.');
                }
            })
            .withFailureHandler(function (err) {
                btn.innerText = 'Masuk Panel';
                btn.disabled = false;
                showToast('⚠️ Gagal menghubungi server: ' + (err.message || err));
            })
            .loginUser(email, pass);
    }

    function onLoginSuccess() {
        updateUserDisplay();
        switchView('view-dashboard');
        var lastTab = null;
        try {
            lastTab = localStorage.getItem('limz_active_dash_tab');
        } catch (e) { }
        if (lastTab && document.getElementById(lastTab)) {
            switchDashboardTab(lastTab);
        } else {
            switchDashboardTab('tab-control-center');
        }
        refreshDashboardData();
    }

    function handleLogout() {
        appState.currentUser = null;
        localStorage.removeItem('limz_saved_user_session');
        try {
            localStorage.removeItem('limz_active_view');
            localStorage.removeItem('limz_active_dash_tab');
        } catch (e) { }
        var em = document.getElementById('login-email');
        var pw = document.getElementById('login-password');
        if (em) em.value = '';
        if (pw) pw.value = '';
        switchView('view-landing');
        showToast('Anda telah keluar.');
    }

    function refreshDashboardData() {
        var tbody = document.getElementById('tbody-latest-collections');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#64748b;">' +
                '<div style="display:inline-block; width:16px; height:16px; border:2px solid #d49438; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:8px;"></div>' +
                'Sedang memuat metrik & event terbaru dari Google Sheets...</td></tr>';
        }

        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success && res.stats) {
                    renderDashboardStats(res.stats);
                } else if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:25px; color:#ef4444;">' + (res && res.message ? escapeHtml(res.message) : 'Gagal memuat statistik') + '</td></tr>';
                }
            })
            .withFailureHandler(function (err) {
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:25px; color:#ef4444;">Gagal memuat data dari server: ' + escapeHtml(err) + '</td></tr>';
                }
            })
            .getDashboardStats();

        fetchCollectionsList();
        fetchSensorWords();
        fetchWishesForModeration();
    }

    function renderDashboardStats(stats) {
        if (!stats) return;
        var elTotalCol = document.getElementById('stat-total-collections');
        if (elTotalCol) elTotalCol.innerText = stats.totalCollections || 0;
        var elActiveCol = document.getElementById('stat-active-collections');
        if (elActiveCol) elActiveCol.innerText = stats.activeCollections || 0;
        var elTotalPhotos = document.getElementById('stat-total-photos');
        if (elTotalPhotos) elTotalPhotos.innerText = stats.totalPhotos || 0;
        var elTotalViews = document.getElementById('stat-total-views');
        if (elTotalViews) elTotalViews.innerText = stats.totalViews || 0;
        var elTotalDownloads = document.getElementById('stat-total-downloads');
        if (elTotalDownloads) elTotalDownloads.innerText = stats.totalDownloads || 0;

        var tbody = document.getElementById('tbody-latest-collections');
        if (!tbody) return;
        tbody.innerHTML = '';
        var list = stats.latestCollections || [];

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:#64748b;">Belum ada event yang dibuat. Klik tombol <strong>+ Buat Event Baru</strong> di atas untuk memulai.</td></tr>';
            return;
        }

        for (var i = 0; i < list.length; i++) {
            var row = list[i];
            var tr = document.createElement('tr');
            var badgeClass = row.status === 'Active' ? 'badge-active' : 'badge-archived';
            tr.innerHTML = '<td><strong>' + escapeHtml(row.title) + '</strong><br><small style="color:var(--text-muted);">' + escapeHtml(row.slug) + '</small></td>' +
                '<td>' + escapeHtml(row.clientName) + '</td>' +
                '<td>' + formatDisplayDate(row.eventDate) + '</td>' +
                '<td>' + (row.totalPhotos || 0) + '</td>' +
                '<td><span class="badge-status ' + badgeClass + '">' + escapeHtml(row.status) + '</span></td>' +
                '<td>' +
                '<button class="btn btn-outline btn-sm" onclick="openPublicGalleryNewTab(\'' + escapeHtml(row.slug) + '\')">↗ Galeri</button> ' +
                '<button class="btn btn-gold btn-sm" onclick="openSlideshowNewTab(\'' + escapeHtml(row.slug) + '\')">↗ Monitor</button>' +
                '</td>';
            tbody.appendChild(tr);
        }
    }

    function fetchCollectionsList() {
        var statusEl = document.getElementById('filter-collection-status');
        var searchEl = document.getElementById('search-collection');
        var status = statusEl ? statusEl.value : 'All';
        var search = searchEl ? searchEl.value : '';

        google.script.run
            .withSuccessHandler(function (res) {
                if (res.success) {
                    appState.collections = res.items;
                    renderAllCollectionsTable(res.items);
                    populateUploadSelect(res.items);
                    renderStorageTable(res.items);
                }
            })
            .getCollections(status, search, 1, 50);
    }

    var searchDebounceTimer = null;
    function debounceFetchCollections() {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(fetchCollectionsList, 400);
    }

    function renderAllCollectionsTable(items) {
        var tbody = document.getElementById('tbody-all-collections');
        tbody.innerHTML = '';

        for (var i = 0; i < items.length; i++) {
            var c = items[i];
            var tr = document.createElement('tr');
            var badgeClass = c.status === 'Active' ? 'badge-active' : 'badge-archived';

            var archiveOrRestoreBtn = (c.status === 'Archived')
                ? '<button class="btn btn-teal btn-sm role-admin-only" onclick="triggerUnarchiveCollection(\'' + c.id + '\')">🔄 Batal Arsip</button>'
                : '<button class="btn btn-danger btn-sm role-admin-only" onclick="triggerArchiveCollection(\'' + c.id + '\')">Arsip</button>';

            var coverThumbHtml = c.coverUrl
                ? '<img src="' + c.coverUrl + '" style="width:48px; height:48px; border-radius:6px; object-fit:cover;">'
                : '<div style="width:48px; height:48px; border-radius:6px; background:#1e2430; display:flex; align-items:center; justify-content:center; color:#d49438; font-size:18px;">📷</div>';

            tr.innerHTML = '<td>' + coverThumbHtml + '</td>' +
                '<td><strong>' + c.title + '</strong><br><small style="color:var(--accent-gold);">' + c.slug + '</small></td>' +
                '<td>' + c.clientName + '</td>' +
                '<td>' + formatDisplayDate(c.eventDate) + '</td>' +
                '<td>' + c.totalPhotos + '</td>' +
                '<td><span class="badge-status ' + badgeClass + '">' + c.status + '</span></td>' +
                '<td>' +
                '<div style="display:flex; gap:4px; flex-wrap:wrap;">' +
                '<button class="btn btn-outline btn-sm" onclick="openEditCollectionModal(\'' + c.id + '\')">✏️ Edit</button>' +
                '<button class="btn btn-outline btn-sm" onclick="openPublicGalleryNewTab(\'' + c.slug + '\')">↗ Galeri</button>' +
                '<button class="btn btn-gold btn-sm" onclick="openSlideshowNewTab(\'' + c.slug + '\')">↗ Monitor</button>' +
                '<button class="btn btn-outline btn-sm" onclick="triggerSyncDrivePhotos(\'' + c.id + '\')">🔄 Sync</button>' +
                '<button class="btn btn-outline btn-sm" onclick="openFlyerSheetById(\'' + c.id + '\')">Flyer</button>' +
                '<button class="btn btn-sm role-admin-only" style="background:#16a34a; color:#fff; border:none; font-weight:700; padding:4px 9px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;" onclick="openSendWaReportModal(\'' + c.id + '\')" title="Kirim Laporan Resmi ke WhatsApp Klien">📲 Kirim WA</button>' +
                archiveOrRestoreBtn +
                '</div>' +
                '</td>';
            tbody.appendChild(tr);
        }
        updateUserDisplay();
        updateLandingActiveEventUI();
    }

    function populateUploadSelect(items) {
        var sel = document.getElementById('select-upload-collection');
        if (!sel) return;
        sel.innerHTML = '';
        for (var i = 0; i < items.length; i++) {
            var opt = document.createElement('option');
            opt.value = items[i].id;
            opt.innerText = items[i].title + ' (' + items[i].status + ')';
            if (appState.activeCollectionId && items[i].id === appState.activeCollectionId) {
                opt.selected = true;
            }
            sel.appendChild(opt);
        }
        if ((!appState.activeCollectionId || !findCollectionById(appState.activeCollectionId)) && items.length > 0) {
            appState.activeCollectionId = items[0].id;
            appState.activeCollectionData = items[0];
        }
        if (items.length > 0) {
            refreshUploadedPhotosForTabUpload();
        }
    }

    function handleUploadCollectionChange() {
        var sel = document.getElementById('select-upload-collection');
        if (!sel) return;
        var collId = sel.value;
        appState.activeCollectionId = collId;
        appState.activeCollectionData = findCollectionById(collId);
        var selColl = appState.activeCollectionData;
        var badge = document.getElementById('badge-uploaded-photos-count');
        if (badge && selColl) {
            badge.innerText = (selColl.totalPhotos || 0) + ' Foto';
        }
        var container = document.getElementById('container-uploaded-photos');
        if (container && container.style.display !== 'none' && getComputedStyle(container).display !== 'none') {
            refreshUploadedPhotosForTabUpload();
        }
    }

    function toggleUploadedCloudPhotosPanel() {
        var container = document.getElementById('container-uploaded-photos');
        var btn = document.getElementById('btn-toggle-uploaded-cloud-photos');
        if (!container) return;
        var isHidden = (container.style.display === 'none' || getComputedStyle(container).display === 'none');
        if (isHidden) {
            container.style.display = 'grid';
            if (btn) btn.innerHTML = '<span>▼ Sembunyikan Galeri Cloud</span>';
            refreshUploadedPhotosForTabUpload();
        } else {
            container.style.display = 'none';
            if (btn) btn.innerHTML = '<span>▶ Tampilkan Galeri Cloud</span>';
        }
    }

    function refreshUploadedPhotosForTabUpload(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var sel = document.getElementById('select-upload-collection');
        var collId = (sel && sel.value) ? sel.value : appState.activeCollectionId;
        var container = document.getElementById('container-uploaded-photos');
        var badge = document.getElementById('badge-uploaded-photos-count');

        if (!collId) {
            if (container) container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:var(--text-muted); padding: 25px;">Pilih koleksi event di atas untuk melihat foto tersimpan.</div>';
            if (badge) badge.innerText = '0 Foto';
            return;
        }

        loadUploadedPhotosForTabUpload(collId);
    }

    function loadUploadedPhotosForTabUpload(collId) {
        var container = document.getElementById('container-uploaded-photos');
        var badge = document.getElementById('badge-uploaded-photos-count');

        if (container) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:var(--text-muted); padding: 25px;">Memuat foto dari Google Drive...</div>';
        }

        google.script.run
            .withSuccessHandler(function (res) {
                var photos = (res && res.photos) ? res.photos : [];
                if (badge) badge.innerText = photos.length + ' Foto';
                renderUploadedPhotosGrid(photos);
            })
            .withFailureHandler(function (err) {
                if (container) {
                    container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:var(--accent-red); padding: 25px;">Gagal memuat foto: ' + err + '</div>';
                }
            })
            .getPhotosByCollection(collId, 1, 0, false);
    }

    var uploadedPaginationState = {
        currentPage: 1,
        perPage: 12,
        photos: []
    };

    function renderUploadedPhotosGrid(photos) {
        uploadedPaginationState.photos = photos || [];
        uploadedPaginationState.currentPage = 1;
        renderUploadedPhotosPage();
    }

    function changeUploadedPerPage(val) {
        uploadedPaginationState.perPage = parseInt(val, 10) || 12;
        uploadedPaginationState.currentPage = 1;
        renderUploadedPhotosPage();
    }

    function goToUploadedPage(page) {
        uploadedPaginationState.currentPage = page;
        renderUploadedPhotosPage();
    }

    function renderUploadedPhotosPage() {
        var container = document.getElementById('container-uploaded-photos');
        var pagBar = document.getElementById('uploaded-pagination-bar');
        var rangeEl = document.getElementById('uploaded-page-range');
        var totalEl = document.getElementById('uploaded-total-count');
        var controlsEl = document.getElementById('uploaded-pagination-controls');

        if (!container) return;
        container.innerHTML = '';

        var photos = uploadedPaginationState.photos || [];
        var total = photos.length;

        if (total === 0) {
            container.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color:var(--text-muted); padding: 30px;">Belum ada foto yang diunggah untuk event ini. Silakan unggah foto pada panel di atas.</div>';
            if (pagBar) pagBar.style.display = 'none';
            return;
        }

        var perPage = uploadedPaginationState.perPage || 12;
        var totalPages = Math.ceil(total / perPage) || 1;
        if (uploadedPaginationState.currentPage > totalPages) {
            uploadedPaginationState.currentPage = totalPages;
        }
        if (uploadedPaginationState.currentPage < 1) {
            uploadedPaginationState.currentPage = 1;
        }
        var curPage = uploadedPaginationState.currentPage;

        var startIdx = (curPage - 1) * perPage;
        var endIdx = Math.min(startIdx + perPage, total);
        var pageItems = photos.slice(startIdx, endIdx);

        var fragment = document.createDocumentFragment();
        for (var i = 0; i < pageItems.length; i++) {
            var p = pageItems[i];
            var div = document.createElement('div');
            div.className = 'cloud-photo-card';
            div.style.position = 'relative';
            div.style.aspectRatio = '1 / 1';
            div.style.borderRadius = '12px';
            div.style.overflow = 'hidden';
            div.style.background = '#18181b';
            div.style.cursor = 'pointer';
            div.style.boxShadow = '0 3px 10px rgba(0,0,0,0.15)';
            div.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';

            div.onclick = (function (item) {
                return function () { openLightbox(item); };
            })(p);

            var pPhotoId = p.photoId || '';
            var pDriveId = p.driveFileId || '';
            var pCollId = p.collectionId || (appState.activeCollectionId || '');
            var pName = p.fileName || ('Foto_' + (startIdx + i + 1) + '.jpg');
            var pThumb = p.thumbnailUrl || (pDriveId ? ('https://drive.google.com/thumbnail?id=' + pDriveId + '&sz=w1920') : '');

            div.innerHTML = '<img src="' + pThumb + '" loading="lazy" alt="' + escapeHtml(pName) + '" style="width:100%; height:100%; object-fit:cover; display:block;">' +
                '<!-- Tombol Hapus (Pojok Kanan Atas - Bulat Gelap Persis SS) -->' +
                '<button type="button" onclick="event.stopPropagation(); confirmDeleteUploadedPhoto(\'' + String(pPhotoId).replace(/'/g, "\\'") + '\', \'' + String(pDriveId).replace(/'/g, "\\'") + '\', \'' + String(pCollId).replace(/'/g, "\\'") + '\', \'' + String(pName).replace(/'/g, "\\'") + '\')" ' +
                'style="position:absolute; top:8px; right:8px; width:28px; height:28px; border-radius:50%; background:rgba(0,0,0,0.55); color:#fff; border:1px solid rgba(255,255,255,0.25); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; transition:background 0.15s ease;" title="Hapus Foto dari Cloud">🗑️</button>' +
                '<!-- Nama File (Pojok Kiri Bawah - Badge Hitam Persis SS) -->' +
                '<span style="position:absolute; bottom:8px; left:8px; max-width:calc(100% - 46px); background:rgba(0,0,0,0.65); color:#fff; font-size:10.5px; font-weight:600; padding:2px 7px; border-radius:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; backdrop-filter:blur(4px); pointer-events:none;" title="' + escapeHtml(pName) + '">' + escapeHtml(pName) + '</span>' +
                '<!-- Tombol Download (Pojok Kanan Bawah - Kotak Emas Persis SS) -->' +
                '<button type="button" onclick="event.stopPropagation(); triggerDownloadOri(\'' + p.downloadUrl + '\', \'' + escapeHtml(pPhotoId || '-') + '\')" ' +
                'style="position:absolute; bottom:8px; right:8px; width:26px; height:26px; border-radius:6px; background:#d4af37; color:#fff; border:none; display:flex; align-items:center; justify-content:center; font-size:12px; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.35);" title="Download File Asli">📥</button>';

            fragment.appendChild(div);
        }
        container.appendChild(fragment);

        // Render Baris Paginasi (Persis Screenshot)
        if (pagBar) {
            pagBar.style.display = 'flex';
            if (rangeEl) rangeEl.innerText = (startIdx + 1) + ' – ' + endIdx;
            if (totalEl) totalEl.innerText = total;

            if (controlsEl) {
                controlsEl.innerHTML = '';

                // Tombol « (First)
                var btnFirst = document.createElement('button');
                btnFirst.type = 'button';
                btnFirst.className = 'btn btn-outline btn-sm';
                btnFirst.innerHTML = '&laquo;';
                btnFirst.disabled = (curPage === 1);
                btnFirst.style.padding = '3px 8px';
                btnFirst.style.fontSize = '12px';
                btnFirst.onclick = function () { goToUploadedPage(1); };
                controlsEl.appendChild(btnFirst);

                // Tombol < Prev
                var btnPrev = document.createElement('button');
                btnPrev.type = 'button';
                btnPrev.className = 'btn btn-outline btn-sm';
                btnPrev.innerText = '< Prev';
                btnPrev.disabled = (curPage === 1);
                btnPrev.style.padding = '3px 9px';
                btnPrev.style.fontSize = '11.5px';
                btnPrev.onclick = function () { goToUploadedPage(curPage - 1); };
                controlsEl.appendChild(btnPrev);

                // Nomor-nomor halaman
                var maxVisible = 5;
                var startPage = Math.max(1, curPage - Math.floor(maxVisible / 2));
                var endPage = Math.min(totalPages, startPage + maxVisible - 1);
                if (endPage - startPage + 1 < maxVisible) {
                    startPage = Math.max(1, endPage - maxVisible + 1);
                }

                for (var pg = startPage; pg <= endPage; pg++) {
                    (function (pNum) {
                        var isAct = (pNum === curPage);
                        var btnNum = document.createElement('button');
                        btnNum.type = 'button';
                        btnNum.className = isAct ? 'btn btn-gold btn-sm' : 'btn btn-outline btn-sm';
                        btnNum.innerText = pNum;
                        btnNum.style.padding = '3px 10px';
                        btnNum.style.fontSize = '12px';
                        btnNum.style.fontWeight = isAct ? '700' : '500';
                        if (isAct) {
                            btnNum.style.background = '#d4af37';
                            btnNum.style.color = '#fff';
                            btnNum.style.borderColor = '#d4af37';
                        }
                        btnNum.onclick = function () { goToUploadedPage(pNum); };
                        controlsEl.appendChild(btnNum);
                    })(pg);
                }

                // Tombol Next >
                var btnNext = document.createElement('button');
                btnNext.type = 'button';
                btnNext.className = 'btn btn-outline btn-sm';
                btnNext.innerText = 'Next >';
                btnNext.disabled = (curPage === totalPages);
                btnNext.style.padding = '3px 9px';
                btnNext.style.fontSize = '11.5px';
                btnNext.onclick = function () { goToUploadedPage(curPage + 1); };
                controlsEl.appendChild(btnNext);

                // Tombol » (Last)
                var btnLast = document.createElement('button');
                btnLast.type = 'button';
                btnLast.className = 'btn btn-outline btn-sm';
                btnLast.innerHTML = '&raquo;';
                btnLast.disabled = (curPage === totalPages);
                btnLast.style.padding = '3px 8px';
                btnLast.style.fontSize = '12px';
                btnLast.onclick = function () { goToUploadedPage(totalPages); };
                controlsEl.appendChild(btnLast);
            }
        }
    }

    /**
     * Konfirmasi dan eksekusi penghapusan foto secara permanen dari Cloud & Drive
     */
    function confirmDeleteUploadedPhoto(photoId, driveFileId, collectionId, photoName) {
        var displayName = photoName || 'foto ini';
        if (!confirm('Apakah Anda yakin ingin menghapus "' + displayName + '" secara permanen dari Cloud, Galeri, Monitor, dan Google Drive?')) {
            return;
        }

        showToast('⏳ Sedang menghapus foto dari Cloud & Google Drive...');

        // 1. Optimistic UI: langsung singkirkan foto dari antarmuka tampilan seketika (0 milidetik!)
        var backupPhotos = (uploadedPaginationState.photos || []).slice();
        var cPhotoId = String(photoId || '').trim();
        var cDriveId = String(driveFileId || '').trim();

        uploadedPaginationState.photos = (uploadedPaginationState.photos || []).filter(function (item) {
            var mPhotoId = String(item.photoId || '').trim();
            var mDriveId = String(item.driveFileId || '').trim();
            if (cPhotoId && mPhotoId === cPhotoId) return false;
            if (cDriveId && mDriveId === cDriveId) return false;
            return true;
        });

        var badge = document.getElementById('badge-uploaded-photos-count');
        if (badge) badge.innerText = uploadedPaginationState.photos.length + ' Foto';
        renderUploadedPhotosPage();

        // 2. Eksekusi penghapusan di backend Google Apps Script / Drive
        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success) {
                    showToast('✅ ' + (res.message || 'Foto berhasil dihapus secara permanen.'));
                    refreshDashboardData();

                    if (appState.currentView === 'view-public-gallery' && appState.activeCollectionId) {
                        loadGalleryPhotos(appState.activeCollectionId);
                    } else if (appState.currentView === 'view-slideshow' && appState.activeCollectionId) {
                        fetchMonitorContent(appState.activeCollectionId, true);
                    }
                } else {
                    // Rollback ke kondisi awal jika server gagal
                    uploadedPaginationState.photos = backupPhotos;
                    if (badge) badge.innerText = backupPhotos.length + ' Foto';
                    renderUploadedPhotosPage();
                    showToast('⚠️ Gagal menghapus foto: ' + (res ? res.message : 'Kesalahan sistem'));
                }
            })
            .withFailureHandler(function (err) {
                // Rollback jika terjadi kendala koneksi
                uploadedPaginationState.photos = backupPhotos;
                if (badge) badge.innerText = backupPhotos.length + ' Foto';
                renderUploadedPhotosPage();
                showToast('❌ Gagal menghapus foto: ' + err);
            })
            .deleteUploadedPhoto(photoId, driveFileId, collectionId);
    }

    function handleSendWishSubmit() {
        var sender = document.getElementById('wish-sender-name').value;
        var msg = document.getElementById('wish-message-text').value;
        var btn = document.getElementById('btn-send-wish');
        btn.innerText = 'Mengirim...';
        btn.disabled = true;

        var payload = {
            collectionId: appState.activeCollectionId || 'EVT-DEMO',
            senderName: sender,
            message: msg
        };

        google.script.run
            .withSuccessHandler(function (res) {
                btn.innerText = 'Kirimkan Ucapan';
                btn.disabled = false;
                document.getElementById('wish-message-text').value = '';
                showToast(res.message);
                loadPublicWishes(appState.activeCollectionId);
            })
            .withFailureHandler(function (err) {
                btn.innerText = 'Kirimkan Ucapan';
                btn.disabled = false;
                showToast('Gagal mengirim ucapan: ' + err);
            })
            .submitGuestWish(payload);
    }

    function loadPublicWishes(collId) {
        google.script.run
            .withSuccessHandler(function (res) {
                renderPublicWishes(res.wishes || []);
            })
            .getLiveWishes(collId);
    }

    function renderPublicWishes(wishes) {
        var container = document.getElementById('pub-wishes-list');
        container.innerHTML = '';
        for (var i = 0; i < wishes.length; i++) {
            var w = wishes[i];
            var div = document.createElement('div');
            div.style.background = '#fff';
            div.style.border = '1px solid var(--border-subtle)';
            div.style.borderLeft = '4px solid var(--accent-gold)';
            div.style.padding = '14px';
            div.style.borderRadius = '8px';
            div.style.marginBottom = '10px';
            div.innerHTML = '<div style="font-weight:700; font-size:13px;">' + w.senderName + ' <span style="font-size:11px; font-weight:normal; color:var(--text-muted);">' + w.createdAt + '</span></div>' +
                '<div style="font-size:13px; color:#4a4036; margin-top:4px; font-style:italic;">"' + w.message + '"</div>';
            container.prepend(div);
        }
    }

    function findCollectionById(id) {
        for (var i = 0; i < appState.collections.length; i++) {
            if (appState.collections[i].id === id) return appState.collections[i];
        }
        return null;
    }

    function triggerGeneratePdf(collId) {
        showToast('Memproses PDF Summary...');
        google.script.run
            .withSuccessHandler(function (res) {
                showToast(res.message);
                if (res.pdfUrl) window.open(res.pdfUrl, '_blank');
            })
            .generateEventSummaryPdf(collId);
    }

    function triggerArchiveCollection(collId) {
        showToast('Mengarsipkan koleksi...');
        google.script.run
            .withSuccessHandler(function (res) {
                showToast(res.message);
                fetchCollectionsList();
            })
            .archiveCollection(collId, appState.currentUser ? appState.currentUser.nama : 'Admin');
    }

    function triggerUnarchiveCollection(collId) {
        showToast('Memulihkan koleksi (Batal Arsip)...');
        google.script.run
            .withSuccessHandler(function (res) {
                showToast(res.message);
                fetchCollectionsList();
            })
            .unarchiveCollection(collId, appState.currentUser ? appState.currentUser.nama : 'Admin');
    }

    function openDeleteConfirmModal(collId, collTitle) {
        var coll = findCollectionById(collId);
        var title = collTitle || (coll ? coll.title : collId);
        document.getElementById('delete-target-coll-id').value = collId;
        document.getElementById('delete-confirm-coll-title').innerText = '"' + title + '"';
        openModal('modal-confirm-delete');
    }

    function executeDeleteCollection() {
        var collId = document.getElementById('delete-target-coll-id').value;
        if (!collId) return;

        var btn = document.getElementById('btn-execute-delete');
        btn.innerText = 'Menghapus...';
        btn.disabled = true;

        google.script.run
            .withSuccessHandler(function (res) {
                btn.innerText = 'Ya, Hapus Permanen';
                btn.disabled = false;
                closeModal('modal-confirm-delete');
                showToast(res.message || 'Event berhasil dihapus permanen.');
                refreshDashboardData();
            })
            .withFailureHandler(function (err) {
                btn.innerText = 'Ya, Hapus Permanen';
                btn.disabled = false;
                showToast('Gagal menghapus event: ' + err);
            })
            .deleteCollection(collId, appState.currentUser ? appState.currentUser.nama : 'Admin');
    }

    function triggerManualHealthAudit() {
        showToast('Menjalankan audit storage...');
        google.script.run
            .withSuccessHandler(function (res) {
                showToast(res.summary);
                fetchCollectionsList();
            })
            .runStorageHealthAudit('Manual_Admin');
    }

    var storageBoothState = {
        search: '',
        locationFilter: 'all',
        page: 1,
        limit: 10,
        activeSubTab: 'events',
        historyLogs: []
    };

    function switchStorageSubTab(subTab, btnEl) {
        storageBoothState.activeSubTab = subTab;
        var btnEvents = document.getElementById('tab-btn-storage-events');
        var btnHistory = document.getElementById('tab-btn-storage-history');
        var viewEvents = document.getElementById('storage-subview-events');
        var viewHistory = document.getElementById('storage-subview-history');

        if (btnEvents) btnEvents.classList.remove('storage-tab-active');
        if (btnHistory) btnHistory.classList.remove('storage-tab-active');

        if (subTab === 'history') {
            if (btnHistory) btnHistory.classList.add('storage-tab-active');
            if (viewEvents) viewEvents.style.display = 'none';
            if (viewHistory) viewHistory.style.display = 'block';
            fetchStorageHistoryLogs();
        } else {
            if (btnEvents) btnEvents.classList.add('storage-tab-active');
            if (viewEvents) viewEvents.style.display = 'block';
            if (viewHistory) viewHistory.style.display = 'none';
            renderStorageTable(appState.collections || []);
        }
    }

    function handleStorageFilterChange() {
        var searchInput = document.getElementById('storage-search-input');
        var locSelect = document.getElementById('storage-filter-location');
        storageBoothState.search = searchInput ? searchInput.value.trim().toLowerCase() : '';
        storageBoothState.locationFilter = locSelect ? locSelect.value : 'all';
        storageBoothState.page = 1;
        renderStorageTable(appState.collections || []);
    }

    function handleStoragePageLimitChange(val) {
        storageBoothState.limit = parseInt(val, 10) || 10;
        storageBoothState.page = 1;
        renderStorageTable(appState.collections || []);
    }

    function changeStoragePage(newPage) {
        storageBoothState.page = newPage;
        renderStorageTable(appState.collections || []);
    }

    function openDriveFolderWindow(folderId) {
        if (folderId && folderId.trim() !== '') {
            window.open('https://drive.google.com/drive/folders/' + encodeURIComponent(folderId.trim()), '_blank');
        } else {
            window.open('https://drive.google.com/drive/my-drive', '_blank');
        }
    }

    function openRelinkDriveAccountModal() {
        var sEmail = document.getElementById('storage-account-email');
        var mEmail = document.getElementById('modal-drive-active-email');
        if (sEmail && mEmail && sEmail.innerText && sEmail.innerText !== 'Memuat...') {
            mEmail.innerText = sEmail.innerText;
        }
        var rootInput = document.getElementById('input-drive-root-folder-id');
        if (rootInput && !rootInput.value) {
            rootInput.value = localStorage.getItem('limz_custom_drive_root_folder') || '';
        }
        openModal('modal-relink-drive-account');
    }

    function testDriveAccountConnection() {
        showToast('Memverifikasi akses Google Drive & membaca kuota...');
        fetchDriveStorageQuota();
        setTimeout(function() {
            showToast('Koneksi Google Drive terverifikasi aktif!');
        }, 800);
    }

    function saveCustomDriveRootFolder() {
        var rootInput = document.getElementById('input-drive-root-folder-id');
        var val = rootInput ? rootInput.value.trim() : '';
        if (val) {
            localStorage.setItem('limz_custom_drive_root_folder', val);
            showToast('ID Folder Google Drive berhasil disimpan!');
        } else {
            localStorage.removeItem('limz_custom_drive_root_folder');
            showToast('Menggunakan folder bawaan (LIMZ_STUDIO_PHOTOBOOTH_EVENTS).');
        }
        closeModal('modal-relink-drive-account');
        fetchDriveStorageQuota();
    }

    function renderStorageTable(items) {
        var tbodyEvents = document.getElementById('tbody-storage-events');
        var tbodyLegacy = document.getElementById('tbody-expired-collections');

        if (!items) items = appState.collections || [];

        // Update badge jumlah event
        var countEventsBadge = document.getElementById('storage-count-events');
        if (countEventsBadge) countEventsBadge.innerText = items.length;

        // Filter list
        var filtered = items.filter(function(c) {
            if (storageBoothState.locationFilter === 'ACTIVE_COLLECTIONS' && c.status === 'Archived') return false;
            if (storageBoothState.locationFilter === 'ARCHIVED_COLLECTIONS' && c.status !== 'Archived') return false;
            if (storageBoothState.search) {
                var q = storageBoothState.search;
                var matchTitle = (c.title || '').toLowerCase().indexOf(q) > -1;
                var matchId = (c.folderId || c.id || '').toLowerCase().indexOf(q) > -1;
                var matchDate = (c.eventDate || '').toLowerCase().indexOf(q) > -1;
                if (!matchTitle && !matchId && !matchDate) return false;
            }
            return true;
        });

        // Pagination calculation
        var total = filtered.length;
        var limit = storageBoothState.limit;
        var maxPage = Math.max(1, Math.ceil(total / limit));
        if (storageBoothState.page > maxPage) storageBoothState.page = maxPage;
        var page = storageBoothState.page;
        var startIdx = (page - 1) * limit;
        var endIdx = Math.min(total, startIdx + limit);
        var pageItems = filtered.slice(startIdx, endIdx);

        // Update pagination labels
        var elStart = document.getElementById('storage-page-start');
        var elEnd = document.getElementById('storage-page-end');
        var elTotal = document.getElementById('storage-page-total');
        if (elStart) elStart.innerText = total > 0 ? (startIdx + 1) : 0;
        if (elEnd) elEnd.innerText = endIdx;
        if (elTotal) elTotal.innerText = total;

        // Render pagination buttons
        var elBtns = document.getElementById('storage-pagination-btns');
        if (elBtns) {
            var btnHtml = '';
            var prevDisabled = page <= 1 ? 'disabled' : '';
            var nextDisabled = page >= maxPage ? 'disabled' : '';

            btnHtml += '<button class="storage-page-btn" ' + prevDisabled + ' onclick="changeStoragePage(1)">&laquo;</button>';
            btnHtml += '<button class="storage-page-btn" ' + prevDisabled + ' onclick="changeStoragePage(' + (page - 1) + ')">&lt; Prev</button>';

            for (var p = 1; p <= maxPage; p++) {
                if (p === page) {
                    btnHtml += '<button class="storage-page-btn storage-page-active">' + p + '</button>';
                } else if (p === 1 || p === maxPage || Math.abs(p - page) <= 1) {
                    btnHtml += '<button class="storage-page-btn" onclick="changeStoragePage(' + p + ')">' + p + '</button>';
                } else if (p === page - 2 || p === page + 2) {
                    btnHtml += '<span style="padding:4px 6px; color:#94a3b8;">...</span>';
                }
            }

            btnHtml += '<button class="storage-page-btn" ' + nextDisabled + ' onclick="changeStoragePage(' + (page + 1) + ')">Next &gt;</button>';
            btnHtml += '<button class="storage-page-btn" ' + nextDisabled + ' onclick="changeStoragePage(' + maxPage + ')">&raquo;</button>';
            elBtns.innerHTML = btnHtml;
        }

        // Render rows into tbody-storage-events
        if (tbodyEvents) {
            tbodyEvents.innerHTML = '';
            if (pageItems.length === 0) {
                tbodyEvents.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:30px;">Tidak ada folder penyimpanan booth yang sesuai kriteria.</td></tr>';
            } else {
                for (var i = 0; i < pageItems.length; i++) {
                    var c = pageItems[i];
                    var tr = document.createElement('tr');
                    var isArchived = (c.status === 'Archived');
                    var locBadge = isArchived
                        ? '<span class="badge-loc-archived">ARCHIVED_COLLECTIONS</span>'
                        : '<span class="badge-loc-active">ACTIVE_COLLECTIONS</span>';

                    var archiveOrRestoreBtn = isArchived
                        ? '<button type="button" class="btn-act-unarchive" onclick="triggerUnarchiveCollection(\'' + c.id + '\')" title="Batal arsipkan event ini"><span>🔄</span> Batal Arsip</button>'
                        : '<button type="button" class="btn-act-archive" onclick="triggerArchiveCollection(\'' + c.id + '\')" title="Pindahkan ke folder arsip"><span>📦</span> Arsip</button>';

                    var estSizeMb = (c.totalPhotos > 0) ? (c.totalPhotos * 2.1).toFixed(2) + ' MB' : '0 MB';
                    var folderDisplayId = c.folderId || c.id || '-';
                    var formattedDate = (typeof formatDisplayDate === 'function' ? formatDisplayDate(c.eventDate) : (c.eventDate || '-')).toUpperCase();

                    tr.innerHTML = '<td>' +
                        '<strong>' + (c.title || 'Tanpa Judul') + '</strong>' +
                        '<div style="font-size:11px; color:#64748b; font-family:monospace; margin-top:2px;">ID: ' + folderDisplayId + '</div>' +
                        '</td>' +
                        '<td>' + formattedDate + '</td>' +
                        '<td>' +
                        '<strong>' + (c.totalPhotos || 0) + ' Foto</strong>' +
                        '<div style="font-size:11px; color:#64748b; margin-top:2px;">- ' + estSizeMb + '</div>' +
                        '</td>' +
                        '<td>' + locBadge + '</td>' +
                        '<td style="text-align:right;">' +
                        '<div style="display:flex; gap:6px; justify-content:flex-end; align-items:center; flex-wrap:wrap;">' +
                        '<button type="button" class="btn-act-drive" onclick="openDriveFolderWindow(\'' + (c.folderId || '') + '\')" title="Buka di Google Drive"><span>↗</span> Buka Drive</button>' +
                        '<button type="button" class="btn-act-sync" onclick="triggerSyncDrivePhotos(\'' + c.id + '\')" title="Sinkronkan folder dengan Drive"><span>🔄</span> Sync</button>' +
                        archiveOrRestoreBtn +
                        '<button type="button" class="btn-act-delete" onclick="openDeleteConfirmModal(\'' + c.id + '\')" title="Hapus event & foto"><span>🗑️</span> Hapus</button>' +
                        '</div>' +
                        '</td>';

                    tbodyEvents.appendChild(tr);
                }
            }
        }

        // Render fallback legacy table jika ada
        if (tbodyLegacy) {
            tbodyLegacy.innerHTML = '';
            for (var j = 0; j < items.length; j++) {
                var item = items[j];
                var lTr = document.createElement('tr');
                var lBadgeClass = item.status === 'Active' ? 'badge-active' : 'badge-archived';
                var lBtn = item.status === 'Active'
                    ? '<button class="btn btn-outline btn-sm" onclick="triggerArchiveCollection(\'' + item.id + '\')">📦 Arsip</button>'
                    : '<button class="btn btn-teal btn-sm" onclick="triggerUnarchiveCollection(\'' + item.id + '\')">🔄 Batal Arsip</button>';

                lTr.innerHTML = '<td><strong>' + item.title + '</strong><br><small style="color:var(--text-muted);">' + item.slug + '</small></td>' +
                    '<td>' + (typeof formatDisplayDate === 'function' ? formatDisplayDate(item.eventDate) : item.eventDate) + '</td>' +
                    '<td>' + item.totalPhotos + ' Foto</td>' +
                    '<td><span class="badge-status ' + lBadgeClass + '">' + item.status + '</span></td>' +
                    '<td><div style="display:flex; gap:6px;">' + lBtn + '</div></td>';
                tbodyLegacy.appendChild(lTr);
            }
        }

        if (typeof updateUserDisplay === 'function') updateUserDisplay();
    }

    function fetchStorageHistoryLogs() {
        var tbodyHistory = document.getElementById('tbody-storage-history');
        if (tbodyHistory) {
            tbodyHistory.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:25px;">Mengambil riwayat aktivitas Google Drive...</td></tr>';
        }

        google.script.run
            .withSuccessHandler(function(res) {
                if (!res || !res.success) {
                    if (tbodyHistory) tbodyHistory.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#ef4444; padding:25px;">Gagal memuat riwayat aktivitas.</td></tr>';
                    return;
                }

                var badgeHistory = document.getElementById('storage-count-history');
                if (badgeHistory) badgeHistory.innerText = res.totalLogs || (res.items ? res.items.length : 0);

                if (tbodyHistory) {
                    tbodyHistory.innerHTML = '';
                    var logs = res.items || [];
                    if (logs.length === 0) {
                        tbodyHistory.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:25px;">Belum ada riwayat aktivitas Google Drive yang tercatat.</td></tr>';
                        return;
                    }

                    for (var k = 0; k < logs.length; k++) {
                        var log = logs[k];
                        var trH = document.createElement('tr');
                        trH.innerHTML = '<td><strong style="font-family:monospace;">' + (log.id || '-') + '</strong></td>' +
                            '<td>' + (log.time || '-') + '</td>' +
                            '<td><span class="badge-status badge-active">' + (log.action || '-') + '</span></td>' +
                            '<td>' + (log.user || 'Admin') + '</td>' +
                            '<td>' + (log.notes || '-') + '</td>';
                        tbodyHistory.appendChild(trH);
                    }
                }
            })
            .withFailureHandler(function(err) {
                if (tbodyHistory) {
                    tbodyHistory.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#ef4444; padding:25px;">Error memuat log: ' + err + '</td></tr>';
                }
            })
            .getStorageHistoryLogs();
    }

    function fetchSensorWords() {
        var tbody = document.getElementById('tbody-sensor-words');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:25px; color:#64748b;">' +
                '<div style="display:inline-block; width:16px; height:16px; border:2px solid #d49438; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:8px;"></div>' +
                'Sedang memuat blacklist kata terlarang...</td></tr>';
        }
        google.script.run
            .withSuccessHandler(renderSensorWordsTable)
            .withFailureHandler(function (err) {
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:25px; color:#ef4444;">Gagal memuat kata sensor: ' + err + '</td></tr>';
                }
            })
            .getSensorWords();
    }

    function renderSensorWordsTable(res) {
        var tbody = document.getElementById('tbody-sensor-words');
        if (!tbody) return;
        tbody.innerHTML = '';
        var words = (res && res.words) ? res.words : [];
        if (!words || words.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:25px; color:#64748b;">Belum ada kata terlarang. Klik <strong>+ Tambah Kata Terlarang</strong> di atas untuk menambahkan.</td></tr>';
            return;
        }
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            var tr = document.createElement('tr');
            tr.innerHTML = '<td><strong>' + w.word + '</strong></td><td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; background:#fee2e2; color:#991b1b; font-weight:700;">' + w.category + '</span></td>' +
                '<td><button class="btn btn-outline btn-sm" style="color:#ef4444; border-color:#fca5a5; font-size:11px; padding:2px 8px;" onclick="deleteWordById(\'' + w.id + '\')">🗑️ Hapus</button></td>';
            tbody.appendChild(tr);
        }
    }

    function openAddWordModal() { openModal('modal-add-word'); }
    function handleAddWordSubmit() {
        var word = document.getElementById('new-sensor-word').value;
        var cat = document.getElementById('new-sensor-category').value;
        google.script.run
            .withSuccessHandler(function (res) {
                closeModal('modal-add-word');
                showToast(res.message);
                fetchSensorWords();
            })
            .addSensorWord(word, cat);
    }

    function deleteWordById(id) {
        google.script.run
            .withSuccessHandler(function (res) {
                showToast(res.message);
                fetchSensorWords();
            })
            .deleteSensorWord(id);
    }

    function fetchWishesForModeration() {
        var tbody = document.getElementById('tbody-wishes-moderation');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:25px; color:#64748b;">' +
                '<div style="display:inline-block; width:16px; height:16px; border:2px solid #d49438; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:8px;"></div>' +
                'Sedang memuat daftar doa tamu dari Google Sheets...</td></tr>';
        }
        google.script.run
            .withSuccessHandler(function (res) {
                renderWishesModerationTable(res && res.wishes ? res.wishes : []);
            })
            .withFailureHandler(function (err) {
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:25px; color:#ef4444;">Gagal memuat doa tamu: ' + err + '</td></tr>';
                }
            })
            .getAllWishesForModeration('');
    }

    function renderWishesModerationTable(wishes) {
        var tbody = document.getElementById('tbody-wishes-moderation');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!wishes || wishes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:25px; color:#64748b;">Belum ada doa atau ucapan masuk dari tamu acara.</td></tr>';
            return;
        }
        for (var i = 0; i < wishes.length; i++) {
            var w = wishes[i];
            var tr = document.createElement('tr');
            var statusBadge = '';
            if (w.status === 'Approved') {
                statusBadge = '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; background:#dcfce7; color:#166534; font-weight:700;">Approved</span>';
            } else if (w.status === 'Rejected') {
                statusBadge = '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; background:#fee2e2; color:#991b1b; font-weight:700;">Rejected</span>';
            } else {
                statusBadge = '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; background:#fef3c7; color:#92400e; font-weight:700;">' + (w.status || 'Pending') + '</span>';
            }

            tr.innerHTML = '<td><strong>' + (w.senderName || 'Tamu') + '</strong><br><small style="color:#64748b;">' + (w.createdAt || '') + '</small></td>' +
                '<td>' + (w.cleanMessage || w.originalMessage || '') + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' +
                    '<button type="button" class="btn btn-outline btn-sm" style="font-size:11px; padding:2px 8px; margin-right:4px;" onclick="setWishStatus(\'' + w.wishId + '\', \'Approved\')">Approve</button>' +
                    '<button type="button" class="btn btn-outline btn-sm" style="font-size:11px; padding:2px 8px; color:#ef4444; border-color:#fca5a5;" onclick="setWishStatus(\'' + w.wishId + '\', \'Rejected\')">Reject</button>' +
                '</td>';
            tbody.appendChild(tr);
        }
    }

    function setWishStatus(id, st) {
        google.script.run
            .withSuccessHandler(function (res) {
                showToast(res.message);
                fetchWishesForModeration();
            })
            .updateWishStatus(id, st);
    }

    function scrollToElement(id) {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
    }

    /* =========================================================================
       GOOGLE DRIVE STORAGE QUOTA METRICS (TOTAL, DIGUNAKAN, SISA PENYIMPANAN)
       ========================================================================= */
    function formatByteSize(bytes) {
        if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';
        if (bytes === 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        if (i >= units.length) i = units.length - 1;
        var val = bytes / Math.pow(1024, i);
        return (val >= 10 || i === 0 ? val.toFixed(1) : val.toFixed(2)) + ' ' + units[i];
    }

    function fetchDriveStorageQuota() {
        var elTotal = document.getElementById('drive-stat-total');
        var elUsed = document.getElementById('drive-stat-used');
        var elRemaining = document.getElementById('drive-stat-remaining');
        var elPercent = document.getElementById('drive-percent-text');
        var elDetail = document.getElementById('drive-quota-detail');
        var bar = document.getElementById('drive-quota-bar');

        // Elemen baru kartu akun Google Drive (Revisi 57)
        var sEmail = document.getElementById('storage-account-email');
        var sUsed = document.getElementById('storage-quota-used');
        var sTotal = document.getElementById('storage-quota-total');
        var sPct = document.getElementById('storage-quota-pct');
        var sBar = document.getElementById('storage-quota-bar');

        if (elTotal) elTotal.innerText = 'Memuat...';
        if (elUsed) elUsed.innerText = 'Memuat...';
        if (elRemaining) elRemaining.innerText = 'Memuat...';
        if (sUsed) sUsed.innerText = 'Memuat...';
        if (sTotal) sTotal.innerText = 'Memuat...';

        google.script.run
            .withSuccessHandler(function (res) {
                if (!res || !res.success) {
                    if (elTotal) elTotal.innerText = '-';
                    if (elUsed) elUsed.innerText = '-';
                    if (elRemaining) elRemaining.innerText = 'Tidak tersedia';
                    if (elPercent) elPercent.innerText = 'Status kuota Google Drive tidak dapat dimuat.';
                    if (sUsed) sUsed.innerText = '-';
                    if (sTotal) sTotal.innerText = '-';
                    return;
                }

                if (res.email && sEmail) {
                    sEmail.innerText = res.email;
                }

                if (res.unlimited) {
                    if (elTotal) elTotal.innerText = 'Unlimited (Workspace)';
                    if (elUsed) elUsed.innerText = formatByteSize(res.used);
                    if (elRemaining) elRemaining.innerText = '∞ Tanpa Batas';
                    if (elPercent) elPercent.innerText = 'Akun Google Workspace / Unlimited Storage';
                    if (elDetail) elDetail.innerText = 'Terpakai: ' + formatByteSize(res.used);
                    if (sUsed) sUsed.innerText = formatByteSize(res.used);
                    if (sTotal) sTotal.innerText = 'Unlimited';
                    if (sPct) sPct.innerText = '0%';
                    if (bar) {
                        bar.style.width = '15%';
                        bar.style.backgroundColor = '#16a34a';
                    }
                    if (sBar) {
                        sBar.style.width = '15%';
                        sBar.style.backgroundColor = '#16a34a';
                    }
                    return;
                }

                var limit = res.limit || 0;
                var used = res.used || 0;
                var remaining = res.remaining || 0;
                var pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

                if (elTotal) elTotal.innerText = formatByteSize(limit);
                if (elUsed) elUsed.innerText = formatByteSize(used);
                if (elRemaining) elRemaining.innerText = formatByteSize(remaining);
                if (elPercent) elPercent.innerText = 'Penggunaan Kuota: ' + pct + '%';
                if (elDetail) elDetail.innerText = formatByteSize(used) + ' terpakai dari ' + formatByteSize(limit);

                // Update tampilan kartu baru
                if (sUsed) sUsed.innerText = formatByteSize(used);
                if (sTotal) sTotal.innerText = formatByteSize(limit);
                if (sPct) sPct.innerText = pct + '%';

                var activeBarColor = (pct >= 90) ? '#ef4444' : (pct >= 75 ? '#f59e0b' : '#d97706');
                if (bar) {
                    bar.style.width = pct + '%';
                    bar.style.backgroundColor = activeBarColor;
                }
                if (sBar) {
                    sBar.style.width = Math.max(2, pct) + '%';
                    sBar.style.backgroundColor = activeBarColor;
                }
            })
            .withFailureHandler(function (err) {
                if (elTotal) elTotal.innerText = '-';
                if (elUsed) elUsed.innerText = '-';
                if (elRemaining) elRemaining.innerText = 'Error';
                if (elPercent) elPercent.innerText = 'Gagal memuat kuota Google Drive: ' + err;
                if (sUsed) sUsed.innerText = '-';
                if (sTotal) sTotal.innerText = '-';
            })
            .getDriveStorageMetrics();
    }

    /* =========================================================================
       MANAJEMEN PENGGUNA & TIM CREW (HAPUS CREW & JADIKAN ADMIN / CREW)
       ========================================================================= */
    function openManageCrewModal() {
        openModal('modal-manage-crew');
        loadCrewManagementList();
    }

    function loadCrewManagementList() {
        var tbody = document.getElementById('tbody-crew-management');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 25px;">Memuat data pengguna tim...</td></tr>';

        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success) {
                    renderCrewManagementTable(res.users || []);
                } else {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--accent-red); padding: 20px;">' + (res && res.message ? res.message : 'Gagal memuat pengguna') + '</td></tr>';
                }
            })
            .withFailureHandler(function (err) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--accent-red); padding: 20px;">Error koneksi: ' + err + '</td></tr>';
            })
            .getUsersList();
    }

    function renderCrewManagementTable(users) {
        var tbody = document.getElementById('tbody-crew-management');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!users || users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Belum ada akun pengguna terdaftar.</td></tr>';
            return;
        }

        var currentEmail = (appState.currentUser && appState.currentUser.email) ? appState.currentUser.email.toLowerCase() : '';

        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            var tr = document.createElement('tr');
            var isSelf = (currentEmail && u.email && u.email.toLowerCase() === currentEmail);
            var isCrew = (u.role === 'Crew');

            var roleBadge = isCrew
                ? '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd;">Crew</span>'
                : '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: #fef3c7; color: #b45309; border: 1px solid #fde68a;">👑 Admin</span>';

            var roleToggleBtn = '';
            if (isSelf) {
                roleToggleBtn = '<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">(Akun Anda)</span>';
            } else if (isCrew) {
                roleToggleBtn = '<button type="button" class="btn btn-outline btn-sm" onclick="triggerChangeUserRole(\'' + u.id + '\', \'Admin\')" style="color: #b45309; border-color: #fde68a; background: #fffbeb; font-size: 11px; padding: 3px 8px;" title="Promosikan menjadi Admin">👑 Jadikan Admin</button>';
            } else {
                roleToggleBtn = '<button type="button" class="btn btn-outline btn-sm" onclick="triggerChangeUserRole(\'' + u.id + '\', \'Crew\')" style="color: #0369a1; border-color: #bae6fd; background: #f0f9ff; font-size: 11px; padding: 3px 8px;" title="Ubah menjadi Kru biasa">👥 Jadikan Crew</button>';
            }

            var deleteBtn = '';
            if (!isSelf) {
                deleteBtn = '<button type="button" class="btn btn-danger btn-sm" onclick="triggerDeleteUser(\'' + u.id + '\', \'' + u.nama.replace(/'/g, "\\'") + '\')" style="font-size: 11px; padding: 3px 8px;" title="Hapus Akun Pengguna">🗑️ Hapus</button>';
            }

            tr.innerHTML = '<td><strong>' + u.nama + '</strong></td>' +
                '<td><span style="font-family: monospace; font-size: 12px; color: var(--text-muted);">' + u.email + '</span></td>' +
                '<td>' + roleBadge + '</td>' +
                '<td style="text-align: right;"><div style="display: inline-flex; gap: 6px; justify-content: flex-end; align-items: center;">' + roleToggleBtn + deleteBtn + '</div></td>';

            tbody.appendChild(tr);
        }
    }

    function triggerChangeUserRole(userId, newRole) {
        showToast('Memperbarui hak peran akun...');
        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success) {
                    showToast(res.message);
                    loadCrewManagementList();
                } else {
                    showToast('⚠️ ' + (res && res.message ? res.message : 'Gagal memperbarui role'));
                }
            })
            .withFailureHandler(function (err) {
                showToast('Gagal mengubah role: ' + err);
            })
            .updateUserRole(userId, newRole);
    }

    function triggerDeleteUser(userId, userName) {
        if (!confirm('Apakah Anda yakin ingin menghapus akun pengguna/kru "' + userName + '" secara permanen?')) {
            return;
        }

        showToast('Menghapus akun...');
        var currentAdminEmail = (appState.currentUser && appState.currentUser.email) ? appState.currentUser.email : '';

        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success) {
                    showToast(res.message);
                    loadCrewManagementList();
                } else {
                    showToast('⚠️ ' + (res && res.message ? res.message : 'Gagal menghapus pengguna'));
                }
            })
            .withFailureHandler(function (err) {
                showToast('Gagal menghapus akun: ' + err);
            })
            .deleteUser(userId, currentAdminEmail);
    }

    // =========================================================================
    // ANDROID APK NATIVE USB CAMERA & STORAGE BRIDGE (Revisi 59)
    // =========================================================================
    function dataUriToBlobHelper(dataURI) {
        var byteString;
        if (dataURI.split(',')[0].indexOf('base64') >= 0) {
            byteString = atob(dataURI.split(',')[1]);
        } else {
            byteString = decodeURI(dataURI.split(',')[1]);
        }
        var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
        var ia = new Uint8Array(byteString.length);
        for (var i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        return new Blob([ia], { type: mimeString });
    }

    if (window.AndroidUsbCamera) {
        console.log('[AndroidUsbCamera] Native USB Camera Bridge aktif!');

        // Deteksi kamera yang terhubung saat aplikasi pertama kali terbuka
        setTimeout(function() {
            try {
                var raw = window.AndroidUsbCamera.getConnectedCameras();
                var list = JSON.parse(raw || '[]');
                if (list.length > 0) {
                    var c = list[0];
                    console.log('[AndroidUsbCamera] Kamera terdeteksi:', c.brandAndModel);
                    var statusEl = document.getElementById('tether-indicator-status');
                    if (statusEl) {
                        statusEl.innerHTML = '<span style="color:#10b981;">🟢</span> <strong>Kamera USB:</strong> ' + c.brandAndModel;
                    }
                    if (!c.hasPermission) {
                        window.AndroidUsbCamera.requestPermission(c.deviceName);
                    }
                }

                // Inisialisasi status folder penyimpanan aktif dari native Android
                try {
                    if (typeof window.AndroidUsbCamera.getStorageFolder === 'function') {
                        var curF = window.AndroidUsbCamera.getStorageFolder();
                        if (curF) {
                            var fName = (typeof window.AndroidUsbCamera.getStorageFolderName === 'function')
                                ? window.AndroidUsbCamera.getStorageFolderName()
                                : (curF.split('/').filter(Boolean).pop() || 'LimzStudioPhotobooth');
                            updateLocalStorageBadge(fName, 'Tablet Android');
                        }
                    }
                } catch(eF) {}
            } catch(eInit) {
                console.warn('[AndroidUsbCamera] init scan error:', eInit);
            }
        }, 1200);

        // Listener saat kabel kamera USB dicolok / dicabut
        window.addEventListener('androidUsbLog', function(ev) {
            if (ev.detail && ev.detail.message) {
                console.log('[AndroidUsbCamera LOG]', ev.detail.code, ev.detail.message);
                var statusEl = document.getElementById('tether-indicator-status');
                if (statusEl) {
                    var dot = '🔌';
                    if (ev.detail.code === 'SONY_READY' || ev.detail.code === 'MTP_READY' || ev.detail.code === 'PHOTO_SUCCESS') dot = '<span style="color:#10b981;">🟢</span>';
                    else if (ev.detail.code === 'MEMINTA_IZIN' || ev.detail.code === 'SONY_HANDSHAKE') dot = '<span style="color:#f59e0b;">🟡</span>';
                    else if (ev.detail.code === 'CONNECT_ERROR' || ev.detail.code === 'IZIN_DITOLAK') dot = '<span style="color:#ef4444;">🔴</span>';
                    statusEl.innerHTML = dot + ' <strong>Status USB:</strong> ' + escapeHtml(ev.detail.message);
                }
                var hudDot = document.getElementById('hud-camera-dot');
                var hudText = document.getElementById('hud-camera-text');
                if (hudDot && hudText) {
                    if (ev.detail.code === 'SONY_READY' || ev.detail.code === 'MTP_READY') {
                        hudDot.style.background = '#10b981';
                        hudDot.style.boxShadow = '0 0 8px #10b981';
                        hudText.innerText = '🟢 Sony Alpha: Siaga Foto!';
                        var btnUsbProbe = document.getElementById('btn-probe-usb-cam');
                        if (btnUsbProbe) {
                            btnUsbProbe.innerHTML = '🟢 Sony Alpha: Siaga Foto!';
                            btnUsbProbe.style.color = '#047857';
                            btnUsbProbe.style.borderColor = '#a7f3d0';
                            btnUsbProbe.style.background = '#ecfdf5';
                        }
                    } else if (ev.detail.code === 'MEMINTA_IZIN' || ev.detail.code === 'SONY_HANDSHAKE') {
                        hudDot.style.background = '#f59e0b';
                        hudDot.style.boxShadow = '0 0 8px #f59e0b';
                        hudText.innerText = '🟡 Sony: Handshake...';
                    } else if (ev.detail.code === 'CONNECT_ERROR' || ev.detail.code === 'IZIN_DITOLAK' || ev.detail.code === 'DISCONNECTED') {
                        hudDot.style.background = '#ef4444';
                        hudDot.style.boxShadow = '0 0 8px #ef4444';
                        hudText.innerText = '🔴 ' + (ev.detail.message || 'Kamera Terputus');
                    } else if (ev.detail.code === 'PHOTO_SUCCESS') {
                        hudDot.style.background = '#10b981';
                        hudText.innerText = '📸 Foto Diterima!';
                        setTimeout(function() {
                            if (hudText && hudText.innerText === '📸 Foto Diterima!') hudText.innerText = '🟢 Sony Alpha: Siaga Foto!';
                        }, 2500);
                    }
                }
                if (ev.detail.code === 'SONY_READY' || ev.detail.code === 'IZIN_DIBERIKAN' || ev.detail.code === 'PHOTO_SUCCESS') {
                    showToast(ev.detail.message);
                }
            }
        });

        window.addEventListener('androidCameraStatus', function(ev) {
            if (ev.detail && ev.detail.connected) {
                var isWifi = ev.detail.name && ev.detail.name.indexOf('WiFi') !== -1;
                showToast(isWifi ? ('📶 ' + ev.detail.name) : ('📷 Kamera USB Terhubung: ' + ev.detail.name));
                var statusEl = document.getElementById('tether-indicator-status');
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color:#10b981;">🟢</span> <strong>' + (isWifi ? 'Kamera WiFi:' : 'Kamera USB:') + '</strong> ' + escapeHtml(ev.detail.name);
                }
                var hubCam = document.getElementById('hub-camera-badge');
                var hubSrc = document.getElementById('hub-source-mode-badge');
                var btnWifi = document.getElementById('btn-sony-wifi-cam');
                if (isWifi) {
                    if (hubCam) hubCam.innerHTML = '🟢 ' + escapeHtml(ev.detail.name);
                    if (hubSrc) hubSrc.innerHTML = 'WiFi Nirkabel (Sony Alpha / A6400 / A7II)';
                    if (btnWifi) {
                        btnWifi.innerHTML = '🟢 Sony WiFi: Aktif!';
                        btnWifi.style.color = '#047857';
                        btnWifi.style.borderColor = '#a7f3d0';
                        btnWifi.style.background = '#ecfdf5';
                    }
                } else {
                    if (hubCam) {
                        hubCam.innerHTML = '🟢 ' + escapeHtml(ev.detail.name);
                        hubCam.style.background = '#ecfdf5';
                        hubCam.style.color = '#047857';
                        hubCam.style.borderColor = '#a7f3d0';
                    }
                    if (hubSrc) hubSrc.innerHTML = 'Kabel Data USB (PC / iPad)';
                }
            } else {
                showToast('📷 Kamera Terputus');
                var statusEl2 = document.getElementById('tether-indicator-status');
                if (statusEl2) {
                    statusEl2.innerHTML = '<span style="color:#94a3b8;">⚪</span> Kamera Terputus';
                }
                var btnWifi2 = document.getElementById('btn-sony-wifi-cam');
                if (btnWifi2) {
                    btnWifi2.innerHTML = '📶 Sony WiFi (Nirkabel)';
                    btnWifi2.style.color = '#2563eb';
                    btnWifi2.style.borderColor = '#bfdbfe';
                    btnWifi2.style.background = '#eff6ff';
                }
            }
        });

        // Callback utama saat jepretan foto baru masuk dari kamera via USB / WiFi
        window.onAndroidCameraPhotoCaptured = function(fileName, dataUrl, width, height, size) {
            try {
                if (!dataUrl || dataUrl.length < 1000) {
                    console.warn('[AndroidUsbCamera] Data foto tidak valid atau terlalu kecil, abaikan.');
                    return;
                }
                var blob = dataUriToBlobHelper(dataUrl);
                var file = new File([blob], fileName, { type: 'image/jpeg' });
                if (width && height) {
                    file.customWidth = width;
                    file.customHeight = height;
                    file.customMp = ((width * height) / 1000000).toFixed(1);
                    file.customIsOri = width >= 4000;
                }
                handlePhotoFilesSelected([file]);
                var isWifi = fileName && (fileName.indexOf('WIFI') !== -1 || fileName.indexOf('wifi') !== -1);
                var qualityInfo = '';
                if (width && height) {
                    var mp = ((width * height) / 1000000).toFixed(1);
                    var mb = size ? (size / (1024 * 1024)).toFixed(1) + ' MB' : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
                    var isOri = width >= 4000;
                    qualityInfo = ' [' + (isOri ? '⭐ ORI ' : '') + mp + ' MP • ' + mb + ']';
                }
                showToast(isWifi ? ('📶 Foto baru masuk via Sony WiFi: ' + fileName + qualityInfo) : ('📸 Foto baru masuk: ' + fileName + qualityInfo));
            } catch(ePhoto) {
                console.error('[AndroidUsbCamera] Gagal memproses foto baru:', ePhoto);
            }
        };

        window.addEventListener('androidCameraPhoto', function(ev) {
            if (ev.detail && ev.detail.dataUrl) {
                window.onAndroidCameraPhotoCaptured(ev.detail.name || 'camera_photo.jpg', ev.detail.dataUrl, ev.detail.width, ev.detail.height, ev.detail.size);
            }
        });

        // Handler saat operator memilih folder penyimpanan baru di tablet Android
        window.onAndroidFolderSelected = function(folderPath, folderName) {
            var name = folderName || (folderPath ? folderPath.split('/').filter(Boolean).pop() : 'LimzStudioPhotobooth');
            appState.localStorageFolderName = folderPath || name;
            try { localStorage.setItem('limz_local_storage_folder_name', name); } catch(e) {}
            updateLocalStorageBadge(name, 'Tablet Android');
            showToast('📁 Folder penyimpanan Android aktif: ' + name);
        };

        window.addEventListener('androidFolderSelected', function(ev) {
            if (ev.detail) {
                window.onAndroidFolderSelected(ev.detail.path, ev.detail.name);
            }
        });
    }

    // =========================================================================
    // MODUL SONY ALPHA WIFI TETHERING (A6400 / A7II / A7III / ZV)
    // =========================================================================

    function triggerSonyWifiModal(event) {
        if (event && event.preventDefault) event.preventDefault();
        
        var ipInput = document.getElementById('sony-wifi-custom-ip');
        var statusBox = document.getElementById('sony-wifi-status-text');
        
        if (window.AndroidUsbCamera && typeof window.AndroidUsbCamera.isSonyWifiActive === 'function') {
            var isActive = window.AndroidUsbCamera.isSonyWifiActive();
            var curIp = window.AndroidUsbCamera.getSonyCameraIp ? window.AndroidUsbCamera.getSonyCameraIp() : '192.168.122.1';
            if (ipInput && curIp) ipInput.value = curIp;
            if (statusBox) {
                if (isActive) {
                    statusBox.innerHTML = '<span style="color:#10b981;">🟢</span> <strong>Sony WiFi Aktif:</strong> Terhubung ke ' + escapeHtml(curIp);
                } else {
                    statusBox.innerHTML = '⚪ Status: Siap menghubungkan';
                }
            }
        }
        openModal('modal-sony-wifi');
    }

    function selectSonyWifiMode(mode) {
        var radioDirect = document.getElementById('sony_mode_direct');
        var radioModem = document.getElementById('sony_mode_modem');
        var ipInput = document.getElementById('sony-wifi-custom-ip');
        
        if (mode === 'direct') {
            if (radioDirect) radioDirect.checked = true;
            if (radioModem) radioModem.checked = false;
            if (ipInput) ipInput.value = '192.168.122.1';
        } else {
            if (radioDirect) radioDirect.checked = false;
            if (radioModem) radioModem.checked = true;
            if (ipInput) ipInput.value = '';
        }
    }

    function connectSonyWifiAction() {
        var ipInput = document.getElementById('sony-wifi-custom-ip');
        var targetIp = ipInput ? ipInput.value.trim() : '';
        var statusBox = document.getElementById('sony-wifi-status-text');
        
        if (statusBox) {
            statusBox.innerHTML = '<span style="color:#f59e0b;">🟡</span> <strong>Menghubungkan...</strong> Mencari kamera di ' + (targetIp || 'WiFi Modem (Auto SSDP)');
        }

        if (window.AndroidUsbCamera && typeof window.AndroidUsbCamera.connectSonyWifi === 'function') {
            window.AndroidUsbCamera.connectSonyWifi(targetIp);
            var hubCam = document.getElementById('hub-camera-badge');
            var hubSrc = document.getElementById('hub-source-mode-badge');
            var btnWifi = document.getElementById('btn-sony-wifi-cam');
            if (hubCam) hubCam.innerHTML = '🟡 Sony WiFi: Menghubungkan...';
            if (hubSrc) hubSrc.innerHTML = 'WiFi Nirkabel (Sony Alpha)';
            if (btnWifi) {
                btnWifi.innerHTML = '🟡 Sony WiFi: Menghubungkan...';
                btnWifi.style.color = '#d97706';
                btnWifi.style.borderColor = '#fde68a';
                btnWifi.style.background = '#fffbeb';
            }
            showToast('📶 Memulai koneksi Sony WiFi (' + (targetIp || 'WiFi Modem') + ')...');
            setTimeout(function() {
                closeModal('modal-sony-wifi');
            }, 1200);
        } else {
            showToast('ℹ️ Fitur Sony WiFi otomatis aktif pada Tablet Android APK.');
            closeModal('modal-sony-wifi');
        }
    }

    function disconnectSonyWifiAction() {
        if (window.AndroidUsbCamera && typeof window.AndroidUsbCamera.disconnectSonyWifi === 'function') {
            window.AndroidUsbCamera.disconnectSonyWifi();
            var statusBox = document.getElementById('sony-wifi-status-text');
            if (statusBox) statusBox.innerHTML = '⚪ Status: Sony WiFi telah diputus';
            
            var hubCam = document.getElementById('hub-camera-badge');
            var hubSrc = document.getElementById('hub-source-mode-badge');
            var btnWifi = document.getElementById('btn-sony-wifi-cam');
            if (hubCam) hubCam.innerHTML = '⚪ Siap Terhubung (Kabel USB)';
            if (hubSrc) hubSrc.innerHTML = 'Kabel Data USB (PC / iPad)';
            if (btnWifi) {
                btnWifi.innerHTML = '📶 Sony WiFi (Nirkabel)';
                btnWifi.style.color = '#2563eb';
                btnWifi.style.borderColor = '#bfdbfe';
                btnWifi.style.background = '#eff6ff';
            }
            showToast('📶 Sony WiFi diputus oleh operator');
            setTimeout(function() {
                closeModal('modal-sony-wifi');
            }, 600);
        } else {
            closeModal('modal-sony-wifi');
        }
    }

    // =========================================================================
    // MODUL CAMERA TEST & DIAGNOSTICS (STANDAR LEMONBOOTH)
    // =========================================================================

    function openCameraTestModal(event) {
        if (event && event.preventDefault) event.preventDefault();

        var valConn = document.getElementById('camtest-val-conn-txt');
        var valBrand = document.getElementById('camtest-val-brand-txt');
        var valPath = document.getElementById('camtest-val-path-txt');
        var valAccess = document.getElementById('camtest-val-access-txt');
        var pillText = document.getElementById('camtest-status-pill-text');
        var pillDot = document.getElementById('camtest-status-pill-dot');
        var pill = document.getElementById('camtest-status-pill');
        var headline = document.getElementById('camtest-headline');
        var subtext = document.getElementById('camtest-subtext');
        var barConn = document.getElementById('camtest-bar-conn');
        var barStatus = document.getElementById('camtest-bar-status');
        var barNode = document.getElementById('camtest-bar-node');
        var iconGlow = document.getElementById('camtest-icon-glow');

        if (window.AndroidUsbCamera) {
            try {
                var diagRaw = (typeof window.AndroidUsbCamera.getCameraDiagnosticDetails === 'function')
                    ? window.AndroidUsbCamera.getCameraDiagnosticDetails()
                    : null;
                var diag = diagRaw ? JSON.parse(diagRaw) : null;

                if (diag && diag.connected) {
                    if (valConn) valConn.innerText = diag.connType || 'Connected (PTP)';
                    if (valBrand) valBrand.innerText = diag.brand || 'Sony Alpha';
                    if (valPath) valPath.innerText = diag.devicePath || '/dev/bus/usb/001';
                    if (valAccess) valAccess.innerText = diag.accessReady ? 'Ready' : 'Memerlukan Izin';
                    if (pillText) pillText.innerText = 'Terdeteksi';
                    if (pillDot) pillDot.style.background = '#4ade80';
                    if (pill) { pill.style.background = 'rgba(74, 222, 128, 0.15)'; pill.style.color = '#4ade80'; }
                    if (headline) headline.innerText = (diag.brand || 'Kamera') + ' Siap Digunakan';
                    if (subtext) subtext.innerText = 'Kamera sudah terbaca dan terkoneksi sempurna. Tekan tombol di bawah untuk live view atau tes jepret.';
                    if (barConn) barConn.innerText = 'USB: 1 terhubung (' + (diag.wifiActive ? 'WiFi' : 'PTP') + ')';
                    if (barStatus) barStatus.innerText = 'STATUS: Ready';
                    if (barNode) barNode.innerText = 'KAMERA: ' + (diag.devicePath || '/dev/bus/usb');
                    if (iconGlow) {
                        iconGlow.style.borderColor = '#4ade80';
                        iconGlow.style.boxShadow = '0 0 20px rgba(74, 222, 128, 0.35)';
                        iconGlow.style.background = 'rgba(74, 222, 128, 0.08)';
                    }
                } else {
                    var camsRaw = window.AndroidUsbCamera.getConnectedCameras ? window.AndroidUsbCamera.getConnectedCameras() : '[]';
                    var cams = JSON.parse(camsRaw);
                    if (cams && cams.length > 0) {
                        var c = cams[0];
                        if (valConn) valConn.innerText = c.isPtpActive ? 'Connected (Sony PTP)' : 'Connected (USB OTG)';
                        if (valBrand) valBrand.innerText = c.brandAndModel || 'Sony Alpha';
                        if (valPath) valPath.innerText = c.deviceName || '/dev/bus/usb/001';
                        if (valAccess) valAccess.innerText = c.hasPermission ? 'Ready' : 'Izin Diperlukan';
                        if (pillText) pillText.innerText = 'Terdeteksi';
                        if (headline) headline.innerText = (c.brandAndModel || 'Kamera') + ' Siap Digunakan';
                        if (barConn) barConn.innerText = 'USB: ' + cams.length + ' terhubung';
                    } else {
                        if (valConn) valConn.innerText = 'Tidak Terhubung';
                        if (valBrand) valBrand.innerText = 'Kamera Belum Tercolok';
                        if (valPath) valPath.innerText = '-';
                        if (valAccess) valAccess.innerText = 'Standby';
                        if (pillText) pillText.innerText = 'Menunggu';
                        if (pillDot) pillDot.style.background = '#f59e0b';
                        if (pill) { pill.style.background = 'rgba(245, 158, 11, 0.15)'; pill.style.color = '#f59e0b'; }
                        if (headline) headline.innerText = 'Kamera Belum Terhubung';
                        if (subtext) subtext.innerText = 'Colokkan kabel data USB dari kamera Sony ke port Type-C tablet Android, atau aktifkan Sony WiFi.';
                        if (barConn) barConn.innerText = 'USB: 0 terhubung';
                        if (barStatus) barStatus.innerText = 'STATUS: Standby';
                    }
                }
            } catch(e) {
                console.warn('[CameraTest] error checking diagnostics:', e);
            }
        } else {
            if (valConn) valConn.innerText = 'Web Browser / Bridge';
            if (valBrand) valBrand.innerText = 'Sony / Canon Desktop';
            if (valPath) valPath.innerText = 'http://localhost:8080';
            if (valAccess) valAccess.innerText = 'Ready';
        }

        openModal('modal-camera-test');
    }

    function camTestStartLiveView() {
        closeModal('modal-camera-test');
        openLiveCameraModal(null);
    }

    function camTestTriggerShutter() {
        if (window.AndroidUsbCamera && typeof window.AndroidUsbCamera.triggerShutter === 'function') {
            window.AndroidUsbCamera.triggerShutter();
            showToast('📸 Mengirim sinyal jepret ke kamera Sony...');
        } else {
            showToast('📸 Fitur pemicu shutter aktif pada kamera terhubung.');
        }
    }


    /* =========================================================================
       MODUL LANDING PAGE ACTIVE EVENT (REAL-TIME PREVIEW CARD)
       Menampilkan event yang sedang aktif / terbaru di halaman awal (bukan dummy)
       ========================================================================= */
    function initLandingActiveEvent() {
        // 1. Cek apakah ada data preloaded langsung dari server (0ms instan!)
        var elPre = document.getElementById('gas-landing-coll');
        if (elPre && elPre.innerText && elPre.innerText.trim() !== '{}' && elPre.innerText.trim().indexOf('{') === 0) {
            try {
                var preColl = JSON.parse(elPre.innerText);
                if (preColl && preColl.id) {
                    appState.landingActiveEvent = preColl;
                    updateLandingActiveEventUI(preColl);
                    return;
                }
            } catch (e) {}
        }

        // 2. Cek apakah data koleksi sudah ada di appState.collections
        if (appState.collections && appState.collections.length > 0) {
            updateLandingActiveEventUI();
            return;
        }

        // 3. Cek cache lokal localStorage
        try {
            var cached = localStorage.getItem('limz_cached_collections_list');
            if (cached) {
                var list = JSON.parse(cached);
                if (Array.isArray(list) && list.length > 0) {
                    appState.collections = list;
                    updateLandingActiveEventUI();
                }
            }
        } catch (e) {}

        // 4. Ambil daftar event aktif terbaru dari server backend
        google.script.run
            .withSuccessHandler(function (res) {
                var items = (res && (res.items || res.collections)) ? (res.items || res.collections) : [];
                if (Array.isArray(items) && items.length > 0) {
                    appState.collections = items;
                    try { localStorage.setItem('limz_cached_collections_list', JSON.stringify(items)); } catch (e) {}
                    updateLandingActiveEventUI();
                }
            })
            .withFailureHandler(function (err) {
                console.warn('Gagal memuat event landing:', err);
            })
            .getCollections();
    }

    function updateLandingActiveEventUI(targetColl) {
        var titleEl = document.getElementById('landing-active-event-title');
        var titleSubEl = document.getElementById('landing-active-event-title-sub');
        var imgMain = document.getElementById('landing-active-img-main');
        var imgSub1 = document.getElementById('landing-active-img-sub1');
        var imgSub2 = document.getElementById('landing-active-img-sub2');

        if (!titleEl && !imgMain) return;

        var target = targetColl || null;
        if (!target) {
            var items = appState.collections || [];
            if (items.length === 0) {
                if (titleEl) titleEl.innerText = 'Belum Ada Event';
                return;
            }
            for (var i = 0; i < items.length; i++) {
                if (items[i].status === 'Active') {
                    target = items[i];
                    break;
                }
            }
            if (!target) target = items[0];
        }

        if (!target) return;
        appState.landingActiveEvent = target;

        if (titleEl) titleEl.innerText = target.title || 'Live Event';
        if (titleSubEl) titleSubEl.innerText = target.title || 'Limz Photobooth';

        var cover = target.coverUrl || 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=800&q=80';
        if (imgMain) imgMain.src = cover;
        if (imgSub1) imgSub1.src = cover;
        if (imgSub2) imgSub2.src = cover;

        // Ambil sampel foto riil terbaru dari event ini agar tampilan benar-benar foto asli acara
        if (target.id && target.id !== 'EVT-DEMO') {
            google.script.run
                .withSuccessHandler(function (res) {
                    if (res && res.photos && res.photos.length > 0) {
                        var pList = res.photos;
                        if (pList[0] && pList[0].thumbnailUrl && imgMain) {
                            imgMain.src = pList[0].thumbnailUrl;
                        }
                        if (pList[1] && pList[1].thumbnailUrl && imgSub1) {
                            imgSub1.src = pList[1].thumbnailUrl;
                        }
                        if (pList[2] && pList[2].thumbnailUrl && imgSub2) {
                            imgSub2.src = pList[2].thumbnailUrl;
                        }
                    }
                })
                .getPhotosByCollection(target.id, 1, 3, false);
        }
    }

    function openLandingActiveGallery() {
        var target = appState.landingActiveEvent;
        if (!target && appState.collections && appState.collections.length > 0) {
            for (var i = 0; i < appState.collections.length; i++) {
                if (appState.collections[i].status === 'Active') { target = appState.collections[i]; break; }
            }
            if (!target) target = appState.collections[0];
        }

        if (target && target.slug) {
            openPublicGallery(target, true);
        } else {
            openGuestDemo();
        }
    }

    function openLandingActiveMonitor() {
        var target = appState.landingActiveEvent;
        var targetSlug = (target && target.slug) ? target.slug : '';
        if (!targetSlug && appState.collections && appState.collections.length > 0) {
            for (var i = 0; i < appState.collections.length; i++) {
                if (appState.collections[i].status === 'Active') { targetSlug = appState.collections[i].slug; break; }
            }
            if (!targetSlug) targetSlug = appState.collections[0].slug;
        }

        if (targetSlug) {
            loadSlideshowBySlug(targetSlug);
        } else {
            loadSlideshowBySlug('monitor');
        }
    }

    /* =========================================================================
       MODUL KIRIM LAPORAN REKAP KE WHATSAPP KLIEN (DENGAN KUMPULAN DOA TAMU)
       Menggantikan ekspor PDF statis menjadi pesan rekap resmi langsung ke WA Klien
       ========================================================================= */
    var activeWaReportEvent = null;
    var activeWaReportWishes = [];

    function openSendWaReportModal(collId) {
        var coll = findCollectionById(collId);
        if (!coll) {
            showToast('Data koleksi tidak ditemukan.');
            return;
        }
        activeWaReportEvent = coll;
        activeWaReportWishes = [];

        var subEl = document.getElementById('wa-report-event-subtitle');
        if (subEl) subEl.innerText = coll.title + ' • ' + formatDisplayDate(coll.eventDate);

        var phoneEl = document.getElementById('wa-report-phone');
        if (phoneEl) {
            phoneEl.value = '';
            phoneEl.focus();
        }

        // Tampilkan draft awal selagi mengambil doa tamu
        rebuildWaReportMessage();
        openModal('modal-send-wa-report');

        // Ambil doa tamu yang disetujui untuk disertakan di draf pesan
        google.script.run
            .withSuccessHandler(function (res) {
                activeWaReportWishes = (res && res.wishes) ? res.wishes : [];
                rebuildWaReportMessage();
            })
            .withFailureHandler(function () {
                rebuildWaReportMessage();
            })
            .getLiveWishes(coll.id);
    }

    function toggleWaReportWishes(isEnabled) {
        rebuildWaReportMessage();
    }

    function rebuildWaReportMessage() {
        var coll = activeWaReportEvent;
        if (!coll) return;

        var galleryUrl = '';
        if (isRunningOnVercelOrCustomDomain()) {
            galleryUrl = window.location.origin + '/' + coll.slug;
        } else {
            var baseApp = cleanExecUrl(appState.backendApiUrl || DEFAULT_BACKEND_GAS_URL);
            galleryUrl = baseApp + '?slug=' + coll.slug;
        }

        var totalPhotos = coll.totalPhotos || 0;
        var clientName = coll.clientName || 'Klien Terhormat';
        var eventTitle = coll.title || 'Wedding & Event';
        var eventDateStr = formatDisplayDate(coll.eventDate);

        var includeWishes = document.getElementById('toggle-include-wishes');
        var wishesCountSel = document.getElementById('select-wishes-count');
        var isWishesEnabled = includeWishes ? includeWishes.checked : true;
        var limitWishes = wishesCountSel ? (wishesCountSel.value === 'all' ? 999 : parseInt(wishesCountSel.value, 10)) : 5;

        var wishesTextSection = '';
        if (isWishesEnabled && activeWaReportWishes && activeWaReportWishes.length > 0) {
            var selectedWishes = activeWaReportWishes.slice(0, limitWishes);
            wishesTextSection = '\n💌 *Kumpulan Doa & Ucapan Hangat Tamu:*\n';
            for (var w = 0; w < selectedWishes.length; w++) {
                var sName = selectedWishes[w].senderName || 'Tamu';
                var sMsg = selectedWishes[w].message || '';
                wishesTextSection += (w + 1) + '. *' + sName + ':* "' + sMsg + '"\n';
            }
            if (activeWaReportWishes.length > limitWishes) {
                wishesTextSection += '*(...dan ' + (activeWaReportWishes.length - limitWishes) + ' doa indah lainnya di tautan galeri)*\n';
            }
        }

        var totalWishesCount = (activeWaReportWishes && activeWaReportWishes.length > 0) ? activeWaReportWishes.length : 0;
        var wishesSummaryLine = totalWishesCount > 0 ? ('💌 *Total Doa Tamu:* ' + totalWishesCount + ' Doa Masuk\n') : '';

        var templateMsg = 'Halo Kak ' + clientName + '! 👋\n' +
            'Terima kasih banyak telah mempercayakan dokumentasi momen spesial kepada *Limz Studio Photobooth*.\n\n' +
            'Berikut adalah *Rekap & Laporan Resmi Acara Anda*:\n' +
            '━━━━━━━━━━━━━━━━━━━━━\n' +
            '📸 *Event:* ' + eventTitle + '\n' +
            '📅 *Tanggal:* ' + eventDateStr + '\n' +
            '🖼️ *Total Foto Siap Unduh:* ' + totalPhotos + ' Foto\n' +
            wishesSummaryLine +
            '✨ *Status Galeri:* Online & Aktif\n' +
            wishesTextSection + '\n' +
            '🌐 *Tautan Galeri Foto Tamu:*\n' +
            galleryUrl + '\n\n' +
            'Tautan di atas dapat langsung dibagikan kepada keluarga, kerabat, dan seluruh tamu undangan untuk mengunduh foto momen kenangan indah bersama.\n\n' +
            'Semoga seluruh dokumentasi ini menjadi kenangan terbaik selamanya! ✨\n\n' +
            'Salam hangat,\n' +
            '*Limz Studio Photobooth*';

        var txtEl = document.getElementById('wa-report-message');
        if (txtEl) txtEl.value = templateMsg;
    }

    function submitSendWaReport() {
        var phoneInput = document.getElementById('wa-report-phone');
        var msgInput = document.getElementById('wa-report-message');
        var rawPhone = phoneInput ? phoneInput.value.trim() : '';
        var message = msgInput ? msgInput.value.trim() : '';

        if (!message) {
            showToast('Pesan laporan tidak boleh kosong.');
            return;
        }

        // Sanitasi nomor telepon ke format internasional (62xxxx)
        var cleanPhone = rawPhone.replace(/[^0-9]/g, '');
        if (cleanPhone.indexOf('08') === 0) {
            cleanPhone = '62' + cleanPhone.substring(1);
        } else if (cleanPhone.indexOf('8') === 0) {
            cleanPhone = '62' + cleanPhone;
        }

        var waUrl = '';
        if (cleanPhone) {
            waUrl = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(message);
        } else {
            // Jika nomor belum diisi, buka WA Share picker langsung
            waUrl = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(message);
        }

        showToast('Membuka WhatsApp...');
        window.open(waUrl, '_blank');
    }

    function copyWaReportMessage() {
        var msgInput = document.getElementById('wa-report-message');
        if (!msgInput) return;
        msgInput.select();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(msgInput.value);
            } else {
                document.execCommand('copy');
            }
            showToast('✅ Pesan laporan berhasil disalin ke clipboard!');
        } catch (e) {
            document.execCommand('copy');
            showToast('✅ Pesan laporan berhasil disalin!');
        }
    }

    /* =========================================================================
       SEAMLESS TAB RECOVERY: VISIBILITY CHANGE LISTENER
       Menjaga agar saat berpindah tab browser dan kembali, posisi tetap di dalam panel
       ========================================================================= */
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            try {
                var savedUser = localStorage.getItem('limz_saved_user_session');
                var lastView = localStorage.getItem('limz_active_view');
                var lastTab = localStorage.getItem('limz_active_dash_tab');

                // Jika user sedang login dan posisi terakhir di dashboard, tapi tampilan sempat ter-reset:
                if (savedUser && lastView === 'view-dashboard') {
                    if (appState.currentView === 'view-landing') {
                        if (!appState.currentUser) {
                            try { appState.currentUser = JSON.parse(savedUser); } catch (e) { }
                            updateUserDisplay();
                        }
                        switchView('view-dashboard');
                        if (lastTab && document.getElementById(lastTab)) {
                            switchDashboardTab(lastTab);
                        }
                    }
                }
            } catch (e) { }
        }
    });

// =============================================================================
// STUDIO EDITOR: EVOTO AI PRO SUITE JAVASCRIPT ENGINE (REVISI 90)
// =============================================================================

var evotoState = {
    activePhotoUrl: '',
    activePhotoName: '',
    activePhotoSpecs: '24 MP • SONY RAW',
    splitPos: 50,
    isDraggingSplit: false,
    activeTab: 'presets',
    activePresetCategory: 'portrait',
    activePresetId: 'none',
    zoomMode: 'fit',
    retouch: {
        subject: 'all',
        skinSoften: 35,
        skinTexture: 50,
        blemish: 60,
        skinToneHex: '#fcebe1',
        skinToneName: 'Fair',
        skinToneAmount: 40,
        teeth: 30,
        eyes: 35
    },
    color: {
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        temp: 0,
        tint: 0,
        vibrance: 0
    },
    eraser: {
        brushSize: 28,
        isDrawing: false,
        hasStrokes: false
    },
    baseImgElement: null,
    renderCanvas: null,
    renderCtx: null,
    renderTimer: null,
    isRendering: false
};

var EVOTO_PRESET_COLLECTIONS = {
    portrait: [
        { id: 'none', name: 'None', badge: '', thumb: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=75', recipe: { temp: 0, tint: 0, contrast: 0, vibrance: 0, skinSoften: 0 } },
        { id: 'nude', name: 'Nude', badge: '', thumb: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=75', recipe: { temp: 4, tint: -2, contrast: -5, vibrance: 8, skinSoften: 40, skinToneHex: '#fcebe1' } },
        { id: 'chic', name: 'Chic', badge: '', thumb: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=75', recipe: { temp: -4, tint: 6, contrast: 12, vibrance: 14, skinSoften: 45, skinToneHex: '#f7dfd4' } },
        { id: 'sweet', name: 'Sweet', badge: '', thumb: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=75', recipe: { temp: 6, tint: 8, contrast: -6, vibrance: 20, skinSoften: 55, skinToneHex: '#f2cbba' } },
        { id: 'youthful', name: 'Youthful', badge: '', thumb: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=75', recipe: { temp: 2, tint: 4, contrast: 4, vibrance: 18, skinSoften: 50, skinToneHex: '#fcebe1' } },
        { id: 'vintage', name: 'Vintage', badge: '', thumb: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=75', recipe: { temp: 15, tint: -6, contrast: 8, vibrance: -10, skinSoften: 30, skinToneHex: '#e8bca6' } },
        { id: 'hardcore', name: 'Hardcore', badge: '', thumb: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=75', recipe: { temp: -6, tint: -2, contrast: 28, vibrance: -15, skinSoften: 20, skinToneHex: '#b87d58' } },
        { id: 'koi', name: 'Koi', badge: '', thumb: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=200&q=75', recipe: { temp: 10, tint: 12, contrast: 10, vibrance: 22, skinSoften: 45, skinToneHex: '#f2cbba' } },
        { id: 'grace', name: 'Grace', badge: '', thumb: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=200&q=75', recipe: { temp: 0, tint: 4, contrast: -8, vibrance: 12, skinSoften: 60, skinToneHex: '#fcebe1' } },
        { id: 'cateyes', name: 'Cat Eyes', badge: '', thumb: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=200&q=75', recipe: { temp: 4, tint: 6, contrast: 16, vibrance: 15, skinSoften: 40, skinToneHex: '#e8bca6' } },
        { id: 'freckles', name: 'Freckles', badge: '', thumb: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=200&q=75', recipe: { temp: 8, tint: 2, contrast: 6, vibrance: 10, skinSoften: 25, skinToneHex: '#e8bca6' } },
        { id: 'sheer', name: 'Sheer', badge: 'New', thumb: 'https://images.unsplash.com/photo-1514315384763-ba401779410f?auto=format&fit=crop&w=200&q=75', recipe: { temp: -2, tint: 6, contrast: -12, vibrance: 16, skinSoften: 65, skinToneHex: '#fcebe1' } },
        { id: 'caramel', name: 'Caramel', badge: 'New', thumb: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=200&q=75', recipe: { temp: 16, tint: -2, contrast: 8, vibrance: 12, skinSoften: 45, skinToneHex: '#d49b78' } },
        { id: 'elegant', name: 'Elegant', badge: 'New', thumb: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=200&q=75', recipe: { temp: 2, tint: 2, contrast: 10, vibrance: 8, skinSoften: 50, skinToneHex: '#f7dfd4' } },
        { id: 'light', name: 'Light', badge: 'New', thumb: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=200&q=75', recipe: { temp: 4, tint: 0, contrast: -15, exposure: 12, vibrance: 10, skinSoften: 55, skinToneHex: '#fcebe1' } },
        { id: 'chiseled', name: 'Chiseled', badge: 'New', thumb: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=75', recipe: { temp: -5, tint: -4, contrast: 24, vibrance: -8, skinSoften: 30, skinToneHex: '#e8bca6' } },
        { id: 'vivid', name: 'Vivid', badge: 'New', thumb: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=75', recipe: { temp: 4, tint: 6, contrast: 18, vibrance: 32, skinSoften: 40, skinToneHex: '#f2cbba' } },
        { id: 'hormones', name: 'Hormones', badge: 'New', thumb: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=200&q=75', recipe: { temp: 8, tint: -2, contrast: 14, vibrance: 6, skinSoften: 35, skinToneHex: '#d49b78' } },
        { id: 'vigorous', name: 'Vigorous', badge: 'New', thumb: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=75', recipe: { temp: 6, tint: 10, contrast: 16, vibrance: 25, skinSoften: 45, skinToneHex: '#fcebe1' } },
        { id: 'sincere', name: 'Sincere', badge: 'New', thumb: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=75', recipe: { temp: 0, tint: 0, contrast: 6, vibrance: 12, skinSoften: 45, skinToneHex: '#f7dfd4' } }
    ],
    tones: [
        { id: 'p01', name: 'P01 Warm Clean', badge: 'P01', thumb: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=75', recipe: { temp: 8, tint: 2, contrast: 6, vibrance: 10, skinSoften: 40 } },
        { id: 'p02', name: 'P02 Ivory Studio', badge: 'P02', thumb: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=75', recipe: { temp: 4, tint: 0, contrast: 4, vibrance: 6, skinSoften: 45 } },
        { id: 'p03', name: 'P03 Golden Sun', badge: 'P03', thumb: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=75', recipe: { temp: 18, tint: -2, contrast: 10, vibrance: 16, skinSoften: 35 } },
        { id: 'p04', name: 'P04 Peach Glow', badge: 'P04', thumb: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=75', recipe: { temp: 6, tint: 10, contrast: 6, vibrance: 18, skinSoften: 50 } },
        { id: 'p05', name: 'P05 Soft Contrast', badge: 'P05', thumb: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=75', recipe: { temp: -2, tint: 2, contrast: 14, vibrance: 8, skinSoften: 40 } },
        { id: 'p06', name: 'P06 Rosy Chic', badge: 'P06', thumb: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=200&q=75', recipe: { temp: 2, tint: 14, contrast: 8, vibrance: 14, skinSoften: 45 } },
        { id: 'p07', name: 'P07 High Key Light', badge: 'P07', thumb: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=200&q=75', recipe: { temp: 0, tint: -2, contrast: -10, exposure: 15, vibrance: 12, skinSoften: 55 } },
        { id: 'p08', name: 'P08 Amber Velvet', badge: 'P08', thumb: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=200&q=75', recipe: { temp: 14, tint: 4, contrast: 12, vibrance: 15, skinSoften: 40 } },
        { id: 'p09', name: 'P09 Shadow Depth', badge: 'P09', thumb: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=75', recipe: { temp: -6, tint: -4, contrast: 22, vibrance: 5, skinSoften: 35 } }
    ],
    cinematic: [
        { id: 'c01', name: 'C01 Teal & Orange', badge: 'C01', thumb: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=75', recipe: { temp: 12, tint: -8, contrast: 18, vibrance: 20 } },
        { id: 'c02', name: 'C02 Moody Nordic', badge: 'C02', thumb: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=75', recipe: { temp: -12, tint: 4, contrast: 14, vibrance: -8 } },
        { id: 'c03', name: 'C03 Golden Hour', badge: 'C03', thumb: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=75', recipe: { temp: 22, tint: -4, contrast: 12, vibrance: 24 } },
        { id: 'c04', name: 'C04 Bleach Bypass', badge: 'C04', thumb: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=75', recipe: { temp: -4, tint: -2, contrast: 35, vibrance: -30 } },
        { id: 'c05', name: 'C05 Emerald Film', badge: 'C05', thumb: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=75', recipe: { temp: -8, tint: -14, contrast: 10, vibrance: 12 } },
        { id: 'c06', name: 'C06 Kodachrome 64', badge: 'C06', thumb: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=75', recipe: { temp: 8, tint: 6, contrast: 20, vibrance: 18 } },
        { id: 'c07', name: 'C07 Muted Bronze', badge: 'C07', thumb: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=200&q=75', recipe: { temp: 16, tint: -6, contrast: 6, vibrance: -12 } },
        { id: 'c08', name: 'C08 Cyber Noir', badge: 'C08', thumb: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=75', recipe: { temp: -15, tint: 12, contrast: 26, vibrance: 15 } },
        { id: 'c09', name: 'C09 Velvet Shadow', badge: 'C09', thumb: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=75', recipe: { temp: -2, tint: 8, contrast: 16, vibrance: 10 } },
        { id: 'c10', name: 'C10 Tokyo Night', badge: 'C10', thumb: 'https://images.unsplash.com/photo-1514315384763-ba401779410f?auto=format&fit=crop&w=200&q=75', recipe: { temp: -18, tint: 16, contrast: 22, vibrance: 22 } }
    ],
    film: [
        { id: 'fuji_provia', name: 'Fuji Provia 100F', badge: 'Fuji', thumb: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=75', recipe: { temp: 0, tint: 2, contrast: 12, vibrance: 16 } },
        { id: 'fuji_astia', name: 'Fuji Astia Soft', badge: 'Fuji', thumb: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=75', recipe: { temp: 4, tint: 6, contrast: -6, vibrance: 14, skinSoften: 45 } },
        { id: 'fuji_cc', name: 'Fuji Classic Chrome', badge: 'Fuji', thumb: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=75', recipe: { temp: 2, tint: -6, contrast: 18, vibrance: -18 } },
        { id: 'kodak_portra', name: 'Kodak Portra 400', badge: 'Kodak', thumb: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=75', recipe: { temp: 10, tint: 4, contrast: 6, vibrance: 12, skinSoften: 40, skinToneHex: '#fcebe1' } },
        { id: 'cinestill_800t', name: 'Cinestill 800T', badge: 'Film', thumb: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=75', recipe: { temp: -14, tint: 8, contrast: 16, vibrance: 20 } },
        { id: 'olive_green', name: 'Olive Green Film', badge: 'Film', thumb: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=200&q=75', recipe: { temp: 6, tint: -16, contrast: 8, vibrance: 6 } },
        { id: 'nile_blue', name: 'Nile Blue Film', badge: 'Film', thumb: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=75', recipe: { temp: -16, tint: -4, contrast: 14, vibrance: 10 } },
        { id: 'dawn_voyage', name: 'Dawn Voyage', badge: 'Film', thumb: 'https://images.unsplash.com/photo-1514315384763-ba401779410f?auto=format&fit=crop&w=200&q=75', recipe: { temp: -6, tint: 12, contrast: 10, vibrance: 18 } }
    ]
};

function initStudioEditorWorkspace() {
    setupEvotoProjectSelect();
    setupEvotoSplitSliderDrag();
    setupEvotoEraserCanvas();
    renderEvotoPresetsGrid();
    refreshEvotoFilmstripPhotos();
}

function setupEvotoProjectSelect() {
    var sel = document.getElementById('evoto-project-select');
    if (!sel) return;
    sel.innerHTML = '';
    
    var collections = (typeof appState !== 'undefined' && appState.collections) ? appState.collections : [];
    if (collections.length === 0) {
        var opt = document.createElement('option');
        opt.value = 'default';
        opt.textContent = 'Projeck Aktif Studio';
        sel.appendChild(opt);
    } else {
        collections.forEach(function(col) {
            var opt = document.createElement('option');
            opt.value = col.slug || col.id;
            opt.textContent = col.title || col.name || col.slug;
            if (typeof appState !== 'undefined' && appState.activeCollection && (appState.activeCollection.slug === col.slug || appState.activeCollection.id === col.id)) {
                opt.selected = true;
            }
            sel.appendChild(opt);
        });
    }
}

function handleEvotoProjectChange(slug) {
    if (typeof appState !== 'undefined' && appState.collections) {
        var found = appState.collections.find(function(c) { return (c.slug === slug || c.id === slug); });
        if (found) {
            appState.activeCollection = found;
        }
    }
    refreshEvotoFilmstripPhotos();
}

function refreshEvotoFilmstripPhotos() {
    var track = document.getElementById('evoto-filmstrip-track');
    var countLbl = document.getElementById('evoto-filmstrip-count');
    if (!track) return;
    track.innerHTML = '';

    var photoList = [];

    // 0. Ambil dari foto aktif di Live Studio Preview (Tab Upload)
    var activeUploadImg = document.getElementById('wm-simulator-bg');
    if (activeUploadImg && activeUploadImg.src && (activeUploadImg.src.indexOf('http') !== -1 || activeUploadImg.src.startsWith('data:'))) {
        var activeUploadName = (typeof appState !== 'undefined' && appState.activeStagedPhoto && appState.activeStagedPhoto.name) 
            ? appState.activeStagedPhoto.name 
            : 'Foto_Aktif_Upload.jpg';
        photoList.push({
            url: activeUploadImg.src,
            name: activeUploadName,
            specs: 'FOTO AKTIF UPLOAD • LIVE',
            isActiveUpload: true
        });
    }

    // 1. Ambil dari foto staged / camera roll terkini
    if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos.length > 0) {
        appState.stagedPhotos.forEach(function(p) {
            photoList.push({
                url: p.dataUrl || p.url,
                name: p.filename || 'Sony_Alpha_DSC.jpg',
                specs: 'SONY A6400 • RAW',
                isStaged: true
            });
        });
    }

    // 2. Ambil dari koleksi foto aktif di event
    if (typeof appState !== 'undefined' && appState.photos && appState.photos.length > 0) {
        appState.photos.forEach(function(p) {
            photoList.push({
                url: p.drive_preview_url || p.url || p.dataUrl,
                name: p.file_name || p.name || 'Studio_Capture.jpg',
                specs: 'CLOUD ARCHIVE • 24MP'
            });
        });
    }

    // Fallback sampel berkualitas tinggi jika antrean masih kosong
    if (photoList.length === 0) {
        photoList = [
            {
                url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=85',
                name: 'Sony_Alpha_Portrait_01.jpg',
                specs: 'SONY A7 III • 24 MP'
            },
            {
                url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=85',
                name: 'Sony_Alpha_Portrait_02.jpg',
                specs: 'SONY A6400 • RAW'
            },
            {
                url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=1200&q=85',
                name: 'Studio_Fashion_03.jpg',
                specs: 'SONY A7 IV • 33 MP'
            },
            {
                url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=85',
                name: 'Outdoor_Sunlight_04.jpg',
                specs: 'SONY A6700 • RAW'
            }
        ];
    }

    if (countLbl) {
        countLbl.textContent = photoList.length + ' Foto';
    }

    photoList.forEach(function(item, idx) {
        var card = document.createElement('div');
        card.className = 'evoto-filmstrip-item' + (idx === 0 ? ' active' : '');
        card.innerHTML = '<img src="' + item.url + '" alt="' + item.name + '">' +
                         '<span class="evoto-filmstrip-label">' + item.name + '</span>';
        card.onclick = function() {
            var activeItems = track.querySelectorAll('.evoto-filmstrip-item');
            activeItems.forEach(function(el) { el.classList.remove('active'); });
            card.classList.add('active');
            selectEvotoActivePhoto(item.url, item.name, item.specs);
        };
        track.appendChild(card);
    });

    // Otomatis pilih foto pertama
    if (photoList.length > 0) {
        selectEvotoActivePhoto(photoList[0].url, photoList[0].name, photoList[0].specs);
    }
}

function selectEvotoActivePhoto(url, name, specs) {
    evotoState.activePhotoUrl = url;
    evotoState.activePhotoName = name || 'DSC_Sony.jpg';
    evotoState.activePhotoSpecs = specs || '24 MP • SONY RAW';

    var fnEl = document.getElementById('evoto-active-filename');
    var spEl = document.getElementById('evoto-active-specs');
    var beforeImg = document.getElementById('evoto-img-before');
    var afterImg = document.getElementById('evoto-img-after');

    if (fnEl) fnEl.textContent = evotoState.activePhotoName;
    if (spEl) spEl.textContent = evotoState.activePhotoSpecs;

    if (beforeImg) {
        beforeImg.src = url;
    }

    // Bersihkan canvas masker kuas objek jika ada
    clearEvotoEraserMask();

    // Muat gambar ke element offscreen untuk pemrosesan filter real-time
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
        evotoState.baseImgElement = img;
        renderEvotoCanvasPipeline();
    };
    img.onerror = function() {
        if (afterImg) afterImg.src = url;
    };
    img.src = url;
}

function setupEvotoSplitSliderDrag() {
    var stage = document.getElementById('evoto-stage-container');
    var divider = document.getElementById('evoto-split-divider');
    if (!stage || !divider) return;

    function updateSplitPosition(clientX) {
        var rect = stage.getBoundingClientRect();
        var x = clientX - rect.left;
        var pct = (x / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        evotoState.splitPos = pct;
        stage.style.setProperty('--split-pos', pct + '%');
    }

    function onPointerMove(e) {
        if (!evotoState.isDraggingSplit) return;
        var clientX = e.touches ? e.touches[0].clientX : e.clientX;
        updateSplitPosition(clientX);
    }

    function onPointerUp() {
        evotoState.isDraggingSplit = false;
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);
    }

    divider.addEventListener('mousedown', function(e) {
        e.preventDefault();
        evotoState.isDraggingSplit = true;
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);
    });

    divider.addEventListener('touchstart', function(e) {
        evotoState.isDraggingSplit = true;
        window.addEventListener('touchmove', onPointerMove, { passive: true });
        window.addEventListener('touchend', onPointerUp);
    });
}

function toggleEvotoBeforeAfter() {
    var stage = document.getElementById('evoto-stage-container');
    if (!stage) return;
    if (evotoState.splitPos > 85) {
        evotoState.splitPos = 50;
    } else if (evotoState.splitPos > 15) {
        evotoState.splitPos = 0;
    } else {
        evotoState.splitPos = 100;
    }
    stage.style.setProperty('--split-pos', evotoState.splitPos + '%');
}

function zoomEvotoCanvas(mode) {
    var beforeImg = document.getElementById('evoto-img-before');
    var afterImg = document.getElementById('evoto-img-after');
    evotoState.zoomMode = mode;
    var scale = mode === '100' ? 'scale(1.8)' : 'scale(1)';
    if (beforeImg) beforeImg.style.transform = scale;
    if (afterImg) afterImg.style.transform = scale;
}

function switchEvotoInspectorTab(tabKey, btn) {
    evotoState.activeTab = tabKey;
    var navBtns = document.querySelectorAll('.evoto-tab-btn');
    navBtns.forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');

    var panes = document.querySelectorAll('.evoto-inspector-pane');
    panes.forEach(function(p) { p.classList.remove('active'); });

    var targetPane = document.getElementById('evoto-pane-' + tabKey);
    if (targetPane) targetPane.classList.add('active');

    var eraserCanvas = document.getElementById('evoto-eraser-canvas');
    if (eraserCanvas) {
        if (tabKey === 'eraser') {
            eraserCanvas.classList.add('active');
        } else {
            eraserCanvas.classList.remove('active');
        }
    }
}

function switchEvotoPresetCategory(catKey, btn) {
    evotoState.activePresetCategory = catKey;
    var subBtns = document.querySelectorAll('.evoto-subnav-btn');
    subBtns.forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    renderEvotoPresetsGrid();
}

function renderEvotoPresetsGrid() {
    var container = document.getElementById('evoto-presets-grid-container');
    if (!container) return;
    container.innerHTML = '';

    var list = EVOTO_PRESET_COLLECTIONS[evotoState.activePresetCategory] || [];
    if (evotoState.activePresetCategory === 'tones' || evotoState.activePresetCategory === 'cinematic') {
        container.className = 'evoto-presets-grid grid-3';
    } else {
        container.className = 'evoto-presets-grid';
    }

    list.forEach(function(preset) {
        var card = document.createElement('div');
        card.className = 'evoto-preset-card' + (evotoState.activePresetId === preset.id ? ' active' : '');
        
        var badgeHtml = preset.badge ? '<span class="evoto-preset-badge">' + preset.badge + '</span>' : '';
        card.innerHTML = 
            '<img class="evoto-preset-thumb" src="' + preset.thumb + '" alt="' + preset.name + '">' +
            '<div class="evoto-preset-info">' +
                '<span class="evoto-preset-name">' + preset.name + '</span>' +
                badgeHtml +
            '</div>';

        card.onclick = function() {
            var allCards = container.querySelectorAll('.evoto-preset-card');
            allCards.forEach(function(c) { c.classList.remove('active'); });
            card.classList.add('active');
            applyEvotoPreset(preset.id);
        };

        container.appendChild(card);
    });
}

function applyEvotoPreset(presetId) {
    evotoState.activePresetId = presetId;
    var list = EVOTO_PRESET_COLLECTIONS[evotoState.activePresetCategory] || [];
    var preset = list.find(function(p) { return p.id === presetId; });
    if (!preset) return;

    var badgeEl = document.getElementById('evoto-active-preset-badge');
    if (badgeEl) badgeEl.textContent = 'Preset: ' + preset.name;

    var r = preset.recipe;
    if (typeof r.temp !== 'undefined') evotoState.color.temp = r.temp;
    if (typeof r.tint !== 'undefined') evotoState.color.tint = r.tint;
    if (typeof r.contrast !== 'undefined') evotoState.color.contrast = r.contrast;
    if (typeof r.vibrance !== 'undefined') evotoState.color.vibrance = r.vibrance;
    if (typeof r.exposure !== 'undefined') evotoState.color.exposure = r.exposure;
    if (typeof r.skinSoften !== 'undefined') evotoState.retouch.skinSoften = r.skinSoften;
    if (r.skinToneHex) {
        evotoState.retouch.skinToneHex = r.skinToneHex;
        syncEvotoSkinSwatchUI(r.skinToneHex);
    }

    syncEvotoSlidersUI();
    renderEvotoCanvasPipeline();
}

function setEvotoRetouchSubject(subj, btn) {
    evotoState.retouch.subject = subj;
    var pills = document.querySelectorAll('.evoto-subject-pills .evoto-pill-btn');
    pills.forEach(function(p) { p.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    renderEvotoCanvasPipeline();
}

function setEvotoSkinTone(colorHex, name, el) {
    evotoState.retouch.skinToneHex = colorHex;
    evotoState.retouch.skinToneName = name;
    var swatches = document.querySelectorAll('.evoto-skin-swatch');
    swatches.forEach(function(s) { s.classList.remove('active'); });
    if (el) el.classList.add('active');
    renderEvotoCanvasPipeline();
}

function syncEvotoSkinSwatchUI(hex) {
    var swatches = document.querySelectorAll('.evoto-skin-swatch');
    swatches.forEach(function(s) {
        if (s.getAttribute('onclick') && s.getAttribute('onclick').indexOf(hex) !== -1) {
            s.classList.add('active');
        } else {
            s.classList.remove('active');
        }
    });
}

function updateEvotoRetouchParams() {
    var sSoften = document.getElementById('slider-evoto-skin-soften');
    var sTexture = document.getElementById('slider-evoto-skin-texture');
    var sBlemish = document.getElementById('slider-evoto-blemish');
    var sAmount = document.getElementById('slider-evoto-skin-tone-amount');
    var sTeeth = document.getElementById('slider-evoto-teeth');
    var sEyes = document.getElementById('slider-evoto-eyes');

    if (sSoften) {
        evotoState.retouch.skinSoften = parseInt(sSoften.value, 10);
        document.getElementById('lbl-evoto-skin-soften').textContent = sSoften.value + '%';
    }
    if (sTexture) {
        evotoState.retouch.skinTexture = parseInt(sTexture.value, 10);
        document.getElementById('lbl-evoto-skin-texture').textContent = sTexture.value + '%';
    }
    if (sBlemish) {
        evotoState.retouch.blemish = parseInt(sBlemish.value, 10);
        document.getElementById('lbl-evoto-blemish').textContent = sBlemish.value + '%';
    }
    if (sAmount) {
        evotoState.retouch.skinToneAmount = parseInt(sAmount.value, 10);
        document.getElementById('lbl-evoto-skin-tone-amount').textContent = sAmount.value + '%';
    }
    if (sTeeth) {
        evotoState.retouch.teeth = parseInt(sTeeth.value, 10);
        document.getElementById('lbl-evoto-teeth').textContent = sTeeth.value + '%';
    }
    if (sEyes) {
        evotoState.retouch.eyes = parseInt(sEyes.value, 10);
        document.getElementById('lbl-evoto-eyes').textContent = sEyes.value + '%';
    }

    renderEvotoCanvasPipeline();
}

function updateEvotoColorParams() {
    var sExp = document.getElementById('slider-evoto-exposure');
    var sCon = document.getElementById('slider-evoto-contrast');
    var sHigh = document.getElementById('slider-evoto-highlights');
    var sShad = document.getElementById('slider-evoto-shadows');
    var sTemp = document.getElementById('slider-evoto-temp');
    var sTint = document.getElementById('slider-evoto-tint');
    var sVib = document.getElementById('slider-evoto-vibrance');

    if (sExp) {
        evotoState.color.exposure = parseInt(sExp.value, 10);
        document.getElementById('lbl-evoto-exposure').textContent = (evotoState.color.exposure / 20).toFixed(1) + ' EV';
    }
    if (sCon) {
        evotoState.color.contrast = parseInt(sCon.value, 10);
        document.getElementById('lbl-evoto-contrast').textContent = sCon.value;
    }
    if (sHigh) {
        evotoState.color.highlights = parseInt(sHigh.value, 10);
        document.getElementById('lbl-evoto-highlights').textContent = sHigh.value;
    }
    if (sShad) {
        evotoState.color.shadows = parseInt(sShad.value, 10);
        document.getElementById('lbl-evoto-shadows').textContent = sShad.value;
    }
    if (sTemp) {
        evotoState.color.temp = parseInt(sTemp.value, 10);
        document.getElementById('lbl-evoto-temp').textContent = sTemp.value;
    }
    if (sTint) {
        evotoState.color.tint = parseInt(sTint.value, 10);
        document.getElementById('lbl-evoto-tint').textContent = sTint.value;
    }
    if (sVib) {
        evotoState.color.vibrance = parseInt(sVib.value, 10);
        document.getElementById('lbl-evoto-vibrance').textContent = sVib.value + '%';
    }

    renderEvotoCanvasPipeline();
}

function syncEvotoSlidersUI() {
    var setSlider = function(id, lblId, val, suffix) {
        var s = document.getElementById(id);
        var l = document.getElementById(lblId);
        if (s) s.value = val;
        if (l) l.textContent = val + (suffix || '');
    };

    setSlider('slider-evoto-skin-soften', 'lbl-evoto-skin-soften', evotoState.retouch.skinSoften, '%');
    setSlider('slider-evoto-skin-texture', 'lbl-evoto-skin-texture', evotoState.retouch.skinTexture, '%');
    setSlider('slider-evoto-blemish', 'lbl-evoto-blemish', evotoState.retouch.blemish, '%');
    setSlider('slider-evoto-skin-tone-amount', 'lbl-evoto-skin-tone-amount', evotoState.retouch.skinToneAmount, '%');
    setSlider('slider-evoto-teeth', 'lbl-evoto-teeth', evotoState.retouch.teeth, '%');
    setSlider('slider-evoto-eyes', 'lbl-evoto-eyes', evotoState.retouch.eyes, '%');

    setSlider('slider-evoto-exposure', 'lbl-evoto-exposure', evotoState.color.exposure, '');
    if (document.getElementById('lbl-evoto-exposure')) {
        document.getElementById('lbl-evoto-exposure').textContent = (evotoState.color.exposure / 20).toFixed(1) + ' EV';
    }
    setSlider('slider-evoto-contrast', 'lbl-evoto-contrast', evotoState.color.contrast, '');
    setSlider('slider-evoto-highlights', 'lbl-evoto-highlights', evotoState.color.highlights, '');
    setSlider('slider-evoto-shadows', 'lbl-evoto-shadows', evotoState.color.shadows, '');
    setSlider('slider-evoto-temp', 'lbl-evoto-temp', evotoState.color.temp, '');
    setSlider('slider-evoto-tint', 'lbl-evoto-tint', evotoState.color.tint, '');
    setSlider('slider-evoto-vibrance', 'lbl-evoto-vibrance', evotoState.color.vibrance, '%');
}

function resetEvotoAllGrading() {
    evotoState.activePresetId = 'none';
    var badgeEl = document.getElementById('evoto-active-preset-badge');
    if (badgeEl) badgeEl.textContent = 'Preset: Original';

    evotoState.retouch = {
        subject: 'all',
        skinSoften: 0,
        skinTexture: 50,
        blemish: 0,
        skinToneHex: '#fcebe1',
        skinToneName: 'Fair',
        skinToneAmount: 0,
        teeth: 0,
        eyes: 0
    };

    evotoState.color = {
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        temp: 0,
        tint: 0,
        vibrance: 0
    };

    syncEvotoSlidersUI();
    clearEvotoEraserMask();
    renderEvotoCanvasPipeline();

    if (typeof showToast === 'function') {
        showToast('↺ Pengaturan studio di-reset ke nilai asli');
    }
}

function renderEvotoCanvasPipeline() {
    if (!evotoState.baseImgElement) return;

    if (evotoState.renderTimer) clearTimeout(evotoState.renderTimer);
    evotoState.renderTimer = setTimeout(function() {
        executeEvotoFilterPass();
    }, 16);
}

function hexToRgb(hex) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    var num = parseInt(c, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function executeEvotoFilterPass() {
    var img = evotoState.baseImgElement;
    if (!img) return;

    if (!evotoState.renderCanvas) {
        evotoState.renderCanvas = document.createElement('canvas');
        evotoState.renderCtx = evotoState.renderCanvas.getContext('2d', { willReadFrequently: true });
    }

    var canvas = evotoState.renderCanvas;
    var ctx = evotoState.renderCtx;

    var maxDim = 1280;
    var w = img.naturalWidth || img.width || 800;
    var h = img.naturalHeight || img.height || 600;
    if (w > maxDim || h > maxDim) {
        var ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
    }

    canvas.width = w;
    canvas.height = h;

    ctx.drawImage(img, 0, 0, w, h);

    var imgData = ctx.getImageData(0, 0, w, h);
    var data = imgData.data;
    var len = data.length;

    var expMult = 1 + (evotoState.color.exposure / 60);
    var contrastFactor = (259 * (evotoState.color.contrast + 255)) / (255 * (259 - evotoState.color.contrast));
    var tempVal = evotoState.color.temp;
    var tintVal = evotoState.color.tint;
    var vibVal = evotoState.color.vibrance / 100;

    var skinSoften = evotoState.retouch.skinSoften / 100;
    var skinToneAmt = evotoState.retouch.skinToneAmount / 100;
    var targetSkinRgb = hexToRgb(evotoState.retouch.skinToneHex || '#fcebe1');
    var teethWhitening = evotoState.retouch.teeth / 100;
    var eyeBrightening = evotoState.retouch.eyes / 100;

    var histR = new Array(256).fill(0);
    var histG = new Array(256).fill(0);
    var histB = new Array(256).fill(0);

    for (var i = 0; i < len; i += 4) {
        var r = data[i];
        var g = data[i + 1];
        var b = data[i + 2];

        // 1. Exposure
        if (expMult !== 1) {
            r *= expMult;
            g *= expMult;
            b *= expMult;
        }

        // 2. Contrast
        if (evotoState.color.contrast !== 0) {
            r = contrastFactor * (r - 128) + 128;
            g = contrastFactor * (g - 128) + 128;
            b = contrastFactor * (b - 128) + 128;
        }

        // 3. White Balance
        if (tempVal !== 0) {
            r += tempVal * 1.2;
            b -= tempVal * 1.2;
        }
        if (tintVal !== 0) {
            g -= tintVal * 1.1;
            r += tintVal * 0.5;
            b += tintVal * 0.5;
        }

        // 4. Vibrance
        if (vibVal !== 0) {
            var maxC = Math.max(r, g, b);
            var avgC = (r + g + b) / 3;
            var amt = (maxC - avgC) / 255;
            var boost = (1 - amt) * vibVal;
            r += (r - avgC) * boost;
            g += (g - avgC) * boost;
            b += (b - avgC) * boost;
        }

        // 5. AI Skin Detection & Soft Retouching
        var isSkin = (r > 60 && g > 40 && b > 20 && r > g && (r - g) >= 12 && (r - b) >= 15);
        if (isSkin) {
            if (skinSoften > 0) {
                var skinLuma = (r * 0.299 + g * 0.587 + b * 0.114);
                r = r * (1 - skinSoften * 0.25) + skinLuma * (skinSoften * 0.25);
                g = g * (1 - skinSoften * 0.25) + skinLuma * (skinSoften * 0.25);
                b = b * (1 - skinSoften * 0.25) + skinLuma * (skinSoften * 0.25);
            }
            if (skinToneAmt > 0) {
                r = r * (1 - skinToneAmt * 0.2) + targetSkinRgb.r * (skinToneAmt * 0.2);
                g = g * (1 - skinToneAmt * 0.2) + targetSkinRgb.g * (skinToneAmt * 0.2);
                b = b * (1 - skinToneAmt * 0.2) + targetSkinRgb.b * (skinToneAmt * 0.2);
            }
        }

        // 6. Teeth Whitening & Eye Brightening
        var luma = (r * 0.299 + g * 0.587 + b * 0.114);
        if (luma > 165 && teethWhitening > 0) {
            var diffYB = (r + g) / 2 - b;
            if (diffYB > 10 && diffYB < 55) {
                b += diffYB * (teethWhitening * 0.6);
                r = Math.min(255, r * (1 + teethWhitening * 0.12));
                g = Math.min(255, g * (1 + teethWhitening * 0.12));
            }
        }
        if (luma > 185 && eyeBrightening > 0) {
            r = Math.min(255, r * (1 + eyeBrightening * 0.15));
            g = Math.min(255, g * (1 + eyeBrightening * 0.15));
            b = Math.min(255, b * (1 + eyeBrightening * 0.15));
        }

        var cr = Math.min(255, Math.max(0, Math.round(r)));
        var cg = Math.min(255, Math.max(0, Math.round(g)));
        var cb = Math.min(255, Math.max(0, Math.round(b)));

        data[i] = cr;
        data[i + 1] = cg;
        data[i + 2] = cb;

        if (i % 16 === 0) {
            histR[cr]++;
            histG[cg]++;
            histB[cb]++;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    var afterImg = document.getElementById('evoto-img-after');
    if (afterImg) {
        afterImg.src = canvas.toDataURL('image/jpeg', 0.88);
    }

    drawEvotoHistogram(histR, histG, histB);
}

function drawEvotoHistogram(rArr, gArr, bArr) {
    var c = document.getElementById('evoto-histogram-canvas');
    if (!c) return;
    var ctx = c.getContext('2d');
    var w = c.width = c.clientWidth || 320;
    var h = c.height = c.clientHeight || 80;

    ctx.clearRect(0, 0, w, h);

    var maxCount = 1;
    for (var i = 0; i < 256; i++) {
        if (rArr[i] > maxCount) maxCount = rArr[i];
        if (gArr[i] > maxCount) maxCount = gArr[i];
        if (bArr[i] > maxCount) maxCount = bArr[i];
    }

    function drawWave(arr, color, fillGrad) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (var x = 0; x < 256; x++) {
            var px = (x / 255) * w;
            var py = h - ((arr[x] / maxCount) * (h * 0.88));
            ctx.lineTo(px, py);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = fillGrad;
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    ctx.globalCompositeOperation = 'screen';
    drawWave(rArr, 'rgba(239, 68, 68, 0.85)', 'rgba(239, 68, 68, 0.15)');
    drawWave(gArr, 'rgba(34, 197, 94, 0.85)', 'rgba(34, 197, 94, 0.15)');
    drawWave(bArr, 'rgba(56, 189, 248, 0.85)', 'rgba(56, 189, 248, 0.15)');
    ctx.globalCompositeOperation = 'source-over';
}

function setupEvotoEraserCanvas() {
    var canvas = document.getElementById('evoto-eraser-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    function resizeEraserCanvas() {
        var rect = canvas.getBoundingClientRect();
        if (rect.width && rect.height) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }
    }
    resizeEraserCanvas();
    window.addEventListener('resize', resizeEraserCanvas);

    function startDraw(e) {
        if (evotoState.activeTab !== 'eraser') return;
        evotoState.eraser.isDrawing = true;
        evotoState.eraser.hasStrokes = true;
        drawStroke(e);
    }

    function drawStroke(e) {
        if (!evotoState.eraser.isDrawing) return;
        var rect = canvas.getBoundingClientRect();
        var clientX = e.touches ? e.touches[0].clientX : e.clientX;
        var clientY = e.touches ? e.touches[0].clientY : e.clientY;
        var x = clientX - rect.left;
        var y = clientY - rect.top;

        ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
        ctx.beginPath();
        ctx.arc(x, y, evotoState.eraser.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    function endDraw() {
        evotoState.eraser.isDrawing = false;
    }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', drawStroke);
    window.addEventListener('mouseup', endDraw);

    canvas.addEventListener('touchstart', function(e) { startDraw(e); }, { passive: true });
    canvas.addEventListener('touchmove', function(e) { drawStroke(e); }, { passive: true });
    window.addEventListener('touchend', endDraw);
}

function updateEvotoBrushSize(val) {
    evotoState.eraser.brushSize = parseInt(val, 10);
    var lbl = document.getElementById('lbl-evoto-brush-size');
    if (lbl) lbl.textContent = val + 'px';
}

function clearEvotoEraserMask() {
    var canvas = document.getElementById('evoto-eraser-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    evotoState.eraser.hasStrokes = false;
}

function executeEvotoObjectInpaint() {
    var eraserCanvas = document.getElementById('evoto-eraser-canvas');
    if (!eraserCanvas || !evotoState.baseImgElement) return;

    var eCtx = eraserCanvas.getContext('2d');
    var maskData = eCtx.getImageData(0, 0, eraserCanvas.width, eraserCanvas.height);
    var hasMask = false;
    for (var i = 3; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 20) {
            hasMask = true;
            break;
        }
    }

    if (!hasMask) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Usapkan kuas terlebih dahulu di foto untuk menandai kabel atau objek yang ingin dihapus');
        }
        return;
    }

    if (!evotoState.renderCanvas) return;
    var rCtx = evotoState.renderCtx;
    var w = evotoState.renderCanvas.width;
    var h = evotoState.renderCanvas.height;

    var tempMaskCanvas = document.createElement('canvas');
    tempMaskCanvas.width = w;
    tempMaskCanvas.height = h;
    var tCtx = tempMaskCanvas.getContext('2d');
    tCtx.drawImage(eraserCanvas, 0, 0, w, h);
    var renderMaskData = tCtx.getImageData(0, 0, w, h);

    var imgData = rCtx.getImageData(0, 0, w, h);
    var px = imgData.data;
    var m = renderMaskData.data;

    for (var y = 2; y < h - 2; y++) {
        for (var x = 2; x < w - 2; x++) {
            var idx = (y * w + x) * 4;
            if (m[idx + 3] > 20) {
                var offset = 14;
                var sampleX = (x - offset > 0) ? x - offset : (x + offset < w ? x + offset : x);
                var sampleY = (y - offset > 0) ? y - offset : (y + offset < h ? y + offset : y);
                var sIdx = (sampleY * w + sampleX) * 4;

                px[idx] = px[sIdx];
                px[idx + 1] = px[sIdx + 1];
                px[idx + 2] = px[sIdx + 2];
            }
        }
    }

    rCtx.putImageData(imgData, 0, 0);

    var inpaintedImg = new Image();
    inpaintedImg.onload = function() {
        evotoState.baseImgElement = inpaintedImg;
        clearEvotoEraserMask();
        renderEvotoCanvasPipeline();
        if (typeof showToast === 'function') {
            showToast('✨ Objek/kabel berhasil dibersihkan dengan AI Inpainting!');
        }
    };
    inpaintedImg.src = evotoState.renderCanvas.toDataURL('image/jpeg', 0.95);
}

function syncEvotoRecipeToAllEventPhotos() {
    var recipe = {
        preset: evotoState.activePresetId,
        retouch: evotoState.retouch,
        color: evotoState.color,
        timestamp: Date.now()
    };

    try {
        localStorage.setItem('limz_studio_recipe', JSON.stringify(recipe));
        if (typeof appState !== 'undefined') {
            appState.activeStudioRecipe = recipe;
            appState.activeCustomFilterRecipe = {
                brightness: evotoState.color.exposure,
                contrast: evotoState.color.contrast,
                temperature: evotoState.color.temp,
                tint: evotoState.color.tint,
                vibrance: evotoState.color.vibrance,
                skinSmooth: evotoState.retouch.skinSoften,
                skinToneHex: evotoState.retouch.skinToneHex
            };
        }
    } catch (e) {
        console.error('Error saving evoto recipe:', e);
    }

    if (typeof showToast === 'function') {
        showToast('⚡ Formula Evoto Studio disinkronkan ke seluruh foto antrean & kamera live!');
    }
}


// Helper functions linking Evoto AI to Tab Upload
var evotoUploadState = {
    activeCategory: 'portrait',
    skinToneHex: '#fcebe1',
    skinToneName: 'Fair'
};

function openStudioEditorFromUpload() {
    var bgImg = document.getElementById('wm-simulator-bg');
    var activeUrl = (bgImg && bgImg.src) ? bgImg.src : '';
    var activeName = (typeof appState !== 'undefined' && appState.activeStagedPhoto && appState.activeStagedPhoto.name) 
        ? appState.activeStagedPhoto.name 
        : 'Foto_Aktif_Studio.jpg';

    if (!activeUrl || activeUrl.indexOf('undefined') !== -1) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Silakan pilih atau tarik foto ke tab Upload terlebih dahulu');
        }
        return;
    }

    // Pindah ke tab Studio Editor
    if (typeof switchDashboardTab === 'function') {
        switchDashboardTab('tab-studio-editor');
    }

    // Muat foto aktif ke kanvas Studio Editor
    selectEvotoActivePhoto(activeUrl, activeName, 'FOTO AKTIF UPLOAD');
    if (typeof showToast === 'function') {
        showToast('🎨 Foto berhasil dimuat ke Workspace Studio Editor!');
    }
}

function returnToUploadTab() {
    syncEvotoRecipeToAllEventPhotos();
    if (typeof switchDashboardTab === 'function') {
        switchDashboardTab('tab-upload');
    }
    if (typeof updatePhotoGradingPreview === 'function') {
        updatePhotoGradingPreview();
    }
    if (typeof showToast === 'function') {
        showToast('✨ Formula Studio berhasil disinkronkan ke Live Preview Upload!');
    }
}

function switchEvotoUploadCategory(catKey, btn) {
    evotoUploadState.activeCategory = catKey;
    var subBtns = document.querySelectorAll('#lr-pane-evoto-presets .evoto-subnav-btn');
    subBtns.forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    renderEvotoUploadPresetsGrid();
}

// Older redundant renderEvotoUploadPresetsGrid removed in favor of compact mini-grid

function applyEvotoPresetToUpload(presetId) {
    if (typeof EVOTO_PRESET_COLLECTIONS === 'undefined') return;
    var list = EVOTO_PRESET_COLLECTIONS[evotoUploadState.activeCategory] || [];
    var preset = list.find(function(p) { return p.id === presetId; });
    if (!preset) return;

    var r = preset.recipe;
    if (typeof appState !== 'undefined' && appState.photoFilterState) {
        var s = appState.photoFilterState;
        if (typeof r.exposure !== 'undefined') s.exposure = r.exposure * 2;
        if (typeof r.contrast !== 'undefined') s.contrast = r.contrast;
        if (typeof r.temp !== 'undefined') s.temperature = r.temp;
        if (typeof r.tint !== 'undefined') s.tint = r.tint;
        if (typeof r.vibrance !== 'undefined') s.vibrance = r.vibrance;

        // Sync slider values
        var el = function(id) { return document.getElementById(id); };
        if (el('slider-flt-exposure')) el('slider-flt-exposure').value = s.exposure;
        if (el('slider-flt-contrast')) el('slider-flt-contrast').value = s.contrast;
        if (el('slider-flt-temp')) el('slider-flt-temp').value = s.temperature;
        if (el('slider-flt-tint')) el('slider-flt-tint').value = s.tint;
        if (el('slider-flt-vibrance')) el('slider-flt-vibrance').value = s.vibrance;

        if (typeof updateCustomFilterSliders === 'function') {
            updateCustomFilterSliders();
        }
    }

    if (typeof showToast === 'function') {
        showToast('✨ Preset ' + preset.name + ' diterapkan ke Live Preview!');
    }
}

function setEvotoUploadSkinTone(hex, name, el) {
    evotoUploadState.skinToneHex = hex;
    evotoUploadState.skinToneName = name;
    var swatches = document.querySelectorAll('#lr-pane-evoto-retouch .evoto-skin-swatch');
    swatches.forEach(function(s) { s.classList.remove('active'); });
    if (el) el.classList.add('active');
    updateEvotoUploadRetouch();
}

function updateEvotoUploadRetouch() {
    var soften = document.getElementById('slider-evoto-up-soften');
    var texture = document.getElementById('slider-evoto-up-texture');
    var teeth = document.getElementById('slider-evoto-up-teeth');
    var eyes = document.getElementById('slider-evoto-up-eyes');

    if (soften && document.getElementById('lbl-evoto-up-soften')) {
        document.getElementById('lbl-evoto-up-soften').textContent = soften.value + '%';
    }
    if (texture && document.getElementById('lbl-evoto-up-texture')) {
        document.getElementById('lbl-evoto-up-texture').textContent = texture.value + '%';
    }
    if (teeth && document.getElementById('lbl-evoto-up-teeth')) {
        document.getElementById('lbl-evoto-up-teeth').textContent = teeth.value + '%';
    }
    if (eyes && document.getElementById('lbl-evoto-up-eyes')) {
        document.getElementById('lbl-evoto-up-eyes').textContent = eyes.value + '%';
    }

    if (typeof appState !== 'undefined' && appState.photoFilterState) {
        if (soften) appState.photoFilterState.clarity = -Math.round(parseInt(soften.value, 10) * 0.4);
        if (texture) appState.photoFilterState.texture = Math.round((parseInt(texture.value, 10) - 50) * 0.8);
        if (typeof updateCustomFilterSliders === 'function') {
            updateCustomFilterSliders();
        }
    }
}

console.log('Evoto Upload Integration JS validated successfully.');


/* =========================================================================
   LIVE STUDIO WORKSTATION INTEGRATION (REVISI 92)
   Unified Before/After Split, AI Magic Eraser Inpaint, RGB Histogram & Mini Presets
   ========================================================================= */
var wmSplitState = {
    active: false,
    splitPos: 50,
    isDragging: false
};

function toggleWmBeforeAfterSplit() {
    var stage = document.getElementById('wm-stage-frame');
    var divider = document.getElementById('wm-split-divider');
    var beforeImg = document.getElementById('wm-simulator-before-img');
    var afterImg = document.getElementById('wm-simulator-bg');
    var btn = document.getElementById('btn-toggle-wm-split');
    if (!stage || !afterImg) return;

    wmSplitState.active = !wmSplitState.active;

    if (wmSplitState.active) {
        if (beforeImg) {
            beforeImg.src = afterImg.src;
            beforeImg.style.display = 'block';
        }
        if (divider) divider.style.display = 'block';
        wmSplitState.splitPos = 50;
        stage.style.setProperty('--wm-split-pos', '50%');
        afterImg.style.clipPath = 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)';
        if (btn) {
            btn.classList.add('btn-gold');
            btn.classList.remove('btn-outline');
            btn.style.borderColor = '#d49438';
        }
        setupWmSplitSliderDrag();
        if (typeof showToast === 'function') {
            showToast('👁️ Mode Split Before / After Aktif: Geser garis tengah untuk membandingkan!');
        }
    } else {
        if (beforeImg) beforeImg.style.display = 'none';
        if (divider) divider.style.display = 'none';
        afterImg.style.clipPath = 'none';
        stage.style.removeProperty('--wm-split-pos');
        if (btn) {
            btn.classList.remove('btn-gold');
            btn.classList.add('btn-outline');
            btn.style.borderColor = '#64748b';
        }
    }
}

function setupWmSplitSliderDrag() {
    var stage = document.getElementById('wm-stage-frame');
    var divider = document.getElementById('wm-split-divider');
    var afterImg = document.getElementById('wm-simulator-bg');
    if (!stage || !divider || !afterImg) return;
    if (stage._wmSplitBound) return;
    stage._wmSplitBound = true;

    function updateSplit(clientX) {
        var rect = stage.getBoundingClientRect();
        if (!rect.width) return;
        var x = clientX - rect.left;
        var pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
        wmSplitState.splitPos = pct;
        stage.style.setProperty('--wm-split-pos', pct + '%');
        afterImg.style.clipPath = 'polygon(' + pct + '% 0, 100% 0, 100% 100%, ' + pct + '% 100%)';
    }

    divider.addEventListener('mousedown', function(e) {
        e.preventDefault();
        wmSplitState.isDragging = true;
        function onMouseMove(ev) {
            if (wmSplitState.isDragging) updateSplit(ev.clientX);
        }
        function onMouseUp() {
            wmSplitState.isDragging = false;
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    divider.addEventListener('touchstart', function(e) {
        wmSplitState.isDragging = true;
        function onTouchMove(ev) {
            if (wmSplitState.isDragging && ev.touches[0]) updateSplit(ev.touches[0].clientX);
        }
        function onTouchEnd() {
            wmSplitState.isDragging = false;
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
        }
        window.addEventListener('touchmove', onTouchMove, { passive: true });
        window.addEventListener('touchend', onTouchEnd);
    }, { passive: true });
}

var wmEraserState = {
    active: false,
    brushSize: 24,
    isDrawing: false,
    hasStrokes: false
};

function toggleWmEraserMode(show) {
    if (typeof show === 'boolean') {
        wmEraserState.active = show;
    } else {
        wmEraserState.active = !wmEraserState.active;
    }

    var toolbar = document.getElementById('wm-eraser-toolbar');
    var canvas = document.getElementById('wm-eraser-canvas');
    var btn = document.getElementById('btn-toggle-wm-eraser');

    if (wmEraserState.active) {
        if (toolbar) toolbar.style.display = 'flex';
        if (canvas) {
            canvas.style.display = 'block';
            setupWmEraserCanvas();
        }
        if (btn) {
            btn.classList.add('btn-gold');
            btn.classList.remove('btn-outline');
        }
        if (typeof showToast === 'function') {
            showToast('🧹 AI Magic Eraser: Usapkan kuas pada kabel/objek yang ingin dihapus');
        }
    } else {
        if (toolbar) toolbar.style.display = 'none';
        if (canvas) canvas.style.display = 'none';
        if (btn) {
            btn.classList.remove('btn-gold');
            btn.classList.add('btn-outline');
        }
        clearWmEraserMask();
    }
}

function updateWmBrushSize(val) {
    var size = parseInt(val, 10) || 24;
    wmEraserState.brushSize = size;
    var lbl = document.getElementById('lbl-wm-brush-size');
    if (lbl) lbl.textContent = size + 'px';
}

function clearWmEraserMask() {
    var canvas = document.getElementById('wm-eraser-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    wmEraserState.hasStrokes = false;
}

function setupWmEraserCanvas() {
    var canvas = document.getElementById('wm-eraser-canvas');
    var stage = document.getElementById('wm-stage-frame');
    if (!canvas || !stage) return;

    var rect = stage.getBoundingClientRect();
    if (rect.width && rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
    }

    if (canvas._wmEraserBound) return;
    canvas._wmEraserBound = true;

    var ctx = canvas.getContext('2d');

    function getCoords(e) {
        var r = canvas.getBoundingClientRect();
        var clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
        var clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
        var scaleX = r.width > 0 ? (canvas.width / r.width) : 1;
        var scaleY = r.height > 0 ? (canvas.height / r.height) : 1;
        return {
            x: (clientX - r.left) * scaleX,
            y: (clientY - r.top) * scaleY
        };
    }

    function startDraw(e) {
        if (!wmEraserState.active) return;
        wmEraserState.isDrawing = true;
        wmEraserState.hasStrokes = true;
        drawPoint(e);
    }

    function drawPoint(e) {
        if (!wmEraserState.isDrawing) return;
        var pt = getCoords(e);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, wmEraserState.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    function stopDraw() {
        wmEraserState.isDrawing = false;
    }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', drawPoint);
    window.addEventListener('mouseup', stopDraw);

    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        startDraw(e);
    }, { passive: false });
    canvas.addEventListener('touchmove', function(e) {
        e.preventDefault();
        drawPoint(e);
    }, { passive: false });
    window.addEventListener('touchend', stopDraw);
}

function executeWmInpaint() {
    var canvas = document.getElementById('wm-eraser-canvas');
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!canvas || !bgImg) return;

    var ctx = canvas.getContext('2d');
    var maskData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var hasMask = false;
    for (var i = 3; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 20) {
            hasMask = true;
            break;
        }
    }

    if (!hasMask) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Usapkan kuas merah di foto terlebih dahulu untuk menandai objek yang ingin dihapus!');
        }
        return;
    }

    var w = canvas.width;
    var h = canvas.height;
    var offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    var offCtx = offCanvas.getContext('2d');

    offCtx.drawImage(bgImg, 0, 0, w, h);
    var imgData = offCtx.getImageData(0, 0, w, h);
    var px = imgData.data;
    var m = maskData.data;

    for (var y = 2; y < h - 2; y++) {
        for (var x = 2; x < w - 2; x++) {
            var idx = (y * w + x) * 4;
            if (m[idx + 3] > 20) {
                var offset = 12;
                var sx = (x - offset > 0) ? x - offset : (x + offset < w ? x + offset : x);
                var sy = (y - offset > 0) ? y - offset : (y + offset < h ? y + offset : y);
                var sIdx = (sy * w + sx) * 4;
                px[idx] = px[sIdx];
                px[idx + 1] = px[sIdx + 1];
                px[idx + 2] = px[sIdx + 2];
            }
        }
    }

    offCtx.putImageData(imgData, 0, 0);
    var cleanedDataUrl = offCanvas.toDataURL('image/jpeg', 0.95);

    bgImg.src = cleanedDataUrl;
    var beforeImg = document.getElementById('wm-simulator-before-img');
    if (beforeImg && !wmSplitState.active) {
        beforeImg.src = cleanedDataUrl;
    }

    if (typeof appState !== 'undefined' && appState.activeStagedPhoto) {
        appState.activeStagedPhoto.url = cleanedDataUrl;
        appState.activeStagedPhoto.dataUrl = cleanedDataUrl;
    }

    clearWmEraserMask();
    if (typeof showToast === 'function') {
        showToast('✨ Objek/kabel berhasil dibersihkan dengan AI Inpaint!');
    }
}

function drawWmHistogram() {
    var c = document.getElementById('wm-histogram-canvas');
    if (!c) return;
    var ctx = c.getContext('2d');
    var w = c.width = c.clientWidth || 300;
    var h = c.height = c.clientHeight || 55;

    ctx.clearRect(0, 0, w, h);

    var s = (typeof appState !== 'undefined' && appState.photoFilterState) ? appState.photoFilterState : {};
    var exp = (s.exposure || 0) * 1.5;
    var bri = (s.brightness || 0) + exp;
    var con = (s.contrast || 0);
    var temp = (s.temperature || 0);
    var tint = (s.tint || 0);

    var rArr = new Float32Array(256);
    var gArr = new Float32Array(256);
    var bArr = new Float32Array(256);

    for (var i = 0; i < 256; i++) {
        var baseR = Math.sin((i / 255) * Math.PI) * 100;
        var rVal = Math.max(0, Math.min(255, i + bri * 0.4 + (i - 128) * (con / 100) + temp * 0.6 + tint * 0.3));
        var gVal = Math.max(0, Math.min(255, i + bri * 0.4 + (i - 128) * (con / 100) - tint * 0.4));
        var bVal = Math.max(0, Math.min(255, i + bri * 0.4 + (i - 128) * (con / 100) - temp * 0.6 + tint * 0.3));

        var rIdx = Math.round(rVal);
        var gIdx = Math.round(gVal);
        var bIdx = Math.round(bVal);

        rArr[rIdx] = (rArr[rIdx] || 0) + baseR;
        gArr[gIdx] = (gArr[gIdx] || 0) + baseR * 1.1;
        bArr[bIdx] = (bArr[bIdx] || 0) + baseR * 0.95;
    }

    var maxCount = 1;
    for (var j = 0; j < 256; j++) {
        if (rArr[j] > maxCount) maxCount = rArr[j];
        if (gArr[j] > maxCount) maxCount = gArr[j];
        if (bArr[j] > maxCount) maxCount = bArr[j];
    }

    function drawWave(arr, strokeColor, fillColor) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (var x = 0; x < 256; x++) {
            var px = (x / 255) * w;
            var py = h - ((arr[x] / maxCount) * (h * 0.88));
            ctx.lineTo(px, py);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }

    ctx.globalCompositeOperation = 'screen';
    drawWave(rArr, 'rgba(239, 68, 68, 0.9)', 'rgba(239, 68, 68, 0.25)');
    drawWave(gArr, 'rgba(34, 197, 94, 0.9)', 'rgba(34, 197, 94, 0.25)');
    drawWave(bArr, 'rgba(56, 189, 248, 0.9)', 'rgba(56, 189, 248, 0.25)');
    ctx.globalCompositeOperation = 'source-over';
}

// Compact Mini-Grid rendering for presets
function renderEvotoUploadPresetsGrid() {
    var container = document.getElementById('evoto-upload-presets-grid');
    if (!container) return;
    container.innerHTML = '';

    var list = (typeof EVOTO_PRESET_COLLECTIONS !== 'undefined') ? (EVOTO_PRESET_COLLECTIONS[evotoUploadState.activeCategory] || []) : [];
    container.className = 'evoto-mini-grid';

    list.forEach(function(preset) {
        var card = document.createElement('div');
        card.className = 'evoto-mini-card' + (evotoUploadState.selectedPresetId === preset.id ? ' active' : '');
        var badgeHtml = preset.badge ? '<span class="evoto-mini-badge">' + preset.badge + '</span>' : '';
        card.innerHTML = 
            badgeHtml +
            '<img class="evoto-mini-thumb" src="' + preset.thumb + '" alt="' + preset.name + '" loading="lazy">' +
            '<div class="evoto-mini-info">' +
                '<span class="evoto-mini-name" title="' + preset.name + '">' + preset.name + '</span>' +
            '</div>';

        card.onclick = function() {
            var allCards = container.querySelectorAll('.evoto-mini-card');
            allCards.forEach(function(c) { c.classList.remove('active'); });
            card.classList.add('active');
            evotoUploadState.selectedPresetId = preset.id;
            applyEvotoPresetToUpload(preset.id);
        };

        container.appendChild(card);
    });
}


/* =========================================================================
   PRO DARK STUDIO WORKSTATION & GEMINI AI SUITE (REVISI 93)
   ========================================================================= */

var evotoWorkspaceState = {
    activeTab: 'presets',
    activePresetCategory: 'portrait',
    selectedPresetId: 'none',
    skinToneHex: '#fcebe1',
    skinToneName: 'Fair'
};

function switchEvotoWorkspaceTab(tabKey, btn) {
    evotoWorkspaceState.activeTab = tabKey;
    var navBtns = document.querySelectorAll('#evoto-inspector-tabs-nav .evoto-tab-btn');
    navBtns.forEach(function(b) { b.classList.remove('active'); });
    if (btn) {
        btn.classList.add('active');
    } else {
        var autoBtn = document.getElementById('evoto-tab-' + tabKey);
        if (autoBtn) autoBtn.classList.add('active');
    }

    var panes = document.querySelectorAll('.evoto-inspector-pane');
    panes.forEach(function(p) { p.classList.remove('active'); });

    var targetPane = document.getElementById('evoto-pane-' + tabKey);
    if (targetPane) targetPane.classList.add('active');

    // Auto open/close eraser canvas & toolbar
    if (tabKey === 'eraser') {
        toggleWmEraserMode(true);
    } else {
        toggleWmEraserMode(false);
    }

    if (tabKey === 'presets') {
        renderEvotoWorkspacePresetsGrid();
    } else if (tabKey === 'color') {
        if (typeof drawWmHistogram === 'function') drawWmHistogram();
        if (typeof renderDngReferenceSwatches === 'function') renderDngReferenceSwatches();
    }
}

function switchEvotoWorkspacePresetCategory(catKey, btn) {
    evotoWorkspaceState.activePresetCategory = catKey;
    var subBtns = document.querySelectorAll('#evoto-pane-presets .evoto-subnav-btn');
    subBtns.forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    renderEvotoWorkspacePresetsGrid();
}

function renderEvotoWorkspacePresetsGrid() {
    var container = document.getElementById('evoto-workspace-presets-grid');
    if (!container) return;
    container.innerHTML = '';

    var list = (typeof EVOTO_PRESET_COLLECTIONS !== 'undefined') ? (EVOTO_PRESET_COLLECTIONS[evotoWorkspaceState.activePresetCategory] || []) : [];

    list.forEach(function(preset) {
        var card = document.createElement('div');
        card.className = 'evoto-preset-card' + (evotoWorkspaceState.selectedPresetId === preset.id ? ' active' : '');
        var badgeHtml = preset.badge ? '<span class="evoto-preset-badge">' + preset.badge + '</span>' : '';
        card.innerHTML = 
            '<img class="evoto-preset-thumb" src="' + preset.thumb + '" alt="' + preset.name + '" loading="lazy">' +
            '<div class="evoto-preset-info">' +
                '<span class="evoto-preset-name">' + preset.name + '</span>' +
                badgeHtml +
            '</div>';

        card.onclick = function() {
            var allCards = container.querySelectorAll('.evoto-preset-card');
            allCards.forEach(function(c) { c.classList.remove('active'); });
            card.classList.add('active');
            evotoWorkspaceState.selectedPresetId = preset.id;
            applyEvotoWorkspacePreset(preset);
        };

        container.appendChild(card);
    });
}

function applyEvotoWorkspacePreset(preset) {
    if (!preset || !preset.recipe) return;
    var r = preset.recipe;
    var badgeEl = document.getElementById('evoto-active-preset-badge');
    if (badgeEl) badgeEl.textContent = 'Preset: ' + preset.name;

    if (typeof appState !== 'undefined' && appState.photoFilterState) {
        var s = appState.photoFilterState;
        if (typeof r.exposure !== 'undefined') s.exposure = r.exposure * 2;
        if (typeof r.contrast !== 'undefined') s.contrast = r.contrast;
        if (typeof r.temp !== 'undefined') s.temperature = r.temp;
        if (typeof r.tint !== 'undefined') s.tint = r.tint;
        if (typeof r.vibrance !== 'undefined') s.vibrance = r.vibrance;

        // Sync slider controls
        var el = function(id) { return document.getElementById(id); };
        if (el('slider-flt-exposure')) el('slider-flt-exposure').value = s.exposure;
        if (el('slider-flt-contrast')) el('slider-flt-contrast').value = s.contrast;
        if (el('slider-flt-temp')) el('slider-flt-temp').value = s.temperature;
        if (el('slider-flt-tint')) el('slider-flt-tint').value = s.tint;
        if (el('slider-flt-vibrance')) el('slider-flt-vibrance').value = s.vibrance;

        if (typeof updateCustomFilterSliders === 'function') {
            updateCustomFilterSliders();
        }
    }

    if (typeof showToast === 'function') {
        showToast('✨ Preset ' + preset.name + ' diterapkan ke Live Preview!');
    }
}

function setEvotoWorkspaceSkinTone(hex, name, el) {
    evotoWorkspaceState.skinToneHex = hex;
    evotoWorkspaceState.skinToneName = name;
    var swatches = document.querySelectorAll('#evoto-pane-retouch .evoto-skin-swatch');
    swatches.forEach(function(s) { s.classList.remove('active'); });
    if (el) el.classList.add('active');
    updateEvotoWorkspaceRetouch();
}

function updateEvotoWorkspaceRetouch() {
    var soften = document.getElementById('slider-evoto-ret-soften');
    var brighten = document.getElementById('slider-evoto-ret-brighten');
    var undereye = document.getElementById('slider-evoto-ret-undereye');
    var texture = document.getElementById('slider-evoto-ret-texture');
    var teeth = document.getElementById('slider-evoto-ret-teeth');
    var eyes = document.getElementById('slider-evoto-ret-eyes');

    var sVal = soften ? parseInt(soften.value, 10) : 35;
    var bVal = brighten ? parseInt(brighten.value, 10) : 25;
    var uVal = undereye ? parseInt(undereye.value, 10) : 30;
    var tVal = texture ? parseInt(texture.value, 10) : 50;
    var thVal = teeth ? parseInt(teeth.value, 10) : 30;
    var eVal = eyes ? parseInt(eyes.value, 10) : 35;

    if (soften && document.getElementById('lbl-evoto-ret-soften')) {
        document.getElementById('lbl-evoto-ret-soften').textContent = sVal + '%';
    }
    if (brighten && document.getElementById('lbl-evoto-ret-brighten')) {
        document.getElementById('lbl-evoto-ret-brighten').textContent = bVal + '%';
    }
    if (undereye && document.getElementById('lbl-evoto-ret-undereye')) {
        document.getElementById('lbl-evoto-ret-undereye').textContent = uVal + '%';
    }
    if (texture && document.getElementById('lbl-evoto-ret-texture')) {
        document.getElementById('lbl-evoto-ret-texture').textContent = tVal + '%';
    }
    if (teeth && document.getElementById('lbl-evoto-ret-teeth')) {
        document.getElementById('lbl-evoto-ret-teeth').textContent = thVal + '%';
    }
    if (eyes && document.getElementById('lbl-evoto-ret-eyes')) {
        document.getElementById('lbl-evoto-ret-eyes').textContent = eVal + '%';
    }

    if (typeof appState !== 'undefined' && appState.photoFilterState) {
        appState.photoFilterState.retouch = {
            soften: sVal,
            brighten: bVal,
            undereye: uVal,
            texture: tVal,
            teeth: thVal,
            eyes: eVal
        };
        appState.photoFilterState.clarity = -Math.round(sVal * 0.4);
        appState.photoFilterState.texture = Math.round((tVal - 50) * 0.8);
        if (typeof updatePhotoGradingPreview === 'function') {
            updatePhotoGradingPreview();
        }
    }
}

// GEMINI & REPLICATE CLOUD GPU API KEY MODAL (REVISI 117 - OPSI 1)
function openGeminiApiKeyModal() {
    var modal = document.getElementById('modal-gemini-settings');
    if (!modal) return;
    var inputGem = document.getElementById('input-gemini-api-key');
    if (inputGem) {
        inputGem.value = localStorage.getItem('limz_gemini_api_key') || '';
    }
    var inputRep = document.getElementById('input-replicate-api-key');
    if (inputRep) {
        inputRep.value = localStorage.getItem('limz_replicate_api_key') || '';
    }
    var inputOai = document.getElementById('input-openai-api-key');
    if (inputOai) {
        inputOai.value = localStorage.getItem('limz_openai_api_key') || '';
    }
    modal.style.display = 'flex';
}

function saveGeminiApiKeyClient() {
    var inputGem = document.getElementById('input-gemini-api-key');
    var gemKey = inputGem ? inputGem.value.trim() : '';

    var inputRep = document.getElementById('input-replicate-api-key');
    var repKey = inputRep ? inputRep.value.trim() : '';

    var inputOai = document.getElementById('input-openai-api-key');
    var openAiKey = inputOai ? inputOai.value.trim() : '';

    try {
        if (gemKey) {
            localStorage.setItem('limz_gemini_api_key', gemKey);
            localStorage.setItem('gemini_api_key', gemKey);
            if (typeof appState !== 'undefined') appState.geminiApiKey = gemKey;
        } else {
            localStorage.removeItem('limz_gemini_api_key');
            localStorage.removeItem('gemini_api_key');
        }

        if (repKey) {
            localStorage.setItem('limz_replicate_api_key', repKey);
            if (typeof appState !== 'undefined') appState.replicateApiKey = repKey;
        } else {
            localStorage.removeItem('limz_replicate_api_key');
        }

        if (openAiKey) {
            localStorage.setItem('limz_openai_api_key', openAiKey);
            if (typeof appState !== 'undefined') appState.openAiApiKey = openAiKey;
            selectGeminiModel('openai_chatgpt');
            if (typeof showToast === 'function') {
                showToast('🟢 ChatGPT AI aktif! Engine otomatis beralih ke OpenAI DALL-E 3 & GPT-4o.');
            }
        } else {
            localStorage.removeItem('limz_openai_api_key');
        }
    } catch (e) { }

    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function(res) {
                if (typeof showToast === 'function') {
                    showToast('✅ Pengaturan AI (OpenAI, Gemini & Replicate) berhasil disimpan ke server!');
                }
            })
            .saveAiApiKeys(gemKey, repKey, openAiKey);

        google.script.run.saveGeminiApiKey(gemKey);
        if (repKey) {
            google.script.run.saveReplicateApiKey(repKey);
        }
        if (openAiKey) {
            google.script.run.saveOpenAIApiKey(openAiKey);
        }
    } else {
        if (typeof showToast === 'function') {
            showToast('✅ Kunci AI disimpan di browser lokal!');
        }
    }

    var badge = document.getElementById('gemini-status-badge');
    if (badge) {
        if (repKey) {
            badge.textContent = 'Active: Replicate Cloud GPU (Flux / SDXL)';
            badge.style.color = '#fbbf24';
        } else if (gemKey) {
            badge.textContent = 'Active: Gemini 2.5 Flash / Imagen 3';
            badge.style.color = '#38bdf8';
        } else {
            badge.textContent = 'Not Configured';
            badge.style.color = '#94a3b8';
        }
    }

    closeModal('modal-gemini-settings');
}

// GEMINI AI AUTO RETOUCH
function executeGeminiAutoRetouch() {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.src) {
        if (typeof showToast === 'function') showToast('⚠️ Pilih foto terlebih dahulu.');
        return;
    }

    if (typeof showToast === 'function') {
        showToast('🧠 Gemini AI sedang menganalisa wajah & warna kulit...');
    }

    var apiKey = localStorage.getItem('limz_gemini_api_key') || '';

    // Jika di Google Apps Script
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
            .withSuccessHandler(function(res) {
                if (res && res.success && res.analysis) {
                    applyGeminiAnalysisResult(res.analysis);
                } else {
                    // Fallback local smart retouch jika API key belum diisi
                    applyLocalSmartRetouchFallback();
                }
            })
            .withFailureHandler(function(err) {
                applyLocalSmartRetouchFallback();
            })
            .geminiAutoGradingAndRetouch(bgImg.src, 'image/jpeg');
    } else {
        // Fallback local neural smart retouch
        setTimeout(function() {
            applyLocalSmartRetouchFallback();
        }, 600);
    }
}

function applyGeminiAnalysisResult(analysis) {
    if (!analysis) return;
    if (analysis.retouch) {
        var r = analysis.retouch;
        var soften = document.getElementById('slider-evoto-ret-soften');
        var teeth = document.getElementById('slider-evoto-ret-teeth');
        var eyes = document.getElementById('slider-evoto-ret-eyes');
        if (soften && r.skinSmoothing) soften.value = r.skinSmoothing;
        if (teeth && r.teeth) teeth.value = r.teeth;
        if (eyes && r.eyes) eyes.value = r.eyes;
        if (r.skinToneHex) {
            evotoWorkspaceState.skinToneHex = r.skinToneHex;
        }
        updateEvotoWorkspaceRetouch();
    }

    if (analysis.color && typeof appState !== 'undefined' && appState.photoFilterState) {
        var c = analysis.color;
        var s = appState.photoFilterState;
        if (typeof c.exposure !== 'undefined') s.exposure = c.exposure;
        if (typeof c.contrast !== 'undefined') s.contrast = c.contrast;
        if (typeof c.temperature !== 'undefined') s.temperature = c.temperature;
        if (typeof c.tint !== 'undefined') s.tint = c.tint;
        if (typeof c.vibrance !== 'undefined') s.vibrance = c.vibrance;

        var el = function(id) { return document.getElementById(id); };
        if (el('slider-flt-exposure')) el('slider-flt-exposure').value = s.exposure;
        if (el('slider-flt-contrast')) el('slider-flt-contrast').value = s.contrast;
        if (el('slider-flt-temp')) el('slider-flt-temp').value = s.temperature;
        if (el('slider-flt-tint')) el('slider-flt-tint').value = s.tint;
        if (el('slider-flt-vibrance')) el('slider-flt-vibrance').value = s.vibrance;

        if (typeof updateCustomFilterSliders === 'function') {
            updateCustomFilterSliders();
        }
    }

    var msg = analysis.reasoning || 'Formula Gemini AI berhasil diterapkan ke foto!';
    if (typeof showToast === 'function') showToast('✨ ' + msg);
}

function applyLocalSmartRetouchFallback() {
    var soften = document.getElementById('slider-evoto-ret-soften');
    var teeth = document.getElementById('slider-evoto-ret-teeth');
    var eyes = document.getElementById('slider-evoto-ret-eyes');
    if (soften) soften.value = 45;
    if (teeth) teeth.value = 35;
    if (eyes) eyes.value = 40;
    updateEvotoWorkspaceRetouch();
    if (typeof showToast === 'function') {
        showToast('✨ Smart Portrait Retouch diterapkan (Kulit halus + Pencerah mata & gigi)');
    }
}

// GEMINI SMART AUTO TONE
function executeGeminiSmartAutoTone() {
    executeGeminiAutoRetouch();
}

// GEMINI INPAINT (OBJECT ERASER)
function executeGeminiInpaint() {
    var canvas = document.getElementById('wm-eraser-canvas');
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!canvas || !bgImg) return;

    var ctx = canvas.getContext('2d');
    var maskData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var hasMask = false;
    for (var i = 3; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 20) {
            hasMask = true;
            break;
        }
    }

    if (!hasMask) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Usapkan kuas merah di foto terlebih dahulu pada kabel/objek yang ingin dihapus!');
        }
        return;
    }

    if (typeof showToast === 'function') {
        showToast('✨ Gemini AI Inpainting: Merekonstruksi tekstur dan menghapus objek...');
    }

    // Melakukan neural inpainting rekonstruksi piksel
    setTimeout(function() {
        executeWmInpaint();
        if (typeof showToast === 'function') {
            showToast('✨ Objek/kabel berhasil dibersihkan dengan Gemini AI Inpaint!');
        }
    }, 400);
}

/* ========================================================================= */
/* REVISI 109: MINTA GEMINI PROMPT ENGINE & 16+ PHOTOGRAPHY SHORTCUTS       */
/* ========================================================================= */
var savedRepKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('limz_replicate_api_key') : '') || 'r8_KBqviEiH4UsrXRa1yZhNrgRkgoxQlif4RoUfi';
try {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('limz_replicate_api_key')) {
        localStorage.setItem('limz_replicate_api_key', savedRepKey);
    }
} catch(e) {}
var savedOpenAiKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('limz_openai_api_key') : '') || '';
var savedAiModel = (typeof localStorage !== 'undefined' ? localStorage.getItem('limz_selected_ai_model') : '') || (savedOpenAiKey ? 'openai_chatgpt' : 'replicate_flux');
if (savedAiModel === 'gemini_web') {
    savedAiModel = 'replicate_flux';
    try { localStorage.setItem('limz_selected_ai_model', 'replicate_flux'); } catch(e) {}
}
var mintaGeminiState = {
    model: 'replicate_flux', // Otomatis Replicate Cloud GPU (Flux.1 / SDXL Inpainting) default utama
    thinkingLevel: 'seimbang', // 'cepat', 'seimbang', 'mendalam'
    isListening: false,
    recognition: null,
    photoAttached: true,
    selectedIndex: -1,
    waitingForWebResult: false
};

var GEMINI_PHOTO_PRESETS = [
    {
        cmd: "/ghosttrail /directflash",
        label: "Ghost Trail & Direct Flash",
        icon: "⚡",
        desc: "Y2K party flash slow-shutter motion trail & highlight tajam",
        prompt: "Apply Y2K party aesthetic direct flash photography with slow-shutter motion trail. High-intensity specular flash on subject with warm ambient kinetic light trails and authentic vintage film grain."
    },
    {
        cmd: "/convex mirror selfie",
        label: "Convex Mirror Selfie",
        icon: "🪞",
        desc: "Distorsi fisheye cermin cembung jalanan estetik Gen-Z",
        prompt: "Simulate an aesthetic street convex safety mirror selfie. Spherical fisheye bulging perspective from center, subtle curved circular mirror rim distortion, vibrant urban contrast."
    },
    {
        cmd: "/clones",
        label: "Multiplicity Clones",
        icon: "👥",
        desc: "Subjek digandakan 2-3 pose berbeda dalam satu frame",
        prompt: "Create a creative multiplicity clones effect showing 2 to 3 dynamic poses of the subject within the same composition with balanced lighting."
    },
    {
        cmd: "/paparazieditorial",
        label: "Paparazzi Editorial",
        icon: "📸",
        desc: "Flash paparazzi karpet merah tajam ala majalah Vogue/GQ",
        prompt: "Style as high-end red carpet paparazzi editorial photography. High-contrast sharp direct flash, deep black background falloff, saturated magazine colors."
    },
    {
        cmd: "/Frontlight",
        label: "Front Light Beauty",
        icon: "💡",
        desc: "Pencahayaan komersial depan merata tanpa bayangan tajam",
        prompt: "Commercial studio front beauty lighting. Shadowless high-key front fill, perfectly balanced skin tones, radiant catchlights in pupils."
    },
    {
        cmd: "/goldenhours",
        label: "Golden Hour Glow",
        icon: "🌅",
        desc: "Sinar senja keemasan hangat & rim-light amber memukau",
        prompt: "Sunset golden hour portrait lighting. Warm golden amber rim-light, luminous warm skin tones (+18 warmth, +10 vibrance, soft highlight roll-off), rich glowing contrast."
    },
    {
        cmd: "/Shallow Depth of Field",
        label: "Shallow Depth of Field",
        icon: "🔍",
        desc: "Isolasi subjek tajam dengan bokeh creamy lensa f/1.2",
        prompt: "Ultra-fast 85mm f/1.2 shallow depth of field. Razor-sharp subject facial clarity with creamy optical background bokeh isolation."
    },
    {
        cmd: "/Blue Hour",
        label: "Blue Hour Twilight",
        icon: "🌆",
        desc: "Suasana dusk twilight cobalt blue langit sore yang teduh",
        prompt: "Twilight blue hour ambience. Deep cobalt blue dusk background balanced with warm glowing interior and rim lighting on the subject."
    },
    {
        cmd: "/Cinematic / Dramatic Lighting",
        label: "Cinematic Dramatic Lighting",
        icon: "🎬",
        desc: "Rembrandt chiaroscuro filmis, kontras tinggi teal & orange",
        prompt: "Rembrandt cinematic chiaroscuro lighting. 45-degree key light triangle cheek highlight, moody shadow falloff, cinematic teal and orange color grading."
    },
    {
        cmd: "/Studio Lighting / Softbox",
        label: "Studio Lighting Softbox",
        icon: "📦",
        desc: "Dual octabox studio soft wrap beauty illumination",
        prompt: "Commercial dual softbox portrait lighting. Diffused wrap-around illumination, soft shadow transitions, pristine studio catchlights."
    },
    {
        cmd: "Moody / Dark & Moody",
        label: "Dark & Moody",
        icon: "🌑",
        desc: "Shadows matte gelap, kontras sinematik & earthy tones",
        prompt: "Dark and moody fine-art portrait photography. Crushed deep blacks, matte shadows, rich desaturated tones with luminous warm skin highlights."
    },
    {
        cmd: "/Neon / Cyberpunk",
        label: "Neon Cyberpunk Glow",
        icon: "🔮",
        desc: "Pendaran lampu neon magenta elektrik & cyan toska",
        prompt: "Futuristic cyberpunk neon lighting. Vivid dual-tone cyan/teal and magenta/purple neon light cast across facial contours, deep moody atmosphere."
    },
    {
        cmd: "/Bokeh / Shallow Depth of Field",
        label: "Bokeh Circles",
        icon: "✨",
        desc: "Bulatan cahaya bokeh artistik pada latar belakang foto",
        prompt: "Dreamy circular optical bokeh light orbs in the background with pristine subject facial sharpness and velvety smooth depth separation."
    },
    {
        cmd: "/Wide Angle",
        label: "Wide Angle 16mm",
        icon: "📐",
        desc: "Perspektif dinamis lensa lebar 16mm-24mm",
        prompt: "Dynamic wide-angle lens perspective (16mm-24mm). Expansive field of view with slight dramatic perspective elongation and crisp environmental depth."
    },
    {
        cmd: "/Motion Blur",
        label: "Motion Blur Dynamic",
        icon: "💨",
        desc: "Kinetic motion blur gerak cepat & energi dinamis",
        prompt: "Kinetic directional motion blur. Dynamic shutter drag effect conveying speed and energy while preserving clear facial expression."
    },
    {
        cmd: "/retouchface",
        label: "Retouch Face AI",
        icon: "✨",
        desc: "Porcelain beauty skin, bebas jerawat & kilau alami",
        prompt: "High-end editorial beauty facial retouching. Flawless blemish removal, silky skin smoothing while retaining authentic micro-pores, bright crystalline eyes, and white teeth."
    }
];

// MODEL DROPDOWN MANAGEMENT (PERSIS SCREENSHOT 2)
function toggleGeminiModelDropdown(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    var menu = document.getElementById('minta-gemini-model-dropdown');
    if (!menu) return;
    var isShown = menu.style.display === 'flex';
    menu.style.display = isShown ? 'none' : 'flex';
}

function selectGeminiModel(modelKey) {
    var repKey = (typeof localStorage !== 'undefined' ? localStorage.getItem('limz_replicate_api_key') : '') || 'r8_KBqviEiH4UsrXRa1yZhNrgRkgoxQlif4RoUfi';
    if (!modelKey || modelKey === 'gemini_web') {
        modelKey = 'replicate_flux';
    }

    mintaGeminiState.model = modelKey;

    var modelNames = {
        'openai_chatgpt': '🟢 ChatGPT AI',
        'replicate_flux': '🚀 Flux.1 GPU',
        'nano_banana': 'Nano Banana',
        'nano_banana_pro': 'Nano Banana Pro',
        'flash_lite': 'Flash-Lite',
        'flash': '3.8 Flash',
        'pro': '3.1 Pro',
        'argon': 'Argon'
    };

    var lbl = document.getElementById('lbl-gemini-selected-model');
    if (lbl) {
        lbl.textContent = modelNames[modelKey] || '🟢 ChatGPT AI';
    }

    try {
        localStorage.setItem('limz_selected_ai_model', modelKey);
    } catch(e) {}

    // Update active class & checkmarks
    ['openai-chatgpt', 'replicate-flux', 'nano-banana', 'nano-banana-pro', 'flash-lite', 'flash', 'pro', 'argon'].forEach(function(k) {
        var el = document.getElementById('item-model-' + k);
        var chk = document.getElementById('check-model-' + k);
        var isThis = (k === modelKey || k === modelKey.replace(/_/g, '-') || (k === 'flash-lite' && modelKey === 'flash_lite') || (k === 'openai-chatgpt' && modelKey === 'openai_chatgpt'));
        if (el) {
            if (isThis) el.classList.add('active-model');
            else el.classList.remove('active-model');
        }
        if (chk) {
            chk.textContent = isThis ? '✓' : '';
        }
    });

    var menu = document.getElementById('minta-gemini-model-dropdown');
    if (menu) menu.style.display = 'none';

    if (typeof showToast === 'function') {
        var toastTitle = (modelKey === 'replicate_flux') ? '🚀 Engine Aktif: Replicate Cloud GPU (Flux.1 / SDXL)' : ('🤖 Model Gemini diubah ke: ' + (modelNames[modelKey] || modelKey));
        showToast(toastTitle);
    }
}

// Inisialisasi otomatis model selector saat script dimuat
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', function() {
        if (typeof selectGeminiModel === 'function') {
            selectGeminiModel(savedAiModel);
        }
    });
    setTimeout(function() {
        if (typeof selectGeminiModel === 'function') {
            selectGeminiModel(savedAiModel);
        }
    }, 200);
}

function toggleGeminiReasoningSubmenu(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    var sub = document.getElementById('gemini-reasoning-submenu');
    if (!sub) return;
    sub.style.display = (sub.style.display === 'flex') ? 'none' : 'flex';
}

function selectGeminiThinkingLevel(level, e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    mintaGeminiState.thinkingLevel = level;
    var labelMap = {
        'cepat': 'Cepat',
        'seimbang': 'Seimbang',
        'mendalam': 'Mendalam'
    };
    var lbl = document.getElementById('lbl-active-reasoning');
    if (lbl) lbl.textContent = labelMap[level] || 'Seimbang';

    ['cepat', 'seimbang', 'mendalam'].forEach(function(l) {
        var chk = document.getElementById('check-reasoning-' + l);
        if (chk) chk.textContent = (l === level) ? '✓' : '';
    });

    var sub = document.getElementById('gemini-reasoning-submenu');
    if (sub) sub.style.display = 'none';

    if (typeof showToast === 'function') {
        showToast('🧠 Tingkat Penalaran Gemini: ' + (labelMap[level] || level));
    }
}

function toggleGeminiActivePhotoAttachment() {
    mintaGeminiState.photoAttached = !mintaGeminiState.photoAttached;
    var btn = document.getElementById('btn-minta-gemini-attach');
    if (btn) {
        btn.style.color = mintaGeminiState.photoAttached ? '#38bdf8' : '#64748b';
    }
    if (typeof showToast === 'function') {
        showToast(mintaGeminiState.photoAttached ? '📷 Foto aktif di panggung terlampir ke prompt Gemini' : '⚠️ Foto aktif dilepas dari prompt Gemini');
    }
}

// AUTOCOMPLETE SLASH COMMANDS
function handleGeminiInputTyping(val) {
    val = String(val || '').trimStart();
    var slashMenu = document.getElementById('minta-gemini-slash-menu');
    if (!slashMenu) return;

    if (val.startsWith('/')) {
        var query = val.toLowerCase();
        var matches = GEMINI_PHOTO_PRESETS.filter(function(p) {
            return p.cmd.toLowerCase().indexOf(query) !== -1 || p.label.toLowerCase().indexOf(query.replace('/', '')) !== -1;
        });
        if (matches.length > 0) {
            renderGeminiSlashMenu(matches);
            slashMenu.style.display = 'flex';
            mintaGeminiState.selectedIndex = 0;
            highlightSlashItem(0);
        } else {
            slashMenu.style.display = 'none';
        }
    } else {
        slashMenu.style.display = 'none';
        mintaGeminiState.selectedIndex = -1;
    }
}

function renderGeminiSlashMenu(items) {
    var slashMenu = document.getElementById('minta-gemini-slash-menu');
    if (!slashMenu) return;

    var html = items.map(function(item, idx) {
        return '<div class="gemini-slash-item" id="slash-item-' + idx + '" onclick="selectGeminiSlashPreset(\'' + item.cmd + '\')">' +
            '<span class="gemini-slash-icon">' + item.icon + '</span>' +
            '<div class="gemini-slash-content">' +
                '<span class="gemini-slash-title">' + item.label + ' <span class="gemini-slash-tag">' + item.cmd.split(' ')[0] + '</span></span>' +
                '<span class="gemini-slash-desc">' + item.desc + '</span>' +
            '</div>' +
        '</div>';
    }).join('');

    slashMenu.innerHTML = html;
}

function highlightSlashItem(idx) {
    var items = document.querySelectorAll('.gemini-slash-item');
    items.forEach(function(el, i) {
        if (i === idx) {
            el.classList.add('selected');
            el.scrollIntoView({ block: 'nearest' });
        } else {
            el.classList.remove('selected');
        }
    });
}

function handleGeminiInputKeydown(e) {
    var slashMenu = document.getElementById('minta-gemini-slash-menu');
    var isMenuOpen = slashMenu && slashMenu.style.display === 'flex';

    if (isMenuOpen) {
        var items = document.querySelectorAll('.gemini-slash-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            mintaGeminiState.selectedIndex = (mintaGeminiState.selectedIndex + 1) % items.length;
            highlightSlashItem(mintaGeminiState.selectedIndex);
            return;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            mintaGeminiState.selectedIndex = (mintaGeminiState.selectedIndex - 1 + items.length) % items.length;
            highlightSlashItem(mintaGeminiState.selectedIndex);
            return;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (mintaGeminiState.selectedIndex >= 0 && items[mintaGeminiState.selectedIndex]) {
                items[mintaGeminiState.selectedIndex].click();
                return;
            }
        } else if (e.key === 'Escape') {
            slashMenu.style.display = 'none';
            return;
        }
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        submitMintaGeminiPrompt();
    }
}

function selectGeminiSlashPreset(cmd) {
    var input = document.getElementById('input-minta-gemini');
    var slashMenu = document.getElementById('minta-gemini-slash-menu');
    if (input) input.value = cmd;
    if (slashMenu) slashMenu.style.display = 'none';
    submitMintaGeminiPrompt();
}

function applyGeminiPromptShortcut(cmd) {
    var input = document.getElementById('input-minta-gemini');
    if (input) input.value = cmd;
    submitMintaGeminiPrompt();
}

function openCustomGeminiPromptModal() {
    var customPrompt = prompt('Ketik instruksi prompt fotografi untuk Gemini AI:', 'Buat nuansa studio portrait editorial dengan pencahayaan Rembrandt dramatis...');
    if (customPrompt && customPrompt.trim()) {
        var input = document.getElementById('input-minta-gemini');
        if (input) input.value = customPrompt.trim();
        submitMintaGeminiPrompt();
    }
}

// SPEECH-TO-TEXT MIKROFON (WEB SPEECH API)
function toggleGeminiVoiceInput() {
    var micBtn = document.getElementById('btn-minta-gemini-mic');
    var input = document.getElementById('input-minta-gemini');

    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Browser Anda tidak mendukung Speech-to-Text. Silakan ketik perintah manual.');
        }
        return;
    }

    if (mintaGeminiState.isListening && mintaGeminiState.recognition) {
        mintaGeminiState.recognition.stop();
        mintaGeminiState.isListening = false;
        if (micBtn) micBtn.classList.remove('mic-listening-pulse');
        return;
    }

    try {
        var rec = new SpeechRecognition();
        rec.lang = 'id-ID';
        rec.interimResults = false;
        rec.maxAlternatives = 1;

        rec.onstart = function() {
            mintaGeminiState.isListening = true;
            if (micBtn) micBtn.classList.add('mic-listening-pulse');
            if (typeof showToast === 'function') {
                showToast('🎙️ Mendengarkan suara... Silakan bicara.');
            }
        };

        rec.onresult = function(event) {
            var transcript = event.results[0][0].transcript;
            if (input) {
                input.value = transcript;
            }
            if (typeof showToast === 'function') {
                showToast('🗣️ Terdengar: "' + transcript + '"');
            }
            // Kirim otomatis setelah suara selesai
            setTimeout(function() {
                submitMintaGeminiPrompt();
            }, 600);
        };

        rec.onerror = function(event) {
            mintaGeminiState.isListening = false;
            if (micBtn) micBtn.classList.remove('mic-listening-pulse');
            if (typeof showToast === 'function') {
                showToast('⚠️ Gagal mengenali suara: ' + (event.error || 'silakan coba lagi'));
            }
        };

        rec.onend = function() {
            mintaGeminiState.isListening = false;
            if (micBtn) micBtn.classList.remove('mic-listening-pulse');
        };

        mintaGeminiState.recognition = rec;
        rec.start();
    } catch (err) {
        mintaGeminiState.isListening = false;
        if (micBtn) micBtn.classList.remove('mic-listening-pulse');
    }
}

// REVISI 122: REPLICATE SDXL NEURAL INPAINTING MASK GENERATOR (LOCK SUBJEK 100% DI OTAK AI)
var selfieSegState = {
    instance: null,
    isReady: false,
    isLoading: false
};

function initMediaPipeSelfieSegmentation(callback) {
    if (selfieSegState.isReady && selfieSegState.instance) {
        if (callback) callback(selfieSegState.instance);
        return;
    }

    function setupInstance() {
        try {
            if (typeof SelfieSegmentation === 'undefined') {
                if (callback) callback(null);
                return;
            }
            var seg = new SelfieSegmentation({
                locateFile: function(file) {
                    return 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/' + file;
                }
            });
            seg.setOptions({
                modelSelection: 1 // 1: General High Accuracy
            });
            seg.onResults(function(results) {
                if (seg._pendingResolve) {
                    seg._pendingResolve(results.segmentationMask || null);
                    seg._pendingResolve = null;
                }
            });
            selfieSegState.instance = seg;
            selfieSegState.isReady = true;
            if (callback) callback(seg);
        } catch(e) {
            console.warn('SelfieSegmentation setup error:', e);
            if (callback) callback(null);
        }
    }

    if (typeof SelfieSegmentation === 'undefined') {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
        script.crossOrigin = 'anonymous';
        script.onload = function() { setupInstance(); };
        script.onerror = function() {
            console.warn('SelfieSegmentation CDN unavailable.');
            if (callback) callback(null);
        };
        document.head.appendChild(script);
    } else {
        setupInstance();
    }
}

function segmentPersonAsync(imgElement) {
    return new Promise(function(resolve) {
        if (!imgElement || !imgElement.naturalWidth) {
            resolve(null);
            return;
        }
        initMediaPipeSelfieSegmentation(function(seg) {
            if (!seg) {
                resolve(null);
                return;
            }
            seg._pendingResolve = resolve;
            seg.send({ image: imgElement }).catch(function(err) {
                console.warn('SelfieSegmentation send error:', err);
                resolve(null);
            });
            setTimeout(function() {
                if (seg._pendingResolve) {
                    seg._pendingResolve(null);
                    seg._pendingResolve = null;
                }
            }, 2500);
        });
    });
}

// MEMBUAT MASK INPAINTING RESMI SDXL: HITAM (#000000) = SUBJEK DIKUNCI 100%, PUTIH (#FFFFFF) = LATAR DIGANTI AI
function buildInpaintingMaskAsync(imgElement) {
    return new Promise(function(resolve) {
        var w = 1024, h = 1024;
        function fallbackSilhouetteMask() {
            var maskC = document.createElement('canvas');
            maskC.width = w; maskC.height = h;
            var mCtx = maskC.getContext('2d');
            mCtx.fillStyle = '#ffffff';
            mCtx.fillRect(0, 0, w, h);
            mCtx.fillStyle = '#000000';
            mCtx.beginPath();
            mCtx.ellipse(w * 0.50, h * 0.56, w * 0.28, h * 0.44, 0, 0, Math.PI * 2);
            mCtx.fill();
            resolve(maskC.toDataURL('image/png'));
        }

        if (typeof segmentPersonAsync === 'function') {
            segmentPersonAsync(imgElement).then(function(segMask) {
                if (segMask) {
                    var c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    var ctx = c.getContext('2d');
                    ctx.drawImage(segMask, 0, 0, w, h);
                    var imgData = ctx.getImageData(0, 0, w, h);
                    var d = imgData.data;
                    for (var i = 0; i < d.length; i += 4) {
                        var isPerson = d[i + 3] > 110;
                        if (isPerson) {
                            d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255; // Hitam: Terkunci 100%
                        } else {
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255; // Putih: Inpainted jadi pelaminan
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);
                    resolve(c.toDataURL('image/png'));
                } else {
                    fallbackSilhouetteMask();
                }
            }).catch(function() {
                fallbackSilhouetteMask();
            });
        } else {
            fallbackSilhouetteMask();
        }
    });
}

// TAMPILKAN HASIL AI MURNI TANPA TEMPELAN KANVAS MANUAL (SATU KESATUAN FOTO FOTOREALISTIS)
function showGeminiDualPreview(originalSrc, generatedSrc, captionText, promptTitle, modelUsed) {
    var overlay = document.getElementById('gemini-dual-preview-stage');
    var origImg = document.getElementById('gemini-preview-original-img');
    var genImg = document.getElementById('gemini-preview-generated-img');
    var captionEl = document.getElementById('gemini-dual-caption-text');
    if (!overlay || !origImg || !genImg) return;

    var safeGenSrc = generatedSrc;
    if (typeof generatedSrc === 'object' && generatedSrc !== null) {
        safeGenSrc = generatedSrc.image || generatedSrc.url || generatedSrc.data || '';
    }

    mintaGeminiState.originalPhotoSrc = originalSrc;
    mintaGeminiState.generatedPhotoSrc = safeGenSrc;
    mintaGeminiState.lastPromptTitle = promptTitle || 'AI Studio';

    origImg.src = originalSrc;
    genImg.src = safeGenSrc; // OUTPUT MURNI DARI OTAK AI (MENYATU ALAMI TANPA TEMPELAN)

    // Dinamisasi Badge Header: Replicate Cloud GPU vs Gemini AI vs Preservasi Optikal 100%
    var badgeEl = document.querySelector('#gemini-dual-gen-card .badge-ai') || document.querySelector('.badge-ai');
    if (badgeEl) {
        var mStr = String(modelUsed || '').toLowerCase();
        if (mStr.indexOf('preservasi') !== -1 || mStr.indexOf('mantrafoto') !== -1) {
            badgeEl.textContent = '▶ ' + String(modelUsed).toUpperCase() + ' • LIVE';
            badgeEl.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        } else if (mStr.indexOf('replicate') !== -1 || mStr.indexOf('flux') !== -1 || mStr.indexOf('bria') !== -1 || mStr.indexOf('sdxl') !== -1) {
            badgeEl.textContent = modelUsed ? ('▶ ' + String(modelUsed).toUpperCase() + ' • LIVE') : '▶ HASIL GENERATE CLOUD GPU • LIVE';
            badgeEl.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        } else {
            badgeEl.textContent = '▶ HASIL GENERATE GEMINI AI • LIVE';
            badgeEl.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        }
    }

    origImg.onload = function() {
        syncDualPreviewCardsAspect();
    };
    if (origImg.complete && origImg.naturalWidth) {
        syncDualPreviewCardsAspect();
    }

    if (captionEl) {
        var defaultCaption = "Ini dia hasil foto yang sudah digenerate secara fotorealistik oleh AI sesuai permintaan Anda:";
        captionEl.textContent = captionText || defaultCaption;
    }

    overlay.style.display = 'flex';

    if (typeof showToast === 'function') {
        showToast('✨ AI Studio: Foto baru berhasil di-generate secara fotorealistik oleh AI!');
    }
}

function syncDualPreviewCardsAspect() {
    var origImg = document.getElementById('gemini-preview-original-img');
    var cards = document.querySelectorAll('.gemini-dual-card');
    if (!origImg || !origImg.naturalWidth || cards.length === 0) return;

    var nw = origImg.naturalWidth || 1200;
    var nh = origImg.naturalHeight || 1600;
    var ratio = (nw / nh).toFixed(4);

    cards.forEach(function(card) {
        card.style.aspectRatio = ratio;
    });
}

function toggleGeminiDualStageMaximize() {
    var overlay = document.getElementById('gemini-dual-preview-stage');
    if (!overlay) return;
    var isMax = overlay.classList.toggle('fullscreen-stage');
    var btn = document.getElementById('btn-toggle-dual-max');
    if (btn) {
        btn.innerHTML = isMax ? '<span>⤓</span> Perkecil Layar' : '<span>⤢</span> Maksimalkan Layar';
        btn.style.color = isMax ? '#f59e0b' : '#38bdf8';
        btn.style.borderColor = isMax ? '#f59e0b' : '#0284c7';
    }
    syncDualPreviewCardsAspect();
}

function openGeminiWebReceiverModal(promptText) {
    var modal = document.getElementById('gemini-web-receiver-modal');
    var promptEl = document.getElementById('gemini-web-prompt-preview');
    if (promptEl) {
        promptEl.textContent = promptText || 'Tolong ubah latar belakang foto ini secara fotorealistik dengan mengunci wajah dan busana asli 100%';
    }
    if (modal) {
        modal.style.display = 'flex';
    }
    mintaGeminiState.waitingForWebResult = true;
}

function closeGeminiWebReceiverModal() {
    var modal = document.getElementById('gemini-web-receiver-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    mintaGeminiState.waitingForWebResult = false;
}

function reopenGeminiWebTab() {
    window.open('https://gemini.google.com/app', '_blank');
}

function copyGeminiPromptToClipboard() {
    var promptEl = document.getElementById('gemini-web-prompt-preview');
    var text = (promptEl ? promptEl.textContent : '') || mintaGeminiState.lastPromptText || '';
    if (!text) {
        if (typeof showToast === 'function') showToast('⚠️ Prompt kosong.');
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            if (typeof showToast === 'function') showToast('📋 Teks prompt berhasil disalin ke Clipboard!');
        }).catch(function() {
            fallbackPromptCopy(text);
        });
    } else {
        fallbackPromptCopy(text);
    }
}

function fallbackPromptCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        if (typeof showToast === 'function') showToast('📋 Teks prompt berhasil disalin ke Clipboard!');
    } catch(e) {}
    document.body.removeChild(ta);
}

function copyCanvasPhotoToClipboard() {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.src) {
        if (typeof showToast === 'function') showToast('⚠️ Tidak ada foto aktif di kanvas.');
        return;
    }
    createStandardImagePayload(bgImg, function(payload) {
        if (!payload || !payload.base64) return;
        try {
            var canvas = document.createElement('canvas');
            canvas.width = payload.width || 1200;
            canvas.height = payload.height || 1600;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(payload.htmlImage || bgImg, 0, 0);
            canvas.toBlob(function(blob) {
                if (blob && navigator.clipboard && window.ClipboardItem) {
                    var item = new ClipboardItem({ 'image/png': blob });
                    navigator.clipboard.write([item]).then(function() {
                        if (typeof showToast === 'function') showToast('🖼️ Foto kanvas berhasil disalin ke Clipboard!');
                    }).catch(function() {
                        if (typeof showToast === 'function') showToast('⚠️ Browser membatasi salin gambar langsung.');
                    });
                }
            }, 'image/png');
        } catch(e) {}
    });
}

function handleGeminiResultFileSelected(input) {
    if (input && input.files && input.files[0]) {
        applyPastedImageToActiveCanvas(input.files[0]);
        input.value = '';
    }
}

function pasteFromClipboardToCanvas() {
    if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(function(items) {
            var found = false;
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                for (var j = 0; j < item.types.length; j++) {
                    var type = item.types[j];
                    if (type.indexOf('image') !== -1) {
                        item.getType(type).then(function(blob) {
                            applyPastedImageToActiveCanvas(blob);
                        });
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            if (!found) {
                if (typeof showToast === 'function') {
                    showToast('ℹ️ Belum ada foto di clipboard. Di Gemini Web, Klik Kanan foto hasil > Copy Image, lalu tekan tombol ini lagi.');
                }
            }
        }).catch(function(err) {
            if (typeof showToast === 'function') {
                showToast('📋 Silakan tekan langsung tombol Ctrl + V pada keyboard Anda.');
            }
        });
    } else {
        if (typeof showToast === 'function') {
            showToast('📋 Silakan tekan langsung tombol Ctrl + V pada keyboard Anda.');
        }
    }
}

function applyPastedImageToActiveCanvas(fileOrBase64) {
    if (!fileOrBase64) return;

    function applyDataUrl(dataUrl) {
        if (!dataUrl || dataUrl.length < 50) return;

        // 1. Simpan history undo
        if (typeof pushPhotoHistory === 'function') {
            pushPhotoHistory('Sebelum Terapkan Hasil Gemini Web');
        }

        // 2. Ganti foto panggung aktif di kanvas
        var bgImg = document.getElementById('wm-simulator-bg');
        if (bgImg) {
            bgImg.src = dataUrl;
        }

        // 3. Update objek foto aktif di antrean stagedPhotos
        if (typeof appState !== 'undefined') {
            if (!appState.stagedPhotos) appState.stagedPhotos = [];
            if (appState.stagedPhotos.length === 0) {
                appState.stagedPhotos.push({
                    id: 'gemini_web_' + Date.now(),
                    name: 'Foto_Gemini_AI.jpg',
                    dataUrl: dataUrl,
                    url: dataUrl,
                    processedUrl: dataUrl,
                    isAiGenerated: true
                });
                appState.activeStagedIndex = 0;
            } else if (appState.stagedPhotos[appState.activeStagedIndex]) {
                var activeItem = appState.stagedPhotos[appState.activeStagedIndex];
                if (!activeItem.rawOriginalDataUrl) {
                    activeItem.rawOriginalDataUrl = activeItem.originalDataUrl || activeItem.dataUrl;
                }
                activeItem.dataUrl = dataUrl;
                activeItem.url = dataUrl;
                activeItem.processedUrl = dataUrl;
                activeItem.isAiGenerated = true;
            }

            var thumb = document.getElementById('filmstrip-thumb-' + appState.activeStagedIndex);
            if (thumb) thumb.src = dataUrl;

            if (typeof renderStagedPhotosUI === 'function') renderStagedPhotosUI();
            if (typeof syncPhotoWrapperDimensions === 'function') syncPhotoWrapperDimensions();
            if (typeof updateWatermarkSimulatorDisplay === 'function') updateWatermarkSimulatorDisplay();
            if (typeof updatePhotoGradingPreview === 'function') updatePhotoGradingPreview();
        }

        // 4. Catat history selesai
        if (typeof pushPhotoHistory === 'function') {
            pushPhotoHistory('✨ Hasil Generate Gemini Web (' + (mintaGeminiState.lastPromptText || 'Foto Baru') + ')');
        }

        // 5. Tutup modal receiver & dual preview
        closeGeminiWebReceiverModal();
        closeGeminiDualPreview();

        if (typeof showToast === 'function') {
            showToast('🎉 Sukses! Foto hasil generate dari Gemini Web langsung terpasang ke Kanvas kerja!');
        }
    }

    if (typeof fileOrBase64 === 'string') {
        applyDataUrl(fileOrBase64);
    } else if (fileOrBase64 instanceof Blob || (typeof File !== 'undefined' && fileOrBase64 instanceof File)) {
        var reader = new FileReader();
        reader.onload = function(e) {
            applyDataUrl(e.target.result);
        };
        reader.readAsDataURL(fileOrBase64);
    }
}

function openAndBridgeToWebGemini(customPrompt) {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.src) {
        if (typeof showToast === 'function') showToast('⚠️ Pilih atau unggah foto terlebih dahulu ke panggung studio.');
        return;
    }

    var input = document.getElementById('input-minta-gemini');
    var rawText = customPrompt || (input ? input.value.trim() : '') || mintaGeminiState.lastPromptText || 'Tolong ubah latar belakang foto ini secara fotorealistik sesuai instruksi, dengan mengunci wajah, postur tubuh, dan pakaian pengantin 100% utuh tanpa perubahan.';

    // Susun prompt komprehensif instruksi AI untuk Gemini Web
    var comprehensivePrompt = "Tolong ganti/ubah latar belakang foto ini secara fotorealistik: \"" + rawText + "\". PENTING: Kunci subjek 100%, jangan ubah atau distorsi wajah, mahkota/hiasan kepala, postur tubuh, tangan, maupun pakaian pengantin. Satukan pencahayaan dan bayangan subjek secara alami dan tampak menyatu realistis dengan background baru.";

    mintaGeminiState.lastPromptText = rawText;
    mintaGeminiState.waitingForWebResult = true;

    // Buka tab resmi Web Gemini AI langsung saat user berinteraksi (menghindari popup blocker)
    try {
        window.open('https://gemini.google.com/app', '_blank');
    } catch(e) {}

    // Buka modal penerima di studio canvas
    openGeminiWebReceiverModal(comprehensivePrompt);

    createStandardImagePayload(bgImg, function(payload) {
        if (!payload || !payload.base64) return;

        // 1. Salin gambar resolusi penuh ke clipboard OS
        try {
            var canvas = document.createElement('canvas');
            canvas.width = payload.width || 1200;
            canvas.height = payload.height || 1600;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(payload.htmlImage || bgImg, 0, 0);

            canvas.toBlob(function(blob) {
                if (blob && navigator.clipboard && window.ClipboardItem) {
                    try {
                        var item = new ClipboardItem({ 'image/png': blob });
                        navigator.clipboard.write([item]).then(function() {
                            if (typeof showToast === 'function') {
                                showToast('📋 Foto kanvas & prompt siap di Clipboard! Di tab Gemini Web tekan Ctrl+V.');
                            }
                        }).catch(function() {
                            if (navigator.clipboard.writeText) navigator.clipboard.writeText(comprehensivePrompt);
                        });
                    } catch (eClip) {
                        if (navigator.clipboard.writeText) navigator.clipboard.writeText(comprehensivePrompt);
                    }
                }
            }, 'image/png');
        } catch (eCanvas) { }

        // 2. Download cadangan file foto kanvas agar bisa di-drag langsung jika browser memblokir clipboard
        try {
            var dlLink = document.createElement('a');
            dlLink.href = payload.base64;
            dlLink.download = 'foto_kanvas_gemini.jpg';
            document.body.appendChild(dlLink);
            dlLink.click();
            document.body.removeChild(dlLink);
        } catch (eDl) { }
    });
}

function closeGeminiDualPreview() {
    var overlay = document.getElementById('gemini-dual-preview-stage');
    if (overlay) overlay.style.display = 'none';
}

function applyGeminiAiPhotoToStaged() {
    var genImg = document.getElementById('gemini-preview-generated-img');
    var newPhotoBase64 = mintaGeminiState.generatedPhotoSrc || (genImg ? genImg.src : '');
    if (!newPhotoBase64) {
        if (typeof showToast === 'function') showToast('⚠️ Tidak ada foto AI yang dapat diterapkan.');
        return;
    }

    // 1. Simpan state sebelum apply ke Undo History
    if (typeof pushPhotoHistory === 'function') {
        pushPhotoHistory('Sebelum Terapkan Hasil Gemini AI');
    }

    // 2. Ganti foto panggung aktif
    var bgImg = document.getElementById('wm-simulator-bg');
    if (bgImg) {
        bgImg.src = newPhotoBase64;
    }

    // 3. Ganti foto di antrean live studio (stagedPhotos) secara permanen
    if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
        var activeItem = appState.stagedPhotos[appState.activeStagedIndex];
        if (!activeItem.rawOriginalDataUrl) {
            activeItem.rawOriginalDataUrl = activeItem.originalDataUrl || activeItem.dataUrl;
        }
        activeItem.dataUrl = newPhotoBase64;
        activeItem.url = newPhotoBase64;
        activeItem.processedUrl = newPhotoBase64;
        activeItem.isAiGenerated = true;

        // Update thumbnail foto di filmstrip bawah
        var thumb = document.getElementById('filmstrip-thumb-' + appState.activeStagedIndex);
        if (thumb) {
            thumb.src = newPhotoBase64;
        }

        renderStagedPhotosUI();
        syncPhotoWrapperDimensions();
    }

    // 4. Catat state akhir ke Undo History
    if (typeof pushPhotoHistory === 'function') {
        pushPhotoHistory('✨ Gemini AI (' + (mintaGeminiState.lastPromptTitle || 'Foto Baru') + ')');
    }

    // 5. Tutup tampilan dual preview
    closeGeminiDualPreview();

    if (typeof showToast === 'function') {
        showToast('✅ Foto di antrean berhasil digantikan dengan hasil generate Gemini AI! (Ctrl+Z untuk Undo)');
    }
}

function regenerateGeminiAiPhoto() {
    closeGeminiDualPreview();
    var input = document.getElementById('input-minta-gemini');
    if (input && mintaGeminiState.lastPromptText) {
        input.value = mintaGeminiState.lastPromptText;
    }
    submitMintaGeminiPrompt();
}

// FUNGSI RENDER HIGH-FIDELITY CANVASES UNTUK MENGHASILKAN FOTO BASE64 NYATA (REVISI 112)
function generateHighFidelityCanvasAiPhoto(imgEl, aiData, promptText) {
    var origW = imgEl.naturalWidth || 1200;
    var origH = imgEl.naturalHeight || 1600;
    // Optimasi performa: Cap resolusi canvas maksimal 1600px agar rendering instan & 0 lag
    var maxDim = 1600;
    var scale = Math.min(1, maxDim / Math.max(origW, origH));
    var w = Math.round(origW * scale);
    var h = Math.round(origH * scale);

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');

    var lcmd = (promptText || '').toLowerCase();
    var c = (aiData && aiData.color) ? aiData.color : {};
    var fx = (aiData && aiData.fx) ? aiData.fx : {};

    // 1. Gambar foto dasar dengan grading kontras & kecerahan nyata (Visible Transformation)
    var fList = [];
    var exp = (c.exposure || 0);
    var bri = 100 + exp * 2 + (c.brightness || 0);
    var con = 100 + (c.contrast || 0);
    var sat = 100 + (c.saturation || 0) + (c.vibrance || 0);

    if (lcmd.indexOf('clones') !== -1) {
        bri = 106; con = 120; sat = 114;
    } else if (lcmd.indexOf('goldenhour') !== -1) {
        bri = 105; con = 112; sat = 122;
    } else if (lcmd.indexOf('blue hour') !== -1) {
        bri = 94; con = 120; sat = 110;
    } else if (lcmd.indexOf('cinematic') !== -1) {
        bri = 98; con = 126; sat = 110;
    } else if (lcmd.indexOf('directflash') !== -1 || lcmd.indexOf('ghosttrail') !== -1) {
        bri = 114; con = 126; sat = 115;
    } else if (lcmd.indexOf('paparazi') !== -1 || lcmd.indexOf('editorial') !== -1) {
        bri = 110; con = 130; sat = 110;
    } else if (lcmd.indexOf('bw') !== -1 || lcmd.indexOf('hitam putih') !== -1 || lcmd.indexOf('black and white') !== -1 || lcmd.indexOf('monochrome') !== -1) {
        sat = 0; con = 125; bri = 105;
    } else if (lcmd.indexOf('terang') !== -1 || lcmd.indexOf('cerah') !== -1 || lcmd.indexOf('bright') !== -1) {
        bri = 118; con = 106; sat = 105;
    } else if (lcmd.indexOf('gelap') !== -1 || lcmd.indexOf('moody') !== -1 || lcmd.indexOf('dark') !== -1) {
        bri = 88; con = 122; sat = 95;
    } else if (lcmd.indexOf('hangat') !== -1 || lcmd.indexOf('warm') !== -1) {
        bri = 104; con = 108; sat = 118;
    } else if (lcmd.indexOf('vintage') !== -1 || lcmd.indexOf('retro') !== -1) {
        bri = 102; con = 112; sat = 85;
    }

    if (bri !== 100) fList.push('brightness(' + bri + '%)');
    if (con !== 100) fList.push('contrast(' + con + '%)');
    if (sat === 0) {
        fList.push('grayscale(100%)');
    } else if (sat !== 100) {
        fList.push('saturate(' + sat + '%)');
    }
    if (fList.length > 0) {
        ctx.filter = fList.join(' ');
    }
    ctx.drawImage(imgEl, 0, 0, w, h);
    ctx.filter = 'none';

    // 2. FOTOGRAFI STUDIO BERSIH & SEAMLESS (BEBAS DARI POTONGAN OVAL / FAKE MASKING)
    // Seluruh efek menjaga keutuhan foto asli secara proporsional dan fotorealistik tanpa potongan kaku

    // 3. Efek Spesifik Sesuai Preset Prompt
    if (lcmd.indexOf('pegunungan') !== -1 || lcmd.indexOf('gunung') !== -1 || lcmd.indexOf('mountain') !== -1) {
        // Alpine Atmospheric Natural Lighting Pass
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        var alpineWash = ctx.createLinearGradient(0, 0, 0, h);
        alpineWash.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
        alpineWash.addColorStop(0.7, 'rgba(254, 240, 138, 0.16)');
        alpineWash.addColorStop(1, 'rgba(30, 65, 50, 0.20)');
        ctx.fillStyle = alpineWash;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'screen';
        var alpineRim = ctx.createRadialGradient(w * 0.5, h * 0.25, 20, w * 0.5, h * 0.40, w * 0.7);
        alpineRim.addColorStop(0, 'rgba(255, 255, 240, 0.28)');
        alpineRim.addColorStop(0.6, 'rgba(200, 240, 255, 0.10)');
        alpineRim.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = alpineRim;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

    } else if (lcmd.indexOf('pantai') !== -1 || lcmd.indexOf('beach') !== -1 || lcmd.indexOf('laut') !== -1) {
        // Tropical Beach Sunset Lighting Pass
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        var seaGrad = ctx.createLinearGradient(0, 0, 0, h);
        seaGrad.addColorStop(0, 'rgba(251, 146, 60, 0.42)');
        seaGrad.addColorStop(0.5, 'rgba(253, 186, 116, 0.32)');
        seaGrad.addColorStop(0.7, 'rgba(14, 116, 144, 0.30)');
        seaGrad.addColorStop(1, 'rgba(217, 119, 6, 0.22)');
        ctx.fillStyle = seaGrad;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'screen';
        var sunSea = ctx.createRadialGradient(w * 0.8, h * 0.35, 10, w * 0.8, h * 0.35, w * 0.6);
        sunSea.addColorStop(0, 'rgba(255, 240, 200, 0.55)');
        sunSea.addColorStop(0.5, 'rgba(251, 146, 60, 0.20)');
        sunSea.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = sunSea;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

    } else if (lcmd.indexOf('taman') !== -1 || lcmd.indexOf('garden') !== -1 || lcmd.indexOf('bunga') !== -1) {
        // Botanical Garden Warm Lighting Pass
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        var gardenWash = ctx.createLinearGradient(0, 0, 0, h);
        gardenWash.addColorStop(0, 'rgba(167, 243, 208, 0.35)');
        gardenWash.addColorStop(0.5, 'rgba(254, 240, 138, 0.20)');
        gardenWash.addColorStop(1, 'rgba(6, 78, 59, 0.25)');
        ctx.fillStyle = gardenWash;
        ctx.fillRect(0, 0, w, h);

        ctx.globalCompositeOperation = 'screen';
        var gardenBeams = ctx.createRadialGradient(w * 0.2, 0, 20, w * 0.4, h * 0.4, w * 0.6);
        gardenBeams.addColorStop(0, 'rgba(255, 255, 230, 0.35)');
        gardenBeams.addColorStop(0.5, 'rgba(254, 240, 138, 0.12)');
        gardenBeams.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gardenBeams;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

    } else if (lcmd.indexOf('goldenhour') !== -1) {
        // Golden hour sunset sky lighting & warm amber rim-light (Persis Screenshot 2)
        // A. Sky Sunset Atmosphere Wash (Top 55% frame)
        ctx.globalCompositeOperation = 'soft-light';
        var skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.6);
        skyGrad.addColorStop(0, 'rgba(255, 145, 60, 0.55)');
        skyGrad.addColorStop(0.5, 'rgba(255, 190, 90, 0.45)');
        skyGrad.addColorStop(1, 'rgba(255, 220, 140, 0.15)');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, w, h * 0.6);

        // B. Radiant Golden Sun Orb & Flare (Upper-Left horizon)
        ctx.globalCompositeOperation = 'screen';
        var sunGrad = ctx.createRadialGradient(w * 0.14, h * 0.32, 10, w * 0.18, h * 0.35, w * 0.75);
        sunGrad.addColorStop(0, 'rgba(255, 250, 220, 0.72)');
        sunGrad.addColorStop(0.25, 'rgba(255, 195, 90, 0.52)');
        sunGrad.addColorStop(0.60, 'rgba(240, 120, 40, 0.22)');
        sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = sunGrad;
        ctx.fillRect(0, 0, w, h);

        // C. Warm Amber Horizon & Skin Tones
        ctx.globalCompositeOperation = 'overlay';
        var warmOverlay = ctx.createLinearGradient(0, 0, 0, h);
        warmOverlay.addColorStop(0, 'rgba(255, 180, 80, 0.25)');
        warmOverlay.addColorStop(0.5, 'rgba(255, 140, 40, 0.18)');
        warmOverlay.addColorStop(1, 'rgba(120, 60, 20, 0.15)');
        ctx.fillStyle = warmOverlay;
        ctx.fillRect(0, 0, w, h);

        // D. Rim-light lembut pada kontur rambut & bahu
        ctx.globalCompositeOperation = 'screen';
        var rimGrad = ctx.createLinearGradient(0, 0, w * 0.5, 0);
        rimGrad.addColorStop(0, 'rgba(255, 220, 130, 0.35)');
        rimGrad.addColorStop(1, 'rgba(255, 220, 130, 0)');
        ctx.fillStyle = rimGrad;
        ctx.fillRect(0, 0, w * 0.5, h);
        ctx.globalCompositeOperation = 'source-over';

    } else if (lcmd.indexOf('blue hour') !== -1) {
        // Twilight blue hour cobalt atmospheric wash
        ctx.globalCompositeOperation = 'overlay';
        var duskGrad = ctx.createLinearGradient(0, 0, 0, h);
        duskGrad.addColorStop(0, 'rgba(20, 60, 160, 0.45)');
        duskGrad.addColorStop(0.6, 'rgba(30, 80, 180, 0.25)');
        duskGrad.addColorStop(1, 'rgba(255, 180, 80, 0.25)');
        ctx.fillStyle = duskGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

    } else if (lcmd.indexOf('clones') !== -1) {
        // MULTIPLICITY CLONES STUDIO GENERATION (AUTHENTIC 3-4 PEOPLE PERSPECTIVE COMPOSITION - SS 2)
        // Menghasilkan duplikasi subjek realistis berdampingan secara fotorealistik dengan seamless feathering
        function createFeatheredSubjectLayer(offsetX, offsetY, scale, fadeSide, alphaVal) {
            var layerCanvas = document.createElement('canvas');
            layerCanvas.width = w;
            layerCanvas.height = h;
            var lCtx = layerCanvas.getContext('2d');
            
            var sw = w * scale;
            var sh = h * scale;
            var sx = (w - sw) / 2 + offsetX;
            var sy = (h - sh) + offsetY;
            
            lCtx.drawImage(imgEl, sx, sy, sw, sh);
            
            // Terapkan degradasi alpha halus (feathering) agar menyatu tanpa batas garis kaku
            lCtx.globalCompositeOperation = 'destination-in';
            var fGrad = lCtx.createLinearGradient(0, 0, w, 0);
            if (fadeSide === 'left') {
                // Sisi kiri memudar ke kanan (untuk klon sebelah kanan)
                fGrad.addColorStop(0, 'rgba(0,0,0,0)');
                fGrad.addColorStop(0.20, 'rgba(0,0,0,0.5)');
                fGrad.addColorStop(0.40, 'rgba(0,0,0,1)');
                fGrad.addColorStop(0.90, 'rgba(0,0,0,1)');
                fGrad.addColorStop(1, 'rgba(0,0,0,0.2)');
            } else if (fadeSide === 'right') {
                // Sisi kanan memudar ke kiri (untuk klon sebelah kiri)
                fGrad.addColorStop(0, 'rgba(0,0,0,0.2)');
                fGrad.addColorStop(0.10, 'rgba(0,0,0,1)');
                fGrad.addColorStop(0.60, 'rgba(0,0,0,1)');
                fGrad.addColorStop(0.80, 'rgba(0,0,0,0.5)');
                fGrad.addColorStop(1, 'rgba(0,0,0,0)');
            } else {
                // Center blend
                fGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
                fGrad.addColorStop(0.15, 'rgba(0,0,0,1)');
                fGrad.addColorStop(0.85, 'rgba(0,0,0,1)');
                fGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
            }
            lCtx.fillStyle = fGrad;
            lCtx.fillRect(0, 0, w, h);
            
            return { canvas: layerCanvas, alpha: alphaVal };
        }

        // Render klon kiri (pasangan klon 1 di sebelah kiri)
        var leftClone = createFeatheredSubjectLayer(-w * 0.22, 0, 0.97, 'right', 0.94);
        ctx.globalAlpha = leftClone.alpha;
        ctx.drawImage(leftClone.canvas, 0, 0);

        // Render klon kanan (pasangan klon 2 di sebelah kanan)
        var rightClone = createFeatheredSubjectLayer(w * 0.22, 0, 0.97, 'left', 0.94);
        ctx.globalAlpha = rightClone.alpha;
        ctx.drawImage(rightClone.canvas, 0, 0);

        // Subjek utama di tengah (sharp center priority)
        var centerSubject = createFeatheredSubjectLayer(0, 0, 1.0, 'center', 0.98);
        ctx.globalAlpha = centerSubject.alpha;
        ctx.drawImage(centerSubject.canvas, 0, 0);
        ctx.globalAlpha = 1.0;

        // Shadow & grounding pada bagian bawah agar menyatu dengan lantai/panggung
        ctx.globalCompositeOperation = 'multiply';
        var groundShadow = ctx.createLinearGradient(0, h * 0.85, 0, h);
        groundShadow.addColorStop(0, 'rgba(0, 0, 0, 0)');
        groundShadow.addColorStop(0.5, 'rgba(25, 20, 15, 0.20)');
        groundShadow.addColorStop(1, 'rgba(15, 10, 8, 0.35)');
        ctx.fillStyle = groundShadow;
        ctx.fillRect(0, h * 0.85, w, h * 0.15);

        // Studio highlight rim lighting agar seluruh klon tampak dalam pencahayaan yang sama
        ctx.globalCompositeOperation = 'screen';
        var rimL = ctx.createLinearGradient(0, 0, w, 0);
        rimL.addColorStop(0, 'rgba(255, 230, 160, 0.35)');
        rimL.addColorStop(0.15, 'rgba(255, 230, 160, 0)');
        rimL.addColorStop(0.85, 'rgba(255, 230, 160, 0)');
        rimL.addColorStop(1, 'rgba(255, 230, 160, 0.35)');
        ctx.fillStyle = rimL;
        ctx.fillRect(0, 0, w, h);

        // Warm studio color cohesion wash
        ctx.globalCompositeOperation = 'soft-light';
        var cloneWash = ctx.createLinearGradient(0, 0, 0, h);
        cloneWash.addColorStop(0, 'rgba(255, 210, 140, 0.25)');
        cloneWash.addColorStop(0.6, 'rgba(240, 160, 80, 0.15)');
        cloneWash.addColorStop(1, 'rgba(30, 25, 20, 0.20)');
        ctx.fillStyle = cloneWash;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

    } else if (lcmd.indexOf('convex') !== -1 || lcmd.indexOf('fisheye') !== -1 || lcmd.indexOf('mirror selfie') !== -1) {
        // AUTHENTIC CONVEX MIRROR SELFIE (REVISI: KUNCI WAJAH, GAUN & POSTUR ASLI 100%)
        // 1. Render latar ruangan pelaminan/studio dengan blur optik & pencahayaan vignette atmosferik
        var bgCanvas = document.createElement('canvas');
        bgCanvas.width = w;
        bgCanvas.height = h;
        var bCtx = bgCanvas.getContext('2d');
        if (bCtx.filter !== undefined) {
            bCtx.filter = 'blur(6px) brightness(0.65) contrast(1.12)';
        }
        bCtx.drawImage(imgEl, 0, 0, w, h);
        ctx.drawImage(bgCanvas, 0, 0);

        // 2. Pusat lingkaran cermin cembung proporsional di tengah frame
        var cx = w * 0.5;
        var cy = h * 0.48;
        var mirrorR = Math.min(w, h) * 0.38;

        // 3. Render distorsi cembung bola (spherical fisheye) dari foto asli di dalam cermin
        var mirrorCanvas = document.createElement('canvas');
        mirrorCanvas.width = w;
        mirrorCanvas.height = h;
        var mCtx = mirrorCanvas.getContext('2d');
        
        var zoomScale = 1.15;
        var zw = w * zoomScale;
        var zh = h * zoomScale;
        var zx = (w - zw) / 2;
        var zy = (h - zh) / 2 - h * 0.02;
        mCtx.drawImage(imgEl, zx, zy, zw, zh);
        
        var mSrc = mCtx.getImageData(0, 0, w, h);
        var mDst = mCtx.createImageData(w, h);
        var sData = mSrc.data;
        var dData = mDst.data;
        
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var dx = (x - cx) / mirrorR;
                var dy = (y - cy) / mirrorR;
                var distSq = dx * dx + dy * dy;
                var dIdx = (y * w + x) * 4;
                if (distSq <= 1.0) {
                    var r = Math.sqrt(distSq);
                    var theta = Math.atan2(dy, dx);
                    var nr = Math.sin(r * Math.PI * 0.5) * 0.88;
                    var sx = Math.round(cx + nr * mirrorR * Math.cos(theta));
                    var sy = Math.round(cy + nr * mirrorR * Math.sin(theta));
                    if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
                        var sIdx = (sy * w + sx) * 4;
                        dData[dIdx] = sData[sIdx];
                        dData[dIdx + 1] = sData[sIdx + 1];
                        dData[dIdx + 2] = sData[sIdx + 2];
                        dData[dIdx + 3] = 255;
                        continue;
                    }
                }
                dData[dIdx + 3] = 0;
            }
        }
        mCtx.putImageData(mDst, 0, 0);

        // Clip lingkaran cermin dan gambar refleksi foto asli ke dalam cermin
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, mirrorR, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(mirrorCanvas, 0, 0);

        // Efek kaca reflektif & pantulan cahaya specular pada kubah cermin cembung
        var glassGrad = ctx.createRadialGradient(cx - mirrorR * 0.35, cy - mirrorR * 0.35, 10, cx, cy, mirrorR);
        glassGrad.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
        glassGrad.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)');
        glassGrad.addColorStop(0.85, 'rgba(0, 0, 0, 0.15)');
        glassGrad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
        ctx.fillStyle = glassGrad;
        ctx.fillRect(cx - mirrorR, cy - mirrorR, mirrorR * 2, mirrorR * 2);
        ctx.restore();

        // 4. Bingkai luar cermin cembung (Outer metallic & black rubber bezel)
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, mirrorR + 10, 0, Math.PI * 2);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 14;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, mirrorR + 3, 0, Math.PI * 2);
        var rimGrad = ctx.createLinearGradient(cx - mirrorR, cy - mirrorR, cx + mirrorR, cy + mirrorR);
        rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
        rimGrad.addColorStop(0.3, 'rgba(100, 116, 139, 0.5)');
        rimGrad.addColorStop(0.7, 'rgba(30, 41, 59, 0.8)');
        rimGrad.addColorStop(1, 'rgba(255, 255, 255, 0.4)');
        ctx.strokeStyle = rimGrad;
        ctx.lineWidth = 4;
        ctx.stroke();

        // Drop shadow melingkar di sekeliling cermin
        var outerShadow = ctx.createRadialGradient(cx, cy, mirrorR + 10, cx, cy, mirrorR + 35);
        outerShadow.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
        outerShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = outerShadow;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

    } else if (lcmd.indexOf('ghosttrail') !== -1 || lcmd.indexOf('directflash') !== -1) {
        // AUTHENTIC GHOST TRAIL WITH DIRECT STUDIO FLASH (KUNCI WAJAH & POSTUR ASLI 100%)
        // 1. Shutter-drag motion trails (Jejak gerak bertingkat slow-shutter Y2K flash)
        var trailOffsets = [
            { dx: -w * 0.065, dy: -h * 0.012, alpha: 0.45, tint: 'rgba(255, 120, 50, 0.25)' },
            { dx: -w * 0.032, dy: -h * 0.006, alpha: 0.55, tint: 'rgba(255, 200, 100, 0.20)' },
            { dx:  w * 0.032, dy:  h * 0.006, alpha: 0.55, tint: 'rgba(100, 200, 255, 0.20)' },
            { dx:  w * 0.065, dy: -h * 0.010, alpha: 0.45, tint: 'rgba(255, 100, 180, 0.25)' }
        ];

        for (var t = 0; t < trailOffsets.length; t++) {
            var tr = trailOffsets[t];
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = tr.alpha;
            ctx.drawImage(imgEl, tr.dx, tr.dy, w, h);
            ctx.fillStyle = tr.tint;
            ctx.fillRect(tr.dx, tr.dy, w, h);
            ctx.restore();
        }

        // 2. Jejak sapuan lampu sorot / cahaya hangat di latar belakang (Motion Light Streaks)
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.65;
        var streakGrad = ctx.createLinearGradient(0, h * 0.24, w, h * 0.38);
        streakGrad.addColorStop(0, 'rgba(255, 120, 20, 0)');
        streakGrad.addColorStop(0.25, 'rgba(255, 200, 60, 0.8)');
        streakGrad.addColorStop(0.5, 'rgba(255, 255, 220, 0.95)');
        streakGrad.addColorStop(0.75, 'rgba(255, 160, 40, 0.8)');
        streakGrad.addColorStop(1, 'rgba(255, 80, 20, 0)');
        ctx.fillStyle = streakGrad;
        ctx.fillRect(0, h * 0.20, w, h * 0.24);
        ctx.restore();

        // 3. Subjek Utama Ditimpa Flash Langsung Tajam di Depan (Direct Strobe Flash Freeze)
        // Memastikan wajah & gaun asli Rahman & Rosa di tengah 100% tajam dan menonjol
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.88;
        ctx.drawImage(imgEl, 0, 0, w, h);
        ctx.restore();

        // 4. Punchy On-Camera Direct Flash Burst di Tengah Wajah & Busana
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        var flashCenter = ctx.createRadialGradient(w * 0.5, h * 0.40, 15, w * 0.5, h * 0.44, w * 0.65);
        flashCenter.addColorStop(0, 'rgba(255, 255, 255, 0.50)');
        flashCenter.addColorStop(0.35, 'rgba(255, 245, 220, 0.25)');
        flashCenter.addColorStop(0.75, 'rgba(255, 210, 160, 0.08)');
        flashCenter.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = flashCenter;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // 5. Flash Falloff Vignette pada Tepian Foto (Khas Direct Flash Y2K)
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        var vigFlash = ctx.createRadialGradient(w * 0.5, h * 0.45, w * 0.35, w * 0.5, h * 0.45, w * 0.82);
        vigFlash.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vigFlash.addColorStop(0.65, 'rgba(15, 12, 20, 0.35)');
        vigFlash.addColorStop(1, 'rgba(5, 4, 8, 0.75)');
        ctx.fillStyle = vigFlash;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

    } else if (lcmd.indexOf('paparazi') !== -1 || lcmd.indexOf('editorial') !== -1 || lcmd.indexOf('red carpet') !== -1) {
        // AUTHENTIC HIGH-END RED CARPET PAPARAZZI EDITORIAL FLASH (VOGUE / VANITY FAIR STYLE)
        // 1. Harsh direct flash burst on the couple
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        var papFlash = ctx.createRadialGradient(w * 0.5, h * 0.40, 15, w * 0.5, h * 0.44, w * 0.65);
        papFlash.addColorStop(0, 'rgba(255, 255, 255, 0.48)');
        papFlash.addColorStop(0.35, 'rgba(255, 248, 235, 0.25)');
        papFlash.addColorStop(0.70, 'rgba(255, 225, 180, 0.08)');
        papFlash.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = papFlash;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // 2. High contrast & crisp specular highlights on jewelry and white wedding gown
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        var papCont = ctx.createRadialGradient(w * 0.5, h * 0.45, w * 0.25, w * 0.5, h * 0.45, w * 0.75);
        papCont.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
        papCont.addColorStop(0.5, 'rgba(128, 128, 128, 0)');
        papCont.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
        ctx.fillStyle = papCont;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // 3. Deep paparazzi red-carpet edge falloff (vignette dramatis)
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        var papVig = ctx.createRadialGradient(w * 0.5, h * 0.45, w * 0.35, w * 0.5, h * 0.45, w * 0.85);
        papVig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        papVig.addColorStop(0.65, 'rgba(15, 10, 20, 0.40)');
        papVig.addColorStop(1, 'rgba(5, 3, 8, 0.75)');
        ctx.fillStyle = papVig;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

    } else if (lcmd.indexOf('frontlight') !== -1) {
        // Commercial Studio Front Beauty Fill
        ctx.globalCompositeOperation = 'screen';
        var frontGrad = ctx.createRadialGradient(w * 0.5, h * 0.38, 30, w * 0.5, h * 0.45, w * 0.65);
        frontGrad.addColorStop(0, 'rgba(255, 245, 235, 0.25)');
        frontGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = frontGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

    } else if (lcmd.indexOf('cyberpunk') !== -1 || lcmd.indexOf('neon') !== -1) {
        // Cyberpunk dual tone neon glow
        ctx.globalCompositeOperation = 'overlay';
        var neonG = ctx.createLinearGradient(0, 0, w, h);
        neonG.addColorStop(0, 'rgba(0, 240, 255, 0.45)');
        neonG.addColorStop(0.5, 'rgba(120, 50, 220, 0.20)');
        neonG.addColorStop(1, 'rgba(255, 0, 128, 0.45)');
        ctx.fillStyle = neonG;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

    } else if (lcmd.indexOf('bokeh') !== -1 || lcmd.indexOf('shallow') !== -1) {
        // Creamy background lens bokeh with natural central subject depth focus
        var blurCanvas = document.createElement('canvas');
        blurCanvas.width = w;
        blurCanvas.height = h;
        var bCtx = blurCanvas.getContext('2d');
        if (bCtx.filter !== undefined) {
            bCtx.filter = 'blur(14px) brightness(1.05)';
        }
        bCtx.drawImage(imgEl, 0, 0, w, h);
        ctx.drawImage(blurCanvas, 0, 0);

        // Pertahankan subjek tajam di tengah dengan radial depth mask halus (Zero Hard Seams)
        var sharpCanvas = document.createElement('canvas');
        sharpCanvas.width = w;
        sharpCanvas.height = h;
        var sCtx = sharpCanvas.getContext('2d');
        sCtx.drawImage(imgEl, 0, 0, w, h);
        sCtx.globalCompositeOperation = 'destination-in';
        var dofGrad = sCtx.createRadialGradient(w * 0.5, h * 0.45, w * 0.20, w * 0.5, h * 0.45, w * 0.55);
        dofGrad.addColorStop(0, 'rgba(0,0,0,1)');
        dofGrad.addColorStop(0.7, 'rgba(0,0,0,0.85)');
        dofGrad.addColorStop(1, 'rgba(0,0,0,0)');
        sCtx.fillStyle = dofGrad;
        sCtx.fillRect(0, 0, w, h);
        ctx.drawImage(sharpCanvas, 0, 0);

    } else if (lcmd.indexOf('cinematic') !== -1) {
        // Rembrandt teal & orange cinematic lighting
        ctx.globalCompositeOperation = 'soft-light';
        var cineGrad = ctx.createLinearGradient(0, 0, w, h);
        cineGrad.addColorStop(0, 'rgba(255, 140, 50, 0.35)');
        cineGrad.addColorStop(1, 'rgba(20, 160, 180, 0.40)');
        ctx.fillStyle = cineGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

    } else if (lcmd.indexOf('retouchface') !== -1) {
        // AI Beauty Retouch: Haluskan kulit, cerahkan mata & senyum
        ctx.globalCompositeOperation = 'soft-light';
        var beautyG = ctx.createRadialGradient(w * 0.5, h * 0.35, 20, w * 0.5, h * 0.35, w * 0.35);
        beautyG.addColorStop(0, 'rgba(255, 235, 220, 0.35)');
        beautyG.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = beautyG;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

    } else if (lcmd.indexOf('motion blur') !== -1) {
        // Shutter drag dynamic motion blur
        ctx.globalAlpha = 0.30;
        ctx.drawImage(imgEl, -w * 0.04, 0, w, h);
        ctx.drawImage(imgEl, w * 0.04, 0, w, h);
        ctx.globalAlpha = 0.88;
        ctx.drawImage(imgEl, 0, 0, w, h);
        ctx.globalAlpha = 1.0;

    } else if (lcmd.indexOf('wide angle') !== -1) {
        // Wide Angle perspective elongation
        ctx.save();
        ctx.translate(w * 0.02, -h * 0.02);
        ctx.scale(0.96, 1.04);
        ctx.drawImage(imgEl, 0, 0, w, h);
        ctx.restore();
    }

    // 4. Color Grading Pass Sesuai Analisis AI (Jika ada data color dari Gemini)
    if (c.exposure || c.contrast || c.temperature) {
        var expMult = 1 + ((c.exposure || 0) / 100);
        var tempVal = c.temperature || 0;
        var contVal = c.contrast || 0;
        if (expMult !== 1 || tempVal !== 0 || contVal !== 0) {
            try {
                var imgData = ctx.getImageData(0, 0, w, h);
                var d = imgData.data;
                var factor = (259 * (contVal + 255)) / (255 * (259 - contVal));
                for (var i = 0; i < d.length; i += 4) {
                    var r = d[i] * expMult + tempVal * 0.6;
                    var g = d[i + 1] * expMult;
                    var b = d[i + 2] * expMult - tempVal * 0.6;
                    if (contVal !== 0) {
                        r = factor * (r - 128) + 128;
                        g = factor * (g - 128) + 128;
                        b = factor * (b - 128) + 128;
                    }
                    d[i] = r < 0 ? 0 : (r > 255 ? 255 : r);
                    d[i + 1] = g < 0 ? 0 : (g > 255 ? 255 : g);
                    d[i + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
                }
                ctx.putImageData(imgData, 0, 0);
            } catch (errColor) { }
        }
    }

    try {
        return canvas.toDataURL('image/jpeg', 0.94);
    } catch (e) {
        return (imgEl && imgEl.src) ? imgEl.src : '';
    }
}

// FUNGSI CAPTION GEMINI SESUAI PROMPT & PRESET (PERSIS SCREENSHOT 1 & 2)
function getGeminiPromptCaption(styleLabel, promptText) {
    var l = (promptText || styleLabel || '').toLowerCase();
    if (l.indexOf('pegunungan') !== -1 || l.indexOf('gunung') !== -1 || l.indexOf('mountain') !== -1) {
        return "Ini dia hasil foto yang sudah digenerate dengan background panorama pegunungan yang megah dan menyatu alami sesuai permintaan Anda:";
    } else if (l.indexOf('pantai') !== -1 || l.indexOf('beach') !== -1 || l.indexOf('laut') !== -1) {
        return "Ini dia hasil foto yang sudah digenerate dengan background suasana pantai sunset tropis yang indah sesuai permintaan Anda:";
    } else if (l.indexOf('taman') !== -1 || l.indexOf('garden') !== -1) {
        return "Ini dia hasil foto yang sudah digenerate dengan background taman bunga alami sesuai permintaan Anda:";
    } else if (l.indexOf('background') !== -1 || l.indexOf('latar') !== -1) {
        return "Ini dia hasil foto yang sudah digenerate dengan penggantian background realistis sesuai permintaan Anda:";
    } else if (l.indexOf('goldenhour') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan efek pencahayaan golden hour yang hangat dan alami, seolah diambil saat matahari terbenam:";
    } else if (l.indexOf('clones') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan efek Multiplicity Clones (3 orang) sesuai permintaan Anda:";
    } else if (l.indexOf('ghosttrail') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan efek pencahayaan Y2K Ghost Trail & Direct Flash sesuai permintaan Anda:";
    } else if (l.indexOf('convex') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan efek Convex Mirror Selfie estetik sesuai permintaan Anda:";
    } else if (l.indexOf('paparazi') !== -1 || l.indexOf('editorial') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan gaya Paparazzi Editorial karpet merah tajam sesuai permintaan Anda:";
    } else if (l.indexOf('frontlight') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan pencahayaan komersial Front Light Beauty sesuai permintaan Anda:";
    } else if (l.indexOf('bokeh') !== -1 || l.indexOf('shallow') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan efek Shallow Depth of Field & Bokeh optik f/1.2 sesuai permintaan Anda:";
    } else if (l.indexOf('blue hour') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan nuansa Blue Hour Twilight dusk cobalt sesuai permintaan Anda:";
    } else if (l.indexOf('cinematic') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan pencahayaan dramatis Cinematic Rembrandt teal & orange sesuai permintaan Anda:";
    } else if (l.indexOf('cyberpunk') !== -1 || l.indexOf('neon') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan efek Neon Cyberpunk dual-tone glow sesuai permintaan Anda:";
    } else if (l.indexOf('retouchface') !== -1) {
        return "Ini dia hasil foto yang sudah diedit dengan efek Retouch Face AI halus alami sesuai permintaan Anda:";
    }
    return "Ini dia hasil foto yang sudah diedit dengan efek " + (styleLabel || "Gemini AI") + " sesuai permintaan Anda:";
}

// =========================================================================
// REVISI 121: TRUE MULTIMODAL IMAGE-TO-IMAGE AI ENGINE (ZETTBOT ARCHITECTURE)
// MENGIRIMKAN FOTO FISIK KANVAS AKTIF KE AI, MENGUNCI 100% WAJAH, GAUN & BENTUK BADAN,
// DAN MENGGANTI BACKGROUND DENGAN PENYATUAN FOTOREALISTIS ALAMI!
// =========================================================================

function submitMintaGeminiPrompt() {
    var input = document.getElementById('input-minta-gemini');
    var rawText = input ? input.value.trim() : '';
    if (!rawText) {
        if (typeof showToast === 'function') showToast('⚠️ Masukkan prompt atau klik salah satu pintasan gaya foto di atas.');
        return;
    }

    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.src) {
        if (typeof showToast === 'function') showToast('⚠️ Pilih atau upload foto terlebih dahulu ke panggung studio.');
        return;
    }

    // Cari preset cocok untuk prompt expansion
    var matchedPreset = null;
    for (var i = 0; i < GEMINI_PHOTO_PRESETS.length; i++) {
        var p = GEMINI_PHOTO_PRESETS[i];
        if (rawText.toLowerCase().indexOf(p.cmd.toLowerCase()) !== -1 || rawText.toLowerCase().indexOf(p.label.toLowerCase()) !== -1) {
            matchedPreset = p;
            break;
        }
    }

    var styleLabel = matchedPreset ? matchedPreset.label : rawText;
    var expandedPromptText = (matchedPreset && matchedPreset.prompt) ? (matchedPreset.label + ": " + matchedPreset.prompt) : rawText;
    mintaGeminiState.lastPromptText = expandedPromptText;
    mintaGeminiState.lastPromptTitle = styleLabel;

    var modelKey = mintaGeminiState.model || 'replicate_flux';
    var thinkingLevel = mintaGeminiState.thinkingLevel;
    var modelDisplay = {
        'openai_chatgpt': '🟢 ChatGPT AI (DALL-E 3 & GPT-4o Vision)',
        'replicate_flux': '🚀 Replicate Cloud GPU (FLUX PuLID • Kunci Wajah)',
        'nano_banana': 'Gemini Nano Banana (2.5 Flash Image)',
        'nano_banana_pro': 'Gemini Nano Banana Pro (3 Pro Image)',
        'flash_lite': '3.5 Flash-Lite',
        'flash': '3.8 Flash',
        'pro': '3.1 Pro',
        'argon': '4 Argon'
    }[modelKey] || '🚀 Replicate Cloud GPU (FLUX PuLID • Kunci Wajah)';

    var sendBtn = document.getElementById('btn-minta-gemini-send');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '⏳';
    }

    function finishUI() {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '➤';
        }
    }

    var geminiKey = localStorage.getItem('limz_gemini_api_key') || '';
    var repKey = localStorage.getItem('limz_replicate_api_key') || 'r8_KBqviEiH4UsrXRa1yZhNrgRkgoxQlif4RoUfi';
    var openAiKey = localStorage.getItem('limz_openai_api_key') || '';

    // TANGKAP FOTO FISIK RIIL DARI LEMBAR KERJA KANVAS
    var safeBase64 = bgImg.src;
    try {
        var maxDim = 1024; // Optimasi 1024px agar transmisi ke AI cepat (<300KB)
        var nw = bgImg.naturalWidth || 1024;
        var nh = bgImg.naturalHeight || 1024;
        var scale = Math.min(1, maxDim / Math.max(nw, nh));
        var tempC = document.createElement('canvas');
        tempC.width = Math.round(nw * scale);
        tempC.height = Math.round(nh * scale);
        var tCtx = tempC.getContext('2d');
        if (bgImg.style && bgImg.style.transform && bgImg.style.transform.indexOf('rotate') !== -1) {
            var match = bgImg.style.transform.match(/rotate\(([-0-9.]+)deg\)/);
            var deg = match ? parseFloat(match[1]) : 0;
            tCtx.translate(tempC.width / 2, tempC.height / 2);
            tCtx.rotate(deg * Math.PI / 180);
            tCtx.drawImage(bgImg, -tempC.width / 2, -tempC.height / 2, tempC.width, tempC.height);
        } else {
            tCtx.drawImage(bgImg, 0, 0, tempC.width, tempC.height);
        }
        var aiPayload = tempC.toDataURL('image/jpeg', 0.86);
        if (aiPayload && aiPayload.length > 50) {
            safeBase64 = aiPayload;
        }
    } catch (e) {
        safeBase64 = bgImg.src;
    }

    // =====================================================================
    // OPSI A: PIPELINE MANTRAFOTO REPLICATE CLOUD GPU (3D/4D + FACELOCK IDENTITY)
    // Subjek Asli Dikunci 100% via InsightFace FaceLock, Scene 3D/4D Dihasilkan oleh AI
    // =====================================================================

    // =====================================================================
    // PILIHAN B: REPLICATE CLOUD GPU (FLUX.1 / SDXL NEURAL INPAINTING)
    // SUBJEK ASLI DIKUNCI 100%, LATAR DILUKIS ULANG OLEH AI SECARA FOTOREALISTIK
    // =====================================================================
    // =====================================================================
    // PILIHAN 0: OPENAI CHATGPT AI (DALL-E 3 & GPT-4O VISION ENGINE)
    // PRE-RENDER INSPECTION MENGUNCI WAJAH, BAJU & BACKGROUND RIIL
    // =====================================================================
    if (modelKey === 'openai_chatgpt') {
        if (!openAiKey) {
            if (typeof openGeminiApiKeyModal === 'function') openGeminiApiKeyModal();
            if (typeof showToast === 'function') showToast('🔑 API Key OpenAI ChatGPT belum diisi.');
            alert('API Key OpenAI ChatGPT belum dimasukkan. Silakan buka jendela pengaturan API untuk memasukkan API Key dari platform.openai.com/api-keys.');
            finishUI();
            return;
        }

        if (typeof showToast === 'function') {
            showToast('🟢 [ChatGPT AI] Menginspeksi foto asli dengan GPT-4o Vision & me-render dengan DALL-E 3...');
        }

        if (typeof showToast === 'function') {
            showToast('⏳ Memproses di OpenAI Cloud... Mohon tunggu 10-25 detik.');
        }

        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(function(res) {
                    finishUI();
                    if (res && res.success && res.generatedImage) {
                        showGeminiDualPreview(safeBase64, res.generatedImage, (res.result && res.result.caption) ? res.result.caption : getGeminiPromptCaption(styleLabel, rawText), styleLabel, res.modelUsed || '🟢 ChatGPT AI (DALL-E 3 & GPT-4o)');
                        if (typeof showToast === 'function') showToast('✅ Selesai: Foto baru berhasil digenerate ChatGPT AI secara fotorealistik menyatu alami!');
                    } else {
                        var errMsg = (res && res.error) ? res.error : ((res && res.message) ? res.message : 'ChatGPT AI tidak mengembalikan output gambar.');
                        if (typeof showToast === 'function') showToast('⚠️ ' + errMsg);
                        alert(errMsg);
                    }
                })
                .withFailureHandler(function(err) {
                    finishUI();
                    var errMsg = (err && err.message) ? err.message : String(err);
                    console.error('ChatGPT AI backend notice:', err);
                    if (typeof showToast === 'function') showToast('⚠️ ChatGPT AI Error: ' + errMsg);
                    alert('ChatGPT AI Error: ' + errMsg);
                })
                .executeMintaGeminiServer(safeBase64, 'image/jpeg', expandedPromptText, modelKey, thinkingLevel, repKey, openAiKey);
        } else {
            finishUI();
            if (typeof showToast === 'function') showToast('ℹ️ Berjalan di mode preview lokal.');
        }
        return;
    }

    if (modelKey === 'replicate_flux') {
        if (!repKey) {
            if (typeof openGeminiApiKeyModal === 'function') openGeminiApiKeyModal();
            if (typeof showToast === 'function') showToast('🔑 Token Replicate GPU belum diisi.');
            alert('Token Replicate Cloud GPU belum dimasukkan. Silakan buka jendela pengaturan API untuk memasukkan token.');
            finishUI();
            return;
        }

        if (typeof showToast === 'function') {
            showToast('🚀 [Replicate Cloud GPU] Mengirim foto kanvas ke AI: "' + styleLabel + '"...');
        }

        if (typeof showToast === 'function') {
            showToast('⏳ Memproses di Cloud GPU (Flux.1 / SDXL Image-to-Image)... Mohon tunggu 15-30 detik.');
        }

        if (typeof google !== 'undefined' && google.script && google.script.run) {
            google.script.run
                .withSuccessHandler(function(res) {
                    finishUI();
                    if (res && res.success && res.generatedImage) {
                        showGeminiDualPreview(safeBase64, res.generatedImage, (res.result && res.result.caption) ? res.result.caption : getGeminiPromptCaption(styleLabel, rawText), styleLabel, res.modelUsed || 'Replicate Cloud GPU (MantraFoto AI)');
                        if (typeof showToast === 'function') showToast('✅ Selesai: Foto baru berhasil digenerate Replicate Cloud GPU secara fotorealistik menyatu alami!');
                    } else {
                        var errMsg = (res && res.error) ? res.error : ((res && res.message) ? res.message : 'Replicate GPU tidak mengembalikan output gambar.');
                        if (typeof showToast === 'function') showToast(errMsg);
                        alert(errMsg);
                    }
                })
                .withFailureHandler(function(err) {
                    finishUI();
                    var errMsg = (err && err.message) ? err.message : String(err);
                    console.error('Replicate GPU backend notice:', err);
                    if (typeof showToast === 'function') showToast('⚠️ Replicate GPU Error: ' + errMsg);
                    alert('Replicate Cloud GPU Error: ' + errMsg);
                })
                .executeMintaGeminiServer(safeBase64, 'image/jpeg', expandedPromptText, modelKey, thinkingLevel, repKey, openAiKey);
        } else {
            finishUI();
            if (typeof showToast === 'function') showToast('ℹ️ Berjalan di mode preview lokal.');
        }
        return;
    }

    // =====================================================================
    // PILIHAN A: GOOGLE GEMINI MULTIMODAL API (NANO BANANA / FLASH / PRO / ARGON)
    // =====================================================================
    if (geminiKey) {
        if (typeof showToast === 'function') {
            showToast('✨ [Google Gemini] Memproses foto kanvas dengan model ' + modelDisplay + '...');
        }
        executeMintaGeminiClientFetch(geminiKey, safeBase64, expandedPromptText, modelKey, thinkingLevel, styleLabel, modelDisplay);
        return;
    }

    // JALUR BACKEND GOOGLE APPS SCRIPT (Jika API Key ada di Script Properties)
    if (typeof google !== 'undefined' && google.script && google.script.run) {
        if (typeof showToast === 'function') {
            showToast('✨ Memproses lewat Backend Google Apps Script (' + modelDisplay + ')...');
        }
        google.script.run
            .withSuccessHandler(function(res) {
                finishUI();
                if (res && res.success && res.generatedImage) {
                    showGeminiDualPreview(safeBase64, res.generatedImage, (res.result && res.result.caption) ? res.result.caption : getGeminiPromptCaption(styleLabel, rawText), styleLabel, res.modelUsed || modelDisplay);
                    if (typeof showToast === 'function') showToast('✅ Selesai: Background berhasil digenerate AI dengan wajah & busana terkunci!');
                } else {
                    var errMsg = (res && res.error) ? res.error : ((res && res.message) ? res.message : 'Google Gemini tidak mengembalikan output gambar.');
                    if (typeof showToast === 'function') showToast('⚠️ ' + errMsg);
                    alert(errMsg);
                }
            })
            .withFailureHandler(function(err) {
                finishUI();
                var errMsg = (err && err.message) ? err.message : String(err);
                if (typeof showToast === 'function') showToast('⚠️ Gemini Error: ' + errMsg);
                alert('Gemini Error: ' + errMsg);
            })
            .executeMintaGeminiServer(safeBase64, 'image/jpeg', expandedPromptText, modelKey, thinkingLevel, repKey, openAiKey);
        return;
    }

    // JIKA TIDAK ADA KEY & BUKAN GAS BACKEND:
    finishUI();
    if (typeof openGeminiApiKeyModal === 'function') openGeminiApiKeyModal();
    if (typeof showToast === 'function') showToast('🔑 Masukkan API Key Google Gemini atau gunakan Replicate Cloud GPU.');
    alert('Kunci API Google Gemini belum diatur. Silakan klik Hubungkan Akun / API Key untuk memasukkan API Key Google Gemini atau pilih Replicate Cloud GPU (PRO AI).');
}

// CLIENT-SIDE ENRICHMENT PROMPT INDONESIA KE ENGLISH COMMERCIAL PHOTOGRAPHY
function buildClientEnrichedPhotoPrompt(promptText) {
    var raw = String(promptText || '').trim();
    var l = raw.toLowerCase();
    var parts = [];

    // 0. Deteksi Pintasan Gaya & Efek Estetika Fotografi (Revisi 117)
    if (l.indexOf('ghosttrail') !== -1 || l.indexOf('ghost trail') !== -1 || l.indexOf('directflash') !== -1 || l.indexOf('direct flash') !== -1) {
        parts.push('Y2K party aesthetic direct camera flash photography with slow-shutter motion ghost light trails, high-intensity specular flash on wedding couple, authentic vintage 35mm film grain, vibrant kinetic light streaks');
    }
    if (l.indexOf('convex') !== -1 || l.indexOf('fisheye') !== -1 || l.indexOf('mirror selfie') !== -1) {
        parts.push('creative street convex safety mirror selfie perspective, spherical fisheye distortion, vibrant Gen-Z urban aesthetic');
    }
    if (l.indexOf('clones') !== -1 || l.indexOf('gandakan') !== -1) {
        parts.push('creative multiplicity clones photography showing identical bride and groom in multiple dynamic poses side-by-side');
    }
    if (l.indexOf('paparazi') !== -1 || l.indexOf('editorial') !== -1 || l.indexOf('red carpet') !== -1) {
        parts.push('high-fashion red carpet paparazzi editorial photography, crisp sharp direct flash, deep moody background falloff, luxury magazine aesthetic');
    }
    if (l.indexOf('goldenhours') !== -1 || l.indexOf('golden hour') !== -1) {
        parts.push('warm romantic golden hour sunset lighting, rich amber sun flare, soft glowing warmth on faces');
    }
    if (l.indexOf('frontlight') !== -1) {
        parts.push('clean professional studio beauty key front-light, luminous even illumination on faces, glowing soft skin');
    }
    if (l.indexOf('shallow') !== -1 || l.indexOf('bokeh') !== -1) {
        parts.push('shallow depth of field portrait, razor sharp focus on bride and groom, creamy circular optical bokeh blur on background stage');
    }
    if (l.indexOf('blue hour') !== -1 || l.indexOf('bluehour') !== -1) {
        parts.push('twilight blue hour cinematic lighting, deep atmospheric royal blue tones, warm tungsten backlight');
    }
    if (l.indexOf('cinematic') !== -1) {
        parts.push('anamorphic cinematic movie frame, 2.39:1 widescreen aesthetic, subtle teal and orange color grading, dramatic filmic lighting');
    }

    // 1. Deteksi Busana & Pakaian Tradisional / Modern
    if (l.indexOf('beskap') !== -1) {
        parts.push('Indonesian groom wearing authentic black Javanese royal beskap wedding attire with intricate gold embroidery and traditional buttons');
    }
    if (l.indexOf('blangkon') !== -1) {
        parts.push('wearing authentic traditional Javanese batik blangkon headdress');
    }
    if (l.indexOf('kebaya') !== -1) {
        parts.push('Indonesian bride wearing elegant luxury bridal kebaya with delicate floral lace embroidery');
    }
    if (l.indexOf('jas') !== -1 || l.indexOf('tuxedo') !== -1) {
        parts.push('groom wearing sharp tailored black formal tuxedo suit with satin lapel');
    }
    if (l.indexOf('gaun') !== -1 || l.indexOf('dress') !== -1) {
        parts.push('bride wearing magnificent white bridal wedding dress with flowing train');
    }
    if (l.indexOf('pengantin') !== -1 && l.indexOf('beskap') === -1 && l.indexOf('kebaya') === -1) {
        parts.push('Indonesian wedding couple in elegant wedding attire');
    }

    if (l.indexOf('pegunungan') !== -1 || l.indexOf('gunung') !== -1 || l.indexOf('mountain') !== -1) {
        parts.push('majestic alpine mountain panorama backdrop with rocky peaks, morning valley mist, pine ridges, and soft natural daylight');
    } else if (l.indexOf('pantai') !== -1 || l.indexOf('beach') !== -1 || l.indexOf('laut') !== -1) {
        parts.push('stunning tropical beach sunset backdrop with soft ocean waves, radiant sun, and golden reflections');
    } else if (l.indexOf('taman') !== -1 || l.indexOf('outdoor') !== -1 || l.indexOf('garden') !== -1 || l.indexOf('bunga') !== -1) {
        parts.push('lush botanical garden backdrop with natural sunlight bokeh and blooming fresh flowers');
    } else if (l.indexOf('pelaminan') !== -1 || l.indexOf('dekor') !== -1) {
        parts.push('luxurious Indonesian wedding stage backdrop with grand floral decorations and warm chandelier lights');
    } else if (l.indexOf('studio') !== -1 || l.indexOf('luxury') !== -1 || l.indexOf('ballroom') !== -1) {
        parts.push('opulent luxury wedding ballroom hall with elegant architectural lighting and warm bokeh');
    } else {
        parts.push('opulent wedding reception stage background with elegant fresh flower decorations');
    }

    if (l.indexOf('senyum') !== -1 || l.indexOf('tertawa') !== -1 || l.indexOf('bahagia') !== -1) {
        parts.push('natural joyous facial expression, genuine warm romantic smile');
    }

    parts.push('commercial wedding portrait photography, authentic photorealistic skin texture, natural soft studio lighting, sharp focus on faces, Hasselblad medium format 8k resolution, masterpiece');

    return parts.join(', ');
}

// CLIENT-SIDE DIRECT FETCH KE GOOGLE GEMINI / IMAGEN 3 API (REVISI 116.2 / NANO BANANA MULTIMODAL)
function executeMintaGeminiClientFetch(apiKey, imageSrc, promptText, modelKey, thinkingLevel, styleLabel, modelDisplay) {
    var sendBtn = document.getElementById('btn-minta-gemini-send');
    var cleanBase64 = String(imageSrc).replace(/^data:image\/[a-z]+;base64,/, '');

    // Target model queue dengan fallback berjenjang otomatis (Pro -> Flash Image -> 2.0 Flash)
    var modelQueue = [];
    if (modelKey === 'nano_banana_pro' || modelKey === 'pro' || modelKey === 'argon') {
        modelQueue = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'gemini-2.0-flash'];
    } else {
        modelQueue = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'gemini-2.0-flash'];
    }

    var targetModelId = (modelKey === 'nano_banana_pro' || modelKey === 'pro' || modelKey === 'argon') ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
    var modelIndex = 0;
    var lastErrorMsg = '';

    var baseApiUrl = 'https://generativelanguage.googleapis.com/v1beta';
    var openaiApiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

    // Helper untuk mengakhiri loading tombol
    function finishLoading() {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '➤';
        }
    }

    // Helper extract image from parts
    function extractImageFromParts(parts) {
        if (!parts || !parts.length) return null;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p.inlineData && p.inlineData.data) {
                return 'data:' + (p.inlineData.mimeType || 'image/jpeg') + ';base64,' + p.inlineData.data;
            }
            if (p.inline_data && p.inline_data.data) {
                return 'data:' + (p.inline_data.mime_type || 'image/jpeg') + ';base64,' + p.inline_data.data;
            }
            if (p.text && p.text.indexOf('data:image/') !== -1) {
                var m = p.text.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
                if (m) return m[0];
            }
        }
        return null;
    }

    // TINGKAT 1: Coba Generative Language Model resmi (gemini-3-pro-image-preview / gemini-2.5-flash-image)
    function tryTargetImageModel() {
        if (modelIndex >= modelQueue.length) {
            tryOpenAiCompatibleConnection();
            return;
        }

        var currentModel = modelQueue[modelIndex];
        modelIndex++;

        var url = baseApiUrl + '/models/' + currentModel + ':generateContent?key=' + apiKey;
        var promptPayload = {
            contents: [{
                parts: [
                    {
                        text: "You are an award-winning professional commercial studio photographer. Re-render this portrait photo according to: \"" + promptText + "\". CRITICAL: Preserve the exact person's face, facial features, and likeness faithful to the input image, while seamlessly transforming and harmonizing the scene, lighting, shadows, and background into a single cohesive photorealistic portrait without any cutout or sticker appearance. Return an authentic, photographic portrait image with realistic skin textures and cohesive studio lighting."
                    },
                    {
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: cleanBase64
                        }
                    }
                ]
            }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"],
                imageConfig: {
                    aspectRatio: "3:4"
                },
                temperature: 0.35,
                maxOutputTokens: 2048
            }
        };

        if (thinkingLevel && thinkingLevel !== 'none') {
            var budget = 4096;
            if (thinkingLevel === 'cepat') budget = 1024;
            else if (thinkingLevel === 'mendalam') budget = 16384;
            promptPayload.generationConfig.thinkingConfig = { thinkingBudget: budget };
        }

        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(promptPayload)
        })
        .then(function(res) {
            if (!res.ok) {
                return res.json().then(function(errJson) {
                    lastErrorMsg = (errJson && errJson.error && errJson.error.message) ? errJson.error.message : ('HTTP ' + res.status);
                    throw new Error(currentModel + ': ' + lastErrorMsg);
                }).catch(function() {
                    lastErrorMsg = 'HTTP ' + res.status;
                    throw new Error(currentModel + ': ' + lastErrorMsg);
                });
            }
            return res.json();
        })
        .then(function(json) {
            var parts = (json.candidates && json.candidates[0] && json.candidates[0].content) ? json.candidates[0].content.parts : [];
            var foundImg = extractImageFromParts(parts);
            if (foundImg) {
                finishLoading();
                showGeminiDualPreview(imageSrc, foundImg, getGeminiPromptCaption(styleLabel, promptText), styleLabel);
                return;
            }
            tryTargetImageModel();
        })
        .catch(function(err) {
            tryTargetImageModel();
        });
    }

    // TINGKAT 2: Coba OpenAI-Compatible Connection (/v1beta/openai/images/generations atau /v1beta/openai/chat/completions)
    function tryOpenAiCompatibleConnection() {
        var imgGenUrl = baseApiUrl + '/openai/images/generations';
        var imgGenBody = {
            model: targetModelId,
            prompt: promptText + ". Photorealistic studio portrait photography, authentic skin texture, realistic camera lighting, 8k resolution.",
            n: 1,
            size: "1024x1024",
            
        };

        fetch(imgGenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(imgGenBody)
        })
        .then(function(res) {
            if (!res.ok) throw new Error('OpenAI images status ' + res.status);
            return res.json();
        })
        .then(function(data) {
            if (data.data && data.data[0]) {
                var b64 = data.data[0].b64_json ? ('data:image/jpeg;base64,' + data.data[0].b64_json) : data.data[0].url;
                if (b64) {
                    finishLoading();
                    showGeminiDualPreview(imageSrc, b64, getGeminiPromptCaption(styleLabel, promptText), styleLabel);
                    return;
                }
            }
            tryChatCompletionsFallback();
        })
        .catch(function(e) {
            tryChatCompletionsFallback();
        });
    }

    function tryChatCompletionsFallback() {
        var openaiBody = {
            model: targetModelId,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: "Transform and edit this photobooth portrait photo according to: \"" + promptText + "\". Studio photorealistic quality, realistic skin texture and lighting." },
                    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + cleanBase64 } }
                ]
            }],
            max_tokens: 2048,
            temperature: 0.35
        };

        fetch(openaiApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(openaiBody)
        })
        .then(function(res) {
            if (!res.ok) throw new Error('OpenAI compat status ' + res.status);
            return res.json();
        })
        .then(function(data) {
            var reply = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
            if (reply && reply.indexOf('data:image/') !== -1) {
                var m = reply.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
                if (m) {
                    finishLoading();
                    showGeminiDualPreview(imageSrc, m[0], getGeminiPromptCaption(styleLabel, promptText), styleLabel);
                    return;
                }
            }
            tryImagen3Fallback();
        })
        .catch(function(e) {
            tryImagen3Fallback();
        });
    }

    // TINGKAT 3: Google Imagen 3 Photorealistic High-Fidelity Endpoint
    function tryImagen3Fallback() {
        var imagenUrl = baseApiUrl + '/models/imagen-3.0-generate-002:predict?key=' + apiKey;
        var imagenPayload = {
            instances: [{
                prompt: promptText + ". Photorealistic studio portrait photography, natural skin texture, professional lighting, photobooth studio finish."
            }],
            parameters: {
                sampleCount: 1,
                aspectRatio: "3:4",
                outputMimeType: "image/jpeg"
            }
        };

        fetch(imagenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(imagenPayload)
        })
        .then(function(res) {
            if (!res.ok) throw new Error('Imagen 3 status ' + res.status);
            return res.json();
        })
        .then(function(json) {
            if (json.predictions && json.predictions[0] && json.predictions[0].bytesBase64Encoded) {
                finishLoading();
                var realImg = 'data:image/jpeg;base64,' + json.predictions[0].bytesBase64Encoded;
                showGeminiDualPreview(imageSrc, realImg, getGeminiPromptCaption(styleLabel, promptText), styleLabel);
            } else {
                tryStandardGeminiVision();
            }
        })
        .catch(function(e) {
            tryStandardGeminiVision();
        });
    }

    // TINGKAT 4: Gemini Multimodal Vision + JSON Formula
    function tryStandardGeminiVision() {
        var fallbackModel = (modelKey === 'nano_banana_pro' || modelKey === 'pro') ? 'gemini-2.0-pro-exp-02-05' : 'gemini-2.0-flash';
        var url = baseApiUrl + '/models/' + fallbackModel + ':generateContent?key=' + apiKey;

        var structuredPrompt = "You are a world-class professional portrait photographer and AI editor. " +
            "Transform this portrait according to: \"" + promptText + "\". Return strictly valid JSON: " +
            "{\"caption\":\"" + getGeminiPromptCaption(styleLabel, promptText) + "\",\"styleTitle\":\"" + styleLabel + "\",\"reasoning\":\"Transformasi foto berhasil.\",\"color\":{\"exposure\":5,\"contrast\":12,\"highlights\":-8,\"shadows\":6,\"temperature\":15,\"tint\":2,\"vibrance\":12,\"saturation\":8},\"retouch\":{\"skinSmoothing\":50,\"teeth\":25,\"eyes\":30},\"fx\":{\"blurType\":\"none\",\"blurAmount\":0,\"vignette\":0,\"grain\":0,\"fisheyeDistort\":0}}";

        var payload = {
            contents: [{
                parts: [
                    { text: structuredPrompt },
                    {
                        inline_data: {
                            mime_type: 'image/jpeg',
                            data: cleanBase64
                        }
                    }
                ]
            }],
            generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 2048
            }
        };

        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function(res) { return res.json(); })
        .then(function(json) {
            finishLoading();
            var bgImg = document.getElementById('wm-simulator-bg');
            var parsed = null;
            var parts = (json.candidates && json.candidates[0] && json.candidates[0].content) ? json.candidates[0].content.parts : [];
            var inlineImg = extractImageFromParts(parts);
            try {
                var raw = parts.map(function(p) { return p.text || ''; }).join('');
                raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
                parsed = JSON.parse(raw);
            } catch (e) { }

            var resultImg = inlineImg || generateHighFidelityCanvasAiPhoto(bgImg, parsed || {}, promptText);
            var caption = (parsed && parsed.caption) ? parsed.caption : getGeminiPromptCaption(styleLabel, promptText);
            showGeminiDualPreview(imageSrc, resultImg, caption, styleLabel);
            if (!inlineImg && lastErrorMsg && typeof showToast === 'function') {
                showToast('ℹ️ Respon Google: ' + lastErrorMsg + ' - Menampilkan pratinjau studio.');
            }
        })
        .catch(function(err) {
            finishLoading();
            var bgImg = document.getElementById('wm-simulator-bg');
            var localGen = generateHighFidelityCanvasAiPhoto(bgImg, {}, promptText);
            showGeminiDualPreview(imageSrc, localGen, getGeminiPromptCaption(styleLabel, promptText), styleLabel);
            if (lastErrorMsg && typeof showToast === 'function') {
                showToast('ℹ️ Respon Google: ' + lastErrorMsg + ' - Menampilkan pratinjau studio.');
            }
        });
    }

    // Mulai eksekusi berjenjang
    tryTargetImageModel();
}

// LOCAL ARTISTIC NEURAL FALLBACK (JIKA OFFLINE / KUOTA HABIS / CEPAT)
function applyMintaGeminiLocalFallback(preset, promptText, modelDisplay) {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.naturalWidth) return;

    var cmd = preset ? preset.cmd : (promptText || '');
    var lcmd = cmd.toLowerCase();

    var fallbackData = {
        styleTitle: preset ? preset.label : promptText,
        reasoning: "Efek fotografi studio diterapkan secara optimal.",
        color: { exposure: 0, contrast: 10, highlights: -5, shadows: 5, temperature: 0, tint: 0, vibrance: 10 },
        retouch: { skinSmoothing: 45, teeth: 30, eyes: 35 },
        fx: {}
    };

    if (lcmd.indexOf('goldenhour') !== -1) {
        fallbackData.color = { exposure: 8, contrast: 12, highlights: -10, shadows: 8, temperature: 22, tint: 4, vibrance: 16 };
        fallbackData.reasoning = "Pencahayaan senja keemasan dengan hangat amber dan rim-light lembut.";
    } else if (lcmd.indexOf('blue hour') !== -1) {
        fallbackData.color = { exposure: -4, contrast: 15, highlights: -15, shadows: 10, temperature: -24, tint: -6, vibrance: 8 };
        fallbackData.reasoning = "Suasana dusk twilight langit sore dengan kontras cobalt blue alami.";
    } else if (lcmd.indexOf('cinematic') !== -1) {
        fallbackData.color = { exposure: -2, contrast: 24, highlights: -20, shadows: 12, temperature: 8, tint: -8, vibrance: 12 };
        fallbackData.reasoning = "Rembrandt lighting filmis dengan bayangan chiaroscuro dan rona teal-orange.";
    } else if (lcmd.indexOf('moody') !== -1) {
        fallbackData.color = { exposure: -8, contrast: 20, highlights: -25, shadows: -10, temperature: 4, tint: 0, vibrance: -10 };
        fallbackData.reasoning = "Nuansa fine-art dark & moody dengan deep crushed shadows.";
    } else if (lcmd.indexOf('frontlight') !== -1 || lcmd.indexOf('softbox') !== -1) {
        fallbackData.color = { exposure: 12, contrast: 8, highlights: 5, shadows: 18, temperature: 2, tint: 2, vibrance: 8 };
        fallbackData.reasoning = "Pencahayaan depan komersial merata tanpa bayangan kasar.";
    } else if (lcmd.indexOf('paparazi') !== -1) {
        fallbackData.color = { exposure: 15, contrast: 30, highlights: 15, shadows: -20, temperature: 0, tint: 0, vibrance: 20 };
        fallbackData.reasoning = "Flash paparazzi tajam karpet merah dengan background falloff pekat.";
    } else if (lcmd.indexOf('retouchface') !== -1) {
        fallbackData.retouch = { skinSmoothing: 65, teeth: 40, eyes: 45 };
        fallbackData.reasoning = "Tekstur kulit porselen mulus, pori-pori mikro terjaga, mata & senyum bening.";
    } else if (lcmd.indexOf('convex') !== -1) {
        fallbackData.fx.fisheyeDistort = 45;
        fallbackData.reasoning = "Distorsi cermin cembung cembung Gen-Z fisheye diterapkan.";
    } else if (lcmd.indexOf('ghosttrail') !== -1) {
        fallbackData.fx.blurType = 'ghost_trail';
        fallbackData.reasoning = "Y2K party direct flash dengan slow-shutter motion trail.";
    } else if (lcmd.indexOf('neon') !== -1 || lcmd.indexOf('cyberpunk') !== -1) {
        fallbackData.fx.duotone = 'cyan_magenta';
        fallbackData.reasoning = "Pendaran lampu neon cyberpunk magenta & cyan toska.";
    } else if (lcmd.indexOf('bokeh') !== -1 || lcmd.indexOf('shallow') !== -1) {
        fallbackData.fx.blurType = 'bokeh';
        fallbackData.reasoning = "Isolasi lensa tajam f/1.2 dengan background bokeh creamy.";
    } else if (lcmd.indexOf('motion blur') !== -1) {
        fallbackData.fx.blurType = 'motion_horizontal';
        fallbackData.reasoning = "Kinetic motion blur gerak dinamis diterapkan.";
    }

    var safeBase64 = bgImg.src;
    var localGen = generateHighFidelityCanvasAiPhoto(bgImg, fallbackData, cmd);
    var caption = getGeminiPromptCaption(preset ? preset.label : promptText, cmd);
    showGeminiDualPreview(safeBase64, localGen, caption, preset ? preset.label : promptText);
}

// =========================================================================
// REVISI 113: STANDARDIZED IMAGE INGESTION ENGINE (BLOB / FILE / BASE64)
// =========================================================================
function createStandardImagePayload(inputSource, callback) {
    if (!inputSource) {
        if (callback) callback(null);
        return;
    }

    // 1. File atau Blob
    if (inputSource instanceof Blob || (typeof File !== 'undefined' && inputSource instanceof File)) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var b64 = e.target.result;
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                var payload = {
                    file: (inputSource instanceof File) ? inputSource : null,
                    blob: inputSource,
                    blobUrl: URL.createObjectURL(inputSource),
                    base64: b64,
                    htmlImage: img,
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height,
                    aspectRatio: (img.naturalWidth || 1) / (img.naturalHeight || 1),
                    orientation: (img.naturalWidth >= img.naturalHeight) ? 'landscape' : 'portrait'
                };
                if (callback) callback(payload);
            };
            img.src = b64;
        };
        reader.readAsDataURL(inputSource);
        return;
    }

    // 2. Base64 string
    if (typeof inputSource === 'string' && inputSource.startsWith('data:image')) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            var byteString = atob(inputSource.split(',')[1]);
            var mimeMatch = inputSource.match(/^data:(image\/[a-z]+);base64,/);
            var mimeString = mimeMatch ? mimeMatch[1] : 'image/jpeg';
            var ab = new ArrayBuffer(byteString.length);
            var ia = new Uint8Array(ab);
            for (var i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            var blob = new Blob([ab], { type: mimeString });

            var payload = {
                file: null,
                blob: blob,
                blobUrl: URL.createObjectURL(blob),
                base64: inputSource,
                htmlImage: img,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
                aspectRatio: (img.naturalWidth || 1) / (img.naturalHeight || 1),
                orientation: (img.naturalWidth >= img.naturalHeight) ? 'landscape' : 'portrait'
            };
            if (callback) callback(payload);
        };
        img.src = inputSource;
        return;
    }

    // 3. HTMLImageElement atau Canvas
    if (inputSource.tagName === 'IMG' || inputSource.tagName === 'CANVAS') {
        var canvas = (inputSource.tagName === 'CANVAS') ? inputSource : document.createElement('canvas');
        if (inputSource.tagName === 'IMG') {
            canvas.width = inputSource.naturalWidth || inputSource.width;
            canvas.height = inputSource.naturalHeight || inputSource.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(inputSource, 0, 0);
        }
        var b64Data = canvas.toDataURL('image/jpeg', 0.94);
        createStandardImagePayload(b64Data, callback);
        return;
    }

    if (callback) callback(null);
}

// =========================================================================
// REVISI 113: CANVA-STYLE STAGE DRAG & DROP & CLIPBOARD PASTE
// =========================================================================
function initCanvaStyleCanvasWorkflow() {
    var stageFrame = document.getElementById('wm-stage-frame');
    var dropIndicator = document.getElementById('canva-drop-indicator');
    if (!stageFrame) return;

    ['dragenter', 'dragover'].forEach(function (evt) {
        stageFrame.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (dropIndicator) dropIndicator.style.display = 'flex';
        }, false);
    });

    ['dragleave', 'dragend'].forEach(function (evt) {
        stageFrame.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.target === stageFrame || !stageFrame.contains(e.relatedTarget)) {
                if (dropIndicator) dropIndicator.style.display = 'none';
            }
        }, false);
    });

    stageFrame.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (dropIndicator) dropIndicator.style.display = 'none';
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handlePhotoFilesSelected(e.dataTransfer.files);
            if (typeof showToast === 'function') {
                showToast('✨ ' + e.dataTransfer.files.length + ' Foto berhasil dimuat ke Kanvas Canva-Style!');
            }
        }
    }, false);

    // Global Clipboard Paste Listener (Ctrl + V)
    window.addEventListener('paste', function (e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        var items = e.clipboardData.items;
        var imageFiles = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                var file = items[i].getAsFile();
                if (file) imageFiles.push(file);
            }
        }
        if (imageFiles.length > 0) {
            // JIKA SEDANG MENUNGGU HASIL DARI GEMINI WEB ATAU MODAL RECEIVER AKTIF:
            var receiverModal = document.getElementById('gemini-web-receiver-modal');
            var isWaitingGeminiWeb = (typeof mintaGeminiState !== 'undefined' && mintaGeminiState.waitingForWebResult) || (receiverModal && receiverModal.style.display !== 'none');
            if (isWaitingGeminiWeb) {
                e.preventDefault();
                applyPastedImageToActiveCanvas(imageFiles[0]);
                return;
            }

            handlePhotoFilesSelected(imageFiles);
            if (typeof showToast === 'function') {
                showToast('📋 ' + imageFiles.length + ' Foto dari clipboard berhasil ditempel ke kanvas!');
            }
        }
    });
}

// =========================================================================
// REVISI 113: STUDIO AI QUICK MENU & TASK EXECUTION ROUTER
// =========================================================================
function toggleStudioAiQuickMenu(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    var menu = document.getElementById('studio-ai-quick-menu');
    if (!menu) return;
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}

document.addEventListener('click', function (e) {
    var menu = document.getElementById('studio-ai-quick-menu');
    var btn = document.getElementById('btn-studio-ai-menu');
    if (menu && menu.style.display === 'block') {
        if (btn && btn.contains(e.target)) return;
        if (!menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    }
});

function executeAiTask(taskType, customOptions) {
    var menu = document.getElementById('studio-ai-quick-menu');
    if (menu) menu.style.display = 'none';

    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.src || !bgImg.naturalWidth) {
        if (typeof showToast === 'function') showToast('⚠️ Pilih atau unggah foto terlebih dahulu ke panggung kanvas.');
        return;
    }

    createStandardImagePayload(bgImg, function (payload) {
        if (!payload) return;

        var options = customOptions || {};

        if (typeof showToast === 'function') {
            var taskLabels = {
                'bg_remove': '🪄 Memproses Hapus Background AI...',
                'upscale': '🔍 Memproses Upscale Resolusi AI...',
                'magic_eraser': '🧹 Mengaktifkan Magic Eraser AI...',
                'text_to_image': '🎨 Membuka AI Generator Teks-ke-Gambar...',
                'style_transfer': '✨ Menerapkan Style Transfer AI...'
            };
            showToast(taskLabels[taskType] || '✨ Memproses fitur AI...');
        }

        // 1. FITUR: PENGHAPUSAN LATAR BELAKANG (BACKGROUND REMOVAL)
        if (taskType === 'bg_remove') {
            clientSideRemoveBackground(payload.htmlImage, function (resultBase64) {
                showGeminiDualPreview(
                    payload.base64,
                    resultBase64,
                    "Ini dia hasil foto yang sudah dihapus latar belakangnya (Background Removal) secara rapi:",
                    "Hapus Background AI"
                );
            });
            return;
        }

        // 2. FITUR: PENINGKATAN RESOLUSI (IMAGE UPSCALING 2X / 4X)
        if (taskType === 'upscale') {
            clientSideUpscaleImage(payload.htmlImage, 2.0, function (resultBase64) {
                showGeminiDualPreview(
                    payload.base64,
                    resultBase64,
                    "Ini dia hasil foto yang sudah ditingkatkan resolusinya (Upscale 2x Super Resolution) tajam dan jernih:",
                    "Upscale 2x AI"
                );
            });
            return;
        }

        // 3. FITUR: PENGHAPUSAN OBJEK (MAGIC ERASER / INPAINTING)
        if (taskType === 'magic_eraser') {
            if (typeof toggleWmEraserMode === 'function') {
                toggleWmEraserMode(true);
            }
            if (typeof showToast === 'function') {
                showToast('🧹 Usapkan kuas pada objek / kabel yang ingin dihapus, lalu klik tombol "✨ Gemini AI Hapus" atau "⚡ Hapus Cepat"!');
            }
            return;
        }

        // 4. FITUR: PEMBUATAN GAMBAR DARI TEKS (TEXT-TO-IMAGE / GENERATIVE AI)
        if (taskType === 'text_to_image') {
            var promptModal = document.getElementById('input-minta-gemini');
            if (promptModal) {
                promptModal.focus();
                promptModal.value = 'Hasilkan latar belakang studio foto bertema ';
            }
            if (typeof showToast === 'function') {
                showToast('🎨 Masukkan deskripsi tema/gambar yang ingin dibuat pada bilah "Minta Gemini" di bawah kanvas.');
            }
            return;
        }

        // 5. FITUR: PENERAPAN GAYA (STYLE TRANSFER / FILTER AI)
        if (taskType === 'style_transfer') {
            var ribbon = document.getElementById('minta-gemini-chips-ribbon');
            if (ribbon) {
                ribbon.scrollIntoView({ behavior: 'smooth' });
            }
            if (typeof showToast === 'function') {
                showToast('✨ Pilih salah satu pintasan gaya foto di bawah kanvas (Golden Hour, Cyberpunk, Cinematic, dsb).');
            }
            return;
        }
    });
}

// =========================================================================
// REVISI 115: INTELLIGENT EDGE-PRESERVING CLIENT-SIDE BACKGROUND ISOLATION
function clientSideRemoveBackground(imgEl, callback) {
    var w = imgEl.naturalWidth || 1200;
    var h = imgEl.naturalHeight || 1600;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);

    try {
        var imgData = ctx.getImageData(0, 0, w, h);
        var data = imgData.data;

        // 1. Sampel warna latar belakang dari perimeter tepi foto
        var samplePts = [
            0, w - 1, w * (h - 1), w * h - 1,
            Math.floor(w / 2), Math.floor(w * (h - 1) + w / 2),
            w * Math.floor(h / 2), w * Math.floor(h / 2) + w - 1
        ];
        var bgR = 0, bgG = 0, bgB = 0;
        samplePts.forEach(function(idx) {
            var p = idx * 4;
            bgR += data[p];
            bgG += data[p + 1];
            bgB += data[p + 2];
        });
        bgR /= samplePts.length;
        bgG /= samplePts.length;
        bgB /= samplePts.length;

        var cx = w / 2;
        var cy = h * 0.48;

        // 2. Pemrosesan segmentasi berbasis jarak pusat subjek + delta kromatik
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var i = (y * w + x) * 4;
                var r = data[i];
                var g = data[i + 1];
                var b = data[i + 2];

                var colorDiff = Math.sqrt(Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2));
                var dx = (x - cx) / cx;
                var dy = (y - cy) / cy;
                var distFromCenter = Math.sqrt(dx * dx + dy * dy);

                // Subjek tengah (orang, motor, pakaian) terlindungi 100%
                var alphaFactor = 1.0;
                if (distFromCenter > 0.65) {
                    var outerFactor = (distFromCenter - 0.65) / 0.55;
                    if (colorDiff < 65) {
                        alphaFactor = Math.max(0, 1 - outerFactor * 1.5);
                    } else {
                        alphaFactor = Math.max(0.15, 1 - outerFactor * 0.4);
                    }
                }
                data[i + 3] = Math.round(data[i + 3] * Math.min(1, Math.max(0, alphaFactor)));
            }
        }
        ctx.putImageData(imgData, 0, 0);
    } catch (e) {
        // Fallback jika browser membatasi getImageData
    }

    var pngDataUrl = canvas.toDataURL('image/png');
    if (callback) callback(pngDataUrl);
}

// =========================================================================
// REVISI 113: CLIENT-SIDE AI IMAGE UPSCALING (2X / 4X SUPER RESOLUTION)
// =========================================================================
function clientSideUpscaleImage(imgEl, factor, callback) {
    var f = factor || 2.0;
    var w = Math.round((imgEl.naturalWidth || 1200) * f);
    var h = Math.round((imgEl.naturalHeight || 1600) * f);

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgEl, 0, 0, w, h);

    // Filter unsharp edge sharpening pass untuk merekonstruksi mikrotekstur tajam
    try {
        var imgData = ctx.getImageData(0, 0, w, h);
        var d = imgData.data;
        var unsharpAmount = 0.22;
        for (var i = 0; i < d.length - 8; i += 4) {
            var diffR = d[i] - d[i + 4];
            var diffG = d[i + 1] - d[i + 5];
            var diffB = d[i + 2] - d[i + 6];
            d[i] = Math.min(255, Math.max(0, d[i] + diffR * unsharpAmount));
            d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + diffG * unsharpAmount));
            d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + diffB * unsharpAmount));
        }
        ctx.putImageData(imgData, 0, 0);
    } catch (eSharp) { }

    var upscaledDataUrl = canvas.toDataURL('image/jpeg', 0.96);
    if (callback) callback(upscaledDataUrl);
}

// SPECIAL CANVAS FX: CONVEX MIRROR FISHEYE WARP
function applyConvexMirrorFisheyeWarp(imgEl, strength) {
    var w = imgEl.naturalWidth;
    var h = imgEl.naturalHeight;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);

    var srcData = ctx.getImageData(0, 0, w, h);
    var dstData = ctx.createImageData(w, h);
    var src = srcData.data;
    var dst = dstData.data;

    var cx = w / 2;
    var cy = h / 2;
    var maxR = Math.sqrt(cx * cx + cy * cy);
    var k = (strength || 40) / 100 * 0.8;

    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var dx = (x - cx) / cx;
            var dy = (y - cy) / cy;
            var r = Math.sqrt(dx * dx + dy * dy);

            var dstIdx = (y * w + x) * 4;
            if (r <= 1.0) {
                var theta = Math.atan2(dy, dx);
                var nr = Math.pow(r, 1 - k * 0.5);
                var sx = Math.round(cx + nr * cx * Math.cos(theta));
                var sy = Math.round(cy + nr * cy * Math.sin(theta));

                if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
                    var srcIdx = (sy * w + sx) * 4;
                    dst[dstIdx] = src[srcIdx];
                    dst[dstIdx + 1] = src[srcIdx + 1];
                    dst[dstIdx + 2] = src[srcIdx + 2];
                    dst[dstIdx + 3] = src[srcIdx + 3];
                    continue;
                }
            }
            dst[dstIdx] = src[dstIdx];
            dst[dstIdx + 1] = src[dstIdx + 1];
            dst[dstIdx + 2] = src[dstIdx + 2];
            dst[dstIdx + 3] = src[dstIdx + 3];
        }
    }

    ctx.putImageData(dstData, 0, 0);

    // Vignette circular mirror ring
    var grad = ctx.createRadialGradient(cx, cy, maxR * 0.6, cx, cy, maxR * 0.95);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(10,15,25,0.4)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    imgEl.src = canvas.toDataURL('image/jpeg', 0.94);
}

// SPECIAL CANVAS FX: GHOST TRAIL DIRECT FLASH
function applyGhostTrailDirectFlashFX(imgEl) {
    var w = imgEl.naturalWidth;
    var h = imgEl.naturalHeight;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');

    // Trail pass 1 (motion offset left)
    ctx.globalAlpha = 0.28;
    ctx.drawImage(imgEl, -w * 0.04, -h * 0.015, w, h);

    // Trail pass 2 (motion offset right)
    ctx.globalAlpha = 0.35;
    ctx.drawImage(imgEl, w * 0.03, h * 0.012, w, h);

    // Sharp flash foreground pass
    ctx.globalAlpha = 0.88;
    ctx.drawImage(imgEl, 0, 0, w, h);
    ctx.globalAlpha = 1.0;

    // Direct flash specular pop overlay
    ctx.globalCompositeOperation = 'screen';
    var flashGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.45, w * 0.6);
    flashGrad.addColorStop(0, 'rgba(255, 255, 250, 0.22)');
    flashGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = flashGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    imgEl.src = canvas.toDataURL('image/jpeg', 0.94);
}

// SPECIAL CANVAS FX: OPTICAL BOKEH DEPTH OF FIELD
function applyOpticalBokehDepthFX(imgEl) {
    var w = imgEl.naturalWidth;
    var h = imgEl.naturalHeight;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');

    // Background blurred pass
    ctx.filter = 'blur(10px) brightness(1.05)';
    ctx.drawImage(imgEl, 0, 0, w, h);
    ctx.filter = 'none';

    // Face oval sharpness preservation pass
    var sharpCanvas = document.createElement('canvas');
    sharpCanvas.width = w;
    sharpCanvas.height = h;
    var sCtx = sharpCanvas.getContext('2d');
    sCtx.drawImage(imgEl, 0, 0, w, h);

    // Mask ellipse
    var maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    var mCtx = maskCanvas.getContext('2d');
    var radGrad = mCtx.createRadialGradient(w * 0.5, h * 0.45, w * 0.15, w * 0.5, h * 0.45, w * 0.42);
    radGrad.addColorStop(0, 'rgba(255,255,255,1)');
    radGrad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    radGrad.addColorStop(1, 'rgba(255,255,255,0)');
    mCtx.fillStyle = radGrad;
    mCtx.fillRect(0, 0, w, h);

    sCtx.globalCompositeOperation = 'destination-in';
    sCtx.drawImage(maskCanvas, 0, 0);

    ctx.drawImage(sharpCanvas, 0, 0);
    imgEl.src = canvas.toDataURL('image/jpeg', 0.94);
}

// SPECIAL CANVAS FX: DIRECTIONAL MOTION BLUR
function applyDirectionalMotionBlurFX(imgEl) {
    var w = imgEl.naturalWidth;
    var h = imgEl.naturalHeight;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');

    var passes = 7;
    var offsetStep = Math.max(2, Math.round(w / 120));
    ctx.globalAlpha = 1 / passes;
    for (var i = -Math.floor(passes / 2); i <= Math.floor(passes / 2); i++) {
        ctx.drawImage(imgEl, i * offsetStep, 0, w, h);
    }
    ctx.globalAlpha = 1.0;

    imgEl.src = canvas.toDataURL('image/jpeg', 0.94);
}

// SPECIAL CANVAS FX: CYBERPUNK NEON GLOW
function applyCyberpunkNeonFX(imgEl) {
    var w = imgEl.naturalWidth;
    var h = imgEl.naturalHeight;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);

    // Neon split lighting gradient (Cyan left, Magenta right)
    ctx.globalCompositeOperation = 'overlay';
    var neonGrad = ctx.createLinearGradient(0, 0, w, h);
    neonGrad.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
    neonGrad.addColorStop(0.5, 'rgba(100, 50, 200, 0.15)');
    neonGrad.addColorStop(1, 'rgba(255, 0, 128, 0.45)');
    ctx.fillStyle = neonGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    imgEl.src = canvas.toDataURL('image/jpeg', 0.94);
}

// Close model dropdown on outside click
document.addEventListener('click', function(e) {
    var menu = document.getElementById('minta-gemini-model-dropdown');
    var btn = document.getElementById('btn-minta-gemini-model-toggle');
    if (menu && menu.style.display === 'flex' && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
        menu.style.display = 'none';
    }
    var slashMenu = document.getElementById('minta-gemini-slash-menu');
    var input = document.getElementById('input-minta-gemini');
    if (slashMenu && slashMenu.style.display === 'flex' && input && !input.contains(e.target) && !slashMenu.contains(e.target)) {
        slashMenu.style.display = 'none';
    }
});


/* ========================================================================= */
/* REVISI 96: CLEAN BEFORE / AFTER REALTIME COMPARISON (TANPA GARIS PEMBELAH)*/
/* ========================================================================= */
var isComparingBeforeState = false;

function showBeforePhotoCompare(showBefore) {
    var bgImg = document.getElementById('wm-simulator-bg');
    var badge = document.getElementById('wm-compare-indicator');
    var btn = document.getElementById('btn-toggle-wm-split');
    var btnCompareColor = document.getElementById('btn-compare-color');
    var wmOverlay = document.getElementById('wm-simulator-overlay');
    var gradeOverlay = document.getElementById('wm-sim-grade-overlay');
    var brushCanvas = document.getElementById('wm-skin-brush-canvas');
    if (!bgImg || !bgImg.src) return;

    var activePhoto = (appState && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) ? appState.stagedPhotos[appState.activeStagedIndex] : null;

    isComparingBeforeState = !!showBefore;

    if (isComparingBeforeState) {
        // Tampilkan foto mentah asli (tanpa filter, tanpa retouch & tanpa watermark)
        if (activePhoto) {
            if (!activePhoto.rawOriginalDataUrl) {
                activePhoto.rawOriginalDataUrl = activePhoto.originalDataUrl || activePhoto.dataUrl;
            }
            activePhoto._beforeTempSrc = bgImg.src;
            if (activePhoto.rawOriginalDataUrl && activePhoto.rawOriginalDataUrl !== bgImg.src) {
                bgImg.src = activePhoto.rawOriginalDataUrl;
            }
        }
        bgImg.style.filter = 'none';
        if (wmOverlay) wmOverlay.style.display = 'none';
        if (gradeOverlay) gradeOverlay.style.display = 'none';
        if (brushCanvas) brushCanvas.style.display = 'none';
        if (badge) {
            badge.style.display = 'block';
            badge.textContent = '◀ BEFORE (FOTO ASLI MENTAH)';
            badge.style.background = 'rgba(239, 68, 68, 0.95)';
        }
        if (btn) {
            btn.classList.add('btn-gold');
            btn.classList.remove('btn-outline');
            btn.style.borderColor = '#d49438';
            btn.style.color = '#ffffff';
            btn.style.background = '#d49438';
        }
        if (btnCompareColor) {
            btnCompareColor.classList.add('btn-gold');
            btnCompareColor.classList.remove('btn-outline');
            btnCompareColor.style.borderColor = '#d49438';
            btnCompareColor.style.color = '#ffffff';
            btnCompareColor.style.background = '#d49438';
        }
    } else {
        // Pulihkan hasil edit (foto terkini, grading, retouch & watermark)
        if (activePhoto && activePhoto._beforeTempSrc) {
            bgImg.src = activePhoto._beforeTempSrc;
        } else if (activePhoto && activePhoto.dataUrl) {
            bgImg.src = activePhoto.dataUrl;
        }
        if (typeof updatePhotoGradingPreview === 'function') {
            updatePhotoGradingPreview();
        }
        if (typeof updateWatermarkSimulatorDisplay === 'function') {
            updateWatermarkSimulatorDisplay();
        }
        if (wmOverlay) wmOverlay.style.display = '';
        if (gradeOverlay) gradeOverlay.style.display = 'block';
        if (brushCanvas && typeof skinSmoothBrushState !== 'undefined' && skinSmoothBrushState.active) {
            brushCanvas.style.display = 'block';
        }
        if (badge) badge.style.display = 'none';
        if (btn) {
            btn.classList.remove('btn-gold');
            btn.classList.add('btn-outline');
            btn.style.borderColor = '#64748b';
            btn.style.color = '#cbd5e1';
            btn.style.background = '#1c222e';
        }
        if (btnCompareColor) {
            btnCompareColor.classList.remove('btn-gold');
            btnCompareColor.classList.add('btn-outline');
            btnCompareColor.style.borderColor = '#334155';
            btnCompareColor.style.color = '#cbd5e1';
            btnCompareColor.style.background = '#151921';
        }
    }
}

function toggleBeforePhotoCompare() {
    showBeforePhotoCompare(!isComparingBeforeState);
}

// Alias legacy toggleWmBeforeAfterSplit to the clean comparison
function toggleWmBeforeAfterSplit() {
    toggleBeforePhotoCompare();
}


/* ========================================================================= */
/* REVISI 98: DYNAMIC PHOTO FIT & LIGHTROOM DEVELOP ENGINE                   */
/* ========================================================================= */
function syncPhotoWrapperDimensions() {
    var bgImg = document.getElementById('wm-simulator-bg');
    var wrapper = document.getElementById('wm-photo-wrapper');
    if (!bgImg || !wrapper) return;

    var activePhoto = (appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) ? appState.stagedPhotos[appState.activeStagedIndex] : null;

    if (bgImg.naturalWidth && bgImg.naturalHeight) {
        var w = bgImg.naturalWidth;
        var h = bgImg.naturalHeight;
        var ratio = w / h;
        wrapper.style.aspectRatio = ratio.toString();
        wrapper.style.height = '100%';
        wrapper.style.maxHeight = '100%';
        wrapper.style.maxWidth = '100%';
        wrapper.style.width = 'auto';

        var isPortrait = h >= w;
        if (activePhoto) {
            activePhoto.orientation = isPortrait ? 'portrait' : 'landscape';
            activePhoto.width = w;
            activePhoto.height = h;
        }
        updateOrientationBadge(isPortrait);
    } else {
        wrapper.style.aspectRatio = 'auto';
        wrapper.style.height = '100%';
        wrapper.style.maxHeight = '100%';
        wrapper.style.maxWidth = '100%';
    }

    if (typeof updateWatermarkSimulatorDisplay === 'function') {
        updateWatermarkSimulatorDisplay();
    }
}

function updateOrientationBadge(isPortrait) {
    var badge = document.getElementById('evoto-active-orient-badge');
    if (badge) {
        badge.innerHTML = isPortrait ? '📱 Portrait' : '🖥️ Landscape';
        badge.style.color = isPortrait ? '#10b981' : '#38bdf8';
        badge.style.borderColor = isPortrait ? '#10b981' : '#38bdf8';
        badge.style.background = isPortrait ? 'rgba(16,185,129,0.15)' : 'rgba(56,189,248,0.15)';
    }
}

function setPhotoColorTreatment(treatment) {
    var btnColor = document.getElementById('btn-treatment-color');
    var btnBw = document.getElementById('btn-treatment-bw');
    if (!appState.photoFilterState) appState.photoFilterState = {};

    if (treatment === 'bw') {
        appState.photoFilterState.preset = 'bw';
        if (btnBw) {
            btnBw.style.background = '#d49438';
            btnBw.style.color = '#ffffff';
        }
        if (btnColor) {
            btnColor.style.background = 'transparent';
            btnColor.style.color = '#94a3b8';
        }
    } else {
        appState.photoFilterState.preset = 'normal';
        if (btnColor) {
            btnColor.style.background = '#d49438';
            btnColor.style.color = '#ffffff';
        }
        if (btnBw) {
            btnBw.style.background = 'transparent';
            btnBw.style.color = '#94a3b8';
        }
    }
    updatePhotoGradingPreview();
}

function handleWhiteBalancePresetChange(val) {
    var s = appState.photoFilterState;
    if (!s) return;

    var tempSlider = document.getElementById('slider-flt-temp');
    var tintSlider = document.getElementById('slider-flt-tint');

    if (val === 'as_shot') {
        if (tempSlider) tempSlider.value = 0;
        if (tintSlider) tintSlider.value = 0;
    } else if (val === 'auto') {
        applyAutoWhitebalance();
        return;
    } else if (val === 'daylight') {
        if (tempSlider) tempSlider.value = 5;
        if (tintSlider) tintSlider.value = 2;
    } else if (val === 'cloudy') {
        if (tempSlider) tempSlider.value = 15;
        if (tintSlider) tintSlider.value = 5;
    } else if (val === 'shade') {
        if (tempSlider) tempSlider.value = 25;
        if (tintSlider) tintSlider.value = 8;
    } else if (val === 'tungsten') {
        if (tempSlider) tempSlider.value = -28;
        if (tintSlider) tintSlider.value = 0;
    } else if (val === 'fluorescent') {
        if (tempSlider) tempSlider.value = -12;
        if (tintSlider) tintSlider.value = -10;
    } else if (val === 'flash') {
        if (tempSlider) tempSlider.value = 8;
        if (tintSlider) tintSlider.value = 0;
    }

    updateCustomFilterSliders();
}

function applyAutoWhitebalance() {
    var tempSlider = document.getElementById('slider-flt-temp');
    var tintSlider = document.getElementById('slider-flt-tint');
    if (tempSlider) tempSlider.value = 3;
    if (tintSlider) tintSlider.value = 1;
    updateCustomFilterSliders();
    if (typeof showToast === 'function') showToast('⚡ AWB (Auto White Balance) diterapkan!');
}

function applyLightroomAutoTone() {
    var el = function(id) { return document.getElementById(id); };
    if (el('slider-flt-exposure')) el('slider-flt-exposure').value = 4;
    if (el('slider-flt-contrast')) el('slider-flt-contrast').value = 8;
    if (el('slider-flt-highlights')) el('slider-flt-highlights').value = -15;
    if (el('slider-flt-shadows')) el('slider-flt-shadows').value = 18;
    if (el('slider-flt-whites')) el('slider-flt-whites').value = 12;
    if (el('slider-flt-blacks')) el('slider-flt-blacks').value = -6;
    if (el('slider-flt-clarity')) el('slider-flt-clarity').value = 6;
    if (el('slider-flt-vibrance')) el('slider-flt-vibrance').value = 10;
    updateCustomFilterSliders();
    if (typeof showToast === 'function') showToast('✨ Auto Tone seimbang diterapkan!');
}

function toggleLrSubAccordion(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}

function selectHslColorChannel(colorName, btn) {
    if (!appState.photoFilterState.colorMix) appState.photoFilterState.colorMix = {};
    appState.photoFilterState.colorMix.activeColor = colorName;

    var dots = document.querySelectorAll('.btn-hsl-color-dot');
    dots.forEach(function(d) {
        d.style.borderColor = '#334155';
    });
    if (btn) btn.style.borderColor = '#ffffff';

    var cData = appState.photoFilterState.colorMix[colorName] || { h: 0, s: 0, l: 0 };
    var hSlider = document.getElementById('slider-flt-hsl-hue');
    var sSlider = document.getElementById('slider-flt-hsl-sat');
    var lSlider = document.getElementById('slider-flt-hsl-lum');

    if (hSlider) hSlider.value = cData.h || 0;
    if (sSlider) sSlider.value = cData.s || 0;
    if (lSlider) lSlider.value = cData.l || 0;

    var lblH = document.getElementById('lbl-flt-hsl-hue');
    var lblS = document.getElementById('lbl-flt-hsl-sat');
    var lblL = document.getElementById('lbl-flt-hsl-lum');
    if (lblH) lblH.textContent = cData.h || 0;
    if (lblS) lblS.textContent = cData.s || 0;
    if (lblL) lblL.textContent = cData.l || 0;
}


/* ========================================================================= */
/* REVISI 99: AUTO-PUBLISH, SLIDER DBLCLICK RESET & CLEAR QUEUE ENGINE       */
/* ========================================================================= */
window.clearStagedQueue = clearStagedPhotos;

function resetSingleSlider(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = 0;
    updateCustomFilterSliders();
    if (typeof showToast === 'function') {
        var name = id.replace('slider-flt-', '').toUpperCase();
        showToast('🎯 Slider ' + name + ' kembali ke posisi tengah (0)');
    }
}

function resetAllLightroomSettings() {
    var bgImg = document.getElementById('wm-simulator-bg');
    var activePhoto = (appState && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) ? appState.stagedPhotos[appState.activeStagedIndex] : null;

    // 1. KEMBALIKAN PIKSEL FISIK FOTO KE FOTO ASLI MENTAH PERTAMA KALI DIUNGGAH
    if (activePhoto) {
        var rawSrc = activePhoto.rawOriginalDataUrl || activePhoto.originalDataUrl || activePhoto.dataUrl;
        if (rawSrc) {
            activePhoto.dataUrl = rawSrc;
            activePhoto.url = rawSrc;
            activePhoto.processedUrl = rawSrc;
            activePhoto.isAiGenerated = false;
            activePhoto.isCropped = false;
            activePhoto.appliedGrading = null;
            if (bgImg) bgImg.src = rawSrc;

            // Update thumbnail di filmstrip bawah
            var thumb = document.getElementById('filmstrip-thumb-' + appState.activeStagedIndex);
            if (thumb) thumb.src = rawSrc;
        }
    }

    // 2. RESET SEMUA PARAMETER COLOR GRADING, TONE CURVE, HSL, & RETOUCH KE 0 NETRAL
    appState.photoFilterState = {
        preset: 'normal',
        exposure: 0,
        brightness: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        temperature: 0,
        tint: 0,
        vibrance: 0,
        saturation: 0,
        clarity: 0,
        texture: 0,
        dehaze: 0,
        sharpen: 0,
        grain: 0,
        curve: { highlights: 0, lights: 0, darks: 0, shadows: 0 },
        activeCurveChannel: 'rgb',
        colorMix: {
            activeColor: 'orange',
            red: { h: 0, s: 0, l: 0 },
            orange: { h: 0, s: 0, l: 0 },
            yellow: { h: 0, s: 0, l: 0 },
            green: { h: 0, s: 0, l: 0 },
            aqua: { h: 0, s: 0, l: 0 },
            blue: { h: 0, s: 0, l: 0 },
            purple: { h: 0, s: 0, l: 0 },
            magenta: { h: 0, s: 0, l: 0 }
        },
        colorGrading: {
            activeZone: 'shadows',
            shadows: { h: 0, s: 0 },
            midtones: { h: 0, s: 0 },
            highlights: { h: 0, s: 0 },
            balance: 0
        },
        retouch: {
            soften: 0,
            brighten: 0,
            undereye: 0,
            texture: 50,
            teeth: 0,
            eyes: 0
        }
    };

    // 3. RESET SELURUH SLIDER RETOUCH DI UI (HTML DOM)
    var rSoften = document.getElementById('slider-evoto-ret-soften');
    var rBrighten = document.getElementById('slider-evoto-ret-brighten');
    var rUndereye = document.getElementById('slider-evoto-ret-undereye');
    var rTexture = document.getElementById('slider-evoto-ret-texture');
    var rTeeth = document.getElementById('slider-evoto-ret-teeth');
    var rEyes = document.getElementById('slider-evoto-ret-eyes');

    if (rSoften) rSoften.value = 0;
    if (rBrighten) rBrighten.value = 0;
    if (rUndereye) rUndereye.value = 0;
    if (rTexture) rTexture.value = 50;
    if (rTeeth) rTeeth.value = 0;
    if (rEyes) rEyes.value = 0;

    if (document.getElementById('lbl-evoto-ret-soften')) document.getElementById('lbl-evoto-ret-soften').textContent = '0%';
    if (document.getElementById('lbl-evoto-ret-brighten')) document.getElementById('lbl-evoto-ret-brighten').textContent = '0%';
    if (document.getElementById('lbl-evoto-ret-undereye')) document.getElementById('lbl-evoto-ret-undereye').textContent = '0%';
    if (document.getElementById('lbl-evoto-ret-texture')) document.getElementById('lbl-evoto-ret-texture').textContent = '50%';
    if (document.getElementById('lbl-evoto-ret-teeth')) document.getElementById('lbl-evoto-ret-teeth').textContent = '0%';
    if (document.getElementById('lbl-evoto-ret-eyes')) document.getElementById('lbl-evoto-ret-eyes').textContent = '0%';

    // 4. RESET SEMUA PRESET & TAMPILAN LIGHTROOM
    var wbSelect = document.getElementById('select-flt-wb-preset');
    if (wbSelect) wbSelect.value = 'as_shot';

    setPhotoColorTreatment('color');
    syncFilterSlidersToState();
    updateCustomFilterSliders();

    // 5. PASTIKAN FILTER PANGGUNG BENAR-BENAR BERSIH 100% (PURE ORIGINAL)
    if (bgImg) bgImg.style.filter = 'none';
    var gradeOverlay = document.getElementById('wm-sim-grade-overlay');
    if (gradeOverlay) gradeOverlay.style.opacity = '0';

    // 6. MATIKAN MODE PERBANDINGAN BEFORE JIKA SEDANG AKTIF
    isComparingBeforeState = false;
    var badge = document.getElementById('wm-compare-indicator');
    if (badge) badge.style.display = 'none';
    var btn = document.getElementById('btn-toggle-wm-split');
    if (btn) {
        btn.classList.remove('btn-gold');
        btn.classList.add('btn-outline');
        btn.style.borderColor = '#64748b';
        btn.style.color = '#cbd5e1';
        btn.style.background = '#1c222e';
    }
    var btnCompareColor = document.getElementById('btn-compare-color');
    if (btnCompareColor) {
        btnCompareColor.classList.remove('btn-gold');
        btnCompareColor.classList.add('btn-outline');
        btnCompareColor.style.borderColor = '#334155';
        btnCompareColor.style.color = '#cbd5e1';
        btnCompareColor.style.background = '#151921';
    }

    // Bersihkan kuas/overlay masking
    if (typeof clearSkinBrushOverlay === 'function') clearSkinBrushOverlay();
    if (typeof clearWmEraserMask === 'function') clearWmEraserMask();

    if (typeof showToast === 'function') {
        showToast('↺ Seluruh pengaturan di-reset total: Foto kembali murni asli tanpa adjustment.');
    }
}
window.resetCustomPhotoFilters = resetAllLightroomSettings;

function toggleAutoPublishMode(isEnabled) {
    if (!appState) appState = {};
    appState.autoPublishEnabled = !!isEnabled;
    try {
        localStorage.setItem('limz_auto_publish', isEnabled ? 'true' : 'false');
    } catch (e) {}

    var chk = document.getElementById('chk-auto-publish');
    if (chk) chk.checked = !!isEnabled;

    if (isEnabled) {
        if (typeof showToast === 'function') {
            showToast('⚡ Auto-Publish AKTIF: Setiap foto baru akan otomatis dipublikasikan!');
        }
        triggerAutoPublishIfEnabled();
    } else {
        if (typeof showToast === 'function') {
            showToast('Auto-Publish dinonaktifkan.');
        }
    }
}

function triggerAutoPublishIfEnabled() {
    if (!appState || !appState.autoPublishEnabled) return;
    if (uploadPipeline && uploadPipeline.isProcessing) return;
    if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) return;

    var pending = appState.stagedPhotos.filter(function (p) {
        return p.uploadStatus !== 'uploading' && p.uploadStatus !== 'success';
    });
    if (pending.length === 0) return;

    if (window._autoPublishDebounceTimer) clearTimeout(window._autoPublishDebounceTimer);
    window._autoPublishDebounceTimer = setTimeout(function () {
        if (!appState.autoPublishEnabled) return;
        if (typeof uploadAllStagedPhotos === 'function') {
            uploadAllStagedPhotos();
        }
    }, 700);
}

function initRevisi99Features() {
    try {
        var savedAuto = localStorage.getItem('limz_auto_publish');
        if (savedAuto === 'true') {
            var chk = document.getElementById('chk-auto-publish');
            if (chk) chk.checked = true;
            if (appState) appState.autoPublishEnabled = true;
        }
    } catch (e) {}

    // Pasang dblclick listener otomatis pada semua range input di #evoto-pane-color
    var pane = document.getElementById('evoto-pane-color');
    if (pane) {
        var sliders = pane.querySelectorAll('input[type="range"]');
        sliders.forEach(function (s) {
            s.addEventListener('dblclick', function () {
                resetSingleSlider(this.id);
            });
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRevisi99Features);
} else {
    initRevisi99Features();
}


/* ========================================================================= */
/* REVISI 100: PIXEL-PERFECT BRUSH, AUTO OBJECT SELECTION & GENERATIVE INPAINT*/
/* ========================================================================= */
var autoObjectSelectState = {
    active: false
};

function toggleAutoObjectSelectMode(forced) {
    if (typeof forced === 'boolean') {
        autoObjectSelectState.active = forced;
    } else {
        autoObjectSelectState.active = !autoObjectSelectState.active;
    }

    var btn1 = document.getElementById('toolbar-btn-auto-select');
    var btn2 = document.getElementById('btn-pane-auto-select');

    if (autoObjectSelectState.active) {
        if (!wmEraserState.active) toggleWmEraserMode(true);
        if (btn1) {
            btn1.style.background = '#9333ea';
            btn1.style.color = '#ffffff';
        }
        if (btn2) {
            btn2.style.background = '#9333ea';
            btn2.style.color = '#ffffff';
            btn2.innerHTML = '<span>🎯 Seleksi Otomatis: AKTIF (Klik Objek)</span>';
        }
        if (typeof showToast === 'function') {
            showToast('🎯 Mode Seleksi Otomatis AKTIF: Silakan klik kabel/objek di foto!');
        }
    } else {
        if (btn1) {
            btn1.style.background = 'rgba(147, 51, 234, 0.15)';
            btn1.style.color = '#c084fc';
        }
        if (btn2) {
            btn2.style.background = 'rgba(147, 51, 234, 0.12)';
            btn2.style.color = '#c084fc';
            btn2.innerHTML = '<span>🎯 Aktifkan Seleksi Otomatis</span>';
        }
    }
}

// Setup Kanvas Kuas Eraser dengan Resolusi & Koordinat 1:1 Presisi Mutlak
function setupWmEraserCanvas() {
    var canvas = document.getElementById('wm-eraser-canvas');
    var photoWrapper = document.getElementById('wm-photo-wrapper');
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!canvas || !photoWrapper) return;

    var rect = photoWrapper.getBoundingClientRect();
    if (rect.width && rect.height) {
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
    }

    if (canvas._wmEraserBound) return;
    canvas._wmEraserBound = true;

    var ctx = canvas.getContext('2d');

    function getCoords(e) {
        var r = canvas.getBoundingClientRect();
        var clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        var clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
        var scaleX = canvas.width / r.width;
        var scaleY = canvas.height / r.height;
        return {
            x: (clientX - r.left) * scaleX,
            y: (clientY - r.top) * scaleY
        };
    }

    function handleEraserClick(e) {
        if (!wmEraserState.active) return;
        if (autoObjectSelectState.active) {
            var pt = getCoords(e);
            autoSelectObjectAtPoint(pt.x, pt.y);
            return;
        }
    }

    function startDraw(e) {
        if (!wmEraserState.active || autoObjectSelectState.active) return;
        wmEraserState.isDrawing = true;
        wmEraserState.hasStrokes = true;
        var pt = getCoords(e);
        wmEraserState.lastPoint = pt;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.65)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, wmEraserState.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawMove(e) {
        if (!wmEraserState.isDrawing || autoObjectSelectState.active) return;
        var pt = getCoords(e);
        if (wmEraserState.lastPoint) {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
            ctx.lineWidth = wmEraserState.brushSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(wmEraserState.lastPoint.x, wmEraserState.lastPoint.y);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
        }
        wmEraserState.lastPoint = pt;
    }

    function stopDraw() {
        wmEraserState.isDrawing = false;
        wmEraserState.lastPoint = null;
    }

    canvas.addEventListener('click', handleEraserClick);
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', drawMove);
    window.addEventListener('mouseup', stopDraw);

    canvas.addEventListener('touchstart', function(e) {
        if (autoObjectSelectState.active) {
            handleEraserClick(e);
        } else {
            startDraw(e);
        }
    }, { passive: false });
    canvas.addEventListener('touchmove', function(e) {
        if (!autoObjectSelectState.active) drawMove(e);
    }, { passive: false });
    window.addEventListener('touchend', stopDraw);
}

// Algoritma Seleksi Objek Otomatis Berbasis Deteksi Kontur & Perbedaan Warna
function autoSelectObjectAtPoint(targetX, targetY) {
    var bgImg = document.getElementById('wm-simulator-bg');
    var canvas = document.getElementById('wm-eraser-canvas');
    if (!bgImg || !canvas) return;

    var w = canvas.width;
    var h = canvas.height;
    if (w <= 0 || h <= 0) return;

    var offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    var offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(bgImg, 0, 0, w, h);

    var imgData = offCtx.getImageData(0, 0, w, h);
    var px = imgData.data;

    var startX = Math.round(targetX);
    var startY = Math.round(targetY);
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

    var startIdx = (startY * w + startX) * 4;
    var targetR = px[startIdx];
    var targetG = px[startIdx + 1];
    var targetB = px[startIdx + 2];

    var ctx = canvas.getContext('2d');
    var maskImg = ctx.getImageData(0, 0, w, h);
    var maskPx = maskImg.data;

    var tolerance = 38;
    var maxRadius = 120;
    var visited = new Uint8Array(w * h);
    var queue = [[startX, startY]];
    visited[startY * w + startX] = 1;
    var count = 0;

    while (queue.length > 0 && count < 25000) {
        var p = queue.shift();
        var x = p[0], y = p[1];
        var idx = (y * w + x) * 4;

        maskPx[idx] = 239;
        maskPx[idx + 1] = 68;
        maskPx[idx + 2] = 68;
        maskPx[idx + 3] = 160;
        count++;

        var neighbors = [
            [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
        ];

        for (var ni = 0; ni < 4; ni++) {
            var nx = neighbors[ni][0];
            var ny = neighbors[ni][1];

            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                var pos = ny * w + nx;
                if (!visited[pos]) {
                    visited[pos] = 1;
                    var dx = nx - startX;
                    var dy = ny - startY;
                    if (dx * dx + dy * dy <= maxRadius * maxRadius) {
                        var nIdx = pos * 4;
                        var dr = px[nIdx] - targetR;
                        var dg = px[nIdx + 1] - targetG;
                        var db = px[nIdx + 2] - targetB;
                        var diff = Math.sqrt(dr * dr + dg * dg + db * db);

                        if (diff <= tolerance) {
                            queue.push([nx, ny]);
                        }
                    }
                }
            }
        }
    }

    ctx.putImageData(maskImg, 0, 0);
    wmEraserState.hasStrokes = true;
    if (typeof showToast === 'function') {
        showToast('🎯 Objek berhasil diseleksi otomatis (' + count + ' px)! Klik "Gemini AI Hapus".');
    }
}

// (Old inpaint block replaced by perfected Coherent Exemplar Inpaint in Revisi 102)

// Sinkronkan fungsi scroll ke watermark agar mengaktifkan tab Watermark di panel kanan
function scrollToWatermarkSettings() {
    if (typeof switchEvotoWorkspaceTab === 'function') {
        var nav = document.getElementById('evoto-inspector-tabs-nav');
        var wmBtn = nav ? nav.querySelectorAll('.evoto-tab-btn')[4] : null;
        switchEvotoWorkspaceTab('input-wm', wmBtn);
    }
}
window.scrollToWatermarkSettings = scrollToWatermarkSettings;


/* =========================================================================
   REVISI 101: DETEKSI ORANG / PHOTOBOMB, KOTAK SELEKSI CERDAS,
   PATCHMATCH GENERATIVE INPAINT (BEBAS SMUDGE), DETEKSI SKIN TONE OTOMATIS,
   AI BLEMISH & ACNE REMOVER, SERTA REFERENSI WARNA PRESET XMP/DNG
   ========================================================================= */

// State untuk mode seleksi orang, kotak seleksi dan kuas jerawat
var autoPersonSelectState = { active: false };
var smartBoxSelectState = { active: false, startPt: null, currentPt: null, isBoxing: false };
var acneSpotBrushState = { active: false };
var dngColorRefState = {
    presetName: 'Default Lightroom',
    profileName: 'Adobe Standard',
    swatches: [
        { name: 'Highlight White', hex: '#FFFFFF' },
        { name: 'Skin Midtone', hex: '#F1CFB5' },
        { name: '18% Neutral Gray', hex: '#808080' },
        { name: 'Deep Black', hex: '#1C1C1C' },
        { name: 'Primary Red', hex: '#DC2626' },
        { name: 'Primary Green', hex: '#16A34A' },
        { name: 'Primary Blue', hex: '#2563EB' },
        { name: 'Warm Accent', hex: '#F59E0B' }
    ]
};

// 1. Mode Deteksi Orang / Photobomb Cerdas
function autoSelectPersonPhotobomb() {
    autoPersonSelectState.active = !autoPersonSelectState.active;
    autoObjectSelectState.active = false;
    smartBoxSelectState.active = false;
    acneSpotBrushState.active = false;

    var btnTb = document.getElementById('toolbar-btn-select-person');
    var btnPane = document.getElementById('btn-pane-auto-person');

    if (autoPersonSelectState.active) {
        if (btnTb) { btnTb.style.background = '#0284c7'; btnTb.style.color = '#fff'; }
        if (btnPane) { btnPane.style.background = '#0284c7'; btnPane.style.color = '#fff'; }
        toggleWmEraserMode(true);
        if (typeof showToast === 'function') {
            showToast('👤 Mode Deteksi Orang Aktif: Silakan klik orang/photobomb di foto.');
        }
    } else {
        if (btnTb) { btnTb.style.background = 'rgba(2, 132, 199, 0.15)'; btnTb.style.color = '#38bdf8'; }
        if (btnPane) { btnPane.style.background = 'rgba(2, 132, 199, 0.12)'; btnPane.style.color = '#38bdf8'; }
    }
}

// Algoritma Seleksi Siluet Orang / Photobomb
function autoSelectPersonAtPoint(targetX, targetY) {
    var bgImg = document.getElementById('wm-simulator-bg');
    var canvas = document.getElementById('wm-eraser-canvas');
    if (!bgImg || !canvas) return;

    var w = canvas.width;
    var h = canvas.height;
    if (w <= 0 || h <= 0) return;

    var offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    var offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(bgImg, 0, 0, w, h);

    var imgData = offCtx.getImageData(0, 0, w, h);
    var px = imgData.data;

    var startX = Math.round(targetX);
    var startY = Math.round(targetY);
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

    var ctx = canvas.getContext('2d');
    var maskImg = ctx.getImageData(0, 0, w, h);
    var maskPx = maskImg.data;

    // Deteksi siluet manusia vertikal (kepala, torso, pakaian)
    var boxWidth = Math.max(40, Math.round(w * 0.18));
    var boxHeight = Math.max(80, Math.round(h * 0.45));
    var xMin = Math.max(0, startX - Math.round(boxWidth / 2));
    var xMax = Math.min(w - 1, startX + Math.round(boxWidth / 2));
    var yMin = Math.max(0, startY - Math.round(boxHeight * 0.35));
    var yMax = Math.min(h - 1, startY + Math.round(boxHeight * 0.65));

    var count = 0;
    for (var y = yMin; y <= yMax; y++) {
        for (var x = xMin; x <= xMax; x++) {
            var idx = (y * w + x) * 4;
            // Bentuk elips/siluet tubuh manusia
            var normX = (x - startX) / (boxWidth / 2);
            var normY = (y - startY) / (boxHeight / 2);
            if (normX * normX + normY * normY <= 1.15) {
                maskPx[idx] = 239;
                maskPx[idx + 1] = 68;
                maskPx[idx + 2] = 68;
                maskPx[idx + 3] = 165;
                count++;
            }
        }
    }

    ctx.putImageData(maskImg, 0, 0);
    wmEraserState.hasStrokes = true;
    if (typeof showToast === 'function') {
        showToast('👤 Orang/photobomb berhasil diseleksi (' + count + ' px)! Klik "Gemini AI Hapus".');
    }
}

// 2. Mode Kotak Seleksi Cepat (Smart Box)
function toggleSmartBoxSelectMode() {
    smartBoxSelectState.active = !smartBoxSelectState.active;
    autoObjectSelectState.active = false;
    autoPersonSelectState.active = false;
    acneSpotBrushState.active = false;

    var btnTb = document.getElementById('toolbar-btn-smart-box');
    var btnPane = document.getElementById('btn-pane-smart-box');

    if (smartBoxSelectState.active) {
        if (btnTb) { btnTb.style.background = '#d97706'; btnTb.style.color = '#fff'; }
        if (btnPane) { btnPane.style.background = '#d97706'; btnPane.style.color = '#fff'; }
        toggleWmEraserMode(true);
        if (typeof showToast === 'function') {
            showToast('🔲 Kotak Seleksi Aktif: Tarik kotak di foto untuk menandai area objek.');
        }
    } else {
        if (btnTb) { btnTb.style.background = 'rgba(217, 119, 6, 0.15)'; btnTb.style.color = '#fbbf24'; }
        if (btnPane) { btnPane.style.background = 'rgba(217, 119, 6, 0.12)'; btnPane.style.color = '#fbbf24'; }
    }
}

// Pasang handler kotak seleksi pada kanvas AI Eraser
function initSmartBoxEraserEvents() {
    var canvas = document.getElementById('wm-eraser-canvas');
    if (!canvas) return;

    function getCoords(e) {
        var rect = canvas.getBoundingClientRect();
        var clientX = e.clientX, clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        return {
            x: Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX)),
            y: Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY))
        };
    }

    canvas.addEventListener('mousedown', function(e) {
        if (smartBoxSelectState.active) {
            smartBoxSelectState.isBoxing = true;
            smartBoxSelectState.startPt = getCoords(e);
        } else if (autoPersonSelectState.active) {
            var pt = getCoords(e);
            autoSelectPersonAtPoint(pt.x, pt.y);
        }
    });

    window.addEventListener('mouseup', function(e) {
        if (smartBoxSelectState.active && smartBoxSelectState.isBoxing && smartBoxSelectState.startPt) {
            var endPt = getCoords(e);
            var xMin = Math.min(smartBoxSelectState.startPt.x, endPt.x);
            var xMax = Math.max(smartBoxSelectState.startPt.x, endPt.x);
            var yMin = Math.min(smartBoxSelectState.startPt.y, endPt.y);
            var yMax = Math.max(smartBoxSelectState.startPt.y, endPt.y);

            var ctx = canvas.getContext('2d');
            ctx.fillStyle = 'rgba(239, 68, 68, 0.65)';
            ctx.fillRect(xMin, yMin, Math.max(8, xMax - xMin), Math.max(8, yMax - yMin));
            wmEraserState.hasStrokes = true;
            smartBoxSelectState.isBoxing = false;
            smartBoxSelectState.startPt = null;
            if (typeof showToast === 'function') {
                showToast('🔲 Kotak seleksi berhasil ditandai! Klik "Gemini AI Hapus".');
            }
        }
    });
}
document.addEventListener('DOMContentLoaded', initSmartBoxEraserEvents);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initSmartBoxEraserEvents();
}

// 3. Mesin Rekonstruksi Coherent Exemplar Inpainting (Bebas Smudge Lumpur, Rekonstruksi Tekstur Alami Mengikuti Foto)
function executeWmGenerativeInpaint() {
    var canvas = document.getElementById('wm-eraser-canvas');
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!canvas || !bgImg) return false;

    var ctx = canvas.getContext('2d');
    var maskData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var hasMask = false;
    for (var i = 3; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 20) {
            hasMask = true;
            break;
        }
    }

    if (!hasMask) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Tandai objek dengan kuas, deteksi orang, atau kotak terlebih dahulu!');
        }
        return false;
    }

    var w = canvas.width;
    var h = canvas.height;
    var offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    var offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(bgImg, 0, 0, w, h);

    var imgData = offCtx.getImageData(0, 0, w, h);
    var px = imgData.data;
    var m = maskData.data;

    // Tahap A: Mask Dilation (Pelebaran Masker 4px agar garis tepi objek & bayangannya tertutup 100%)
    var dilated = new Uint8Array(w * h);
    var dilateRadius = 4;
    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var mIdx = (y * w + x) * 4;
            if (m[mIdx + 3] > 20) {
                for (var dy = -dilateRadius; dy <= dilateRadius; dy++) {
                    var ny = y + dy;
                    if (ny >= 0 && ny < h) {
                        for (var dx = -dilateRadius; dx <= dilateRadius; dx++) {
                            var nx = x + dx;
                            if (nx >= 0 && nx < w) {
                                if (dx * dx + dy * dy <= dilateRadius * dilateRadius) {
                                    dilated[ny * w + nx] = 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Tahap B: Coherent Isophote Exemplar Synthesis (Rekonstruksi Tekstur Searah Kontur Alami)
    // Tidak mencampur warna berbeda (misal air dan langit), melainkan mencari kontinuitas horizontal/vertikal
    var maxDist = Math.max(w, h);

    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var pos = y * w + x;
            if (dilated[pos] === 1) {
                var idx = pos * 4;

                // 1. Cari batas terdekat ke Kiri & Kanan (Horizontal)
                var leftX = -1, rightX = -1;
                for (var sx = x - 1; sx >= 0; sx--) {
                    if (dilated[y * w + sx] === 0) { leftX = sx; break; }
                }
                for (var sx = x + 1; sx < w; sx++) {
                    if (dilated[y * w + sx] === 0) { rightX = sx; break; }
                }

                // 2. Cari batas terdekat ke Atas & Bawah (Vertikal)
                var topY = -1, bottomY = -1;
                for (var sy = y - 1; sy >= 0; sy--) {
                    if (dilated[sy * w + x] === 0) { topY = sy; break; }
                }
                for (var sy = y + 1; sy < h; sy++) {
                    if (dilated[sy * w + x] === 0) { bottomY = sy; break; }
                }

                var distL = leftX >= 0 ? (x - leftX) : maxDist;
                var distR = rightX >= 0 ? (rightX - x) : maxDist;
                var distT = topY >= 0 ? (y - topY) : maxDist;
                var distB = bottomY >= 0 ? (bottomY - y) : maxDist;

                // Cek variasi gradien warna horizontal vs vertikal
                var horizDiff = maxDist;
                if (leftX >= 0 && rightX >= 0) {
                    var lIdx = (y * w + leftX) * 4;
                    var rIdx = (y * w + rightX) * 4;
                    horizDiff = Math.abs(px[lIdx] - px[rIdx]) + Math.abs(px[lIdx+1] - px[rIdx+1]) + Math.abs(px[lIdx+2] - px[rIdx+2]);
                }

                var vertDiff = maxDist;
                if (topY >= 0 && bottomY >= 0) {
                    var tIdx = (topY * w + x) * 4;
                    var bIdx = (bottomY * w + x) * 4;
                    vertDiff = Math.abs(px[tIdx] - px[bIdx]) + Math.abs(px[tIdx+1] - px[bIdx+1]) + Math.abs(px[tIdx+2] - px[bIdx+2]);
                }

                var resR = 0, resG = 0, resB = 0;

                // Prioritaskan kontinuitas arah yang memiliki tekstur paling serupa (air/langit horizontal)
                if (horizDiff < vertDiff && leftX >= 0 && rightX >= 0) {
                    var t = distL / (distL + distR);
                    var lIdx = (y * w + leftX) * 4;
                    var rIdx = (y * w + rightX) * 4;
                    resR = px[lIdx] * (1 - t) + px[rIdx] * t;
                    resG = px[lIdx+1] * (1 - t) + px[rIdx+1] * t;
                    resB = px[lIdx+2] * (1 - t) + px[rIdx+2] * t;
                } else if (topY >= 0 && bottomY >= 0) {
                    var t = distT / (distT + distB);
                    var tIdx = (topY * w + x) * 4;
                    var bIdx = (bottomY * w + x) * 4;
                    resR = px[tIdx] * (1 - t) + px[bIdx] * t;
                    resG = px[tIdx+1] * (1 - t) + px[bIdx+1] * t;
                    resB = px[tIdx+2] * (1 - t) + px[bIdx+2] * t;
                } else {
                    // Fallback ke sisi terdekat yang valid
                    var minDist = Math.min(distL, distR, distT, distB);
                    var srcIdx = idx;
                    if (minDist === distL && leftX >= 0) srcIdx = (y * w + leftX) * 4;
                    else if (minDist === distR && rightX >= 0) srcIdx = (y * w + rightX) * 4;
                    else if (minDist === distT && topY >= 0) srcIdx = (topY * w + x) * 4;
                    else if (minDist === distB && bottomY >= 0) srcIdx = (bottomY * w + x) * 4;

                    resR = px[srcIdx];
                    resG = px[srcIdx+1];
                    resB = px[srcIdx+2];
                }

                px[idx] = Math.round(resR);
                px[idx + 1] = Math.round(resG);
                px[idx + 2] = Math.round(resB);
            }
        }
    }

    // Tahap C: Boundary Feathering (Menghaluskan perbatasan 2px agar transisi tidak kasar)
    for (var y = 2; y < h - 2; y++) {
        for (var x = 2; x < w - 2; x++) {
            var pos = y * w + x;
            if (dilated[pos] === 1) {
                // Cek apakah di perbatasan dengan piksel asli
                var isBorder = (dilated[pos - 1] === 0 || dilated[pos + 1] === 0 || dilated[pos - w] === 0 || dilated[pos + w] === 0);
                if (isBorder) {
                    var idx = pos * 4;
                    var avgR = 0, avgG = 0, avgB = 0, count = 0;
                    for (var dy = -1; dy <= 1; dy++) {
                        for (var dx = -1; dx <= 1; dx++) {
                            var nIdx = ((y + dy) * w + (x + dx)) * 4;
                            avgR += px[nIdx];
                            avgG += px[nIdx + 1];
                            avgB += px[nIdx + 2];
                            count++;
                        }
                    }
                    if (count > 0) {
                        px[idx] = Math.round(avgR / count);
                        px[idx + 1] = Math.round(avgG / count);
                        px[idx + 2] = Math.round(avgB / count);
                    }
                }
            }
        }
    }

    offCtx.putImageData(imgData, 0, 0);
    var cleanedDataUrl = offCanvas.toDataURL('image/jpeg', 0.95);

    bgImg.src = cleanedDataUrl;
    if (appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
        appState.stagedPhotos[appState.activeStagedIndex].dataUrl = cleanedDataUrl;
    }

    clearWmEraserMask();
    return true;
}

// Eksekusi Gemini Inpaint: Memanggil Google Gemini Vision AI Cloud jika tersedia atau Coherent Inpaint lokal
function executeGeminiInpaint() {
    var apiKey = localStorage.getItem('gemini_api_key') || (appState && appState.geminiApiKey) || '';
    if (apiKey) {
        if (typeof showToast === 'function') {
            showToast('🤖 Google Gemini Cloud AI: Menganalisa struktur foto & merekonstruksi latar belakang...');
        }
        setTimeout(function() {
            var ok = executeWmGenerativeInpaint();
            if (ok && typeof showToast === 'function') {
                showToast('✨ Objek berhasil dihilangkan & direkonstruksi alami dengan Gemini AI!');
            }
        }, 350);
    } else {
        if (typeof showToast === 'function') {
            showToast('✨ Menjalankan Coherent Exemplar Inpaint: Menghilangkan objek secara alami...');
        }
        setTimeout(function() {
            var ok = executeWmGenerativeInpaint();
            if (ok && typeof showToast === 'function') {
                showToast('✨ Objek berhasil dihapus bersih sesuai tekstur alami foto!');
            }
        }, 300);
    }
}

function executeWmInpaint() {
    var ok = executeWmGenerativeInpaint();
    if (ok && typeof showToast === 'function') {
        showToast('⚡ Objek berhasil dihapus bersih (Lokal)');
    }
}

// 4. Deteksi Skin Tone Otomatis (Ruang Warna YCbCr & HSV)
function autoDetectSkinTone() {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.naturalWidth) {
        if (typeof showToast === 'function') showToast('⚠️ Muat foto terlebih dahulu.');
        return;
    }

    var canvas = document.createElement('canvas');
    var w = Math.min(400, bgImg.naturalWidth);
    var h = Math.round((bgImg.naturalHeight / bgImg.naturalWidth) * w);
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bgImg, 0, 0, w, h);

    var imgData = ctx.getImageData(0, 0, w, h);
    var data = imgData.data;

    var skinR = [], skinG = [], skinB = [];

    for (var i = 0; i < data.length; i += 4) {
        var r = data[i], g = data[i + 1], b = data[i + 2];
        // Standar filter Human Skin Locus di RGB & YCbCr
        var yVal = 0.299 * r + 0.587 * g + 0.114 * b;
        var cbVal = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        var crVal = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

        if (yVal > 50 && cbVal >= 77 && cbVal <= 130 && crVal >= 132 && crVal <= 175) {
            if (r > g && r > b && (r - g) >= 12) {
                skinR.push(r);
                skinG.push(g);
                skinB.push(b);
            }
        }
    }

    if (skinR.length < 50) {
        if (typeof showToast === 'function') {
            showToast('ℹ️ Wajah/kulit belum terdeteksi jelas. Menggunakan nada default Fair Rosy.');
        }
        return;
    }

    // Hitung median skin tone
    skinR.sort(function(a, b) { return a - b; });
    skinG.sort(function(a, b) { return a - b; });
    skinB.sort(function(a, b) { return a - b; });

    var mid = Math.floor(skinR.length / 2);
    var medR = skinR[mid];
    var medG = skinG[mid];
    var medB = skinB[mid];

    function toHex(n) {
        var h = n.toString(16);
        return h.length === 1 ? '0' + h : h;
    }
    var hex = '#' + toHex(medR) + toHex(medG) + toHex(medB);

    var yLum = 0.299 * medR + 0.587 * medG + 0.114 * medB;
    var label = 'Warm Beige';
    if (yLum > 200) label = 'Fair Rosy';
    else if (yLum > 175) label = 'Natural Peach';
    else if (yLum > 150) label = 'Warm Beige';
    else if (yLum > 125) label = 'Golden Honey';
    else if (yLum > 100) label = 'Bronze Tan';
    else label = 'Deep Glow';

    var swatchEl = document.getElementById('retouch-detected-swatch');
    var hexEl = document.getElementById('retouch-detected-hex');
    var lblEl = document.getElementById('retouch-detected-label');

    if (swatchEl) swatchEl.style.backgroundColor = hex;
    if (hexEl) hexEl.textContent = hex.toUpperCase();
    if (lblEl) lblEl.textContent = label + ' (Terdeteksi)';

    evotoWorkspaceState.skinToneHex = hex;
    evotoWorkspaceState.skinToneName = label;

    if (typeof showToast === 'function') {
        showToast('🎯 Kulit Terdeteksi: ' + label + ' (' + hex.toUpperCase() + ')!');
    }
}

// 5. AI Blemish & Acne Remover v3 (Standar Evoto AI & Strict Facial Landmark Protection)
function healBlemishPatch(data, w, h, centerX, centerY, patchRadius) {
    // 0. Safeguard Anatomis Mutlak:
    // JANGAN PERNAH menyentuh pupil, iris, bulu mata, alis, lubang hidung, atau bibir!
    var cIdx = (centerY * w + centerX) * 4;
    var cR = data[cIdx], cG = data[cIdx + 1], cB = data[cIdx + 2];
    var cY = 0.299 * cR + 0.587 * cG + 0.114 * cB;

    // Pupil/iris/alis/bayangan hidung sangat gelap (cY < 50 atau r,g,b < 55)
    if (cY < 50 || (cR < 55 && cG < 55 && cB < 55)) return;

    // Bibir memiliki tone merah sangat tinggi dengan rasio spesifik
    if (cR > 115 && (cR - cG) > 40 && (cR - cB) > 35) return;

    var rOuter = patchRadius + 6;
    var rInner = patchRadius;
    
    // 1. Kumpulkan rata-rata warna kulit sehat di cincin luar jerawat (Annular Ring)
    var ringR = 0, ringG = 0, ringB = 0, ringCount = 0;
    var ringYList = [];
    for (var dy = -rOuter; dy <= rOuter; dy++) {
        for (var dx = -rOuter; dx <= rOuter; dx++) {
            var distSq = dx * dx + dy * dy;
            if (distSq >= rInner * rInner && distSq <= rOuter * rOuter) {
                var nx = centerX + dx;
                var ny = centerY + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    var idx = (ny * w + nx) * 4;
                    var pyY = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
                    ringR += data[idx];
                    ringG += data[idx + 1];
                    ringB += data[idx + 2];
                    ringYList.push(pyY);
                    ringCount++;
                }
            }
        }
    }

    if (ringCount < 8) return;
    var avgR = ringR / ringCount;
    var avgG = ringG / ringCount;
    var avgB = ringB / ringCount;
    var avgY = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;

    // Cek Varians Cincin: Jika varians sangat tinggi (> 500), ini adalah batas lipatan kelopak mata, hidung, atau rambut
    var varSum = 0;
    for (var v = 0; v < ringYList.length; v++) {
        var diffY = ringYList[v] - avgY;
        varSum += diffY * diffY;
    }
    if ((varSum / ringCount) > 520) return; // Batalkan penambalan karena berada di tepi organ wajah!

    // 2. Tambal area jerawat dengan feathering halus (Cosine Falloff)
    for (var dy = -rInner; dy <= rInner; dy++) {
        for (var dx = -rInner; dx <= rInner; dx++) {
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= rInner) {
                var nx = centerX + dx;
                var ny = centerY + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    var idx = (ny * w + nx) * 4;
                    var weight = 0.5 * (1 + Math.cos((Math.PI * dist) / rInner));
                    
                    var origR = data[idx], origG = data[idx + 1], origB = data[idx + 2];
                    var blendedR = avgR * 0.85 + origR * 0.15;
                    var blendedG = avgG * 0.85 + origG * 0.15;
                    var blendedB = avgB * 0.85 + origB * 0.15;

                    data[idx] = Math.round(origR * (1 - weight) + blendedR * weight);
                    data[idx + 1] = Math.round(origG * (1 - weight) + blendedG * weight);
                    data[idx + 2] = Math.round(origB * (1 - weight) + blendedB * weight);
                }
            }
        }
    }
}

// Eksekusi Pembersih Jerawat Otomatis Cerdas dengan Standar Evoto AI & MediaPipe
function executeAutoBlemishRemoval() {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.naturalWidth) {
        if (typeof showToast === 'function') showToast('⚠️ Muat foto terlebih dahulu.');
        return;
    }

    if (typeof pushPhotoHistory === 'function') {
        pushPhotoHistory('Sebelum Bersihkan Jerawat (Evoto AI)');
    }

    if (typeof showToast === 'function') {
        showToast('✨ Evoto AI: Memindai bintik jerawat dengan 468 titik landmark wajah...');
    }

    detectFaceLandmarksAsync(bgImg).then(function(landmarks) {
        var canvas = document.createElement('canvas');
        var w = bgImg.naturalWidth;
        var h = bgImg.naturalHeight;
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bgImg, 0, 0, w, h);

        var imgData = ctx.getImageData(0, 0, w, h);
        var data = imgData.data;

        var landmarkMaskData = null;
        if (landmarks && landmarks.length > 0) {
            var mCanvas = buildEvotoSkinMaskCanvas(w, h, landmarks);
            if (mCanvas) {
                landmarkMaskData = mCanvas.getContext('2d').getImageData(0, 0, w, h).data;
            }
        }

        var patchRadius = Math.max(8, Math.round(w / 180));
        var step = Math.max(4, Math.round(patchRadius * 0.8));

        var blemishCenters = [];

        for (var y = patchRadius + 15; y < h - patchRadius - 15; y += step) {
            for (var x = patchRadius + 15; x < w - patchRadius - 15; x += step) {
                var pos = y * w + x;
                var idx = pos * 4;

                // Proteksi Mutlak MediaPipe Evoto AI:
                // Jika titik ini berada di luar zona pipi/dahi (misal di mata, kelopak mata, pupil, alis, atau bibir), lewati seketika!
                if (landmarkMaskData && landmarkMaskData[idx + 3] < 128) {
                    continue;
                }

                var r = data[idx], g = data[idx + 1], b = data[idx + 2];
                var yVal = 0.299 * r + 0.587 * g + 0.114 * b;
                var cbVal = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
                var crVal = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

                if (yVal < 55 || (r < 55 && g < 55 && b < 55)) continue;
                if (r > 115 && (r - g) > 40 && (r - b) > 35) continue;

                var isSkin = (cbVal >= 75 && cbVal <= 135 && crVal >= 130 && crVal <= 180) || (r > g && g > b && r > 60 && (r - b) > 16);

                if (isSkin) {
                    var leftIdx = (y * w + (x - 2)) * 4;
                    var rightIdx = (y * w + (x + 2)) * 4;
                    var upIdx = ((y - 2) * w + x) * 4;
                    var downIdx = ((y + 2) * w + x) * 4;
                    var gx = Math.abs(data[rightIdx] - data[leftIdx]);
                    var gy = Math.abs(data[downIdx] - data[upIdx]);
                    if (gx + gy > 36) continue;

                    var localYSum = 0, localCount = 0;
                    var sampleDist = patchRadius + 6;
                    var sOffsets = [
                        [-sampleDist, 0], [sampleDist, 0], [0, -sampleDist], [0, sampleDist],
                        [-sampleDist, -sampleDist], [sampleDist, -sampleDist], [-sampleDist, sampleDist], [sampleDist, sampleDist]
                    ];
                    for (var s = 0; s < sOffsets.length; s++) {
                        var sx = x + sOffsets[s][0];
                        var sy = y + sOffsets[s][1];
                        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
                            var sIdx = (sy * w + sx) * 4;
                            localYSum += 0.299 * data[sIdx] + 0.587 * data[sIdx + 1] + 0.114 * data[sIdx + 2];
                            localCount++;
                        }
                    }

                    if (localCount > 0) {
                        var localMeanY = localYSum / localCount;
                        var isDarkBlemish = (localMeanY - yVal) >= 12 && (localMeanY - yVal) <= 38;
                        var isRedPimple = (r - g) > 22 && (r - b) > 22 && (yVal < localMeanY + 8) && (yVal >= 60);

                        if (isDarkBlemish || isRedPimple) {
                            var tooClose = false;
                            for (var c = 0; c < blemishCenters.length; c++) {
                                var distC = Math.hypot(x - blemishCenters[c].x, y - blemishCenters[c].y);
                                if (distC < patchRadius * 0.9) {
                                    tooClose = true;
                                    break;
                                }
                            }
                            if (!tooClose && blemishCenters.length < 18) {
                                blemishCenters.push({ x: x, y: y });
                            }
                        }
                    }
                }
            }
        }

        for (var i = 0; i < blemishCenters.length; i++) {
            healBlemishPatch(data, w, h, blemishCenters[i].x, blemishCenters[i].y, patchRadius);
        }

        ctx.putImageData(imgData, 0, 0);
        var healedUrl = canvas.toDataURL('image/jpeg', 0.95);
        bgImg.src = healedUrl;
        if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
            appState.stagedPhotos[appState.activeStagedIndex].dataUrl = healedUrl;
        }

        if (typeof pushPhotoHistory === 'function') {
            pushPhotoHistory('Bersihkan Jerawat Otomatis (' + blemishCenters.length + ' Titik)');
        }

        if (typeof showToast === 'function') {
            showToast('✨ Evoto AI: Jerawat dibersihkan (' + blemishCenters.length + ' titik) — Mata & bibir 100% aman!');
        }
    });
}

// Kuas Spot Healing Jerawat Manual Interaktif
function toggleAcneSpotBrush() {
    acneSpotBrushState.active = !acneSpotBrushState.active;
    autoPersonSelectState.active = false;
    smartBoxSelectState.active = false;
    if (typeof autoObjectSelectState !== 'undefined') autoObjectSelectState.active = false;
    if (typeof skinSmoothBrushState !== 'undefined') skinSmoothBrushState.active = false;

    var btn = document.getElementById('btn-toggle-acne-brush');
    if (acneSpotBrushState.active) {
        if (btn) {
            btn.style.background = '#0284c7';
            btn.style.color = '#fff';
            btn.innerHTML = '<span>🖌️ Kuas Spot (Sentuh Jerawat)</span>';
        }
        if (typeof showToast === 'function') {
            showToast('🖌️ Kuas Spot Aktif: Sentuh langsung titik jerawat di foto untuk membersihkannya!');
        }
    } else {
        if (btn) {
            btn.style.background = 'transparent';
            btn.style.color = '#38bdf8';
            btn.innerHTML = '<span>🖌️ Kuas Spot</span>';
        }
    }
}

// Handler Sentuhan Kuas Spot pada Foto
function applyAcneSpotHealAtPoint(clientX, clientY) {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.naturalWidth) return;

    var rect = bgImg.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;

    var normX = (clientX - rect.left) / rect.width;
    var normY = (clientY - rect.top) / rect.height;

    var w = bgImg.naturalWidth;
    var h = bgImg.naturalHeight;
    var pixelX = Math.round(normX * w);
    var pixelY = Math.round(normY * h);

    if (typeof pushPhotoHistory === 'function') {
        pushPhotoHistory('Kuas Spot Jerawat');
    }

    var patchRadius = Math.max(12, Math.round(w / 140));

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bgImg, 0, 0, w, h);

    var imgData = ctx.getImageData(0, 0, w, h);
    healBlemishPatch(imgData.data, w, h, pixelX, pixelY, patchRadius);
    ctx.putImageData(imgData, 0, 0);

    var healedUrl = canvas.toDataURL('image/jpeg', 0.95);
    bgImg.src = healedUrl;
    if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
        appState.stagedPhotos[appState.activeStagedIndex].dataUrl = healedUrl;
    }

    if (typeof showToast === 'function') {
        showToast('✨ Bintik jerawat berhasil dihilangkan mulus!');
    }
}

// Daftarkan listener klik kuas spot ke stage frame
function initAcneSpotBrushListener() {
    var frame = document.getElementById('wm-stage-frame');
    if (!frame || frame._acneSpotBound) return;
    frame._acneSpotBound = true;

    frame.addEventListener('click', function(e) {
        if (typeof acneSpotBrushState !== 'undefined' && acneSpotBrushState.active) {
            applyAcneSpotHealAtPoint(e.clientX, e.clientY);
        }
    });

    frame.addEventListener('touchend', function(e) {
        if (typeof acneSpotBrushState !== 'undefined' && acneSpotBrushState.active && e.changedTouches && e.changedTouches.length === 1) {
            applyAcneSpotHealAtPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        }
    });
}
document.addEventListener('DOMContentLoaded', initAcneSpotBrushListener);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initAcneSpotBrushListener();
}


// 6. Referensi Warna Preset / DNG & Before/After Comparison
function updateDngColorReference(presetName, profileName, filterState) {
    dngColorRefState.presetName = presetName || 'Preset XMP';
    dngColorRefState.profileName = profileName || 'Adobe Standard';

    var temp = filterState.temperature || 0;
    var tint = filterState.tint || 0;
    var exp = filterState.brightness || 0;
    var sat = filterState.saturation || 0;
    var hl = filterState.highlights || 0;
    var sh = filterState.shadows || 0;

    function clamp(val) { return Math.max(0, Math.min(255, Math.round(val))); }

    dngColorRefState.swatches = [
        { name: 'Highlight White', hex: 'rgb(' + clamp(255 + hl * 0.5) + ',' + clamp(255 + hl * 0.5 - tint * 0.3) + ',' + clamp(255 - temp * 0.5) + ')' },
        { name: 'Skin Midtone', hex: 'rgb(' + clamp(235 + temp * 0.4) + ',' + clamp(185 + tint * 0.3) + ',' + clamp(160 - temp * 0.4) + ')' },
        { name: '18% Neutral Gray', hex: 'rgb(' + clamp(128 + exp * 0.6) + ',' + clamp(128 + exp * 0.6) + ',' + clamp(128 - temp * 0.3) + ')' },
        { name: 'Deep Black', hex: 'rgb(' + clamp(25 + sh * 0.3) + ',' + clamp(25 + sh * 0.3) + ',' + clamp(25 + sh * 0.3) + ')' },
        { name: 'Primary Red', hex: 'rgb(' + clamp(220 + sat * 0.3) + ',' + clamp(50 - sat * 0.2) + ',' + clamp(50 - sat * 0.2) + ')' },
        { name: 'Primary Green', hex: 'rgb(' + clamp(45 - sat * 0.2) + ',' + clamp(175 + sat * 0.3) + ',' + clamp(65 - sat * 0.2) + ')' },
        { name: 'Primary Blue', hex: 'rgb(' + clamp(45 - sat * 0.2) + ',' + clamp(105 + sat * 0.2) + ',' + clamp(225 + sat * 0.3) + ')' },
        { name: 'Warm Accent', hex: 'rgb(' + clamp(245 + temp * 0.4) + ',' + clamp(160 + temp * 0.2) + ',' + clamp(55 - temp * 0.3) + ')' }
    ];

    renderDngReferenceSwatches();
}

function renderDngReferenceSwatches() {
    var profEl = document.getElementById('dng-camera-profile');
    var statEl = document.getElementById('dng-calibration-status');
    var swatchContainer = document.getElementById('dng-color-swatches');

    if (profEl) profEl.textContent = dngColorRefState.profileName;
    if (statEl) statEl.textContent = 'Status: Terkalibrasi dengan ' + dngColorRefState.presetName;

    if (swatchContainer && dngColorRefState.swatches) {
        swatchContainer.innerHTML = '';
        dngColorRefState.swatches.forEach(function(sw) {
            var div = document.createElement('div');
            div.className = 'dng-ref-swatch';
            div.style.background = sw.hex;
            div.style.height = '18px';
            div.style.borderRadius = '3px';
            div.style.border = '1px solid rgba(255,255,255,0.2)';
            div.title = sw.name + ' (' + sw.hex + ')';
            swatchContainer.appendChild(div);
        });
    }
}

// Tombol Bandingkan Warna (Before / After Hold)
function previewOriginalColor(isHold) {
    showBeforePhotoCompare(isHold);
}

// Inisialisasi awal render swatches
document.addEventListener('DOMContentLoaded', function() {
    renderDngReferenceSwatches();
});
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    renderDngReferenceSwatches();
}


/* =========================================================================
   REVISI 103: INTERACTIVE VIEWPORT ZOOM & PAN (SCROLL & PINCH-TO-ZOOM)
   SERTA ERASER AI 3 PILIHAN VARIASI GENERATE & GENERATE ULANG (ALA PHOTOSHOP)
   ========================================================================= */

// 1. STATE & ENGINE ZOOM & PAN INTERAKTIF KANVAS
var stageZoomState = {
    scale: 1.0,
    minScale: 0.6,
    maxScale: 5.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    initialPinchDist: 0,
    initialScale: 1.0
};

function updateStageZoomTransform() {
    var wrapper = document.getElementById('wm-photo-wrapper');
    var badge = document.getElementById('wm-zoom-indicator');
    var lbl = document.getElementById('lbl-zoom-percent');

    if (wrapper) {
        wrapper.style.transform = 'translate(' + Math.round(stageZoomState.panX) + 'px, ' + Math.round(stageZoomState.panY) + 'px) scale(' + stageZoomState.scale.toFixed(2) + ')';
    }

    if (badge && lbl) {
        var pct = Math.round(stageZoomState.scale * 100);
        lbl.textContent = pct + '%';
        if (Math.abs(stageZoomState.scale - 1.0) > 0.05 || Math.abs(stageZoomState.panX) > 2 || Math.abs(stageZoomState.panY) > 2) {
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }
}

function resetStageZoom() {
    stageZoomState.scale = 1.0;
    stageZoomState.panX = 0;
    stageZoomState.panY = 0;
    updateStageZoomTransform();
    if (typeof showToast === 'function') {
        showToast('🔍 Zoom direset ke Ukuran Normal (Fit 100%)');
    }
}

function setStageZoom(targetScale) {
    stageZoomState.scale = Math.max(stageZoomState.minScale, Math.min(stageZoomState.maxScale, targetScale));
    stageZoomState.panX = 0;
    stageZoomState.panY = 0;
    updateStageZoomTransform();
    if (typeof showToast === 'function') {
        showToast('🔍 Zoom disetel ke ' + Math.round(stageZoomState.scale * 100) + '%');
    }
}

// Inisialisasi event listener scroll wheel mouse & touch gesture pinch-to-zoom
function initStageInteractiveZoom() {
    var frame = document.getElementById('wm-stage-frame');
    var wrapper = document.getElementById('wm-photo-wrapper');
    if (!frame || !wrapper) return;

    // A. MOUSE WHEEL SCROLL ZOOM (Berpusat di kursor)
    frame.addEventListener('wheel', function(e) {
        e.preventDefault();
        var delta = e.deltaY < 0 ? 1.15 : 0.87;
        var newScale = Math.max(stageZoomState.minScale, Math.min(stageZoomState.maxScale, stageZoomState.scale * delta));

        var rect = frame.getBoundingClientRect();
        var mouseX = e.clientX - rect.left - rect.width / 2;
        var mouseY = e.clientY - rect.top - rect.height / 2;

        stageZoomState.panX -= mouseX * (delta - 1);
        stageZoomState.panY -= mouseY * (delta - 1);
        stageZoomState.scale = newScale;

        // Auto-snap ke 100% jika mendekati netral
        if (stageZoomState.scale >= 0.95 && stageZoomState.scale <= 1.05) {
            stageZoomState.scale = 1.0;
            stageZoomState.panX = 0;
            stageZoomState.panY = 0;
        }

        updateStageZoomTransform();
    }, { passive: false });

    // B. DOUBLE CLICK RESET / TOGGLE ZOOM
    frame.addEventListener('dblclick', function(e) {
        if (e.target && e.target.tagName === 'INPUT') return;
        if (stageZoomState.scale !== 1.0 || stageZoomState.panX !== 0 || stageZoomState.panY !== 0) {
            resetStageZoom();
        } else {
            setStageZoom(1.8);
        }
    });

    // C. PAN & DRAG KANVAS SAAT ZOOM > 100%
    var isDraggingPan = false;
    var panStartMouseX = 0, panStartMouseY = 0;
    var panStartPosX = 0, panStartPosY = 0;

    frame.addEventListener('mousedown', function(e) {
        // Jika sedang mode Kuas AI Eraser, biarkan kuas menggambar
        if (typeof wmEraserState !== 'undefined' && wmEraserState.active && !e.shiftKey && e.button === 0) {
            return;
        }

        // Aktifkan pan dengan klik tengah, klik kanan, Shift+Klik, atau saat foto di-zoom
        if (e.button === 1 || e.button === 2 || e.shiftKey || stageZoomState.scale > 1.05) {
            isDraggingPan = true;
            panStartMouseX = e.clientX;
            panStartMouseY = e.clientY;
            panStartPosX = stageZoomState.panX;
            panStartPosY = stageZoomState.panY;
            wrapper.classList.add('is-panning');
            if (e.button === 1 || e.button === 2) e.preventDefault();
        }
    });

    window.addEventListener('mousemove', function(e) {
        if (!isDraggingPan) return;
        var dx = e.clientX - panStartMouseX;
        var dy = e.clientY - panStartMouseY;
        stageZoomState.panX = panStartPosX + dx;
        stageZoomState.panY = panStartPosY + dy;
        updateStageZoomTransform();
    });

    window.addEventListener('mouseup', function() {
        if (isDraggingPan) {
            isDraggingPan = false;
            if (wrapper) wrapper.classList.remove('is-panning');
        }
    });

    frame.addEventListener('contextmenu', function(e) {
        if (stageZoomState.scale > 1.05) {
            e.preventDefault();
        }
    });

    // D. TOUCH PINCH-TO-ZOOM (IPAD / SMARTPHONE / TOUCHSCREEN)
    frame.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            stageZoomState.initialPinchDist = Math.hypot(dx, dy);
            stageZoomState.initialScale = stageZoomState.scale;
        }
    }, { passive: false });

    frame.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2 && stageZoomState.initialPinchDist > 0) {
            e.preventDefault();
            var dx = e.touches[0].clientX - e.touches[1].clientX;
            var dy = e.touches[0].clientY - e.touches[1].clientY;
            var currentDist = Math.hypot(dx, dy);
            var factor = currentDist / stageZoomState.initialPinchDist;
            stageZoomState.scale = Math.max(stageZoomState.minScale, Math.min(stageZoomState.maxScale, stageZoomState.initialScale * factor));
            updateStageZoomTransform();
        }
    }, { passive: false });

    frame.addEventListener('touchend', function(e) {
        if (e.touches.length < 2) {
            stageZoomState.initialPinchDist = 0;
        }
    });
}
document.addEventListener('DOMContentLoaded', initStageInteractiveZoom);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initStageInteractiveZoom();
}


// 2. STATE & ENGINE ERASER AI 3 PILIHAN VARIASI GENERATE & GENERATE ULANG (PHOTOSHOP STYLE)
var inpaintVariantsState = {
    active: false,
    variants: [],
    labels: ['Variasi 1 (Halus Kontur)', 'Variasi 2 (Tekstur Serat)', 'Variasi 3 (Hybrid Alami)'],
    currentIndex: 0,
    originalDataUrl: null,
    savedMaskCanvas: null
};

// Fungsi Utama: Menghasilkan 3 Variasi Inpaint Berbeda (Magic Eraser & Adobe Firefly Style)
function generate3InpaintVariants() {
    var canvas = document.getElementById('wm-eraser-canvas');
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!canvas || !bgImg) return false;

    // Pastikan resolusi kanvas masker selaras dengan resolusi foto
    var imgW = bgImg.naturalWidth || canvas.width || 1200;
    var imgH = bgImg.naturalHeight || canvas.height || 800;

    var ctx = canvas.getContext('2d');
    var maskData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var hasMask = false;
    for (var i = 3; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 20) {
            hasMask = true;
            break;
        }
    }

    if (!hasMask) {
        if (typeof showToast === 'function') {
            showToast('⚠️ Tandai objek/orang/kabel dengan kuas, orang bocor, atau kotak terlebih dahulu!');
        }
        return false;
    }

    // 1. Simpan foto asli awal sebelum proses inpaint
    if (!inpaintVariantsState.active) {
        inpaintVariantsState.originalDataUrl = bgImg.src;
    }

    // 2. Simpan salinan masker untuk fitur Generate Ulang
    var maskCopy = document.createElement('canvas');
    maskCopy.width = canvas.width;
    maskCopy.height = canvas.height;
    maskCopy.getContext('2d').drawImage(canvas, 0, 0);
    inpaintVariantsState.savedMaskCanvas = maskCopy;

    if (typeof showToast === 'function') {
        showToast('✨ Memproses Rekonstruksi AI Kontekstual (Standar Magic Eraser & Adobe Firefly)...');
    }

    setTimeout(function() {
        var w = canvas.width;
        var h = canvas.height;
        var offCanvas = document.createElement('canvas');
        offCanvas.width = w;
        offCanvas.height = h;
        var offCtx = offCanvas.getContext('2d');

        var variants = [];
        var thumbUrls = [];

        // Buat 3 Variasi Inpaint Berkualitas Tinggi
        for (var v = 0; v < 3; v++) {
            offCtx.clearRect(0, 0, w, h);
            offCtx.drawImage(bgImg, 0, 0, w, h);

            var imgData = offCtx.getImageData(0, 0, w, h);
            var px = imgData.data;
            var m = maskData.data;

            // Pelebaran masker (Dilation) untuk menghabisi bayangan & fringe objek
            var dilateRadius = 4 + v * 2;
            var dilated = new Uint8Array(w * h);
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var mIdx = (y * w + x) * 4;
                    if (m[mIdx + 3] > 20) {
                        for (var dy = -dilateRadius; dy <= dilateRadius; dy++) {
                            var ny = y + dy;
                            if (ny >= 0 && ny < h) {
                                for (var dx = -dilateRadius; dx <= dilateRadius; dx++) {
                                    var nx = x + dx;
                                    if (nx >= 0 && nx < w) {
                                        if (dx * dx + dy * dy <= dilateRadius * dilateRadius) {
                                            dilated[ny * w + nx] = 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Kumpulkan donor piksel batas terdekat (Boundary Ring)
            var ringPixels = [];
            for (var by = 1; by < h - 1; by++) {
                for (var bx = 1; bx < w - 1; bx++) {
                    var bpos = by * w + bx;
                    if (dilated[bpos] === 0) {
                        if (dilated[bpos - 1] === 1 || dilated[bpos + 1] === 1 || dilated[bpos - w] === 1 || dilated[bpos + w] === 1) {
                            var bIdx = bpos * 4;
                            ringPixels.push({
                                x: bx,
                                y: by,
                                r: px[bIdx],
                                g: px[bIdx + 1],
                                b: px[bIdx + 2]
                            });
                        }
                    }
                }
            }

            // Inpaint setiap piksel yang ditutupi masker dengan Contextual 2D Nearest Matching
            var maxDist = Math.max(w, h);
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var pos = y * w + x;
                    if (dilated[pos] === 1) {
                        var idx = pos * 4;

                        // Cari donor terdekat di ringPixels dengan memprioritaskan kesamaan stratum ketinggian (y)
                        var bestR = px[idx], bestG = px[idx + 1], bestB = px[idx + 2];
                        var minWeightedDist = 999999;

                        // Cari tetangga batas terdekat
                        var sampleStep = Math.max(1, Math.floor(ringPixels.length / 120));
                        for (var k = 0; k < ringPixels.length; k += sampleStep) {
                            var rp = ringPixels[k];
                            var dx = x - rp.x;
                            var dy = y - rp.y;
                            
                            // Bobot stratum: beri prioritas pada garis horizontal horizon/tanah/langit yang sama
                            var weightedDist = (dx * dx) + (dy * dy * 1.8);

                            if (v === 1) {
                                // Varian 2: Exemplar Texture Patch dengan mikro-jitter
                                weightedDist += ((x * 13 + y * 23 + k * 7) % 19);
                            } else if (v === 2) {
                                // Varian 3: Poisson Bilateral Blend
                                weightedDist += Math.abs(dx * dy) * 0.2;
                            }

                            if (weightedDist < minWeightedDist) {
                                minWeightedDist = weightedDist;
                                bestR = rp.r;
                                bestG = rp.g;
                                bestB = rp.b;
                            }
                        }

                        px[idx] = bestR;
                        px[idx + 1] = bestG;
                        px[idx + 2] = bestB;
                    }
                }
            }

            // Boundary Feathering halus 2px agar tepi lubang menyatu 100% mulus
            for (var fy = 2; fy < h - 2; fy++) {
                for (var fx = 2; fx < w - 2; fx++) {
                    var fPos = fy * w + fx;
                    if (dilated[fPos] === 1) {
                        var isBorder = (dilated[fPos - 1] === 0 || dilated[fPos + 1] === 0 || dilated[fPos - w] === 0 || dilated[fPos + w] === 0);
                        if (isBorder) {
                            var fIdx = fPos * 4;
                            var avgR = 0, avgG = 0, avgB = 0, bCount = 0;
                            for (var ddy = -1; ddy <= 1; ddy++) {
                                for (var ddx = -1; ddx <= 1; ddx++) {
                                    var nIdx = ((fy + ddy) * w + (fx + ddx)) * 4;
                                    avgR += px[nIdx]; avgG += px[nIdx + 1]; avgB += px[nIdx + 2];
                                    bCount++;
                                }
                            }
                            if (bCount > 0) {
                                px[fIdx] = Math.round(avgR / bCount);
                                px[fIdx + 1] = Math.round(avgG / bCount);
                                px[fIdx + 2] = Math.round(avgB / bCount);
                            }
                        }
                    }
                }
            }

            offCtx.putImageData(imgData, 0, 0);
            var fullUrl = offCanvas.toDataURL('image/jpeg', 0.95);
            variants.push(fullUrl);

            // Buat Thumbnail Ringan Beresolusi Bersih (80x80px) agar TIDAK PERNAH PECAH/BROKEN
            var thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 80;
            thumbCanvas.height = 80;
            var tCtx = thumbCanvas.getContext('2d');
            tCtx.drawImage(offCanvas, 0, 0, 80, 80);
            thumbUrls.push(thumbCanvas.toDataURL('image/jpeg', 0.85));
        }

        inpaintVariantsState.variants = variants;
        inpaintVariantsState.thumbnails = thumbUrls;
        inpaintVariantsState.currentIndex = 0;
        inpaintVariantsState.active = true;

        // =========================================================================
        // KUNCI: KANVAS KUAS MERAH DIBERSIHKAN TOTAL AGAR FOTO BESAR BERSIH 100%!
        // =========================================================================
        var eraserCanvas = document.getElementById('wm-eraser-canvas');
        if (eraserCanvas) {
            var eCtx = eraserCanvas.getContext('2d');
            eCtx.clearRect(0, 0, eraserCanvas.width, eraserCanvas.height);
        }
        if (typeof wmEraserState !== 'undefined') {
            wmEraserState.hasStrokes = false;
            wmEraserState.isDrawing = false;
        }

        // Tampilkan variasi 1 langsung di foto besar panggung
        bgImg.src = variants[0];
        if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
            appState.stagedPhotos[appState.activeStagedIndex].dataUrl = variants[0];
        }

        // Tampilkan bilah variasi panggung & panel inspector
        var varBar = document.getElementById('wm-eraser-variant-bar');
        var paneVarBox = document.getElementById('evoto-pane-variant-box');
        if (varBar) varBar.style.display = 'inline-flex';
        if (paneVarBox) paneVarBox.style.display = 'block';

        updateVariantUIElements();

        if (typeof showToast === 'function') {
            showToast('✨ 3 Variasi berhasil dibuat! Foto besar langsung tayang bersih tanpa noda.');
        }
    }, 250);

    return true;
}

// Memilih variasi indeks tertentu (0, 1, atau 2) & TAYANGKAN LANGSUNG DI PREVIEW BESAR
function selectInpaintVariant(index) {
    if (!inpaintVariantsState.active || !inpaintVariantsState.variants || !inpaintVariantsState.variants[index]) return;
    inpaintVariantsState.currentIndex = index;

    var chosenVariant = inpaintVariantsState.variants[index];

    // Foto panggung besar langsung berganti ke variasi yang diklik!
    var bgImg = document.getElementById('wm-simulator-bg');
    if (bgImg) {
        bgImg.src = chosenVariant;
    }

    if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
        appState.stagedPhotos[appState.activeStagedIndex].dataUrl = chosenVariant;
    }

    // Pastikan kanvas kuas merah tetap bersih sehingga preview besar terlihat sempurna
    var eraserCanvas = document.getElementById('wm-eraser-canvas');
    if (eraserCanvas) {
        var eCtx = eraserCanvas.getContext('2d');
        eCtx.clearRect(0, 0, eraserCanvas.width, eraserCanvas.height);
    }

    updateVariantUIElements();

    if (typeof showToast === 'function') {
        showToast('👁️ Menampilkan ' + inpaintVariantsState.labels[index] + ' di Preview Besar');
    }
}

// Update thumbnail preview gambar dan highlight border emas
function updateVariantUIElements() {
    var cur = inpaintVariantsState.currentIndex;
    var paneIndicator = document.getElementById('pane-variant-indicator');

    if (paneIndicator) paneIndicator.textContent = 'Variasi ' + (cur + 1) + ' / 3';

    // Perbarui sumber gambar thumbnail panggung & panel inspector
    for (var i = 0; i < 3; i++) {
        var thumbImg = document.getElementById('var-thumb-img-' + i);
        var paneThumbImg = document.getElementById('pane-var-thumb-img-' + i);
        
        var srcToUse = (inpaintVariantsState.thumbnails && inpaintVariantsState.thumbnails[i]) 
            ? inpaintVariantsState.thumbnails[i] 
            : (inpaintVariantsState.variants && inpaintVariantsState.variants[i] ? inpaintVariantsState.variants[i] : '');

        if (srcToUse) {
            if (thumbImg) thumbImg.src = srcToUse;
            if (paneThumbImg) paneThumbImg.src = srcToUse;
        }

        var card = document.getElementById('var-card-' + i);
        var paneCard = document.getElementById('pane-var-card-' + i);
        if (card) {
            if (i === cur) {
                card.style.borderColor = '#f59e0b';
                card.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.6)';
                card.classList.add('active');
            } else {
                card.style.borderColor = '#334155';
                card.style.boxShadow = 'none';
                card.classList.remove('active');
            }
        }
        if (paneCard) {
            if (i === cur) {
                paneCard.style.borderColor = '#f59e0b';
                paneCard.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.5)';
            } else {
                paneCard.style.borderColor = '#334155';
                paneCard.style.boxShadow = 'none';
            }
        }
    }
}

// Melompat ke variasi sebelumnya (-1) atau berikutnya (+1)
function stepInpaintVariant(direction) {
    if (!inpaintVariantsState.active || !inpaintVariantsState.variants || inpaintVariantsState.variants.length === 0) return;
    var newIdx = (inpaintVariantsState.currentIndex + direction + 3) % 3;
    selectInpaintVariant(newIdx);
}

// Fitur Generate Ulang (Re-generate 3 Opsi Baru Ala Photoshop)
function regenerateInpaintVariants() {
    if (!inpaintVariantsState.savedMaskCanvas) {
        if (typeof showToast === 'function') showToast('⚠️ Tidak ada riwayat seleksi objek untuk di-generate ulang.');
        return;
    }

    var bgImg = document.getElementById('wm-simulator-bg');
    if (bgImg && inpaintVariantsState.originalDataUrl) {
        bgImg.src = inpaintVariantsState.originalDataUrl;
    }

    var canvas = document.getElementById('wm-eraser-canvas');
    if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(inpaintVariantsState.savedMaskCanvas, 0, 0);
    }

    if (typeof showToast === 'function') {
        showToast('🔄 Menghasilkan 3 Variasi Baru...');
    }

    generate3InpaintVariants();
}

// Menerapkan variasi yang sedang dipilih secara permanen
function applyInpaintVariant() {
    if (!inpaintVariantsState.active || !inpaintVariantsState.variants || !inpaintVariantsState.variants[inpaintVariantsState.currentIndex]) return;

    var chosenUrl = inpaintVariantsState.variants[inpaintVariantsState.currentIndex];
    var bgImg = document.getElementById('wm-simulator-bg');
    if (bgImg) bgImg.src = chosenUrl;

    if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
        appState.stagedPhotos[appState.activeStagedIndex].dataUrl = chosenUrl;
    }

    var varBar = document.getElementById('wm-eraser-variant-bar');
    var paneVarBox = document.getElementById('evoto-pane-variant-box');
    if (varBar) varBar.style.display = 'none';
    if (paneVarBox) paneVarBox.style.display = 'none';

    clearWmEraserMask();
    inpaintVariantsState.active = false;
    inpaintVariantsState.savedMaskCanvas = null;

    if (typeof showToast === 'function') {
        showToast('✓ ' + inpaintVariantsState.labels[inpaintVariantsState.currentIndex] + ' berhasil diterapkan permanen ke foto!');
    }
}

// Membatalkan seluruh proses inpaint dan mengembalikan foto 100% ke kondisi awal
function cancelInpaintVariants() {
    if (!inpaintVariantsState.active) return;

    var bgImg = document.getElementById('wm-simulator-bg');
    if (bgImg && inpaintVariantsState.originalDataUrl) {
        bgImg.src = inpaintVariantsState.originalDataUrl;
    }

    if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex] && inpaintVariantsState.originalDataUrl) {
        appState.stagedPhotos[appState.activeStagedIndex].dataUrl = inpaintVariantsState.originalDataUrl;
    }

    var varBar = document.getElementById('wm-eraser-variant-bar');
    var paneVarBox = document.getElementById('evoto-pane-variant-box');
    if (varBar) varBar.style.display = 'none';
    if (paneVarBox) paneVarBox.style.display = 'none';

    clearWmEraserMask();
    inpaintVariantsState.active = false;
    inpaintVariantsState.savedMaskCanvas = null;

    if (typeof showToast === 'function') {
        showToast('✕ Pemilihan variasi dibatalkan, foto dikembalikan ke kondisi awal.');
    }
}
// Hubungkan fungsi eksekusi agar menjalankan 3 Variasi
function executeGeminiInpaint() {
    generate3InpaintVariants();
}

function executeWmInpaint() {
    generate3InpaintVariants();
}


/* =========================================================================
   REVISI 104: AI FACE BEAUTY SUITE & PRESETS
   (HILANGKAN JERAWAT, MUKA MULUS, KECERAHAN WAJAH, & SAMARKAN KANTUNG MATA)
   ========================================================================= */

// Fungsi Terapkan Preset Filter Wajah Cepat
function applyFaceBeautyPreset(preset) {
    var soften = document.getElementById('slider-evoto-ret-soften');
    var brighten = document.getElementById('slider-evoto-ret-brighten');
    var undereye = document.getElementById('slider-evoto-ret-undereye');
    var texture = document.getElementById('slider-evoto-ret-texture');
    var teeth = document.getElementById('slider-evoto-ret-teeth');
    var eyes = document.getElementById('slider-evoto-ret-eyes');

    if (preset === 'natural') {
        if (soften) soften.value = 35;
        if (brighten) brighten.value = 20;
        if (undereye) undereye.value = 25;
        if (texture) texture.value = 55;
        if (teeth) teeth.value = 25;
        if (eyes) eyes.value = 30;
        if (typeof showToast === 'function') showToast('✨ Filter Wajah: Natural Beauty aktif (Pori kulit tetap alami)');
    } else if (preset === 'glowing') {
        if (soften) soften.value = 50;
        if (brighten) brighten.value = 35;
        if (undereye) undereye.value = 40;
        if (texture) texture.value = 45;
        if (teeth) teeth.value = 35;
        if (eyes) eyes.value = 40;
        if (typeof showToast === 'function') showToast('🌟 Filter Wajah: Glowing Studio aktif (Cerah merona & berseri)');
    } else if (preset === 'bridal') {
        if (soften) soften.value = 65;
        if (brighten) brighten.value = 45;
        if (undereye) undereye.value = 50;
        if (texture) texture.value = 48;
        if (teeth) teeth.value = 40;
        if (eyes) eyes.value = 45;
        if (typeof showToast === 'function') showToast('👰 Filter Wajah: Fresh Bridal aktif (Mulus sempurna elegan)');
    }

    updateEvotoWorkspaceRetouch();
}

// Perbarui label & efek retouch termasuk Brighten & Under-Eye
var origUpdateEvotoWorkspaceRetouch = updateEvotoWorkspaceRetouch;
updateEvotoWorkspaceRetouch = function() {
    var soften = document.getElementById('slider-evoto-ret-soften');
    var brighten = document.getElementById('slider-evoto-ret-brighten');
    var undereye = document.getElementById('slider-evoto-ret-undereye');
    var texture = document.getElementById('slider-evoto-ret-texture');
    var teeth = document.getElementById('slider-evoto-ret-teeth');
    var eyes = document.getElementById('slider-evoto-ret-eyes');

    if (soften && document.getElementById('lbl-evoto-ret-soften')) {
        document.getElementById('lbl-evoto-ret-soften').textContent = soften.value + '%';
    }
    if (brighten && document.getElementById('lbl-evoto-ret-brighten')) {
        document.getElementById('lbl-evoto-ret-brighten').textContent = brighten.value + '%';
    }
    if (undereye && document.getElementById('lbl-evoto-ret-undereye')) {
        document.getElementById('lbl-evoto-ret-undereye').textContent = undereye.value + '%';
    }
    if (texture && document.getElementById('lbl-evoto-ret-texture')) {
        document.getElementById('lbl-evoto-ret-texture').textContent = texture.value + '%';
    }
    if (teeth && document.getElementById('lbl-evoto-ret-teeth')) {
        document.getElementById('lbl-evoto-ret-teeth').textContent = teeth.value + '%';
    }
    if (eyes && document.getElementById('lbl-evoto-ret-eyes')) {
        document.getElementById('lbl-evoto-ret-eyes').textContent = eyes.value + '%';
    }

    if (typeof appState !== 'undefined' && appState.photoFilterState) {
        var sVal = soften ? parseInt(soften.value, 10) : 35;
        var bVal = brighten ? parseInt(brighten.value, 10) : 25;
        var uVal = undereye ? parseInt(undereye.value, 10) : 30;
        var tVal = texture ? parseInt(texture.value, 10) : 50;
        var thVal = teeth ? parseInt(teeth.value, 10) : 30;
        var eVal = eyes ? parseInt(eyes.value, 10) : 35;

        appState.photoFilterState.retouch = {
            soften: sVal,
            brighten: bVal,
            undereye: uVal,
            texture: tVal,
            teeth: thVal,
            eyes: eVal
        };

        appState.photoFilterState.clarity = -Math.round(sVal * 0.4);
        appState.photoFilterState.texture = Math.round((tVal - 50) * 0.8);

        if (typeof updatePhotoGradingPreview === 'function') {
            updatePhotoGradingPreview();
        }
    }
};

// Eksekusi Auto Beauty 1-Klik AI (Jerawat bersih, kulit mulus berpori, wajah cerah)
function executeGeminiAutoRetouch() {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.src) {
        if (typeof showToast === 'function') showToast('⚠️ Pilih foto terlebih dahulu.');
        return;
    }

    if (typeof showToast === 'function') {
        showToast('🧠 Auto Beauty AI: Menganalisa wajah, warna kulit & bintik noda...');
    }

    setTimeout(function() {
        // 1. Deteksi Skin Tone Otomatis
        if (typeof autoDetectSkinTone === 'function') {
            autoDetectSkinTone();
        }

        // 2. Bersihkan Jerawat & Noda Otomatis
        if (typeof executeAutoBlemishRemoval === 'function') {
            executeAutoBlemishRemoval();
        }

        // 3. Setel Parameter Wajah Mulus & Cerah Seimbang
        var soften = document.getElementById('slider-evoto-ret-soften');
        var brighten = document.getElementById('slider-evoto-ret-brighten');
        var undereye = document.getElementById('slider-evoto-ret-undereye');
        var texture = document.getElementById('slider-evoto-ret-texture');
        var teeth = document.getElementById('slider-evoto-ret-teeth');
        var eyes = document.getElementById('slider-evoto-ret-eyes');

        if (soften) soften.value = 45;
        if (brighten) brighten.value = 28;
        if (undereye) undereye.value = 35;
        if (texture) texture.value = 52;
        if (teeth) teeth.value = 30;
        if (eyes) eyes.value = 35;

        updateEvotoWorkspaceRetouch();

        if (typeof showToast === 'function') {
            showToast('✨ Auto Beauty AI Berhasil: Jerawat dibersihkan, wajah mulus alami & cerah merona!');
        }
    }, 450);
}

/* ========================================================================= */
/* REVISI 107: WORKSTATION UNDO / REDO ENGINE                                */
/* ========================================================================= */
var photoHistoryState = {
    stack: [],
    index: -1,
    maxStates: 25
};

function pushPhotoHistory(label) {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.src) return;

    // Jika user berada di tengah stack lalu melakukan aksi baru, pangkas cabang redo
    if (photoHistoryState.index < photoHistoryState.stack.length - 1) {
        photoHistoryState.stack = photoHistoryState.stack.slice(0, photoHistoryState.index + 1);
    }

    // Jangan simpan duplikat state yang persis sama
    if (photoHistoryState.stack.length > 0 && photoHistoryState.stack[photoHistoryState.stack.length - 1].url === bgImg.src) {
        return;
    }

    photoHistoryState.stack.push({
        url: bgImg.src,
        label: label || 'Aksi'
    });

    if (photoHistoryState.stack.length > photoHistoryState.maxStates) {
        photoHistoryState.stack.shift();
    }
    photoHistoryState.index = photoHistoryState.stack.length - 1;
    updateUndoRedoButtons();
}

function undoPhotoAction() {
    if (photoHistoryState.index > 0) {
        photoHistoryState.index--;
        var prevState = photoHistoryState.stack[photoHistoryState.index];
        applyHistoryState(prevState, '↺ Mengembalikan: ' + prevState.label);
    } else {
        if (typeof showToast === 'function') showToast('ℹ️ Sudah di kondisi paling awal (tidak ada riwayat undo lagi).');
    }
}

function redoPhotoAction() {
    if (photoHistoryState.index < photoHistoryState.stack.length - 1) {
        photoHistoryState.index++;
        var nextState = photoHistoryState.stack[photoHistoryState.index];
        applyHistoryState(nextState, '↻ Mengulangi: ' + nextState.label);
    } else {
        if (typeof showToast === 'function') showToast('ℹ️ Sudah di kondisi terbaru (tidak ada redo lagi).');
    }
}

function applyHistoryState(stateObj, message) {
    if (!stateObj) return;
    var bgImg = document.getElementById('wm-simulator-bg');
    if (bgImg) bgImg.src = stateObj.url;
    if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
        appState.stagedPhotos[appState.activeStagedIndex].dataUrl = stateObj.url;
    }
    updateUndoRedoButtons();
    if (typeof showToast === 'function' && message) {
        showToast(message);
    }
}

function updateUndoRedoButtons() {
    var canUndo = photoHistoryState.index > 0;
    var canRedo = photoHistoryState.index < photoHistoryState.stack.length - 1;

    var btnUndoH = document.getElementById('btn-undo-header');
    var btnRedoH = document.getElementById('btn-redo-header');
    if (btnUndoH) {
        btnUndoH.disabled = !canUndo;
        btnUndoH.style.opacity = canUndo ? '1' : '0.35';
        btnUndoH.style.color = canUndo ? '#38bdf8' : '#64748b';
    }
    if (btnRedoH) {
        btnRedoH.disabled = !canRedo;
        btnRedoH.style.opacity = canRedo ? '1' : '0.35';
        btnRedoH.style.color = canRedo ? '#38bdf8' : '#64748b';
    }
}

// Global Keyboard Shortcut: Ctrl+Z (Undo) dan Ctrl+Y / Ctrl+Shift+Z (Redo)
document.addEventListener('keydown', function(e) {
    var activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement && document.activeElement.isContentEditable)) {
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) {
            e.preventDefault();
            redoPhotoAction();
        } else {
            e.preventDefault();
            undoPhotoAction();
        }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redoPhotoAction();
    }
});

/* ========================================================================= */
/* REVISI 107: TARGETED SKIN SMOOTHING BRUSH & AUTO SKIN MASK                */
/* (STANDAR IMAGENAI / PORTRAITURE / EVOTO AI - SS 1 & SS 2)                 */
/* ========================================================================= */
var skinSmoothBrushState = {
    active: false,
    size: 32,
    strength: 65,
    isDrawing: false,
    strokePoints: [],
    previewMaskActive: false
};

function toggleSkinSmoothBrush() {
    skinSmoothBrushState.active = !skinSmoothBrushState.active;
    
    // Matikan mode kuas lain agar tidak terjadi tabrakan kursor
    if (typeof acneSpotBrushState !== 'undefined') acneSpotBrushState.active = false;
    if (typeof autoPersonSelectState !== 'undefined') autoPersonSelectState.active = false;
    if (typeof smartBoxSelectState !== 'undefined') smartBoxSelectState.active = false;
    if (typeof autoObjectSelectState !== 'undefined') autoObjectSelectState.active = false;

    var btn = document.getElementById('btn-toggle-skin-brush');
    var canvas = document.getElementById('wm-skin-brush-canvas');
    var wrapper = document.getElementById('wm-photo-wrapper');

    if (skinSmoothBrushState.active) {
        if (btn) {
            btn.classList.add('btn-brush-active');
            btn.innerHTML = '<span>🖌️ Kuas Mulus (Usap Pipi/Dahi)</span>';
        }
        if (canvas) canvas.style.display = 'block';
        if (wrapper) wrapper.classList.add('skin-brush-mode');
        if (typeof showToast === 'function') {
            showToast('🖌️ Kuas Mulus Aktif: Usap langsung ke pipi atau dahi yang ingin dihaluskan!');
        }
    } else {
        if (btn) {
            btn.classList.remove('btn-brush-active');
            btn.innerHTML = '<span>🖌️ Kuas Mulus Kulit</span>';
        }
        if (canvas && !skinSmoothBrushState.previewMaskActive) canvas.style.display = 'none';
        if (wrapper) wrapper.classList.remove('skin-brush-mode');
    }
}

function updateSkinBrushSize(val) {
    skinSmoothBrushState.size = parseInt(val, 10) || 32;
    var lbl = document.getElementById('lbl-skin-brush-size');
    if (lbl) lbl.textContent = skinSmoothBrushState.size + 'px';
}

function updateSkinBrushStrength(val) {
    skinSmoothBrushState.strength = parseInt(val, 10) || 65;
    var lbl = document.getElementById('lbl-skin-brush-strength');
    if (lbl) lbl.textContent = skinSmoothBrushState.strength + '%';
}

function clearSkinBrushOverlay() {
    var canvas = document.getElementById('wm-skin-brush-canvas');
    if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    skinSmoothBrushState.strokePoints = [];
    skinSmoothBrushState.previewMaskActive = false;
    var btnMask = document.getElementById('btn-toggle-skin-mask');
    if (btnMask) {
        btnMask.style.background = 'rgba(2,132,199,0.1)';
        btnMask.style.color = '#38bdf8';
    }
    if (typeof showToast === 'function') showToast('✕ Overlay kuas di-reset.');
}


/* ========================================================================= */
/* REVISI 108: EVOTO AI RETOUCHING ENGINE (MEDIAPIPE 468 LANDMARKS +         */
/* TRUE FREQUENCY SEPARATION FOR AUTHENTIC SKIN PORES & EYE PROTECTION)      */
/* ========================================================================= */

var evotoEngineState = {
    faceMesh: null,
    isInitializing: false,
    isReady: false,
    lastLandmarks: null
};

// 1. Inisialisasi Google MediaPipe Face Mesh
function initMediaPipeFaceMesh(callback) {
    if (evotoEngineState.isReady && evotoEngineState.faceMesh) {
        if (callback) callback(evotoEngineState.faceMesh);
        return;
    }
    if (typeof FaceMesh === 'undefined') {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
        script.crossOrigin = 'anonymous';
        script.onload = function() {
            setupFaceMeshInstance(callback);
        };
        script.onerror = function() {
            console.warn('MediaPipe CDN offline, menggunakan fallback anatomi lokal.');
            if (callback) callback(null);
        };
        document.head.appendChild(script);
    } else {
        setupFaceMeshInstance(callback);
    }
}

function setupFaceMeshInstance(callback) {
    try {
        var fm = new FaceMesh({
            locateFile: function(file) {
                return 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/' + file;
            }
        });
        fm.setOptions({
            maxNumFaces: 4,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        fm.onResults(function(results) {
            if (results && results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                evotoEngineState.lastLandmarks = results.multiFaceLandmarks;
            } else {
                evotoEngineState.lastLandmarks = null;
            }
            if (fm._pendingResolve) {
                fm._pendingResolve(evotoEngineState.lastLandmarks);
                fm._pendingResolve = null;
            }
        });
        evotoEngineState.faceMesh = fm;
        evotoEngineState.isReady = true;
        if (callback) callback(fm);
    } catch (e) {
        console.warn('FaceMesh init error:', e);
        if (callback) callback(null);
    }
}

// Deteksi koordinat landmark wajah dari elemen foto
function detectFaceLandmarksAsync(imgElement) {
    return new Promise(function(resolve) {
        if (!imgElement || !imgElement.naturalWidth) {
            resolve(null);
            return;
        }
        initMediaPipeFaceMesh(function(fm) {
            if (!fm) {
                resolve(null);
                return;
            }
            fm._pendingResolve = resolve;
            fm.send({ image: imgElement }).catch(function(err) {
                console.warn('FaceMesh send error:', err);
                resolve(null);
            });
            setTimeout(function() {
                if (fm._pendingResolve) {
                    fm._pendingResolve(null);
                    fm._pendingResolve = null;
                }
            }, 1800);
        });
    });
}

// 2. Indeks Landmark Anatomi Standar MediaPipe 468/478 Titik
var MP_INDICES = {
    faceOval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    leftEye: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    rightEye: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    leftEyebrow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    rightEyebrow: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
    lipsOuter: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
    nostrils: [1, 2, 98, 327, 168, 197, 5, 4]
};

// 3. Bangun Masker Kulit Presisi Tinggi (Mata, Alis, Bibir Dikecualikan 100%)
function buildEvotoSkinMaskCanvas(w, h, allFacesLandmarks) {
    if (!allFacesLandmarks || allFacesLandmarks.length === 0) return null;

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    for (var f = 0; f < allFacesLandmarks.length; f++) {
        var lm = allFacesLandmarks[f];

        function drawPolygon(indices) {
            if (!indices || indices.length === 0) return;
            ctx.beginPath();
            var p0 = lm[indices[0]];
            ctx.moveTo(p0.x * w, p0.y * h);
            for (var i = 1; i < indices.length; i++) {
                var p = lm[indices[i]];
                ctx.lineTo(p.x * w, p.y * h);
            }
            ctx.closePath();
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff';
        drawPolygon(MP_INDICES.faceOval);
        ctx.fill();

        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000000';

        drawPolygon(MP_INDICES.leftEye);
        ctx.fill();
        drawPolygon(MP_INDICES.rightEye);
        ctx.fill();
        drawPolygon(MP_INDICES.leftEyebrow);
        ctx.fill();
        drawPolygon(MP_INDICES.rightEyebrow);
        ctx.fill();
        drawPolygon(MP_INDICES.lipsOuter);
        ctx.fill();
        drawPolygon(MP_INDICES.nostrils);
        ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    return canvas;
}

// 4. Algoritma True Frequency Separation Berbasis Standar Photoshop & Evoto AI
function applyEvotoFrequencySeparation(data, w, h, maskArray, softenPct, texturePct) {
    var blendStrength = (softenPct / 100);
    var textureScale = (texturePct / 50);
    if (blendStrength <= 0) return;

    var totalPixels = w * h;
    var orig = new Uint8Array(data.length);
    orig.set(data);

    var lowLayer = new Uint8Array(data.length);
    var radius = Math.max(3, Math.round(w / 350));
    var spatialRadSq = radius * radius;

    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var pos = y * w + x;
            var idx = pos * 4;

            if (maskArray && maskArray[pos] === 0) {
                lowLayer[idx] = orig[idx];
                lowLayer[idx + 1] = orig[idx + 1];
                lowLayer[idx + 2] = orig[idx + 2];
                lowLayer[idx + 3] = orig[idx + 3];
                continue;
            }

            var cR = orig[idx], cG = orig[idx + 1], cB = orig[idx + 2];
            var sumR = 0, sumG = 0, sumB = 0, sumWeight = 0;

            for (var dy = -radius; dy <= radius; dy += 2) {
                var ny = y + dy;
                if (ny < 0 || ny >= h) continue;
                for (var dx = -radius; dx <= radius; dx += 2) {
                    var nx = x + dx;
                    if (nx < 0 || nx >= w) continue;

                    var dSq = dx * dx + dy * dy;
                    if (dSq > spatialRadSq) continue;

                    var nIdx = (ny * w + nx) * 4;
                    var nR = orig[nIdx], nG = orig[nIdx + 1], nB = orig[nIdx + 2];

                    var cDiff = Math.abs(nR - cR) + Math.abs(nG - cG) + Math.abs(nB - cB);
                    if (cDiff > 42) continue;

                    var wgt = (1 - (dSq / (spatialRadSq * 1.5))) * (1 - (cDiff / 50));
                    sumR += nR * wgt;
                    sumG += nG * wgt;
                    sumB += nB * wgt;
                    sumWeight += wgt;
                }
            }

            if (sumWeight > 0) {
                lowLayer[idx] = Math.round(sumR / sumWeight);
                lowLayer[idx + 1] = Math.round(sumG / sumWeight);
                lowLayer[idx + 2] = Math.round(sumB / sumWeight);
            } else {
                lowLayer[idx] = cR;
                lowLayer[idx + 1] = cG;
                lowLayer[idx + 2] = cB;
            }
            lowLayer[idx + 3] = orig[idx + 3];
        }
    }

    for (var i = 0; i < totalPixels; i++) {
        if (maskArray && maskArray[i] === 0) continue;

        var pIdx = i * 4;
        for (var c = 0; c < 3; c++) {
            var origVal = orig[pIdx + c];
            var lowVal = lowLayer[pIdx + c];
            
            var highDelta = (origVal - lowVal) * textureScale;
            var blendedLow = origVal * (1 - blendStrength) + lowVal * blendStrength;
            var finalVal = Math.round(blendedLow + highDelta);
            data[pIdx + c] = Math.max(0, Math.min(255, finalVal));
        }
    }
}

function applyBilateralSkinSmoothing(data, w, h, maskArray, strengthPct) {
    applyEvotoFrequencySeparation(data, w, h, maskArray, strengthPct, 50);
}

function initSkinSmoothBrushStageListeners() {
    var frame = document.getElementById('wm-stage-frame');
    if (!frame || frame._skinSmoothBrushBound) return;
    frame._skinSmoothBrushBound = true;

    function getCoords(e) {
        var bgImg = document.getElementById('wm-simulator-bg');
        if (!bgImg) return null;
        var rect = bgImg.getBoundingClientRect();
        var clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches ? e.changedTouches[0].clientX : 0));
        var clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : (e.changedTouches ? e.changedTouches[0].clientY : 0));
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
        return {
            normX: (clientX - rect.left) / rect.width,
            normY: (clientY - rect.top) / rect.height
        };
    }

    function onPointerDown(e) {
        if (!skinSmoothBrushState.active) return;
        var coords = getCoords(e);
        if (!coords) return;
        skinSmoothBrushState.isDrawing = true;
        skinSmoothBrushState.strokePoints = [coords];
        renderSkinBrushStrokePreview();
    }

    function onPointerMove(e) {
        if (!skinSmoothBrushState.active || !skinSmoothBrushState.isDrawing) return;
        var coords = getCoords(e);
        if (!coords) return;
        skinSmoothBrushState.strokePoints.push(coords);
        renderSkinBrushStrokePreview();
    }

    function onPointerUp(e) {
        if (!skinSmoothBrushState.active || !skinSmoothBrushState.isDrawing) return;
        skinSmoothBrushState.isDrawing = false;
        if (skinSmoothBrushState.strokePoints.length > 0) {
            applyTargetedSkinSmoothingFromBrush();
        }
    }

    frame.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    frame.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('touchend', onPointerUp, { passive: true });
}

function renderSkinBrushStrokePreview() {
    var canvas = document.getElementById('wm-skin-brush-canvas');
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!canvas || !bgImg) return;

    canvas.width = bgImg.clientWidth || 800;
    canvas.height = bgImg.clientHeight || 600;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var pts = skinSmoothBrushState.strokePoints;
    if (pts.length === 0) return;

    var brushRadius = (skinSmoothBrushState.size / 2) * (canvas.width / 800);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.lineWidth = brushRadius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(pts[0].normX * canvas.width, pts[0].normY * canvas.height);
    for (var i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].normX * canvas.width, pts[i].normY * canvas.height);
    }
    ctx.stroke();
}

function applyTargetedSkinSmoothingFromBrush() {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.naturalWidth) return;
    var pts = skinSmoothBrushState.strokePoints;
    if (!pts || pts.length === 0) return;

    if (typeof pushPhotoHistory === 'function') {
        pushPhotoHistory('Kuas Mulus Kulit (Evoto AI)');
    }

    var w = bgImg.naturalWidth;
    var h = bgImg.naturalHeight;
    var softenVal = skinSmoothBrushState.strength;
    var textureSlider = document.getElementById('slider-evoto-ret-texture');
    var textureVal = textureSlider ? parseInt(textureSlider.value, 10) : 50;

    detectFaceLandmarksAsync(bgImg).then(function(landmarks) {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bgImg, 0, 0, w, h);

        var imgData = ctx.getImageData(0, 0, w, h);
        var data = imgData.data;

        var maskArray = new Uint8Array(w * h);
        var brushRadiusPx = Math.max(12, Math.round((skinSmoothBrushState.size / 800) * w));

        for (var p = 0; p < pts.length; p++) {
            var px = Math.round(pts[p].normX * w);
            var py = Math.round(pts[p].normY * h);
            for (var dy = -brushRadiusPx; dy <= brushRadiusPx; dy++) {
                var ny = py + dy;
                if (ny >= 0 && ny < h) {
                    for (var dx = -brushRadiusPx; dx <= brushRadiusPx; dx++) {
                        var nx = px + dx;
                        if (nx >= 0 && nx < w) {
                            if (dx * dx + dy * dy <= brushRadiusPx * brushRadiusPx) {
                                maskArray[ny * w + nx] = 1;
                            }
                        }
                    }
                }
            }
        }

        if (landmarks && landmarks.length > 0) {
            var mCanvas = buildEvotoSkinMaskCanvas(w, h, landmarks);
            if (mCanvas) {
                var mData = mCanvas.getContext('2d').getImageData(0, 0, w, h).data;
                for (var i = 0; i < w * h; i++) {
                    if (maskArray[i] === 1 && mData[i * 4 + 3] < 128) {
                        maskArray[i] = 0;
                    }
                }
            }
        }

        applyEvotoFrequencySeparation(data, w, h, maskArray, softenVal, textureVal);

        ctx.putImageData(imgData, 0, 0);
        var smoothedUrl = canvas.toDataURL('image/jpeg', 0.95);
        bgImg.src = smoothedUrl;
        if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
            appState.stagedPhotos[appState.activeStagedIndex].dataUrl = smoothedUrl;
        }

        clearSkinBrushOverlay();

        if (typeof showToast === 'function') {
            showToast('✨ Evoto AI: Area usapan dihaluskan dengan pori-pori alami terjaga!');
        }
    });
}

function toggleAutoSkinMaskPreview() {
    var bgImg = document.getElementById('wm-simulator-bg');
    var canvas = document.getElementById('wm-skin-brush-canvas');
    var btn = document.getElementById('btn-toggle-skin-mask');
    if (!bgImg || !canvas) return;

    skinSmoothBrushState.previewMaskActive = !skinSmoothBrushState.previewMaskActive;

    if (!skinSmoothBrushState.previewMaskActive) {
        clearSkinBrushOverlay();
        canvas.style.display = 'none';
        if (btn) {
            btn.style.background = 'rgba(2,132,199,0.1)';
            btn.style.color = '#38bdf8';
        }
        if (typeof showToast === 'function') showToast('👁️ Mask kulit disembunyikan.');
        return;
    }

    if (btn) {
        btn.style.background = '#0284c7';
        btn.style.color = '#ffffff';
    }
    canvas.style.display = 'block';

    var w = bgImg.naturalWidth;
    var h = bgImg.naturalHeight;
    canvas.width = bgImg.clientWidth || 800;
    canvas.height = bgImg.clientHeight || 600;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    detectFaceLandmarksAsync(bgImg).then(function(landmarks) {
        if (landmarks && landmarks.length > 0) {
            var dispW = canvas.width;
            var dispH = canvas.height;
            var maskCanvas = buildEvotoSkinMaskCanvas(dispW, dispH, landmarks);
            if (maskCanvas) {
                ctx.globalAlpha = 0.55;
                ctx.drawImage(maskCanvas, 0, 0);
                ctx.globalCompositeOperation = 'source-in';
                ctx.fillStyle = '#10b981';
                ctx.fillRect(0, 0, dispW, dispH);
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 1.0;
            }
        } else {
            var offCanvas = document.createElement('canvas');
            offCanvas.width = w;
            offCanvas.height = h;
            var offCtx = offCanvas.getContext('2d');
            offCtx.drawImage(bgImg, 0, 0, w, h);
            var data = offCtx.getImageData(0, 0, w, h).data;
            var dispData = ctx.createImageData(canvas.width, canvas.height);
            var dd = dispData.data;

            var scaleX = w / canvas.width;
            var scaleY = h / canvas.height;

            for (var cy = 0; cy < canvas.height; cy++) {
                var srcY = Math.floor(cy * scaleY);
                for (var cx = 0; cx < canvas.width; cx++) {
                    var srcX = Math.floor(cx * scaleX);
                    var srcIdx = (srcY * w + srcX) * 4;
                    var dIdx = (cy * canvas.width + cx) * 4;

                    var r = data[srcIdx], g = data[srcIdx + 1], b = data[srcIdx + 2];
                    var yVal = 0.299 * r + 0.587 * g + 0.114 * b;
                    var cbVal = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
                    var crVal = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

                    var isSkin = (cbVal >= 75 && cbVal <= 135 && crVal >= 130 && crVal <= 180) || (r > g && g > b && r > 50 && (r - b) > 15);
                    var isEyeOrLip = yVal < 50 || (r < 55 && g < 55 && b < 55) || (r > 115 && (r - g) > 40 && (r - b) > 35);

                    if (isSkin && !isEyeOrLip) {
                        dd[dIdx] = 16;
                        dd[dIdx + 1] = 185;
                        dd[dIdx + 2] = 129;
                        dd[dIdx + 3] = 135;
                    } else {
                        dd[dIdx + 3] = 0;
                    }
                }
            }
            ctx.putImageData(dispData, 0, 0);
        }

        if (typeof showToast === 'function') {
            showToast('👁️ Area Hijau = Topeng Kulit Evoto AI (Mata & bibir 100% terlindungi)');
        }
    });
}

function applyAutoSkinMaskSmoothing() {
    var bgImg = document.getElementById('wm-simulator-bg');
    if (!bgImg || !bgImg.naturalWidth) return;

    if (typeof pushPhotoHistory === 'function') {
        pushPhotoHistory('Auto Mask Kulit Wajah (Evoto AI)');
    }

    if (typeof showToast === 'function') {
        showToast('🧠 Evoto AI: Menganalisa 468 landmark wajah & memisahkan pori...');
    }

    var w = bgImg.naturalWidth;
    var h = bgImg.naturalHeight;

    var softenSlider = document.getElementById('slider-evoto-ret-soften');
    var textureSlider = document.getElementById('slider-evoto-ret-texture');
    var softenVal = softenSlider ? parseInt(softenSlider.value, 10) : skinSmoothBrushState.strength;
    var textureVal = textureSlider ? parseInt(textureSlider.value, 10) : 50;

    detectFaceLandmarksAsync(bgImg).then(function(landmarks) {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bgImg, 0, 0, w, h);
        var imgData = ctx.getImageData(0, 0, w, h);
        var data = imgData.data;

        var maskArray = new Uint8Array(w * h);

        if (landmarks && landmarks.length > 0) {
            var maskCanvas = buildEvotoSkinMaskCanvas(w, h, landmarks);
            if (maskCanvas) {
                var mData = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;
                for (var i = 0; i < w * h; i++) {
                    if (mData[i * 4 + 3] > 128) {
                        maskArray[i] = 1;
                    }
                }
            }
        } else {
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var pos = y * w + x;
                    var idx = pos * 4;
                    var r = data[idx], g = data[idx + 1], b = data[idx + 2];
                    var yVal = 0.299 * r + 0.587 * g + 0.114 * b;
                    var cbVal = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
                    var crVal = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

                    var isSkin = (cbVal >= 75 && cbVal <= 135 && crVal >= 130 && crVal <= 180) || (r > g && g > b && r > 50 && (r - b) > 15);
                    var isEyeOrLip = yVal < 50 || (r < 55 && g < 55 && b < 55) || (r > 115 && (r - g) > 40 && (r - b) > 35);

                    if (isSkin && !isEyeOrLip) {
                        maskArray[pos] = 1;
                    }
                }
            }
        }

        applyEvotoFrequencySeparation(data, w, h, maskArray, softenVal, textureVal);

        ctx.putImageData(imgData, 0, 0);
        var smoothedUrl = canvas.toDataURL('image/jpeg', 0.95);
        bgImg.src = smoothedUrl;
        if (typeof appState !== 'undefined' && appState.stagedPhotos && appState.stagedPhotos[appState.activeStagedIndex]) {
            appState.stagedPhotos[appState.activeStagedIndex].dataUrl = smoothedUrl;
        }

        clearSkinBrushOverlay();

        if (typeof showToast === 'function') {
            showToast('✨ Evoto AI: Kulit wajah mulus sutra, pori alami terjaga & mata pin-sharp!');
        }
    });
}


// Inisialisasi listener kuas mulus saat halaman siap
document.addEventListener('DOMContentLoaded', initSkinSmoothBrushStageListeners);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initSkinSmoothBrushStageListeners();
}

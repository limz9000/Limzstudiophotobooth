var appState = {
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
        initCropDragEvents();
        initWatermarkDragEvents();
        initIndexedDB();
        initCameraAndStorageHub();
        checkUrlRouting();
        initKeyboardShortcuts();
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
        if (toggleBtn) {
            toggleBtn.innerText = isCollapsed ? '▶' : '◀';
        }
        if (floatBtn) {
            floatBtn.style.display = isCollapsed ? 'inline-flex' : 'none';
        }
        localStorage.setItem('limz_sidebar_collapsed', isCollapsed ? 'true' : 'false');
    }

    function initSidebarState() {
        var saved = localStorage.getItem('limz_sidebar_collapsed');
        var sidebar = document.getElementById('dashboard-sidebar');
        var toggleBtn = document.getElementById('sidebar-toggle-btn');
        var floatBtn = document.getElementById('sidebar-floating-toggle');
        if (saved === 'true') {
            if (sidebar) sidebar.classList.add('collapsed');
            if (toggleBtn) toggleBtn.innerText = '▶';
            if (floatBtn) floatBtn.style.display = 'inline-flex';
        } else {
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
        enumerateCameraDevices();
        startLiveCameraStream();
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

    function enumerateCameraDevices() {
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
                videoDevices.forEach(function (dev, idx) {
                    var opt = document.createElement('option');
                    opt.value = dev.deviceId;
                    opt.innerText = dev.label || ('Kamera ' + (idx + 1) + ' (USB / Capture Card / iPad)');
                    select.appendChild(opt);
                });
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

        var videoConstraint = deviceId
            ? { deviceId: { exact: deviceId } }
            : {
                width: { ideal: 1920, min: 640 },
                height: { ideal: 1080, min: 480 }
            };

        navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false })
            .then(function (stream) {
                liveCameraStream = stream;
                video.srcObject = stream;
                video.play();
            })
            .catch(function (err) {
                console.error('Kamera error, coba fallback constraint:', err);
                navigator.mediaDevices.getUserMedia({ video: true, audio: false })
                    .then(function (fallbackStream) {
                        liveCameraStream = fallbackStream;
                        video.srcObject = fallbackStream;
                        video.play();
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
            isCropped: false
        };
        if (appState.photoFilterState && appState.photoFilterState.isLocked) {
            newSnap.appliedGrading = JSON.parse(JSON.stringify(appState.photoFilterState));
        }
        if (appState.liveCameraSettings) {
            newSnap.appliedCameraSettings = JSON.parse(JSON.stringify(appState.liveCameraSettings));
        }
        appState.stagedPhotos.push(newSnap);

        // Auto-save jepretan kamera langsung ke folder lokal PC atau IndexedDB iPad
        if (appState.localExportDirHandle || isTabletOrMobileDevice()) {
            savePhotoToLocalDirectory(fileName, dataUrl);
        }

        appState.activeStagedIndex = appState.stagedPhotos.length - 1;
        renderStagedPhotosUI();
        showToast('📸 Foto berhasil dijepret & masuk antrian preview!');
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
            if (lastFolder) {
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
        var ipadInput = document.getElementById('file-input-ipad-roll');
        if (ipadInput) {
            showToast('📱 Hubungkan kabel data USB kamera ke iPad. Di dialog yang muncul: pilih "Choose Files" (buka kamera di sidebar Files) atau "Photo Library".');
            ipadInput.click();
        }
    }

    async function triggerUsbCameraProbe(e) {
        if (e && e.stopPropagation) e.stopPropagation();
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
            if (appState.localExportDirHandle || isTabletOrMobileDevice()) {
                savePhotoToLocalDirectory(data.name, data.dataUrl);
            }

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
            if (mainKey) {
                var slug = (appState.activeCollectionData && appState.activeCollectionData.slug) || '';
                var directUrl = getDirectPhotoOrGalleryUrl(slug, mainKey);
                setCachedQrCode('mon-qr-large-img', directUrl, 400);
                setCachedQrCode('mon-qr-img', directUrl, 260);
                var bEl = document.getElementById('mon-qr-badge-text');
                if (bEl) bEl.innerText = 'FOTO TAMPIL';
                var dEl = document.getElementById('mon-qr-heading-desc');
                if (dEl) dEl.innerHTML = 'Scan & Download<br><span style="color:#e2b86b;">Foto yang Sedang Tampil</span>';
                var hEl = document.getElementById('mon-qr-target-hint');
                if (hEl) hEl.innerText = '📸 Pindai untuk membuka foto ini langsung...';
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

        // Update labels
        if (el('lbl-flt-exposure')) el('lbl-flt-exposure').innerText = ((s.exposure || 0) >= 0 ? '+' : '') + ((s.exposure || 0) / 25).toFixed(2) + ' EV';
        if (el('lbl-flt-contrast')) el('lbl-flt-contrast').innerText = ((s.contrast || 0) >= 0 ? '+' : '') + (s.contrast || 0) + '%';
        if (el('lbl-flt-highlights')) el('lbl-flt-highlights').innerText = ((s.highlights || 0) >= 0 ? '+' : '') + (s.highlights || 0) + '%';
        if (el('lbl-flt-shadows')) el('lbl-flt-shadows').innerText = ((s.shadows || 0) >= 0 ? '+' : '') + (s.shadows || 0) + '%';
        if (el('lbl-flt-whites')) el('lbl-flt-whites').innerText = ((s.whites || 0) >= 0 ? '+' : '') + (s.whites || 0) + '%';
        if (el('lbl-flt-blacks')) el('lbl-flt-blacks').innerText = ((s.blacks || 0) >= 0 ? '+' : '') + (s.blacks || 0) + '%';

        if (el('lbl-flt-crv-hl')) el('lbl-flt-crv-hl').innerText = s.curve.highlights;
        if (el('lbl-flt-crv-lights')) el('lbl-flt-crv-lights').innerText = s.curve.lights;
        if (el('lbl-flt-crv-darks')) el('lbl-flt-crv-darks').innerText = s.curve.darks;
        if (el('lbl-flt-crv-sh')) el('lbl-flt-crv-sh').innerText = s.curve.shadows;

        if (el('lbl-flt-temp')) el('lbl-flt-temp').innerText = ((s.temperature || 0) >= 0 ? '+' : '') + s.temperature;
        if (el('lbl-flt-tint')) el('lbl-flt-tint').innerText = ((s.tint || 0) >= 0 ? '+' : '') + s.tint;
        if (el('lbl-flt-vibrance')) el('lbl-flt-vibrance').innerText = ((s.vibrance || 0) >= 0 ? '+' : '') + s.vibrance + '%';
        if (el('lbl-flt-sat')) el('lbl-flt-sat').innerText = ((s.saturation || 0) >= 0 ? '+' : '') + s.saturation + '%';

        if (el('lbl-flt-clarity')) el('lbl-flt-clarity').innerText = ((s.clarity || 0) >= 0 ? '+' : '') + s.clarity + '%';
        if (el('lbl-flt-texture')) el('lbl-flt-texture').innerText = ((s.texture || 0) >= 0 ? '+' : '') + s.texture + '%';
        if (el('lbl-flt-dehaze')) el('lbl-flt-dehaze').innerText = ((s.dehaze || 0) >= 0 ? '+' : '') + s.dehaze + '%';
        if (el('lbl-flt-sharpen')) el('lbl-flt-sharpen').innerText = s.sharpen + '%';
        if (el('lbl-flt-grain')) el('lbl-flt-grain').innerText = s.grain + '%';

        if (el('lbl-hsl-hue')) el('lbl-hsl-hue').innerText = (s.colorMix[actCol].h >= 0 ? '+' : '') + s.colorMix[actCol].h;
        if (el('lbl-hsl-sat')) el('lbl-hsl-sat').innerText = (s.colorMix[actCol].s >= 0 ? '+' : '') + s.colorMix[actCol].s + '%';
        if (el('lbl-hsl-lum')) el('lbl-hsl-lum').innerText = (s.colorMix[actCol].l >= 0 ? '+' : '') + s.colorMix[actCol].l + '%';

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

        // Hitung effective brightness dari exposure, whites, blacks, shadows, highlights
        var expMultiplier = (s.exposure || 0) * 1.5;
        var b = 100 + (s.brightness || 0) + expMultiplier + Math.round((s.shadows || 0) * 0.35) + Math.round((s.highlights || 0) * 0.2) + Math.round((s.whites || 0) * 0.3) + Math.round((s.blacks || 0) * 0.2);
        var c = 100 + (s.contrast || 0) + Math.round((s.shadows || 0) * -0.15) + Math.round((s.clarity || 0) * 0.25);
        var sat = 100 + (s.saturation || 0) + Math.round((s.vibrance || 0) * 0.6);
        var preset = s.preset;

        var filterStr = 'brightness(' + Math.max(10, Math.round(b)) + '%) contrast(' + Math.max(10, Math.round(c)) + '%) saturate(' + Math.max(0, Math.round(sat)) + '%)';
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

        bgImg.style.filter = filterStr;

        if (overlay) {
            var temp = s.temperature || 0;
            var tint = s.tint || 0;
            var absTemp = Math.abs(temp);
            var absTint = Math.abs(tint);

            // Cek apakah ada split toning / color grading aktif
            var cgShadows = (s.colorGrading && s.colorGrading.shadows) ? s.colorGrading.shadows : { h: 0, s: 0 };
            var cgHighlights = (s.colorGrading && s.colorGrading.highlights) ? s.colorGrading.highlights : { h: 0, s: 0 };

            if (absTemp > 0 || absTint > 0 || cgShadows.s > 0 || cgHighlights.s > 0) {
                var r = 128, g = 128, bVal = 128;
                if (temp > 0) { r += Math.round(temp * 2.2); bVal -= Math.round(temp * 1.5); }
                else if (temp < 0) { bVal += Math.round(-temp * 2.2); r -= Math.round(-temp * 1.5); }
                if (tint > 0) { r += Math.round(tint * 1.8); bVal += Math.round(tint * 1.8); g -= Math.round(tint * 1.5); }
                else if (tint < 0) { g += Math.round(-tint * 2.2); r -= Math.round(-tint * 1.2); }

                // Skin Tone Luminance Boost (Orange / Yellow)
                if (s.colorMix && s.colorMix.orange && s.colorMix.orange.l > 0) {
                    r += Math.round(s.colorMix.orange.l * 0.8);
                    g += Math.round(s.colorMix.orange.l * 0.5);
                }

                r = Math.max(0, Math.min(255, r));
                g = Math.max(0, Math.min(255, g));
                bVal = Math.max(0, Math.min(255, bVal));

                var maxShift = Math.max(absTemp, absTint, (cgHighlights.s * 0.5));
                overlay.style.backgroundColor = 'rgb(' + r + ',' + g + ',' + bVal + ')';
                overlay.style.opacity = Math.min(0.45, (maxShift / 50) * 0.35);
            } else {
                overlay.style.opacity = 0;
            }
        }
    }

    function getCanvasFilterString(customState) {
        var s = customState || appState.photoFilterState;
        var expMultiplier = (s.exposure || 0) * 1.5;
        var b = 100 + (s.brightness || 0) + expMultiplier + Math.round((s.shadows || 0) * 0.35) + Math.round((s.highlights || 0) * 0.2) + Math.round((s.whites || 0) * 0.3) + Math.round((s.blacks || 0) * 0.2);
        var c = 100 + (s.contrast || 0) + Math.round((s.shadows || 0) * -0.15) + Math.round((s.clarity || 0) * 0.25);
        var sat = 100 + (s.saturation || 0) + Math.round((s.vibrance || 0) * 0.6);
        var preset = s.preset;

        var filterStr = 'brightness(' + Math.max(10, Math.round(b)) + '%) contrast(' + Math.max(10, Math.round(c)) + '%) saturate(' + Math.max(0, Math.round(sat)) + '%)';
        if (preset === 'bw') {
            filterStr = 'grayscale(100%) ' + filterStr;
        } else if (preset === 'warm') {
            filterStr = 'sepia(20%) ' + filterStr;
        } else if (preset === 'vintage') {
            filterStr = 'sepia(35%) ' + filterStr;
        }
        return filterStr;
    }

    function rotateActiveStagedPhoto(angleDelta) {
        if (!appState.stagedPhotos || appState.stagedPhotos.length === 0) {
            showToast('⚠️ Belum ada foto dalam antrian pratinjau.');
            return;
        }
        var activePhoto = appState.stagedPhotos[appState.activeStagedIndex];
        if (!activePhoto) return;

        var currentRot = activePhoto.rotation || 0;
        var newRot = (currentRot + angleDelta) % 360;
        if (newRot < 0) newRot += 360;
        activePhoto.rotation = newRot;

        var bgImg = document.getElementById('wm-simulator-bg');
        if (bgImg) {
            bgImg.style.transform = 'rotate(' + newRot + 'deg)';
        }

        renderStagedPhotosUI();
        showToast('🔄 Foto #' + (appState.activeStagedIndex + 1) + ' diputar ke orientasi ' + newRot + '°');
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

        if (count === 0) {
            if (headingTitle) headingTitle.innerText = '0 Item siap dipublikasikan';
            if (badgeEl) {
                badgeEl.innerText = 'Belum Ada Foto';
                badgeEl.style.background = '#f1f5f9';
                badgeEl.style.color = '#64748b';
            }
            if (resetCropBtn) resetCropBtn.style.display = 'none';
            if (typeof toggleCropMode === 'function' && cropState.active) {
                toggleCropMode(false);
            }
            if (wrapperEl) wrapperEl.style.display = 'none';
            if (bgImg) {
                bgImg.src = 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=800&q=80';
                bgImg.style.transform = 'rotate(0deg)';
            }
            if (btnStartUpload) {
                btnStartUpload.disabled = true;
            }
            updatePhotoGradingPreview();
            updateWatermarkSimulatorDisplay();
            return;
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

                thumb.innerHTML = '<img src="' + item.dataUrl + '" style="width:100%; height:100%; object-fit:cover; display:block; transform: rotate(' + (item.rotation || 0) + 'deg); transition: transform 0.2s ease;">' +
                    cropBadge + rotBadge + statusBadge +
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
        var stageFrame = document.getElementById('wm-stage-frame');
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
        document.getElementById('slider-wm-pos-x').value = x;
        document.getElementById('slider-wm-pos-y').value = y;
        if (scale) document.getElementById('slider-wm-scale').value = scale;
        updateWatermarkManualSettings();
        showToast('Titik preset posisi diterapkan!');
    }

    function updateWatermarkSimulatorDisplay() {
        var overlay = document.getElementById('wm-simulator-overlay');
        var logoImg = document.getElementById('wm-sim-logo-img');
        var fallbackText = document.getElementById('wm-sim-fallback-text');

        if (!overlay) return;

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

        overlay.style.width = scale + '%';
        overlay.style.opacity = opacity;

        // Positioning halus, presisi dan bebas loncatan (0% - 100%)
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
        switchDashboardTab('tab-collections');
        if (!appState.collections || appState.collections.length === 0) {
            fetchCollectionsList();
        }
    }

    function showToast(msg) {
        var toast = document.getElementById('global-toast');
        toast.innerText = msg;
        toast.style.display = 'block';
        setTimeout(function () { toast.style.display = 'none'; }, 3500);
    }

    function switchView(viewId) {
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
        if (target) target.style.display = 'block';

        if (tabId === 'tab-storage') {
            fetchDriveStorageQuota();
        } else if (tabId === 'tab-upload') {
            refreshUploadedPhotosForTabUpload();
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

        var slug = urlParams.get('slug') || serverQuery.slug;
        var view = urlParams.get('view') || serverQuery.view;
        var photoId = urlParams.get('photoId') || urlParams.get('photo') || serverQuery.photoId || serverQuery.photo;

        // Parsing Pretty Path jika dibuka di Vercel (misal: /irvan-susan, /irvan-susan/monitor, atau langsung /monitor)
        if (!slug && isRunningOnVercelOrCustomDomain()) {
            var pathSegments = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/');
            if (pathSegments.length > 0 && pathSegments[0] && pathSegments[0] !== 'index.html') {
                if (pathSegments[0] === 'monitor' || pathSegments[0] === 'slideshow') {
                    // Jika URL adalah /monitor langsung, arahkan otomatis ke project event aktif terakhir!
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

                // Cek apakah ada cover tersimpan di localStorage atau preloaded server
                var cachedCover = (preloadedColl && preloadedColl.coverUrl)
                    ? preloadedColl.coverUrl
                    : (localStorage.getItem('limz_cover_' + slug) || '');

                var isAlreadyDismissed = false;
                try { isAlreadyDismissed = (sessionStorage.getItem('limz_splash_dismissed_' + slug) === '1'); } catch (e) { }
                if (isAlreadyDismissed) appState.splashDismissed = true;

                if (cachedCover && !appState.splashDismissed) {
                    startThreeSecondSplashScreen({ slug: slug, coverUrl: cachedCover }, cachedCover);
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
            switchView('view-landing');
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

        // Jika sudah ditutup oleh tamu, BATALKAN TOTAL!
        if (appState.splashDismissed) {
            var splashEl = document.getElementById('gallery-splash-loader');
            if (splashEl) splashEl.style.display = 'none';
            return;
        }

        var splash = document.getElementById('gallery-splash-loader');
        var bg = document.getElementById('splash-bg-overlay');
        var countEl = document.getElementById('splash-countdown-num');

        var finalCover = coverUrl || (coll && coll.coverUrl) || (coll && coll.slug && localStorage.getItem('limz_cover_' + coll.slug)) || '';
        if (bg && finalCover) {
            bg.style.backgroundImage = 'url(\'' + finalCover + '\')';
        }

        if (!splash) return;
        splash.style.display = 'flex';
        splash.style.pointerEvents = 'auto';
        splash.style.opacity = '1';

        var secondsLeft = 3;
        if (countEl) countEl.innerText = secondsLeft;

        if (splashCountdownTimer) clearInterval(splashCountdownTimer);

        splashCountdownTimer = setInterval(function () {
            if (appState.splashDismissed) {
                clearInterval(splashCountdownTimer);
                splashCountdownTimer = null;
                return;
            }
            secondsLeft--;
            if (secondsLeft > 0) {
                if (countEl) {
                    countEl.innerText = secondsLeft;
                }
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
            if (hasPhotos && mainKey) {
                var directMainUrl = getDirectPhotoOrGalleryUrl(slug, mainKey);
                setCachedQrCode('mon-qr-img', directMainUrl, 260);
                if (badgeTextEl) badgeTextEl.innerText = 'FOTO TAMPIL';
                if (descEl) descEl.innerHTML = 'Scan & Download<br><span style="color:#e2b86b;">Foto yang Sedang Tampil</span>';
                if (hintEl) hintEl.innerText = '📸 Pindai untuk membuka foto ini langsung...';
            } else {
                var galleryPublicUrl = getPublicGalleryUrl(slug);
                setCachedQrCode('mon-qr-img', galleryPublicUrl, 260);
                if (badgeTextEl) badgeTextEl.innerText = 'GALERI EVENT';
                if (descEl) descEl.innerHTML = 'Scan & Download<br><span style="color:#e2b86b;">Galeri Foto Event</span>';
                if (hintEl) hintEl.innerText = '📲 Pindai untuk membuka seluruh galeri...';
            }
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
        window.open(targetUrl, '_blank');
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
                coverUrl: coverBase64 ? '' : coverUrlInput,
                coverBase64: coverBase64 || ''
            };

            google.script.run
                .withSuccessHandler(function (res) {
                    btn.innerText = 'Simpan Perubahan';
                    btn.disabled = false;
                    closeModal('modal-edit-collection');
                    showToast(res.message || 'Koleksi berhasil diperbarui!');

                    // Update koleksi lokal seketika
                    if (res && res.coverUrl) {
                        for (var c = 0; c < appState.collections.length; c++) {
                            if (appState.collections[c].id === id) {
                                appState.collections[c].coverUrl = res.coverUrl;
                                break;
                            }
                        }
                        if (appState.activeCollectionData && appState.activeCollectionData.id === id) {
                            appState.activeCollectionData.coverUrl = res.coverUrl;
                            var heroBanner = document.getElementById('pub-hero-banner');
                            if (heroBanner) heroBanner.style.backgroundImage = 'url(\'' + res.coverUrl + '\')';
                        }
                    }
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
                if (appState.localExportDirHandle || isTabletOrMobileDevice()) {
                    savePhotoToLocalDirectory(processedFile.name, dataUrl);
                }

                var newStaged = {
                    id: 'staged_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + loadedCount,
                    file: processedFile,
                    name: processedFile.name,
                    size: processedFile.size,
                    dataUrl: dataUrl,
                    originalDataUrl: dataUrl,
                    isCropped: false,
                    wasRaw: isRawFile(file),
                    rotation: 0
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
        refreshDashboardData();
    }

    function handleLogout() {
        appState.currentUser = null;
        localStorage.removeItem('limz_saved_user_session');
        var em = document.getElementById('login-email');
        var pw = document.getElementById('login-password');
        if (em) em.value = '';
        if (pw) pw.value = '';
        switchView('view-landing');
        showToast('Anda telah keluar.');
    }

    function refreshDashboardData() {
        google.script.run
            .withSuccessHandler(function (res) {
                if (res.success) renderDashboardStats(res.stats);
            })
            .getDashboardStats();

        fetchCollectionsList();
        fetchSensorWords();
        fetchWishesForModeration();
    }

    function renderDashboardStats(stats) {
        document.getElementById('stat-total-collections').innerText = stats.totalCollections || 0;
        document.getElementById('stat-active-collections').innerText = stats.activeCollections || 0;
        document.getElementById('stat-total-photos').innerText = stats.totalPhotos || 0;
        document.getElementById('stat-total-views').innerText = stats.totalViews || 0;
        document.getElementById('stat-total-downloads').innerText = stats.totalDownloads || 0;

        var tbody = document.getElementById('tbody-latest-collections');
        tbody.innerHTML = '';
        var list = stats.latestCollections || [];

        for (var i = 0; i < list.length; i++) {
            var row = list[i];
            var tr = document.createElement('tr');
            var badgeClass = row.status === 'Active' ? 'badge-active' : 'badge-archived';
            tr.innerHTML = '<td><strong>' + row.title + '</strong><br><small style="color:var(--text-muted);">' + row.slug + '</small></td>' +
                '<td>' + row.clientName + '</td>' +
                '<td>' + formatDisplayDate(row.eventDate) + '</td>' +
                '<td>' + row.totalPhotos + '</td>' +
                '<td><span class="badge-status ' + badgeClass + '">' + row.status + '</span></td>' +
                '<td>' +
                '<button class="btn btn-outline btn-sm" onclick="openPublicGalleryNewTab(\'' + row.slug + '\')">↗ Galeri</button> ' +
                '<button class="btn btn-gold btn-sm" onclick="openSlideshowNewTab(\'' + row.slug + '\')">↗ Monitor</button>' +
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
                '<button class="btn btn-blue btn-sm role-admin-only" onclick="triggerGeneratePdf(\'' + c.id + '\')">PDF</button>' +
                archiveOrRestoreBtn +
                '</div>' +
                '</td>';
            tbody.appendChild(tr);
        }
        updateUserDisplay();
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
                '<button type="button" onclick="event.stopPropagation(); confirmDeleteUploadedPhoto(\'' + pPhotoId + '\', \'' + pDriveId + '\', \'' + pCollId + '\')" ' +
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
    function confirmDeleteUploadedPhoto(photoId, driveFileId, collectionId) {
        if (!confirm('Apakah Anda yakin ingin menghapus foto ini secara permanen dari Cloud, Galeri, Monitor, dan Google Drive?')) {
            return;
        }

        showToast('⏳ Sedang menghapus foto dari Cloud & Google Drive...');

        google.script.run
            .withSuccessHandler(function (res) {
                if (res && res.success) {
                    showToast('✅ ' + (res.message || 'Foto berhasil dihapus secara permanen.'));
                    refreshUploadedPhotosForTabUpload();
                    refreshDashboardData();

                    if (appState.currentView === 'view-public-gallery' && appState.activeCollectionId) {
                        loadGalleryPhotos(appState.activeCollectionId);
                    } else if (appState.currentView === 'view-slideshow' && appState.activeCollectionId) {
                        fetchMonitorContent(appState.activeCollectionId, true);
                    }
                } else {
                    showToast('⚠️ Gagal menghapus foto: ' + (res ? res.message : 'Kesalahan sistem'));
                }
            })
            .withFailureHandler(function (err) {
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

    function renderStorageTable(items) {
        var tbody = document.getElementById('tbody-expired-collections');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!items || items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 20px;">Belum ada koleksi tersimpan.</td></tr>';
            return;
        }

        for (var i = 0; i < items.length; i++) {
            var c = items[i];
            var tr = document.createElement('tr');
            var badgeClass = c.status === 'Active' ? 'badge-active' : 'badge-archived';

            var actionButtons = '';
            if (c.status === 'Active') {
                actionButtons += '<button class="btn btn-outline btn-sm" onclick="triggerArchiveCollection(\'' + c.id + '\')">📦 Arsip</button> ';
            } else if (c.status === 'Archived') {
                actionButtons += '<button class="btn btn-teal btn-sm" onclick="triggerUnarchiveCollection(\'' + c.id + '\')">🔄 Batal Arsip</button> ';
            }
            actionButtons += '<button class="btn btn-danger btn-sm" onclick="openDeleteConfirmModal(\'' + c.id + '\')">🗑️ Hapus</button>';

            tr.innerHTML = '<td><strong>' + c.title + '</strong><br><small style="color:var(--text-muted);">' + c.slug + '</small></td>' +
                '<td>' + formatDisplayDate(c.eventDate) + '</td>' +
                '<td>' + c.totalPhotos + ' Foto</td>' +
                '<td><span class="badge-status ' + badgeClass + '">' + c.status + '</span></td>' +
                '<td>' +
                '<div style="display:flex; gap:6px; flex-wrap:wrap;">' + actionButtons + '</div>' +
                '</td>';
            tbody.appendChild(tr);
        }
        updateUserDisplay();
    }

    function fetchSensorWords() {
        google.script.run.withSuccessHandler(renderSensorWordsTable).getSensorWords();
    }

    function renderSensorWordsTable(res) {
        var tbody = document.getElementById('tbody-sensor-words');
        if (!tbody) return;
        tbody.innerHTML = '';
        var words = res.words || [];
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + w.word + '</td><td>' + w.category + '</td>' +
                '<td><button class="btn btn-outline btn-sm" style="color:#ef4444;" onclick="deleteWordById(\'' + w.id + '\')">🗑️</button></td>';
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
        google.script.run
            .withSuccessHandler(function (res) {
                renderWishesModerationTable(res.wishes || []);
            })
            .getAllWishesForModeration('');
    }

    function renderWishesModerationTable(wishes) {
        var tbody = document.getElementById('tbody-wishes-moderation');
        if (!tbody) return;
        tbody.innerHTML = '';
        for (var i = 0; i < wishes.length; i++) {
            var w = wishes[i];
            var tr = document.createElement('tr');
            tr.innerHTML = '<td><strong>' + w.senderName + '</strong></td><td>' + w.cleanMessage + '</td><td>' + w.status + '</td>' +
                '<td><button class="btn btn-outline btn-sm" onclick="setWishStatus(\'' + w.wishId + '\', \'Approved\')">Approve</button> <button class="btn btn-danger btn-sm" onclick="setWishStatus(\'' + w.wishId + '\', \'Rejected\')">Reject</button></td>';
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

        if (elTotal) elTotal.innerText = 'Memuat...';
        if (elUsed) elUsed.innerText = 'Memuat...';
        if (elRemaining) elRemaining.innerText = 'Memuat...';

        google.script.run
            .withSuccessHandler(function (res) {
                if (!res || !res.success) {
                    if (elTotal) elTotal.innerText = '-';
                    if (elUsed) elUsed.innerText = '-';
                    if (elRemaining) elRemaining.innerText = 'Tidak tersedia';
                    if (elPercent) elPercent.innerText = 'Status kuota Google Drive tidak dapat dimuat.';
                    return;
                }

                if (res.unlimited) {
                    if (elTotal) elTotal.innerText = 'Unlimited (Workspace)';
                    if (elUsed) elUsed.innerText = formatByteSize(res.used);
                    if (elRemaining) elRemaining.innerText = '∞ Tanpa Batas';
                    if (elPercent) elPercent.innerText = 'Akun Google Workspace / Unlimited Storage';
                    if (elDetail) elDetail.innerText = 'Terpakai: ' + formatByteSize(res.used);
                    if (bar) {
                        bar.style.width = '15%';
                        bar.style.backgroundColor = '#16a34a';
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

                if (bar) {
                    bar.style.width = pct + '%';
                    if (pct >= 90) {
                        bar.style.backgroundColor = '#ef4444';
                    } else if (pct >= 75) {
                        bar.style.backgroundColor = '#f59e0b';
                    } else {
                        bar.style.backgroundColor = '#2563eb';
                    }
                }
            })
            .withFailureHandler(function (err) {
                if (elTotal) elTotal.innerText = '-';
                if (elUsed) elUsed.innerText = '-';
                if (elRemaining) elRemaining.innerText = 'Error';
                if (elPercent) elPercent.innerText = 'Gagal memuat kuota Google Drive: ' + err;
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

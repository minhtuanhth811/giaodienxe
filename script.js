/**
 * HỆ THỐNG ĐIỀU KHIỂN AGV & QUẢN LÝ KHO (WMS)
 * Kiến trúc: Phân tán (Master ESP32 - Slave Raspberry Pi)
 */

// --- 1. BIẾN TOÀN CỤC ---
let currentMode = 'MANUAL';
let packageCount = 0;
let activePickupTime = null;
const terminal = document.getElementById('terminalBox');
let testInterval; // Lưu vòng lặp test
let currentStep = 1; // Lưu bước hiện tại để Resume
let isAutoRunning = false; // Trạng thái chạy/dừng của chế độ AUTO
const JOINTS_WITH_NAMES = [
    { id: 1, label: 'Base' },
    { id: 2, label: 'Shoulder' },
    { id: 3, label: 'Elbow' },
    { id: 4, label: 'Wrist Pitch' },
    { id: 5, label: 'Wrist Roll' },
    { id: 6, label: 'Gripper' }
];

// --- 2. KHỞI TẠO HỆ THỐNG ---
function initDashboard() {
    const armHeader = document.querySelector('.arm-panel-header');
    if (armHeader) {
        armHeader.innerHTML += `<button onclick="resetArm()" class="btn-reset-arm"> Reset về 90°</button>`;
    }
    const armGrid = document.getElementById('armControlsGrid');
    JOINTS_WITH_NAMES.forEach((joint) => {
        armGrid.innerHTML += `
    <div class="joint-widget">
        <div class="joint-header">
            <span>J${joint.id}: ${joint.label}</span>
            <div class="input-container">
                <input type="number" id="num${joint.id}" class="joint-input" 
                       value="90" min="0" max="180" 
                       onchange="syncFromNum(${joint.id})">
                <div class="input-tooltip">Nhập từ 0° - 180°</div>
            </div>
        </div>
        <input type="range" id="range${joint.id}" min="0" max="180" value="90" 
            oninput="syncFromRange(${joint.id})" 
            onchange="sendArmCommand(${joint.id}, this.value)">
    </div>
`;
    });

    setInterval(() => {
        const timeEl = document.getElementById('sysTime');
        if (timeEl) {
            timeEl.innerText = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        }
    }, 1000);

    setMode('MANUAL');
}

// --- 3. CÁC HÀM TIỆN ÍCH ---
function printLog(message, isError = false) {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const colorClass = isError ? 'style="color: var(--color-red);"' : '';
    terminal.innerHTML += `<div class="log-line" ${colorClass}><span class="time">[${time}]</span> ${message}</div>`;
    terminal.scrollTop = terminal.scrollHeight;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m > 0 ? `${m}p ${s}s` : `${s} giây`;
}

// --- 4. GIAO TIẾP VỚI E-RA API ---
function sendToEra(pin, value) {
    console.log(`[E-RA TX] Pin: ${pin} | Val: ${value}`);
}

function setMode(mode) {
    // CHẶN TUYỆT ĐỐI: Đang EMERGENCY thì không cho đổi sang bất cứ mode nào
    if (currentMode === 'EMERGENCY') {
        printLog('HỆ THỐNG ĐANG KHÓA CỨNG! Hãy nhấn RESET SYSTEM trên nút màu đỏ.', true);
        return; // Thoát hàm ngay lập tức
    }

    currentMode = mode;
    const stopBtn = document.querySelector('.btn-stop');

    // Các thiết lập giao diện bên dưới giữ nguyên...
    stopBtn.innerText = 'STOP';
    stopBtn.classList.remove('is-start', 'is-auto-start');
    stopBtn.classList.add('is-stop');

    document.querySelectorAll('.btn-mode').forEach(btn => {
        btn.classList.remove('active', 'active-auto');
    });

    document.getElementById('modeDisplay').innerText = mode;

    if (mode === 'MANUAL') {
        isAutoRunning = false;
        clearInterval(testInterval);
        document.getElementById('btnManual').classList.add('active');
        document.getElementById('modeDisplay').className = 'value font-mono text-blue';
        sendToEra('V1', 0);
        setMissionStep(0);
        printLog('Đã chuyển sang MANUAL.');
    } else if (mode === 'AUTO') {
        isAutoRunning = true;
        currentStep = 1;
        document.getElementById('btnAuto').classList.add('active-auto');
        document.getElementById('modeDisplay').className = 'value font-mono text-green';
        sendToEra('V1', 1);
        printLog('Đã chuyển sang AUTO.');
        startAutoLogic();
    }
}
function triggerEmergency() {
    currentMode = 'EMERGENCY';
    isAutoRunning = false;
    clearInterval(testInterval);

    const emerBtn = document.getElementById('btnEmergency');
    emerBtn.innerText = 'RESET SYSTEM';
    emerBtn.classList.add('active-emergency');

    // Gán trực tiếp hàm Reset
    emerBtn.onclick = resetFromEmergency;

    const stopBtn = document.querySelector('.btn-stop');
    stopBtn.innerText = 'LOCKED';
    stopBtn.style.background = 'var(--color-red)';
    stopBtn.style.color = '#fff';
    stopBtn.style.borderColor = '#fff';

    document.getElementById('modeDisplay').innerText = 'EMG-LOCKED';
    if (stopBtn) {
        // XÓA SẠCH các class xanh trước khi thêm hiệu ứng đỏ của Emergency
        stopBtn.classList.remove('is-start', 'is-auto-start');

        // Cập nhật giao diện Emergency cho nút
        stopBtn.innerText = 'LOCKED';
        stopBtn.classList.add('is-stop'); // Ép về màu đỏ chuyên nghiệp

        // Nếu Khoa có dùng inline style thì nên xóa luôn để nó ăn theo Class
        stopBtn.style.borderColor = '#ef4444';
        stopBtn.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.5)';
    }
    printLog('⚠️ EMERGENCY: Hệ thống đã khóa. Nhấn RESET để tiếp tục!', true);

    sendToEra('V1', 99);
    sendToEra('V2', 'STOP');
}

function move(direction) {
    if (currentMode === 'EMERGENCY') {
        // Nếu là lệnh STOP thì không cần báo (vì hệ thống đang stop rồi)
        // Nhưng nếu là các hướng di chuyển khác thì phải báo lỗi
        if (direction !== 'S' && direction !== 'FORCE_STOP') {
            printLog('HỆ THỐNG ĐANG KHÓA! Hãy nhấn RESET SYSTEM trên nút màu đỏ.', true);
        }
        return;
    }

    const stopBtn = document.querySelector('.btn-stop');

    // --- XỬ LÝ CHẾ ĐỘ AUTO ---
    if (currentMode === 'AUTO') {
        if (direction === 'FORCE_STOP') {
            if (!isAutoRunning) {
                isAutoRunning = true;
                stopBtn.innerText = 'STOP';
                // Xóa class xanh, thêm class đỏ
                stopBtn.classList.remove('is-start', 'is-auto-start');
                stopBtn.classList.add('is-stop');

                printLog('AUTO: Tiếp tục hành trình...', '#10b981');
                startAutoLogic();
            } else {
                isAutoRunning = false;
                clearInterval(testInterval);
                sendToEra('V2', 'STOP');

                stopBtn.innerText = 'START';
                // QUAN TRỌNG: Xóa class đỏ, thêm class xanh
                stopBtn.classList.remove('is-stop');
                stopBtn.classList.add('is-start'); // Hoặc is-auto-start tùy Khoa đặt tên

                printLog('AUTO: Đã tạm dừng.', '#ef4444');
            }
        } else if (direction !== 'S') {
            printLog('Lỗi: Đang AUTO!', true);
        }
        return;
    }

    if (direction === 'FORCE_STOP') {
        if (stopBtn.innerText === 'STOP') {
            // --- CHUYỂN SANG TRẠNG THÁI START (XANH) ---
            sendToEra('V2', 'S');
            stopBtn.innerText = 'START';

            stopBtn.classList.remove('is-stop'); // Xóa class đỏ
            stopBtn.classList.add('is-start');    // Thêm class xanh

            printLog('MANUAL: Đã dừng xe. (Ấn START để tiếp tục)', '#f59e0b');
        } else {
            // --- CHUYỂN SANG TRẠNG THÁI STOP (ĐỎ) ---
            stopBtn.innerText = 'STOP';

            stopBtn.classList.remove('is-start'); // Xóa class xanh
            stopBtn.classList.add('is-stop');     // Thêm class đỏ

            printLog('MANUAL: Hệ thống sẵn sàng điều khiển.', '#10b981');
        }
        return;
    }
    // Gửi lệnh di chuyển chỉ khi nút đang ở trạng thái STOP (Sẵn sàng)
    if (stopBtn.innerText === 'STOP') {
        sendToEra('V2', direction);
        if (direction !== 'S') {
            printLog(`Motor Drive: ${direction}`);
        }
    } else {
        if (direction !== 'S') {
            printLog('Lỗi: Hãy nhấn START để mở khóa điều khiển!', true);
        }
    }
}
// Hàm bổ trợ để quản lý vòng lặp AUTO
function startAutoLogic() {
    clearInterval(testInterval);
    testInterval = setInterval(() => {
        if (currentMode !== 'AUTO' || !isAutoRunning) {
            clearInterval(testInterval);
            return;
        }
        onEraMessageReceived('V5', currentStep);
        if (currentStep === 5) currentStep = 0;
        currentStep++;
    }, 2500);
}
function sendArmCommand(id, value) {
    if (currentMode === 'EMERGENCY') {
        printLog('LỖI: Tay máy bị khóa cứng do EMERGENCY!', true);
        return;
    }
    if (currentMode !== 'MANUAL') {
        printLog('Lỗi: Tay máy bị khóa trong chế độ AUTO', true);
        return;
    }
    const jointName = JOINTS_WITH_NAMES.find(j => j.id === id).label;
    sendToEra(`V${10 + id}`, value);
    // HIỆN THÔNG BÁO RA BẢNG TELEMETRY
    printLog(`Khớp ${jointName} (J${id}) -> ${value}°`);
}

// Khi bạn gõ số vào ô và nhấn Enter hoặc bỏ chọn ô
function syncFromNum(id) {
    let val = document.getElementById(`num${id}`).value;
    if (val < 0) val = 0;
    if (val > 180) val = 180;

    document.getElementById(`num${id}`).value = val;
    document.getElementById(`range${id}`).value = val;

    // Gọi hàm gửi lệnh (hàm này sẽ tự in Log)
    sendArmCommand(id, val);
}

// Khi bạn kéo thanh trượt
function syncFromRange(id) {
    let val = document.getElementById(`range${id}`).value;
    document.getElementById(`num${id}`).value = val;
    // Không in log ở đây để tránh làm tràn bảng Telemetry khi đang kéo
}

// --- 6. XỬ LÝ CẢNH BÁO ---
function showAlert() {
    clearInterval(testInterval);
    document.getElementById('lineAlert').style.display = 'flex';
    printLog('CRITICAL ERROR: Xe bị mất line!', true);
}

function dismissAlert() {
    document.getElementById('lineAlert').style.display = 'none';
    setMode('MANUAL');
}

function setMissionStep(stepIndex) {
    const labels = ['Sẵn sàng', 'Đang tới A', 'Tại A: Gắp hàng', 'Đang tới B', 'Tại B: Thả hàng', 'Hoàn thành'];
    const statusObj = document.getElementById('missionStatus');

    if (statusObj) {
        statusObj.innerText = labels[stepIndex] || 'N/A';

        // Xóa sạch các class màu cũ trước khi đặt màu mới
        statusObj.classList.remove('moving-status', 'done-status');

        if (stepIndex >= 1 && stepIndex <= 4) {
            // TRƯỜNG HỢP 1: Đang làm (Hiện màu VÀNG)
            statusObj.classList.add('moving-status');
        }
        else if (stepIndex === 5) {
            // TRƯỜNG HỢP 2: Hoàn thành (Hiện màu XANH LÁ)
            statusObj.classList.add('done-status');
        }
        // TRƯỜNG HỢP 3: Mặc định (Sẵn sàng) -> Sẽ không có class màu, hiện màu xám/đen gốc
    }
    // --- PHẦN QUAN TRỌNG: RESET TRẠNG THÁI KHI BẮT ĐẦU VÒNG MỚI ---
    // Nếu stepIndex = 0 hoặc 1 (bắt đầu chu trình mới), ta xóa sạch màu của các bước cũ
    if (stepIndex <= 1) {
        for (let j = 0; j <= 5; j++) {
            const s = document.getElementById('step' + j);
            const l = document.getElementById('line' + j);
            if (s) s.classList.remove('active', 'done');
            if (l) l.classList.remove('done');
        }
    }

    // --- CẬP NHẬT ĐÈN THEO BƯỚC HIỆN TẠI ---
    for (let i = 0; i <= 5; i++) {
        const step = document.getElementById('step' + i);
        const line = document.getElementById('line' + i);

        if (!step) continue; // Bỏ qua nếu không tìm thấy ID

        // Xóa trạng thái cũ để cập nhật mới
        step.classList.remove('active', 'done');
        if (line) line.classList.remove('done');

        if (i < stepIndex) {
            // Các bước đã qua: Hiện màu xanh (Done)
            step.classList.add('done');
            if (line) line.classList.add('done');
        } else if (i === stepIndex) {
            // Bước hiện tại: Hiện màu xanh dương (Active)
            step.classList.add('active');
        }
    }
}
function handleWMSRecord(step) {
    const tbody = document.getElementById('wmsBody');
    const timeNow = new Date();
    const timeStr = timeNow.toLocaleTimeString('vi-VN', { hour12: false });

    if (step === 2) {
        activePickupTime = timeNow;
        const newId = packageCount + 1;
        const pkgCode = `PKG-${String(newId).padStart(4, '0')}`;
        const row = document.createElement('tr');
        row.id = `pkg-row-${newId}`;
        row.innerHTML = `
            <td class="font-mono text-blue font-bold">${pkgCode}</td>
            <td>${timeStr}</td>
            <td id="t-drop-${newId}" style="color: var(--text-dim);">--:--:--</td>
            <td id="t-diff-${newId}" style="color: var(--text-dim);">Đang tính...</td>
            <td id="t-stat-${newId}"><span class="tag tag-warn">Đang trung chuyển</span></td>
        `;
        tbody.appendChild(row);
        const tableWrap = document.getElementById('wmsTableWrap');
        tableWrap.scrollTop = tableWrap.scrollHeight;
        printLog(`[WMS] Bắt đầu gắp: ${pkgCode}`);
    }

    if (step === 5) {
        packageCount++;
        document.getElementById('totalCount').innerText = String(packageCount).padStart(2, '0');
        const dropCell = document.getElementById(`t-drop-${packageCount}`);
        const diffCell = document.getElementById(`t-diff-${packageCount}`);
        const statCell = document.getElementById(`t-stat-${packageCount}`);
        if (dropCell && activePickupTime) {
            dropCell.innerText = timeStr;
            dropCell.style.color = 'var(--text-main)';
            statCell.innerHTML = `<span class="tag tag-succ">Đã nhập kho B</span>`;
            const diffMs = timeNow - activePickupTime;
            diffCell.innerText = formatDuration(diffMs);
            diffCell.className = 'text-green font-bold';
        }
        printLog(`[WMS] Nhập kho thành công kiện thứ ${packageCount}`);
        setTimeout(() => { if (currentMode === 'AUTO') setMissionStep(0); }, 3000);
    }
}

function onEraMessageReceived(pin, value) {
    if (pin === 'V5') {
        const step = parseInt(value);
        if (step === 99) { showAlert(); return; }
        setMissionStep(step);
        handleWMSRecord(step);
    }
}

function exportWMS() {
    const table = document.getElementById("wmsTable");
    const rows = table.querySelectorAll("tr");
    let csv = "\uFEFF";
    rows.forEach(row => {
        const cols = row.querySelectorAll("td, th");
        const rowData = Array.from(cols).map(col => `"${col.innerText.trim()}"`);
        csv += rowData.join(",") + "\n";
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `AGV_WMS_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

initDashboard();

// GIẢ LẬP TEST AUTO
document.getElementById('btnAuto').addEventListener('click', () => {
    clearInterval(testInterval);
    let step = 1;
    testInterval = setInterval(() => {
        if (currentMode !== 'AUTO') { clearInterval(testInterval); return; }
        onEraMessageReceived('V5', step);
        if (step === 5) step = 0;
        step++;
    }, 2500);
});
function resetArm() {
    // 1. Kiểm tra chế độ (Chỉ cho phép reset khi ở MANUAL)
    if (currentMode !== 'MANUAL') {
        printLog('Lỗi: Cần chuyển sang MANUAL để Reset tay máy', true);
        return;
    }

    // 2. Hiện thông báo bắt đầu
    printLog('Hệ thống: Đang đưa tay máy về vị trí mặc định (90°)...', '#3b82f6');

    // 3. Thực hiện thay đổi giá trị trên giao diện và gửi lệnh ngay lập tức
    JOINTS_WITH_NAMES.forEach(joint => {
        const defaultVal = 90;

        // Cập nhật ô số
        const numInput = document.getElementById(`num${joint.id}`);
        if (numInput) numInput.value = defaultVal;

        // Cập nhật thanh trượt
        const rangeInput = document.getElementById(`range${joint.id}`);
        if (rangeInput) rangeInput.value = defaultVal;

        // Gửi lệnh xuống ESP32 (V11 - V16)
        sendToEra(`V${10 + joint.id}`, defaultVal);
    });

    // 4. Đợi 5 giây (5000ms) sau mới hiện thông báo hoàn tất
    setTimeout(() => {
        printLog('Hoàn tất: Tay máy đã về vị trí 90°.');
    }, 3000);
}
function onEraMessageReceived(pin, value) {
    if (pin === 'V5') {
        const step = parseInt(value);
        currentStep = step; // Cập nhật biến nhớ để khi Start lại sẽ chạy đúng bước
        if (step === 99) { showAlert(); return; }
        setMissionStep(step);
        handleWMSRecord(step);
    }
}
function resetFromEmergency() {
    currentMode = 'MANUAL';
    printLog('Hệ thống: Đang giải phóng lệnh khóa...', '#3b82f6');

    // 1. Trả lại nút EMERGENCY nguyên bản
    const emerBtn = document.getElementById('btnEmergency');
    if (emerBtn) {
        emerBtn.innerText = 'EMERGENCY';
        emerBtn.classList.remove('active-emergency');
        emerBtn.onclick = triggerEmergency;
    }

    // 2. LÀM SẠCH NÚT STOP (Xóa bỏ vòng đỏ cứng)
    const stopBtn = document.querySelector('.btn-stop');
    if (stopBtn) {
        // XÓA sạch các style "cứng" mà triggerEmergency đã áp vào
        stopBtn.style.background = '';
        stopBtn.style.color = '';
        stopBtn.style.borderColor = '';
        stopBtn.style.boxShadow = '';

        // Đưa nó về trạng thái STOP mặc định (Màu đỏ chuyên nghiệp)
        stopBtn.innerText = 'STOP';
        stopBtn.classList.remove('is-start', 'is-auto-start');
        stopBtn.classList.add('is-stop');
    }

    // 3. Mở khóa lại 2 nút Gắp/Thả
    const actionBtns = document.querySelectorAll('.btn-action');
    actionBtns.forEach(btn => {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.cursor = 'pointer';
    });

    setMode('MANUAL');
    printLog('Hệ thống: Đã mở khóa hoàn toàn.', '#10b981');
}
function manualPick() {
    if (currentMode !== 'MANUAL') {
        printLog('Lỗi: Hãy chuyển sang MANUAL để gắp!', true);
        return;
    }
    // Giả sử J6 là kẹp hàng, 180 độ là đóng
    sendToEra('V16', 180);
    // Cập nhật giao diện thanh trượt J6 cho đồng bộ
    if (document.getElementById('num6')) document.getElementById('num6').value = 180;
    if (document.getElementById('range6')) document.getElementById('range6').value = 180;

    printLog('MANUAL: Lệnh GẮP HÀNG (J6 -> 180°)', '#10b981');
}

function manualDrop() {
    if (currentMode !== 'MANUAL') {
        printLog('Lỗi: Hãy chuyển sang MANUAL để thả!', true);
        return;
    }
    // Giả sử J6 là kẹp hàng, 0 độ là mở
    sendToEra('V16', 0);
    // Cập nhật giao diện thanh trượt J6 cho đồng bộ
    if (document.getElementById('num6')) document.getElementById('num6').value = 0;
    if (document.getElementById('range6')) document.getElementById('range6').value = 0;

    printLog('MANUAL: Lệnh THẢ HÀNG (J6 -> 0°)', '#f59e0b');
}
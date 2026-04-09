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

const eraWidget = new EraWidget();


function pressing(direction){
    console.log(direction);
    if (direction == 'up'){
        eraWidget.triggerAction(action[0]?.action, null);
    } else if (direction == 'down'){
        eraWidget.triggerAction(action[2]?.action, null);
    } else if (direction == 'left'){
        eraWidget.triggerAction(action[4]?.action, null);
    } else if (direction == 'right'){
        eraWidget.triggerAction(action[6]?.action, null);
    }
}
function release(direction){
    console.log(direction);
    if (direction == 'up'){
        eraWidget.triggerAction(action[1]?.action, null);
    } else if (direction == 'down'){
        eraWidget.triggerAction(action[3]?.action, null);
    } else if (direction == 'left'){
        eraWidget.triggerAction(action[5]?.action, null);
    } else if (direction == 'right'){
        eraWidget.triggerAction(action[7]?.action, null);
    }
}
function manualPick(){
    console.log(direction);
    eraWidget.triggerAction(action[8]?.action, null);
}
function manualDrop(){
    console.log(direction);
    eraWidget.triggerAction(action[9]?.action, null);
}

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

function setMode(mode) {
    if (currentMode === 'EMERGENCY') {
        printLog('HỆ THỐNG ĐANG KHÓA CỨNG! Hãy nhấn RESET SYSTEM trên nút màu đỏ.', true);
        return;
    }

    currentMode = mode;
    const stopBtn = document.querySelector('.btn-stop');
    const statusObj = document.getElementById('missionStatus'); // Lấy cái Badge

    // RESET Badge màu sắc
    if (statusObj) {
        statusObj.classList.remove('moving-status', 'done-status', 'ready-status');
    }

    // Reset nút Stop/Start ở giữa
    stopBtn.innerText = 'STOP';
    stopBtn.classList.remove('is-start', 'is-auto-start');
    stopBtn.classList.add('is-stop');
    // Xóa bỏ style inline do Emergency áp vào (nếu có)
    stopBtn.style.background = '';
    stopBtn.style.boxShadow = '';

    document.getElementById('modeDisplay').innerText = mode;

    if (mode === 'MANUAL') {
        isAutoRunning = false;
        clearInterval(testInterval);
        document.getElementById('btnManual').classList.add('active');
        document.getElementById('btnAuto').classList.remove('active-auto');
        if (statusObj) statusObj.innerText = 'Chế độ tay';
        printLog('Đã chuyển sang MANUAL.');
    } else if (mode === 'AUTO') {
        isAutoRunning = false; // Đợi bấm nút giữa mới chạy thực sự
        currentStep = 0;
        document.getElementById('btnAuto').classList.add('active-auto');
        document.getElementById('btnManual').classList.remove('active');

        // LÀM SÁNG BADGE XANH DƯƠNG
        if (statusObj) {
            statusObj.innerText = 'Sẵn sàng';
            statusObj.classList.add('ready-status');
        }
        printLog('Đã chuyển sang AUTO (Sẵn sàng).');
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
        if (direction !== 'S' && direction !== 'FORCE_STOP') {
            printLog('HỆ THỐNG ĐANG KHÓA! Hãy nhấn RESET SYSTEM trên nút màu đỏ.', true);
        }
        return;
    }

    const stopBtn = document.querySelector('.btn-stop');

    // --- BẢNG MAPPING LỆNH CHỮ SANG SỐ ĐỂ GỬI QUA E-RA ---
    // 0: STOP, 1: FORWARD, 2: BACKWARD, 3: LEFT, 4: RIGHT
    let eraValue = 0;
    if (direction === 'F') eraValue = 1;
    else if (direction === 'B') eraValue = 2;
    else if (direction === 'L') eraValue = 3;
    else if (direction === 'R') eraValue = 4;
    else eraValue = 0; // Mặc định cho S, STOP, FORCE_STOP

    // --- XỬ LÝ CHẾ ĐỘ AUTO ---
    if (currentMode === 'AUTO') {
        if (direction === 'FORCE_STOP') {
            if (!isAutoRunning) {
                isAutoRunning = true;
                stopBtn.innerText = 'STOP';
                stopBtn.classList.remove('is-start', 'is-auto-start');
                stopBtn.classList.add('is-stop');

                printLog('AUTO: Tiếp tục hành trình...', '#10b981');
                startAutoLogic();
            } else {
                isAutoRunning = false;
                clearInterval(testInterval);

                // Gửi số 0 thay vì chữ 'STOP'
                sendToEra('V2', 0);

                stopBtn.innerText = 'START';
                stopBtn.classList.remove('is-stop');
                stopBtn.classList.add('is-start');

                printLog('AUTO: Đã tạm dừng.', '#ef4444');
            }
        } else if (direction !== 'S') {
            printLog('Lỗi: Đang AUTO!', true);
        }
        return;
    }

    if (direction === 'FORCE_STOP') {
        if (stopBtn.innerText === 'STOP') {
            // Gửi số 0 (Dừng xe)
            sendToEra('V2', 0);
            stopBtn.innerText = 'START';

            stopBtn.classList.remove('is-stop');
            stopBtn.classList.add('is-start');

            printLog('MANUAL: Đã dừng xe. (Ấn START để tiếp tục)', '#f59e0b');
        } else {
            stopBtn.innerText = 'STOP';

            stopBtn.classList.remove('is-start');
            stopBtn.classList.add('is-stop');

            printLog('MANUAL: Hệ thống sẵn sàng điều khiển.', '#10b981');
        }
        return;
    }

    // Gửi lệnh di chuyển chỉ khi nút đang ở trạng thái STOP (Sẵn sàng)
    if (stopBtn.innerText === 'STOP') {
        // Gửi con số (1, 2, 3, 4 hoặc 0) đã mapping ở đầu hàm
        sendToEra('V2', eraValue);

        if (direction !== 'S') {
            printLog(`Motor Drive: ${direction} (Mã: ${eraValue})`);
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
        // Xóa sạch màu cũ
        statusObj.classList.remove('moving-status', 'done-status', 'ready-status');

        if (stepIndex >= 1 && stepIndex <= 4) {
            statusObj.classList.add('moving-status'); // Vàng
        } else if (stepIndex === 5) {
            statusObj.classList.add('done-status');   // Xanh lá
        } else if (stepIndex === 0 && currentMode === 'AUTO') {
            statusObj.classList.add('ready-status');  // Xanh dương
        }
    }

    // Logic xử lý các vòng tròn (step) bên dưới
    for (let i = 0; i <= 5; i++) {
        const step = document.getElementById('step' + i);
        const line = document.getElementById('line' + i);
        if (!step) continue;

        step.classList.remove('active', 'done');
        if (line) line.classList.remove('done');

        if (i < stepIndex) {
            step.classList.add('done');
            if (line) line.classList.add('done');
        } else if (i === stepIndex) {
            step.classList.add('active'); // Luôn là Xanh dương theo ý Khoa
        }
    }
}
function handleWMSRecord(step) {
    const tbody = document.getElementById('wmsBody');
    const timeNow = new Date();
    const timeStr = timeNow.toLocaleTimeString('vi-VN', { hour12: false });

    const dateStr = timeNow.toLocaleDateString('vi-VN');
    if (step === 2) {
        activePickupTime = timeNow;
        const newId = packageCount + 1;
        const pkgCode = `PKG-${String(newId).padStart(4, '0')}`;
        const row = document.createElement('tr');
        row.id = `pkg-row-${newId}`;

        row.innerHTML = `
            <td class="font-mono text-blue font-bold">${pkgCode}</td>
            <td>${dateStr}</td> <td>${timeStr}</td>
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
eraWidget.init({
  onConfiguration: (configuration) => {
    action = configuration.actions;
    pressUpConfig = configuration.actions[0];
    releaseUpConfig = configuration.actions[1];
    pressDownConfig = configuration.actions[2];
    releaseDownConfig = configuration.actions[3];
    pressLeftConfig = configuration.actions[4];
    releaseLeftConfig = configuration.actions[5];
    pressRightConfig = configuration.actions[6];
    releaseRightConfig = configuration.actions[7];
    PickConfig = configuration.actions[8];
    DropConfig = configuration.actions[9];
    
  },
});

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
// Hàm Gắp (Sửa lại để gửi số 160 hoặc 180 tùy giới hạn của Khoa)
function manualPick() {
    if (currentMode !== 'MANUAL') {
        printLog('Lỗi: Hãy chuyển sang MANUAL để gắp!', true);
        return;
    }
    const gripAngle = 160; // Góc đóng kẹp (theo code test của Khoa)
    sendToEra('V16', gripAngle);

    // Đồng bộ thanh trượt trên giao diện
    if (document.getElementById('num6')) document.getElementById('num6').value = gripAngle;
    if (document.getElementById('range6')) document.getElementById('range6').value = gripAngle;

    printLog(`MANUAL: Lệnh GẮP HÀNG (V16 -> ${gripAngle}°)`, '#10b981');
}

// Hàm Thả
function manualDrop() {
    if (currentMode !== 'MANUAL') {
        printLog('Lỗi: Hãy chuyển sang MANUAL để thả!', true);
        return;
    }
    const openAngle = 10; // Góc mở kẹp
    sendToEra('V16', openAngle);

    if (document.getElementById('num6')) document.getElementById('num6').value = openAngle;
    if (document.getElementById('range6')) document.getElementById('range6').value = openAngle;

    printLog(`MANUAL: Lệnh THẢ HÀNG (V16 -> ${openAngle}°)`, '#f59e0b');
}
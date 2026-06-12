var API = '';
var charts = {};
var currentPage = 'dashboard';
var adminLoggedIn = false;
var userStep = 0;
var userState = { dept: 0, doctor: null, date: '', slot: '' };

var $ = function(s) { return document.querySelector(s); };
var $$ = function(s) { return document.querySelectorAll(s); };
var fmt = function(n) { return n == null ? '--' : Number(n).toLocaleString('en-IN'); };
var fmtMoney = function(n) { return n == null ? '--' : '\u20B9' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0 }); };
var badge = function(t, c) { return '<span class="badge badge-' + c + '">' + t + '</span>'; };
var nullVal = function(v) { return v == null || v === '' ? '<span class="null-val">NULL</span>' : v; };

async function api(url, opts) {
    opts = opts || {};
    try {
        var res = await fetch(API + url, {
            headers: { 'Content-Type': 'application/json' },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            method: opts.method || 'GET'
        });
        if (!res.ok) {
            var errText = await res.text();
            try { var errJson = JSON.parse(errText); throw new Error(errJson.error || 'Request failed'); }
            catch (parseErr) { throw new Error('Server error (check terminal): ' + errText.substring(0, 120)); }
        }
        return await res.json();
    } catch (e) { toast(e.message, 'error'); throw e; }
}

function toast(msg, type) {
    type = type || 'success';
    var icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = '<i class="fas ' + icons[type] + '"></i><span>' + msg + '</span>';
    $('#toast-container').appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
}

function closeModal() { $('#modal-overlay').classList.add('hidden'); }
function openModal(title, body) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    $('#modal-overlay').classList.remove('hidden');
}

function updateClock() {
    var now = new Date();
    $('#clock').textContent = now.toLocaleTimeString('en-IN', { hour12: true }) + '  \u2022  ' + now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
setInterval(updateClock, 1000);
updateClock();

(function () {
    var saved = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
})();
 $('#theme-toggle').addEventListener('click', function () {
    var cur = document.body.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
    toast('Switched to ' + next + ' theme', 'info');
});
function updateThemeIcon(t) {
    $('#theme-toggle').innerHTML = t === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}

 $$('.nav-item').forEach(function (item) {
    item.addEventListener('click', function (e) {
        e.preventDefault();
        var page = item.dataset.page;
        if (page === currentPage) return;
        $$('.nav-item').forEach(function (n) { n.classList.remove('active'); });
        item.classList.add('active');
        currentPage = page;
        var titles = { dashboard: 'Dashboard', patients: 'Patient Records', doctors: 'Doctor Directory', appointments: 'Appointment Management', beds: 'Bed Management', billing: 'Billing & Invoices', admin: 'Admin Portal', 'user-portal': 'User Portal', 'dbms-explorer': 'DBMS Concept Explorer' };
        $('#page-title').textContent = titles[page] || page;
        userStep = 0;
        userState = { dept: 0, doctor: null, date: '', slot: '' };
        renderPage(page);
        $('#sidebar').classList.remove('open');
    });
});
 $('#sidebar-toggle').addEventListener('click', function () { $('#sidebar').classList.toggle('open'); });

function statusBadge(s) {
    var m = { Scheduled: 'blue', Confirmed: 'accent', Completed: 'green', Cancelled: 'red', 'No-Show': 'yellow', Pending: 'yellow', Paid: 'green', Active: 'green', Inactive: 'gray' };
    return badge(s, m[s] || 'gray');
}

function renderPage(page) {
    Object.values(charts).forEach(function (c) { c.destroy(); });
    charts = {};
    $('#page-content').className = 'page-enter';
    var r = { dashboard: renderDashboard, patients: renderPatients, doctors: renderDoctors, appointments: renderAppointments, beds: renderBeds, billing: renderBilling, admin: renderAdmin, 'user-portal': renderUserPortal, 'dbms-explorer': renderDBMSExplorer };
    (r[page] || renderDashboard)();
}

function makeTable(data, cols, fmts, sqlMode) {
    if (!data || !data.length) return '<p style="color:var(--fg-dim);padding:12px 0">No data returned</p>';
    var fc = function (col, val) {
        if (val == null || val === '') return '<span class="null-val">NULL</span>';
        if (fmts && fmts[col]) return fmts[col](val);
        if (sqlMode && typeof val === 'string' && val.length > 80) return '<span style="font-size:0.72rem">' + val.substring(0, 80) + '...</span>';
        return val;
    };
    return '<div class="table-wrap"><table class="dbms-result-table"><thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' + data.map(function (row) { return '<tr>' + cols.map(function (c) { return '<td>' + fc(c, row[c]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
}

function highlightSQL(sql) {
    if (!sql) return '';
    return sql.replace(/(--[^\n]*)/g, '<span class="cmt">$1</span>')
        .replace(/\b(CREATE|VIEW|TRIGGER|INDEX|TABLE|SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|BEGIN|COMMIT|ROLLBACK|TRANSACTION|ON|AFTER|BEFORE|FOR|EACH|ROW|WHEN|IF|EXISTS|NOT NULL|UNIQUE|PRIMARY KEY|FOREIGN KEY|REFERENCES|DEFAULT|GROUP BY|ORDER BY|HAVING|INNER|LEFT|RIGHT|JOIN|AS|AND|OR|IN|CASE|THEN|ELSE|END|LIKE|DISTINCT|COUNT|SUM|AVG|ROUND|COALESCE|NULL|ASC|DESC|LIMIT|DROP|PRAGMA|AUTOINCREMENT|CONFLICT|DO)\b/gi, '<span class="kw">$1</span>')
        .replace(/\b(datetime|COUNT|SUM|AVG|ROUND|COALESCE|CAST)\b/gi, '<span class="fn">$1</span>')
        .replace(/'([^']*)'/g, "'<span class=\"str\">$1</span>'");
}

// ===================== DASHBOARD =====================
async function renderDashboard() {
    var d = await api('/api/dashboard');
    $('#page-content').innerHTML =
        '<div class="stats-grid">' +
        '<div class="stat-card accent"><div class="stat-icon accent"><i class="fas fa-user-injured"></i></div><div class="stat-value">' + d.total_patients + '</div><div class="stat-label">Total Patients</div></div>' +
        '<div class="stat-card info"><div class="stat-icon info"><i class="fas fa-user-md"></i></div><div class="stat-value">' + d.total_doctors + '</div><div class="stat-label">Active Doctors</div></div>' +
        '<div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-calendar-check"></i></div><div class="stat-value">' + d.scheduled_appts + '</div><div class="stat-label">Scheduled</div></div>' +
        '<div class="stat-card success"><div class="stat-icon success"><i class="fas fa-bed"></i></div><div class="stat-value">' + d.available_beds + '<small style="font-size:0.5em;color:var(--fg-dim)">/' + d.total_beds + '</small></div><div class="stat-label">Available Beds</div></div>' +
        '<div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-rupee-sign"></i></div><div class="stat-value" style="font-size:1.4rem">' + fmtMoney(d.total_revenue) + '</div><div class="stat-label">Total Revenue</div></div></div>' +
        '<div class="grid-2"><div class="card"><div class="card-header"><h3>Appointments by Status</h3></div><div class="card-body"><div class="chart-container"><canvas id="chart-appt-status"></canvas></div></div></div>' +
        '<div class="card"><div class="card-header"><h3>Bed Occupancy by Type</h3></div><div class="card-body"><div class="chart-container"><canvas id="chart-bed-type"></canvas></div></div></div></div>' +
        '<div class="grid-2"><div class="card"><div class="card-header"><h3>Department Revenue</h3></div><div class="card-body"><div class="chart-container"><canvas id="chart-dept-rev"></canvas></div></div></div>' +
        '<div class="card"><div class="card-header"><h3>Avg Wait Time by Dept</h3></div><div class="card-body"><div class="chart-container"><canvas id="chart-wait"></canvas></div></div></div></div>' +
        '<div class="card"><div class="card-header"><h3>Recent Appointments</h3></div><div class="card-body table-wrap"><table><thead><tr><th>Patient</th><th>Doctor</th><th>Dept</th><th>Date</th><th>Time</th><th>Status</th><th>Fees</th></tr></thead><tbody>' +
        d.recent_appts.map(function (a) { return '<tr><td>' + a.patient_name + '</td><td>' + a.doctor_name + '</td><td>' + a.dept_name + '</td><td class="mono" style="font-size:0.8rem">' + a.appointment_date + '</td><td class="mono">' + a.time_slot + '</td><td>' + statusBadge(a.status) + '</td><td class="money">' + fmtMoney(a.fees) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>';

    var sc = { Scheduled: '#3498db', Completed: '#2ed573', Cancelled: '#ff4757', 'No-Show': '#ffa502', Confirmed: '#00d4aa' };
    charts.as = new Chart($('#chart-appt-status'), { type: 'doughnut', data: { labels: d.appt_by_status.map(function (s) { return s.status; }), datasets: [{ data: d.appt_by_status.map(function (s) { return s.cnt; }), backgroundColor: d.appt_by_status.map(function (s) { return sc[s.status] || '#666'; }), borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#7a8599', padding: 16, font: { family: 'Space Grotesk' } } } } } });
    charts.bt = new Chart($('#chart-bed-type'), { type: 'bar', data: { labels: d.bed_by_type.map(function (b) { return b.bed_type; }), datasets: [{ label: 'Available', data: d.bed_by_type.map(function (b) { return b.available; }), backgroundColor: 'rgba(46,213,115,0.7)' }, { label: 'Occupied', data: d.bed_by_type.map(function (b) { return b.occupied; }), backgroundColor: 'rgba(255,71,87,0.7)' }, { label: 'Maintenance', data: d.bed_by_type.map(function (b) { return b.maintenance; }), backgroundColor: 'rgba(255,165,2,0.7)' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#7a8599', font: { family: 'Space Grotesk' } } } }, scales: { x: { stacked: true, ticks: { color: '#7a8599' }, grid: { color: '#1e293b' } }, y: { stacked: true, ticks: { color: '#7a8599', stepSize: 1 }, grid: { color: '#1e293b' } } } } });
    var dc = ['#00d4aa', '#3498db', '#f0a500', '#ff4757', '#2ed573', '#a55eea', '#ff6348', '#1e90ff'];
    charts.dr = new Chart($('#chart-dept-rev'), { type: 'bar', data: { labels: d.dept_stats.filter(function (s) { return s.revenue > 0; }).map(function (s) { return s.dept_name; }), datasets: [{ label: 'Revenue', data: d.dept_stats.filter(function (s) { return s.revenue > 0; }).map(function (s) { return s.revenue; }), backgroundColor: dc, borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#7a8599' }, grid: { color: '#1e293b' } }, y: { ticks: { color: '#7a8599' }, grid: { display: false } } } } });
    charts.wt = new Chart($('#chart-wait'), { type: 'bar', data: { labels: d.wait_times.map(function (w) { return w.dept_name; }), datasets: [{ label: 'Avg Wait (min)', data: d.wait_times.map(function (w) { return w.avg_wait; }), backgroundColor: 'rgba(0,212,170,0.6)', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#7a8599', maxRotation: 45 }, grid: { display: false } }, y: { ticks: { color: '#7a8599' }, grid: { color: '#1e293b' } } } } });
}

// ===================== PATIENTS =====================
var patientData = [];
async function renderPatients() {
    patientData = await api('/api/patients');
    $('#page-content').innerHTML = '<div class="toolbar"><div class="search-box"><i class="fas fa-search"></i><input id="patient-search" placeholder="Search by name, phone, or insurance ID..." /></div><button class="btn btn-primary" onclick="openPatientModal()"><i class="fas fa-plus"></i> Add Patient</button></div><div class="card"><div class="card-body table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Age</th><th>Gender</th><th>Phone</th><th>Blood</th><th>Insurance</th><th>Registered</th><th>Actions</th></tr></thead><tbody id="patient-tbody"></tbody></table></div></div>';
    renderPatientTable(patientData);
    $('#patient-search').addEventListener('input', function (e) {
        var q = e.target.value.toLowerCase();
        renderPatientTable(patientData.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0 || p.phone.indexOf(q) >= 0 || (p.insurance_id || '').toLowerCase().indexOf(q) >= 0; }));
    });
}
function renderPatientTable(data) {
    $('#patient-tbody').innerHTML = data.length ? data.map(function (p) { return '<tr><td class="mono" style="color:var(--fg-dim)">P' + String(p.patient_id).padStart(4, '0') + '</td><td style="font-weight:600">' + p.name + '</td><td>' + p.age + '</td><td>' + p.gender + '</td><td class="mono" style="font-size:0.8rem">' + p.phone + '</td><td>' + nullVal(p.blood_group) + '</td><td>' + (p.insurance_id ? '<span title="' + p.insurance_provider + '">' + p.insurance_id + '</span>' : '<span class="null-val">None</span>') + '</td><td class="mono" style="font-size:0.8rem">' + p.registration_date + '</td><td class="action-cell"><button class="btn btn-secondary btn-sm" onclick="openPatientModal(' + p.patient_id + ')"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm" onclick="deletePatient(' + p.patient_id + ',\'' + p.name.replace(/'/g, "\\'") + '\')"><i class="fas fa-trash"></i></button></td></tr>'; }).join('') : '<tr><td colspan="9" class="empty-state"><p>No patients found</p></td></tr>';
}
function openPatientModal(id) {
    var p = id ? patientData.find(function (x) { return x.patient_id === id; }) : null;
    openModal(p ? 'Edit Patient P' + String(id).padStart(4, '0') : 'Register New Patient',
        '<div class="form-grid"><div class="form-group"><label>Full Name *</label><input id="f-pname" value="' + (p ? p.name : '') + '" /></div><div class="form-group"><label>Age *</label><input id="f-page" type="number" value="' + (p ? p.age : '') + '" /></div><div class="form-group"><label>Gender *</label><select id="f-pgender"><option value="Male"' + (p && p.gender === 'Male' ? ' selected' : '') + '>Male</option><option value="Female"' + (p && p.gender === 'Female' ? ' selected' : '') + '>Female</option><option value="Other"' + (p && p.gender === 'Other' ? ' selected' : '') + '>Other</option></select></div><div class="form-group"><label>Phone *</label><input id="f-pphone" value="' + (p ? p.phone : '') + '" /></div><div class="form-group"><label>Email</label><input id="f-pemail" value="' + (p ? p.email || '' : '') + '" /></div><div class="form-group"><label>Blood Group</label><select id="f-pblood"><option value="">Select</option>' + ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(function (bg) { return '<option' + (p && p.blood_group === bg ? ' selected' : '') + '>' + bg + '</option>'; }).join('') + '</select></div><div class="form-group full"><label>Address</label><input id="f-paddr" value="' + (p ? p.address || '' : '') + '" /></div><div class="form-group"><label>Insurance ID</label><input id="f-pinsid" value="' + (p ? p.insurance_id || '' : '') + '" /></div><div class="form-group"><label>Insurance Provider</label><input id="f-pinsprov" value="' + (p ? p.insurance_provider || '' : '') + '" /></div></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePatient(' + id + ')">' + (p ? 'Update' : 'Register') + '</button></div>');
}
async function savePatient(id) {
    var data = { name: $('#f-pname').value, age: parseInt($('#f-page').value), gender: $('#f-pgender').value, phone: $('#f-pphone').value, email: $('#f-pemail').value, blood_group: $('#f-pblood').value, address: $('#f-paddr').value, insurance_id: $('#f-pinsid').value || null, insurance_provider: $('#f-pinsprov').value || null };
    if (!data.name || !data.age || !data.phone) return toast('Name, age, phone required', 'error');
    if (id) { await api('/api/patients/' + id, { method: 'PUT', body: data }); toast('Updated'); }
    else { await api('/api/patients', { method: 'POST', body: data }); toast('Registered'); }
    closeModal(); patientData = await api('/api/patients'); renderPatientTable(patientData);
}
async function deletePatient(id, name) {
    if (!confirm('Delete ' + name + '?\nCASCADE deletes appointments. SET NULL frees beds.')) return;
    await api('/api/patients/' + id, { method: 'DELETE' }); toast(name + ' deleted'); patientData = await api('/api/patients'); renderPatientTable(patientData);
}

// ===================== DOCTORS =====================
async function renderDoctors() {
    var docs = await api('/api/doctors'); var depts = await api('/api/departments'); window._depts = depts;
    $('#page-content').innerHTML = '<div class="toolbar"><select id="doc-dept-filter" class="filter-select"><option value="0">All Departments</option>' + depts.map(function (d) { return '<option value="' + d.dept_id + '">' + d.dept_name + '</option>'; }).join('') + '</select><button class="btn btn-primary" onclick="openDoctorModal()"><i class="fas fa-plus"></i> Add Doctor</button></div><div class="card"><div class="card-body table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Specialization</th><th>Department</th><th>Location</th><th>Phone</th><th>Salary</th><th>Status</th></tr></thead><tbody id="doc-tbody"></tbody></table></div></div>';
    renderDoctorTable(docs);
    $('#doc-dept-filter').addEventListener('change', async function (e) { var d = await api('/api/doctors?dept=' + e.target.value); renderDoctorTable(d); });
}
function renderDoctorTable(data) {
    $('#doc-tbody').innerHTML = data.length ? data.map(function (d) { return '<tr><td class="mono" style="color:var(--fg-dim)">D' + String(d.doctor_id).padStart(4, '0') + '</td><td style="font-weight:600">' + d.name + '</td><td>' + d.specialization + '</td><td>' + badge(d.dept_name, 'accent') + '</td><td style="font-size:0.8rem">' + d.location + '</td><td class="mono" style="font-size:0.8rem">' + (d.phone || '--') + '</td><td class="money">' + fmtMoney(d.salary) + '</td><td>' + statusBadge(d.status) + '</td></tr>'; }).join('') : '<tr><td colspan="8" class="empty-state"><p>No doctors found</p></td></tr>';
}
function openDoctorModal() {
    openModal('Add New Doctor', '<div class="form-grid"><div class="form-group"><label>Full Name *</label><input id="f-dname" /></div><div class="form-group"><label>Specialization *</label><input id="f-dspec" /></div><div class="form-group"><label>Department *</label><select id="f-ddept">' + window._depts.map(function (d) { return '<option value="' + d.dept_id + '">' + d.dept_name + '</option>'; }).join('') + '</select></div><div class="form-group"><label>Phone</label><input id="f-dphone" /></div><div class="form-group"><label>Email</label><input id="f-demail" /></div><div class="form-group"><label>Monthly Salary *</label><input id="f-dsalary" type="number" /></div></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveDoctor()">Add Doctor</button></div>');
}
async function saveDoctor() {
    var data = { name: $('#f-dname').value, specialization: $('#f-dspec').value, dept_id: parseInt($('#f-ddept').value), phone: $('#f-dphone').value, email: $('#f-demail').value, salary: parseFloat($('#f-dsalary').value) };
    if (!data.name || !data.specialization || !data.salary) return toast('Name, specialization, salary required', 'error');
    await api('/api/doctors', { method: 'POST', body: data }); toast('Doctor added'); closeModal(); renderDoctors();
}

// ===================== APPOINTMENTS =====================
async function renderAppointments() {
    var appts = await api('/api/appointments');
    $('#page-content').innerHTML = '<div class="toolbar"><select id="appt-status-filter" class="filter-select"><option value="">All Statuses</option><option>Scheduled</option><option>Confirmed</option><option>Completed</option><option>Cancelled</option><option>No-Show</option></select><button class="btn btn-primary" onclick="openBookModal()"><i class="fas fa-plus"></i> Book Appointment</button></div><div class="card"><div class="card-body table-wrap"><table><thead><tr><th>ID</th><th>Patient</th><th>Doctor</th><th>Dept</th><th>Date</th><th>Time</th><th>Duration</th><th>Status</th><th>Symptoms</th><th>Fees</th><th>Actions</th></tr></thead><tbody id="appt-tbody"></tbody></table></div></div>';
    renderApptTable(appts);
    $('#appt-status-filter').addEventListener('change', async function (e) { var d = await api('/api/appointments?status=' + e.target.value); renderApptTable(d); });
}
function renderApptTable(data) {
    $('#appt-tbody').innerHTML = data.length ? data.map(function (a) {
        var actions = '--';
        if (a.status === 'Scheduled') {
            actions = '<button class="btn btn-sm btn-secondary" onclick="changeAppt(' + a.appointment_id + ',\'Completed\')"><i class="fas fa-check"></i></button><button class="btn btn-sm btn-secondary" onclick="changeAppt(' + a.appointment_id + ',\'Cancelled\')"><i class="fas fa-times"></i></button>';
        }
        return '<tr><td class="mono" style="color:var(--fg-dim)">A' + String(a.appointment_id).padStart(4, '0') + '</td><td style="font-weight:500">' + a.patient_name + '</td><td>' + a.doctor_name + '</td><td>' + a.dept_name + '</td><td class="mono" style="font-size:0.8rem">' + a.appointment_date + '</td><td class="mono">' + a.time_slot + '</td><td>' + (a.duration_minutes ? a.duration_minutes + ' min' : '--') + '</td><td>' + statusBadge(a.status) + '</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (a.symptoms || '') + '">' + nullVal(a.symptoms) + '</td><td class="money">' + fmtMoney(a.fees) + '</td><td class="action-cell">' + actions + '</td></tr>';
    }).join('') : '<tr><td colspan="11" class="empty-state"><p>No appointments</p></td></tr>';
}
async function changeAppt(id, st) { await api('/api/appointments/' + id + '/status', { method: 'PUT', body: { status: st } }); toast('Status -> ' + st + ' (trigger fired)'); renderAppointments(); }

async function openBookModal() {
    var pts = await api('/api/patients'); var docs = await api('/api/doctors');
    openModal('Book Appointment',
        '<p style="color:var(--fg-muted);font-size:0.82rem;margin-bottom:16px"><i class="fas fa-magic" style="color:var(--accent)"></i> Wait time auto-predicted via SUBQUERY. Double-booking prevented by TRANSACTION.</p>' +
        '<div class="form-grid"><div class="form-group"><label>Patient *</label><select id="f-apatient">' + pts.map(function (p) { return '<option value="' + p.patient_id + '">' + p.name + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-group"><label>Doctor *</label><select id="f-adoctor" onchange="loadSlots()">' + docs.map(function (d) { return '<option value="' + d.doctor_id + '">' + d.name + ' - ' + d.specialization + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-group"><label>Date *</label><input id="f-adate" type="date" onchange="loadSlots()" /></div>' +
        '<div class="form-group"><label>Time Slot *</label><select id="f-aslot"><option value="">Select date & doctor first</option></select></div>' +
        '<div class="form-group full"><label>Symptoms</label><textarea id="f-asymptoms" placeholder="Describe symptoms..."></textarea></div>' +
        '<div class="form-group"><label>Consultation Fee</label><input id="f-afees" type="number" value="500" /></div></div>' +
        '<div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="bookAppointment()"><i class="fas fa-calendar-plus"></i> Book (Transaction)</button></div>');
    $('#f-adate').value = new Date().toISOString().split('T')[0];
}
async function loadSlots() {
    var docId = $('#f-adoctor').value; var date = $('#f-adate').value;
    if (!docId || !date) return;
    try {
        var slots = await api('/api/doctors/' + docId + '/slots?date=' + date);
        $('#f-aslot').innerHTML = slots.length ? slots.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join('') : '<option value="">No slots available</option>';
    } catch (e) { }
}
async function bookAppointment() {
    var data = { patient_id: parseInt($('#f-apatient').value), doctor_id: parseInt($('#f-adoctor').value), appointment_date: $('#f-adate').value, time_slot: $('#f-aslot').value, symptoms: $('#f-asymptoms').value, fees: parseFloat($('#f-afees').value) || 500 };
    if (!data.appointment_date || !data.time_slot) return toast('Select date and time slot', 'error');
    try { var res = await api('/api/appointments', { method: 'POST', body: data }); toast(res.message); closeModal(); renderAppointments(); } catch (e) { }
}

// ===================== BEDS =====================
async function renderBeds() {
    var beds = await api('/api/beds');
    var wards = {}; beds.forEach(function (b) { if (!wards[b.ward_name]) wards[b.ward_name] = { type: b.bed_type, beds: [] }; wards[b.ward_name].beds.push(b); });
    var total = beds.length; var avail = beds.filter(function (b) { return b.status === 'Available'; }).length;
    var occ = beds.filter(function (b) { return b.status === 'Occupied'; }).length; var maint = beds.filter(function (b) { return b.status === 'Maintenance'; }).length;
    $('#page-content').innerHTML =
        '<div class="stats-grid"><div class="stat-card success"><div class="stat-icon success"><i class="fas fa-check-circle"></i></div><div class="stat-value">' + avail + '</div><div class="stat-label">Available</div></div><div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-user-check"></i></div><div class="stat-value">' + occ + '</div><div class="stat-label">Occupied</div></div><div class="stat-card warning"><div class="stat-icon warning"><i class="fas fa-tools"></i></div><div class="stat-value">' + maint + '</div><div class="stat-label">Maintenance</div></div><div class="stat-card accent"><div class="stat-icon accent"><i class="fas fa-percentage"></i></div><div class="stat-value">' + (total ? Math.round(occ / total * 100) : 0) + '%</div><div class="stat-label">Occupancy Rate</div></div></div>' +
        '<div class="bed-legend"><span><span class="dot avail"></span> Available</span><span><span class="dot occ"></span> Occupied</span><span><span class="dot maint"></span> Maintenance</span></div>' +
        '<div class="bed-grid-container">' + Object.entries(wards).map(function (entry) {
            var name = entry[0]; var w = entry[1];
            return '<div class="ward-section"><h4><i class="fas fa-door-open" style="color:var(--accent)"></i> ' + name + ' <span class="badge badge-gray" style="font-size:0.65rem">' + w.type + '</span></h4><div class="bed-grid">' + w.beds.map(function (b) { return '<div class="bed-cell ' + b.status.toLowerCase() + '" title="' + (b.status === 'Occupied' ? 'Patient: ' + (b.patient_name || '?') : b.status) + '"><div class="bed-num">' + b.bed_number + '</div>' + (b.status === 'Occupied' ? '<i class="fas fa-user" style="font-size:0.65rem"></i>' : b.status === 'Maintenance' ? '<i class="fas fa-wrench" style="font-size:0.65rem"></i>' : '<i class="fas fa-check" style="font-size:0.65rem"></i>') + '</div>'; }).join('') + '</div></div>';
        }).join('') + '</div>';
}

// ===================== BILLING =====================
async function renderBilling() {
    var bills = await api('/api/bills');
    var totalRev = bills.reduce(function (s, b) { return s + b.total_amount; }, 0);
    var totalIns = bills.reduce(function (s, b) { return s + b.insurance_coverage; }, 0);
    var totalPaid = bills.filter(function (b) { return b.status === 'Paid'; }).reduce(function (s, b) { return s + b.patient_payable; }, 0);
    var pending = bills.filter(function (b) { return b.status === 'Pending'; });
    $('#page-content').innerHTML =
        '<div class="stats-grid"><div class="stat-card accent"><div class="stat-icon accent"><i class="fas fa-receipt"></i></div><div class="stat-value">' + fmtMoney(totalRev) + '</div><div class="stat-label">Total Billed</div></div><div class="stat-card info"><div class="stat-icon info"><i class="fas fa-shield-alt"></i></div><div class="stat-value">' + fmtMoney(totalIns) + '</div><div class="stat-label">Insurance Covered</div></div><div class="stat-card success"><div class="stat-icon success"><i class="fas fa-hand-holding-usd"></i></div><div class="stat-value">' + fmtMoney(totalPaid) + '</div><div class="stat-label">Collected</div></div><div class="stat-card danger"><div class="stat-icon danger"><i class="fas fa-clock"></i></div><div class="stat-value">' + pending.length + '</div><div class="stat-label">Pending Bills</div></div></div>' +
        '<div class="toolbar"><button class="btn btn-primary" onclick="openBillModal()"><i class="fas fa-plus"></i> Generate Bill</button></div>' +
        '<div class="card"><div class="card-body table-wrap"><table><thead><tr><th>Bill ID</th><th>Patient</th><th>Consultation</th><th>Medicine</th><th>Tests</th><th>Bed</th><th>Total</th><th>Insurance</th><th>Payable</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
        bills.map(function (b) { return '<tr><td class="mono" style="color:var(--fg-dim)">B' + String(b.bill_id).padStart(4, '0') + '</td><td style="font-weight:500">' + b.patient_name + '</td><td class="money">' + fmtMoney(b.consultation_fees) + '</td><td class="money">' + fmtMoney(b.medicine_charges) + '</td><td class="money">' + fmtMoney(b.test_charges) + '</td><td class="money">' + fmtMoney(b.bed_charges) + '</td><td class="money" style="font-weight:700">' + fmtMoney(b.total_amount) + '</td><td class="money" style="color:var(--info)">' + fmtMoney(b.insurance_coverage) + '</td><td class="money" style="color:var(--warning)">' + fmtMoney(b.patient_payable) + '</td><td>' + statusBadge(b.status) + '</td><td>' + (b.status === 'Pending' ? '<button class="btn btn-sm btn-primary" onclick="payBill(' + b.bill_id + ')"><i class="fas fa-rupee-sign"></i> Pay</button>' : '--') + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>';
}
async function openBillModal() {
    var patients = await api('/api/patients');
    openModal('Generate Bill', '<p style="color:var(--fg-muted);font-size:0.82rem;margin-bottom:16px"><i class="fas fa-shield-alt" style="color:var(--info)"></i> Insurance auto-calculated via SUBQUERY (70% if insured).</p><div class="form-grid"><div class="form-group"><label>Patient *</label><select id="f-bpatient">' + patients.map(function (p) { return '<option value="' + p.patient_id + '">' + p.name + (p.insurance_id ? ' (' + p.insurance_id + ')' : ' (No Insurance)') + '</option>'; }).join('') + '</select></div><div class="form-group"><label>Consultation Fees</label><input id="f-bconsult" type="number" value="0" /></div><div class="form-group"><label>Medicine Charges</label><input id="f-bmed" type="number" value="0" /></div><div class="form-group"><label>Test Charges</label><input id="f-btest" type="number" value="0" /></div><div class="form-group"><label>Bed Charges</label><input id="f-bbed" type="number" value="0" /></div></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="generateBill()"><i class="fas fa-file-invoice"></i> Generate</button></div>');
}
async function generateBill() {
    var data = { patient_id: parseInt($('#f-bpatient').value), consultation_fees: parseFloat($('#f-bconsult').value) || 0, medicine_charges: parseFloat($('#f-bmed').value) || 0, test_charges: parseFloat($('#f-btest').value) || 0, bed_charges: parseFloat($('#f-bbed').value) || 0 };
    await api('/api/bills', { method: 'POST', body: data }); toast('Bill generated'); closeModal(); renderBilling();
}
async function payBill(id) { await api('/api/bills/' + id + '/pay', { method: 'PUT' }); toast('Bill marked as paid'); renderBilling(); }

// ===================== ADMIN PORTAL =====================
var adminTab = 'pending';
async function renderAdmin() {
    if (!adminLoggedIn) {
        $('#page-content').innerHTML = '<div class="login-box"><div class="login-icon"><i class="fas fa-user-shield"></i></div><h2>Admin Login</h2><p>Access doctor management, appointments, and availability</p><div class="form-group"><label>Username</label><input id="login-user" placeholder="Enter username" /></div><div class="form-group"><label>Password</label><input id="login-pass" type="password" placeholder="Enter password" /></div><button class="btn btn-primary" onclick="doAdminLogin()"><i class="fas fa-sign-in-alt"></i> Login</button></div>';
        return;
    }
    $('#page-content').innerHTML = '<div class="admin-tabs"><button class="admin-tab' + (adminTab === 'pending' ? ' active' : '') + '" onclick="switchAdminTab(\'pending\')">Pending Appointments</button><button class="admin-tab' + (adminTab === 'availability' ? ' active' : '') + '" onclick="switchAdminTab(\'availability\')">Doctor Availability</button><button class="admin-tab' + (adminTab === 'manage' ? ' active' : '') + '" onclick="switchAdminTab(\'manage\')">Manage Doctors</button></div><div id="admin-content"></div>';
    if (adminTab === 'pending') renderAdminPending();
    else if (adminTab === 'availability') renderAdminAvailability();
    else renderAdminManage();
}
async function doAdminLogin() {
    try {
        var res = await api('/api/admin/login', { method: 'POST', body: { username: $('#login-user').value, password: $('#login-pass').value } });
        adminLoggedIn = true; toast('Welcome, Admin'); renderAdmin();
    } catch (e) { }
}
function switchAdminTab(tab) { adminTab = tab; renderAdmin(); }

async function renderAdminPending() {
    var appts = await api('/api/pending-appointments');
    $('#admin-content').innerHTML = appts.length ? '<div class="card"><div class="card-body table-wrap"><table><thead><tr><th>ID</th><th>Patient</th><th>Phone</th><th>Doctor</th><th>Dept</th><th>Date</th><th>Time</th><th>Symptoms</th><th>Actions</th></tr></thead><tbody>' + appts.map(function (a) { return '<tr><td class="mono">A' + String(a.appointment_id).padStart(4, '0') + '</td><td style="font-weight:600">' + a.patient_name + '</td><td class="mono" style="font-size:0.8rem">' + a.patient_phone + '</td><td>' + a.doctor_name + '</td><td>' + a.dept_name + '</td><td class="mono">' + a.appointment_date + '</td><td class="mono">' + a.time_slot + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + nullVal(a.symptoms) + '</td><td class="action-cell"><button class="btn btn-sm btn-primary" onclick="adminAccept(' + a.appointment_id + ')"><i class="fas fa-check"></i> Accept</button><button class="btn btn-sm btn-danger" onclick="adminReject(' + a.appointment_id + ')"><i class="fas fa-times"></i></button></td></tr>'; }).join('') + '</tbody></table></div></div>' : '<div class="empty-state"><i class="fas fa-calendar-check"></i><p>No pending appointments</p></div>';
}
async function adminAccept(aid) {
    openModal('Accept Appointment A' + String(aid).padStart(4, '0'), '<div class="form-group"><label>Duration Needed (minutes)</label><input id="f-duration" type="number" value="30" min="10" max="120" step="5" /><p style="color:var(--fg-muted);font-size:0.78rem;margin-top:6px">Set how long this patient will need. This helps manage overlapping slots.</p></div><div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="confirmAccept(' + aid + ')"><i class="fas fa-check"></i> Confirm Appointment</button></div>');
}
async function confirmAccept(aid) {
    var dur = parseInt($('#f-duration').value) || 30;
    await api('/api/appointments/' + aid + '/accept', { method: 'PUT', body: { duration_minutes: dur } });
    toast('Appointment confirmed for ' + dur + ' minutes'); closeModal(); renderAdminPending();
}
async function adminReject(aid) {
    if (!confirm('Reject this appointment?')) return;
    await api('/api/appointments/' + aid + '/status', { method: 'PUT', body: { status: 'Cancelled' } });
    toast('Appointment rejected'); renderAdminPending();
}

async function renderAdminAvailability() {
    var docs = await api('/api/doctors'); var depts = await api('/api/departments');
    var now = new Date();
    var dates = []; var labels = [];
    for (var i = 0; i < 3; i++) { var d = new Date(now.getTime() + i * 86400000); dates.push(d.toISOString().split('T')[0]); labels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })); }

    var html = '<div class="toolbar"><button class="btn btn-primary" onclick="openSetAvailability()"><i class="fas fa-clock"></i> Set Availability</button></div>';
    html += '<div class="card"><div class="card-body table-wrap"><table><thead><tr><th>Doctor</th><th>Dept</th>';
    labels.forEach(function (l) { html += '<th>' + l + '</th>'; });
    html += '</tr></thead><tbody>';

    docs.forEach(function (doc) {
        html += '<tr><td style="font-weight:600">' + doc.name + '</td><td>' + badge(doc.dept_name, 'accent') + '</td>';
        dates.forEach(function (dt, di) {
            var av = doc._avail ? doc._avail[dt] : null;
            if (av && !av.is_available) {
                html += '<td>' + badge('On Leave', 'red') + '<br><span style="font-size:0.7rem;color:var(--fg-dim)">' + (av.notes || '') + '</span></td>';
            } else if (av) {
                html += '<td>' + badge(av.start_time + '-' + av.end_time, 'green') + (av.notes ? '<br><span style="font-size:0.7rem;color:var(--fg-dim)">' + av.notes + '</span>' : '') + '</td>';
            } else {
                html += '<td>' + badge('09:00-17:00', 'gray') + '<br><span style="font-size:0.7rem;color:var(--fg-dim)">Default</span></td>';
            }
        });
        html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    // Fetch all availability to enrich
    try {
        var allAv = await api('/api/availability');
        var avMap = {};
        allAv.forEach(function (a) { avMap[a.doctor_id + '_' + a.avail_date] = a; });
        docs.forEach(function (doc) {
            doc._avail = {};
            dates.forEach(function (dt) { doc._avail[dt] = avMap[doc.doctor_id + '_' + dt] || null; });
        });
        // Re-render table
        html = '<div class="toolbar"><button class="btn btn-primary" onclick="openSetAvailability()"><i class="fas fa-clock"></i> Set Availability</button></div>';
        html += '<div class="card"><div class="card-body table-wrap"><table><thead><tr><th>Doctor</th><th>Dept</th>';
        labels.forEach(function (l) { html += '<th>' + l + '</th>'; });
        html += '</tr></thead><tbody>';
        docs.forEach(function (doc) {
            html += '<tr><td style="font-weight:600">' + doc.name + '</td><td>' + badge(doc.dept_name, 'accent') + '</td>';
            dates.forEach(function (dt) {
                var av = doc._avail[dt];
                if (av && !av.is_available) {
                    html += '<td><div style="display:flex;align-items:center;gap:6px">' + badge('Leave', 'red') + '<button class="btn btn-sm btn-danger" onclick="deleteAvail(' + av.avail_id + ')" title="Remove"><i class="fas fa-trash"></i></button></div><span style="font-size:0.7rem;color:var(--fg-dim)">' + (av.notes || '') + '</span></td>';
                } else if (av) {
                    html += '<td><div style="display:flex;align-items:center;gap:6px">' + badge(av.start_time + '-' + av.end_time, 'green') + '<button class="btn btn-sm btn-danger" onclick="deleteAvail(' + av.avail_id + ')" title="Remove"><i class="fas fa-trash"></i></button></div>' + (av.notes ? '<span style="font-size:0.7rem;color:var(--fg-dim)">' + av.notes + '</span>' : '') + '</td>';
                } else {
                    html += '<td>' + badge('Default', 'gray') + '</td>';
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table></div></div>';
    } catch (e) { }

    $('#admin-content').innerHTML = html;
}
async function deleteAvail(availId) {
    if (!confirm('Remove this availability entry?')) return;
    await api('/api/availability', { method: 'DELETE', body: { avail_id: availId } });
    toast('Availability removed'); renderAdminAvailability();
}
async function openSetAvailability() {
    var docs = await api('/api/doctors');
    var now = new Date();
    var dates = []; var labels = [];
    for (var i = 0; i < 3; i++) { var d = new Date(now.getTime() + i * 86400000); dates.push(d.toISOString().split('T')[0]); labels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })); }

    var html = '<p style="color:var(--fg-muted);font-size:0.82rem;margin-bottom:16px">Set availability for the next 3 days. Use "On Leave" to block all slots, or set custom hours.</p>';
    html += '<div class="form-group"><label>Doctor *</label><select id="f-avdoc">' + docs.map(function (d) { return '<option value="' + d.doctor_id + '">' + d.name + '</option>'; }).join('') + '</select></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin:16px 0">';
    for (var i = 0; i < 3; i++) {
        html += '<div style="background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px"><label style="font-size:0.78rem;font-weight:600;color:var(--fg-muted);text-transform:uppercase;display:block;margin-bottom:10px">' + labels[i] + '</label>';
        html += '<div class="form-group" style="margin-bottom:8px"><label style="font-size:0.7rem">Available?</label><select id="f-av-avail-' + i + '"><option value="1">Yes - Working</option><option value="0">No - On Leave</option></select></div>';
        html += '<div class="form-group" style="margin-bottom:8px"><label style="font-size:0.7rem">Start Time</label><input id="f-av-st-' + i + '" type="time" value="09:00" /></div>';
        html += '<div class="form-group" style="margin-bottom:8px"><label style="font-size:0.7rem">End Time</label><input id="f-av-en-' + i + '" type="time" value="17:00" /></div>';
        html += '<div class="form-group"><label style="font-size:0.7rem">Notes</label><input id="f-av-notes-' + i + '" placeholder="e.g. Half day, surgery..." /></div></div>';
    }
    html += '</div>';
    html += '<div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveAvailability()"><i class="fas fa-save"></i> Save All 3 Days</button></div>';
    openModal('Set Doctor Availability', html);
}
async function saveAvailability() {
    var docId = parseInt($('#f-avdoc').value);
    var now = new Date(); var records = [];
    for (var i = 0; i < 3; i++) {
        var d = new Date(now.getTime() + i * 86400000);
        records.push({
            doctor_id: docId, avail_date: d.toISOString().split('T')[0],
            start_time: $('#f-av-st-' + i).value || '09:00',
            end_time: $('#f-av-en-' + i).value || '17:00',
            is_available: parseInt($('#f-av-avail-' + i).value),
            notes: $('#f-av-notes-' + i).value || ''
        });
    }
    await api('/api/availability', { method: 'POST', body: records });
    toast('Availability saved for 3 days'); closeModal(); renderAdminAvailability();
}

async function renderAdminManage() {
    var docs = await api('/api/doctors'); var depts = await api('/api/departments');
    var html = '<div class="toolbar"><button class="btn btn-primary" onclick="openDoctorModal()"><i class="fas fa-plus"></i> Add Doctor</button></div>';
    html += '<div class="card"><div class="card-body table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Specialization</th><th>Department</th><th>Phone</th><th>Salary</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    docs.forEach(function (d) {
        html += '<tr><td class="mono">D' + String(d.doctor_id).padStart(4, '0') + '</td><td style="font-weight:600">' + d.name + '</td><td>' + d.specialization + '</td><td>' + badge(d.dept_name, 'accent') + '</td><td class="mono" style="font-size:0.8rem">' + (d.phone || '--') + '</td><td class="money">' + fmtMoney(d.salary) + '</td><td>' + statusBadge(d.status) + '</td><td class="action-cell"><button class="btn btn-sm btn-secondary" onclick="toggleDocStatus(' + d.doctor_id + ',\'' + d.status + '\')"><i class="fas fa-exchange-alt"></i> Toggle</button></td></tr>';
    });
    html += '</tbody></table></div></div>';
    $('#admin-content').innerHTML = html;
}
async function toggleDocStatus(id, cur) {
    var next = cur === 'Active' ? 'Inactive' : 'Active';
    if (!confirm('Set doctor to ' + next + '?')) return;
    await api('/api/doctors/' + id, { method: 'PUT', body: { status: next } });
    toast('Doctor status -> ' + next); renderAdminManage();
}

// ===================== USER PORTAL =====================
async function renderUserPortal() {
    var depts = await api('/api/departments');
    var steps = ['Select Department', 'Choose Doctor', 'Pick Date & Slot', 'Your Details', 'Confirm'];
    var stepsHtml = '<div class="user-steps">';
    steps.forEach(function (s, i) {
        var cls = i < userStep ? 'done' : i === userStep ? 'active' : '';
        stepsHtml += '<div class="user-step ' + cls + '"><span class="step-num">' + (i + 1) + '</span>' + s + '</div>';
    });
    stepsHtml += '</div>';

    var bodyHtml = '<div id="user-step-content"></div>';
    $('#page-content').innerHTML = stepsHtml + bodyHtml;
    renderUserStep();
}
async function renderUserStep() {
    var el = $('#user-step-content');
    if (userStep === 0) {
        var depts = await api('/api/departments');
        el.innerHTML = '<h3 style="margin-bottom:16px">Select a Department</h3><div class="dept-cards">' + depts.map(function (d) { return '<div class="dept-card' + (userState.dept === d.dept_id ? ' selected' : '') + '" onclick="userSelectDept(' + d.dept_id + ')"><i class="fas fa-hospital"></i><h4>' + d.dept_name + '</h4><span>' + d.location + '</span></div>'; }).join('') + '</div>';
    } else if (userStep === 1) {
        var docs = await api('/api/user/doctors?dept=' + userState.dept);
        el.innerHTML = '<h3 style="margin-bottom:16px">Choose a Doctor</h3>' + (docs.length ? docs.map(function (d) {
            var avHtml = '<div class="avail-badges">';
            d.availability.forEach(function (a) {
                if (!a.is_available) avHtml += badge(a.label + ': Leave', 'red');
                else if (a.start_time !== '09:00' || a.end_time !== '17:00') avHtml += badge(a.label + ': ' + a.start_time + '-' + a.end_time, 'yellow');
                else avHtml += badge(a.label + ': Available', 'green');
            });
            avHtml += '</div>';
            return '<div class="doc-card' + (userState.doctor && userState.doctor.doctor_id === d.doctor_id ? ' selected' : '') + '" onclick="userSelectDoctor(' + d.doctor_id + ')" style="margin-bottom:12px"><h4>' + d.name + '</h4><span>' + d.specialization + ' \u2022 ' + d.dept_name + '</span>' + avHtml + '</div>';
        }).join('') : '<div class="empty-state"><p>No active doctors in this department</p></div>');
    } else if (userStep === 2) {
        if (!userState.doctor) { userStep = 1; renderUserStep(); return; }
        var doc = userState.doctor;
        var availDays = doc.availability.filter(function (a) { return a.is_available; });
        el.innerHTML = '<h3 style="margin-bottom:8px">Pick Date & Time Slot</h3><p style="color:var(--fg-muted);font-size:0.85rem;margin-bottom:20px">Doctor: <strong>' + doc.name + '</strong></p>';
        if (!availDays.length) { el.innerHTML += '<div class="empty-state"><i class="fas fa-calendar-times"></i><p>Doctor is on leave for all 3 days</p></div>'; return; }
        availDays.forEach(function (a) {
            var sel = userState.date === a.date ? ' style="border-color:var(--accent);background:var(--accent-glow)"' : '';
            el.innerHTML += '<div class="card" style="margin-bottom:16px"' + sel + '><div class="card-header"><h3>' + a.label + ' (' + a.date + ')</h3><span>' + badge(a.start_time + ' - ' + a.end_time, 'green') + '</span></div><div class="card-body"><div class="slot-grid" id="slots-' + a.date.replace(/-/g, '') + '"></div></div></div>';
        });
        // Load slots for each available day
        for (var i = 0; i < availDays.length; i++) {
            (function (a) {
                api('/api/doctors/' + doc.doctor_id + '/slots?date=' + a.date).then(function (slots) {
                    var container = $('#slots-' + a.date.replace(/-/g, ''));
                    if (!container) return;
                    if (!slots.length) { container.innerHTML = '<p style="color:var(--fg-dim);grid-column:1/-1">All slots booked</p>'; return; }
                    container.innerHTML = slots.map(function (s) {
                        var cls = userState.slot === s && userState.date === a.date ? ' selected' : '';
                        return '<div class="slot-btn' + cls + '" onclick="userSelectSlot(\'' + a.date + '\',\'' + s + '\')">' + s + '</div>';
                    }).join('');
                }).catch(function () { });
            })(availDays[i]);
        }
    } else if (userStep === 3) {
        el.innerHTML = '<h3 style="margin-bottom:16px">Your Details</h3><div class="form-grid"><div class="form-group"><label>Full Name *</label><input id="f-uname" placeholder="Your name" /></div><div class="form-group"><label>Age *</label><input id="f-uage" type="number" placeholder="Age" /></div><div class="form-group"><label>Gender *</label><select id="f-ugender"><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></div><div class="form-group"><label>Phone *</label><input id="f-uphone" placeholder="Phone number" /></div><div class="form-group full"><label>Symptoms (optional)</label><textarea id="f-usymptoms" placeholder="Describe your symptoms..."></textarea></div></div><div style="margin-top:16px;display:flex;gap:10px"><button class="btn btn-secondary" onclick="userStep=2;renderUserStep()"><i class="fas fa-arrow-left"></i> Back</button><button class="btn btn-primary" onclick="userConfirm()"><i class="fas fa-arrow-right"></i> Review Booking</button></div>';
    } else if (userStep === 4) {
        el.innerHTML = '<div class="card" style="max-width:500px;margin:0 auto"><div class="card-body" style="text-align:center"><div style="font-size:3rem;color:var(--accent);margin-bottom:16px"><i class="fas fa-calendar-check"></i></div><h3 style="margin-bottom:20px">Confirm Your Booking</h3><div style="text-align:left;font-size:0.9rem;line-height:2"><strong>Doctor:</strong> ' + userState.doctor.name + '<br><strong>Specialization:</strong> ' + userState.doctor.specialization + '<br><strong>Date:</strong> ' + userState.date + '<br><strong>Time:</strong> ' + userState.slot + '<br><strong>Name:</strong> ' + $('#f-uname').value + '<br><strong>Phone:</strong> ' + $('#f-uphone').value + '<br><strong>Symptoms:</strong> ' + ($('#f-usymptoms').value || 'None') + '</div><div style="margin-top:20px;display:flex;gap:10px;justify-content:center"><button class="btn btn-secondary" onclick="userStep=3;renderUserStep()"><i class="fas fa-arrow-left"></i> Back</button><button class="btn btn-primary" onclick="userFinalBook()"><i class="fas fa-check"></i> Confirm Booking</button></div></div></div>';
    }
}
function userSelectDept(id) { userState.dept = id; userState.doctor = null; userState.date = ''; userState.slot = ''; userStep = 1; renderUserPortal(); }
async function userSelectDoctor(id) {
    var docs = await api('/api/user/doctors?dept=' + userState.dept);
    userState.doctor = docs.find(function (d) { return d.doctor_id === id; });
    userState.date = ''; userState.slot = ''; userStep = 2; renderUserPortal();
}
function userSelectSlot(date, slot) { userState.date = date; userState.slot = slot; userStep = 3; renderUserPortal(); }
function userConfirm() {
    if (!$('#f-uname').value || !$('#f-uage').value || !$('#f-uphone').value) return toast('Name, age, and phone are required', 'error');
    userStep = 4; renderUserPortal();
}
async function userFinalBook() {
    var data = { name: $('#f-uname').value, age: parseInt($('#f-uage').value), gender: $('#f-ugender').value, phone: $('#f-uphone').value, doctor_id: userState.doctor.doctor_id, appointment_date: userState.date, time_slot: userState.slot, symptoms: $('#f-usymptoms').value || '' };
    try {
        var res = await api('/api/user/book', { method: 'POST', body: data });
        toast(res.message);
        userStep = 0; userState = { dept: 0, doctor: null, date: '', slot: '' };
        renderUserPortal();
    } catch (e) { }
}

// ===================== DBMS EXPLORER =====================
var dbmsTabs = [
    { id: 'joins', label: 'JOINs', endpoint: '/api/dbms/joins' },
    { id: 'aggregation', label: 'Aggregation', endpoint: '/api/dbms/aggregation' },
    { id: 'subqueries', label: 'Subqueries', endpoint: '/api/dbms/subqueries' },
    { id: 'views', label: 'Views', endpoint: '/api/dbms/views' },
    { id: 'triggers', label: 'Triggers', endpoint: '/api/dbms/triggers' },
    { id: 'transactions', label: 'Transactions', endpoint: '/api/dbms/transactions' },
    { id: 'indexes', label: 'Indexes', endpoint: '/api/dbms/indexes' },
    { id: 'constraints', label: 'Constraints', endpoint: '/api/dbms/constraints' },
    { id: 'uploads', label: 'Uploads & ER Diagram', endpoint: null }
];
var activeDbmsTab = 'joins';
var dbmsCache = {};

async function renderDBMSExplorer() {
    $('#page-content').innerHTML = '<div class="dbms-tabs">' + dbmsTabs.map(function (t) { return '<button class="dbms-tab' + (t.id === activeDbmsTab ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>'; }).join('') + '</div><div id="dbms-content"></div>';
    $$('.dbms-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            activeDbmsTab = tab.dataset.tab;
            $$('.dbms-tab').forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            renderDbmsTab();
        });
    });
    await renderDbmsTab();
}

async function renderDbmsTab() {
    var container = $('#dbms-content');

    if (activeDbmsTab === 'uploads') {
        renderUploadsTab(container);
        return;
    }

    var tab = dbmsTabs.find(function (t) { return t.id === activeDbmsTab; });
    if (!dbmsCache[activeDbmsTab]) dbmsCache[activeDbmsTab] = await api(tab.endpoint);
    var data = dbmsCache[activeDbmsTab];

    var html = '<div class="dbms-explanation">' + data.explanation + '</div>';

    if (activeDbmsTab === 'joins') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">INNER JOIN - Doctors with completed appointments</h4>';
        html += makeTable(data.inner_join, ['doctor', 'dept_name', 'completed_appts']);
        html += '<h4 style="margin:20px 0 12px;color:var(--info)">LEFT JOIN - All doctors including 0 appointments</h4>';
        html += makeTable(data.left_join, ['doctor', 'dept_name', 'total_appts']);
    } else if (activeDbmsTab === 'aggregation') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">GROUP BY + CASE + HAVING</h4>';
        html += makeTable(data.grouped, ['dept_name', 'doctors', 'appointments', 'revenue', 'avg_wait', 'cancellations'], { revenue: function (v) { return fmtMoney(v); }, avg_wait: function (v) { return v ? v + ' min' : '--'; } });
        html += '<h4 style="margin:20px 0 12px;color:var(--info)">Subquery with Aggregation - Salary vs Average</h4>';
        html += makeTable(data.subquery_agg, ['name', 'salary', 'avg_salary', 'diff_from_avg'], { salary: function (v) { return fmtMoney(v); }, avg_salary: function (v) { return fmtMoney(v); }, diff_from_avg: function (v) { return '<span class="money ' + (v >= 0 ? 'positive' : 'negative') + '">' + (v >= 0 ? '+' : '') + fmtMoney(v) + '</span>'; } });
    } else if (activeDbmsTab === 'subqueries') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">Non-Correlated - Above average salary</h4>';
        html += makeTable(data.above_avg_salary, ['name', 'specialization', 'salary'], { salary: function (v) { return fmtMoney(v); } });
        html += '<h4 style="margin:20px 0 12px;color:var(--info)">Nested - Above average appointments</h4>';
        html += makeTable(data.above_dept_avg_appts, ['name', 'dept_name', 'appt_count']);
        html += '<h4 style="margin:20px 0 12px;color:var(--warning)">EXISTS - Patients with bills</h4>';
        html += makeTable(data.patients_with_bills, ['name', 'phone']);
    } else if (activeDbmsTab === 'views') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">v_doctor_dept</h4>';
        html += makeTable(data.v_doctor_dept, ['name', 'specialization', 'status', 'dept_name', 'location']);
        html += '<h4 style="margin:20px 0 12px;color:var(--info)">v_appointment_details</h4>';
        html += makeTable(data.v_appointment_details, ['patient_name', 'doctor_name', 'dept_name', 'appointment_date', 'time_slot', 'status']);
        html += '<h4 style="margin:20px 0 12px;color:var(--warning)">v_dept_stats</h4>';
        html += makeTable(data.v_dept_stats, ['dept_name', 'doctor_count', 'total_appointments', 'revenue', 'avg_wait'], { revenue: function (v) { return fmtMoney(v); } });
        html += '<h4 style="margin:20px 0 12px;color:var(--fg-muted)">View Definitions</h4>';
        data.view_definitions.forEach(function (def) { html += '<div class="sql-block">' + highlightSQL(def) + '</div>'; });
    } else if (activeDbmsTab === 'triggers') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">Audit Log (auto-generated by triggers)</h4>';
        html += makeTable(data.audit_log, ['log_id', 'table_name', 'record_id', 'action', 'old_value', 'new_value', 'timestamp']);
        html += '<h4 style="margin:20px 0 12px;color:var(--fg-muted)">Trigger Definitions</h4>';
        data.trigger_definitions.forEach(function (def) { html += '<div class="sql-block">' + highlightSQL(def) + '</div>'; });
    } else if (activeDbmsTab === 'transactions') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">Scheduled Appointments (conflict candidates)</h4>';
        if (data.scheduled_before.length) {
            html += makeTable(data.scheduled_before, ['appointment_id', 'doctor_id', 'appointment_date', 'time_slot', 'status']);
            if (data.conflict_test) {
                var ct = data.conflict_test;
                html += '<div class="dbms-explanation" style="margin-top:16px;background:var(--danger-glow);border-color:rgba(255,71,87,0.2)"><strong>Conflict Test:</strong> Booking Doctor D' + String(ct.doctor_id).padStart(4, '0') + ' on ' + ct.appointment_date + ' at ' + ct.time_slot + ' will ROLLBACK. Try from Appointments page!</div>';
            }
        } else { html += '<p style="color:var(--fg-dim)">No scheduled appointments.</p>'; }
        html += '<div class="sql-block"><span class="cmt">-- Transaction pattern used in booking:</span>\n<span class="kw">BEGIN TRANSACTION</span>;\n  <span class="cmt">-- Check for conflicts</span>\n  <span class="kw">SELECT</span> <span class="fn">COUNT</span>(*) <span class="kw">FROM</span> appointments\n  <span class="kw">WHERE</span> doctor_id=? <span class="kw">AND</span> appointment_date=? <span class="kw">AND</span> time_slot=?;\n  <span class="cmt">-- If count > 0: ROLLBACK</span>\n  <span class="cmt">-- Else: INSERT</span>\n  <span class="kw">INSERT INTO</span> appointments (...) <span class="kw">VALUES</span> (...);\n<span class="kw">COMMIT</span>;</div>';
    } else if (activeDbmsTab === 'indexes') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">Indexes</h4>';
        html += makeTable(data.indexes, ['name', 'tbl_name'], {}, true);
        html += '<h4 style="margin:20px 0 12px;color:var(--info)">Query Execution Plan</h4>';
        html += makeTable(data.query_plan, ['id', 'parent', 'notused', 'detail']);
        html += '<div class="sql-block"><span class="cmt">-- Without index: full table scan O(n)</span>\n<span class="cmt">-- With index: B-Tree lookup O(log n)</span>\n<span class="kw">CREATE INDEX</span> idx_appt_date <span class="kw">ON</span> appointments(appointment_date);</div>';
    } else if (activeDbmsTab === 'constraints') {
        html += '<h4 style="margin-bottom:12px;color:var(--accent)">FK: doctors -> departments (RESTRICT)</h4>';
        html += makeTable(data.fk_doctors, ['id', 'table', 'from', 'to', 'on_update', 'on_delete']);
        html += '<h4 style="margin:20px 0 12px;color:var(--info)">FK: appointments (CASCADE + RESTRICT)</h4>';
        html += makeTable(data.fk_appts, ['id', 'table', 'from', 'to', 'on_update', 'on_delete']);
        html += '<h4 style="margin:20px 0 12px;color:var(--warning)">FK: beds -> patients (SET NULL)</h4>';
        html += makeTable(data.fk_beds, ['id', 'table', 'from', 'to', 'on_update', 'on_delete']);
        html += '<h4 style="margin:20px 0 12px;color:var(--fg-muted)">UNIQUE on patients</h4>';
        html += makeTable(data.patient_indexes, ['seq', 'name', 'unique', 'origin'], { unique: function (v) { return v ? badge('YES', 'green') : badge('NO', 'gray'); } });
    }

    container.innerHTML = html;
}

async function renderUploadsTab(container) {
    var uploads = await api('/api/dbms/uploads');
    var html = '<div class="upload-zone" id="upload-zone"><i class="fas fa-cloud-upload-alt"></i><p>Click or drag files here to upload</p><p style="font-size:0.75rem;color:var(--fg-dim);margin-top:8px">Supports images (PNG, JPG, SVG, WebP) and documents (PDF, DOC, PPT, XLS)</p><input type="file" id="upload-file-input" style="display:none" accept=".png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.svg,.webp" /></div>';
    if (uploads.length) {
        html += '<h4 style="margin-bottom:14px">Uploaded Files</h4><div class="upload-list">';
        uploads.forEach(function (u) {
            var isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].indexOf(u.file_type) >= 0;
            html += '<div class="upload-card">';
            if (isImage) html += '<img src="/uploads/' + u.filename + '" alt="' + u.original_name + '" />';
            else html += '<div style="height:180px;display:flex;align-items:center;justify-content:center;background:var(--bg-input);border-bottom:1px solid var(--border)"><i class="fas fa-file-alt" style="font-size:2.5rem;color:var(--fg-dim)"></i></div>';
            html += '<div class="upload-info"><div><div class="upload-name" title="' + u.original_name + '">' + u.original_name + '</div><div class="upload-date">' + u.uploaded_at + '</div></div><button class="btn btn-sm btn-danger" onclick="deleteUpload(' + u.upload_id + ',\'' + u.filename + '\')"><i class="fas fa-trash"></i></button></div></div>';
        });
        html += '</div>';
    }
    container.innerHTML = html;

    var zone = $('#upload-zone');
    var fileInput = $('#upload-file-input');
    zone.addEventListener('click', function () { fileInput.click(); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; zone.style.background = 'var(--accent-glow)'; });
    zone.addEventListener('dragleave', function () { zone.style.borderColor = ''; zone.style.background = ''; });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.style.borderColor = ''; zone.style.background = ''; if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', function () { if (fileInput.files.length) handleUpload(fileInput.files[0]); });
}
async function handleUpload(file) {
    var formData = new FormData();
    formData.append('file', file);
    try {
        var res = await fetch(API + '/api/dbms/uploads', { method: 'POST', body: formData });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        toast('File uploaded successfully');
        dbmsCache['uploads'] = null;
        renderDbmsTab();
    } catch (e) { toast(e.message, 'error'); }
}
async function deleteUpload(id, filename) {
    if (!confirm('Delete this file?')) return;
    await api('/api/dbms/uploads', { method: 'DELETE', body: { upload_id: id, filename: filename } });
    toast('File deleted');
    dbmsCache['uploads'] = null;
    renderDbmsTab();
}

// ===================== INIT =====================
renderPage('dashboard');

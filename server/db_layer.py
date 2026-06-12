import sqlite3
from datetime import datetime, timedelta
import random
import os

DB_PATH = "hospital.db"
UPLOAD_DIR = "uploads"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    conn = get_connection()
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS departments (
        dept_id INTEGER PRIMARY KEY AUTOINCREMENT, dept_name TEXT NOT NULL UNIQUE,
        location TEXT NOT NULL, capacity INTEGER DEFAULT 50)""")

    c.execute("""CREATE TABLE IF NOT EXISTS doctors (
        doctor_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        specialization TEXT NOT NULL, dept_id INTEGER NOT NULL, phone TEXT UNIQUE,
        email TEXT UNIQUE, hire_date TEXT NOT NULL, salary REAL NOT NULL,
        status TEXT DEFAULT 'Active',
        FOREIGN KEY (dept_id) REFERENCES departments(dept_id) ON DELETE RESTRICT)""")

    c.execute("""CREATE TABLE IF NOT EXISTS patients (
        patient_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        age INTEGER NOT NULL, gender TEXT NOT NULL, phone TEXT NOT NULL,
        email TEXT, blood_group TEXT, address TEXT, registration_date TEXT NOT NULL,
        insurance_id TEXT, insurance_provider TEXT, status TEXT DEFAULT 'Active')""")

    c.execute("""CREATE TABLE IF NOT EXISTS beds (
        bed_id INTEGER PRIMARY KEY AUTOINCREMENT, ward_name TEXT NOT NULL,
        bed_number TEXT NOT NULL UNIQUE, bed_type TEXT NOT NULL,
        status TEXT DEFAULT 'Available', patient_id INTEGER, admitted_date TEXT,
        hourly_rate REAL DEFAULT 0,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE SET NULL)""")

    c.execute("""CREATE TABLE IF NOT EXISTS appointments (
        appointment_id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL, appointment_date TEXT NOT NULL, time_slot TEXT NOT NULL,
        status TEXT DEFAULT 'Scheduled', symptoms TEXT, diagnosis TEXT, prescription TEXT,
        fees REAL DEFAULT 0, wait_time_minutes INTEGER DEFAULT 0,
        duration_minutes INTEGER DEFAULT 30, created_at TEXT NOT NULL,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
        FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id) ON DELETE RESTRICT)""")

    c.execute("""CREATE TABLE IF NOT EXISTS bills (
        bill_id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL,
        appointment_id INTEGER, bed_charges REAL DEFAULT 0, consultation_fees REAL DEFAULT 0,
        medicine_charges REAL DEFAULT 0, test_charges REAL DEFAULT 0, total_amount REAL DEFAULT 0,
        insurance_coverage REAL DEFAULT 0, patient_payable REAL DEFAULT 0,
        bill_date TEXT NOT NULL, status TEXT DEFAULT 'Pending',
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
        FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id))""")

    c.execute("""CREATE TABLE IF NOT EXISTS audit_log (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL,
        record_id INTEGER NOT NULL, action TEXT NOT NULL, old_value TEXT,
        new_value TEXT, timestamp TEXT NOT NULL, performed_by TEXT DEFAULT 'System')""")

    c.execute("""CREATE TABLE IF NOT EXISTS doctor_availability (
        avail_id INTEGER PRIMARY KEY AUTOINCREMENT, doctor_id INTEGER NOT NULL,
        avail_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '09:00',
        end_time TEXT NOT NULL DEFAULT '17:00', is_available INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        FOREIGN KEY (doctor_id) REFERENCES doctors(doctor_id) ON DELETE CASCADE,
        UNIQUE(doctor_id, avail_date))""")

    c.execute("""CREATE TABLE IF NOT EXISTS dbms_uploads (
        upload_id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL,
        original_name TEXT NOT NULL, file_type TEXT, uploaded_at TEXT NOT NULL)""")

    for idx in ["idx_doctor_dept ON doctors(dept_id)", "idx_patient_name ON patients(name)",
                "idx_patient_phone ON patients(phone)", "idx_appt_date ON appointments(appointment_date)",
                "idx_appt_status ON appointments(status)", "idx_appt_doctor ON appointments(doctor_id)",
                "idx_bed_status ON beds(status)", "idx_bill_patient ON bills(patient_id)",
                "idx_audit_table ON audit_log(table_name)", "idx_avail_doc ON doctor_availability(doctor_id,avail_date)"]:
        c.execute("CREATE INDEX IF NOT EXISTS " + idx)

    c.execute("DROP VIEW IF EXISTS v_doctor_dept")
    c.execute("""CREATE VIEW v_doctor_dept AS
        SELECT d.doctor_id, d.name, d.specialization, d.status,
               dp.dept_name, dp.location, d.salary
        FROM doctors d INNER JOIN departments dp ON d.dept_id = dp.dept_id""")

    c.execute("DROP VIEW IF EXISTS v_appointment_details")
    c.execute("""CREATE VIEW v_appointment_details AS
        SELECT a.appointment_id, p.name AS patient_name, p.phone AS patient_phone,
               d.name AS doctor_name, dp.dept_name, a.appointment_date, a.time_slot,
               a.status, a.fees, a.symptoms, a.diagnosis, a.duration_minutes
        FROM appointments a
        INNER JOIN patients p ON a.patient_id = p.patient_id
        INNER JOIN doctors d ON a.doctor_id = d.doctor_id
        INNER JOIN departments dp ON d.dept_id = dp.dept_id""")

    c.execute("DROP VIEW IF EXISTS v_bed_occupancy")
    c.execute("""CREATE VIEW v_bed_occupancy AS
        SELECT b.bed_id, b.ward_name, b.bed_number, b.bed_type, b.status,
               b.hourly_rate, p.name AS patient_name, b.admitted_date
        FROM beds b LEFT JOIN patients p ON b.patient_id = p.patient_id""")

    c.execute("DROP VIEW IF EXISTS v_dept_stats")
    c.execute("""CREATE VIEW v_dept_stats AS
        SELECT dp.dept_id, dp.dept_name, dp.location,
               COUNT(DISTINCT d.doctor_id) AS doctor_count,
               COUNT(DISTINCT a.appointment_id) AS total_appointments,
               SUM(CASE WHEN a.status='Completed' THEN a.fees ELSE 0 END) AS revenue,
               ROUND(AVG(CASE WHEN a.status='Completed' THEN a.wait_time_minutes END),1) AS avg_wait
        FROM departments dp
        LEFT JOIN doctors d ON dp.dept_id = d.dept_id
        LEFT JOIN appointments a ON d.doctor_id = a.doctor_id
        GROUP BY dp.dept_id""")

    c.execute("DROP TRIGGER IF EXISTS trg_appt_status")
    c.execute("""CREATE TRIGGER trg_appt_status
        AFTER UPDATE OF status ON appointments FOR EACH ROW
        BEGIN
            INSERT INTO audit_log (table_name,record_id,action,old_value,new_value,timestamp)
            VALUES ('appointments',NEW.appointment_id,'STATUS_CHANGE',OLD.status,NEW.status,datetime('now'));
        END""")

    c.execute("DROP TRIGGER IF EXISTS trg_patient_delete")
    c.execute("""CREATE TRIGGER trg_patient_delete
        AFTER DELETE ON patients FOR EACH ROW
        BEGIN
            INSERT INTO audit_log (table_name,record_id,action,old_value,new_value,timestamp)
            VALUES ('patients',OLD.patient_id,'DELETE',
                    OLD.name||' (ID:'||CAST(OLD.patient_id AS TEXT)||')',NULL,datetime('now'));
        END""")

    c.execute("DROP TRIGGER IF EXISTS trg_bed_assign")
    c.execute("""CREATE TRIGGER trg_bed_assign
        AFTER UPDATE OF status ON beds FOR EACH ROW
        WHEN NEW.status='Occupied' AND OLD.status!='Occupied'
        BEGIN
            INSERT INTO audit_log (table_name,record_id,action,old_value,new_value,timestamp)
            VALUES ('beds',NEW.bed_id,'BED_ASSIGNED',OLD.status,
                    'Patient ID:'||COALESCE(CAST(NEW.patient_id AS TEXT),'?'),datetime('now'));
        END""")

    conn.commit()
    c.execute("SELECT COUNT(*) FROM departments")
    if c.fetchone()[0] == 0:
        _seed(conn)
    conn.close()


def _seed(conn):
    c = conn.cursor()
    now = datetime.now()
    c.executemany("INSERT INTO departments (dept_name,location,capacity) VALUES (?,?,?)", [
        ("Cardiology","Floor 3, Wing A",30),("Neurology","Floor 4, Wing B",25),
        ("Orthopedics","Floor 2, Wing A",35),("Pediatrics","Floor 1, Wing C",40),
        ("Oncology","Floor 5, Wing A",20),("Emergency","Ground Floor",50),
        ("Dermatology","Floor 2, Wing B",15),("ENT","Floor 3, Wing B",15)])
    c.executemany("INSERT INTO doctors (name,specialization,dept_id,phone,email,hire_date,salary) VALUES (?,?,?,?,?,?,?)",[
        ("Dr. Rajesh Kumar","Cardiologist",1,"9876543210","rajesh.k@hosp.com","2020-01-15",150000),
        ("Dr. Priya Sharma","Neurologist",2,"9876543211","priya.s@hosp.com","2019-06-20",160000),
        ("Dr. Arun Mehta","Orthopedic Surgeon",3,"9876543212","arun.m@hosp.com","2018-03-10",140000),
        ("Dr. Sneha Patel","Pediatrician",4,"9876543213","sneha.p@hosp.com","2021-02-01",120000),
        ("Dr. Vikram Singh","Oncologist",5,"9876543214","vikram.s@hosp.com","2017-09-15",180000),
        ("Dr. Anita Desai","Emergency Medicine",6,"9876543215","anita.d@hosp.com","2020-11-05",130000),
        ("Dr. Rohan Joshi","Dermatologist",7,"9876543216","rohan.j@hosp.com","2022-01-20",110000),
        ("Dr. Kavita Nair","ENT Specialist",8,"9876543217","kavita.n@hosp.com","2021-07-12",115000),
        ("Dr. Suresh Reddy","Cardiologist",1,"9876543218","suresh.r@hosp.com","2019-04-08",145000),
        ("Dr. Meera Gupta","Neurologist",2,"9876543219","meera.g@hosp.com","2020-08-25",155000),
        ("Dr. Amit Verma","Orthopedic Surgeon",3,"9876543220","amit.v@hosp.com","2021-05-30",135000),
        ("Dr. Pooja Iyer","Pediatrician",4,"9876543221","pooja.i@hosp.com","2022-03-15",118000)])
    c.executemany("INSERT INTO patients (name,age,gender,phone,email,blood_group,address,registration_date,insurance_id,insurance_provider) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[
        ("Amitabh B.",78,"Male","9000000001","amitabh@email.com","B+","Mumbai","2024-01-10","INS001","Star Health"),
        ("Sunita Devi",45,"Female","9000000002","sunita@email.com","O-","Delhi","2024-01-15","INS002","HDFC Ergo"),
        ("Rahul Verma",32,"Male","9000000003","rahul@email.com","A+","Bangalore","2024-01-20","INS003","ICICI Lombard"),
        ("Priyanka C.",38,"Female","9000000004","priyanka@email.com","AB+","Mumbai","2024-02-01","INS004","Bajaj Allianz"),
        ("Ravi Shankar",55,"Male","9000000005","ravi@email.com","B-","Chennai","2024-02-05","INS005","New India Assure"),
        ("Meena Kumari",62,"Female","9000000006","meena@email.com","A-","Kolkata","2024-02-10",None,None),
        ("Arjun Reddy",28,"Male","9000000007","arjun@email.com","O+","Hyderabad","2024-02-15","INS006","Star Health"),
        ("Deepika P.",35,"Female","9000000008","deepika@email.com","AB-","Bangalore","2024-02-20","INS007","HDFC Ergo"),
        ("Karthik N.",50,"Male","9000000009","karthik@email.com","B+","Pune","2024-03-01","INS008","ICICI Lombard"),
        ("Lakshmi Iyer",70,"Female","9000000010","lakshmi@email.com","A+","Chennai","2024-03-05","INS009","Bajaj Allianz"),
        ("Nikhil Sharma",25,"Male","9000000011","nikhil@email.com","O-","Delhi","2024-03-10",None,None),
        ("Anjali Rao",42,"Female","9000000012","anjali@email.com","B+","Mumbai","2024-03-15","INS010","New India Assure"),
        ("Suresh Menon",58,"Male","9000000013","suresh.m@email.com","AB+","Kochi","2024-03-20","INS011","Star Health"),
        ("Ritu Singh",33,"Female","9000000014","ritu@email.com","A-","Jaipur","2024-03-25","INS012","HDFC Ergo"),
        ("Vikash Kumar",47,"Male","9000000015","vikash@email.com","O+","Patna","2024-04-01",None,None)])

    wards = [("ICU-A","ICU",500,4),("ICU-B","ICU",500,4),("General-Ward-1","General",100,6),
             ("General-Ward-2","General",100,6),("Private-Ward-1","Private",300,5),
             ("Private-Ward-2","Private",300,5),("Semi-Private-1","Semi-Private",200,5),
             ("Semi-Private-2","Semi-Private",200,5),("Pediatric-Ward","General",120,5)]
    bed_counter = 1
    for wn, bt, rate, cnt in wards:
        for i in range(1, cnt + 1):
            c.execute("INSERT INTO beds (ward_name,bed_number,bed_type,status,hourly_rate) VALUES (?,?,?,?,?)",
                      (wn, "BED-"+str(bed_counter).zfill(3), bt, "Available", rate))
            bed_counter += 1
    for bid, pid, dt in [(1,1,"2024-04-10 08:00"),(2,5,"2024-04-11 14:00"),
                          (9,3,"2024-04-12 10:00"),(15,8,"2024-04-13 09:00"),(21,10,"2024-04-14 11:00")]:
        c.execute("UPDATE beds SET status='Occupied',patient_id=?,admitted_date=? WHERE bed_id=?", (pid, dt, bid))
    c.execute("UPDATE beds SET status='Maintenance' WHERE bed_id=33")

    slots = ["09:00","09:30","10:00","10:30","11:00","11:30","14:00","14:30","15:00","15:30","16:00","16:30"]
    symp_list = ["Chest pain, shortness of breath","Severe headache, dizziness","Knee pain, difficulty walking",
        "Fever, cough in child","Persistent fatigue, weight loss","Accident injury, bleeding",
        "Skin rash, itching","Throat pain, difficulty swallowing","Irregular heartbeat, palpitations",
        "Memory loss, confusion","Back pain, numbness in legs","Child vaccination routine checkup",
        "Joint swelling, morning stiffness","Chronic abdominal pain","Recurrent sinus infections"]
    diag_list = ["Acute Myocardial Infarction","Migraine with aura","Meniscal tear","Viral fever - Pediatric",
        "Lymphoma - Stage II","Multiple fractures","Contact Dermatitis","Chronic Tonsillitis",
        "Atrial Fibrillation","Early onset Alzheimer's","Herniated Disc L4-L5","Healthy - Vaccination due",
        "Rheumatoid Arthritis","Irritable Bowel Syndrome","Chronic Sinusitis"]
    presc_list = ["Aspirin 75mg, Clopidogrel 75mg","Sumatriptan 50mg, Paracetamol 500mg",
        "Ibuprofen 400mg, Physiotherapy","Paracetamol syrup, ORS","R-CHOP Chemotherapy protocol",
        "IV Fluids, Surgery scheduled","Hydrocortisone cream 1%, Cetirizine 10mg","Amoxicillin 500mg",
        "Warfarin 5mg, Beta-blocker","Donepezil 10mg, Memory exercises","Muscle relaxant, Epidural injection",
        "DPT Booster, OPV drops","Methotrexate, Folic acid","Antispasmodics, Probiotics","Nasal corticosteroid spray"]
    fee_opts = [500,800,1000,1200,1500,2000]
    for i in range(15):
        d_off = random.randint(-30,15)
        ad = (now+timedelta(days=d_off)).strftime("%Y-%m-%d")
        ts = slots[i%len(slots)]
        if d_off < -20:
            st,fee,wt = "Completed", random.choice(fee_opts), random.randint(5,45)
        elif d_off < -5:
            st = random.choice(["Completed","Cancelled","No-Show"])
            fee,wt = random.choice([500,800,1000,1200]), (random.randint(5,45) if st=="Completed" else 0)
        elif d_off < 0:
            st = random.choice(["Completed","Scheduled"])
            fee,wt = random.choice([500,800,1000,1500]), (random.randint(5,30) if st=="Completed" else 0)
        else:
            st,fee,wt = "Scheduled", random.choice([500,800,1000,1200]), 0
        ca = (now+timedelta(days=d_off-random.randint(1,5))).strftime("%Y-%m-%d %H:%M:%S")
        c.execute("INSERT INTO appointments (patient_id,doctor_id,appointment_date,time_slot,status,symptoms,diagnosis,prescription,fees,wait_time_minutes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (i+1,(i%12)+1,ad,ts,st,symp_list[i],diag_list[i] if st=="Completed" else None,presc_list[i] if st=="Completed" else None,fee,wt,ca))

    c.execute("SELECT appointment_id,patient_id,fees FROM appointments WHERE status='Completed'")
    for row in c.fetchall():
        med = random.choice([200,350,500,800,1200])
        test = random.choice([0,500,1000,1500,2500])
        bed = random.choice([0,2400,4800,7200])
        total = row["fees"]+med+test+bed
        c.execute("SELECT insurance_id FROM patients WHERE patient_id=?", (row["patient_id"],))
        pat = c.fetchone()
        cov = round(total*random.uniform(0.5,0.85),2) if (pat and pat["insurance_id"]) else 0.0
        bd = (now+timedelta(days=random.randint(-15,0))).strftime("%Y-%m-%d")
        c.execute("INSERT INTO bills (patient_id,appointment_id,bed_charges,consultation_fees,medicine_charges,test_charges,total_amount,insurance_coverage,patient_payable,bill_date,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (row["patient_id"],row["appointment_id"],bed,row["fees"],med,test,total,cov,round(total-cov,2),bd,random.choice(["Paid","Pending","Paid","Paid"])))

    c.executemany("INSERT INTO audit_log (table_name,record_id,action,old_value,new_value,timestamp) VALUES (?,?,?,?,?,?)",[
        ("appointments",1,"STATUS_CHANGE","Scheduled","Completed","2024-04-05 10:30:00"),
        ("appointments",2,"STATUS_CHANGE","Scheduled","Completed","2024-04-06 11:15:00"),
        ("appointments",3,"STATUS_CHANGE","Scheduled","Cancelled","2024-04-07 09:00:00"),
        ("beds",1,"BED_ASSIGNED","Available","Patient ID:1","2024-04-10 08:00:00"),
        ("beds",2,"BED_ASSIGNED","Available","Patient ID:5","2024-04-11 14:00:00")])

    for day_offset in range(3):
        dt = (now+timedelta(days=day_offset)).strftime("%Y-%m-%d")
        for doc_id in [1,2,3,4,5,6]:
            avail = 1
            st_time = "09:00"
            en_time = "17:00"
            notes = ""
            if doc_id == 3 and day_offset == 1:
                avail = 0
                notes = "Personal leave"
                st_time = "09:00"
                en_time = "17:00"
            elif doc_id == 1 and day_offset == 2:
                st_time = "10:00"
                en_time = "13:00"
                notes = "Half day - morning only"
            elif doc_id == 5 and day_offset == 0:
                st_time = "14:00"
                en_time = "17:00"
                notes = "Surgery in morning"
            c.execute("INSERT INTO doctor_availability (doctor_id,avail_date,start_time,end_time,is_available,notes) VALUES (?,?,?,?,?,?)",
                      (doc_id, dt, st_time, en_time, avail, notes))
    conn.commit()


def rows_to_list(cursor):
    return [dict(r) for r in cursor.fetchall()]


def get_dashboard_stats():
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) as cnt FROM patients"); total_patients = c.fetchone()["cnt"]
    c.execute("SELECT COUNT(*) as cnt FROM doctors WHERE status='Active'"); total_doctors = c.fetchone()["cnt"]
    c.execute("SELECT COUNT(*) as cnt FROM appointments WHERE status='Scheduled'"); scheduled = c.fetchone()["cnt"]
    c.execute("SELECT COUNT(*) as cnt FROM beds WHERE status='Available'"); avail_beds = c.fetchone()["cnt"]
    c.execute("SELECT COUNT(*) as cnt FROM beds"); total_beds = c.fetchone()["cnt"]
    c.execute("SELECT COALESCE(SUM(total_amount),0) as rev FROM bills"); total_revenue = c.fetchone()["rev"]
    c.execute("SELECT status, COUNT(*) as cnt FROM appointments GROUP BY status"); appt_by_status = rows_to_list(c)
    c.execute("SELECT * FROM v_dept_stats"); dept_stats = rows_to_list(c)
    c.execute("SELECT bed_type, COUNT(*) as total, SUM(CASE WHEN status='Available' THEN 1 ELSE 0 END) as available, SUM(CASE WHEN status='Occupied' THEN 1 ELSE 0 END) as occupied, SUM(CASE WHEN status='Maintenance' THEN 1 ELSE 0 END) as maintenance FROM beds GROUP BY bed_type")
    bed_by_type = rows_to_list(c)
    c.execute("SELECT * FROM v_appointment_details ORDER BY appointment_date DESC, time_slot DESC LIMIT 8"); recent_appts = rows_to_list(c)
    c.execute("SELECT dp.dept_name, ROUND(AVG(a.wait_time_minutes),1) as avg_wait FROM appointments a JOIN doctors d ON a.doctor_id=d.doctor_id JOIN departments dp ON d.dept_id=dp.dept_id WHERE a.status='Completed' GROUP BY dp.dept_name ORDER BY avg_wait DESC")
    wait_times = rows_to_list(c)
    conn.close()
    return {"total_patients":total_patients,"total_doctors":total_doctors,"scheduled_appts":scheduled,
            "available_beds":avail_beds,"total_beds":total_beds,"total_revenue":round(total_revenue,2),
            "appt_by_status":appt_by_status,"dept_stats":dept_stats,"bed_by_type":bed_by_type,
            "recent_appts":recent_appts,"wait_times":wait_times}


def get_patients(search=""):
    conn = get_connection(); c = conn.cursor()
    if search:
        c.execute("SELECT * FROM patients WHERE name LIKE ? OR phone LIKE ? OR insurance_id LIKE ? ORDER BY patient_id DESC",
                  ("%"+search+"%","%"+search+"%","%"+search+"%"))
    else:
        c.execute("SELECT * FROM patients ORDER BY patient_id DESC")
    data = rows_to_list(c); conn.close(); return data

def add_patient(data):
    conn = get_connection(); c = conn.cursor()
    c.execute("INSERT INTO patients (name,age,gender,phone,email,blood_group,address,registration_date,insurance_id,insurance_provider) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (data["name"],data["age"],data["gender"],data["phone"],data.get("email",""),data.get("blood_group",""),
               data.get("address",""),datetime.now().strftime("%Y-%m-%d"),data.get("insurance_id"),data.get("insurance_provider")))
    conn.commit(); pid = c.lastrowid; conn.close(); return pid

def update_patient(pid, data):
    conn = get_connection(); c = conn.cursor()
    fields,vals = [],[]
    for k in ["name","age","gender","phone","email","blood_group","address","insurance_id","insurance_provider","status"]:
        if k in data: fields.append(k+"=?"); vals.append(data[k])
    vals.append(pid)
    c.execute("UPDATE patients SET "+", ".join(fields)+" WHERE patient_id=?", vals); conn.commit(); conn.close()

def delete_patient(pid):
    conn = get_connection(); conn.execute("DELETE FROM patients WHERE patient_id=?", (pid,)); conn.commit(); conn.close()

def get_doctors(dept_filter=0):
    conn = get_connection(); c = conn.cursor()
    if dept_filter: c.execute("SELECT * FROM v_doctor_dept WHERE dept_id=? ORDER BY doctor_id", (dept_filter,))
    else: c.execute("SELECT * FROM v_doctor_dept ORDER BY doctor_id")
    data = rows_to_list(c); conn.close(); return data

def add_doctor(data):
    conn = get_connection(); c = conn.cursor()
    c.execute("INSERT INTO doctors (name,specialization,dept_id,phone,email,hire_date,salary) VALUES (?,?,?,?,?,?,?)",
              (data["name"],data["specialization"],data["dept_id"],data["phone"],data.get("email",""),
               datetime.now().strftime("%Y-%m-%d"),data["salary"]))
    conn.commit(); did = c.lastrowid; conn.close(); return did

def get_departments():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT * FROM departments ORDER BY dept_id"); data = rows_to_list(c); conn.close(); return data

def get_appointments(status_filter="", date_filter=""):
    conn = get_connection(); c = conn.cursor()
    q = "SELECT * FROM v_appointment_details WHERE 1=1"; params = []
    if status_filter: q += " AND status=?"; params.append(status_filter)
    if date_filter: q += " AND appointment_date=?"; params.append(date_filter)
    q += " ORDER BY appointment_date DESC, time_slot DESC"
    c.execute(q, params); data = rows_to_list(c); conn.close(); return data

def book_appointment(data):
    conn = get_connection()
    try:
        conn.execute("BEGIN TRANSACTION"); c = conn.cursor()
        c.execute("SELECT COUNT(*) as cnt FROM appointments WHERE doctor_id=? AND appointment_date=? AND time_slot=? AND status IN ('Scheduled','Confirmed','Completed')",
                  (data["doctor_id"],data["appointment_date"],data["time_slot"]))
        if c.fetchone()["cnt"] > 0: conn.rollback(); return None, "Time slot already booked"
        c.execute("SELECT COALESCE(ROUND(AVG(wait_time_minutes)),15) as pw FROM appointments WHERE doctor_id=? AND status='Completed'", (data["doctor_id"],))
        pw = c.fetchone()["pw"]
        ns = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("INSERT INTO appointments (patient_id,doctor_id,appointment_date,time_slot,status,symptoms,fees,wait_time_minutes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (data["patient_id"],data["doctor_id"],data["appointment_date"],data["time_slot"],"Scheduled",data.get("symptoms",""),data.get("fees",500),pw,ns))
        aid = c.lastrowid
        c.execute("INSERT INTO audit_log (table_name,record_id,action,old_value,new_value,timestamp) VALUES (?,?,?,?,?,?)",
                  ("appointments",aid,"CREATED",None,"P:"+str(data["patient_id"])+" D:"+str(data["doctor_id"]),ns))
        conn.commit(); return aid, "Booked. Predicted wait: "+str(pw)+" min"
    except Exception as e: conn.rollback(); return None, str(e)
    finally: conn.close()

def update_appointment_status(aid, new_status):
    conn = get_connection(); conn.execute("UPDATE appointments SET status=? WHERE appointment_id=?", (new_status,aid)); conn.commit(); conn.close()

def accept_appointment(aid, duration_minutes):
    conn = get_connection()
    conn.execute("UPDATE appointments SET status='Confirmed', duration_minutes=? WHERE appointment_id=?", (duration_minutes, aid))
    conn.commit(); conn.close()

def get_doctor_slots(doctor_id, date):
    conn = get_connection(); c = conn.cursor()
    all_slots = ["09:00","09:30","10:00","10:30","11:00","11:30","14:00","14:30","15:00","15:30","16:00","16:30"]
    c.execute("SELECT time_slot FROM appointments WHERE doctor_id=? AND appointment_date=? AND status IN ('Scheduled','Confirmed','Completed')", (doctor_id,date))
    booked = [r["time_slot"] for r in c.fetchall()]
    c.execute("SELECT * FROM doctor_availability WHERE doctor_id=? AND avail_date=?", (doctor_id,date))
    av = c.fetchone()
    conn.close()
    if av and av["is_available"] == 0: return []
    if av: return [s for s in all_slots if s not in booked and s >= av["start_time"] and s < av["end_time"]]
    return [s for s in all_slots if s not in booked]

def get_beds():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT * FROM v_bed_occupancy ORDER BY ward_name, bed_number"); data = rows_to_list(c); conn.close(); return data

def assign_bed(bed_id, patient_id):
    conn = get_connection()
    try:
        conn.execute("BEGIN TRANSACTION"); c = conn.cursor()
        c.execute("SELECT status FROM beds WHERE bed_id=?", (bed_id,)); bed = c.fetchone()
        if not bed or bed["status"] != "Available": conn.rollback(); return False, "Bed not available"
        c.execute("UPDATE beds SET status='Occupied',patient_id=?,admitted_date=datetime('now') WHERE bed_id=?", (patient_id,bed_id))
        conn.commit(); return True, "Bed assigned"
    except Exception as e: conn.rollback(); return False, str(e)
    finally: conn.close()

def release_bed(bed_id):
    conn = get_connection(); conn.execute("UPDATE beds SET status='Available',patient_id=NULL,admitted_date=NULL WHERE bed_id=?", (bed_id,)); conn.commit(); conn.close()

def get_bills():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT b.*, p.name as patient_name, p.insurance_provider FROM bills b JOIN patients p ON b.patient_id=p.patient_id ORDER BY b.bill_id DESC")
    data = rows_to_list(c); conn.close(); return data

def generate_bill(data):
    conn = get_connection(); c = conn.cursor()
    total = data["bed_charges"]+data["consultation_fees"]+data["medicine_charges"]+data["test_charges"]
    c.execute("SELECT COALESCE(insurance_id,'NONE') as ins FROM patients WHERE patient_id=?", (data["patient_id"],))
    has_ins = c.fetchone()["ins"] != "NONE"
    cov = round(total*0.7,2) if has_ins else 0.0
    c.execute("INSERT INTO bills (patient_id,appointment_id,bed_charges,consultation_fees,medicine_charges,test_charges,total_amount,insurance_coverage,patient_payable,bill_date,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (data["patient_id"],data.get("appointment_id"),data["bed_charges"],data["consultation_fees"],data["medicine_charges"],data["test_charges"],total,cov,round(total-cov,2),datetime.now().strftime("%Y-%m-%d"),"Pending"))
    conn.commit(); bid = c.lastrowid; conn.close(); return bid

def pay_bill(bid):
    conn = get_connection(); conn.execute("UPDATE bills SET status='Paid' WHERE bill_id=?", (bid,)); conn.commit(); conn.close()


def get_doctor_availability(doctor_id, from_date, to_date):
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT * FROM doctor_availability WHERE doctor_id=? AND avail_date BETWEEN ? AND ? ORDER BY avail_date", (doctor_id, from_date, to_date))
    data = rows_to_list(c); conn.close(); return data

def get_all_availability():
    conn = get_connection(); c = conn.cursor()
    c.execute("""SELECT da.*, d.name as doctor_name, d.specialization, dp.dept_name
                 FROM doctor_availability da
                 JOIN doctors d ON da.doctor_id = d.doctor_id
                 JOIN departments dp ON d.dept_id = dp.dept_id
                 ORDER BY da.avail_date, d.name""")
    data = rows_to_list(c); conn.close(); return data

def set_doctor_availability(records):
    conn = get_connection()
    try:
        conn.execute("BEGIN TRANSACTION")
        for r in records:
            c = conn.cursor()
            c.execute("""INSERT INTO doctor_availability (doctor_id,avail_date,start_time,end_time,is_available,notes)
                         VALUES (?,?,?,?,?,?)
                         ON CONFLICT(doctor_id, avail_date) DO UPDATE SET
                         start_time=excluded.start_time, end_time=excluded.end_time,
                         is_available=excluded.is_available, notes=excluded.notes""",
                      (r["doctor_id"], r["avail_date"], r["start_time"], r["end_time"], r["is_available"], r.get("notes","")))
        conn.commit(); return True
    except Exception as e: conn.rollback(); return False
    finally: conn.close()

def delete_doctor_availability(avail_id):
    conn = get_connection(); conn.execute("DELETE FROM doctor_availability WHERE avail_id=?", (avail_id,)); conn.commit(); conn.close()

def get_pending_appointments():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT * FROM v_appointment_details WHERE status='Scheduled' ORDER BY appointment_date, time_slot")
    data = rows_to_list(c); conn.close(); return data

def user_get_doctors_with_availability(dept_id=0):
    conn = get_connection(); c = conn.cursor()
    now = datetime.now()
    dates = [(now+timedelta(days=i)).strftime("%Y-%m-%d") for i in range(3)]
    date_labels = [(now+timedelta(days=i)).strftime("%a, %b %d") for i in range(3)]
    if dept_id:
        c.execute("SELECT * FROM v_doctor_dept WHERE dept_id=? ORDER BY name", (dept_id,))
    else:
        c.execute("SELECT * FROM v_doctor_dept WHERE status='Active' ORDER BY dept_name, name")
    docs = rows_to_list(c)
    for doc in docs:
        doc["availability"] = []
        for i, dt in enumerate(dates):
            c.execute("SELECT * FROM doctor_availability WHERE doctor_id=? AND avail_date=?", (doc["doctor_id"], dt))
            av = c.fetchone()
            if av:
                doc["availability"].append({"date": dt, "label": date_labels[i],
                    "is_available": bool(av["is_available"]), "start_time": av["start_time"],
                    "end_time": av["end_time"], "notes": av["notes"] or ""})
            else:
                doc["availability"].append({"date": dt, "label": date_labels[i],
                    "is_available": True, "start_time": "09:00", "end_time": "17:00", "notes": "Default schedule"})
    conn.close(); return docs

def user_book_appointment(data):
    conn = get_connection()
    try:
        conn.execute("BEGIN TRANSACTION"); c = conn.cursor()
        c.execute("SELECT * FROM doctor_availability WHERE doctor_id=? AND avail_date=?", (data["doctor_id"], data["appointment_date"]))
        av = c.fetchone()
        if av and av["is_available"] == 0: conn.rollback(); return None, "Doctor is on leave on this date"
        if av and (data["time_slot"] < av["start_time"] or data["time_slot"] >= av["end_time"]):
            conn.rollback(); return None, "Selected time is outside doctor's available hours ("+av["start_time"]+"-"+av["end_time"]+")"
        c.execute("SELECT COUNT(*) as cnt FROM appointments WHERE doctor_id=? AND appointment_date=? AND time_slot=? AND status IN ('Scheduled','Confirmed','Completed')",
                  (data["doctor_id"], data["appointment_date"], data["time_slot"]))
        if c.fetchone()["cnt"] > 0: conn.rollback(); return None, "This slot is already booked"
        c.execute("SELECT patient_id FROM patients WHERE phone=?", (data["phone"],))
        pat = c.fetchone()
        if not pat:
            c.execute("INSERT INTO patients (name,age,gender,phone,registration_date) VALUES (?,?,?,?,?)",
                      (data["name"], data["age"], data["gender"], data["phone"], datetime.now().strftime("%Y-%m-%d")))
            pid = c.lastrowid
        else:
            pid = pat["patient_id"]
        ns = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        c.execute("INSERT INTO appointments (patient_id,doctor_id,appointment_date,time_slot,status,symptoms,fees,wait_time_minutes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (pid, data["doctor_id"], data["appointment_date"], data["time_slot"], "Scheduled", data.get("symptoms",""), 500, 0, ns))
        aid = c.lastrowid
        c.execute("INSERT INTO audit_log (table_name,record_id,action,old_value,new_value,timestamp) VALUES (?,?,?,?,?,?)",
                  ("appointments", aid, "USER_BOOKED", None, "Patient:"+str(pid), ns))
        conn.commit(); return aid, "Appointment booked successfully!"
    except Exception as e: conn.rollback(); return None, str(e)
    finally: conn.close()


def add_upload(filename, original_name, file_type):
    conn = get_connection(); c = conn.cursor()
    c.execute("INSERT INTO dbms_uploads (filename,original_name,file_type,uploaded_at) VALUES (?,?,?,?)",
              (filename, original_name, file_type, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    conn.commit(); uid = c.lastrowid; conn.close(); return uid

def get_uploads():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT * FROM dbms_uploads ORDER BY uploaded_at DESC"); data = rows_to_list(c); conn.close(); return data

def delete_upload(upload_id, filename):
    conn = get_connection()
    conn.execute("DELETE FROM dbms_uploads WHERE upload_id=?", (upload_id,))
    conn.commit(); conn.close()
    fpath = os.path.join(UPLOAD_DIR, filename)
    if os.path.exists(fpath): os.remove(fpath)


def dbms_demo_join():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT d.name AS doctor, dp.dept_name, COUNT(a.appointment_id) AS completed_appts FROM doctors d INNER JOIN departments dp ON d.dept_id=dp.dept_id INNER JOIN appointments a ON d.doctor_id=a.doctor_id AND a.status='Completed' GROUP BY d.doctor_id ORDER BY completed_appts DESC LIMIT 5")
    ij = rows_to_list(c)
    c.execute("SELECT d.name AS doctor, dp.dept_name, COUNT(a.appointment_id) AS total_appts FROM doctors d LEFT JOIN departments dp ON d.dept_id=dp.dept_id LEFT JOIN appointments a ON d.doctor_id=a.doctor_id GROUP BY d.doctor_id ORDER BY d.name")
    lj = rows_to_list(c); conn.close()
    return {"inner_join":ij,"left_join":lj,"explanation":"INNER JOIN returns only rows with matches in both tables. LEFT JOIN returns ALL rows from the left table, with NULLs where no match exists on the right."}

def dbms_demo_aggregation():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT dp.dept_name, COUNT(DISTINCT d.doctor_id) AS doctors, COUNT(a.appointment_id) AS appointments, SUM(CASE WHEN a.status='Completed' THEN a.fees ELSE 0 END) AS revenue, ROUND(AVG(CASE WHEN a.status='Completed' THEN a.wait_time_minutes END),1) AS avg_wait, SUM(CASE WHEN a.status='Cancelled' THEN 1 ELSE 0 END) AS cancellations FROM departments dp LEFT JOIN doctors d ON dp.dept_id=d.dept_id LEFT JOIN appointments a ON d.doctor_id=a.doctor_id GROUP BY dp.dept_id HAVING appointments > 0 ORDER BY revenue DESC")
    gr = rows_to_list(c)
    c.execute("SELECT name, salary, (SELECT ROUND(AVG(salary),2) FROM doctors) AS avg_salary, ROUND(salary-(SELECT AVG(salary) FROM doctors),2) AS diff_from_avg FROM doctors ORDER BY salary DESC LIMIT 5")
    sa = rows_to_list(c); conn.close()
    return {"grouped":gr,"subquery_agg":sa,"explanation":"GROUP BY groups rows sharing a value. Aggregation functions (COUNT, SUM, AVG) operate on each group. HAVING filters groups after grouping. CASE creates conditional values inside aggregations."}

def dbms_demo_views():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT * FROM v_doctor_dept LIMIT 5"); v1 = rows_to_list(c)
    c.execute("SELECT * FROM v_appointment_details LIMIT 5"); v2 = rows_to_list(c)
    c.execute("SELECT * FROM v_dept_stats"); v3 = rows_to_list(c)
    c.execute("SELECT sql FROM sqlite_master WHERE type='view' ORDER BY name"); vd = [r["sql"] for r in c.fetchall()]
    conn.close()
    return {"v_doctor_dept":v1,"v_appointment_details":v2,"v_dept_stats":v3,"view_definitions":vd,"explanation":"Views are virtual tables defined by stored queries. They do not store data physically -- every query on a view re-executes the underlying SQL."}

def dbms_demo_triggers():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT * FROM audit_log ORDER BY timestamp DESC"); logs = rows_to_list(c)
    c.execute("SELECT sql FROM sqlite_master WHERE type='trigger'"); td = [r["sql"] for r in c.fetchall()]
    conn.close()
    return {"audit_log":logs,"trigger_definitions":td,"explanation":"Triggers are automatically executed SQL code fired by events (INSERT, UPDATE, DELETE) on a table. Here, changing appointment status auto-logs to audit_log."}

def dbms_demo_transaction():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT appointment_id, doctor_id, appointment_date, time_slot, status FROM appointments WHERE status='Scheduled' LIMIT 5")
    before = rows_to_list(c); ct = None
    if before: ct = {"doctor_id":before[0]["doctor_id"],"appointment_date":before[0]["appointment_date"],"time_slot":before[0]["time_slot"]}
    conn.close()
    return {"scheduled_before":before,"conflict_test":ct,"explanation":"Transactions (BEGIN...COMMIT/ROLLBACK) ensure ATOMICITY -- either all operations succeed or none do. Here, booking checks for conflicts inside a transaction."}

def dbms_demo_indexes():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"); ix = rows_to_list(c)
    c.execute("EXPLAIN QUERY PLAN SELECT * FROM appointments WHERE appointment_date='2024-04-15'"); pl = rows_to_list(c)
    conn.close()
    return {"indexes":ix,"query_plan":pl,"explanation":"Indexes create B-Tree structures for fast O(log n) lookups instead of O(n) full table scans. Trade-off: faster reads, slower writes."}

def dbms_demo_constraints():
    conn = get_connection(); c = conn.cursor()
    c.execute("PRAGMA foreign_key_list(doctors)"); fd = rows_to_list(c)
    c.execute("PRAGMA foreign_key_list(appointments)"); fa = rows_to_list(c)
    c.execute("PRAGMA foreign_key_list(beds)"); fb = rows_to_list(c)
    c.execute("PRAGMA index_list(patients)"); pi = rows_to_list(c)
    conn.close()
    return {"fk_doctors":fd,"fk_appointments":fa,"fk_beds":fb,"patient_indexes":pi,"explanation":"FOREIGN KEY constraints enforce referential integrity. ON DELETE RESTRICT prevents deleting a department with doctors. CASCADE auto-deletes appointments. SET NULL frees beds."}

def dbms_demo_subqueries():
    conn = get_connection(); c = conn.cursor()
    c.execute("SELECT name, specialization, salary FROM doctors WHERE salary > (SELECT AVG(salary) FROM doctors) ORDER BY salary DESC")
    aa = rows_to_list(c)
    c.execute("SELECT d.name, dp.dept_name, cnt AS appt_count FROM doctors d JOIN departments dp ON d.dept_id=dp.dept_id JOIN (SELECT doctor_id, COUNT(*) as cnt FROM appointments GROUP BY doctor_id) a ON d.doctor_id=a.doctor_id WHERE cnt > (SELECT AVG(sub_cnt) FROM (SELECT COUNT(*) as sub_cnt FROM appointments GROUP BY doctor_id))")
    ad = rows_to_list(c)
    c.execute("SELECT name, phone FROM patients p WHERE EXISTS (SELECT 1 FROM bills b WHERE b.patient_id=p.patient_id) ORDER BY name")
    hb = rows_to_list(c); conn.close()
    return {"above_avg_salary":aa,"above_dept_avg_appts":ad,"patients_with_bills":hb,"explanation":"Non-correlated subqueries execute once. Correlated subqueries execute per row. EXISTS checks for row existence (efficient)."}
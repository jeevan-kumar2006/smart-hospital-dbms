from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from db_layer import (
    init_db, get_dashboard_stats,
    get_patients, add_patient, update_patient, delete_patient,
    get_doctors, add_doctor, get_departments,
    get_appointments, book_appointment, update_appointment_status, accept_appointment, get_doctor_slots,
    get_beds, assign_bed, release_bed,
    get_bills, generate_bill, pay_bill,
    get_doctor_availability, get_all_availability, set_doctor_availability, delete_doctor_availability,
    get_pending_appointments, user_get_doctors_with_availability, user_book_appointment,
    add_upload, get_uploads, delete_upload,
    dbms_demo_join, dbms_demo_aggregation, dbms_demo_views,
    dbms_demo_triggers, dbms_demo_transaction, dbms_demo_indexes,
    dbms_demo_constraints, dbms_demo_subqueries,
    UPLOAD_DIR,
)
import os

app = Flask(__name__, static_folder=None)
CORS(app)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
UPLOAD_PATH = os.path.join(BASE_DIR, UPLOAD_DIR)
ALLOWED_EXTENSIONS = set(['png','jpg','jpeg','gif','pdf','doc','docx','xls','xlsx','ppt','pptx','txt','svg','webp'])
ADMIN_USER = "admin"
ADMIN_PASS = "pass@123"


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory(FRONTEND_DIR, path)

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_PATH, filename)


@app.route("/api/admin/login", methods=["POST"])
def api_admin_login():
    d = request.json
    if d.get("username") == ADMIN_USER and d.get("password") == ADMIN_PASS:
        return jsonify({"success": True, "message": "Login successful"})
    return jsonify({"success": False, "message": "Invalid credentials"}), 401


@app.route("/api/dashboard")
def api_dashboard():
    return jsonify(get_dashboard_stats())

@app.route("/api/patients", methods=["GET", "POST"])
def api_patients():
    if request.method == "GET":
        return jsonify(get_patients(request.args.get("search", "")))
    pid = add_patient(request.json)
    return jsonify({"id": pid, "message": "Patient added"}), 201

@app.route("/api/patients/<int:pid>", methods=["PUT", "DELETE"])
def api_patient(pid):
    if request.method == "PUT":
        update_patient(pid, request.json)
        return jsonify({"message": "Patient updated"})
    delete_patient(pid)
    return jsonify({"message": "Patient deleted (cascaded)"})

@app.route("/api/doctors", methods=["GET", "POST"])
def api_doctors():
    if request.method == "GET":
        return jsonify(get_doctors(int(request.args.get("dept", 0))))
    did = add_doctor(request.json)
    return jsonify({"id": did, "message": "Doctor added"}), 201

@app.route("/api/departments")
def api_departments():
    return jsonify(get_departments())

@app.route("/api/appointments", methods=["GET", "POST"])
def api_appointments():
    if request.method == "GET":
        return jsonify(get_appointments(request.args.get("status", ""), request.args.get("date", "")))
    aid, msg = book_appointment(request.json)
    if aid: return jsonify({"id": aid, "message": msg}), 201
    return jsonify({"error": msg}), 409

@app.route("/api/appointments/<int:aid>/status", methods=["PUT"])
def api_appt_status(aid):
    update_appointment_status(aid, request.json["status"])
    return jsonify({"message": "Status updated"})

@app.route("/api/appointments/<int:aid>/accept", methods=["PUT"])
def api_appt_accept(aid):
    accept_appointment(aid, request.json["duration_minutes"])
    return jsonify({"message": "Appointment confirmed"})

@app.route("/api/doctors/<int:did>/slots")
def api_doctor_slots(did):
    return jsonify(get_doctor_slots(did, request.args.get("date", "")))

@app.route("/api/availability", methods=["GET", "POST", "DELETE"])
def api_availability():
    if request.method == "GET":
        did = request.args.get("doctor_id", 0)
        fd = request.args.get("from", "")
        td = request.args.get("to", "")
        if did and fd and td:
            return jsonify(get_doctor_availability(int(did), fd, td))
        return jsonify(get_all_availability())
    if request.method == "POST":
        ok = set_doctor_availability(request.json)
        if ok: return jsonify({"message": "Availability saved"})
        return jsonify({"error": "Failed to save"}), 400
    delete_doctor_availability(request.json["avail_id"])
    return jsonify({"message": "Availability deleted"})

@app.route("/api/pending-appointments")
def api_pending():
    return jsonify(get_pending_appointments())

@app.route("/api/user/doctors")
def api_user_doctors():
    return jsonify(user_get_doctors_with_availability(int(request.args.get("dept", 0))))

@app.route("/api/user/book", methods=["POST"])
def api_user_book():
    aid, msg = user_book_appointment(request.json)
    if aid: return jsonify({"id": aid, "message": msg}), 201
    return jsonify({"error": msg}), 409

@app.route("/api/beds", methods=["GET"])
def api_beds():
    return jsonify(get_beds())

@app.route("/api/beds/<int:bid>/assign", methods=["PUT"])
def api_assign_bed(bid):
    ok, msg = assign_bed(bid, request.json["patient_id"])
    if ok: return jsonify({"message": msg})
    return jsonify({"error": msg}), 400

@app.route("/api/beds/<int:bid>/release", methods=["PUT"])
def api_release_bed(bid):
    release_bed(bid)
    return jsonify({"message": "Bed released"})

@app.route("/api/bills", methods=["GET", "POST"])
def api_bills():
    if request.method == "GET": return jsonify(get_bills())
    bid = generate_bill(request.json)
    return jsonify({"id": bid, "message": "Bill generated"}), 201

@app.route("/api/bills/<int:bid>/pay", methods=["PUT"])
def api_pay_bill(bid):
    pay_bill(bid)
    return jsonify({"message": "Bill paid"})

@app.route("/api/dbms/uploads", methods=["GET", "POST", "DELETE"])
def api_uploads():
    if request.method == "GET":
        return jsonify(get_uploads())
    if request.method == "POST":
        if "file" not in request.files:
            return jsonify({"error": "No file"}), 400
        f = request.files["file"]
        if f.filename == "" or not allowed_file(f.filename):
            return jsonify({"error": "Invalid file type"}), 400
        orig = f.filename
        safe = secure_filename(orig)
        ext = safe.rsplit('.', 1)[1].lower() if '.' in safe else ''
        fname = str(int(datetime.now().timestamp())) + "_" + safe
        f.save(os.path.join(UPLOAD_PATH, fname))
        uid = add_upload(fname, orig, ext)
        return jsonify({"id": uid, "message": "Uploaded"}), 201
    delete_upload(request.json["upload_id"], request.json["filename"])
    return jsonify({"message": "Deleted"})

@app.route("/api/dbms/joins")
def api_dbms_joins(): return jsonify(dbms_demo_join())
@app.route("/api/dbms/aggregation")
def api_dbms_agg(): return jsonify(dbms_demo_aggregation())
@app.route("/api/dbms/views")
def api_dbms_views(): return jsonify(dbms_demo_views())
@app.route("/api/dbms/triggers")
def api_dbms_triggers(): return jsonify(dbms_demo_triggers())
@app.route("/api/dbms/transactions")
def api_dbms_tx(): return jsonify(dbms_demo_transaction())
@app.route("/api/dbms/indexes")
def api_dbms_idx(): return jsonify(dbms_demo_indexes())
@app.route("/api/dbms/constraints")
def api_dbms_con(): return jsonify(dbms_demo_constraints())
@app.route("/api/dbms/subqueries")
def api_dbms_sub(): return jsonify(dbms_demo_subqueries())

@app.errorhandler(404)
def not_found(e): return jsonify({"error": "Not found"}), 404
@app.errorhandler(500)
def server_error(e): return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("=" * 60)
    print("  SMART HOSPITAL MANAGEMENT SYSTEM")
    print("  Initializing database...")
    print("=" * 60)
    init_db()
    print("  Ready at http://localhost:5000")
    print("  Admin: admin / pass@123")
    print("=" * 60)
    app.run(debug=True, port=5000)
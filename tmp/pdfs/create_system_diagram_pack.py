from pathlib import Path
import shutil
import textwrap

import fitz
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "AstreaBlue_System_Module_Diagram_Pack.pdf"
RENDER_DIR = ROOT / "tmp" / "pdfs" / "system-diagrams-rendered"
LOGO = ROOT / "frontend" / "public" / "astrea-blue-logo.png"

PAGE_W, PAGE_H = landscape(A4)
NAVY = colors.HexColor("#071B3A")
BLUE = colors.HexColor("#1769E8")
CYAN = colors.HexColor("#0EA5E9")
INK = colors.HexColor("#10213B")
MUTED = colors.HexColor("#58708F")
LINE = colors.HexColor("#BFD5F2")
PALE = colors.HexColor("#F4F8FE")
PALE_BLUE = colors.HexColor("#EAF3FF")
GREEN = colors.HexColor("#059669")
GREEN_BG = colors.HexColor("#EAF9F2")
AMBER = colors.HexColor("#C36A00")
AMBER_BG = colors.HexColor("#FFF5DD")
ROSE = colors.HexColor("#D7264E")
ROSE_BG = colors.HexColor("#FFF0F3")
VIOLET = colors.HexColor("#6D3CE7")
VIOLET_BG = colors.HexColor("#F3EEFF")
WHITE = colors.white


def wrapped_lines(text, width=34, limit=4):
    return textwrap.wrap(str(text), width=width, break_long_words=False, break_on_hyphens=False)[:limit]


def draw_text(c, text, x, y, size=8, color=INK, bold=False, width=None, leading=None, align="left"):
    font = "Helvetica-Bold" if bold else "Helvetica"
    c.setFont(font, size)
    c.setFillColor(color)
    lines = wrapped_lines(text, width or 55, 8)
    leading = leading or size * 1.25
    for index, line in enumerate(lines):
        yy = y - index * leading
        if align == "center":
            c.drawCentredString(x, yy, line)
        elif align == "right":
            c.drawRightString(x, yy, line)
        else:
            c.drawString(x, yy, line)


def box(c, x, y, w, h, title, body="", fill=PALE_BLUE, stroke=BLUE, badge=None, title_size=8.7):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 7, fill=1, stroke=1)
    draw_text(c, title, x + w / 2, y + h - 15, title_size, stroke, True, 34, align="center")
    if body:
        body_lines = wrapped_lines(body, 38, 4)
        c.setFont("Helvetica", 7)
        c.setFillColor(INK)
        start = y + h - 29
        for i, line in enumerate(body_lines):
            c.drawCentredString(x + w / 2, start - i * 8.5, line)
    if badge:
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColor(stroke)
        c.drawRightString(x + w - 7, y + 7, badge)


def arrow(c, x1, y1, x2, y2, label=None, color=CYAN):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.3)
    c.line(x1, y1, x2, y2)
    import math
    angle = math.atan2(y2 - y1, x2 - x1)
    length = 6
    for offset in (2.55, -2.55):
        c.line(x2, y2, x2 - length * math.cos(angle + offset), y2 - length * math.sin(angle + offset))
    if label:
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColor(MUTED)
        c.drawCentredString((x1 + x2) / 2, (y1 + y2) / 2 + 5, label)


def header(c, title, subtitle, page, section):
    c.setFillColor(NAVY)
    c.roundRect(18, PAGE_H - 73, PAGE_W - 36, 55, 12, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.roundRect(PAGE_W - 220, PAGE_H - 73, 202, 55, 12, fill=1, stroke=0)
    if LOGO.exists():
        c.drawImage(ImageReader(str(LOGO)), 30, PAGE_H - 61, width=70, height=31, preserveAspectRatio=True, mask="auto")
    draw_text(c, section.upper(), 112, PAGE_H - 37, 7, colors.HexColor("#A5E8FF"), True, 50)
    draw_text(c, title, 112, PAGE_H - 53, 16, WHITE, True, 65)
    draw_text(c, subtitle, 112, PAGE_H - 67, 7.5, colors.HexColor("#D5E8FF"), False, 100)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(WHITE)
    c.drawRightString(PAGE_W - 32, PAGE_H - 39, f"PAGE {page}")


def footer(c):
    c.setStrokeColor(LINE)
    c.line(20, 20, PAGE_W - 20, 20)
    c.setFont("Helvetica", 6.5)
    c.setFillColor(MUTED)
    c.drawString(22, 9, "AstreaBlue Enterprise ITSM | System Module Diagram Pack | July 2026")
    c.drawRightString(PAGE_W - 22, 9, "Print: A4 landscape | Scale: Fit to printable area")


def legend(c, items, x=24, y=35):
    cursor = x
    for label, fill, stroke in items:
        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.roundRect(cursor, y, 10, 10, 2, fill=1, stroke=1)
        draw_text(c, label, cursor + 15, y + 8, 6.5, MUTED, True, 28)
        cursor += 95


def flow_row(c, labels, y, x=30, total_w=None, h=61, fills=None):
    total_w = total_w or PAGE_W - 60
    gap = 18
    w = (total_w - gap * (len(labels) - 1)) / len(labels)
    positions = []
    for idx, item in enumerate(labels):
        title, body = item if isinstance(item, tuple) else (item, "")
        xx = x + idx * (w + gap)
        fill, stroke = (fills[idx] if fills else (PALE_BLUE, BLUE))
        box(c, xx, y, w, h, title, body, fill, stroke)
        positions.append((xx, y, w, h))
        if idx:
            previous = positions[idx - 1]
            arrow(c, previous[0] + previous[2], y + h / 2, xx, y + h / 2)
    return positions


def flow_two_rows(c, labels, y_top, y_bottom, split_at=4, x=50, total_w=None, h=70, fills=None):
    """Render long sequential workflows without squeezing seven or eight steps into one row."""
    total_w = total_w or PAGE_W - (x * 2)
    top = labels[:split_at]
    bottom = labels[split_at:]
    top_fills = fills[:split_at] if fills else None
    bottom_fills = fills[split_at:] if fills else None
    top_positions = flow_row(c, top, y_top, x=x, total_w=total_w, h=h, fills=top_fills)
    bottom_width = total_w * (len(bottom) / split_at) if bottom else total_w
    bottom_x = x + (total_w - bottom_width) / 2
    bottom_positions = flow_row(c, bottom, y_bottom, x=bottom_x, total_w=bottom_width, h=h, fills=bottom_fills) if bottom else []
    if top_positions and bottom_positions:
        source = top_positions[-1]
        target = bottom_positions[0]
        arrow(c, source[0] + source[2] / 2, source[1], target[0] + target[2] / 2, target[1] + target[3], "CONTINUE")
    return top_positions + bottom_positions


def note(c, title, body, x, y, w, h, color=GREEN, fill=GREEN_BG, body_color=INK):
    c.setFillColor(fill)
    c.setStrokeColor(color)
    c.roundRect(x, y, w, h, 7, fill=1, stroke=1)
    draw_text(c, title, x + 10, y + h - 15, 8, color, True, 55)
    draw_text(c, body, x + 10, y + h - 30, 7, body_color, False, 85, 9)


def cover(c):
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(BLUE)
    c.circle(PAGE_W - 70, PAGE_H - 65, 165, fill=1, stroke=0)
    c.setFillColor(CYAN)
    c.circle(PAGE_W - 22, PAGE_H - 8, 95, fill=1, stroke=0)
    if LOGO.exists():
        c.drawImage(ImageReader(str(LOGO)), 48, PAGE_H - 126, width=150, height=66, preserveAspectRatio=True, mask="auto")
    draw_text(c, "ASTREABLUE ENTERPRISE ITSM", 48, PAGE_H - 185, 11, colors.HexColor("#8DE5FF"), True, 60)
    draw_text(c, "Complete System", 48, PAGE_H - 235, 32, WHITE, True, 50)
    draw_text(c, "Module Diagram Pack", 48, PAGE_H - 272, 32, WHITE, True, 50)
    draw_text(c, "Print-ready architecture, workflows, role handoffs, data movement, and module relationships", 50, PAGE_H - 313, 11, colors.HexColor("#D7E9FF"), False, 90)
    note(c, "WHAT THIS PACK CONTAINS", "One enterprise overview followed by dedicated diagrams for Service Desk, Assets, CMDB, Replacement, Endpoint Monitoring, Consent, Employee Lifecycle, Integrations, Analytics, and Administration.", 48, 78, 540, 76, CYAN, colors.HexColor("#0C2A55"), WHITE)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(PAGE_W - 48, 55, "Prepared from the implemented AstreaBlue codebase")
    c.showPage()


def page_index(c, page):
    header(c, "Diagram Index", "Use the overview first, then present each operational module.", page, "Presentation Guide")
    entries = [
        ("01", "Enterprise System Map", "Roles, frontend, API, data, storage, and external systems"),
        ("02", "Service Desk", "Incidents, service requests, knowledge, calendar, and SLA"),
        ("03", "Asset Management", "Hardware, software, discovery, finance, and history"),
        ("04", "Configuration Management", "Configuration items, dependency map, and change impact"),
        ("05", "Replacement Management", "Assessment, repair path, and replacement path"),
        ("06", "Endpoint Management", "Enrollment, identity, heartbeat, inventory, activity, screenshots, USB/DLP"),
        ("07", "Consent Governance", "General consent, device assignment, effective policy, and enforcement"),
        ("08", "Employee Onboarding", "Pre-hire case, invitation, consent, asset, and evidence gate"),
        ("09", "Employee Offboarding", "Access, assets, licenses, classification, notification, and closure"),
        ("10", "External Ticket Gateway", "System registration, API key, ticket submission, and SuperAdmin queue"),
        ("11", "Reporting and Administration", "Dashboards, exports, users, branches, settings, and audit"),
        ("12", "End-to-End Demonstration", "Recommended presentation sequence and acceptance evidence"),
    ]
    for idx, (number, title, body) in enumerate(entries):
        col = idx % 2
        row = idx // 2
        x = 35 + col * 385
        y = PAGE_H - 120 - row * 68
        c.setFillColor(BLUE if col == 0 else NAVY)
        c.circle(x + 14, y + 14, 14, fill=1, stroke=0)
        draw_text(c, number, x + 14, y + 17, 7, WHITE, True, 10, align="center")
        draw_text(c, title, x + 38, y + 22, 9.5, INK, True, 50)
        draw_text(c, body, x + 38, y + 8, 7, MUTED, False, 60)
    footer(c)
    c.showPage()


def page_enterprise(c, page):
    header(c, "Enterprise System Map", "All users and systems enter through governed API boundaries.", page, "System Architecture")
    flow_row(c, [
        ("HUMAN USERS", "SuperAdmin, Admin, Technician, Employee, and HR"),
        ("REACT FRONTEND", "Role-based navigation and real-time interface"),
        ("NODE.JS API", "JWT authentication, RBAC, validation, and audit"),
        ("POSTGRESQL", "Operational source of truth and history"),
    ], PAGE_H - 180, h=70, fills=[(PALE_BLUE, BLUE), (PALE_BLUE, BLUE), (PALE, NAVY), (GREEN_BG, GREEN)])
    flow_row(c, [
        ("EXTERNAL SYSTEMS", "HRIS, Payroll, Accounting, E-Invoicing, Inventory"),
        ("EXTERNAL TICKET API", "Unique API keys, idempotency, and logging"),
        ("CENTRALIZED QUEUE", "External tickets visible only to SuperAdmin"),
    ], PAGE_H - 310, x=80, total_w=PAGE_W - 160, h=66, fills=[(AMBER_BG, AMBER), (AMBER_BG, AMBER), (ROSE_BG, ROSE)])
    flow_row(c, [
        ("WINDOWS ENDPOINT", "Native service and activity companion"),
        ("ENDPOINT API", "Per-device credential and effective policy"),
        ("R2 PRIVATE STORAGE", "Encrypted screenshot objects with retention"),
    ], PAGE_H - 425, x=80, total_w=PAGE_W - 160, h=66, fills=[(VIOLET_BG, VIOLET), (PALE, NAVY), (GREEN_BG, GREEN)])
    note(c, "CORE TRUST RULE", "The frontend never connects directly to PostgreSQL or Cloudflare R2. Backend authorization and policy checks are authoritative. WebSocket events invalidate views but never replace database validation.", 70, 48, PAGE_W - 140, 48, BLUE, PALE_BLUE)
    footer(c)
    c.showPage()


def page_service_desk(c, page):
    header(c, "Service Desk and Ticketing", "One controlled record from submission through resolution and SLA evidence.", page, "Module 1")
    flow_row(c, [
        ("FILE REQUEST", "Employee, HR, authorized staff, or external API"),
        ("VALIDATE", "Identity, branch, category, priority, ownership"),
        ("OPEN QUEUE", "SLA clocks and ticket history begin"),
        ("ACCEPT", "Eligible branch technician takes ownership"),
        ("RESOLVE", "Work notes, resolution, completion time"),
        ("CLOSE", "Requester or authorized staff verifies outcome"),
    ], PAGE_H - 178, h=68)
    modules = [
        ("INCIDENT MANAGEMENT", "Restore interrupted or degraded service", ROSE_BG, ROSE),
        ("SERVICE REQUESTS", "Fulfill standard access, equipment, and support needs", PALE_BLUE, BLUE),
        ("KNOWLEDGE BASE", "Technicians publish reusable resolutions from eligible work", GREEN_BG, GREEN),
        ("TICKET CALENDAR", "Visualize due dates, schedules, and branch workload", VIOLET_BG, VIOLET),
        ("SLA MANAGEMENT", "P1: 15/120 min; P2: 30/240; P3: 120/480; P4: 240/1440", AMBER_BG, AMBER),
    ]
    w = 142
    for idx, (title, body, fill, stroke) in enumerate(modules):
        x = 28 + idx * 160
        box(c, x, PAGE_H - 325, w, 82, title, body, fill, stroke)
    note(c, "RBAC BOUNDARY", "Employees see their own tickets. Technicians see eligible work in their branch but not lifecycle, privacy, consent-change, role-change, or centralized external tickets. Admin is branch-scoped; SuperAdmin is company-wide.", 45, 55, PAGE_W - 90, 54, NAVY, PALE)
    footer(c)
    c.showPage()


def page_assets(c, page):
    header(c, "Asset Management", "Track physical and software resources from discovery to disposal.", page, "Module 2")
    flow_row(c, [
        ("DISCOVER / REGISTER", "Agent inventory, manual registration, or controlled import"),
        ("RECONCILE", "Match by endpoint identity, serial, MAC, or asset tag"),
        ("VERIFY", "Confirm branch, condition, ownership, and inventory"),
        ("ASSIGN", "Link employee and optionally the permanent endpoint UUID"),
        ("OPERATE", "Monitor usage, maintenance, licenses, and history"),
        ("RETURN / DISPOSE", "Redeploy, repair, retire, or dispose with audit"),
    ], PAGE_H - 175, h=68, fills=[(PALE_BLUE, BLUE), (AMBER_BG, AMBER), (GREEN_BG, GREEN), (PALE_BLUE, BLUE), (VIOLET_BG, VIOLET), (ROSE_BG, ROSE)])
    box(c, 45, PAGE_H - 335, 170, 95, "HARDWARE ASSETS", "Asset tag, serial, branch, employee assignment, status, condition, procurement, images, and history.", PALE_BLUE, BLUE)
    box(c, 235, PAGE_H - 335, 170, 95, "SOFTWARE LICENSES", "Entitlements, assignments, seats, expiration, renewal, compliance, cost, and reminders.", GREEN_BG, GREEN)
    box(c, 425, PAGE_H - 335, 170, 95, "ASSET DISCOVERY", "Unmanaged observations are linked to an existing asset or converted into a new managed asset.", AMBER_BG, AMBER)
    box(c, 615, PAGE_H - 335, 170, 95, "DEPRECIATION", "Straight-line financial tracking, useful life, salvage value, and disposal evidence.", VIOLET_BG, VIOLET)
    note(c, "IMPORTANT DISTINCTION", "A hardware asset is the owned physical record. A monitored device is its persistent endpoint identity. Linking or replacing an asset must not silently delete the device UUID, credential, monitoring history, or consent evidence.", 65, 50, PAGE_W - 130, 57, NAVY, PALE)
    footer(c)
    c.showPage()


def page_cmdb(c, page):
    header(c, "Configuration Management", "Model technical dependencies so change risk is based on live relationships.", page, "Module 3")
    box(c, 38, PAGE_H - 180, 190, 78, "CONFIGURATION ITEM", "Application, database, server, network device, cloud service, endpoint, or business service.", PALE_BLUE, BLUE)
    box(c, 326, PAGE_H - 180, 190, 78, "DEPENDENCY MAP", "Directed relationships: Depends On, Connected To, Uses, Hosts, Runs On, Contains, or Linked To.", VIOLET_BG, VIOLET)
    box(c, 614, PAGE_H - 180, 190, 78, "CHANGE IMPACT", "Traverses related CIs to identify affected components, applications, branches, and risk.", AMBER_BG, AMBER)
    arrow(c, 228, PAGE_H - 141, 326, PAGE_H - 141, "CREATE RELATIONSHIPS")
    arrow(c, 516, PAGE_H - 141, 614, PAGE_H - 141, "ANALYZE")
    draw_text(c, "REFERENCE DEPENDENCY", PAGE_W / 2, PAGE_H - 235, 10, NAVY, True, 50, align="center")
    positions = flow_row(c, [
        ("PAYROLL APPLICATION", "Production application"),
        ("PRODUCTION PAYROLL DATABASE", "Application Uses database"),
        ("DATABASE SERVER", "Database Runs On server"),
    ], PAGE_H - 340, x=115, total_w=PAGE_W - 230, h=70, fills=[(PALE_BLUE, BLUE), (GREEN_BG, GREEN), (VIOLET_BG, VIOLET)])
    c.setFont("Helvetica-Bold", 7)
    c.setFillColor(MUTED)
    c.drawCentredString((positions[0][0] + positions[0][2] + positions[1][0]) / 2, PAGE_H - 295, "USES")
    c.drawCentredString((positions[1][0] + positions[1][2] + positions[2][0]) / 2, PAGE_H - 295, "RUNS ON")
    note(c, "HOW TO EXPLAIN THE SCORE", "The selected CI is the impact source. The backend follows downstream and upstream relationships, counts affected and Production CIs, identifies dependent applications and branches, and converts that evidence into an impact score, risk label, and recommended action.", 52, 45, PAGE_W - 104, 62, BLUE, PALE_BLUE)
    footer(c)
    c.showPage()


def page_replacement(c, page):
    header(c, "Replacement Management", "A controlled decision between repairing the current laptop and issuing another asset.", page, "Module 4")
    flow_row(c, [
        ("SUBMITTED", "Employee reports damage and selects assigned laptop"),
        ("UNDER ASSESSMENT", "Technician records diagnosis and recommendation"),
    ], PAGE_H - 170, x=165, total_w=PAGE_W - 330, h=67)
    center_x = PAGE_W / 2
    arrow(c, center_x, PAGE_H - 170, center_x, PAGE_H - 210)
    draw_text(c, "DECISION", center_x, PAGE_H - 220, 8, NAVY, True, 20, align="center")
    # Repair lane
    draw_text(c, "REPAIR PATH", 205, PAGE_H - 250, 10, GREEN, True, 30, align="center")
    repair = flow_row(c, [
        ("REPAIR RECOMMENDED", "Technical repair is viable"),
        ("IN REPAIR", "Asset status changes automatically"),
        ("REPAIRED", "Resolution recorded; condition becomes Working"),
        ("RESTORE STATUS", "Assigned: In Use; unassigned: Available"),
    ], PAGE_H - 360, x=35, total_w=375, h=66, fills=[(GREEN_BG, GREEN)] * 4)
    # Replacement lane
    draw_text(c, "REPLACEMENT PATH", 626, PAGE_H - 250, 10, VIOLET, True, 30, align="center")
    replacement = flow_row(c, [
        ("AWAITING APPROVAL", "Administrator decision"),
        ("APPROVED / RESERVED", "Available replacement is locked"),
        ("ISSUED", "New asset assigned; old asset enters repair"),
        ("COMPLETED", "Exchange and audit history verified"),
    ], PAGE_H - 360, x=430, total_w=375, h=66, fills=[(VIOLET_BG, VIOLET)] * 4)
    arrow(c, center_x - 5, PAGE_H - 226, repair[1][0] + repair[1][2] / 2, PAGE_H - 294, "REPAIR")
    arrow(c, center_x + 5, PAGE_H - 226, replacement[1][0] + replacement[1][2] / 2, PAGE_H - 294, "REPLACE")
    note(c, "AUTOMATIC DATA EFFECTS", "Request status, asset status, employee assignment, condition, responsible actor, timestamps, and asset history are updated together. Endpoint identity and historical monitoring records remain intact.", 70, 45, PAGE_W - 140, 54, NAVY, PALE)
    footer(c)
    c.showPage()


def page_endpoint(c, page):
    header(c, "Endpoint Management", "Securely enroll each Windows laptop and enforce consent-derived monitoring policy.", page, "Module 5")
    flow_row(c, [
        ("CREATE ONE-TIME CODE", "Hostname, branch scope, and expiration"),
        ("INSTALL NATIVE AGENT", "Code is consumed once"),
        ("ISSUE DEVICE CREDENTIAL", "Unique secret protected with Windows DPAPI"),
        ("HEARTBEAT", "Online state and agent version"),
        ("INVENTORY", "Hardware and software evidence"),
        ("POLICY SYNC", "Effective settings downloaded every minute"),
    ], PAGE_H - 174, h=67, fills=[(AMBER_BG, AMBER), (PALE_BLUE, BLUE), (GREEN_BG, GREEN), (PALE_BLUE, BLUE), (VIOLET_BG, VIOLET), (GREEN_BG, GREEN)])
    box(c, 32, PAGE_H - 332, 145, 94, "ACTIVITY", "Foreground application, active window title, and idle time through the user-session companion.", PALE_BLUE, BLUE)
    box(c, 192, PAGE_H - 332, 145, 94, "SCREENSHOTS", "Notification before capture; JPEG encrypted by backend with AES-256-GCM and stored privately in R2.", VIOLET_BG, VIOLET)
    box(c, 352, PAGE_H - 332, 145, 94, "USB AND DLP", "Insertion/removal and file metadata only. Backend calculates risk and may create alerts/incidents.", AMBER_BG, AMBER)
    box(c, 512, PAGE_H - 332, 145, 94, "SECURITY", "Credential validation, branch-scoped viewing, retention, and complete audit evidence.", ROSE_BG, ROSE)
    box(c, 672, PAGE_H - 332, 145, 94, "ADMINISTRATION", "Enrollment codes, policies, device linkage, employee assignment, diagnostics, repair, and revoke controls.", GREEN_BG, GREEN)
    note(c, "THREE REQUIRED GATES", "Privacy-sensitive monitoring runs only when all three are true: approved employee consent, enabled effective endpoint policy, and the device is assigned to that employee. Heartbeat and operational inventory remain baseline management functions.", 55, 48, PAGE_W - 110, 58, BLUE, PALE_BLUE)
    footer(c)
    c.showPage()


def page_consent(c, page):
    header(c, "Consent and Policy Governance", "One employee privacy record drives device-specific enforcement after assignment.", page, "Module 6")
    flow_two_rows(c, [
        ("PRIVACY NOTICE", "Employee reviews RA 10173 notice and rights"),
        ("GENERAL CONSENT", "Employee chooses optional monitoring categories and signs"),
        ("ADMIN REVIEW", "Approve, reject, request revision, withdraw, or supersede"),
        ("ASSET ASSIGNMENT", "Approved employee is linked to a managed laptop"),
        ("EFFECTIVE POLICY", "Consent choices intersect with administrator controls"),
        ("AGENT ENFORCEMENT", "Backend and endpoint enforce the resulting flags"),
    ], PAGE_H - 180, PAGE_H - 280, h=68, fills=[(PALE_BLUE, BLUE), (VIOLET_BG, VIOLET), (AMBER_BG, AMBER), (PALE_BLUE, BLUE), (GREEN_BG, GREEN), (GREEN_BG, GREEN)])
    box(c, 90, 170, 285, 78, "GENERAL PRIVACY RECORD", "The legally governed employee consent document. It is not a second laptop-specific signature for every assignment.", PALE_BLUE, BLUE)
    box(c, 465, 170, 285, 78, "DEVICE MONITORING CONTROL", "The device view shows how the employee's approved record and administrator policy apply to the assigned endpoint.", GREEN_BG, GREEN)
    arrow(c, 375, 209, 465, 209, "APPLIES AFTER ASSIGNMENT")
    note(c, "NO MONITORING BY LABEL ALONE", "A UI label does not authorize collection. The backend revalidates assignment, approved consent, enabled feature flag, policy version, and device credential before accepting privacy-sensitive telemetry.", 70, 48, PAGE_W - 140, 54, NAVY, PALE)
    footer(c)
    c.showPage()


def page_onboarding(c, page):
    header(c, "Employee Onboarding", "The case can begin before the employee has an AstreaBlue account.", page, "Module 7A")
    flow_two_rows(c, [
        ("HR CREATES PRE-HIRE CASE", "Name, personal contact, branch, department, job title, and start date"),
        ("SYSTEM CREATES TICKET", "Internal onboarding ticket and required checklist"),
        ("ADMIN CREATES INVITATION", "Employee role only; one-time activation link"),
        ("EMPLOYEE ACTIVATES", "Profile, password, privacy notice, and consent signature"),
        ("IT ASSIGNS ASSET", "Managed laptop is linked without changing device UUID"),
        ("EVIDENCE GATE", "Consent, heartbeat, inventory, and policy download must exist"),
        ("CASE COMPLETES", "Authorized verification after every required task"),
    ], PAGE_H - 180, PAGE_H - 280, h=68, fills=[(AMBER_BG, AMBER), (PALE_BLUE, BLUE), (VIOLET_BG, VIOLET), (GREEN_BG, GREEN), (PALE_BLUE, BLUE), (ROSE_BG, ROSE), (GREEN_BG, GREEN)])
    note(c, "ROLE HANDOFF", "HR owns pre-hire details and oversight. Admin/SuperAdmin owns privileged account invitation and consent approval. IT evidence comes from real system records; automatically verifiable items cannot be falsely completed by manually checking a box.", 55, 178, PAGE_W - 110, 54, BLUE, PALE_BLUE)
    box(c, 85, 62, 190, 75, "HR", "Creates and monitors the branch-scoped lifecycle case.", AMBER_BG, AMBER)
    box(c, 325, 62, 190, 75, "ADMIN / SUPERADMIN", "Creates the invitation and performs privileged approvals.", VIOLET_BG, VIOLET)
    box(c, 565, 62, 190, 75, "EMPLOYEE + ENDPOINT", "Activates the account, signs consent, and generates live device evidence.", GREEN_BG, GREEN)
    footer(c)
    c.showPage()


def page_offboarding(c, page):
    header(c, "Employee Offboarding", "Close access and recover company resources without deleting endpoint history.", page, "Module 7B")
    flow_two_rows(c, [
        ("CREATE OFFBOARDING CASE", "HR selects the employee and branch"),
        ("LINK INTERNAL TICKET", "Service Desk record tracks authorized work"),
        ("DISABLE ASTREABLUE ACCESS", "Internal account is deactivated"),
        ("RECOVER ASSETS", "Assigned equipment is returned and unassigned"),
        ("RELEASE LICENSES", "Recorded assignments return to the available pool"),
        ("CLASSIFY ASSETS", "Redeploy, repair, retire, or dispose"),
        ("VERIFY AND CLOSE", "Required checklist, notifications, and ticket closure"),
    ], PAGE_H - 180, PAGE_H - 280, h=68, fills=[(AMBER_BG, AMBER), (PALE_BLUE, BLUE), (ROSE_BG, ROSE), (VIOLET_BG, VIOLET), (GREEN_BG, GREEN), (AMBER_BG, AMBER), (GREEN_BG, GREEN)])
    note(c, "CURRENT SYSTEM BOUNDARY", "Offboarding automates only AstreaBlue records. It does not pretend to deactivate Google Workspace, Microsoft 365, VPN, HRIS, or other external accounts unless a future authorized integration is implemented.", 65, 178, PAGE_W - 130, 54, ROSE, ROSE_BG)
    box(c, 80, 68, 205, 76, "PRESERVED", "Device UUID, credential history, telemetry history, asset history, consent documents, and audit events.", GREEN_BG, GREEN)
    box(c, 320, 68, 205, 76, "CHANGED", "User active state, asset assignment, license assignment, lifecycle tasks, and linked ticket state.", PALE_BLUE, BLUE)
    box(c, 560, 68, 205, 76, "BLOCKED UNTIL COMPLETE", "The lifecycle case cannot close while any required checklist or evidence item remains pending.", AMBER_BG, AMBER)
    footer(c)
    c.showPage()


def page_gateway(c, page):
    header(c, "Centralized External Ticket Gateway", "Other company systems submit support requests without sharing their source code.", page, "Module 8")
    flow_two_rows(c, [
        ("REGISTER SYSTEM", "SuperAdmin creates system name and code"),
        ("GENERATE API KEY", "Unique secret is shown once"),
        ("EXTERNAL BACKEND", "Stores key server-side; browser never receives it"),
        ("POST TICKET", "HTTPS /api/v1/external/tickets with x-api-key"),
        ("VALIDATE", "System, key, payload, priority, and idempotency"),
        ("CREATE PREFIXED ID", "Example: INVENTORY-20260722001"),
        ("SUPERADMIN QUEUE", "Centralized external tickets stay company-wide and protected"),
    ], PAGE_H - 180, PAGE_H - 280, h=68, fills=[(PALE_BLUE, BLUE), (AMBER_BG, AMBER), (VIOLET_BG, VIOLET), (PALE_BLUE, BLUE), (GREEN_BG, GREEN), (GREEN_BG, GREEN), (ROSE_BG, ROSE)])
    note(c, "WHAT THE OTHER DEVELOPER RECEIVES", "API URL, unique API key, request headers, JSON contract, priority mapping, idempotent external_reference rule, and response format. They call the API from their backend, not directly from the Help form browser.", 55, 175, PAGE_W - 110, 58, BLUE, PALE_BLUE)
    box(c, 105, 62, 185, 72, "SUCCESS", "201 Created with AstreaBlue ticket number and stored origin metadata.", GREEN_BG, GREEN)
    box(c, 328, 62, 185, 72, "SAFE RETRY", "Same external_reference and same payload return the existing ticket.", PALE_BLUE, BLUE)
    box(c, 551, 62, 185, 72, "FAILURE", "401 authentication, 400 validation, or 409 conflicting reference; all attempts are logged.", ROSE_BG, ROSE)
    footer(c)
    c.showPage()


def page_reporting_admin(c, page):
    header(c, "Reporting, Analytics, and Administration", "Operational data is summarized without bypassing the source modules or RBAC.", page, "Modules 9 and 10")
    analytics = [
        ("EXECUTIVE DASHBOARD", "Company-wide operational KPIs"),
        ("OPERATIONAL ANALYTICS", "Service delivery and trend analysis"),
        ("ASSET AND ENDPOINT", "Inventory, health, screenshots, and compliance"),
        ("GOVERNANCE", "Consent, SLA, and audit posture"),
        ("PROJECTS / FORECASTING", "Delivery status, budgets, risks, and capacity"),
        ("CUSTOM REPORTS", "Filtered, branch-aware report definitions"),
    ]
    flow_row(c, analytics, PAGE_H - 185, h=75, fills=[(PALE_BLUE, BLUE), (PALE_BLUE, BLUE), (GREEN_BG, GREEN), (VIOLET_BG, VIOLET), (AMBER_BG, AMBER), (ROSE_BG, ROSE)])
    draw_text(c, "SYSTEM ADMINISTRATION", PAGE_W / 2, PAGE_H - 235, 10, NAVY, True, 40, align="center")
    box(c, 50, PAGE_H - 350, 170, 88, "USER AND ROLE", "Accounts, role assignments, status, invitations, password and onboarding state.", PALE_BLUE, BLUE)
    box(c, 240, PAGE_H - 350, 170, 88, "BRANCH MANAGEMENT", "Branch identity, active status, and branch-bound administrators.", GREEN_BG, GREEN)
    box(c, 430, PAGE_H - 350, 170, 88, "INTEGRATION HUB", "External systems, API keys, test console, metrics, and logs.", AMBER_BG, AMBER)
    box(c, 620, PAGE_H - 350, 170, 88, "SYSTEM SETTINGS", "SMTP diagnostics, security configuration, and platform preferences.", VIOLET_BG, VIOLET)
    note(c, "EXPORT STANDARD", "Filtered reports use the current authorized scope and produce consistent Excel, TXT, or PDF output with AstreaBlue branding, report title, branch/company context, and generation timestamp.", 65, 48, PAGE_W - 130, 55, NAVY, PALE)
    footer(c)
    c.showPage()


def page_demo(c, page):
    header(c, "Recommended End-to-End Demonstration", "A presentation sequence that proves connected data instead of isolated screens.", page, "Presentation Flow")
    flow_two_rows(c, [
        ("1. ADMIN SETUP", "Create branch, employee invitation, and system configuration"),
        ("2. ONBOARD", "Activate employee, sign and approve consent"),
        ("3. ASSET + AGENT", "Create/link asset, enroll laptop, verify inventory"),
        ("4. SERVICE DESK", "File, accept, resolve, and close a ticket with SLA evidence"),
        ("5. CONFIGURATION", "Create three CIs, map dependencies, analyze impact"),
        ("6. REPLACEMENT", "Assess damaged laptop and demonstrate repair or replacement"),
        ("7. EXTERNAL API", "Submit Inventory ticket and verify SuperAdmin-only visibility"),
        ("8. REPORT", "Show dashboards, audit history, filters, and PDF export"),
    ], PAGE_H - 180, PAGE_H - 280, h=68, fills=[(PALE_BLUE, BLUE), (AMBER_BG, AMBER), (GREEN_BG, GREEN), (PALE_BLUE, BLUE), (VIOLET_BG, VIOLET), (ROSE_BG, ROSE), (AMBER_BG, AMBER), (GREEN_BG, GREEN)])
    note(c, "ACCEPTANCE EVIDENCE", "For every step, show the originating action, resulting database-backed status, responsible actor and timestamp, RBAC restriction from another role, and the corresponding history or audit event.", 58, 176, PAGE_W - 116, 56, BLUE, PALE_BLUE)
    box(c, 70, 62, 210, 78, "LIVE PROOF", "Heartbeat, inventory timestamps, Socket.IO refresh, ticket state transitions, and current effective policy.", GREEN_BG, GREEN)
    box(c, 315, 62, 210, 78, "SECURITY PROOF", "Branch isolation, SuperAdmin-only external queue, consent enforcement, and unique device credentials.", ROSE_BG, ROSE)
    box(c, 560, 62, 210, 78, "AUDIT PROOF", "History entries, SLA changes, lifecycle evidence, integration logs, and branded exports.", VIOLET_BG, VIOLET)
    footer(c)
    c.showPage()


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=landscape(A4), pageCompression=1)
    c.setTitle("AstreaBlue Complete System Module Diagram Pack")
    c.setAuthor("AstreaBlue Project Team")
    cover(c)
    pages = [page_index, page_enterprise, page_service_desk, page_assets, page_cmdb,
             page_replacement, page_endpoint, page_consent, page_onboarding, page_offboarding,
             page_gateway, page_reporting_admin, page_demo]
    for number, renderer in enumerate(pages, start=2):
        renderer(c, number)
    c.save()

    if RENDER_DIR.exists():
        shutil.rmtree(RENDER_DIR)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    document = fitz.open(OUTPUT)
    matrix = fitz.Matrix(1.5, 1.5)
    for index, page in enumerate(document):
        page.get_pixmap(matrix=matrix, alpha=False).save(RENDER_DIR / f"page-{index + 1:02d}.png")
    print(f"PDF={OUTPUT}")
    print(f"PAGES={len(document)}")
    print(f"RENDER_DIR={RENDER_DIR}")


if __name__ == "__main__":
    build()

from __future__ import annotations

import os
import shutil
import textwrap
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

import fitz
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    Image as RLImage,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs"
RENDER_DIR = TMP_DIR / "rendered"
PDF_PATH = OUTPUT_DIR / "AstreaBlue_Enterprise_ITSM_Technical_Thesis.pdf"
LOGO_PATH = ROOT / "frontend" / "public" / "astrea-blue-logo.png"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
if RENDER_DIR.exists():
    shutil.rmtree(RENDER_DIR)
RENDER_DIR.mkdir(parents=True, exist_ok=True)


# Brand palette
NAVY = colors.HexColor("#082B5C")
BLUE = colors.HexColor("#1769E0")
CYAN = colors.HexColor("#22B9DF")
INK = colors.HexColor("#152238")
SLATE = colors.HexColor("#53657D")
MUTED = colors.HexColor("#7E8EA5")
PALE = colors.HexColor("#F3F7FC")
PALE_BLUE = colors.HexColor("#EAF3FF")
BORDER = colors.HexColor("#C9D9EC")
GREEN = colors.HexColor("#169B62")
GREEN_BG = colors.HexColor("#E8F8F0")
AMBER = colors.HexColor("#B76B00")
AMBER_BG = colors.HexColor("#FFF4D8")
RED = colors.HexColor("#C9344A")
RED_BG = colors.HexColor("#FDECEF")
WHITE = colors.white


def register_fonts():
    candidates = {
        "ThesisSans": Path("C:/Windows/Fonts/arial.ttf"),
        "ThesisSans-Bold": Path("C:/Windows/Fonts/arialbd.ttf"),
        "ThesisSerif": Path("C:/Windows/Fonts/times.ttf"),
        "ThesisSerif-Bold": Path("C:/Windows/Fonts/timesbd.ttf"),
        "ThesisMono": Path("C:/Windows/Fonts/consola.ttf"),
    }
    for name, path in candidates.items():
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))


register_fonts()
SANS = "ThesisSans" if "ThesisSans" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
SANS_BOLD = "ThesisSans-Bold" if "ThesisSans-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
SERIF = "ThesisSerif" if "ThesisSerif" in pdfmetrics.getRegisteredFontNames() else "Times-Roman"
SERIF_BOLD = "ThesisSerif-Bold" if "ThesisSerif-Bold" in pdfmetrics.getRegisteredFontNames() else "Times-Bold"
MONO = "ThesisMono" if "ThesisMono" in pdfmetrics.getRegisteredFontNames() else "Courier"


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverKicker", fontName=SANS_BOLD, fontSize=11, leading=14,
    alignment=TA_CENTER, textColor=CYAN, spaceAfter=8, uppercase=True,
))
styles.add(ParagraphStyle(
    name="CoverTitle", fontName=SERIF_BOLD, fontSize=24, leading=30,
    alignment=TA_CENTER, textColor=NAVY, spaceAfter=16,
))
styles.add(ParagraphStyle(
    name="CoverSubtitle", fontName=SANS, fontSize=12, leading=18,
    alignment=TA_CENTER, textColor=SLATE, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="ChapterTitle", fontName=SERIF_BOLD, fontSize=19, leading=24,
    textColor=NAVY, spaceBefore=4, spaceAfter=12, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="SectionTitle", fontName=SERIF_BOLD, fontSize=14, leading=18,
    textColor=BLUE, spaceBefore=12, spaceAfter=7, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="SubsectionTitle", fontName=SANS_BOLD, fontSize=10.5, leading=14,
    textColor=INK, spaceBefore=9, spaceAfter=5, keepWithNext=True,
))
styles.add(ParagraphStyle(
    name="BodyThesis", fontName=SERIF, fontSize=10.5, leading=16,
    alignment=TA_JUSTIFY, textColor=INK, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="BodySmall", fontName=SANS, fontSize=8.3, leading=11.5,
    alignment=TA_LEFT, textColor=SLATE, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="BulletThesis", fontName=SERIF, fontSize=10.1, leading=14.5,
    leftIndent=15, firstLineIndent=-7, bulletIndent=6, textColor=INK, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="Caption", fontName=SANS, fontSize=8.2, leading=11,
    alignment=TA_CENTER, textColor=SLATE, spaceBefore=5, spaceAfter=9,
))
styles.add(ParagraphStyle(
    name="TableHead", fontName=SANS_BOLD, fontSize=7.5, leading=9.5,
    textColor=WHITE, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="TableCell", fontName=SANS, fontSize=7.3, leading=10,
    textColor=INK, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="TableCellSmall", fontName=SANS, fontSize=6.6, leading=8.4,
    textColor=INK, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="Callout", fontName=SANS, fontSize=9, leading=13,
    textColor=NAVY, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="ThesisCode", fontName=MONO, fontSize=7.5, leading=10,
    textColor=INK, backColor=PALE, borderColor=BORDER, borderWidth=0.5,
    borderPadding=7, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="Reference", fontName=SERIF, fontSize=9, leading=13,
    leftIndent=18, firstLineIndent=-18, textColor=INK, spaceAfter=6,
))


def P(text, style="BodyThesis", raw=False):
    value = text if raw else escape(str(text))
    return Paragraph(value, styles[style])


def bullet(text):
    return Paragraph(f"• {escape(text)}", styles["BulletThesis"])


def heading(text, level=1):
    return P(text, "ChapterTitle" if level == 1 else "SectionTitle" if level == 2 else "SubsectionTitle")


def caption(text):
    return P(text, "Caption")


def callout(title, body, color=BLUE, background=PALE_BLUE):
    content = Paragraph(f"<b>{escape(title)}</b><br/>{escape(body)}", styles["Callout"])
    table = Table([[content]], colWidths=[151 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.8, color),
        ("LINEBEFORE", (0, 0), (0, -1), 4, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return table


def data_table(headers, rows, widths=None, small=False, repeat=1):
    cell_style = styles["TableCellSmall" if small else "TableCell"]
    data = [[Paragraph(escape(str(h)), styles["TableHead"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(escape(str(v)), cell_style) for v in row])
    if widths is None:
        widths = [151 * mm / len(headers)] * len(headers)
    table = Table(data, colWidths=widths, repeatRows=repeat, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    for idx in range(1, len(data)):
        if idx % 2 == 0:
            commands.append(("BACKGROUND", (0, idx), (-1, idx), PALE))
    table.setStyle(TableStyle(commands))
    return table


class SequenceDiagram(Flowable):
    def __init__(self, title, steps, width=151 * mm, box_height=14 * mm):
        super().__init__()
        self.title = title
        self.steps = steps
        self.width = width
        self.box_height = box_height
        # Reserve the full title/box stack height so the final box never
        # extends outside this flowable and collides with its caption.
        self.height = 19 * mm + len(steps) * box_height + (len(steps) - 1) * 6 * mm

    def wrap(self, availWidth, availHeight):
        return min(self.width, availWidth), self.height

    def draw(self):
        c = self.canv
        w = self.width
        c.setFont(SANS_BOLD, 9)
        c.setFillColor(NAVY)
        c.drawCentredString(w / 2, self.height - 8 * mm, self.title)
        y = self.height - 18 * mm
        box_w = w * 0.78
        x = (w - box_w) / 2
        for idx, step in enumerate(self.steps):
            fill = PALE_BLUE if idx % 2 == 0 else colors.white
            c.setFillColor(fill)
            c.setStrokeColor(BLUE)
            c.setLineWidth(0.8)
            c.roundRect(x, y - self.box_height, box_w, self.box_height, 5, fill=1, stroke=1)
            c.setFillColor(INK)
            c.setFont(SANS_BOLD if idx in (0, len(self.steps) - 1) else SANS, 7.6)
            label = str(step)
            lines = textwrap.wrap(label, width=82, break_long_words=False, break_on_hyphens=False)[:2]
            start_y = y - self.box_height / 2 + (len(lines) - 1) * 4
            for line_no, line in enumerate(lines):
                c.drawCentredString(w / 2, start_y - line_no * 9, line)
            if idx < len(self.steps) - 1:
                c.setStrokeColor(CYAN)
                c.setFillColor(CYAN)
                arrow_x = w / 2
                y2 = y - self.box_height - 5 * mm
                c.line(arrow_x, y - self.box_height, arrow_x, y2)
                c.line(arrow_x, y2, arrow_x - 3, y2 + 4)
                c.line(arrow_x, y2, arrow_x + 3, y2 + 4)
            y -= self.box_height + 6 * mm


class ArchitectureDiagram(Flowable):
    def __init__(self, width=151 * mm, height=102 * mm):
        super().__init__()
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        return min(self.width, availWidth), self.height

    def draw_box(self, c, x, y, w, h, title, lines, fill, stroke):
        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.roundRect(x, y, w, h, 6, fill=1, stroke=1)
        c.setFillColor(stroke)
        c.setFont(SANS_BOLD, 8.2)
        c.drawCentredString(x + w / 2, y + h - 12, title)
        c.setFillColor(INK)
        c.setFont(SANS, 6.8)
        cursor = y + h - 24
        for line in lines:
            c.drawCentredString(x + w / 2, cursor, line)
            cursor -= 9

    def draw(self):
        c = self.canv
        w, h = self.width, self.height
        c.setFont(SANS_BOLD, 9)
        c.setFillColor(NAVY)
        c.drawCentredString(w / 2, h - 8, "AstreaBlue logical deployment architecture")
        box_w = 43 * mm
        gap = (w - box_w * 3) / 4
        top_y = h - 40 * mm
        self.draw_box(c, gap, top_y, box_w, 25 * mm, "USERS", ["SuperAdmin / Admin", "Technician / Employee / HR"], PALE_BLUE, BLUE)
        self.draw_box(c, gap * 2 + box_w, top_y, box_w, 25 * mm, "EXTERNAL SYSTEMS", ["HRIS / Payroll / Accounting", "E-Invoicing / Inventory"], AMBER_BG, AMBER)
        self.draw_box(c, gap * 3 + box_w * 2, top_y, box_w, 25 * mm, "WINDOWS ENDPOINTS", ["Native service", "Activity companion"], GREEN_BG, GREEN)
        mid_w = 66 * mm
        mid_gap = (w - mid_w * 2) / 3
        mid_y = h - 75 * mm
        self.draw_box(c, mid_gap, mid_y, mid_w, 25 * mm, "REACT FRONTEND", ["Vite SPA / RBAC navigation", "Socket.IO live updates"], PALE, NAVY)
        self.draw_box(c, mid_gap * 2 + mid_w, mid_y, mid_w, 25 * mm, "NODE.JS API", ["Express REST / JWT / API keys", "Domain services / audit events"], PALE_BLUE, BLUE)
        bottom_y = 2 * mm
        self.draw_box(c, gap, bottom_y, box_w, 25 * mm, "POSTGRESQL", ["Operational source of truth", "Migrations and audit history"], PALE, NAVY)
        self.draw_box(c, gap * 2 + box_w, bottom_y, box_w, 25 * mm, "CLOUDFLARE R2", ["Private encrypted screenshots", "Retention-controlled objects"], GREEN_BG, GREEN)
        self.draw_box(c, gap * 3 + box_w * 2, bottom_y, box_w, 25 * mm, "SMTP / EMAIL", ["Invitations and notices", "Operational notifications"], AMBER_BG, AMBER)
        c.setStrokeColor(CYAN)
        c.setLineWidth(1.2)
        for x1 in [gap + box_w / 2, gap * 2 + box_w * 1.5, gap * 3 + box_w * 2.5]:
            c.line(x1, top_y, w / 2, mid_y + 25 * mm)
        for x2 in [gap + box_w / 2, gap * 2 + box_w * 1.5, gap * 3 + box_w * 2.5]:
            c.line(w / 2 + 25 * mm, mid_y, x2, bottom_y + 25 * mm)


class ThesisDocTemplate(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, **kwargs)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        self.addPageTemplates([PageTemplate(id="thesis", frames=frame, onPage=self.page_decor)])
        self._section_counter = 0

    def page_decor(self, canvas, doc):
        page = canvas.getPageNumber()
        if page == 1:
            return
        canvas.saveState()
        if LOGO_PATH.exists():
            canvas.drawImage(str(LOGO_PATH), 25 * mm, A4[1] - 17 * mm, width=25 * mm, height=9 * mm, preserveAspectRatio=True, mask="auto")
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.45)
        canvas.line(25 * mm, A4[1] - 19 * mm, A4[0] - 25 * mm, A4[1] - 19 * mm)
        canvas.setFont(SANS, 7.2)
        canvas.setFillColor(SLATE)
        canvas.drawRightString(A4[0] - 25 * mm, A4[1] - 14 * mm, "Enterprise ITSM Technical Thesis")
        canvas.line(25 * mm, 17 * mm, A4[0] - 25 * mm, 17 * mm)
        canvas.drawString(25 * mm, 11 * mm, "AstreaBlue | Technical Thesis Documentation | July 2026")
        canvas.setFont(SANS_BOLD, 7.5)
        canvas.drawRightString(A4[0] - 25 * mm, 11 * mm, f"Page {page}")
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style = flowable.style.name
            if style in ("ChapterTitle", "SectionTitle", "SubsectionTitle"):
                level = {"ChapterTitle": 0, "SectionTitle": 1, "SubsectionTitle": 2}[style]
                text = flowable.getPlainText()
                key = f"section-{self.seq.nextf('section')}"
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=level, closed=False)
                self.notify("TOCEntry", (level, text, self.page, key))


story = []


def add(*items):
    story.extend(items)


def chapter(title):
    if story:
        add(PageBreak())
    add(heading(title, 1), HRFlowable(width="100%", thickness=1.2, color=CYAN, spaceAfter=10))


def section(title):
    add(heading(title, 2))


def subsection(title):
    add(heading(title, 3))


# Cover
add(Spacer(1, 18 * mm))
if LOGO_PATH.exists():
    add(RLImage(str(LOGO_PATH), width=62 * mm, height=22 * mm), Spacer(1, 12 * mm))
add(P("A TECHNICAL THESIS MANUSCRIPT", "CoverKicker"))
add(P("AstreaBlue: A Centralized Enterprise IT Service Management, Asset Governance, Endpoint Monitoring, and External Ticket Integration Platform", "CoverTitle"))
add(HRFlowable(width="62%", thickness=2, color=CYAN, spaceBefore=4, spaceAfter=14))
add(P("System Architecture, Role-Based Workflows, Implementation, Validation, and Development Roadmap", "CoverSubtitle"))
add(Spacer(1, 20 * mm))
cover_meta = data_table(
    ["DOCUMENT", "DETAIL"],
    [
        ["Classification", "Academic technical thesis and system implementation report"],
        ["Prepared by", "AstreaBlue Project Team"],
        ["Prepared for", "Academic presentation and system defense"],
        ["Version", "1.0 - Print Edition"],
        ["Date", "22 July 2026"],
        ["System environment", "React frontend, Node.js API, PostgreSQL, Railway, Cloudflare R2, native Windows agent"],
    ],
    widths=[42 * mm, 109 * mm],
)
add(cover_meta, Spacer(1, 16 * mm))
add(P("This manuscript documents the implemented repository and automated validation baseline as of 22 July 2026. No production secrets are included.", "CoverSubtitle"))


# Document control and declaration
chapter("Document Control and Declaration")
add(P("This document is intended to serve as a thesis-level technical record of AstreaBlue. It explains the problem addressed by the platform, its users, architecture, workflows, data-governance controls, implementation approach, validation evidence, sprint history, current limitations, and recommended next phases. The manuscript may be printed directly on A4 paper."))
add(data_table(
    ["REVISION", "DATE", "DESCRIPTION", "STATUS"],
    [
        ["1.0", "22 July 2026", "Initial consolidated technical thesis based on the implemented repository", "Approved for presentation"],
    ],
    widths=[20 * mm, 30 * mm, 76 * mm, 25 * mm],
))
add(Spacer(1, 10 * mm))
add(P("Declaration of technical accuracy", "SectionTitle"))
add(P("The document separates implemented capability from pilot-stage and planned capability. Statements describing system behavior were derived from the current source tree, database migrations, internal technical documentation, and the automated test baseline. No production secrets, employee passwords, API keys, encryption keys, or database credentials are reproduced."))
add(Spacer(1, 18 * mm))
add(data_table(
    ["ROLE", "NAME / SIGNATURE", "DATE"],
    [
        ["Researcher / Developer", "________________________________________", "________________"],
        ["Technical Adviser", "________________________________________", "________________"],
        ["Project Mentor", "________________________________________", "________________"],
    ],
    widths=[42 * mm, 77 * mm, 32 * mm],
))


chapter("Abstract")
add(P("AstreaBlue is a centralized enterprise information technology service management platform designed to connect incident handling, service requests, asset governance, configuration management, employee lifecycle processes, endpoint monitoring, privacy consent, reporting, and external-system ticket intake. The project addresses fragmented support workflows in which incidents, hardware assignments, employee transitions, and monitoring evidence are recorded in separate tools or manual documents. Its principal design decision is to maintain one PostgreSQL-backed operational source of truth while enforcing role, branch, ownership, and machine-identity boundaries at the backend."))
add(P("The platform uses a React and Vite single-page frontend, an Express and Node.js API, JSON Web Token authentication for human users, per-system API keys for external integrations, and unique per-device credentials for Windows endpoints. A native .NET Windows service provides heartbeat, hardware inventory, software inventory, policy synchronization, screenshot capture, and USB/DLP metadata collection. Privacy-sensitive monitoring is controlled by employee consent and an effective policy that is revalidated by the backend. Screenshots are encrypted with AES-256-GCM before private Cloudflare R2 storage. External systems submit tickets through a centralized gateway without receiving access to the AstreaBlue user interface or internal database."))
add(P("The implementation follows an iterative, risk-controlled methodology. Schema migrations, modular services, RBAC filters, idempotent integration contracts, audit histories, and automated tests are used to reduce regression risk. At the documented baseline, the backend test suite reports 77 passing tests. Native enrollment, heartbeat, inventory, screenshot capture, and USB/DLP behavior have first-pilot evidence; second-device restart testing, trusted code signing, a signed MSI, and complete retirement of the legacy global monitoring token remain planned. The resulting platform demonstrates how service management, asset custody, privacy governance, and endpoint telemetry can be integrated without erasing the organizational boundaries between SuperAdmin, Admin, Technician, Employee, HR, and external systems."))
add(P("Keywords: enterprise ITSM, centralized ticketing, asset management, endpoint monitoring, RBAC, consent management, RA 10173, CMDB, DLP, employee lifecycle, external API."))


chapter("Table of Contents")
toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle(name="TOC0", fontName=SERIF_BOLD, fontSize=10.5, leading=15, leftIndent=0, firstLineIndent=0, textColor=NAVY, spaceBefore=5),
    ParagraphStyle(name="TOC1", fontName=SERIF, fontSize=9.2, leading=13, leftIndent=13, firstLineIndent=0, textColor=INK),
    ParagraphStyle(name="TOC2", fontName=SERIF, fontSize=8.5, leading=12, leftIndent=27, firstLineIndent=0, textColor=SLATE),
]
add(toc)
add(PageBreak(), heading("List of Figures and Tables", 2))
add(data_table(
    ["TYPE", "ITEM"],
    [
        ["Figure 1", "AstreaBlue logical deployment architecture"],
        ["Figure 2", "Internal Service Desk ticket workflow"],
        ["Figure 3", "External Ticket Gateway workflow"],
        ["Figure 4", "Asset and replacement workflow"],
        ["Figure 5", "Consent-aware endpoint monitoring workflow"],
        ["Figure 6", "Employee onboarding workflow"],
        ["Figure 7", "Employee offboarding workflow"],
        ["Table 1", "Stakeholder and user-role matrix"],
        ["Table 2", "Functional module inventory"],
        ["Table 3", "SLA target matrix"],
        ["Table 4", "Sprint and phase status"],
        ["Table 5", "Validation baseline and open acceptance risks"],
    ],
    widths=[27 * mm, 124 * mm],
))


chapter("Chapter 1 - Introduction")
section("1.1 Background of the Study")
add(P("Organizations with multiple internal systems commonly experience a fragmented support environment. Employees report problems through informal messages, branch technicians see incomplete context, assets are tracked separately from incidents, and externally developed systems cannot create standardized support records. Endpoint telemetry may exist but remain disconnected from employee consent, hardware assignment, and incident response. These conditions make it difficult to establish accountability, measure service performance, and prove who changed an operational record."))
add(P("AstreaBlue was conceived as a unified IT service management platform. It consolidates support demand, technology assets, configuration dependencies, endpoint evidence, and employee lifecycle controls while retaining strict access boundaries. The platform is not merely a ticket form: it is a coordinated set of workflows in which events create traceable records and authorized actions update related operational data."))
section("1.2 Statement of the Problem")
add(P("The project addresses the following core problems:"))
for item in [
    "Support requests from employees and independent company systems do not naturally enter one controlled queue.",
    "Branch-based operations require visibility boundaries that cannot safely depend on frontend filtering alone.",
    "Hardware, software licenses, endpoint telemetry, and employee responsibility are often recorded as unrelated data.",
    "Privacy-sensitive monitoring requires documented consent, policy enforcement, retention, and auditable administrative control.",
    "Onboarding and offboarding require both human verification and automatic evidence without allowing checklists to falsely represent completion.",
    "Management reporting requires consistent data, SLA calculations, and exports derived from the same source of truth.",
]:
    add(bullet(item))
section("1.3 General Objective")
add(P("To design, implement, and validate a centralized enterprise ITSM platform that integrates Service Desk operations, asset and configuration governance, endpoint monitoring, employee lifecycle workflows, reporting, and external ticket intake under enforceable role-based and branch-based access control."))
section("1.4 Specific Objectives")
for item in [
    "Provide standardized incident and service-request lifecycles with assignment, comments, attachments, notifications, history, and SLA evidence.",
    "Enable approved external systems to create and follow tickets through a secure, idempotent backend-to-backend API.",
    "Maintain hardware, software-license, discovery, financial, and configuration-item records with operational relationships.",
    "Operate a native Windows endpoint agent using unique device credentials, consent-derived policy, secure local credential storage, and offline-tolerant telemetry delivery.",
    "Support repair and replacement workflows that update asset custody while preserving device identity and historical evidence.",
    "Provide pre-hire onboarding and controlled offboarding workflows with role separation, verification gates, and internal automation.",
    "Present management analytics and consistent exports without exposing data outside authorized scope.",
]:
    add(bullet(item))
section("1.5 Scope and Delimitations")
add(P("The documented system covers the AstreaBlue web application, backend API, PostgreSQL schema, Cloudflare R2 screenshot storage, SMTP-dependent notifications, and native Windows agent. External HRIS, payroll, accounting, e-invoicing, and inventory applications remain independent systems; AstreaBlue provides their ticket contract and credentials but does not require access to their source code. Offboarding automations are intentionally limited to records controlled by AstreaBlue and do not deactivate external email, VPN, HRIS, or cloud accounts."))
add(callout("Important boundary", "AstreaBlue records and verifies IT actions. It does not claim to control third-party systems unless a future, separately authorized connector is implemented.", AMBER, AMBER_BG))
section("1.6 Significance of the Study")
add(P("Employees gain a single, traceable support channel. Technicians receive branch-appropriate work queues and technical context. Administrators gain approval, asset, consent, and lifecycle controls. SuperAdministrators gain company-wide governance, integrations, and audit visibility. HR gains a restricted lifecycle workspace without broad IT administration. Management gains consistent analytics. External development teams gain a minimal contract: a production API URL, a unique system credential, and a documented request schema."))


chapter("Chapter 2 - Conceptual and Regulatory Foundations")
section("2.1 IT Service Management as an Integrated Control System")
add(P("The project treats ITSM as a set of connected records rather than independent screens. A ticket can be linked to an employee, branch, category, priority, SLA, asset, configuration item, replacement request, endpoint alert, or external system. This relationship-centered model allows operational evidence to be reused across dashboards and audits."))
section("2.2 Privacy and Consent by Design")
add(P("Republic Act No. 10173 establishes the Philippine Data Privacy Act of 2012 and frames the protection of personal information in information and communications systems [1]. AstreaBlue applies this concern through visible consent documents, explicit monitoring categories, approval state, effective device policy, administrative audit history, retention controls, and the ability for an authorized SuperAdmin to pause screenshot collection. This implementation is a technical control framework and does not replace organizational legal review."))
section("2.3 Least Privilege and Backend Authorization")
add(P("The security model uses deny-by-default reasoning: possession of a valid login does not automatically authorize access to every record. Human access is checked by role, branch, ownership, assignment, ticket origin, and sensitivity. This aligns with OWASP guidance that object-level and function-level authorization must be consistently enforced in APIs, particularly for administrative functions [2]."))
section("2.4 Auditability and Accountability")
add(P("Operational changes are represented as history events rather than silent overwrites wherever practical. Tickets, lifecycle cases, replacement requests, consent actions, asset assignments, endpoint policies, and integration calls retain actor and timestamp evidence. NIST SP 800-53 identifies audit and accountability as a dedicated control family, supporting the decision to preserve histories and restrict destructive deletion [3]."))
section("2.5 Machine Identity")
add(P("AstreaBlue separates human identity from machine identity. Human users authenticate with a JWT-backed session. External systems use individually provisioned API keys stored as hashes. Windows devices enroll with short-lived single-use codes and receive unique credentials bound to their permanent device UUID. Windows DPAPI protects device credentials at rest; Microsoft documents DPAPI as an operating-system service for encrypting data using user or machine credentials [4]."))


chapter("Chapter 3 - Development Methodology and System Architecture")
section("3.1 Development Method")
add(P("The project follows iterative delivery with risk-based verification. Each sprint establishes a bounded capability, adds database migration support, preserves existing routes and role rules, and is followed by syntax checks, focused tests, full backend regression tests, and a frontend production build. High-risk areas such as ticket visibility, consent, device credentials, assignment, replacement, lifecycle closure, and external API idempotency receive dedicated tests."))
section("3.2 Technology Stack")
add(data_table(
    ["LAYER", "TECHNOLOGY", "RESPONSIBILITY"],
    [
        ["Frontend", "React 18, Vite, React Router, Zustand, Recharts, Socket.IO client", "Role-aware UI, dashboards, forms, tables, live invalidation"],
        ["Backend", "Node.js, Express 5, JWT, bcrypt, Multer, Nodemailer, Socket.IO", "REST API, authentication, domain workflows, notifications, realtime events"],
        ["Database", "PostgreSQL", "Transactional source of truth, RBAC-scoped queries, audit records, migrations"],
        ["Object storage", "Cloudflare R2 through S3-compatible SDK", "Private encrypted screenshot objects and retention deletion"],
        ["Endpoint", ".NET Framework native Windows service and companion", "Enrollment, heartbeat, inventory, policy, activity, screenshot, USB/DLP metadata"],
        ["Deployment", "Railway-hosted frontend and backend", "Production web delivery and environment-managed secrets"],
    ],
    widths=[25 * mm, 51 * mm, 75 * mm],
    small=True,
))
section("3.3 Logical Architecture")
add(ArchitectureDiagram(), caption("Figure 1. AstreaBlue logical deployment architecture."))
add(P("The React frontend never connects directly to PostgreSQL or R2. It calls authenticated backend endpoints. External systems call only the external ticket gateway from trusted server-side code. Windows devices use their own credential path. The backend performs policy and authorization checks before accessing operational data or encrypted objects."))
section("3.4 Backend Route Organization")
add(P("The API is progressively modularized under backend/src/routes. Active domains include authentication, tickets, attachments, SLA, assets, consent, endpoint management, integrations, employee lifecycle, replacement requests, CMDB, analytics, projects, calendar, reports, invitations, users, roles, branches, notifications, and knowledge base. The legacy server.js remains a mixed bootstrap and compatibility layer; the refactor roadmap therefore prioritizes gradual extraction rather than high-risk wholesale deletion."))
section("3.5 Data Architecture")
add(P("PostgreSQL is the authoritative transactional store. Domain tables represent users and roles, branches, tickets and comments, SLA policies and histories, hardware assets, software licenses, monitored devices, endpoint inventory, consent documents, effective policies, screenshot metadata, USB/DLP events, configuration items and relationships, replacement requests, lifecycle cases, external integrations, and audit logs. Database migrations are idempotent and are executed before server startup."))
section("3.6 Realtime Update Strategy")
add(P("Socket.IO events provide low-latency invalidation for tickets and selected operational modules. The durable database remains authoritative: reconnecting clients re-fetch the current server state. This hybrid model avoids making WebSocket delivery the sole source of truth and prevents missed events from permanently corrupting a dashboard."))


chapter("Chapter 4 - Users, Roles, and Access-Control Model")
section("4.1 Stakeholder and User-Role Matrix")
add(data_table(
    ["ROLE", "PRIMARY RESPONSIBILITY", "DATA SCOPE", "KEY RESTRICTIONS"],
    [
        ["SuperAdmin", "Company-wide governance, system configuration, integrations, users, audit, global operations", "All branches and centralized external tickets", "Sensitive actions remain audited; completed lifecycle records are protected"],
        ["Admin", "Branch administration, ticket oversight, consent approval, assets, lifecycle IT actions", "Assigned branch", "No global integration secrets or cross-branch access"],
        ["Technician", "Accept and resolve eligible incidents, contribute technical KB content, endpoint operations as permitted", "Assigned branch and assigned/available eligible tickets", "Cannot see centralized external tickets or privacy/role-change/lifecycle-sensitive tickets"],
        ["Employee", "Submit and follow own tickets, sign consent, view own records, request repair/replacement", "Own identity, tickets, consent, and assigned assets", "Cannot administer other users, branches, devices, or tickets"],
        ["HR", "Create and oversee branch-scoped onboarding/offboarding cases and HR-owned verification", "Assigned branch lifecycle cases and permitted linked tickets", "Cannot complete IT-owned tasks or invite privileged roles"],
        ["External System", "Submit and follow tickets through machine API", "Only its own external references and tickets", "No web login, no internal IDs, no cross-system access"],
        ["Windows Device", "Report telemetry and retrieve effective policy", "One enrolled device identity", "Credential bound to device; policy and consent revalidated server-side"],
    ],
    widths=[23 * mm, 45 * mm, 35 * mm, 48 * mm],
    small=True,
))
section("4.2 RBAC Enforcement Principles")
for item in [
    "Backend query scoping is authoritative; hidden buttons are only a usability layer.",
    "SuperAdmin is the only human role with company-wide external-ticket visibility.",
    "Admin and Technician access is branch-scoped, with additional category and assignment restrictions.",
    "Employee access is ownership-scoped.",
    "HR access is lifecycle-focused and does not imply broad IT administration.",
    "Sensitive consent, privacy, role-change, and lifecycle-linked tickets are excluded from ordinary technician queues.",
    "Invitation endpoints must hard-code or validate the maximum assignable role to prevent privilege escalation.",
]:
    add(bullet(item))
section("4.3 Recommended Invitation Governance")
add(P("The onboarding invitation is intended only for the Employee role and should be tied to a lifecycle case and its branch. HR may be permitted to initiate or resend that employee-only invitation if the backend fixes the role to Employee and the branch to the case. Invitations for Technician, Admin, HR, or other privileged roles should remain in SuperAdmin User and Role Management. This separation keeps routine onboarding efficient without allowing HR to grant administrative privileges."))


chapter("Chapter 5 - Functional Modules and End-to-End Workflows")
section("5.1 Functional Module Inventory")
add(data_table(
    ["MODULE", "SUBMODULES / FUNCTIONS", "PRIMARY OUTPUT"],
    [
        ["Dashboard and Analytics", "Executive dashboard, operational analytics, asset/endpoint analytics, governance, forecasting, custom reports", "KPIs, trends, drill-down reports"],
        ["Service Desk", "Incident Management, Service Request Management, Knowledge Base, Calendar, SLA", "Traceable ticket lifecycle"],
        ["Asset Management", "Hardware, software licenses, discovery/reconciliation, depreciation and finance", "Custody, inventory, lifecycle and financial evidence"],
        ["Configuration Management", "Configuration items, dependency map, change impact analysis", "Service dependency and blast-radius evidence"],
        ["Replacement Management", "Employee request, assessment, repair path, replacement path, asset exchange", "Controlled repair/replacement and history"],
        ["Endpoint Management", "Devices, inventory, health, activity, screenshots, USB/DLP, policy, administration", "Consent-aware endpoint evidence"],
        ["Employee Lifecycle", "Pre-hire onboarding, account invitation, evidence checklist, offboarding automation", "Verified joiner/leaver records"],
        ["Integration Hub", "Registered systems, API keys, console, API logs", "External-system ticket connectivity and audit"],
        ["System Administration", "Users, roles, branches, configuration, email diagnostics", "Controlled platform administration"],
    ],
    widths=[37 * mm, 72 * mm, 42 * mm],
    small=True,
))

section("5.2 Internal Service Desk Workflow")
add(SequenceDiagram("Internal Service Desk ticket workflow", [
    "Employee or authorized staff submits incident/service request",
    "Backend validates identity, branch, category, priority, and payload",
    "Ticket enters Open Queue; SLA due times and history are created",
    "Eligible branch technician accepts ownership",
    "Status changes to In Progress; first-response evidence is recorded",
    "Technician adds comments, attachments, diagnosis, and work evidence",
    "Ticket changes to Resolved; resolution SLA and completion time are evaluated",
    "Authorized closure confirms completion; history and notifications remain auditable",
]), caption("Figure 2. Internal Service Desk ticket workflow."))
subsection("Incident Management")
add(P("Incident Management handles unplanned interruptions or degraded service. Tickets carry canonical numbers, priority P1 through P4, status, branch, category, requester, assignment, comments, attachments, SLA deadlines, work-started time, resolved time, completion duration, and audit history. Admin and SuperAdmin may correct priority when a requester misjudges urgency, while the change remains attributable."))
subsection("Service Request Management")
add(P("Service requests represent planned assistance such as access, equipment, information, or standard fulfillment. They share the core ticket engine but can be categorized and routed differently from incidents. The design avoids a second disconnected ticket database."))
subsection("Knowledge Base")
add(P("The Knowledge Base captures reusable solutions and operational guidance. Technician article creation should offer only tickets the technician accepted or resolved, preventing unrelated branch tickets from being used as article sources. Articles support faster resolution and consistent troubleshooting."))
subsection("Ticket Schedule Calendar")
add(P("The calendar presents ticket events and due dates in a time-oriented view. Role and branch filters must match the Service Desk access model. Calendar failures must never broaden access; a server error is preferable to returning unauthorized records."))
subsection("SLA Management")
add(P("SLA timing is based on the active priority policy at ticket creation. First response is measured from creation until work first enters In Progress. Resolution is measured from creation until Resolved or Closed. Cancellation changes both targets to Cancelled rather than Met or Breached. The current seeded targets are shown below."))
add(data_table(
    ["PRIORITY", "FIRST RESPONSE", "RESOLUTION", "INTERPRETATION"],
    [
        ["P1 - Critical", "15 minutes", "120 minutes", "Major operational interruption requiring immediate attention"],
        ["P2 - High", "30 minutes", "240 minutes", "High business impact with urgent restoration"],
        ["P3 - Medium", "120 minutes", "480 minutes", "Normal operational issue"],
        ["P4 - Low", "240 minutes", "1,440 minutes", "Low urgency or limited impact"],
    ],
    widths=[30 * mm, 30 * mm, 30 * mm, 61 * mm],
))

section("5.3 External Ticket Gateway")
add(SequenceDiagram("External Ticket Gateway workflow", [
    "SuperAdmin registers an external system and provisions a unique API key",
    "System developer stores the key only in the external backend",
    "External Help form sends data to its own backend",
    "External backend POSTs to /api/v1/external/tickets over HTTPS with x-api-key",
    "Gateway authenticates system, validates payload, priority, category, and idempotency",
    "Shared Service Desk service generates SYSTEM-YYYYMMDDSEQ ticket number",
    "Ticket enters centralized unbranched queue visible only to SuperAdmin",
    "Originating system may retrieve status or add public comments with the same credential",
]), caption("Figure 3. External Ticket Gateway workflow."))
add(P("The gateway requires a stable external_reference. Replaying the identical logical request returns the existing ticket, while a conflicting reuse returns HTTP 409. Keys are displayed only at issuance and stored as SHA-256 hashes. Each integration is isolated from every other integration. The gateway is backend-to-backend; placing a key in browser code would invalidate the security model."))
add(P("Current production endpoint: https://backend-production-fc059.up.railway.app/api/v1/external/tickets. Required data includes external employee identifier, requester name and email, origin system and module, external reference, title, and description. Optional category and priority must use known canonical values."))

section("5.4 Asset Management Workflow")
add(SequenceDiagram("Asset and replacement workflow", [
    "Asset is created, imported, or discovered and reconciled",
    "Admin verifies identity, branch, condition, and ownership",
    "Asset is assigned to an eligible employee and optionally linked to an endpoint UUID",
    "Usage, maintenance, license, depreciation, and history records accumulate",
    "Employee reports damage through a ticket and replacement request",
    "Admin assesses: repair path or replacement path",
    "Repair path sets asset In Repair and later restores the recorded pre-repair status",
    "Replacement path returns old asset, assigns available replacement, and preserves histories",
]), caption("Figure 4. Asset and replacement workflow."))
subsection("Hardware Asset Tracking")
add(P("Hardware records include asset tag, type, make/model, serial number, branch, assignment, status, condition, images, financial information, and history. Asset status is an operational state, not merely a label: replacement and offboarding workflows update it transactionally."))
subsection("Software License Management")
add(P("License records track product, key or entitlement metadata, branch, seat counts, assignments, purchase and expiry dates, and renewal history. Expiry status is derived from dates. Renewal should create a history record, require a later expiry date, update cost when applicable, and return released seats to the available pool during offboarding."))
subsection("Asset Discovery and Reconciliation")
add(P("Discovery records identify observed devices and compare them with managed asset records. Matched means the discovery identity already resolves to an asset; selection controls should therefore represent review or relinking, not imply that an unmatched action remains required. Hardware and software inventory from the native agent are separate evidence streams linked by monitored device identity."))
subsection("Depreciation and Finance")
add(P("Financial reporting uses acquisition cost, capitalization data, useful life, depreciation method, accumulated depreciation, and net book value. Reports should state branch/company scope and generation timestamp, and exports should use non-editable or protected formats when distributed as official evidence."))

section("5.5 Configuration Management and Change Impact")
add(P("Configuration Management records technology components and the relationships among them. CI type describes the technical class, such as Application, Database, Server, Network Device, or Service. Category supplies a business or operational grouping; it should not duplicate CI type. Supported relationships include depends on, connected to, uses, hosts, runs on, contains, and linked to."))
add(P("Change Impact Analysis traverses CI relationships. Upstream dependencies are components the selected CI needs; downstream or affected CIs are components that depend on the selected CI. Related branches come from the selected and connected records. Dependent application counts and the impact score are calculated from graph reach, relationship direction, CI criticality, environment, and branch spread. Low, Medium, or High risk is therefore a derived classification, not a manually typed label."))
add(data_table(
    ["EXAMPLE CI", "RELATIONSHIP", "TARGET CI", "WHY IT MATTERS"],
    [
        ["Inventory Web Application", "depends on", "Inventory PostgreSQL Database", "Database outage directly affects the application"],
        ["Inventory Web Application", "uses", "AstreaBlue External Ticket API", "Help submissions require gateway availability"],
        ["Application Server", "hosts", "Inventory Web Application", "Server maintenance affects hosted service"],
    ],
    widths=[40 * mm, 28 * mm, 42 * mm, 41 * mm],
    small=True,
))

section("5.6 Consent-Aware Endpoint Management")
add(SequenceDiagram("Consent-aware endpoint monitoring workflow", [
    "Admin creates one-time enrollment code for the intended Windows hostname",
    "Native installer consumes code and receives unique device credential",
    "Credential is protected locally with DPAPI and bound to permanent device UUID",
    "Device sends heartbeat and baseline hardware/software inventory",
    "Asset and employee assignment establish organizational context",
    "Employee signs monitoring consent; authorized administrator approves it",
    "Backend generates effective policy from consent, assignment, and administrative controls",
    "Agent downloads policy and enables only permitted collectors",
    "Telemetry is authenticated, branch-scoped, audited, and displayed in Endpoint Management",
]), caption("Figure 5. Consent-aware endpoint monitoring workflow."))
subsection("Heartbeat, Inventory, and Activity")
add(P("The Windows service starts automatically and sends heartbeats at the configured interval. Hardware and software inventory run periodically, presently on a 24-hour schedule when enabled. The interactive companion observes foreground application, active window title, and idle duration; the service forwards these samples only when the effective policy permits activity monitoring."))
subsection("Screenshot Monitoring")
add(P("The interactive companion displays a Windows notification before capture. The service uploads through its authenticated channel. The backend revalidates device assignment, consent, and policy; encrypts the image with AES-256-GCM; stores ciphertext in private R2; retains metadata in PostgreSQL; restricts viewing by RBAC and branch; and deletes expired objects according to retention policy. A SuperAdmin pause/resume control updates effective policy without revoking device identity."))
subsection("USB and DLP")
add(P("The agent records removable-drive insertion/removal and metadata for files written or changed on the removable volume. File contents are not collected. Server-side rules assign risk from attributes such as file extension, sensitivity pattern, size, count, transfer volume, and policy thresholds. High or Critical events can create alerts and, when policy permits, automatic Service Desk incidents. An offline queue resubmits events idempotently after connectivity returns."))
subsection("Health Interpretation")
add(P("Online status indicates recent heartbeat, not full monitoring health. A device can be Online while inventory is stale or privacy-sensitive collectors are disabled. Warning states therefore identify evidence that has exceeded its freshness threshold. Repairing or updating the agent should preserve the device UUID unless the device is intentionally purged and re-enrolled as a new machine."))

section("5.7 Employee Lifecycle Management")
add(P("Employee Lifecycle separates HR oversight from IT implementation without creating a second identity system. A pre-hire onboarding case can exist before the employee has an AstreaBlue account. Checklists contain both manually verified organizational tasks and automatically reconciled evidence tasks. The case cannot be completed while required evidence remains pending."))
add(SequenceDiagram("Employee onboarding workflow", [
    "HR creates pre-hire onboarding case with name, branch, department, role context, and start date",
    "System creates a linked internal onboarding ticket and a nine-item required checklist",
    "Authorized Admin/SuperAdmin creates an Employee-role account invitation",
    "Activation link is sent to company email; personal email receives a reminder when configured",
    "Employee activates account, completes profile, reviews privacy notice, and signs general consent",
    "Authorized administrator approves consent",
    "IT assigns the managed asset without changing endpoint identity",
    "Endpoint reports current heartbeat, inventories, and effective-policy download",
    "HR/IT verification gate confirms all required evidence before case completion",
]), caption("Figure 6. Employee onboarding workflow."))
add(SequenceDiagram("Employee offboarding workflow", [
    "HR creates branch-scoped offboarding case linked to employee and Service Desk ticket",
    "Authorized IT action deactivates the AstreaBlue account",
    "Assigned AstreaBlue assets are recovered and unassigned without deleting endpoint identity",
    "Recorded software-license assignments are released",
    "Internal data handover completion is recorded as audit evidence",
    "Returned assets are classified for redeployment, repair, or disposal",
    "HR verifies that every required item is complete",
    "Internal completion notifications are created",
    "Linked AstreaBlue ticket closes only after verified lifecycle completion",
]), caption("Figure 7. Employee offboarding workflow."))
add(callout("Evidence rule", "Automatically verifiable onboarding items cannot be falsely checked by hand. Account, consent, assignment, heartbeat, inventory, and policy evidence must exist in the system.", GREEN, GREEN_BG))

section("5.8 Reporting, Forecasting, and Export")
add(P("Executive and operational dashboards aggregate Service Desk, SLA, asset, endpoint, compliance, and project data from the same PostgreSQL source. Filters must be applied before aggregation and export. Official exports should include the AstreaBlue logo, report title, branch or company scope, generation timestamp, table/list format, and page numbering. Supported standardized outputs are Excel, TXT, and PDF; PDF is the non-editable presentation record, while Excel may be protected to discourage accidental modification."))


chapter("Chapter 6 - Security, Privacy, and Reliability Controls")
section("6.1 Authentication")
add(data_table(
    ["ACTOR", "AUTHENTICATION", "SECRET STORAGE", "REVOCATION"],
    [
        ["Human user", "Email/password and JWT", "Password hash in PostgreSQL; JWT held by client", "Deactivate account / expire session"],
        ["External system", "x-api-key", "Only SHA-256 hash stored by AstreaBlue", "Disable system/key or rotate credential"],
        ["Windows endpoint", "Unique device credential", "Hash in PostgreSQL; DPAPI-protected value on laptop", "Revoke/rotate device credential"],
    ],
    widths=[31 * mm, 38 * mm, 47 * mm, 35 * mm],
    small=True,
))
section("6.2 Authorization")
add(P("Authorization is applied at route and query level. Record identifiers supplied by clients are treated as untrusted. Ticket access uses canonical user context rather than accepting a claimed role from a query string. Integration calls are scoped to the authenticated system. Endpoint requests are scoped to the credential-bound device. This directly addresses broken object- and function-level authorization risks identified by OWASP [2]."))
section("6.3 Privacy Controls")
for item in [
    "General employee consent supplies one approved preference record for assigned managed devices.",
    "Effective policy intersects consent, assignment, administrative controls, and safe defaults.",
    "Screenshot and USB/DLP collection remain disabled without explicit relevant consent.",
    "Screenshot notification, encryption, private storage, access audit, pause/resume, and retention are enforced.",
    "USB file contents are not uploaded; the system records operational metadata only.",
    "Consent changes, approvals, withdrawals, and supersession remain auditable.",
]:
    add(bullet(item))
section("6.4 Data Integrity and Transaction Boundaries")
add(P("Multi-record workflows use PostgreSQL transactions and row locks. Replacement exchange updates the old asset, replacement asset, monitored-device assignment, assignment history, and request history as one controlled operation. Lifecycle closure verifies pending tasks before changing final state. External ticket idempotency prevents network retries from creating duplicate incidents."))
section("6.5 Availability and Failure Handling")
add(P("The native agent uses service recovery, rotating local logs, and offline queues for USB/DLP delivery. WebSocket loss does not erase data because clients re-fetch durable REST state. Database readiness gates avoid serving feature routes before migrations complete. SMTP failure reports delivery failure without pretending that an email was sent; invitation links can still be securely copied while configuration is corrected."))
section("6.6 Secret Management")
add(P("Railway environment variables hold production database, SMTP, JWT, integration, R2, and screenshot encryption configuration. Secrets must not be committed, embedded in frontend bundles, printed in logs, or included in screenshots and support messages. Exposed keys must be rotated rather than merely hidden."))


chapter("Chapter 7 - Testing, Results, and Evaluation")
section("7.1 Validation Strategy")
add(P("Validation combines static syntax checks, domain unit tests, route-level integration tests, frontend production builds, migration execution, and physical-device pilot checks. The complete backend suite is executed serially to reduce shared-database interference. High-risk authorization cases are explicitly tested rather than inferred from successful UI behavior."))
section("7.2 Automated Test Baseline")
add(data_table(
    ["TEST DOMAIN", "VALIDATED BEHAVIOR"],
    [
        ["Ticket RBAC", "Employee ownership, branch technician scope, HR scope, SuperAdmin external-ticket exclusivity"],
        ["External Gateway", "Authentication, validation, canonical priority, idempotency, cross-system isolation"],
        ["Endpoint Enrollment", "Single-use codes, unique credentials, revocation, DPAPI-at-rest smoke behavior"],
        ["Native Agent", "Policy, heartbeat, hardware/software inventory, screenshot and USB/DLP smoke paths"],
        ["Consent and Onboarding", "Approval reconciliation, mandatory evidence, role restrictions, lifecycle completion gates"],
        ["Replacement", "Repair lifecycle, pre-repair status restoration, assignment preservation"],
        ["Screenshot Retention", "R2 object deletion, metadata removal, audit record"],
        ["Reports", "Branded Excel, TXT, and valid PDF output"],
        ["Realtime", "Ticket Socket.IO events and durable refresh behavior"],
    ],
    widths=[43 * mm, 108 * mm],
    small=True,
))
add(callout("Automated result", "Backend regression baseline: 77 tests passed, 0 failed, 0 skipped. Frontend production build completed successfully at the documented repository state.", GREEN, GREEN_BG))
section("7.3 Physical Pilot Evidence")
add(data_table(
    ["CAPABILITY", "FIRST PILOT", "SECOND / RESTART ACCEPTANCE"],
    [
        ["Enrollment, heartbeat, diagnostics, repair", "Validated", "Second-laptop and restart coverage still required"],
        ["Hardware/software inventory", "Validated", "Restart and long-running freshness validation required"],
        ["Activity companion", "Validated after repair corrected local access", "Repeat across user logon/restart"],
        ["Encrypted screenshot", "Validated on first pilot", "Validate repair/restart on second pilot"],
        ["USB insertion/removal and file metadata", "Validated on first pilot", "Validate DLP/auto-incident on testing laptop"],
    ],
    widths=[55 * mm, 36 * mm, 60 * mm],
    small=True,
))
section("7.4 Acceptance Criteria")
for item in [
    "No user can retrieve data outside the backend-enforced role/branch/ownership scope.",
    "External systems can create, retrieve, and comment only on their own tickets.",
    "A device cannot authenticate with a revoked credential.",
    "Privacy-sensitive telemetry is rejected when consent or effective policy is absent.",
    "Lifecycle and replacement transitions cannot skip required gates.",
    "Reports reflect active filters and identify scope and generation time.",
    "Automated tests and production builds pass before deployment.",
]:
    add(bullet(item))
section("7.5 Observed Limitations")
add(P("The current production architecture remains a modularizing monolith; server.js still contains legacy compatibility logic. Native installers and executables are not yet signed with a trusted company certificate. The MSI package, production signed-update manifest, staged update channels, complete multi-laptop restart validation, and removal of the legacy global monitoring token remain incomplete. SMTP delivery depends on valid provider configuration. Browser and network conditions can interrupt realtime connections, requiring REST reconciliation."))


chapter("Chapter 8 - Sprint History and Phase Status")
section("8.1 Development Phases")
add(data_table(
    ["PHASE / SPRINT", "OBJECTIVE", "STATUS", "KEY RESULT"],
    [
        ["Phase 0 - Discovery and safety baseline", "Inventory code, routes, RBAC, schema, and critical regressions", "Completed", "Risk areas identified; non-destructive migration approach adopted"],
        ["Phase 1 - Core validation", "Authentication, RBAC, assets, endpoints, consent, policy, diagnostics", "Completed with ongoing hardening", "Core human workflows and branch scope operational"],
        ["Phase 2 - External Ticket Gateway", "Centralized API for independent company systems", "Implemented", "Per-system keys, canonical tickets, idempotency, logs, documentation"],
        ["Phase 3 - External onboarding", "Connect HRIS, payroll, accounting, e-invoicing, inventory Help pages", "Foundation ready; partner adoption in progress", "External teams require only API URL, key, and contract"],
        ["Phase 4 - Endpoint monitoring", "Activity, screenshots, USB/DLP, automatic incidents", "Pilot implemented", "Consent-aware native collectors, encrypted R2, DLP scoring"],
        ["Sprint 5 - CMDB and analytics", "CI relationships, impact, dashboards, exports", "Implemented; UX/performance tuning ongoing", "Dependency-aware reporting and impact views"],
        ["Sprint 6 - Replacement Management", "Repair and laptop exchange with asset updates", "Implemented", "Pre-repair status restoration and auditable exchange"],
        ["Sprint 7 - Employee Lifecycle", "Pre-hire onboarding and internal offboarding", "Implemented; invitation governance refinement planned", "Evidence-backed checklists and closure gates"],
        ["Sprint 8 - Production hardening", "Signing, MSI, update channels, performance, expanded E2E QA", "Planned / active backlog", "Required before wide endpoint deployment"],
    ],
    widths=[34 * mm, 49 * mm, 28 * mm, 40 * mm],
    small=True,
))
section("8.2 Native Agent Delivery Priorities")
add(data_table(
    ["PRIORITY", "COMPLETED", "OUTSTANDING"],
    [
        ["P0 Secure enrollment", "Single-use code, unique hashed credentials, binding, audit, rotation/revocation", "Retire temporary global-token compatibility after migration"],
        ["P1 Native service", "Heartbeat, policy, inventory, activity, screenshot, USB/DLP", "Second-device restart and DLP acceptance"],
        ["P2 Installation", "Install, repair, diagnostics, uninstall, ZIP package", "Trusted code signing and signed MSI"],
        ["P3 Reliability", "Recovery, logs, intervals, update verification framework", "Production manifest, pilot/stable channels, automatic rollback dashboard"],
        ["P4 Migration", "First pilot deployment and credential validation", "Controlled fleet migration and global-token removal"],
    ],
    widths=[32 * mm, 61 * mm, 58 * mm],
    small=True,
))


chapter("Chapter 9 - Conclusions and Recommended Roadmap")
section("9.1 Conclusions")
add(P("AstreaBlue demonstrates that a centralized Service Desk can be extended into an enterprise control platform without forcing every business system into one codebase. Human users, external systems, and endpoint devices use different authentication models but converge on a common audited operational record. Asset assignment, consent, endpoint policy, lifecycle, and ticketing are connected through controlled backend workflows rather than manual assumptions."))
add(P("The strongest project characteristic is its preservation of source-of-truth and access boundaries. External tickets use the existing Service Desk engine. Endpoint identities survive repair and reassignment. Onboarding evidence is reconciled from real account, consent, asset, heartbeat, inventory, and policy records. Replacement updates custody while retaining history. These design choices reduce duplicate data and make management reporting defensible."))
section("9.2 Priority Roadmap")
add(data_table(
    ["PRIORITY", "NEXT ACTION", "EXIT CRITERION"],
    [
        ["1", "Complete end-to-end role and branch regression matrix", "SuperAdmin, Admin, Technician, Employee, and HR pass positive and negative access tests"],
        ["2", "Finalize onboarding invitation governance", "Employee-only HR initiation is backend-enforced or Admin-only policy is documented and tested"],
        ["3", "Complete physical endpoint acceptance", "Second laptop passes install, restart, repair, screenshot, USB/DLP, offline queue, and uninstall tests"],
        ["4", "Sign and package the native agent", "Trusted certificate, signed EXEs/scripts, signed MSI, verified clean install"],
        ["5", "Retire legacy monitoring token", "All active devices use unique credential_last_seen_at evidence; fallback removed"],
        ["6", "Finish modular backend extraction", "Route ownership centralized; server.js reduced without duplicate behavior"],
        ["7", "Performance and scale verification", "Paginated large lists, indexed queries, measured Railway response times, 120-screenshot gallery test"],
        ["8", "Disaster recovery and operational runbooks", "Backup/restore drill, key-rotation procedure, SMTP/R2 outage playbooks"],
    ],
    widths=[18 * mm, 72 * mm, 61 * mm],
    small=True,
))
section("9.3 Final Recommendation")
add(P("The system is suitable for controlled demonstration and continued pilot use. Broad production rollout of the endpoint agent should wait for trusted code signing, signed installer delivery, multi-device restart acceptance, and retirement of the shared legacy token. The web platform should continue receiving regression-focused improvements, especially around role boundaries, lifecycle invitation governance, pagination, and operational observability."))


chapter("References")
refs = [
    "[1] National Privacy Commission, Republic Act 10173 - Data Privacy Act of 2012. https://privacy.gov.ph/data-privacy-act/ (accessed 22 July 2026).",
    "[2] OWASP Foundation, OWASP API Security Top 10 - 2023, including Broken Object Level Authorization and Broken Function Level Authorization. https://owasp.org/API-Security/ (accessed 22 July 2026).",
    "[3] National Institute of Standards and Technology, Security and Privacy Controls for Information Systems and Organizations, NIST SP 800-53 Revision 5, Audit and Accountability family. https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final (accessed 22 July 2026).",
    "[4] Microsoft, How to Use Data Protection (.NET) and ProtectedData/DPAPI documentation. https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection (accessed 22 July 2026).",
    "[5] AstreaBlue project repository, backend and frontend source, database migrations, automated tests, and internal technical documentation, repository state dated 22 July 2026.",
]
for ref in refs:
    add(P(ref, "Reference"))


chapter("Appendix A - Demonstration Script")
add(P("The following sequence is recommended for a thesis defense because it moves from executive visibility to operational proof and finally to governance."))
add(data_table(
    ["STEP", "ROLE", "DEMONSTRATION", "EXPECTED EVIDENCE"],
    [
        ["1", "SuperAdmin", "Open Executive Dashboard and explain common source of truth", "KPIs from tickets, assets, endpoints, compliance"],
        ["2", "Employee", "Create a branch-scoped ticket with attachment", "Canonical ticket number, Open Queue, SLA deadlines"],
        ["3", "Technician", "Accept eligible ticket, start work, comment, resolve", "Assignment, first response, work tracker, resolution history"],
        ["4", "SuperAdmin", "Show external Inventory ticket", "INVENTORY-date-sequence number and origin metadata"],
        ["5", "Admin", "Show hardware assignment and software licenses", "Asset custody, status, history, branch scope"],
        ["6", "Admin", "Open CMDB dependency map and impact analysis", "Upstream/downstream relationships, impact score"],
        ["7", "Employee/Admin", "Run repair or replacement path", "Asset state changes and request history"],
        ["8", "SuperAdmin", "Show endpoint health, screenshot, USB/DLP", "Heartbeat, inventory, consent policy, encrypted media metadata"],
        ["9", "HR/Admin", "Open onboarding case and explain automatic evidence", "Checklist count matches account/consent/asset/device facts"],
        ["10", "HR/Admin", "Open offboarding case", "Internal deactivation, asset return, license release, closure gate"],
        ["11", "SuperAdmin", "Export a filtered report", "Logo, scope, datestamp, table, protected/non-editable output"],
    ],
    widths=[14 * mm, 25 * mm, 60 * mm, 52 * mm],
    small=True,
))


chapter("Appendix B - External Ticket API Example")
add(P("Production request endpoint"), P("POST https://backend-production-fc059.up.railway.app/api/v1/external/tickets", "ThesisCode"))
add(P("Required headers"), P("Content-Type: application/json\nx-api-key: &lt;unique server-side system API key&gt;", "ThesisCode", raw=True))
api_json = """{
  \"external_employee_id\": \"INV-EMP-001\",
  \"requester_name\": \"Demo Employee\",
  \"requester_email\": \"demo.employee@example.com\",
  \"origin_system\": \"Inventory System\",
  \"origin_module\": \"Stock Management\",
  \"external_reference\": \"INV-DEMO-001\",
  \"title\": \"Unable to update stock quantity\",
  \"description\": \"The stock adjustment page does not save.\",
  \"priority\": \"P2-High\"
}"""
add(P("Example JSON payload"), P(escape(api_json).replace("\n", "<br/>"), "ThesisCode", raw=True))
add(P("The credential must be stored only in the external system backend. The browser-facing Help form sends data to that backend, which then calls AstreaBlue. The external_reference must be stable so safe retries do not create duplicates."))


chapter("Appendix C - Operational Acceptance Checklist")
acceptance = [
    ("Authentication", "Valid and invalid login, expired JWT, deactivated account"),
    ("RBAC", "Positive and negative cases for every role, branch, ownership, and sensitive category"),
    ("Ticket lifecycle", "Create, assign, start, comment, attach, resolve, close, cancel, and SLA history"),
    ("External gateway", "Valid key, revoked key, invalid payload, replay, conflict, cross-system retrieval"),
    ("Asset", "Create, assign, history, discovery match, depreciation, license expiry/renewal"),
    ("Replacement", "Repair and replacement paths, asset state, endpoint assignment, rollback on invalid state"),
    ("Consent", "Draft, submit, approve, change request, withdraw, effective policy regeneration"),
    ("Endpoint", "Install, restart, heartbeat, inventory, activity, screenshot, USB/DLP, offline retry, repair, uninstall"),
    ("Lifecycle", "Pre-hire creation, invitation, activation, consent, asset, device evidence, completion, offboarding"),
    ("Reporting", "Branch filters, date filters, Excel/TXT/PDF, logo, datestamp, non-editable official output"),
    ("Resilience", "SMTP failure, R2 failure, WebSocket reconnect, database migration/readiness, backup restore"),
]
add(data_table(["AREA", "MANDATORY ACCEPTANCE"], acceptance, widths=[36 * mm, 115 * mm], small=True))


chapter("Appendix D - Acronyms and Terms")
add(data_table(
    ["TERM", "MEANING"],
    [
        ["API", "Application Programming Interface"],
        ["CAB", "Change Advisory Board; retained only in legacy change documentation, not the active replacement workflow"],
        ["CI", "Configuration Item"],
        ["CMDB", "Configuration Management Database"],
        ["DLP", "Data Loss Prevention"],
        ["DPAPI", "Windows Data Protection API"],
        ["HR", "Human Resources role with restricted lifecycle oversight"],
        ["ITSM", "Information Technology Service Management"],
        ["JWT", "JSON Web Token"],
        ["RBAC", "Role-Based Access Control"],
        ["R2", "Cloudflare object storage used for private encrypted screenshots"],
        ["SLA", "Service Level Agreement"],
        ["UUID", "Universally Unique Identifier used for durable endpoint identity"],
    ],
    widths=[34 * mm, 117 * mm],
))


doc = ThesisDocTemplate(
    str(PDF_PATH),
    pagesize=A4,
    leftMargin=32 * mm,
    rightMargin=27 * mm,
    topMargin=25 * mm,
    bottomMargin=23 * mm,
    title="AstreaBlue Enterprise ITSM Technical Thesis",
    author="AstreaBlue Project Team",
    subject="Architecture, workflows, implementation, validation, and roadmap",
    keywords="ITSM, AstreaBlue, endpoint monitoring, RBAC, consent, asset management, centralized ticketing",
)
doc.multiBuild(story)


# Render every page for visual QA and create contact sheets.
pdf = fitz.open(PDF_PATH)
page_images = []
for idx, page in enumerate(pdf):
    pix = page.get_pixmap(matrix=fitz.Matrix(1.35, 1.35), alpha=False)
    png_path = RENDER_DIR / f"page-{idx + 1:03d}.png"
    pix.save(str(png_path))
    page_images.append(png_path)

thumb_w = 330
thumb_h = int(thumb_w * A4[1] / A4[0])
for sheet_idx in range(0, len(page_images), 12):
    batch = page_images[sheet_idx:sheet_idx + 12]
    sheet = Image.new("RGB", (thumb_w * 4 + 50, thumb_h * 3 + 60), "#d9e3ef")
    for local_idx, path in enumerate(batch):
        img = Image.open(path).convert("RGB")
        img.thumbnail((thumb_w - 14, thumb_h - 18))
        x = 10 + (local_idx % 4) * thumb_w
        y = 10 + (local_idx // 4) * thumb_h
        sheet.paste(img, (x, y))
    sheet.save(RENDER_DIR / f"contact-{sheet_idx // 12 + 1:02d}.png")

print(f"PDF={PDF_PATH}")
print(f"PAGES={len(pdf)}")
print(f"RENDER_DIR={RENDER_DIR}")

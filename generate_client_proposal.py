import os
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def add_styled_heading(doc, text, level):
    h = doc.add_heading(text, level=level)
    h.paragraph_format.keep_with_next = True
    h.paragraph_format.space_before = Pt(14)
    h.paragraph_format.space_after = Pt(4)
    run = h.runs[0]
    if level == 1:
        run.font.name = "Arial"
        run.font.size = Pt(15)
        run.font.color.rgb = RGBColor(0x0F, 0x29, 0x4A) # Navy
        run.font.bold = True
    elif level == 2:
        run.font.name = "Arial"
        run.font.size = Pt(12.5)
        run.font.color.rgb = RGBColor(0x1E, 0x40, 0xAF) # Vibrant Blue
        run.font.bold = True
    elif level == 3:
        run.font.name = "Arial"
        run.font.size = Pt(11)
        run.font.color.rgb = RGBColor(0x33, 0x41, 0x55) # Slate
        run.font.bold = True
    return h

def add_callout_box(doc, text, title=""):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    cell = table.cell(0, 0)
    cell.width = Inches(6.8)
    set_cell_background(cell, "EFF6FF") # Soft Blue
    set_cell_margins(cell, top=120, bottom=120, left=180, right=180)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    if title:
        rt = p.add_run(f"{title}\n")
        rt.font.name = "Arial"
        rt.font.size = Pt(10)
        rt.font.bold = True
        rt.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A)
    
    run = p.add_run(text)
    run.font.name = "Arial"
    run.font.size = Pt(9.5)
    run.font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def format_proposal_table(table, col_widths, headers, data):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    
    # Header Row
    hdr_cells = table.rows[0].cells
    for i, title in enumerate(headers):
        hdr_cells[i].text = title
        hdr_cells[i].width = col_widths[i]
        set_cell_background(hdr_cells[i], "1E3A8A") # Professional Navy
        set_cell_margins(hdr_cells[i], top=120, bottom=120, left=140, right=140)
        p = hdr_cells[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.runs[0].font.name = "Arial"
        p.runs[0].font.bold = True
        p.runs[0].font.size = Pt(9.5)
        p.runs[0].font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        
    # Data Rows
    for r_idx, row_data in enumerate(data):
        row_cells = table.add_row().cells
        bg_color = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"
        for c_idx, val in enumerate(row_data):
            row_cells[c_idx].text = val
            row_cells[c_idx].width = col_widths[c_idx]
            set_cell_background(row_cells[c_idx], bg_color)
            set_cell_margins(row_cells[c_idx], top=80, bottom=80, left=120, right=120)
            p = row_cells[c_idx].paragraphs[0]
            if len(p.runs) > 0:
                p.runs[0].font.name = "Arial"
                p.runs[0].font.size = Pt(9)
                p.runs[0].font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)

def build_client_proposal():
    doc = docx.Document()
    
    # 0.8 in margins for clean presentation
    for s in doc.sections:
        s.top_margin = Inches(0.8)
        s.bottom_margin = Inches(0.8)
        s.left_margin = Inches(0.8)
        s.right_margin = Inches(0.8)
        
    # Title Block
    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(0)
    p_title.paragraph_format.space_after = Pt(2)
    r_title = p_title.add_run("Technical Implementation Proposal")
    r_title.font.name = "Arial"
    r_title.font.size = Pt(22)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(0x0F, 0x29, 0x4A)
    
    p_sub = doc.add_paragraph()
    p_sub.paragraph_format.space_after = Pt(12)
    r_sub = p_sub.add_run("Self-Hosted Jitsi Meet & Automated Screen Recording Infrastructure\nMigration from 8x8 JaaS | Host + 500 Attendees Webinar Architecture")
    r_sub.font.name = "Arial"
    r_sub.font.size = Pt(11)
    r_sub.font.color.rgb = RGBColor(0x47, 0x55, 0x69)
    
    # Divider
    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_after = Pt(8)
    r_div = p_div.add_run("―" * 58)
    r_div.font.color.rgb = RGBColor(0xCB, 0xD5, 0xE1)
    
    # 1. Executive Summary
    add_styled_heading(doc, "1. Executive Summary & Project Goal", level=1)
    p = doc.add_paragraph(
        "This proposal outlines the implementation plan and server infrastructure requirements for transitioning your dedicated platform from 8x8 JaaS (Jitsi as a Service) to your own self-hosted, private Jitsi Meet cluster."
    )
    p.paragraph_format.space_after = Pt(6)
    
    add_callout_box(
        doc,
        "Target Operational Scenario:\n"
        "• 1 Host (Speaker/Instructor) broadcasting audio, webcam, and high-definition 1080p screen share slides.\n"
        "• 500 Attendees (Students/Audience) joining via your platform in listen-only mode with active chat.\n"
        "• Jibri Server-Side Recorder: A dedicated recording engine that joins automatically to record the Host's presentation slides in crisp 1080p MP4 without any UI clutter, popups, or attendee tiles.",
        title="Project Scope Summary"
    )

    # 2. How the System Works in Plain English
    add_styled_heading(doc, "2. How the System Works (Plain English)", level=1)
    p = doc.add_paragraph(
        "Instead of routing through 8x8's third-party cloud, the entire video conference and recording run directly on your dedicated server infrastructure:"
    )
    p.paragraph_format.space_after = Pt(4)
    
    steps = [
        ("The Host (Presenter): ", "The speaker connects from your web or mobile app, sharing their screen (presentation slides, demo, or video). Their stream travels securely to your Jitsi Videobridge (the media router)."),
        ("The 500 Audience Members: ", "Attendees join via your web app. To ensure the call is completely smooth and lag-free, attendees join with microphones and webcams muted. They receive the presenter's video and screen share with near-instant WebRTC speed (<200ms latency)."),
        ("The Jibri Recording Bot: ", "A private, automated recording bot joins the meeting behind the scenes. It acts as an automated 1080p virtual studio camera, locking onto the host's screen share and recording both the presentation and the host's audio directly into an MP4 file on the server.")
    ]
    for s_title, s_desc in steps:
        bp = doc.add_paragraph(style='List Bullet')
        bp.paragraph_format.space_after = Pt(3)
        r1 = bp.add_run(s_title)
        r1.font.bold = True
        bp.add_run(s_desc)
        
    p_iso = doc.add_paragraph(
        "Key Innovation: The recorder bot is configured with 'stream isolation'. It deliberately ignores the 500 viewers and pulls only the host's screen share. This keeps server CPU low and guarantees that the recording is 100% focused on the lecture slides."
    )
    p_iso.paragraph_format.space_before = Pt(4)
    p_iso.paragraph_format.space_after = Pt(8)

    # 3. Server Requirements
    add_styled_heading(doc, "3. Server Hardware & Infrastructure Requirements", level=1)
    p_srv = doc.add_paragraph(
        "Hosting 500 live attendees watching a high-definition presentation is similar to broadcasting 500 high-speed video streams simultaneously. The server must have sufficient CPU power and, most importantly, high network bandwidth."
    )
    p_srv.paragraph_format.space_after = Pt(6)
    
    add_styled_heading(doc, "Recommended Deployment: Single Dedicated Bare-Metal Server", level=2)
    p_rec = doc.add_paragraph(
        "We recommend deploying on a single high-performance dedicated bare-metal server (such as Hetzner AX102, OVH Advance, or an equivalent dedicated server). This provides maximum reliability, lowest monthly operational complexity, and eliminates cloud virtualization overhead."
    )
    p_rec.paragraph_format.space_after = Pt(4)
    
    table_specs = doc.add_table(rows=1, cols=3)
    headers_specs = ["Resource", "Specification", "Why It Matters for Your Platform"]
    widths_specs = [Inches(1.8), Inches(2.2), Inches(2.8)]
    data_specs = [
        ["Processor (CPU)", "16 Cores / 32 Threads\n(AMD EPYC, Ryzen 9, or Intel Xeon)", "Handles real-time WebRTC media routing to 500 users + real-time 1080p MP4 video encoding."],
        ["Memory (RAM)", "64 GB DDR4/DDR5 ECC", "Provides ample room for 500 simultaneous user connections and isolated browser memory for the recorder."],
        ["Network Card (Port)", "10 Gbps Port (Unmetered)\n(Minimum 2.5 Gbps dedicated)", "CRITICAL: 500 users streaming video consume 1.3 to 2.0 Gbps of outbound bandwidth. Standard 1 Gbps ports will cause freezing."],
        ["Primary Storage", "500 GB NVMe SSD", "High-speed drive for Linux OS, Docker containers, and database logs."],
        ["Recording Storage", "1 TB NVMe SSD (Dedicated buffer)", "Captures raw 1080p video without delay (~1.85 GB per 1-hour session). Can auto-upload to S3/MinIO."],
        ["Operating System", "Ubuntu Server 24.04 LTS (64-bit)", "Stable, modern Linux environment supporting high-performance WebRTC socket networking."]
    ]
    format_proposal_table(table_specs, widths_specs, headers_specs, data_specs)
    
    add_styled_heading(doc, "Recommended Hosting Providers", level=2)
    providers = [
        ("Hetzner (Dedicated AX-Series): ", "Excellent performance-to-price ratio with 1Gbps / 10Gbps unmetered uplink options in Europe and US."),
        ("OVHcloud (Advance / High-Grade): ", "Enterprise anti-DDoS protection and dedicated 10Gbps unmetered network pipelines."),
        ("AWS EC2 / Google Cloud: ", "Instances like c6i.8xlarge or c5n.9xlarge (provides high network burst, but outbound bandwidth transfer fees will apply).")
    ]
    for pr_title, pr_desc in providers:
        bp = doc.add_paragraph(style='List Bullet')
        bp.paragraph_format.space_after = Pt(2)
        r1 = bp.add_run(pr_title)
        r1.font.bold = True
        bp.add_run(pr_desc)

    # 4. Network Bandwidth Calculation
    add_styled_heading(doc, "4. Network Bandwidth & Capacity Breakdown", level=1)
    p_bw = doc.add_paragraph("To understand why a 10 Gbps network connection is required:")
    p_bw.paragraph_format.space_after = Pt(4)
    
    table_bw = doc.add_table(rows=1, cols=3)
    headers_bw = ["Traffic Stream", "Bitrate / Speed", "Total Server Bandwidth"]
    widths_bw = [Inches(2.2), Inches(2.0), Inches(2.6)]
    data_bw = [
        ["Host Presenter Ingest", "4.5 Mbps (Screen + Webcam + Mic)", "4.5 Mbps inbound to server"],
        ["500 Audience Downloads", "2.5 to 3.8 Mbps per viewer", "1.3 Gbps to 1.9 Gbps outbound from server"],
        ["Jibri Recorder Downlink", "2.6 Mbps (Screen + Audio only)", "2.6 Mbps internal loopback"],
        ["Recommended Server Port", "10 Gbps Line", "Safely absorbs 2 Gbps peak with 80% headroom"]
    ]
    format_proposal_table(table_bw, widths_bw, headers_bw, data_bw)

    # 5. Integration
    add_styled_heading(doc, "5. How This Integrates with Your Existing Platform", level=1)
    p_int = doc.add_paragraph(
        "Transitioning from 8x8 JaaS to your self-hosted server is designed to be a smooth, drop-in replacement with zero disruption to your end-users:"
    )
    p_int.paragraph_format.space_after = Pt(4)
    
    int_points = [
        ("Frontend Web/Mobile App: ", "Your existing Jitsi IFrame API or React SDK integration remains unchanged. You simply change the server address from '8x8.vc/<jaas_app_id>' to your private domain (e.g., 'meet.yourplatform.com')."),
        ("User Authentication (JWT): ", "The system uses the same industry-standard JWT token authentication as JaaS. Your backend continues generating signed tokens, specifying who is the Host (with recording controls) and who is an Attendee."),
        ("One-Click or Automated Recording: ", "The Host can start recording with one click from the meeting menu, or your platform backend can trigger the recording automatically when the lecture begins."),
        ("Completed Recordings: ", "Recordings are saved directly to the server as clean MP4 files (~1.85 GB/hour). We can configure an automated hook to push the MP4 file to AWS S3, Cloudflare R2, or your platform storage immediately upon call completion.")
    ]
    for ip_title, ip_desc in int_points:
        bp = doc.add_paragraph(style='List Bullet')
        bp.paragraph_format.space_after = Pt(3)
        r1 = bp.add_run(ip_title)
        r1.font.bold = True
        bp.add_run(ip_desc)

    # 6. Implementation Plan & Milestones
    add_styled_heading(doc, "6. Implementation Milestones & Deliverables", level=1)
    table_m = doc.add_table(rows=1, cols=3)
    headers_m = ["Phase", "Key Deliverables", "Timeline"]
    widths_m = [Inches(1.5), Inches(3.8), Inches(1.5)]
    data_m = [
        ["Phase 1:\nServer Setup", "• Provision bare-metal server (16 Cores, 64GB, 10Gbps NIC)\n• Optimize Linux network socket buffers & file descriptors\n• Install Docker and production container runtime", "Day 1 – 2"],
        ["Phase 2:\nJitsi Core & SSL", "• Deploy Jitsi cluster (Web, Prosody, Jicofo, JVB SFU)\n• Attach custom domain & Let's Encrypt SSL certificates\n• Configure JWT security matching existing JaaS tokens", "Day 3 – 4"],
        ["Phase 3:\nJibri Screen Recorder", "• Deploy Jibri recording daemon with virtual X11 & PulseAudio\n• Configure screen-share auto-pinning and stream isolation\n• Apply clean broadcast style (hides chat, badges, popups)", "Day 5 – 6"],
        ["Phase 4:\nTesting & Verification", "• Test host screen sharing with 1080p 30fps recording quality\n• Verify host disconnect resilience and audio-video sync\n• Load-test WebRTC packet forwarding for large attendance", "Day 7 – 8"],
        ["Phase 5:\nPlatform Cutover", "• Point platform frontend IFrame API to new server\n• Production launch, monitoring setup, and documentation handover", "Day 9 – 10"]
    ]
    format_proposal_table(table_m, widths_m, headers_m, data_m)

    # 7. Frequently Asked Questions
    add_styled_heading(doc, "7. Frequently Asked Questions (FAQ)", level=1)
    faqs = [
        ("Will the 500 participants experience buffering or lag?", 
         "No. Because attendees join with microphones and webcams muted, they only consume a single downstream WebRTC video stream. With our 10 Gbps network configuration and kernel UDP buffer tuning, media latency is sub-second (<200ms), far faster than traditional HLS streaming (which typically lags by 10–30 seconds)."),
        
        ("What happens if the host's internet drops temporarily?", 
         "Our Jibri recorder runs entirely on the server. If the host drops off due to a local Wi-Fi blip and reconnects 10 seconds later, the server-side recording continues without terminating or corrupting the MP4 file."),
         
        ("Can we customize the branding on the video screen?", 
         "Yes. Because this is your private, self-hosted deployment, all watermarks, logos, background colors, and welcome screens can be fully branded with your organization's identity.")
    ]
    for q, a in faqs:
        p_q = doc.add_paragraph()
        p_q.paragraph_format.space_before = Pt(4)
        p_q.paragraph_format.space_after = Pt(1)
        r_q = p_q.add_run(f"Q: {q}")
        r_q.font.name = "Arial"
        r_q.font.bold = True
        r_q.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A)
        
        p_a = doc.add_paragraph()
        p_a.paragraph_format.space_after = Pt(6)
        r_a = p_a.add_run(f"A: {a}")
        r_a.font.name = "Arial"
        r_a.font.color.rgb = RGBColor(0x33, 0x41, 0x55)

    # Save documents
    out_docx_1 = "/home/saimon/Office/Jitsi/docs/Client_Proposal_Jitsi_SelfHosted_Recording.docx"
    out_docx_2 = "/home/saimon/Office/Jitsi/Client_Proposal_Jitsi_SelfHosted_Recording.docx"
    doc.save(out_docx_1)
    doc.save(out_docx_2)
    print("Successfully built client proposal docx!")

if __name__ == "__main__":
    build_client_proposal()

import os
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
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
        run.font.size = Pt(16)
        run.font.color.rgb = RGBColor(0x0F, 0x29, 0x4A) # Deep Navy
        run.font.bold = True
    elif level == 2:
        run.font.size = Pt(13)
        run.font.color.rgb = RGBColor(0x1E, 0x40, 0xAF) # Blue
        run.font.bold = True
    elif level == 3:
        run.font.size = Pt(11)
        run.font.color.rgb = RGBColor(0x33, 0x41, 0x55) # Slate
        run.font.bold = True
    return h

def add_code_block(doc, code_text):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    cell = table.cell(0, 0)
    cell.width = Inches(6.5)
    set_cell_background(cell, "F1F5F9") # Slate light
    set_cell_margins(cell, top=120, bottom=120, left=180, right=180)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    run = p.add_run(code_text.strip())
    run.font.name = "Consolas"
    run.font.size = Pt(8.5)
    run.font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)
    
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def format_table_headers_and_borders(table, col_widths, headers, data):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    
    # Header Row
    hdr_cells = table.rows[0].cells
    for i, title in enumerate(headers):
        hdr_cells[i].text = title
        hdr_cells[i].width = col_widths[i]
        set_cell_background(hdr_cells[i], "1E3A8A") # Dark Navy
        set_cell_margins(hdr_cells[i], top=120, bottom=120, left=150, right=150)
        p = hdr_cells[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
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
                p.runs[0].font.size = Pt(8.5)
                p.runs[0].font.color.rgb = RGBColor(0x1E, 0x29, 0x3B)
                
    doc_p = table._tbl.getparent()

def build_document():
    doc = docx.Document()
    
    # Page setup - 1 inch margins
    sections = doc.sections
    for s in sections:
        s.top_margin = Inches(0.8)
        s.bottom_margin = Inches(0.8)
        s.left_margin = Inches(0.8)
        s.right_margin = Inches(0.8)
        
    # Document Title Block
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(0)
    title_p.paragraph_format.space_after = Pt(2)
    title_run = title_p.add_run("Server Implementation & Infrastructure Requirements")
    title_run.font.name = "Arial"
    title_run.font.size = Pt(20)
    title_run.font.bold = True
    title_run.font.color.rgb = RGBColor(0x0F, 0x29, 0x4A)
    
    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(12)
    sub_run = sub_p.add_run("Self-Hosted Jitsi Meet & Jibri Screen Recording (Migration from 8x8 JaaS)\nScenario: 1 Host (Screen Share + Audio) + 500 Attendees | Output: 1080p MP4")
    sub_run.font.name = "Arial"
    sub_run.font.size = Pt(11)
    sub_run.font.color.rgb = RGBColor(0x47, 0x55, 0x69)
    
    # Divider line
    p_div = doc.add_paragraph()
    p_div.paragraph_format.space_after = Pt(8)
    r_div = p_div.add_run("―" * 58)
    r_div.font.color.rgb = RGBColor(0xCB, 0xD5, 0xE1)
    
    # 1. Overview
    add_styled_heading(doc, "1. Target Workload & Traffic Overview", level=1)
    p = doc.add_paragraph(
        "This specification outlines the server hardware, networking, kernel tuning, and configuration required to deploy a self-hosted Jitsi Meet cluster with dedicated Jibri server-side recording, replacing 8x8 JaaS on your dedicated platform."
    )
    p.paragraph_format.space_after = Pt(6)
    
    bullets = [
        ("1 Host (Presenter): ", "Streams 1080p screen share (~3.0 Mbps), webcam (~1.5 Mbps), and audio (~48 kbps). Ingress to server is ~4.5 Mbps."),
        ("500 Attendees (Viewers): ", "Connect in listen-only mode with camera and microphone muted. Each attendee receives the 1080p presentation stream. Outbound WebRTC egress from JVB peaks at 1.25 Gbps to 1.90 Gbps."),
        ("Jibri Recorder: ", "Runs as a headless containerized participant with channelLastN=1 (ignoring the 500 attendees). It auto-pins the host screen share, capturing clean 1080p 30fps video and PulseAudio sound into an MP4 file.")
    ]
    for b_title, b_desc in bullets:
        bp = doc.add_paragraph(style='List Bullet')
        bp.paragraph_format.space_after = Pt(3)
        r1 = bp.add_run(b_title)
        r1.font.bold = True
        bp.add_run(b_desc)

    # 2. Server Requirements
    add_styled_heading(doc, "2. Server Hardware Specifications", level=1)
    p2 = doc.add_paragraph(
        "Because 500 concurrent participants downloading a 1080p screen share generate between 1.25 Gbps and 1.90 Gbps of outbound WebRTC UDP traffic, the server hosting Jitsi Videobridge (JVB) requires a dedicated 10 Gbps network interface."
    )
    p2.paragraph_format.space_after = Pt(6)
    
    add_styled_heading(doc, "Option A: Recommended Single Bare-Metal Node (All-in-One)", level=2)
    p_opt_a = doc.add_paragraph(
        "All services (Nginx, Prosody, Jicofo, JVB, and Jibri) run on one high-performance bare-metal host (e.g., Hetzner AX102, OVH Advance, or AWS bare-metal)."
    )
    p_opt_a.paragraph_format.space_after = Pt(4)
    
    table_a = doc.add_table(rows=1, cols=3)
    headers_a = ["Hardware Component", "Minimum Specification", "Technical Purpose / Rationale"]
    widths_a = [Inches(1.8), Inches(2.2), Inches(2.5)]
    data_a = [
        ["Processor (CPU)", "16 Cores / 32 Threads\n(AMD EPYC, Ryzen 9, Intel Xeon)", "Handles JVB WebRTC packet routing, Chromium headless rendering, and real-time x264 FFmpeg encoding."],
        ["System RAM", "64 GB DDR4/DDR5 ECC", "Buffers 500 WebRTC peer connections and isolates Chromium browser execution."],
        ["Network Card (NIC)", "10 Gbps Port (Dedicated/Unmetered)", "CRITICAL: Outbound WebRTC traffic to 500 users is 1.3 - 2.0 Gbps. Standard 1 Gbps ports will bottleneck."],
        ["Storage (OS & Apps)", "500 GB NVMe SSD (PCIe Gen4)", "Fast system boot, container images, and temporary cache."],
        ["Storage (Recordings)", "1 TB NVMe SSD (Dedicated mount)", "Dedicated sequential write buffer for 1080p MP4 recordings (~1.85 GB/hour)."],
        ["Operating System", "Ubuntu Server 22.04 or 24.04 LTS", "Modern WebRTC socket support and current Docker Compose V2 runtime."]
    ]
    format_table_headers_and_borders(table_a, widths_a, headers_a, data_a)
    
    add_styled_heading(doc, "Option B: Distributed 3-Node Cluster", level=2)
    p_opt_b = doc.add_paragraph("Splits the signaling, media routing, and video encoding across three specialized servers:")
    p_opt_b.paragraph_format.space_after = Pt(4)
    
    table_b = doc.add_table(rows=1, cols=4)
    headers_b = ["Node Role", "vCPU / RAM", "Network Port", "Assigned Workload"]
    widths_b = [Inches(1.8), Inches(1.5), Inches(1.3), Inches(1.9)]
    data_b = [
        ["Node 1: Control Plane", "4 vCPU / 8 GB RAM", "1 Gbps NIC", "Nginx Web SSL, Prosody XMPP (JWT Auth), and Jicofo."],
        ["Node 2: Media Bridge (JVB)", "16 vCPU / 32 GB RAM", "10 Gbps NIC (Crucial)", "Routes WebRTC audio/video/screen packets to 500 users."],
        ["Node 3: Recording (Jibri)", "8 vCPU / 16 GB RAM", "1 Gbps NIC + 1TB NVMe", "Runs headless Chrome, PulseAudio, and FFmpeg encoder."]
    ]
    format_table_headers_and_borders(table_b, widths_b, headers_b, data_b)

    # 3. Container Resource Limits
    add_styled_heading(doc, "3. Container Resource Limits & Docker Shared Memory", level=1)
    p3 = doc.add_paragraph(
        "To ensure system stability, configure CPU and RAM boundaries in docker-compose.yml and jibri.yml. Note that Jibri requires shm_size: '4gb' to prevent Chromium from crashing during 1080p decoding."
    )
    p3.paragraph_format.space_after = Pt(4)
    
    compose_snippet = """services:
  jvb:
    deploy:
      resources:
        limits:
          cpus: '12.0'
          memory: 16384M
        reservations:
          cpus: '4.0'
          memory: 4096M

  jibri:
    shm_size: '4gb' # CRITICAL: Chromium crashes without at least 2GB-4GB shared memory
    deploy:
      resources:
        limits:
          cpus: '4.0'
          memory: 8192M
        reservations:
          cpus: '2.0'
          memory: 4096M"""
    add_code_block(doc, compose_snippet)

    # 4. Network Firewall
    add_styled_heading(doc, "4. Network Firewall & Port Matrix", level=1)
    table_ports = doc.add_table(rows=1, cols=4)
    headers_ports = ["Port", "Protocol", "Accessibility", "Purpose"]
    widths_ports = [Inches(1.0), Inches(1.0), Inches(2.0), Inches(2.5)]
    data_ports = [
        ["80", "TCP", "Public (0.0.0.0/0)", "HTTP Web redirection & Let's Encrypt renewal"],
        ["443", "TCP", "Public (0.0.0.0/0)", "HTTPS Web client, WebSockets, and BOSH"],
        ["10000", "UDP", "Public (0.0.0.0/0)", "WebRTC audio/video media streams via JVB (Mandatory)"],
        ["8443", "TCP", "Internal / Docker", "Internal Nginx reverse proxy loopback"],
        ["5222", "TCP", "Internal / Docker", "Prosody XMPP client signaling"],
        ["5347", "TCP", "Internal / Docker", "Prosody XMPP component protocol"],
        ["2222", "TCP", "Internal / Docker", "Jibri REST health check daemon"]
    ]
    format_table_headers_and_borders(table_ports, widths_ports, headers_ports, data_ports)

    # 5. Linux Kernel Tuning
    add_styled_heading(doc, "5. Host Linux Kernel & Socket Buffer Tuning", level=1)
    p_sysctl = doc.add_paragraph(
        "A standard Linux kernel drops UDP packets when routing media to >100 participants. Deploy the following configuration to /etc/sysctl.d/99-jitsi-500users.conf and apply with 'sudo sysctl --system':"
    )
    p_sysctl.paragraph_format.space_after = Pt(4)
    
    sysctl_snippet = """# Socket receive & send buffer maximums for WebRTC
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.rmem_default = 33554432
net.core.wmem_default = 33554432

# Buffer memory allocation for UDP queues
net.ipv4.udp_mem = 65536 131072 262144

# System-wide file descriptor limit for 500+ WebRTC peer sockets
fs.file-max = 2097152

# Ephemeral port range expansion
net.ipv4.ip_local_port_range = 1024 65535

# Backlog queue limits
net.core.netdev_max_backlog = 100000
net.core.somaxconn = 65535"""
    add_code_block(doc, sysctl_snippet)
    
    p_limits = doc.add_paragraph("In /etc/security/limits.conf, expand open file limits:")
    p_limits.paragraph_format.space_after = Pt(2)
    limits_snippet = """* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535"""
    add_code_block(doc, limits_snippet)

    # 6. Step-by-Step Implementation Runbook
    add_styled_heading(doc, "6. Step-by-Step Server Setup Runbook", level=1)
    
    add_styled_heading(doc, "Step 1: Install Docker & Docker Compose V2", level=2)
    p_step1 = doc.add_paragraph("Execute the following commands on the Ubuntu/Debian server:")
    p_step1.paragraph_format.space_after = Pt(2)
    docker_inst = """sudo apt update && sudo apt upgrade -y
sudo apt install -y curl gnupg lsb-release apt-transport-https ca-certificates
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker"""
    add_code_block(doc, docker_inst)

    add_styled_heading(doc, "Step 2: Configure Environment Variables (jitsi/.env)", level=2)
    p_step2 = doc.add_paragraph("Configure the public domain, ports, JWT authentication, and Jibri settings in jitsi/.env:")
    p_step2.paragraph_format.space_after = Pt(2)
    env_snippet = """PUBLIC_URL=https://meet.yourplatform.com
HTTP_PORT=80
HTTPS_PORT=443
JVB_PORT=10000

COMPOSE_FILE=docker-compose.yml:jibri.yml
JIBRI_RECORDING_DIR=/storage/recordings

ENABLE_RECORDING=1
ENABLE_SERVICE_RECORDING=1
JIBRI_BREWERY_MUC=jibribrewery

JIBRI_RECORDER_USER=recorder
JIBRI_RECORDER_PASSWORD=strong_recorder_password
JIBRI_XMPP_USER=jibri
JIBRI_XMPP_PASSWORD=strong_jibri_password

# JWT Authentication matching your platform backend
ENABLE_AUTH=1
AUTH_TYPE=jwt
JWT_APP_ID=your_platform_app_id
JWT_APP_SECRET=your_platform_app_secret
JWT_ACCEPTED_ISSUERS=your_platform_backend
JWT_ACCEPTED_AUDIENCES=jitsi

CHROMIUM_FLAGS=--autoplay-policy=no-user-gesture-required,--use-fake-ui-for-media-stream,--start-maximized,--kiosk,--enabled,--host-resolver-rules=MAP meet.yourplatform.com web:8443"""
    add_code_block(doc, env_snippet)

    add_styled_heading(doc, "Step 3: Configure Jibri for Host Screen Recording Only", level=2)
    p_step3 = doc.add_paragraph("To protect Jibri from 500 audience streams and guarantee clean slide capture, Jibri joins with conference URL parameters:")
    p_step3.paragraph_format.space_after = Pt(2)
    jibri_conf = """// Stream isolation: requests only 1 video stream (the host screen)
config.channelLastN = 1;
config.disableTileView = true;
config.disableAutoPinOnScreenShare = false;

// Clean broadcast: hides toolbars, popups, and badges from MP4
config.hideConferenceSubject = true;
config.hideConferenceTimer = true;
config.disableNotifications = true;
config.disableChat = true;
interfaceConfig.TOOLBAR_BUTTONS = [];
interfaceConfig.SHOW_JITSI_WATERMARK = false;"""
    add_code_block(doc, jibri_conf)

    add_styled_heading(doc, "Step 4: Update Dedicated Platform Frontend (Replacing JaaS)", level=2)
    p_step4 = doc.add_paragraph("In your platform web application, update the Jitsi IFrame / React initialization:")
    p_step4.paragraph_format.space_after = Pt(2)
    fe_code = """const domain = "meet.yourplatform.com";
const options = {
    roomName: "webinar-hall-500",
    width: "100%",
    height: "100%",
    parentNode: document.querySelector("#jitsi-container"),
    jwt: clientBackendGeneratedJWT,
    configOverwrite: {
        startWithAudioMuted: !isHost, // 500 attendees start muted
        startWithVideoMuted: !isHost, // 500 attendees start with camera off
        channelLastN: 2,              // Viewers receive screen share + presenter cam
        disableAutoPinOnScreenShare: false
    },
    interfaceConfigOverwrite: {
        TOOLBAR_BUTTONS: isHost 
            ? ['microphone', 'camera', 'desktop', 'recording', 'chat', 'participants-pane', 'hangup']
            : ['chat', 'raisehand', 'hangup']
    }
};
const api = new JitsiMeetExternalAPI(domain, options);"""
    add_code_block(doc, fe_code)

    add_styled_heading(doc, "Step 5: Backend JWT Token Generation (Host vs. Viewers)", level=2)
    jwt_code = """// Host Presenter Token Payload:
{
  "context": {
    "user": { "name": "Host Presenter", "moderator": true },
    "features": { "recording": true }
  },
  "aud": "jitsi",
  "iss": "your_platform_backend",
  "sub": "meet.yourplatform.com",
  "room": "webinar-hall-500"
}

// 500 Attendees Token Payload:
{
  "context": {
    "user": { "name": "Attendee", "moderator": false },
    "features": { "recording": false }
  },
  "aud": "jitsi",
  "iss": "your_platform_backend",
  "sub": "meet.yourplatform.com",
  "room": "webinar-hall-500"
}"""
    add_code_block(doc, jwt_code)

    add_styled_heading(doc, "Step 6: Start Services & Health Checks", level=2)
    sh_run = """cd jitsi

# 1. Start all containers in background
docker compose up -d

# 2. Check running status (web, prosody, jicofo, jvb, jibri)
docker compose ps

# 3. Check Jibri health
docker exec jitsi-jibri-1 curl -s http://127.0.0.1:2222/jibri/api/v1.0/health
# Response: {"busyStatus":"IDLE","health":{"healthStatus":"HEALTHY"}}

# 4. Follow live recording logs when host starts recording
docker compose logs -f jibri"""
    add_code_block(doc, sh_run)

    # Output paths
    output_docx_1 = "/home/saimon/Office/Jitsi/docs/Jitsi_Meet_Server_Requirements_and_Implementation.docx"
    output_docx_2 = "/home/saimon/Office/Jitsi/Jitsi_Meet_Server_Requirements_and_Implementation.docx"
    os.makedirs("/home/saimon/Office/Jitsi/docs", exist_ok=True)
    doc.save(output_docx_1)
    doc.save(output_docx_2)
    print(f"Successfully generated DOCX at {output_docx_1} and {output_docx_2}")

if __name__ == "__main__":
    build_document()

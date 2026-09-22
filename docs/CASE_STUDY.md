# Technical Implementation Proposal
## Self-Hosted Jitsi Meet & Automated Screen Recording Infrastructure
### Migration from 8x8 JaaS | Host + 500 Attendees Webinar Architecture

---

## 1. Executive Summary & Project Goal

This proposal outlines the implementation plan and server infrastructure requirements for transitioning your dedicated platform from **8x8 JaaS (Jitsi as a Service)** to your own **self-hosted, private Jitsi Meet cluster with Jibri screen recording**.

### Target Operational Scenario
* **1 Host (Speaker / Instructor)**: Broadcasts HD webcam, microphone audio, and high-definition **1080p screen share slides**.
* **500 Attendees (Audience / Students)**: Connect via your dedicated web or mobile platform in listen-only mode (microphones and webcams muted), with active live chat.
* **Jibri Server-Side Recorder**: An automated recording engine that joins the room behind the scenes to capture the **Host's 1080p presentation slides** and clear audio into a studio-grade MP4 file, completely free of attendee tiles, popups, or chat overlays.

---

## 2. How the System Works (In Plain English)

Instead of sending video through 8x8's third-party cloud, the entire video conference and recording run directly on your private server:

1. **The Host (Presenter)**:
   The speaker connects from your web or mobile app, sharing their presentation slides and speaking to the audience. Their stream travels securely to your private Jitsi Videobridge (the media router).
2. **The 500 Audience Members**:
   Attendees join via your web app. To ensure the session is completely smooth and lag-free, attendees join with microphones and webcams muted. They receive the presenter's video and screen share with near-instant WebRTC speed (<200ms latency, far faster than traditional 15-second YouTube or HLS delays).
3. **The Jibri Recording Bot**:
   An automated recording bot joins behind the scenes. It acts as an automated 1080p virtual studio camera, locking onto the host's screen share and recording both the presentation and the host's audio directly into an MP4 file on the server.
   > **Stream Isolation Advantage**: The recorder is programmed to ignore all 500 viewers and pull only the host's screen share. This keeps server CPU low and guarantees that the recording is 100% focused on the lecture slides.

---

## 3. Server Hardware & Infrastructure Requirements

Hosting 500 live attendees watching a high-definition presentation is similar to broadcasting 500 high-speed video streams simultaneously. The server must have sufficient CPU power and, most importantly, **high network bandwidth**.

### Recommended Deployment: Single Dedicated Bare-Metal Server (All-in-One)
We recommend deploying on a single high-performance dedicated bare-metal server (such as Hetzner AX102, OVH Advance, or an equivalent dedicated server). This provides maximum reliability, zero virtualization lag, and simple ongoing maintenance.

| Resource | Specification | Why It Matters for Your Platform |
| :--- | :--- | :--- |
| **Processor (CPU)** | **16 Cores / 32 Threads**<br>(AMD EPYC, Ryzen 9, or Intel Xeon) | Handles real-time WebRTC media routing to 500 users + real-time 1080p MP4 video encoding simultaneously. |
| **Memory (RAM)** | **64 GB DDR4/DDR5 ECC** | Provides ample room for 500 simultaneous user connections and isolated browser memory for the recorder. |
| **Network Card (Port)** | **10 Gbps Port (Unmetered)**<br>*(Minimum 2.5 Gbps dedicated)* | **CRITICAL**: 500 users streaming video consume **1.3 to 2.0 Gbps** of outbound bandwidth. Standard 1 Gbps ports will cause buffering and freezing. |
| **Primary Storage** | **500 GB NVMe SSD** | High-speed drive for Linux OS, Docker containers, and database logs. |
| **Recording Storage** | **1 TB NVMe SSD** (Dedicated buffer) | Captures raw 1080p video without delay (~1.85 GB per 1-hour session). Can auto-upload to S3/MinIO. |
| **Operating System** | **Ubuntu Server 24.04 LTS (64-bit)** | Stable, modern Linux environment supporting high-performance WebRTC socket networking. |

### Recommended Hosting Providers
* **Hetzner (Dedicated AX-Series)**: Excellent performance-to-price ratio with 1Gbps / 10Gbps unmetered uplink options.
* **OVHcloud (Advance / High-Grade)**: Enterprise anti-DDoS protection and dedicated 10Gbps unmetered network pipelines.
* **AWS EC2 / Google Cloud**: Instances like `c6i.8xlarge` or `c5n.9xlarge` (high network burst capability, though outbound bandwidth egress costs apply).

---

## 4. Network Bandwidth & Capacity Breakdown

To understand why a 10 Gbps network connection is required:

| Traffic Stream | Bitrate / Speed | Total Server Bandwidth |
| :--- | :--- | :--- |
| **Host Presenter Ingest** | 4.5 Mbps (Screen + Webcam + Mic) | 4.5 Mbps inbound to server |
| **500 Audience Downloads** | 2.5 to 3.8 Mbps per viewer | **1.3 Gbps to 1.9 Gbps outbound from server** |
| **Jibri Recorder Downlink** | 2.6 Mbps (Screen + Audio only) | 2.6 Mbps internal loopback |
| **Recommended Server Port** | **10 Gbps Line** | Safely absorbs 2 Gbps peak with **80% headroom** |

---

## 5. How This Integrates with Your Existing Platform

Transitioning from 8x8 JaaS to your self-hosted server is designed to be a smooth, drop-in replacement with zero disruption to your end-users:

1. **Frontend Web / Mobile App**:
   Your existing Jitsi IFrame API or React SDK integration remains unchanged. You simply change the server address from `8x8.vc/<jaas_app_id>` to your private domain (e.g., `meet.yourplatform.com`).
2. **User Authentication (JWT)**:
   The system uses the same industry-standard JWT token authentication as JaaS. Your backend continues generating signed tokens, specifying who is the Host (with recording controls) and who is an Attendee.
3. **One-Click or Automated Recording**:
   The Host can start recording with one click from the meeting menu, or your platform backend can trigger the recording automatically when the lecture begins.
4. **Completed Recordings**:
   Recordings are saved directly to the server as clean MP4 files (~1.85 GB/hour). We can configure an automated hook to push the MP4 file to AWS S3, Cloudflare R2, or your platform storage immediately upon call completion.

---

## 6. Implementation Milestones & Deliverables

| Phase | Key Deliverables | Timeline |
| :--- | :--- | :--- |
| **Phase 1: Server Setup** | • Provision bare-metal server (16 Cores, 64GB, 10Gbps NIC)<br>• Optimize Linux network socket buffers & file descriptors<br>• Install Docker and production container runtime | Day 1 – 2 |
| **Phase 2: Jitsi Core & SSL** | • Deploy Jitsi cluster (Web, Prosody, Jicofo, JVB SFU)<br>• Attach custom domain & Let's Encrypt SSL certificates<br>• Configure JWT security matching existing JaaS tokens | Day 3 – 4 |
| **Phase 3: Jibri Screen Recorder** | • Deploy Jibri recording daemon with virtual X11 & PulseAudio<br>• Configure screen-share auto-pinning and stream isolation<br>• Apply clean broadcast style (hides chat, badges, popups) | Day 5 – 6 |
| **Phase 4: Testing & Verification** | • Test host screen sharing with 1080p 30fps recording quality<br>• Verify host disconnect resilience and audio-video sync<br>• Load-test WebRTC packet forwarding for large attendance | Day 7 – 8 |
| **Phase 5: Platform Cutover** | • Point platform frontend IFrame API to new server<br>• Production launch, monitoring setup, and documentation handover | Day 9 – 10 |

---

## 7. Frequently Asked Questions (FAQ)

**Q: Will the 500 participants experience buffering or lag?**  
**A:** No. Because attendees join with microphones and webcams muted, they only consume a single downstream WebRTC video stream. With our 10 Gbps network configuration and kernel UDP buffer tuning, media latency is sub-second (<200ms), far faster than traditional HLS streaming (which typically lags by 10–30 seconds).

**Q: What happens if the host's internet drops temporarily?**  
**A:** Our Jibri recorder runs entirely on the server. If the host drops off due to a local Wi-Fi blip and reconnects 10 seconds later, the server-side recording continues without terminating or corrupting the MP4 file.

**Q: Can we customize the branding on the video screen?**  
**A:** Yes. Because this is your private, self-hosted deployment, all watermarks, logos, background colors, and welcome screens can be fully branded with your organization's identity.

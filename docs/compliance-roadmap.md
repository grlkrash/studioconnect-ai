# StudioConnect AI – Compliance Roadmap

> **Standards Covered:**
> 1. GDPR (EU General Data Protection Regulation)
> 2. CCPA / CPRA (California Consumer Privacy/ Rights Act)
> 3. SOC 2 Type II (AICPA Trust Service Criteria)
>
> **Audience:** Engineering, Security, Product, Legal, & Executive teams
>
> **Version:** 2025-06-19

---

## 0  Legend & Methodology
| Phase | Timeline | Colour | Definition |
|-------|----------|--------|------------|
| 🟢 Immediate | 0-30 days | `#d1fade` | Closes critical gaps discovered in code review. |
| 🟡 Short-term | 30-90 days | `#fff8d3` | Foundational controls & policy work. |
| 🟠 Pre-audit | 90-120 days | `#ffe7d6` | Evidence collection & internal testing. |
| 🔵 Audit / Go-Live | 120-180 days | `#dce4ff` | External assessment & public attestation. |
| ♾️ Ongoing | Continuous | – | Activities that repeat or remain in force. |

All tasks are grouped by **standard** and **phase**. Each task lists an _owner_ and the _evidence_ required for auditors/regulators.

---

## 1  GDPR Roadmap
### 1.1 Immediate (🟢 0-30 days)
| # | Task | Owner | Evidence |
|---|------|-------|----------|
| G-1 | Enable *Storage Encryption* & *Require SSL* on Render Postgres. | DevOps | Screenshot of Render DB settings, TLS test logs. |
| G-2 | Implement `/privacy/export` & `/privacy/delete` endpoints (Server Actions + Supabase functions). | Backend | API source code, Postman test run, DB rows purged. |
| G-3 | Add Cookie / Tracking consent banner (granular). | Front-end | Screen recording, GA logs showing opt-in flag. |
| G-4 | Draft **Data Retention Schedule** & automate purge cron (call audio 30d, transcripts 90d, etc.). | Security Eng | PR # ‑ Retention script, cron logs. |
| G-5 | Create **Sub-processor Register** & sign vendor DPAs. | Legal | DPA PDFs, register in `/policies/sub-processors.md`. |

### 1.2 Short-term (🟡 30-90 days)
| G-6 | Appoint Data Protection Officer (internal or virtual). | Exec | Board minutes, DPO contract. |
| G-7 | Conduct Data Protection Impact Assessment (DPIA) for call recording & AI processing. | Product + Legal | DPIA document. |
| G-8 | Create Article 30 **Records of Processing Activities (RoPA)**. | Legal | RoPA spreadsheet. |
| G-9 | Implement consent logging table (`user_consents`). | Backend | DB schema, sample rows. |
| G-10 | Add "Right to Rectification" UI in profile settings. | Front-end | Screenshot & PR. |

### 1.3 Pre-audit (🟠 90-120 days)
| G-11 | Run GDPR Readiness Gap-Analysis workshop. | DPO | Meeting notes, updated roadmap. |
| G-12 | Table-top exercise: personal-data breach & 72-h notification draft. | Security Team | Exercise report. |
| G-13 | Verify SCC / Data Privacy Framework for US transfers. | Legal | SCC annexes, vendor certifications. |

### 1.4 Ongoing (♾️)
• Annual privacy training for all staff  
• Quarterly RoPA & Sub-processor review  
• Log & fulfil DSARs within 30 days  
• Test data-deletion jobs monthly  

---

## 2  CCPA / CPRA Roadmap
### 2.1 Immediate (🟢 0-30 days)
| # | Task | Owner | Evidence |
|---|------|-------|----------|
| C-1 | Display **"Do Not Sell/Share My Personal Information"** link in footer (all pages). | Front-end | Screenshot. |
| C-2 | Honour **Global Privacy Control (GPC)** header in `middleware/validateRequest.ts`. | Backend | Unit test showing 204 on GPC opt-out. |
| C-3 | Add `/privacy/opt-out` endpoint & store preference in `user_privacy`. | Backend | API docs, DB rows. |
| C-4 | Create **Consumer Request Log** (`privacy_requests` table). | Backend | Table schema, seed record. |

### 2.2 Short-term (🟡 30-90 days)
| C-5 | Update Privacy Policy: categories, purpose, retention, third-parties. | Legal | Published policy URL. |
| C-6 | Implement dual identity-verification flow (JWT + email OTP) for requests. | Backend | Security test record. |
| C-7 | Age 13-16 opt-in toggle for data sale/share. | Front-end | UI screenshot. |
| C-8 | Create metrics report (num. requests, median fulfilment) – CPRA §999.317(g). | Data Eng | Dashboard link. |

### 2.3 Pre-audit (🟠 90-120 days)
| C-9 | External legal review of CPRA compliance. | Legal | Memo & sign-off. |
| C-10 | Pen-test web flows for request endpoints. | Security Eng | Pen-test report. |

### 2.4 Ongoing (♾️)
• Fulfil consumer requests within 45 days (extend once)  
• Annual privacy policy refresh  
• Bi-annual training on CPRA new regs  

---

## 3  SOC 2 Type II Roadmap
### 3.1 Immediate (🟢 0-30 days)
| # | Task | Trust Service Criterion | Owner | Evidence |
|---|------|------------------------|-------|----------|
| S-1 | Centralised structured logging → Datadog/Loki. | CC7.4, CC5.2 | DevOps | Terraform plan, log screenshot. |
| S-2 | Nightly logical backups to S3 + quarterly restore test. | A1.2 | DevOps | Backup logs, restore ticket. |
| S-3 | Enforce MFA on Render, GitHub, Supabase. | CC6.1 | IT | Auth settings screenshot. |
| S-4 | Draft core policies (InfoSec, Change Mgmt, IR, Vendor, BCP). | CC1 series | Security Lead | Policies in `/policies/`. |
| S-5 | Define RBAC roles (admin, agent, client) via Supabase RLS. | CC6.2 | Backend | RLS script, test cases. |

### 3.2 Short-term (🟡 30-90 days)
| S-6 | Select auditor & sign Letter of Intent (audit window ≥3 months). | – | Exec | Signed LoI. |
| S-7 | Implement Change-Management workflow (GitHub PR template + 2 reviewers). | CC8.1 | Dev Ops | Merged PR template. |
| S-8 | Deploy vulnerability scanning (Dependabot + Snyk CLI). | CC7.1 | Dev Ops | Scan reports. |
| S-9 | Security Awareness training for all staff. | CC4.3 | HR | Attendance sheet. |
| S-10 | Complete Risk Assessment & Risk Register. | CC3.2 | Security Lead | Risk doc. |

### 3.3 Pre-audit (🟠 90-120 days)
| S-11 | Run BCP / DR test (failover Render DB). | A1.2, C1.2 | Dev Ops | Test report. |
| S-12 | Table-top Incident-Response drill. | CC7.3 | Security Team | Drill minutes. |
| S-13 | Collect evidence in GRC platform (Drata/Vanta/bytechek). | – | Security Lead | Evidence screenshots. |

### 3.4 Audit / Go-Live (🔵 120-180 days)
| S-14 | Auditor performs Type II period testing. | – | Auditor | Draft SOC 2 report. |
| S-15 | Address auditor Action Items & publish final report to clients. | – | Exec | Signed report PDF. |

### 3.5 Ongoing (♾️)
• Quarterly access review & terminations  
• Annual penetration test  
• Monthly vulnerability scan & patch within 30 days  
• Refresh policies annually & board re-approval  

---

## 4  Cross-Standard Controls
| Area | Control | Standards Covered |
|------|---------|-------------------|
| Encryption in transit & rest | TLS 1.2+, AES-256 Postgres, SSE-S3 | GDPR Art.32, CPRA §1798.150, SOC 2 CC6 |
| Access Control & MFA | RBAC, Supabase RLS, SCIM, MFA | All |
| Vendor Management | Sub-processor DPAs, SOC 2 reports from vendors | GDPR, SOC 2 |
| Incident Response | 24×7 pager, runbook, notifications | GDPR Art.33, SOC 2 CC7 |
| Logging & Monitoring | Centralised logs, alerting thresholds | SOC 2 CC7, GDPR security |
| Security & Privacy Training | Annual all-hands, onboarding module | All |
| Data Retention & Disposal | Policy + automation scripts | GDPR Art.5, CPRA data minimisation, SOC 2 A1 |

---

## 5  Will Immediate Steps Alone Deliver Compliance?
* **GDPR & CCPA/CPRA:** Immediate tasks address the most critical code-level gaps but you must also complete policy, documentation, and training requirements (**Short-term phase**) before claiming compliance.
* **SOC 2 Type II:** Compliance is demonstrated by an *external audit over time* (typically 3–12 months). Immediate steps start technical hardening but you need to implement and **evidence** all controls through the entire audit window.

> **Bottom line:** Immediate 🟢 tasks ≈ ~40 % of the total journey. Full compliance requires completing 🟡 and 🟠 tasks, maintaining ♾️ activities, and (for SOC 2) passing the auditor's examination.

---

## 6  Ownership Matrix
| Function | Primary Responsibilities |
|----------|-------------------------|
| Engineering | Encryption, backups, logging, retention scripts, API endpoints |
| Security | Policies, risk assessment, incident response, training, audit liaison |
| DevOps | CI/CD hardening, monitoring, infrastructure compliance |
| Product | Privacy-by-design, consent UX, feature DPIAs |
| Legal | DPAs, RoPA, policy review, GDPR/CPRA notices |
| Executive | Budget, strategic decisions, auditor engagement |

---

## 7  Useful References
* **GDPR:** EDPB Guidelines, ICO "GDPR compliance checklist"
* **CPRA:** California Regs Title 11, Article 3 – §7000-7304
* **SOC 2:** AICPA TSC 2017, Cloud Security Alliance CAIQ
* **Policy templates:** open-source PolicyKit SOC 2, GitHub compliance-as-code
* **Tools:** Drata, Vanta, bytechek, OneTrust, Osano, Iubenda

---

> **Next Action:** Review 🟢 tasks, assign owners, and create GitHub issues linked to this document. 
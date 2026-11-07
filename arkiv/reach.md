# Arkiv Reach & User Adoption

**Track Criterion:** Reach (25%)\
**Project:** Ephemeral — Decentralized Healthcare AI Clean Room & Marketplace

---

## 1. Who Is It For, and Would They Use It?

### Primary Stakeholders
1. **Academic Medical Centers & Research Hospitals:**
   * Institutions that publish open validation benchmarks, rare disease registries, and synthetic cohorts for clinical reproducibility.
   * **Their Problem Today:** Hospitals publish public data across fragmented channels (Google Drive, Zenodo, institutional FTPs, or behind gatekept forms). These repositories frequently suffer from dead links, unauthorized data mutations, and zero native monetization or compute bridges.
   * **Why They Use Ephemeral on Arkiv:** Ephemeral provides an immutable, decentralized catalog where clinical institutions retain cryptographic ownership (`ownedBy`) over their listings. Each entry provides rich schema profiles, verified record counts, and zero-download sample previews.
2. **Biotech Startups & Healthcare AI Researchers:**
   * ML engineers seeking validated open-source cohorts (e.g., HPLC thalassemia screening, cardiology ICU vitals, genomic variants) to benchmark diagnostic pipelines.
   * **Why They Use Ephemeral on Arkiv:** Researchers can query the entire decentralized marketplace with SQL-like precision (filtering by disease category, record count, and feature columns) without asking anyone for API access or permission.

---

## 2. Can They Try It Today?

**Yes — Ephemeral is live and fully interactive today across three layers:**

1. **Live Decentralized DApp on Ethereum Swarm & ENS:**
   * **Production Gateway:** [https://ephemeralglobal.eth.limo/app/#/marketplace](https://ephemeralglobal.eth.limo/app/#/marketplace)
   * **ENS Name:** `ephemeralglobal.eth`
2. **Live Arkiv Rabdi Integration:**
   * Anyone can visit the marketplace to see **ARKIV VERIFIED** datasets fetched directly from Rabdi testnet.
   * Users can click **"Download public dataset ↗"** to stream and assemble multi-part CSV data chunks directly from Arkiv into a clean CSV file in real time.
3. **Live Base Mainnet Escrow Settlement:**
   * Deployed smart contracts on **Base Mainnet** (`0x3348145B791245E149Efe0BD9d7f74B69191714a`) enabling native Circle USDC escrow funding for AI training jobs.

---

## 3. Post-Mumbai Development & Future Roadmap

We are committed to taking Ephemeral beyond the hackathon into clinical production:

* **Phase 1 (Post-Mumbai Month 1):** Mainnet Arkiv migration once Arkiv launches its production chain; automated sync pipelines for NIH (National Institutes of Health) public clinical trials.
* **Phase 2 (Month 2–3):** Federated multi-hospital learning queries across Arkiv entities; enabling AI builders to train models simultaneously across multiple hospital benchmarks.
* **Phase 3 (Month 4+):** Decentralized identity verification linking hospital NPI / accreditation numbers to their Arkiv owner wallets via ENS reverse resolution.

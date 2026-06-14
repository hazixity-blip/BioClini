# MedCode Translator

**Translate drug and disease names into every medical code system — instantly.**

A free, open-source tool for clinical researchers and biotech teams who need to bridge plain English terms to coding systems like ICD-10, RxNorm, NDC, SNOMED CT, MeSH, and ATC.

No backend. No login. No cost. Calls free public APIs directly from the browser.

🔗 **Live site:** `https://<your-username>.github.io/medcode`

---

## Features

- **Drug lookup** → RxNorm RXCUI, NDC, WHO ATC, SNOMED CT, MeSH
- **Disease lookup** → ICD-10-CM (multiple specificity levels), SNOMED CT, MeSH
- **Auto-detect** — figures out if your term is a drug or disease
- **One-click copy** for any individual code
- **Bulk lookup** — paste a list, get all codes in a table
- **CSV export** — download results for use in data queries
- **Deep links** — share a URL like `?q=metformin&type=drug`
- **Fully client-side** — no data leaves your browser

---

## Code systems

| System | Covers | Use case |
|--------|--------|----------|
| **ICD-10-CM** | Diseases & conditions | EHR billing, claims databases, epidemiology |
| **RxNorm (RXCUI)** | Drug concepts | Linking across EHR, pharmacy, claims |
| **NDC** | Specific drug products | Pharmacy claims, FDA drug identification |
| **SNOMED CT** | Clinical concepts (drugs + diseases) | HL7 FHIR, interoperability, clinical decision support |
| **MeSH** | Biomedical concepts | PubMed search, literature indexing |
| **ATC** | Drug classification | WHO drug utilization studies, pharmacoepidemiology |

---

## APIs used (all free, no auth required)

| API | Endpoint | Used for |
|-----|----------|---------|
| NLM RxNorm | `rxnav.nlm.nih.gov/REST` | RXCUI, drug name normalization, ATC crosswalk |
| NLM Clinical Tables | `clinicaltables.nlm.nih.gov/api` | ICD-10-CM codes, SNOMED CT search |
| NCBI E-utilities | `eutils.ncbi.nlm.nih.gov` | MeSH descriptor lookup |
| RxNorm NDC service | `rxnav.nlm.nih.gov/REST/rxcui/{id}/ndcs` | National Drug Codes |

---

## Deploy to GitHub Pages (5 minutes)

### Option A — GitHub web UI

1. Create a new repository (e.g. `medcode`)
2. Upload all four files: `index.html`, `style.css`, `api.js`, `app.js`
3. Go to **Settings → Pages**
4. Set source to **Deploy from a branch**, branch `main`, folder `/ (root)`
5. Click Save — your site is live at `https://<username>.github.io/medcode`

### Option B — Git command line

```bash
git clone https://github.com/<username>/medcode.git
cd medcode
# copy the four files here
git add .
git commit -m "Initial deploy"
git push origin main
# then enable Pages in Settings → Pages
```

### Option C — GitHub CLI

```bash
gh repo create medcode --public
cd medcode
# copy files here
git add . && git commit -m "Initial" && git push
gh api repos/:owner/medcode/pages -X POST -f source.branch=main -f source.path=/
```

---

## Local development

No build step needed. Just open `index.html` in a browser.

For CORS reasons, some APIs work better when served over HTTP rather than `file://`:

```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve .
```

Then open `http://localhost:8080`.

---

## Extending

### Add a new code system

1. In `api.js`, add a new `safe(async ...)` function that calls the API
2. Call it inside `lookup()` in parallel with the others
3. Push the result into the `codes` array via `buildDrugCodes()` or `buildDiseaseCodes()`
4. Add a CSS class for the badge color in `style.css` (follow the `.tag-*` pattern)

### Add ICD-11 live codes

The WHO ICD-11 API requires a free token. Add your token:

```js
// in api.js
const ICD11_TOKEN = 'your-token-here'; // get at: https://icd.who.int/icdapi
const getICD11 = safe(async (term) => {
  const res = await fetch(
    `https://id.who.int/icd/release/11/2024-01/mms/search?q=${encodeURIComponent(term)}&flatResults=true`,
    { headers: { 'Authorization': `Bearer ${ICD11_TOKEN}`, 'Accept-Language': 'en', 'API-Version': 'v2' } }
  );
  const data = await res.json();
  return data.destinationEntities?.[0] ?? null;
});
```

### Add OMIM (genetic disease IDs)

```js
// requires free OMIM API key: https://www.omim.org/api
const getOMIM = safe(async (term) => {
  const data = await fetchJSON(
    `https://api.omim.org/api/entry/search?search=${encodeURIComponent(term)}&format=json&apiKey=YOUR_KEY`
  );
  return data?.omim?.searchResponse?.entryList?.[0] ?? null;
});
```

---

## License

MIT — free to use, fork, and deploy.

---

## Contributing

PRs welcome. Priority areas:
- ICD-11 live integration (needs WHO API token flow)
- OMIM for genetic diseases
- LOINC for lab tests
- CPT codes for procedures
- Offline mode / service worker caching

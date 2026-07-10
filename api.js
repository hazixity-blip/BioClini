/**
 * api.js — MedCode Translator
 * Wraps public, no-auth-required APIs:
 *   - NLM RxNorm  (drugs)
 *   - OpenFDA     (NDC)
 *   - NLM Clinical Tables (ICD-10-CM)
 *   - SNOMED CT FHIR Browser
 *   - NLM MeSH
 */

const API = (() => {

  /* ── helpers ─────────────────────────────────────────────── */
  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json();
  }

  function safe(fn, label) {
    const tag = label || fn.name || 'call';
    return async (...args) => {
      try {
        const result = await fn(...args);
        console.log(`[MedCode] ${tag} succeeded:`, result);
        return result;
      } catch (e) {
        console.error(`[MedCode] ${tag} FAILED:`, e.message);
        return null;
      }
    };
  }

  /* ── RxNorm ──────────────────────────────────────────────── */
  const getRxNorm = safe(async (term) => {
    const BASE = 'https://rxnav.nlm.nih.gov/REST';
    // 1. find RXCUI
    const approx = await fetchJSON(`${BASE}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=5`);
    const candidates = approx?.approximateGroup?.candidate;
    if (!candidates?.length) return null;
    const rxcui = candidates[0].rxcui;
    const name  = candidates[0].name;
    const score = candidates[0].score;
    // lowered from 50 — many valid single-word drug names score 4-20 in this API
    if (parseInt(score) < 4) return null;

    // 2. get ATC and properties in parallel
    const [propData, atcData] = await Promise.all([
      fetchJSON(`${BASE}/rxcui/${rxcui}/properties.json`).catch(() => null),
      fetchJSON(`${BASE}/rxcui/${rxcui}/property.json?propName=ATC`).catch(() => null),
    ]);

    const atcCodes = atcData?.propConceptGroup?.propConcept?.map(p => p.propValue) ?? [];

    return {
      rxcui,
      name: propData?.properties?.name ?? name,
      synonym: propData?.properties?.synonym ?? '',
      atc: atcCodes,
    };
  });

  /* ── OpenFDA NDC ─────────────────────────────────────────── */
  const getNDC = safe(async (rxcui) => {
    const data = await fetchJSON(
      `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/ndcs.json`
    );
    const ndcs = data?.ndcGroup?.ndcList?.ndc ?? [];
    if (!ndcs.length) return [];
    // return up to 3, formatted
    return ndcs.slice(0, 3).map(n => {
      // format as XXXXX-XXXX-XX
      const clean = n.replace(/\D/g, '');
      return clean.length >= 9
        ? `${clean.slice(0,5)}-${clean.slice(5,9)}-${clean.slice(9)}`
        : n;
    });
  });

  /* ── DrugBank (via RxNorm cross-ref) ─────────────────────── */
  const getDrugBankId = safe(async (rxcui) => {
    const data = await fetchJSON(
      `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allrelated.json`
    );
    // DrugBank IDs appear as sourceConceptId with source=DRUGBANK
    const allConcepts = data?.allRelatedGroup?.conceptGroup ?? [];
    for (const group of allConcepts) {
      if (group.tty === 'SBD' || group.tty === 'SCD') {
        // drill into properties for drugbank
      }
    }
    // Separate, more targeted approach
    const propData = await fetchJSON(
      `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/allProperties.json?prop=codes`
    ).catch(() => null);
    const props = propData?.propConceptGroup?.propConcept ?? [];
    const db = props.find(p => p.propName === 'DrugBank');
    return db ? db.propValue : null;
  });

  /* ── SNOMED CT via NLM Value Set Authority ───────────────── */
  const getSNOMED = safe(async (term) => {
    const data = await fetchJSON(
      `https://clinicaltables.nlm.nih.gov/api/snomed_ct/v3/search?terms=${encodeURIComponent(term)}&maxList=3&df=code,display`
    );
    // returns [total, [codes], {}, [[code, display], ...]]
    if (!data || !data[3] || !data[3].length) return null;
    return data[3].map(row => ({ code: row[0], display: row[1] }));
  });

  /* ── ICD-10-CM ───────────────────────────────────────────── */
  const getICD10 = safe(async (term) => {
    const data = await fetchJSON(
      `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms=${encodeURIComponent(term)}&maxList=5&df=code,name`
    );
    if (!data || !data[3] || !data[3].length) return null;
    return data[3].slice(0, 4).map(row => ({ code: row[0], name: row[1] }));
  });

  /* ── MeSH via E-utilities ────────────────────────────────── */
  const getMeSH = safe(async (term) => {
    // Search MeSH by term
    const searchData = await fetchJSON(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=mesh&term=${encodeURIComponent(term)}[mesh]+OR+${encodeURIComponent(term)}[tiab]&retmax=1&retmode=json`
    );
    const ids = searchData?.esearchresult?.idlist;
    if (!ids?.length) return null;

    // Fetch summary
    const summaryData = await fetchJSON(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=mesh&id=${ids[0]}&retmode=json`
    );
    const summary = summaryData?.result?.[ids[0]];
    if (!summary) return null;

    return {
      uid: summary.ds_meshui || `D${ids[0].padStart(6,'0')}`,
      name: summary.ds_meshterms?.[0] || summary.ds_name || term,
      scope: summary.ds_scopenote || '',
    };
  });

  /* ── ICD-11 (unofficial browser fallback) ────────────────── */
  const getICD11 = safe(async (term) => {
    const data = await fetchJSON(
      `https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms=${encodeURIComponent(term)}&maxList=1&df=code,name`
    );
    // ICD-11 free API is auth-gated; we note this and link to browser
    return null; // placeholder — will show a link-out instead
  });

  /* ── Auto-detect: drug or disease? ──────────────────────── */
  const DRUG_HINTS = /tablet|capsule|mg|mcg|injection|syrup|hydrochloride|sodium|potassium|acid|mab|nib|vir|pril|statin|olol|sartan|cillin|mycin|cycline|azole|dipine|lukast|lukast|pam|lam|zepam|idone|prazole|tidine|bital|fenac|profen|codone|orphine|fentanyl|zocin|floxacin/i;

  async function detectType(term, hint) {
    if (hint === 'drug') return 'drug';
    if (hint === 'condition') return 'disease';
    if (DRUG_HINTS.test(term)) return 'drug';
    // try RxNorm AND ICD10 in parallel, pick whichever answers
    const [rx, icd] = await Promise.all([getRxNorm(term), getICD10(term)]);
    console.log('[MedCode] detectType — rx:', rx, 'icd:', icd);
    if (rx && !icd) return 'drug';
    if (icd && !rx) return 'disease';
    if (rx && icd) return 'drug'; // ambiguous — default to drug, user can override with the radio buttons
    return 'disease';
  }

  /* ── Main lookup ─────────────────────────────────────────── */
  async function lookup(term, hint = 'auto') {
    const type = await detectType(term, hint);

    if (type === 'drug') {
      const rx = await getRxNorm(term);
      if (!rx) return { type: 'drug', found: false, term };

      const [ndcs, meshData, snomedData] = await Promise.all([
        getNDC(rx.rxcui),
        getMeSH(rx.name || term),
        getSNOMED(rx.name || term),
      ]);

      return {
        type: 'drug',
        found: true,
        name: rx.name,
        term,
        codes: buildDrugCodes(rx, ndcs, meshData, snomedData),
      };
    } else {
      const [icd10, snomedData, meshData] = await Promise.all([
        getICD10(term),
        getSNOMED(term),
        getMeSH(term),
      ]);

      if (!icd10?.length && !snomedData?.length && !meshData) {
        return { type: 'disease', found: false, term };
      }

      const displayName = meshData?.name
        || snomedData?.[0]?.display
        || icd10?.[0]?.name
        || term;

      return {
        type: 'disease',
        found: true,
        name: displayName,
        term,
        codes: buildDiseaseCodes(icd10, snomedData, meshData),
      };
    }
  }

  function buildDrugCodes(rx, ndcs, mesh, snomed) {
    const codes = [];

    codes.push({
      system: 'RxNorm',
      tagClass: 'tag-rxnorm',
      code: rx.rxcui,
      label: 'RXCUI — RxNorm concept ID',
      desc: `${rx.name}${rx.synonym ? ' · ' + rx.synonym : ''}`,
      url: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${rx.rxcui}`,
    });

    if (rx.atc?.length) {
      codes.push({
        system: 'ATC',
        tagClass: 'tag-atc',
        code: rx.atc[0],
        label: 'WHO ATC classification code',
        desc: 'Anatomical Therapeutic Chemical — WHO classification',
        url: `https://www.whocc.no/atc_ddd_index/?code=${rx.atc[0]}`,
      });
    }

    if (ndcs?.length) {
      codes.push({
        system: 'NDC',
        tagClass: 'tag-ndc',
        code: ndcs[0],
        label: 'National Drug Code (FDA)',
        desc: ndcs.length > 1 ? `+${ndcs.length - 1} additional NDC(s): ${ndcs.slice(1).join(', ')}` : 'Primary product NDC',
        url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=`,
        allNdcs: ndcs,
      });
    }

    if (snomed?.length) {
      codes.push({
        system: 'SNOMED CT',
        tagClass: 'tag-snomed',
        code: snomed[0].code,
        label: 'SNOMED CT concept ID',
        desc: snomed[0].display,
        url: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${snomed[0].code}`,
      });
    }

    if (mesh) {
      codes.push({
        system: 'MeSH',
        tagClass: 'tag-mesh',
        code: mesh.uid,
        label: 'MeSH descriptor ID',
        desc: mesh.name,
        url: `https://meshb.nlm.nih.gov/record/ui?ui=${mesh.uid}`,
      });
    }

    return codes;
  }

  function buildDiseaseCodes(icd10, snomed, mesh) {
    const codes = [];

    if (icd10?.length) {
      icd10.forEach((item, i) => {
        codes.push({
          system: 'ICD-10-CM',
          tagClass: 'tag-icd',
          code: item.code,
          label: i === 0 ? 'ICD-10-CM — primary match' : 'ICD-10-CM — related code',
          desc: item.name,
          url: `https://icd10cmtool.cdc.gov/?fy=FY2024&q=${item.code}`,
        });
      });
    }

    if (snomed?.length) {
      snomed.slice(0, 2).forEach((item, i) => {
        codes.push({
          system: 'SNOMED CT',
          tagClass: 'tag-snomed',
          code: item.code,
          label: i === 0 ? 'SNOMED CT concept ID' : 'SNOMED CT — related',
          desc: item.display,
          url: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=${item.code}`,
        });
      });
    }

    if (mesh) {
      codes.push({
        system: 'MeSH',
        tagClass: 'tag-mesh',
        code: mesh.uid,
        label: 'MeSH descriptor ID',
        desc: mesh.name,
        url: `https://meshb.nlm.nih.gov/record/ui?ui=${mesh.uid}`,
      });
    }

    return codes;
  }

  return { lookup };
})();

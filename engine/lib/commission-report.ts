// Python do relatório de comissão (filtro, regras, abas e xlsx) vira CODE JS.
// Cada detector exige o corpo Workato; outro py_eval continua no stub.

function hasMarkers(python: string, markers: readonly string[]): boolean {
  return markers.every((marker) => python.includes(marker));
}

const FILTER_MARKERS = [
  'def _normalize_agents_from_input',
  'current_location_clean',
  'competency_start = datetime(year, month, 1)',
  'return {"new_rows": new_rows, "log": ""}',
] as const;

const PREPARE_MARKERS = [
  'worked_month_for_renewal',
  'renewal_only_positions = {"Concierge"}',
  'route_new_to_renewal_pool',
  'leasing_agents_enriched',
] as const;

const SUMMARY_MARKERS = [
  'Summary page start',
  'ordered_agents',
  'EE_number',
  'Summary1: kept=',
] as const;

const RENEWAL_MARKERS = [
  'Renewal Commissions',
  'compose_renewal_pool',
  'per_person_split',
  'Renewals: pool_rows=',
] as const;

const EE_MARKERS = [
  'EE# Sheets - New Leases',
  'EMPTY_EE_TEMPLATE',
  'EE#0',
  'def next_free_ee',
] as const;

const FINISH_MARKERS = [
  'def _norm_name',
  'total_renewal_commission',
  'per_person_split * fte',
  'Summary2: OK (no mismatches).',
] as const;

const SHEET_MARKERS = [
  'def populate_summary_sheet',
  'def populate_renewal_sheet',
  'def populate_employee_sheet',
  'commission_{prop}_{m}-{y}.xlsx',
  '"file_content": file_content_b64',
] as const;

export function commissionPythonCode(python: string): string | null {
  if (hasMarkers(python, SHEET_MARKERS)) return spreadsheetCode();
  if (hasMarkers(python, FINISH_MARKERS)) return finishSummaryCode();
  if (hasMarkers(python, EE_MARKERS)) return eeSheetsCode();
  if (hasMarkers(python, RENEWAL_MARKERS)) return renewalCode();
  if (hasMarkers(python, SUMMARY_MARKERS)) return summaryStartCode();
  if (hasMarkers(python, PREPARE_MARKERS)) return prepareCode();
  if (hasMarkers(python, FILTER_MARKERS)) return filterEmployeesCode();
  return null;
}

function filterEmployeesCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const asText = (value) => (value == null || (typeof value === "number" && Number.isNaN(value)) ? "" : String(value));
  const parseJson = (value) => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  };
  const normalizeAgents = (raw) => {
    let value = parseJson(raw);
    const vals = [];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          for (const key of ["employee_number", "Employee_Number", "EmployeeNumber", "employeeNumber"]) {
            if (item[key] != null) { vals.push(String(item[key])); break; }
          }
        } else if (typeof item === "string") vals.push(item);
      }
    } else if (typeof value === "string") {
      for (const part of value.split(/[,\\n;]+/)) if (part.trim()) vals.push(part.trim());
    }
    return new Set(vals.filter((item) => item.trim()).map((item) => item.trim().toLowerCase()));
  };
  const location = asText(inputs.location).trim();
  let month = 0;
  let year = 0;
  try {
    month = Number.parseInt(asText(inputs.month), 10);
    year = Number.parseInt(asText(inputs.year), 10);
    if (!Number.isFinite(month) || !Number.isFinite(year)) month = year = 0;
  } catch { month = year = 0; }
  let lookup = parseJson(inputs.lookup_data ?? "[]");
  if (!Array.isArray(lookup)) lookup = [];
  const rename = { col3: "name", col4: "current_location", col5: "status", col6: "position", col10: "employee_number", col8: "hire_date" };
  const rows = lookup.filter((row) => row && typeof row === "object").map((row) => {
    const entry = row.entry && typeof row.entry === "object" ? row.entry : row;
    const out = {};
    for (const [key, value] of Object.entries(entry)) out[rename[String(key).toLowerCase().trim()] || String(key).toLowerCase().trim()] = value;
    return out;
  });
  if (!rows.length) return { new_rows: [], log: "Lookup Table estava vazia ou não foi lida." };
  for (const row of rows) if (row.employee_number == null || (typeof row.employee_number === "number" && Number.isNaN(row.employee_number))) row.employee_number = "";
  for (const row of rows) row.employee_number = asText(row.employee_number);
  const locationClean = (value) => {
    if (value == null || (typeof value === "number" && Number.isNaN(value))) return null;
    const found = String(value).match(/^([^(]+)/);
    return found ? found[1].trim() : null;
  };
  const locClean = location.replace(/\\s*\\(.*\\)/, "").trim().toLowerCase();
  const existing = normalizeAgents(inputs.leasing_agents ?? "[]");
  const hireOf = (value) => {
    const match = asText(value).trim().match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date.getTime();
  };
  const competency = month > 0 && year > 0 ? Date.UTC(year, month - 1, 1) : null;
  const matched = rows.filter((row) => {
    const clean = locationClean(row.current_location);
    if (clean == null) return false;
    const text = clean.toLowerCase();
    if (locClean !== "" && !new RegExp(locClean).test(text)) return false;
    if (existing.has(asText(row.employee_number).trim().toLowerCase())) return false;
    if (competency == null) return true;
    const hire = hireOf(row.hire_date);
    return hire != null && hire < competency;
  });
  return {
    new_rows: matched.map((row) => ({
      name: row.name ?? null,
      status: row.status ?? null,
      position: row.position ?? null,
      employee_number: row.employee_number,
      current_location: location,
    })),
    log: "",
  };
};`;
}

function prepareCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const asText = (value) => (value == null || (typeof value === "number" && Number.isNaN(value)) ? "" : String(value));
  const toInt = (value) => {
    try {
      const n = Number.parseInt(asText(value).trim(), 10);
      return Number.isFinite(n) ? n : 0;
    } catch { return 0; }
  };
  const toNum = (value) => {
    if (value == null || value === "") return 0;
    const n = typeof value === "number" ? value : Number(asText(value).trim());
    return Number.isFinite(n) ? n : 0;
  };
  const pyBool = (value) => {
    if (value == null || value === false) return false;
    if (value === true) return true;
    if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
    if (typeof value === "string") return value.length > 0;
    return Boolean(value);
  };
  const ymd = (y, m, d) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date.getTime();
  };
  const parseDt = (value) => {
    const raw = asText(value).trim();
    if (!raw || ["nil", "none", "null", "-"].includes(raw.toLowerCase())) return null;
    const head = raw.split("T")[0].split(" ")[0];
    let match = head.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
    if (match) return ymd(Number(match[1]), Number(match[2]), Number(match[3]));
    match = head.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2})$/);
    if (match) {
      const yy = Number(match[3]);
      const parsed = ymd(yy >= 69 ? 1900 + yy : 2000 + yy, Number(match[2]), Number(match[1]));
      if (parsed != null) return parsed;
    }
    match = head.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);
    if (match) {
      const dayFirst = ymd(Number(match[3]), Number(match[2]), Number(match[1]));
      if (dayFirst != null) return dayFirst;
      return ymd(Number(match[3]), Number(match[1]), Number(match[2]));
    }
    return null;
  };
  const data = inputs.leasing_agents;
  if (!Array.isArray(data)) throw new Error("leasing_agents precisa ser uma lista");
  const assetNorm = asText(inputs.asset_type).trim().toLowerCase();
  const propNorm = asText(inputs.property_name).trim().toLowerCase();
  const compMonth = toInt(inputs.month);
  const compYear = toInt(inputs.year);
  const lastDay = compMonth > 0 && compYear > 0 ? new Date(Date.UTC(compYear, compMonth, 0)).getUTCDate() : 0;
  const monthStart = lastDay ? Date.UTC(compYear, compMonth - 1, 1) : 0;
  const monthEnd = lastDay ? Date.UTC(compYear, compMonth - 1, lastDay) : 0;
  const minTs = Date.UTC(1, 0, 1);
  const maxTs = Date.UTC(9999, 11, 31);
  const workedMonth = (ini, fin) => {
    if (compMonth <= 0 || compYear <= 0) return true;
    let start = parseDt(ini);
    let end = parseDt(fin);
    if (start == null && end == null) return true;
    if (start == null) start = minTs;
    if (end == null) end = maxTs;
    return !((start <= monthStart) && (end >= monthEnd));
  };
  const office = ["Property Manager", "Sr. Property Manager", "Senior Property Manager", "Property Manager, Lease Up", "Assistant Property Manager", "Accounts Associate", "Leasing Manager", "Leasing Consultant", "Leasing Professional", "Concierge"];
  const renewalOnly = new Set(["Concierge"]);
  const corporate = ["National Leasing Specialist", "Sr. National Leasing Specialist", "Regional Leasing Consultant", "Traveling Operations Manager", "NLS - New Development", "NLS Conventional Housing"];
  const maintenance = ["Maintenance Supervisor", "Sr. Maintenance Supervisor", "Senior Maintenance Supervisor", "Sr. Maintenance Supv", "Senior Maintenance Supv", "Maintenance Technician", "Maintenance Technician II", "Maintenance Tech II", "Maintenance Tech III", "Groundskeeper", "Housekeeper"];
  const bucketOf = (position) => office.includes(position) ? "Office Staff" : corporate.includes(position) ? "Corporate" : maintenance.includes(position) ? "Maintenance Staff" : "Other";
  const has = (term) => assetNorm.includes(term.toLowerCase());
  const newBuckets = has("student") ? new Set(["Office Staff"]) : has("conventional") ? new Set(["Office Staff", "Corporate"]) : new Set();
  const splitBuckets = new Set(["Office Staff", "Maintenance Staff"]);
  const textCols = ["position", "commission_type", "status", "agent", "resident_name", "comment", "current_location", "filtered_just_by_current_location", "employee_number", "InitialDateOfAbsence", "FinalDateOfAbsence"];
  const numCols = ["special_commissions_new", "commission_due_new", "special_commissions_renewal", "commission_due_renewal", "lease_term"];
  const enriched = data.map((source) => {
    const row = { ...(source && typeof source === "object" ? source : {}) };
    for (const col of textCols) row[col] = asText(row[col]);
    for (const col of numCols) row[col] = toNum(row[col]);
    row.worked_month_for_renewal = workedMonth(row.InitialDateOfAbsence, row.FinalDateOfAbsence);
    row.staff_bucket = bucketOf(row.position);
    row.include_in_split = splitBuckets.has(row.staff_bucket);
    row.match_current_location_and_property = propNorm === "" ? true : asText(row.current_location).toLowerCase().includes(propNorm);
    const justByLoc = ["yes", "y", "true", "1"].includes(asText(row.filtered_just_by_current_location).trim().toLowerCase());
    row.eligible_for_new_ee = newBuckets.has(row.staff_bucket) && !justByLoc && !renewalOnly.has(row.position);
    const isNew = row.commission_type === "New Leases";
    const isRen = ["renewals", "renewal"].includes(asText(row.commission_type).trim().toLowerCase());
    row.route_new_to_renewal_pool = isNew && !row.eligible_for_new_ee;
    row.compose_renewal_pool = isRen || row.route_new_to_renewal_pool;
    row.commission_due_new_effective = row.eligible_for_new_ee ? row.commission_due_new : 0;
    row.special_commissions_new_effective = row.eligible_for_new_ee ? row.special_commissions_new : 0;
    row.commission_due_renewal_effective = row.commission_due_renewal + (row.route_new_to_renewal_pool ? row.commission_due_new : 0);
    row.special_commissions_renewal_effective = row.special_commissions_renewal + (row.route_new_to_renewal_pool ? row.special_commissions_new : 0);
    row.donation_to_pool_amount = (row.route_new_to_renewal_pool ? row.commission_due_new : 0) + (isRen && !row.include_in_split ? row.commission_due_renewal : 0);
    row.is_donation = row.donation_to_pool_amount > 0;
    row.eligible_for_renewal_split = row.include_in_split && row.match_current_location_and_property && row.worked_month_for_renewal;
    return row;
  });
  return { leasing_agents_enriched: enriched };
};`;
}

function summaryStartCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const asText = (value) => (value == null || (typeof value === "number" && Number.isNaN(value)) ? "" : String(value));
  const pyBool = (value) => {
    if (value == null || value === false) return false;
    if (value === true) return true;
    if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
    if (typeof value === "string") return value.length > 0;
    return Boolean(value);
  };
  const toNum = (value) => {
    if (value == null || value === "") return 0;
    const n = typeof value === "number" ? value : Number(asText(value).trim());
    return Number.isFinite(n) ? n : 0;
  };
  const propertyName = inputs.property_name || "";
  const assetType = inputs.asset_type || "";
  const month = inputs.month || "";
  const year = inputs.year || "";
  const dataset = Array.isArray(inputs.data) ? inputs.data : [];
  if (!dataset.length) {
    return {
      summary_page_content: { asset_type: assetType, property_name: propertyName, month, year, fte_total: 0, rows: [] },
      ordered_agents: [],
      log: "Summary1: empty dataset.",
    };
  }
  const rows = dataset.map((source) => {
    const row = { ...(source && typeof source === "object" ? source : {}) };
    for (const col of ["agent", "status", "position", "staff_bucket", "employee_number"]) row[col] = asText(row[col]);
    for (const col of ["include_in_split", "eligible_for_new_ee", "eligible_for_renewal_split"]) row[col] = pyBool(row[col]);
    row.commission_due_new_effective = toNum(row.commission_due_new_effective);
    return row;
  });
  const seen = new Set();
  const summary = [];
  for (const row of rows) {
    if (seen.has(row.agent)) continue;
    seen.add(row.agent);
    if (row.agent === "") continue;
    summary.push({
      agent: row.agent,
      status: row.status,
      position: row.position,
      staff_bucket: row.staff_bucket,
      employee_number: row.employee_number,
    });
  }
  const anySplit = new Map();
  const newSum = new Map();
  for (const row of rows) {
    anySplit.set(row.agent, (anySplit.get(row.agent) || false) || row.eligible_for_renewal_split);
    newSum.set(row.agent, (newSum.get(row.agent) || 0) + row.commission_due_new_effective);
  }
  const noFte = new Set(["new hire - not renewal eligible", "recent term - not renewal eligible"]);
  const rank = { "Office Staff": 0, "Maintenance Staff": 1, Other: 2 };
  const kept = summary.map((row) => {
    const status = row.status.toLowerCase();
    const base = noFte.has(status) ? 0 : status === "part time" ? 0.5 : status === "full time" ? 1 : 0;
    const eligible = Boolean(anySplit.get(row.agent));
    const newTotal = newSum.get(row.agent) || 0;
    const staff = row.staff_bucket === "Corporate" ? "Office Staff" : row.staff_bucket;
    return { ...row, staff_type: staff, eligible, fte: base * (eligible ? 1 : 0), new_total_eff: newTotal };
  }).filter((row) => {
    const terminated = /\\bterminated\\b/i.test(row.status);
    if (terminated && row.new_total_eff <= 0) return false;
    return row.fte > 0 || row.new_total_eff > 0;
  }).sort((a, b) => {
    const staff = (rank[a.staff_type] ?? 99) - (rank[b.staff_type] ?? 99);
    if (staff) return staff;
    const hasNew = (b.new_total_eff > 0 ? 1 : 0) - (a.new_total_eff > 0 ? 1 : 0);
    if (hasNew) return hasNew;
    if (a.agent < b.agent) return -1;
    if (a.agent > b.agent) return 1;
    return 0;
  });
  const outRows = kept.map((row, index) => ({
    row_number: index + 11,
    staff_type: String(row.staff_type),
    "EE#": "EE#" + String(index + 1),
    employee_number: row.employee_number,
    employee_name: row.agent,
    status: row.status,
    position: row.position,
    fte: Number(row.fte),
  }));
  return {
    summary_page_content: {
      asset_type: assetType,
      property_name: propertyName,
      month,
      year,
      fte_total: kept.reduce((sum, row) => sum + Number(row.fte), 0),
      rows: outRows,
    },
    ordered_agents: kept.map((row) => row.agent),
    log: "Summary1: kept=" + kept.length + "; new_first ordering applied",
  };
};`;
}

function renewalCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const asText = (value) => (value == null || (typeof value === "number" && Number.isNaN(value)) ? "" : String(value));
  const pyBool = (value) => {
    if (value == null || value === false) return false;
    if (value === true) return true;
    if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
    if (typeof value === "string") return value.length > 0;
    return Boolean(value);
  };
  const toNum = (value) => {
    if (value == null || value === "") return 0;
    const n = typeof value === "number" ? value : Number(asText(value).trim());
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (n) => {
    const sign = n < 0 ? -1 : 1;
    const x = Math.abs(n) * 100;
    const base = Math.floor(x);
    const frac = x - base;
    const even = Math.abs(frac - 0.5) < 1e-8 ? (base % 2 === 0 ? base : base + 1) : Math.round(x);
    return (sign * even) / 100;
  };
  const blank = (value) => value == null || value === "" || (typeof value === "number" && Number.isNaN(value));
  const textOrEmpty = (value) => (blank(value) ? "" : value);
  let fte = inputs.fte_team_members == null || inputs.fte_team_members === "" ? 0 : Number(inputs.fte_team_members);
  if (!Number.isFinite(fte)) throw new Error("fte_team_members invalido");
  const source = Array.isArray(inputs.leasing_agents) ? inputs.leasing_agents : [];
  if (!source.length) {
    return {
      renewal_commission_content: { fte_team_members: fte, total_commission_due: 0, per_person_split: 0, rows: [] },
      log: "Renewals: empty dataset.",
    };
  }
  const rows = source.map((item) => {
    const row = { ...(item && typeof item === "object" ? item : {}) };
    row.lease_term = Math.trunc(toNum(row.lease_term));
    row.compose_renewal_pool = pyBool(row.compose_renewal_pool);
    row.commission_due_renewal_effective = toNum(row.commission_due_renewal_effective);
    row.special_commissions_renewal_effective = toNum(row.special_commissions_renewal_effective);
    return row;
  }).filter((row) => row.compose_renewal_pool && (row.commission_due_renewal_effective > 0 || row.special_commissions_renewal_effective > 0));
  rows.sort((a, b) => {
    const left = blank(a.resident_name) ? null : String(a.resident_name);
    const right = blank(b.resident_name) ? null : String(b.resident_name);
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  const total = rows.reduce((sum, row) => sum + row.commission_due_renewal_effective, 0);
  const split = fte ? round2(total / fte) : 0;
  return {
    renewal_commission_content: {
      fte_team_members: fte,
      total_commission_due: round2(total),
      per_person_split: split,
      rows: rows.map((row, index) => ({
        row_number: 10 + index,
        resident_name: textOrEmpty(row.resident_name),
        renewal_date: textOrEmpty(row.move_in_date),
        lease_term: Math.trunc(toNum(row.lease_term)),
        special_commissions_new: toNum(row.special_commissions_renewal_effective),
        commission_due_new: toNum(row.commission_due_renewal_effective),
        comment: textOrEmpty(row.comment),
      })),
    },
    log: "Renewals: pool_rows=" + rows.length + ", total=" + round2(total) + ", split=" + split + " (fte=" + fte + ")",
  };
};`;
}

function eeSheetsCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const empty = { "EE#1": { employee_name: "", total_commission_due: 0, rows: [] } };
  const asText = (value) => (value == null || (typeof value === "number" && Number.isNaN(value)) ? "" : String(value));
  const pyBool = (value) => {
    if (value == null || value === false) return false;
    if (value === true) return true;
    if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
    if (typeof value === "string") return value.length > 0;
    return Boolean(value);
  };
  const toNum = (value) => {
    if (value == null || value === "") return 0;
    const n = typeof value === "number" ? value : Number(asText(value).trim());
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (n) => {
    const sign = n < 0 ? -1 : 1;
    const x = Math.abs(n) * 100;
    const base = Math.floor(x);
    const frac = x - base;
    const even = Math.abs(frac - 0.5) < 1e-8 ? (base % 2 === 0 ? base : base + 1) : Math.round(x);
    return (sign * even) / 100;
  };
  const blank = (value) => value == null || value === "" || (typeof value === "number" && Number.isNaN(value));
  const textOrEmpty = (value) => (blank(value) ? "" : value);
  const byText = (left, right) => {
    const a = blank(left) ? null : String(left);
    const b = blank(right) ? null : String(right);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  };
  const source = Array.isArray(inputs.leasing_agents) ? inputs.leasing_agents : [];
  if (!source.length) return { data: empty };
  const summaryRows = (inputs.summary_page_content && inputs.summary_page_content.rows) || [];
  const eeMap = {};
  const summaryOrder = [];
  for (const row of summaryRows) {
    const name = asText(row && row.employee_name).trim().toLowerCase();
    const key = asText(row && row["EE#"]).trim();
    if (!name) continue;
    summaryOrder.push(name);
    if (key) eeMap[name] = key;
  }
  const fresh = source.map((item) => {
    const row = { ...(item && typeof item === "object" ? item : {}) };
    row.agent = asText(row.agent);
    row.commission_type = asText(row.commission_type);
    row.LeaseSignedType = asText(row.LeaseSignedType);
    row.eligible_for_new_ee = pyBool(row.eligible_for_new_ee);
    row.lease_term = Math.trunc(toNum(row.lease_term));
    row.special_commissions_new_effective = toNum(row.special_commissions_new_effective);
    row.commission_due_new_effective = toNum(row.commission_due_new_effective);
    return row;
  }).filter((row) => row.commission_type === "New Leases" && row.eligible_for_new_ee);
  if (!fresh.length) return { data: empty };
  const sheets = {};
  const buildRows = (group) => group.map((row, index) => ({
    row_number: 9 + index,
    resident_name: textOrEmpty(row.resident_name),
    move_in_date: textOrEmpty(row.move_in_date),
    lease_term: Math.trunc(toNum(row.lease_term)),
    lease_signed_type: textOrEmpty(row.LeaseSignedType),
    special_commissions_new: toNum(row.special_commissions_new_effective),
    commission_due_new: toNum(row.commission_due_new_effective),
  }));
  const unassigned = fresh.filter((row) => row.agent.trim() === "").sort((a, b) => byText(a.resident_name, b.resident_name) || byText(a.move_in_date, b.move_in_date));
  if (unassigned.length) {
    const total = unassigned.reduce((sum, row) => sum + row.commission_due_new_effective, 0);
    sheets["EE#0"] = { employee_name: "No Agent", total_commission_due: round2(total), rows: buildRows(unassigned) };
  }
  const assigned = fresh.filter((row) => row.agent.trim() !== "").map((row) => ({ ...row, agent_norm: row.agent.trim().toLowerCase() }));
  const agentsWithNew = new Set(assigned.map((row) => row.agent_norm));
  const used = new Set([...Object.keys(sheets), ...Object.values(eeMap)]);
  const nextFree = () => {
    let i = 1;
    while (used.has("EE#" + i)) i += 1;
    used.add("EE#" + i);
    return "EE#" + i;
  };
  const buildSheet = (agentNorm) => {
    const group = assigned.filter((row) => row.agent_norm === agentNorm).sort((a, b) => byText(a.resident_name, b.resident_name) || byText(a.move_in_date, b.move_in_date));
    if (!group.length) return;
    const sheetName = eeMap[agentNorm] || nextFree();
    const total = group.reduce((sum, row) => sum + row.commission_due_new_effective, 0);
    sheets[sheetName] = { employee_name: group[0].agent, total_commission_due: round2(total), rows: buildRows(group) };
  };
  for (const name of summaryOrder) if (agentsWithNew.has(name)) buildSheet(name);
  const leftovers = [...agentsWithNew].filter((name) => !summaryOrder.includes(name)).sort();
  for (const name of leftovers) buildSheet(name);
  return { data: sheets };
};`;
}

function finishSummaryCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const toFloat = (value, fallback = 0) => {
    try {
      if (value == null || value === "") return fallback;
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    } catch { return fallback; }
  };
  const round2 = (n) => {
    const sign = n < 0 ? -1 : 1;
    const x = Math.abs(n) * 100;
    const base = Math.floor(x);
    const frac = x - base;
    const even = Math.abs(frac - 0.5) < 1e-8 ? (base % 2 === 0 ? base : base + 1) : Math.round(x);
    return (sign * even) / 100;
  };
  const normName = (value) => {
    if (value == null) return "";
    return String(value).normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").trim().split(/\\s+/).filter(Boolean).join(" ").toLowerCase();
  };
  const summary = JSON.parse(JSON.stringify(inputs.summary_page_content || {}));
  const renewal = inputs.renewal_commission_content || {};
  const eeTabs = inputs.other_sheets_content || {};
  const rows = Array.isArray(summary.rows) ? summary.rows : [];
  summary.rows = rows;
  const split = toFloat(renewal.per_person_split, 0);
  const byKey = {};
  const byName = {};
  if (eeTabs && typeof eeTabs === "object" && !Array.isArray(eeTabs)) {
    for (const [key, data] of Object.entries(eeTabs)) {
      if (!data || typeof data !== "object") continue;
      const total = toFloat(data.total_commission_due, 0);
      byKey[String(key).trim()] = total;
      const name = normName(data.employee_name);
      if (name) byName[name] = total;
    }
  }
  const warnings = [];
  for (const row of rows) {
    const eeKey = String(row["EE#"] || "").trim();
    const name = normName(row.employee_name);
    const fromKey = Object.prototype.hasOwnProperty.call(byKey, eeKey) ? byKey[eeKey] : null;
    const fromName = Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : null;
    let next = 0;
    if (fromKey != null && fromName != null) {
      next = fromKey;
      if (Math.abs(fromKey - fromName) > 0.01) {
        warnings.push("Mismatch for " + eeKey + " / '" + (row.employee_name || "") + "': EE# total=" + fromKey + " vs name total=" + fromName + ". Using EE#.");
      }
    } else if (fromKey != null) next = fromKey;
    else if (fromName != null) next = fromName;
    const fte = toFloat(row.fte, 0);
    row.new_leases_commission = round2(next);
    row.renewal_commission = round2(split * fte);
    row.total_commission = round2(row.new_leases_commission + row.renewal_commission);
  }
  const totalRenewal = round2(rows.reduce((sum, row) => sum + toFloat(row.renewal_commission, 0), 0));
  const out = { summary_page_output: summary, total_renewal_commission: totalRenewal };
  out.log = warnings.length ? warnings.slice(0, 50).join(" | ") : "Summary2: OK (no mismatches).";
  return out;
};`;
}

function spreadsheetCode(): string {
  return `// py_eval/invoke_custom_py_code
export const code = async (inputs) => {
  const money = (value) => {
    try { return value == null || value === "" ? 0 : Number(value) || 0; } catch { return 0; }
  };
  const xml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colName = (n) => {
    let s = "";
    let x = n;
    while (x > 0) {
      const m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  };
  const sheetXml = (cells) => {
    const byRow = new Map();
    for (const cell of cells) {
      if (!byRow.has(cell.row)) byRow.set(cell.row, []);
      byRow.get(cell.row).push(cell);
    }
    const rows = [...byRow.keys()].sort((a, b) => a - b).map((row) => {
      const cols = byRow.get(row).sort((a, b) => a.col - b.col).map((cell) => {
        const ref = colName(cell.col) + row;
        const style = cell.style ? ' s="' + cell.style + '"' : "";
        if (typeof cell.value === "number" && Number.isFinite(cell.value)) return '<c r="' + ref + '"' + style + "><v>" + cell.value + "</v></c>";
        return '<c r="' + ref + '" t="inlineStr"' + style + "><is><t>" + xml(cell.value) + "</t></is></c>";
      }).join("");
      return '<row r="' + row + '">' + cols + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + "</sheetData></worksheet>";
  };
  const fillSummary = (data) => {
    const cells = [];
    const put = (col, row, value, style = 0) => cells.push({ col, row, value, style });
    put(1, 1, "Property Name", 1); put(2, 1, data.property_name ?? "");
    put(1, 2, "Asset Type", 1); put(2, 2, data.asset_type ?? "");
    put(1, 3, "Month / Year", 1); put(2, 3, String(data.month ?? "") + "/" + String(data.year ?? ""));
    put(1, 4, "FTE Total", 1); put(2, 4, data.fte_total ?? "");
    const headers = ["Staff Type", "EE#", "Employee Number", "Employee Name", "Status", "Position", "New Leases Commission", "Renewal Commission", "Total Commissions Due", "FTE"];
    headers.forEach((header, index) => put(index + 1, 6, header, 1));
    (data.rows || []).forEach((row, index) => {
      const line = 7 + index;
      const values = [row.staff_type, row["EE#"], row.employee_number, row.employee_name, row.status, row.position, money(row.new_leases_commission), money(row.renewal_commission), money(row.total_commission), row.fte];
      values.forEach((value, col) => put(col + 1, line, value ?? "", col >= 6 && col <= 8 ? 2 : 0));
    });
    return cells;
  };
  const fillRenewal = (data) => {
    const cells = [];
    const put = (col, row, value, style = 0) => cells.push({ col, row, value, style });
    put(1, 1, "FTE Team Members", 1); put(2, 1, data.fte_team_members ?? "");
    put(1, 2, "Total Commission Due", 1); put(2, 2, money(data.total_commission_due), 2);
    put(1, 3, "Per Person Split", 1); put(2, 3, money(data.per_person_split), 2);
    ["Row Number", "Resident Name", "Renewal Date", "Lease Term", "Special Commissions", "Commission Due", "Comment"].forEach((header, index) => put(index + 1, 5, header, 1));
    (data.rows || []).forEach((row, index) => {
      const line = 6 + index;
      const values = [row.row_number, row.resident_name, row.renewal_date, row.lease_term, money(row.special_commissions_new), money(row.commission_due_new), row.comment];
      values.forEach((value, col) => put(col + 1, line, value ?? "", col === 4 || col === 5 ? 2 : 0));
    });
    return cells;
  };
  const fillEmployee = (data) => {
    const cells = [];
    const put = (col, row, value, style = 0) => cells.push({ col, row, value, style });
    put(1, 1, "Employee Name", 1); put(2, 1, data.employee_name ?? "");
    put(1, 2, "Total Commission Due", 1); put(2, 2, money(data.total_commission_due), 2);
    ["Row Number", "Resident Name", "Move In Date", "Lease Term", "Lease Signed Type", "Special Commissions", "Commission Due"].forEach((header, index) => put(index + 1, 4, header, 1));
    (data.rows || []).forEach((row, index) => {
      const line = 5 + index;
      const values = [row.row_number, row.resident_name, row.move_in_date, row.lease_term, row.lease_signed_type, money(row.special_commissions_new), money(row.commission_due_new)];
      values.forEach((value, col) => put(col + 1, line, value ?? "", col === 5 || col === 6 ? 2 : 0));
    });
    return cells;
  };
  const utf8 = (text) => {
    const out = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return out;
  };
  const crc32 = (bytes) => {
    let c = -1;
    for (const b of bytes) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const zip = (files) => {
    const locals = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
      const name = utf8(file.name);
      const data = utf8(file.data);
      const crc = crc32(data);
      const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data];
      locals.push(local);
      central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]);
      offset += local.length;
    }
    const cd = central.flat();
    const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd.length), ...u32(offset), ...u16(0)];
    return [...locals.flat(), ...cd, ...eocd];
  };
  const b64 = (bytes) => {
    const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      const n = (a << 16) | (b << 8) | c;
      out += alpha[(n >> 18) & 63] + alpha[(n >> 12) & 63] + (i + 1 < bytes.length ? alpha[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? alpha[n & 63] : "=");
    }
    return out;
  };
  try {
    const rawSummary = inputs.summary_page_content || {};
    const summary = rawSummary.summary_page_output || rawSummary;
    const renewal = inputs.renewal_commission_content || {};
    const employees = inputs.other_sheets_content || {};
    const names = {};
    for (const row of summary.rows || []) {
      const key = String(row["EE#"] || "").trim();
      const name = String(row.employee_name || "").trim();
      if (key && name) names[key] = name;
    }
    const sheets = [
      { name: "Summary Page", cells: fillSummary(summary) },
      { name: "Renewal Commissions", cells: fillRenewal(renewal) },
    ];
    if (employees && typeof employees === "object" && !Array.isArray(employees)) {
      for (const [key, value] of Object.entries(employees)) {
        const row = { ...(value && typeof value === "object" ? value : {}) };
        row.employee_name = Object.prototype.hasOwnProperty.call(names, key) ? names[key] : row.employee_name;
        sheets.push({ name: key, cells: fillEmployee(row) });
      }
    }
    const overrides = sheets.map((_, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("");
    const rels = sheets.map((_, index) => '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>').join("") + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    const workbookSheets = sheets.map((sheet, index) => '<sheet name="' + xml(sheet.name) + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join("");
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
    const files = [
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + overrides + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + workbookSheets + "</sheets></workbook>" },
      { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>" },
      { name: "xl/styles.xml", data: styles },
      ...sheets.map((sheet, index) => ({ name: "xl/worksheets/sheet" + (index + 1) + ".xml", data: sheetXml(sheet.cells) })),
    ];
    const prop = String(summary.property_name || "report").trim().replace(/ /g, "_");
    const month = String(summary.month || "").trim();
    const year = String(summary.year || "").trim();
    const filename = ("commission_" + prop + "_" + month + "-" + year + ".xlsx").replace(/__/g, "_").replace(/^[_-]+|[_-]+$/g, "");
    return { file_content: b64(zip(files)), filename };
  } catch (error) {
    return { success: false, error_message: error instanceof Error ? error.message : String(error) };
  }
};`;
}

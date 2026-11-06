const IDENTIFIER = /(^|\b)(sl\s*no|serial|patient|subject|record|medical\s*record|mrn|name|email|phone|mobile|address|aadhaar|abha|pan|ssn|license|account|device|url|ip|biometric|photo|zip|pin)(\b|$)/i;
const GEOGRAPHY = /(district|city|village|town|state|country|location|region|geograph)/i;
const SENSITIVE_CONTEXT = /(religion|caste|ethnicity)/i;
const AGE = /(^|\b)age(\b|$)/i;
const BINARY = /(gender|sex|weakness|weekness|jaundice|yes.?no|positive|negative|flag|indicator)/i;
const TARGET = /(diagnos|outcome|target|label|class|mortality|survival|response|readmission|prognos)/i;
const BIOMARKER = /(hba0|hba2|hbf|s.?window|rbc|hb|mcv|mch|mchc|rdw|heart.?rate|temperature|lactate|glucose|platelet|creatinine|bilirubin|sodium|potassium)/i;
const round = (value, digits = 2) => Number(value.toFixed(digits));
const clean = (value) => value.trim().replace(/\s+/g, ' ');
const canonical = (value) => {
    const normalized = clean(value);
    if (/^(yes|y|true|1|positive)$/i.test(normalized))
        return 'Yes';
    if (/^(no|n|false|0|negative)$/i.test(normalized))
        return 'No';
    if (/^(male|m)$/i.test(normalized))
        return 'Male';
    if (/^(female|f)$/i.test(normalized))
        return 'Female';
    return normalized;
};
export function parseClinicalAge(value) {
    const normalized = clean(value);
    if (!normalized)
        return null;
    const plain = Number(normalized);
    if (Number.isFinite(plain) && plain >= 0)
        return plain;
    const years = normalized.match(/(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years)\b/i);
    const months = normalized.match(/(\d+(?:\.\d+)?)\s*(?:m|mo|mos|month|months)\b/i);
    const days = normalized.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/i);
    if (!years && !months && !days)
        return null;
    return (years ? Number(years[1]) : 0)
        + (months ? Number(months[1]) / 12 : 0)
        + (days ? Number(days[1]) / 365.25 : 0);
}
function parseClinicalNumber(value) {
    const normalized = clean(value).replace(/,/g, '');
    if (!normalized)
        return null;
    const exact = Number(normalized);
    if (Number.isFinite(exact))
        return exact;
    const match = normalized.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match)
        return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}
function seedFrom(columns, rowCount) {
    let hash = 2166136261 ^ rowCount;
    for (const char of columns.join('\u001f')) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function seededRandom(seed) {
    let state = seed || 0x9e3779b9;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
function stats(values) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return { min: round(min), max: round(max), mean: round(mean), std: round(Math.sqrt(variance)) };
}
function allowedDomain(values, sourceRows, alwaysExpose = false) {
    const counts = new Map();
    for (const value of values.map(canonical).filter(Boolean))
        counts.set(value, (counts.get(value) || 0) + 1);
    const minimumSupport = alwaysExpose ? 1 : Math.max(5, Math.ceil(sourceRows * 0.01));
    const allowed = [...counts.entries()].filter(([, count]) => count >= minimumSupport).map(([value]) => value);
    if (counts.size > allowed.length)
        allowed.push('Other');
    return { counts, allowed: allowed.length ? allowed : ['Synthetic category'] };
}
function classBalance(domain, counts) {
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0) || 1;
    return Object.fromEntries(domain.map(value => {
        if (value === 'Other')
            return [value, 'present'];
        const ratio = (counts.get(value) || 0) / total;
        return [value, ratio >= 0.5 ? 'dominant' : ratio >= 0.2 ? 'common' : 'present'];
    }));
}
function chooseWeighted(domain, counts, random) {
    const weights = domain.map(value => value === 'Other' ? 1 : (counts.get(value) || 0) + 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = random() * total;
    for (let index = 0; index < domain.length; index++) {
        cursor -= weights[index];
        if (cursor <= 0)
            return domain[index];
    }
    return domain[domain.length - 1];
}
function truncatedNormal(summary, random) {
    if (summary.min === summary.max)
        return summary.mean;
    const deviation = summary.std || (summary.max - summary.min) / 6;
    for (let attempt = 0; attempt < 8; attempt++) {
        const u1 = Math.max(random(), Number.EPSILON);
        const u2 = random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const candidate = summary.mean + z * deviation;
        if (candidate >= summary.min && candidate <= summary.max)
            return candidate;
    }
    return summary.min + random() * (summary.max - summary.min);
}
function prepareColumn(name, values, sourceRows, random) {
    const identifier = IDENTIFIER.test(name);
    const geography = GEOGRAPHY.test(name);
    const sensitiveContext = SENSITIVE_CONTEXT.test(name);
    const isAge = AGE.test(name);
    const isTarget = TARGET.test(name);
    const parsedNumbers = values.map(value => isAge ? parseClinicalAge(value) : parseClinicalNumber(value));
    const available = parsedNumbers.filter((value) => value !== null);
    const numeric = available.length > 0 && available.length >= Math.ceil(values.filter(value => clean(value)).length * 0.9);
    if (identifier || geography || sensitiveContext) {
        const transformation = geography
            ? 'Geography replaced with synthetic region tokens.'
            : sensitiveContext
                ? 'Sensitive context replaced with synthetic categories.'
                : 'Direct identifier removed from public preview values.';
        return {
            profile: {
                name,
                privacyTier: 'safe_harbor_identifier',
                dataType: 'redacted',
                role: 'identifier',
                includedInFeaturesByDefault: false,
                transformation,
            },
            generate: row => geography
                ? `REDACTED_REGION_${String.fromCharCode(65 + row % 3)}`
                : sensitiveContext
                    ? `REDACTED_SENSITIVE_CATEGORY_${String.fromCharCode(65 + row % 2)}`
                    : `REDACTED_IDENTIFIER_${row + 1}`,
        };
    }
    if (isAge && available.length) {
        const summary = stats(available.map(value => Math.min(value, 90)));
        return {
            profile: {
                name,
                privacyTier: 'safe_harbor_identifier',
                dataType: 'age',
                role: 'feature',
                includedInFeaturesByDefault: true,
                numericSummary: summary,
                transformation: 'Composite ages normalized to years; ages over 89 represented as 90+.',
            },
            generate: () => {
                const value = truncatedNormal(summary, random);
                return value >= 89.5 ? '90+' : value.toFixed(2);
            },
        };
    }
    if (isTarget) {
        const { counts, allowed } = allowedDomain(values, sourceRows);
        return {
            profile: {
                name,
                privacyTier: 'clinical_target',
                dataType: 'categorical',
                role: 'target',
                includedInFeaturesByDefault: false,
                domain: allowed,
                approximateClassBalance: classBalance(allowed, counts),
                transformation: 'Minimum-support class labels retained; rare classes collapsed to Other.',
            },
            generate: () => chooseWeighted(allowed, counts, random),
        };
    }
    if (numeric || BIOMARKER.test(name)) {
        const safeValues = available.length ? available : [0, 1];
        const summary = stats(safeValues);
        const integer = safeValues.every(Number.isInteger);
        return {
            profile: {
                name,
                privacyTier: 'continuous_measurement',
                dataType: integer ? 'integer' : 'float',
                role: 'feature',
                includedInFeaturesByDefault: true,
                numericSummary: summary,
                transformation: 'Synthetic values sampled independently from a bounded normal approximation.',
            },
            generate: () => {
                const value = truncatedNormal(summary, random);
                return integer ? String(Math.round(value)) : value.toFixed(2);
            },
        };
    }
    const alwaysExpose = BINARY.test(name);
    const { counts, allowed } = allowedDomain(values, sourceRows, alwaysExpose);
    const binary = alwaysExpose || allowed.length <= 2;
    return {
        profile: {
            name,
            privacyTier: 'bounded_categorical',
            dataType: binary ? 'boolean' : 'categorical',
            role: 'feature',
            includedInFeaturesByDefault: true,
            domain: allowed,
            transformation: binary
                ? 'Allowed clinical indicator domain retained; preview rows are independently sampled.'
                : 'Minimum-support categories retained; rare values collapsed to Other.',
        },
        generate: () => chooseWeighted(allowed, counts, random),
    };
}
export function buildSyntheticSchema(columns, records, previewRows = 10) {
    if (!columns.length || new Set(columns).size !== columns.length || columns.some(column => !clean(column))) {
        throw new Error('Use non-empty, unique column names.');
    }
    if (!records.length || records.some(row => row.length !== columns.length)) {
        throw new Error('Include data rows with the same number of fields as the header.');
    }
    const random = seededRandom(seedFrom(columns, records.length));
    const prepared = columns.map((name, index) => prepareColumn(clean(name), records.map(row => row[index] || ''), records.length, random));
    return {
        columns: columns.map(clean),
        rows: Array.from({ length: previewRows }, (_, row) => prepared.map(column => column.generate(row))),
        sourceRows: records.length,
        columnProfiles: prepared.map(column => column.profile),
        privacyModel: 'ephemeral-safe-harbor-v1',
        schemaVersion: '2.0.0',
    };
}
//# sourceMappingURL=syntheticPreview.js.map
// Deterministic proposals, never inferred personal characteristics or generated answers.
export const SENSITIVE = new Set([
  'ethnicity', 'gender', 'citizenship', 'workAuthorization', 'sponsorship',
  'disability', 'veteranStatus', 'birthDate', 'ssn', 'sexualOrientation'
]);
export const EDITABLE = [
  'fullName', 'firstName', 'lastName', 'email', 'phone', 'city', 'linkedin',
  'github', 'website', 'school', 'degree', 'graduation', 'currentEmployer', 'currentTitle',
  ...SENSITIVE
];
export const normalize = x => String(x ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const tokens = x => new Set(normalize(x).match(/[a-z][a-z0-9+#.-]*/g) ?? []);

export function emptyProfile() {
  return {schema: 1, revision: 0, resumes: [], facts: {}, selectedResume: null};
}

export function parseResume(text, source) {
  if (typeof text !== 'string' || text.length > 250000) throw new Error('Resume must be text under 250 KB');
  if (!source?.sha256 || !source?.name) throw new Error('Source identity required');
  const lines = text.split(/\r?\n/);
  const facts = [];
  const add = (key, value, line, confidence = 0.99) => {
    if (value && !SENSITIVE.has(key)) facts.push({key, value: value.trim(), confidence,
      source: {kind: 'resume', name: source.name, sha256: source.sha256, line: line + 1,
        excerpt: lines[line].slice(0, 600),page:source.linePages?.[line]??null}});
  };
  const labels = {
    name: 'fullName', 'full name': 'fullName', 'first name': 'firstName', 'last name': 'lastName',
    email: 'email', phone: 'phone', city: 'city', location: 'city', school: 'school', university: 'school',
    degree: 'degree', graduation: 'graduation', 'graduation date': 'graduation',
    'current employer': 'currentEmployer', 'current title': 'currentTitle',
    linkedin: 'linkedin', github: 'github', website: 'website'
  };
  lines.forEach((line, i) => {
    const labeled = line.match(/^\s*([\w ]{2,30})\s*:\s*(.+?)\s*$/);
    if (labeled && Object.hasOwn(labels, normalize(labeled[1]))) add(labels[normalize(labeled[1])], labeled[2], i);
    else {
      const emails = line.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi);
      if (emails?.length === 1) add('email', emails[0], i, 0.97);
      for (const [key, pattern] of [
        ['linkedin', /https:\/\/(?:www\.)?linkedin\.com\/in\/[a-z0-9_-]+\/?/gi],
        ['github', /https:\/\/(?:www\.)?github\.com\/[a-z0-9_-]+\/?/gi]
      ]) {
        const urls = line.match(pattern);
        if (urls?.length === 1) add(key, urls[0], i, 0.97);
      }
      const phones = line.match(/(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/g);
      if (phones?.length === 1) add('phone', phones[0], i, 0.88);
      // Education proposals are limited to an explicit education section. Dates elsewhere
      // cannot silently become graduation dates. Excerpts still require user verification.
      const priorHeading = lines.slice(0,i+1).map(x=>x.trim()).filter(x=>
        /^(education|experience|projects|skills|technical skills|publications|research)$/i.test(x)).at(-1);
      if (normalize(priorHeading) === 'education') {
        const school = line.match(/^\s*([A-Za-z .'-]+(?:University|College|Institute of Technology))\b/);
        if (school) add('school',school[1],i,0.88);
        const degree = line.match(/\b((?:Bachelor|Master) of (?:Science|Arts|Engineering)(?: in [A-Za-z ]+)?|Ph\.?D\.? in [A-Za-z ]+)\b/);
        if (degree) add('degree',degree[1].trim(),i,0.88);
        const graduation = line.match(/\b(?:Expected|Graduation)\s*:?\s*((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})\b/i);
        if (graduation) add('graduation',graduation[1],i,0.90);
      }
    }
  });
  // Unlabeled first lines are suggestions only, with intentionally low confidence.
  const firstLine=lines[0]?.trim() ?? '';
  if (!facts.some(f => f.key === 'fullName') && /^[A-Za-z][A-Za-z .'-]{3,70}$/.test(firstLine) &&
      firstLine.split(/\s+/).length>=2 && !/^(curriculum vitae|technical skills|work experience)$/i.test(firstLine))
    add('fullName', lines[0], 0, 0.70);
  return {id: source.sha256, name: source.name, sha256: source.sha256,
    text, facts, terms: [...tokens(text)]};
}

export function importResume(profile, resume) {
  if (profile.resumes.some(r => r.id === resume.id)) return false;
  profile.resumes.push(resume);
  for (const proposal of resume.facts) {
    const fact = profile.facts[proposal.key] ??= {candidates: [], selected: null};
    const newValue = !fact.candidates.some(c => normalize(c.value) === normalize(proposal.value));
    const id = `${resume.id}:${proposal.key}:${proposal.source.line}`;
    if (!fact.candidates.some(c => c.id === id)) fact.candidates.push({...proposal, id, verified: false});
    if (newValue) fact.selected = null;
  }
  profile.revision++;
  return true;
}

export function verifyCandidate(profile, key, id) {
  const fact = profile.facts[key];
  const candidate = fact?.candidates.find(c => c.id === id);
  if (!candidate || SENSITIVE.has(key) && candidate.source.kind !== 'user') throw new Error('Unverifiable fact');
  candidate.verified = true;
  fact.selected = id;
  profile.revision++;
}

export function setUserFact(profile, key, value) {
  if (!EDITABLE.includes(key) || typeof value !== 'string' || value.length > 500 || !value.trim())
    throw new Error('Choose a supported fact and a nonempty value under 500 characters');
  const id = `user:${key}:${profile.revision + 1}`;
  const fact = profile.facts[key] ??= {candidates: [], selected: null};
  fact.candidates.push({id, key, value: value.trim(), confidence: 1, verified: true,
    source: {kind: 'user', name: 'Explicit user entry', excerpt: '', line: null}});
  fact.selected = id;
  profile.revision++;
}

export function deleteFact(profile, key) {
  delete profile.facts[key];
  profile.revision++;
}

export function deleteResume(profile, id) {
  profile.resumes = profile.resumes.filter(r => r.id !== id);
  for (const [key, fact] of Object.entries(profile.facts)) {
    fact.candidates = fact.candidates.filter(c => c.source.sha256 !== id);
    if (!fact.candidates.some(c => c.id === fact.selected)) fact.selected = null;
    if (!fact.candidates.length) delete profile.facts[key];
  }
  if (profile.selectedResume === id) profile.selectedResume = null;
  profile.revision++;
}

export function factState(profile, key) {
  const fact = profile.facts[key];
  if (!fact?.candidates.length) return {reason: 'missing fact'};
  const values = new Set(fact.candidates.map(c => normalize(c.value)));
  const selected = fact.candidates.find(c => c.id === fact.selected && c.verified);
  if (selected) return {candidate: selected};
  return {reason: values.size > 1 ? 'conflicting resume versions' : 'needs user verification'};
}

export function rankResumes(profile, jobText) {
  const stop = new Set(['the','and','with','for','you','our','are','that','will','your','from','this','have','work','role']);
  const query = [...tokens(jobText)].filter(t => t.length > 2 && !stop.has(t));
  const unique = [...new Set(query)];
  const rows = profile.resumes.map(r => {
    const terms = new Set(r.terms);
    const matched = unique.filter(t => terms.has(t));
    // Rare query terms weigh more across the imported versions; not learned relevance.
    const score = matched.reduce((sum, t) => sum + Math.log(1 + profile.resumes.length /
      (1 + profile.resumes.filter(x => x.terms.includes(t)).length)), 0);
    return {id: r.id, name: r.name, score, matched};
  }).sort((a,b) => b.score - a.score || a.name.localeCompare(b.name));
  return {rows, suggestion: rows[0]?.score > 0 && (!rows[1] || rows[0].score > rows[1].score)
    ? rows[0].id : null};
}

// Exact semantic patterns are deliberately conservative. Score is rule confidence, not calibrated probability.
export function classifyField(field) {
  const label = normalize(field.label).replace(/[?*:]/g, '').trim();
  const sensitive = [
    ['ethnicity', /^(race|ethnicity|race ethnicity|race\/ethnicity)$/],
    ['gender', /^(gender|gender identity|sex)$/], ['citizenship', /^(citizenship|country of citizenship|citizenship status)$/],
    ['workAuthorization', /^(work authorization|are you authorized to work in (the )?(united states|us))$/],
    ['sponsorship', /^(require sponsorship|will you (now or in the future )?require (visa )?sponsorship)$/],
    ['disability', /^(disability|disability status)$/], ['veteranStatus', /^(veteran|veteran status)$/],
    ['birthDate', /^(date of birth|birth date)$/], ['ssn', /^(ssn|social security number)$/],
    ['sexualOrientation', /^(sexual orientation)$/]
  ];
  for (const [key, re] of sensitive) if (re.test(label)) return {key, confidence: 1, sensitive: true};
  // Sensitive-looking unknown wording must never fall back to an ordinary name/autocomplete hint.
  if (/race|ethnic|gender|citizen|disab|veteran|sponsor|authoriz|birth|social security|sexual/.test(label))
    return {reason: 'unrecognized sensitive wording'};
  const auto = {'given-name':'firstName','family-name':'lastName','name':'fullName','email':'email',
    'tel':'phone','address-level2':'city','organization':'currentEmployer','organization-title':'currentTitle'};
  const rules = [
    ['firstName', /^(first name|given name)$/], ['lastName', /^(last name|family name|surname)$/],
    ['fullName', /^(full name|legal name|name)$/], ['email', /^(email|email address|e-mail)$/],
    ['phone', /^(phone|phone number|mobile|mobile phone)$/], ['city', /^(city|current city|location)$/],
    ['linkedin', /^(linkedin|linkedin profile|linkedin url)$/], ['github', /^(github|github profile|github url)$/],
    ['website', /^(website|personal website|portfolio|portfolio url)$/], ['school', /^(school|university|school name)$/],
    ['degree', /^(degree|degree type)$/], ['graduation', /^(graduation|graduation date|expected graduation)$/],
    ['currentEmployer', /^(current employer|current company)$/], ['currentTitle', /^(current title|current job title)$/]
  ];
  const hits = rules.filter(([,re]) => re.test(label));
  const hint = auto[normalize(field.autocomplete).split(' ').at(-1)];
  if (hits.length === 1 && hint && hits[0][0] !== hint) return {reason: 'label/autocomplete conflict'};
  if (hits.length === 1) return {key: hits[0][0], confidence: 0.99, sensitive: false};
  if (!label && hint) return {key: hint, confidence: 0.96, sensitive: false};
  return {reason: 'unknown or narrative question'};
}

export function optionValue(field, value) {
  if(['date','month'].includes(field.kind)){
    let formatted=String(value).trim();
    if(field.kind==='month'){
      const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
      const match=normalize(value).match(/^([a-z]+) (\d{4})$/);
      if(match&&months.includes(match[1]))formatted=`${match[2]}-${String(months.indexOf(match[1])+1).padStart(2,'0')}`;
    }
    const match=formatted.match(field.kind==='date'?/^(\d{4})-(\d{2})-(\d{2})$/:/^(\d{4})-(\d{2})$/);
    if(!match)return {reason:field.kind==='date'?'needs an exact YYYY-MM-DD date; no day is inferred':'needs an exact month and year'};
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]??1),
      days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
    if(!year||month<1||month>12||day<1||day>days[month-1])return {reason:'invalid calendar date'};
    if(field.min&&formatted<field.min||field.max&&formatted>field.max)return {reason:'date is outside form bounds'};
    if(field.step&&!['1','any'].includes(field.step))return {reason:'nonstandard date increments remain manual'};
    return {value:formatted};
  }
  if (!['select', 'radio'].includes(field.kind)) return {value};
  const hits = field.options.filter(o => !o.disabled && o.value !== '' &&
    (normalize(o.label) === normalize(value) || normalize(o.value) === normalize(value)));
  if (hits.length !== 1) return {reason: hits.length ? 'ambiguous options' : 'no exact option match'};
  return {value: hits[0].value};
}

export function buildPlan(profile, snapshot) {
  const rows = snapshot.fields.map(field => {
    const base = {id: field.id, label: field.label, action:field.action ?? snapshot.url, signature: field.signature, status: 'abstain'};
    if (field.blocked) return {...base, reason: field.blocked};
    if (field.currentValue !== '') return {...base, reason: 'already filled'};
    const mapping = classifyField(field);
    if (!mapping.key) return {...base, reason: mapping.reason};
    const state = factState(profile, mapping.key);
    if (!state.candidate) return {...base, key: mapping.key, reason: state.reason};
    if (mapping.sensitive && state.candidate.source.kind !== 'user')
      return {...base, reason: 'sensitive facts require explicit user entry'};
    const option = optionValue(field, state.candidate.value);
    if (option.reason) return {...base, key: mapping.key, reason: option.reason};
    return {...base, key: mapping.key, status: mapping.sensitive ? 'sensitive-review' : 'review',
      value: option.value, displayValue: ['date','month'].includes(field.kind)?option.value:state.candidate.value, confidence: mapping.confidence,
      source: state.candidate.source, sensitive: mapping.sensitive};
  });
  return {profileRevision: profile.revision, nonce: snapshot.nonce, url: snapshot.url,
    destination: snapshot.destination, rows};
}

export function approvePlan(plan, ids, sensitiveApproved, currentRevision) {
  if (currentRevision !== plan.profileRevision) throw new Error('Profile changed; scan again');
  const chosen = new Set(ids);
  if ([...chosen].some(id => !plan.rows.some(row => row.id === id))) throw new Error('Unknown reviewed field');
  const rows = plan.rows.filter(r => chosen.has(r.id));
  if (rows.some(r => r.status === 'abstain')) throw new Error('An abstained field cannot be approved');
  if (rows.some(r => r.sensitive) && !sensitiveApproved) throw new Error('Sensitive destination approval required');
  return {nonce: plan.nonce, url: plan.url, destination: plan.destination,
    fields: rows.map(({id, signature, value, sensitive}) => ({id, signature, value, sensitive})),
    sensitiveApproved: Boolean(sensitiveApproved)};
}

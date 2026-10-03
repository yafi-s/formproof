// These functions are self-contained so Chrome can inject their source in the isolated world.
// They never submit, click buttons, fetch, or attach resume files.
export function scanPage() {
  function labelFor(el) {
    if (el.type === 'radio') {
      const legend = el.closest('fieldset')?.querySelector('legend');
      if (legend) return legend.textContent.trim();
    }
    const refs = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    return el.getAttribute('aria-label') || refs || [...(el.labels ?? [])].map(l => l.textContent.trim()).join(' ') || el.placeholder || '';
  }
  function signature(el, group) {
    return JSON.stringify({tag:el.tagName, type:el.type, name:el.name, label:labelFor(el),
      autocomplete:el.autocomplete, action:el.form?.action ?? location.href,
      options:group ? group.map(e => [e.value, [...(e.labels ?? [])].map(l => l.textContent.trim()).join(' '), e.disabled]) :
        el.tagName === 'SELECT' ? [...el.options].map(o => [o.value,o.textContent.trim(),o.disabled]) : null});
  }
  const handles = new Map(); const fields = []; const seen = new Set();
  const elements = [...document.querySelectorAll('input,select,textarea')];
  for (const el of elements) {
    if (['submit','button','reset','image'].includes(el.type)) continue;
    const radio = el.type === 'radio';
    const group = radio ? elements.filter(e => e.type === 'radio' && e.name === el.name && e.form === el.form) : null;
    if (radio && seen.has(el)) continue;
    if (radio) group.forEach(e => seen.add(e));
    const id = `field-${fields.length}`;
    let blocked = null;
    if (el.disabled || el.readOnly) blocked = 'disabled or read-only';
    else if (!el.getClientRects().length || el.type === 'hidden' || getComputedStyle(el).visibility === 'hidden') blocked = 'hidden field';
    else if (['password','file','checkbox','date','number'].includes(el.type) || el.multiple) blocked = 'unsupported control';
    else if (radio && (!el.name || !el.closest('fieldset')?.querySelector('legend'))) blocked = 'radio needs named fieldset';
    else if (!radio && !['text','email','tel','url','search','select-one','textarea'].includes(el.type)) blocked = 'unsupported control';
    const options = group ? group.map(e => ({value:e.value,
      label:[...(e.labels ?? [])].map(l => l.textContent.trim()).join(' '), disabled:e.disabled})) :
      el.tagName === 'SELECT' ? [...el.options].map(o => ({value:o.value,label:o.textContent.trim(),disabled:o.disabled})) : [];
    const action=el.form?.action ?? location.href;
    if (!/^https?:/i.test(action)) blocked='unsupported form destination';
    fields.push({id, label:labelFor(el), action, autocomplete:el.autocomplete ?? '', kind:radio ? 'radio' : el.tagName === 'SELECT' ? 'select' : 'text',
      options, blocked, currentValue:blocked ? '' : (group ? group.some(e => e.checked) : el.value !== '') ? '[present]' : '',
      signature:signature(el, group)});
    handles.set(id, {el, group});
  }
  const nonce = crypto.randomUUID();
  const destination = JSON.stringify({url:location.href, forms:[...document.forms].map(f => f.action)});
  const snapshot = {nonce, url:location.href, destination, fields};
  globalThis.__formProof = {snapshot, handles, signature, used:false};
  return snapshot;
}

export function applyPage(approval) {
  const state = globalThis.__formProof;
  const fail = reason => ({applied:[], errors:[reason]});
  const currentDestination = () => JSON.stringify({url:location.href, forms:[...document.forms].map(f => f.action)});
  const currentRadioGroup = el => [...document.querySelectorAll('input')].filter(e => e.type==='radio' && e.name===el.name && e.form===el.form);
  const sameGroup = (el,group) => !group || (() => {const live=currentRadioGroup(el);return live.length===group.length && group.every((e,i)=>e===live[i]);})();
  if (!state || state.used || state.snapshot.nonce !== approval.nonce) return fail('Review expired or already used');
  state.used = true; // Even a failed approval is single-use.
  const destination = currentDestination();
  if (approval.url !== location.href || approval.destination !== destination) return fail('Destination changed');
  if (approval.fields.some(f => f.sensitive) && !approval.sensitiveApproved) return fail('Sensitive approval missing');
  if (new Set(approval.fields.map(f => f.id)).size !== approval.fields.length) return fail('Duplicate field approval');
  // Validate all targets before the first mutation, including labels/options changed by page scripts.
  for (const item of approval.fields) {
    const handle = state.handles.get(item.id);
    if (!handle) return fail('Unknown field');
    const {el,group} = handle;
    if (!el.isConnected || group?.some(e => !e.isConnected) || !sameGroup(el,group) || state.signature(el,group) !== item.signature)
      return fail('Form changed; scan again');
    const current = group ? group.find(e => e.checked)?.value ?? '' : el.value;
    if (current !== '' || el.disabled || el.readOnly || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden')
      return fail('Field is no longer empty and editable');
    const original = state.snapshot.fields.find(f => f.id === item.id);
    if (original.blocked || typeof item.value !== 'string') return fail('Unsupported field');
    if (original.kind !== 'text' && !original.options.some(o => !o.disabled && o.value === item.value)) return fail('Invalid option');
  }
  const applied = [];
  for (const item of approval.fields) {
    const {el,group} = state.handles.get(item.id);
    // Events from earlier fields can mutate later fields; recheck before each write.
    if (approval.url!==location.href || approval.destination!==currentDestination())
      return {applied,errors:['Destination changed during fill; remaining fields skipped']};
    if (!el.isConnected || !sameGroup(el,group) || state.signature(el,group) !== item.signature || el.disabled || el.readOnly ||
        (group ? group.some(e => e.checked) : el.value !== ''))
      return {applied, errors:['Page changed during fill; remaining fields skipped']};
    const target = group ? group.find(e => e.value === item.value && !e.disabled) : el;
    if (!target || !target.getClientRects().length || getComputedStyle(target).visibility === 'hidden')
      return {applied,errors:['Target became unavailable']};
    if (group) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked').set.call(target,true);
    else {
      const proto = target.tagName === 'SELECT' ? HTMLSelectElement.prototype :
        target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(target,item.value);
    }
    applied.push(item.id);
    target.dispatchEvent(new Event('input', {bubbles:true}));
    target.dispatchEvent(new Event('change', {bubbles:true}));
  }
  return {applied, errors:[]};
}

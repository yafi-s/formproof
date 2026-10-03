// These functions are self-contained so Chrome can inject their source in the isolated world.
// They never submit, click buttons, fetch, or attach resume files.
export function scanPage() {
  function visible(el){
    const rect=el.getBoundingClientRect();if(rect.width<=0||rect.height<=0||el.closest('[hidden],[inert]'))return false;
    for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);
      if(style.visibility!=='visible'||style.display==='none'||Number(style.opacity)===0)return false;}
    return true;
  }
  function labelFor(el) {
    // Wrapped selects/textareas contribute their option/value text to label.textContent.
    // Read the label itself without treating choices or existing answers as its name.
    function labelText(label){const copy=label.cloneNode(true);copy.querySelectorAll('input,select,textarea,button').forEach(node=>node.remove());return copy.textContent.trim();}
    if (el.type === 'radio') {
      const legend = el.closest('fieldset')?.querySelector('legend');
      if (legend) return legend.textContent.trim();
    }
    const refs = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => {const label=document.getElementById(id);return label?labelText(label):'';}).join(' ').trim();
    return el.getAttribute('aria-label') || refs || [...(el.labels ?? [])].map(labelText).join(' ') || el.placeholder || '';
  }
  function signature(el, group) {
    return JSON.stringify({tag:el.tagName, type:el.type, name:el.name, label:labelFor(el),
      autocomplete:el.autocomplete, action:el.form?.action ?? location.href,min:el.min??'',max:el.max??'',step:el.step??'',
      options:group ? group.map(e => [e.value, [...(e.labels ?? [])].map(l => l.textContent.trim()).join(' '), e.matches(':disabled')]) :
        el.tagName === 'SELECT' ? [...el.options].map(o => [o.value,o.textContent.trim(),o.matches(':disabled')]) : null});
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
    if (el.matches(':disabled') || el.readOnly) blocked = 'disabled or read-only';
    else if (!visible(el) || el.type === 'hidden') blocked = 'hidden field';
    else if (['password','file','checkbox','number'].includes(el.type) || el.multiple) blocked = 'unsupported control';
    else if (radio && (!el.name || !el.closest('fieldset')?.querySelector('legend'))) blocked = 'radio needs named fieldset';
    else if (!radio && !['text','email','tel','url','search','select-one','textarea','date','month'].includes(el.type)) blocked = 'unsupported control';
    const options = group ? group.map(e => ({value:e.value,
      label:[...(e.labels ?? [])].map(l => l.textContent.trim()).join(' '), disabled:e.matches(':disabled')})) :
      el.tagName === 'SELECT' ? [...el.options].map(o => ({value:o.value,label:o.textContent.trim(),disabled:o.matches(':disabled')})) : [];
    const action=el.form?.action ?? location.href;
    if (!/^https?:/i.test(action)) blocked='unsupported form destination';
    fields.push({id, label:labelFor(el), action, autocomplete:el.autocomplete ?? '',min:el.min??'',max:el.max??'',step:el.step??'',
      kind:radio ? 'radio' : el.tagName === 'SELECT' ? 'select' : ['date','month'].includes(el.type)?el.type:'text',
      options, blocked, currentValue:blocked ? '' : (group ? group.some(e => e.checked) : el.value !== '') ? '[present]' : '',
      signature:signature(el, group)});
    handles.set(id, {el, group});
  }
  const nonce = crypto.randomUUID();
  const destination = JSON.stringify({url:location.href, forms:[...document.forms].map(f => f.action)});
  const snapshot = {nonce, url:location.href, destination, fields};
  globalThis.__formProof = {snapshot, handles, signature,visible,used:false};
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
    if (current !== '' || el.matches(':disabled') || el.readOnly || !state.visible(el))
      return fail('Field is no longer empty and editable');
    const original = state.snapshot.fields.find(f => f.id === item.id);
    if (original.blocked || typeof item.value !== 'string') return fail('Unsupported field');
    if (['select','radio'].includes(original.kind) && !original.options.some(o => !o.disabled && o.value === item.value)) return fail('Invalid option');
    if(['date','month'].includes(original.kind)){
      const probe=document.createElement('input');probe.type=original.kind;probe.min=el.min;probe.max=el.max;probe.step=el.step;probe.value=item.value;
      if(probe.value!==item.value||!probe.checkValidity())return fail('Invalid date or form bounds');
    }
  }
  const applied = [];
  for (const item of approval.fields) {
    const {el,group} = state.handles.get(item.id);
    // Events from earlier fields can mutate later fields; recheck before each write.
    if (approval.url!==location.href || approval.destination!==currentDestination())
      return {applied,errors:['Destination changed during fill; remaining fields skipped']};
    if (!el.isConnected || !sameGroup(el,group) || state.signature(el,group) !== item.signature || el.matches(':disabled') || el.readOnly || !state.visible(el) ||
        (group ? group.some(e => e.checked) : el.value !== ''))
      return {applied, errors:['Page changed during fill; remaining fields skipped']};
    const target = group ? group.find(e => e.value === item.value && !e.disabled) : el;
    if (!target || target.matches(':disabled') || !state.visible(target))
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

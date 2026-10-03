const ITERATIONS = 210000;
export function checkProfileSize(profile){
  const encoded=new TextEncoder().encode(JSON.stringify(profile));
  if(encoded.length>4*1024*1024)throw new Error('Local profile exceeds the 4 MB text budget. Remove a resume version or import a shorter document. Nothing was changed.');
  return encoded;
}
const bytes = () => crypto.getRandomValues(new Uint8Array(16));
const b64 = data => btoa(String.fromCharCode(...new Uint8Array(data)));
const un64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
async function keyFor(password, salt) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Use a passphrase of at least 12 characters');
  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations: ITERATIONS}, raw,
    {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export async function seal(profile, password) {
  const encoded=checkProfileSize(profile);
  const salt = bytes(); const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt);
  // No large spread on ciphertext, which may include several resume texts.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {name:'AES-GCM', iv, additionalData: new TextEncoder().encode('FormProof vault v1')}, key, encoded));
  let binary = ''; for (const byte of ciphertext) binary += String.fromCharCode(byte);
  return {version:1, kdf:'PBKDF2-SHA256', iterations:ITERATIONS, salt:b64(salt), iv:b64(iv), data:btoa(binary)};
}
export async function unseal(envelope, password) {
  if (envelope?.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS)
    throw new Error('Unsupported vault format');
  const key = await keyFor(password, un64(envelope.salt));
  const decoded = await crypto.subtle.decrypt({name:'AES-GCM', iv:un64(envelope.iv),
    additionalData: new TextEncoder().encode('FormProof vault v1')}, key, un64(envelope.data));
  const profile = JSON.parse(new TextDecoder().decode(decoded));
  if (profile.schema !== 1) throw new Error('Unsupported profile schema');
  return profile;
}

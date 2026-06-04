const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64FromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function getKeyMaterial(passphrase) {
  return crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
}

async function deriveKey(passphrase, salt) {
  const material = await getKeyMaterial(passphrase);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 150_000,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(value, passphrase) {
  if (!value) return { ciphertext: "", iv: "", salt: "" };
  if (!passphrase) {
    return { ciphertext: base64FromBytes(encoder.encode(value)), iv: "", salt: "", mode: "plain" };
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return {
    ciphertext: base64FromBytes(new Uint8Array(encrypted)),
    iv: base64FromBytes(iv),
    salt: base64FromBytes(salt),
    mode: "aes-gcm"
  };
}

export async function decryptSecret(record, passphrase) {
  if (!record?.ciphertext) return "";
  if (record.mode === "plain") {
    return decoder.decode(bytesFromBase64(record.ciphertext));
  }
  if (!passphrase) return "Encrypted";
  const salt = bytesFromBase64(record.salt);
  const iv = bytesFromBase64(record.iv);
  const key = await deriveKey(passphrase, salt);
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    bytesFromBase64(record.ciphertext)
  );
  return decoder.decode(bytes);
}


// Pure helpers for the contact 360 screens (links, labels, formatting).

export const CHANNEL_LABELS = {
  office: "Oficina",
  mobile: "Móvil",
  billing: "Facturación",
  other: "Otro",
};

export const ADDRESS_KIND_LABELS = {
  fiscal: "Fiscal",
  shipping: "Entrega",
  other: "Otra",
};

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

// Stored phones may or may not include the country code; prefix it when the
// national number is 10 digits (MX) and a country code is known.
export function fullPhoneDigits(value, countryCode = "+52") {
  const digits = digitsOnly(value);
  const cc = digitsOnly(countryCode);
  if (!digits) return "";
  if (digits.length === 10 && cc) return `${cc}${digits}`;
  return digits;
}

export function telHref(value, countryCode) {
  const digits = fullPhoneDigits(value, countryCode);
  return digits ? `tel:+${digits}` : null;
}

export function whatsappHref(value, countryCode) {
  const digits = fullPhoneDigits(value, countryCode);
  return digits ? `https://wa.me/${digits}` : null;
}

export function mailtoHref(value) {
  const email = String(value ?? "").trim();
  return email ? `mailto:${email}` : null;
}

export function formatAddressLines(address) {
  if (!address) return [];
  const street = [address.street, address.extNumber, address.intNumber && `Int. ${address.intNumber}`]
    .filter(Boolean)
    .join(" ");
  const area = [address.neighborhood, address.postalCode && `C.P. ${address.postalCode}`].filter(Boolean).join(", ");
  const region = [address.city, address.state, address.country].filter(Boolean).join(", ");
  return [street, area, region].filter(Boolean);
}

export function mapsHref(address) {
  const query = formatAddressLines(address).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

export function primaryChannel(channels = [], kind) {
  return channels.find((c) => c.kind === kind && c.isPrimary) ?? channels.find((c) => c.kind === kind) ?? null;
}

const RTF = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
const STEPS = [
  ["year", 31536000], ["month", 2592000], ["week", 604800],
  ["day", 86400], ["hour", 3600], ["minute", 60],
];

export function relativeTime(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return RTF.format(Math.round(seconds / size), unit);
  }
  return "hace un momento";
}

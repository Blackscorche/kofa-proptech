// Phone number helpers for Nigeria.
const BY_CODE = { '62130': 'MTN', '62120': 'Airtel', '62150': 'Glo', '62160': 'T2mobile' };

const PREFIXES = {
  MTN: ['0803', '0806', '0703', '0706', '0813', '0816', '0810', '0814', '0903', '0906', '0913', '0916', '0704', '07025', '07026'],
  Airtel: ['0802', '0808', '0708', '0812', '0701', '0902', '0901', '0904', '0907', '0912', '0911'],
  Glo: ['0805', '0807', '0705', '0815', '0811', '0905', '0915'],
  T2mobile: ['0809', '0818', '0817', '0909', '0908'],
};

function toE164(phone) {
  const d = String(phone || '').replace(/[^\d]/g, '');
  if (/^234\d{10}$/.test(d)) return '+' + d;
  if (/^0\d{10}$/.test(d)) return '+234' + d.slice(1);
  if (/^\d{10}$/.test(d)) return '+234' + d;
  return null;
}

function toLocal(phone) {
  const e = toE164(phone);
  if (!e) return phone || '';
  const l = '0' + e.slice(4);
  return `${l.slice(0, 4)} ${l.slice(4, 7)} ${l.slice(7)}`;
}

function detectNetwork(phone, networkCode) {
  if (networkCode && BY_CODE[networkCode]) return BY_CODE[networkCode];
  const e = toE164(phone);
  if (!e) return 'Unknown';
  const local = '0' + e.slice(4);
  const all = Object.entries(PREFIXES).flatMap(([net, ps]) => ps.map((p) => [p, net]));
  all.sort((a, b) => b[0].length - a[0].length);
  const hit = all.find(([p]) => local.startsWith(p));
  return hit ? hit[1] : 'Unknown';
}

module.exports = { toE164, toLocal, detectNetwork, NETWORKS: Object.keys(PREFIXES) };

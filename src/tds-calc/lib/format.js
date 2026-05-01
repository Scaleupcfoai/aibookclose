// Indian number formatting: 1,23,45,678 style.
export function formatINR(value) {
  if (value == null || isNaN(value)) return '—';
  const isNeg = value < 0;
  const abs = Math.abs(value);
  const [intPart, decPart] = abs.toFixed(2).split('.');
  let result;
  const digits = intPart.split('');
  const len = digits.length;
  if (len <= 3) {
    result = intPart;
  } else {
    result = digits.slice(len - 3).join('');
    let remaining = digits.slice(0, len - 3);
    while (remaining.length > 0) {
      const group = remaining.splice(-2).join('');
      result = group + ',' + result;
    }
  }
  return (isNeg ? '-' : '') + '₹' + result + '.' + decPart;
}

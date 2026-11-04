/** Keep accent text readable on the white page without changing saved settings. */
export function readableThemeColor(hex: string): string {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const contrast = () => {
    const linear = channels.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    return 1.05 / (linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 + .05);
  };
  if (contrast() >= 4.5) return hex;
  while (contrast() < 4.5) channels.forEach((value, index) => { channels[index] = Math.floor(value * .9); });
  return '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('');
}

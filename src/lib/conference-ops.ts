export function conferenceChannelName(hexQ: number, hexR: number, strongholdName?: string | null): string {
  if (strongholdName) {
    const slug = strongholdName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `conf-${slug}`;
  }
  const qStr = hexQ < 0 ? `n${Math.abs(hexQ)}` : `${hexQ}`;
  const rStr = hexR < 0 ? `n${Math.abs(hexR)}` : `${hexR}`;
  return `conf-${qStr}-${rStr}`;
}

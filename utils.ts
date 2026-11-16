export function splitOnFirst(str: string, del: string) {
  const s = str.split(del);
  if (s.length < 2) return [str];
  return [s[0]!, s.slice(1).join(del)];
}

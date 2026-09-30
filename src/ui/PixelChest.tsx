// Tiny pixel-art chest, drawn from a character map so it stays crisp at any size.

const MAP = [
  '..oooooooooooo..',
  '.oLLLLLLLLLLLLo.',
  'oLWWWWWWWWWWWWLo',
  'oLWwwwwwwwwwwWLo',
  'oMMMMMMKKMMMMMMo',
  'ooooooKkkKoooooo',
  'oMWWWWKkkKWWWWMo',
  'oMWwwwwKKwwwwWMo',
  'oMWwwwwwwwwwwWMo',
  'oMWwwwwwwwwwwWMo',
  'oMMMMMMMMMMMMMMo',
  'oooooooooooooooo',
];

const PALETTES = {
  gold: { L: '#ffe08a', M: '#e0a82e' },
  silver: { L: '#f1f4f8', M: '#9aa3b0' },
  bronze: { L: '#e8a468', M: '#a8612c' },
} as const;

export type Tier = keyof typeof PALETTES;

export const PixelChest = ({ tier, size = 32 }: { tier: Tier; size?: number }) => {
  const p = PALETTES[tier];
  const colors: Record<string, string> = { o: '#140d07', L: p.L, M: p.M, W: '#8a5a2e', w: '#6b4221', K: p.L, k: '#140d07' };
  const rects: JSX.Element[] = [];
  MAP.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') rects.push(<rect key={`${x},${y}`} x={x} y={y} width={1.02} height={1.02} fill={colors[ch]} />);
  }));
  return (
    <svg className="pixel-chest" viewBox="0 0 16 12" width={size} height={(size * 12) / 16} shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
};

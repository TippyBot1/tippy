// Tippy: a round mint robot wizard — big eyes, a floppy violet hat (his antenna
// light glows at the tip), a starry robe and a little wand. Pure SVG + CSS so the
// extension stays tiny. Moods map to what Tippy is doing.

export type Mood = 'idle' | 'watching' | 'happy' | 'worried' | 'sleeping' | 'confused' | 'selling';

const ANTENNA: Record<Mood, string> = {
  idle: 'var(--t-mint)',
  watching: 'var(--t-mint)',
  selling: 'var(--t-mint)',
  happy: 'var(--t-gold)',
  worried: 'var(--t-amber)',
  sleeping: 'var(--t-sleep)',
  confused: 'var(--t-pink)',
};

const ROBE = 'var(--t-robe, #6c5ce7)';
const ROBE_DEEP = 'var(--t-robe-deep, #4b3fb8)';
const GOLD = 'var(--t-gold, #ffd166)';

/** A little 4-point sparkle centred on (x, y). */
const star = (x: number, y: number, r: number) => `M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3}Z`;

export function Mascot({ mood = 'idle', size = 64, title = 'Tippy' }: { mood?: Mood; size?: number; title?: string }) {
  return (
    <svg class={`tippy-mascot mood-${mood}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={title}>
      <title>{title}</title>
      <g class="tm-bob">
        {/* feet peeking out under the robe */}
        <ellipse cx="46" cy="114" rx="8" ry="4.5" fill="var(--t-mint-deep)" />
        <ellipse cx="74" cy="114" rx="8" ry="4.5" fill="var(--t-mint-deep)" />
        {/* arms in wizard sleeves; the right hand holds the wand */}
        <g class="tm-arm tm-arm-l">
          <circle cx="7" cy="67" r="4.5" fill="var(--t-mint-deep)" />
          <rect x="9" y="60" width="18" height="14" rx="6" fill={ROBE} />
          <rect x="9" y="60" width="4.5" height="14" rx="2.2" fill={GOLD} />
        </g>
        <g class="tm-arm tm-arm-r">
          <line x1="110" y1="71" x2="113" y2="46" stroke="#8a5a3c" stroke-width="3.2" stroke-linecap="round" />
          <path class="tm-wand-star" d={star(113, 42, 6)} fill={GOLD} />
          <rect x="93" y="60" width="18" height="14" rx="6" fill={ROBE} />
          <rect x="106.5" y="60" width="4.5" height="14" rx="2.2" fill={GOLD} />
          <circle cx="112" cy="67" r="4.5" fill="var(--t-mint-deep)" />
        </g>
        {/* body */}
        <circle cx="60" cy="64" r="42" fill="var(--t-mint)" />
        {/* robe: V neckline, flares to the floor */}
        <path d="M25.5 88 L60 97 L94.5 88 Q101 100 108 113 Q60 121 12 113 Q19 100 25.5 88Z" fill={ROBE} />
        <path d="M25.5 88 L60 97 L94.5 88" stroke={GOLD} stroke-width="3" stroke-linejoin="round" stroke-linecap="round" fill="none" />
        <path d="M12 113 Q60 121 108 113" stroke={GOLD} stroke-width="3" stroke-linecap="round" fill="none" />
        <path d={star(60, 99, 5.5)} fill={GOLD} />
        <path d={star(37, 106, 3.2)} fill={GOLD} opacity="0.85" />
        <path d={star(84, 105, 2.6)} fill={GOLD} opacity="0.85" />
        {/* face screen */}
        <rect x="27" y="42" width="66" height="42" rx="20" fill="var(--t-screen)" />
        <Face mood={mood} />
        {/* cheeks */}
        <circle cx="35" cy="78" r="4.5" fill="var(--t-pink)" opacity="0.55" />
        <circle cx="85" cy="78" r="4.5" fill="var(--t-pink)" opacity="0.55" />
        {/* wizard hat: floppy tip with Tippy's antenna light, gold band, stars */}
        <path d="M34 25 C40 16 48 8 56 2 C62 -1 70 2 78 6 L89 11 C82 11 76 12 72 14 C77 18 82 21 86 25Z" fill={ROBE} />
        <path d="M36 20 Q60 14 84 20 L85.5 24 Q60 18 34.5 24Z" fill={GOLD} />
        <ellipse cx="60" cy="28" rx="41" ry="7" fill={ROBE_DEEP} />
        <path d={star(56, 10, 3.6)} fill={GOLD} />
        <circle cx="67" cy="6.5" r="1.4" fill={GOLD} />
        <circle class="tm-light" cx="90" cy="11.5" r="5.5" fill={ANTENNA[mood]} />
      </g>
      {mood === 'sleeping' && (
        <g class="tm-zzz" fill="var(--t-ink-soft)" font-family="ui-rounded, system-ui, sans-serif" font-weight="800">
          <text x="8" y="50" font-size="14">z</text>
          <text x="2" y="38" font-size="10">z</text>
        </g>
      )}
      {mood === 'confused' && (
        <text x="2" y="52" font-size="22" font-weight="900" fill="var(--t-pink)" font-family="ui-rounded, system-ui, sans-serif">
          ?
        </text>
      )}
      {mood === 'happy' && (
        <g class="tm-sparkle" fill="var(--t-gold)">
          <path d="M10 26 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" />
          <path d="M104 24 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z" />
        </g>
      )}
    </svg>
  );
}

function Face({ mood }: { mood: Mood }) {
  const eye = '#EFFFF8';
  const pupil = 'var(--t-ink)';
  switch (mood) {
    case 'happy':
      return (
        <g stroke={eye} stroke-width="4.5" stroke-linecap="round" fill="none">
          <path d="M40 62 q7 -9 14 0" />
          <path d="M66 62 q7 -9 14 0" />
          <path d="M50 70 q10 10 20 0" />
        </g>
      );
    case 'sleeping':
      return (
        <g stroke={eye} stroke-width="4" stroke-linecap="round" fill="none">
          <path d="M40 61 q7 5 14 0" />
          <path d="M66 61 q7 5 14 0" />
          <path d="M56 73 h8" />
        </g>
      );
    case 'worried':
      return (
        <g>
          <path d="M39 51 l13 4" stroke={eye} stroke-width="3" stroke-linecap="round" />
          <path d="M81 51 l-13 4" stroke={eye} stroke-width="3" stroke-linecap="round" />
          <circle cx="47" cy="62" r="7" fill={eye} />
          <circle cx="73" cy="62" r="7" fill={eye} />
          <circle cx="47" cy="65" r="3.5" fill={pupil} />
          <circle cx="73" cy="65" r="3.5" fill={pupil} />
          <path d="M53 76 q7 -5 14 0" stroke={eye} stroke-width="3" stroke-linecap="round" fill="none" />
        </g>
      );
    case 'confused':
      return (
        <g>
          <circle cx="47" cy="61" r="6" fill={eye} />
          <circle cx="73" cy="60" r="9" fill={eye} />
          <circle cx="48" cy="62" r="3" fill={pupil} />
          <circle cx="71" cy="61" r="4" fill={pupil} />
          <path d="M51 75 l5 -3 5 3 5 -3 5 3" stroke={eye} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </g>
      );
    default:
      // idle / watching / selling — round eyes; watching scans side to side
      return (
        <g>
          <g class="tm-eyes">
            <circle cx="47" cy="61" r="8" fill={eye} />
            <circle cx="73" cy="61" r="8" fill={eye} />
            <g class="tm-pupils">
              <circle cx="47" cy="62" r="4" fill={pupil} />
              <circle cx="73" cy="62" r="4" fill={pupil} />
            </g>
          </g>
          <path d="M53 73 q7 6 14 0" stroke={eye} stroke-width="3.5" stroke-linecap="round" fill="none" />
        </g>
      );
  }
}

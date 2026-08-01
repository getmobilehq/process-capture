/**
 * The Magpie mark.
 *
 * A magpie in white on a brand plate, with the wing patch and the eye punched
 * through to the plate colour rather than painted white — per the brand system,
 * "patch and eye are the background, not white ink". That is what keeps the bird
 * readable when the plate darkens in dark mode.
 *
 * The system specifies a blue→purple→red sweep on plates 64 px and above, and a
 * flat #712D85 below that. Everywhere this ships today is below 64 px, so the flat
 * anchor is the correct rendering, not a simplification.
 */
export function MagpieMark({ size = 34 }: { size?: number }) {
  const plate = 'var(--brand-mark)';
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Magpie"
      style={{ display: 'block', borderRadius: '50%', background: plate, flex: 'none' }}
    >
      <g fill="#FFFFFF">
        <polygon points="1.8,18 11.6,14.6 11.6,21.2" />
        <circle cx="19.5" cy="17" r="8.6" />
        <ellipse cx="32.5" cy="32" rx="14" ry="12" transform="rotate(-10 32.5 32)" />
        <polygon points="43,29.5 63,40.5 61,45.6 39,37.5" />
      </g>
      {/* Punched through to the plate, never filled white. */}
      <ellipse
        cx="28.5"
        cy="30.5"
        rx="5"
        ry="3.3"
        transform="rotate(-20 28.5 30.5)"
        fill={plate}
      />
      <circle cx="17" cy="15" r="2.9" fill={plate} />
    </svg>
  );
}

const CENTRE = 36;
const CHECK_PATH = 'M24 37 L33 46 L49 28';
const CHECK_STROKE_WIDTH = 8;
const RAY_COUNT = 8;
const RAY_START_RADIUS = 26;
const RAY_END_RADIUS = 31;
const RAY_STROKE_WIDTH = 3;
const ANGLE_STEP_DEGREES = 360 / RAY_COUNT;

/** Two decimals keep the generated coordinates short and stable in the markup. */
function roundCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

/** One point `radius` away from the centre, `radians` counter-clockwise from the positive x axis. */
function pointOnRay(radius: number, radians: number): string {
  const x = roundCoordinate(CENTRE + Math.cos(radians) * radius);
  const y = roundCoordinate(CENTRE + Math.sin(radians) * radius);
  return `${x} ${y}`;
}

function rayPath(index: number): string {
  const radians = (index * ANGLE_STEP_DEGREES * Math.PI) / 180;
  return `M${pointOnRay(RAY_START_RADIUS, radians)} L${pointOnRay(RAY_END_RADIUS, radians)}`;
}

const RAY_PATHS = Array.from({ length: RAY_COUNT }, (_, index) => rayPath(index));

/** Bold check mark inside eight short rays; the accent colour comes from `.setup-complete-icon`. */
export function SetupCompleteIcon() {
  return (
    <svg
      className="setup-complete-icon"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={CHECK_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={CHECK_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {RAY_PATHS.map((ray) => (
        <path
          key={ray}
          d={ray}
          fill="none"
          stroke="currentColor"
          strokeWidth={RAY_STROKE_WIDTH}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

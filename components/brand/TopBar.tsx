import { MagpieMark } from './MagpieMark';

/**
 * The Magpie lockup, carried on every page of both faces (FR-6.2).
 *
 * Mark plus wordmark, with the delivery partner named underneath rather than
 * beside it — Magpie is the product, Virgin Media O2 is who it is for, and the
 * hierarchy should say so.
 */
export function TopBar() {
  return (
    <header className="pc-topbar">
      <div className="pc-topbar-in">
        <MagpieMark size={34} />
        <div>
          <div className="pc-tname">Magpie</div>
          <div className="pc-tsub">Process capture for Virgin Media O2</div>
        </div>
      </div>
    </header>
  );
}

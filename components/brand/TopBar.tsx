/**
 * The Virgin Media O2 lockup, carried on every page of both faces (FR-6.2).
 * Reproduces the approved demo's header so a reviewer recognises the built
 * product as the same thing. Plain <img> against the statically served brand
 * asset — no Next image pipeline, the file is already sized for its slot.
 */
export function TopBar() {
  return (
    <header className="pc-topbar">
      <div className="pc-topbar-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logos/vmo2-logo.png" alt="Virgin Media O2" />
        <div>
          <div className="pc-tname">Process capture</div>
          <div className="pc-tsub">SME interview tool · V1</div>
        </div>
      </div>
    </header>
  );
}

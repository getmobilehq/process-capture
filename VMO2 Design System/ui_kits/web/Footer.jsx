function Footer() {
  const cols = [
    { h: 'Mobile', items: ['Pay monthly', 'SIM only', 'Business mobile', 'Roaming'] },
    { h: 'Broadband', items: ['Fibre plans', 'Volt bundles', 'Switch to us'] },
    { h: 'Business', items: ['VMO2 Business', 'Public sector', 'Wholesale', 'Partners'] },
    { h: 'Help', items: ['Contact us', 'Accessibility', 'Network status', 'Coverage checker'] },
  ];
  return (
    <footer className="vmo2-footer">
      <div className="vmo2-footer__inner">
        <div className="vmo2-footer__brand">
          <img src="../../assets/logos/vmo2-logo.png" alt="Virgin Media O2" />
          <p className="t-body-s">Part of the Liberty Global and Telefónica joint venture.</p>
          <div className="vmo2-footer__siblings">
            <img src="../../assets/logos/virgin-media-business.png" alt="Virgin Media Business" />
            <img src="../../assets/logos/o2-business-horizontal.png" alt="O2 Business" />
            <img src="../../assets/logos/giffgaff.png" alt="giffgaff" />
          </div>
        </div>
        <div className="vmo2-footer__cols">
          {cols.map(c => (
            <div key={c.h}>
              <h4>{c.h}</h4>
              <ul>{c.items.map(i => <li key={i}><a href="#">{i}</a></li>)}</ul>
            </div>
          ))}
        </div>
      </div>
      <div className="vmo2-footer__base">
        <p>© Virgin Media O2 2026. All rights reserved.</p>
        <p>Privacy · Cookies · Modern slavery · Accessibility</p>
      </div>
    </footer>
  );
}
window.Footer = Footer;

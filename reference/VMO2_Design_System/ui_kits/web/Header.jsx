function Header() {
  const [activeSub, setActiveSub] = React.useState('Business');
  return (
    <header className="vmo2-header">
      <div className="vmo2-header__inner">
        <a className="vmo2-header__logo" href="#">
          <img src="../../assets/logos/vmo2-business-stacked.png" alt="Virgin Media O2 Business" />
        </a>
        <nav className="vmo2-header__nav">
          {['Mobile', 'Broadband', 'Fibre & networks', 'IoT', 'Public sector', 'Support'].map(label => (
            <a key={label} href="#" className="vmo2-header__link">{label}</a>
          ))}
        </nav>
        <div className="vmo2-header__actions">
          <a href="#" className="vmo2-header__link">Sign in</a>
          <button className="vmo2-btn vmo2-btn--primary">Get a quote</button>
        </div>
      </div>
      <div className="vmo2-subnav">
        {['Business', 'Public sector', 'Wholesale', 'Partners'].map(s => (
          <button
            key={s}
            onClick={() => setActiveSub(s)}
            className={'vmo2-subnav__item ' + (activeSub === s ? 'is-active' : '')}>
            {s}
          </button>
        ))}
      </div>
    </header>
  );
}
window.Header = Header;

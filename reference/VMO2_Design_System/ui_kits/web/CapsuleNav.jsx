function CapsuleNav() {
  const tabs = [
    { label: 'Benefits to VMO2', color: 'red',  cap: 'blue' },
    { label: 'For our customers', color: 'blue', cap: 'red'  },
    { label: 'The deal in four steps', color: 'blue', cap: 'red' },
    { label: "What's next?", color: 'pink', cap: 'red' },
  ];
  const [active, setActive] = React.useState(0);
  return (
    <section className="vmo2-tabs">
      <div className="vmo2-tabs__strip">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setActive(i)}
            className={'vmo2-cap vmo2-cap--' + t.color + (active===i ? ' is-active' : '')}>
            <span>{t.label}</span>
            <i className={'vmo2-cap__circle vmo2-cap__circle--' + t.cap} />
          </button>
        ))}
      </div>
      <div className="vmo2-tabs__panel">
        <h3>{tabs[active].label}</h3>
        <ul>
          <li><strong>Scale to challenge at national level</strong> — expanded nexfibre footprint is expected to reach around 8m full-fibre homes.</li>
          <li><strong>Stronger as a disruptive wholesale challenger</strong> to BT Openreach, offering greater choice for the future.</li>
          <li><strong>We'll enhance competition</strong> and strengthen the UK's digital infrastructure.</li>
        </ul>
      </div>
    </section>
  );
}
window.CapsuleNav = CapsuleNav;

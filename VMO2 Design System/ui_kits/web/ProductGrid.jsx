function ProductGrid() {
  const items = [
    { tag: 'Mobile',    title: 'Unlimited Business mobile',  body: '5G data on the UK\u2019s largest network. Unlimited calls and texts.', cta: 'See plans',  color: 'red' },
    { tag: 'Fibre',     title: 'Gig1 leased line',           body: 'Symmetrical 1 Gbps with 99.99% SLA and 4-hour fix.',                  cta: 'Get a quote', color: 'blue' },
    { tag: 'IoT',       title: 'Managed IoT connectivity',   body: 'A single SIM for global fleets across 600+ networks.',               cta: 'Talk to us',  color: 'pink' },
  ];
  return (
    <section className="vmo2-grid">
      <div className="vmo2-grid__head">
        <p className="t-eyebrow">Products</p>
        <h2 className="t-h1">Connectivity that pulls its weight.</h2>
      </div>
      <div className="vmo2-grid__items">
        {items.map(it => (
          <article key={it.title} className="vmo2-card">
            <div className={'vmo2-cap vmo2-cap--' + it.color}>
              <span>{it.tag}</span>
              <i className="vmo2-cap__circle vmo2-cap__circle--blue" />
            </div>
            <h3>{it.title}</h3>
            <p>{it.body}</p>
            <a href="#" className="vmo2-card__cta">{it.cta} →</a>
          </article>
        ))}
      </div>
    </section>
  );
}
window.ProductGrid = ProductGrid;

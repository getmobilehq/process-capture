function Hero() {
  return (
    <section className="vmo2-hero">
      <div className="vmo2-hero__bg" />
      <div className="vmo2-hero__inner">
        <div className="vmo2-hero__copy">
          <div className="vmo2-cap vmo2-cap--gradient">
            <span>Instant quote</span>
            <i className="vmo2-cap__circle" />
          </div>
          <h1 className="t-shout vmo2-hero__h">
            Built for British business.<br />Wired for what's next.
          </h1>
          <p className="vmo2-hero__sub">
            Fibre, mobile and managed networks from the UK's largest combined connectivity provider. 99.9% mobile coverage. Full-fibre to 8 million homes by 2027.
          </p>
          <div className="vmo2-hero__cta">
            <button className="vmo2-btn vmo2-btn--primary">Talk to sales</button>
            <button className="vmo2-btn vmo2-btn--ghost">See plans →</button>
          </div>
        </div>
        <div className="vmo2-hero__visual">
          <img src="../../_pptx_media/image1.jpg" alt="" onError={(e)=>{e.target.style.display='none'}} />
        </div>
      </div>
    </section>
  );
}
window.Hero = Hero;

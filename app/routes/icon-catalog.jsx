import {
  PRODUCT_PULSE_ICON_CATALOG,
  PRODUCT_PULSE_ICON_RENDERERS,
} from "../lib/product-pulse-icon-catalog";
import { ProductPulseGlyph } from "../components/ProductPulseScreens";

export default function IconCatalog() {
  return (
    <main className="ppIconCatalogPage" aria-label="ProductPulse icon catalog">
      <header className="ppIconCatalogHeader">
        <div>
          <p>ProductPulse UI kit</p>
          <h1>Icon catalog</h1>
        </div>
        <span>{PRODUCT_PULSE_ICON_CATALOG.length} icons</span>
      </header>

      <section className="ppIconCatalogGrid" aria-label="Available icons">
        {PRODUCT_PULSE_ICON_CATALOG.map((icon) => (
          <article className="ppIconCatalogTile" key={icon.key}>
            <span className="ppIconCatalogGlyph" aria-hidden="true">
              <IconCatalogGlyph icon={icon} />
            </span>
            <strong>{icon.name}</strong>
            <small>{icon.key}</small>
          </article>
        ))}
      </section>
    </main>
  );
}

function IconCatalogGlyph({ icon }) {
  if (icon.renderer === PRODUCT_PULSE_ICON_RENDERERS.asset && icon.assetPath) {
    return <img src={icon.assetPath} alt="" loading="lazy" decoding="async" />;
  }

  if (icon.renderer === PRODUCT_PULSE_ICON_RENDERERS.textGlyph) {
    return <span className="ppIconCatalogTextGlyph">P</span>;
  }

  return <ProductPulseGlyph type={icon.key} />;
}

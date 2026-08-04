/**
 * Rendered specification view.
 *
 * The markdown is ours — the renderer in lib/spec/render.ts writes every line of
 * it — so this parses the subset that renderer emits rather than pulling in a
 * markdown library (P6: extend before adding). It also means no
 * `dangerouslySetInnerHTML`: everything below is React elements, so a stray
 * angle bracket in an informant's words can never become markup.
 *
 * The frontmatter becomes a metadata panel rather than a wall of YAML — it is the
 * provenance record, and a reader should be able to take it in at a glance.
 */
export interface SpecMeta {
  processName?: string;
  department?: string;
  informant?: string;
  interviewed?: string;
  durationMin?: string;
  provenance?: string;
  coverage: { label: string; value: string }[];
  openItems: string[];
  notApplicable: string[];
}

/** Split the frontmatter from the body and read the fields the renderer writes. */
export function parseSpec(markdown: string): { meta: SpecMeta; body: string } {
  const m = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: SpecMeta = { coverage: [], openItems: [], notApplicable: [] };
  if (!m) return { meta, body: markdown };

  const [, front, body] = m;
  const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, '$1');
  const field = (k: string) => front.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1];

  meta.processName = field('process_name') ? unquote(field('process_name')!) : undefined;
  meta.department = field('department') ? unquote(field('department')!) : undefined;
  meta.interviewed = field('interviewed')?.trim();
  meta.durationMin = field('duration_min')?.trim();
  meta.provenance = field('provenance')?.trim();

  const inf = field('informant');
  if (inf) {
    const name = inf.match(/name:\s*"([^"]*)"/)?.[1];
    const role = inf.match(/role:\s*"([^"]*)"/)?.[1];
    meta.informant = [name, role].filter(Boolean).join(' · ');
  }

  const cov = field('coverage');
  if (cov) {
    for (const pair of cov.replace(/[{}]/g, '').split(',')) {
      const [k, v] = pair.split(':');
      if (k && v) meta.coverage.push({ label: k.trim().replace(/_/g, ' '), value: v.trim() });
    }
  }

  // List items sit under their key, indented with "- ".
  const listUnder = (key: string) => {
    const at = front.indexOf(`${key}:`);
    if (at === -1) return [];
    const rest = front.slice(at).split('\n').slice(1);
    const out: string[] = [];
    for (const line of rest) {
      if (!/^\s+-\s/.test(line)) break;
      out.push(unquote(line.replace(/^\s+-\s*/, '')));
    }
    return out;
  };
  meta.openItems = listUnder('open_items');
  meta.notApplicable = listUnder('not_applicable_items');

  return { meta, body };
}

/** Inline emphasis: **bold** and _italic_, as the renderer emits them. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|_(.+?)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={`${keyBase}-b${i}`}>{m[1]}</strong>);
    else parts.push(<em key={`${keyBase}-i${i}`}>{m[2]}</em>);
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function SpecView({ markdown }: { markdown: string }) {
  const { meta, body } = parseSpec(markdown);

  // Blocks are separated by blank lines; each is a heading, quote, or paragraph.
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return (
    <div className="pc-spec">
      <section className="pc-spec-meta" aria-label="Specification provenance">
        <div className="pc-spec-metagrid">
          {meta.informant && (
            <div>
              <dt>Informant</dt>
              <dd>{meta.informant}</dd>
            </div>
          )}
          {meta.department && (
            <div>
              <dt>Department</dt>
              <dd>{meta.department}</dd>
            </div>
          )}
          {meta.interviewed && (
            <div>
              <dt>Interviewed</dt>
              <dd>{meta.interviewed}</dd>
            </div>
          )}
          {meta.durationMin && (
            <div>
              <dt>Duration</dt>
              <dd>{meta.durationMin} min</dd>
            </div>
          )}
          {meta.provenance && (
            <div>
              <dt>Provenance</dt>
              <dd>{meta.provenance}</dd>
            </div>
          )}
        </div>

        {meta.coverage.length > 0 && (
          <div className="pc-spec-coverage">
            {meta.coverage.map((c) => (
              <span key={c.label} className="pc-spec-stat">
                <b>{c.value}</b> {c.label}
              </span>
            ))}
          </div>
        )}

        {meta.openItems.length > 0 && (
          <div className="pc-spec-open">
            <p className="t-caption">Open items — what this interview did not settle</p>
            <ul>
              {meta.openItems.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}

        {meta.notApplicable.length > 0 && (
          <div className="pc-spec-open">
            <p className="t-caption">Ruled out by the informant</p>
            <ul>
              {meta.notApplicable.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <article className="pc-spec-body">
        {blocks.map((block, i) => {
          if (block.startsWith('# ')) {
            return (
              <h2 key={i} className="t-h3 pc-spec-title">
                {block.slice(2)}
              </h2>
            );
          }
          if (block.startsWith('## ')) {
            const [, num, name, state] =
              block.slice(3).match(/^(\d+)\.\s*(.+?)\s+—\s+(.+)$/) ?? [];
            if (num) {
              return (
                <h3 key={i} className="pc-spec-facet">
                  <span className="pc-spec-facetnum">{num}</span>
                  <span className="pc-spec-facetname">{name}</span>
                  <span className={`pc-spec-state ${state.replace(/\s+/g, '-')}`}>{state}</span>
                </h3>
              );
            }
            return (
              <h3 key={i} className="pc-spec-facet">
                {block.slice(3)}
              </h3>
            );
          }
          // Finding callouts and the provenance line are both blockquotes.
          if (block.startsWith('>')) {
            const text = block
              .split('\n')
              .map((l) => l.replace(/^>\s?/, ''))
              .join('\n');
            return (
              <blockquote key={i} className="pc-spec-callout">
                {text.split('\n').map((l, j) => (
                  <p key={j}>{inline(l, `${i}-${j}`)}</p>
                ))}
              </blockquote>
            );
          }
          if (block === '---') return <hr key={i} className="pc-spec-rule" />;
          return <p key={i}>{inline(block, String(i))}</p>;
        })}
      </article>
    </div>
  );
}

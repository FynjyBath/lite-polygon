import katex from 'katex';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: true });
  } catch {
    return `<span style="color:red">${esc(tex)}</span>`;
  }
}

export function latexToHtml(text: string): string {
  if (!text?.trim()) return '';

  const slots: string[] = [];
  const save = (html: string) => { const i = slots.length; slots.push(html); return `\x00S${i}\x00`; };

  let s = text;

  // Math: display $$...$$ and \[...\]
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, t) => save(renderMath(t, true)));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, t) => save(renderMath(t, true)));
  // Math: inline $...$ and \(...\)
  s = s.replace(/\$([^\$\n]+?)\$/g, (_, t) => save(renderMath(t, false)));
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, t) => save(renderMath(t, false)));

  // Verbatim environments — protect from further processing
  s = s.replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g,
    (_, c) => save(`<pre class="lx-pre">${esc(c)}</pre>`));

  // Text commands
  s = s.replace(/\\textbf\{([^}]*)\}/g, '<b>$1</b>');
  s = s.replace(/\\textit\{([^}]*)\}/g, '<i>$1</i>');
  s = s.replace(/\\emph\{([^}]*)\}/g, '<i>$1</i>');
  s = s.replace(/\\texttt\{([^}]*)\}/g, '<code class="lx-tt">$1</code>');
  s = s.replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>');
  s = s.replace(/\\text\{([^}]*)\}/g, '$1');
  s = s.replace(/\\mbox\{([^}]*)\}/g, '$1');

  // Paragraph-level commands
  s = s.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g,
    (_, c) => `<div style="text-align:center">${c}</div>`);

  // itemize / enumerate
  function wrapList(content: string, tag: string): string {
    const items = content.split(/\\item/).slice(1)
      .map(i => `<li>${i.trim()}</li>`).join('');
    return `<${tag} class="lx-list">${items}</${tag}>`;
  }
  s = s.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g,
    (_, c) => wrapList(c, 'ul'));
  s = s.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g,
    (_, c) => wrapList(c, 'ol'));

  // Tabular — simplified pass-through as a simple table
  s = s.replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_, body) => {
    const rows = body.trim().split(/\\\\/).map((r: string) => r.trim()).filter(Boolean);
    const trs = rows.map((r: string) => {
      const cells = r.split('&').map((c: string) => `<td style="padding:2px 8px;border:1px solid #ccc">${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table style="border-collapse:collapse;margin:4px 0">${trs}</table>`;
  });

  // Remaining unknown environments — strip tags
  s = s.replace(/\\begin\{[^}]*\}/g, '').replace(/\\end\{[^}]*\}/g, '');

  // Typography
  s = s.replace(/``(.*?)''/g, '“$1”');
  s = s.replace(/`(.*?)'/g, '‘$1’');
  s = s.replace(/---/g, '—');
  s = s.replace(/--/g, '–');

  // Non-breaking space
  s = s.replace(/~/g, ' ');

  // Explicit line break
  s = s.replace(/\\\\/g, '<br>');

  // \par → paragraph break
  s = s.replace(/\\par\b/g, '\n\n');

  // \noindent, \newpage etc. — strip
  s = s.replace(/\\noindent\b/g, '');
  s = s.replace(/\\newpage\b/g, '<hr style="border:none;border-top:1px solid #ddd;margin:12px 0">');
  s = s.replace(/\\medskip\b|\\bigskip\b|\\smallskip\b/g, '<br>');

  // Remaining unknown commands \foo{} — just render the content
  s = s.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1');
  // Remaining \foo — strip
  s = s.replace(/\\[a-zA-Z]+\*?\b/g, '');

  // Wrap double-newline separated blocks into paragraphs
  const paras = s.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  s = paras.map(p => `<p class="lx-p">${p.replace(/\n/g, ' ')}</p>`).join('\n');

  // Restore saved slots
  s = s.replace(/\x00S(\d+)\x00/g, (_, i) => slots[parseInt(i)]);

  return s;
}

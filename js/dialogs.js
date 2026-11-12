// Diálogos do app (T13): trocam o prompt() e o confirm() do navegador. Só interface, nenhuma regra de negócio.
// Usam <dialog>.showModal(): o foco fica preso no diálogo e o fundo não recebe toque.
// Cada saída (botão, toque no fundo, Esc) resolve e remove o diálogo por conta própria, sem depender do evento "close".

const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...children);
  return n;
};

/** Mostra o diálogo e devolve finish(valor): fecha, remove e resolve uma vez só. */
function show(dlg, resolve) {
  let done = false;
  const finish = (value) => {
    if (done) return;
    done = true;
    try { dlg.close(); } catch { /* já fechado */ }
    dlg.remove();
    resolve(value);
  };
  dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); }); // toque no fundo escurecido
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); }); // Esc
  dlg.addEventListener('close', () => finish(null)); // qualquer outro fechamento
  document.body.append(dlg);
  dlg.showModal();
  return finish;
}

/** Pede um texto. Devolve o texto, ou null se cancelou. */
export function askText({ title, label, initial = '', confirmLabel = 'Salvar', maxLength = 80 }) {
  return new Promise((resolve) => {
    const input = el('input', { className: 'field', type: 'text', value: initial, maxLength, autocomplete: 'off', enterKeyHint: 'done', id: 'dlgField' });
    let finish;
    const form = el('form', { className: 'dlg-body' },
      el('h2', { textContent: title }),
      el('label', { htmlFor: 'dlgField', className: 'dlg-label', textContent: label }),
      input,
      el('div', { className: 'dlg-actions' },
        el('button', { className: 'btn', type: 'button', textContent: 'Cancelar', onclick: () => finish(null) }),
        el('button', { className: 'btn primary', type: 'submit', textContent: confirmLabel })));
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!input.value.trim()) return input.focus(); // vazio não conta
      finish(input.value);
    };
    finish = show(el('dialog', { className: 'dlg' }, form), resolve);
    input.select();
  });
}

/** Confirma uma ação. Devolve true se o usuário confirmou. */
export function confirmDialog({ title, text, confirmLabel = 'Apagar', danger = true }) {
  return new Promise((resolve) => {
    let finish;
    const dlg = el('dialog', { className: 'dlg', role: 'alertdialog' },
      el('div', { className: 'dlg-body' },
        el('h2', { textContent: title }),
        text ? el('p', { className: 'dlg-text', textContent: text }) : '',
        el('div', { className: 'dlg-actions' },
          el('button', { className: 'btn', type: 'button', textContent: 'Cancelar', onclick: () => finish(false) }),
          el('button', { className: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', textContent: confirmLabel, onclick: () => finish(true) }))));
    finish = show(dlg, (v) => resolve(v === true));
  });
}

/** Folha de baixo com conteúdo livre. Devolve { close } para o chamador fechar quando terminar. */
export function openSheet(dlg) {
  const finish = show(dlg, () => {});
  return { close: () => finish(null) };
}

// Minimal element builder: h('button.btn.primary', { onclick }, child, child…)

type Child = Node | string | null | undefined | false;

export function h(spec: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key in el && key !== 'list' && key !== 'form') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const el = h('div.toast', { role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

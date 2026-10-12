// A minimal browser for tests: just enough DOM for the h()/clear()/toast()
// screens and the <dialog> helper, plus a localStorage that can be made to fail
// the two ways real browsers fail. Test-only; nothing in the game imports it,
// so it adds nothing to the bundle. Events bubble along the path computed at
// dispatch time, like the real DOM. There is no layout: offsetLeft and
// scrollLeft are plain numbers a test can set.

export interface FakeEvent {
  type: string;
  /** keydown only */
  key?: string;
  target: FakeElement;
  currentTarget: FakeElement;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

type Listener = (event: FakeEvent) => void;

export class FakeNode {
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  /** In the page: hangs under <html>. A screen that was cleared away is not. */
  get isConnected(): boolean {
    let root: FakeNode = this;
    while (root.parentNode) root = root.parentNode;
    return root instanceof FakeElement && root.tagName === 'html';
  }

  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(value: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [new FakeText(String(value))];
    this.childNodes[0].parentNode = this as unknown as FakeElement;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

export class FakeText extends FakeNode {
  constructor(public data: string) {
    super();
  }

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string) {
    this.data = value;
  }
}

class FakeClassList {
  constructor(private el: FakeElement) {}

  private get names(): Set<string> {
    return new Set(this.el.className.split(/\s+/).filter(Boolean));
  }

  add(...names: string[]): void {
    const s = this.names;
    names.forEach((n) => s.add(n));
    this.el.className = [...s].join(' ');
  }

  remove(...names: string[]): void {
    const s = this.names;
    names.forEach((n) => s.delete(n));
    this.el.className = [...s].join(' ');
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }
}

class FakeStyle {
  cssText = '';
  private props = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? '';
  }
}

/** What has focus: document.activeElement reads it, element.focus() sets it. */
let focused: FakeElement | null = null;

export class FakeElement extends FakeNode {
  className = '';
  readonly classList = new FakeClassList(this);
  readonly dataset: Record<string, string> = {};
  id = '';
  disabled = false;
  value = '';
  type = '';
  placeholder = '';
  href = '';
  target = '';
  rel = '';
  lang = '';
  /** <dialog> only */
  open = false;
  offsetLeft = 0;
  scrollLeft = 0;
  private readonly styleDecl = new FakeStyle();
  private readonly attrs = new Map<string, string>();
  private readonly listeners = new Map<string, { fn: Listener; once: boolean }[]>();

  constructor(readonly tagName: string) {
    super();
  }

  get style(): FakeStyle {
    return this.styleDecl;
  }

  /** h() assigns inline styles as a string. */
  set style(css: string) {
    this.styleDecl.cssText = css;
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement);
  }

  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) {
      const node = typeof n === 'string' ? new FakeText(n) : n;
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  insertBefore(node: FakeNode, ref: FakeNode | null): FakeNode {
    node.remove();
    node.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }

  removeChild(node: FakeNode): FakeNode {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  addEventListener(type: string, fn: Listener, opts?: { once?: boolean }): void {
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, once: opts?.once ?? false });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn));
  }

  /** Simple selectors only: "tag", ".a.b" or "tag.a.b". Anything else matches nothing. */
  matches(selector: string): boolean {
    if (/[^\w.-]/.test(selector)) return false;
    const [tag, ...classes] = selector.split('.');
    if (tag && tag.toLowerCase() !== this.tagName.toLowerCase()) return false;
    return classes.every((c) => this.classList.contains(c));
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const c of el.children) {
        if (c.matches(selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  select(): void {}

  focus(): void {
    focused = this;
  }

  /** Jumps at once: the fake has no smooth scrolling and fires no scroll event. */
  scrollTo(options: { left?: number }): void {
    if (options.left !== undefined) this.scrollLeft = options.left;
  }

  /** <dialog>: the fake has no top layer; open is what the tests read. */
  showModal(): void {
    this.open = true;
  }

  /** <dialog>: closes and fires close (a queued task in browsers, at once here). */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatch('close');
  }

  /** Canvas stand-in: tests never draw the share poster, so its PNG is empty. */
  toBlob(done: (blob: Blob | null) => void, type = 'image/png'): void {
    done(new Blob([], { type }));
  }

  click(): void {
    if (this.disabled) return;
    this.dispatch('click');
  }

  /** Fire an event here and bubble it to the root; returns it so callers can read defaultPrevented. */
  dispatch(type: string, key?: string): FakeEvent {
    const path: FakeElement[] = [];
    for (let n: FakeElement | null = this; n; n = n.parentNode) path.push(n);
    let stopped = false;
    const event: FakeEvent = {
      type,
      key,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    };
    for (const el of path) {
      event.currentTarget = el;
      for (const l of [...(el.listeners.get(type) ?? [])]) {
        if (l.once) el.removeEventListener(type, l.fn);
        l.fn(event);
      }
      if (stopped) break;
    }
    return event;
  }
}

/** The focused element, or <body> when nothing (still in the page) has focus. */
export function activeElement(): FakeElement {
  return focused?.isConnected ? focused : (document.body as unknown as FakeElement);
}

/**
 * A key press on the focused element. Escape then does what a browser does
 * with an open modal dialog: fire cancel at the topmost one and, unless that
 * was prevented, close it.
 */
export function pressKey(key: string): void {
  const down = activeElement().dispatch('keydown', key);
  if (key !== 'Escape' || down.defaultPrevented) return;
  const top = (document.body as unknown as FakeElement).querySelectorAll('dialog').filter((d) => d.open).pop();
  if (top && !top.dispatch('cancel').defaultPrevented) top.close();
}

export interface FakeDom {
  /** the #app root the game renders into */
  app: FakeElement;
  /** overlays, sheets and toasts land here */
  body: FakeElement;
}

/**
 * Install document, window, Node, navigator, location and history on
 * globalThis (a fresh page). hash: the address's fragment, e.g. '#r=...';
 * history.replaceState rewrites it like a browser.
 */
export function installDom(languages: string[] = ['en-US'], hash = ''): FakeDom {
  const documentElement = new FakeElement('html');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const app = new FakeElement('div');
  documentElement.append(head, body);
  body.append(app);
  focused = null;
  const doc = {
    documentElement,
    head,
    body,
    get activeElement() {
      return activeElement();
    },
    title: '',
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => new FakeText(text),
    querySelector: (selector: string) => (selector === '#app' ? app : documentElement.querySelector(selector)),
    querySelectorAll: (selector: string) => documentElement.querySelectorAll(selector),
    execCommand: () => false,
  };
  const g = globalThis as Record<string, unknown>;
  g.document = doc;
  g.window = globalThis;
  g.Node = FakeNode;
  g.scrollTo = () => {};
  const location = { pathname: '/', search: '', hash };
  g.location = location;
  const history = {
    state: null as unknown,
    replaceState(state: unknown, _title: string, url: string) {
      history.state = state;
      const at = url.indexOf('#');
      location.hash = at < 0 ? '' : url.slice(at);
    },
  };
  g.history = history;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { languages, language: languages[0], vibrate: () => true },
  });
  return { app, body };
}

export type StorageFault = 'none' | 'blocked' | 'full';

/**
 * Install a Map-backed localStorage and return the map. 'blocked' makes the
 * localStorage property getter itself throw SecurityError, as browsers do when
 * site data is blocked or a third-party iframe is denied storage. 'full' makes
 * every write throw QuotaExceededError. Pass the same map to survive a reload.
 */
export function installStorage(fault: StorageFault = 'none', map = new Map<string, string>()): Map<string, string> {
  const storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fault === 'full') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      map.set(key, String(value));
    },
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      if (fault === 'blocked') {
        throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied.", 'SecurityError');
      }
      return storage;
    },
  });
  return map;
}

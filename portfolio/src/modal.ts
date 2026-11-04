import { stripI18n } from './i18n';

/**
 * Accessible dialog for project / education / experience details. Uses the
 * native <dialog>: showModal() gives a focus trap, Esc closes it, and focus
 * returns to the opener.
 */
export interface ModalHooks {
  onOpen?(): void;
  onClose?(): void;
}

export class Modal {
  readonly dialog: HTMLDialogElement;
  private readonly body: HTMLElement;
  private opener: HTMLElement | null = null;

  constructor(hooks: ModalHooks = {}) {
    this.dialog = document.getElementById('modal') as HTMLDialogElement;
    this.body = document.getElementById('modal-body') as HTMLElement;
    this.dialog.addEventListener('close', () => {
      hooks.onClose?.();
      this.opener?.focus({ preventScroll: true });
      this.opener = null;
    });
    // click on the backdrop closes
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    this.hooks = hooks;
  }

  private readonly hooks: ModalHooks;

  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** Fill the dialog from a card / slingshot element's real HTML content. */
  openFor(source: HTMLElement, opener?: HTMLElement): void {
    const title = source.querySelector('h3, h2');
    const titleText = (title?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const stack = source.querySelector(':scope > .stack');
    const detail = source.querySelector('.detail');

    const frag = document.createDocumentFragment();
    const h = document.createElement('h2');
    h.id = 'modal-title';
    h.textContent = titleText;
    frag.append(h);
    if (stack) {
      const p = document.createElement('p');
      p.className = 'stack';
      p.textContent = stack.textContent ?? '';
      frag.append(p);
    }
    if (detail) frag.append(detail.cloneNode(true));
    if (source.classList.contains('card')) {
      const more = document.getElementById('more-projects');
      if (more) frag.append(more.cloneNode(true));
    }
    this.body.replaceChildren(frag);
    this.body.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    stripI18n(this.body); // the dialog shows a snapshot of the page text in the current language
    h.id = 'modal-title';

    this.opener = opener ?? (document.activeElement as HTMLElement | null);
    if (!this.dialog.open) this.dialog.showModal();
    this.hooks.onOpen?.();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }
}

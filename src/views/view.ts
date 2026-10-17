// What every view gives the frame (app.ts).

export interface View {
  /** Called every animation frame while the view is on screen. */
  frame(): void;
  /** The space for the picture changed (or the view came on screen). */
  resize(): void;
  key(e: KeyboardEvent): void;
}
/** Room inside the stage for the view's main column, in CSS pixels. */
export type Room = () => { w: number; h: number };
export type Log = (text: string) => void;

export const segmented = (root: HTMLElement, attr: string, value: string) =>
  root.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
